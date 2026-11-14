import { describe, expect, it } from 'vitest'
import { createReportBodySchema, isCardStandardLegal } from '../src/index.js'

describe('@olydor/types', () => {
  it('validates CARD_MODEL_ERROR and ENGINE_RULE_ERROR payloads with Zod', () => {
    const validCardErr = createReportBodySchema.safeParse({
      type: 'CARD_MODEL_ERROR',
      cardId: 'sv03-125',
      userComment: 'Dégâts mal interprétés',
    })
    expect(validCardErr.success).toBe(true)

    const missingCardId = createReportBodySchema.safeParse({
      type: 'CARD_MODEL_ERROR',
      cardId: '',
    })
    expect(missingCardId.success).toBe(false)

    const validEngineErr = createReportBodySchema.safeParse({
      type: 'ENGINE_RULE_ERROR',
      matchLogs: { turn: 2, action: 'RETREAT' },
    })
    expect(validEngineErr.success).toBe(true)
  })

  it('checks standard legality including regulation marks G/H/I/J and basic energy', () => {
    expect(
      isCardStandardLegal({
        identity: { legalStandard: false, regulationMark: 'H', subCategory: 'BASIC' },
      }),
    ).toBe(true)
    expect(
      isCardStandardLegal({
        identity: { legalStandard: false, regulationMark: 'F', subCategory: 'BASIC' },
      }),
    ).toBe(false)
    expect(
      isCardStandardLegal({
        identity: { legalStandard: false, regulationMark: 'A', subCategory: 'BASIC_ENERGY' },
      }),
    ).toBe(true)
  })
})
