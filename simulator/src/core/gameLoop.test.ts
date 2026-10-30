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
  })
})
