"""Schémas Pydantic V2 stricts pour la compilation de cartes Pokémon TCG.

Ce module définit :
1. Les énumérations normalisées (`CardCategory`, `CardSubCategory`, `ActionType`,
   `TimingPhase`, `EffectPrimitive`, `SpecialCondition`, `CoinFlipMode`,
   `ScalingOperator`, `ScalingMetric`, `EffectTarget`, `ZoneType`, `AIRole`).
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
    TRIGGERED_ABILITY = "TRIGGERED_ABILITY"
    PASSIVE_ABILITY = "PASSIVE_ABILITY"
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
    # Nouvelles primitives Standard
    PLACE_DAMAGE_COUNTERS = "PLACE_DAMAGE_COUNTERS"
    MOVE_DAMAGE_COUNTERS = "MOVE_DAMAGE_COUNTERS"
    MOVE_ENERGY = "MOVE_ENERGY"
    MODIFY_DAMAGE_TAKEN = "MODIFY_DAMAGE_TAKEN"
    MODIFY_DAMAGE_DEALT = "MODIFY_DAMAGE_DEALT"
    MODIFY_HP = "MODIFY_HP"
    MODIFY_RETREAT_COST = "MODIFY_RETREAT_COST"
    PREVENT_DAMAGE_OR_EFFECTS = "PREVENT_DAMAGE_OR_EFFECTS"
    LOCK_NEXT_TURN_ATTACK = "LOCK_NEXT_TURN_ATTACK"
    LOCK_RETREAT = "LOCK_RETREAT"
    LOCK_ABILITIES = "LOCK_ABILITIES"
    LOCK_ITEMS = "LOCK_ITEMS"
    EXPAND_BENCH = "EXPAND_BENCH"
    KNOCK_OUT = "KNOCK_OUT"
    MILL_DECK = "MILL_DECK"
    TAKE_EXTRA_PRIZE = "TAKE_EXTRA_PRIZE"
    PUT_ON_TOP_OR_BOTTOM_OF_DECK = "PUT_ON_TOP_OR_BOTTOM_OF_DECK"


class SpecialCondition(str, Enum):
    POISONED = "POISONED"
    BURNED = "BURNED"
    ASLEEP = "ASLEEP"
    PARALYZED = "PARALYZED"
    CONFUSED = "CONFUSED"


class CoinFlipMode(str, Enum):
    SINGLE_HEADS_REQUIRED = "SINGLE_HEADS_REQUIRED"
    SINGLE_HEADS_BONUS = "SINGLE_HEADS_BONUS"
    MULTI_COIN_PER_HEADS = "MULTI_COIN_PER_HEADS"
    UNTIL_TAILS_PER_HEADS = "UNTIL_TAILS_PER_HEADS"
    TWO_TAILS_SELF_DAMAGE = "TWO_TAILS_SELF_DAMAGE"


class ScalingOperator(str, Enum):
    ADD = "ADD"
    MULTIPLY = "MULTIPLY"


class ScalingMetric(str, Enum):
    PER_ENERGY_ON_SELF = "PER_ENERGY_ON_SELF"
    PER_ENERGY_ON_OPPONENT_ACTIVE = "PER_ENERGY_ON_OPPONENT_ACTIVE"
    PER_ENERGY_ON_BOTH_ACTIVES = "PER_ENERGY_ON_BOTH_ACTIVES"
    PER_ENERGY_IN_PLAY = "PER_ENERGY_IN_PLAY"
    PER_ENERGY_DISCARDED = "PER_ENERGY_DISCARDED"
    PER_DAMAGE_COUNTER_ON_SELF = "PER_DAMAGE_COUNTER_ON_SELF"
    PER_DAMAGE_COUNTER_ON_OPPONENT_ACTIVE = "PER_DAMAGE_COUNTER_ON_OPPONENT_ACTIVE"
    PER_BENCHED_POKEMON_WITH_DAMAGE = "PER_BENCHED_POKEMON_WITH_DAMAGE"
    PER_OWN_BENCH_POKEMON = "PER_OWN_BENCH_POKEMON"
    PER_OPPONENT_BENCH_POKEMON = "PER_OPPONENT_BENCH_POKEMON"
    PER_BOTH_BENCH_POKEMON = "PER_BOTH_BENCH_POKEMON"
    PER_PRIZE_TAKEN_BY_OPPONENT = "PER_PRIZE_TAKEN_BY_OPPONENT"
    PER_PRIZE_TAKEN_BY_PLAYER = "PER_PRIZE_TAKEN_BY_PLAYER"
    PER_PRIZE_REMAINING_PLAYER = "PER_PRIZE_REMAINING_PLAYER"
    PER_CARD_IN_OWN_HAND = "PER_CARD_IN_OWN_HAND"
    PER_CARD_IN_OPPONENT_HAND = "PER_CARD_IN_OPPONENT_HAND"
    CONDITIONAL_FLAT_BONUS = "CONDITIONAL_FLAT_BONUS"


class EffectTarget(str, Enum):
    SELF = "SELF"
    OPPONENT_ACTIVE = "OPPONENT_ACTIVE"
    OPPONENT_BENCH_SINGLE = "OPPONENT_BENCH_SINGLE"
    OPPONENT_BENCH_ALL = "OPPONENT_BENCH_ALL"
    OPPONENT_POKEMON_ANY = "OPPONENT_POKEMON_ANY"
    OPPONENT_ALL_POKEMON = "OPPONENT_ALL_POKEMON"
    OWN_ACTIVE = "OWN_ACTIVE"
    OWN_BENCH_SINGLE = "OWN_BENCH_SINGLE"
    OWN_BENCH_ALL = "OWN_BENCH_ALL"
    OWN_POKEMON_ANY = "OWN_POKEMON_ANY"
    OWN_ALL_POKEMON = "OWN_ALL_POKEMON"
    ALL_POKEMON_IN_PLAY = "ALL_POKEMON_IN_PLAY"
    PLAYER = "PLAYER"
    OPPONENT = "OPPONENT"


class ZoneType(str, Enum):
    DECK = "DECK"
    TOP_OF_DECK = "TOP_OF_DECK"
    BOTTOM_OF_DECK = "BOTTOM_OF_DECK"
    HAND = "HAND"
    DISCARD = "DISCARD"
    BENCH = "BENCH"
    ACTIVE = "ACTIVE"
    PRIZES = "PRIZES"
    LOST_ZONE = "LOST_ZONE"
    ATTACHED_CARDS = "ATTACHED_CARDS"


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
        "TRIGGERED_ABILITY": ActionType.TRIGGERED_ABILITY,
        "ABILITY_ON_EVOLVE": ActionType.TRIGGERED_ABILITY,
        "ABILITY_ON_PLAY_FROM_HAND": ActionType.TRIGGERED_ABILITY,
        "ON_PLAY_ABILITY": ActionType.TRIGGERED_ABILITY,
        "ON_EVOLVE_ABILITY": ActionType.TRIGGERED_ABILITY,
        "ABILITY_REACTIVE": ActionType.TRIGGERED_ABILITY,
        "PASSIVE_ABILITY": ActionType.PASSIVE_ABILITY,
        "ABILITY_PASSIVE": ActionType.PASSIVE_ABILITY,
        "CONTINUOUS_ABILITY": ActionType.PASSIVE_ABILITY,
        "ATTACH_ENERGY": ActionType.ATTACH_ENERGY,
        "SPECIAL_ENERGY_EFFECT": ActionType.ATTACH_ENERGY,
        "ENERGY_ATTACHMENT": ActionType.ATTACH_ENERGY,
        "RETREAT": ActionType.RETREAT,
        "RETREAT_ACTION": ActionType.RETREAT,
        "ATTACK": ActionType.ATTACK,
    }
    if key in mapping:
        return mapping[key]
    if "PASSIVE" in key or "CONTINUOUS" in key:
        return ActionType.PASSIVE_ABILITY
    if "TRIGGER" in key or "REACTIVE" in key or "ON_PLAY" in key or "ON_EVOLVE" in key:
        return ActionType.TRIGGERED_ABILITY
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
    if val is None:
        raise ValueError("La primitive d'effet ne peut pas être nulle.")
    key = _clean_enum_key(val)
    if not key or key in {"NONE", "NULL", "N/A", "NA"}:
        raise ValueError(f"Primitive d'effet vide ou nulle : {val!r}")
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
        # PUT_ON_TOP_OR_BOTTOM_OF_DECK
        "LOOK_TOP_DECK": EffectPrimitive.PUT_ON_TOP_OR_BOTTOM_OF_DECK,
        "REORDER_DECK": EffectPrimitive.PUT_ON_TOP_OR_BOTTOM_OF_DECK,
        "PUT_ON_TOP_DECK": EffectPrimitive.PUT_ON_TOP_OR_BOTTOM_OF_DECK,
        "PUT_ON_BOTTOM_DECK": EffectPrimitive.PUT_ON_TOP_OR_BOTTOM_OF_DECK,
        "PLACE_ON_TOP_OF_DECK": EffectPrimitive.PUT_ON_TOP_OR_BOTTOM_OF_DECK,
        "PLACE_ON_BOTTOM_OF_DECK": EffectPrimitive.PUT_ON_TOP_OR_BOTTOM_OF_DECK,
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
        # DAMAGE_BENCH
        "DEAL_DAMAGE_BENCH": EffectPrimitive.DAMAGE_BENCH,
        "SNIPE_BENCH": EffectPrimitive.DAMAGE_BENCH,
        "SPREAD_DAMAGE": EffectPrimitive.DAMAGE_BENCH,
        # PLACE_DAMAGE_COUNTERS
        "PLACE_DAMAGE_COUNTERS": EffectPrimitive.PLACE_DAMAGE_COUNTERS,
        "PUT_DAMAGE_COUNTERS": EffectPrimitive.PLACE_DAMAGE_COUNTERS,
        "PLACE_COUNTERS": EffectPrimitive.PLACE_DAMAGE_COUNTERS,
        "DAMAGE_COUNTERS": EffectPrimitive.PLACE_DAMAGE_COUNTERS,
        "ADD_DAMAGE_COUNTERS": EffectPrimitive.PLACE_DAMAGE_COUNTERS,
        # MOVE_DAMAGE_COUNTERS
        "MOVE_DAMAGE_COUNTERS": EffectPrimitive.MOVE_DAMAGE_COUNTERS,
        "TRANSFER_DAMAGE_COUNTERS": EffectPrimitive.MOVE_DAMAGE_COUNTERS,
        # PREVENT_DAMAGE_OR_EFFECTS
        "COIN_FLIP": EffectPrimitive.PREVENT_DAMAGE_OR_EFFECTS,
        "FLIP_COIN": EffectPrimitive.PREVENT_DAMAGE_OR_EFFECTS,
        "PREVENT_DAMAGE": EffectPrimitive.PREVENT_DAMAGE_OR_EFFECTS,
        "PREVENT_EFFECTS": EffectPrimitive.PREVENT_DAMAGE_OR_EFFECTS,
        "PASSIVE_PREVENT_DAMAGE_OR_EFFECTS": EffectPrimitive.PREVENT_DAMAGE_OR_EFFECTS,
        "IMMUNITY": EffectPrimitive.PREVENT_DAMAGE_OR_EFFECTS,
        # MODIFY_DAMAGE_TAKEN
        "PASSIVE_DAMAGE_REDUCTION": EffectPrimitive.MODIFY_DAMAGE_TAKEN,
        "REDUCE_DAMAGE": EffectPrimitive.MODIFY_DAMAGE_TAKEN,
        "REDUCE_DAMAGE_TAKEN": EffectPrimitive.MODIFY_DAMAGE_TAKEN,
        "DAMAGE_REDUCTION": EffectPrimitive.MODIFY_DAMAGE_TAKEN,
        # MODIFY_DAMAGE_DEALT
        "PASSIVE_DAMAGE_BOOST": EffectPrimitive.MODIFY_DAMAGE_DEALT,
        "BOOST_DAMAGE": EffectPrimitive.MODIFY_DAMAGE_DEALT,
        "BONUS_DAMAGE": EffectPrimitive.MODIFY_DAMAGE_DEALT,
        "EXTRA_DAMAGE": EffectPrimitive.MODIFY_DAMAGE_DEALT,
        "DAMAGE_BOOST": EffectPrimitive.MODIFY_DAMAGE_DEALT,
        # MODIFY_HP
        "BOOST_HP": EffectPrimitive.MODIFY_HP,
        "INCREASE_HP": EffectPrimitive.MODIFY_HP,
        "MAX_HP_MOD": EffectPrimitive.MODIFY_HP,
        # MODIFY_RETREAT_COST
        "PASSIVE_RETREAT_COST_MOD": EffectPrimitive.MODIFY_RETREAT_COST,
        "REDUCE_RETREAT_COST": EffectPrimitive.MODIFY_RETREAT_COST,
        "FREE_RETREAT": EffectPrimitive.MODIFY_RETREAT_COST,
        # LOCK_*
        "LOCK_ATTACK": EffectPrimitive.LOCK_NEXT_TURN_ATTACK,
        "CANNOT_ATTACK": EffectPrimitive.LOCK_NEXT_TURN_ATTACK,
        "CANT_ATTACK": EffectPrimitive.LOCK_NEXT_TURN_ATTACK,
        "CANT_RETREAT": EffectPrimitive.LOCK_RETREAT,
        "CANNOT_RETREAT": EffectPrimitive.LOCK_RETREAT,
        "PREVENT_RETREAT": EffectPrimitive.LOCK_RETREAT,
        "PASSIVE_ABILITY_OR_ITEM_LOCK": EffectPrimitive.LOCK_ABILITIES,
        "DISABLE_ABILITIES": EffectPrimitive.LOCK_ABILITIES,
        "ABILITY_LOCK": EffectPrimitive.LOCK_ABILITIES,
        "NEGATE_ABILITIES": EffectPrimitive.LOCK_ABILITIES,
        "ITEM_LOCK": EffectPrimitive.LOCK_ITEMS,
        "CANT_PLAY_ITEMS": EffectPrimitive.LOCK_ITEMS,
        # EXPAND_BENCH
        "BENCH_SIZE_MOD": EffectPrimitive.EXPAND_BENCH,
        # KNOCK_OUT
        "KO": EffectPrimitive.KNOCK_OUT,
        "INSTANT_KO": EffectPrimitive.KNOCK_OUT,
        "AUTO_KO": EffectPrimitive.KNOCK_OUT,
        # MILL_DECK
        "MILL": EffectPrimitive.MILL_DECK,
        "DISCARD_TOP_DECK": EffectPrimitive.MILL_DECK,
        # TAKE_EXTRA_PRIZE
        "EXTRA_PRIZE": EffectPrimitive.TAKE_EXTRA_PRIZE,
        "TAKE_PRIZE": EffectPrimitive.TAKE_EXTRA_PRIZE,
        # ATTACH_ENERGY / MOVE_ENERGY
        "ATTACH_ENERGY_FROM_HAND": EffectPrimitive.ATTACH_ENERGY,
        "ATTACH_ENERGY_FROM_DISCARD": EffectPrimitive.ATTACH_ENERGY,
        "ATTACH_ENERGY_FROM_DECK": EffectPrimitive.ATTACH_ENERGY,
        "SEARCH_AND_ATTACH_ENERGY": EffectPrimitive.ATTACH_ENERGY,
        "ACCELERATE_ENERGY": EffectPrimitive.ATTACH_ENERGY,
        "PROVIDE_ENERGY": EffectPrimitive.ATTACH_ENERGY,
        "MOVE_ENERGY_BETWEEN_POKEMON": EffectPrimitive.MOVE_ENERGY,
        "TRANSFER_ENERGY": EffectPrimitive.MOVE_ENERGY,
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
        # SWITCH_ACTIVE
        "SWITCH_ACTIVE_POKEMON": EffectPrimitive.SWITCH_ACTIVE,
        "GUST_OPPONENT_BENCH_TO_ACTIVE": EffectPrimitive.SWITCH_ACTIVE,
        "SWITCH_OPPONENT_ACTIVE": EffectPrimitive.SWITCH_ACTIVE,
        "SWITCH": EffectPrimitive.SWITCH_ACTIVE,
        "GUST": EffectPrimitive.SWITCH_ACTIVE,
        "RETREAT": EffectPrimitive.SWITCH_ACTIVE,
        # APPLY_SPECIAL_CONDITION
        "SPECIAL_CONDITION": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        "STATUS_CONDITION": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        "POISON": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        "BURN": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        "SLEEP": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        "PARALYZE": EffectPrimitive.APPLY_SPECIAL_CONDITION,
        "CONFUSE": EffectPrimitive.APPLY_SPECIAL_CONDITION,
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

    if "MILL" in key:
        return EffectPrimitive.MILL_DECK
    if "KNOCK_OUT" in key or key.endswith("_KO"):
        return EffectPrimitive.KNOCK_OUT
    if "EXTRA_PRIZE" in key:
        return EffectPrimitive.TAKE_EXTRA_PRIZE
    if "MOVE" in key and "COUNTER" in key:
        return EffectPrimitive.MOVE_DAMAGE_COUNTERS
    if "COUNTER" in key and ("PLACE" in key or "PUT" in key):
        return EffectPrimitive.PLACE_DAMAGE_COUNTERS
    if "MOVE" in key and "ENERG" in key:
        return EffectPrimitive.MOVE_ENERGY
    if "PREVENT" in key:
        return EffectPrimitive.PREVENT_DAMAGE_OR_EFFECTS
    if "REDUCE" in key and "DAMAGE" in key:
        return EffectPrimitive.MODIFY_DAMAGE_TAKEN
    if ("BOOST" in key or "BONUS" in key or "DEALT" in key) and "DAMAGE" in key:
        return EffectPrimitive.MODIFY_DAMAGE_DEALT
    if "RETREAT" in key and ("MOD" in key or "COST" in key or "REDUCE" in key):
        return EffectPrimitive.MODIFY_RETREAT_COST
    if "RETREAT" in key and ("LOCK" in key or "CANT" in key or "CANNOT" in key):
        return EffectPrimitive.LOCK_RETREAT
    if "ABILITY" in key and ("LOCK" in key or "DISABLE" in key):
        return EffectPrimitive.LOCK_ABILITIES
    if "ITEM" in key and ("LOCK" in key or "CANT" in key or "CANNOT" in key):
        return EffectPrimitive.LOCK_ITEMS
    if "ATTACK" in key and ("LOCK" in key or "CANT" in key or "CANNOT" in key):
        return EffectPrimitive.LOCK_NEXT_TURN_ATTACK
    if "EXPAND" in key and "BENCH" in key:
        return EffectPrimitive.EXPAND_BENCH
    if "HP" in key and ("MOD" in key or "BOOST" in key or "INCREASE" in key):
        return EffectPrimitive.MODIFY_HP
    if "SEARCH" in key and "ENERG" in key and "ATTACH" in key:
        return EffectPrimitive.ATTACH_ENERGY
    if "SEARCH" in key or "FIND" in key or "TUTOR" in key:
        return EffectPrimitive.SEARCH_DECK
    if "SHUFFLE" in key and "DRAW" in key:
        return EffectPrimitive.SHUFFLE_HAND_DRAW
    if "DRAW" in key or "PIOCH" in key:
        return EffectPrimitive.DRAW_CARDS
    if "BENCH" in key and "DAMAGE" in key:
        return EffectPrimitive.DAMAGE_BENCH
    if "DAMAGE" in key or "DEGAT" in key:
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
    if "CONDITION" in key or "STATUS" in key:
        return EffectPrimitive.APPLY_SPECIAL_CONDITION

    raise ValueError(f"Primitive d'effet inconnue ou invalide : {val!r}")


def _coerce_special_condition(val: Any) -> Optional[SpecialCondition]:
    if val is None:
        return None
    if isinstance(val, SpecialCondition):
        return val
    key = _clean_enum_key(val)
    if not key or key in {"NONE", "NULL", "N/A"}:
        return None
    try:
        return SpecialCondition(key)
    except ValueError:
        pass
    mapping = {
        "POISON": SpecialCondition.POISONED,
        "EMPOISONNE": SpecialCondition.POISONED,
        "EMPOISONNÉ": SpecialCondition.POISONED,
        "BURN": SpecialCondition.BURNED,
        "BRULE": SpecialCondition.BURNED,
        "BRÛLÉ": SpecialCondition.BURNED,
        "SLEEP": SpecialCondition.ASLEEP,
        "ENDORMI": SpecialCondition.ASLEEP,
        "PARALYZE": SpecialCondition.PARALYZED,
        "PARALYZ": SpecialCondition.PARALYZED,
        "PARALYSE": SpecialCondition.PARALYZED,
        "PARALYSÉ": SpecialCondition.PARALYZED,
        "CONFUSE": SpecialCondition.CONFUSED,
        "CONFUS": SpecialCondition.CONFUSED,
    }
    for k, cond in mapping.items():
        if k in key:
            return cond
    raise ValueError(f"État spécial inconnu : {val!r}")


def _coerce_coin_flip_mode(val: Any) -> Optional[CoinFlipMode]:
    if val is None:
        return None
    if isinstance(val, CoinFlipMode):
        return val
    key = _clean_enum_key(val)
    if not key or key in {"NONE", "NULL", "N/A"}:
        return None
    try:
        return CoinFlipMode(key)
    except ValueError:
        pass
    if "UNTIL" in key or "TAILS_STOP" in key:
        return CoinFlipMode.UNTIL_TAILS_PER_HEADS
    if "TWO" in key and "TAIL" in key:
        return CoinFlipMode.TWO_TAILS_SELF_DAMAGE
    if "MULTI" in key or "PER_HEADS" in key:
        return CoinFlipMode.MULTI_COIN_PER_HEADS
    if "BONUS" in key or "EXTRA" in key:
        return CoinFlipMode.SINGLE_HEADS_BONUS
    if "HEADS" in key or "REQUIRED" in key or "COIN" in key:
        return CoinFlipMode.SINGLE_HEADS_REQUIRED
    raise ValueError(f"Mode de lancer de pièce inconnu : {val!r}")


def _coerce_scaling_operator(val: Any) -> Optional[ScalingOperator]:
    if val is None:
        return None
    if isinstance(val, ScalingOperator):
        return val
    raw_s = str(val).strip()
    if raw_s == "+":
        return ScalingOperator.ADD
    if raw_s in {"×", "x", "X", "*"}:
        return ScalingOperator.MULTIPLY
    key = _clean_enum_key(val)
    if not key or key in {"NONE", "NULL", "N/A"}:
        return None
    if key in {"ADD", "PLUS", "BONUS"}:
        return ScalingOperator.ADD
    if key in {"MULTIPLY", "MULT", "TIMES", "X"}:
        return ScalingOperator.MULTIPLY
    raise ValueError(f"Opérateur de scaling inconnu : {val!r}")


def _coerce_scaling_metric(val: Any) -> Optional[ScalingMetric]:
    if val is None:
        return None
    if isinstance(val, ScalingMetric):
        return val
    key = _clean_enum_key(val)
    if not key or key in {"NONE", "NULL", "N/A"}:
        return None
    try:
        return ScalingMetric(key)
    except ValueError:
        pass
    raise ValueError(f"Métrique de scaling inconnue : {val!r}")


def _coerce_effect_target(val: Any) -> Optional[EffectTarget]:
    if val is None:
        return None
    if isinstance(val, EffectTarget):
        return val
    if isinstance(val, list):
        joined = "_".join(str(x).upper() for x in val)
        if "OWN" in joined and "OPPONENT" in joined:
            return EffectTarget.ALL_POKEMON_IN_PLAY
        if "OPPONENT" in joined or "DEFENDING" in joined:
            return EffectTarget.OPPONENT_ACTIVE
        if "OWN" in joined or "SELF" in joined:
            return EffectTarget.OWN_POKEMON_ANY
        val = val[0] if val else None
        if val is None:
            return None
    if isinstance(val, dict):
        val = val.get("TO") or val.get("to") or val.get("target") or "OWN_POKEMON_ANY"

    key = _clean_enum_key(val)
    key = re.sub(r"[\s,;|]+", "_", key).strip("_")
    if not key or key in {"NONE", "NULL", "N/A", "NA"}:
        return None
    try:
        return EffectTarget(key)
    except ValueError:
        pass

    mapping: Dict[str, EffectTarget] = {
        "SELF": EffectTarget.SELF,
        "ATTACHED_POKEMON": EffectTarget.SELF,
        "SELF_ENERGY": EffectTarget.SELF,
        "OWN_ATTACKS": EffectTarget.SELF,
        "ATTACHED_POKEMON_ATTACK": EffectTarget.SELF,
        "OPPONENT_ACTIVE": EffectTarget.OPPONENT_ACTIVE,
        "OPPONENT_ACTIVE_POKEMON": EffectTarget.OPPONENT_ACTIVE,
        "DEFENDING_POKEMON": EffectTarget.OPPONENT_ACTIVE,
        "OPPO_ACTIVE": EffectTarget.OPPONENT_ACTIVE,
        "OP": EffectTarget.OPPONENT_ACTIVE,
        "OPPONENT_BENCH": EffectTarget.OPPONENT_BENCH_SINGLE,
        "OPPO_BENCH": EffectTarget.OPPONENT_BENCH_SINGLE,
        "OPPONENT_BENCH_SINGLE": EffectTarget.OPPONENT_BENCH_SINGLE,
        "OPPONENT_BENCH_ALL": EffectTarget.OPPONENT_BENCH_ALL,
        "OPPONENT_POKEMON_ANY": EffectTarget.OPPONENT_POKEMON_ANY,
        "OPPONENT_POKEMON": EffectTarget.OPPONENT_POKEMON_ANY,
        "OPPONENT_BENCH_OPPONENT_ACTIVE": EffectTarget.OPPONENT_ALL_POKEMON,
        "OPPONENT_BENCH_OR_ACTIVE": EffectTarget.OPPONENT_POKEMON_ANY,
        "CHOSEN_POKEMON": EffectTarget.OPPONENT_POKEMON_ANY,
        "SELECTED_POKEMON": EffectTarget.OPPONENT_POKEMON_ANY,
        "OPPONENT_ALL_POKEMON": EffectTarget.OPPONENT_ALL_POKEMON,
        "OWN_ACTIVE": EffectTarget.OWN_ACTIVE,
        "SELF_ACTIVE": EffectTarget.OWN_ACTIVE,
        "PLAYER_ACTIVE": EffectTarget.OWN_ACTIVE,
        "ACTIVE": EffectTarget.OWN_ACTIVE,
        "ACTIVE_POKEMON": EffectTarget.OWN_ACTIVE,
        "NEW_ACTIVE": EffectTarget.OWN_ACTIVE,
        "OWN_BENCH": EffectTarget.OWN_BENCH_SINGLE,
        "SELF_BENCH": EffectTarget.OWN_BENCH_SINGLE,
        "PLAYER_BENCH": EffectTarget.OWN_BENCH_SINGLE,
        "YOUR_BENCH": EffectTarget.OWN_BENCH_SINGLE,
        "OWN_BENCH_N": EffectTarget.OWN_BENCH_SINGLE,
        "BENCH": EffectTarget.OWN_BENCH_SINGLE,
        "OWN_BENCH_ANY": EffectTarget.OWN_BENCH_ALL,
        "OWN_BENCH_ALL": EffectTarget.OWN_BENCH_ALL,
        "OWN_POKEMON_ANY": EffectTarget.OWN_POKEMON_ANY,
        "OWN_POKEMON": EffectTarget.OWN_POKEMON_ANY,
        "SELF_POKEMON_ANY": EffectTarget.OWN_POKEMON_ANY,
        "PLAYER_POKEMON_ANY": EffectTarget.OWN_POKEMON_ANY,
        "OWN_OTHER_POKEMON": EffectTarget.OWN_POKEMON_ANY,
        "OWN_BENCH_OR_ACTIVE": EffectTarget.OWN_POKEMON_ANY,
        "OWN_BENCH_OWN_ACTIVE": EffectTarget.OWN_POKEMON_ANY,
        "OWN": EffectTarget.OWN_POKEMON_ANY,
        "TARGET_FUTURE_POKEMON": EffectTarget.OWN_POKEMON_ANY,
        "OWN_ALL_POKEMON": EffectTarget.OWN_ALL_POKEMON,
        "ALL_OWN_POKEMON": EffectTarget.OWN_ALL_POKEMON,
        "ALL_YOUR_POKEMON": EffectTarget.OWN_ALL_POKEMON,
        "ALL_POKEMON_IN_PLAY": EffectTarget.ALL_POKEMON_IN_PLAY,
        "ALL_POKEMON": EffectTarget.ALL_POKEMON_IN_PLAY,
        "ALL_ACTIVE": EffectTarget.ALL_POKEMON_IN_PLAY,
        "BOTH_ACTIVE": EffectTarget.ALL_POKEMON_IN_PLAY,
        "BOTH_BENCH": EffectTarget.ALL_POKEMON_IN_PLAY,
        "OWN_BENCH_AND_OPPO_BENCH": EffectTarget.ALL_POKEMON_IN_PLAY,
        "PLAYER": EffectTarget.PLAYER,
        "OWNER": EffectTarget.PLAYER,
        "DECK": EffectTarget.PLAYER,
        "HAND": EffectTarget.PLAYER,
        "OWN_DECK": EffectTarget.PLAYER,
        "PLAYER_DECK": EffectTarget.PLAYER,
        "PLAYER_HAND": EffectTarget.PLAYER,
        "OWN_HAND": EffectTarget.PLAYER,
        "OWN_DISCARD": EffectTarget.PLAYER,
        "DISCARD": EffectTarget.PLAYER,
        "SEARCHED_CARD": EffectTarget.PLAYER,
        "SEARCHED_CARDS": EffectTarget.PLAYER,
        "SEARCHED_POKEMON": EffectTarget.PLAYER,
        "REVEALED_CARD": EffectTarget.PLAYER,
        "STADIUM": EffectTarget.PLAYER,
        "OPPONENT": EffectTarget.OPPONENT,
        "ENEMY": EffectTarget.OPPONENT,
        "OPPONENT_DECK": EffectTarget.OPPONENT,
        "OPPONENT_HAND": EffectTarget.OPPONENT,
        "OPPONENT_STADIUM": EffectTarget.OPPONENT,
    }
    if key in mapping:
        return mapping[key]
    if key.startswith("ALL_") and ("POKEMON" in key or "IN_PLAY" in key or "PSYDUCK" in key or "PSYKOKWAK" in key or "MEGA_" in key):
        return EffectTarget.ALL_POKEMON_IN_PLAY
    if "OPPONENT" in key or "OPPO" in key or "ENEMY" in key:
        if "BENCH" in key:
            return EffectTarget.OPPONENT_BENCH_SINGLE
        if "ACTIVE" in key:
            return EffectTarget.OPPONENT_ACTIVE
        return EffectTarget.OPPONENT
    if "BENCH" in key:
        return EffectTarget.OWN_BENCH_SINGLE
    if "SELF" in key:
        return EffectTarget.SELF
    if "PLAYER" in key or "OWN" in key:
        return EffectTarget.PLAYER
    raise ValueError(f"Cible d'effet (EffectTarget) inconnue : {val!r}")


def _coerce_zone_type(val: Any) -> Optional[ZoneType]:
    if val is None:
        return None
    if isinstance(val, ZoneType):
        return val
    if isinstance(val, list):
        val = val[0] if val else None
        if val is None:
            return None
    key = _clean_enum_key(val)
    key = re.sub(r"[\s,;|]+", "_", key).strip("_")
    if not key or key in {"NONE", "NULL", "N/A", "NA", "RETREAT_COST", "ATTACK"}:
        return None
    if key.startswith("ZONE:"):
        key = key.split(":", 1)[1].strip("_")
    try:
        return ZoneType(key)
    except ValueError:
        pass

    mapping: Dict[str, ZoneType] = {
        "DECK": ZoneType.DECK,
        "SEARCHED": ZoneType.DECK,
        "SEARCHED_CARDS": ZoneType.DECK,
        "FOUND_CARDS": ZoneType.DECK,
        "BENCH_TO_DECK": ZoneType.DECK,
        "TOP_OF_DECK": ZoneType.TOP_OF_DECK,
        "TOP_DECK": ZoneType.TOP_OF_DECK,
        "DECK_TOP": ZoneType.TOP_OF_DECK,
        "BOTTOM_OF_DECK": ZoneType.BOTTOM_OF_DECK,
        "BOTTOM_DECK": ZoneType.BOTTOM_OF_DECK,
        "DECK_BOTTOM": ZoneType.BOTTOM_OF_DECK,
        "HAND": ZoneType.HAND,
        "HAND_DECK": ZoneType.HAND,
        "HAND_OR_BENCH": ZoneType.HAND,
        "DISCARD": ZoneType.DISCARD,
        "DISCARD_PILE": ZoneType.DISCARD,
        "BENCH": ZoneType.BENCH,
        "OWN_BENCH": ZoneType.BENCH,
        "OPPONENT_BENCH": ZoneType.BENCH,
        "BENCH_ACTIVE": ZoneType.BENCH,
        "BENCH_OR_ACTIVE": ZoneType.BENCH,
        "PLAY": ZoneType.BENCH,
        "BATTLEFIELD": ZoneType.BENCH,
        "ALL_POKEMON_IN_PLAY": ZoneType.BENCH,
        "GLOBAL": ZoneType.BENCH,
        "ALL": ZoneType.BENCH,
        "POKEMON": ZoneType.BENCH,
        "EVOLUTION_POKEMON": ZoneType.BENCH,
        "OWN_POKEMON_ANY": ZoneType.BENCH,
        "ACTIVE": ZoneType.ACTIVE,
        "ACTIVATE": ZoneType.ACTIVE,
        "BENCH_TO_ACTIVE": ZoneType.ACTIVE,
        "OPPONENT_ACTIVE": ZoneType.ACTIVE,
        "ATTACKING_POKEMON": ZoneType.ACTIVE,
        "OPPONENT_BENCH_OR_ACTIVE": ZoneType.ACTIVE,
        "SELF": ZoneType.ACTIVE,
        "STADIUM": ZoneType.ACTIVE,
        "PRIZES": ZoneType.PRIZES,
        "PRIZE": ZoneType.PRIZES,
        "PRIZE_CARDS": ZoneType.PRIZES,
        "LOST_ZONE": ZoneType.LOST_ZONE,
        "ATTACHED_CARDS": ZoneType.ATTACHED_CARDS,
        "ATTACHED_ENERGY": ZoneType.ATTACHED_CARDS,
        "ATTACHED": ZoneType.ATTACHED_CARDS,
        "ENERGY": ZoneType.ATTACHED_CARDS,
    }
    if key in mapping:
        return mapping[key]
    if "DISCARD" in key:
        return ZoneType.DISCARD
    if "LOST" in key:
        return ZoneType.LOST_ZONE
    if "PRIZE" in key:
        return ZoneType.PRIZES
    if "DECK" in key:
        return ZoneType.DECK
    if "HAND" in key:
        return ZoneType.HAND
    if "BENCH" in key:
        return ZoneType.BENCH
    if "ACTIVE" in key:
        return ZoneType.ACTIVE
    if "ATTACH" in key or "ENERG" in key:
        return ZoneType.ATTACHED_CARDS
    raise ValueError(f"Zone (ZoneType) inconnue : {val!r}")


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


def _sync_effect_zones(
    primitive: EffectPrimitive,
    target: Optional[EffectTarget],
    source_zone: Optional[ZoneType],
    dest_zone: Optional[ZoneType],
    zone: Optional[ZoneType],
) -> tuple[Optional[ZoneType], Optional[ZoneType], Optional[ZoneType]]:
    """Synchronise `sourceZone`, `destinationZone` et `zone` de façon cohérente."""
    if source_zone is None and dest_zone is None and zone is not None:
        if primitive in {
            EffectPrimitive.SEARCH_DECK,
            EffectPrimitive.DRAW_CARDS,
            EffectPrimitive.SHUFFLE_HAND_DRAW,
            EffectPrimitive.MILL_DECK,
        }:
            if zone == ZoneType.DECK:
                source_zone = ZoneType.DECK
                if target in {EffectTarget.OWN_BENCH_SINGLE, EffectTarget.OWN_BENCH_ALL}:
                    dest_zone = ZoneType.BENCH
                else:
                    dest_zone = ZoneType.HAND
            elif zone in {ZoneType.HAND, ZoneType.BENCH}:
                source_zone = ZoneType.DECK
                dest_zone = zone
            else:
                source_zone = zone
        elif primitive == EffectPrimitive.RECOVER_FROM_DISCARD:
            source_zone = ZoneType.DISCARD
            if zone in {ZoneType.HAND, ZoneType.DECK, ZoneType.BENCH, ZoneType.TOP_OF_DECK}:
                dest_zone = zone
        elif primitive == EffectPrimitive.DISCARD_CARDS:
            source_zone = zone
            dest_zone = ZoneType.DISCARD
        elif primitive == EffectPrimitive.ATTACH_ENERGY:
            source_zone = zone
            dest_zone = ZoneType.ATTACHED_CARDS
        elif primitive == EffectPrimitive.EVOLVE_POKEMON:
            source_zone = zone
            dest_zone = ZoneType.BENCH if target in {EffectTarget.OWN_BENCH_SINGLE, EffectTarget.OWN_BENCH_ALL} else ZoneType.ACTIVE
        elif primitive == EffectPrimitive.SWITCH_ACTIVE:
            source_zone = ZoneType.BENCH
            dest_zone = ZoneType.ACTIVE
        else:
            source_zone = zone

    if zone is None:
        zone = source_zone or dest_zone

    return source_zone, dest_zone, zone


class AtomicEffect(BaseModel):
    """Effet atomique normalisé exécuté par une action."""

    model_config = ConfigDict(extra="ignore")

    primitive: EffectPrimitive = Field(description="Primitive d'effet normalisée")
    target: Optional[EffectTarget] = Field(
        default=None,
        description="Cible stricte de l'effet (`EffectTarget`)",
    )
    value: Optional[int] = Field(
        default=None,
        description="Valeur numérique de l'effet (ex: 200 pour les dégâts ou le soin)",
    )
    count: Optional[int] = Field(
        default=None,
        description="Nombre d'éléments affectés (ex: 2 cartes à piocher ou chercher)",
    )
    sourceZone: Optional[ZoneType] = Field(
        default=None,
        description="Zone d'origine de la carte ou ressource (ex: 'DECK', 'DISCARD', 'HAND')",
    )
    destinationZone: Optional[ZoneType] = Field(
        default=None,
        description="Zone de destination de la carte ou ressource (ex: 'HAND', 'BENCH', 'ACTIVE', 'DISCARD')",
    )
    zone: Optional[ZoneType] = Field(
        default=None,
        description="Zone principale impliquée (`ZoneType`, synchronisée avec sourceZone/destinationZone)",
    )
    filter: Optional[str] = Field(
        default=None,
        description="Filtre normalisé (ex: 'CATEGORY:POKEMON|STAGE:BASIC|MAX_HP:70', 'CATEGORY:ENERGY|TYPE:Feu')",
    )
    specialCondition: Optional[SpecialCondition] = Field(
        default=None,
        description="État spécial appliqué (obligatoire si primitive == APPLY_SPECIAL_CONDITION)",
    )
    coinFlipMode: Optional[CoinFlipMode] = Field(
        default=None,
        description="Mode de lancer de pièce associé à cet effet",
    )
    coinCount: Optional[int] = Field(
        default=None,
        description="Nombre de pièces lancées si applicable",
    )
    scalingOperator: Optional[ScalingOperator] = Field(
        default=None,
        description="Opérateur de scaling des dégâts/effets (`ADD` ou `MULTIPLY`)",
    )
    scalingMetric: Optional[ScalingMetric] = Field(
        default=None,
        description="Métrique de scaling (`ScalingMetric`)",
    )
    bonusValue: Optional[int] = Field(
        default=None,
        description="Montant du bonus ou multiplicateur par unité",
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
        raw_prim = out.get("primitive")
        if raw_prim is None:
            raw_prim = out.get("type")
        if raw_prim is None:
            raw_prim = out.get("effect")
        prim = _coerce_effect_primitive(raw_prim)
        out["primitive"] = prim

        # Compatibilité value <-> baseDamage / amount / damage / heal
        if out.get("value") is None:
            for alt_key in ("baseDamage", "damage", "amount", "heal", "damageScalingValue"):
                if out.get(alt_key) is not None:
                    out["value"] = out.get(alt_key)
                    break
        out["value"] = _coerce_optional_int(out.get("value"))

        # Compatibilité count & coinCount & bonusValue
        out["count"] = _coerce_optional_int(out.get("count"))
        out["coinCount"] = _coerce_optional_int(out.get("coinCount"))
        out["bonusValue"] = _coerce_optional_int(out.get("bonusValue"))

        # Sauvegarde si target contenait une zone explicite (ex: 'DECK', 'OPPONENT_HAND')
        raw_tgt = out.get("target")
        if isinstance(raw_tgt, str):
            tgt_upper = raw_tgt.strip().upper()
            if out.get("zone") is None and out.get("sourceZone") is None:
                if tgt_upper in {"DECK", "OWN_DECK", "PLAYER_DECK", "OPPONENT_DECK"}:
                    out["sourceZone"] = ZoneType.DECK
                elif tgt_upper in {"HAND", "OWN_HAND", "PLAYER_HAND", "OPPONENT_HAND"}:
                    out["sourceZone"] = ZoneType.HAND
                elif tgt_upper in {"DISCARD", "OWN_DISCARD"}:
                    out["sourceZone"] = ZoneType.DISCARD

        target = _coerce_effect_target(raw_tgt)
        out["target"] = target

        # Compatibilité zones (`sourceZone`, `destinationZone`, `zone`)
        src_z = _coerce_zone_type(out.get("sourceZone"))
        dst_z = _coerce_zone_type(out.get("destinationZone") or out.get("targetZone"))
        raw_z = _coerce_zone_type(out.get("zone"))
        src_z, dst_z, main_z = _sync_effect_zones(prim, target, src_z, dst_z, raw_z)
        out["sourceZone"] = src_z
        out["destinationZone"] = dst_z
        out["zone"] = main_z

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

        # Compatibilité specialCondition
        raw_sc = (
            out.get("specialCondition")
            if out.get("specialCondition") is not None
            else (out.get("statusCondition") or out.get("status") or out.get("condition"))
        )
        sc = _coerce_special_condition(raw_sc)
        if sc is None and prim == EffectPrimitive.APPLY_SPECIAL_CONDITION:
            # Récupération depuis raw_prim (ex: 'POISON', 'BURN') ou filter
            for hint in (raw_prim, out.get("filter")):
                if hint is not None:
                    try:
                        sc = _coerce_special_condition(hint)
                        if sc is not None:
                            break
                    except ValueError:
                        pass
        out["specialCondition"] = sc

        # Champs coinFlip et scaling
        out["coinFlipMode"] = _coerce_coin_flip_mode(out.get("coinFlipMode"))
        out["scalingOperator"] = _coerce_scaling_operator(out.get("scalingOperator"))
        out["scalingMetric"] = _coerce_scaling_metric(out.get("scalingMetric"))

        out["upTo"] = _coerce_bool(out.get("upTo"), default=False)
        out["optional"] = _coerce_bool(out.get("optional"), default=False)
        return out

    @model_validator(mode="after")
    def _validate_effect_invariants(self) -> "AtomicEffect":
        if self.primitive == EffectPrimitive.APPLY_SPECIAL_CONDITION and self.specialCondition is None:
            raise ValueError(
                "Le champ `specialCondition` (POISONED, BURNED, ASLEEP, PARALYZED, CONFUSED) "
                "est obligatoire lorsque `primitive == APPLY_SPECIAL_CONDITION`."
            )
        return self


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
