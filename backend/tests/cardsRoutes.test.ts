import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { buildServer } from '../src/server.js'
import type { EngineCardModel } from '../src/services/alternativesService.js'

const sampleCards: Array<{
  card_id: string
  name_fr: string
  name_en: string
  set_id: string
  data: EngineCardModel
}> = [
  {
    card_id: 'sv03-125',
    name_fr: 'Dracaufeu-ex',
    name_en: 'Charizard ex',
    set_id: 'sv03',
    data: {
      cardId: 'sv03-125',
      identity: {
        cardId: 'sv03-125',
        nameFr: 'Dracaufeu-ex',
        nameEn: 'Charizard ex',
        setId: 'sv03',
        category: 'POKEMON',
        subCategory: 'STAGE_2',
        prizeCardsGiven: 2,
      },
      pokemonStats: {
        hp: 330,
        types: ['Darkness'],
        evolutionChain: ['Salamèche', 'Reptincel', 'Dracaufeu-ex'],
        retreatCost: 2,
      },
      category: 'POKEMON',
      subCategory: 'STAGE_2',
      playableActions: [
        {
          actionId: 'attack_1',
          label: 'Obscurité Brûlante',
          actionType: 'ATTACK',
          cost: { Fire: 2 },
          effects: [{ primitive: 'DAMAGE_ACTIVE', value: 180 }],
        },
      ],
      strategicEvaluator: { aiRole: 'MAIN_ATTACKER' },
    },
  },
  {
    card_id: 'sv04-125',
    name_fr: 'Super Bonbon',
    name_en: 'Rare Candy',
    set_id: 'sv04',
    data: {
      cardId: 'sv04-125',
      identity: {
        cardId: 'sv04-125',
        nameFr: 'Super Bonbon',
        nameEn: 'Rare Candy',
        setId: 'sv04',
        category: 'TRAINER',
        subCategory: 'ITEM',
      },
      pokemonStats: null,
      category: 'TRAINER',
      subCategory: 'ITEM',
      playableActions: [
        {
          actionId: 'play_candy',
          label: 'Super Bonbon',
          actionType: 'PLAY_ITEM',
          effects: [{ primitive: 'SEARCH_DECK' }],
        },
      ],
      strategicEvaluator: { aiRole: 'CONSISTENCY_BOOSTER' },
    },
  },
  {
    card_id: 'sv01-166',
    name_fr: 'Pepper',
    name_en: 'Arven',
    set_id: 'sv01',
    data: {
      cardId: 'sv01-166',
      identity: {
        cardId: 'sv01-166',
        nameFr: 'Pepper',
        nameEn: 'Arven',
        setId: 'sv01',
        category: 'TRAINER',
        subCategory: 'SUPPORTER',
      },
      pokemonStats: null,
      category: 'TRAINER',
      subCategory: 'SUPPORTER',
      playableActions: [
        {
          actionId: 'play_pepper',
          label: 'Pepper',
          actionType: 'PLAY_SUPPORTER',
          effects: [{ primitive: 'SEARCH_DECK' }],
        },
      ],
      strategicEvaluator: { aiRole: 'CONSISTENCY_BOOSTER' },
    },
  },
  {
    card_id: 'me02.5-142',
    name_fr: 'Favianos-ex',
    name_en: 'Fezandipiti ex',
    set_id: 'me02.5',
    data: {
      cardId: 'me02.5-142',
      identity: {
        cardId: 'me02.5-142',
        nameFr: 'Favianos-ex',
        nameEn: 'Fezandipiti ex',
        setId: 'me02.5',
        category: 'POKEMON',
        subCategory: 'BASIC',
        prizeCardsGiven: 2,
      },
      pokemonStats: {
        hp: 210,
        types: ['Darkness'],
        evolutionChain: ['Favianos-ex'],
        retreatCost: 1,
      },
      category: 'POKEMON',
      subCategory: 'BASIC',
      playableActions: [
        {
          actionId: 'ability_flip',
          label: 'Pivot Chanceux',
          actionType: 'USE_ABILITY',
          effects: [{ primitive: 'DRAW_CARDS', count: 3 }],
        },
      ],
      strategicEvaluator: { aiRole: 'DRAW_ENGINE' },
    },
  },
  {
    card_id: 'sv06.5-038',
    name_fr: 'Favianos-ex',
    name_en: 'Fezandipiti ex',
    set_id: 'sv06.5',
    data: {
      cardId: 'sv06.5-038',
      identity: {
        cardId: 'sv06.5-038',
        nameFr: 'Favianos-ex',
        nameEn: 'Fezandipiti ex',
        setId: 'sv06.5',
        category: 'POKEMON',
        subCategory: 'BASIC',
        prizeCardsGiven: 2,
      },
      pokemonStats: {
        hp: 210,
        types: ['Darkness'],
        evolutionChain: ['Favianos-ex'],
        retreatCost: 1,
      },
      category: 'POKEMON',
      subCategory: 'BASIC',
      playableActions: [
        {
          actionId: 'ability_flip',
          label: 'Pivot Chanceux',
          actionType: 'USE_ABILITY',
          effects: [{ primitive: 'DRAW_CARDS', count: 3 }],
        },
      ],
      strategicEvaluator: { aiRole: 'DRAW_ENGINE' },
    },
  },
  {
    card_id: 'sv02-177',
    name_fr: 'Ligue Pokémon',
    name_en: 'Pokemon League',
    set_id: 'sv02',
    data: {
      cardId: 'sv02-177',
      identity: {
        cardId: 'sv02-177',
        nameFr: 'Ligue Pokémon',
        nameEn: 'Pokemon League',
        setId: 'sv02',
        category: 'TRAINER',
        subCategory: 'STADIUM',
      },
      pokemonStats: null,
      category: 'TRAINER',
      subCategory: 'STADIUM',
      playableActions: [
        {
          actionId: 'play_stadium',
          label: 'Stade',
          actionType: 'PLAY_STADIUM',
          effects: [{ primitive: 'SEARCH_DECK' }],
        },
      ],
      strategicEvaluator: { aiRole: 'CONSISTENCY_BOOSTER' },
    },
  },
]

function createCardsMockPool() {
  const queries: Array<{ sql: string; params?: unknown[] }> = []

  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params })

      // Catalog load for AlternativesService
      if (sql.trim() === 'SELECT card_id, data FROM cards') {
        return { rows: sampleCards.map((c) => ({ card_id: c.card_id, data: c.data })) }
      }

      // Direct card_id lookup (batch & resolve step 1/2)
      if (sql.includes('SELECT card_id, data FROM cards WHERE card_id = ANY($1)')) {
        const ids = (params?.[0] as string[]) ?? []
        return {
          rows: sampleCards
            .filter((c) => ids.includes(c.card_id))
            .map((c) => ({ card_id: c.card_id, data: c.data })),
        }
      }

      // Name fallback lookup (resolve step 3)
      if (sql.includes('SELECT card_id, name_fr, name_en, data')) {
        const synonymIds = (params?.[0] as string[]) ?? []
        const normNames = (params?.[1] as string[]) ?? []
        return {
          rows: sampleCards.filter((c) => {
            if (synonymIds.includes(c.card_id)) return true
            const normFr = c.name_fr
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/['’-]/g, ' ')
            const normEn = c.name_en.toLowerCase()
            return normNames.includes(normFr) || normNames.includes(normEn)
          }),
        }
      }

      // GET /api/cards COUNT
      if (sql.startsWith('SELECT COUNT(*)::int AS total FROM cards')) {
        return { rows: [{ total: 12 }] }
      }

      // GET /api/cards paginated items
      if (sql.startsWith('SELECT data FROM cards')) {
        return {
          rows: sampleCards.slice(0, 2).map((c) => ({ data: c.data })),
        }
      }

      return { rows: [] }
    }),
  } as unknown as Pool

  return { pool, queries }
}

describe('Cards API routes', () => {
  it('GET /api/cards validates query params and executes paginated SQL with exact/prefix ordering', async () => {
    const { pool, queries } = createCardsMockPool()
    const app = await buildServer({ pool, logger: false })

    const res = await app.inject({
      method: 'GET',
      url: '/api/cards?q=%20Dracauf%C3%A9u%20&category=POKEMON&subCategory=STAGE_2&limit=10&offset=5',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(12)
    expect(body.limit).toBe(10)
    expect(body.offset).toBe(5)
    expect(body.items).toHaveLength(2)

    const countQuery = queries.find((q) => q.sql.startsWith('SELECT COUNT(*)::int AS total'))
    expect(countQuery?.params).toEqual(['POKEMON', 'STAGE_2', '%dracaufeu%'])

    const listQuery = queries.find((q) => q.sql.startsWith('SELECT data FROM cards'))
    expect(listQuery?.sql).toContain('ORDER BY')
    expect(listQuery?.params).toEqual(['POKEMON', 'STAGE_2', '%dracaufeu%', 'dracaufeu', 'dracaufeu%', 10, 5])

    const invalidLimit = await app.inject({
      method: 'GET',
      url: '/api/cards?limit=100',
    })
    expect(invalidLimit.statusCode).toBe(400)

    const invalidCategory = await app.inject({
      method: 'GET',
      url: '/api/cards?category=INVALID',
    })
    expect(invalidCategory.statusCode).toBe(400)

    await app.close()
  })

  it('POST /api/cards/batch accepts up to 300 cardIds and rejects >300', async () => {
    const { pool } = createCardsMockPool()
    const app = await buildServer({ pool, logger: false })

    const ids250 = Array.from({ length: 250 }, (_, idx) => (idx === 0 ? 'sv03-125' : `fake-${idx}`))
    const okRes = await app.inject({
      method: 'POST',
      url: '/api/cards/batch',
      payload: { cardIds: ids250 },
    })
    expect(okRes.statusCode).toBe(200)
    expect(okRes.json()['sv03-125']).toBeDefined()

    const ids301 = Array.from({ length: 301 }, (_, idx) => `id-${idx}`)
    const badRes = await app.inject({
      method: 'POST',
      url: '/api/cards/batch',
      payload: { cardIds: ids301 },
    })
    expect(badRes.statusCode).toBe(400)

    await app.close()
  })

  it('POST /api/cards/resolve (Mode A) prioritizes direct card_id before alias_id, falls back to name/synonyms, and lists unresolved', async () => {
    const { pool } = createCardsMockPool()
    const app = await buildServer({ pool, logger: false })

    const res = await app.inject({
      method: 'POST',
      url: '/api/cards/resolve',
      payload: {
        items: [
          // Exists directly in DB (must match card_id even though me02.5-142 is in CARD_ID_ALIASES)
          { key: 'direct-fez', candidateIds: ['me02.5-142'], name: 'Favianos ex' },
          // Reprint mapped via CARD_ID_ALIASES (sv01-191 -> sv04-125)
          { key: 'alias-candy', candidateIds: ['sv01-191'], name: 'Super Bonbon' },
          // Fallback via normalized name / accent folding
          { key: 'name-league', candidateIds: ['unknown-99'], name: 'Ligue Pokemon' },
          // Fallback via NAME_SYNONYMS ("arven" -> sv01-166 Pepper)
          { key: 'synonym-arven', candidateIds: ['sv99-999'], name: 'Arven' },
          // Truly missing
          { key: 'missing-card', candidateIds: ['missing-001'], name: 'Non Existent Card' },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.resolved['direct-fez'].matchedBy).toBe('card_id')
    expect(body.resolved['direct-fez'].card.cardId).toBe('me02.5-142')

    expect(body.resolved['alias-candy'].matchedBy).toBe('alias_id')
    expect(body.resolved['alias-candy'].card.cardId).toBe('sv04-125')

    expect(body.resolved['name-league'].matchedBy).toBe('name')
    expect(body.resolved['name-league'].card.cardId).toBe('sv02-177')

    expect(body.resolved['synonym-arven'].matchedBy).toBe('name')
    expect(body.resolved['synonym-arven'].card.cardId).toBe('sv01-166')

    expect(body.unresolved).toEqual(['missing-card'])

    await app.close()
  })

  it('POST /api/cards/resolve (Mode B) parses raw ptcglText and resolves cards', async () => {
    const { pool } = createCardsMockPool()
    const app = await buildServer({ pool, logger: false })

    const res = await app.inject({
      method: 'POST',
      url: '/api/cards/resolve',
      payload: {
        ptcglText: [
          'Pokémon: 1',
          '2 Dracaufeu-ex OBF 125',
          'Trainers: 2',
          '3 Rare Candy SVI 191',
          '1 Mystery Card OBF 999',
        ].join('\n'),
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.resolved['sv03-125']?.matchedBy).toBe('card_id')
    expect(body.resolved['sv01-191']?.matchedBy).toBe('alias_id')
    expect(body.resolved['sv01-191']?.card.cardId).toBe('sv04-125')
    expect(body.unresolved).toEqual(['sv03-999'])

    await app.close()
  })

  it('POST /api/cards/alternatives computes suggestions, uses server cache across requests, and supports gzip compression', async () => {
    const { pool, queries } = createCardsMockPool()
    const app = await buildServer({ pool, logger: false })

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/cards/alternatives',
      headers: {
        'accept-encoding': 'gzip',
      },
      payload: {
        cardIds: ['sv01-166', 'sv03-125'],
        limitPerCard: 5,
      },
    })

    expect(res1.statusCode).toBe(200)
    const json1 = res1.json()
    // Pepper (SUPPORTER) should receive Super Bonbon (ITEM) as economy upgrade
    expect(json1.results['sv01-166']).toHaveLength(1)
    expect(json1.results['sv01-166'][0]).toMatchObject({
      alternativeCardId: 'sv04-125',
      suggestionType: 'SUPPORTER_TO_ITEM_OR_ABILITY',
    })
    // Charizard (MAIN_ATTACKER) should have no alternatives
    expect(json1.results['sv03-125']).toEqual([])

    // Second request must reuse in-memory catalog cache (still only 1 SELECT card_id, data FROM cards)
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/cards/alternatives',
      payload: {
        cardIds: ['sv01-166'],
      },
    })
    expect(res2.statusCode).toBe(200)
    const catalogQueries = queries.filter((q) => q.sql.trim() === 'SELECT card_id, data FROM cards')
    expect(catalogQueries).toHaveLength(1)

    // Large payload (> 1024 bytes) with Accept-Encoding: gzip should return gzipped content
    const largeBatch = await app.inject({
      method: 'POST',
      url: '/api/cards/batch',
      headers: {
        'accept-encoding': 'gzip',
      },
      payload: {
        cardIds: ['sv03-125', 'sv04-125', 'sv01-166', 'me02.5-142', 'sv06.5-038', 'sv02-177'],
      },
    })
    expect(largeBatch.statusCode).toBe(200)
    expect(largeBatch.headers['content-encoding']).toBe('gzip')

    await app.close()
  })
})
