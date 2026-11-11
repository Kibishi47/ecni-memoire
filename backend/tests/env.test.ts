import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { parseEnv } from '../src/config/env.js'
import { buildServer } from '../src/server.js'

describe('env validation and core routes', () => {
  it('validates environment variables strictly with Zod', () => {
    const parsed = parseEnv({
      PORT: '4000',
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      GITHUB_TOKEN: '   ',
      RATE_LIMIT_MAX_REPORTS_PER_HOUR: '10',
    })

    expect(parsed.PORT).toBe(4000)
    expect(parsed.NODE_ENV).toBe('production')
    expect(parsed.GITHUB_TOKEN).toBeUndefined()
    expect(parsed.RATE_LIMIT_MAX_REPORTS_PER_HOUR).toBe(10)

    expect(() =>
      parseEnv({
        DATABASE_URL: 'mysql://localhost/db',
      }),
    ).toThrow(/DATABASE_URL/)
  })

  it('serves /health, /api/decks/meta, /api/cards/batch, and /api/cards/:cardId', async () => {
    const sampleCard = { cardId: 'sv06-130', identity: { nameFr: 'Lanssorien-ex' } }

    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT 1')) {
          return { rows: [{ '?column?': 1 }] }
        }
        if (sql.includes('FROM decks d')) {
          return {
            rows: [
              {
                deck_id: 1,
                deck_name: 'Lanssorien-ex',
                deck_archetype: 'Spread & Contrôle',
                card_id: 'sv06-130',
                count: 3,
                data: sampleCard,
              },
            ],
          }
        }
        if (sql.includes('WHERE card_id = ANY($1)')) {
          return { rows: [{ card_id: 'sv06-130', data: sampleCard }] }
        }
        if (sql.includes('WHERE card_id = $1')) {
          return params?.[0] === 'sv06-130'
            ? { rows: [{ data: sampleCard }] }
            : { rows: [] }
        }
        return { rows: [] }
      }),
    } as unknown as Pool

    const app = await buildServer({ pool, logger: false })

    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json().status).toBe('ok')

    const decks = await app.inject({ method: 'GET', url: '/api/decks/meta' })
    expect(decks.statusCode).toBe(200)
    expect(decks.json()).toEqual([
      {
        id: 1,
        name: 'Lanssorien-ex',
        archetype: 'Spread & Contrôle',
        totalCards: 3,
        cards: [{ cardId: 'sv06-130', count: 3, data: sampleCard }],
      },
    ])

    const batch = await app.inject({
      method: 'POST',
      url: '/api/cards/batch',
      payload: { cardIds: ['sv06-130'] },
    })
    expect(batch.statusCode).toBe(200)
    expect(batch.json()).toEqual({ 'sv06-130': sampleCard })

    const cardOk = await app.inject({ method: 'GET', url: '/api/cards/sv06-130' })
    expect(cardOk.statusCode).toBe(200)
    expect(cardOk.json()).toEqual(sampleCard)

    const card404 = await app.inject({ method: 'GET', url: '/api/cards/unknown-999' })
    expect(card404.statusCode).toBe(404)

    await app.close()
  })
})
