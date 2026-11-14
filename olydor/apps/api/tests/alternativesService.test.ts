import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import {
  AlternativesService,
  CardCatalogCache,
  type EngineCardModel,
  extractAttackerComparisonRow,
  findAlternativesForCard,
} from '../src/services/alternativesService.js'

function makeCard(overrides: Partial<EngineCardModel> & { cardId: string; nameFr: string }): EngineCardModel {
  const category = overrides.category ?? 'TRAINER'
  const subCategory = overrides.subCategory ?? 'ITEM'
  return {
    cardId: overrides.cardId,
    identity: {
      cardId: overrides.cardId,
      nameFr: overrides.nameFr,
      setId: 'sv01',
      category,
      subCategory,
      prizeCardsGiven: category === 'POKEMON' ? 1 : 0,
      ...(overrides.identity ?? {}),
    },
    pokemonStats: overrides.pokemonStats ?? null,
    category,
    subCategory,
    playableActions: overrides.playableActions ?? [],
    strategicEvaluator: {
      aiRole: 'CONSISTENCY_BOOSTER',
      ...(overrides.strategicEvaluator ?? {}),
    },
  }
}

const basicEnergy = makeCard({
  cardId: 'sve-002',
  nameFr: 'Énergie Feu de base',
  category: 'ENERGY',
  subCategory: 'BASIC_ENERGY',
})

const pepperSupporter = makeCard({
  cardId: 'sv01-166',
  nameFr: 'Pepper',
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
})

const nestBallItem = makeCard({
  cardId: 'sv01-181',
  nameFr: 'Faiblo Ball',
  category: 'TRAINER',
  subCategory: 'ITEM',
  playableActions: [
    {
      actionId: 'play_nest_ball',
      label: 'Faiblo Ball',
      actionType: 'PLAY_ITEM',
      effects: [{ primitive: 'SEARCH_DECK' }],
    },
  ],
})

const pidgeotAbility = makeCard({
  cardId: 'sv03-164',
  nameFr: 'Roucarnage-ex',
  category: 'POKEMON',
  subCategory: 'STAGE_2',
  identity: {
    cardId: 'sv03-164',
    nameFr: 'Roucarnage-ex',
    setId: 'sv03',
    category: 'POKEMON',
    subCategory: 'STAGE_2',
    prizeCardsGiven: 2,
  },
  pokemonStats: {
    hp: 280,
    types: ['Colorless'],
    evolutionChain: ['Roucool', 'Roucoups', 'Roucarnage-ex'],
    retreatCost: 0,
  },
  strategicEvaluator: { aiRole: 'CONSISTENCY_BOOSTER' },
  playableActions: [
    {
      actionId: 'ability_quick_search',
      label: 'Recherche Rapide',
      actionType: 'USE_ABILITY',
      effects: [{ primitive: 'SEARCH_DECK' }],
    },
    {
      actionId: 'attack_blustery_wind',
      label: 'Vent Violent',
      actionType: 'ATTACK',
      cost: { Colorless: 2 },
      effects: [{ primitive: 'DAMAGE_ACTIVE', value: 120 }],
    },
  ],
})

const charizardMain = makeCard({
  cardId: 'sv03-125',
  nameFr: 'Dracaufeu-ex',
  category: 'POKEMON',
  subCategory: 'STAGE_2',
  identity: {
    cardId: 'sv03-125',
    nameFr: 'Dracaufeu-ex',
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
  strategicEvaluator: { aiRole: 'MAIN_ATTACKER' },
  playableActions: [
    {
      actionId: 'ability_infernal_reign',
      label: 'Règne Infernal',
      actionType: 'USE_ABILITY',
      effects: [{ primitive: 'ATTACH_ENERGY' }, { primitive: 'SEARCH_DECK' }],
    },
    {
      actionId: 'attack_burning_darkness',
      label: 'Obscurité Brûlante',
      actionType: 'ATTACK',
      cost: { Fire: 2 },
      effects: [
        { primitive: 'DAMAGE_ACTIVE', value: 180, damageScalingPerOpponentPrizeTaken: 30 },
      ],
    },
  ],
})

const charmanderPreEvo = makeCard({
  cardId: 'sv03-026',
  nameFr: 'Salamèche',
  category: 'POKEMON',
  subCategory: 'BASIC',
  pokemonStats: {
    hp: 70,
    types: ['Fire'],
    evolutionChain: ['Salamèche', 'Reptincel', 'Dracaufeu-ex'],
    retreatCost: 1,
  },
  strategicEvaluator: { aiRole: 'CONSISTENCY_BOOSTER' },
  playableActions: [
    {
      actionId: 'attack_ember',
      label: 'Flammèche',
      actionType: 'ATTACK',
      cost: { Fire: 1 },
      effects: [{ primitive: 'DAMAGE_ACTIVE', value: 30 }],
    },
  ],
})

const secondaryAttacker = makeCard({
  cardId: 'sv04-110',
  nameFr: 'Fulgulairo-ex',
  category: 'POKEMON',
  subCategory: 'BASIC',
  identity: {
    cardId: 'sv04-110',
    nameFr: 'Fulgulairo-ex',
    setId: 'sv04',
    category: 'POKEMON',
    subCategory: 'BASIC',
    prizeCardsGiven: 2,
  },
  pokemonStats: {
    hp: 220,
    types: ['Lightning'],
    evolutionChain: ['Fulgulairo-ex'],
    retreatCost: 1,
  },
  strategicEvaluator: { aiRole: 'SECONDARY_ATTACKER' },
  playableActions: [
    {
      actionId: 'attack_volt',
      label: 'Éclair Brutal',
      actionType: 'ATTACK',
      cost: { Lightning: 2, Colorless: 1 },
      effects: [{ primitive: 'DAMAGE_ACTIVE', value: 160 }],
    },
  ],
})

const doubleAttacker = makeCard({
  cardId: 'sv06-018',
  nameFr: 'Pomdramour',
  category: 'POKEMON',
  subCategory: 'STAGE_1',
  pokemonStats: {
    hp: 90,
    types: ['Grass'],
    evolutionChain: ['Verpom', 'Pomdramour'],
    retreatCost: 2,
    canAttackTwice: true,
  },
  strategicEvaluator: { aiRole: 'SECONDARY_ATTACKER' },
  playableActions: [
    {
      actionId: 'attack_do_the_wave',
      label: 'Festival Frénétique',
      actionType: 'ATTACK',
      cost: { Grass: 1 },
      canAttackTwice: true,
      effects: [{ primitive: 'DAMAGE_ACTIVE', value: 100 }],
    },
  ],
})

const allTestCards = [
  basicEnergy,
  pepperSupporter,
  nestBallItem,
  pidgeotAbility,
  charizardMain,
  charmanderPreEvo,
  secondaryAttacker,
  doubleAttacker,
]

describe('alternativesService', () => {
  it('ignores basic energies and never suggests alternatives for MAIN_ATTACKER or its pre-evolutions', () => {
    expect(findAlternativesForCard(basicEnergy, allTestCards)).toEqual([])
    expect(findAlternativesForCard(charizardMain, allTestCards)).toEqual([])
    expect(findAlternativesForCard(charmanderPreEvo, allTestCards)).toEqual([])
  })

  it('suggests Item and Pokemon Ability alternatives for Supporter with action economy badge and excludes MAIN_ATTACKER', () => {
    const suggestions = findAlternativesForCard(pepperSupporter, allTestCards)

    expect(suggestions.some((s) => s.alternativeCardId === charizardMain.cardId)).toBe(false)
    expect(suggestions.length).toBeGreaterThanOrEqual(2)
    expect(suggestions.every((s) => s.suggestionType === 'SUPPORTER_TO_ITEM_OR_ABILITY')).toBe(true)
    expect(suggestions[0]?.actionEconomyBadge).toContain("Gain d'Économie d'Action")
    expect(suggestions.map((s) => s.alternativeCardId)).toContain(nestBallItem.cardId)
    expect(suggestions.map((s) => s.alternativeCardId)).toContain(pidgeotAbility.cardId)
  })

  it('finds functional equivalents for Trainer Items while excluding Supporters', () => {
    const ultraBall = makeCard({
      cardId: 'sv01-196',
      nameFr: 'Hyper Ball',
      category: 'TRAINER',
      subCategory: 'ITEM',
      playableActions: [
        {
          actionId: 'play_ultra_ball',
          label: 'Hyper Ball',
          actionType: 'PLAY_ITEM',
          effects: [{ primitive: 'PUT_ON_TOP_OR_BOTTOM_OF_DECK' }],
        },
      ],
    })

    const suggestions = findAlternativesForCard(ultraBall, allTestCards)
    expect(suggestions.some((s) => s.alternativeSubCategory === 'SUPPORTER')).toBe(false)
    expect(suggestions.every((s) => s.suggestionType === 'FUNCTIONAL_EQUIVALENT')).toBe(true)
    // PUT_ON_TOP_OR_BOTTOM_OF_DECK is tutor-compatible with SEARCH_DECK
    expect(suggestions.map((s) => s.alternativeCardId)).toContain(nestBallItem.cardId)
  })

  it('extracts attackerComparison stats including double attack bounds', () => {
    const row = extractAttackerComparisonRow(doubleAttacker)
    expect(row).toMatchObject({
      cardId: 'sv06-018',
      hp: 90,
      energyCostCount: 1,
      baseDamage: 100,
      estimatedMaxDamage: 200,
      damageSummary: '100 ×2 (200 max)',
      canAttackTwice: true,
    })

    const altSuggestions = findAlternativesForCard(secondaryAttacker, allTestCards)
    expect(altSuggestions.every((s) => s.suggestionType === 'ALTERNATIVE_ATTACKER')).toBe(true)
    expect(altSuggestions[0]?.attackerComparison).toBeDefined()
  })

  it('respects excludeCardIds and limitPerCard while using CardCatalogCache efficiently', async () => {
    let clock = 1000
    const queryMock = vi.fn(async () => ({
      rows: allTestCards.map((card) => ({ card_id: card.cardId, data: card })),
    }))
    const mockPool = { query: queryMock } as unknown as Pool

    const cache = new CardCatalogCache({
      pool: mockPool,
      ttlMs: 60_000,
      now: () => clock,
    })
    const service = new AlternativesService(cache)

    // Concurrent calls should deduplicate into a single DB query
    const [res1, res2] = await Promise.all([
      service.findAlternativesForCards({
        cardIds: [pepperSupporter.cardId, 'unknown-999'],
        excludeCardIds: [pidgeotAbility.cardId],
        limitPerCard: 1,
      }),
      service.findAlternativesForCards({
        cardIds: [pepperSupporter.cardId],
      }),
    ])

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(res1[pepperSupporter.cardId]).toHaveLength(1)
    expect(res1[pepperSupporter.cardId]?.[0]?.alternativeCardId).toBe(nestBallItem.cardId)
    expect(res1['unknown-999']).toEqual([])
    expect(res2[pepperSupporter.cardId]?.length).toBeGreaterThanOrEqual(2)

    // Advance clock past TTL and invalidate check
    clock += 61_000
    await service.findAlternativesForCards({ cardIds: [pepperSupporter.cardId] })
    expect(queryMock).toHaveBeenCalledTimes(2)

    cache.invalidate()
    await service.findAlternativesForCards({ cardIds: [pepperSupporter.cardId] })
    expect(queryMock).toHaveBeenCalledTimes(3)
  })
})
