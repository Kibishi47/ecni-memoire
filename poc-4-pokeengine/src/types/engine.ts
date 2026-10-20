/**
 * PokéEngine Lab & Inspector — Core Type Definitions
 * Declarative Atomic Primitives, Bit-Packed Uint16 State & Simulation Telemetry
 */

export type CardCategory = 'POKEMON' | 'ITEM' | 'SUPPORTER' | 'TOOL' | 'STADIUM' | 'ENERGY'

export type PokemonSubType = 'BASIC' | 'STAGE_1' | 'STAGE_2'

export type EvolutionLine = 'CHARIZARD' | 'PIDGEOT' | 'LUMINEON' | 'FEZANDIPITI' | 'ROTOM' | 'MANAPHY' | 'NONE'

export type AtomicOpcode =
  | 'SEARCH_DECK_TO_BENCH'
  | 'SEARCH_DECK_TO_HAND'
  | 'COST_DISCARD_CARDS'
  | 'EVOLVE_BASIC_TO_STAGE2'
  | 'EVOLVE_STANDARD'
  | 'ABILITY_INFERNAL_REIGN'
  | 'ABILITY_QUICK_SEARCH'
  | 'ABILITY_LUMINOUS_SIGN'
  | 'ABILITY_INSTANT_CHARGE'
  | 'ABILITY_FLIP_THE_SCRIPT'
  | 'VSTAR_POWER_SEARCH_ANY'
  | 'DISCARD_HAND_DRAW_N'
  | 'SHUFFLE_HAND_BOTTOM_DRAW_N'
  | 'RECOVER_DISCARD_TO_DECK'
  | 'RECOVER_DISCARD_TO_HAND'
  | 'ATTACH_TOOL'
  | 'PLAY_STADIUM'
  | 'GUST_OPPONENT_BENCH'
  | 'ATTACH_BASIC_ENERGY'

export type TargetFilter =
  | 'BASIC_HP_LTE_70'
  | 'BASIC_ANY'
  | 'POKEMON_ANY'
  | '1_ITEM_AND_1_TOOL'
  | 'SUPPORTER_ANY'
  | 'ANY_CARD'
  | 'FIRE_ENERGY'
  | 'POKEMON_OR_BASIC_ENERGY'
  | 'NONE'

export type PreconditionRule =
  | 'NONE'
  | 'TARGET_ON_BOARD_PREV_TURN'
  | 'REQUIRES_MIN_HAND_SIZE_3'
  | 'REQUIRES_V_POKEMON_IN_PLAY'
  | 'ONCE_PER_TURN'
  | 'ONCE_PER_GAME_VSTAR'
  | 'NO_SUPPORTER_T1_GOING_FIRST'
  | 'OPPONENT_KNOCKED_OUT_LAST_TURN'

export interface AtomicEffectPrimitive {
  opcode: AtomicOpcode
  filter: TargetFilter
  maxTargets: number
  maxHp?: number
  costDiscard?: number
  drawCount?: number
  precondition: PreconditionRule
  description: string
}

export interface DeclarativeCardDefinition {
  id: number // 1..20 unique card template ID (packed in bits 0..5 of Uint16)
  code: string
  name: string
  category: CardCategory
  subType?: PokemonSubType
  hp?: number
  isPokemonV?: boolean
  isPokemonEx?: boolean
  evolutionLine: EvolutionLine
  evolvesFrom?: string
  attackEnergyCost?: number
  attackDamage?: number
  attackName?: string
  priorityActive: number // Heuristic weight for choosing starting Active vs Bench
  strategicValue: number // Heuristic weight for discard cost preservation (higher = keep)
  defaultCount: number
  primitives: AtomicEffectPrimitive[]
}

export type AIStrategyMode = 'OPTIMAL_BEAM' | 'GREEDY' | 'NAIVE_RANDOM'

export type Turn3DisruptionMode = 'NONE' | 'IONO_HAND_TO_3' | 'KO_ACTIVE_POKEMON'

export interface SimulationConfig {
  iterations: 100 | 1000 | 10000 | 100000
  aiMode: AIStrategyMode
  goingFirst: boolean
  prizesEnabled: boolean
  turn3Disruption: Turn3DisruptionMode
  seed: number
  deckRatios: {
    basicPokemonCount: number // default: 9
    poffinCount: number // default: 4
    rareCandyCount: number // default: 4
    fireEnergyCount: number // default: 8
  }
  customRegistry?: DeclarativeCardDefinition[]
}

export interface BoardPokemonSnapshot {
  cardId: number
  name: string
  subType: PokemonSubType
  hp: number
  attachedEnergies: number
  attachedToolName: string | null
  turnPlayed: number
  abilityUsedThisTurn: boolean
}

export interface DecisionBranchRecord {
  branchId: string
  label: string
  selected: boolean
  boardScore: number
  scoreBreakdown: string[]
  actions: string[]
  thinningDelta: number // Cards removed from deck before random draw
}

export interface TurnTimelineRecord {
  turnNumber: number
  drawnCardName: string | null
  disruptionApplied: string | null
  deckCountStart: number
  deckCountEnd: number
  branchesEvaluated: number
  branches: DecisionBranchRecord[]
  activePokemon: BoardPokemonSnapshot | null
  benchPokemon: BoardPokemonSnapshot[]
  handCardNames: string[]
  prizesRemaining: number
  supporterPlayedThisTurn: boolean
  energyAttachedThisTurn: boolean
  vstarUsedInGame: boolean
}

export interface SampledGameRecord {
  gameIndex: number
  seedUsed: number
  mulliganCount: number
  initialHandNames: string[]
  prizeCardNames: string[]
  criticalPrizesCount: number // Rare Candy or Charizard ex in prizes
  rareCandyPrizedCount: number
  charizardPrizedCount: number
  turn1SetupSuccess: boolean
  turn2CharizardReady: boolean
  pidgeotInPlayByT2: boolean
  bricked: boolean
  rareCandyLockedInPrizes: boolean
  finalBoardScore: number
  tags: ('PERFECT_T2' | 'BRICK' | 'CANDY_PRIZED' | 'NORMAL')[]
  turns: TurnTimelineRecord[]
}

export interface HypergeometricComparison {
  metricName: string
  formulaLabel: string
  populationN: number
  successesK: number
  sampleSizeN: number
  exactTheoreticalPct: number
  observedMonteCarloPct: number
  deltaAbsolutePct: number
  converged: boolean
}

export interface RuleInvariantAudit {
  id: string
  ruleCode: string
  title: string
  description: string
  checkedCount: number
  passedCount: number
  violationsCount: number
}

export interface AIModeComparisonMetric {
  aiMode: AIStrategyMode
  label: string
  turn1SetupRatePct: number
  turn2CharizardAttachRatePct: number
  pidgeotEstablishedRatePct: number
  brickRatePct: number
  avgBoardScore: number
  avgDeckThinningCards: number
}

export interface SimulationResultPayload {
  config: SimulationConfig
  telemetry: {
    executionTimeMs: number
    gamesPerSecond: number
    microsecondsPerGame: number
    totalBranchesEvaluated: number
    totalActionsExecuted: number
    memoryBufferBytes: number
  }
  hypergeometricAudit: {
    mulliganRate: HypergeometricComparison
    poffinOpeningRate: HypergeometricComparison
  }
  invariantsAudit: {
    totalGamesAudited: number
    allPassed: boolean
    rules: RuleInvariantAudit[]
  }
  strategicMetrics: {
    turn1SetupSuccessPct: number
    turn2CharizardReadyPct: number
    pidgeotInPlayPct: number
    brickRatePct: number
    rareCandyPrizedWarningPct: number
    avgMulligansPerGame: number
    avgBoardScoreT2: number
    avgBoardScoreT4: number
  }
  aiComparison: AIModeComparisonMetric[]
  sampledGames: SampledGameRecord[]
}
