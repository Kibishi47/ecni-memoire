import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNIFIED_CARD_REGISTRY, CARD_ID_ALIASES } from '../data/cardCatalog'
import { mapApiMetaDecks } from './metaDeckAdapter'
import { parsePtcglDecklist, parsePtcglDecklistWithApi } from '../utils/ptcglParser'
import type { ApiMetaDeck } from './apiClient'

const CUSTOM_API_CARD = {
  cardId: 'sv99-010',
  identity: {
    cardId: 'sv99-010',
    nameFr: 'Pikachu Test API',
    nameEn: 'API Pikachu',
    setId: 'sv99',
    setName: 'Test Expansion',
    localId: '010',
    category: 'POKEMON',
    subCategory: 'BASIC',
    isRuleBox: false,
    prizeCardsGiven: 1,
    isAceSpec: false,
    isAncient: false,
    isFuture: false,
    isTera: false,
    regulationMark: 'H',
    legalStandard: true,
    legalExpanded: true,
    rarity: 'Commune',
    imageUrl: null,
    rawRulesText: [],
  },
  pokemonStats: {
    hp: 70,
    types: ['Électrique'],
    stage: 'De base',
    evolvesFrom: null,
    rootBasicName: 'Pikachu Test API',
    evolutionChain: ['Pikachu Test API'],
    retreatCost: 1,
    weaknesses: [{ type: 'Combat', value: 'x2' }],
    resistances: [],
    prizeCardsGiven: 1,
    isRuleBox: false,
  },
  category: 'POKEMON',
  subCategory: 'BASIC',
  playableActions: [],
  strategicEvaluator: {
    aiRole: 'SECONDARY_ATTACKER',
    primaryRole: 'SECONDARY_ATTACKER',
    intrinsicBaseScore: 45,
  },
}

describe('metaDeckAdapter & async PTCGL resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete UNIFIED_CARD_REGISTRY['sv99-010']
    delete CARD_ID_ALIASES['sv99-010']
    delete CARD_ID_ALIASES['sv99-10']
  })

  it('maps API meta decks into MetaOpponentDeck UI objects and flat OpponentDeckDescriptor payloads', () => {
    const sampleCard = UNIFIED_CARD_REGISTRY['sv03-125']!
    const apiDecks: ApiMetaDeck[] = [
      {
        id: 7,
        name: 'Dragapult / Dusknoir',
        archetype: 'Lanssorien',
        totalCards: 4,
        cards: [
          { cardId: sampleCard.cardId, count: 4, model: sampleCard },
        ],
      },
    ]

    const mapped = mapApiMetaDecks(apiDecks)
    expect(mapped).toHaveLength(1)
    expect(mapped[0]!.metaDeck.id).toBe('meta_api_7')
    expect(mapped[0]!.metaDeck.archetypeBadge).toBe('Lanssorien')
    expect(mapped[0]!.metaDeck.badgeColor).toBe('purple')
    expect(mapped[0]!.metaDeck.keyThreats).toContain(sampleCard.identity.nameFr)
    expect(mapped[0]!.descriptor.models).toHaveLength(4)
    expect(mapped[0]!.descriptor.id).toBe('meta_api_7')
  })

  it('parsePtcglDecklistWithApi resolves unknown cards via POST /api/cards/resolve before full parse', async () => {
    const deckText = `Pokémon: 4
4 API Pikachu SV99 10

Energy: 56
56 Lightning Energy SVE 4`

    const syncBefore = parsePtcglDecklist(deckText)
    expect(syncBefore.isFullyResolved).toBe(false)
    expect(syncBefore.unresolvedCount).toBe(4)

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resolved: {
            'sv99-010': {
              matchedBy: 'card_id',
              card: CUSTOM_API_CARD,
            },
          },
          unresolved: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const resolvedDeck = await parsePtcglDecklistWithApi(deckText)
    expect(fetchMock).toHaveBeenCalledWith('/api/cards/resolve', expect.objectContaining({ method: 'POST' }))
    expect(resolvedDeck.isFullyResolved).toBe(true)
    expect(resolvedDeck.isValid60).toBe(true)
    expect(resolvedDeck.unresolvedCount).toBe(0)
    expect(resolvedDeck.pokemonCount).toBe(4)
  })
})
