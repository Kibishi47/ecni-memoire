import { describe, expect, it } from 'vitest'
import type { SimulationConfig } from '@meta-oracle/types'
import {
  expandParsedDeckToModels,
  mergeSimulationShards,
  META_OPPONENT_DECKS,
  parsePtcglDecklist,
  resolveOpponentDescriptors,
  runSimulationShard,
} from '../src/index.js'

describe('GameLoop — Full Match Simulation, 8 Mandatory KPIs & Traced Debug Mode', () => {
  it('simulates full matches across multiple meta opponents and computes all 8 mandatory KPIs deterministically', () => {
    const playerDeck = parsePtcglDecklist(META_OPPONENT_DECKS[0]!.ptcglText)
    const playerModels = expandParsedDeckToModels(playerDeck)
    const opponentDecks = resolveOpponentDescriptors([
      META_OPPONENT_DECKS[0]!.id,
      META_OPPONENT_DECKS[1]!.id,
    ])

    const config: SimulationConfig = {
      iterations: 8,
      maxTurns: 14,
      maxBranches: 8,
      selectedOpponentIds: opponentDecks.map((d) => d.id),
      firstPlayerMode: 'RANDOM',
      workerCount: 2,
      fixedSeed: 123456,
      perturbationType: 'NONE',
      perturbationTurn: 3,
    }

    const shard1 = runSimulationShard({
      shardId: 0,
      startGameIndex: 0,
      gameCount: 4,
      baseSeed: 123456,
      config,
      playerDeckModels: playerModels,
      opponentDecks,
    })
    const shard2 = runSimulationShard({
      shardId: 1,
      startGameIndex: 4,
      gameCount: 4,
      baseSeed: 123456,
      config,
      playerDeckModels: playerModels,
      opponentDecks,
    })

    const summary1 = mergeSimulationShards([shard1, shard2], opponentDecks, config, 123456, 250)

    const shardRepeat1 = runSimulationShard({
      shardId: 0,
      startGameIndex: 0,
      gameCount: 8,
      baseSeed: 123456,
      config,
      playerDeckModels: playerModels,
      opponentDecks,
    })
    const summary2 = mergeSimulationShards([shardRepeat1], opponentDecks, config, 123456, 250)

    expect(summary1.totalGamesSimulated).toBe(8)
    expect(summary1.totalDurationMs).toBeGreaterThanOrEqual(0)
    expect(summary1.gamesPerSecond).toBeGreaterThan(0)
    expect(summary1.globalWinRate).toBeGreaterThanOrEqual(0)
    expect(summary1.globalWinRate).toBeLessThanOrEqual(100)
    expect(summary1.matchupBreakdown.length).toBe(2)
    expect(summary1.matchupBreakdown[0]!.gamesPlayed).toBe(4)
    expect(summary1.matchupBreakdown[1]!.gamesPlayed).toBe(4)
    expect(summary1.avgPlayerPrizesWon).toBeGreaterThanOrEqual(0)
    expect(summary1.avgPlayerPrizesWon).toBeLessThanOrEqual(6)
    expect(summary1.avgOpponentPrizesWon).toBeGreaterThanOrEqual(0)
    expect(summary1.avgOpponentPrizesWon).toBeLessThanOrEqual(6)

    // Déterminisme strict à Seed fixe
    expect(summary1.globalWinRate).toBe(summary2.globalWinRate)
    expect(summary1.avgPlayerPrizesWon).toBe(summary2.avgPlayerPrizesWon)
    expect(summary1.avgOpponentPrizesWon).toBe(summary2.avgOpponentPrizesWon)

    // Vérification des 6 analyses tactiques compétitives
    expect(Object.keys(summary1.cardTelemetry).length).toBeGreaterThan(0)
    const firstCard = playerDeck.cards[0]!
    const telemetry = summary1.cardTelemetry[firstCard.cardId]
    expect(telemetry).toBeDefined()
    expect(telemetry!.gamesInDeck).toBe(8)
    expect(telemetry!.quantityInDeck).toBe(firstCard.quantity)

    expect(summary1.averageSetupTurn).toBeGreaterThanOrEqual(0)
    expect(summary1.setupTurnHistogram.T1).toBeGreaterThanOrEqual(0)
    expect(summary1.attackerStreamingRate).toBeGreaterThanOrEqual(0)
    expect(summary1.attackerStreamingRate).toBeLessThanOrEqual(100)

    expect(summary1.postDisruptionResilience).toBeDefined()
    expect(summary1.bossFlexibility).toBeDefined()
    expect(summary1.bossFlexibilityRate).toBeGreaterThanOrEqual(0)
    expect(summary1.conditionalComboStats.length).toBeGreaterThan(0)
    expect(summary1.averageDamagePerTurn).toBeGreaterThanOrEqual(0)

    expect(summary1.turnOrderSplitStats.gamesGoingFirst).toBe(4)
    expect(summary1.turnOrderSplitStats.gamesGoingSecond).toBe(4)
    expect(summary1.tracedGames).toBeUndefined()
  })

  it('tracks OHKO attacker streaming, post-Iono resilience, and records tracedGames when debugMode=true', () => {
    const playerDeck = parsePtcglDecklist(META_OPPONENT_DECKS[0]!.ptcglText)
    const playerModels = expandParsedDeckToModels(playerDeck)
    const opponentDecks = resolveOpponentDescriptors([META_OPPONENT_DECKS[0]!.id])

    const config: SimulationConfig = {
      iterations: 4,
      maxTurns: 10,
      maxBranches: 8,
      selectedOpponentIds: [META_OPPONENT_DECKS[0]!.id],
      firstPlayerMode: 'RANDOM',
      workerCount: 1,
      fixedSeed: 987654,
      debugMode: true,
      perturbationType: 'FORCE_OPPONENT_IONO',
      perturbationTurn: 3,
      stressTestOhkoEachTurn: true,
    }

    const shard = runSimulationShard({
      shardId: 0,
      startGameIndex: 0,
      gameCount: 4,
      baseSeed: 987654,
      config,
      playerDeckModels: playerModels,
      opponentDecks,
    })

    const summary = mergeSimulationShards([shard], opponentDecks, config, 987654, 150)
    expect(summary.totalGamesSimulated).toBe(4)
    expect(summary.totalActiveKOsSuffered).toBeGreaterThan(0)
    expect(summary.postDisruptionResilience.disruptionsSufferedCount).toBeGreaterThan(0)
    expect(summary.tracedGames?.length).toBe(4)
    expect(summary.tracedGames?.[0]?.turns.length).toBeGreaterThan(0)
  })

  it('supports collectDetailedTelemetry=false and marginOfErrorPct', () => {
    const playerDeck = parsePtcglDecklist(META_OPPONENT_DECKS[0]!.ptcglText)
    const playerModels = expandParsedDeckToModels(playerDeck)
    const opponentDecks = resolveOpponentDescriptors([
      META_OPPONENT_DECKS[0]!.id,
      META_OPPONENT_DECKS[1]!.id,
    ])

    const config: SimulationConfig = {
      iterations: 6,
      maxTurns: 10,
      maxBranches: 8,
      lookaheadPly: 1,
      topKCandidates: 1,
      beamWidth: 4,
      selectedOpponentIds: opponentDecks.map((d) => d.id),
      firstPlayerMode: 'RANDOM',
      workerCount: 1,
      collectDetailedTelemetry: false,
      fixedSeed: 5555,
    }

    const shard = runSimulationShard({
      shardId: 0,
      startGameIndex: 0,
      gameCount: 6,
      baseSeed: 5555,
      config,
      playerDeckModels: playerModels,
      opponentDecks,
    })

    const summary = mergeSimulationShards([shard], opponentDecks, config, 5555, 100)
    expect(summary.totalGamesSimulated).toBe(6)
    expect(summary.marginOfErrorPct).toBeGreaterThanOrEqual(0)
    expect(Object.keys(summary.cardTelemetry)).toHaveLength(0)
  })
})
