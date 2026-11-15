import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { z } from 'zod'
import {
  clearCompiledCards,
  createInitialMatchState,
  evaluateBestTurnBranch,
  expandParsedDeckToModels,
  getCompiledCardsCount,
  META_OPPONENT_DECKS,
  parsePtcglDecklist,
  registerCompiledCards,
  startTurn,
  type AiTemperament,
  type LookaheadPly,
  type MatchState,
  type MaxBranchesSetting,
} from '@olydor/engine'
import { getPool } from '../db/pool.js'
import { CardCatalogCache, type CardCatalogSnapshot } from '../services/alternativesService.js'
import { parseWithZod } from './validation.js'

export interface EngineRouteOptions {
  pool?: Pool
  catalogCache?: CardCatalogCache
}

let lastLoadedSnapshot: CardCatalogSnapshot | null = null

/**
 * Ensures the `@olydor/engine` in-memory catalog is synchronized from PostgreSQL (`cards` table).
 */
export async function ensureEngineCatalogLoaded(catalogCache: CardCatalogCache): Promise<number> {
  const snapshot = await catalogCache.getSnapshot()
  if (snapshot !== lastLoadedSnapshot || (snapshot.models.length > 0 && getCompiledCardsCount() === 0)) {
    clearCompiledCards()
    registerCompiledCards(snapshot.models)
    lastLoadedSnapshot = snapshot
  }
  return getCompiledCardsCount()
}

const validateDeckBodySchema = z.object({
  deckText: z.string({ required_error: 'deckText est requis' }).trim().min(1, 'La decklist PTCGL ne peut pas être vide'),
})

const evaluateTurnBodySchema = z
  .object({
    state: z.record(z.string(), z.unknown()).optional(),
    ptcglText: z.string().trim().min(1).optional(),
    opponentDeckId: z.string().trim().optional(),
    seed: z.coerce.number().int().optional(),
    maxBranches: z
      .union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12), z.literal(999)])
      .optional()
      .default(8),
    lookaheadPly: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(3),
    aiTemperament: z.enum(['BALANCED', 'AGGRESSIVE', 'DEFENSIVE']).optional().default('BALANCED'),
    recordTrace: z.boolean().optional().default(true),
  })
  .refine((data) => Boolean(data.state || data.ptcglText), {
    message: 'Fournissez soit un objet `state` (MatchState) soit une decklist `ptcglText`.',
  })

/**
 * Registers shared `@olydor/engine` server-side endpoints:
 * - `POST /api/decks/validate`
 * - `POST /api/engine/evaluate-turn`
 */
export async function registerEngineRoutes(
  app: FastifyInstance,
  options: EngineRouteOptions = {},
): Promise<void> {
  const catalogCache = options.catalogCache ?? new CardCatalogCache({ pool: options.pool ?? getPool() })

  app.post('/api/decks/validate', async (request, reply) => {
    const parsedBody = parseWithZod(validateDeckBodySchema, request.body, reply)
    if (!parsedBody) return

    await ensureEngineCatalogLoaded(catalogCache)

    const deck = parsePtcglDecklist(parsedBody.deckText)
    const isValid =
      deck.isValid60 &&
      deck.hasAtLeastOneBasic &&
      deck.isFullyResolved &&
      deck.isStandardLegal

    return reply.status(200).send({
      isValid,
      isValid60: deck.isValid60,
      hasAtLeastOneBasic: deck.hasAtLeastOneBasic,
      isFullyResolved: deck.isFullyResolved,
      isStandardLegal: deck.isStandardLegal,
      totalCards: deck.totalCards,
      unresolvedCount: deck.unresolvedCount,
      unresolvedCards: deck.unresolvedCards,
      copyLimitViolations: deck.copyLimitViolations ?? [],
      warnings: deck.warnings,
      catalogCardsLoaded: getCompiledCardsCount(),
      cards: deck.cards.map((entry) => ({
        cardId: entry.model.cardId,
        nameFr: entry.model.identity.nameFr,
        category: entry.model.category,
        subCategory: entry.model.subCategory,
        quantity: entry.quantity,
        setCode: entry.setCode,
        collectorNumber: entry.number,
        isAceSpec: entry.model.identity.isAceSpec,
        aiRole: entry.model.strategicEvaluator.aiRole,
      })),
    })
  })

  app.post('/api/engine/evaluate-turn', async (request, reply) => {
    const body = parseWithZod(evaluateTurnBodySchema, request.body, reply)
    if (!body) return

    await ensureEngineCatalogLoaded(catalogCache)

    let turnState: MatchState
    if (body.state) {
      turnState = body.state as unknown as MatchState
    } else {
      const parsedPlayer = parsePtcglDecklist(body.ptcglText!)
      if (!parsedPlayer.hasAtLeastOneBasic || parsedPlayer.totalCards < 7) {
        return reply.status(400).send({
          error: 'Invalid Decklist',
          message: 'La decklist doit contenir au moins un Pokémon de base et suffisamment de cartes pour démarrer un duel.',
        })
      }

      const oppMeta =
        META_OPPONENT_DECKS.find((d) => d.id === body.opponentDeckId) ?? META_OPPONENT_DECKS[0]!
      const parsedOpp = parsePtcglDecklist(oppMeta.ptcglText)

      const playerModels = expandParsedDeckToModels(parsedPlayer)
      const oppModels = expandParsedDeckToModels(parsedOpp)
      const initial = createInitialMatchState(playerModels, oppModels, {
        seed: body.seed ?? 20261114,
        firstPlayerIndex: 0,
        maxTurns: 14,
      })
      startTurn(initial)
      turnState = initial
    }

    const decision = evaluateBestTurnBranch(
      turnState,
      body.maxBranches as MaxBranchesSetting,
      body.recordTrace,
      {
        lookaheadPly: body.lookaheadPly as LookaheadPly,
        aiTemperament: body.aiTemperament as AiTemperament,
      },
    )

    return reply.status(200).send({
      bestMove: decision.chosenActionLabels[0] ?? decision.chosenActions[0]?.label ?? 'Passer le tour',
      chosenActionLabels: decision.chosenActionLabels,
      chosenActionsCount: decision.chosenActions.length,
      scoreT: decision.scoreT,
      scoreTAdv: decision.scoreTAdv,
      scoreTPlus1: decision.scoreTPlus1,
      expectedEvaluationScore: decision.totalScore,
      totalBranchesExplored: decision.totalBranchesExplored,
      candidateTraces: decision.candidateTraces,
    })
  })
}
