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
  | 'SNIPER_BENCH_ATTACKER'
  | 'CONTROL_LOCK_DISRUPTION'
  | 'DEFENSIVE_TANK_WALL'
  | 'PASSIVE_STAT_BUFFER'
  | 'HEALER_SUPPORT'

export type ActionSourceType =
  | 'TRAINER_PLAY'
  | 'ABILITY_ACTIVATED'
  | 'ABILITY_ON_EVOLVE'
  | 'ABILITY_PASSIVE'
  | 'ATTACK'
  | 'ABILITY_ON_PLAY_FROM_HAND'
  | 'ABILITY_REACTIVE'
  | 'STADIUM_EFFECT'
  | 'TOOL_EFFECT'
  | 'SPECIAL_ENERGY_EFFECT'

export type ActionTiming =
  | 'ONCE_PER_CARD'
  | 'ONCE_PER_TURN_ABILITY'
  | 'ONCE_PER_TURN_SUPPORTER'
  | 'ONCE_PER_GAME_VSTAR'
  | 'ON_EVOLVE_TRIGGER'
  | 'END_OF_TURN_ATTACK'
  | 'PASSIVE_CONTINUOUS'
  | 'AS_OFTEN_AS_YOU_LIKE'
  | 'ON_PLAY_FROM_HAND_TRIGGER'
  | 'ON_DAMAGED_OR_KO_TRIGGER'
  | 'BETWEEN_TURNS_CHECKUP'
  | 'ONCE_PER_TURN_STADIUM'

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

export type CostType =
  | 'DISCARD_FROM_HAND'
  | 'DISCARD_ENERGY_FROM_PLAY'
  | 'PUT_DAMAGE_COUNTERS_ON_SELF'
  | 'END_TURN_IMMEDIATELY'
  | 'KNOCK_OUT_SELF'
  | 'SELF_DAMAGE'
  | 'SHUFFLE_ATTACHED_ENERGY_TO_DECK'
  | 'CANT_ATTACK_NEXT_TURN'
  | 'PUT_HAND_CARD_BOTTOM_DECK'

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
  | 'DRAW_UNTIL_HAND_SIZE'
  | 'HEAL_DAMAGE'
  | 'PLACE_DAMAGE_COUNTERS'
  | 'DEAL_DAMAGE_BENCH'
  | 'APPLY_SPECIAL_CONDITION'
  | 'MOVE_ENERGY_BETWEEN_POKEMON'
  | 'MOVE_DAMAGE_COUNTERS'
  | 'RETURN_POKEMON_TO_HAND'
  | 'DISCARD_OPPONENT_ENERGY'
  | 'DISCARD_TOOL_OR_STADIUM'
  | 'MILL_OPPONENT_DECK'
  | 'DISCARD_FROM_OPPONENT_HAND'
  | 'DEVOLVE_OPPONENT_POKEMON'
  | 'TAKE_EXTRA_PRIZE_CARDS'
  | 'PASSIVE_DAMAGE_REDUCTION'
  | 'PASSIVE_DAMAGE_BOOST'
  | 'PASSIVE_HP_BOOST'
  | 'PASSIVE_RETREAT_COST_MOD'
  | 'PASSIVE_PREVENT_DAMAGE_OR_EFFECTS'
  | 'PASSIVE_ABILITY_OR_ITEM_LOCK'

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

export type DeadCardReason =
  | 'NO_VALID_TARGET_IN_DECK'
  | 'NO_STAGE2_LEFT_IN_DECK_OR_HAND'
  | 'NO_BASE_POKEMON_LINE_LEFT'
  | 'BENCH_ALREADY_FULL'
  | 'NOT_BEHIND_ON_PRIZES'
  | 'DISCARD_PILE_EMPTY'
  | 'NO_TERA_POKEMON_IN_PLAY'
  | 'HAND_ALREADY_FULL_OR_AT_LIMIT'
  | 'NO_DAMAGE_ON_OWN_POKEMON'
  | 'NO_KO_LAST_TURN'
  | 'STADIUM_ALREADY_IN_PLAY_SAME_NAME'

export type DamageScalingType =
  | 'PER_COIN_FLIP_HEADS'
  | 'PER_ENERGY_ATTACHED_SELF'
  | 'PER_ENERGY_ATTACHED_ALL'
  | 'PER_ENERGY_ATTACHED_TARGET'
  | 'PER_DAMAGE_COUNTER_ON_SELF'
  | 'PER_DAMAGE_COUNTER_ON_FRIENDLY'
  | 'PER_ENERGY_DISCARDED'
  | 'PER_OPPONENT_PRIZE_TAKEN'
  | 'IF_TARGET_IS_EX_OR_EVOLUTION'
  | 'PER_DAMAGE_COUNTER_ON_TARGET'
  | 'PER_BENCHED_POKEMON'
  | 'PER_CARD_IN_DISCARD_OR_LOST_ZONE'

export type SpecialConditionType =
  | 'POISONED'
  | 'BURNED'
  | 'CONFUSED'
  | 'PARALYZED'
  | 'ASLEEP'

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
  damageScalingType?: DamageScalingType | null
  damageScalingValue?: number | null
  specialCondition?: SpecialConditionType | null
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
  energyCost?: string[]
  canAttackTwice?: boolean
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
  isAceSpec?: boolean
  mechanicTag?: 'ANCIENT' | 'FUTURE' | null
  isAncient?: boolean
  isFuture?: boolean
  isTechnicalMachine?: boolean
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
  dexId?: number[]
  isTera?: boolean
  isAncient?: boolean
  isFuture?: boolean
  hasAbility?: boolean
  weaknessMultiplier?: string
  resistanceModifier?: number
  canAttackTwice?: boolean
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

/**
 * Règle de légalité Standard avec correctif pour le marquage TCGdex.
 */
export function isCardStandardLegal(card: {
  identity: Pick<CardIdentity, 'legalStandard' | 'regulationMark' | 'subCategory'>
}): boolean {
  if (card.identity.legalStandard === true) return true
  if (card.identity.subCategory === 'BASIC_ENERGY') return true
  const mark = (card.identity.regulationMark || '').toUpperCase()
  return mark === 'G' || mark === 'H' || mark === 'I'
}
