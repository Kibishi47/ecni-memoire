"""Constructeur 100 % déterministe du squelette `EngineCardModel` et des slots d'effets pour l'IA.

Ce module implémente le Principe Directeur :
- Construire en Python pur 100 % des données connues depuis `data/raw_tcgdex/{id}.json` :
  * `identity` (`CardIdentity` avec `prizeCardsGiven`, `isRuleBox`, `isAceSpec`, `isAncient`, `isFuture`, `isTera`, `legalStandard`, `legalExpanded`)
  * `pokemonStats` (`PokemonStats` avec `hp`, `types`, `stage`, `evolvesFrom`, `rootBasicName`, `evolutionChain`, `retreatCost`, `weaknesses`, `resistances`)
  * Les squelettes des `playableActions` (`PLAY_FROM_HAND`, `EVOLVE`, `USE_ABILITY`, `TRIGGERED_ABILITY`, `PASSIVE_ABILITY`, `ATTACK`, `RETREAT`, `ATTACH_ENERGY`) avec leurs `cost`, `timingPhase`, `canUseTurn1GoingFirst`, `canUseTurn1GoingSecond` et les dégâts numériques de base (`DAMAGE_ACTIVE`).
  * Les synergies déterministes de base (`requires_evolution_line:...`, `requires_energy_type:...`).
- Extraire uniquement la liste des `EffectSlotToCompile` (`slots_for_llm`) contenant les textes d'effets à traduire par le pipeline IA en 2 passes.
- Fusionner le `LLMCompiledPayload` généré par la Passe 2 dans le squelette déterministe en appliquant les verrous et garde-fous déterministes finaux.
"""

from __future__ import annotations

import copy
import html
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from pydantic import BaseModel, Field

from compiler.schemas import (
    AIRole,
    ActionType,
    AtomicEffect,
    CardCategory,
    CardIdentity,
    CardSubCategory,
    CoinFlipMode,
    CompilationMetadata,
    EffectPrimitive,
    EffectTarget,
    EngineCardModel,
    LLMCompiledPayload,
    LLMTranslatedSlot,
    PlayableAction,
    PokemonStats,
    ScalingMetric,
    ScalingOperator,
    SpecialCondition,
    StrategicEvaluator,
    TimingPhase,
    TurnPhaseWeights,
    TypeModifier,
    ZoneType,
)


_DEFAULT_RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw_tcgdex"
_REPRINT_INDEX_CACHE: Dict[str, Dict[Tuple[str, str], Tuple[str, str]]] = {}
_EVOLVABLE_INDEX_CACHE: Dict[str, Set[str]] = {}

_OWN_OR_SELF_TARGETS = {
    EffectTarget.SELF,
    EffectTarget.PLAYER,
    EffectTarget.OWN_ACTIVE,
    EffectTarget.OWN_BENCH_SINGLE,
    EffectTarget.OWN_BENCH_ALL,
    EffectTarget.OWN_POKEMON_ANY,
    EffectTarget.OWN_ALL_POKEMON,
}

_BIASED_WEIGHT_TUPLES = {
    (0.9, 0.9, 0.8, 0.8),
    (0.0, 0.9, 0.8, 0.8),
}

_ALLOWED_EXACT_SYNERGY_TAGS = {
    "requires_stage_2_pokemon",
    "requires_tera_pokemon",
    "requires_ancient_pokemon",
    "requires_future_pokemon",
    "requires_discard_synergy",
    "requires_pokemon_tool",
}

_ALLOWED_SYNERGY_PREFIXES = (
    "requires_energy_type:",
    "requires_evolution_line:",
    "requires_basic_hp_lte_",
    "requires_subcategory:",
    "requires_category:",
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
    printedDamageStr: Optional[str] = Field(
        default=None,
        description="Chaîne brute des dégâts TCGdex (ex: '180+', '70×')",
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
    """Nettoie les balises HTML TCGdex (`<span class='energy-symbol'...>`, `<em>`, etc.) et normalise les espaces."""
    if not text:
        return ""
    s = str(text)
    s = re.sub(
        r"<span\b[^>]*class=[\"'][^\"']*energy-symbol[^\"']*[\"'][^>]*title=[\"']([^\"']+)[\"'][^>]*>[^<]*</span>",
        r"{\1}",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"<span\b[^>]*title=[\"']([^\"']+)[\"'][^>]*class=[\"'][^\"']*energy-symbol[^\"']*[\"'][^>]*>[^<]*</span>",
        r"{\1}",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def clean_tcgdex_text(text: Optional[str]) -> str:
    """Alias public vers le nettoyeur HTML/espaces TCGdex."""
    return _normalize_whitespace(text)


def build_reprint_effect_index(raw_dir: Optional[Path] = None) -> Dict[Tuple[str, str], Tuple[str, str]]:
    """Indexe les textes d'effets FR/EN non nuls des cartes Dresseur/Énergie par nom pour résoudre les rééditions sans texte."""
    target_dir = (raw_dir or _DEFAULT_RAW_DIR).resolve()
    cache_key = str(target_dir)
    if cache_key in _REPRINT_INDEX_CACHE:
        return _REPRINT_INDEX_CACHE[cache_key]

    index: Dict[Tuple[str, str], Tuple[str, str]] = {}
    if not target_dir.is_dir():
        _REPRINT_INDEX_CACHE[cache_key] = index
        return index

    for fpath in sorted(target_dir.glob("*.json")):
        if fpath.name.startswith("_"):
            continue
        try:
            data = json.loads(fpath.read_text(encoding="utf-8"))
        except Exception:
            continue
        raw_fr = data.get("fr") if isinstance(data.get("fr"), dict) else data
        raw_en = data.get("en") if isinstance(data.get("en"), dict) else {}
        if not isinstance(raw_fr, dict):
            continue
        cat, _ = infer_category_and_subcategory(raw_fr, raw_en)
        if cat not in {CardCategory.TRAINER, CardCategory.ENERGY}:
            continue
        eff_fr = _normalize_whitespace(raw_fr.get("effect"))
        eff_en = _normalize_whitespace(raw_en.get("effect"))
        if not eff_fr and not eff_en:
            continue
        name_fr = _normalize_whitespace(raw_fr.get("name")).lower()
        name_en = _normalize_whitespace(raw_en.get("name")).lower()
        pair = (eff_fr, eff_en)
        if name_fr and (cat.value, name_fr) not in index:
            index[(cat.value, name_fr)] = pair
        if name_en and (cat.value, name_en) not in index:
            index[(cat.value, name_en)] = pair

    _REPRINT_INDEX_CACHE[cache_key] = index
    return index


def build_evolvable_names_index(raw_dir: Optional[Path] = None) -> Set[str]:
    """Construit l'ensemble des noms de Pokémon ayant au moins une évolution dans `raw_tcgdex/`."""
    target_dir = (raw_dir or _DEFAULT_RAW_DIR).resolve()
    cache_key = str(target_dir)
    if cache_key in _EVOLVABLE_INDEX_CACHE:
        return _EVOLVABLE_INDEX_CACHE[cache_key]

    evolvables: Set[str] = set()
    if not target_dir.is_dir():
        _EVOLVABLE_INDEX_CACHE[cache_key] = evolvables
        return evolvables

    for fpath in sorted(target_dir.glob("*.json")):
        if fpath.name.startswith("_"):
            continue
        try:
            data = json.loads(fpath.read_text(encoding="utf-8"))
        except Exception:
            continue
        raw_fr = data.get("fr") if isinstance(data.get("fr"), dict) else data
        raw_en = data.get("en") if isinstance(data.get("en"), dict) else {}
        for block in (raw_fr, raw_en):
            if isinstance(block, dict):
                evo = block.get("evolveFrom") or block.get("evolvesFrom")
                if isinstance(evo, str) and evo.strip():
                    evolvables.add(evo.strip().lower())

    _EVOLVABLE_INDEX_CACHE[cache_key] = evolvables
    return evolvables


def resolve_missing_reprint_effects(
    raw_fr: Dict[str, Any],
    raw_en: Optional[Dict[str, Any]],
    category: CardCategory,
    raw_dir: Optional[Path] = None,
    reprint_index: Optional[Dict[Tuple[str, str], Tuple[str, str]]] = None,
) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    """Hérite le texte d'effet d'une réédition existante si une carte Dresseur/Énergie a `effect == null`."""
    if category not in {CardCategory.TRAINER, CardCategory.ENERGY}:
        return raw_fr, raw_en

    has_fr = bool(_normalize_whitespace(raw_fr.get("effect")) or raw_fr.get("attacks"))
    has_en = bool(raw_en and (_normalize_whitespace(raw_en.get("effect")) or raw_en.get("attacks")))
    if has_fr or has_en:
        return raw_fr, raw_en

    idx = reprint_index if reprint_index is not None else build_reprint_effect_index(raw_dir)
    name_fr = _normalize_whitespace(raw_fr.get("name")).lower()
    name_en = _normalize_whitespace((raw_en or {}).get("name")).lower()

    found: Optional[Tuple[str, str]] = None
    if name_fr and (category.value, name_fr) in idx:
        found = idx[(category.value, name_fr)]
    elif name_en and (category.value, name_en) in idx:
        found = idx[(category.value, name_en)]

    if not found:
        return raw_fr, raw_en

    new_fr = dict(raw_fr)
    new_en = dict(raw_en) if raw_en is not None else None
    if found[0]:
        new_fr["effect"] = found[0]
    if found[1] and new_en is not None:
        new_en["effect"] = found[1]
    elif found[1] and new_en is None:
        new_en = {"effect": found[1]}
    return new_fr, new_en


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
    """Assemble tous les textes d'effets, talents et attaques (FR + EN) sans balises HTML."""
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
            ab_name = _normalize_whitespace(ability.get("name"))
            ab_effect = _normalize_whitespace(ability.get("effect"))
            lines.append(f"[{ab_type} FR: {ab_name}] {ab_effect}")

    if raw_en:
        for ability in raw_en.get("abilities") or []:
            if isinstance(ability, dict):
                ab_type = ability.get("type") or "Ability"
                ab_name = _normalize_whitespace(ability.get("name"))
                ab_effect = _normalize_whitespace(ability.get("effect"))
                lines.append(f"[{ab_type} EN: {ab_name}] {ab_effect}")

    for attack in raw_fr.get("attacks") or []:
        if isinstance(attack, dict):
            atk_name = _normalize_whitespace(attack.get("name"))
            atk_cost = ",".join(attack.get("cost") or [])
            atk_dmg = attack.get("damage")
            atk_eff = _normalize_whitespace(attack.get("effect"))
            dmg_str = f" ({atk_dmg} dégâts)" if atk_dmg is not None else ""
            lines.append(f"[Attaque FR: {atk_name} | Coût: {atk_cost}{dmg_str}] {atk_eff}".strip())

    if raw_en:
        for attack in raw_en.get("attacks") or []:
            if isinstance(attack, dict):
                atk_name = _normalize_whitespace(attack.get("name"))
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
    """Calcule de façon 100 % déterministe `(isRuleBox, prizeCardsGiven)` pour un Pokémon."""
    name_fr_clean = (name_fr or "").strip()
    name_en_clean = (name_en or "").strip()
    combined_name = f"{name_fr_clean} {name_en_clean}"
    raw_suffix = str(raw_fr.get("suffix") or (raw_en or {}).get("suffix") or "").strip()
    suffix = raw_suffix.lower()

    is_mega_prefix = (
        name_fr_clean.lower().startswith(("méga-", "mega-", "méga ", "mega "))
        or name_en_clean.lower().startswith(("mega ", "mega-", "méga-"))
    )
    has_lowercase_ex = (
        raw_suffix == "ex"
        or bool(re.search(r"(?:\b|-)ex\b", combined_name))
    )

    if (is_mega_prefix and has_lowercase_ex) or re.search(r"\b(vmax|v-union)\b", combined_name, flags=re.IGNORECASE) or "vmax" in suffix:
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


def classify_ability_action_type(text_fr: Optional[str], text_en: Optional[str] = None) -> ActionType:
    """Distingue de façon déterministe un talent activable (`USE_ABILITY`), déclenché (`TRIGGERED_ABILITY`) ou passif (`PASSIVE_ABILITY`)."""
    lower = f"{_normalize_whitespace(text_fr)} {_normalize_whitespace(text_en)}".lower().strip()
    if not lower:
        return ActionType.USE_ABILITY

    # Déclencheurs événementiels (pose, évolution, K.O., attaque subie, Contrôle Pokémon)
    if (
        "lorsque vous jouez ce pokémon de votre main" in lower
        or "when you play this pokémon from your hand" in lower
        or "si ce pokémon est mis k.o." in lower
        or "if this pokémon is knocked out" in lower
        or "lorsque l'un de vos pokémon est mis k.o." in lower
        or "when one of your pokémon is knocked out" in lower
        or "lorsque le pokémon actif de votre adversaire" in lower
        or "when your opponent's active pokémon" in lower
        or "subit les dégâts d'une attaque" in lower
        or "is damaged by an attack" in lower
        or "pendant le contrôle pokémon" in lower
        or "during pokémon checkup" in lower
        or "lorsque vous préparez la partie" in lower
    ):
        return ActionType.TRIGGERED_ABILITY

    # Talents activables manuellement pendant le tour
    if (
        "une fois pendant votre tour" in lower
        or "once during your turn" in lower
        or "autant de fois que vous le voulez" in lower
        or "aussi souvent que vous le voulez" in lower
        or "as often as you like" in lower
        or "pendant votre tour, vous pouvez" in lower
    ):
        return ActionType.USE_ABILITY

    return ActionType.PASSIVE_ABILITY


def _grants_turn1_going_first(text_fr: Optional[str], text_en: Optional[str] = None) -> bool:
    """Détecte si un texte autorise explicitement d'attaquer au Tour 1 du premier joueur."""
    lower = f"{_normalize_whitespace(text_fr)} {_normalize_whitespace(text_en)}".lower()
    return (
        ("si vous jouez en premier" in lower and "premier tour" in lower and "peut utiliser" in lower)
        or ("if you go first" in lower and "first turn" in lower and "can use" in lower)
        or ("même si vous jouez en premier" in lower)
        or ("even if you go first" in lower)
    )


def _forbids_turn1_both(text_fr: Optional[str], text_en: Optional[str] = None, label: str = "") -> bool:
    """Détecte si la carte ou l'action est explicitement interdite au Tour 1 (y compris en second)."""
    lower = f"{_normalize_whitespace(text_fr)} {_normalize_whitespace(text_en)}".lower()
    lbl = (label or "").lower()
    return (
        "ni pendant votre premier tour" in lower
        or "nor during your first turn" in lower
        or "super bonbon" in lbl
        or "rare candy" in lbl
    )


def _extract_raw_parts(
    raw_input: Union[Dict[str, Any], Path, Any],
    raw_dir: Optional[Path] = None,
    reprint_index: Optional[Dict[Tuple[str, str], Tuple[str, str]]] = None,
) -> Tuple[str, Dict[str, Any], Optional[Dict[str, Any]], Optional[Tuple[Optional[str], Optional[str], List[str]]], Optional[Path]]:
    """Extrait `(card_id, raw_fr, raw_en, evolution_info, resolved_raw_dir)`."""
    detected_raw_dir = raw_dir

    if hasattr(raw_input, "card_id") and hasattr(raw_input, "raw_fr"):
        bundle = raw_input
        card_id = str(bundle.card_id).strip()
        raw_fr = dict(bundle.raw_fr or {})
        raw_en = dict(bundle.raw_en) if bundle.raw_en is not None else None
        if detected_raw_dir is None and getattr(bundle, "raw_cache_path", None):
            cand_dir = Path(bundle.raw_cache_path).parent
            if cand_dir.is_dir():
                detected_raw_dir = cand_dir
        evo_info: Optional[Tuple[Optional[str], Optional[str], List[str]]] = None
        if getattr(bundle, "pokemon_stats", None) is not None:
            ps = bundle.pokemon_stats
            evo_info = (ps.evolvesFrom, ps.rootBasicName, list(ps.evolutionChain or []))
    elif isinstance(raw_input, Path):
        data = json.loads(raw_input.read_text(encoding="utf-8"))
        if detected_raw_dir is None and raw_input.parent.is_dir():
            detected_raw_dir = raw_input.parent
        raw_fr, raw_en, card_id, evo_info = _unpack_raw_dict(data)
    elif isinstance(raw_input, dict):
        raw_fr, raw_en, card_id, evo_info = _unpack_raw_dict(raw_input)
    else:
        raise TypeError(f"Type d'entrée non supporté pour build_deterministic_skeleton: {type(raw_input)}")

    cat, _ = infer_category_and_subcategory(raw_fr, raw_en)
    raw_fr, raw_en = resolve_missing_reprint_effects(
        raw_fr=raw_fr,
        raw_en=raw_en,
        category=cat,
        raw_dir=detected_raw_dir,
        reprint_index=reprint_index,
    )
    return card_id, raw_fr, raw_en, evo_info, detected_raw_dir


def _unpack_raw_dict(
    data: Dict[str, Any],
) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]], str, Optional[Tuple[Optional[str], Optional[str], List[str]]]]:
    if "fr" in data and isinstance(data["fr"], dict):
        raw_fr = dict(data["fr"])
        raw_en = dict(data["en"]) if isinstance(data.get("en"), dict) else None
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
        return raw_fr, raw_en, card_id, evo_info

    raw_fr = dict(data)
    card_id = str(raw_fr.get("id") or "unknown-000").strip()
    return raw_fr, None, card_id, None


def build_identity_and_stats_from_raw(
    requested_card_id: str,
    raw_fr: Dict[str, Any],
    raw_en: Optional[Dict[str, Any]] = None,
    evolution_info: Optional[Tuple[Optional[str], Optional[str], List[str]]] = None,
) -> Tuple[CardIdentity, Optional[PokemonStats]]:
    """Construit de façon 100 % déterministe `CardIdentity` et `PokemonStats`."""
    category, sub_category = infer_category_and_subcategory(raw_fr, raw_en)
    name_fr = _normalize_whitespace(raw_fr.get("name") or requested_card_id)
    name_en = _normalize_whitespace(raw_en.get("name")) if raw_en and raw_en.get("name") else None

    set_obj = raw_fr.get("set") if isinstance(raw_fr.get("set"), dict) else {}
    set_id = str(set_obj.get("id") or requested_card_id.split("-")[0]).strip()
    set_name = _normalize_whitespace(set_obj.get("name")) or None
    local_id = str(raw_fr.get("localId") or requested_card_id.split("-")[-1]).strip()

    reg_mark = raw_fr.get("regulationMark") or (raw_en or {}).get("regulationMark")
    reg_mark_norm = str(reg_mark).strip().upper() if reg_mark else None

    legal_obj = raw_fr.get("legal") if isinstance(raw_fr.get("legal"), dict) else {}
    legal_standard = bool(
        legal_obj.get("standard", False)
        or (reg_mark_norm in {"G", "H", "I", "J"})
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


def _append_ability_actions_and_slots(
    abilities_fr: List[Dict[str, Any]],
    abilities_en: List[Dict[str, Any]],
    can_t1_first_base: bool,
    playable_actions: List[PlayableAction],
    slots_for_llm: List[EffectSlotToCompile],
) -> bool:
    """Construit les `PlayableAction` et `EffectSlotToCompile` des talents; retourne True si T1 J1 attaque autorisé."""
    grants_t1_attack = False
    for idx, ab_fr in enumerate(abilities_fr):
        ab_en = abilities_en[idx] if idx < len(abilities_en) else None
        ab_name = _normalize_whitespace(ab_fr.get("name") or (ab_en or {}).get("name") or f"Talent {idx + 1}")
        ab_text_fr = _normalize_whitespace(ab_fr.get("effect"))
        ab_text_en = _normalize_whitespace((ab_en or {}).get("effect")) or None
        if _grants_turn1_going_first(ab_text_fr, ab_text_en):
            grants_t1_attack = True

        slot_id = f"ability_{idx}"
        ab_action_type = classify_ability_action_type(ab_text_fr, ab_text_en)
        forbids_t1 = _forbids_turn1_both(ab_text_fr, ab_text_en, ab_name)

        playable_actions.append(
            PlayableAction(
                actionId=slot_id,
                label=ab_name,
                actionType=ab_action_type,
                timingPhase=TimingPhase.MAIN_PHASE_1,
                canUseTurn1GoingFirst=can_t1_first_base and not forbids_t1,
                canUseTurn1GoingSecond=not forbids_t1,
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
                    actionType=ab_action_type,
                    label=ab_name,
                    textFr=ab_text_fr,
                    textEn=ab_text_en,
                )
            )
    return grants_t1_attack


def _append_attack_actions_and_slots(
    attacks_fr: List[Dict[str, Any]],
    attacks_en: List[Dict[str, Any]],
    pokemon_grants_t1_attack: bool,
    playable_actions: List[PlayableAction],
    slots_for_llm: List[EffectSlotToCompile],
    base_synergies: List[str],
) -> None:
    """Construit les `PlayableAction` et `EffectSlotToCompile` des attaques (Pokémon ou Capsule Technique)."""
    for idx, atk_fr in enumerate(attacks_fr):
        atk_en = attacks_en[idx] if idx < len(attacks_en) else None
        atk_name = _normalize_whitespace(atk_fr.get("name") or (atk_en or {}).get("name") or f"Attaque {idx + 1}")
        cost_dict = _count_energy_cost(atk_fr.get("cost"))
        printed_dmg_str = str(atk_fr.get("damage") or "").strip() or None
        base_dmg = _parse_base_damage(atk_fr.get("damage"))
        atk_text_fr = _normalize_whitespace(atk_fr.get("effect"))
        atk_text_en = _normalize_whitespace((atk_en or {}).get("effect")) or None
        slot_id = f"attack_{idx}"

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
                    target=EffectTarget.OPPONENT_ACTIVE,
                    value=base_dmg,
                )
            )

        forbids_t1 = _forbids_turn1_both(atk_text_fr, atk_text_en, atk_name)
        can_t1_first = (pokemon_grants_t1_attack or _grants_turn1_going_first(atk_text_fr, atk_text_en)) and not forbids_t1
        can_t1_second = not forbids_t1

        playable_actions.append(
            PlayableAction(
                actionId=slot_id,
                label=atk_name,
                actionType=ActionType.ATTACK,
                timingPhase=TimingPhase.ATTACK_PHASE,
                canUseTurn1GoingFirst=can_t1_first,
                canUseTurn1GoingSecond=can_t1_second,
                cost=cost_dict,
                preconditions=["SELF_IS_ACTIVE"],
                effects=initial_effects,
                deadCardCondition=None,
            )
        )

        if atk_text_fr or atk_text_en:
            slots_for_llm.append(
                EffectSlotToCompile(
                    slotId=slot_id,
                    actionType=ActionType.ATTACK,
                    label=atk_name,
                    textFr=atk_text_fr,
                    textEn=atk_text_en,
                    baseDamage=base_dmg,
                    printedDamageStr=printed_dmg_str,
                )
            )


def build_deterministic_skeleton(
    raw_input: Union[Dict[str, Any], Path, Any],
    raw_dir: Optional[Path] = None,
    reprint_index: Optional[Dict[Tuple[str, str], Tuple[str, str]]] = None,
) -> DeterministicCardSkeleton:
    """Construit 100 % du squelette déterministe et extrait les `slots_for_llm` à traduire."""
    card_id, raw_fr, raw_en, evo_info, _ = _extract_raw_parts(
        raw_input,
        raw_dir=raw_dir,
        reprint_index=reprint_index,
    )
    identity, pokemon_stats = build_identity_and_stats_from_raw(
        requested_card_id=card_id,
        raw_fr=raw_fr,
        raw_en=raw_en,
        evolution_info=evo_info,
    )
    if hasattr(raw_input, "identity") and isinstance(getattr(raw_input, "identity", None), CardIdentity):
        if not raw_fr.get("category") and not (raw_en or {}).get("category"):
            # Nettoyer d'éventuelles balises HTML sur rawRulesText préexistant
            existing_rules = [_normalize_whitespace(line) for line in raw_input.identity.rawRulesText]
            identity = raw_input.identity.model_copy(update={"rawRulesText": existing_rules})
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
                        target=EffectTarget.OWN_POKEMON_ANY,
                        count=1,
                        sourceZone=ZoneType.HAND,
                        destinationZone=ZoneType.ATTACHED_CARDS,
                        zone=ZoneType.HAND,
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
                            target=EffectTarget.SELF,
                            sourceZone=ZoneType.HAND,
                            destinationZone=ZoneType.BENCH,
                        )
                    ],
                    deadCardCondition=f"NO_{evo_from.upper().replace(' ', '_')}_IN_PLAY",
                )
            )
            if pokemon_stats.rootBasicName:
                base_synergies.append(f"requires_evolution_line:{pokemon_stats.rootBasicName}")

        # Talents & Attaques (construction factorisée)
        abilities_fr = [a for a in (raw_fr.get("abilities") or []) if isinstance(a, dict)]
        abilities_en = [a for a in ((raw_en or {}).get("abilities") or []) if isinstance(a, dict)]
        pokemon_grants_t1_attack = _append_ability_actions_and_slots(
            abilities_fr,
            abilities_en,
            is_base,
            playable_actions,
            slots_for_llm,
        )

        attacks_fr = [a for a in (raw_fr.get("attacks") or []) if isinstance(a, dict)]
        attacks_en = [a for a in ((raw_en or {}).get("attacks") or []) if isinstance(a, dict)]
        _append_attack_actions_and_slots(
            attacks_fr,
            attacks_en,
            pokemon_grants_t1_attack,
            playable_actions,
            slots_for_llm,
            base_synergies,
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
                        target=EffectTarget.SELF,
                        sourceZone=ZoneType.ACTIVE,
                        destinationZone=ZoneType.BENCH,
                    )
                ],
                deadCardCondition="BENCH_IS_EMPTY",
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
        abilities_fr = [a for a in (raw_fr.get("abilities") or []) if isinstance(a, dict)]
        abilities_en = [a for a in ((raw_en or {}).get("abilities") or []) if isinstance(a, dict)]
        attacks_fr = [a for a in (raw_fr.get("attacks") or []) if isinstance(a, dict)]
        attacks_en = [a for a in ((raw_en or {}).get("attacks") or []) if isinstance(a, dict)]

        combined_trainer_low = f"{eff_fr} {eff_en or ''}".lower()
        is_fossil_trainer = (
            "jouez cette carte comme si c'était un pokémon" in combined_trainer_low
            or "play this card as if it were a" in combined_trainer_low
        )

        if identity.isTechnicalMachine and attacks_fr:
            # Capsule Technique / Outil à attaque : l'action trainer_0 gère l'attachement pur (effects=[]),
            # et les attaques conférées sont compilées avec leur coût en énergie dans attack_0...
            playable_actions.append(
                PlayableAction(
                    actionId="trainer_0",
                    label=identity.nameFr,
                    actionType=ActionType.PLAY_FROM_HAND,
                    timingPhase=TimingPhase.MAIN_PHASE_1,
                    canUseTurn1GoingFirst=True,
                    canUseTurn1GoingSecond=True,
                    cost={},
                    preconditions=[],
                    effects=[],
                    deadCardCondition="NO_POKEMON_WITHOUT_TOOL",
                )
            )
            _append_attack_actions_and_slots(
                attacks_fr,
                attacks_en,
                False,
                playable_actions,
                slots_for_llm,
                base_synergies,
            )
            if abilities_fr:
                _append_ability_actions_and_slots(
                    abilities_fr,
                    abilities_en,
                    True,
                    playable_actions,
                    slots_for_llm,
                )
        else:
            if not eff_fr and attacks_fr:
                a0 = attacks_fr[0]
                eff_fr = _normalize_whitespace(f"{a0.get('name', '')}: {a0.get('effect', '')}")
            if not eff_en and attacks_en:
                a0_en = attacks_en[0]
                eff_en = _normalize_whitespace(f"{a0_en.get('name', '')}: {a0_en.get('effect', '')}")

            forbids_t1 = _forbids_turn1_both(eff_fr, eff_en, identity.nameFr)
            can_t1_first = (sub_category != CardSubCategory.SUPPORTER) and not forbids_t1
            can_t1_second = not forbids_t1

            default_preconditions: List[str] = []
            default_dead_cond: Optional[str] = None
            if sub_category == CardSubCategory.STADIUM:
                default_dead_cond = "STADIUM_ALREADY_IN_PLAY_SAME_NAME"
            elif sub_category == CardSubCategory.TOOL:
                default_dead_cond = "NO_POKEMON_WITHOUT_TOOL"
            elif is_fossil_trainer:
                default_preconditions = ["BENCH_HAS_EMPTY_SLOT"]
                default_dead_cond = "BENCH_FULL"

            playable_actions.append(
                PlayableAction(
                    actionId="trainer_0",
                    label=identity.nameFr,
                    actionType=ActionType.PLAY_FROM_HAND,
                    timingPhase=TimingPhase.MAIN_PHASE_1,
                    canUseTurn1GoingFirst=can_t1_first,
                    canUseTurn1GoingSecond=can_t1_second,
                    cost={},
                    preconditions=default_preconditions,
                    effects=[],
                    deadCardCondition=default_dead_cond,
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
            if abilities_fr:
                _append_ability_actions_and_slots(
                    abilities_fr,
                    abilities_en,
                    True,
                    playable_actions,
                    slots_for_llm,
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
                    target=EffectTarget.OWN_POKEMON_ANY,
                    count=1,
                    sourceZone=ZoneType.HAND,
                    destinationZone=ZoneType.ATTACHED_CARDS,
                    zone=ZoneType.HAND,
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


# ============================================================================
# EXTRACTIONS DÉTERMINISTES DES MÉCANIQUES TEXTUELLES FR / EN
# ============================================================================


def _extract_special_conditions(lower: str) -> List[SpecialCondition]:
    """Détecte uniquement les États Spéciaux effectivement APPLIQUÉS par le texte (pas ceux testés en 'si')."""
    clauses = re.split(r"[.;!?]+", lower)
    applied: List[SpecialCondition] = []

    cond_patterns = [
        (SpecialCondition.POISONED, ("empoisonn", "poisoned")),
        (SpecialCondition.BURNED, ("brûl", "burned")),
        (SpecialCondition.ASLEEP, ("endormi", "asleep")),
        (SpecialCondition.PARALYZED, ("paralys", "paralyzed")),
        (SpecialCondition.CONFUSED, ("confus", "confused")),
    ]

    for clause in clauses:
        cl = clause.strip()
        if not cl:
            continue
        # Ignorer les propositions conditionnelles pures du type "Si le Pokémon Actif est Brûlé..."
        is_test_clause = cl.startswith(("si ", "if ")) and not any(
            marker in cl for marker in ("si c'est face", "if heads", "si c'est pile", "if tails", "si vous obtenez")
        )
        if is_test_clause:
            # Ne vérifier que la conséquence après la virgule si présente
            if "," in cl:
                cl = cl.split(",", 1)[1].strip()
            else:
                continue

        # Vérifier les phrases d'application directe
        has_apply_marker = any(
            m in cl
            for m in (
                "est maintenant",
                "est désormais",
                "sont maintenant",
                "is now",
                "are now",
                "rendre ",
                "rend ",
                "make ",
                "makes ",
                "leaves that pokémon",
                "leaves your opponent's active pokémon",
                "si c'est face",
                "if heads",
            )
        )
        if not has_apply_marker:
            continue

        for cond_enum, kws in cond_patterns:
            if any(kw in cl for kw in kws) and cond_enum not in applied:
                applied.append(cond_enum)

    return applied


def _extract_coin_flip(
    lower: str,
    base_dmg: Optional[int] = None,
) -> Tuple[Optional[CoinFlipMode], Optional[int], Optional[int], bool]:
    """Retourne `(coinFlipMode, coinCount, bonusDamageOnHeads, affectsPrimaryDamage)`."""
    if not any(w in lower for w in ("pièce", "coin", "côté face", "côté pile", "heads", "tails")):
        return None, None, None, False

    if (
        re.search(r"lancez 2 pièces.*2 côtés pile|flip 2 coins.*both.*tails", lower)
        or ("2 côtés pile" in lower and "s'inflige" in lower)
    ):
        return CoinFlipMode.TWO_TAILS_SELF_DAMAGE, 2, None, False

    if "jusqu'à obtenir un côté pile" in lower or "jusqu'à obtenir côté pile" in lower or "until you get tails" in lower:
        return CoinFlipMode.UNTIL_TAILS_PER_HEADS, None, None, True

    if "lancez autant de pièces" in lower or "flip a coin for each" in lower:
        is_dmg = any(k in lower for k in ("inflige", "dégâts", "damage", "marqueur"))
        return CoinFlipMode.MULTI_COIN_PER_HEADS, None, None, is_dmg

    m_multi = re.search(r"lancez\s+(\d+)\s+pièces?|flip\s+(\d+)\s+coins?", lower)
    if m_multi:
        cnt = int(m_multi.group(1) or m_multi.group(2))
        if "pour chaque côté face" in lower or "for each heads" in lower:
            is_dmg = any(k in lower for k in ("inflige", "dégâts", "damage", "marqueur"))
            return CoinFlipMode.MULTI_COIN_PER_HEADS, cnt, None, is_dmg
        return CoinFlipMode.SINGLE_HEADS_REQUIRED, cnt, None, ("ne fait rien" in lower or "does nothing" in lower)

    m_bonus = re.search(
        r"(?:si c'est face|if heads)[^.]*?inflige\s+(\d+)\s+dégâts\s+supplémentaires|(?:if heads)[^.]*?does\s+(\d+)\s+more\s+damage",
        lower,
    )
    if m_bonus:
        bonus = int(m_bonus.group(1) or m_bonus.group(2))
        return CoinFlipMode.SINGLE_HEADS_BONUS, 1, bonus, True

    if "ne fait rien" in lower or "does nothing" in lower:
        return CoinFlipMode.SINGLE_HEADS_REQUIRED, 1, None, True

    # Si l'attaque inflige déjà des dégâts de base garantis et que le lancer de pièce déclenche un effet secondaire ("Si c'est face, ...")
    if base_dmg is not None and base_dmg > 0:
        return CoinFlipMode.SINGLE_HEADS_BONUS, 1, None, False

    return CoinFlipMode.SINGLE_HEADS_REQUIRED, 1, None, False


def _extract_damage_scaling(
    lower: str,
    printed_dmg_str: Optional[str],
    base_dmg: Optional[int],
) -> Tuple[Optional[ScalingOperator], Optional[ScalingMetric], Optional[int]]:
    """Extrait `(scalingOperator, scalingMetric, bonusValue)` depuis le texte et le champ `damage` brut."""
    dmg_s = (printed_dmg_str or "").strip()
    is_add = "+" in dmg_s or "dégâts supplémentaires" in lower or "more damage" in lower or "en plus" in lower
    is_mult = (
        "×" in dmg_s
        or dmg_s.lower().endswith("x")
        or (
            not is_add
            and bool(re.search(r"(?:inflige|does)\s+\d+\s+(?:dégâts|damage)[^.]*?(?:pour chaque|for each)", lower))
        )
    )
    if not is_add and not is_mult:
        if "pour chaque marqueur de dégâts" in lower and "placez" in lower:
            is_mult = True
        else:
            return None, None, None

    op = ScalingOperator.ADD if is_add else ScalingOperator.MULTIPLY
    bonus_val: Optional[int] = None

    if op == ScalingOperator.ADD:
        m_b = re.search(r"(\d+)\s+dégâts\s+supplémentaires|(\d+)\s+more\s+damage", lower)
        if m_b:
            bonus_val = int(m_b.group(1) or m_b.group(2))
    else:
        if base_dmg is not None and base_dmg > 0:
            bonus_val = base_dmg
        else:
            m_m = re.search(r"(\d+)\s+(?:dégâts|damage)", lower)
            if m_m:
                bonus_val = int(m_m.group(1))
            else:
                m_cnt = re.search(r"placez\s+(\d+)\s+marqueur|put\s+(\d+)\s+damage\s+counter", lower)
                if m_cnt:
                    bonus_val = int(m_cnt.group(1) or m_cnt.group(2)) * 10

    # Identifier la métrique
    metric: Optional[ScalingMetric] = None
    if "côté face" in lower or "for each heads" in lower:
        # Géré par coinFlipMode
        return op, None, bonus_val

    if "marqueur" in lower or "damage counter" in lower:
        if "pokémon de banc" in lower and "marqueur" in lower and "pour chacun" in lower:
            metric = ScalingMetric.PER_BENCHED_POKEMON_WITH_DAMAGE
        elif "adversaire" in lower or "pokémon-là" in lower or "défenseur" in lower or "opponent" in lower:
            metric = ScalingMetric.PER_DAMAGE_COUNTER_ON_OPPONENT_ACTIVE
        else:
            metric = ScalingMetric.PER_DAMAGE_COUNTER_ON_SELF
    elif "récompense" in lower or "prize" in lower:
        if "adversaire a récupérée" in lower or "opponent has taken" in lower:
            metric = ScalingMetric.PER_PRIZE_TAKEN_BY_OPPONENT
        elif "restant" in lower or "remaining" in lower:
            metric = ScalingMetric.PER_PRIZE_REMAINING_PLAYER
        elif "récupérée" in lower or "taken" in lower:
            metric = ScalingMetric.PER_PRIZE_TAKEN_BY_PLAYER
    elif "énergie" in lower or "energy" in lower:
        if "deux pokémon actifs" in lower or "both active" in lower:
            metric = ScalingMetric.PER_ENERGY_ON_BOTH_ACTIVES
        elif "défauss" in lower or "discard" in lower:
            metric = ScalingMetric.PER_ENERGY_DISCARDED
        elif "pokémon actif de votre adversaire" in lower or "opponent's active" in lower or "pokémon défenseur" in lower:
            metric = ScalingMetric.PER_ENERGY_ON_OPPONENT_ACTIVE
        elif "tous vos pokémon" in lower or "en jeu" in lower or "all of your" in lower or "in play" in lower:
            metric = ScalingMetric.PER_ENERGY_IN_PLAY
        elif "attachée" in lower or "attached" in lower:
            metric = ScalingMetric.PER_ENERGY_ON_SELF
    elif "carte" in lower and ("dans votre main" in lower or "in your hand" in lower):
        metric = ScalingMetric.PER_CARD_IN_OWN_HAND
    elif "carte" in lower and ("main de votre adversaire" in lower or "opponent's hand" in lower):
        metric = ScalingMetric.PER_CARD_IN_OPPONENT_HAND
    elif "pokémon de banc" in lower or "benched pokémon" in lower:
        if "les vôtres et ceux de votre adversaire" in lower or "both players" in lower:
            metric = ScalingMetric.PER_BOTH_BENCH_POKEMON
        elif "adversaire" in lower or "opponent" in lower:
            metric = ScalingMetric.PER_OPPONENT_BENCH_POKEMON
        else:
            metric = ScalingMetric.PER_OWN_BENCH_POKEMON
    elif "pour chacun de vos pokémon en jeu" in lower or "for each of your pokémon in play" in lower:
        metric = ScalingMetric.PER_OWN_BENCH_POKEMON

    if metric is None and op == ScalingOperator.ADD and bonus_val is not None:
        if "si " in lower or "if " in lower:
            metric = ScalingMetric.CONDITIONAL_FLAT_BONUS

    if metric is None and bonus_val is None:
        return None, None, None

    return op, metric, bonus_val


def _extract_recoil_damage(lower: str) -> Optional[int]:
    """Détecte les dégâts auto-infligés ('Ce Pokémon [peut] s'inflige[r] aussi X dégâts')."""
    m = re.search(
        r"ce pokémon (?:peut )?s'inflige[r]?(?:\s+aussi)?\s+(\d+)\s+dégâts|this pokémon (?:may )?(?:also )?does?\s+(\d+)\s+damage to itself",
        lower,
    )
    if m:
        return int(m.group(1) or m.group(2))
    return None


def _extract_snipe_or_spread(lower: str, base_dmg: Optional[int]) -> Tuple[bool, Optional[EffectTarget], Optional[int]]:
    """Détecte si une attaque inflige des dégâts sur le Banc ou à tous les Pokémon adverses.

    Retourne `(replaces_active_damage, bench_target, bench_damage_value)`.
    """
    m_bench_all = re.search(
        r"(\d+)\s+dégâts\s+à\s+chacun\s+des\s+pokémon\s+de\s+banc\s+de\s+votre\s+adversaire|(\d+)\s+damage\s+to\s+each\s+of\s+your\s+opponent's\s+benched",
        lower,
    )
    if m_bench_all:
        val = int(m_bench_all.group(1) or m_bench_all.group(2))
        replaces = base_dmg is None or base_dmg == 0
        return replaces, EffectTarget.OPPONENT_BENCH_ALL, val

    m_bench_one = re.search(
        r"(\d+)\s+dégâts\s+à\s+l'un\s+des\s+pokémon\s+de\s+banc\s+de\s+votre\s+adversaire|(\d+)\s+damage\s+to\s+1\s+of\s+your\s+opponent's\s+benched",
        lower,
    )
    if m_bench_one:
        val = int(m_bench_one.group(1) or m_bench_one.group(2))
        replaces = base_dmg is None or base_dmg == 0
        return replaces, EffectTarget.OPPONENT_BENCH_SINGLE, val

    m_opp_all = re.search(
        r"(\d+)\s+dégâts\s+à\s+chacun\s+des\s+pokémon\s+de\s+votre\s+adversaire|(\d+)\s+damage\s+to\s+each\s+of\s+your\s+opponent's\s+pokémon",
        lower,
    )
    if m_opp_all:
        val = int(m_opp_all.group(1) or m_opp_all.group(2))
        replaces = base_dmg is None or base_dmg == 0
        return replaces, EffectTarget.OPPONENT_ALL_POKEMON, val

    m_opp_any = re.search(
        r"(\d+)\s+dégâts\s+à\s+l'un\s+des\s+pokémon\s+de\s+votre\s+adversaire|(\d+)\s+damage\s+to\s+1\s+of\s+your\s+opponent's\s+pokémon",
        lower,
    )
    if m_opp_any:
        val = int(m_opp_any.group(1) or m_opp_any.group(2))
        replaces = base_dmg is None or base_dmg == 0
        return replaces, EffectTarget.OPPONENT_POKEMON_ANY, val

    if (
        "chacun des pokémon de votre adversaire" in lower
        or "each of your opponent's pokémon" in lower
    ) and ("dégâts" in lower or "damage" in lower or "marqueur" in lower):
        return (base_dmg is None or base_dmg == 0), EffectTarget.OPPONENT_ALL_POKEMON, base_dmg

    if (
        "à l'un des pokémon de votre adversaire" in lower
        or "to 1 of your opponent's pokémon" in lower
    ) and ("dégâts" in lower or "damage" in lower):
        return (base_dmg is None or base_dmg == 0), EffectTarget.OPPONENT_POKEMON_ANY, base_dmg

    return False, None, None


def _extract_shuffle_hand_draw(lower: str) -> Tuple[bool, Optional[int], Optional[ScalingMetric]]:
    """Identifie de vrais effets `SHUFFLE_HAND_DRAW` (sans confusion avec une simple recherche dans le deck) et leur compte exact."""
    has_hand_shuffle_or_bottom = (
        "mélangez votre main" in lower
        or "mélange sa main" in lower
        or "mélangez leur main" in lower
        or "mélangez vos mains" in lower
        or "chaque joueur mélange sa main" in lower
        or "shuffle your hand" in lower
        or "each player shuffles their hand" in lower
        or "shuffles their hand" in lower
    )
    has_draw = "pioche" in lower or "draw" in lower
    if not (has_hand_shuffle_or_bottom and has_draw):
        return False, None, None

    if "chacune de ses cartes récompense restantes" in lower or "each of their remaining prize" in lower:
        return True, None, ScalingMetric.PER_PRIZE_REMAINING_PLAYER

    m_cnt = re.search(r"(?:piochez|pioche|draw|draws)\s+(\d+)\s+(?:cartes?|cards?)", lower)
    if m_cnt:
        return True, int(m_cnt.group(1)), None
    if "piochez une carte" in lower or "draw a card" in lower:
        return True, 1, None
    return True, None, None


def _extract_energy_type_filter(text: str) -> Optional[str]:
    """Extrait un filtre de type d'énergie normalisé s'il est mentionné ({G}, {R}, Plante, Feu, etc.)."""
    symbol_map = {
        "{g}": "Plante",
        "{r}": "Feu",
        "{w}": "Eau",
        "{l}": "Électrique",
        "{p}": "Psy",
        "{f}": "Combat",
        "{d}": "Obscurité",
        "{m}": "Métal",
        "{plante}": "Plante",
        "{feu}": "Feu",
        "{eau}": "Eau",
        "{électrique}": "Électrique",
        "{psy}": "Psy",
        "{combat}": "Combat",
        "{obscurité}": "Obscurité",
        "{métal}": "Métal",
        "{grass}": "Plante",
        "{fire}": "Feu",
        "{water}": "Eau",
        "{lightning}": "Électrique",
        "{psychic}": "Psy",
        "{fighting}": "Combat",
        "{darkness}": "Obscurité",
        "{metal}": "Métal",
    }
    low = text.lower()
    for sym, cname in symbol_map.items():
        if sym in low:
            return cname
    return None


def translate_slot_deterministically(
    slot: EffectSlotToCompile,
    skeleton: DeterministicCardSkeleton,
) -> Tuple[List[str], List[AtomicEffect], Optional[str], List[str]]:
    """Analyse déterministe complète d'un `EffectSlotToCompile` en `(preconditions, effects, deadCardCondition, synergy_tags)`."""
    combined = f"{_normalize_whitespace(slot.textFr)} {_normalize_whitespace(slot.textEn)}".strip()
    lower = combined.lower()
    preconditions: List[str] = []
    effects: List[AtomicEffect] = []
    dead_cond: Optional[str] = None
    synergy_tags: List[str] = []

    # 1. Préconditions textuelles explicites
    if (
        "si ce pokémon est sur le poste actif" in lower
        or "if this pokémon is in the active spot" in lower
        or "tant que ce pokémon est sur le poste actif" in lower
        or "as long as this pokémon is in the active spot" in lower
        or slot.actionType == ActionType.ATTACK
    ):
        preconditions.append("SELF_IS_ACTIVE")

    if "si ce pokémon est sur votre banc" in lower or "if this pokémon is on your bench" in lower or "tant que ce pokémon est sur votre banc" in lower:
        preconditions.append("SELF_ON_BENCH")

    if "lorsque vous jouez ce pokémon de votre main pour faire évoluer" in lower or "when you play this pokémon from your hand to evolve" in lower:
        preconditions.append("ON_EVOLVE_FROM_HAND")

    if "lorsque vous jouez ce pokémon de votre main sur votre banc" in lower or "when you play this pokémon from your hand onto your bench" in lower:
        preconditions.append("ON_PLAY_FROM_HAND_TO_BENCH")

    if "mis k.o. pendant le dernier tour de votre adversaire" in lower or "knocked out during your opponent's last turn" in lower:
        preconditions.append("KO_SUFFERED_LAST_TURN")
        dead_cond = "NO_KO_SUFFERED_LAST_TURN"

    if "plus de cartes récompense restantes que votre adversaire" in lower or "more prize cards remaining than your opponent" in lower:
        preconditions.append("PLAYER_BEHIND_ON_PRIZES")
        dead_cond = "NOT_BEHIND_ON_PRIZES"

    if (
        "il reste exactement une carte récompense à votre adversaire" in lower
        or "il reste exactement 1 carte récompense à votre adversaire" in lower
        or "opponent has exactly 1 prize card remaining" in lower
    ):
        preconditions.append("OPPONENT_PRIZES_EXACT_COUNT")
        dead_cond = dead_cond or "OPPONENT_PRIZES_NOT_1"

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
                target=EffectTarget.PLAYER,
                count=cnt,
                sourceZone=ZoneType.HAND,
                destinationZone=ZoneType.DISCARD,
                zone=ZoneType.HAND,
            )
        )
        dead_cond = f"HAND_FEWER_THAN_{cnt}_OTHER_CARDS"
        synergy_tags.append("requires_discard_synergy")

    # Coût de défausse de main complète (Recherches Professorales)
    if "défaussez votre main et piochez" in lower or "discard your hand and draw" in lower:
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.DISCARD_CARDS,
                target=EffectTarget.PLAYER,
                sourceZone=ZoneType.HAND,
                destinationZone=ZoneType.DISCARD,
                zone=ZoneType.HAND,
            )
        )

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
                target=EffectTarget.OWN_POKEMON_ANY,
                count=1,
                sourceZone=ZoneType.HAND,
                destinationZone=ZoneType.BENCH,
                zone=ZoneType.HAND,
                filter="CATEGORY:POKEMON|STAGE:STAGE_2",
            )
        )
        dead_cond = "NO_STAGE_2_IN_HAND_OR_NO_BASIC_IN_PLAY"
        synergy_tags.append("requires_stage_2_pokemon")

    # Recherche + évolution (ex: Ascension / Évolution Précoce)
    elif "cherchez dans votre deck une carte évolution" in lower or "search your deck for a card that evolves" in lower:
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.SEARCH_DECK,
                target=EffectTarget.SELF,
                count=1,
                sourceZone=ZoneType.DECK,
                destinationZone=ZoneType.ACTIVE,
                filter="CATEGORY:POKEMON|EVOLUTION_FOR_SELF",
            )
        )
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.EVOLVE_POKEMON,
                target=EffectTarget.SELF,
                count=1,
                sourceZone=ZoneType.DECK,
            )
        )
        dead_cond = dead_cond or "NO_VALID_TARGET_IN_DECK"

    # Poffin Copain-Copain / Faiblo Ball (Recherche de Pokémon de Base vers le Banc)
    elif ("cherchez dans votre deck" in lower or "search your deck" in lower) and (
        "sur votre banc" in lower or "onto your bench" in lower
    ):
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
                target=EffectTarget.OWN_BENCH_SINGLE,
                count=cnt,
                sourceZone=ZoneType.DECK,
                destinationZone=ZoneType.BENCH,
                zone=ZoneType.DECK,
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
        e_type = _extract_energy_type_filter(combined)
        filt = f"CATEGORY:ENERGY|SUBCATEGORY:BASIC_ENERGY|TYPE:{e_type}" if e_type else "CATEGORY:ENERGY|SUBCATEGORY:BASIC_ENERGY"
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.ATTACH_ENERGY,
                target=EffectTarget.SELF if "à ce pokémon" in lower else EffectTarget.OWN_POKEMON_ANY,
                count=cnt,
                sourceZone=ZoneType.DECK,
                destinationZone=ZoneType.ATTACHED_CARDS,
                zone=ZoneType.DECK,
                filter=filt,
                upTo=bool(m_cnt),
                optional=("vous pouvez" in lower or "you may" in lower),
            )
        )
        dead_cond = dead_cond or "NO_VALID_TARGET_IN_DECK"

    # Recherche dans le deck vers la main (Hyper Ball, Pepper, Recherche Rapide, etc.)
    elif "cherchez dans votre deck" in lower or "search your deck" in lower:
        if "un objet et une carte outil" in lower or ("item card" in lower and "tool card" in lower):
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.SEARCH_DECK,
                    target=EffectTarget.PLAYER,
                    count=1,
                    sourceZone=ZoneType.DECK,
                    destinationZone=ZoneType.HAND,
                    filter="CATEGORY:TRAINER|SUBCATEGORY:ITEM",
                    upTo=True,
                )
            )
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.SEARCH_DECK,
                    target=EffectTarget.PLAYER,
                    count=1,
                    sourceZone=ZoneType.DECK,
                    destinationZone=ZoneType.HAND,
                    filter="CATEGORY:TRAINER|SUBCATEGORY:TOOL",
                    upTo=True,
                )
            )
            synergy_tags.append("requires_pokemon_tool")
        else:
            m_cnt = re.search(r"(?:jusqu'à|up to)\s+(\d+)", lower)
            cnt = int(m_cnt.group(1)) if m_cnt else 1
            if "carte supporter" in lower or "supporter card" in lower:
                filt = "CATEGORY:TRAINER|SUBCATEGORY:SUPPORTER"
            elif "carte stade" in lower or "stadium card" in lower:
                filt = "CATEGORY:TRAINER|SUBCATEGORY:STADIUM"
            elif "carte énergie" in lower or "energy card" in lower:
                e_type = _extract_energy_type_filter(combined)
                filt = f"CATEGORY:ENERGY|TYPE:{e_type}" if e_type else "CATEGORY:ENERGY"
            elif "un pokémon" in lower or "a pokémon" in lower or "pokémon" in lower:
                filt = "CATEGORY:POKEMON"
            else:
                filt = "ANY"
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.SEARCH_DECK,
                    target=EffectTarget.PLAYER,
                    count=cnt,
                    sourceZone=ZoneType.DECK,
                    destinationZone=ZoneType.HAND,
                    zone=ZoneType.DECK,
                    filter=filt,
                    upTo=bool(m_cnt),
                )
            )
        dead_cond = dead_cond or "NO_VALID_TARGET_IN_DECK"

    # Mélange / remise de la main et pioche (ex: Mashynn / Iono, Juge, Lilie)
    is_shuf_draw, shuf_cnt, shuf_metric = _extract_shuffle_hand_draw(lower)
    if is_shuf_draw:
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.SHUFFLE_HAND_DRAW,
                target=EffectTarget.PLAYER if "adversaire" not in lower else EffectTarget.ALL_POKEMON_IN_PLAY,
                count=shuf_cnt,
                sourceZone=ZoneType.DECK,
                destinationZone=ZoneType.HAND,
                scalingMetric=shuf_metric,
            )
        )
    else:
        # Pioche directe (sans "jusqu'à en avoir X" ou avec exact N)
        m_draw_until = re.search(r"piochez des cartes jusqu'à en avoir\s+(\d+)|draw cards until you have\s+(\d+)", lower)
        m_draw = re.search(r"(?:piochez|draw)\s+(\d+)\s+(?:cartes?|cards?)", lower)
        if m_draw_until:
            cnt_u = int(m_draw_until.group(1) or m_draw_until.group(2))
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.DRAW_CARDS,
                    target=EffectTarget.PLAYER,
                    count=cnt_u,
                    sourceZone=ZoneType.DECK,
                    destinationZone=ZoneType.HAND,
                    upTo=True,
                    optional=("vous pouvez" in lower or "you may" in lower),
                )
            )
        elif m_draw:
            draw_cnt = int(m_draw.group(1))
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.DRAW_CARDS,
                    target=EffectTarget.PLAYER,
                    count=draw_cnt,
                    sourceZone=ZoneType.DECK,
                    destinationZone=ZoneType.HAND,
                    optional=("vous pouvez" in lower or "you may" in lower),
                )
            )
        elif "piochez une carte" in lower or "draw a card" in lower:
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.DRAW_CARDS,
                    target=EffectTarget.PLAYER,
                    count=1,
                    sourceZone=ZoneType.DECK,
                    destinationZone=ZoneType.HAND,
                    optional=("vous pouvez" in lower or "you may" in lower),
                )
            )

    # Attachement d'énergie depuis la main / défausse (ex: Ogerpon Danse Turquoise, Serveuse)
    if (
        ("attachez" in lower or "attach" in lower)
        and ("énergie" in lower or "energy" in lower)
        and "cherchez dans votre deck" not in lower
        and "search your deck" not in lower
    ):
        e_type = _extract_energy_type_filter(combined)
        src_z = (
            ZoneType.DISCARD
            if ("pile de défausse" in lower or "discard pile" in lower)
            else (ZoneType.TOP_OF_DECK if "dessus de votre deck" in lower or "top 6 cards" in lower else ZoneType.HAND)
        )
        m_ecnt = re.search(r"attache[zr]\s+(?:jusqu'à\s+)?(\d+)\s+(?:cartes?\s+)?énergie", lower)
        ecnt = int(m_ecnt.group(1)) if m_ecnt else 1
        tgt_e = EffectTarget.SELF if ("à ce pokémon" in lower or "to this pokémon" in lower) else EffectTarget.OWN_POKEMON_ANY
        filt = f"CATEGORY:ENERGY|SUBCATEGORY:BASIC_ENERGY|TYPE:{e_type}" if e_type else "CATEGORY:ENERGY|SUBCATEGORY:BASIC_ENERGY"
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.ATTACH_ENERGY,
                target=tgt_e,
                count=ecnt,
                sourceZone=src_z,
                destinationZone=ZoneType.ATTACHED_CARDS,
                filter=filt,
                optional=("vous pouvez" in lower or "you may" in lower),
            )
        )

    # Déplacement d'énergies (ex: Vert-de-Fer-ex Vernier Rapide)
    if ("déplacez" in lower or "move" in lower) and ("énergie" in lower or "energy" in lower):
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.MOVE_ENERGY,
                target=EffectTarget.SELF if "vers ce pokémon" in lower or "to this pokémon" in lower else EffectTarget.OWN_POKEMON_ANY,
                sourceZone=ZoneType.ATTACHED_CARDS,
                destinationZone=ZoneType.ATTACHED_CARDS,
                optional=("vous pouvez" in lower or "you may" in lower),
            )
        )

    # Regard / placement sur le dessus ou dessous du deck (ex: Serveuse, Académie de Nuit, Note d'Ingérence, Dispareptil)
    if (
        "cartes du dessus de votre deck" in lower
        or ("top" in lower and "cards of your deck" in lower)
        or "sur le dessus de votre deck" in lower
        or "on top of your deck" in lower
        or "en dessous de votre deck" in lower
        or "dessous de son deck" in lower
        or "bottom of their deck" in lower
    ):
        m_top = re.search(r"(\d+)\s+cartes? du dessus|top\s+(\d+)\s+cards?", lower)
        top_cnt = int(m_top.group(1) or m_top.group(2)) if m_top else (None if "main" in lower or "hand" in lower else 1)
        src_z = ZoneType.HAND if ("de sa main" in lower or "dans sa main" in lower or "from their hand" in lower or "their hand" in lower) else ZoneType.TOP_OF_DECK
        dst_z = ZoneType.BOTTOM_OF_DECK if "dessous" in lower or "bottom" in lower else ZoneType.TOP_OF_DECK
        tgt_top = EffectTarget.OPPONENT if "adversaire" in lower or "opponent" in lower else EffectTarget.PLAYER
        if not any(e.primitive == EffectPrimitive.SEARCH_DECK for e in effects):
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.PUT_ON_TOP_OR_BOTTOM_OF_DECK,
                    target=tgt_top,
                    count=top_cnt,
                    sourceZone=src_z,
                    destinationZone=dst_z,
                )
            )

    # Récupération depuis la pile de défausse
    if ("pile de défausse" in lower or "discard pile" in lower) and any(
        w in lower for w in ("ajoutez", "mélangez", "placez", "récupérez", "put", "shuffle", "into your hand")
    ) and "marqueur" not in lower:
        dst_z = (
            ZoneType.DECK
            if "avec votre deck" in lower or "into your deck" in lower
            else (ZoneType.BENCH if "sur votre banc" in lower else ZoneType.HAND)
        )
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.RECOVER_FROM_DISCARD,
                target=EffectTarget.PLAYER,
                sourceZone=ZoneType.DISCARD,
                destinationZone=dst_z,
            )
        )
        synergy_tags.append("requires_discard_synergy")

    # Changement du Pokémon Actif (Gust adverse ou Switch allié)
    if (
        ("pokémon de banc de votre adversaire" in lower and ("poste actif" in lower or "pokémon actif" in lower))
        or ("opponent's benched pokémon" in lower and ("active spot" in lower or "active pokémon" in lower))
    ):
        preconditions.append("OPPONENT_HAS_BENCHED_POKEMON")
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.SWITCH_ACTIVE,
                target=EffectTarget.OPPONENT_ACTIVE,
                count=1,
                sourceZone=ZoneType.BENCH,
                destinationZone=ZoneType.ACTIVE,
            )
        )
        dead_cond = dead_cond or "OPPONENT_BENCH_EMPTY"
    elif (
        "échangez votre pokémon actif" in lower
        or "échangez ce pokémon contre l'un de vos pokémon de banc" in lower
        or "vous pouvez l'échanger contre votre pokémon actif" in lower
        or "switch your active pokémon" in lower
        or "switch this pokémon with 1 of your benched" in lower
    ):
        preconditions.append("BENCH_HAS_POKEMON")
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.SWITCH_ACTIVE,
                target=EffectTarget.SELF if "ce pokémon" in lower or "this pokémon" in lower else EffectTarget.OWN_ACTIVE,
                count=1,
                sourceZone=ZoneType.BENCH,
                destinationZone=ZoneType.ACTIVE,
                optional=("vous pouvez" in lower or "you may" in lower),
            )
        )
        dead_cond = dead_cond or "BENCH_IS_EMPTY"

    # Marqueurs de dégâts : MOVE vs PLACE
    if "marqueur" in lower or "damage counter" in lower:
        if "déplacez" in lower or "move" in lower:
            m_mc = re.search(r"(\d+)\s+marqueur|(\d+)\s+damage counter", lower)
            mc_cnt = int(m_mc.group(1) or m_mc.group(2)) if m_mc else None
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.MOVE_DAMAGE_COUNTERS,
                    target=EffectTarget.OPPONENT_POKEMON_ANY if "adversaire" in lower else EffectTarget.OWN_POKEMON_ANY,
                    count=mc_cnt,
                    upTo="jusqu'à" in lower or "up to" in lower,
                    optional=("vous pouvez" in lower or "you may" in lower),
                )
            )
        elif "placez" in lower or "put" in lower:
            m_pc = re.search(r"placez\s+(\d+)\s+marqueur|put\s+(\d+)\s+damage counter", lower)
            pc_cnt = int(m_pc.group(1) or m_pc.group(2)) if m_pc else (1 if ("un marqueur" in lower or "1 damage counter" in lower) else None)
            if "chacun des pokémon de votre adversaire" in lower or "each of your opponent's pokémon" in lower:
                pc_tgt = EffectTarget.OPPONENT_ALL_POKEMON
            elif (
                "chacun des pokémon de banc de votre adversaire" in lower
                or "les pokémon de banc de votre adversaire" in lower
                or "each of your opponent's benched" in lower
                or "your opponent's benched pokémon in any way you like" in lower
                or "on your opponent's benched pokémon as you like" in lower
            ):
                pc_tgt = EffectTarget.OPPONENT_BENCH_ALL
            elif "l'un des pokémon de banc de votre adversaire" in lower or "1 of your opponent's benched pokémon" in lower:
                pc_tgt = EffectTarget.OPPONENT_BENCH_SINGLE
            elif "l'un des pokémon de votre adversaire" in lower or "1 of your opponent's pokémon" in lower:
                pc_tgt = EffectTarget.OPPONENT_POKEMON_ANY
            elif "sur ce pokémon" in lower or "on this pokémon" in lower:
                pc_tgt = EffectTarget.SELF
            elif "chacun des pokémon ayant un talent" in lower or "each pokémon in play" in lower:
                pc_tgt = EffectTarget.ALL_POKEMON_IN_PLAY
            else:
                pc_tgt = EffectTarget.OPPONENT_ACTIVE
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.PLACE_DAMAGE_COUNTERS,
                    target=pc_tgt,
                    count=pc_cnt,
                    value=(pc_cnt * 10) if pc_cnt is not None else None,
                    optional=("vous pouvez" in lower or "you may" in lower),
                )
            )

    # K.O. directs (auto-K.O. Noctunoir / K.O. conditionnel — exclure les déclencheurs et parenthèses "(même s'il est mis K.O.)")
    ko_clean = re.sub(
        r"(?:même\s+s(?:'|’)?il|même\s+si\s+ce\s+pokémon|si\s+ce\s+pokémon|s(?:'|’)?il|even\s+if\s+(?:it|this\s+pokémon)|if\s+this\s+pokémon)\s+(?:est\s+mis\s+k\.o\.|is\s+knocked\s+out)"
        r"|[^.]*?(?:est\s+mis\s+k\.o\.|is\s+knocked\s+out)\s+(?:par\s+les\s+dégâts|by\s+damage)[^.]*"
        r"|[^.]*?(?:doit\s+être\s+mis\s+k\.o\.|would\s+be\s+knocked\s+out)[^.]*",
        "",
        lower,
    )
    if (
        "ce pokémon est mis k.o." in ko_clean
        or "this pokémon is knocked out" in ko_clean
    ):
        effects.append(AtomicEffect(primitive=EffectPrimitive.KNOCK_OUT, target=EffectTarget.SELF))
    elif (
        re.search(r"(?<![sS]['’])\bil est mis k\.o\.", ko_clean)
        or "mettez k.o." in ko_clean
        or "sera mis k.o." in ko_clean
        or "le pokémon actif de votre adversaire est mis k.o." in ko_clean
        or ("knock out " in ko_clean and "if " not in ko_clean)
        or "your opponent's active pokémon is knocked out" in ko_clean
    ):
        tgt_ko = EffectTarget.OPPONENT_ALL_POKEMON if "chacun des pokémon" in ko_clean or "each of your opponent's" in ko_clean else EffectTarget.OPPONENT_ACTIVE
        effects.append(AtomicEffect(primitive=EffectPrimitive.KNOCK_OUT, target=tgt_ko))

    # États Spéciaux
    for sc in _extract_special_conditions(lower):
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.APPLY_SPECIAL_CONDITION,
                target=EffectTarget.OPPONENT_ACTIVE,
                specialCondition=sc,
            )
        )

    # Verrous (Lock attack / retreat / abilities / items)
    if (
        "ne peut pas attaquer" in lower
        or "ne peut pas utiliser d'attaques" in lower
        or "ne peut pas utiliser" in lower and "prochain tour" in lower
        or "can't attack" in lower
        or "ce pokémon ne peut attaquer que si" in lower
    ):
        tgt_la = (
            EffectTarget.OPPONENT_ALL_POKEMON
            if "les pokémon" in lower and "adversaire" in lower
            else (EffectTarget.OPPONENT_ACTIVE if "défenseur" in lower or "adversaire" in lower else EffectTarget.SELF)
        )
        flt_la = "CONDITION:TEAM_ROCKET_MIN_4" if "team rocket" in lower else None
        effects.append(AtomicEffect(primitive=EffectPrimitive.LOCK_NEXT_TURN_ATTACK, target=tgt_la, filter=flt_la))

    if "ne peut pas battre en retraite" in lower or "can't retreat" in lower:
        lr_tgt = (
            EffectTarget.SELF
            if ("cette carte" in lower or "ce pokémon" in lower or "this card" in lower or "this pokémon" in lower)
            and not any(w in lower for w in ("défenseur", "defending", "adversaire", "opponent"))
            else EffectTarget.OPPONENT_ACTIVE
        )
        effects.append(AtomicEffect(primitive=EffectPrimitive.LOCK_RETREAT, target=lr_tgt))

    if "n'ont pas de talent" in lower or "have no abilities" in lower or "n'ont aucun effet" in lower:
        effects.append(AtomicEffect(primitive=EffectPrimitive.LOCK_ABILITIES, target=EffectTarget.ALL_POKEMON_IN_PLAY))

    if "ne peut pas jouer de cartes objet" in lower or "can't play any item cards" in lower:
        effects.append(AtomicEffect(primitive=EffectPrimitive.LOCK_ITEMS, target=EffectTarget.OPPONENT))

    # Modificateurs continus / Banc / PV / Retraite / Dégâts / Immunités
    m_expand = re.search(r"jusqu'à\s+(\d+)\s+pokémon sur son banc|up to\s+(\d+)\s+pokémon on their bench", lower)
    if m_expand:
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.EXPAND_BENCH,
                target=EffectTarget.ALL_POKEMON_IN_PLAY,
                value=int(m_expand.group(1) or m_expand.group(2)),
            )
        )
        if "téracristal" in lower or "tera " in lower:
            synergy_tags.append("requires_tera_pokemon")

    m_hp = re.search(r"(?:reçoit|a|gets)\s*\+(\d+)\s*(?:pv|hp)", lower)
    if m_hp:
        hp_tgt = EffectTarget.OWN_POKEMON_ANY if "auquel cette carte est attachée" in lower else EffectTarget.SELF
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.MODIFY_HP,
                target=hp_tgt,
                value=int(m_hp.group(1)),
            )
        )

    m_dmg_taken = re.search(r"subit\s+(\d+)\s+dégâts\s+de\s+moins|takes\s+(\d+)\s+less\s+damage", lower)
    if m_dmg_taken:
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.MODIFY_DAMAGE_TAKEN,
                target=EffectTarget.SELF if "ce pokémon" in lower or "this pokémon" in lower else EffectTarget.OWN_POKEMON_ANY,
                value=-int(m_dmg_taken.group(1) or m_dmg_taken.group(2)),
            )
        )

    m_dmg_taken_plus = re.search(r"subit\s+(\d+)\s+dégâts\s+supplémentaires|takes\s+(\d+)\s+more\s+damage", lower)
    if m_dmg_taken_plus:
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.MODIFY_DAMAGE_TAKEN,
                target=EffectTarget.OPPONENT_ACTIVE,
                value=int(m_dmg_taken_plus.group(1) or m_dmg_taken_plus.group(2)),
            )
        )

    m_dmg_dealt = re.search(r"attaques.*infligent\s+(\d+)\s+dégâts\s+supplémentaires|attacks.*do\s+(\d+)\s+more\s+damage", lower)
    if m_dmg_dealt:
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.MODIFY_DAMAGE_DEALT,
                target=EffectTarget.SELF,
                value=int(m_dmg_dealt.group(1) or m_dmg_dealt.group(2)),
            )
        )
    elif "la faiblesse" in lower and ("type" in lower or "×3" in lower) or "coûte" in lower and ("de moins" in lower or "de plus" in lower):
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.MODIFY_DAMAGE_DEALT,
                target=EffectTarget.OPPONENT_ALL_POKEMON if "adversaire" in lower else EffectTarget.SELF,
                filter="EFFECT:WEAKNESS_OR_COST_MODIFIER",
            )
        )

    if "coût de retraite" in lower or "retreat cost" in lower:
        if "n'a pas de coût de retraite" in lower or "n'ont pas de coût de retraite" in lower or "no retreat cost" in lower:
            rc_val = 0
        elif "diminué de" in lower or "less" in lower:
            rc_val = -2 if "{c}{c}" in lower else -1
        elif "augmenté de" in lower or "more" in lower:
            rc_val = 1
        else:
            rc_val = 0
        rc_tgt = EffectTarget.OPPONENT_ACTIVE if "adversaire" in lower else (EffectTarget.OWN_ALL_POKEMON if "vos pokémon" in lower else EffectTarget.SELF)
        effects.append(AtomicEffect(primitive=EffectPrimitive.MODIFY_RETREAT_COST, target=rc_tgt, value=rc_val))

    if (
        "évitez tous les dégâts" in lower
        or "prevent all damage" in lower
        or "empêchez que" in lower
        or "ne peut pas être soigné" in lower
        or "n'a pas de faiblesse" in lower
    ):
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.PREVENT_DAMAGE_OR_EFFECTS,
                target=EffectTarget.OWN_BENCH_ALL if "sur votre banc" in lower else EffectTarget.SELF,
            )
        )

    # Soin (hors modificateurs passifs)
    m_heal = re.search(r"soignez\s+(\d+)\s+dégâts|heal\s+(\d+)\s+damage", lower)
    if m_heal or "soignez tous les dégâts" in lower or "heal all damage" in lower:
        heal_v = int(m_heal.group(1) or m_heal.group(2)) if m_heal else 999
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.HEAL,
                target=EffectTarget.SELF if "de ce pokémon" in lower else EffectTarget.OWN_POKEMON_ANY,
                value=heal_v,
            )
        )

    # Meule (Mill deck)
    if ("défaussez" in lower or "discard" in lower) and ("dessus du deck" in lower or "top" in lower and "deck" in lower):
        m_mill = re.search(r"(\d+)\s+cartes? du dessus|top\s+(\d+)\s+cards?", lower)
        mill_cnt = int(m_mill.group(1) or m_mill.group(2)) if m_mill else 1
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.MILL_DECK,
                target=EffectTarget.OPPONENT if "adversaire" in lower or "opponent" in lower else EffectTarget.PLAYER,
                count=mill_cnt,
                sourceZone=ZoneType.DECK,
                destinationZone=ZoneType.DISCARD,
            )
        )

    # Défausse de Stade
    if "défaussez un stade" in lower or "défausser un stade" in lower or "discard a stadium" in lower:
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.DISCARD_CARDS,
                target=EffectTarget.ALL_POKEMON_IN_PLAY,
                count=1,
                destinationZone=ZoneType.DISCARD,
                filter="CATEGORY:STADIUM",
                optional=("vous pouvez" in lower or "you may" in lower),
            )
        )

    # Défausse d'énergies sur soi ou adversaire
    if ("défaussez" in lower or "discard" in lower) and ("énergie" in lower or "energy" in lower) and "dessus du deck" not in lower:
        m_de = re.search(r"défaussez\s+(\d+)\s+énergie|discard\s+(\d+)\s+energy", lower)
        de_cnt = int(m_de.group(1) or m_de.group(2)) if m_de else None
        de_tgt = (
            EffectTarget.OPPONENT_ACTIVE
            if "pokémon actif de votre adversaire" in lower or "opponent's active" in lower
            else EffectTarget.SELF
        )
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.DISCARD_CARDS,
                target=de_tgt,
                count=de_cnt,
                sourceZone=ZoneType.ATTACHED_CARDS,
                destinationZone=ZoneType.DISCARD,
                filter="CATEGORY:ENERGY",
            )
        )

    # Récompense supplémentaire
    if "carte récompense supplémentaire" in lower or "cartes récompense supplémentaires" in lower or "more prize card" in lower:
        m_pr = re.search(r"(\d+)\s+cartes? récompense|take\s+(\d+)\s+more prize", lower)
        pr_cnt = int(m_pr.group(1) or m_pr.group(2)) if m_pr else 1
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.TAKE_EXTRA_PRIZE,
                target=EffectTarget.PLAYER,
                count=pr_cnt,
                sourceZone=ZoneType.PRIZES,
                destinationZone=ZoneType.HAND,
            )
        )

    # Spécificités d'ATTAQUES : Recul, Snipe/Spread, Scaling, Lancer de pièce
    if slot.actionType == ActionType.ATTACK:
        coin_mode, coin_cnt, coin_bonus, coin_primary = _extract_coin_flip(lower, slot.baseDamage)
        recoil = _extract_recoil_damage(lower)
        replaces_active, bench_tgt, bench_val = _extract_snipe_or_spread(lower, slot.baseDamage)
        scale_op, scale_metric, scale_bonus = _extract_damage_scaling(lower, slot.printedDamageStr, slot.baseDamage)

        if replaces_active and bench_tgt is not None:
            effects.insert(
                0,
                AtomicEffect(
                    primitive=EffectPrimitive.DAMAGE_BENCH,
                    target=bench_tgt,
                    value=bench_val,
                    coinFlipMode=coin_mode if coin_primary else None,
                    coinCount=coin_cnt if coin_primary else None,
                    scalingOperator=scale_op,
                    scalingMetric=scale_metric,
                    bonusValue=coin_bonus or scale_bonus,
                ),
            )
        else:
            if slot.baseDamage is not None and slot.baseDamage > 0:
                effects.insert(
                    0,
                    AtomicEffect(
                        primitive=EffectPrimitive.DAMAGE_ACTIVE,
                        target=EffectTarget.OPPONENT_ACTIVE,
                        value=slot.baseDamage,
                        coinFlipMode=coin_mode if coin_primary else None,
                        coinCount=coin_cnt if coin_primary else None,
                        scalingOperator=scale_op,
                        scalingMetric=scale_metric,
                        bonusValue=coin_bonus or scale_bonus,
                    ),
                )
            elif not any(e.primitive in {EffectPrimitive.PLACE_DAMAGE_COUNTERS, EffectPrimitive.KNOCK_OUT} for e in effects) and (scale_bonus or bench_val):
                effects.insert(
                    0,
                    AtomicEffect(
                        primitive=EffectPrimitive.DAMAGE_BENCH if bench_tgt else EffectPrimitive.DAMAGE_ACTIVE,
                        target=bench_tgt or EffectTarget.OPPONENT_ACTIVE,
                        value=bench_val or scale_bonus or 0,
                        coinFlipMode=coin_mode if coin_primary else None,
                        coinCount=coin_cnt if coin_primary else None,
                        scalingOperator=scale_op,
                        scalingMetric=scale_metric,
                        bonusValue=coin_bonus or scale_bonus,
                    ),
                )
            if not replaces_active and bench_tgt is not None and bench_val is not None:
                effects.append(
                    AtomicEffect(
                        primitive=EffectPrimitive.DAMAGE_BENCH,
                        target=bench_tgt,
                        value=bench_val,
                    )
                )

        if recoil is not None and recoil > 0:
            effects.append(
                AtomicEffect(
                    primitive=EffectPrimitive.DAMAGE_ACTIVE,
                    target=EffectTarget.SELF,
                    value=recoil,
                    coinFlipMode=CoinFlipMode.TWO_TAILS_SELF_DAMAGE if coin_mode == CoinFlipMode.TWO_TAILS_SELF_DAMAGE else None,
                    coinCount=coin_cnt if coin_mode == CoinFlipMode.TWO_TAILS_SELF_DAMAGE else None,
                )
            )

    # Si l'attaque autorise T1 ou Évolution T1 (svp-173 / sv10.5b-044)
    if not effects and ("évoluer pendant votre premier tour" in lower or "evolve.*first turn" in lower):
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.EVOLVE_POKEMON,
                target=EffectTarget.SELF,
                filter="ALLOW_T1_OR_SAME_TURN_EVOLVE",
            )
        )
    elif not effects and ("peut utiliser des attaques pendant votre premier tour" in lower or "can use attacks during your first turn" in lower):
        effects.append(
            AtomicEffect(
                primitive=EffectPrimitive.MODIFY_DAMAGE_DEALT,
                target=EffectTarget.SELF,
                filter="ALLOW_T1_GOING_FIRST_ATTACK",
            )
        )

    # Dernier filet : ne jamais laisser un slot à texte non vide sans effet
    if not effects and combined:
        if any(w in lower for w in ("interdit", "ne peut pas", "can't", "évitez", "prevent", "pas d'effet")):
            effects.append(AtomicEffect(primitive=EffectPrimitive.PREVENT_DAMAGE_OR_EFFECTS, target=EffectTarget.SELF))
        else:
            effects.append(AtomicEffect(primitive=EffectPrimitive.MODIFY_DAMAGE_DEALT, target=EffectTarget.SELF, filter="SPECIAL_RULE_EFFECT"))

    # Appliquer coinFlipMode sur l'effet pertinent pour TOUT slot (Talents, Dresseurs, Attaques à 0 dégâts ou effet secondaire)
    coin_mode_any, coin_cnt_any, _, _ = _extract_coin_flip(lower, slot.baseDamage)
    if coin_mode_any is not None and not any(e.coinFlipMode is not None for e in effects):
        secondary_priority = (
            EffectPrimitive.APPLY_SPECIAL_CONDITION,
            EffectPrimitive.PREVENT_DAMAGE_OR_EFFECTS,
            EffectPrimitive.SEARCH_DECK,
            EffectPrimitive.ATTACH_ENERGY,
            EffectPrimitive.SWITCH_ACTIVE,
            EffectPrimitive.DISCARD_CARDS,
            EffectPrimitive.MILL_DECK,
            EffectPrimitive.TAKE_EXTRA_PRIZE,
            EffectPrimitive.HEAL,
            EffectPrimitive.DRAW_CARDS,
            EffectPrimitive.RECOVER_FROM_DISCARD,
            EffectPrimitive.PLACE_DAMAGE_COUNTERS,
            EffectPrimitive.LOCK_RETREAT,
            EffectPrimitive.LOCK_NEXT_TURN_ATTACK,
        )
        applied_coin = False
        for prim_target in secondary_priority:
            for e in effects:
                if e.primitive == prim_target and e.coinFlipMode is None:
                    e.coinFlipMode = coin_mode_any
                    e.coinCount = coin_cnt_any
                    applied_coin = True
                    break
            if applied_coin:
                break
        if not applied_coin and effects:
            effects[0].coinFlipMode = coin_mode_any
            effects[0].coinCount = coin_cnt_any

    return list(dict.fromkeys(preconditions)), effects, dead_cond, list(dict.fromkeys(synergy_tags))


# ============================================================================
# NORMALISATION ET GARDE-FOUS POST-LLM (`preconditions`, `deadCardCondition`, `strategicEvaluator`)
# ============================================================================


_PRECONDITION_SYNONYMS: Dict[str, Optional[str]] = {
    "NONE": None,
    "NULL": None,
    "N/A": None,
    "TRUE": None,
    "FALSE": None,
    "ABILITY_IS_USABLE": None,
    "ABILITY_IS_ACTIVE": None,
    "OPPONENT_HAS_ACTIVE_POKEMON": None,
    "SELF_ACTIVE": "SELF_IS_ACTIVE",
    "ON_ACTIVE_SPOT": "SELF_IS_ACTIVE",
    "SELF_IS_IN_THE_ACTIVE_SPOT": "SELF_IS_ACTIVE",
    "IS_ACTIVE": "SELF_IS_ACTIVE",
    "SELF_IS_ACTIVE": "SELF_IS_ACTIVE",
    "SELF_ON_BENCH": "SELF_ON_BENCH",
    "SELF_IS_ON_BENCH": "SELF_ON_BENCH",
    "ON_BENCH": "SELF_ON_BENCH",
    "SELF_IN_HAND": "SELF_IS_IN_HAND",
    "SELF_IS_IN_HAND": "SELF_IS_IN_HAND",
    "SELF_IS_PLAYED_FROM_HAND": "SELF_IS_IN_HAND",
    "HAND": "SELF_IS_IN_HAND",
    "OWN_TURN": "DURING_YOUR_TURN",
    "YOUR_TURN": "DURING_YOUR_TURN",
    "IT_IS_YOUR_TURN": "DURING_YOUR_TURN",
    "PLAYER_IS_DURING_TURN": "DURING_YOUR_TURN",
    "DURING_YOUR_TURN": "DURING_YOUR_TURN",
    "OPPONENT_BENCH_HAS_POKEMON": "OPPONENT_HAS_BENCHED_POKEMON",
    "OPPONENT_HAS_BENCH_POKEMON": "OPPONENT_HAS_BENCHED_POKEMON",
    "OPPONENT_HAS_BENCHED_POKEMON": "OPPONENT_HAS_BENCHED_POKEMON",
    "BENCH_NOT_FULL": "BENCH_HAS_EMPTY_SLOT",
    "EMPTY_BENCH_SLOT": "BENCH_HAS_EMPTY_SLOT",
    "BENCH_HAS_EMPTY_SLOT": "BENCH_HAS_EMPTY_SLOT",
    "OWN_BENCH_HAS_POKEMON": "BENCH_HAS_POKEMON",
    "HAS_BENCH_POKEMON": "BENCH_HAS_POKEMON",
    "BENCH_HAS_POKEMON": "BENCH_HAS_POKEMON",
    "HAS_ENERGY_ATTACHED": "SELF_HAS_ENERGY",
    "SELF_HAS_ENERGY": "SELF_HAS_ENERGY",
    "SELF_IS_ATTACHED": "SELF_IN_PLAY",
    "SELF_ATTACHED": "SELF_IN_PLAY",
}

_POSITIVE_TO_NEGATIVE_DEAD_MAP: Dict[str, Optional[str]] = {
    "SELF_IS_ACTIVE": "SELF_NOT_ACTIVE",
    "SELF_ACTIVE": "SELF_NOT_ACTIVE",
    "SELF_IS_NOT_ACTIVE": "SELF_NOT_ACTIVE",
    "SELF_NOT_ACTIVE": "SELF_NOT_ACTIVE",
    "SELF_ON_BENCH": "SELF_NOT_ON_BENCH",
    "SELF_IS_ON_BENCH": "SELF_NOT_ON_BENCH",
    "KO_SUFFERED_LAST_TURN": "NO_KO_SUFFERED_LAST_TURN",
    "NO_KO_SUFFERED_LAST_TURN": "NO_KO_SUFFERED_LAST_TURN",
    "PLAYER_BEHIND_ON_PRIZES": "NOT_BEHIND_ON_PRIZES",
    "NOT_BEHIND_ON_PRIZES": "NOT_BEHIND_ON_PRIZES",
    "OPPONENT_BENCH_HAS_POKEMON": "OPPONENT_BENCH_EMPTY",
    "OPPONENT_HAS_BENCHED_POKEMON": "OPPONENT_BENCH_EMPTY",
    "OPPONENT_HAS_BENCH_POKEMON": "OPPONENT_BENCH_EMPTY",
    "OPPONENT_BENCH_EMPTY": "OPPONENT_BENCH_EMPTY",
    "BENCH_HAS_POKEMON": "BENCH_IS_EMPTY",
    "OWN_BENCH_HAS_POKEMON": "BENCH_IS_EMPTY",
    "BENCH_EMPTY": "BENCH_IS_EMPTY",
    "NO_BENCH_POKEMON": "BENCH_IS_EMPTY",
    "BENCH_IS_EMPTY": "BENCH_IS_EMPTY",
    "BENCH_HAS_EMPTY_SLOT": "BENCH_FULL",
    "BENCH_FULL": "BENCH_FULL",
    "DECK_NOT_EMPTY": "DECK_IS_EMPTY",
    "NO_CARDS_IN_DECK": "DECK_IS_EMPTY",
    "DECK_IS_EMPTY": "DECK_IS_EMPTY",
    "HAND_NOT_EMPTY": "HAND_IS_EMPTY",
    "HAS_CARDS_IN_HAND": "HAND_IS_EMPTY",
    "NO_CARDS_IN_HAND": "HAND_IS_EMPTY",
    "HAND_IS_EMPTY": "HAND_IS_EMPTY",
    "OPPONENT_HAND_NOT_EMPTY": "OPPONENT_HAND_IS_EMPTY",
    "OPPONENT_HAND_IS_EMPTY": "OPPONENT_HAND_IS_EMPTY",
    "SELF_HAS_ENERGY": "NO_ENERGY_ATTACHED",
    "HAS_ENERGY_ATTACHED": "NO_ENERGY_ATTACHED",
    "NO_ENERGY_ATTACHED": "NO_ENERGY_ATTACHED",
    "SELF_HAS_DAMAGE": "NO_DAMAGE_COUNTERS_ON_SELF",
    "OPPONENT_ACTIVE_HAS_DAMAGE": "OPPONENT_ACTIVE_NO_DAMAGE",
    "OPPONENT_HAS_ACTIVE_POKEMON": None,
    "ABILITY_IS_ACTIVE": "ABILITY_LOCKED",
    "ABILITY_IS_USABLE": "ABILITY_LOCKED",
    "SELF_IS_ACTIVE_AND_CANNOT_ATTACK": "CANNOT_ATTACK_THIS_TURN",
    "OPPONENT_ACTIVE_IS_KO": "OPPONENT_ACTIVE_NOT_KO",
    "ABILITY_LOCKED": "ABILITY_LOCKED",
    "STADIUM_ALREADY_IN_PLAY_SAME_NAME": "STADIUM_ALREADY_IN_PLAY_SAME_NAME",
    "NO_POKEMON_WITHOUT_TOOL": "NO_POKEMON_WITHOUT_TOOL",
    "OPPONENT_PRIZES_EXACT_COUNT": "OPPONENT_PRIZES_NOT_1",
    "OPPONENT_PRIZES_NOT_1": "OPPONENT_PRIZES_NOT_1",
}

_NEGATIVE_PREFIXES = (
    "NO_",
    "NOT_",
    "BENCH_FULL",
    "DECK_IS_EMPTY",
    "HAND_IS_EMPTY",
    "HAND_FEWER_",
    "OPPONENT_BENCH_EMPTY",
    "OPPONENT_HAND_IS_EMPTY",
    "OPPONENT_ACTIVE_NO",
    "OPPONENT_ACTIVE_NOT",
    "OPPONENT_PRIZES_NOT_",
    "STADIUM_ALREADY_IN_PLAY",
    "BENCH_IS_EMPTY",
    "CANNOT_",
    "INSUFFICIENT_",
    "SELF_NOT_",
    "ABILITY_LOCKED",
)


def canonicalize_preconditions(raw_list: List[str]) -> List[str]:
    """Normalise une liste de préconditions vers un vocabulaire canonique compact sans doublons ni tautologies."""
    cleaned: List[str] = []
    for raw in raw_list:
        token = str(raw or "").strip().upper()
        token = re.sub(r"\s+", "_", token)
        if not token:
            continue
        if token in {"BENCH_FULL", "BENCH_IS_EMPTY", "NO_VALID_TARGET_IN_DECK", "BENCH_FULL_OR_NO_TARGET_IN_DECK"} or (
            token.startswith("NO_") and ("IN_PLAY" in token or "ON_BENCH" in token or "BENCH_FULL" in token)
        ):
            continue
        if token in _PRECONDITION_SYNONYMS:
            mapped = _PRECONDITION_SYNONYMS[token]
            if mapped and mapped not in cleaned:
                cleaned.append(mapped)
            continue
        if token.startswith("HAS_IN_PLAY:"):
            suffix = token.split(":", 1)[1].strip("_")
            token = f"IN_PLAY:{suffix}"
        if token not in cleaned:
            cleaned.append(token)
    return cleaned


def normalize_and_uninvert_dead_card_condition(
    dead_cond: Optional[str],
    preconditions: List[str],
) -> Optional[str]:
    """Normalise `deadCardCondition` et corrige automatiquement toute inversion logique (condition d'activation recopiée)."""
    if not dead_cond:
        return None
    if "|" in str(dead_cond):
        parts_norm = [
            res
            for p in str(dead_cond).split("|")
            if p.strip()
            for res in [normalize_and_uninvert_dead_card_condition(p, preconditions)]
            if res
        ]
        return "|".join(dict.fromkeys(parts_norm)) or None
    raw_token = re.sub(r"\s+", "_", str(dead_cond).strip().upper())
    if not raw_token or raw_token in {"NONE", "NULL", "N/A", "NA", "NEVER", "FALSE"}:
        return None

    # 1. Si identique à une précondition active, inverser AVANT tout autre mapping
    norm_pre = {re.sub(r"\s+", "_", p.strip().upper()) for p in preconditions}
    if raw_token in norm_pre:
        if raw_token == "HAND_IS_EMPTY":
            return "HAND_NOT_EMPTY"
        if raw_token in _POSITIVE_TO_NEGATIVE_DEAD_MAP:
            return _POSITIVE_TO_NEGATIVE_DEAD_MAP[raw_token]
        if raw_token.startswith("IN_PLAY:") or raw_token.startswith("HAS_IN_PLAY:"):
            target_name = raw_token.split(":", 1)[1].strip("_")
            return f"NO_{target_name}_IN_PLAY"
        if raw_token.startswith("HAND_MIN_OTHER_CARDS:"):
            cnt = raw_token.split(":", 1)[1]
            return f"HAND_FEWER_THAN_{cnt}_OTHER_CARDS"
        if raw_token.startswith("NO_"):
            return raw_token[3:]
        if raw_token.startswith("NOT_"):
            return raw_token[4:]
        return f"NOT_{raw_token}"

    # 2. Mapping direct des conditions positives connues et variantes synonymes
    if raw_token == "HAND_NOT_EMPTY" and "HAND_IS_EMPTY" in norm_pre:
        return "HAND_NOT_EMPTY"
    if raw_token in {"OPPONENT_BENCHNOTEMPTY", "OPPONENT_BENCH_NOT_EMPTY"}:
        return "OPPONENT_BENCH_EMPTY"
    if raw_token in _POSITIVE_TO_NEGATIVE_DEAD_MAP:
        return _POSITIVE_TO_NEGATIVE_DEAD_MAP[raw_token]

    # 3. Cas paramétrés ou composites positifs
    if raw_token.startswith("SELF_IS_ACTIVE"):
        return "SELF_NOT_ACTIVE"
    if raw_token.startswith("HAND_SIZE_EXACT:"):
        n_part = raw_token.split(":", 1)[1]
        return f"HAND_SIZE_NOT_EXACT:{n_part}"
    if raw_token.startswith("ENERGY_COUNT_ON_SELF:"):
        n_part = raw_token.split(":", 1)[1]
        return f"INSUFFICIENT_ENERGY_ON_SELF:{n_part}"
    if raw_token.startswith("BENCH_POKEMON_WITH_DAMAGE"):
        return "NO_BENCH_POKEMON_WITH_DAMAGE"
    if raw_token.startswith("DISCARD_PILE_HAS") or raw_token.startswith("DISCARD_HAS_"):
        return "NO_VALID_TARGET_IN_DISCARD"
    if raw_token.startswith("BENCH_HAS_"):
        target_name = raw_token[len("BENCH_HAS_") :]
        return f"NO_{target_name}_IN_PLAY"
    if raw_token.startswith("HAS_IN_PLAY:") or raw_token.startswith("IN_PLAY:"):
        target_name = raw_token.split(":", 1)[1].strip("_")
        return f"NO_{target_name}_IN_PLAY"
    if raw_token.startswith("HAS_"):
        rest = raw_token[4:]
        if not rest.startswith("NO_"):
            return f"NO_{rest}"
    if raw_token.startswith("OPPONENT_HAS_"):
        rest = raw_token[len("OPPONENT_HAS_") :]
        return f"OPPONENT_NO_{rest}"
    if raw_token.startswith("PLAYER_BEHIND"):
        return "NOT_BEHIND_ON_PRIZES"
    if raw_token.startswith("HAND_MIN_OTHER_CARDS:"):
        cnt = raw_token.split(":", 1)[1]
        return f"HAND_FEWER_THAN_{cnt}_OTHER_CARDS"

    return raw_token


def filter_and_normalize_synergy_tags(
    tags: List[str],
    identity: CardIdentity,
) -> List[str]:
    """Ne conserve que les tags de synergie formels normalisés (`requires_*`) et supprime les commentaires libres."""
    normalized: List[str] = []

    alias_map = {
        "stage_2_evolution": "requires_stage_2_pokemon",
        "requires_tera": "requires_tera_pokemon",
        "requires_ancient": "requires_ancient_pokemon",
        "requires_future": "requires_future_pokemon",
        "requires_discard": "requires_discard_synergy",
    }

    for raw_tag in tags:
        t = str(raw_tag or "").strip()
        if not t:
            continue
        t_low = t.lower()
        t_canon = alias_map.get(t_low, t)

        is_allowed = (
            t_canon in _ALLOWED_EXACT_SYNERGY_TAGS
            or any(t_canon.startswith(pref) for pref in _ALLOWED_SYNERGY_PREFIXES)
        )
        if not is_allowed:
            continue
        if t_canon not in normalized:
            normalized.append(t_canon)

    if identity.isTera and "requires_tera_pokemon" not in normalized:
        normalized.append("requires_tera_pokemon")
    if identity.isAncient and "requires_ancient_pokemon" not in normalized:
        normalized.append("requires_ancient_pokemon")
    if identity.isFuture and "requires_future_pokemon" not in normalized:
        normalized.append("requires_future_pokemon")

    return normalized


def _compute_calibrated_turn_phase_weights(
    skeleton: DeterministicCardSkeleton,
    ai_role: AIRole,
    actions: List[PlayableAction],
) -> TurnPhaseWeights:
    """Calcule une courbe `TurnPhaseWeights` réaliste selon le stade, coût d'énergie et rôle."""
    all_pre = [p for a in actions for p in a.preconditions]
    is_behind_or_late = any(p in {"PLAYER_BEHIND_ON_PRIZES", "KO_SUFFERED_LAST_TURN"} for p in all_pre)
    if is_behind_or_late:
        return TurnPhaseWeights(turn1=0.0, turn2=0.4, turn3=0.8, turn4Plus=1.0)

    cat = skeleton.category
    sub = skeleton.subCategory
    is_t1_locked = all(not a.canUseTurn1GoingFirst and not a.canUseTurn1GoingSecond for a in actions)

    if cat == CardCategory.ENERGY:
        if sub == CardSubCategory.BASIC_ENERGY:
            return TurnPhaseWeights(turn1=1.0, turn2=1.0, turn3=1.0, turn4Plus=1.0)
        return TurnPhaseWeights(turn1=0.8, turn2=0.9, turn3=0.8, turn4Plus=0.6)

    if cat == CardCategory.TRAINER:
        if ai_role == AIRole.CONSISTENCY_BOOSTER:
            return TurnPhaseWeights(turn1=0.0 if is_t1_locked else 1.0, turn2=0.9, turn3=0.5, turn4Plus=0.3)
        if ai_role == AIRole.DRAW_ENGINE:
            t1_val = 0.0 if is_t1_locked else (0.5 if sub == CardSubCategory.SUPPORTER else 1.0)
            return TurnPhaseWeights(turn1=t1_val, turn2=0.9, turn3=0.8, turn4Plus=0.6)
        if ai_role == AIRole.DISRUPTION:
            return TurnPhaseWeights(turn1=0.2, turn2=0.7, turn3=0.9, turn4Plus=1.0)
        if ai_role == AIRole.ENERGY_ACCELERATOR:
            return TurnPhaseWeights(turn1=0.8, turn2=0.9, turn3=0.8, turn4Plus=0.6)
        return TurnPhaseWeights(turn1=0.6, turn2=0.7, turn3=0.7, turn4Plus=0.7)

    # Cas POKÉMON
    max_energy_cost = max([sum(a.cost.values()) for a in actions if a.actionType == ActionType.ATTACK] or [0])

    if sub == CardSubCategory.STAGE_2:
        if ai_role in {AIRole.MAIN_ATTACKER, AIRole.SECONDARY_ATTACKER}:
            return TurnPhaseWeights(turn1=0.0, turn2=0.8, turn3=1.0, turn4Plus=1.0)
        return TurnPhaseWeights(turn1=0.0, turn2=0.9, turn3=1.0, turn4Plus=0.9)

    if sub == CardSubCategory.STAGE_1:
        return TurnPhaseWeights(turn1=0.0, turn2=0.9, turn3=0.8, turn4Plus=0.6)

    # BASIC Pokémon
    if ai_role in {AIRole.CONSISTENCY_BOOSTER, AIRole.DRAW_ENGINE, AIRole.ENERGY_ACCELERATOR, AIRole.GUEST_TECH}:
        if ai_role == AIRole.CONSISTENCY_BOOSTER:
            return TurnPhaseWeights(turn1=1.0, turn2=0.8, turn3=0.4, turn4Plus=0.2)
        if ai_role == AIRole.DRAW_ENGINE:
            return TurnPhaseWeights(turn1=0.9, turn2=0.9, turn3=0.7, turn4Plus=0.5)
        return TurnPhaseWeights(turn1=0.8, turn2=0.8, turn3=0.6, turn4Plus=0.4)

    if max_energy_cost >= 3:
        return TurnPhaseWeights(turn1=0.2, turn2=0.7, turn3=1.0, turn4Plus=1.0)

    return TurnPhaseWeights(turn1=0.8, turn2=1.0, turn3=0.9, turn4Plus=0.7)


def enforce_strategic_evaluator_guardrails(
    skeleton: DeterministicCardSkeleton,
    ai_role: AIRole,
    turn_weights: TurnPhaseWeights,
    actions: List[PlayableAction],
    synergies: List[str],
    evolvable_names: Optional[Set[str]] = None,
) -> StrategicEvaluator:
    """Applique les garde-fous déterministes sur `aiRole`, `turnPhaseWeights` et `decklistSynergyRequirements`."""
    all_effects = [eff for act in actions for eff in act.effects]
    all_prims = {eff.primitive for eff in all_effects}

    eff_role = ai_role

    # 1. Interdiction de classer Dresseur ou Énergie en attaquant
    if skeleton.category in {CardCategory.TRAINER, CardCategory.ENERGY} and eff_role in {
        AIRole.MAIN_ATTACKER,
        AIRole.SECONDARY_ATTACKER,
    }:
        is_opp_gust = any(
            eff.primitive == EffectPrimitive.SWITCH_ACTIVE
            and eff.target in {EffectTarget.OPPONENT_ACTIVE, EffectTarget.OPPONENT_BENCH_SINGLE, EffectTarget.OPPONENT_BENCH_ALL}
            for eff in all_effects
        )
        is_opp_discard = any(
            eff.primitive == EffectPrimitive.DISCARD_CARDS
            and eff.target in {EffectTarget.OPPONENT, EffectTarget.OPPONENT_ACTIVE, EffectTarget.OPPONENT_ALL_POKEMON}
            for eff in all_effects
        )
        has_lock_or_mill = bool(
            all_prims
            & {
                EffectPrimitive.LOCK_ABILITIES,
                EffectPrimitive.LOCK_ITEMS,
                EffectPrimitive.LOCK_NEXT_TURN_ATTACK,
                EffectPrimitive.LOCK_RETREAT,
                EffectPrimitive.MILL_DECK,
            }
        )
        if EffectPrimitive.SEARCH_DECK in all_prims or EffectPrimitive.EVOLVE_POKEMON in all_prims or EffectPrimitive.RECOVER_FROM_DISCARD in all_prims:
            eff_role = AIRole.CONSISTENCY_BOOSTER
        elif EffectPrimitive.DRAW_CARDS in all_prims or EffectPrimitive.SHUFFLE_HAND_DRAW in all_prims:
            eff_role = AIRole.DRAW_ENGINE
        elif EffectPrimitive.ATTACH_ENERGY in all_prims or EffectPrimitive.MOVE_ENERGY in all_prims:
            eff_role = AIRole.ENERGY_ACCELERATOR
        elif is_opp_gust or is_opp_discard or has_lock_or_mill:
            eff_role = AIRole.DISRUPTION
        else:
            eff_role = AIRole.GUEST_TECH

    # 2. Interdiction de classer les petits Pokémon de Base pré-évolutifs / faibles (<= 70 PV non-RuleBox) en MAIN_ATTACKER
    if (
        skeleton.category == CardCategory.POKEMON
        and skeleton.subCategory == CardSubCategory.BASIC
        and not skeleton.identity.isRuleBox
        and skeleton.pokemonStats is not None
        and skeleton.pokemonStats.hp <= 70
        and eff_role == AIRole.MAIN_ATTACKER
    ):
        evo_set = evolvable_names if evolvable_names is not None else build_evolvable_names_index()
        name_low = skeleton.identity.nameFr.strip().lower()
        name_en_low = (skeleton.identity.nameEn or "").strip().lower()
        has_evolution = (name_low in evo_set) or (bool(name_en_low) and name_en_low in evo_set)

        max_dmg = max(
            [
                eff.value or 0
                for act in actions
                if act.actionType == ActionType.ATTACK
                for eff in act.effects
                if eff.primitive in {EffectPrimitive.DAMAGE_ACTIVE, EffectPrimitive.DAMAGE_BENCH}
                and eff.target not in _OWN_OR_SELF_TARGETS
            ]
            or [0]
        )

        if has_evolution or max_dmg <= 30:
            if EffectPrimitive.DRAW_CARDS in all_prims or EffectPrimitive.SHUFFLE_HAND_DRAW in all_prims:
                eff_role = AIRole.DRAW_ENGINE
            else:
                eff_role = AIRole.CONSISTENCY_BOOSTER
        else:
            eff_role = AIRole.SECONDARY_ATTACKER

    # 3. Détection & recalibrage du biais de copie (0.9, 0.9, 0.8, 0.8) / (0.0, 0.9, 0.8, 0.8)
    t1 = max(0.0, min(1.0, float(turn_weights.turn1)))
    t2 = max(0.0, min(1.0, float(turn_weights.turn2)))
    t3 = max(0.0, min(1.0, float(turn_weights.turn3)))
    t4 = max(0.0, min(1.0, float(turn_weights.turn4Plus)))

    if (round(t1, 4), round(t2, 4), round(t3, 4), round(t4, 4)) in _BIASED_WEIGHT_TUPLES:
        calibrated = _compute_calibrated_turn_phase_weights(skeleton, eff_role, actions)
        t1, t2, t3, t4 = calibrated.turn1, calibrated.turn2, calibrated.turn3, calibrated.turn4Plus

    if skeleton.subCategory in {CardSubCategory.STAGE_1, CardSubCategory.STAGE_2}:
        t1 = 0.0
    if skeleton.category == CardCategory.TRAINER and all(
        not a.canUseTurn1GoingFirst and not a.canUseTurn1GoingSecond for a in actions
    ):
        t1 = 0.0

    clamped_weights = TurnPhaseWeights(turn1=t1, turn2=t2, turn3=t3, turn4Plus=t4)
    filtered_synergies = filter_and_normalize_synergy_tags(synergies, skeleton.identity)

    return StrategicEvaluator(
        aiRole=eff_role,
        turnPhaseWeights=clamped_weights,
        decklistSynergyRequirements=filtered_synergies,
    )


def _sync_effect_from_det(le: AtomicEffect, de: AtomicEffect) -> None:
    """Synchronise `coinFlipMode`, `scaling*` et cible/compteur précis depuis un effet déterministe."""
    if de.coinFlipMode is not None and le.coinFlipMode is None:
        le.coinFlipMode = de.coinFlipMode
        le.coinCount = de.coinCount
    if de.scalingOperator is not None and le.scalingOperator is None:
        le.scalingOperator = de.scalingOperator
    if de.scalingMetric is not None and le.scalingMetric is None:
        le.scalingMetric = de.scalingMetric
    if de.bonusValue is not None and le.bonusValue is None:
        le.bonusValue = de.bonusValue
    if de.primitive == EffectPrimitive.PLACE_DAMAGE_COUNTERS:
        if de.target is not None and le.target in {None, EffectTarget.OPPONENT_ACTIVE, EffectTarget.OPPONENT}:
            le.target = de.target
        if de.count is not None and le.count is None:
            le.count = de.count
        if de.value is not None and le.value is None:
            le.value = de.value
    if de.primitive == EffectPrimitive.DRAW_CARDS and de.count is not None and le.count is None:
        le.count = de.count
    if de.primitive == EffectPrimitive.PUT_ON_TOP_OR_BOTTOM_OF_DECK and de.target is not None:
        if le.target is None or (de.target == EffectTarget.OPPONENT and le.target == EffectTarget.PLAYER):
            le.target = de.target
        if de.destinationZone is not None and le.destinationZone is None:
            le.destinationZone = de.destinationZone


def _repair_action_effects(
    act: PlayableAction,
    slot_spec: EffectSlotToCompile,
    det_effs: List[AtomicEffect],
) -> List[AtomicEffect]:
    """Nettoie et répare les effets d'un slot à partir du texte déterministe officiel."""
    combined_lower = f"{slot_spec.textFr} {slot_spec.textEn or ''}".strip().lower()
    has_draw_word = any(w in combined_lower for w in ("pioch", "draw"))
    is_shuf_draw, shuf_cnt, shuf_metric = _extract_shuffle_hand_draw(combined_lower)
    recoil_val = _extract_recoil_damage(combined_lower)
    det_prims = {d.primitive for d in det_effs}

    raw_effs = list(act.effects)
    cleaned: List[AtomicEffect] = []
    counter_counts = {
        de.count
        for de in det_effs
        if de.primitive == EffectPrimitive.PLACE_DAMAGE_COUNTERS and de.count is not None
    }
    has_counters_det = any(
        d.primitive in {EffectPrimitive.PLACE_DAMAGE_COUNTERS, EffectPrimitive.MOVE_DAMAGE_COUNTERS}
        for d in det_effs
    )

    for eff in raw_effs:
        e = eff.model_copy()

        # Supprimer les primitives hallucinéees contredites par le texte brut
        if e.primitive == EffectPrimitive.KNOCK_OUT and EffectPrimitive.KNOCK_OUT not in det_prims:
            continue
        if e.primitive == EffectPrimitive.SEARCH_DECK and combined_lower and not any(
            w in combined_lower for w in ("deck", "cherche", "recherch", "search")
        ):
            continue
        if (
            e.primitive == EffectPrimitive.ATTACH_ENERGY
            and slot_spec.slotId != "energy_0"
            and act.actionType != ActionType.ATTACH_ENERGY
            and combined_lower
            and not any(w in combined_lower for w in ("énergie", "énergies", "energy"))
        ):
            continue
        if e.primitive == EffectPrimitive.HEAL and combined_lower and not any(
            w in combined_lower for w in ("soign", "guér", "heal", "recover")
        ):
            continue
        if e.primitive == EffectPrimitive.EVOLVE_POKEMON and combined_lower and not any(
            w in combined_lower for w in ("évolu", "evolv")
        ):
            continue

        # Supprimer tout DRAW_CARDS fantôme lorsque le texte ne mentionne aucune pioche
        if e.primitive == EffectPrimitive.DRAW_CARDS and combined_lower and not has_draw_word:
            continue

        # Nettoyer le filtre BASIC_ENERGY sur Énergie Spéciale (energy_0) s'attachant elle-même
        if (
            slot_spec.slotId == "energy_0"
            and e.primitive == EffectPrimitive.ATTACH_ENERGY
            and e.filter == "CATEGORY:ENERGY|SUBCATEGORY:BASIC_ENERGY"
            and "énergie de base" not in combined_lower
            and "basic energy" not in combined_lower
        ):
            e.filter = None

        # Supprimer tout SHUFFLE_HAND_DRAW mal classé sur une recherche dans le deck ou remise sous le deck
        if e.primitive == EffectPrimitive.SHUFFLE_HAND_DRAW:
            if not is_shuf_draw:
                continue
            if shuf_cnt is not None:
                e.count = shuf_cnt
            elif shuf_metric is not None:
                e.count = None
                e.scalingMetric = shuf_metric
            else:
                e.count = None

        # Supprimer les dégâts OWN_ACTIVE fantômes sur attaques multi-pièces / offensives
        if e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.target == EffectTarget.OWN_ACTIVE:
            continue

        # Supprimer un faux DAMAGE_ACTIVE ou DAMAGE_BENCH encodant en réalité un nombre de marqueurs
        if has_counters_det and e.primitive in {EffectPrimitive.DAMAGE_ACTIVE, EffectPrimitive.DAMAGE_BENCH}:
            if (
                e.target in {EffectTarget.OPPONENT_BENCH_SINGLE, EffectTarget.OPPONENT_BENCH_ALL, EffectTarget.OPPONENT}
                or (e.value in counter_counts and (not slot_spec.baseDamage or slot_spec.baseDamage != e.value))
                or (e.value is None and e.count in counter_counts)
                or (e.value is None and not slot_spec.baseDamage)
            ):
                continue

        # Corriger les dégâts sur SELF codés en DAMAGE_ACTIVE
        if e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.target == EffectTarget.SELF:
            if e.value is not None and e.value < 0:
                e.primitive = EffectPrimitive.MODIFY_DAMAGE_TAKEN
            elif e.value is None or e.value == 0:
                if recoil_val is None:
                    continue
                e.value = recoil_val
            elif recoil_val is None:
                e.target = EffectTarget.OPPONENT_ACTIVE
            elif e.value != recoil_val:
                # Ancien bug où baseDamage avait été injecté dans SELF en plus du vrai recul
                continue

        # Nettoyer le champ `count` parasite sur DAMAGE_ACTIVE / DAMAGE_BENCH
        if e.primitive in {EffectPrimitive.DAMAGE_ACTIVE, EffectPrimitive.DAMAGE_BENCH}:
            if e.value is None and e.count is not None and e.count >= 10:
                e.value = e.count
            if e.primitive == EffectPrimitive.DAMAGE_ACTIVE or (e.count is not None and (e.count < 0 or e.count in {e.value, 1})):
                e.count = None

        # Supprimer les placeholders vides DAMAGE_ACTIVE(value=None/0) quand baseDamage est absent et que det_effs existe
        if (
            e.primitive == EffectPrimitive.DAMAGE_ACTIVE
            and (e.value is None or e.value == 0)
            and (slot_spec.baseDamage is None or slot_spec.baseDamage == 0)
            and e.scalingOperator is None
            and e.coinFlipMode is None
            and det_effs
        ):
            continue

        cleaned.append(e)

    # Traitement spécifique par ActionType
    if act.actionType == ActionType.ATTACK:
        base_dmg = slot_spec.baseDamage
        replaces_active, bench_tgt, bench_val = _extract_snipe_or_spread(combined_lower, base_dmg)

        if replaces_active and bench_tgt is not None:
            cleaned = [
                e for e in cleaned
                if not (e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.target not in _OWN_OR_SELF_TARGETS)
            ]

        if base_dmg is not None and base_dmg > 0 and not replaces_active:
            has_base_dmg = False
            for idx, eff in enumerate(cleaned):
                if (
                    eff.primitive == EffectPrimitive.DAMAGE_ACTIVE
                    and eff.target not in _OWN_OR_SELF_TARGETS
                    and (eff.value is None or eff.value >= 0)
                ):
                    if not has_base_dmg:
                        if eff.value is None or eff.value == 0 or (
                            recoil_val is not None and eff.value == recoil_val and recoil_val != base_dmg
                        ):
                            eff.value = base_dmg
                        if eff.target is None:
                            eff.target = EffectTarget.OPPONENT_ACTIVE
                        has_base_dmg = True
                    elif eff.value == base_dmg and eff.scalingOperator is None and eff.coinFlipMode is None:
                        # Doublon exact du dégât de base
                        cleaned[idx] = None  # type: ignore[assignment]
            cleaned = [e for e in cleaned if e is not None]
            if not has_base_dmg:
                cleaned.insert(
                    0,
                    AtomicEffect(
                        primitive=EffectPrimitive.DAMAGE_ACTIVE,
                        target=EffectTarget.OPPONENT_ACTIVE,
                        value=base_dmg,
                    ),
                )

        # Réinjection / synchronisation des effets critiques détectés déterministiquement
        present_prims = {e.primitive for e in cleaned}
        for de in det_effs:
            if de.primitive == EffectPrimitive.DAMAGE_ACTIVE and de.target == EffectTarget.SELF:
                if not any(e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.target == EffectTarget.SELF for e in cleaned):
                    cleaned.append(de.model_copy())
            elif de.primitive == EffectPrimitive.DAMAGE_ACTIVE and de.target == EffectTarget.OPPONENT_ACTIVE:
                for le in cleaned:
                    if le.primitive == EffectPrimitive.DAMAGE_ACTIVE and le.target not in _OWN_OR_SELF_TARGETS:
                        _sync_effect_from_det(le, de)
                        break
            elif de.primitive == EffectPrimitive.DAMAGE_BENCH:
                if not any(e.primitive == EffectPrimitive.DAMAGE_BENCH for e in cleaned):
                    cleaned.append(de.model_copy())
                else:
                    for le in cleaned:
                        if le.primitive == EffectPrimitive.DAMAGE_BENCH:
                            _sync_effect_from_det(le, de)
            elif de.primitive == EffectPrimitive.APPLY_SPECIAL_CONDITION:
                matched_sc = False
                for le in cleaned:
                    if le.primitive == EffectPrimitive.APPLY_SPECIAL_CONDITION and le.specialCondition == de.specialCondition:
                        _sync_effect_from_det(le, de)
                        matched_sc = True
                if not matched_sc:
                    cleaned.append(de.model_copy())
            elif de.primitive not in present_prims:
                cleaned.append(de.model_copy())
                present_prims.add(de.primitive)
            else:
                for le in cleaned:
                    if le.primitive == de.primitive:
                        _sync_effect_from_det(le, de)
                        break

        # Supprimer les doublons de DAMAGE_ACTIVE offensif qui copiaient le bonusValue ou la valeur de recul
        primary_opp_idx = next(
            (i for i, e in enumerate(cleaned) if e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.target not in _OWN_OR_SELF_TARGETS),
            None,
        )
        if primary_opp_idx is not None:
            prim_e = cleaned[primary_opp_idx]
            bonus_v = prim_e.bonusValue
            deduped: List[AtomicEffect] = []
            for i, e in enumerate(cleaned):
                if (
                    i != primary_opp_idx
                    and e.primitive == EffectPrimitive.DAMAGE_ACTIVE
                    and e.target not in _OWN_OR_SELF_TARGETS
                    and (e.value in {None, 0, bonus_v, prim_e.value, recoil_val})
                ):
                    continue
                deduped.append(e)
            cleaned = deduped
    else:
        # Cas Talents, Dresseurs et Énergies Spéciales
        if not cleaned:
            cleaned = [d.model_copy() for d in det_effs]
        else:
            llm_prims = {e.primitive for e in cleaned}
            for de in det_effs:
                if de.primitive not in llm_prims:
                    cleaned.append(de.model_copy())
                    llm_prims.add(de.primitive)
                else:
                    for le in cleaned:
                        if le.primitive == de.primitive:
                            _sync_effect_from_det(le, de)
                            break

        # Garantir que SPECIAL_ENERGY conserve ATTACH_ENERGY en position 0
        if slot_spec.slotId == "energy_0" or act.actionType == ActionType.ATTACH_ENERGY:
            has_attach = any(e.primitive == EffectPrimitive.ATTACH_ENERGY for e in cleaned)
            if not has_attach:
                cleaned.insert(
                    0,
                    AtomicEffect(
                        primitive=EffectPrimitive.ATTACH_ENERGY,
                        target=EffectTarget.OWN_POKEMON_ANY,
                        count=1,
                        sourceZone=ZoneType.HAND,
                        destinationZone=ZoneType.ATTACHED_CARDS,
                        zone=ZoneType.HAND,
                    ),
                )

    # Garantir qu'aucun coinFlipMode détecté par det_effs ne soit perdu si l'action LLM avait une autre primitive
    det_coin = next((d for d in det_effs if d.coinFlipMode is not None), None)
    if det_coin is not None and cleaned and not any(e.coinFlipMode is not None for e in cleaned):
        target_eff = next(
            (e for e in cleaned if e.primitive != EffectPrimitive.DAMAGE_ACTIVE),
            cleaned[0],
        )
        target_eff.coinFlipMode = det_coin.coinFlipMode
        target_eff.coinCount = det_coin.coinCount

    return cleaned or [d.model_copy() for d in det_effs]


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

    sub = skeleton.subCategory
    cat = skeleton.category
    ai_role = AIRole.GUEST_TECH

    all_primitives = [
        eff.primitive
        for s in translated_slots
        for eff in s.effects
    ] + [
        eff.primitive
        for act in skeleton.playableActions
        for eff in act.effects
    ]

    if sub == CardSubCategory.BASIC_ENERGY or cat == CardCategory.ENERGY:
        ai_role = AIRole.ENERGY_ACCELERATOR
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
                for s in translated_slots
                if s.slotId.startswith("attack_")
                for eff in s.effects
                if eff.primitive in {EffectPrimitive.DAMAGE_ACTIVE, EffectPrimitive.DAMAGE_BENCH}
                and eff.target not in _OWN_OR_SELF_TARGETS
            ]
            + [
                eff.value or 0
                for act in skeleton.playableActions
                if act.actionType == ActionType.ATTACK
                for eff in act.effects
                if eff.primitive == EffectPrimitive.DAMAGE_ACTIVE
                and eff.target not in _OWN_OR_SELF_TARGETS
            ]
            or [0]
        )
        if max_dmg >= 180 or (skeleton.identity.prizeCardsGiven >= 2 and max_dmg >= 120):
            ai_role = AIRole.MAIN_ATTACKER
        elif has_draw_ability:
            ai_role = AIRole.DRAW_ENGINE
        elif has_search_ability:
            ai_role = AIRole.CONSISTENCY_BOOSTER
        elif max_dmg > 0 and not (skeleton.pokemonStats and skeleton.pokemonStats.hp <= 70 and not skeleton.identity.isRuleBox and max_dmg <= 30):
            ai_role = AIRole.SECONDARY_ATTACKER
        elif has_draw_ability or EffectPrimitive.DRAW_CARDS in all_primitives:
            ai_role = AIRole.DRAW_ENGINE
        else:
            ai_role = AIRole.CONSISTENCY_BOOSTER if (skeleton.pokemonStats and skeleton.pokemonStats.hp <= 70 and not skeleton.identity.isRuleBox) else AIRole.GUEST_TECH
    elif cat == CardCategory.TRAINER:
        all_prims_set = set(all_primitives)
        if (
            EffectPrimitive.SEARCH_DECK in all_prims_set
            or EffectPrimitive.EVOLVE_POKEMON in all_prims_set
            or EffectPrimitive.RECOVER_FROM_DISCARD in all_prims_set
        ):
            ai_role = AIRole.CONSISTENCY_BOOSTER
        elif EffectPrimitive.SHUFFLE_HAND_DRAW in all_prims_set or EffectPrimitive.DRAW_CARDS in all_prims_set:
            ai_role = AIRole.DRAW_ENGINE
        elif any(
            e.primitive in {EffectPrimitive.LOCK_ABILITIES, EffectPrimitive.LOCK_ITEMS, EffectPrimitive.MILL_DECK}
            or (e.primitive == EffectPrimitive.SWITCH_ACTIVE and e.target == EffectTarget.OPPONENT_ACTIVE)
            for s in translated_slots
            for e in s.effects
        ):
            ai_role = AIRole.DISRUPTION
        elif EffectPrimitive.ATTACH_ENERGY in all_prims_set or EffectPrimitive.MOVE_ENERGY in all_prims_set:
            ai_role = AIRole.ENERGY_ACCELERATOR
        else:
            ai_role = AIRole.GUEST_TECH

    mock_actions: List[PlayableAction] = []
    slot_map = {s.slotId: s for s in translated_slots}
    for act in skeleton.playableActions:
        ac = copy.deepcopy(act)
        if ac.actionId in slot_map:
            ac.preconditions = slot_map[ac.actionId].preconditions
            ac.effects = slot_map[ac.actionId].effects
        mock_actions.append(ac)

    weights = _compute_calibrated_turn_phase_weights(skeleton, ai_role, mock_actions)

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
    evolvable_names: Optional[Set[str]] = None,
) -> EngineCardModel:
    """Fusionne le `LLMCompiledPayload` avec le squelette déterministe et applique tous les verrous et garde-fous finaux."""
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
                act_copy.preconditions = canonicalize_preconditions(
                    list(act_copy.preconditions) + list(llm_slot.preconditions) + list(det_pre)
                )
                act_copy.effects = list(llm_slot.effects)
                act_copy.effects = _repair_action_effects(act_copy, slot_spec, det_effs)
                raw_dead = llm_slot.deadCardCondition or det_dead or act_copy.deadCardCondition
                act_copy.deadCardCondition = normalize_and_uninvert_dead_card_condition(raw_dead, act_copy.preconditions)
            else:
                act_copy.preconditions = canonicalize_preconditions(list(act_copy.preconditions) + list(det_pre))
                if det_effs:
                    act_copy.effects = det_effs
                raw_dead = det_dead or act_copy.deadCardCondition
                act_copy.deadCardCondition = normalize_and_uninvert_dead_card_condition(raw_dead, act_copy.preconditions)

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

        elif act_copy.actionId in slot_map and not act_copy.effects:
            llm_slot_extra = slot_map[act_copy.actionId]
            if llm_slot_extra.effects:
                act_copy.effects = list(llm_slot_extra.effects)
            act_copy.preconditions = canonicalize_preconditions(act_copy.preconditions)
            act_copy.deadCardCondition = normalize_and_uninvert_dead_card_condition(
                act_copy.deadCardCondition,
                act_copy.preconditions,
            )
        else:
            act_copy.preconditions = canonicalize_preconditions(act_copy.preconditions)
            act_copy.deadCardCondition = normalize_and_uninvert_dead_card_condition(
                act_copy.deadCardCondition,
                act_copy.preconditions,
            )

        if skeleton.subCategory == CardSubCategory.STADIUM and act_copy.actionId == "trainer_0":
            cur_dead = act_copy.deadCardCondition
            if not cur_dead or cur_dead in {"STADIUM_IN_PLAY", "NO_STADIUM_IN_PLAY"}:
                act_copy.deadCardCondition = "STADIUM_ALREADY_IN_PLAY_SAME_NAME"
            elif "STADIUM_ALREADY_IN_PLAY_SAME_NAME" not in cur_dead.split("|"):
                act_copy.deadCardCondition = f"{cur_dead}|STADIUM_ALREADY_IN_PLAY_SAME_NAME"

        merged_actions.append(act_copy)

    all_synergies = skeleton.base_synergies + auto_synergy_tags + list(effective_payload.additionalSynergyTags)
    evaluator = enforce_strategic_evaluator_guardrails(
        skeleton=skeleton,
        ai_role=effective_payload.aiRole,
        turn_weights=effective_payload.turnPhaseWeights,
        actions=merged_actions,
        synergies=all_synergies,
        evolvable_names=evolvable_names,
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
