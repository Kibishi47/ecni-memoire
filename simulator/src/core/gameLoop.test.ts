import { describe, expect, it } from 'vitest'
import { META_OPPONENT_DECKS } from '../data/metaDecks'
import { parsePtcglDecklist } from '../utils/ptcglParser'
import { SimulationWorkerPool } from '../worker/workerPool'

describe('GameLoop & WorkerPool — Full Match Simulation & 8 Mandatory KPIs', () => {
  it('simulates full matches across multiple meta opponents and computes all 8 mandatory KPIs deterministically', async () => {
    const playerDeck = parsePtcglDecklist(META_OPPONENT_DECKS[0]!.ptcglText)
    const pool = new SimulationWorkerPool()

    const config = {
      iterations: 8,
      maxTurns: 14,
      maxBranches: 8 as const,
      selectedOpponentIds: [
        META_OPPONENT_DECKS[0]!.id,
        META_OPPONENT_DECKS[1]!.id,
      ],
      firstPlayerMode: 'RANDOM' as const,
      workerCount: 2,
      fixedSeed: 123456,
      perturbationType: 'NONE' as const,
      perturbationTurn: 3,
    }

    const summary1 = await pool.runSimulation(playerDeck, config)
    const summary2 = await pool.runSimulation(playerDeck, config)

    // Vérification des 8 KPIs obligatoires
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

    // Vérification des 6 nouvelles familles d'analyses tactiques compétitives
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
  })

  it('tracks OHKO attacker streaming under stressTestOhkoEachTurn and post-Iono resilience', async () => {
    const playerDeck = parsePtcglDecklist(META_OPPONENT_DECKS[0]!.ptcglText)
    const pool = new SimulationWorkerPool()

    const config = {
      iterations: 6,
      maxTurns: 12,
      maxBranches: 8 as const,
      selectedOpponentIds: [META_OPPONENT_DECKS[0]!.id],
      firstPlayerMode: 'RANDOM' as const,
      workerCount: 1,
      fixedSeed: 987654,
      perturbationType: 'FORCE_OPPONENT_IONO' as const,
      perturbationTurn: 3,
      stressTestOhkoEachTurn: true,
    }

    const summary = await pool.runSimulation(playerDeck, config)
    expect(summary.totalGamesSimulated).toBe(6)
    expect(summary.totalActiveKOsSuffered).toBeGreaterThan(0)
    expect(summary.postDisruptionResilience.disruptionsSufferedCount).toBeGreaterThan(0)
  })

  it('cancels simulation immediately and sets status to CANCELLED', async () => {
    const playerDeck = parsePtcglDecklist(META_OPPONENT_DECKS[0]!.ptcglText)
    const pool = new SimulationWorkerPool()

    const config = {
      iterations: 50,
      maxTurns: 14,
      maxBranches: 8 as const,
      selectedOpponentIds: [META_OPPONENT_DECKS[0]!.id],
      firstPlayerMode: 'RANDOM' as const,
      workerCount: 2,
      fixedSeed: 42,
      perturbationType: 'NONE' as const,
      perturbationTurn: 3,
    }

    const simPromise = pool.runSimulation(playerDeck, config)
    expect(pool.isRunning).toBe(true)
    pool.cancelSimulation()
    expect(pool.isRunning).toBe(false)
    expect(pool.status).toBe('CANCELLED')

    await expect(simPromise).rejects.toThrow('Simulation annulée par l\'utilisateur')
  })

  it('supports DYNAMIC_BATCHES scheduling, collectDetailedTelemetry=false, and marginOfErrorPct', async () => {
    const playerDeck = parsePtcglDecklist(META_OPPONENT_DECKS[0]!.ptcglText)
    const pool = new SimulationWorkerPool()

    const summary = await pool.runSimulation(playerDeck, {
      iterations: 16,
      maxTurns: 12,
      maxBranches: 8,
      lookaheadPly: 1,
      topKCandidates: 1,
      beamWidth: 4,
      selectedOpponentIds: [META_OPPONENT_DECKS[0]!.id, META_OPPONENT_DECKS[1]!.id],
      firstPlayerMode: 'RANDOM',
      workerCount: 2,
      workerSchedulingMode: 'DYNAMIC_BATCHES',
      batchSize: 5,
      collectDetailedTelemetry: false,
      fixedSeed: 5555,
    })

    expect(summary.totalGamesSimulated).toBe(16)
    expect(summary.marginOfErrorPct).toBeGreaterThanOrEqual(0)
    expect(Object.keys(summary.cardTelemetry)).toHaveLength(0)
  })
})
