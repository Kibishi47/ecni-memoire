import { describe, expect, it } from 'vitest'
import { extractCardsFromJson } from '../src/scripts/seedCards.js'

describe('seedCards extractCardsFromJson', () => {
  it('handles EngineCardModel[] array format and deduplicates by cardId', () => {
    const input = [
      {
        cardId: 'sv06-128',
        identity: { cardId: 'sv06-128', nameFr: 'Fantyrm', nameEn: 'Dreepy', setId: 'sv06' },
      },
      {
        cardId: 'sv06-128',
        identity: { cardId: 'sv06-128', nameFr: 'Fantyrm (Updated)', nameEn: 'Dreepy', setId: 'sv06' },
      },
    ]

    const result = extractCardsFromJson(input)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      cardId: 'sv06-128',
      nameFr: 'Fantyrm (Updated)',
      nameEn: 'Dreepy',
      setId: 'sv06',
    })
  })

  it('handles { cards: Record<string, EngineCardModel> } object format', () => {
    const input = {
      schemaVersion: '2.0',
      cards: {
        'sv03-125': {
          cardId: 'sv03-125',
          identity: { cardId: 'sv03-125', nameFr: 'Dracaufeu-ex', nameEn: 'Charizard ex', setId: 'sv03' },
        },
        '30th-066': {
          cardId: '30th-066',
          identity: { cardId: '30th-066', nameFr: 'Mew-ex', nameEn: null, setId: '30th' },
        },
      },
    }

    const result = extractCardsFromJson(input)
    expect(result).toHaveLength(2)
    expect(result[0]!.cardId).toBe('sv03-125')
    expect(result[1]).toMatchObject({
      cardId: '30th-066',
      nameFr: 'Mew-ex',
      nameEn: null,
      setId: '30th',
    })
  })
})
