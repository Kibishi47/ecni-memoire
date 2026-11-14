import { ref } from 'vue'
import type {
  AlternativesRequestParams,
  ApiMetaDeck,
  ApiMetaDeckCard,
  BugReportPayload,
  BugReportResponse,
  EngineCardModel,
  HealthResponse,
  ResolveCardItemInput,
  ResolveCardsResponse,
  ResolvedCardResult,
  SearchCardsParams,
  SearchCardsResponse,
  SmartAlternativeSuggestion,
} from '@meta-oracle/types'
import {
  findSmartDeckAlternatives,
  getAllCatalogModels,
  getCompiledCardsCount,
  META_OPPONENT_DECKS,
  parsePtcglDecklist,
  registerCardIdAlias,
  registerCompiledCard,
  registerCompiledCards,
  resolveCardModel,
  UNIFIED_CARD_REGISTRY,
} from '@meta-oracle/engine'

export type {
  AlternativesRequestParams,
  ApiMetaDeck,
  ApiMetaDeckCard,
  BugReportPayload,
  BugReportResponse,
  HealthResponse,
  ResolveCardItemInput,
  ResolveCardsResponse,
  ResolvedCardResult,
  ResolutionMatchType,
  SearchCardsParams,
  SearchCardsResponse,
} from '@meta-oracle/types'

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

let configuredApiBaseUrl = ''
let localCatalogLoadPromise: Promise<number> | null = null
export const isUsingOfflineCatalog = ref(false)

export function setApiBaseUrl(url: string): void {
  configuredApiBaseUrl = url.trim().replace(/\/+$/, '')
}

export function getApiBaseUrl(): string {
  if (configuredApiBaseUrl) return configuredApiBaseUrl
  const env = (import.meta as { env?: Record<string, string | undefined> }).env
  const raw =
    env?.NUXT_PUBLIC_API_URL ||
    env?.VITE_API_URL ||
    (typeof process !== 'undefined' ? process.env?.NUXT_PUBLIC_API_URL : undefined) ||
    ''
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
    // Ignore error body read issues
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

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/**
 * Charge le catalogue local consolidé (/cards_database.json) une seule fois en cas de mode offline / repli API.
 */
export async function ensureLocalCatalogLoaded(): Promise<number> {
  if (getCompiledCardsCount() > 50) {
    return getCompiledCardsCount()
  }
  if (!localCatalogLoadPromise) {
    localCatalogLoadPromise = (async () => {
      try {
        const res = await fetch('/cards_database.json', { headers: { Accept: 'application/json' } })
        if (res.ok) {
          const payload = (await res.json()) as unknown
          const cards = Array.isArray(payload)
            ? payload
            : Object.values(payload as Record<string, unknown>)
          registerCompiledCards(cards)
        }
      } catch {
        // Silently keep any already-registered fallback models
      } finally {
        localCatalogLoadPromise = null
      }
      return getCompiledCardsCount()
    })()
  }
  return localCatalogLoadPromise
}

export async function checkHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/health', { method: 'GET', signal })
}

function buildOfflineMetaDecks(): ApiMetaDeck[] {
  return META_OPPONENT_DECKS.map((meta, idx) => {
    const parsed = parsePtcglDecklist(meta.ptcglText)
    return {
      id: idx + 1,
      name: meta.name,
      archetype: meta.archetypeBadge,
      totalCards: parsed.totalCards,
      cards: parsed.cards.map((entry) => ({
        cardId: entry.cardId,
        count: entry.quantity,
        model: entry.model,
      })),
    }
  })
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

  try {
    const rawDecks = await requestJson<RawMetaDeckResponse[]>('/api/decks/meta', {
      method: 'GET',
      signal,
    })

    if (Array.isArray(rawDecks) && rawDecks.length > 0) {
      isUsingOfflineCatalog.value = false
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
  } catch (err) {
    if (isAbortError(err)) throw err
  }

  await ensureLocalCatalogLoaded()
  isUsingOfflineCatalog.value = true
  return buildOfflineMetaDecks()
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

  const limit = params.limit !== undefined ? Math.min(50, Math.max(1, Math.trunc(params.limit))) : 24
  const offset = params.offset !== undefined ? Math.max(0, Math.trunc(params.offset)) : 0

  try {
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
    query.set('limit', String(limit))
    query.set('offset', String(offset))

    const raw = await requestJson<RawSearchResponse>(`/api/cards?${query.toString()}`, {
      method: 'GET',
      signal: params.signal,
    })
    isUsingOfflineCatalog.value = false
    return {
      items: raw.items
        .map((item) => registerApiCardWithAliases(item))
        .filter((m): m is EngineCardModel => m !== null),
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    }
  } catch (err) {
    if (isAbortError(err)) throw err
  }

  await ensureLocalCatalogLoaded()
  isUsingOfflineCatalog.value = true
  const needle = (params.q ?? '').trim().toLowerCase()
  const filtered = Object.values(UNIFIED_CARD_REGISTRY).filter((model) => {
    if (params.category && model.category !== params.category) return false
    if (params.subCategory && model.subCategory !== params.subCategory) return false
    if (!needle) return true
    return (
      model.cardId.toLowerCase().includes(needle) ||
      (model.identity.nameFr ?? '').toLowerCase().includes(needle) ||
      (model.identity.nameEn ?? '').toLowerCase().includes(needle)
    )
  })
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    limit,
    offset,
  }
}

export async function fetchCardsBatch(
  cardIds: string[],
  signal?: AbortSignal,
): Promise<Record<string, EngineCardModel>> {
  const uniqueIds = Array.from(new Set(cardIds.map((id) => id.trim()).filter(Boolean)))
  const out: Record<string, EngineCardModel> = {}

  try {
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
  } catch (err) {
    if (isAbortError(err)) throw err
  }

  await ensureLocalCatalogLoaded()
  isUsingOfflineCatalog.value = true
  for (const id of uniqueIds) {
    const res = resolveCardModel({ cardId: id, rawName: id })
    if (res.source !== 'unresolved') {
      out[id] = res.model
    }
  }
  return out
}

function normalizeLookupName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export async function resolveCardsFromApi(
  items: ResolveCardItemInput[],
  signal?: AbortSignal,
): Promise<ResolveCardsResponse> {
  interface RawResolveResponse {
    resolved: Record<
      string,
      {
        matchedBy: 'card_id' | 'alias_id' | 'name'
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

  try {
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
    isUsingOfflineCatalog.value = false
    return { resolved, unresolved }
  } catch (err) {
    if (isAbortError(err)) throw err
  }

  await ensureLocalCatalogLoaded()
  isUsingOfflineCatalog.value = true
  const byName = new Map<string, EngineCardModel>()
  for (const model of Object.values(UNIFIED_CARD_REGISTRY)) {
    if (model.identity.nameFr) byName.set(normalizeLookupName(model.identity.nameFr), model)
    if (model.identity.nameEn) byName.set(normalizeLookupName(model.identity.nameEn), model)
  }

  for (const item of normalizedItems) {
    let foundModel: EngineCardModel | undefined
    let matchedBy: 'card_id' | 'alias_id' | 'name' = 'card_id'
    for (const cid of item.candidateIds) {
      const res = resolveCardModel({ cardId: cid, rawName: item.name || cid })
      if (res.source !== 'unresolved') {
        foundModel = res.model
        matchedBy = cid === foundModel.cardId ? 'card_id' : 'alias_id'
        break
      }
    }
    if (!foundModel && item.name) {
      foundModel = byName.get(normalizeLookupName(item.name))
      if (foundModel) matchedBy = 'name'
    }
    if (foundModel) {
      registerCardIdAlias(item.key, foundModel.cardId)
      for (const cid of item.candidateIds) {
        registerCardIdAlias(cid, foundModel.cardId)
      }
      resolved[item.key] = { matchedBy, card: foundModel }
    } else {
      unresolved.push(item.key)
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

  try {
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
  } catch (err) {
    if (isAbortError(err)) throw err
  }

  await ensureLocalCatalogLoaded()
  isUsingOfflineCatalog.value = true
  const targetModels = uniqueCardIds
    .map((id) => UNIFIED_CARD_REGISTRY[id])
    .filter((m): m is EngineCardModel => Boolean(m))
  const excludedSet = new Set(excludeCardIds ?? [])
  const rawResults = findSmartDeckAlternatives(targetModels, getAllCatalogModels())
  const filtered: Record<string, SmartAlternativeSuggestion[]> = {}
  for (const [cardId, suggestions] of Object.entries(rawResults)) {
    filtered[cardId] = suggestions
      .filter((s) => !excludedSet.has(s.alternativeCardId))
      .slice(0, limitPerCard)
  }
  return filtered
}

export async function submitBugReport(payload: BugReportPayload): Promise<BugReportResponse> {
  return requestJson<BugReportResponse>('/api/reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
