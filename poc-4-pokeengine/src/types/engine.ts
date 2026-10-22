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
  | 'PLAYER_BEHIND_ON_PRIZES'

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

export type AIStrategyMode =
  | 'EXPECTIMINIMAX_T1'
  | 'OPTIMAL_BEAM'
  | 'FIXED_BEAM'
  | 'GREEDY'
  | 'NAIVE_RANDOM'

export type WorkerExecutionMode = 'MULTI_WORKER' | 'SINGLE_WORKER'

export type OpponentArchetype =
  | 'RAGING_BOLT_AGGRO'
  | 'CHARIZARD_DRAGAPULT_SETUP'
  | 'GARDEVOIR_DISRUPTION'

export type OpponentPokemonRole =
  | 'LOADED_ATTACKER'
  | 'ENGINE_SUPPORT'
  | 'BASIC_EVOLVER'
  | 'TWO_PRIZE_LIABILITY'

export type Turn3DisruptionMode = 'NONE' | 'IONO_HAND_TO_3' | 'KO_ACTIVE_POKEMON'

export type GameEndReason =
  | 'MAX_TURNS_REACHED'
  | 'VICTORY_ALL_PRIZES'
  | 'DEFEAT_DECK_OUT'
  | 'DEFEAT_NO_POKEMON'

export interface SimulationConfig {
  iterations: 100 | 1000 | 10000 | 100000
  maxTurns: number // 1..10 turns (early stop if game ends before maxTurns)
  aiMode: AIStrategyMode
  fixedBeamWidth: number // 1..8 branches tested every turn when aiMode === 'FIXED_BEAM'
  workerMode: WorkerExecutionMode // 'MULTI_WORKER' (4..8 parallel workers) | 'SINGLE_WORKER'
  opponentArchetype: OpponentArchetype
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

export interface OpponentPokemonSnapshot {
  slotIndex: number // 0 = Active, 1..5 = Bench
  name: string
  hp: number
  attachedEnergies: number
  prizeValue: 1 | 2
  role: OpponentPokemonRole
  roleLabel: string
  threatScore: number
  threatBreakdown: string[]
  targetedAndKnockedOut?: boolean
}

export interface ExpectiminimaxProjectionRecord {
  immediateScore: number // V_immediat(S_T)
  energyBankingBonus: number // +30 pts if manual energy banked on backup attacker
  resourceConservationBonus: number // +25 pts if T+1 Supporter / Rare Candy preserved in hand
  threatReductionBonus: number // Threat points eliminated on opponent board
  opponentKoProbPct: number // p_KO (%)
  opponentIonoProbPct: number // p_iono (%)
  opponentGustProbPct: number // p_gust (%)
  reboundExpectedScore: number // E[V_rebond(S_{T+1})]
  revengeKillReadyAtTPlus1: boolean // Can immediately counter-attack after Active KO
  postIonoRecoveryReady: boolean // On-board draw engine ready (Pidgeot ex / Fezandipiti ex)
  totalExpectiminimaxScore: number // U(S_T) = V_immediat + 0.75 * E[V_rebond]
  summaryLine: string
}

export interface DecisionBranchRecord {
  branchId: string
  label: string
  selected: boolean
  boardScore: number
  scoreBreakdown: string[]
  actions: string[]
  thinningDelta: number // Cards removed from deck before random draw
  attackTargetSummary?: string | null // e.g. "Cible : Roucarnage ex adverse via Attrape-Riposte [Menace : 165 pts]"
  expectiminimax?: ExpectiminimaxProjectionRecord
}

export interface TurnTimelineRecord {
  turnNumber: number
  drawnCardName: string | null
  disruptionApplied: string | null
  opponentTurnSummary?: string | null
  attackExecuted: string | null
  terminalEvent: string | null
  deckCountStart: number
  deckCountEnd: number
  branchesEvaluated: number
  branches: DecisionBranchRecord[]
  activePokemon: BoardPokemonSnapshot | null
  benchPokemon: BoardPokemonSnapshot[]
  opponentActivePokemon?: OpponentPokemonSnapshot | null
  opponentBenchPokemon?: OpponentPokemonSnapshot[]
  opponentPrizesRemaining?: number
  prizesKnownByPlayer?: boolean
  prizeCheckDeductionNote?: string | null
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
  firstSearchTurn?: number | null // Turn on which first SEARCH_DECK deduced the 6 Prizes
  turn1SetupSuccess: boolean
  turn2CharizardReady: boolean
  pidgeotInPlayByT2: boolean
  bricked: boolean
  rareCandyLockedInPrizes: boolean
  finalBoardScore: number
  turnsPlayed: number
  maxTurnsConfigured: number
  endedEarly: boolean
  endReason: GameEndReason
  endReasonLabel: string
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
  revengeKillT3RatePct?: number
  threatNeutralizationRatePct?: number
  postIonoSurvivalRatePct?: number
  brickRatePct: number
  avgBoardScore: number
  avgDeckThinningCards: number
}

export interface WorkerShardRawResult {
  startGameIndex: number
  gamesExecuted: number
  zeroBasicsCount: number
  poffinInFirst7Count: number
  totalMulligans: number
  t1SetupCount: number
  t2CharizardCount: number
  pidgeotCount: number
  revengeKillOpportunitiesCount: number
  revengeKillSuccessCount: number
  gustThreatNeutralizedCount: number
  ionoExperiencedCount: number
  postIonoSurvivedCount: number
  optimalPrizeMappingCount: number
  brickCount: number
  candyPrizedWarningCount: number
  sumScoreT2: number
  sumScoreT4: number
  sumTurnsPlayed: number
  earlyEndedCount: number
  sumThinning: number
  totalBranches: number
  totalExpectiminimaxNodes: number
  totalActions: number
  invariants: {
    inv1Checked: number
    inv1Passed: number
    inv2Checked: number
    inv2Passed: number
    inv3Checked: number
    inv3Passed: number
    inv4Checked: number
    inv4Passed: number
    inv5Checked: number
    inv5Passed: number
  }
  sampledGames: SampledGameRecord[]
}

export interface SimulationResultPayload {
  config: SimulationConfig
  telemetry: {
    executionTimeMs: number
    gamesPerSecond: number
    microsecondsPerGame: number
    totalBranchesEvaluated: number
    expectiminimaxNodesEvaluated: number
    totalActionsExecuted: number
    memoryBufferBytes: number
    activeWorkersCount: number
    zeroAllocationMode: boolean
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
    revengeKillT3RatePct: number
    threatNeutralizationRatePct: number
    postIonoSurvivalRatePct: number
    prizeMappingPrecisionPct: number
    brickRatePct: number
    rareCandyPrizedWarningPct: number
    avgMulligansPerGame: number
    avgBoardScoreT2: number
    avgBoardScoreT4: number
    avgTurnsPlayed: number
    earlyTerminationRatePct: number
  }
  aiComparison: AIModeComparisonMetric[]
  sampledGames: SampledGameRecord[]
}
