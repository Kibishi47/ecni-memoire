"""Schémas Pydantic V2 stricts et Enums fermés de primitives atomiques pour le compilateur Pokémon TCG.

Ce module définit :
1. Les 10 Enums fermés obligatoires utilisés pour borner la génération LLM via GBNF.
2. Le modèle `LLMCompiledCardPart` dont le JSON Schema guide `llama-cpp-python` en Constrained Decoding.
3. Le modèle consolidé `EngineCardModel` fusionnant les métadonnées déterministes TCGdex (`identity`,
   `pokemonStats`) et la sortie compilée de l'IA (`playableActions`, `strategicEvaluator`).
"""

from __future__ import annotations

import difflib
import re
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ============================================================================
# A. ENUMS FERMÉS OBLIGATOIRES
# ============================================================================


class CardCategory(str, Enum):
    POKEMON = "POKEMON"
    TRAINER = "TRAINER"
    ENERGY = "ENERGY"


class CardSubCategory(str, Enum):
    BASIC = "BASIC"
    STAGE_1 = "STAGE_1"
    STAGE_2 = "STAGE_2"
    ITEM = "ITEM"
    SUPPORTER = "SUPPORTER"
    TOOL = "TOOL"
    STADIUM = "STADIUM"
    BASIC_ENERGY = "BASIC_ENERGY"
    SPECIAL_ENERGY = "SPECIAL_ENERGY"


class StrategicRole(str, Enum):
    MAIN_ATTACKER = "MAIN_ATTACKER"
    SECONDARY_ATTACKER = "SECONDARY_ATTACKER"
    SNIPER_BENCH_ATTACKER = "SNIPER_BENCH_ATTACKER"
    DRAW_ENGINE_POKEMON = "DRAW_ENGINE_POKEMON"
    TUTOR_ENGINE_POKEMON = "TUTOR_ENGINE_POKEMON"
    ENERGY_ACCELERATOR = "ENERGY_ACCELERATOR"
    BENCH_DEPLOYER = "BENCH_DEPLOYER"
    CONSISTENCY_TUTOR = "CONSISTENCY_TUTOR"
    EVOLUTION_ACCELERATOR = "EVOLUTION_ACCELERATOR"
    HAND_REFRESH_DRAW = "HAND_REFRESH_DRAW"
    HAND_DISRUPTION = "HAND_DISRUPTION"
    GUST_BOSS_EFFECT = "GUST_BOSS_EFFECT"
    RECOVERY_RECYCLER = "RECOVERY_RECYCLER"
    MOBILITY_SWITCH = "MOBILITY_SWITCH"
    RESOURCE_ENERGY = "RESOURCE_ENERGY"
    CONTROL_LOCK_DISRUPTION = "CONTROL_LOCK_DISRUPTION"
    DEFENSIVE_TANK_WALL = "DEFENSIVE_TANK_WALL"
    PASSIVE_STAT_BUFFER = "PASSIVE_STAT_BUFFER"
    HEALER_SUPPORT = "HEALER_SUPPORT"
    TECH_UTILITY = "TECH_UTILITY"


class ActionSourceType(str, Enum):
    TRAINER_PLAY = "TRAINER_PLAY"
    ABILITY_ACTIVATED = "ABILITY_ACTIVATED"
    ABILITY_ON_EVOLVE = "ABILITY_ON_EVOLVE"
    ABILITY_ON_PLAY_FROM_HAND = "ABILITY_ON_PLAY_FROM_HAND"
    ABILITY_REACTIVE = "ABILITY_REACTIVE"
    ABILITY_PASSIVE = "ABILITY_PASSIVE"
    ATTACK = "ATTACK"
    STADIUM_EFFECT = "STADIUM_EFFECT"
    TOOL_EFFECT = "TOOL_EFFECT"
    SPECIAL_ENERGY_EFFECT = "SPECIAL_ENERGY_EFFECT"


class ActionTiming(str, Enum):
    ONCE_PER_CARD = "ONCE_PER_CARD"
    ONCE_PER_TURN_ABILITY = "ONCE_PER_TURN_ABILITY"
    AS_OFTEN_AS_YOU_LIKE = "AS_OFTEN_AS_YOU_LIKE"
    ONCE_PER_TURN_SUPPORTER = "ONCE_PER_TURN_SUPPORTER"
    ONCE_PER_TURN_STADIUM = "ONCE_PER_TURN_STADIUM"
    ONCE_PER_GAME_VSTAR = "ONCE_PER_GAME_VSTAR"
    ON_EVOLVE_TRIGGER = "ON_EVOLVE_TRIGGER"
    ON_PLAY_FROM_HAND_TRIGGER = "ON_PLAY_FROM_HAND_TRIGGER"
    ON_DAMAGED_OR_KO_TRIGGER = "ON_DAMAGED_OR_KO_TRIGGER"
    BETWEEN_TURNS_CHECKUP = "BETWEEN_TURNS_CHECKUP"
    PASSIVE_CONTINUOUS = "PASSIVE_CONTINUOUS"
    END_OF_TURN_ATTACK = "END_OF_TURN_ATTACK"


class PreconditionType(str, Enum):
    ZONE_HAS_MATCHING_CARD = "ZONE_HAS_MATCHING_CARD"
    BENCH_HAS_EMPTY_SLOTS = "BENCH_HAS_EMPTY_SLOTS"
    HAND_MIN_OTHER_CARDS = "HAND_MIN_OTHER_CARDS"
    PLAYER_BEHIND_ON_PRIZES = "PLAYER_BEHIND_ON_PRIZES"
    KO_SUFFERED_LAST_TURN = "KO_SUFFERED_LAST_TURN"
    BASIC_IN_PLAY_PREVIOUS_TURN = "BASIC_IN_PLAY_PREVIOUS_TURN"
    SELF_IS_ACTIVE = "SELF_IS_ACTIVE"
    SELF_IS_ON_BENCH = "SELF_IS_ON_BENCH"
    SELF_HAS_ENERGY_COST = "SELF_HAS_ENERGY_COST"
    HAS_TERA_POKEMON_IN_PLAY = "HAS_TERA_POKEMON_IN_PLAY"
    STADIUM_IN_PLAY = "STADIUM_IN_PLAY"
    OPPONENT_ACTIVE_HAS_SPECIAL_CONDITION = "OPPONENT_ACTIVE_HAS_SPECIAL_CONDITION"
    OPPONENT_PRIZES_EXACT_COUNT = "OPPONENT_PRIZES_EXACT_COUNT"
    NO_ENERGY_IN_PLAY = "NO_ENERGY_IN_PLAY"
    SECOND_PLAYER_TURN_1 = "SECOND_PLAYER_TURN_1"


class CostType(str, Enum):
    DISCARD_FROM_HAND = "DISCARD_FROM_HAND"
    DISCARD_ENERGY_FROM_PLAY = "DISCARD_ENERGY_FROM_PLAY"
    PUT_DAMAGE_COUNTERS_ON_SELF = "PUT_DAMAGE_COUNTERS_ON_SELF"
    END_TURN_IMMEDIATELY = "END_TURN_IMMEDIATELY"
    KNOCK_OUT_SELF = "KNOCK_OUT_SELF"
    SELF_DAMAGE = "SELF_DAMAGE"
    SHUFFLE_ATTACHED_ENERGY_TO_DECK = "SHUFFLE_ATTACHED_ENERGY_TO_DECK"
    CANT_ATTACK_NEXT_TURN = "CANT_ATTACK_NEXT_TURN"
    PUT_HAND_CARD_BOTTOM_DECK = "PUT_HAND_CARD_BOTTOM_DECK"


class EffectPrimitive(str, Enum):
    SEARCH_DECK_TO_HAND = "SEARCH_DECK_TO_HAND"
    SEARCH_DECK_TO_BENCH = "SEARCH_DECK_TO_BENCH"
    DRAW_CARDS = "DRAW_CARDS"
    DRAW_UNTIL_HAND_SIZE = "DRAW_UNTIL_HAND_SIZE"
    DISCARD_HAND_AND_DRAW = "DISCARD_HAND_AND_DRAW"
    SHUFFLE_HAND_AND_DRAW = "SHUFFLE_HAND_AND_DRAW"
    SHUFFLE_HAND_BOTTOM_DRAW_PRIZES = "SHUFFLE_HAND_BOTTOM_DRAW_PRIZES"
    LOOK_TOP_DECK_PICK = "LOOK_TOP_DECK_PICK"
    EVOLVE_NORMAL = "EVOLVE_NORMAL"
    EVOLVE_SKIP_STAGE1 = "EVOLVE_SKIP_STAGE1"
    SEARCH_AND_ATTACH_ENERGY = "SEARCH_AND_ATTACH_ENERGY"
    ATTACH_ENERGY_FROM_DISCARD = "ATTACH_ENERGY_FROM_DISCARD"
    ATTACH_EXTRA_ENERGY_FROM_HAND = "ATTACH_EXTRA_ENERGY_FROM_HAND"
    MOVE_ENERGY_BETWEEN_POKEMON = "MOVE_ENERGY_BETWEEN_POKEMON"
    RECOVER_DISCARD_TO_HAND = "RECOVER_DISCARD_TO_HAND"
    SHUFFLE_DISCARD_TO_DECK = "SHUFFLE_DISCARD_TO_DECK"
    RETURN_POKEMON_TO_HAND = "RETURN_POKEMON_TO_HAND"
    SWITCH_ACTIVE_POKEMON = "SWITCH_ACTIVE_POKEMON"
    GUST_OPPONENT_BENCH = "GUST_OPPONENT_BENCH"
    DEAL_DAMAGE_ACTIVE = "DEAL_DAMAGE_ACTIVE"
    DEAL_DAMAGE_BENCH = "DEAL_DAMAGE_BENCH"
    DISTRIBUTE_DAMAGE_COUNTERS_BENCH = "DISTRIBUTE_DAMAGE_COUNTERS_BENCH"
    PLACE_DAMAGE_COUNTERS = "PLACE_DAMAGE_COUNTERS"
    MOVE_DAMAGE_COUNTERS = "MOVE_DAMAGE_COUNTERS"
    HEAL_DAMAGE = "HEAL_DAMAGE"
    APPLY_SPECIAL_CONDITION = "APPLY_SPECIAL_CONDITION"
    DISCARD_OPPONENT_ENERGY = "DISCARD_OPPONENT_ENERGY"
    DISCARD_TOOL_OR_STADIUM = "DISCARD_TOOL_OR_STADIUM"
    MILL_OPPONENT_DECK = "MILL_OPPONENT_DECK"
    DISCARD_FROM_OPPONENT_HAND = "DISCARD_FROM_OPPONENT_HAND"
    DEVOLVE_OPPONENT_POKEMON = "DEVOLVE_OPPONENT_POKEMON"
    TAKE_EXTRA_PRIZE_CARDS = "TAKE_EXTRA_PRIZE_CARDS"
    PASSIVE_DAMAGE_REDUCTION = "PASSIVE_DAMAGE_REDUCTION"
    PASSIVE_DAMAGE_BOOST = "PASSIVE_DAMAGE_BOOST"
    PASSIVE_HP_BOOST = "PASSIVE_HP_BOOST"
    PASSIVE_RETREAT_COST_MOD = "PASSIVE_RETREAT_COST_MOD"
    PASSIVE_PREVENT_DAMAGE_OR_EFFECTS = "PASSIVE_PREVENT_DAMAGE_OR_EFFECTS"
    PASSIVE_ABILITY_OR_ITEM_LOCK = "PASSIVE_ABILITY_OR_ITEM_LOCK"


class ZoneType(str, Enum):
    DECK = "DECK"
    HAND = "HAND"
    DISCARD = "DISCARD"
    BENCH = "BENCH"
    ACTIVE = "ACTIVE"
    IN_PLAY_ALL = "IN_PLAY_ALL"
    PRIZES = "PRIZES"
    OPPONENT_ACTIVE = "OPPONENT_ACTIVE"
    OPPONENT_BENCH = "OPPONENT_BENCH"
    OPPONENT_IN_PLAY_ALL = "OPPONENT_IN_PLAY_ALL"
    OPPONENT_HAND = "OPPONENT_HAND"
    OPPONENT_DECK = "OPPONENT_DECK"
    OPPONENT_DISCARD = "OPPONENT_DISCARD"
    STADIUM = "STADIUM"
    LOST_ZONE = "LOST_ZONE"


class DeadCardReason(str, Enum):
    NO_VALID_TARGET_IN_DECK = "NO_VALID_TARGET_IN_DECK"
    NO_STAGE2_LEFT_IN_DECK_OR_HAND = "NO_STAGE2_LEFT_IN_DECK_OR_HAND"
    NO_BASE_POKEMON_LINE_LEFT = "NO_BASE_POKEMON_LINE_LEFT"
    BENCH_ALREADY_FULL = "BENCH_ALREADY_FULL"
    NOT_BEHIND_ON_PRIZES = "NOT_BEHIND_ON_PRIZES"
    DISCARD_PILE_EMPTY = "DISCARD_PILE_EMPTY"
    NO_TERA_POKEMON_IN_PLAY = "NO_TERA_POKEMON_IN_PLAY"
    HAND_ALREADY_FULL_OR_AT_LIMIT = "HAND_ALREADY_FULL_OR_AT_LIMIT"
    NO_DAMAGE_ON_OWN_POKEMON = "NO_DAMAGE_ON_OWN_POKEMON"
    NO_KO_LAST_TURN = "NO_KO_LAST_TURN"
    STADIUM_ALREADY_IN_PLAY_SAME_NAME = "STADIUM_ALREADY_IN_PLAY_SAME_NAME"


class DamageScalingType(str, Enum):
    PER_COIN_FLIP_HEADS = "PER_COIN_FLIP_HEADS"
    PER_ENERGY_ATTACHED_SELF = "PER_ENERGY_ATTACHED_SELF"
    PER_ENERGY_ATTACHED_ALL = "PER_ENERGY_ATTACHED_ALL"
    PER_ENERGY_ATTACHED_TARGET = "PER_ENERGY_ATTACHED_TARGET"
    PER_DAMAGE_COUNTER_ON_SELF = "PER_DAMAGE_COUNTER_ON_SELF"
    PER_DAMAGE_COUNTER_ON_FRIENDLY = "PER_DAMAGE_COUNTER_ON_FRIENDLY"
    PER_DAMAGE_COUNTER_ON_TARGET = "PER_DAMAGE_COUNTER_ON_TARGET"
    PER_ENERGY_DISCARDED = "PER_ENERGY_DISCARDED"
    PER_OPPONENT_PRIZE_TAKEN = "PER_OPPONENT_PRIZE_TAKEN"
    IF_TARGET_IS_EX_OR_EVOLUTION = "IF_TARGET_IS_EX_OR_EVOLUTION"
    PER_BENCHED_POKEMON = "PER_BENCHED_POKEMON"
    PER_CARD_IN_DISCARD_OR_LOST_ZONE = "PER_CARD_IN_DISCARD_OR_LOST_ZONE"


class SpecialConditionType(str, Enum):
    POISONED = "POISONED"
    BURNED = "BURNED"
    CONFUSED = "CONFUSED"
    PARALYZED = "PARALYZED"
    ASLEEP = "ASLEEP"


# ============================================================================
# B. MODÈLES DE FILTRES, ACTIONS ATOMIQUES ET ÉVALUATION STRATÉGIQUE
# ============================================================================


class CardFilter(BaseModel):
    """Filtre générique de ciblage de cartes utilisable dans les préconditions, coûts, effets et synergies."""

    model_config = ConfigDict(extra="forbid")

    category: Optional[CardCategory] = Field(
        default=None,
        description="Catégorie de carte ciblée (POKEMON, TRAINER, ENERGY) ou null si non restreint.",
    )
    subCategory: Optional[CardSubCategory] = Field(
        default=None,
        description=(
            "Sous-catégorie de carte ciblée (BASIC, STAGE_1, STAGE_2, ITEM, SUPPORTER, "
            "TOOL, STADIUM, BASIC_ENERGY, SPECIAL_ENERGY) ou null."
        ),
    )
    maxHp: Optional[int] = Field(
        default=None,
        description="PV maximum autorisés pour le Pokémon ciblé (ex: 70 pour Poffin Pote-Pote) ou null.",
    )
    minHp: Optional[int] = Field(
        default=None,
        description="PV minimum requis pour le Pokémon ciblé ou null.",
    )
    energyType: Optional[str] = Field(
        default=None,
        description="Type d'énergie ou de Pokémon requis (ex: 'Feu', 'Fire', 'Obscurité') ou null.",
    )
    specificCardName: Optional[str] = Field(
        default=None,
        description="Nom exact du Pokémon ou de la carte ciblée (ex: 'Salamèche', 'Dracaufeu ex') ou null.",
    )
    isRuleBox: Optional[bool] = Field(
        default=None,
        description="True si cible un Pokémon à encadré Règle (ex, V...), False si l'exclut (ex: Cuencia), ou null.",
    )
    isEvolution: Optional[bool] = Field(
        default=None,
        description="True si cible un Pokémon Évolutif (STAGE_1 ou STAGE_2), False sinon, ou null.",
    )
    isTera: Optional[bool] = Field(
        default=None,
        description="True si cible un Pokémon Téracristal, ou null.",
    )
    isAncient: Optional[bool] = Field(
        default=None,
        description="True si cible une carte Temps passé (Ancient), ou null.",
    )
    isFuture: Optional[bool] = Field(
        default=None,
        description="True si cible une carte Temps futur (Future), ou null.",
    )
    hasAbility: Optional[bool] = Field(
        default=None,
        description="True si cible un Pokémon doté d'un Talent, False si sans Talent, ou null.",
    )
    maxRetreatCost: Optional[int] = Field(
        default=None,
        description="Coût de retraite maximum autorisé ou null.",
    )


class ActionPrecondition(BaseModel):
    """Précondition formelle devant être vérifiée dans l'état du jeu avant d'exécuter une action."""

    model_config = ConfigDict(extra="forbid")

    type: PreconditionType = Field(
        ...,
        description="Type de précondition requise avant de pouvoir jouer ou activer l'action.",
    )
    zone: Optional[ZoneType] = Field(
        default=None,
        description="Zone de jeu inspectée par la précondition (DECK, HAND, DISCARD, BENCH, ACTIVE, IN_PLAY_ALL, PRIZES) ou null.",
    )
    minCount: int = Field(
        default=1,
        ge=0,
        description="Nombre minimum de cartes ou d'emplacements requis pour satisfaire la précondition.",
    )
    targetFilter: Optional[CardFilter] = Field(
        default=None,
        description="Filtre identifiant les cartes requises dans la zone vérifiée, ou null.",
    )

    @field_validator("type", mode="before")
    @classmethod
    def normalize_precondition_type(cls, v: Any) -> PreconditionType:
        if isinstance(v, PreconditionType):
            return v
        if not isinstance(v, str):
            return PreconditionType.ZONE_HAS_MATCHING_CARD
        raw = v.strip().upper()
        for p in PreconditionType:
            if p.value == raw:
                return p
        clean = re.sub(r"[^A-Z0-9]+", "_", raw).strip("_")
        for p in PreconditionType:
            if p.value == clean:
                return p
        PRECOND_MAP: Dict[str, PreconditionType] = {
            "BENCH_EMPTY_SLOTS": PreconditionType.BENCH_HAS_EMPTY_SLOTS,
            "BENCH_FULL": PreconditionType.BENCH_HAS_EMPTY_SLOTS,
            "BENCH_NOT_FULL": PreconditionType.BENCH_HAS_EMPTY_SLOTS,
            "HAND_MIN_CARDS": PreconditionType.HAND_MIN_OTHER_CARDS,
            "DISCARD_OTHER_CARDS": PreconditionType.HAND_MIN_OTHER_CARDS,
            "BEHIND_ON_PRIZES": PreconditionType.PLAYER_BEHIND_ON_PRIZES,
            "KO_LAST_TURN": PreconditionType.KO_SUFFERED_LAST_TURN,
            "ACTIVE": PreconditionType.SELF_IS_ACTIVE,
            "BENCH": PreconditionType.SELF_IS_ON_BENCH,
            "TERA": PreconditionType.HAS_TERA_POKEMON_IN_PLAY,
            "STADIUM": PreconditionType.STADIUM_IN_PLAY,
        }
        if clean in PRECOND_MAP:
            return PRECOND_MAP[clean]
        matches = difflib.get_close_matches(clean, [e.value for e in PreconditionType], n=1, cutoff=0.5)
        if matches:
            return PreconditionType(matches[0])
        return PreconditionType.ZONE_HAS_MATCHING_CARD

    @field_validator("zone", mode="before")
    @classmethod
    def sanitize_precond_zone(cls, v: Any) -> Optional[ZoneType]:
        if v is None:
            return None
        if isinstance(v, ZoneType):
            return v
        if isinstance(v, str):
            clean = v.strip().upper()
            if clean in {"BOARD", "FIELD", "PLAY", "IN_PLAY"}:
                return ZoneType.IN_PLAY_ALL
            if clean in {"GRAVEYARD", "TRASH", "DISCARD_PILE"}:
                return ZoneType.DISCARD
            try:
                return ZoneType(clean)
            except ValueError:
                return None
        return None


class ActionCost(BaseModel):
    """Coût additionnel à payer pour jouer ou activer l'action."""

    model_config = ConfigDict(extra="forbid")

    type: CostType = Field(
        ...,
        description="Nature du coût à acquitter (DISCARD_FROM_HAND, DISCARD_ENERGY_FROM_PLAY, PUT_DAMAGE_COUNTERS_ON_SELF, END_TURN_IMMEDIATELY).",
    )
    count: int = Field(
        default=1,
        ge=0,
        description="Nombre de cartes à défausser ou quantité de marqueurs de dégâts à placer.",
    )
    targetFilter: Optional[CardFilter] = Field(
        default=None,
        description="Filtre éventuel sur les cartes autorisées pour payer ce coût, ou null.",
    )

    @field_validator("type", mode="before")
    @classmethod
    def normalize_cost_type(cls, v: Any) -> CostType:
        if isinstance(v, CostType):
            return v
        if not isinstance(v, str):
            return CostType.DISCARD_FROM_HAND
        raw = v.strip().upper()
        for c in CostType:
            if c.value == raw:
                return c
        clean = re.sub(r"[^A-Z0-9]+", "_", raw).strip("_")
        for c in CostType:
            if c.value == clean:
                return c
        COST_MAP: Dict[str, CostType] = {
            "DISCARD_HAND": CostType.DISCARD_FROM_HAND,
            "DISCARD_CARD": CostType.DISCARD_FROM_HAND,
            "DISCARD": CostType.DISCARD_FROM_HAND,
            "DISCARD_ENERGY": CostType.DISCARD_ENERGY_FROM_PLAY,
            "DAMAGE_SELF": CostType.SELF_DAMAGE,
            "PUT_DAMAGE": CostType.PUT_DAMAGE_COUNTERS_ON_SELF,
            "END_TURN": CostType.END_TURN_IMMEDIATELY,
            "KO_SELF": CostType.KNOCK_OUT_SELF,
        }
        if clean in COST_MAP:
            return COST_MAP[clean]
        matches = difflib.get_close_matches(clean, [e.value for e in CostType], n=1, cutoff=0.5)
        if matches:
            return CostType(matches[0])
        return CostType.DISCARD_FROM_HAND

    @field_validator("count", mode="before")
    @classmethod
    def clamp_cost_count(cls, v: Any) -> int:
        try:
            return max(0, int(round(float(v))))
        except (ValueError, TypeError):
            return 1


class AtomicEffect(BaseModel):
    """Effet élémentaire atomique modifiant l'état de la partie Pokémon TCG."""

    model_config = ConfigDict(extra="forbid")

    primitive: EffectPrimitive = Field(
        ...,
        description="Primitive atomique normalisée décrivant l'effet mécanique.",
    )
    sourceZone: Optional[ZoneType] = Field(
        default=None,
        description="Zone de départ des cartes manipulées (ex: DECK, DISCARD, HAND) ou null.",
    )
    targetZone: Optional[ZoneType] = Field(
        default=None,
        description="Zone d'arrivée des cartes manipulées (ex: HAND, BENCH, ACTIVE, DECK) ou null.",
    )
    count: int = Field(
        default=1,
        ge=0,
        description="Nombre de cartes cherchées, piochées, attachées ou affectées par l'effet.",
    )
    upTo: bool = Field(
        default=False,
        description="True si le joueur peut choisir 'jusqu'à' count cartes (ex: Poffin Pote-Pote, Règne Infernal), False sinon.",
    )
    targetFilter: Optional[CardFilter] = Field(
        default=None,
        description="Filtre caractérisant les cartes ciblées par l'effet atomique, ou null.",
    )
    baseDamage: Optional[int] = Field(
        default=None,
        ge=0,
        description="Dégâts de base infligés par une attaque (ex: 180 pour Combustion Obscure, 120 pour Rafale Tornade) ou null.",
    )
    damageScalingPerOpponentPrizeTaken: Optional[int] = Field(
        default=None,
        ge=0,
        description="Bonus de dégâts par carte Récompense déjà prise par l'adversaire (ex: 30 pour Dracaufeu ex) ou null.",
    )
    damageScalingType: Optional[DamageScalingType] = Field(
        default=None,
        description="Type de calcul dynamique des dégâts (ex: PER_ENERGY_DISCARDED, PER_BENCHED_POKEMON, PER_COIN_FLIP_HEADS) ou null.",
    )
    damageScalingValue: Optional[int] = Field(
        default=None,
        ge=0,
        description="Valeur unitaire du bonus ou multiplicateur de dégâts dynamiques (ex: 70 pour 70×, 30 pour +30) ou null.",
    )
    specialCondition: Optional[SpecialConditionType] = Field(
        default=None,
        description="État Spécial infligé (POISONED, BURNED, CONFUSED, PARALYZED, ASLEEP) ou null.",
    )

    @field_validator("primitive", mode="before")
    @classmethod
    def normalize_primitive(cls, v: Any) -> EffectPrimitive:
        if isinstance(v, EffectPrimitive):
            return v
        if not isinstance(v, str):
            return EffectPrimitive.DEAL_DAMAGE_ACTIVE
        raw = v.strip().upper()
        for prim in EffectPrimitive:
            if prim.value == raw:
                return prim
        clean = re.sub(r"[^A-Z0-9]+", "_", raw).strip("_")
        for prim in EffectPrimitive:
            if prim.value == clean:
                return prim

        SYNONYMS: Dict[str, EffectPrimitive] = {
            # Dégâts
            "DAMAGE": EffectPrimitive.DEAL_DAMAGE_ACTIVE,
            "DEAL_DAMAGE": EffectPrimitive.DEAL_DAMAGE_ACTIVE,
            "ATTACK": EffectPrimitive.DEAL_DAMAGE_ACTIVE,
            "ATTACK_ACTIVE": EffectPrimitive.DEAL_DAMAGE_ACTIVE,
            "DAMAGE_ACTIVE": EffectPrimitive.DEAL_DAMAGE_ACTIVE,
            "DIRECT_DAMAGE": EffectPrimitive.DEAL_DAMAGE_ACTIVE,
            "INFLICT_DAMAGE": EffectPrimitive.DEAL_DAMAGE_ACTIVE,
            "DAMAGE_BENCH": EffectPrimitive.DEAL_DAMAGE_BENCH,
            "DEAL_DAMAGE_BENCH": EffectPrimitive.DEAL_DAMAGE_BENCH,
            "BENCH_DAMAGE": EffectPrimitive.DEAL_DAMAGE_BENCH,
            "SNIPER": EffectPrimitive.DEAL_DAMAGE_BENCH,
            "SNIPE": EffectPrimitive.DEAL_DAMAGE_BENCH,
            "DAMAGE_COUNTERS": EffectPrimitive.PLACE_DAMAGE_COUNTERS,
            "PLACE_DAMAGE_COUNTER": EffectPrimitive.PLACE_DAMAGE_COUNTERS,
            "PUT_DAMAGE_COUNTERS": EffectPrimitive.PLACE_DAMAGE_COUNTERS,
            "MOVE_DAMAGE_COUNTER": EffectPrimitive.MOVE_DAMAGE_COUNTERS,
            # Protection / Prévention (ex: Statitik Esquive / Splashing Dodge)
            "PREVENT_DAMAGE": EffectPrimitive.PASSIVE_PREVENT_DAMAGE_OR_EFFECTS,
            "PREVENT_ALL_DAMAGE": EffectPrimitive.PASSIVE_PREVENT_DAMAGE_OR_EFFECTS,
            "PREVENT_DAMAGE_OR_EFFECTS": EffectPrimitive.PASSIVE_PREVENT_DAMAGE_OR_EFFECTS,
            "PREVENT_EFFECTS": EffectPrimitive.PASSIVE_PREVENT_DAMAGE_OR_EFFECTS,
            "PREVENT": EffectPrimitive.PASSIVE_PREVENT_DAMAGE_OR_EFFECTS,
            "DODGE": EffectPrimitive.PASSIVE_PREVENT_DAMAGE_OR_EFFECTS,
            "INVULNERABLE": EffectPrimitive.PASSIVE_PREVENT_DAMAGE_OR_EFFECTS,
            "IMMUNITY": EffectPrimitive.PASSIVE_PREVENT_DAMAGE_OR_EFFECTS,
            "FLIP_COIN": EffectPrimitive.PASSIVE_PREVENT_DAMAGE_OR_EFFECTS,
            "COIN_FLIP": EffectPrimitive.PASSIVE_PREVENT_DAMAGE_OR_EFFECTS,
            "COIN": EffectPrimitive.PASSIVE_PREVENT_DAMAGE_OR_EFFECTS,
            # Pioche / Recherche
            "DRAW": EffectPrimitive.DRAW_CARDS,
            "DRAW_CARD": EffectPrimitive.DRAW_CARDS,
            "DRAW_CARDS": EffectPrimitive.DRAW_CARDS,
            "DRAW_UNTIL": EffectPrimitive.DRAW_UNTIL_HAND_SIZE,
            "SEARCH": EffectPrimitive.SEARCH_DECK_TO_HAND,
            "SEARCH_DECK": EffectPrimitive.SEARCH_DECK_TO_HAND,
            "SEARCH_DECK_HAND": EffectPrimitive.SEARCH_DECK_TO_HAND,
            "TUTOR": EffectPrimitive.SEARCH_DECK_TO_HAND,
            "SEARCH_BENCH": EffectPrimitive.SEARCH_DECK_TO_BENCH,
            "SEARCH_DECK_BENCH": EffectPrimitive.SEARCH_DECK_TO_BENCH,
            "CALL_FOR_FAMILY": EffectPrimitive.SEARCH_DECK_TO_BENCH,
            # Énergie
            "ATTACH_ENERGY": EffectPrimitive.ATTACH_EXTRA_ENERGY_FROM_HAND,
            "ATTACH_EXTRA_ENERGY": EffectPrimitive.ATTACH_EXTRA_ENERGY_FROM_HAND,
            "SEARCH_ENERGY": EffectPrimitive.SEARCH_AND_ATTACH_ENERGY,
            "ACCELERATE_ENERGY": EffectPrimitive.SEARCH_AND_ATTACH_ENERGY,
            "ATTACH_FROM_DISCARD": EffectPrimitive.ATTACH_ENERGY_FROM_DISCARD,
            "MOVE_ENERGY": EffectPrimitive.MOVE_ENERGY_BETWEEN_POKEMON,
            # Soin
            "HEAL": EffectPrimitive.HEAL_DAMAGE,
            "HEALING": EffectPrimitive.HEAL_DAMAGE,
            # Mouvement / Switch / Gust
            "SWITCH": EffectPrimitive.SWITCH_ACTIVE_POKEMON,
            "SWITCH_POKEMON": EffectPrimitive.SWITCH_ACTIVE_POKEMON,
            "RETREAT": EffectPrimitive.SWITCH_ACTIVE_POKEMON,
            "GUST": EffectPrimitive.GUST_OPPONENT_BENCH,
            "BOSS": EffectPrimitive.GUST_OPPONENT_BENCH,
            "GUST_BENCH": EffectPrimitive.GUST_OPPONENT_BENCH,
            "SWITCH_OPPONENT": EffectPrimitive.GUST_OPPONENT_BENCH,
            # États Spéciaux
            "SPECIAL_CONDITION": EffectPrimitive.APPLY_SPECIAL_CONDITION,
            "PARALYZE": EffectPrimitive.APPLY_SPECIAL_CONDITION,
            "POISON": EffectPrimitive.APPLY_SPECIAL_CONDITION,
            "BURN": EffectPrimitive.APPLY_SPECIAL_CONDITION,
            "ASLEEP": EffectPrimitive.APPLY_SPECIAL_CONDITION,
            "CONFUSE": EffectPrimitive.APPLY_SPECIAL_CONDITION,
            # Défausse / Meule
            "DISCARD_ENERGY": EffectPrimitive.DISCARD_OPPONENT_ENERGY,
            "DISCARD_OPPONENT_ENERGY": EffectPrimitive.DISCARD_OPPONENT_ENERGY,
            "DISCARD_HAND": EffectPrimitive.DISCARD_HAND_AND_DRAW,
            "SHUFFLE_DRAW": EffectPrimitive.SHUFFLE_HAND_AND_DRAW,
            "SHUFFLE_HAND": EffectPrimitive.SHUFFLE_HAND_AND_DRAW,
            "MILL": EffectPrimitive.MILL_OPPONENT_DECK,
            "MILL_DECK": EffectPrimitive.MILL_OPPONENT_DECK,
            "DISCARD_OPPONENT_HAND": EffectPrimitive.DISCARD_FROM_OPPONENT_HAND,
            "DEVOLVE": EffectPrimitive.DEVOLVE_OPPONENT_POKEMON,
            "EVOLVE": EffectPrimitive.EVOLVE_NORMAL,
            "RECOVER": EffectPrimitive.RECOVER_DISCARD_TO_HAND,
            "RETRIEVE": EffectPrimitive.RECOVER_DISCARD_TO_HAND,
            "DISCARD_TOOL": EffectPrimitive.DISCARD_TOOL_OR_STADIUM,
            "DISCARD_STADIUM": EffectPrimitive.DISCARD_TOOL_OR_STADIUM,
        }
        if clean in SYNONYMS:
            return SYNONYMS[clean]

        matches = difflib.get_close_matches(clean, [e.value for e in EffectPrimitive], n=1, cutoff=0.5)
        if matches:
            return EffectPrimitive(matches[0])

        if any(w in clean for w in ["DAMAGE", "ATTACK", "HIT", "STRIKE"]):
            return EffectPrimitive.DEAL_DAMAGE_ACTIVE
        if any(w in clean for w in ["DRAW", "CARD"]):
            return EffectPrimitive.DRAW_CARDS
        if any(w in clean for w in ["SEARCH", "FIND", "FETCH"]):
            return EffectPrimitive.SEARCH_DECK_TO_HAND
        if any(w in clean for w in ["ENERGY"]):
            return EffectPrimitive.ATTACH_EXTRA_ENERGY_FROM_HAND
        if any(w in clean for w in ["HEAL"]):
            return EffectPrimitive.HEAL_DAMAGE
        if any(w in clean for w in ["SWITCH"]):
            return EffectPrimitive.SWITCH_ACTIVE_POKEMON
        if any(w in clean for w in ["PREVENT", "PROTECT", "EVADE", "DODGE"]):
            return EffectPrimitive.PASSIVE_PREVENT_DAMAGE_OR_EFFECTS

        return EffectPrimitive.DEAL_DAMAGE_ACTIVE

    @field_validator("sourceZone", "targetZone", mode="before")
    @classmethod
    def sanitize_effect_zone(cls, v: Any) -> Optional[ZoneType]:
        if v is None:
            return None
        if isinstance(v, ZoneType):
            return v
        if isinstance(v, str):
            clean = v.strip().upper()
            if clean in {"BOARD", "FIELD", "PLAY", "IN_PLAY"}:
                return ZoneType.IN_PLAY_ALL
            if clean in {"GRAVEYARD", "TRASH", "DISCARD_PILE"}:
                return ZoneType.DISCARD
            try:
                return ZoneType(clean)
            except ValueError:
                return None
        return None

    @field_validator("damageScalingType", mode="before")
    @classmethod
    def normalize_damage_scaling_type(cls, v: Any) -> Optional[DamageScalingType]:
        if v is None:
            return None
        if isinstance(v, DamageScalingType):
            return v
        if isinstance(v, str):
            clean = v.strip().upper()
            for ds in DamageScalingType:
                if ds.value == clean:
                    return ds
            clean_norm = re.sub(r"[^A-Z0-9]+", "_", clean).strip("_")
            for ds in DamageScalingType:
                if ds.value == clean_norm:
                    return ds
            if "COIN" in clean_norm:
                return DamageScalingType.PER_COIN_FLIP_HEADS
            if "PRIZE" in clean_norm:
                return DamageScalingType.PER_OPPONENT_PRIZE_TAKEN
            if "BENCH" in clean_norm:
                return DamageScalingType.PER_BENCHED_POKEMON
            if "DISCARD" in clean_norm or "LOST" in clean_norm:
                return DamageScalingType.PER_CARD_IN_DISCARD_OR_LOST_ZONE
            if "ENERGY" in clean_norm:
                if "TARGET" in clean_norm:
                    return DamageScalingType.PER_ENERGY_ATTACHED_TARGET
                if "ALL" in clean_norm:
                    return DamageScalingType.PER_ENERGY_ATTACHED_ALL
                if "DISCARD" in clean_norm:
                    return DamageScalingType.PER_ENERGY_DISCARDED
                return DamageScalingType.PER_ENERGY_ATTACHED_SELF
            if "DAMAGE" in clean_norm:
                if "TARGET" in clean_norm:
                    return DamageScalingType.PER_DAMAGE_COUNTER_ON_TARGET
                if "FRIENDLY" in clean_norm:
                    return DamageScalingType.PER_DAMAGE_COUNTER_ON_FRIENDLY
                return DamageScalingType.PER_DAMAGE_COUNTER_ON_SELF
            matches = difflib.get_close_matches(clean_norm, [e.value for e in DamageScalingType], n=1, cutoff=0.5)
            if matches:
                return DamageScalingType(matches[0])
        return None

    @field_validator("specialCondition", mode="before")
    @classmethod
    def normalize_special_condition(cls, v: Any) -> Optional[SpecialConditionType]:
        if v is None:
            return None
        if isinstance(v, SpecialConditionType):
            return v
        if isinstance(v, str):
            clean = v.strip().upper()
            if "POISON" in clean:
                return SpecialConditionType.POISONED
            if "BURN" in clean:
                return SpecialConditionType.BURNED
            if "CONFUS" in clean:
                return SpecialConditionType.CONFUSED
            if "PARALY" in clean:
                return SpecialConditionType.PARALYZED
            if "SLEEP" in clean or "ASLEEP" in clean:
                return SpecialConditionType.ASLEEP
            try:
                return SpecialConditionType(clean)
            except ValueError:
                return None
        return None

    @field_validator("count", mode="before")
    @classmethod
    def clamp_effect_count(cls, v: Any) -> int:
        try:
            return max(0, int(round(float(v))))
        except (ValueError, TypeError):
            return 1

    @field_validator("baseDamage", "damageScalingPerOpponentPrizeTaken", "damageScalingValue", mode="before")
    @classmethod
    def clamp_damage_vals(cls, v: Any) -> Optional[int]:
        if v is None:
            return None
        try:
            return max(0, int(round(float(v))))
        except (ValueError, TypeError):
            return 0


class PlayableAction(BaseModel):
    """Action jouable complète (effet de carte Dresseur, Talent ou Attaque de Pokémon)."""

    model_config = ConfigDict(extra="forbid")

    actionId: str = Field(
        ...,
        description="Identifiant technique snake_case de l'action (ex: 'play_rare_candy', 'ability_quick_search', 'attack_burning_darkness').",
    )
    label: str = Field(
        ...,
        description="Nom officiel de l'action, du talent ou de l'attaque.",
    )
    sourceType: ActionSourceType = Field(
        ...,
        description="Type de source de l'action (TRAINER_PLAY, ABILITY_ACTIVATED, ABILITY_ON_EVOLVE, ABILITY_PASSIVE, ATTACK).",
    )
    timing: ActionTiming = Field(
        ...,
        description="Fréquence ou fenêtre d'activation autorisée (ONCE_PER_CARD, ONCE_PER_TURN_ABILITY, ONCE_PER_TURN_SUPPORTER, ONCE_PER_GAME_VSTAR, ON_EVOLVE_TRIGGER, END_OF_TURN_ATTACK).",
    )
    canUseTurn1GoingFirst: bool = Field(
        ...,
        description="True si utilisable au Tour 1 par le premier joueur (strictement False pour tout Supporter, toute Attaque et toute Évolution/Super Bonbon).",
    )
    canUseTurn1GoingSecond: bool = Field(
        ...,
        description="True si utilisable au Tour 1 par le second joueur (strictement False pour toute Évolution/Super Bonbon, True pour Supporter et Attaque).",
    )
    energyCost: List[str] = Field(
        default_factory=list,
        description="Liste exacte des énergies requises pour une attaque (ex: ['Électrique', 'Combat'], ['Feu', 'Feu'], ou [] sinon).",
    )
    preconditions: List[ActionPrecondition] = Field(
        default_factory=list,
        description="Liste des préconditions nécessaires pour déclarer l'action.",
    )
    costs: List[ActionCost] = Field(
        default_factory=list,
        description="Liste des coûts explicites de l'action (défausse de la main, etc.).",
    )
    effects: List[AtomicEffect] = Field(
        default_factory=list,
        description="Liste ordonnée des primitives d'effets résolues par l'action.",
    )

    @field_validator("sourceType", mode="before")
    @classmethod
    def normalize_source_type(cls, v: Any) -> ActionSourceType:
        if isinstance(v, ActionSourceType):
            return v
        if not isinstance(v, str):
            return ActionSourceType.ATTACK
        raw = v.strip().upper()
        for s in ActionSourceType:
            if s.value == raw:
                return s
        clean = re.sub(r"[^A-Z0-9]+", "_", raw).strip("_")
        for s in ActionSourceType:
            if s.value == clean:
                return s
        if "ATTACK" in clean:
            return ActionSourceType.ATTACK
        if "ABILITY" in clean or "TALENT" in clean:
            return ActionSourceType.ABILITY_ACTIVATED
        if "TRAINER" in clean or "ITEM" in clean or "SUPPORTER" in clean:
            return ActionSourceType.TRAINER_PLAY
        if "STADIUM" in clean:
            return ActionSourceType.STADIUM_EFFECT
        if "TOOL" in clean:
            return ActionSourceType.TOOL_EFFECT
        return ActionSourceType.ATTACK

    @field_validator("timing", mode="before")
    @classmethod
    def normalize_timing(cls, v: Any) -> ActionTiming:
        if isinstance(v, ActionTiming):
            return v
        if not isinstance(v, str):
            return ActionTiming.END_OF_TURN_ATTACK
        raw = v.strip().upper()
        for t in ActionTiming:
            if t.value == raw:
                return t
        clean = re.sub(r"[^A-Z0-9]+", "_", raw).strip("_")
        for t in ActionTiming:
            if t.value == clean:
                return t
        if "ATTACK" in clean:
            return ActionTiming.END_OF_TURN_ATTACK
        if "SUPPORTER" in clean:
            return ActionTiming.ONCE_PER_TURN_SUPPORTER
        if "STADIUM" in clean:
            return ActionTiming.ONCE_PER_TURN_STADIUM
        if "EVOLVE" in clean:
            return ActionTiming.ON_EVOLVE_TRIGGER
        if "ABILITY" in clean or "TURN" in clean:
            return ActionTiming.ONCE_PER_TURN_ABILITY
        if "PASSIVE" in clean:
            return ActionTiming.PASSIVE_CONTINUOUS
        return ActionTiming.ONCE_PER_CARD

    @field_validator("effects", mode="before")
    @classmethod
    def ensure_effects_list(cls, v: Any) -> List[Any]:
        if isinstance(v, dict):
            return [v]
        if isinstance(v, list):
            return v
        return []

    @model_validator(mode="before")
    @classmethod
    def filter_or_migrate_attack_costs(cls, data: Any) -> Any:
        if isinstance(data, dict):
            # Si le LLM a placé un coût en énergie dans `costs` au lieu de `energyCost`
            raw_costs = data.get("costs")
            if isinstance(raw_costs, list):
                valid_costs = []
                for c in raw_costs:
                    if isinstance(c, dict):
                        if ("energyType" in c or "energy" in c) and "type" not in c:
                            e_val = c.get("energyType") or c.get("energy")
                            if e_val and isinstance(e_val, str):
                                if "energyCost" not in data or not isinstance(data["energyCost"], list):
                                    data["energyCost"] = []
                                count = c.get("count", 1)
                                try:
                                    cnt = int(count)
                                except Exception:
                                    cnt = 1
                                for _ in range(max(1, cnt)):
                                    data["energyCost"].append(e_val)
                            continue
                    valid_costs.append(c)
                data["costs"] = valid_costs
        return data


class TurnPhaseWeights(BaseModel):
    """Pondérations de l'impact stratégique de la carte selon le tour de jeu."""

    model_config = ConfigDict(extra="forbid")

    turn1: float = Field(
        ...,
        ge=0.0,
        le=2.0,
        description="Coefficient d'utilité au Tour 1 (0.0 à 2.0).",
    )
    turn2: float = Field(
        ...,
        ge=0.0,
        le=2.0,
        description="Coefficient d'utilité au Tour 2 (0.0 à 2.0).",
    )
    turn3: float = Field(
        ...,
        ge=0.0,
        le=2.0,
        description="Coefficient d'utilité au Tour 3 (0.0 à 2.0).",
    )
    turn4Plus: float = Field(
        ...,
        ge=0.0,
        le=2.0,
        description="Coefficient d'utilité aux Tours 4 et suivants (0.0 à 2.0).",
    )

    @field_validator("turn1", "turn2", "turn3", "turn4Plus", mode="before")
    @classmethod
    def clamp_phase_weight(cls, v: Any) -> float:
        try:
            val = float(v)
            return max(0.0, min(2.0, round(val, 2)))
        except (ValueError, TypeError):
            return 1.0


class SynergyRequirement(BaseModel):
    """Condition de synergie de decklist pour l'évaluation statique et dynamique de la carte."""

    model_config = ConfigDict(extra="forbid")

    requiredFilter: CardFilter = Field(
        ...,
        description="Filtre des cartes devant être présentes dans la decklist (ex: STAGE_2 pour Super Bonbon, BASIC <= 70 PV pour Poffin Pote-Pote).",
    )
    minCountInDeck: int = Field(
        default=1,
        ge=1,
        description="Nombre minimal d'exemplaires correspondants attendus dans le deck.",
    )
    ifMissingSetValueToZero: bool = Field(
        default=False,
        description="True si l'absence totale de cartes correspondantes dans le deck annule complètement la valeur de cette carte (ex: Super Bonbon sans aucun STAGE_2).",
    )
    bonusWeightPerCopy: float = Field(
        default=0.0,
        ge=0.0,
        description="Bonus de score attribué par exemplaire compatible présent dans le deck.",
    )

    @field_validator("minCountInDeck", mode="before")
    @classmethod
    def clamp_min_count(cls, v: Any) -> int:
        try:
            return max(1, int(round(float(v))))
        except (ValueError, TypeError):
            return 1

    @field_validator("bonusWeightPerCopy", mode="before")
    @classmethod
    def clamp_bonus_weight(cls, v: Any) -> float:
        try:
            return max(0.0, float(v))
        except (ValueError, TypeError):
            return 0.0


class DeadCardCondition(BaseModel):
    """Condition dynamique en cours de partie rendant la carte injouable ou inutile (carte morte)."""

    model_config = ConfigDict(extra="forbid")

    reason: DeadCardReason = Field(
        ...,
        description="Motif normalisé de carte morte (NO_VALID_TARGET_IN_DECK, NO_STAGE2_LEFT_IN_DECK_OR_HAND, NO_BASE_POKEMON_LINE_LEFT, BENCH_ALREADY_FULL, NOT_BEHIND_ON_PRIZES, DISCARD_PILE_EMPTY).",
    )
    zonesToCheck: List[ZoneType] = Field(
        ...,
        description="Zones du jeu à vérifier pour déterminer si la carte est devenue morte (ex: [DECK], [DECK, HAND], [BENCH]).",
    )
    targetFilter: Optional[CardFilter] = Field(
        default=None,
        description="Filtre des cartes cibles dont l'absence dans zonesToCheck déclenche l'état de carte morte, ou null.",
    )

    @field_validator("reason", mode="before")
    @classmethod
    def normalize_dead_card_reason(cls, v: Any) -> DeadCardReason:
        if isinstance(v, DeadCardReason):
            return v
        if not isinstance(v, str):
            return DeadCardReason.NO_VALID_TARGET_IN_DECK
        raw = v.strip().upper()
        for r in DeadCardReason:
            if r.value == raw:
                return r
        clean = re.sub(r"[^A-Z0-9]+", "_", raw).strip("_")
        for r in DeadCardReason:
            if r.value == clean:
                return r

        REASON_SYNONYMS: Dict[str, DeadCardReason] = {
            "BENCH_FULL": DeadCardReason.BENCH_ALREADY_FULL,
            "BENCH_IS_FULL": DeadCardReason.BENCH_ALREADY_FULL,
            "FULL_BENCH": DeadCardReason.BENCH_ALREADY_FULL,
            "NO_TARGET": DeadCardReason.NO_VALID_TARGET_IN_DECK,
            "NO_TARGETS": DeadCardReason.NO_VALID_TARGET_IN_DECK,
            "NO_TARGET_IN_DECK": DeadCardReason.NO_VALID_TARGET_IN_DECK,
            "DECK_EMPTY": DeadCardReason.NO_VALID_TARGET_IN_DECK,
            "NO_CARDS_IN_DECK": DeadCardReason.NO_VALID_TARGET_IN_DECK,
            "NO_STAGE2": DeadCardReason.NO_STAGE2_LEFT_IN_DECK_OR_HAND,
            "NO_STAGE_2": DeadCardReason.NO_STAGE2_LEFT_IN_DECK_OR_HAND,
            "NO_BASIC": DeadCardReason.NO_BASE_POKEMON_LINE_LEFT,
            "NO_BASE": DeadCardReason.NO_BASE_POKEMON_LINE_LEFT,
            "NOT_BEHIND": DeadCardReason.NOT_BEHIND_ON_PRIZES,
            "AHEAD_ON_PRIZES": DeadCardReason.NOT_BEHIND_ON_PRIZES,
            "DISCARD_EMPTY": DeadCardReason.DISCARD_PILE_EMPTY,
            "NO_DISCARD": DeadCardReason.DISCARD_PILE_EMPTY,
            "NO_TERA": DeadCardReason.NO_TERA_POKEMON_IN_PLAY,
            "HAND_FULL": DeadCardReason.HAND_ALREADY_FULL_OR_AT_LIMIT,
            "NO_DAMAGE": DeadCardReason.NO_DAMAGE_ON_OWN_POKEMON,
            "NO_KO": DeadCardReason.NO_KO_LAST_TURN,
            "STADIUM_IN_PLAY": DeadCardReason.STADIUM_ALREADY_IN_PLAY_SAME_NAME,
        }
        if clean in REASON_SYNONYMS:
            return REASON_SYNONYMS[clean]

        matches = difflib.get_close_matches(clean, [e.value for e in DeadCardReason], n=1, cutoff=0.5)
        if matches:
            return DeadCardReason(matches[0])

        if "BENCH" in clean:
            return DeadCardReason.BENCH_ALREADY_FULL
        if "STAGE" in clean:
            return DeadCardReason.NO_STAGE2_LEFT_IN_DECK_OR_HAND
        if "BASIC" in clean or "BASE" in clean:
            return DeadCardReason.NO_BASE_POKEMON_LINE_LEFT
        if "PRIZE" in clean:
            return DeadCardReason.NOT_BEHIND_ON_PRIZES
        if "DISCARD" in clean:
            return DeadCardReason.DISCARD_PILE_EMPTY
        if "TERA" in clean:
            return DeadCardReason.NO_TERA_POKEMON_IN_PLAY
        if "HAND" in clean:
            return DeadCardReason.HAND_ALREADY_FULL_OR_AT_LIMIT
        if "DAMAGE" in clean:
            return DeadCardReason.NO_DAMAGE_ON_OWN_POKEMON
        if "KO" in clean:
            return DeadCardReason.NO_KO_LAST_TURN
        if "STADIUM" in clean:
            return DeadCardReason.STADIUM_ALREADY_IN_PLAY_SAME_NAME

        return DeadCardReason.NO_VALID_TARGET_IN_DECK

    @field_validator("zonesToCheck", mode="before")
    @classmethod
    def sanitize_zones_to_check(cls, v: Any) -> List[ZoneType]:
        if not isinstance(v, list):
            return [ZoneType.DECK]
        res: List[ZoneType] = []
        for z in v:
            if isinstance(z, ZoneType):
                res.append(z)
            elif isinstance(z, str):
                z_clean = z.strip().upper()
                if z_clean in {"BOARD", "FIELD", "PLAY", "IN_PLAY"}:
                    res.append(ZoneType.IN_PLAY_ALL)
                elif z_clean in {"GRAVEYARD", "TRASH", "DISCARD_PILE"}:
                    res.append(ZoneType.DISCARD)
                else:
                    try:
                        res.append(ZoneType(z_clean))
                    except ValueError:
                        res.append(ZoneType.DECK)
        return res or [ZoneType.DECK]


class StrategicEvaluator(BaseModel):
    """Évaluateur stratégique heuristique pour le moteur de décision Pokémon TCG."""

    model_config = ConfigDict(extra="forbid")

    primaryRole: StrategicRole = Field(
        ...,
        description="Rôle stratégique principal de la carte.",
    )
    intrinsicBaseScore: int = Field(
        ...,
        ge=0,
        le=100,
        description="Score de valeur intrinsèque de base entre 0 et 100.",
    )
    turnPhaseWeights: TurnPhaseWeights = Field(
        ...,
        description="Poids d'importance stratégique par phase de tour (turn1, turn2, turn3, turn4Plus).",
    )
    decklistSynergyRequirements: List[SynergyRequirement] = Field(
        default_factory=list,
        description="Liste des synergies requises dans la decklist pour valoriser la carte.",
    )
    inGameDeadCardConditions: List[DeadCardCondition] = Field(
        default_factory=list,
        description="Liste des conditions rendant la carte morte en cours de partie.",
    )
    discardPriorityWhenDead: int = Field(
        ...,
        ge=0,
        le=100,
        description="Priorité (0 à 100) pour défausser cette carte via un coût (ex: Hyper Ball) lorsqu'elle est morte.",
    )
    holdForNextTurnBonus: int = Field(
        ...,
        ge=0,
        le=50,
        description="Bonus (0 à 50) récompensant la conservation de la carte en main pour le tour suivant (T+1).",
    )

    @field_validator("inGameDeadCardConditions", mode="before")
    @classmethod
    def sanitize_dead_card_conditions(cls, v: Any) -> List[Any]:
        if not isinstance(v, list):
            return []
        filtered: List[Any] = []
        for item in v:
            if not isinstance(item, dict):
                filtered.append(item)
                continue
            reason = item.get("reason")
            if reason is None:
                continue
            if isinstance(reason, str):
                r_clean = reason.strip().upper()
                if r_clean in {
                    "NONE", "NOT_APPLICABLE", "N/A", "NA", "NULL",
                    "NO_CONDITION", "NO_CONDITIONS", "NEANT", "AUCUNE",
                    "NO_DEAD_CARD", "NO_DEAD_CARD_CONDITION", ""
                }:
                    continue
            zones = item.get("zonesToCheck")
            if not zones or not isinstance(zones, list):
                item["zonesToCheck"] = ["DECK"]
            filtered.append(item)
        return filtered

    @field_validator("primaryRole", mode="before")
    @classmethod
    def normalize_primary_role(cls, v: Any) -> StrategicRole:
        if isinstance(v, StrategicRole):
            return v
        if not isinstance(v, str):
            return StrategicRole.MAIN_ATTACKER
        raw = v.strip().upper()
        for r in StrategicRole:
            if r.value == raw:
                return r
        clean = re.sub(r"[^A-Z0-9]+", "_", raw).strip("_")
        for r in StrategicRole:
            if r.value == clean:
                return r
        ROLE_MAP: Dict[str, StrategicRole] = {
            "ATTACKER": StrategicRole.MAIN_ATTACKER,
            "MAIN": StrategicRole.MAIN_ATTACKER,
            "PRIMARY_ATTACKER": StrategicRole.MAIN_ATTACKER,
            "SECONDARY": StrategicRole.SECONDARY_ATTACKER,
            "SNIPER": StrategicRole.SNIPER_BENCH_ATTACKER,
            "DRAW": StrategicRole.DRAW_ENGINE_POKEMON,
            "DRAW_ENGINE": StrategicRole.DRAW_ENGINE_POKEMON,
            "TUTOR": StrategicRole.TUTOR_ENGINE_POKEMON,
            "TUTOR_ENGINE": StrategicRole.TUTOR_ENGINE_POKEMON,
            "CONSISTENCY_BOOSTER": StrategicRole.CONSISTENCY_TUTOR,
            "CONSISTENCY": StrategicRole.CONSISTENCY_TUTOR,
            "ENERGY_ACCEL": StrategicRole.ENERGY_ACCELERATOR,
            "ACCELERATOR": StrategicRole.ENERGY_ACCELERATOR,
            "BENCH": StrategicRole.BENCH_DEPLOYER,
            "DEPLOYER": StrategicRole.BENCH_DEPLOYER,
            "GUST": StrategicRole.GUST_BOSS_EFFECT,
            "BOSS": StrategicRole.GUST_BOSS_EFFECT,
            "SWITCH": StrategicRole.MOBILITY_SWITCH,
            "MOBILITY": StrategicRole.MOBILITY_SWITCH,
            "TANK": StrategicRole.DEFENSIVE_TANK_WALL,
            "WALL": StrategicRole.DEFENSIVE_TANK_WALL,
            "HEALER": StrategicRole.HEALER_SUPPORT,
            "SUPPORT": StrategicRole.HEALER_SUPPORT,
            "TECH": StrategicRole.TECH_UTILITY,
            "UTILITY": StrategicRole.TECH_UTILITY,
        }
        if clean in ROLE_MAP:
            return ROLE_MAP[clean]
        matches = difflib.get_close_matches(clean, [e.value for e in StrategicRole], n=1, cutoff=0.5)
        if matches:
            return StrategicRole(matches[0])
        return StrategicRole.MAIN_ATTACKER

    @field_validator("intrinsicBaseScore", "discardPriorityWhenDead", mode="before")
    @classmethod
    def clamp_score_100(cls, v: Any) -> int:
        try:
            return max(0, min(100, int(round(float(v)))))
        except (ValueError, TypeError):
            return 50

    @field_validator("holdForNextTurnBonus", mode="before")
    @classmethod
    def clamp_hold_bonus(cls, v: Any) -> int:
        try:
            return max(0, min(50, int(round(float(v)))))
        except (ValueError, TypeError):
            return 0


# ============================================================================
# C. SORTIE CONTRAINTE DU LLM (GBNF) ET MODÈLE CONSOLIDÉ FINAL
# ============================================================================


class LLMCompiledCardPart(BaseModel):
    """Schéma strict utilisé directement dans `response_format` de `llama-cpp-python` (Constrained Decoding GBNF)."""

    model_config = ConfigDict(extra="forbid")

    reasoningAnalysis: str = Field(
        ...,
        description=(
            "Analyse obligatoire étape par étape avant de remplir le JSON : "
            "1) Catégorie et Rôle de la carte. "
            "2) Coûts explicites exigés par le texte ('vous ne pouvez utiliser cette carte que si vous défaussez...'). "
            "3) Filtres exacts (PV max, type d'énergie précis comme Feu, sous-catégorie). "
            "4) Conditions où la carte est morte en main ou inutile dans le deck."
        ),
    )
    category: CardCategory = Field(
        ...,
        description="Catégorie principale de la carte (POKEMON, TRAINER, ENERGY).",
    )
    subCategory: CardSubCategory = Field(
        ...,
        description="Sous-catégorie exacte de la carte (BASIC, STAGE_1, STAGE_2, ITEM, SUPPORTER, TOOL, STADIUM, BASIC_ENERGY, SPECIAL_ENERGY).",
    )
    playableActions: List[PlayableAction] = Field(
        ...,
        description="Actions jouables de la carte traduites en préconditions, coûts et effets atomiques.",
    )
    strategicEvaluator: StrategicEvaluator = Field(
        ...,
        description="Profil d'évaluation stratégique dynamique de la carte.",
    )

    @field_validator("category", mode="before")
    @classmethod
    def normalize_category(cls, v: Any) -> CardCategory:
        if isinstance(v, CardCategory):
            return v
        if not isinstance(v, str):
            return CardCategory.POKEMON
        raw = v.strip().upper()
        if "POK" in raw:
            return CardCategory.POKEMON
        if "TRAIN" in raw or "DRESS" in raw:
            return CardCategory.TRAINER
        if "ENERG" in raw:
            return CardCategory.ENERGY
        try:
            return CardCategory(raw)
        except ValueError:
            return CardCategory.POKEMON

    @field_validator("subCategory", mode="before")
    @classmethod
    def normalize_sub_category(cls, v: Any) -> CardSubCategory:
        if isinstance(v, CardSubCategory):
            return v
        if not isinstance(v, str):
            return CardSubCategory.BASIC
        raw = v.strip().upper()
        SUB_MAP: Dict[str, CardSubCategory] = {
            "BASE": CardSubCategory.BASIC,
            "BASIC": CardSubCategory.BASIC,
            "STAGE_1": CardSubCategory.STAGE_1,
            "STAGE1": CardSubCategory.STAGE_1,
            "NIVEAU_1": CardSubCategory.STAGE_1,
            "NIVEAU1": CardSubCategory.STAGE_1,
            "STAGE_2": CardSubCategory.STAGE_2,
            "STAGE2": CardSubCategory.STAGE_2,
            "NIVEAU_2": CardSubCategory.STAGE_2,
            "NIVEAU2": CardSubCategory.STAGE_2,
            "ITEM": CardSubCategory.ITEM,
            "OBJET": CardSubCategory.ITEM,
            "SUPPORTER": CardSubCategory.SUPPORTER,
            "TOOL": CardSubCategory.TOOL,
            "OUTIL": CardSubCategory.TOOL,
            "STADIUM": CardSubCategory.STADIUM,
            "STADE": CardSubCategory.STADIUM,
            "BASIC_ENERGY": CardSubCategory.BASIC_ENERGY,
            "SPECIAL_ENERGY": CardSubCategory.SPECIAL_ENERGY,
        }
        clean = re.sub(r"[^A-Z0-9]+", "_", raw).strip("_")
        if clean in SUB_MAP:
            return SUB_MAP[clean]
        try:
            return CardSubCategory(clean)
        except ValueError:
            return CardSubCategory.BASIC


class CardIdentity(BaseModel):
    """Métadonnées déterministes extraites directement depuis l'API TCGdex."""

    model_config = ConfigDict(extra="forbid")

    cardId: str = Field(..., description="Identifiant unique TCGdex (ex: 'sv04-125').")
    nameFr: str = Field(..., description="Nom officiel français de la carte.")
    nameEn: Optional[str] = Field(default=None, description="Nom officiel anglais de la carte (secours/référence).")
    setId: str = Field(..., description="Identifiant de l'extension TCGdex (ex: 'sv04').")
    setName: Optional[str] = Field(default=None, description="Nom complet de l'extension.")
    localId: str = Field(..., description="Numéro local de la carte dans l'extension.")
    category: CardCategory = Field(..., description="Catégorie déterministe de la carte.")
    subCategory: CardSubCategory = Field(..., description="Sous-catégorie déterministe de la carte.")
    regulationMark: Optional[str] = Field(default=None, description="Marque de régulation officielle (ex: 'G', 'H').")
    legalStandard: bool = Field(default=True, description="Légalité au format Standard.")
    legalExpanded: bool = Field(default=True, description="Légalité au format Étendu.")
    rarity: Optional[str] = Field(default=None, description="Rareté officielle de la carte.")
    imageUrl: Optional[str] = Field(default=None, description="URL de l'image haute résolution TCGdex.")
    isAceSpec: bool = Field(
        default=False,
        description="True si la carte est une carte HIGH-TECH / ACE SPEC (limite de 1 par deck).",
    )
    isAncient: bool = Field(
        default=False,
        description="True si la carte possède la mécanique Temps passé (Ancient).",
    )
    isFuture: bool = Field(
        default=False,
        description="True si la carte possède la mécanique Temps futur (Future).",
    )
    isTechnicalMachine: bool = Field(
        default=False,
        description="True si la carte Outil est une Capsule Technique (Technical Machine).",
    )
    rawRulesText: List[str] = Field(
        default_factory=list,
        description="Textes complets des effets, talents et attaques issus de TCGdex (FR + EN).",
    )


class PokemonStats(BaseModel):
    """Statistiques déterministes et lignée d'évolution pour les cartes de catégorie POKEMON."""

    model_config = ConfigDict(extra="forbid")

    hp: int = Field(..., ge=0, description="Points de vie (PV / HP) du Pokémon.")
    types: List[str] = Field(default_factory=list, description="Types élémentaires du Pokémon.")
    dexId: List[int] = Field(
        default_factory=list,
        description="Numéros de Pokédex national issus de TCGdex.",
    )
    stage: Optional[str] = Field(default=None, description="Stade d'évolution brut TCGdex.")
    evolvesFrom: Optional[str] = Field(default=None, description="Nom du Pokémon pré-évolué direct.")
    rootBasicName: Optional[str] = Field(
        default=None,
        description="Nom du Pokémon de Base à la racine de la lignée d'évolution (ex: 'Salamèche' pour 'Dracaufeu ex').",
    )
    evolutionChain: List[str] = Field(
        default_factory=list,
        description="Lignée complète d'évolution depuis le Pokémon de Base jusqu'à cette carte.",
    )
    retreatCost: int = Field(default=0, ge=0, description="Coût de retraite du Pokémon.")
    weaknesses: List[str] = Field(default_factory=list, description="Types de faiblesse du Pokémon.")
    weaknessMultiplier: str = Field(
        default="×2",
        description="Multiplicateur ou modificateur de faiblesse (ex: '×2').",
    )
    resistances: List[str] = Field(default_factory=list, description="Types de résistance du Pokémon.")
    resistanceModifier: int = Field(
        default=-30,
        description="Modificateur de résistance (ex: -30).",
    )
    prizeCardsGiven: int = Field(
        default=1,
        ge=1,
        le=3,
        description="Nombre de cartes Récompense offertes à l'adversaire lors d'un KO (2 pour un Pokémon ex/V, 1 sinon).",
    )
    isRuleBox: bool = Field(
        default=False,
        description="True si le Pokémon possède un encadré Règle (ex, V, VSTAR, VMAX, Radieux).",
    )
    isTera: bool = Field(
        default=False,
        description="True si le Pokémon est Téracristal (immunisé aux dégâts d'attaques sur le Banc).",
    )
    isAncient: bool = Field(
        default=False,
        description="True si le Pokémon est Temps passé (Ancient).",
    )
    isFuture: bool = Field(
        default=False,
        description="True si le Pokémon est Temps futur (Future).",
    )
    hasAbility: bool = Field(
        default=False,
        description="True si le Pokémon possède au moins un Talent (Ability).",
    )


class CompilationMetadata(BaseModel):
    """Informations de traçabilité sur la compilation LLM de la carte."""

    model_config = ConfigDict(extra="forbid")

    modelRepoId: str = Field(..., description="Dépôt Hugging Face du modèle GGUF utilisé.")
    modelFilename: str = Field(..., description="Nom du fichier GGUF utilisé.")
    compilationTimeSeconds: float = Field(..., ge=0.0, description="Temps total de compilation en secondes.")
    compiledAtIso: str = Field(..., description="Date/heure ISO 8601 de génération.")
    completionTokens: Optional[int] = Field(
        default=None,
        ge=0,
        description="Nombre total de tokens générés lors de la complétion.",
    )
    tokensPerSecond: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Débit moyen de génération en tokens par seconde (t/s) calculé sur le temps effectif de génération des tokens.",
    )
    generationTimeSeconds: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Temps effectif de génération de tokens en secondes (hors délai TTFT avant premier token).",
    )
    timeToFirstTokenSeconds: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Délai avant le premier token (Time To First Token) en secondes.",
    )


class EngineCardModel(BaseModel):
    """Modèle final complet d'une carte Pokémon TCG prêt pour le moteur de simulation."""

    model_config = ConfigDict(extra="forbid")

    cardId: str = Field(..., description="Identifiant unique TCGdex de la carte.")
    identity: CardIdentity = Field(..., description="Identité déterministe extraite de TCGdex.")
    pokemonStats: Optional[PokemonStats] = Field(
        default=None,
        description="Statistiques Pokémon et lignée d'évolution (null pour les cartes Dresseur et Énergie).",
    )
    category: CardCategory = Field(..., description="Catégorie principale de la carte.")
    subCategory: CardSubCategory = Field(..., description="Sous-catégorie de la carte.")
    playableActions: List[PlayableAction] = Field(
        ...,
        description="Actions jouables compilées sous contrainte de schéma GBNF.",
    )
    strategicEvaluator: StrategicEvaluator = Field(
        ...,
        description="Évaluateur stratégique compilé sous contrainte de schéma GBNF.",
    )
    compilationMetadata: Optional[CompilationMetadata] = Field(
        default=None,
        description="Métadonnées d'exécution du compilateur.",
    )
