/**
 * Contrat de données strict `EngineCardModel` aligné à 100 % sur `card-compiler/compiler/schemas.py`.
 */

export type CardCategory = 'POKEMON' | 'TRAINER' | 'ENERGY'

export type CardSubCategory =
  | 'BASIC'
  | 'STAGE_1'
  | 'STAGE_2'
  | 'ITEM'
  | 'SUPPORTER'
  | 'TOOL'
  | 'STADIUM'
  | 'BASIC_ENERGY'
  | 'SPECIAL_ENERGY'

export type StrategicRole =
  | 'MAIN_ATTACKER'
  | 'SECONDARY_ATTACKER'
  | 'DRAW_ENGINE_POKEMON'
  | 'TUTOR_ENGINE_POKEMON'
  | 'ENERGY_ACCELERATOR'
  | 'BENCH_DEPLOYER'
  | 'CONSISTENCY_TUTOR'
  | 'EVOLUTION_ACCELERATOR'
  | 'HAND_REFRESH_DRAW'
  | 'HAND_DISRUPTION'
  | 'GUST_BOSS_EFFECT'
  | 'RECOVERY_RECYCLER'
  | 'MOBILITY_SWITCH'
  | 'RESOURCE_ENERGY'
  | 'TECH_UTILITY'

export type ActionSourceType =
  | 'TRAINER_PLAY'
  | 'ABILITY_ACTIVATED'
  | 'ABILITY_ON_EVOLVE'
  | 'ABILITY_PASSIVE'
  | 'ATTACK'

export type ActionTiming =
  | 'ONCE_PER_CARD'
  | 'ONCE_PER_TURN_ABILITY'
  | 'ONCE_PER_TURN_SUPPORTER'
  | 'ONCE_PER_GAME_VSTAR'
  | 'ON_EVOLVE_TRIGGER'
  | 'END_OF_TURN_ATTACK'

export type PreconditionType =
  | 'ZONE_HAS_MATCHING_CARD'
  | 'BENCH_HAS_EMPTY_SLOTS'
  | 'HAND_MIN_OTHER_CARDS'
  | 'PLAYER_BEHIND_ON_PRIZES'
  | 'KO_SUFFERED_LAST_TURN'
  | 'BASIC_IN_PLAY_PREVIOUS_TURN'
  | 'SELF_IS_ACTIVE'
  | 'SELF_HAS_ENERGY_COST'

export type CostType =
  | 'DISCARD_FROM_HAND'
  | 'DISCARD_ENERGY_FROM_PLAY'
  | 'PUT_DAMAGE_COUNTERS_ON_SELF'
  | 'END_TURN_IMMEDIATELY'

export type EffectPrimitive =
  | 'SEARCH_DECK_TO_HAND'
  | 'SEARCH_DECK_TO_BENCH'
  | 'DRAW_CARDS'
  | 'DISCARD_HAND_AND_DRAW'
  | 'SHUFFLE_HAND_AND_DRAW'
  | 'SHUFFLE_HAND_BOTTOM_DRAW_PRIZES'
  | 'LOOK_TOP_DECK_PICK'
  | 'EVOLVE_NORMAL'
  | 'EVOLVE_SKIP_STAGE1'
  | 'SEARCH_AND_ATTACH_ENERGY'
  | 'ATTACH_ENERGY_FROM_DISCARD'
  | 'ATTACH_EXTRA_ENERGY_FROM_HAND'
  | 'RECOVER_DISCARD_TO_HAND'
  | 'SHUFFLE_DISCARD_TO_DECK'
  | 'SWITCH_ACTIVE_POKEMON'
  | 'GUST_OPPONENT_BENCH'
  | 'DEAL_DAMAGE_ACTIVE'
  | 'DISTRIBUTE_DAMAGE_COUNTERS_BENCH'

export type ZoneType =
  | 'DECK'
  | 'HAND'
  | 'DISCARD'
  | 'BENCH'
  | 'ACTIVE'
  | 'IN_PLAY_ALL'
  | 'PRIZES'

export type DeadCardReason =
  | 'NO_VALID_TARGET_IN_DECK'
  | 'NO_STAGE2_LEFT_IN_DECK_OR_HAND'
  | 'NO_BASE_POKEMON_LINE_LEFT'
  | 'BENCH_ALREADY_FULL'
  | 'NOT_BEHIND_ON_PRIZES'
  | 'DISCARD_PILE_EMPTY'

export interface CardFilter {
  category?: CardCategory | null
  subCategory?: CardSubCategory | null
  maxHp?: number | null
  energyType?: string | null
  specificCardName?: string | null
}

export interface ActionPrecondition {
  type: PreconditionType
  zone?: ZoneType | null
  minCount: number
  targetFilter?: CardFilter | null
}

export interface ActionCost {
  type: CostType
  count: number
  targetFilter?: CardFilter | null
}

export interface AtomicEffect {
  primitive: EffectPrimitive
  sourceZone?: ZoneType | null
  targetZone?: ZoneType | null
  count: number
  upTo: boolean
  targetFilter?: CardFilter | null
  baseDamage?: number | null
  damageScalingPerOpponentPrizeTaken?: number | null
}

export interface PlayableAction {
  actionId: string
  label: string
  sourceType: ActionSourceType
  timing: ActionTiming
  canUseTurn1GoingFirst: boolean
  canUseTurn1GoingSecond: boolean
  preconditions: ActionPrecondition[]
  costs: ActionCost[]
  effects: AtomicEffect[]
}

export interface TurnPhaseWeights {
  turn1: number
  turn2: number
  turn3: number
  turn4Plus: number
}

export interface SynergyRequirement {
  requiredFilter: CardFilter
  minCountInDeck: number
  ifMissingSetValueToZero: boolean
  bonusWeightPerCopy: number
}

export interface DeadCardCondition {
  reason: DeadCardReason
  zonesToCheck: ZoneType[]
  targetFilter?: CardFilter | null
}

export interface StrategicEvaluator {
  primaryRole: StrategicRole
  intrinsicBaseScore: number
  turnPhaseWeights: TurnPhaseWeights
  decklistSynergyRequirements: SynergyRequirement[]
  inGameDeadCardConditions: DeadCardCondition[]
  discardPriorityWhenDead: number
  holdForNextTurnBonus: number
}

export interface CardIdentity {
  cardId: string
  nameFr: string
  nameEn?: string | null
  setId: string
  setName?: string | null
  localId: string
  category: CardCategory
  subCategory: CardSubCategory
  regulationMark?: string | null
  legalStandard: boolean
  legalExpanded: boolean
  rarity?: string | null
  imageUrl?: string | null
  rawRulesText: string[]
}

export interface PokemonStats {
  hp: number
  types: string[]
  stage?: string | null
  evolvesFrom?: string | null
  rootBasicName?: string | null
  evolutionChain: string[]
  retreatCost: number
  weaknesses: string[]
  resistances: string[]
  prizeCardsGiven: number
  isRuleBox: boolean
}

export interface CompilationMetadata {
  modelRepoId: string
  modelFilename: string
  compilationTimeSeconds: number
  compiledAtIso: string
}

export interface EngineCardModel {
  cardId: string
  identity: CardIdentity
  pokemonStats: PokemonStats | null
  category: CardCategory
  subCategory: CardSubCategory
  playableActions: PlayableAction[]
  strategicEvaluator: StrategicEvaluator
  compilationMetadata?: CompilationMetadata | null
}

export interface ConsolidatedCardsDatabase {
  schemaVersion: string
  updatedAtIso: string
  totalCards: number
  cards: Record<string, EngineCardModel>
}
