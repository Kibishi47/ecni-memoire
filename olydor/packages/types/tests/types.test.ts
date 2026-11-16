import { describe, expect, it } from 'vitest'
import {
  createReportBodySchema,
  isCardStandardLegal,
  isSetStandardOverridden,
  STANDARD_ALLOWED_REGULATION_MARKS,
} from '../src/index.js'

describe('@olydor/types', () => {
  it('validates CARD_MODEL_ERROR, ENGINE_RULE_ERROR, and WEBSITE_ERROR payloads with Zod', () => {
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

    const validWebsiteErr = createReportBodySchema.safeParse({
      type: 'WEBSITE_ERROR',
      userComment: 'Bouton invisible sur mobile',
      matchLogs: { href: 'https://olydor.app/' },
    })
    expect(validWebsiteErr.success).toBe(true)

    const emptyWebsiteErr = createReportBodySchema.safeParse({
      type: 'WEBSITE_ERROR',
      userComment: '   ',
    })
    expect(emptyWebsiteErr.success).toBe(false)
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
    expect(STANDARD_ALLOWED_REGULATION_MARKS.has('J')).toBe(true)
    expect(isSetStandardOverridden(null)).toBe(false)
    expect(
      isCardStandardLegal(
        {
          identity: { legalStandard: false, regulationMark: null, subCategory: 'BASIC', setId: 'me05' },
        },
        ['ME05'],
      ),
    ).toBe(true)
    expect(
      isCardStandardLegal(
        {
          identity: { legalStandard: false, regulationMark: null, subCategory: 'BASIC', setId: 'sv01' },
        },
        ['me05'],
      ),
    ).toBe(false)
  })
})
