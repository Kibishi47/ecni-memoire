import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { getPool } from '../db/pool.js'

export interface DeckRouteOptions {
  pool?: Pool
}

interface MetaDeckRow {
  deck_id: number
  deck_name: string
  deck_archetype: string | null
  card_id: string | null
  count: number | null
  data: Record<string, unknown> | null
}

export interface MetaDeckCardResponse {
  cardId: string
  count: number
  data: Record<string, unknown>
}

export interface MetaDeckResponse {
  id: number
  name: string
  archetype: string | null
  totalCards: number
  cards: MetaDeckCardResponse[]
}

/**
 * Registers meta deck query endpoint (`GET /api/decks/meta`).
 */
export async function registerDeckRoutes(
  app: FastifyInstance,
  options: DeckRouteOptions = {},
): Promise<void> {
  const pool = options.pool ?? getPool()

  app.get('/api/decks/meta', async (_request, reply) => {
    const result = await pool.query<MetaDeckRow>(`
      SELECT
        d.id AS deck_id,
        d.name AS deck_name,
        d.archetype AS deck_archetype,
        c.card_id,
        cd.count,
        c.data
      FROM decks d
      LEFT JOIN card_deck cd ON cd.id_deck = d.id
      LEFT JOIN cards c ON c.id = cd.id_card
      WHERE d.is_active = TRUE
      ORDER BY d.id ASC, cd.count DESC, c.card_id ASC;
    `)

    const decksById = new Map<number, MetaDeckResponse>()

    for (const row of result.rows) {
      let deck = decksById.get(row.deck_id)
      if (!deck) {
        deck = {
          id: row.deck_id,
          name: row.deck_name,
          archetype: row.deck_archetype,
          totalCards: 0,
          cards: [],
        }
        decksById.set(row.deck_id, deck)
      }

      if (row.card_id !== null && row.count !== null && row.data !== null) {
        deck.cards.push({
          cardId: row.card_id,
          count: row.count,
          data: row.data,
        })
        deck.totalCards += row.count
      }
    }

    return reply.status(200).send(Array.from(decksById.values()))
  })
}
