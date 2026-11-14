import { describe, expect, it } from 'vitest'
import {
  matchesDslFilter,
  matchesInPlayConditions,
  parseDslFilter,
  targetFilterToDsl,
  UNIFIED_CARD_REGISTRY,
} from '../src/index.js'

describe('Filter DSL (matchesDslFilter, parseDslFilter, targetFilterToDsl)', () => {
  it('parses key:value filters and bare tokens accurately', () => {
    expect(parseDslFilter('CATEGORY:POKEMON|STAGE:BASIC|MAX_HP:70')).toEqual({
      CATEGORY: 'POKEMON',
      STAGE: 'BASIC',
      MAX_HP: '70',
    })
    expect(parseDslFilter('BASIC_ENERGY')).toEqual({ SUB: 'BASIC_ENERGY' })
    expect(parseDslFilter('TOOL')).toEqual({ SUB: 'TOOL' })
  })

  it('converts legacy object targetFilters into normalized DSL strings', () => {
    expect(
      targetFilterToDsl({
        category: 'POKEMON',
        subCategory: 'BASIC',
        maxHp: 70,
        energyType: 'Feu',
      }),
    ).toBe('CATEGORY:POKEMON|SUB:BASIC|TYPE:Feu|MAX_HP:70')
    expect(targetFilterToDsl(null)).toBeNull()
  })

  it('matches cards in the 854-card catalog against DSL filters', () => {
    const dreepy = UNIFIED_CARD_REGISTRY['sv06-128']!
    const dragapult = UNIFIED_CARD_REGISTRY['sv06-130']!
    const nestBall = UNIFIED_CARD_REGISTRY['sv01-181']!

    expect(dreepy).toBeDefined()
    expect(dragapult).toBeDefined()
    expect(nestBall).toBeDefined()

    expect(matchesDslFilter(dreepy, 'CATEGORY:POKEMON|STAGE:BASIC|MAX_HP:70')).toBe(true)
    expect(matchesDslFilter(dragapult, 'CATEGORY:POKEMON|STAGE:BASIC|MAX_HP:70')).toBe(false)
    expect(matchesDslFilter(dragapult, 'CATEGORY:POKEMON|RULE_BOX:TRUE|STAGE:STAGE_2')).toBe(true)
    expect(matchesDslFilter({ ...dragapult, identity: { ...dragapult.identity, isTera: true } }, 'CATEGORY:POKEMON|RULE_BOX:TRUE|TERA:TRUE')).toBe(true)
    expect(matchesDslFilter(nestBall, 'CATEGORY:TRAINER|SUB:ITEM')).toBe(true)
  })

  it('checks IN_PLAY conditions against cards in play', () => {
    const dragapult = UNIFIED_CARD_REGISTRY['sv06-130']!
    const drakloak = UNIFIED_CARD_REGISTRY['sv06-129']!
    expect(matchesInPlayConditions(['IN_PLAY:Lanssorien-ex'], [drakloak, dragapult])).toBe(true)
    expect(matchesInPlayConditions(['IN_PLAY:Dracaufeu-ex'], [drakloak])).toBe(false)
  })
})
