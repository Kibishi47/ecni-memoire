import { describe, expect, it } from 'vitest'
import {
  extractCleanAiTranscriptions,
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
})
