"""Schémas Pydantic V2 stricts et Enums fermés de primitives atomiques pour le compilateur Pokémon TCG.

Ce module définit :
1. Les 10 Enums fermés obligatoires utilisés pour borner la génération LLM via GBNF.
2. Le modèle `LLMCompiledCardPart` dont le JSON Schema guide `llama-cpp-python` en Constrained Decoding.
3. Le modèle consolidé `EngineCardModel` fusionnant les métadonnées déterministes TCGdex (`identity`,
   `pokemonStats`) et la sortie compilée de l'IA (`playableActions`, `strategicEvaluator`).
"""

from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


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
    TECH_UTILITY = "TECH_UTILITY"


class ActionSourceType(str, Enum):
    TRAINER_PLAY = "TRAINER_PLAY"
    ABILITY_ACTIVATED = "ABILITY_ACTIVATED"
    ABILITY_ON_EVOLVE = "ABILITY_ON_EVOLVE"
    ABILITY_PASSIVE = "ABILITY_PASSIVE"
    ATTACK = "ATTACK"


class ActionTiming(str, Enum):
    ONCE_PER_CARD = "ONCE_PER_CARD"
    ONCE_PER_TURN_ABILITY = "ONCE_PER_TURN_ABILITY"
    ONCE_PER_TURN_SUPPORTER = "ONCE_PER_TURN_SUPPORTER"
    ONCE_PER_GAME_VSTAR = "ONCE_PER_GAME_VSTAR"
    ON_EVOLVE_TRIGGER = "ON_EVOLVE_TRIGGER"
    END_OF_TURN_ATTACK = "END_OF_TURN_ATTACK"


class PreconditionType(str, Enum):
    ZONE_HAS_MATCHING_CARD = "ZONE_HAS_MATCHING_CARD"
    BENCH_HAS_EMPTY_SLOTS = "BENCH_HAS_EMPTY_SLOTS"
    HAND_MIN_OTHER_CARDS = "HAND_MIN_OTHER_CARDS"
    PLAYER_BEHIND_ON_PRIZES = "PLAYER_BEHIND_ON_PRIZES"
    KO_SUFFERED_LAST_TURN = "KO_SUFFERED_LAST_TURN"
    BASIC_IN_PLAY_PREVIOUS_TURN = "BASIC_IN_PLAY_PREVIOUS_TURN"
    SELF_IS_ACTIVE = "SELF_IS_ACTIVE"
    SELF_HAS_ENERGY_COST = "SELF_HAS_ENERGY_COST"


class CostType(str, Enum):
    DISCARD_FROM_HAND = "DISCARD_FROM_HAND"
    DISCARD_ENERGY_FROM_PLAY = "DISCARD_ENERGY_FROM_PLAY"
    PUT_DAMAGE_COUNTERS_ON_SELF = "PUT_DAMAGE_COUNTERS_ON_SELF"
    END_TURN_IMMEDIATELY = "END_TURN_IMMEDIATELY"


class EffectPrimitive(str, Enum):
    SEARCH_DECK_TO_HAND = "SEARCH_DECK_TO_HAND"
    SEARCH_DECK_TO_BENCH = "SEARCH_DECK_TO_BENCH"
    DRAW_CARDS = "DRAW_CARDS"
    DISCARD_HAND_AND_DRAW = "DISCARD_HAND_AND_DRAW"
    SHUFFLE_HAND_AND_DRAW = "SHUFFLE_HAND_AND_DRAW"
    SHUFFLE_HAND_BOTTOM_DRAW_PRIZES = "SHUFFLE_HAND_BOTTOM_DRAW_PRIZES"
    LOOK_TOP_DECK_PICK = "LOOK_TOP_DECK_PICK"
    EVOLVE_NORMAL = "EVOLVE_NORMAL"
    EVOLVE_SKIP_STAGE1 = "EVOLVE_SKIP_STAGE1"
    SEARCH_AND_ATTACH_ENERGY = "SEARCH_AND_ATTACH_ENERGY"
    ATTACH_ENERGY_FROM_DISCARD = "ATTACH_ENERGY_FROM_DISCARD"
    ATTACH_EXTRA_ENERGY_FROM_HAND = "ATTACH_EXTRA_ENERGY_FROM_HAND"
    RECOVER_DISCARD_TO_HAND = "RECOVER_DISCARD_TO_HAND"
    SHUFFLE_DISCARD_TO_DECK = "SHUFFLE_DISCARD_TO_DECK"
    SWITCH_ACTIVE_POKEMON = "SWITCH_ACTIVE_POKEMON"
    GUST_OPPONENT_BENCH = "GUST_OPPONENT_BENCH"
    DEAL_DAMAGE_ACTIVE = "DEAL_DAMAGE_ACTIVE"
    DISTRIBUTE_DAMAGE_COUNTERS_BENCH = "DISTRIBUTE_DAMAGE_COUNTERS_BENCH"


class ZoneType(str, Enum):
    DECK = "DECK"
    HAND = "HAND"
    DISCARD = "DISCARD"
    BENCH = "BENCH"
    ACTIVE = "ACTIVE"
    IN_PLAY_ALL = "IN_PLAY_ALL"
    PRIZES = "PRIZES"


class DeadCardReason(str, Enum):
    NO_VALID_TARGET_IN_DECK = "NO_VALID_TARGET_IN_DECK"
    NO_STAGE2_LEFT_IN_DECK_OR_HAND = "NO_STAGE2_LEFT_IN_DECK_OR_HAND"
    NO_BASE_POKEMON_LINE_LEFT = "NO_BASE_POKEMON_LINE_LEFT"
    BENCH_ALREADY_FULL = "BENCH_ALREADY_FULL"
    NOT_BEHIND_ON_PRIZES = "NOT_BEHIND_ON_PRIZES"
    DISCARD_PILE_EMPTY = "DISCARD_PILE_EMPTY"


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
    energyType: Optional[str] = Field(
        default=None,
        description="Type d'énergie ou de Pokémon requis (ex: 'Feu', 'Fire', 'Obscurité') ou null.",
    )
    specificCardName: Optional[str] = Field(
        default=None,
        description="Nom exact du Pokémon ou de la carte ciblée (ex: 'Salamèche', 'Dracaufeu ex') ou null.",
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


# ============================================================================
# C. SORTIE CONTRAINTE DU LLM (GBNF) ET MODÈLE CONSOLIDÉ FINAL
# ============================================================================


class LLMCompiledCardPart(BaseModel):
    """Schéma strict utilisé directement dans `response_format` de `llama-cpp-python` (Constrained Decoding GBNF)."""

    model_config = ConfigDict(extra="forbid")

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
    rawRulesText: List[str] = Field(
        default_factory=list,
        description="Textes complets des effets, talents et attaques issus de TCGdex (FR + EN).",
    )


class PokemonStats(BaseModel):
    """Statistiques déterministes et lignée d'évolution pour les cartes de catégorie POKEMON."""

    model_config = ConfigDict(extra="forbid")

    hp: int = Field(..., ge=0, description="Points de vie (PV / HP) du Pokémon.")
    types: List[str] = Field(default_factory=list, description="Types élémentaires du Pokémon.")
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
    resistances: List[str] = Field(default_factory=list, description="Types de résistance du Pokémon.")
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


class CompilationMetadata(BaseModel):
    """Informations de traçabilité sur la compilation LLM de la carte."""

    model_config = ConfigDict(extra="forbid")

    modelRepoId: str = Field(..., description="Dépôt Hugging Face du modèle GGUF utilisé.")
    modelFilename: str = Field(..., description="Nom du fichier GGUF utilisé.")
    compilationTimeSeconds: float = Field(..., ge=0.0, description="Temps d'inférence en secondes.")
    compiledAtIso: str = Field(..., description="Date/heure ISO 8601 de génération.")


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
