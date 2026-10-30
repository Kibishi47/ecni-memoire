/**
 * Boucle de Match Complet (`src/core/gameLoop.ts`) & Agrégateur de Shards Multi-Workers.
 *
 * Exécute des parties complètes de Pokémon TCG du Tour 1 jusqu'à la victoire
 * (`ALL_PRIZES_TAKEN`, `NO_POKEMON_IN_PLAY`, `DECK_OUT`) ou `maxTurns`.
 * Les deux joueurs (Joueur ET Adversaire) utilisent l'Évaluateur 3-Ply (`selectBestTurnBranch`) à chaque tour.
 */

import type { EngineCardModel } from '../types/cardModel'
import type {
  MatchupStatRecord,
  SimulationConfig,
  SimulationMetricsSummary,
  TracedBoardSnapshot,
  TracedGameRecord,
  TracedPokemonSnapshot,
  TracedTurnRecord,
} from '../types/simulator'
import {
  applyDebugPerturbationIfConfigured,
  createInitialMatchState,
  endTurnAndAdvance,
  getPokemonMaxHp,
  getRemainingHp,
  startTurn,
  type InPlayPokemon,
  type PlayerBoardState,
  type WinReason,
} from './engine'
import { selectBestTurnBranch } from './evaluator'
import { deriveGameSeed } from './prng'

export const MAX_TRACED_GAMES = 50

export interface OpponentDeckDescriptor {
  id: string
  name: string
  archetypeTag: string
  accentColor: string
  models: EngineCardModel[]
}

export interface SingleGameOutcome {
  gameIndex: number
  opponentId: string
  opponentName: string
  winner: 'PLAYER' | 'OPPONENT' | 'DRAW'
  winReason: WinReason
  turnsPlayed: number
  playerPrizesWon: number
  opponentPrizesWon: number
  playerMulligans: number
  opponentMulligans: number
  hadPlayerTurn1BenchSetup: boolean
  hadPlayerTurn2AttackerReady: boolean
  tracedGame?: TracedGameRecord
}

export interface SimulationShardInput {
  shardId: number
  startGameIndex: number
  gameCount: number
  baseSeed: number
  config: SimulationConfig
  playerDeckModels: EngineCardModel[]
  opponentDecks: OpponentDeckDescriptor[]
}

export interface SimulationShardResult {
  shardId: number
  outcomes: SingleGameOutcome[]
  tracedGames: TracedGameRecord[]
}

function snapshotPokemon(poke: InPlayPokemon): TracedPokemonSnapshot {
  return {
    instanceId: poke.instanceId,
    cardId: poke.card.cardId,
    nameFr: poke.card.identity.nameFr,
    subCategory: poke.card.subCategory,
    currentHp: getRemainingHp(poke),
    maxHp: getPokemonMaxHp(poke),
    damage: poke.damage,
    attachedEnergies: poke.attachedEnergies.map((e) => e.identity.nameFr),
    attachedTools: poke.attachedTools.map((t) => t.identity.nameFr),
    isRuleBox: Boolean(poke.card.pokemonStats?.isRuleBox),
  }
}

export function snapshotBoardForTrace(board: PlayerBoardState): TracedBoardSnapshot {
  return {
    active: board.activePokemon ? snapshotPokemon(board.activePokemon) : null,
    bench: board.bench.map(snapshotPokemon),
    hand: board.hand.map((c) => c.identity.nameFr),
    prizesRemaining: board.prizes.length,
    prizesList: board.prizes.map((c) => c.identity.nameFr),
    prizesKnownByPlayer: board.prizesKnownByPlayer,
    deckCount: board.deck.length,
    discardCount: board.discard.length,
    discardTopNames: board.discard.slice(-6).map((c) => c.identity.nameFr),
  }
}

/**
 * Joue une partie complète de Pokémon TCG du Tour 1 jusqu'à la victoire ou `config.maxTurns`.
 */
export function playFullGame(
  playerDeckModels: EngineCardModel[],
  opponentDeck: OpponentDeckDescriptor,
  gameIndex: number,
  seed: number,
  config: SimulationConfig,
  recordTrace: boolean,
): SingleGameOutcome {
  const firstPlayerIndex: 0 | 1 =
    config.firstPlayerMode === 'PLAYER'
      ? 0
      : config.firstPlayerMode === 'OPPONENT'
        ? 1
        : gameIndex % 2 === 0
          ? 0
          : 1

  let state = createInitialMatchState(playerDeckModels, opponentDeck.models, {
    seed,
    firstPlayerIndex,
    maxTurns: config.maxTurns,
    perturbationType: config.perturbationType,
    perturbationTurn: config.perturbationTurn,
  })

  const tracedTurns: TracedTurnRecord[] = []
  let hadPlayerTurn1BenchSetup = state.player.bench.length >= 2
  let hadPlayerTurn2AttackerReady = false

  let safetyLoopGuard = 0
  const maxLoopSteps = Math.max(4, config.maxTurns) + 4

  while (state.winner === null && safetyLoopGuard < maxLoopSteps) {
    safetyLoopGuard++
    const currentTurnNumber = state.turnNumber
    const actingPlayer: 'PLAYER' | 'OPPONENT' =
      state.activePlayerIndex === 0 ? 'PLAYER' : 'OPPONENT'

    const { drawnCard } = startTurn(state)
    const perturbationNote = applyDebugPerturbationIfConfigured(
      state,
      config.perturbationType,
      config.perturbationTurn,
    )

    if (state.winner !== null) {
      break
    }

    const playerBoardBefore = recordTrace ? snapshotBoardForTrace(state.player) : null
    const opponentBoardBefore = recordTrace ? snapshotBoardForTrace(state.opponent) : null

    const decision = selectBestTurnBranch(state, config.maxBranches, recordTrace)
    state = decision.finalTurnState

    // Checkpoints analytiques de stabilité du deck joueur
    if (currentTurnNumber <= 2 && state.player.bench.length >= 2) {
      hadPlayerTurn1BenchSetup = true
    }
    if (currentTurnNumber <= 4) {
      const playerAll = [
        ...(state.player.activePokemon ? [state.player.activePokemon] : []),
        ...state.player.bench,
      ]
      if (
        playerAll.some(
          (p) =>
            (p.card.subCategory === 'STAGE_2' ||
              p.card.strategicEvaluator.primaryRole === 'MAIN_ATTACKER') &&
            p.attachedEnergies.length >= 2,
        )
      ) {
        hadPlayerTurn2AttackerReady = true
      }
    }

    if (recordTrace && playerBoardBefore && opponentBoardBefore) {
      tracedTurns.push({
        turnNumber: currentTurnNumber,
        actingPlayer,
        drawnCardName: drawnCard ? drawnCard.identity.nameFr : null,
        perturbationNote,
        playerBoardBefore,
        opponentBoardBefore,
        playerBoardAfter: snapshotBoardForTrace(state.player),
        opponentBoardAfter: snapshotBoardForTrace(state.opponent),
        chosenActionSequence: decision.chosenActionLabels,
        scoreT: decision.scoreT,
        scoreTAdv: decision.scoreTAdv,
        scoreTPlus1: decision.scoreTPlus1,
        totalScore: decision.totalScore,
        branchesExplored: decision.totalBranchesExplored,
        candidateBranches: decision.candidateTraces,
      })
    }

    if (state.winner !== null) {
      break
    }
  }

  if (state.winner === null) {
    endTurnAndAdvance(state)
    if (state.winner === null) {
      state.winReason = 'MAX_TURNS_REACHED'
      if (state.player.prizes.length < state.opponent.prizes.length) {
        state.winner = 'PLAYER'
      } else if (state.opponent.prizes.length < state.player.prizes.length) {
        state.winner = 'OPPONENT'
      } else {
        state.winner = 'DRAW'
      }
    }
  }

  const playerPrizesWon = Math.max(0, 6 - state.player.prizes.length)
  const opponentPrizesWon = Math.max(0, 6 - state.opponent.prizes.length)

  const tracedGame: TracedGameRecord | undefined = recordTrace
    ? {
        gameIndex: gameIndex + 1,
        seed,
        opponentId: opponentDeck.id,
        opponentName: opponentDeck.name,
        firstPlayer: firstPlayerIndex === 0 ? 'PLAYER' : 'OPPONENT',
        winner: state.winner,
        winReason: state.winReason,
        totalTurns: state.turnNumber,
        playerPrizesWon,
        opponentPrizesWon,
        playerMulligans: state.player.mulliganCount,
        opponentMulligans: state.opponent.mulliganCount,
        playerInitialHand: state.player.initialHandSnapshot,
        playerInitialPrizes: state.player.initialPrizesSnapshot,
        opponentInitialHand: state.opponent.initialHandSnapshot,
        opponentInitialPrizes: state.opponent.initialPrizesSnapshot,
        turns: tracedTurns,
      }
    : undefined

  return {
    gameIndex: gameIndex + 1,
    opponentId: opponentDeck.id,
    opponentName: opponentDeck.name,
    winner: state.winner,
    winReason: state.winReason,
    turnsPlayed: state.turnNumber,
    playerPrizesWon,
    opponentPrizesWon,
    playerMulligans: state.player.mulliganCount,
    opponentMulligans: state.opponent.mulliganCount,
    hadPlayerTurn1BenchSetup,
    hadPlayerTurn2AttackerReady,
    tracedGame,
  }
}

/**
 * Exécute un lot (Shard) de parties et notifie la progression en temps réel.
 */
export function runSimulationShard(
  input: SimulationShardInput,
  onProgress?: (completedCountInShard: number) => void,
): SimulationShardResult {
  const outcomes: SingleGameOutcome[] = []
  const tracedGames: TracedGameRecord[] = []
  const oppCount = Math.max(1, input.opponentDecks.length)

  for (let i = 0; i < input.gameCount; i++) {
    const globalGameIdx = input.startGameIndex + i
    const oppDeck = input.opponentDecks[globalGameIdx % oppCount]!
    const gameSeed = deriveGameSeed(input.baseSeed, globalGameIdx + 1)
    const shouldTrace = globalGameIdx < MAX_TRACED_GAMES

    const outcome = playFullGame(
      input.playerDeckModels,
      oppDeck,
      globalGameIdx,
      gameSeed,
      input.config,
      shouldTrace,
    )

    outcomes.push(outcome)
    if (outcome.tracedGame) {
      tracedGames.push(outcome.tracedGame)
    }

    if (onProgress && ((i + 1) % 2 === 0 || i === input.gameCount - 1)) {
      onProgress(i + 1)
    }
  }

  return {
    shardId: input.shardId,
    outcomes,
    tracedGames,
  }
}

/**
 * Fusionne les résultats de tous les Shards Web Workers pour produire les 8 KPIs obligatoires
 * et les 50 parties tracées pour l'Inspecteur Debug.
 */
export function mergeSimulationShards(
  shards: SimulationShardResult[],
  opponentDecks: OpponentDeckDescriptor[],
  config: SimulationConfig,
  baseSeed: number,
  totalDurationMs: number,
): SimulationMetricsSummary {
  const allOutcomes: SingleGameOutcome[] = []
  const allTraced: TracedGameRecord[] = []

  for (const shard of shards) {
    allOutcomes.push(...shard.outcomes)
    allTraced.push(...shard.tracedGames)
  }

  allOutcomes.sort((a, b) => a.gameIndex - b.gameIndex)
  allTraced.sort((a, b) => a.gameIndex - b.gameIndex)

  const totalGames = allOutcomes.length
  let wins = 0
  let losses = 0
  let draws = 0
  let totalPlayerMulligans = 0
  let gamesWithMulliganCount = 0
  let sumPlayerPrizes = 0
  let sumOpponentPrizes = 0
  let sumTurns = 0
  let turn1BenchSetupCount = 0
  let turn2AttackerReadyCount = 0

  const winReasons = {
    ALL_PRIZES_TAKEN: 0,
    NO_POKEMON_IN_PLAY: 0,
    DECK_OUT: 0,
    MAX_TURNS_REACHED: 0,
  }

  const byOpponent = new Map<
    string,
    {
      desc: OpponentDeckDescriptor
      games: number
      wins: number
      losses: number
      draws: number
      playerPrizes: number
      opponentPrizes: number
    }
  >()

  for (const opp of opponentDecks) {
    byOpponent.set(opp.id, {
      desc: opp,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      playerPrizes: 0,
      opponentPrizes: 0,
    })
  }

  for (const o of allOutcomes) {
    if (o.winner === 'PLAYER') wins++
    else if (o.winner === 'OPPONENT') losses++
    else draws++

    totalPlayerMulligans += o.playerMulligans
    if (o.playerMulligans >= 1) gamesWithMulliganCount++

    sumPlayerPrizes += o.playerPrizesWon
    sumOpponentPrizes += o.opponentPrizesWon
    sumTurns += o.turnsPlayed

    if (o.hadPlayerTurn1BenchSetup) turn1BenchSetupCount++
    if (o.hadPlayerTurn2AttackerReady) turn2AttackerReadyCount++

    if (o.winReason && o.winReason in winReasons) {
      winReasons[o.winReason]++
    }

    const bucket = byOpponent.get(o.opponentId)
    if (bucket) {
      bucket.games++
      if (o.winner === 'PLAYER') bucket.wins++
      else if (o.winner === 'OPPONENT') bucket.losses++
      else bucket.draws++
      bucket.playerPrizes += o.playerPrizesWon
      bucket.opponentPrizes += o.opponentPrizesWon
    }
  }

  const matchupBreakdown: MatchupStatRecord[] = Array.from(byOpponent.values()).map((b) => ({
    opponentId: b.desc.id,
    opponentName: b.desc.name,
    archetypeTag: b.desc.archetypeTag,
    accentColor: b.desc.accentColor,
    gamesPlayed: b.games,
    wins: b.wins,
    losses: b.losses,
    draws: b.draws,
    winRate: b.games > 0 ? Math.round((b.wins / b.games) * 1000) / 10 : 0,
    avgPlayerPrizesWon: b.games > 0 ? Math.round((b.playerPrizes / b.games) * 100) / 100 : 0,
    avgOpponentPrizesWon: b.games > 0 ? Math.round((b.opponentPrizes / b.games) * 100) / 100 : 0,
  }))

  const safeDurationSec = Math.max(0.001, totalDurationMs / 1000)
  const gamesPerSecond = Math.round((totalGames / safeDurationSec) * 10) / 10

  return {
    totalDurationMs: Math.round(totalDurationMs),
    totalGamesSimulated: totalGames,
    gamesPerSecond,
    globalWinRate: totalGames > 0 ? Math.round((wins / totalGames) * 1000) / 10 : 0,
    wins,
    losses,
    draws,
    matchupBreakdown,
    totalPlayerMulligans,
    gamesWithMulliganCount,
    gamesWithMulliganRate:
      totalGames > 0 ? Math.round((gamesWithMulliganCount / totalGames) * 1000) / 10 : 0,
    avgPlayerPrizesWon:
      totalGames > 0 ? Math.round((sumPlayerPrizes / totalGames) * 100) / 100 : 0,
    avgOpponentPrizesWon:
      totalGames > 0 ? Math.round((sumOpponentPrizes / totalGames) * 100) / 100 : 0,
    avgTurnsPlayed: totalGames > 0 ? Math.round((sumTurns / totalGames) * 10) / 10 : 0,
    turn1BenchSetupRate:
      totalGames > 0 ? Math.round((turn1BenchSetupCount / totalGames) * 1000) / 10 : 0,
    turn2AttackerReadyRate:
      totalGames > 0 ? Math.round((turn2AttackerReadyCount / totalGames) * 1000) / 10 : 0,
    winReasons,
    configUsed: config,
    baseSeedUsed: baseSeed,
    tracedGames: allTraced.slice(0, MAX_TRACED_GAMES),
  }
}
