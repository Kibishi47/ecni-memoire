import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { z } from 'zod'
import { env } from '../config/env.js'
import { getPool } from '../db/pool.js'
import { GitHubService, type GitHubIssueCreator } from '../services/githubService.js'
import { InMemoryRateLimiter } from '../services/rateLimiter.js'
import { parseWithZod } from './validation.js'

export interface ReportRouteOptions {
  pool?: Pool
  githubService?: GitHubIssueCreator
  rateLimiter?: InMemoryRateLimiter
}

const optionalCommentSchema = z
  .string()
  .trim()
  .max(1000, 'userComment ne peut pas dépasser 1000 caractères')
  .transform((val) => (val === '' ? null : val))
  .nullable()
  .optional()

const optionalCardIdSchema = z
  .string()
  .trim()
  .max(32, 'cardId ne peut pas dépasser 32 caractères')
  .transform((val) => (val === '' ? null : val))
  .nullable()
  .optional()

const cardModelReportSchema = z.object({
  type: z.literal('CARD_MODEL_ERROR'),
  cardId: z
    .string({ required_error: 'cardId est requis pour CARD_MODEL_ERROR' })
    .trim()
    .min(1, 'cardId ne peut pas être vide pour CARD_MODEL_ERROR')
    .max(32, 'cardId ne peut pas dépasser 32 caractères'),
  matchLogs: z.record(z.string(), z.unknown()).nullable().optional(),
  userComment: optionalCommentSchema,
})

const engineRuleReportSchema = z.object({
  type: z.literal('ENGINE_RULE_ERROR'),
  cardId: optionalCardIdSchema,
  matchLogs: z.record(z.string(), z.unknown(), {
    required_error: 'matchLogs est requis pour ENGINE_RULE_ERROR',
    invalid_type_error: 'matchLogs doit être un objet JSON valide',
  }),
  userComment: optionalCommentSchema,
})

export const createReportBodySchema = z.discriminatedUnion('type', [
  cardModelReportSchema,
  engineRuleReportSchema,
])

/**
 * Registers bug reporting endpoint (`POST /api/reports`) with rate limiting and GitHub integration.
 */
export async function registerReportRoutes(
  app: FastifyInstance,
  options: ReportRouteOptions = {},
): Promise<void> {
  const pool = options.pool ?? getPool()
  const githubService = options.githubService ?? new GitHubService()
  const rateLimiter =
    options.rateLimiter ??
    new InMemoryRateLimiter({
      maxRequests: env.RATE_LIMIT_MAX_REPORTS_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    })

  app.post('/api/reports', async (request, reply) => {
    const clientIp = (request.ip || 'unknown').slice(0, 45)
    const rate = rateLimiter.consume(clientIp)

    if (!rate.allowed) {
      return reply
        .status(429)
        .header('Retry-After', String(rate.retryAfterSeconds))
        .send({
          error: 'Too Many Requests',
          message: `Limite de signalements atteinte (maximum ${env.RATE_LIMIT_MAX_REPORTS_PER_HOUR} par heure).`,
          retryAfterSeconds: rate.retryAfterSeconds,
        })
    }

    const parsed = parseWithZod(createReportBodySchema, request.body, reply)
    if (!parsed) return

    const requestedCardId = parsed.cardId ?? null
    const matchLogs = parsed.matchLogs ?? null
    const userComment = parsed.userComment ?? null

    let dbCardId: string | null = null
    let cardNameFr: string | null = null
    let cardInCatalog = false

    if (requestedCardId) {
      const cardRes = await pool.query<{ card_id: string; name_fr: string }>(
        'SELECT card_id, name_fr FROM cards WHERE card_id = $1',
        [requestedCardId],
      )
      if (cardRes.rows.length > 0) {
        dbCardId = cardRes.rows[0]!.card_id
        cardNameFr = cardRes.rows[0]!.name_fr
        cardInCatalog = true
      }
    }

    const storedComment =
      requestedCardId && !cardInCatalog
        ? [
            `[cardId signalé hors catalogue : ${requestedCardId}]`,
            userComment,
          ]
            .filter(Boolean)
            .join('\n')
        : userComment

    const insertRes = await pool.query<{ id: number }>(
      `
        INSERT INTO bug_reports (type, card_id, match_logs, user_comment, status, client_ip)
        VALUES ($1, $2, $3::jsonb, $4, 'OPEN', $5)
        RETURNING id;
      `,
      [
        parsed.type,
        dbCardId,
        matchLogs ? JSON.stringify(matchLogs) : null,
        storedComment,
        clientIp,
      ],
    )

    const reportId = insertRes.rows[0]!.id
    let issueUrl: string | null = null

    if (githubService.isConfigured()) {
      try {
        const createdIssue = await githubService.createBugReportIssue({
          reportId,
          type: parsed.type,
          cardId: requestedCardId,
          cardNameFr,
          cardInCatalog: requestedCardId ? cardInCatalog : undefined,
          matchLogs,
          userComment,
        })

        if (createdIssue) {
          issueUrl = createdIssue.issueUrl
          await pool.query(
            `
              UPDATE bug_reports
              SET github_issue_url = $1, github_issue_number = $2
              WHERE id = $3;
            `,
            [createdIssue.issueUrl, createdIssue.issueNumber, reportId],
          )
        }
      } catch (err) {
        app.log.error(
          { err, reportId },
          '[reports] Échec lors de la création de l’issue GitHub (signalement conservé en base)',
        )
      }
    }

    return reply.status(201).send({
      success: true,
      reportId,
      issueUrl,
    })
  })
}
