import { describe, expect, it } from 'vitest'
import {
  coerceActionType,
  coerceEffectPrimitive,
  normalizeCardModel,
} from './cardNormalizer'
import type { EffectPrimitive } from '../types/cardModel'

const ALL_29_PRIMITIVES: EffectPrimitive[] = [
  'SEARCH_DECK',
  'DRAW_CARDS',
  'DAMAGE_ACTIVE',
  'DAMAGE_BENCH',
  'ATTACH_ENERGY',
  'DISCARD_CARDS',
  'HEAL',
  'SWITCH_ACTIVE',
  'APPLY_SPECIAL_CONDITION',
  'EVOLVE_POKEMON',
  'SHUFFLE_HAND_DRAW',
  'RECOVER_FROM_DISCARD',
  'PLACE_DAMAGE_COUNTERS',
  'MOVE_DAMAGE_COUNTERS',
  'MOVE_ENERGY',
  'MODIFY_DAMAGE_TAKEN',
  'MODIFY_DAMAGE_DEALT',
  'MODIFY_HP',
  'MODIFY_RETREAT_COST',
  'PREVENT_DAMAGE_OR_EFFECTS',
  'LOCK_NEXT_TURN_ATTACK',
  'LOCK_RETREAT',
  'LOCK_ABILITIES',
  'LOCK_ITEMS',
  'EXPAND_BENCH',
  'KNOCK_OUT',
  'MILL_DECK',
  'TAKE_EXTRA_PRIZE',
  'PUT_ON_TOP_OR_BOTTOM_OF_DECK',
]

describe('cardNormalizer — Schéma v2 & Intégrité des Primitives', () => {
  it('mappe fidèlement les 29 EffectPrimitive officielles sans perte ni écrasement', () => {
    for (const prim of ALL_29_PRIMITIVES) {
      expect(coerceEffectPrimitive(prim)).toBe(prim)
    }
    expect(coerceEffectPrimitive('PLACE_DAMAGE_COUNTERS')).toBe('PLACE_DAMAGE_COUNTERS')
    expect(coerceEffectPrimitive('MOVE_ENERGY')).toBe('MOVE_ENERGY')
    expect(coerceEffectPrimitive('TAKE_EXTRA_PRIZE_CARDS')).toBe('TAKE_EXTRA_PRIZE')
    expect(coerceEffectPrimitive('CANT_ATTACK_NEXT_TURN')).toBe('LOCK_NEXT_TURN_ATTACK')
    expect(coerceEffectPrimitive('MILL_OPPONENT_DECK')).toBe('MILL_DECK')
    expect(coerceEffectPrimitive('MOVE_ENERGY_BETWEEN_POKEMON')).toBe('MOVE_ENERGY')
    expect(coerceEffectPrimitive('PASSIVE_DAMAGE_BOOST')).toBe('MODIFY_DAMAGE_DEALT')
    expect(coerceEffectPrimitive('PASSIVE_ABILITY_OR_ITEM_LOCK')).toBe('LOCK_ITEMS')
  })

  it('ne convertit jamais une primitive inconnue ou nulle en DRAW_CARDS', () => {
    expect(coerceEffectPrimitive('TOTALLY_UNKNOWN_PRIMITIVE_XYZ')).toBeNull()
    expect(coerceEffectPrimitive('UNKNOWN_FOO')).toBeNull()
    expect(coerceEffectPrimitive(null)).toBeNull()
    expect(coerceEffectPrimitive('')).toBeNull()
    expect(coerceEffectPrimitive('NONE')).toBeNull()

    const normalized = normalizeCardModel({
      cardId: 'test-filter-unknown',
      category: 'TRAINER',
      subCategory: 'ITEM',
      identity: { nameFr: 'Carte Test', category: 'TRAINER', subCategory: 'ITEM', regulationMark: 'J' },
      playableActions: [
        {
          actionId: 'trainer_0',
          label: 'Action Test',
          actionType: 'PLAY_FROM_HAND',
          timingPhase: 'MAIN_PHASE_1',
          preconditions: [{ type: 'HAND_MIN_OTHER_CARDS', minCount: 2 }],
          effects: [
            { primitive: 'UNKNOWN_GARBAGE_PRIMITIVE', target: 'PLAYER' },
            {
              primitive: 'PLACE_DAMAGE_COUNTERS',
              target: 'OPPONENT_BENCH_ALL',
              value: 60,
              count: 6,
            },
          ],
        },
      ],
    })

    expect(normalized.identity.legalStandard).toBe(true)
    expect(normalized.playableActions[0]?.preconditions).toContain('HAND_MIN_OTHER_CARDS:2')
    expect(normalized.playableActions[0]?.effects.length).toBe(1)
    expect(normalized.playableActions[0]?.effects[0]?.primitive).toBe('PLACE_DAMAGE_COUNTERS')
    expect(normalized.playableActions[0]?.effects[0]?.value).toBe(60)
  })

  it('préserve TRIGGERED_ABILITY, PASSIVE_ABILITY et tous les champs v2 AtomicEffect', () => {
    expect(coerceActionType('TRIGGERED_ABILITY')).toBe('TRIGGERED_ABILITY')
    expect(coerceActionType('PASSIVE_ABILITY')).toBe('PASSIVE_ABILITY')
    expect(coerceActionType('USE_ABILITY')).toBe('USE_ABILITY')

    const model = normalizeCardModel({
      cardId: 'test-v2-fields',
      category: 'POKEMON',
      subCategory: 'STAGE_2',
      identity: { nameFr: 'Test v2', category: 'POKEMON', subCategory: 'STAGE_2', regulationMark: 'H' },
      pokemonStats: { hp: 310, types: ['Feu'], stage: 'Niveau 2', retreatCost: 2 },
      playableActions: [
        {
          actionId: 'ability_0',
          label: 'Talent Déclenché',
          actionType: 'TRIGGERED_ABILITY',
          timingPhase: 'MAIN_PHASE_1',
          preconditions: ['IN_PLAY:REPTINCEL'],
          effects: [
            {
              primitive: 'SEARCH_DECK',
              target: 'OWN_POKEMON_ANY',
              sourceZone: 'DECK',
              destinationZone: 'ATTACHED_CARDS',
              count: 2,
              filter: 'CATEGORY:ENERGY',
            },
          ],
        },
        {
          actionId: 'ability_1',
          label: 'Talent Passif',
          actionType: 'PASSIVE_ABILITY',
          timingPhase: 'MAIN_PHASE_1',
          effects: [
            {
              primitive: 'MODIFY_DAMAGE_TAKEN',
              target: 'SELF',
              value: -30,
            },
          ],
        },
        {
          actionId: 'attack_0',
          label: 'Attaque Pièce',
          actionType: 'ATTACK',
          timingPhase: 'ATTACK_PHASE',
          cost: { Feu: 1 },
          effects: [
            {
              primitive: 'DAMAGE_ACTIVE',
              target: 'OPPONENT_ACTIVE',
              value: 50,
              coinFlipMode: 'MULTI_COIN_PER_HEADS',
              coinCount: 3,
              scalingOperator: 'MULTIPLY',
              scalingMetric: 'PER_ENERGY_ON_SELF',
              bonusValue: 50,
            },
          ],
        },
      ],
    })

    expect(model.playableActions[0]?.actionType).toBe('TRIGGERED_ABILITY')
    expect(model.playableActions[0]?.effects[0]?.sourceZone).toBe('DECK')
    expect(model.playableActions[0]?.effects[0]?.destinationZone).toBe('ATTACHED_CARDS')
    expect(model.playableActions[1]?.actionType).toBe('PASSIVE_ABILITY')
    expect(model.playableActions[1]?.effects[0]?.value).toBe(-30)
    expect(model.playableActions[2]?.effects[0]?.coinFlipMode).toBe('MULTI_COIN_PER_HEADS')
    expect(model.playableActions[2]?.effects[0]?.coinCount).toBe(3)
    expect(model.playableActions[2]?.effects[0]?.scalingOperator).toBe('MULTIPLY')
    expect(model.playableActions[2]?.effects[0]?.scalingMetric).toBe('PER_ENERGY_ON_SELF')
    expect(model.playableActions[2]?.effects[0]?.bonusValue).toBe(50)
  })
})
