import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { z } from 'zod'
import { getPool } from '../db/pool.js'
import {
  SQL_ACCENT_SOURCE,
  SQL_ACCENT_TARGET,
  resolveCardItems,
  resolvePtcglDeckText,
} from '../services/cardResolutionService.js'
import { parseWithZod } from './validation.js'

export interface CardRouteOptions {
  pool?: Pool
}

const optionalTrimmedString = z
  .string()
  .trim()
  .optional()
  .transform((val) => (val && val.length > 0 ? val : undefined))

const searchCardsQuerySchema = z.object({
  q: optionalTrimmedString,
  category: z.enum(['POKEMON', 'TRAINER', 'ENERGY']).optional(),
  subCategory: optionalTrimmedString,
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

const batchCardsBodySchema = z.object({
  cardIds: z
    .array(z.string().trim().min(1, 'Chaque cardId doit être une chaîne non vide').max(32))
    .min(1, 'cardIds doit contenir au moins 1 identifiant')
    .max(300, 'cardIds ne peut pas dépasser 300 identifiants par requête'),
})

const resolveItemSchema = z.object({
  key: z.string().trim().min(1, 'Chaque key doit être une chaîne non vide').max(64),
  candidateIds: z
    .array(z.string().trim().min(1).max(32))
    .min(1, 'candidateIds doit contenir au moins 1 identifiant')
    .max(10, 'candidateIds ne peut pas dépasser 10 identifiants'),
  name: z.string().trim().min(1).max(255).optional(),
})

const resolveModeASchema = z
  .object({
    items: z
      .array(resolveItemSchema)
      .min(1, 'items doit contenir au moins 1 élément')
      .max(100, 'items ne peut pas dépasser 100 éléments'),
  })
  .strict()

const resolveModeBSchema = z
  .object({
    ptcglText: z.string().trim().min(1, 'ptcglText ne peut pas être vide').max(50_000),
  })
  .strict()

const resolveCardsBodySchema = z.union([resolveModeASchema, resolveModeBSchema])

const cardIdParamsSchema = z.object({
  cardId: z.string().trim().min(1).max(32),
})

function foldSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

function sqlFold(expression: string): string {
  return `TRANSLATE(LOWER(COALESCE(${expression}, '')), '${SQL_ACCENT_SOURCE}', '${SQL_ACCENT_TARGET}')`
}

/**
 * Registers card lookup, search, resolution, and detail endpoints.
 */
export async function registerCardRoutes(
  app: FastifyInstance,
  options: CardRouteOptions = {},
): Promise<void> {
  const pool = options.pool ?? getPool()

  app.get('/api/cards', async (request, reply) => {
    const query = parseWithZod(searchCardsQuerySchema, request.query, reply)
    if (!query) return

    const conditions: string[] = []
    const filterParams: unknown[] = []

    if (query.category) {
      filterParams.push(query.category)
      conditions.push(`data->>'category' = $${filterParams.length}`)
    }

    if (query.subCategory) {
      filterParams.push(query.subCategory)
      conditions.push(`data->>'subCategory' = $${filterParams.length}`)
    }

    let foldedQuery: string | undefined
    let escapedPrefix: string | undefined
    if (query.q) {
      foldedQuery = foldSearchText(query.q)
      const escaped = escapeLikePattern(foldedQuery)
      escapedPrefix = `${escaped}%`
      filterParams.push(`%${escaped}%`)
      const patternParam = `$${filterParams.length}`
      conditions.push(
        `(${sqlFold('card_id')} LIKE ${patternParam} ESCAPE '\\' OR ${sqlFold('name_fr')} LIKE ${patternParam} ESCAPE '\\' OR ${sqlFold('name_en')} LIKE ${patternParam} ESCAPE '\\' OR ${sqlFold("data->>'subCategory'")} LIKE ${patternParam} ESCAPE '\\')`,
      )
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countResult = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM cards ${whereClause}`,
      filterParams,
    )
    const total = countResult.rows[0]?.total ?? 0

    const listParams = [...filterParams]
    let orderByClause = 'ORDER BY name_fr ASC, card_id ASC'

    if (foldedQuery !== undefined && escapedPrefix !== undefined) {
      listParams.push(foldedQuery)
      const exactParam = `$${listParams.length}`
      listParams.push(escapedPrefix)
      const prefixParam = `$${listParams.length}`

      orderByClause = `ORDER BY
        CASE
          WHEN ${sqlFold('card_id')} = ${exactParam}
            OR ${sqlFold('name_fr')} = ${exactParam}
            OR ${sqlFold('name_en')} = ${exactParam} THEN 0
          WHEN ${sqlFold('card_id')} LIKE ${prefixParam} ESCAPE '\\'
            OR ${sqlFold('name_fr')} LIKE ${prefixParam} ESCAPE '\\'
            OR ${sqlFold('name_en')} LIKE ${prefixParam} ESCAPE '\\' THEN 1
          ELSE 2
        END ASC,
        name_fr ASC,
        card_id ASC`
    }

    listParams.push(query.limit)
    const limitParam = `$${listParams.length}`
    listParams.push(query.offset)
    const offsetParam = `$${listParams.length}`

    const itemsResult = await pool.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM cards ${whereClause} ${orderByClause} LIMIT ${limitParam} OFFSET ${offsetParam}`,
      listParams,
    )

    return reply.status(200).send({
      items: itemsResult.rows.map((row) => row.data),
      total,
      limit: query.limit,
      offset: query.offset,
    })
  })

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

  app.post('/api/cards/resolve', async (request, reply) => {
    const parsed = parseWithZod(resolveCardsBodySchema, request.body, reply)
    if (!parsed) return

    const result =
      'items' in parsed
        ? await resolveCardItems(pool, parsed.items)
        : await resolvePtcglDeckText(pool, parsed.ptcglText)

    return reply.status(200).send(result)
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
