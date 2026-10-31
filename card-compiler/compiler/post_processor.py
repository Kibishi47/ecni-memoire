"""Post-processeur déterministe et moteur de règles métier Pokémon TCG (`compiler/post_processor.py`).

Ce module applique la fonction `sanitize_and_enrich_card(raw_tcgdex_card, compiled_model)` après
l'inférence LLM et avant la sauvegarde sur disque afin de corriger toute hallucination sémantique :
1. Injection et réconciliation déterministes des Talents (`abilities`) et Attaques (`attacks`) issus de TCGdex
   (extraction regex des dégâts de base, du bonus par Récompense, du coût de défausse d'énergie, des effets
   de pioche d'attaque comme *Explosion Hurlante* et des symboles d'énergie TCGdex `{R}` -> `"Feu"`).
2. Application stricte des invariants physiques du JCC Pokémon (Tour 1, Supporters, Stage 1 / Stage 2,
   conditions de KO au tour précédent, coûts de défausse de la main `HAND_MIN_OTHER_CARDS` + `DISCARD_FROM_HAND`).
3. Normalisation sémantique des primitives d'effets, filtres de ciblage (`CardFilter`), rôles stratégiques
   (`StrategicRole`), scores intrinsèques (`intrinsicBaseScore`), synergies de decklist
   (`decklistSynergyRequirements`) et conditions de carte morte (`inGameDeadCardConditions`).
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Union

from compiler.schemas import (
    ActionCost,
    ActionPrecondition,
    ActionSourceType,
    ActionTiming,
    AtomicEffect,
    CardCategory,
    CardFilter,
    CardSubCategory,
    CostType,
    DamageScalingType,
    DeadCardCondition,
    DeadCardReason,
    EffectPrimitive,
    EngineCardModel,
    PlayableAction,
    PreconditionType,
    SpecialConditionType,
    StrategicRole,
    SynergyRequirement,
    TurnPhaseWeights,
    ZoneType,
)
from compiler.tcgdex_fetcher import FetchedCardBundle

# Correspondance des symboles d'énergie TCGdex ({R}, {G}, {W}, {L}, {F}, {P}, {D}, {M}, {C}) vers les noms FR
TCGDEX_ENERGY_SYMBOL_MAP: Dict[str, str] = {
    "{r}": "Feu",
    "{g}": "Plante",
    "{w}": "Eau",
    "{l}": "Électrique",
    "{p}": "Psy",
    "{f}": "Combat",
    "{d}": "Obscurité",
    "{m}": "Métal",
    "{y}": "Fée",
    "{n}": "Dragon",
    "{c}": "Incolore",
}


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", text.lower()).strip("_")
    return slug or "action"


def _combined_rules_text(raw_fr: Dict[str, Any], raw_en: Optional[Dict[str, Any]]) -> str:
    parts: List[str] = []
    if raw_fr.get("effect"):
        parts.append(str(raw_fr["effect"]))
    if raw_en and raw_en.get("effect"):
        parts.append(str(raw_en["effect"]))
    for ab in (raw_fr.get("abilities") or []) + ((raw_en or {}).get("abilities") or []):
        if isinstance(ab, dict):
            parts.append(str(ab.get("name") or ""))
            parts.append(str(ab.get("effect") or ""))
    for atk in (raw_fr.get("attacks") or []) + ((raw_en or {}).get("attacks") or []):
        if isinstance(atk, dict):
            parts.append(str(atk.get("name") or ""))
            parts.append(str(atk.get("effect") or ""))
    return " ".join(parts)


def _extract_energy_type_from_text(text: str) -> Optional[str]:
    """Détecte le type d'énergie dans un texte d'effet TCGdex (symboles `{R}` ou noms FR/EN)."""
    lower = text.lower()
    for sym, name_fr in TCGDEX_ENERGY_SYMBOL_MAP.items():
        if sym in lower:
            return name_fr

    word_map = [
        (("énergie feu", "basic fire energy", "fire energy", "feu"), "Feu"),
        (("énergie plante", "grass energy"), "Plante"),
        (("énergie eau", "water energy"), "Eau"),
        (("énergie électrique", "lightning energy"), "Électrique"),
        (("énergie psy", "psychic energy"), "Psy"),
        (("énergie combat", "fighting energy"), "Combat"),
        (("énergie obscurité", "darkness energy"), "Obscurité"),
        (("énergie métal", "metal energy"), "Métal"),
    ]
    for keywords, name_fr in word_map:
        if any(kw in lower for kw in keywords):
            return name_fr
    return None


def _extract_hand_discard_cost(text: str) -> int:
    """Extrait le nombre X de cartes à défausser de la main (ex: 'défaussez 2 autres cartes de votre main' -> 2)."""
    lower = text.lower()
    m_num = re.search(
        r"(?:défaussez|défausser|discard)\s+(\d+)\s+(?:autres?\s+|other\s+)?(?:cartes?|cards?)\s+(?:de\s+votre\s+main|from\s+your\s+hand)",
        lower,
    )
    if m_num:
        return int(m_num.group(1))

    m_one = re.search(
        r"(?:défaussez|défausser|discard)\s+(?:une|a|an)\s+(?:autre\s+|other\s+)?(?:carte|card)\s+(?:de\s+votre\s+main|from\s+your\s+hand)",
        lower,
    )
    if m_one:
        return 1
    return 0


def _extract_int_from_damage(damage_val: Any, effect_text: str = "") -> Optional[int]:
    """Extrait les dégâts de base depuis le champ `damage` TCGdex (ex: 180, '180+', '70×', '120') ou le texte."""
    if isinstance(damage_val, int):
        return damage_val
    if isinstance(damage_val, str):
        m = re.search(r"(\d+)", damage_val)
        if m:
            return int(m.group(1))
    if effect_text:
        m_txt = re.search(r"(?:inflige|does)\s+(\d+)\s+(?:dégâts|damage)", effect_text, flags=re.IGNORECASE)
        if m_txt:
            return int(m_txt.group(1))
    return None


def _extract_prize_scaling_damage(effect_text: str) -> Optional[int]:
    """Extrait le bonus de dégâts par carte Récompense récupérée par l'adversaire (ex: +30 pour Dracaufeu-ex)."""
    if not effect_text:
        return None
    patterns = [
        r"(\d+)\s+dégâts\s+supplémentaires\s+pour\s+chaque\s+carte\s+Récompense",
        r"(\d+)\s+more\s+damage\s+for\s+each\s+Prize\s+card",
    ]
    for pat in patterns:
        m = re.search(pat, effect_text, flags=re.IGNORECASE)
        if m:
            return int(m.group(1))
    return None


def _dominant_energy_type(cost_list: List[str]) -> Optional[str]:
    """Détermine le type d'énergie principal requis par un coût d'attaque TCGdex."""
    if not cost_list:
        return None
    non_colorless = [
        str(c) for c in cost_list
        if str(c).lower() not in {"incolore", "colorless"}
    ]
    if non_colorless:
        return non_colorless[0]
    return str(cost_list[0])


def _detect_special_condition(lower_eff: str) -> Optional[SpecialConditionType]:
    """Détecte un État Spécial infligé dans le texte d'une attaque ou d'un talent."""
    if "empoisonné" in lower_eff or "poisoned" in lower_eff:
        return SpecialConditionType.POISONED
    if "brûlé" in lower_eff or "burned" in lower_eff:
        return SpecialConditionType.BURNED
    if "paralysé" in lower_eff or "paralyzed" in lower_eff:
        return SpecialConditionType.PARALYZED
    if "endormi" in lower_eff or "asleep" in lower_eff:
        return SpecialConditionType.ASLEEP
    if "confus" in lower_eff or "confused" in lower_eff:
        return SpecialConditionType.CONFUSED
    return None


def _detect_attack_scaling(
    raw_dmg_field: Any,
    base_dmg: Optional[int],
    prize_scaling: Optional[int],
    lower_eff: str,
) -> Tuple[Optional[DamageScalingType], Optional[int]]:
    """Détecte le type et la valeur du bonus/multiplicateur de dégâts d'une attaque."""
    if prize_scaling is not None:
        return DamageScalingType.PER_OPPONENT_PRIZE_TAKEN, prize_scaling

    dmg_str = str(raw_dmg_field or "")
    m_extra = re.search(
        r"(\d+)\s*(?:dégâts supplémentaires|more damage|damage for each|dégâts pour chaque)",
        lower_eff,
    )
    scaling_val = int(m_extra.group(1)) if m_extra else base_dmg

    if (
        "pour chaque énergie" in lower_eff
        or "pour chaque carte énergie" in lower_eff
        or "pour chaque carte défaussée" in lower_eff
        or "for each energy" in lower_eff
        or "for each basic energy" in lower_eff
        or "for each card you discarded" in lower_eff
    ):
        if "défauss" in lower_eff or "discard" in lower_eff:
            return DamageScalingType.PER_ENERGY_DISCARDED, scaling_val
        if "tous vos pokémon" in lower_eff or "all of your pokémon" in lower_eff:
            return DamageScalingType.PER_ENERGY_ATTACHED_ALL, scaling_val
        if "adversaire" in lower_eff or "opponent" in lower_eff:
            return DamageScalingType.PER_ENERGY_ATTACHED_TARGET, scaling_val
        return DamageScalingType.PER_ENERGY_ATTACHED_SELF, scaling_val

    if "marqueur de dégâts sur ce pokémon" in lower_eff or "damage counter on this pokémon" in lower_eff:
        return DamageScalingType.PER_DAMAGE_COUNTER_ON_SELF, scaling_val
    if "marqueur de dégâts sur le pokémon actif de votre adversaire" in lower_eff or "damage counter on your opponent's active" in lower_eff:
        return DamageScalingType.PER_DAMAGE_COUNTER_ON_TARGET, scaling_val
    if ("pokémon de banc" in lower_eff or "benched pokémon" in lower_eff) and ("pour chaque" in lower_eff or "for each" in lower_eff):
        return DamageScalingType.PER_BENCHED_POKEMON, scaling_val
    if ("pile ou face" in lower_eff or "flip a coin" in lower_eff or "flip" in lower_eff) and ("×" in dmg_str or "+" in dmg_str or "pour chaque côté face" in lower_eff or "for each heads" in lower_eff):
        return DamageScalingType.PER_COIN_FLIP_HEADS, scaling_val
    if ("pile de défausse" in lower_eff or "zone perdue" in lower_eff or "discard pile" in lower_eff or "lost zone" in lower_eff) and ("pour chaque" in lower_eff or "for each" in lower_eff):
        return DamageScalingType.PER_CARD_IN_DISCARD_OR_LOST_ZONE, scaling_val

    return None, None


def _build_deterministic_attack_action(
    atk_fr: Dict[str, Any],
    atk_en: Optional[Dict[str, Any]],
    sub_category: CardSubCategory,
) -> PlayableAction:
    """Construit une `PlayableAction` déterministe pour une attaque issue de TCGdex."""
    name_fr = str(atk_fr.get("name") or (atk_en or {}).get("name") or "Attaque").strip()
    name_en = str((atk_en or {}).get("name") or name_fr).strip()
    effect_fr = str(atk_fr.get("effect") or "").strip()
    effect_en = str((atk_en or {}).get("effect") or "").strip()
    combined_eff = f"{effect_fr} {effect_en}".strip()
    lower_eff = combined_eff.lower()

    cost_list = [str(c) for c in (atk_fr.get("cost") or (atk_en or {}).get("cost") or [])]
    energy_count = len(cost_list)

    raw_dmg_field = atk_fr.get("damage") if atk_fr.get("damage") is not None else (atk_en or {}).get("damage")
    base_dmg = _extract_int_from_damage(raw_dmg_field, combined_eff)
    prize_scaling = _extract_prize_scaling_damage(combined_eff)
    scaling_type, scaling_val = _detect_attack_scaling(raw_dmg_field, base_dmg, prize_scaling, lower_eff)

    is_stage_evo = sub_category in {CardSubCategory.STAGE_1, CardSubCategory.STAGE_2}

    preconditions: List[ActionPrecondition] = [
        ActionPrecondition(
            type=PreconditionType.SELF_IS_ACTIVE,
            zone=ZoneType.ACTIVE,
            minCount=1,
            targetFilter=None,
        )
    ]
    if energy_count > 0:
        # Comptage précis par type d'énergie non-Incolore (évite d'écraser les coûts multi-types comme ["Électrique", "Combat"])
        typed_counts: Dict[str, int] = {}
        colorless_count = 0
        for c in cost_list:
            if c.lower() in {"incolore", "colorless"}:
                colorless_count += 1
            else:
                typed_counts[c] = typed_counts.get(c, 0) + 1

        if len(typed_counts) > 1 or (len(typed_counts) == 1 and colorless_count > 0):
            for etype, cnt in typed_counts.items():
                preconditions.append(
                    ActionPrecondition(
                        type=PreconditionType.SELF_HAS_ENERGY_COST,
                        zone=ZoneType.ACTIVE,
                        minCount=cnt,
                        targetFilter=CardFilter(
                            category=CardCategory.ENERGY,
                            energyType=etype,
                        ),
                    )
                )
            if colorless_count > 0:
                preconditions.append(
                    ActionPrecondition(
                        type=PreconditionType.SELF_HAS_ENERGY_COST,
                        zone=ZoneType.ACTIVE,
                        minCount=energy_count,
                        targetFilter=CardFilter(
                            category=CardCategory.ENERGY,
                            energyType=None,
                        ),
                    )
                )
        else:
            energy_type = _dominant_energy_type(cost_list)
            if energy_type and energy_type.lower() in {"incolore", "colorless"}:
                energy_type = None
            preconditions.append(
                ActionPrecondition(
                    type=PreconditionType.SELF_HAS_ENERGY_COST,
                    zone=ZoneType.ACTIVE,
                    minCount=energy_count,
                    targetFilter=CardFilter(
                        category=CardCategory.ENERGY,
                        energyType=energy_type,
                    ),
                )
            )

    costs: List[ActionCost] = []
    # 1. Coût de défausse d'énergies en jeu (ex: Tempête Éclats / Bellowing Thunder d'Ire-Foudre-ex)
    m_disc_energy_num = re.search(
        r"(?:défaussez|défausser|discard)\s+(\d+)\s+(?:cartes?\s+)?(?:énergies?|energy)",
        lower_eff,
    )
    if m_disc_energy_num:
        is_basic_en = "de base" in lower_eff or "basic" in lower_eff
        costs.append(
            ActionCost(
                type=CostType.DISCARD_ENERGY_FROM_PLAY,
                count=int(m_disc_energy_num.group(1)),
                targetFilter=CardFilter(
                    category=CardCategory.ENERGY,
                    subCategory=CardSubCategory.BASIC_ENERGY if is_basic_en else None,
                ),
            )
        )
    elif (
        "défausser autant d'énergies" in lower_eff
        or "défaussez autant d'énergies" in lower_eff
        or "discard any amount of basic energy" in lower_eff
        or "discard any amount of energy" in lower_eff
    ):
        is_basic_en = "de base" in lower_eff or "basic" in lower_eff
        costs.append(
            ActionCost(
                type=CostType.DISCARD_ENERGY_FROM_PLAY,
                count=1,
                targetFilter=CardFilter(
                    category=CardCategory.ENERGY,
                    subCategory=CardSubCategory.BASIC_ENERGY if is_basic_en else None,
                ),
            )
        )

    # Coût d'impossibilité d'attaquer au prochain tour
    if (
        "ne peut pas attaquer pendant votre prochain tour" in lower_eff
        or "can't attack during your next turn" in lower_eff
    ):
        costs.append(
            ActionCost(
                type=CostType.CANT_ATTACK_NEXT_TURN,
                count=1,
                targetFilter=None,
            )
        )

    # Coût de dégâts de recul (self-damage)
    m_self_dmg = re.search(
        r"(?:ce pokémon s'inflige|this pokémon also does)\s+(\d+)\s+(?:dégâts|damage)",
        lower_eff,
    )
    if m_self_dmg:
        costs.append(
            ActionCost(
                type=CostType.SELF_DAMAGE,
                count=int(m_self_dmg.group(1)),
                targetFilter=None,
            )
        )

    effects: List[AtomicEffect] = []

    # 2. Attaque de rafraîchissement de main / pioche sans dégâts (ex: Explosion Hurlante / Burst Roar d'Ire-Foudre-ex)
    m_disc_hand_draw = re.search(
        r"(?:défaussez votre main.*?piochez|discard your hand and draw)\s+(\d+)\s+(?:cartes|cards)",
        lower_eff,
    )
    if m_disc_hand_draw and base_dmg is None:
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.DISCARD_HAND_AND_DRAW,
                sourceZone=ZoneType.DECK,
                targetZone=ZoneType.HAND,
                count=int(m_disc_hand_draw.group(1)),
                upTo=False,
                targetFilter=None,
                baseDamage=None,
                damageScalingPerOpponentPrizeTaken=None,
            )
        )
    elif base_dmg is None:
        m_draw_until = re.search(
            r"(?:piochez des cartes jusqu'à en avoir|draw cards until you have)\s+(\d+)",
            lower_eff,
        )
        m_draw_only = re.search(r"(?:piochez|draw)\s+(\d+)\s+(?:cartes|cards)", lower_eff)
        if m_draw_until:
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.DRAW_UNTIL_HAND_SIZE,
                    sourceZone=ZoneType.DECK,
                    targetZone=ZoneType.HAND,
                    count=int(m_draw_until.group(1)),
                    upTo=False,
                    targetFilter=None,
                )
            )
        elif m_draw_only:
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.DRAW_CARDS,
                    sourceZone=ZoneType.DECK,
                    targetZone=ZoneType.HAND,
                    count=int(m_draw_only.group(1)),
                    upTo=False,
                    targetFilter=None,
                    baseDamage=None,
                    damageScalingPerOpponentPrizeTaken=None,
                )
            )

    if not effects or base_dmg is not None:
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.DEAL_DAMAGE_ACTIVE,
                sourceZone=ZoneType.ACTIVE,
                targetZone=ZoneType.ACTIVE,
                count=1,
                upTo=False,
                targetFilter=None,
                baseDamage=base_dmg if base_dmg is not None else 0,
                damageScalingPerOpponentPrizeTaken=prize_scaling,
                damageScalingType=scaling_type,
                damageScalingValue=scaling_val,
            )
        )

    # Effet additionnel d'État Spécial infligé au Pokémon Actif adverse
    spec_cond = _detect_special_condition(lower_eff)
    if spec_cond is not None and ("pokémon actif de votre adversaire" in lower_eff or "opponent's active pokémon" in lower_eff or "pokémon défenseur" in lower_eff):
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.APPLY_SPECIAL_CONDITION,
                sourceZone=ZoneType.ACTIVE,
                targetZone=ZoneType.OPPONENT_ACTIVE,
                count=1,
                upTo=False,
                targetFilter=None,
                specialCondition=spec_cond,
            )
        )

    # Effet additionnel de dégâts sur le Banc adverse
    m_bench_dmg = re.search(
        r"(\d+)\s+(?:dégâts à l'un des pokémon de banc|damage to 1 of your opponent's benched)",
        lower_eff,
    )
    if m_bench_dmg:
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.DEAL_DAMAGE_BENCH,
                sourceZone=ZoneType.ACTIVE,
                targetZone=ZoneType.OPPONENT_BENCH,
                count=1,
                upTo=False,
                targetFilter=CardFilter(category=CardCategory.POKEMON),
                baseDamage=int(m_bench_dmg.group(1)),
            )
        )

    return PlayableAction(
        actionId=f"attack_{_slugify(name_en)}",
        label=name_fr,
        sourceType=ActionSourceType.ATTACK,
        timing=ActionTiming.END_OF_TURN_ATTACK,
        canUseTurn1GoingFirst=False,
        canUseTurn1GoingSecond=not is_stage_evo,
        energyCost=cost_list,
        preconditions=preconditions,
        costs=costs,
        effects=effects,
    )


def _build_deterministic_ability_action(
    ab_fr: Dict[str, Any],
    ab_en: Optional[Dict[str, Any]],
    sub_category: CardSubCategory,
) -> Optional[PlayableAction]:
    """Construit ou corrige de façon déterministe une `PlayableAction` pour un Talent Pokémon TCGdex."""
    name_fr = str(ab_fr.get("name") or (ab_en or {}).get("name") or "Talent").strip()
    name_en = str((ab_en or {}).get("name") or name_fr).strip()
    effect_fr = str(ab_fr.get("effect") or "").strip()
    effect_en = str((ab_en or {}).get("effect") or "").strip()
    combined_eff = f"{effect_fr} {effect_en}".strip()
    lower_eff = combined_eff.lower()

    is_stage_evo = sub_category in {CardSubCategory.STAGE_1, CardSubCategory.STAGE_2}

    # 1. Talent déclenché à l'évolution (ex: Règne Infernal de Dracaufeu-ex, Chercheur de Joyaux de Noarfang)
    if (
        "lorsque vous jouez ce pokémon de votre main pour faire évoluer" in lower_eff
        or "when you play this pokémon from your hand to evolve" in lower_eff
    ):
        # 1a. Attachement d'énergie depuis le deck (ex: Règne Infernal)
        if "cherchez dans votre deck" in lower_eff and ("énergie" in lower_eff or "energy" in lower_eff):
            m_count = re.search(r"(?:jusqu'à|up to)\s+(\d+)", lower_eff)
            count = int(m_count.group(1)) if m_count else 3
            energy_type = _extract_energy_type_from_text(combined_eff)
            if energy_type is None and ("infernal" in name_fr.lower() or "infernal" in name_en.lower()):
                energy_type = "Feu"
            energy_filter = CardFilter(
                category=CardCategory.ENERGY,
                subCategory=CardSubCategory.BASIC_ENERGY,
                energyType=energy_type,
            )
            return PlayableAction(
                actionId=f"ability_{_slugify(name_en)}",
                label=name_fr,
                sourceType=ActionSourceType.ABILITY_ON_EVOLVE,
                timing=ActionTiming.ON_EVOLVE_TRIGGER,
                canUseTurn1GoingFirst=False,
                canUseTurn1GoingSecond=False,
                preconditions=[
                    ActionPrecondition(
                        type=PreconditionType.ZONE_HAS_MATCHING_CARD,
                        zone=ZoneType.DECK,
                        minCount=1,
                        targetFilter=energy_filter,
                    )
                ],
                costs=[],
                effects=[
                    AtomicEffect(
                        primitive=EffectPrimitive.SEARCH_AND_ATTACH_ENERGY,
                        sourceZone=ZoneType.DECK,
                        targetZone=ZoneType.IN_PLAY_ALL,
                        count=count,
                        upTo=True,
                        targetFilter=energy_filter,
                        baseDamage=None,
                        damageScalingPerOpponentPrizeTaken=None,
                    )
                ],
            )

        # 1b. Recherche de Dresseurs avec condition Téracristal (ex: Noarfang sv07-115 Chercheur de Joyaux)
        if "téracristal" in lower_eff or "tera pokémon" in lower_eff:
            m_count = re.search(r"(?:jusqu'à|up to)\s+(\d+)", lower_eff)
            count = int(m_count.group(1)) if m_count else 2
            trainer_filter = CardFilter(category=CardCategory.TRAINER)
            return PlayableAction(
                actionId=f"ability_{_slugify(name_en)}",
                label=name_fr,
                sourceType=ActionSourceType.ABILITY_ON_EVOLVE,
                timing=ActionTiming.ON_EVOLVE_TRIGGER,
                canUseTurn1GoingFirst=False,
                canUseTurn1GoingSecond=False,
                preconditions=[
                    ActionPrecondition(
                        type=PreconditionType.HAS_TERA_POKEMON_IN_PLAY,
                        zone=ZoneType.IN_PLAY_ALL,
                        minCount=1,
                        targetFilter=CardFilter(category=CardCategory.POKEMON, isTera=True),
                    ),
                    ActionPrecondition(
                        type=PreconditionType.ZONE_HAS_MATCHING_CARD,
                        zone=ZoneType.DECK,
                        minCount=1,
                        targetFilter=trainer_filter,
                    ),
                ],
                costs=[],
                effects=[
                    AtomicEffect(
                        primitive=EffectPrimitive.SEARCH_DECK_TO_HAND,
                        sourceZone=ZoneType.DECK,
                        targetZone=ZoneType.HAND,
                        count=count,
                        upTo=True,
                        targetFilter=trainer_filter,
                    )
                ],
            )

    # 2. Talent déclenché à la pose de la main sur le Banc (ex: Vert-de-Fer-ex Vernier Rapide, Brutalibré)
    if (
        "lorsque vous jouez ce pokémon de votre main sur votre banc" in lower_eff
        or "when you play this pokémon from your hand onto your bench" in lower_eff
    ):
        effects_on_play: List[AtomicEffect] = []
        if "poste actif" in lower_eff or "pokémon actif" in lower_eff or "active spot" in lower_eff or "active pokémon" in lower_eff:
            effects_on_play.append(
                AtomicEffect(
                    primitive=EffectPrimitive.SWITCH_ACTIVE_POKEMON,
                    sourceZone=ZoneType.BENCH,
                    targetZone=ZoneType.ACTIVE,
                    count=1,
                )
            )
        if ("déplacez" in lower_eff or "déplacer" in lower_eff or "move" in lower_eff) and ("énergie" in lower_eff or "energy" in lower_eff):
            effects_on_play.append(
                AtomicEffect(
                    primitive=EffectPrimitive.MOVE_ENERGY_BETWEEN_POKEMON,
                    sourceZone=ZoneType.IN_PLAY_ALL,
                    targetZone=ZoneType.ACTIVE,
                    count=1,
                    upTo=True,
                    targetFilter=CardFilter(category=CardCategory.ENERGY),
                )
            )
        if "marqueur" in lower_eff or "damage counter" in lower_eff:
            m_dc = re.search(r"(\d+)\s+marqueur", lower_eff)
            effects_on_play.append(
                AtomicEffect(
                    primitive=EffectPrimitive.PLACE_DAMAGE_COUNTERS,
                    sourceZone=ZoneType.BENCH,
                    targetZone=ZoneType.OPPONENT_BENCH,
                    count=int(m_dc.group(1)) if m_dc else 1,
                )
            )
        if not effects_on_play:
            effects_on_play.append(
                AtomicEffect(
                    primitive=EffectPrimitive.DRAW_CARDS,
                    sourceZone=ZoneType.DECK,
                    targetZone=ZoneType.HAND,
                    count=1,
                )
            )
        return PlayableAction(
            actionId=f"ability_{_slugify(name_en)}",
            label=name_fr,
            sourceType=ActionSourceType.ABILITY_ON_PLAY_FROM_HAND,
            timing=ActionTiming.ON_PLAY_FROM_HAND_TRIGGER,
            canUseTurn1GoingFirst=True,
            canUseTurn1GoingSecond=True,
            preconditions=[],
            costs=[],
            effects=effects_on_play,
        )

    # 3. Talent réactif aux dégâts subis ou au K.O. (ex: Rosélia Point Poison, Momartik-ex, Craparoi-ex)
    if (
        "subit les dégâts d'une attaque" in lower_eff
        or "damaged by an attack" in lower_eff
        or "est mis k.o. par les dégâts d'une attaque" in lower_eff
        or "is knocked out by damage from an attack" in lower_eff
    ):
        spec_cond = _detect_special_condition(lower_eff)
        reactive_effects: List[AtomicEffect] = []
        if spec_cond is not None:
            reactive_effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.APPLY_SPECIAL_CONDITION,
                    sourceZone=ZoneType.ACTIVE,
                    targetZone=ZoneType.OPPONENT_ACTIVE,
                    count=1,
                    specialCondition=spec_cond,
                )
            )
        else:
            m_dc = re.search(r"(\d+)\s+(?:marqueurs? de dégâts|damage counters?)", lower_eff)
            reactive_effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.PLACE_DAMAGE_COUNTERS,
                    sourceZone=ZoneType.ACTIVE,
                    targetZone=ZoneType.OPPONENT_ACTIVE,
                    count=int(m_dc.group(1)) if m_dc else 2,
                )
            )
        return PlayableAction(
            actionId=f"ability_{_slugify(name_en)}",
            label=name_fr,
            sourceType=ActionSourceType.ABILITY_REACTIVE,
            timing=ActionTiming.ON_DAMAGED_OR_KO_TRIGGER,
            canUseTurn1GoingFirst=False,
            canUseTurn1GoingSecond=False,
            preconditions=[
                ActionPrecondition(
                    type=PreconditionType.SELF_IS_ACTIVE,
                    zone=ZoneType.ACTIVE,
                    minCount=1,
                )
            ],
            costs=[],
            effects=reactive_effects,
        )

    # 4. Talent activé avec auto-K.O. et pose de marqueurs de dégâts (ex: Noctunoir sv06.5-020 Explosion Maudite)
    if (
        ("ce pokémon est mis k.o." in lower_eff or "this pokémon is knocked out" in lower_eff)
        and ("marqueurs de dégâts" in lower_eff or "damage counters" in lower_eff)
    ):
        m_dc = re.search(r"(\d+)\s+(?:marqueurs? de dégâts|damage counters?)", lower_eff)
        dc_count = int(m_dc.group(1)) if m_dc else 13
        return PlayableAction(
            actionId=f"ability_{_slugify(name_en)}",
            label=name_fr,
            sourceType=ActionSourceType.ABILITY_ACTIVATED,
            timing=ActionTiming.ONCE_PER_TURN_ABILITY,
            canUseTurn1GoingFirst=not is_stage_evo,
            canUseTurn1GoingSecond=not is_stage_evo,
            preconditions=[],
            costs=[
                ActionCost(
                    type=CostType.KNOCK_OUT_SELF,
                    count=1,
                    targetFilter=None,
                )
            ],
            effects=[
                AtomicEffect(
                    primitive=EffectPrimitive.PLACE_DAMAGE_COUNTERS,
                    sourceZone=ZoneType.IN_PLAY_ALL,
                    targetZone=ZoneType.OPPONENT_IN_PLAY_ALL,
                    count=dc_count,
                    upTo=False,
                    targetFilter=CardFilter(category=CardCategory.POKEMON),
                )
            ],
        )

    # 5. Talent activé conditionné par un KO au tour précédent (ex: Retour Renversant / Flip the Script de Favianos-ex)
    if (
        "mis k.o. pendant le dernier tour de votre adversaire" in lower_eff
        or "knocked out during your opponent's last turn" in lower_eff
    ):
        m_draw = re.search(r"(?:piochez|draw)\s+(\d+)\s+(?:cartes|cards)", lower_eff)
        draw_count = int(m_draw.group(1)) if m_draw else 3
        return PlayableAction(
            actionId=f"ability_{_slugify(name_en)}",
            label=name_fr,
            sourceType=ActionSourceType.ABILITY_ACTIVATED,
            timing=ActionTiming.ONCE_PER_TURN_ABILITY,
            canUseTurn1GoingFirst=False,
            canUseTurn1GoingSecond=True,
            preconditions=[
                ActionPrecondition(
                    type=PreconditionType.KO_SUFFERED_LAST_TURN,
                    zone=ZoneType.DISCARD,
                    minCount=1,
                    targetFilter=CardFilter(category=CardCategory.POKEMON),
                )
            ],
            costs=[],
            effects=[
                AtomicEffect(
                    primitive=EffectPrimitive.DRAW_CARDS,
                    sourceZone=ZoneType.DECK,
                    targetZone=ZoneType.HAND,
                    count=draw_count,
                    upTo=False,
                    targetFilter=None,
                    baseDamage=None,
                    damageScalingPerOpponentPrizeTaken=None,
                )
            ],
        )

    # 6. Talent de tutorat universel dans le deck (ex: Recherche Rapide / Quick Search de Roucarnage-ex)
    if (
        ("chercher dans votre deck une carte" in lower_eff or "search your deck for a card" in lower_eff)
        and ("ajoutez-la à votre main" in lower_eff or "put it into your hand" in lower_eff)
    ):
        return PlayableAction(
            actionId=f"ability_{_slugify(name_en)}",
            label=name_fr,
            sourceType=ActionSourceType.ABILITY_ACTIVATED,
            timing=ActionTiming.ONCE_PER_TURN_ABILITY,
            canUseTurn1GoingFirst=not is_stage_evo,
            canUseTurn1GoingSecond=not is_stage_evo,
            preconditions=[
                ActionPrecondition(
                    type=PreconditionType.ZONE_HAS_MATCHING_CARD,
                    zone=ZoneType.DECK,
                    minCount=1,
                    targetFilter=None,
                )
            ],
            costs=[],
            effects=[
                AtomicEffect(
                    primitive=EffectPrimitive.SEARCH_DECK_TO_HAND,
                    sourceZone=ZoneType.DECK,
                    targetZone=ZoneType.HAND,
                    count=1,
                    upTo=False,
                    targetFilter=None,
                    baseDamage=None,
                    damageScalingPerOpponentPrizeTaken=None,
                )
            ],
        )

    # 7. Talent activé de pioche jusqu'à X cartes en main (ex: Mew-ex Reprise, Vrombotor Vrombi-Moteur)
    m_draw_until = re.search(
        r"(?:piochez des cartes jusqu'à en avoir|draw cards until you have)\s+(\d+)",
        lower_eff,
    )
    if m_draw_until and ("pendant votre tour" in lower_eff or "during your turn" in lower_eff):
        hand_target = int(m_draw_until.group(1))
        costs_until: List[ActionCost] = []
        if "défaussez une carte énergie" in lower_eff or "discard an energy card" in lower_eff:
            costs_until.append(
                ActionCost(
                    type=CostType.DISCARD_FROM_HAND,
                    count=1,
                    targetFilter=CardFilter(category=CardCategory.ENERGY),
                )
            )
        return PlayableAction(
            actionId=f"ability_{_slugify(name_en)}",
            label=name_fr,
            sourceType=ActionSourceType.ABILITY_ACTIVATED,
            timing=ActionTiming.ONCE_PER_TURN_ABILITY,
            canUseTurn1GoingFirst=not is_stage_evo,
            canUseTurn1GoingSecond=not is_stage_evo,
            preconditions=[],
            costs=costs_until,
            effects=[
                AtomicEffect(
                    primitive=EffectPrimitive.DRAW_UNTIL_HAND_SIZE,
                    sourceZone=ZoneType.DECK,
                    targetZone=ZoneType.HAND,
                    count=hand_target,
                    upTo=False,
                    targetFilter=None,
                )
            ],
        )

    # 8. Talents passifs continus (aucun marqueur d'activation ou de pose depuis la main)
    is_activated_or_triggered = any(
        marker in lower_eff
        for marker in (
            "pendant votre tour",
            "during your turn",
            "lorsque vous jouez",
            "when you play",
            "lorsque ce pokémon",
            "when this pokémon",
        )
    )
    if not is_activated_or_triggered:
        passive_timing = (
            ActionTiming.BETWEEN_TURNS_CHECKUP
            if ("contrôle pokémon" in lower_eff or "pokémon checkup" in lower_eff)
            else ActionTiming.PASSIVE_CONTINUOUS
        )
        m_red = re.search(r"subit\s+(\d+)\s+dégâts\s+de\s+moins|takes\s+(\d+)\s+less\s+damage", lower_eff)
        m_boost = re.search(r"infligent\s+(\d+)\s+dégâts\s+supplémentaires|do\s+(\d+)\s+more\s+damage", lower_eff)

        if m_red:
            val = int(m_red.group(1) or m_red.group(2))
            prim = EffectPrimitive.PASSIVE_DAMAGE_REDUCTION
        elif m_boost:
            val = int(m_boost.group(1) or m_boost.group(2))
            prim = EffectPrimitive.PASSIVE_DAMAGE_BOOST
        elif "coût de retraite" in lower_eff or "retreat cost" in lower_eff:
            val = 1
            prim = EffectPrimitive.PASSIVE_RETREAT_COST_MOD
        elif (
            "n'ont pas de talent" in lower_eff
            or "have no abilities" in lower_eff
            or "ne peut pas jouer de cartes objet" in lower_eff
            or "can't play any item cards" in lower_eff
        ):
            val = 1
            prim = EffectPrimitive.PASSIVE_ABILITY_OR_ITEM_LOCK
        else:
            val = 1
            prim = EffectPrimitive.PASSIVE_PREVENT_DAMAGE_OR_EFFECTS

        return PlayableAction(
            actionId=f"ability_{_slugify(name_en)}",
            label=name_fr,
            sourceType=ActionSourceType.ABILITY_PASSIVE,
            timing=passive_timing,
            canUseTurn1GoingFirst=not is_stage_evo,
            canUseTurn1GoingSecond=not is_stage_evo,
            preconditions=[],
            costs=[],
            effects=[
                AtomicEffect(
                    primitive=prim,
                    sourceZone=ZoneType.IN_PLAY_ALL,
                    targetZone=ZoneType.IN_PLAY_ALL,
                    count=val,
                    upTo=False,
                    targetFilter=None,
                )
            ],
        )

    return None


def _sanitize_pokemon_card(
    raw_fr: Dict[str, Any],
    raw_en: Optional[Dict[str, Any]],
    compiled_model: EngineCardModel,
) -> None:
    """Corrige les actions, le rôle stratégique et les synergies d'une carte POKEMON."""
    sub_cat = compiled_model.subCategory
    is_stage_evo = sub_cat in {CardSubCategory.STAGE_1, CardSubCategory.STAGE_2}

    compiled_model.playableActions = [
        act for act in compiled_model.playableActions
        if act.sourceType != ActionSourceType.TRAINER_PLAY
    ]

    # 1. Réconciliation des Talents (abilities)
    abilities_fr = [a for a in (raw_fr.get("abilities") or []) if isinstance(a, dict)]
    abilities_en = [a for a in ((raw_en or {}).get("abilities") or []) if isinstance(a, dict)]
    all_raw_abilities = abilities_fr + abilities_en

    # Si le Pokémon n'a AUCUN talent dans ses données TCGdex brutes :
    # PURGE STRICTE ET ABSOLUE de tout talent fantôme halluciné ou contaminé
    ability_source_types = {
        ActionSourceType.ABILITY_ACTIVATED,
        ActionSourceType.ABILITY_ON_EVOLVE,
        ActionSourceType.ABILITY_ON_PLAY_FROM_HAND,
        ActionSourceType.ABILITY_REACTIVE,
        ActionSourceType.ABILITY_PASSIVE,
    }
    if not all_raw_abilities:
        compiled_model.playableActions = [
            act for act in compiled_model.playableActions
            if act.sourceType not in ability_source_types
            and act.timing not in {
                ActionTiming.ONCE_PER_TURN_ABILITY,
                ActionTiming.AS_OFTEN_AS_YOU_LIKE,
                ActionTiming.ON_EVOLVE_TRIGGER,
                ActionTiming.ON_PLAY_FROM_HAND_TRIGGER,
                ActionTiming.ON_DAMAGED_OR_KO_TRIGGER,
            }
        ]
        final_abilities: List[PlayableAction] = []
    else:
        deterministic_abilities: List[PlayableAction] = []
        for idx, ab_fr in enumerate(abilities_fr):
            ab_en = abilities_en[idx] if idx < len(abilities_en) else None
            det_ab = _build_deterministic_ability_action(ab_fr, ab_en, sub_cat)
            if det_ab is not None:
                deterministic_abilities.append(det_ab)

        # Collecte des noms de talents autorisés issus de TCGdex
        allowed_ability_names = set()
        for ab in all_raw_abilities:
            name_val = str(ab.get("name") or "").strip().lower()
            if name_val:
                allowed_ability_names.add(name_val)
                allowed_ability_names.add(_slugify(name_val))

        if deterministic_abilities:
            final_abilities = deterministic_abilities
        else:
            existing_abilities = [
                act for act in compiled_model.playableActions
                if act.sourceType in ability_source_types
            ]
            final_abilities = [
                act for act in existing_abilities
                if any(
                    allowed in act.label.strip().lower()
                    or allowed in _slugify(act.label)
                    or allowed in act.actionId.replace("ability_", "").strip().lower()
                    for allowed in allowed_ability_names
                )
            ]

    # 2. Réconciliation des Attaques (attacks)
    attacks_fr = [a for a in (raw_fr.get("attacks") or []) if isinstance(a, dict)]
    attacks_en = [a for a in ((raw_en or {}).get("attacks") or []) if isinstance(a, dict)]
    deterministic_attacks: List[PlayableAction] = []
    for idx, atk_fr in enumerate(attacks_fr):
        atk_en = attacks_en[idx] if idx < len(attacks_en) else None
        det_atk = _build_deterministic_attack_action(atk_fr, atk_en, sub_cat)
        deterministic_attacks.append(det_atk)

    final_attacks = deterministic_attacks if deterministic_attacks else [
        act for act in compiled_model.playableActions if act.sourceType == ActionSourceType.ATTACK
    ]
    compiled_model.playableActions = final_abilities + final_attacks

    # 3. Application des invariants physiques par action
    all_text_lower = _combined_rules_text(raw_fr, raw_en).lower()
    for act in compiled_model.playableActions:
        if is_stage_evo:
            act.canUseTurn1GoingFirst = False
            act.canUseTurn1GoingSecond = False
        if act.sourceType == ActionSourceType.ATTACK:
            act.canUseTurn1GoingFirst = False
            act.timing = ActionTiming.END_OF_TURN_ATTACK
        if any(p.type == PreconditionType.KO_SUFFERED_LAST_TURN for p in act.preconditions):
            act.canUseTurn1GoingFirst = False
            act.canUseTurn1GoingSecond = True

    # 4. Rôle stratégique, score intrinsèque et pondérations par tour
    evaluator = compiled_model.strategicEvaluator
    if is_stage_evo:
        evaluator.turnPhaseWeights.turn1 = 0.0
        if evaluator.turnPhaseWeights.turn2 < 1.5:
            evaluator.turnPhaseWeights.turn2 = 1.8
        if evaluator.turnPhaseWeights.turn3 < 1.8:
            evaluator.turnPhaseWeights.turn3 = 2.0
        if evaluator.turnPhaseWeights.turn4Plus < 1.8:
            evaluator.turnPhaseWeights.turn4Plus = 1.9

    has_universal_tutor = any(
        eff.primitive == EffectPrimitive.SEARCH_DECK_TO_HAND and eff.targetFilter is None
        for act in final_abilities
        for eff in act.effects
    )
    has_draw_ability = any(
        eff.primitive == EffectPrimitive.DRAW_CARDS
        for act in final_abilities
        for eff in act.effects
    )
    has_energy_discard_scaling_attack = any(
        any(c.type == CostType.DISCARD_ENERGY_FROM_PLAY for c in act.costs)
        and any(eff.primitive == EffectPrimitive.DEAL_DAMAGE_ACTIVE for eff in act.effects)
        for act in final_attacks
    )
    max_base_dmg = max(
        (
            eff.baseDamage or 0
            for act in final_attacks
            for eff in act.effects
            if eff.primitive == EffectPrimitive.DEAL_DAMAGE_ACTIVE
        ),
        default=0,
    )

    if has_universal_tutor:
        evaluator.primaryRole = StrategicRole.TUTOR_ENGINE_POKEMON
        evaluator.intrinsicBaseScore = 96
        evaluator.discardPriorityWhenDead = 80
        evaluator.holdForNextTurnBonus = 44
    elif has_draw_ability:
        evaluator.primaryRole = StrategicRole.DRAW_ENGINE_POKEMON
        evaluator.intrinsicBaseScore = 91
        evaluator.discardPriorityWhenDead = 35
        evaluator.holdForNextTurnBonus = 30
    elif max_base_dmg >= 150 or has_energy_discard_scaling_attack:
        evaluator.primaryRole = StrategicRole.MAIN_ATTACKER
        evaluator.intrinsicBaseScore = 97 if is_stage_evo else 95
        evaluator.discardPriorityWhenDead = 82 if is_stage_evo else 30
        evaluator.holdForNextTurnBonus = 45 if is_stage_evo else 32

    if any(
        p.type == PreconditionType.KO_SUFFERED_LAST_TURN
        for act in final_abilities
        for p in act.preconditions
    ):
        evaluator.turnPhaseWeights = TurnPhaseWeights(
            turn1=0.0,
            turn2=1.6,
            turn3=1.8,
            turn4Plus=1.8,
        )

    # 5. Synergies de decklist et conditions de carte morte pour les Pokémon
    pstats = compiled_model.pokemonStats
    root_basic = pstats.rootBasicName if pstats and pstats.rootBasicName else None

    if sub_cat == CardSubCategory.STAGE_2 and root_basic:
        synergies: List[SynergyRequirement] = [
            SynergyRequirement(
                requiredFilter=CardFilter(
                    category=CardCategory.POKEMON,
                    subCategory=CardSubCategory.BASIC,
                    specificCardName=root_basic,
                ),
                minCountInDeck=2,
                ifMissingSetValueToZero=True,
                bonusWeightPerCopy=20.0,
            ),
            SynergyRequirement(
                requiredFilter=CardFilter(
                    category=CardCategory.TRAINER,
                    subCategory=CardSubCategory.ITEM,
                    specificCardName="Super Bonbon",
                ),
                minCountInDeck=2,
                ifMissingSetValueToZero=False,
                bonusWeightPerCopy=15.0,
            ),
        ]
        for act in final_abilities:
            for eff in act.effects:
                if (
                    eff.primitive == EffectPrimitive.SEARCH_AND_ATTACH_ENERGY
                    and eff.targetFilter
                    and eff.targetFilter.subCategory == CardSubCategory.BASIC_ENERGY
                ):
                    synergies.append(
                        SynergyRequirement(
                            requiredFilter=CardFilter(
                                category=CardCategory.ENERGY,
                                subCategory=CardSubCategory.BASIC_ENERGY,
                                energyType=eff.targetFilter.energyType,
                            ),
                            minCountInDeck=5,
                            ifMissingSetValueToZero=True,
                            bonusWeightPerCopy=8.0,
                        )
                    )
        evaluator.decklistSynergyRequirements = synergies
        evaluator.inGameDeadCardConditions = [
            DeadCardCondition(
                reason=DeadCardReason.NO_BASE_POKEMON_LINE_LEFT,
                zonesToCheck=[ZoneType.BENCH, ZoneType.ACTIVE, ZoneType.HAND, ZoneType.DECK],
                targetFilter=CardFilter(
                    category=CardCategory.POKEMON,
                    subCategory=CardSubCategory.BASIC,
                    specificCardName=root_basic,
                ),
            )
        ]
    elif has_energy_discard_scaling_attack:
        evaluator.turnPhaseWeights = TurnPhaseWeights(
            turn1=1.7,
            turn2=1.9,
            turn3=2.0,
            turn4Plus=1.9,
        )
        evaluator.decklistSynergyRequirements = [
            SynergyRequirement(
                requiredFilter=CardFilter(
                    category=CardCategory.ENERGY,
                    subCategory=CardSubCategory.BASIC_ENERGY,
                ),
                minCountInDeck=8,
                ifMissingSetValueToZero=True,
                bonusWeightPerCopy=6.0,
            )
        ]
        evaluator.inGameDeadCardConditions = []
    elif "énergie spéciale" not in all_text_lower and "special energy" not in all_text_lower:
        evaluator.decklistSynergyRequirements = [
            syn for syn in evaluator.decklistSynergyRequirements
            if syn.requiredFilter.subCategory != CardSubCategory.SPECIAL_ENERGY
        ]


def _sanitize_trainer_card(
    raw_fr: Dict[str, Any],
    raw_en: Optional[Dict[str, Any]],
    compiled_model: EngineCardModel,
) -> None:
    """Corrige les actions, préconditions, coûts, effets, rôles et synergies d'une carte TRAINER."""
    sub_cat = compiled_model.subCategory
    is_supporter = sub_cat == CardSubCategory.SUPPORTER

    name_fr = compiled_model.identity.nameFr
    name_en = compiled_model.identity.nameEn or name_fr
    text_fr = str(raw_fr.get("effect") or "").strip()
    text_en = str((raw_en or {}).get("effect") or "").strip()
    combined_text = f"{text_fr} {text_en}".strip()
    lower_text = combined_text.lower()

    if is_supporter:
        default_source = ActionSourceType.TRAINER_PLAY
        timing = ActionTiming.ONCE_PER_TURN_SUPPORTER
    elif sub_cat == CardSubCategory.STADIUM:
        default_source = ActionSourceType.STADIUM_EFFECT
        if "une fois pendant le tour" in lower_text or "once during each player's turn" in lower_text:
            timing = ActionTiming.ONCE_PER_TURN_STADIUM
        else:
            timing = ActionTiming.PASSIVE_CONTINUOUS
    elif sub_cat == CardSubCategory.TOOL:
        default_source = ActionSourceType.TOOL_EFFECT
        if "puissance vstar" in lower_text or "vstar power" in lower_text:
            timing = ActionTiming.ONCE_PER_GAME_VSTAR
        else:
            timing = ActionTiming.PASSIVE_CONTINUOUS
    else:
        default_source = ActionSourceType.TRAINER_PLAY
        timing = ActionTiming.ONCE_PER_CARD

    # Cas particulier des Capsules Techniques (Technical Machines) : Outils qui confèrent une attaque
    if compiled_model.identity.isTechnicalMachine and (raw_fr.get("attacks") or (raw_en or {}).get("attacks")):
        atks_fr = [a for a in (raw_fr.get("attacks") or []) if isinstance(a, dict)]
        atks_en = [a for a in ((raw_en or {}).get("attacks") or []) if isinstance(a, dict)]
        if atks_fr:
            tm_atk = _build_deterministic_attack_action(
                atks_fr[0],
                atks_en[0] if atks_en else None,
                CardSubCategory.BASIC,
            )
            compiled_model.playableActions = [tm_atk]
            return

    if not compiled_model.playableActions:
        compiled_model.playableActions = [
            PlayableAction(
                actionId=f"play_{_slugify(name_en)}",
                label=name_fr,
                sourceType=default_source,
                timing=timing,
                canUseTurn1GoingFirst=not is_supporter,
                canUseTurn1GoingSecond=True,
                preconditions=[],
                costs=[],
                effects=[],
            )
        ]

    action = compiled_model.playableActions[0]
    action.sourceType = default_source
    action.timing = timing
    if is_supporter:
        action.canUseTurn1GoingFirst = False
        action.canUseTurn1GoingSecond = True

    # Suppression systématique des effets SHUFFLE_HAND_AND_DRAW parasites
    if "mélangez votre main" not in lower_text and "shuffle your hand" not in lower_text:
        action.effects = [
            eff for eff in action.effects
            if eff.primitive != EffectPrimitive.SHUFFLE_HAND_AND_DRAW and eff.count > 0
        ]
    else:
        action.effects = [eff for eff in action.effects if eff.count > 0]

    evaluator = compiled_model.strategicEvaluator
    hand_discard_cost = _extract_hand_discard_cost(combined_text)

    # -------------------------------------------------------------------------
    # CAS 1 : Déploiement sur le Banc depuis le Deck (Faiblo Ball, Poffin Copain-Copain, Cuencia)
    # -------------------------------------------------------------------------
    if (
        "placez-le sur votre banc" in lower_text
        or "placez-les sur votre banc" in lower_text
        or "put it onto your bench" in lower_text
        or "put them onto your bench" in lower_text
    ):
        m_up_to = re.search(r"(?:jusqu'à|up to)\s+(\d+)", lower_text)
        count = int(m_up_to.group(1)) if m_up_to else 1
        m_hp = re.search(r"(\d+)\s*(?:pv|hp)\s*(?:ou moins|or less|maximum)", lower_text)
        max_hp = int(m_hp.group(1)) if m_hp else None
        no_rule_box = (
            "n'ayant pas d'encadré règle" in lower_text
            or "doesn't have a rule box" in lower_text
        )

        target_filter = CardFilter(
            category=CardCategory.POKEMON,
            subCategory=CardSubCategory.BASIC,
            maxHp=max_hp,
            energyType=None,
            specificCardName=None,
            isRuleBox=False if no_rule_box else None,
        )
        action.actionId = f"play_{_slugify(name_en)}"
        action.label = name_fr
        action.canUseTurn1GoingFirst = not is_supporter
        action.canUseTurn1GoingSecond = True
        action.preconditions = [
            ActionPrecondition(
                type=PreconditionType.BENCH_HAS_EMPTY_SLOTS,
                zone=ZoneType.BENCH,
                minCount=1,
                targetFilter=None,
            ),
            ActionPrecondition(
                type=PreconditionType.ZONE_HAS_MATCHING_CARD,
                zone=ZoneType.DECK,
                minCount=1,
                targetFilter=target_filter,
            ),
        ]
        action.costs = []
        action.effects = [
            AtomicEffect(
                primitive=EffectPrimitive.SEARCH_DECK_TO_BENCH,
                sourceZone=ZoneType.DECK,
                targetZone=ZoneType.BENCH,
                count=count,
                upTo=True,
                targetFilter=target_filter,
                baseDamage=None,
                damageScalingPerOpponentPrizeTaken=None,
            )
        ]
        evaluator.primaryRole = StrategicRole.BENCH_DEPLOYER
        evaluator.intrinsicBaseScore = 94 if max_hp else 86
        evaluator.discardPriorityWhenDead = 92 if max_hp else 85
        evaluator.holdForNextTurnBonus = 15
        evaluator.turnPhaseWeights = TurnPhaseWeights(
            turn1=2.0,
            turn2=1.4,
            turn3=0.8,
            turn4Plus=0.4,
        )
        evaluator.decklistSynergyRequirements = [
            SynergyRequirement(
                requiredFilter=target_filter,
                minCountInDeck=4,
                ifMissingSetValueToZero=True,
                bonusWeightPerCopy=12.0 if max_hp else 8.0,
            )
        ]
        evaluator.inGameDeadCardConditions = [
            DeadCardCondition(
                reason=DeadCardReason.BENCH_ALREADY_FULL,
                zonesToCheck=[ZoneType.BENCH],
                targetFilter=None,
            ),
            DeadCardCondition(
                reason=DeadCardReason.NO_VALID_TARGET_IN_DECK,
                zonesToCheck=[ZoneType.DECK],
                targetFilter=target_filter,
            ),
        ]

    # -------------------------------------------------------------------------
    # CAS 2 : Accélérateur d'Évolution De base -> Niveau 2 (Super Bonbon / Rare Candy)
    # -------------------------------------------------------------------------
    elif (
        ("pokémon de base en jeu" in lower_text and ("niveau 2" in lower_text or "stage 2" in lower_text))
        or ("basic pokémon in play" in lower_text and "stage 2" in lower_text)
        or any(eff.primitive == EffectPrimitive.EVOLVE_SKIP_STAGE1 for eff in action.effects)
    ):
        basic_filter = CardFilter(
            category=CardCategory.POKEMON,
            subCategory=CardSubCategory.BASIC,
        )
        stage2_filter = CardFilter(
            category=CardCategory.POKEMON,
            subCategory=CardSubCategory.STAGE_2,
        )
        action.actionId = "play_rare_candy"
        action.label = name_fr
        action.canUseTurn1GoingFirst = False
        action.canUseTurn1GoingSecond = False
        action.preconditions = [
            ActionPrecondition(
                type=PreconditionType.BASIC_IN_PLAY_PREVIOUS_TURN,
                zone=ZoneType.IN_PLAY_ALL,
                minCount=1,
                targetFilter=basic_filter,
            ),
            ActionPrecondition(
                type=PreconditionType.ZONE_HAS_MATCHING_CARD,
                zone=ZoneType.HAND,
                minCount=1,
                targetFilter=stage2_filter,
            ),
        ]
        action.costs = []
        action.effects = [
            AtomicEffect(
                primitive=EffectPrimitive.EVOLVE_SKIP_STAGE1,
                sourceZone=ZoneType.HAND,
                targetZone=ZoneType.IN_PLAY_ALL,
                count=1,
                upTo=False,
                targetFilter=stage2_filter,
                baseDamage=None,
                damageScalingPerOpponentPrizeTaken=None,
            )
        ]
        evaluator.primaryRole = StrategicRole.EVOLUTION_ACCELERATOR
        evaluator.intrinsicBaseScore = 92
        evaluator.discardPriorityWhenDead = 95
        evaluator.holdForNextTurnBonus = 42
        evaluator.turnPhaseWeights = TurnPhaseWeights(
            turn1=0.0,
            turn2=1.9,
            turn3=1.6,
            turn4Plus=0.9,
        )
        evaluator.decklistSynergyRequirements = [
            SynergyRequirement(
                requiredFilter=stage2_filter,
                minCountInDeck=1,
                ifMissingSetValueToZero=True,
                bonusWeightPerCopy=15.0,
            ),
            SynergyRequirement(
                requiredFilter=basic_filter,
                minCountInDeck=2,
                ifMissingSetValueToZero=True,
                bonusWeightPerCopy=10.0,
            ),
        ]
        evaluator.inGameDeadCardConditions = [
            DeadCardCondition(
                reason=DeadCardReason.NO_STAGE2_LEFT_IN_DECK_OR_HAND,
                zonesToCheck=[ZoneType.HAND, ZoneType.DECK],
                targetFilter=stage2_filter,
            ),
            DeadCardCondition(
                reason=DeadCardReason.NO_BASE_POKEMON_LINE_LEFT,
                zonesToCheck=[ZoneType.BENCH, ZoneType.ACTIVE, ZoneType.HAND, ZoneType.DECK],
                targetFilter=basic_filter,
            ),
        ]

    # -------------------------------------------------------------------------
    # CAS 3 : Recherche de n'importe quel Pokémon vers la main (ex: Hyper Ball / Ultra Ball)
    # -------------------------------------------------------------------------
    elif (
        ("cherchez dans votre deck un pokémon" in lower_text or "search your deck for a pokémon" in lower_text)
        and "de base" not in lower_text
        and "basic" not in lower_text
        and ("ajoutez-le à votre main" in lower_text or "put it into your hand" in lower_text)
    ):
        any_pokemon_filter = CardFilter(
            category=CardCategory.POKEMON,
            subCategory=None,
            maxHp=None,
            energyType=None,
            specificCardName=None,
        )
        disc_count = hand_discard_cost if hand_discard_cost > 0 else 2

        preconditions: List[ActionPrecondition] = [
            ActionPrecondition(
                type=PreconditionType.HAND_MIN_OTHER_CARDS,
                zone=ZoneType.HAND,
                minCount=disc_count,
                targetFilter=None,
            ),
            ActionPrecondition(
                type=PreconditionType.ZONE_HAS_MATCHING_CARD,
                zone=ZoneType.DECK,
                minCount=1,
                targetFilter=any_pokemon_filter,
            ),
        ]
        costs: List[ActionCost] = [
            ActionCost(
                type=CostType.DISCARD_FROM_HAND,
                count=disc_count,
                targetFilter=None,
            )
        ]

        action.actionId = f"play_{_slugify(name_en)}"
        action.label = name_fr
        action.canUseTurn1GoingFirst = not is_supporter
        action.canUseTurn1GoingSecond = True
        action.preconditions = preconditions
        action.costs = costs
        action.effects = [
            AtomicEffect(
                primitive=EffectPrimitive.SEARCH_DECK_TO_HAND,
                sourceZone=ZoneType.DECK,
                targetZone=ZoneType.HAND,
                count=1,
                upTo=True,
                targetFilter=any_pokemon_filter,
                baseDamage=None,
                damageScalingPerOpponentPrizeTaken=None,
            )
        ]
        evaluator.primaryRole = StrategicRole.CONSISTENCY_TUTOR
        evaluator.intrinsicBaseScore = 93
        evaluator.discardPriorityWhenDead = 88
        evaluator.holdForNextTurnBonus = 28
        evaluator.turnPhaseWeights = TurnPhaseWeights(
            turn1=1.6,
            turn2=1.8,
            turn3=1.5,
            turn4Plus=1.2,
        )
        evaluator.decklistSynergyRequirements = [
            SynergyRequirement(
                requiredFilter=any_pokemon_filter,
                minCountInDeck=6,
                ifMissingSetValueToZero=True,
                bonusWeightPerCopy=5.0,
            )
        ]
        evaluator.inGameDeadCardConditions = [
            DeadCardCondition(
                reason=DeadCardReason.NO_VALID_TARGET_IN_DECK,
                zonesToCheck=[ZoneType.DECK],
                targetFilter=any_pokemon_filter,
            )
        ]

    # -------------------------------------------------------------------------
    # CAS 4 : Recherche combinée Objet + Outil Pokémon (Pepper / Arven)
    # -------------------------------------------------------------------------
    elif (
        ("carte objet" in lower_text and "outil pokémon" in lower_text)
        or ("item card" in lower_text and "pokémon tool" in lower_text)
    ):
        item_filter = CardFilter(
            category=CardCategory.TRAINER,
            subCategory=CardSubCategory.ITEM,
        )
        tool_filter = CardFilter(
            category=CardCategory.TRAINER,
            subCategory=CardSubCategory.TOOL,
        )
        action.actionId = f"play_{_slugify(name_en)}"
        action.label = name_fr
        action.canUseTurn1GoingFirst = False
        action.canUseTurn1GoingSecond = True
        action.preconditions = [
            ActionPrecondition(
                type=PreconditionType.ZONE_HAS_MATCHING_CARD,
                zone=ZoneType.DECK,
                minCount=1,
                targetFilter=item_filter,
            ),
        ]
        action.costs = []
        action.effects = [
            AtomicEffect(
                primitive=EffectPrimitive.SEARCH_DECK_TO_HAND,
                sourceZone=ZoneType.DECK,
                targetZone=ZoneType.HAND,
                count=1,
                upTo=True,
                targetFilter=item_filter,
                baseDamage=None,
                damageScalingPerOpponentPrizeTaken=None,
            ),
            AtomicEffect(
                primitive=EffectPrimitive.SEARCH_DECK_TO_HAND,
                sourceZone=ZoneType.DECK,
                targetZone=ZoneType.HAND,
                count=1,
                upTo=True,
                targetFilter=tool_filter,
                baseDamage=None,
                damageScalingPerOpponentPrizeTaken=None,
            ),
        ]
        evaluator.primaryRole = StrategicRole.CONSISTENCY_TUTOR
        evaluator.intrinsicBaseScore = 88
        evaluator.discardPriorityWhenDead = 90
        evaluator.holdForNextTurnBonus = 36
        evaluator.turnPhaseWeights = TurnPhaseWeights(
            turn1=1.2,
            turn2=1.9,
            turn3=1.5,
            turn4Plus=1.0,
        )
        evaluator.decklistSynergyRequirements = [
            SynergyRequirement(
                requiredFilter=item_filter,
                minCountInDeck=4,
                ifMissingSetValueToZero=False,
                bonusWeightPerCopy=8.0,
            ),
            SynergyRequirement(
                requiredFilter=tool_filter,
                minCountInDeck=1,
                ifMissingSetValueToZero=False,
                bonusWeightPerCopy=12.0,
            ),
        ]
        evaluator.inGameDeadCardConditions = [
            DeadCardCondition(
                reason=DeadCardReason.NO_VALID_TARGET_IN_DECK,
                zonesToCheck=[ZoneType.DECK],
                targetFilter=item_filter,
            ),
            DeadCardCondition(
                reason=DeadCardReason.NO_VALID_TARGET_IN_DECK,
                zonesToCheck=[ZoneType.DECK],
                targetFilter=tool_filter,
            ),
        ]

    # -------------------------------------------------------------------------
    # CAS 5 : Gust du Banc adverse vers le Poste Actif (Attrape-Riposte / Ordres du Boss)
    # -------------------------------------------------------------------------
    elif (
        ("pokémon de banc de votre adversaire" in lower_text and "poste actif" in lower_text)
        or ("opponent's benched pokémon" in lower_text and "active spot" in lower_text)
    ):
        behind_on_prizes = (
            "plus de cartes récompense" in lower_text
            or "more prize cards remaining than your opponent" in lower_text
        )
        action.actionId = f"play_{_slugify(name_en)}"
        action.label = name_fr
        action.canUseTurn1GoingFirst = False if (is_supporter or behind_on_prizes) else True
        action.canUseTurn1GoingSecond = True
        action.preconditions = (
            [
                ActionPrecondition(
                    type=PreconditionType.PLAYER_BEHIND_ON_PRIZES,
                    zone=ZoneType.PRIZES,
                    minCount=1,
                    targetFilter=None,
                )
            ]
            if behind_on_prizes
            else []
        )
        action.costs = []
        action.effects = [
            AtomicEffect(
                primitive=EffectPrimitive.GUST_OPPONENT_BENCH,
                sourceZone=ZoneType.BENCH,
                targetZone=ZoneType.ACTIVE,
                count=1,
                upTo=False,
                targetFilter=CardFilter(category=CardCategory.POKEMON),
                baseDamage=None,
                damageScalingPerOpponentPrizeTaken=None,
            )
        ]
        evaluator.primaryRole = StrategicRole.GUST_BOSS_EFFECT
        evaluator.intrinsicBaseScore = 85 if behind_on_prizes else 90
        evaluator.discardPriorityWhenDead = 75
        evaluator.holdForNextTurnBonus = 38
        if behind_on_prizes:
            evaluator.turnPhaseWeights = TurnPhaseWeights(
                turn1=0.2,
                turn2=1.6,
                turn3=1.8,
                turn4Plus=1.7,
            )
            evaluator.inGameDeadCardConditions = [
                DeadCardCondition(
                    reason=DeadCardReason.NOT_BEHIND_ON_PRIZES,
                    zonesToCheck=[ZoneType.PRIZES],
                    targetFilter=None,
                )
            ]

    # -------------------------------------------------------------------------
    # CAS 6 : Perturbation de main sous le deck + pioche selon les Récompenses (Mashynn / Iono)
    # -------------------------------------------------------------------------
    elif (
        ("dessous de son deck" in lower_text and "récompense" in lower_text)
        or ("bottom of their deck" in lower_text and "prize card" in lower_text)
    ):
        action.actionId = f"play_{_slugify(name_en)}"
        action.label = name_fr
        action.canUseTurn1GoingFirst = False
        action.canUseTurn1GoingSecond = True
        action.preconditions = []
        action.costs = []
        action.effects = [
            AtomicEffect(
                primitive=EffectPrimitive.SHUFFLE_HAND_BOTTOM_DRAW_PRIZES,
                sourceZone=ZoneType.HAND,
                targetZone=ZoneType.DECK,
                count=1,
                upTo=False,
                targetFilter=None,
                baseDamage=None,
                damageScalingPerOpponentPrizeTaken=None,
            )
        ]
        evaluator.primaryRole = StrategicRole.HAND_DISRUPTION
        evaluator.intrinsicBaseScore = 91
        evaluator.discardPriorityWhenDead = 25
        evaluator.holdForNextTurnBonus = 35
        evaluator.turnPhaseWeights = TurnPhaseWeights(
            turn1=0.8,
            turn2=1.5,
            turn3=1.7,
            turn4Plus=1.9,
        )
        evaluator.decklistSynergyRequirements = []
        evaluator.inGameDeadCardConditions = []

    # -------------------------------------------------------------------------
    # RÈGLE GÉNÉRIQUE : Toute carte à coût de défausse de la main ("défaussez X autres cartes de votre main")
    # -------------------------------------------------------------------------
    if hand_discard_cost > 0:
        if not any(p.type == PreconditionType.HAND_MIN_OTHER_CARDS for p in action.preconditions):
            action.preconditions.insert(
                0,
                ActionPrecondition(
                    type=PreconditionType.HAND_MIN_OTHER_CARDS,
                    zone=ZoneType.HAND,
                    minCount=hand_discard_cost,
                    targetFilter=None,
                ),
            )
        if not any(c.type == CostType.DISCARD_FROM_HAND for c in action.costs):
            action.costs.insert(
                0,
                ActionCost(
                    type=CostType.DISCARD_FROM_HAND,
                    count=hand_discard_cost,
                    targetFilter=None,
                ),
            )

    compiled_model.playableActions = [action]


def sanitize_and_enrich_card(
    raw_tcgdex_card: Union[FetchedCardBundle, Dict[str, Any]],
    compiled_model: EngineCardModel,
) -> EngineCardModel:
    """Valide, corrige et enrichit de manière déterministe un `EngineCardModel` à partir des données TCGdex."""
    if isinstance(raw_tcgdex_card, FetchedCardBundle):
        raw_fr = raw_tcgdex_card.raw_fr
        raw_en = raw_tcgdex_card.raw_en
        compiled_model.category = raw_tcgdex_card.identity.category
        compiled_model.subCategory = raw_tcgdex_card.identity.subCategory
    else:
        raw_fr = raw_tcgdex_card.get("fr", raw_tcgdex_card)
        raw_en = raw_tcgdex_card.get("en")
        compiled_model.category = compiled_model.identity.category
        compiled_model.subCategory = compiled_model.identity.subCategory

    if compiled_model.category == CardCategory.POKEMON:
        _sanitize_pokemon_card(raw_fr, raw_en, compiled_model)
    elif compiled_model.category == CardCategory.TRAINER:
        _sanitize_trainer_card(raw_fr, raw_en, compiled_model)

    return compiled_model
