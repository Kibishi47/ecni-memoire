/**
 * Contrat de données strict `EngineCardModel` aligné à 100 % sur `card-compiler/compiler/schemas.py`.
 */

// ============================================================================
// A. ENUMS NORMALISÉS (MAJUSCULES AVEC UNDERSCORES)
// ============================================================================

export type CardCategory = 'POKEMON' | 'TRAINER' | 'ENERGY'

export type CardSubCategory =
  | 'BASIC'
  | 'STAGE_1'
  | 'STAGE_2'
  | 'SUPPORTER'
  | 'ITEM'
  | 'STADIUM'
  | 'TOOL'
  | 'BASIC_ENERGY'
  | 'SPECIAL_ENERGY'

export type ActionType =
  | 'PLAY_FROM_HAND'
  | 'EVOLVE'
  | 'USE_ABILITY'
  | 'TRIGGERED_ABILITY'
  | 'PASSIVE_ABILITY'
  | 'ATTACH_ENERGY'
  | 'RETREAT'
  | 'ATTACK'

export type TimingPhase =
  | 'PREPARATION'
  | 'MAIN_PHASE_1'
  | 'MAIN_PHASE_2'
  | 'ATTACK_PHASE'

export type EffectPrimitive =
  | 'SEARCH_DECK'
  | 'DRAW_CARDS'
  | 'DAMAGE_ACTIVE'
  | 'DAMAGE_BENCH'
  | 'ATTACH_ENERGY'
  | 'DISCARD_CARDS'
  | 'HEAL'
  | 'SWITCH_ACTIVE'
  | 'APPLY_SPECIAL_CONDITION'
  | 'EVOLVE_POKEMON'
  | 'SHUFFLE_HAND_DRAW'
  | 'RECOVER_FROM_DISCARD'
  | 'PLACE_DAMAGE_COUNTERS'
  | 'MOVE_DAMAGE_COUNTERS'
  | 'MOVE_ENERGY'
  | 'MODIFY_DAMAGE_TAKEN'
  | 'MODIFY_DAMAGE_DEALT'
  | 'MODIFY_HP'
  | 'MODIFY_RETREAT_COST'
  | 'PREVENT_DAMAGE_OR_EFFECTS'
  | 'LOCK_NEXT_TURN_ATTACK'
  | 'LOCK_RETREAT'
  | 'LOCK_ABILITIES'
  | 'LOCK_ITEMS'
  | 'EXPAND_BENCH'
  | 'KNOCK_OUT'
  | 'MILL_DECK'
  | 'TAKE_EXTRA_PRIZE'
  | 'PUT_ON_TOP_OR_BOTTOM_OF_DECK'

export type SpecialConditionType =
  | 'POISONED'
  | 'BURNED'
  | 'ASLEEP'
  | 'PARALYZED'
  | 'CONFUSED'

export type SpecialCondition = SpecialConditionType

export type CoinFlipMode =
  | 'SINGLE_HEADS_REQUIRED'
  | 'SINGLE_HEADS_BONUS'
  | 'MULTI_COIN_PER_HEADS'
  | 'UNTIL_TAILS_PER_HEADS'
  | 'TWO_TAILS_SELF_DAMAGE'

export type ScalingOperator = 'ADD' | 'MULTIPLY'

export type ScalingMetric =
  | 'PER_ENERGY_ON_SELF'
  | 'PER_ENERGY_ON_OPPONENT_ACTIVE'
  | 'PER_ENERGY_ON_BOTH_ACTIVES'
  | 'PER_ENERGY_IN_PLAY'
  | 'PER_ENERGY_DISCARDED'
  | 'PER_DAMAGE_COUNTER_ON_SELF'
  | 'PER_DAMAGE_COUNTER_ON_OPPONENT_ACTIVE'
  | 'PER_BENCHED_POKEMON_WITH_DAMAGE'
  | 'PER_OWN_BENCH_POKEMON'
  | 'PER_OPPONENT_BENCH_POKEMON'
  | 'PER_BOTH_BENCH_POKEMON'
  | 'PER_PRIZE_TAKEN_BY_OPPONENT'
  | 'PER_PRIZE_TAKEN_BY_PLAYER'
  | 'PER_PRIZE_REMAINING_PLAYER'
  | 'PER_CARD_IN_OWN_HAND'
  | 'PER_CARD_IN_OPPONENT_HAND'
  | 'CONDITIONAL_FLAT_BONUS'

export type EffectTarget =
  | 'SELF'
  | 'OPPONENT_ACTIVE'
  | 'OPPONENT_BENCH_SINGLE'
  | 'OPPONENT_BENCH_ALL'
  | 'OPPONENT_POKEMON_ANY'
  | 'OPPONENT_ALL_POKEMON'
  | 'OWN_ACTIVE'
  | 'OWN_BENCH_SINGLE'
  | 'OWN_BENCH_ALL'
  | 'OWN_POKEMON_ANY'
  | 'OWN_ALL_POKEMON'
  | 'ALL_POKEMON_IN_PLAY'
  | 'PLAYER'
  | 'OPPONENT'

export type EffectZoneType =
  | 'DECK'
  | 'TOP_OF_DECK'
  | 'BOTTOM_OF_DECK'
  | 'HAND'
  | 'DISCARD'
  | 'BENCH'
  | 'ACTIVE'
  | 'PRIZES'
  | 'LOST_ZONE'
  | 'ATTACHED_CARDS'

export type AIRole =
  | 'MAIN_ATTACKER'
  | 'SECONDARY_ATTACKER'
  | 'DRAW_ENGINE'
  | 'ENERGY_ACCELERATOR'
  | 'GUEST_TECH'
  | 'DISRUPTION'
  | 'CONSISTENCY_BOOSTER'

// Alias de rétrocompatibilité
export type StrategicRole = AIRole | string
export type ActionSourceType = ActionType | string
export type ActionTiming = TimingPhase | string

// ============================================================================
// B. STRUCTURES COMPOSANTES
// ============================================================================

export interface TypeModifier {
  type: string
  value: string
}

export interface CardIdentity {
  cardId: string
  nameFr: string
  nameEn?: string | null
  setId: string
  setName?: string | null
  category: CardCategory
  subCategory: CardSubCategory
  isRuleBox: boolean
  prizeCardsGiven: number
  isAceSpec: boolean
  isAncient: boolean
  isFuture: boolean
  isTera: boolean
  legalStandard: boolean
  legalExpanded: boolean

  // Métadonnées complémentaires
  localId?: string | null
  regulationMark?: string | null
  rarity?: string | null
  imageUrl?: string | null
  isTechnicalMachine?: boolean
  rawRulesText?: string[]
  mechanicTag?: 'ANCIENT' | 'FUTURE' | null
}

export interface PokemonStats {
  hp: number
  types: string[]
  stage: string
  evolvesFrom?: string | null
  rootBasicName: string
  evolutionChain: string[]
  retreatCost: number
  weaknesses: TypeModifier[]
  resistances: TypeModifier[]

  // Rétrocompatibilité / helpers
  prizeCardsGiven?: number
  isRuleBox?: boolean
  dexId?: number[]
  isTera?: boolean
  isAncient?: boolean
  isFuture?: boolean
  hasAbility?: boolean
  weaknessMultiplier?: string
  resistanceModifier?: number
  canAttackTwice?: boolean
}

export interface AtomicEffect {
  primitive: EffectPrimitive
  target?: EffectTarget | string | null
  value?: number | null
  count?: number | null
  sourceZone?: EffectZoneType | string | null
  destinationZone?: EffectZoneType | string | null
  zone?: EffectZoneType | string | null
  filter?: string | null
  specialCondition?: SpecialConditionType | null
  coinFlipMode?: CoinFlipMode | null
  coinCount?: number | null
  scalingOperator?: ScalingOperator | null
  scalingMetric?: ScalingMetric | null
  bonusValue?: number | null
  upTo?: boolean
  optional?: boolean

  // Rétrocompatibilité
  baseDamage?: number | null
  targetZone?: string | null
  targetFilter?: any
  damageScalingPerOpponentPrizeTaken?: number | null
  damageScalingType?: string | null
  damageScalingValue?: number | null
}

export interface PlayableAction {
  actionId: string
  label: string
  actionType: ActionType
  timingPhase: TimingPhase
  canUseTurn1GoingFirst: boolean
  canUseTurn1GoingSecond: boolean
  cost: Record<string, number>
  preconditions: string[]
  effects: AtomicEffect[]
  deadCardCondition?: string | null

  // Rétrocompatibilité
  sourceType?: ActionSourceType
  timing?: ActionTiming
  costs?: any[]
  energyCost?: string[]
  canAttackTwice?: boolean
}

export interface TurnPhaseWeights {
  turn1: number
  turn2: number
  turn3: number
  turn4Plus: number
}

export interface StrategicEvaluator {
  aiRole: AIRole
  turnPhaseWeights: TurnPhaseWeights
  decklistSynergyRequirements: string[]

  // Rétrocompatibilité
  primaryRole?: StrategicRole
  intrinsicBaseScore?: number
  inGameDeadCardConditions?: any[]
  discardPriorityWhenDead?: number
  holdForNextTurnBonus?: number
}

export interface ActionCost {
  type: string
  count: number
  targetFilter?: any
}

export interface ActionPrecondition {
  type: string
  zone?: ZoneType | null
  minCount?: number
  targetFilter?: any
}

export interface DeadCardCondition {
  reason: string
  zonesToCheck: ZoneType[]
  targetFilter?: any
}

export interface SynergyRequirement {
  requiredFilter?: CardFilter | any
  minCountInDeck?: number
  ifMissingSetValueToZero?: boolean
  bonusWeightPerCopy?: number
}

export interface CompilationMetadata {
  modelRepoId: string
  modelFilename: string
  compilationTimeSeconds: number
  compiledAtIso: string
  completionTokens?: number | null
  tokensPerSecond?: number | null
  generationTimeSeconds?: number | null
  timeToFirstTokenSeconds?: number | null
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

// Rétrocompatibilité pour CardFilter / ZoneType / PreconditionType si utilisés par les tests
export interface CardFilter {
  category?: CardCategory | null
  subCategory?: CardSubCategory | null
  maxHp?: number | null
  energyType?: string | null
  specificCardName?: string | null
  isRuleBox?: boolean | null
  isEvolution?: boolean | null
  isFuture?: boolean | null
  isAncient?: boolean | null
  isTera?: boolean | null
  hasAbility?: boolean | null
  maxRetreatCost?: number | null
  minHp?: number | null
}

export type ZoneType =
  | 'DECK'
  | 'HAND'
  | 'DISCARD'
  | 'BENCH'
  | 'ACTIVE'
  | 'IN_PLAY_ALL'
  | 'PRIZES'
  | 'OPPONENT_ACTIVE'
  | 'OPPONENT_BENCH'
  | 'OPPONENT_IN_PLAY_ALL'
  | 'OPPONENT_HAND'
  | 'OPPONENT_DECK'
  | 'OPPONENT_DISCARD'
  | 'STADIUM'
  | 'LOST_ZONE'

export type PreconditionType =
  | 'ZONE_HAS_MATCHING_CARD'
  | 'BENCH_HAS_EMPTY_SLOTS'
  | 'HAND_MIN_OTHER_CARDS'
  | 'PLAYER_BEHIND_ON_PRIZES'
  | 'KO_SUFFERED_LAST_TURN'
  | 'BASIC_IN_PLAY_PREVIOUS_TURN'
  | 'SELF_IS_ACTIVE'
  | 'SELF_HAS_ENERGY_COST'
  | 'HAS_TERA_POKEMON_IN_PLAY'
  | 'STADIUM_IN_PLAY'
  | 'OPPONENT_ACTIVE_HAS_SPECIAL_CONDITION'
  | 'OPPONENT_PRIZES_EXACT_COUNT'
  | 'SELF_IS_ON_BENCH'
  | 'NO_ENERGY_IN_PLAY'
  | 'SECOND_PLAYER_TURN_1'
  | 'HAND_MAX_OTHER_CARDS_ZERO'

/**
 * Règle de légalité Standard avec correctif pour le marquage TCGdex.
 */
export function isCardStandardLegal(card: {
  identity: Pick<CardIdentity, 'legalStandard' | 'regulationMark' | 'subCategory'>
}): boolean {
  if (card.identity.legalStandard === true) return true
  if (card.identity.subCategory === 'BASIC_ENERGY') return true
  const mark = (card.identity.regulationMark || '').toUpperCase()
  return mark === 'G' || mark === 'H' || mark === 'I' || mark === 'J'
}
