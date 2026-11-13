import { describe, expect, it } from 'vitest'
import {
  buildHumanReadableAiBreakdown,
  extractCleanAiTranscriptions,
  formatHumanCardFilter,
  getHumanReadableActionType,
  getHumanReadableAiRole,
  getHumanReadableEffectDetails,
  getHumanReadablePrecondition,
  getHumanReadablePrimitive,
  stripNullAndEmpty,
} from './debugModelHelper'
import type { AtomicEffect, EngineCardModel } from '../types/cardModel'

describe('debugModelHelper — AI Model Clean Extraction & Human-Readable Formatting', () => {
  it('stripNullAndEmpty recursively eliminates nulls, undefined, empty strings, and empty structures', () => {
    const dirty = {
      keepMe: 'hello',
      emptyStr: '   ',
      nullVal: null,
      undefVal: undefined,
      nested: {
        numberVal: 42,
        nestedNull: null,
        emptyArr: [],
      },
      arrayWithNulls: [1, null, 'two', undefined, ''],
      emptyObj: {
        onlyNull: null,
      },
    }

    const cleaned = stripNullAndEmpty(dirty)
    expect(cleaned).toEqual({
      keepMe: 'hello',
      nested: {
        numberVal: 42,
      },
      arrayWithNulls: [1, 'two'],
    })
  })

  it('translates AI strategic roles cleanly in FR and EN', () => {
    expect(getHumanReadableAiRole('MAIN_ATTACKER', 'fr')).toBe('Attaquant Principal')
    expect(getHumanReadableAiRole('MAIN_ATTACKER', 'en')).toBe('Main Attacker')
    expect(getHumanReadableAiRole('DRAW_ENGINE', 'fr')).toBe('Moteur de Pioche')
    expect(getHumanReadableAiRole('DRAW_ENGINE', 'en')).toBe('Draw Engine')
    expect(getHumanReadableAiRole('DISRUPTION', 'fr')).toBe('Perturbation & Contrôle')
  })

  it('translates action types and timing phases', () => {
    expect(getHumanReadableActionType('ATTACK', 'fr')).toBe('Attaque')
    expect(getHumanReadableActionType('ATTACK', 'en')).toBe('Attack')
    expect(getHumanReadableActionType('USE_ABILITY', 'fr')).toBe('Talent')
    expect(getHumanReadableActionType('USE_ABILITY', 'en')).toBe('Ability')
  })

  it('translates engine preconditions into clear player sentences', () => {
    expect(getHumanReadablePrecondition('SELF_IS_ACTIVE', 'fr')).toBe('Doit être le Pokémon Actif')
    expect(getHumanReadablePrecondition('SELF_IS_ACTIVE', 'en')).toBe('Must be the Active Pokémon')
    expect(getHumanReadablePrecondition('BENCH_HAS_EMPTY_SLOT', 'fr')).toBe('Le banc doit avoir une place libre')
    expect(getHumanReadablePrecondition('ATTACHED_ENERGY_COUNT:2:Fire', 'fr')).toBe('Requiert 2 Énergie(s) Fire attachée(s)')
  })

  it('translates primitive effects and details without null keys', () => {
    expect(getHumanReadablePrimitive('DAMAGE_ACTIVE', 'fr')).toBe('Dégâts au Pokémon Actif')
    expect(getHumanReadablePrimitive('DAMAGE_ACTIVE', 'en')).toBe('Damage Active Pokémon')

    const effect: AtomicEffect = {
      primitive: 'DAMAGE_ACTIVE',
      value: 120,
      baseDamage: 120,
      target: 'OPPONENT_ACTIVE',
      count: null,
      zone: null,
      filter: null,
      upTo: false,
      optional: false,
    }

    const details = getHumanReadableEffectDetails(effect, 'fr')
    expect(details).toEqual([
      { label: 'Dégâts de base', value: '120' },
      { label: 'Cible', value: 'Pokémon Actif Adverse' },
    ])
  })

  it('extractCleanAiTranscriptions extracts only AI data and strips all nulls', () => {
    const mockModel: EngineCardModel = {
      cardId: 'test_card',
      category: 'POKEMON',
      subCategory: 'STAGE_1',
      identity: {
        cardId: 'test_card',
        nameFr: 'Dracaufeu',
        nameEn: 'Charizard',
        setId: 'sv03',
        category: 'POKEMON',
        subCategory: 'STAGE_2',
        isRuleBox: true,
        prizeCardsGiven: 2,
        isAceSpec: false,
        isAncient: false,
        isFuture: false,
        isTera: true,
        legalStandard: true,
        legalExpanded: true,
      },
      pokemonStats: {
        hp: 330,
        types: ['Obscurité'],
        stage: 'Niveau 2',
        rootBasicName: 'Salameche',
        evolutionChain: ['Salameche', 'Reptincel', 'Dracaufeu'],
        retreatCost: 2,
        weaknesses: [],
        resistances: [],
      },
      strategicEvaluator: {
        aiRole: 'MAIN_ATTACKER',
        turnPhaseWeights: { turn1: 0.2, turn2: 0.8, turn3: 1, turn4Plus: 1 },
        decklistSynergyRequirements: ['rare_candy'],
      },
      playableActions: [
        {
          actionId: 'attack_0',
          label: 'Obscurité Brûlante',
          actionType: 'ATTACK',
          timingPhase: 'ATTACK_PHASE',
          canUseTurn1GoingFirst: false,
          canUseTurn1GoingSecond: false,
          cost: { Feu: 2 },
          preconditions: ['SELF_IS_ACTIVE'],
          effects: [
            {
              primitive: 'DAMAGE_ACTIVE',
              value: 180,
              baseDamage: 180,
              target: 'OPPONENT_ACTIVE',
              damageScalingType: 'PER_OPPONENT_PRIZE_TAKEN',
              damageScalingValue: 30,
              count: null,
              zone: null,
            },
          ],
          deadCardCondition: null,
        },
      ],
    }

    const cleaned = extractCleanAiTranscriptions(mockModel)
    expect(cleaned).toBeDefined()
    expect(cleaned?.cardId).toBe('test_card')
    expect(cleaned?.aiRole).toBe('MAIN_ATTACKER')
    expect(cleaned?.playableActions[0].label).toBe('Obscurité Brûlante')
    expect(cleaned?.playableActions[0].cost).toEqual({ Feu: 2 })
    expect(cleaned?.playableActions[0].effects[0].damageScalingType).toBe('PER_OPPONENT_PRIZE_TAKEN')
    expect(cleaned?.playableActions[0].deadCardCondition).toBeUndefined()
  })

  it('traduit les 29 primitives v2, ActionTypes déclenchés/passifs, cibles, zones, coinFlipMode et scalingMetric en FR et EN', () => {
    expect(getHumanReadableActionType('TRIGGERED_ABILITY', 'fr')).toBe('Talent Déclenché')
    expect(getHumanReadableActionType('PASSIVE_ABILITY', 'en')).toBe('Passive Ability')

    expect(getHumanReadablePrimitive('PLACE_DAMAGE_COUNTERS', 'fr')).toBe('Placement de Marqueurs de Dégâts')
    expect(getHumanReadablePrimitive('LOCK_ITEMS', 'en')).toBe('Lock Items (Item-Lock)')
    expect(getHumanReadablePrimitive('EXPAND_BENCH', 'fr')).toBe('Extension du Banc')

    const detailsFr = getHumanReadableEffectDetails(
      {
        primitive: 'DAMAGE_ACTIVE',
        target: 'OPPONENT_BENCH_ALL',
        value: 50,
        coinFlipMode: 'MULTI_COIN_PER_HEADS',
        coinCount: 3,
        scalingOperator: 'MULTIPLY',
        scalingMetric: 'PER_ENERGY_ON_SELF',
        bonusValue: 50,
        sourceZone: 'DECK',
        destinationZone: 'HAND',
      },
      'fr',
    )

    expect(detailsFr.some((d) => d.value.includes('Tout le Banc Adverse'))).toBe(true)
    expect(detailsFr.some((d) => d.value.includes('3 lancers'))).toBe(true)
    expect(detailsFr.some((d) => d.value.includes('×50'))).toBe(true)
    expect(detailsFr.some((d) => d.value === 'Deck')).toBe(true)
    expect(detailsFr.some((d) => d.value === 'Main')).toBe(true)
  })

  it('builds a clear non-developer AI summary without raw JSON or [object Object] leaks', () => {
    const model: EngineCardModel = {
      cardId: 'sv01-166',
      category: 'TRAINER',
      subCategory: 'ITEM',
      identity: {
        cardId: 'sv01-166',
        nameFr: 'Faiblo Ball',
        nameEn: 'Nest Ball',
        setId: 'sv01',
        category: 'TRAINER',
        subCategory: 'ITEM',
        isRuleBox: false,
        prizeCardsGiven: 1,
        isAceSpec: false,
        isAncient: false,
        isFuture: false,
        isTera: false,
        legalStandard: true,
        legalExpanded: true,
      },
      pokemonStats: null,
      strategicEvaluator: {
        aiRole: 'CONSISTENCY_BOOSTER',
        turnPhaseWeights: { turn1: 0.95, turn2: 0.7, turn3: 0.4, turn4Plus: 0.2 },
        decklistSynergyRequirements: ['requires_energy_type:Feu'],
        holdForNextTurnBonus: 0.1,
        discardPriorityWhenDead: 8,
      },
      playableActions: [
        {
          actionId: 'play_nest_ball',
          label: 'Jouer Faiblo Ball',
          actionType: 'PLAY_FROM_HAND',
          timingPhase: 'MAIN_PHASE_1',
          canUseTurn1GoingFirst: true,
          canUseTurn1GoingSecond: true,
          cost: {},
          preconditions: [
            'BENCH_HAS_EMPTY_SLOT',
            { type: 'ZONE_HAS_MATCHING_CARD', zone: 'DECK', minCount: 1, targetFilter: { subCategory: 'BASIC', maxHp: 70 } } as any,
          ],
          effects: [
            {
              primitive: 'SEARCH_DECK',
              count: 1,
              upTo: true,
              sourceZone: 'DECK',
              destinationZone: 'BENCH',
              filter: { subCategory: 'BASIC' } as any,
            },
          ],
          deadCardCondition: null,
        },
      ],
    }

    expect(formatHumanCardFilter({ subCategory: 'BASIC', maxHp: 70 }, 'fr')).toBe('Pokémon de Base • 70 PV ou moins')

    const breakdownFr = buildHumanReadableAiBreakdown(model, 'fr')
    expect(breakdownFr).not.toBeNull()
    expect(breakdownFr?.roleLabel).toBe('Stabilisateur de Consistance')
    expect(breakdownFr?.phasePriorities[0]?.pct).toBe(95)
    expect(breakdownFr?.actions[0]?.effectSentences[0]).toContain('Cherche')
    expect(breakdownFr?.actions[0]?.effectSentences[0]).not.toContain('[object Object]')
    expect(breakdownFr?.actions[0]?.preconditions[1]).toContain('Pokémon de Base')
    expect(breakdownFr?.synergies[0]?.text).toContain('Feu')

    const breakdownEn = buildHumanReadableAiBreakdown(model, 'en')
    expect(breakdownEn?.roleLabel).toBe('Consistency Booster')
    expect(breakdownEn?.actions[0]?.effectSentences[0]).toContain('Searches')
  })
})
