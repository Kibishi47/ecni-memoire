"""Schémas Pydantic V2 stricts pour la compilation de cartes Pokémon TCG.

Ce module définit :
1. Les énumérations normalisées (`CardCategory`, `CardSubCategory`, `ActionType`,
   `TimingPhase`, `EffectPrimitive`, `AIRole`).
2. La structure complète et déterministe du modèle final `EngineCardModel`
   (`CardIdentity`, `PokemonStats`, `TypeModifier`, `PlayableAction`,
   `AtomicEffect`, `StrategicEvaluator`, `TurnPhaseWeights`, `CompilationMetadata`).
3. Le schéma micro-ciblé pour l'IA (`LLMTranslatedSlot`, `LLMCompiledPayload`)
   utilisé exclusivement en Passe 2 via Constrained Decoding.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ============================================================================
# A. ENUMS NORMALISÉS (MAJUSCULES AVEC UNDERSCORES)
# ============================================================================


class CardCategory(str, Enum):
    POKEMON = "POKEMON"
    TRAINER = "TRAINER"
    ENERGY = "ENERGY"


class CardSubCategory(str, Enum):
    BASIC = "BASIC"
    STAGE_1 = "STAGE_1"
    STAGE_2 = "STAGE_2"
    SUPPORTER = "SUPPORTER"
    ITEM = "ITEM"
    STADIUM = "STADIUM"
    TOOL = "TOOL"
    BASIC_ENERGY = "BASIC_ENERGY"
    SPECIAL_ENERGY = "SPECIAL_ENERGY"


class ActionType(str, Enum):
    PLAY_FROM_HAND = "PLAY_FROM_HAND"
    EVOLVE = "EVOLVE"
    USE_ABILITY = "USE_ABILITY"
    ATTACH_ENERGY = "ATTACH_ENERGY"
    RETREAT = "RETREAT"
    ATTACK = "ATTACK"


class TimingPhase(str, Enum):
    PREPARATION = "PREPARATION"
    MAIN_PHASE_1 = "MAIN_PHASE_1"
    MAIN_PHASE_2 = "MAIN_PHASE_2"
    ATTACK_PHASE = "ATTACK_PHASE"


class EffectPrimitive(str, Enum):
    SEARCH_DECK = "SEARCH_DECK"
    DRAW_CARDS = "DRAW_CARDS"
    DAMAGE_ACTIVE = "DAMAGE_ACTIVE"
    DAMAGE_BENCH = "DAMAGE_BENCH"
    ATTACH_ENERGY = "ATTACH_ENERGY"
    DISCARD_CARDS = "DISCARD_CARDS"
    HEAL = "HEAL"
    SWITCH_ACTIVE = "SWITCH_ACTIVE"
    APPLY_SPECIAL_CONDITION = "APPLY_SPECIAL_CONDITION"
    EVOLVE_POKEMON = "EVOLVE_POKEMON"
    SHUFFLE_HAND_DRAW = "SHUFFLE_HAND_DRAW"
    RECOVER_FROM_DISCARD = "RECOVER_FROM_DISCARD"


class AIRole(str, Enum):
    MAIN_ATTACKER = "MAIN_ATTACKER"
    SECONDARY_ATTACKER = "SECONDARY_ATTACKER"
    DRAW_ENGINE = "DRAW_ENGINE"
    ENERGY_ACCELERATOR = "ENERGY_ACCELERATOR"
    GUEST_TECH = "GUEST_TECH"
    DISRUPTION = "DISRUPTION"
    CONSISTENCY_BOOSTER = "CONSISTENCY_BOOSTER"


# Alias de rétrocompatibilité
StrategicRole = AIRole
ActionSourceType = ActionType
ActionTiming = TimingPhase


# ============================================================================
# FONCTIONS DE COERCITION ET TOLÉRANCE AUX VARIATIONS LLM
# ============================================================================


def _clean_enum_key(val: Any) -> str:
    if isinstance(val, Enum):
        return str(val.value).strip().upper()
    s = str(val or "").strip().upper()
    s = re.sub(r"[\s\-]+", "_", s)
    return s


def _coerce_bool(val: Any, default: bool = False) -> bool:
    if isinstance(val, bool):
        return val
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return bool(val)
    s = str(val).strip().lower()
    if s in {"true", "1", "yes", "oui", "vrai"}:
        return True
    if s in {"false", "0", "no", "non", "faux", "none", "null", ""}:
        return False
    return default


def _coerce_optional_int(val: Any) -> Optional[int]:
    if val is None or isinstance(val, bool):
        return None
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(val)
    s = str(val).strip()
    if not s or s.lower() in {"none", "null", "n/a", "na", "-"}:
        return None
    m = re.search(r"-?\d+", s)
    if m:
        try:
            return int(m.group(0))
        except ValueError:
            return None
    return None


def _coerce_card_category(val: Any) -> CardCategory:
    key = _clean_enum_key(val)
    if "POK" in key:
        return CardCategory.POKEMON
    if "ENERG" in key:
        return CardCategory.ENERGY
    if key in {"TRAINER", "DRESSEUR", "SUPPORTER", "ITEM", "OBJET", "STADIUM", "STADE", "TOOL", "OUTIL"}:
        return CardCategory.TRAINER
    try:
        return CardCategory(key)
    except ValueError:
        return CardCategory.POKEMON


def _coerce_card_subcategory(val: Any) -> CardSubCategory:
    key = _clean_enum_key(val)
    mapping = {
        "BASIC": CardSubCategory.BASIC,
        "BASE": CardSubCategory.BASIC,
        "STAGE_1": CardSubCategory.STAGE_1,
        "STAGE1": CardSubCategory.STAGE_1,
        "NIVEAU_1": CardSubCategory.STAGE_1,
        "STAGE_2": CardSubCategory.STAGE_2,
        "STAGE2": CardSubCategory.STAGE_2,
        "NIVEAU_2": CardSubCategory.STAGE_2,
        "SUPPORTER": CardSubCategory.SUPPORTER,
        "ITEM": CardSubCategory.ITEM,
        "OBJET": CardSubCategory.ITEM,
        "STADIUM": CardSubCategory.STADIUM,
        "STADE": CardSubCategory.STADIUM,
        "TOOL": CardSubCategory.TOOL,
        "POKEMON_TOOL": CardSubCategory.TOOL,
        "OUTIL": CardSubCategory.TOOL,
        "BASIC_ENERGY": CardSubCategory.BASIC_ENERGY,
        "ENERGIE_DE_BASE": CardSubCategory.BASIC_ENERGY,
        "SPECIAL_ENERGY": CardSubCategory.SPECIAL_ENERGY,
        "ENERGIE_SPECIALE": CardSubCategory.SPECIAL_ENERGY,
    }
    if key in mapping:
        return mapping[key]
    try:
        return CardSubCategory(key)
    except ValueError:
        return CardSubCategory.BASIC


def _coerce_action_type(val: Any) -> ActionType:
    key = _clean_enum_key(val)
    mapping = {
        "PLAY_FROM_HAND": ActionType.PLAY_FROM_HAND,
        "TRAINER_PLAY": ActionType.PLAY_FROM_HAND,
        "PLAY_CARD": ActionType.PLAY_FROM_HAND,
        "PLAY_POKEMON": ActionType.PLAY_FROM_HAND,
        "PLAY_TRAINER": ActionType.PLAY_FROM_HAND,
        "STADIUM_EFFECT": ActionType.PLAY_FROM_HAND,
        "TOOL_STATIC_MODIFIER": ActionType.PLAY_FROM_HAND,
        "EVOLVE": ActionType.EVOLVE,
        "EVOLVE_POKEMON": ActionType.EVOLVE,
        "USE_ABILITY": ActionType.USE_ABILITY,
        "ABILITY": ActionType.USE_ABILITY,
        "ABILITY_ACTIVATED": ActionType.USE_ABILITY,
        "ABILITY_ON_EVOLVE": ActionType.USE_ABILITY,
        "ABILITY_ON_PLAY_FROM_HAND": ActionType.USE_ABILITY,
        "ABILITY_PASSIVE": ActionType.USE_ABILITY,
        "ABILITY_REACTIVE": ActionType.USE_ABILITY,
        "ATTACH_ENERGY": ActionType.ATTACH_ENERGY,
        "SPECIAL_ENERGY_EFFECT": ActionType.ATTACH_ENERGY,
        "ENERGY_ATTACHMENT": ActionType.ATTACH_ENERGY,
        "RETREAT": ActionType.RETREAT,
        "RETREAT_ACTION": ActionType.RETREAT,
        "ATTACK": ActionType.ATTACK,
    }
    if key in mapping:
        return mapping[key]
    if "ABILITY" in key or "TALENT" in key:
        return ActionType.USE_ABILITY
    if "ATTACK" in key or "ATTAQUE" in key:
        return ActionType.ATTACK
    if "EVOLV" in key:
        return ActionType.EVOLVE
    if "RETREAT" in key or "RETRAITE" in key:
        return ActionType.RETREAT
    if "ENERG" in key or "ATTACH" in key:
        return ActionType.ATTACH_ENERGY
    return ActionType.PLAY_FROM_HAND


def _coerce_timing_phase(val: Any) -> TimingPhase:
    key = _clean_enum_key(val)
    mapping = {
        "PREPARATION": TimingPhase.PREPARATION,
        "SETUP": TimingPhase.PREPARATION,
        "MAIN_PHASE_1": TimingPhase.MAIN_PHASE_1,
        "MAIN_PHASE": TimingPhase.MAIN_PHASE_1,
        "ONCE_PER_TURN_SUPPORTER": TimingPhase.MAIN_PHASE_1,
        "ONCE_PER_TURN_ABILITY": TimingPhase.MAIN_PHASE_1,
        "ONCE_PER_TURN_STADIUM": TimingPhase.MAIN_PHASE_1,
        "ONCE_PER_CARD": TimingPhase.MAIN_PHASE_1,
        "ON_EVOLVE_TRIGGER": TimingPhase.MAIN_PHASE_1,
        "ON_PLAY_FROM_HAND_TRIGGER": TimingPhase.MAIN_PHASE_1,
        "ON_ATTACH_TRIGGER": TimingPhase.MAIN_PHASE_1,
        "PASSIVE_CONTINUOUS": TimingPhase.MAIN_PHASE_1,
        "MAIN_PHASE_2": TimingPhase.MAIN_PHASE_2,
        "BETWEEN_TURNS_CHECKUP": TimingPhase.MAIN_PHASE_2,
        "ON_DAMAGED_OR_KO_TRIGGER": TimingPhase.ATTACK_PHASE,
        "ATTACK_PHASE": TimingPhase.ATTACK_PHASE,
        "END_OF_TURN_ATTACK": TimingPhase.ATTACK_PHASE,
        "ATTACK": TimingPhase.ATTACK_PHASE,
    }
    if key in mapping:
        return mapping[key]
    if "ATTACK" in key:
        return TimingPhase.ATTACK_PHASE
    if "MAIN_PHASE_2" in key or "PHASE_2" in key:
        return TimingPhase.MAIN_PHASE_2
    if "PREP" in key:
        return TimingPhase.PREPARATION
    return TimingPhase.MAIN_PHASE_1


def _coerce_effect_primitive(val: Any) -> EffectPrimitive:
    key = _clean_enum_key(val)
    try:
        return EffectPrimitive(key)
    except ValueError:
        pass

    synonyms: Dict[str, EffectPrimitive] = {
        # SEARCH_DECK
        "SEARCH_DECK_TO_HAND": EffectPrimitive.SEARCH_DECK,
        "SEARCH_DECK_TO_BENCH": EffectPrimitive.SEARCH_DECK,
        "SEARCH_DECK_AND_PUT_ON_BENCH": EffectPrimitive.SEARCH_DECK,
        "SEARCH_CARD": EffectPrimitive.SEARCH_DECK,
        "SEARCH": EffectPrimitive.SEARCH_DECK,
        "TUTOR": EffectPrimitive.SEARCH_DECK,
        "LOOK_TOP_DECK": EffectPrimitive.SEARCH_DECK,
        # DRAW_CARDS
        "DRAW": EffectPrimitive.DRAW_CARDS,
        "DRAW_CARD": EffectPrimitive.DRAW_CARDS,
        "DRAW_UNTIL_HAND_SIZE": EffectPrimitive.DRAW_CARDS,
        "DRAW_UNTIL": EffectPrimitive.DRAW_CARDS,
        # DAMAGE_ACTIVE
        "DEAL_DAMAGE_ACTIVE": EffectPrimitive.DAMAGE_ACTIVE,
        "DEAL_DAMAGE": EffectPrimitive.DAMAGE_ACTIVE,
        "DAMAGE": EffectPrimitive.DAMAGE_ACTIVE,
        "ATTACK_DAMAGE": EffectPrimitive.DAMAGE_ACTIVE,
        "COIN_FLIP_DAMAGE": EffectPrimitive.DAMAGE_ACTIVE,
        "COIN_FLIP": EffectPrimitive.DAMAGE_ACTIVE,
        "FLIP_COIN": EffectPrimitive.DAMAGE_ACTIVE,
        "BONUS_DAMAGE": EffectPrimitive.DAMAGE_ACTIVE,
        "EXTRA_DAMAGE": EffectPrimitive.DAMAGE_ACTIVE,
        "PASSIVE_DAMAGE_BOOST": EffectPrimitive.DAMAGE_ACTIVE,
        # DAMAGE_BENCH
        "DEAL_DAMAGE_BENCH": EffectPrimitive.DAMAGE_BENCH,
        "PLACE_DAMAGE_COUNTERS": EffectPrimitive.DAMAGE_BENCH,
        "PUT_DAMAGE_COUNTERS": EffectPrimitive.DAMAGE_BENCH,
        "SNIPE_BENCH": EffectPrimitive.DAMAGE_BENCH,
        "SPREAD_DAMAGE": EffectPrimitive.DAMAGE_BENCH,
        # ATTACH_ENERGY
        "ATTACH_ENERGY_FROM_HAND": EffectPrimitive.ATTACH_ENERGY,
        "ATTACH_ENERGY_FROM_DISCARD": EffectPrimitive.ATTACH_ENERGY,
        "ATTACH_ENERGY_FROM_DECK": EffectPrimitive.ATTACH_ENERGY,
        "SEARCH_AND_ATTACH_ENERGY": EffectPrimitive.ATTACH_ENERGY,
        "ACCELERATE_ENERGY": EffectPrimitive.ATTACH_ENERGY,
        "MOVE_ENERGY_BETWEEN_POKEMON": EffectPrimitive.ATTACH_ENERGY,
        "MOVE_ENERGY": EffectPrimitive.ATTACH_ENERGY,
        "PROVIDE_ENERGY": EffectPrimitive.ATTACH_ENERGY,
        # DISCARD_CARDS
        "DISCARD": EffectPrimitive.DISCARD_CARDS,
        "DISCARD_FROM_HAND": EffectPrimitive.DISCARD_CARDS,
        "DISCARD_HAND": EffectPrimitive.DISCARD_CARDS,
        "DISCARD_ENERGY": EffectPrimitive.DISCARD_CARDS,
        "DISCARD_STADIUM": EffectPrimitive.DISCARD_CARDS,
        "DISCARD_TOOL": EffectPrimitive.DISCARD_CARDS,
        # HEAL
        "HEAL_DAMAGE": EffectPrimitive.HEAL,
        "HEAL_POKEMON": EffectPrimitive.HEAL,
        "REMOVE_DAMAGE_COUNTERS": EffectPrimitive.HEAL,
        "PASSIVE_DAMAGE_REDUCTION": EffectPrimitive.HEAL,
        "PASSIVE_PREVENT_DAMAGE_OR_EFFECTS": EffectPrimitive.HEAL,
        # SWITCH_ACTIVE
        "SWITCH_ACTIVE_POKEMON": EffectPrimitive.SWITCH_ACTIVE,
        "GUST_OPPONENT_BENCH_TO_ACTIVE": EffectPrimitive.SWITCH_ACTIVE,
        "SWITCH_OPPONENT_ACTIVE": EffectPrimitive.SWITCH_ACTIVE,
        "SWITCH": EffectPrimitive.SWITCH_ACTIVE,
        "GUST": EffectPrimitive.SWITCH_ACTIVE,
        "RETREAT": EffectPrimitive.SWITCH_ACTIVE,
        "PASSIVE_RETREAT_COST_MOD": EffectPrimitive.SWITCH_ACTIVE,
        # APPLY_SPECIAL_CONDITION
        "SPECIAL_CONDITION": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        "STATUS_CONDITION": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        "POISON": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        "BURN": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        "SLEEP": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        "PARALYZE": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        "CONFUSE": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        "PASSIVE_ABILITY_OR_ITEM_LOCK": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        # EVOLVE_POKEMON
        "EVOLVE_SKIP_STAGE_1": EffectPrimitive.EVOLVE_POKEMON,
        "EVOLVE_FROM_HAND": EffectPrimitive.EVOLVE_POKEMON,
        "EVOLVE_FROM_DECK": EffectPrimitive.EVOLVE_POKEMON,
        "EVOLVE": EffectPrimitive.EVOLVE_POKEMON,
        "USE_STAGE_2_CARD": EffectPrimitive.EVOLVE_POKEMON,
        # SHUFFLE_HAND_DRAW
        "SHUFFLE_HAND_AND_DRAW": EffectPrimitive.SHUFFLE_HAND_DRAW,
        "SHUFFLE_AND_DRAW": EffectPrimitive.SHUFFLE_HAND_DRAW,
        "RESET_HAND": EffectPrimitive.SHUFFLE_HAND_DRAW,
        "IONO_EFFECT": EffectPrimitive.SHUFFLE_HAND_DRAW,
        # RECOVER_FROM_DISCARD
        "RECOVER_FROM_DISCARD_TO_HAND": EffectPrimitive.RECOVER_FROM_DISCARD,
        "RECOVER_FROM_DISCARD_TO_DECK": EffectPrimitive.RECOVER_FROM_DISCARD,
        "RECOVER_FROM_DISCARD_TO_BENCH": EffectPrimitive.RECOVER_FROM_DISCARD,
        "RECOVER_CARDS": EffectPrimitive.RECOVER_FROM_DISCARD,
        "RECOVER": EffectPrimitive.RECOVER_FROM_DISCARD,
    }
    if key in synonyms:
        return synonyms[key]

    if "SEARCH" in key and "ENERG" in key and "ATTACH" in key:
        return EffectPrimitive.ATTACH_ENERGY
    if "SEARCH" in key or "FIND" in key or "TUTOR" in key:
        return EffectPrimitive.SEARCH_DECK
    if "SHUFFLE" in key and "DRAW" in key:
        return EffectPrimitive.SHUFFLE_HAND_DRAW
    if "DRAW" in key or "PIOCH" in key:
        return EffectPrimitive.DRAW_CARDS
    if "BENCH" in key and ("DAMAGE" in key or "COUNTER" in key):
        return EffectPrimitive.DAMAGE_BENCH
    if "DAMAGE" in key or "DEGAT" in key or "ATTACK" in key:
        return EffectPrimitive.DAMAGE_ACTIVE
    if "ENERG" in key or "ATTACH" in key:
        return EffectPrimitive.ATTACH_ENERGY
    if "DISCARD" in key or "DEFAUSS" in key:
        return EffectPrimitive.DISCARD_CARDS
    if "HEAL" in key or "SOIN" in key or "SOIGN" in key:
        return EffectPrimitive.HEAL
    if "SWITCH" in key or "GUST" in key or "SWAP" in key:
        return EffectPrimitive.SWITCH_ACTIVE
    if "EVOLV" in key or "STAGE" in key:
        return EffectPrimitive.EVOLVE_POKEMON
    if "RECOVER" in key or "RETRIEVE" in key:
        return EffectPrimitive.RECOVER_FROM_DISCARD
    if "CONDITION" in key or "STATUS" in key or "LOCK" in key:
        return EffectPrimitive.APPLY_SPECIAL_CONDITION

    return EffectPrimitive.DRAW_CARDS


def _coerce_ai_role(val: Any) -> AIRole:
    key = _clean_enum_key(val)
    try:
        return AIRole(key)
    except ValueError:
        pass

    synonyms: Dict[str, AIRole] = {
        "MAIN_ATTACKER": AIRole.MAIN_ATTACKER,
        "ATTACKER": AIRole.MAIN_ATTACKER,
        "PRIMARY_ATTACKER": AIRole.MAIN_ATTACKER,
        "SWEEPER": AIRole.MAIN_ATTACKER,
        "SECONDARY_ATTACKER": AIRole.SECONDARY_ATTACKER,
        "FINISHER": AIRole.SECONDARY_ATTACKER,
        "BENCH_SNIPER": AIRole.SECONDARY_ATTACKER,
        "SUB_ATTACKER": AIRole.SECONDARY_ATTACKER,
        "DRAW_ENGINE": AIRole.DRAW_ENGINE,
        "DRAW_SUPPORT": AIRole.DRAW_ENGINE,
        "DRAW": AIRole.DRAW_ENGINE,
        "ENERGY_ACCELERATOR": AIRole.ENERGY_ACCELERATOR,
        "RESOURCE_ENERGY": AIRole.ENERGY_ACCELERATOR,
        "ENERGY_PROVIDER": AIRole.ENERGY_ACCELERATOR,
        "RAMP": AIRole.ENERGY_ACCELERATOR,
        "GUEST_TECH": AIRole.GUEST_TECH,
        "TECH": AIRole.GUEST_TECH,
        "UTILITY": AIRole.GUEST_TECH,
        "SUPPORT_UTILITY": AIRole.GUEST_TECH,
        "PIVOT_MOBILITY": AIRole.GUEST_TECH,
        "RECOVERY_UTILITY": AIRole.GUEST_TECH,
        "STADIUM_CONTROL": AIRole.GUEST_TECH,
        "DISRUPTION": AIRole.DISRUPTION,
        "GUST_DISRUPTION": AIRole.DISRUPTION,
        "HAND_DISRUPTION": AIRole.DISRUPTION,
        "CONTROL_STALL": AIRole.DISRUPTION,
        "CONTROL": AIRole.DISRUPTION,
        "STALL": AIRole.DISRUPTION,
        "STALL_WALL": AIRole.DISRUPTION,
        "CONSISTENCY_BOOSTER": AIRole.CONSISTENCY_BOOSTER,
        "BENCH_DEPLOYER": AIRole.CONSISTENCY_BOOSTER,
        "CONSISTENCY_TUTOR": AIRole.CONSISTENCY_BOOSTER,
        "EVOLUTION_ACCELERATOR": AIRole.CONSISTENCY_BOOSTER,
        "TECH_UTILITY": AIRole.GUEST_TECH,
        "CONSISTENCY_TUTOR": AIRole.CONSISTENCY_BOOSTER,
        "EVOLUTION_ACCELERATOR": AIRole.CONSISTENCY_BOOSTER,
        "SEARCH_ENGINE": AIRole.CONSISTENCY_BOOSTER,
        "TUTOR": AIRole.CONSISTENCY_BOOSTER,
        "SETUP": AIRole.CONSISTENCY_BOOSTER,
    }
    if key in synonyms:
        return synonyms[key]

    if "MAIN" in key or "ATTACK" in key:
        return AIRole.MAIN_ATTACKER
    if "SECOND" in key or "SNIP" in key or "FINISH" in key:
        return AIRole.SECONDARY_ATTACKER
    if "DRAW" in key:
        return AIRole.DRAW_ENGINE
    if "ENERG" in key:
        return AIRole.ENERGY_ACCELERATOR
    if "DISRUPT" in key or "GUST" in key or "STALL" in key or "CONTROL" in key:
        return AIRole.DISRUPTION
    if "CONSIST" in key or "TUTOR" in key or "EVOLV" in key or "SEARCH" in key:
        return AIRole.CONSISTENCY_BOOSTER
    return AIRole.GUEST_TECH


# ============================================================================
# B. STRUCTURE DE EngineCardModel (MODÈLE FINAL)
# ============================================================================


class TypeModifier(BaseModel):
    """Modificateur de faiblesse ou de résistance d'un Pokémon."""

    model_config = ConfigDict(extra="ignore")

    type: str = Field(description="Type d'énergie (ex: 'Combat', 'Feu', 'Métal')")
    value: str = Field(default="×2", description="Valeur du modificateur (ex: '×2', '-30')")

    @model_validator(mode="before")
    @classmethod
    def _coerce_from_scalar_or_dict(cls, data: Any) -> Any:
        if isinstance(data, str):
            return {"type": data.strip(), "value": "×2"}
        if isinstance(data, dict):
            t = str(data.get("type") or "Incolore").strip()
            v = data.get("value")
            v_str = str(v).strip() if v is not None else "×2"
            return {"type": t, "value": v_str}
        return data


class CardIdentity(BaseModel):
    """Identité déterministe complète de la carte extraite depuis TCGdex."""

    model_config = ConfigDict(extra="ignore")

    cardId: str = Field(description="Identifiant unique TCGdex (ex: 'me01-104', 'sv03-125')")
    nameFr: str = Field(description="Nom officiel en français")
    nameEn: Optional[str] = Field(default=None, description="Nom officiel en anglais")
    setId: str = Field(default="", description="Code de l'extension (ex: 'me01', 'sv03')")
    setName: Optional[str] = Field(default=None, description="Nom de l'extension")
    category: CardCategory = Field(description="Catégorie principale (POKEMON, TRAINER, ENERGY)")
    subCategory: CardSubCategory = Field(description="Sous-catégorie précise")
    isRuleBox: bool = Field(default=False, description="Possède un encadré Règle (ex, V, VSTAR, VMAX, Radieux)")
    prizeCardsGiven: int = Field(default=1, ge=1, le=3, description="Nombre de cartes Récompense données si mis K.O. (1, 2 ou 3)")
    isAceSpec: bool = Field(default=False, description="Carte HIGH-TECH / ACE SPEC (max 1 par deck)")
    isAncient: bool = Field(default=False, description="Carte Temps passé (Ancient)")
    isFuture: bool = Field(default=False, description="Carte Temps futur (Future)")
    isTera: bool = Field(default=False, description="Pokémon Téracristal (immunisé aux dégâts d'attaques sur le Banc)")
    legalStandard: bool = Field(default=True, description="Légal au format Standard")
    legalExpanded: bool = Field(default=True, description="Légal au format Étendu")

    # Champs de métadonnées complémentaires optionnels (rétrocompatibilité)
    localId: Optional[str] = Field(default=None, description="Numéro local dans l'extension")
    regulationMark: Optional[str] = Field(default=None, description="Marque de régulation (G, H, I...)")
    rarity: Optional[str] = Field(default=None, description="Rareté officielle")
    imageUrl: Optional[str] = Field(default=None, description="URL de l'image haute résolution")
    isTechnicalMachine: bool = Field(default=False, description="Outil Capsule Technique (CT / TM)")
    rawRulesText: List[str] = Field(default_factory=list, description="Textes bruts FR/EN consolidés")

    @field_validator("category", mode="before")
    @classmethod
    def _val_category(cls, v: Any) -> CardCategory:
        return _coerce_card_category(v)

    @field_validator("subCategory", mode="before")
    @classmethod
    def _val_subcategory(cls, v: Any) -> CardSubCategory:
        return _coerce_card_subcategory(v)

    @field_validator("prizeCardsGiven", mode="before")
    @classmethod
    def _val_prizes(cls, v: Any) -> int:
        parsed = _coerce_optional_int(v)
        if parsed is None:
            return 1
        return max(1, min(3, parsed))


class PokemonStats(BaseModel):
    """Statistiques déterministes d'une carte Pokémon."""

    model_config = ConfigDict(extra="ignore")

    hp: int = Field(default=0, ge=0, description="Points de Vie (PV)")
    types: List[str] = Field(default_factory=list, description="Types du Pokémon (ex: ['Incolore'], ['Feu'])")
    stage: str = Field(default="Base", description="Stade d'évolution ('Base', 'Niveau 1', 'Niveau 2')")
    evolvesFrom: Optional[str] = Field(default=None, description="Nom du Pokémon pré-évolution direct")
    rootBasicName: str = Field(default="", description="Nom du Pokémon de Base racine de la lignée")
    evolutionChain: List[str] = Field(default_factory=list, description="Chaîne complète d'évolution")
    retreatCost: int = Field(default=0, ge=0, description="Coût de retraite en Énergies Incolores")
    weaknesses: List[TypeModifier] = Field(default_factory=list, description="Faiblesses typées")
    resistances: List[TypeModifier] = Field(default_factory=list, description="Résistances typées")

    @model_validator(mode="before")
    @classmethod
    def _normalize_pokemon_stats(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        out = dict(data)

        # Normalisation de stage
        raw_stage = str(out.get("stage") or "Base").strip()
        low_stage = raw_stage.lower()
        if "2" in low_stage:
            out["stage"] = "Niveau 2"
        elif "1" in low_stage or "vmax" in low_stage or "vstar" in low_stage:
            out["stage"] = "Niveau 1"
        else:
            out["stage"] = "Base"

        # Normalisation de rootBasicName
        if not out.get("rootBasicName"):
            evo_chain = out.get("evolutionChain")
            if isinstance(evo_chain, list) and evo_chain:
                out["rootBasicName"] = str(evo_chain[0])
            elif out.get("evolvesFrom"):
                out["rootBasicName"] = str(out["evolvesFrom"])
            else:
                out["rootBasicName"] = ""

        # Normalisation de weaknesses / resistances si fournis sous forme de listes de strings
        weak_mult = str(out.get("weaknessMultiplier") or "×2")
        raw_w = out.get("weaknesses")
        if isinstance(raw_w, list):
            norm_w = []
            for item in raw_w:
                if isinstance(item, str):
                    norm_w.append({"type": item, "value": weak_mult})
                elif isinstance(item, (dict, TypeModifier)):
                    norm_w.append(item)
            out["weaknesses"] = norm_w
        elif raw_w is None:
            out["weaknesses"] = []

        res_mod = out.get("resistanceModifier", "-30")
        res_mod_str = str(res_mod) if res_mod is not None else "-30"
        raw_r = out.get("resistances")
        if isinstance(raw_r, list):
            norm_r = []
            for item in raw_r:
                if isinstance(item, str):
                    norm_r.append({"type": item, "value": res_mod_str})
                elif isinstance(item, (dict, TypeModifier)):
                    norm_r.append(item)
            out["resistances"] = norm_r
        elif raw_r is None:
            out["resistances"] = []

        return out


class AtomicEffect(BaseModel):
    """Effet atomique normalisé exécuté par une action."""

    model_config = ConfigDict(extra="ignore")

    primitive: EffectPrimitive = Field(description="Primitive d'effet normalisée")
    target: Optional[str] = Field(
        default=None,
        description="Cible de l'effet (ex: 'SELF', 'OPPONENT_ACTIVE', 'OPPONENT_BENCH', 'OWN_BENCH', 'OWN_POKEMON_ANY', 'PLAYER')",
    )
    value: Optional[int] = Field(
        default=None,
        description="Valeur numérique de l'effet (ex: 200 pour les dégâts ou le soin)",
    )
    count: Optional[int] = Field(
        default=None,
        description="Nombre d'éléments affectés (ex: 2 cartes à piocher ou chercher)",
    )
    zone: Optional[str] = Field(
        default=None,
        description="Zone impliquée (ex: 'DECK', 'HAND', 'DISCARD', 'BENCH', 'ACTIVE')",
    )
    filter: Optional[str] = Field(
        default=None,
        description="Filtre normalisé (ex: 'CATEGORY:POKEMON|STAGE:BASIC|MAX_HP:70', 'CATEGORY:ENERGY|TYPE:Feu')",
    )
    upTo: bool = Field(default=False, description="Indique si le nombre est un maximum ('jusqu'à X')")
    optional: bool = Field(default=False, description="Indique si l'effet est facultatif ('vous pouvez')")

    @property
    def baseDamage(self) -> Optional[int]:
        """Propriété de rétrocompatibilité pointant sur `value`."""
        return self.value

    @model_validator(mode="before")
    @classmethod
    def _coerce_atomic_effect(cls, data: Any) -> Any:
        if isinstance(data, str):
            return {"primitive": _coerce_effect_primitive(data)}
        if not isinstance(data, dict):
            return data

        out = dict(data)
        out["primitive"] = _coerce_effect_primitive(
            out.get("primitive") or out.get("type") or out.get("effect") or "DRAW_CARDS"
        )

        # Compatibilité value <-> baseDamage / amount / damage / heal
        if out.get("value") is None:
            for alt_key in ("baseDamage", "damage", "amount", "heal", "damageScalingValue"):
                if out.get(alt_key) is not None:
                    out["value"] = out.get(alt_key)
                    break
        out["value"] = _coerce_optional_int(out.get("value"))

        # Compatibilité count
        out["count"] = _coerce_optional_int(out.get("count"))

        # Compatibilité target
        if out.get("target") is not None and not isinstance(out.get("target"), str):
            out["target"] = str(out["target"]).strip().upper()
        elif isinstance(out.get("target"), str):
            out["target"] = out["target"].strip() or None

        # Compatibilité zone <-> sourceZone / targetZone
        if out.get("zone") is None:
            src_z = out.get("sourceZone") or out.get("targetZone")
            if src_z is not None:
                out["zone"] = str(getattr(src_z, "value", src_z)).strip().upper()
        elif not isinstance(out.get("zone"), str):
            out["zone"] = str(out["zone"]).strip().upper()

        # Compatibilité filter <-> targetFilter
        raw_filter = out.get("filter") if out.get("filter") is not None else out.get("targetFilter")
        if isinstance(raw_filter, dict):
            parts = []
            for k, v in raw_filter.items():
                if v is not None and v != "":
                    val_str = getattr(v, "value", v)
                    parts.append(f"{str(k).upper()}:{val_str}")
            out["filter"] = "|".join(parts) if parts else None
        elif isinstance(raw_filter, BaseModel):
            dumped = raw_filter.model_dump(exclude_none=True)
            parts = [f"{str(k).upper()}:{getattr(v, 'value', v)}" for k, v in dumped.items()]
            out["filter"] = "|".join(parts) if parts else None
        elif raw_filter is not None:
            s_filt = str(raw_filter).strip()
            out["filter"] = s_filt if s_filt and s_filt.lower() not in {"none", "null"} else None
        else:
            out["filter"] = None

        out["upTo"] = _coerce_bool(out.get("upTo"), default=False)
        out["optional"] = _coerce_bool(out.get("optional"), default=False)
        return out


class PlayableAction(BaseModel):
    """Action jouable complète d'une carte Pokémon TCG."""

    model_config = ConfigDict(extra="ignore")

    actionId: str = Field(description="Identifiant unique de l'action (ex: 'play_from_hand', 'ability_0', 'attack_0', 'retreat')")
    label: str = Field(description="Nom lisible de l'action (ex: 'Course Fructueuse', 'Combo en Rafale')")
    actionType: ActionType = Field(description="Type d'action normalisé")
    timingPhase: TimingPhase = Field(default=TimingPhase.MAIN_PHASE_1, description="Phase du tour où l'action est exécutée")
    canUseTurn1GoingFirst: bool = Field(default=True, description="Autorisé au Tour 1 du joueur qui commence")
    canUseTurn1GoingSecond: bool = Field(default=True, description="Autorisé au Tour 1 du joueur qui joue en second")
    cost: Dict[str, int] = Field(default_factory=dict, description="Coût en énergie agrégé (ex: {'Feu': 2, 'Incolore': 1} ou {})")
    preconditions: List[str] = Field(
        default_factory=list,
        description="Conditions formelles normalisées (ex: ['SELF_IS_ACTIVE'], ['BENCH_HAS_EMPTY_SLOT'])",
    )
    effects: List[AtomicEffect] = Field(default_factory=list, description="Séquence d'effets atomiques")
    deadCardCondition: Optional[str] = Field(
        default=None,
        description="Condition rendant l'action/carte morte en main (ex: 'NO_STAGE_2_IN_HAND_OR_NO_BASIC_IN_PLAY')",
    )

    @property
    def sourceType(self) -> ActionType:
        """Propriété de rétrocompatibilité pointant sur `actionType`."""
        return self.actionType

    @property
    def timing(self) -> TimingPhase:
        """Propriété de rétrocompatibilité pointant sur `timingPhase`."""
        return self.timingPhase

    @model_validator(mode="before")
    @classmethod
    def _coerce_playable_action(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        out = dict(data)
        action_id = str(out.get("actionId") or out.get("id") or "action_0").strip()
        out["actionId"] = action_id
        out["label"] = str(out.get("label") or out.get("name") or action_id).strip()

        raw_atype = out.get("actionType") or out.get("sourceType") or out.get("type")
        if raw_atype is None:
            if action_id.startswith("attack"):
                raw_atype = ActionType.ATTACK
            elif action_id.startswith("ability"):
                raw_atype = ActionType.USE_ABILITY
            elif action_id.startswith("retreat"):
                raw_atype = ActionType.RETREAT
            elif action_id.startswith("evolve"):
                raw_atype = ActionType.EVOLVE
            elif action_id.startswith("attach"):
                raw_atype = ActionType.ATTACH_ENERGY
            else:
                raw_atype = ActionType.PLAY_FROM_HAND
        atype = _coerce_action_type(raw_atype)
        out["actionType"] = atype

        raw_timing = out.get("timingPhase") or out.get("timing")
        if raw_timing is None:
            raw_timing = TimingPhase.ATTACK_PHASE if atype == ActionType.ATTACK else TimingPhase.MAIN_PHASE_1
        out["timingPhase"] = _coerce_timing_phase(raw_timing)

        out["canUseTurn1GoingFirst"] = _coerce_bool(
            out.get("canUseTurn1GoingFirst"),
            default=(atype not in {ActionType.ATTACK, ActionType.EVOLVE}),
        )
        out["canUseTurn1GoingSecond"] = _coerce_bool(
            out.get("canUseTurn1GoingSecond"),
            default=(atype != ActionType.EVOLVE),
        )

        # Normalisation de cost (Dict[str, int])
        raw_cost = out.get("cost")
        if raw_cost is None and out.get("energyCost") is not None:
            raw_cost = out.get("energyCost")
        cost_dict: Dict[str, int] = {}
        if isinstance(raw_cost, dict):
            for k, v in raw_cost.items():
                iv = _coerce_optional_int(v)
                if iv is not None and iv > 0:
                    cost_dict[str(k).strip()] = iv
        elif isinstance(raw_cost, list):
            for item in raw_cost:
                if isinstance(item, str) and item.strip():
                    k = item.strip()
                    cost_dict[k] = cost_dict.get(k, 0) + 1
                elif isinstance(item, dict):
                    k = str(item.get("type") or "Incolore").strip()
                    iv = _coerce_optional_int(item.get("count", 1)) or 1
                    cost_dict[k] = cost_dict.get(k, 0) + iv
        out["cost"] = cost_dict

        # Normalisation de preconditions (List[str])
        raw_pre = out.get("preconditions")
        pre_list: List[str] = []
        if isinstance(raw_pre, list):
            for p in raw_pre:
                if isinstance(p, str) and p.strip():
                    pre_list.append(p.strip())
                elif isinstance(p, dict):
                    ptype = str(p.get("type") or p.get("condition") or "").strip()
                    if ptype:
                        pre_list.append(ptype)
                elif hasattr(p, "type"):
                    pre_list.append(str(getattr(p.type, "value", p.type)))
        elif isinstance(raw_pre, str) and raw_pre.strip():
            pre_list.append(raw_pre.strip())
        out["preconditions"] = pre_list

        # Normalisation de effects (List[AtomicEffect])
        raw_effs = out.get("effects")
        if raw_effs is None and isinstance(out.get("primitives"), list):
            raw_effs = [{"primitive": p} for p in out["primitives"]]
        if not isinstance(raw_effs, list):
            raw_effs = []
        out["effects"] = raw_effs

        # Normalisation de deadCardCondition
        dead_cond = out.get("deadCardCondition")
        if isinstance(dead_cond, list):
            dead_cond = "|".join(str(x).strip() for x in dead_cond if str(x).strip()) or None
        elif isinstance(dead_cond, dict):
            dead_cond = str(dead_cond.get("reason") or dead_cond.get("condition") or "").strip() or None
        elif dead_cond is not None:
            dead_cond = str(dead_cond).strip() or None
            if dead_cond and dead_cond.lower() in {"none", "null", "n/a"}:
                dead_cond = None
        out["deadCardCondition"] = dead_cond

        return out


class TurnPhaseWeights(BaseModel):
    """Poids stratégiques par phase de la partie (bornés strictement entre 0.0 et 1.0)."""

    model_config = ConfigDict(extra="ignore")

    turn1: float = Field(default=0.8, ge=0.0, le=1.0, description="Poids stratégique au Tour 1 (0.0 à 1.0)")
    turn2: float = Field(default=0.8, ge=0.0, le=1.0, description="Poids stratégique au Tour 2 (0.0 à 1.0)")
    turn3: float = Field(default=0.8, ge=0.0, le=1.0, description="Poids stratégique au Tour 3 (0.0 à 1.0)")
    turn4Plus: float = Field(default=0.8, ge=0.0, le=1.0, description="Poids stratégique au Tour 4 et + (0.0 à 1.0)")

    @model_validator(mode="before")
    @classmethod
    def _clamp_and_normalize_weights(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return {"turn1": 0.8, "turn2": 0.8, "turn3": 0.8, "turn4Plus": 0.8}

        def _extract_clamped(keys: List[str], default: float = 0.8) -> float:
            for k in keys:
                if k in data and data[k] is not None:
                    try:
                        val = float(data[k])
                        return round(max(0.0, min(1.0, val)), 4)
                    except (TypeError, ValueError):
                        continue
            return default

        return {
            "turn1": _extract_clamped(["turn1", "turn_1", "T1", "PREPARATION", "earlyGame"], 0.8),
            "turn2": _extract_clamped(["turn2", "turn_2", "T2", "MAIN_PHASE_1", "midGame"], 0.8),
            "turn3": _extract_clamped(["turn3", "turn_3", "T3", "MAIN_PHASE_2"], 0.8),
            "turn4Plus": _extract_clamped(["turn4Plus", "turn4_plus", "turn4", "T4", "END_PHASE", "lateGame"], 0.8),
        }


class StrategicEvaluator(BaseModel):
    """Profil d'évaluation stratégique de la carte pour le moteur heuristique / MCTS."""

    model_config = ConfigDict(extra="ignore")

    aiRole: AIRole = Field(default=AIRole.GUEST_TECH, description="Rôle stratégique principal de la carte")
    turnPhaseWeights: TurnPhaseWeights = Field(
        default_factory=TurnPhaseWeights,
        description="Poids d'importance selon l'avancement de la partie (bornés entre 0.0 et 1.0)",
    )
    decklistSynergyRequirements: List[str] = Field(
        default_factory=list,
        description="Exigences de synergie de deck (ex: ['requires_energy_type:Feu', 'requires_evolution_line:Salamèche'])",
    )

    @property
    def primaryRole(self) -> AIRole:
        """Propriété de rétrocompatibilité pointant sur `aiRole`."""
        return self.aiRole

    @model_validator(mode="before")
    @classmethod
    def _coerce_strategic_evaluator(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return {
                "aiRole": AIRole.GUEST_TECH,
                "turnPhaseWeights": TurnPhaseWeights(),
                "decklistSynergyRequirements": [],
            }
        out = dict(data)
        raw_role = out.get("aiRole") or out.get("primaryRole") or out.get("role") or AIRole.GUEST_TECH
        out["aiRole"] = _coerce_ai_role(raw_role)

        if not isinstance(out.get("turnPhaseWeights"), (dict, TurnPhaseWeights)):
            out["turnPhaseWeights"] = {}

        raw_syn = out.get("decklistSynergyRequirements")
        syn_list: List[str] = []
        if isinstance(raw_syn, list):
            for item in raw_syn:
                if isinstance(item, str) and item.strip():
                    syn_list.append(item.strip())
                elif isinstance(item, dict):
                    rf = item.get("requiredFilter") or {}
                    if isinstance(rf, dict):
                        if rf.get("energyType"):
                            syn_list.append(f"requires_energy_type:{rf['energyType']}")
                        elif rf.get("specificCardName"):
                            syn_list.append(f"requires_evolution_line:{rf['specificCardName']}")
                        elif rf.get("subCategory"):
                            syn_list.append(f"requires_subcategory:{rf['subCategory']}")
                        elif rf.get("category"):
                            syn_list.append(f"requires_category:{rf['category']}")
        out["decklistSynergyRequirements"] = list(dict.fromkeys(syn_list))
        return out


# ============================================================================
# C. LE SCHÉMA MICRO-CIBLÉ POUR L'IA (LLMCompiledPayload)
# ============================================================================


class LLMTranslatedSlot(BaseModel):
    """Traduction formelle d'un slot d'effet individuel par l'IA de Passe 2."""

    model_config = ConfigDict(extra="ignore")

    slotId: str = Field(
        description="Identifiant exact du slot fourni en entrée (ex: 'ability_0', 'attack_0', 'trainer_0')"
    )
    preconditions: List[str] = Field(
        default_factory=list,
        description="Conditions requises dans le texte pour activer cet effet",
    )
    effects: List[AtomicEffect] = Field(
        default_factory=list,
        description="Séquence ordonnée de primitives atomiques traduisant l'effet",
    )
    deadCardCondition: Optional[str] = Field(
        default=None,
        description="Condition rendant cette action/carte morte en main",
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce_slot(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        out = dict(data)
        out["slotId"] = str(out.get("slotId") or out.get("actionId") or out.get("id") or "slot_0").strip()

        raw_pre = out.get("preconditions")
        pre_list: List[str] = []
        if isinstance(raw_pre, list):
            for p in raw_pre:
                if isinstance(p, str) and p.strip():
                    pre_list.append(p.strip())
                elif isinstance(p, dict):
                    ptype = str(p.get("type") or p.get("condition") or "").strip()
                    if ptype:
                        pre_list.append(ptype)
        elif isinstance(raw_pre, str) and raw_pre.strip():
            pre_list.append(raw_pre.strip())
        out["preconditions"] = pre_list

        raw_effs = out.get("effects")
        if raw_effs is None and isinstance(out.get("primitives"), list):
            raw_effs = [{"primitive": p} for p in out["primitives"]]
        if not isinstance(raw_effs, list):
            raw_effs = []
        out["effects"] = raw_effs

        dead_cond = out.get("deadCardCondition")
        if isinstance(dead_cond, list):
            dead_cond = "|".join(str(x).strip() for x in dead_cond if str(x).strip()) or None
        elif dead_cond is not None:
            dead_cond = str(dead_cond).strip() or None
            if dead_cond and dead_cond.lower() in {"none", "null", "n/a"}:
                dead_cond = None
        out["deadCardCondition"] = dead_cond
        return out


class LLMCompiledPayload(BaseModel):
    """Schéma micro-ciblé unique généré par l'IA de Passe 2 via Constrained Decoding."""

    model_config = ConfigDict(extra="ignore")

    translatedSlots: List[LLMTranslatedSlot] = Field(
        default_factory=list,
        description="Liste des slots d'effets traduits en primitives atomiques",
    )
    aiRole: AIRole = Field(
        default=AIRole.GUEST_TECH,
        description="Rôle stratégique principal de la carte",
    )
    turnPhaseWeights: TurnPhaseWeights = Field(
        default_factory=TurnPhaseWeights,
        description="Poids d'intérêt stratégique par tour (bornés entre 0.0 et 1.0)",
    )
    additionalSynergyTags: List[str] = Field(
        default_factory=list,
        description="Tags de synergie complémentaires, ex: 'requires_stage_2_pokemon', 'requires_basic_hp_lte_70'",
    )

    @model_validator(mode="before")
    @classmethod
    def _coerce_llm_payload(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        out = dict(data)

        # Tolérance si l'IA renvoie playableActions ou un effet isolé au lieu de translatedSlots
        if "translatedSlots" not in out or out["translatedSlots"] is None:
            if isinstance(out.get("playableActions"), list):
                out["translatedSlots"] = [
                    {
                        "slotId": act.get("slotId") or act.get("actionId") or f"slot_{idx}",
                        "preconditions": act.get("preconditions") or [],
                        "effects": act.get("effects") or act.get("primitives") or [],
                        "deadCardCondition": act.get("deadCardCondition"),
                    }
                    for idx, act in enumerate(out["playableActions"])
                    if isinstance(act, dict)
                ]
            elif isinstance(out.get("slots"), list):
                out["translatedSlots"] = out["slots"]
            elif "primitive" in out:
                out["translatedSlots"] = [
                    {
                        "slotId": out.get("slotId") or "attack_0",
                        "preconditions": [],
                        "effects": [dict(out)],
                        "deadCardCondition": None,
                    }
                ]
            elif "actionId" in out and "effects" in out:
                out["translatedSlots"] = [
                    {
                        "slotId": out.get("actionId") or "attack_0",
                        "preconditions": out.get("preconditions") or [],
                        "effects": out.get("effects") or [],
                        "deadCardCondition": out.get("deadCardCondition"),
                    }
                ]
            else:
                out["translatedSlots"] = []

        # Tolérance si aiRole / turnPhaseWeights / additionalSynergyTags sont dans strategicEvaluator
        strat = out.get("strategicEvaluator")
        if isinstance(strat, dict):
            if "aiRole" not in out:
                out["aiRole"] = strat.get("aiRole") or strat.get("primaryRole") or AIRole.GUEST_TECH
            if "turnPhaseWeights" not in out and "turnPhaseWeights" in strat:
                out["turnPhaseWeights"] = strat["turnPhaseWeights"]
            if "additionalSynergyTags" not in out and "decklistSynergyRequirements" in strat:
                out["additionalSynergyTags"] = strat["decklistSynergyRequirements"]

        out["aiRole"] = _coerce_ai_role(out.get("aiRole") or out.get("primaryRole") or AIRole.GUEST_TECH)

        if not isinstance(out.get("turnPhaseWeights"), (dict, TurnPhaseWeights)):
            out["turnPhaseWeights"] = {}

        raw_tags = out.get("additionalSynergyTags")
        if isinstance(raw_tags, list):
            out["additionalSynergyTags"] = [str(t).strip() for t in raw_tags if str(t).strip()]
        else:
            out["additionalSynergyTags"] = []

        return out


# Alias mentionné dans la description d'architecture et rétrocompatibilité
LLMCompiledEffectsAndStrategy = LLMCompiledPayload
LLMCompiledCardPart = LLMCompiledPayload


# ============================================================================
# D. MÉTADONNÉES ET MODÈLE CONSOLIDÉ FINAL (EngineCardModel)
# ============================================================================


class CompilationMetadata(BaseModel):
    """Métadonnées techniques de télémétrie sur la compilation de la carte."""

    model_config = ConfigDict(extra="ignore")

    modelRepoId: str = Field(description="Identifiant du dépôt ou modèle utilisé")
    modelFilename: str = Field(description="Nom du fichier ou backend de poids")
    compilationTimeSeconds: float = Field(ge=0.0, description="Durée totale de compilation en secondes")
    compiledAtIso: str = Field(description="Horodatage ISO 8601 UTC")
    completionTokens: Optional[int] = Field(default=None, ge=0, description="Nombre de tokens générés")
    tokensPerSecond: Optional[float] = Field(default=None, ge=0.0, description="Vitesse moyenne (tokens/s)")
    generationTimeSeconds: Optional[float] = Field(default=None, ge=0.0, description="Temps pur de génération")
    timeToFirstTokenSeconds: Optional[float] = Field(default=None, ge=0.0, description="Latence du premier token")


class EngineCardModel(BaseModel):
    """Modèle de carte Pokémon TCG final complet et validé."""

    model_config = ConfigDict(extra="ignore")

    cardId: str = Field(description="Identifiant unique TCGdex (ex: 'me01-104')")
    identity: CardIdentity = Field(description="Identité déterministe complète de la carte")
    pokemonStats: Optional[PokemonStats] = Field(
        default=None,
        description="Statistiques Pokémon déterministes (`null` si Dresseur ou Énergie)",
    )
    category: CardCategory = Field(description="Catégorie principale")
    subCategory: CardSubCategory = Field(description="Sous-catégorie")
    playableActions: List[PlayableAction] = Field(
        default_factory=list,
        description="Liste ordonnée des actions jouables",
    )
    strategicEvaluator: StrategicEvaluator = Field(
        default_factory=StrategicEvaluator,
        description="Profil d'évaluation stratégique",
    )
    compilationMetadata: Optional[CompilationMetadata] = Field(
        default=None,
        description="Métadonnées de compilation IA / déterministe",
    )

    @field_validator("category", mode="before")
    @classmethod
    def _val_cat(cls, v: Any) -> CardCategory:
        return _coerce_card_category(v)

    @field_validator("subCategory", mode="before")
    @classmethod
    def _val_subcat(cls, v: Any) -> CardSubCategory:
        return _coerce_card_subcategory(v)
