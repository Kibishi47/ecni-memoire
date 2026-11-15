import { z } from 'zod'
import type { CardCategory, EffectPrimitive, EngineCardModel } from './cardModel.js'

export interface HealthResponse {
  status: string
  timestamp?: string
}

export interface ApiMetaDeckCard {
  cardId: string
  count: number
  model: EngineCardModel
}

export interface ApiMetaDeck {
  id: number
  name: string
  archetype: string | null
  totalCards: number
  cards: ApiMetaDeckCard[]
}

export interface SearchCardsParams {
  q?: string
  category?: CardCategory
  subCategory?: string
  limit?: number
  offset?: number
  signal?: AbortSignal
}

export interface SearchCardsResponse {
  items: EngineCardModel[]
  total: number
  limit: number
  offset: number
}

export interface ResolveCardItemInput {
  key: string
  candidateIds: string[]
  name?: string
}

export type ResolutionMatchType = 'card_id' | 'alias_id' | 'name'

export interface ResolvedCardResult {
  matchedBy: ResolutionMatchType
  card: EngineCardModel
}

export interface ResolveCardsResponse {
  resolved: Record<string, ResolvedCardResult>
  unresolved: string[]
}

export interface AlternativesRequestParams {
  cardIds: string[]
  excludeCardIds?: string[]
  limitPerCard?: number
  signal?: AbortSignal
}

export interface AttackerComparisonRow {
  cardId: string
  nameFr: string
  subCategory: string
  hp: number
  types: string[]
  energyCostCount: number
  energyCostLabels: string[]
  baseDamage: number
  estimatedMaxDamage: number
  damageSummary: string
  retreatCost: number
  prizeCardsGiven: number
  canAttackTwice: boolean
  primaryRole: string
  mainAttackLabel: string
}

export interface SmartAlternativeSuggestion {
  targetCardId: string
  targetCardNameFr: string
  targetCardNameEn?: string
  alternativeModel: EngineCardModel
  alternativeCardId: string
  alternativeNameFr: string
  alternativeNameEn?: string
  alternativeCategory: string
  alternativeSubCategory: string
  suggestionType:
    | 'SUPPORTER_TO_ITEM_OR_ABILITY'
    | 'FUNCTIONAL_EQUIVALENT'
    | 'ALTERNATIVE_ATTACKER'
  sharedPrimitives: EffectPrimitive[]
  actionEconomyBadge: string
  actionEconomyBadgeEn?: string
  strategicReason: string
  strategicReasonEn?: string
  relevanceScore: number
  attackerComparison?: AttackerComparisonRow
}

export type BugReportType = 'CARD_MODEL_ERROR' | 'ENGINE_RULE_ERROR' | 'WEBSITE_ERROR'

export interface BugReportPayload {
  type: BugReportType
  cardId?: string | null
  matchLogs?: Record<string, unknown> | null
  userComment?: string | null
}

export interface BugReportResponse {
  success: boolean
  reportId: number
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

export const cardModelReportSchema = z.object({
  type: z.literal('CARD_MODEL_ERROR'),
  cardId: z
    .string({ required_error: 'cardId est requis pour CARD_MODEL_ERROR' })
    .trim()
    .min(1, 'cardId ne peut pas être vide pour CARD_MODEL_ERROR')
    .max(32, 'cardId ne peut pas dépasser 32 caractères'),
  matchLogs: z.record(z.string(), z.unknown()).nullable().optional(),
  userComment: optionalCommentSchema,
})

export const engineRuleReportSchema = z.object({
  type: z.literal('ENGINE_RULE_ERROR'),
  cardId: optionalCardIdSchema,
  matchLogs: z.record(z.string(), z.unknown(), {
    required_error: 'matchLogs est requis pour ENGINE_RULE_ERROR',
    invalid_type_error: 'matchLogs doit être un objet JSON valide',
  }),
  userComment: optionalCommentSchema,
})

export const websiteReportSchema = z.object({
  type: z.literal('WEBSITE_ERROR'),
  cardId: optionalCardIdSchema,
  matchLogs: z.record(z.string(), z.unknown()).nullable().optional(),
  userComment: z
    .string({ required_error: 'userComment est requis pour WEBSITE_ERROR' })
    .trim()
    .min(1, 'userComment ne peut pas être vide pour WEBSITE_ERROR')
    .max(1000, 'userComment ne peut pas dépasser 1000 caractères'),
})

export const createReportBodySchema = z.discriminatedUnion('type', [
  cardModelReportSchema,
  engineRuleReportSchema,
  websiteReportSchema,
])

export const bugReportPayloadSchema = createReportBodySchema
