import type { CardCategory, EngineCardModel } from '../types/cardModel'
import type { SmartAlternativeSuggestion } from '../core/alternativesFinder'
import { registerCardIdAlias, registerCompiledCard } from '../data/cardCatalog'

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

export type BugReportType = 'CARD_MODEL_ERROR' | 'ENGINE_RULE_ERROR'

export interface BugReportPayload {
  type: BugReportType
  cardId?: string | null
  matchLogs?: Record<string, unknown> | null
  userComment?: string | null
}

export interface BugReportResponse {
  success: boolean
  reportId: number
  issueUrl: string | null
}

export class ApiError extends Error {
  readonly status: number
  readonly retryAfterSeconds?: number
  readonly details?: unknown

  constructor(
    message: string,
    status: number,
    options: { retryAfterSeconds?: number; details?: unknown } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfterSeconds = options.retryAfterSeconds
    this.details = options.details
  }
}

export function getApiBaseUrl(): string {
  const raw = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_URL
  if (!raw) return ''
  return raw.trim().replace(/\/+$/, '')
}

function buildApiUrl(path: string): string {
  const base = getApiBaseUrl()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

async function parseErrorBody(res: Response): Promise<{ message: string; retryAfterSeconds?: number; details?: unknown }> {
  const retryHeader = res.headers.get('Retry-After')
  let retryAfterSeconds = retryHeader ? Number.parseInt(retryHeader, 10) : undefined
  if (retryAfterSeconds !== undefined && !Number.isFinite(retryAfterSeconds)) {
    retryAfterSeconds = undefined
  }

  let details: unknown = undefined
  let message = `Erreur HTTP ${res.status}`

  try {
    const text = await res.text()
    if (text) {
      try {
        const json = JSON.parse(text) as Record<string, unknown>
        details = json
        if (typeof json.message === 'string' && json.message.trim().length > 0) {
          message = json.message
        } else if (typeof json.error === 'string' && json.error.trim().length > 0) {
          message = json.error
        }
        if (typeof json.retryAfterSeconds === 'number' && Number.isFinite(json.retryAfterSeconds)) {
          retryAfterSeconds = json.retryAfterSeconds
        }
      } catch {
        message = text.slice(0, 200)
      }
    }
  } catch {
    // Ignorer les erreurs de lecture du corps HTTP en échec
  }

  return { message, retryAfterSeconds, details }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = buildApiUrl(path)
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(url, { ...init, headers })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err
    }
    const reason = err instanceof Error ? err.message : String(err)
    throw new ApiError(`Impossible de joindre le serveur API (${reason})`, 0, { details: err })
  }

  if (!response.ok) {
    const parsed = await parseErrorBody(response)
    throw new ApiError(parsed.message, response.status, {
      retryAfterSeconds: parsed.retryAfterSeconds,
      details: parsed.details,
    })
  }

  return (await response.json()) as T
}

function registerApiCardWithAliases(
  rawCard: Record<string, unknown>,
  aliasKeys: string[] = [],
): EngineCardModel | null {
  const model = registerCompiledCard(rawCard)
  if (!model) return null
  for (const alias of aliasKeys) {
    const trimmed = alias.trim()
    if (trimmed && trimmed !== model.cardId) {
      registerCardIdAlias(trimmed, model.cardId)
    }
  }
  return model
}

export async function checkHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/health', { method: 'GET', signal })
}

export async function fetchMetaDecks(signal?: AbortSignal): Promise<ApiMetaDeck[]> {
  interface RawMetaDeckResponse {
    id: number
    name: string
    archetype: string | null
    totalCards: number
    cards: Array<{
      cardId: string
      count: number
      data: Record<string, unknown>
    }>
  }

  const rawDecks = await requestJson<RawMetaDeckResponse[]>('/api/decks/meta', {
    method: 'GET',
    signal,
  })

  return rawDecks.map((deck) => ({
    id: deck.id,
    name: deck.name,
    archetype: deck.archetype,
    totalCards: deck.totalCards,
    cards: deck.cards
      .map((entry) => {
        const model = registerApiCardWithAliases(entry.data, [entry.cardId])
        if (!model) return null
        return {
          cardId: entry.cardId,
          count: entry.count,
          model,
        }
      })
      .filter((entry): entry is ApiMetaDeckCard => entry !== null),
  }))
}

export async function searchCatalogCards(
  params: SearchCardsParams = {},
): Promise<SearchCardsResponse> {
  interface RawSearchResponse {
    items: Array<Record<string, unknown>>
    total: number
    limit: number
    offset: number
  }

  const query = new URLSearchParams()
  if (params.q && params.q.trim().length > 0) {
    query.set('q', params.q.trim())
  }
  if (params.category) {
    query.set('category', params.category)
  }
  if (params.subCategory && params.subCategory.trim().length > 0) {
    query.set('subCategory', params.subCategory.trim())
  }
  if (params.limit !== undefined) {
    query.set('limit', String(Math.min(50, Math.max(1, Math.trunc(params.limit)))))
  }
  if (params.offset !== undefined) {
    query.set('offset', String(Math.max(0, Math.trunc(params.offset))))
  }

  const qs = query.toString()
  const path = qs ? `/api/cards?${qs}` : '/api/cards'
  const raw = await requestJson<RawSearchResponse>(path, {
    method: 'GET',
    signal: params.signal,
  })

  return {
    items: raw.items
      .map((item) => registerApiCardWithAliases(item))
      .filter((m): m is EngineCardModel => m !== null),
    total: raw.total,
    limit: raw.limit,
    offset: raw.offset,
  }
}

export async function fetchCardsBatch(
  cardIds: string[],
  signal?: AbortSignal,
): Promise<Record<string, EngineCardModel>> {
  const uniqueIds = Array.from(new Set(cardIds.map((id) => id.trim()).filter(Boolean)))
  const out: Record<string, EngineCardModel> = {}

  for (let i = 0; i < uniqueIds.length; i += 300) {
    const chunk = uniqueIds.slice(i, i + 300)
    const rawDict = await requestJson<Record<string, Record<string, unknown>>>('/api/cards/batch', {
      method: 'POST',
      body: JSON.stringify({ cardIds: chunk }),
      signal,
    })

    for (const [requestedId, rawCard] of Object.entries(rawDict)) {
      if (!rawCard) continue
      const model = registerApiCardWithAliases(rawCard, [requestedId])
      if (model) {
        out[requestedId] = model
      }
    }
  }

  return out
}

export async function resolveCardsFromApi(
  items: ResolveCardItemInput[],
  signal?: AbortSignal,
): Promise<ResolveCardsResponse> {
  interface RawResolveResponse {
    resolved: Record<
      string,
      {
        matchedBy: ResolutionMatchType
        card: Record<string, unknown>
      }
    >
    unresolved: string[]
  }

  const normalizedItems = items.map((item) => ({
    key: item.key.trim(),
    candidateIds: Array.from(new Set(item.candidateIds.map((c) => c.trim()).filter(Boolean))).slice(
      0,
      10,
    ),
    ...(item.name && item.name.trim().length > 0 ? { name: item.name.trim() } : {}),
  }))

  const resolved: Record<string, ResolvedCardResult> = {}
  const unresolved: string[] = []

  for (let i = 0; i < normalizedItems.length; i += 100) {
    const chunk = normalizedItems.slice(i, i + 100)
    const inputByKey = new Map(chunk.map((item) => [item.key, item]))

    const raw = await requestJson<RawResolveResponse>('/api/cards/resolve', {
      method: 'POST',
      body: JSON.stringify({ items: chunk }),
      signal,
    })

    for (const [key, entry] of Object.entries(raw.resolved || {})) {
      if (!entry?.card) continue
      const sourceInput = inputByKey.get(key)
      const aliasList = [key, ...(sourceInput?.candidateIds ?? [])]
      const model = registerApiCardWithAliases(entry.card, aliasList)
      if (!model) {
        unresolved.push(key)
        continue
      }
      resolved[key] = {
        matchedBy: entry.matchedBy,
        card: model,
      }
    }

    if (Array.isArray(raw.unresolved)) {
      unresolved.push(...raw.unresolved)
    }
  }

  return { resolved, unresolved }
}

export async function fetchAlternativesFromApi(
  params: AlternativesRequestParams,
): Promise<Record<string, SmartAlternativeSuggestion[]>> {
  type RawAlternativeSuggestion = Omit<SmartAlternativeSuggestion, 'alternativeModel'> & {
    alternativeModel: Record<string, unknown>
  }

  interface RawAlternativesResponse {
    results: Record<string, RawAlternativeSuggestion[]>
  }

  const uniqueCardIds = Array.from(new Set(params.cardIds.map((id) => id.trim()).filter(Boolean)))
  if (uniqueCardIds.length === 0) {
    return {}
  }

  const excludeCardIds = params.excludeCardIds
    ? Array.from(new Set(params.excludeCardIds.map((id) => id.trim()).filter(Boolean))).slice(
        0,
        120,
      )
    : undefined

  const limitPerCard =
    params.limitPerCard !== undefined
      ? Math.min(30, Math.max(1, Math.trunc(params.limitPerCard)))
      : 10

  const merged: Record<string, SmartAlternativeSuggestion[]> = {}

  for (let i = 0; i < uniqueCardIds.length; i += 60) {
    const chunk = uniqueCardIds.slice(i, i + 60)
    const raw = await requestJson<RawAlternativesResponse>('/api/cards/alternatives', {
      method: 'POST',
      body: JSON.stringify({
        cardIds: chunk,
        ...(excludeCardIds && excludeCardIds.length > 0 ? { excludeCardIds } : {}),
        limitPerCard,
      }),
      signal: params.signal,
    })

    for (const [sourceCardId, list] of Object.entries(raw.results || {})) {
      merged[sourceCardId] = (list || [])
        .map((entry) => {
          const model = registerApiCardWithAliases(entry.alternativeModel)
          if (!model) return null
          return {
            ...entry,
            alternativeModel: model,
          }
        })
        .filter((item): item is SmartAlternativeSuggestion => item !== null)
    }
  }

  return merged
}

export async function submitBugReport(payload: BugReportPayload): Promise<BugReportResponse> {
  return requestJson<BugReportResponse>('/api/reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
