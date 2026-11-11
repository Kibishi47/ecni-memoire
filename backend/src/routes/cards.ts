import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { z } from 'zod'
import { getPool } from '../db/pool.js'
import { parseWithZod } from './validation.js'

export interface CardRouteOptions {
  pool?: Pool
}

const batchCardsBodySchema = z.object({
  cardIds: z
    .array(z.string().trim().min(1, 'Chaque cardId doit être une chaîne non vide').max(32))
    .min(1, 'cardIds doit contenir au moins 1 identifiant')
    .max(100, 'cardIds ne peut pas dépasser 100 identifiants par requête'),
})

const cardIdParamsSchema = z.object({
  cardId: z.string().trim().min(1).max(32),
})

/**
 * Registers card lookup endpoints (`POST /api/cards/batch` and `GET /api/cards/:cardId`).
 */
export async function registerCardRoutes(
  app: FastifyInstance,
  options: CardRouteOptions = {},
): Promise<void> {
  const pool = options.pool ?? getPool()

  app.post('/api/cards/batch', async (request, reply) => {
    const parsed = parseWithZod(batchCardsBodySchema, request.body, reply)
    if (!parsed) return

    const uniqueIds = Array.from(new Set(parsed.cardIds))

    const result = await pool.query<{ card_id: string; data: Record<string, unknown> }>(
      'SELECT card_id, data FROM cards WHERE card_id = ANY($1)',
      [uniqueIds],
    )

    const dictionary: Record<string, Record<string, unknown>> = {}
    for (const row of result.rows) {
      dictionary[row.card_id] = row.data
    }

    return reply.status(200).send(dictionary)
  })

  app.get('/api/cards/:cardId', async (request, reply) => {
    const params = parseWithZod(cardIdParamsSchema, request.params, reply)
    if (!params) return

    const result = await pool.query<{ data: Record<string, unknown> }>(
      'SELECT data FROM cards WHERE card_id = $1',
      [params.cardId],
    )

    if (result.rows.length === 0) {
      return reply.status(404).send({
        error: 'Card not found',
        cardId: params.cardId,
      })
    }

    return reply.status(200).send(result.rows[0]!.data)
  })
}
