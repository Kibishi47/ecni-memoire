import type { EngineCardModel } from './cardModel.js'

export type PlayerKey = 'PLAYER' | 'OPPONENT'
export type MatchWinner = null | 'PLAYER' | 'OPPONENT' | 'DRAW'
export type WinReason =
  | null
  | 'ALL_PRIZES_TAKEN'
  | 'NO_POKEMON_IN_PLAY'
  | 'DECK_OUT'
  | 'MAX_TURNS_REACHED'

export type DebugPerturbationType =
  | 'NONE'
  | 'FORCE_OPPONENT_IONO'
  | 'FORCE_KO_ACTIVE'
  | 'FORCE_KEY_CARD_PRIZED'

export interface InPlayPokemon {
  instanceId: string
  card: EngineCardModel
  previousStages: EngineCardModel[]
  damage: number
  attachedEnergies: EngineCardModel[]
  attachedTools: EngineCardModel[]
  turnPlayed: number
  evolvedThisTurn: boolean
  specialConditions: import('./cardModel.js').SpecialConditionType[]
  cantAttackNextTurn: boolean
  cantAttackTurn?: number
  cantRetreatNextTurn?: boolean
  cantRetreatTurn?: number
  preventDamageOrEffectsNextTurn?: boolean
  preventDamageOrEffectsTurn?: number
  damageTakenModifierNextTurn?: number
  damageTakenModifierTurn?: number
  damageDealtModifierNextTurn?: number
  damageDealtModifierTurn?: number
  hpBonus?: number
  retreatCostModifier?: number
}

export interface PlayerBoardState {
  deck: EngineCardModel[]
  hand: EngineCardModel[]
  prizes: EngineCardModel[]
  discard: EngineCardModel[]
  activePokemon: InPlayPokemon | null
  bench: InPlayPokemon[]
  lostZone: EngineCardModel[]
  extraTurnGranted: boolean
  itemLockActive: boolean
  abilityLockActive?: boolean
  abilityLockTurn?: number
  maxBenchSlotsOverride?: number | null
  supporterPlayedThisTurn: boolean
  stadiumPlayedThisTurn?: boolean
  energyAttachedThisTurn: boolean
  retreatUsedThisTurn: boolean
  usedOncePerTurnAbilities: Set<string>
  abilityUsageCountsThisTurn: Record<string, number>
  vstarPowerUsed: boolean
  koSufferedLastOpponentTurn: boolean
  mulliganCount: number
  initialHandSnapshot: string[]
  initialPrizesSnapshot: string[]
  prizesKnownByPlayer: boolean
  firstSearchTurn: number | null
  turnDamageBoost?: number
}

export type ActiveStadiumState = {
  card: EngineCardModel
  ownerIndex: 0 | 1
  usedThisTurn: boolean
}

export interface MatchState {
  player: PlayerBoardState
  opponent: PlayerBoardState
  turnNumber: number
  maxTurns: number
  activePlayerIndex: 0 | 1
  firstPlayerIndex: 0 | 1
  winner: MatchWinner
  winReason: WinReason
  rngState: number
  nextInstanceSeq: number
  lastActionLog: string[]
  activeStadium: ActiveStadiumState | null
}

export type GameActionType =
  | 'PUT_BASIC_ON_BENCH'
  | 'ATTACH_MANUAL_ENERGY'
  | 'NORMAL_EVOLVE'
  | 'RETREAT_ACTIVE'
  | 'PLAY_TRAINER'
  | 'USE_ABILITY'
  | 'DECLARE_ATTACK'
  | 'PASS_TURN'

export interface GameAction {
  type: GameActionType
  label: string
  cardId?: string
  actionId?: string
  handIndex?: number
  sourceSlot?: 'ACTIVE' | number
  targetSlot?: 'ACTIVE' | number
  targetBenchIndex?: number
  targetCardIds?: string[]
  discardCardIds?: string[]
  estimatedDamage?: number
  endsTurnImmediately?: boolean
}

export type MaxBranchesSetting = 8 | 20 | 50 | 'INFINITE'
export type LookaheadPly = 1 | 2 | 3
export type AiTemperament = 'BALANCED' | 'AGGRESSIVE' | 'CONSERVATIVE'

export interface EvaluatorOptions {
  maxActionDepth?: number
  beamWidth?: number
  topKCandidates?: number
  lookaheadPly?: LookaheadPly
  rolloutMaxActions?: number
  aiTemperament?: AiTemperament
}

export interface EvaluatedBranchTrace {
  branchId: string
  isChosen: boolean
  actions: string[]
  scoreT: number
  scoreTAdv: number
  scoreTPlus1: number
  totalScore: number
  opponentReactionSummary: string
  reboundSummary: string
}

export interface TurnBranchDecision {
  chosenActions: GameAction[]
  chosenActionLabels: string[]
  finalTurnState: MatchState
  scoreT: number
  scoreTAdv: number
  scoreTPlus1: number
  totalScore: number
  totalBranchesExplored: number
  candidateTraces: EvaluatedBranchTrace[]
}
