import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { META_OPPONENT_DECKS } from '@meta-oracle/engine'
import { buildServer } from '../src/server.js'

function createMockPool(): Pool {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT 1')) {
        return { rows: [{ '?column?': 1 }] }
      }
      return { rows: [] }
    }),
  } as unknown as Pool
}

describe('@meta-oracle/api Engine Routes & CORS', () => {
  it('validates a 60-card Standard PTCGL deck via POST /api/decks/validate', async () => {
    const app = await buildServer({ pool: createMockPool(), logger: false })

    const validRes = await app.inject({
      method: 'POST',
      url: '/api/decks/validate',
      payload: {
        deckText: META_OPPONENT_DECKS[0]!.ptcglText,
      },
    })

    expect(validRes.statusCode).toBe(200)
    const body = validRes.json()
    expect(body.isValid).toBe(true)
    expect(body.isValid60).toBe(true)
    expect(body.hasAtLeastOneBasic).toBe(true)
    expect(body.isFullyResolved).toBe(true)
    expect(body.totalCards).toBe(60)
    expect(body.catalogCardsLoaded).toBe(854)

    const partialRes = await app.inject({
      method: 'POST',
      url: '/api/decks/validate',
      payload: {
        deckText: 'Pokémon: 1\n2 Fantyrm TWM 128',
      },
    })
    expect(partialRes.statusCode).toBe(200)
    expect(partialRes.json().isValid).toBe(false)
    expect(partialRes.json().totalCards).toBe(2)

    await app.close()
  })

  it('evaluates a tactical 3-ply turn branch via POST /api/engine/evaluate-turn', async () => {
    const app = await buildServer({ pool: createMockPool(), logger: false })

    const res = await app.inject({
      method: 'POST',
      url: '/api/engine/evaluate-turn',
      payload: {
        ptcglText: META_OPPONENT_DECKS[0]!.ptcglText,
        opponentDeckId: META_OPPONENT_DECKS[1]!.id,
        seed: 20261114,
        maxBranches: 6,
        lookaheadPly: 3,
      },
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(typeof json.bestMove).toBe('string')
    expect(Array.isArray(json.chosenActionLabels)).toBe(true)
    expect(typeof json.expectedEvaluationScore).toBe('number')
    expect(json.totalBranchesExplored).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(json.candidateTraces)).toBe(true)

    await app.close()
  })

  it('enforces Meta Oracle subdomain & localhost CORS allowlist', async () => {
    const app = await buildServer({ pool: createMockPool(), logger: false })

    for (const allowedOrigin of [
      'https://meta-oracle.com',
      'https://sim.meta-oracle.com',
      'https://arena.meta-oracle.com',
      'http://localhost:3002',
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: allowedOrigin },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin)
    }

    const blockedRes = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://unauthorized.example.com' },
    })
    expect(blockedRes.headers['access-control-allow-origin']).toBeUndefined()

    await app.close()
  })
})
