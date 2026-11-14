import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
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
import { getBackendRoot } from '../config/env.js'
import { parseWithZod } from './validation.js'

let catalogLoaded = false

/**
 * Ensures the 854-card `@olydor/engine` catalog is loaded once in memory.
 */
export function ensureEngineCatalogLoaded(): number {
  if (catalogLoaded && getCompiledCardsCount() > 0) {
    return getCompiledCardsCount()
  }

  const candidates = [
    process.env.CARDS_DATABASE_PATH,
    path.resolve(getBackendRoot(), 'data/cards_database.json'),
    path.resolve(getBackendRoot(), '../../packages/engine/data/cards_database.json'),
    path.resolve(process.cwd(), 'data/cards_database.json'),
  ].filter((p): p is string => Boolean(p && p.trim()))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const raw = JSON.parse(fs.readFileSync(candidate, 'utf8')) as unknown
      const rawList: unknown[] = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && 'cards' in raw && (raw as { cards?: unknown }).cards
          ? Object.values((raw as { cards: Record<string, unknown> }).cards)
          : []
      registerCompiledCards(rawList)
      catalogLoaded = true
      return getCompiledCardsCount()
    }
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
export async function registerEngineRoutes(app: FastifyInstance): Promise<void> {
  ensureEngineCatalogLoaded()

  app.post('/api/decks/validate', async (request, reply) => {
    ensureEngineCatalogLoaded()

    const parsedBody = parseWithZod(validateDeckBodySchema, request.body, reply)
    if (!parsedBody) return

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
    ensureEngineCatalogLoaded()

    const body = parseWithZod(evaluateTurnBodySchema, request.body, reply)
    if (!body) return

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
