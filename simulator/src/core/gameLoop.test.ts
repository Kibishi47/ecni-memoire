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
      debugMode: true,
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

    // Vérification des traces détaillées pour l'Inspecteur Debug (?debug=true)
    expect(summary1.tracedGames.length).toBe(8)
    expect(summary1.tracedGames[0]!.turns.length).toBeGreaterThan(0)
    expect(summary1.tracedGames[0]!.turns[0]!.candidateBranches.length).toBeGreaterThan(0)

    // Déterminisme strict à Seed fixe
    expect(summary1.globalWinRate).toBe(summary2.globalWinRate)
    expect(summary1.avgPlayerPrizesWon).toBe(summary2.avgPlayerPrizesWon)
    expect(summary1.avgOpponentPrizesWon).toBe(summary2.avgOpponentPrizesWon)

    // Vérification des 6 nouvelles familles d'analyses tactiques compétitives
    expect(Object.keys(summary1.cardTelemetry).length).toBeGreaterThan(0)
    const ragingBoltTelemetry = summary1.cardTelemetry['sv05-123']
    expect(ragingBoltTelemetry).toBeDefined()
    expect(ragingBoltTelemetry!.gamesInDeck).toBe(8)
    expect(ragingBoltTelemetry!.quantityInDeck).toBe(4)

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
      debugMode: false,
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
      debugMode: false,
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
})
