import type { DebugPerturbationType, MatchWinner, WinReason } from '../core/engine'
import type { EvaluatedBranchTrace, MaxBranchesSetting } from '../core/evaluator'

export type FirstPlayerMode = 'PLAYER' | 'OPPONENT' | 'RANDOM'

export interface SimulationConfig {
  iterations: number
  maxTurns: number
  maxBranches: MaxBranchesSetting
  selectedOpponentIds: string[]
  firstPlayerMode: FirstPlayerMode
  debugMode: boolean
  workerCount: number
  fixedSeed: number | null
  perturbationType: DebugPerturbationType
  perturbationTurn: number
}

export interface TracedPokemonSnapshot {
  instanceId: string
  cardId: string
  nameFr: string
  subCategory: string
  currentHp: number
  maxHp: number
  damage: number
  attachedEnergies: string[]
  attachedTools: string[]
  isRuleBox: boolean
}

export interface TracedBoardSnapshot {
  active: TracedPokemonSnapshot | null
  bench: TracedPokemonSnapshot[]
  hand: string[]
  prizesRemaining: number
  prizesList: string[]
  prizesKnownByPlayer: boolean
  deckCount: number
  discardCount: number
  discardTopNames: string[]
}

export interface TracedTurnRecord {
  turnNumber: number
  actingPlayer: 'PLAYER' | 'OPPONENT'
  drawnCardName: string | null
  perturbationNote: string | null
  playerBoardBefore: TracedBoardSnapshot
  opponentBoardBefore: TracedBoardSnapshot
  playerBoardAfter: TracedBoardSnapshot
  opponentBoardAfter: TracedBoardSnapshot
  chosenActionSequence: string[]
  scoreT: number
  scoreTAdv: number
  scoreTPlus1: number
  totalScore: number
  branchesExplored: number
  candidateBranches: EvaluatedBranchTrace[]
}

export interface TracedGameRecord {
  gameIndex: number
  seed: number
  opponentId: string
  opponentName: string
  firstPlayer: 'PLAYER' | 'OPPONENT'
  winner: Exclude<MatchWinner, null>
  winReason: WinReason
  totalTurns: number
  playerPrizesWon: number
  opponentPrizesWon: number
  playerMulligans: number
  opponentMulligans: number
  playerInitialHand: string[]
  playerInitialPrizes: string[]
  opponentInitialHand: string[]
  opponentInitialPrizes: string[]
  turns: TracedTurnRecord[]
}

export interface MatchupStatRecord {
  opponentId: string
  opponentName: string
  archetypeTag: string
  accentColor: string
  gamesPlayed: number
  wins: number
  losses: number
  draws: number
  winRate: number
  avgPlayerPrizesWon: number
  avgOpponentPrizesWon: number
}

export interface SimulationMetricsSummary {
  // Les 8 KPIs obligatoires
  totalDurationMs: number
  totalGamesSimulated: number
  gamesPerSecond: number
  globalWinRate: number
  wins: number
  losses: number
  draws: number
  matchupBreakdown: MatchupStatRecord[]
  totalPlayerMulligans: number
  gamesWithMulliganCount: number
  gamesWithMulliganRate: number
  avgPlayerPrizesWon: number
  avgOpponentPrizesWon: number

  // Métriques analytiques complémentaires
  avgTurnsPlayed: number
  turn1BenchSetupRate: number
  turn2AttackerReadyRate: number
  winReasons: {
    ALL_PRIZES_TAKEN: number
    NO_POKEMON_IN_PLAY: number
    DECK_OUT: number
    MAX_TURNS_REACHED: number
  }
  configUsed: SimulationConfig
  baseSeedUsed: number
  tracedGames: TracedGameRecord[]
}

export interface DeckCardContributionItem {
  cardId: string
  nameFr: string
  category: 'pokemon' | 'trainer' | 'energy'
  oldQty: number
  newQty: number
  deltaQty: number
}
