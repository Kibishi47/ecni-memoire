import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  fetchAlternativesFromApi,
  fetchCardsBatch,
  fetchMetaDecks,
  resolveCardsFromApi,
  searchCatalogCards,
  submitBugReport,
} from './apiClient'
import { CARD_ID_ALIASES, UNIFIED_CARD_REGISTRY } from '../data/cardCatalog'

const SAMPLE_RAW_CARD = {
  cardId: 'test-api-001',
  identity: {
    cardId: 'test-api-001',
    nameFr: 'Carte Test API',
    nameEn: 'API Test Card',
    setId: 'test',
    setName: 'Test Set',
    localId: '001',
    category: 'TRAINER',
    subCategory: 'ITEM',
    isRuleBox: false,
    prizeCardsGiven: 0,
    isAceSpec: false,
    isAncient: false,
    isFuture: false,
    isTera: false,
    regulationMark: 'H',
    legalStandard: true,
    legalExpanded: true,
    rarity: 'Peu Commune',
    imageUrl: null,
    rawRulesText: ['Piochez 1 carte.'],
  },
  pokemonStats: null,
  category: 'TRAINER',
  subCategory: 'ITEM',
  playableActions: [
    {
      actionId: 'draw_one',
      label: 'Piocher 1',
      actionType: 'PLAY_TRAINER_ITEM',
      sourceType: 'TRAINER_CARD',
      effects: [{ primitive: 'DRAW_CARDS', count: 1, target: 'SELF' }],
    },
  ],
  strategicEvaluator: {
    aiRole: 'CONSISTENCY_DRAW',
    primaryRole: 'CONSISTENCY_DRAW',
    intrinsicBaseScore: 55,
  },
}

function createJsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('apiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete UNIFIED_CARD_REGISTRY['test-api-001']
    delete CARD_ID_ALIASES['legacy-alias-001']
    delete CARD_ID_ALIASES['test-key-1']
  })

  it('fetchMetaDecks parses decks and hydrates UNIFIED_CARD_REGISTRY', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      createJsonResponse([
        {
          id: 42,
          name: 'Lanssorien ex API',
          archetype: 'Dragapult',
          totalCards: 4,
          cards: [{ cardId: 'test-api-001', count: 4, data: SAMPLE_RAW_CARD }],
        },
      ]),
    )

    const decks = await fetchMetaDecks()
    expect(fetchMock).toHaveBeenCalledWith('/api/decks/meta', expect.objectContaining({ method: 'GET' }))
    expect(decks).toHaveLength(1)
    expect(decks[0]!.name).toBe('Lanssorien ex API')
    expect(decks[0]!.cards[0]!.model.cardId).toBe('test-api-001')
    expect(UNIFIED_CARD_REGISTRY['test-api-001']?.identity.nameFr).toBe('Carte Test API')
  })

  it('searchCatalogCards encodes params and registers returned card models', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        items: [SAMPLE_RAW_CARD],
        total: 1,
        limit: 15,
        offset: 0,
      }),
    )

    const res = await searchCatalogCards({ q: 'Carte Test', category: 'TRAINER', limit: 15 })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cards?q=Carte+Test&category=TRAINER&limit=15',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(res.total).toBe(1)
    expect(res.items[0]!.cardId).toBe('test-api-001')
    expect(UNIFIED_CARD_REGISTRY['test-api-001']).toBeDefined()
  })

  it('resolveCardsFromApi registers canonical model and alias mappings', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      createJsonResponse({
        resolved: {
          'test-key-1': {
            matchedBy: 'alias_id',
            card: SAMPLE_RAW_CARD,
          },
        },
        unresolved: ['missing-key'],
      }),
    )

    const res = await resolveCardsFromApi([
      { key: 'test-key-1', candidateIds: ['legacy-alias-001'], name: 'Carte Test API' },
      { key: 'missing-key', candidateIds: ['xxx-999'], name: 'Unknown Card' },
    ])

    expect(fetchMock).toHaveBeenCalledWith('/api/cards/resolve', expect.objectContaining({ method: 'POST' }))
    expect(res.resolved['test-key-1']?.card.cardId).toBe('test-api-001')
    expect(res.unresolved).toEqual(['missing-key'])
    expect(CARD_ID_ALIASES['legacy-alias-001']).toBe('test-api-001')
    expect(CARD_ID_ALIASES['test-key-1']).toBe('test-api-001')
  })

  it('fetchCardsBatch and fetchAlternativesFromApi hydrate returned models into catalog', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(createJsonResponse({ 'test-api-001': SAMPLE_RAW_CARD }))
      .mockResolvedValueOnce(
        createJsonResponse({
          results: {
            'sv01-181': [
              {
                targetCardId: 'sv01-181',
                targetCardNameFr: 'Faiblo Ball',
                alternativeModel: SAMPLE_RAW_CARD,
                alternativeCardId: 'test-api-001',
                alternativeNameFr: 'Carte Test API',
                alternativeCategory: 'TRAINER',
                alternativeSubCategory: 'ITEM',
                suggestionType: 'FUNCTIONAL_EQUIVALENT',
                sharedPrimitives: ['DRAW_CARDS'],
                actionEconomyBadge: 'Même tempo (Objet)',
                strategicReason: 'Alternative de test',
                relevanceScore: 88,
              },
            ],
          },
        }),
      )

    const batch = await fetchCardsBatch(['test-api-001'])
    expect(batch['test-api-001']?.cardId).toBe('test-api-001')

    const alts = await fetchAlternativesFromApi({ cardIds: ['sv01-181'], limitPerCard: 10 })
    expect(alts['sv01-181']).toHaveLength(1)
    expect(alts['sv01-181']![0]!.alternativeModel.cardId).toBe('test-api-001')
    expect(UNIFIED_CARD_REGISTRY['test-api-001']).toBeDefined()
  })

  it('submitBugReport handles 201 success and throws typed ApiError on 429 rate limit', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(createJsonResponse({ success: true, reportId: 7, issueUrl: 'https://github.com/org/repo/issues/7' }, 201))
      .mockResolvedValueOnce(
        createJsonResponse(
          { error: 'Too Many Requests', message: 'Trop de signalements', retryAfterSeconds: 1200 },
          429,
          { 'Retry-After': '1200' },
        ),
      )

    const ok = await submitBugReport({ type: 'CARD_MODEL_ERROR', cardId: 'sv03-125', userComment: 'Test bug' })
    expect(ok).toEqual({ success: true, reportId: 7, issueUrl: 'https://github.com/org/repo/issues/7' })

    try {
      await submitBugReport({ type: 'ENGINE_RULE_ERROR', matchLogs: { seed: 42 }, userComment: 'Bug règle' })
      expect.unreachable('Expected ApiError to be thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(429)
      expect(apiErr.retryAfterSeconds).toBe(1200)
      expect(apiErr.message).toContain('Trop de signalements')
    }
  })
})
