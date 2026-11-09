import { describe, expect, it } from 'vitest'
import { getCardImageUrl } from './cardImage'
import { createNativeBasicEnergyModel } from './energy'

describe('cardImage — Artwork URL Resolver', () => {
  it('resolves official Limitless SVE URLs for all 9 basic energy types', () => {
    const grass = createNativeBasicEnergyModel('Grass')
    const fire = createNativeBasicEnergyModel('Fire')
    const water = createNativeBasicEnergyModel('Water')
    const lightning = createNativeBasicEnergyModel('Lightning')
    const psychic = createNativeBasicEnergyModel('Psychic')
    const fighting = createNativeBasicEnergyModel('Fighting')
    const darkness = createNativeBasicEnergyModel('Darkness')
    const metal = createNativeBasicEnergyModel('Metal')
    const fairy = createNativeBasicEnergyModel('Fairy')

    expect(getCardImageUrl(grass)).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_001_R_EN.png',
    )
    expect(getCardImageUrl(fire)).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_002_R_EN.png',
    )
    expect(getCardImageUrl(water)).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_003_R_EN.png',
    )
    expect(getCardImageUrl(lightning)).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_004_R_EN.png',
    )
    expect(getCardImageUrl(psychic)).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_005_R_EN.png',
    )
    expect(getCardImageUrl(fighting)).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_006_R_EN.png',
    )
    expect(getCardImageUrl(darkness)).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_007_R_EN.png',
    )
    expect(getCardImageUrl(metal)).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_008_R_EN.png',
    )
    expect(getCardImageUrl(fairy)).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_009_R_EN.png',
    )
  })

  it('maps MEE basic energy set tokens to official SVE images', () => {
    // 3 Fire Energy MEE 10
    const meeFire = {
      nameFr: 'Énergie Feu de base',
      nameEn: 'Basic Fire Energy',
      setCode: 'MEE',
      number: '10',
    }
    expect(getCardImageUrl(meeFire)).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_002_R_EN.png',
    )

    // 3 Psychic Energy MEE 13
    const meePsychic = {
      nameFr: 'Énergie Psy de base',
      nameEn: 'Basic Psychic Energy',
      setCode: 'MEE',
      number: '13',
    }
    expect(getCardImageUrl(meePsychic)).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_005_R_EN.png',
    )

    // 3 Darkness Energy MEE 15
    const meeDarkness = {
      nameFr: 'Énergie Obscurité de base',
      nameEn: 'Basic Darkness Energy',
      setCode: 'MEE',
      number: '15',
    }
    expect(getCardImageUrl(meeDarkness)).toBe(
      'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/SVE/SVE_007_R_EN.png',
    )
  })

  it('supports low vs high resolution mode for card images', () => {
    const card = {
      cardId: 'sv06-130',
      nameFr: 'Lanssorien-ex',
      setCode: 'TWM',
      number: '130',
    }
    expect(getCardImageUrl(card, 'low')).toBe(
      'https://assets.tcgdex.net/fr/sv/sv06/130/low.webp',
    )
    expect(getCardImageUrl(card, 'high')).toBe(
      'https://assets.tcgdex.net/fr/sv/sv06/130/high.webp',
    )
  })
})
