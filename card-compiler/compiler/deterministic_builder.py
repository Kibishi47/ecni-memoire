"""Constructeur 100 % déterministe du squelette `EngineCardModel` et des slots d'effets pour l'IA.

Ce module implémente le Principe Directeur :
- Construire en Python pur 100 % des données connues depuis `data/raw_tcgdex/{id}.json` :
  * `identity` (`CardIdentity` avec `prizeCardsGiven`, `isRuleBox`, `isAceSpec`, `isAncient`, `isFuture`, `isTera`, `legalStandard`, `legalExpanded`)
  * `pokemonStats` (`PokemonStats` avec `hp`, `types`, `stage`, `evolvesFrom`, `rootBasicName`, `evolutionChain`, `retreatCost`, `weaknesses`, `resistances`)
  * Les squelettes des `playableActions` (`PLAY_FROM_HAND`, `EVOLVE`, `USE_ABILITY`, `ATTACK`, `RETREAT`, `ATTACH_ENERGY`) avec leurs `cost`, `timingPhase`, `canUseTurn1GoingFirst`, `canUseTurn1GoingSecond` et les dégâts numériques de base (`DAMAGE_ACTIVE`).
  * Les synergies déterministes de base (`requires_evolution_line:...`, `requires_energy_type:...`).
- Extraire uniquement la liste des `EffectSlotToCompile` (`slots_for_llm`) contenant les textes d'effets à traduire par le pipeline IA en 2 passes.
- Fusionner le `LLMCompiledPayload` généré par la Passe 2 dans le squelette déterministe en appliquant les verrous déterministes finaux.
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from pydantic import BaseModel, Field

from compiler.schemas import (
    AIRole,
    ActionType,
    AtomicEffect,
    CardCategory,
    CardIdentity,
    CardSubCategory,
    CompilationMetadata,
    EffectPrimitive,
    EngineCardModel,
    LLMCompiledPayload,
    LLMTranslatedSlot,
    PlayableAction,
    PokemonStats,
    StrategicEvaluator,
    TimingPhase,
    TurnPhaseWeights,
    TypeModifier,
)


class EffectSlotToCompile(BaseModel):
    """Slot d'effet textuel isolé à soumettre au pipeline IA (Passe 1 & Passe 2)."""

    slotId: str = Field(description="Identifiant unique du slot (ex: 'ability_0', 'attack_0', 'trainer_0')")
    actionType: ActionType = Field(description="Type d'action correspondant au slot")
    label: str = Field(description="Nom de la capacité, de l'attaque ou de la carte Dresseur")
    textFr: str = Field(description="Texte d'effet officiel en français")
    textEn: Optional[str] = Field(default=None, description="Texte d'effet officiel en anglais")
    baseDamage: Optional[int] = Field(
        default=None,
        description="Dégâts numériques de base déjà injectés par Python si c'est une attaque",
    )


class DeterministicCardSkeleton(BaseModel):
    """Squelette déterministe complet d'une carte avant injection des effets traduits par l'IA."""

    cardId: str
    identity: CardIdentity
    pokemonStats: Optional[PokemonStats] = None
    category: CardCategory
    subCategory: CardSubCategory
    playableActions: List[PlayableAction] = Field(default_factory=list)
    slots_for_llm: List[EffectSlotToCompile] = Field(default_factory=list)
    base_synergies: List[str] = Field(default_factory=list)
    static_strategic_evaluator: Optional[StrategicEvaluator] = None


def _normalize_whitespace(text: Optional[str]) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", str(text)).strip()


def infer_category_and_subcategory(
    raw_fr: Dict[str, Any],
    raw_en: Optional[Dict[str, Any]] = None,
) -> Tuple[CardCategory, CardSubCategory]:
    """Détermine de façon déterministe `CardCategory` et `CardSubCategory` depuis le JSON TCGdex."""
    cat_fr = (raw_fr.get("category") or "").strip().lower()
    cat_en = ((raw_en or {}).get("category") or "").strip().lower()

    # 1. POKEMON
    if "pok" in cat_fr or "pok" in cat_en:
        stage_fr = (raw_fr.get("stage") or "").strip().lower()
        stage_en = ((raw_en or {}).get("stage") or "").strip().lower()
        if "niveau 2" in stage_fr or "stage2" in stage_en or "stage 2" in stage_en:
            return CardCategory.POKEMON, CardSubCategory.STAGE_2
        if (
            "niveau 1" in stage_fr
            or "stage1" in stage_en
            or "stage 1" in stage_en
            or "vmax" in stage_fr
            or "vstar" in stage_fr
            or "vmax" in stage_en
            or "vstar" in stage_en
        ):
            return CardCategory.POKEMON, CardSubCategory.STAGE_1
        return CardCategory.POKEMON, CardSubCategory.BASIC

    # 2. ENERGY
    if "énerg" in cat_fr or "energ" in cat_fr or "energ" in cat_en:
        etype_fr = (raw_fr.get("energyType") or "").strip().lower()
        etype_en = ((raw_en or {}).get("energyType") or "").strip().lower()
        name_fr = (raw_fr.get("name") or "").strip().lower()
        name_en = ((raw_en or {}).get("name") or "").strip().lower()
        effect_fr = (raw_fr.get("effect") or "").strip()
        effect_en = ((raw_en or {}).get("effect") or "").strip()
        if (
            "spécial" in etype_fr
            or "special" in etype_en
            or (bool(effect_fr or effect_en) and "de base" not in name_fr and "basic" not in name_en)
        ):
            return CardCategory.ENERGY, CardSubCategory.SPECIAL_ENERGY
        return CardCategory.ENERGY, CardSubCategory.BASIC_ENERGY

    # 3. TRAINER
    ttype_fr = (raw_fr.get("trainerType") or "").strip().lower()
    ttype_en = ((raw_en or {}).get("trainerType") or "").strip().lower()
    if "supporter" in ttype_fr or "supporter" in ttype_en:
        return CardCategory.TRAINER, CardSubCategory.SUPPORTER
    if "outil" in ttype_fr or "tool" in ttype_en or "technical machine" in ttype_en:
        return CardCategory.TRAINER, CardSubCategory.TOOL
    if "stade" in ttype_fr or "stadium" in ttype_en:
        return CardCategory.TRAINER, CardSubCategory.STADIUM
    return CardCategory.TRAINER, CardSubCategory.ITEM


def extract_raw_rules_text(
    raw_fr: Dict[str, Any],
    raw_en: Optional[Dict[str, Any]] = None,
) -> List[str]:
    """Assemble tous les textes d'effets, talents et attaques (FR + EN)."""
    lines: List[str] = []

    effect_fr = _normalize_whitespace(raw_fr.get("effect"))
    if effect_fr:
        lines.append(f"[Effet FR] {effect_fr}")

    if raw_en:
        effect_en = _normalize_whitespace(raw_en.get("effect"))
        if effect_en and effect_en != effect_fr:
            lines.append(f"[Effect EN] {effect_en}")

    for ability in raw_fr.get("abilities") or []:
        if isinstance(ability, dict):
            ab_type = ability.get("type") or "Talent"
            ab_name = ability.get("name") or ""
            ab_effect = _normalize_whitespace(ability.get("effect"))
            lines.append(f"[{ab_type} FR: {ab_name}] {ab_effect}")

    if raw_en:
        for ability in raw_en.get("abilities") or []:
            if isinstance(ability, dict):
                ab_type = ability.get("type") or "Ability"
                ab_name = ability.get("name") or ""
                ab_effect = _normalize_whitespace(ability.get("effect"))
                lines.append(f"[{ab_type} EN: {ab_name}] {ab_effect}")

    for attack in raw_fr.get("attacks") or []:
        if isinstance(attack, dict):
            atk_name = attack.get("name") or ""
            atk_cost = ",".join(attack.get("cost") or [])
            atk_dmg = attack.get("damage")
            atk_eff = _normalize_whitespace(attack.get("effect"))
            dmg_str = f" ({atk_dmg} dégâts)" if atk_dmg is not None else ""
            lines.append(f"[Attaque FR: {atk_name} | Coût: {atk_cost}{dmg_str}] {atk_eff}".strip())

    if raw_en:
        for attack in raw_en.get("attacks") or []:
            if isinstance(attack, dict):
                atk_name = attack.get("name") or ""
                atk_cost = ",".join(attack.get("cost") or [])
                atk_dmg = attack.get("damage")
                atk_eff = _normalize_whitespace(attack.get("effect"))
                dmg_str = f" ({atk_dmg} dmg)" if atk_dmg is not None else ""
                lines.append(f"[Attack EN: {atk_name} | Cost: {atk_cost}{dmg_str}] {atk_eff}".strip())

    return lines


def detect_rule_box_and_prizes(
    name_fr: str,
    name_en: Optional[str],
    raw_fr: Dict[str, Any],
    raw_en: Optional[Dict[str, Any]] = None,
) -> Tuple[bool, int]:
    """Calcule de façon 100 % déterministe `(isRuleBox, prizeCardsGiven)` pour un Pokémon.

    Règles :
    - `prizeCardsGiven = 3` si c'est un Méga-Pokémon-ex (ex: `nameFr` commence par `"Méga-"` ou `"Mega "` et `suffix == "ex"`)
      ou un Pokémon-VMAX / V-UNION.
    - `prizeCardsGiven = 2` si `suffix in ["ex", "V", "VSTAR", "GX"]` ou `"ex"` / `"V"` / `"VSTAR"` dans le nom.
    - `prizeCardsGiven = 1` sinon (y compris Radieux / Radiant).
    - `isRuleBox = True` si `prizeCardsGiven >= 2` ou Radieux (Radiant).
    """
    name_fr_clean = (name_fr or "").strip()
    name_en_clean = (name_en or "").strip()
    combined_name = f"{name_fr_clean} {name_en_clean}"
    suffix_fr = str(raw_fr.get("suffix") or "").strip().lower()
    suffix_en = str((raw_en or {}).get("suffix") or "").strip().lower()
    suffix = suffix_fr or suffix_en

    is_mega_prefix = (
        name_fr_clean.lower().startswith(("méga-", "mega-", "méga ", "mega "))
        or name_en_clean.lower().startswith(("mega ", "mega-", "méga-"))
    )
    has_ex_marker = (
        suffix == "ex"
        or bool(re.search(r"(?:\b|-)(ex)\b", combined_name, flags=re.IGNORECASE))
    )

    if (is_mega_prefix and has_ex_marker) or re.search(r"\b(vmax|v-union)\b", combined_name, flags=re.IGNORECASE) or "vmax" in suffix:
        return True, 3

    if (
        suffix in {"ex", "v", "vstar", "gx"}
        or re.search(r"(?:\b|-)(ex|v|vstar|gx)\b", combined_name, flags=re.IGNORECASE)
    ):
        return True, 2

    if re.search(r"\b(radieux|radiant)\b", combined_name, flags=re.IGNORECASE):
        return True, 1

    return False, 1


def _normalize_stage(raw_stage_fr: Optional[str], raw_stage_en: Optional[str], sub_category: CardSubCategory) -> str:
    """Normalise le stade d'un Pokémon en `'Base'`, `'Niveau 1'` ou `'Niveau 2'`."""
    if sub_category == CardSubCategory.STAGE_2:
        return "Niveau 2"
    if sub_category == CardSubCategory.STAGE_1:
        return "Niveau 1"
    s = f"{raw_stage_fr or ''} {raw_stage_en or ''}".lower()
    if "2" in s:
        return "Niveau 2"
    if "1" in s:
        return "Niveau 1"
    return "Base"


def _parse_base_damage(damage_raw: Any) -> Optional[int]:
    """Extrait les dégâts numériques de base depuis `attack['damage']` (ex: `'200+'` -> `200`)."""
    if damage_raw is None:
        return None
    if isinstance(damage_raw, int):
        return damage_raw
    if isinstance(damage_raw, float):
        return int(damage_raw)
    s = str(damage_raw).strip()
    if not s:
        return None
    m = re.search(r"\d+", s)
    if m:
        try:
            return int(m.group(0))
        except ValueError:
            return None
    return None


def _count_energy_cost(cost_list: Any) -> Dict[str, int]:
    """Compte déterministiquement le coût en énergie depuis `attack['cost']`."""
    counts: Dict[str, int] = {}
    if isinstance(cost_list, dict):
        for k, v in cost_list.items():
            try:
                iv = int(v)
                if iv > 0:
                    counts[str(k).strip()] = iv
            except (TypeError, ValueError):
                pass
        return counts

    if not isinstance(cost_list, list):
        return counts

    for item in cost_list:
        if isinstance(item, str) and item.strip():
            key = item.strip()
            counts[key] = counts.get(key, 0) + 1
    return counts


def _extract_raw_parts(
    raw_input: Union[Dict[str, Any], Path, Any],
) -> Tuple[str, Dict[str, Any], Optional[Dict[str, Any]], Optional[Tuple[Optional[str], Optional[str], List[str]]]]:
    """Extrait `(card_id, raw_fr, raw_en, evolution_info)` depuis un chemin, un dict TCGdex ou un `FetchedCardBundle`."""
    if hasattr(raw_input, "card_id") and hasattr(raw_input, "raw_fr"):
        # FetchedCardBundle
        bundle = raw_input
        card_id = str(bundle.card_id).strip()
        raw_fr = bundle.raw_fr or {}
        raw_en = bundle.raw_en
        evo_info: Optional[Tuple[Optional[str], Optional[str], List[str]]] = None
        if getattr(bundle, "pokemon_stats", None) is not None:
            ps = bundle.pokemon_stats
            evo_info = (ps.evolvesFrom, ps.rootBasicName, list(ps.evolutionChain or []))
        return card_id, raw_fr, raw_en, evo_info

    if isinstance(raw_input, Path):
        data = json.loads(raw_input.read_text(encoding="utf-8"))
    elif isinstance(raw_input, dict):
        data = raw_input
    else:
        raise TypeError(f"Type d'entrée non supporté pour build_deterministic_skeleton: {type(raw_input)}")

    if "fr" in data and isinstance(data["fr"], dict):
        raw_fr = data["fr"]
        raw_en = data.get("en") if isinstance(data.get("en"), dict) else None
        card_id = str(data.get("requestedId") or raw_fr.get("id") or "unknown-000").strip()
        evo_obj = data.get("resolvedEvolution")
        if isinstance(evo_obj, dict):
            evo_info = (
                evo_obj.get("evolvesFrom"),
                evo_obj.get("rootBasicName"),
                list(evo_obj.get("evolutionChain") or []),
            )
        else:
            evo_info = None
        return card_id, raw_fr, raw_en, evo_info

    # Dictionnaire FR plat direct
    raw_fr = data
    raw_en = None
    card_id = str(raw_fr.get("id") or "unknown-000").strip()
    return card_id, raw_fr, raw_en, None


def build_identity_and_stats_from_raw(
    requested_card_id: str,
    raw_fr: Dict[str, Any],
    raw_en: Optional[Dict[str, Any]] = None,
    evolution_info: Optional[Tuple[Optional[str], Optional[str], List[str]]] = None,
) -> Tuple[CardIdentity, Optional[PokemonStats]]:
    """Construit de façon 100 % déterministe `CardIdentity` et `PokemonStats`."""
    category, sub_category = infer_category_and_subcategory(raw_fr, raw_en)
    name_fr = str(raw_fr.get("name") or requested_card_id).strip()
    name_en = str(raw_en.get("name")).strip() if raw_en and raw_en.get("name") else None

    set_obj = raw_fr.get("set") if isinstance(raw_fr.get("set"), dict) else {}
    set_id = str(set_obj.get("id") or requested_card_id.split("-")[0]).strip()
    set_name = str(set_obj.get("name")).strip() if set_obj.get("name") else None
    local_id = str(raw_fr.get("localId") or requested_card_id.split("-")[-1]).strip()

    reg_mark = raw_fr.get("regulationMark") or (raw_en or {}).get("regulationMark")
    reg_mark_norm = str(reg_mark).strip().upper() if reg_mark else None

    legal_obj = raw_fr.get("legal") if isinstance(raw_fr.get("legal"), dict) else {}
    legal_standard = bool(
        legal_obj.get("standard", False)
        or (reg_mark_norm in {"G", "H", "I"})
        or (sub_category == CardSubCategory.BASIC_ENERGY)
    )
    legal_expanded = bool(legal_obj.get("expanded", False) or legal_standard)

    rarity_val = raw_fr.get("rarity") or (raw_en or {}).get("rarity")
    rarity_lower = str(rarity_val or "").lower()
    raw_rules_text = extract_raw_rules_text(raw_fr, raw_en)
    rules_joined_lower = " ".join(raw_rules_text).lower()
    name_and_rules_lower = f"{name_fr} {name_en or ''} {rules_joined_lower}".lower()

    raw_dex_ids = raw_fr.get("dexId") or (raw_en or {}).get("dexId") or []
    dex_ids: List[int] = []
    if isinstance(raw_dex_ids, list):
        for d in raw_dex_ids:
            try:
                dex_ids.append(int(d))
            except (TypeError, ValueError):
                pass

    ancient_paradox_dex = {984, 985, 986, 987, 988, 989, 1005, 1009, 1020, 1021}
    future_paradox_dex = {990, 991, 992, 993, 994, 995, 1006, 1010, 1022, 1023}

    is_rule_box, prize_cards = (
        detect_rule_box_and_prizes(name_fr, name_en, raw_fr, raw_en)
        if category == CardCategory.POKEMON
        else (False, 1)
    )

    is_ace_spec = (
        "high-tech" in rarity_lower
        or "ace spec" in rarity_lower
        or "high-tech" in rules_joined_lower
        or "ace spec" in rules_joined_lower
    )

    if category == CardCategory.POKEMON:
        is_ancient = (
            any(d in ancient_paradox_dex for d in dex_ids)
            or (1007 in dex_ids and set_id.lower() != "sv01" and not is_rule_box)
            or "temps passé" in name_fr.lower()
            or "ancient" in (name_en or "").lower()
        )
        is_future = (
            any(d in future_paradox_dex for d in dex_ids)
            or (1008 in dex_ids and set_id.lower() != "sv01" and not is_rule_box)
            or "temps futur" in name_fr.lower()
            or "future" in (name_en or "").lower()
        )
        is_tera = (
            "téracristal" in rules_joined_lower
            or "pokémon téracristal" in rules_joined_lower
            or "tera pokémon" in rules_joined_lower
            or "tant que ce pokémon est sur votre banc, évitez tous les dégâts" in rules_joined_lower
            or "as long as this pokémon is on your bench, prevent all damage" in rules_joined_lower
        )
    else:
        is_ancient = (
            "temps passé" in name_and_rules_lower
            or "professeure olim" in name_fr.lower()
            or "professor sada" in (name_en or "").lower()
            or "tambour éveil" in name_fr.lower()
            or "awakening drum" in (name_en or "").lower()
        )
        is_future = (
            "temps futur" in name_and_rules_lower
            or "professeur turum" in name_fr.lower()
            or "professor turo" in (name_en or "").lower()
            or "techno-radar" in name_fr.lower()
            or "techno radar" in (name_en or "").lower()
            or "capsule de redémarrage" in name_fr.lower()
            or "reboot pod" in (name_en or "").lower()
        )
        is_tera = False

    is_technical_machine = sub_category == CardSubCategory.TOOL and (
        "capsule technique" in name_fr.lower()
        or "technical machine" in (name_en or "").lower()
        or bool(raw_fr.get("attacks") or (raw_en or {}).get("attacks"))
    )

    identity = CardIdentity(
        cardId=requested_card_id,
        nameFr=name_fr,
        nameEn=name_en,
        setId=set_id,
        setName=set_name,
        category=category,
        subCategory=sub_category,
        isRuleBox=is_rule_box,
        prizeCardsGiven=prize_cards,
        isAceSpec=is_ace_spec,
        isAncient=is_ancient,
        isFuture=is_future,
        isTera=is_tera,
        legalStandard=legal_standard,
        legalExpanded=legal_expanded,
        localId=local_id,
        regulationMark=reg_mark,
        rarity=rarity_val,
        imageUrl=raw_fr.get("image") or (raw_en or {}).get("image"),
        isTechnicalMachine=is_technical_machine,
        rawRulesText=raw_rules_text,
    )

    pokemon_stats: Optional[PokemonStats] = None
    if category == CardCategory.POKEMON:
        hp_raw = raw_fr.get("hp") if raw_fr.get("hp") is not None else (raw_en or {}).get("hp")
        try:
            hp = int(hp_raw) if hp_raw is not None else 0
        except (TypeError, ValueError):
            hp = 0

        types_list = [str(t) for t in (raw_fr.get("types") or (raw_en or {}).get("types") or [])]
        stage_norm = _normalize_stage(raw_fr.get("stage"), (raw_en or {}).get("stage"), sub_category)

        if evolution_info is not None:
            evolves_from, root_basic, evo_chain = evolution_info
            root_basic = root_basic or evolves_from or name_fr
            if not evo_chain:
                evo_chain = [evolves_from, name_fr] if evolves_from else [name_fr]
        else:
            evo_from_raw = raw_fr.get("evolveFrom") or raw_fr.get("evolvesFrom")
            evolves_from = str(evo_from_raw).strip() if evo_from_raw else None
            root_basic = evolves_from or name_fr
            evo_chain = [evolves_from, name_fr] if evolves_from else [name_fr]

        retreat_raw = raw_fr.get("retreat") if raw_fr.get("retreat") is not None else (raw_en or {}).get("retreat")
        try:
            retreat_cost = int(retreat_raw) if retreat_raw is not None else 0
        except (TypeError, ValueError):
            retreat_cost = 0

        raw_weaknesses = [w for w in (raw_fr.get("weaknesses") or []) if isinstance(w, dict)]
        weaknesses_list = [
            TypeModifier(
                type=str(w.get("type")).strip(),
                value=str(w.get("value") or "×2").strip(),
            )
            for w in raw_weaknesses
            if w.get("type")
        ]

        raw_resistances = [r for r in (raw_fr.get("resistances") or []) if isinstance(r, dict)]
        resistances_list = [
            TypeModifier(
                type=str(r.get("type")).strip(),
                value=str(r.get("value") or "-30").strip(),
            )
            for r in raw_resistances
            if r.get("type")
        ]

        pokemon_stats = PokemonStats(
            hp=hp,
            types=types_list,
            stage=stage_norm,
            evolvesFrom=evolves_from,
            rootBasicName=root_basic,
            evolutionChain=evo_chain,
            retreatCost=retreat_cost,
            weaknesses=weaknesses_list,
            resistances=resistances_list,
        )

    return identity, pokemon_stats


def build_deterministic_skeleton(
    raw_input: Union[Dict[str, Any], Path, Any],
) -> DeterministicCardSkeleton:
    """Construit 100 % du squelette déterministe et extrait les `slots_for_llm` à traduire."""
    card_id, raw_fr, raw_en, evo_info = _extract_raw_parts(raw_input)
    identity, pokemon_stats = build_identity_and_stats_from_raw(
        requested_card_id=card_id,
        raw_fr=raw_fr,
        raw_en=raw_en,
        evolution_info=evo_info,
    )
    if hasattr(raw_input, "identity") and isinstance(getattr(raw_input, "identity", None), CardIdentity):
        if not raw_fr.get("category") and not (raw_en or {}).get("category"):
            identity = raw_input.identity
        if pokemon_stats is None and getattr(raw_input, "pokemon_stats", None) is not None:
            pokemon_stats = raw_input.pokemon_stats

    category = identity.category
    sub_category = identity.subCategory
    playable_actions: List[PlayableAction] = []
    slots_for_llm: List[EffectSlotToCompile] = []
    base_synergies: List[str] = []
    static_evaluator: Optional[StrategicEvaluator] = None

    # 1. CAS ÉNERGIE DE BASE : 100 % STATIQUE (0 APPEL IA)
    if sub_category == CardSubCategory.BASIC_ENERGY:
        playable_actions.append(
            PlayableAction(
                actionId="attach_energy",
                label=f"Attacher {identity.nameFr}",
                actionType=ActionType.ATTACH_ENERGY,
                timingPhase=TimingPhase.MAIN_PHASE_1,
                canUseTurn1GoingFirst=True,
                canUseTurn1GoingSecond=True,
                cost={},
                preconditions=[],
                effects=[
                    AtomicEffect(
                        primitive=EffectPrimitive.ATTACH_ENERGY,
                        target="OWN_POKEMON_ANY",
                        count=1,
                        zone="HAND",
                    )
                ],
                deadCardCondition=None,
            )
        )
        static_evaluator = StrategicEvaluator(
            aiRole=AIRole.ENERGY_ACCELERATOR,
            turnPhaseWeights=TurnPhaseWeights(turn1=1.0, turn2=1.0, turn3=1.0, turn4Plus=1.0),
            decklistSynergyRequirements=[],
        )
        return DeterministicCardSkeleton(
            cardId=card_id,
            identity=identity,
            pokemonStats=None,
            category=category,
            subCategory=sub_category,
            playableActions=playable_actions,
            slots_for_llm=[],
            base_synergies=[],
            static_strategic_evaluator=static_evaluator,
        )

    # 2. CAS POKÉMON
    if category == CardCategory.POKEMON and pokemon_stats is not None:
        stage = pokemon_stats.stage
        is_base = stage == "Base"

        # Action 1 : Mise en jeu (PLAY_FROM_HAND si Base, EVOLVE si Niveau 1 / Niveau 2)
        if is_base:
            playable_actions.append(
                PlayableAction(
                    actionId="play_from_hand",
                    label=f"Poser {identity.nameFr}",
                    actionType=ActionType.PLAY_FROM_HAND,
                    timingPhase=TimingPhase.MAIN_PHASE_1,
                    canUseTurn1GoingFirst=True,
                    canUseTurn1GoingSecond=True,
                    cost={},
                    preconditions=["BENCH_HAS_EMPTY_SLOT"],
                    effects=[],
                    deadCardCondition="BENCH_FULL",
                )
            )
        else:
            evo_from = pokemon_stats.evolvesFrom or pokemon_stats.rootBasicName
            playable_actions.append(
                PlayableAction(
                    actionId="evolve",
                    label=f"Évoluer en {identity.nameFr}",
                    actionType=ActionType.EVOLVE,
                    timingPhase=TimingPhase.MAIN_PHASE_1,
                    canUseTurn1GoingFirst=False,
                    canUseTurn1GoingSecond=False,
                    cost={},
                    preconditions=[
                        f"IN_PLAY:{evo_from}",
                        "TARGET_IN_PLAY_SINCE_PREVIOUS_TURN",
                    ],
                    effects=[
                        AtomicEffect(
                            primitive=EffectPrimitive.EVOLVE_POKEMON,
                            target="SELF",
                        )
                    ],
                    deadCardCondition=f"NO_{evo_from.upper().replace(' ', '_')}_IN_PLAY",
                )
            )
            if pokemon_stats.rootBasicName:
                base_synergies.append(f"requires_evolution_line:{pokemon_stats.rootBasicName}")

        # Talents : abilities[i]
        abilities_fr = [a for a in (raw_fr.get("abilities") or []) if isinstance(a, dict)]
        abilities_en = [a for a in ((raw_en or {}).get("abilities") or []) if isinstance(a, dict)]
        for idx, ab_fr in enumerate(abilities_fr):
            ab_en = abilities_en[idx] if idx < len(abilities_en) else None
            ab_name = str(ab_fr.get("name") or (ab_en or {}).get("name") or f"Talent {idx + 1}").strip()
            ab_text_fr = _normalize_whitespace(ab_fr.get("effect"))
            ab_text_en = _normalize_whitespace((ab_en or {}).get("effect")) or None
            slot_id = f"ability_{idx}"

            playable_actions.append(
                PlayableAction(
                    actionId=slot_id,
                    label=ab_name,
                    actionType=ActionType.USE_ABILITY,
                    timingPhase=TimingPhase.MAIN_PHASE_1,
                    canUseTurn1GoingFirst=is_base,
                    canUseTurn1GoingSecond=is_base,
                    cost={},
                    preconditions=[],
                    effects=[],
                    deadCardCondition=None,
                )
            )
            if ab_text_fr or ab_text_en:
                slots_for_llm.append(
                    EffectSlotToCompile(
                        slotId=slot_id,
                        actionType=ActionType.USE_ABILITY,
                        label=ab_name,
                        textFr=ab_text_fr,
                        textEn=ab_text_en,
                    )
                )

        # Attaques : attacks[i]
        attacks_fr = [a for a in (raw_fr.get("attacks") or []) if isinstance(a, dict)]
        attacks_en = [a for a in ((raw_en or {}).get("attacks") or []) if isinstance(a, dict)]
        for idx, atk_fr in enumerate(attacks_fr):
            atk_en = attacks_en[idx] if idx < len(attacks_en) else None
            atk_name = str(atk_fr.get("name") or (atk_en or {}).get("name") or f"Attaque {idx + 1}").strip()
            cost_dict = _count_energy_cost(atk_fr.get("cost"))
            base_dmg = _parse_base_damage(atk_fr.get("damage"))
            atk_text_fr = _normalize_whitespace(atk_fr.get("effect"))
            atk_text_en = _normalize_whitespace((atk_en or {}).get("effect")) or None
            slot_id = f"attack_{idx}"

            # Synergies énergétiques déterministes (hors Incolore)
            for energy_type in cost_dict.keys():
                if energy_type.lower() not in {"incolore", "colorless"}:
                    syn_tag = f"requires_energy_type:{energy_type}"
                    if syn_tag not in base_synergies:
                        base_synergies.append(syn_tag)

            initial_effects: List[AtomicEffect] = []
            if base_dmg is not None and base_dmg > 0:
                initial_effects.append(
                    AtomicEffect(
                        primitive=EffectPrimitive.DAMAGE_ACTIVE,
                        target="OPPONENT_ACTIVE",
                        value=base_dmg,
                    )
                )

            playable_actions.append(
                PlayableAction(
                    actionId=slot_id,
                    label=atk_name,
                    actionType=ActionType.ATTACK,
                    timingPhase=TimingPhase.ATTACK_PHASE,
                    canUseTurn1GoingFirst=False,
                    canUseTurn1GoingSecond=is_base,
                    cost=cost_dict,
                    preconditions=["SELF_IS_ACTIVE"],
                    effects=initial_effects,
                    deadCardCondition=None,
                )
            )

            # Optimisation clé : si l'attaque n'a aucun texte d'effet, aucun slot IA n'est créé !
            if atk_text_fr or atk_text_en:
                slots_for_llm.append(
                    EffectSlotToCompile(
                        slotId=slot_id,
                        actionType=ActionType.ATTACK,
                        label=atk_name,
                        textFr=atk_text_fr,
                        textEn=atk_text_en,
                        baseDamage=base_dmg,
                    )
                )

        # Action Repli (RETREAT)
        retreat_cost = (
            {"Incolore": pokemon_stats.retreatCost}
            if pokemon_stats.retreatCost > 0
            else {}
        )
        playable_actions.append(
            PlayableAction(
                actionId="retreat",
                label="Retraite",
                actionType=ActionType.RETREAT,
                timingPhase=TimingPhase.MAIN_PHASE_1,
                canUseTurn1GoingFirst=True,
                canUseTurn1GoingSecond=True,
                cost=retreat_cost,
                preconditions=["SELF_IS_ACTIVE", "BENCH_HAS_POKEMON"],
                effects=[
                    AtomicEffect(
                        primitive=EffectPrimitive.SWITCH_ACTIVE,
                        target="SELF",
                    )
                ],
                deadCardCondition=None,
            )
        )

        return DeterministicCardSkeleton(
            cardId=card_id,
            identity=identity,
            pokemonStats=pokemon_stats,
            category=category,
            subCategory=sub_category,
            playableActions=playable_actions,
            slots_for_llm=slots_for_llm,
            base_synergies=base_synergies,
        )

    # 3. CAS TRAINER
    if category == CardCategory.TRAINER:
        eff_fr = _normalize_whitespace(raw_fr.get("effect"))
        eff_en = _normalize_whitespace((raw_en or {}).get("effect")) or None

        # Cas particulier des Capsules Techniques (Tools qui confèrent une attaque dans raw_fr["attacks"])
        if not eff_fr and raw_fr.get("attacks"):
            atk_list = [a for a in (raw_fr.get("attacks") or []) if isinstance(a, dict)]
            if atk_list:
                a0 = atk_list[0]
                eff_fr = _normalize_whitespace(f"{a0.get('name', '')}: {a0.get('effect', '')}")
        if not eff_en and raw_en and raw_en.get("attacks"):
            atk_list_en = [a for a in (raw_en.get("attacks") or []) if isinstance(a, dict)]
            if atk_list_en:
                a0_en = atk_list_en[0]
                eff_en = _normalize_whitespace(f"{a0_en.get('name', '')}: {a0_en.get('effect', '')}")

        can_t1_first = sub_category != CardSubCategory.SUPPORTER
        playable_actions.append(
            PlayableAction(
                actionId="trainer_0",
                label=identity.nameFr,
                actionType=ActionType.PLAY_FROM_HAND,
                timingPhase=TimingPhase.MAIN_PHASE_1,
                canUseTurn1GoingFirst=can_t1_first,
                canUseTurn1GoingSecond=True,
                cost={},
                preconditions=[],
                effects=[],
                deadCardCondition=None,
            )
        )
        if eff_fr or eff_en:
            slots_for_llm.append(
                EffectSlotToCompile(
                    slotId="trainer_0",
                    actionType=ActionType.PLAY_FROM_HAND,
                    label=identity.nameFr,
                    textFr=eff_fr,
                    textEn=eff_en,
                )
            )
        return DeterministicCardSkeleton(
            cardId=card_id,
            identity=identity,
            pokemonStats=None,
            category=category,
            subCategory=sub_category,
            playableActions=playable_actions,
            slots_for_llm=slots_for_llm,
            base_synergies=base_synergies,
        )

    # 4. CAS ÉNERGIE SPÉCIALE
    eff_fr = _normalize_whitespace(raw_fr.get("effect"))
    eff_en = _normalize_whitespace((raw_en or {}).get("effect")) or None
    playable_actions.append(
        PlayableAction(
            actionId="energy_0",
            label=identity.nameFr,
            actionType=ActionType.ATTACH_ENERGY,
            timingPhase=TimingPhase.MAIN_PHASE_1,
            canUseTurn1GoingFirst=True,
            canUseTurn1GoingSecond=True,
            cost={},
            preconditions=[],
            effects=[
                AtomicEffect(
                    primitive=EffectPrimitive.ATTACH_ENERGY,
                    target="OWN_POKEMON_ANY",
                    count=1,
                    zone="HAND",
                )
            ],
            deadCardCondition=None,
        )
    )
    if eff_fr or eff_en:
        slots_for_llm.append(
            EffectSlotToCompile(
                slotId="energy_0",
                actionType=ActionType.ATTACH_ENERGY,
                label=identity.nameFr,
                textFr=eff_fr,
                textEn=eff_en,
            )
        )
    return DeterministicCardSkeleton(
        cardId=card_id,
        identity=identity,
        pokemonStats=None,
        category=category,
        subCategory=sub_category,
        playableActions=playable_actions,
        slots_for_llm=slots_for_llm,
        base_synergies=base_synergies,
    )


def translate_slot_deterministically(
    slot: EffectSlotToCompile,
    skeleton: DeterministicCardSkeleton,
) -> Tuple[List[str], List[AtomicEffect], Optional[str], List[str]]:
    """Analyse déterministe d'un `EffectSlotToCompile` en `(preconditions, effects, deadCardCondition, synergy_tags)`.

    Sert à la fois :
    1. De filet de sécurité déterministe post-LLM pour garantir que les préconditions et effets critiques
       explicitement écrits dans le texte FR/EN ne soient jamais oubliés.
    2. De moteur de secours (fallback) si l'IA échoue.
    """
    combined = f"{slot.textFr} {slot.textEn or ''}".strip()
    lower = combined.lower()
    preconditions: List[str] = []
    effects: List[AtomicEffect] = []
    dead_cond: Optional[str] = None
    synergy_tags: List[str] = []

    # 1. Préconditions textuelles explicites
    if (
        "si ce pokémon est sur le poste actif" in lower
        or "if this pokémon is in the active spot" in lower
        or slot.actionType == ActionType.ATTACK
    ):
        if "SELF_IS_ACTIVE" not in preconditions:
            preconditions.append("SELF_IS_ACTIVE")

    if (
        "lorsque vous jouez ce pokémon de votre main pour faire évoluer" in lower
        or "when you play this pokémon from your hand to evolve" in lower
    ):
        preconditions.append("ON_EVOLVE_FROM_HAND")

    if (
        "lorsque vous jouez ce pokémon de votre main sur votre banc" in lower
        or "when you play this pokémon from your hand onto your bench" in lower
    ):
        preconditions.append("ON_PLAY_FROM_HAND_TO_BENCH")

    if (
        "mis k.o. pendant le dernier tour de votre adversaire" in lower
        or "knocked out during your opponent's last turn" in lower
    ):
        preconditions.append("KO_SUFFERED_LAST_TURN")
        dead_cond = "NO_KO_SUFFERED_LAST_TURN"

    if (
        "plus de cartes récompense restantes que votre adversaire" in lower
        or "more prize cards remaining than your opponent" in lower
    ):
        preconditions.append("PLAYER_BEHIND_ON_PRIZES")
        dead_cond = "NOT_BEHIND_ON_PRIZES"

    m_discard_other = re.search(
        r"(?:défausser|défaussez|discard)\s+(\d+)\s+(?:autres?\s+)?(?:cartes?|cards?)\s+(?:de votre main|from your hand)",
        lower,
    )
    if m_discard_other:
        cnt = int(m_discard_other.group(1))
        preconditions.append(f"HAND_MIN_OTHER_CARDS:{cnt}")
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.DISCARD_CARDS,
                target="PLAYER",
                count=cnt,
                zone="HAND",
            )
        )
        dead_cond = f"HAND_FEWER_THAN_{cnt}_OTHER_CARDS"

    # Super Bonbon / Rare Candy
    if (
        "cartes niveau 2 de votre main" in lower
        or "stage 2 card from your hand" in lower
        or "super bonbon" in slot.label.lower()
        or "rare candy" in slot.label.lower()
    ):
        preconditions.extend(["NOT_FIRST_TURN", "BASIC_POKEMON_IN_PLAY_SINCE_LAST_TURN", "STAGE_2_IN_HAND"])
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.EVOLVE_POKEMON,
                target="OWN_POKEMON_ANY",
                count=1,
                zone="HAND",
                filter="CATEGORY:POKEMON|STAGE:STAGE_2",
            )
        )
        dead_cond = "NO_STAGE_2_IN_HAND_OR_NO_BASIC_IN_PLAY"
        synergy_tags.append("requires_stage_2_pokemon")

    # Poffin Copain-Copain / Faiblo Ball (Recherche de Pokémon de Base vers le Banc)
    if (
        ("cherchez dans votre deck" in lower or "search your deck" in lower)
        and ("sur votre banc" in lower or "onto your bench" in lower)
    ):
        if "BENCH_HAS_EMPTY_SLOT" not in preconditions:
            preconditions.append("BENCH_HAS_EMPTY_SLOT")
        m_cnt = re.search(r"(?:jusqu'à|up to)\s+(\d+)", lower)
        cnt = int(m_cnt.group(1)) if m_cnt else 1
        up_to = bool(m_cnt)
        m_hp = re.search(r"(\d+)\s*pv\s*ou\s*moins|(\d+)\s*hp\s*or\s*less", lower)
        if m_hp:
            hp_lim = int(m_hp.group(1) or m_hp.group(2))
            filt = f"CATEGORY:POKEMON|STAGE:BASIC|MAX_HP:{hp_lim}"
            synergy_tags.append(f"requires_basic_hp_lte_{hp_lim}")
        else:
            filt = "CATEGORY:POKEMON|STAGE:BASIC"
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.SEARCH_DECK,
                target="OWN_BENCH",
                count=cnt,
                zone="DECK",
                filter=filt,
                upTo=up_to,
            )
        )
        dead_cond = dead_cond or "BENCH_FULL_OR_NO_TARGET_IN_DECK"

    # Recherche dans le deck et attachement d'énergie (ex: Règne Infernal)
    elif (
        ("cherchez dans votre deck" in lower or "search your deck" in lower)
        and ("attachez" in lower or "attach" in lower)
        and ("énergie" in lower or "energy" in lower)
    ):
        m_cnt = re.search(r"(?:jusqu'à|up to)\s+(\d+)", lower)
        cnt = int(m_cnt.group(1)) if m_cnt else 1
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.ATTACH_ENERGY,
                target="OWN_POKEMON_ANY",
                count=cnt,
                zone="DECK",
                filter="CATEGORY:ENERGY|SUBCATEGORY:BASIC_ENERGY",
                upTo=True,
                optional=True,
            )
        )

    # Recherche dans le deck vers la main (ex: Hyper Ball, Pepper, Recherche Rapide)
    elif "cherchez dans votre deck" in lower or "search your deck" in lower:
        if "un objet et une carte outil" in lower or ("item card" in lower and "tool card" in lower):
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.SEARCH_DECK,
                    target="PLAYER",
                    count=1,
                    zone="DECK",
                    filter="CATEGORY:TRAINER|SUBCATEGORY:ITEM",
                    upTo=True,
                )
            )
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.SEARCH_DECK,
                    target="PLAYER",
                    count=1,
                    zone="DECK",
                    filter="CATEGORY:TRAINER|SUBCATEGORY:TOOL",
                    upTo=True,
                )
            )
            synergy_tags.append("requires_pokemon_tool")
        else:
            m_cnt = re.search(r"(?:jusqu'à|up to)\s+(\d+)", lower)
            cnt = int(m_cnt.group(1)) if m_cnt else 1
            filt = "CATEGORY:POKEMON" if ("un pokémon" in lower or "a pokémon" in lower) else "ANY"
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.SEARCH_DECK,
                    target="PLAYER",
                    count=cnt,
                    zone="DECK",
                    filter=filt,
                    upTo=bool(m_cnt),
                )
            )
        dead_cond = dead_cond or "NO_VALID_TARGET_IN_DECK"

    # Mélange / remise de la main et pioche (ex: Mashynn / Iono, Recherches Professorales)
    if (
        ("mélangez votre main" in lower or "shuffle your hand" in lower or "dessous de son deck" in lower or "bottom of their deck" in lower)
        and ("pioche" in lower or "draw" in lower)
    ):
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.SHUFFLE_HAND_DRAW,
                target="PLAYER",
                count=6,
                zone="DECK",
            )
        )
    else:
        # Pioche directe (ex: Course Fructueuse "Piochez 2 cartes", Favianos-ex "Piochez 3 cartes")
        m_draw = re.search(r"(?:piochez|draw)\s+(\d+)\s+(?:cartes?|cards?)", lower)
        if m_draw:
            draw_cnt = int(m_draw.group(1))
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.DRAW_CARDS,
                    target="PLAYER",
                    count=draw_cnt,
                    zone="DECK",
                    optional=("vous pouvez" in lower or "you may" in lower),
                )
            )

    # Changement du Pokémon Actif adverse ou allié (ex: Ordres du Boss, Attrape-Riposte)
    if (
        "pokémon de banc de votre adversaire" in lower
        and ("poste actif" in lower or "pokémon actif" in lower)
    ) or (
        "opponent's benched pokémon" in lower
        and ("active spot" in lower or "active pokémon" in lower)
    ):
        if "OPPONENT_HAS_BENCHED_POKEMON" not in preconditions:
            preconditions.append("OPPONENT_HAS_BENCHED_POKEMON")
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.SWITCH_ACTIVE,
                target="OPPONENT_ACTIVE",
                count=1,
                zone="BENCH",
            )
        )
        dead_cond = dead_cond or "OPPONENT_BENCH_EMPTY"

    # Garantie des dégâts de base pour les attaques
    if slot.actionType == ActionType.ATTACK:
        if slot.baseDamage is not None and slot.baseDamage > 0:
            effects.insert(
                0,
                AtomicEffect(
                    primitive=EffectPrimitive.DAMAGE_ACTIVE,
                    target="OPPONENT_ACTIVE",
                    value=slot.baseDamage,
                ),
            )
        else:
            m_extra_dmg = re.search(r"(\d+)\s+dégâts|(\d+)\s+(?:more\s+)?damage", lower)
            dmg_val = int(m_extra_dmg.group(1) or m_extra_dmg.group(2)) if m_extra_dmg else 0
            effects.insert(
                0,
                AtomicEffect(
                    primitive=EffectPrimitive.DAMAGE_ACTIVE,
                    target="OPPONENT_ACTIVE",
                    value=dmg_val,
                ),
            )

    return list(dict.fromkeys(preconditions)), effects, dead_cond, list(dict.fromkeys(synergy_tags))


def build_fallback_llm_payload(skeleton: DeterministicCardSkeleton) -> LLMCompiledPayload:
    """Construit un `LLMCompiledPayload` déterministe complet (sans IA ou en secours)."""
    translated_slots: List[LLMTranslatedSlot] = []
    extra_synergies: List[str] = []

    for slot in skeleton.slots_for_llm:
        pre, effs, dead_cond, syn_tags = translate_slot_deterministically(slot, skeleton)
        translated_slots.append(
            LLMTranslatedSlot(
                slotId=slot.slotId,
                preconditions=pre,
                effects=effs,
                deadCardCondition=dead_cond,
            )
        )
        for tag in syn_tags:
            if tag not in extra_synergies:
                extra_synergies.append(tag)

    # Détermination du rôle stratégique et des poids par tour
    sub = skeleton.subCategory
    cat = skeleton.category
    ai_role = AIRole.GUEST_TECH
    weights = TurnPhaseWeights(turn1=0.8, turn2=0.8, turn3=0.8, turn4Plus=0.8)

    all_primitives = [
        eff.primitive
        for s in translated_slots
        for eff in s.effects
    ] + [
        eff.primitive
        for act in skeleton.playableActions
        for eff in act.effects
    ]

    if sub == CardSubCategory.BASIC_ENERGY:
        ai_role = AIRole.ENERGY_ACCELERATOR
        weights = TurnPhaseWeights(turn1=1.0, turn2=1.0, turn3=1.0, turn4Plus=1.0)
    elif cat == CardCategory.POKEMON:
        has_draw_ability = any(
            s.slotId.startswith("ability_")
            and any(e.primitive == EffectPrimitive.DRAW_CARDS for e in s.effects)
            for s in translated_slots
        )
        has_search_ability = any(
            s.slotId.startswith("ability_")
            and any(e.primitive == EffectPrimitive.SEARCH_DECK for e in s.effects)
            for s in translated_slots
        )
        max_dmg = max(
            [
                eff.value or 0
                for act in skeleton.playableActions
                if act.actionType == ActionType.ATTACK
                for eff in act.effects
                if eff.primitive == EffectPrimitive.DAMAGE_ACTIVE
            ]
            or [0]
        )
        if max_dmg >= 180 or skeleton.identity.prizeCardsGiven >= 2 and max_dmg >= 120:
            ai_role = AIRole.MAIN_ATTACKER
        elif has_draw_ability:
            ai_role = AIRole.DRAW_ENGINE
        elif has_search_ability:
            ai_role = AIRole.CONSISTENCY_BOOSTER
        elif max_dmg > 0:
            ai_role = AIRole.SECONDARY_ATTACKER
        else:
            ai_role = AIRole.GUEST_TECH

        if sub in {CardSubCategory.STAGE_1, CardSubCategory.STAGE_2}:
            weights = TurnPhaseWeights(turn1=0.0, turn2=0.9, turn3=1.0, turn4Plus=1.0)
        else:
            weights = TurnPhaseWeights(turn1=0.9, turn2=0.9, turn3=0.8, turn4Plus=0.8)
    elif cat == CardCategory.TRAINER:
        if EffectPrimitive.SHUFFLE_HAND_DRAW in all_primitives or EffectPrimitive.SWITCH_ACTIVE in all_primitives:
            ai_role = AIRole.DISRUPTION
            weights = TurnPhaseWeights(turn1=0.3, turn2=0.8, turn3=0.9, turn4Plus=1.0)
        elif EffectPrimitive.SEARCH_DECK in all_primitives or EffectPrimitive.EVOLVE_POKEMON in all_primitives:
            ai_role = AIRole.CONSISTENCY_BOOSTER
            is_t1_locked = any("NOT_FIRST_TURN" in s.preconditions for s in translated_slots)
            weights = TurnPhaseWeights(
                turn1=0.0 if is_t1_locked else 1.0,
                turn2=1.0,
                turn3=0.8,
                turn4Plus=0.5,
            )
        elif EffectPrimitive.DRAW_CARDS in all_primitives:
            ai_role = AIRole.DRAW_ENGINE
            weights = TurnPhaseWeights(turn1=0.5, turn2=0.9, turn3=0.9, turn4Plus=0.8)
        else:
            ai_role = AIRole.GUEST_TECH

    return LLMCompiledPayload(
        translatedSlots=translated_slots,
        aiRole=ai_role,
        turnPhaseWeights=weights,
        additionalSynergyTags=extra_synergies,
    )


def merge_llm_payload_into_skeleton(
    skeleton: DeterministicCardSkeleton,
    llm_payload: Optional[LLMCompiledPayload] = None,
    compilation_metadata: Optional[CompilationMetadata] = None,
) -> EngineCardModel:
    """Fusionne le `LLMCompiledPayload` avec le squelette déterministe et applique les verrous finaux."""
    if skeleton.static_strategic_evaluator is not None and not skeleton.slots_for_llm:
        return EngineCardModel(
            cardId=skeleton.cardId,
            identity=skeleton.identity,
            pokemonStats=skeleton.pokemonStats,
            category=skeleton.category,
            subCategory=skeleton.subCategory,
            playableActions=copy.deepcopy(skeleton.playableActions),
            strategicEvaluator=copy.deepcopy(skeleton.static_strategic_evaluator),
            compilationMetadata=compilation_metadata,
        )

    effective_payload = llm_payload or build_fallback_llm_payload(skeleton)
    slot_map: Dict[str, LLMTranslatedSlot] = {s.slotId: s for s in effective_payload.translatedSlots}
    slot_spec_map: Dict[str, EffectSlotToCompile] = {s.slotId: s for s in skeleton.slots_for_llm}

    # Si l'IA n'a renvoyé qu'un seul slot avec un ID générique alors qu'il n'y a qu'un seul slot attendu
    if len(skeleton.slots_for_llm) == 1 and len(effective_payload.translatedSlots) == 1:
        expected_id = skeleton.slots_for_llm[0].slotId
        if expected_id not in slot_map:
            slot_map[expected_id] = effective_payload.translatedSlots[0]

    merged_actions: List[PlayableAction] = []
    auto_synergy_tags: List[str] = []

    for action in skeleton.playableActions:
        act_copy = copy.deepcopy(action)
        slot_spec = slot_spec_map.get(act_copy.actionId)

        if slot_spec is not None:
            det_pre, det_effs, det_dead, det_syns = translate_slot_deterministically(slot_spec, skeleton)
            for tag in det_syns:
                if tag not in auto_synergy_tags:
                    auto_synergy_tags.append(tag)

            llm_slot = slot_map.get(act_copy.actionId)
            if llm_slot is not None:
                # 1. Fusion des préconditions (préconditions déterministes critiques + LLM)
                merged_pre = list(act_copy.preconditions)
                for p in llm_slot.preconditions:
                    if p and p not in merged_pre:
                        merged_pre.append(p)
                for p in det_pre:
                    if p and p not in merged_pre:
                        merged_pre.append(p)
                act_copy.preconditions = merged_pre

                # 2. Fusion des effets atomiques
                llm_effects = list(llm_slot.effects)
                if act_copy.actionType == ActionType.ATTACK:
                    # Garantir que le DAMAGE_ACTIVE de base déterministe est TOUJOURS présent
                    base_dmg = slot_spec.baseDamage
                    if base_dmg is not None and base_dmg > 0:
                        has_base_dmg = False
                        for eff in llm_effects:
                            if eff.primitive == EffectPrimitive.DAMAGE_ACTIVE:
                                if eff.value is None or eff.value == 0:
                                    eff.value = base_dmg
                                if not eff.target:
                                    eff.target = "OPPONENT_ACTIVE"
                                has_base_dmg = True
                                break
                        if not has_base_dmg:
                            llm_effects.insert(
                                0,
                                AtomicEffect(
                                    primitive=EffectPrimitive.DAMAGE_ACTIVE,
                                    target="OPPONENT_ACTIVE",
                                    value=base_dmg,
                                ),
                            )
                    elif not llm_effects:
                        llm_effects = det_effs
                    act_copy.effects = llm_effects
                else:
                    # Pour les Talents et Dresseurs : si le LLM a omis les effets ou un effet critique (ex: DRAW_CARDS)
                    if not llm_effects:
                        act_copy.effects = det_effs
                    else:
                        # Vérifie si le texte impose explicitement une pioche/recherche/évolution absente de llm_effects
                        llm_prims = {e.primitive for e in llm_effects}
                        for de in det_effs:
                            if de.primitive not in llm_prims:
                                llm_effects.append(de)
                            elif de.primitive == EffectPrimitive.DRAW_CARDS and de.count is not None:
                                for le in llm_effects:
                                    if le.primitive == EffectPrimitive.DRAW_CARDS and le.count is None:
                                        le.count = de.count
                        act_copy.effects = llm_effects

                act_copy.deadCardCondition = llm_slot.deadCardCondition or det_dead or act_copy.deadCardCondition
            else:
                # Fallback déterministe sur ce slot si non retourné par le LLM
                merged_pre = list(act_copy.preconditions)
                for p in det_pre:
                    if p and p not in merged_pre:
                        merged_pre.append(p)
                act_copy.preconditions = merged_pre
                if det_effs:
                    act_copy.effects = det_effs
                act_copy.deadCardCondition = det_dead or act_copy.deadCardCondition

            # Verrous déterministes finaux sur les restrictions de Tour 1 d'après le texte du slot
            low_text = f"{slot_spec.textFr} {slot_spec.textEn or ''}".lower()
            if (
                "ni pendant votre premier tour" in low_text
                or "nor during your first turn" in low_text
                or "super bonbon" in slot_spec.label.lower()
                or "rare candy" in slot_spec.label.lower()
            ):
                act_copy.canUseTurn1GoingFirst = False
                act_copy.canUseTurn1GoingSecond = False

            if (
                "plus de cartes récompense restantes que votre adversaire" in low_text
                or "more prize cards remaining than your opponent" in low_text
                or "mis k.o. pendant le dernier tour de votre adversaire" in low_text
                or "knocked out during your opponent's last turn" in low_text
            ):
                act_copy.canUseTurn1GoingFirst = False

            # Si ce slot n'était pas dans slots_for_llm mais que le LLM a fourni un slot correspondant et que effects est vide
        elif act_copy.actionId in slot_map and not act_copy.effects:
            llm_slot_extra = slot_map[act_copy.actionId]
            if llm_slot_extra.effects:
                act_copy.effects = list(llm_slot_extra.effects)

        merged_actions.append(act_copy)

    # Verrous déterministes sur les poids de tour (bornés strictement entre 0.0 et 1.0)
    raw_w = effective_payload.turnPhaseWeights
    t1 = max(0.0, min(1.0, float(raw_w.turn1)))
    t2 = max(0.0, min(1.0, float(raw_w.turn2)))
    t3 = max(0.0, min(1.0, float(raw_w.turn3)))
    t4 = max(0.0, min(1.0, float(raw_w.turn4Plus)))

    if skeleton.subCategory in {CardSubCategory.STAGE_1, CardSubCategory.STAGE_2}:
        t1 = 0.0
    if skeleton.category == CardCategory.TRAINER and all(
        not a.canUseTurn1GoingFirst and not a.canUseTurn1GoingSecond for a in merged_actions
    ):
        t1 = 0.0

    clamped_weights = TurnPhaseWeights(turn1=t1, turn2=t2, turn3=t3, turn4Plus=t4)

    # Consolidation des tags de synergie (base déterministe + auto + LLM)
    synergies: List[str] = []
    for tag in skeleton.base_synergies + auto_synergy_tags + list(effective_payload.additionalSynergyTags):
        t_clean = str(tag).strip()
        if t_clean and t_clean not in synergies:
            synergies.append(t_clean)

    evaluator = StrategicEvaluator(
        aiRole=effective_payload.aiRole,
        turnPhaseWeights=clamped_weights,
        decklistSynergyRequirements=synergies,
    )

    return EngineCardModel.model_validate(
        {
            "cardId": skeleton.cardId,
            "identity": skeleton.identity,
            "pokemonStats": skeleton.pokemonStats,
            "category": skeleton.category,
            "subCategory": skeleton.subCategory,
            "playableActions": merged_actions,
            "strategicEvaluator": evaluator,
            "compilationMetadata": compilation_metadata,
        }
    )
