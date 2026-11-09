import { describe, expect, it } from 'vitest'
import {
  currentLang,
  getLocalizedCardName,
  getLocalizedCardRules,
  getLocalizedSubCategory,
  setLanguage,
  t,
  toggleLanguage,
} from './i18n'

describe('i18n — Internationalization & Translation Helper', () => {
  it('switches reactively between French and English', () => {
    setLanguage('fr')
    expect(currentLang.value).toBe('fr')
    expect(t('appTitle')).toBe('PokéSim TCG')
    expect(t('pokemonCount')).toBe('Pokémon')
    expect(t('trainerCount')).toBe('Dresseurs')
    expect(t('energyCount')).toBe('Énergies')

    setLanguage('en')
    expect(currentLang.value).toBe('en')
    expect(t('trainerCount')).toBe('Trainers')
    expect(t('energyCount')).toBe('Energy')

    toggleLanguage()
    expect(currentLang.value).toBe('fr')
    expect(t('trainerCount')).toBe('Dresseurs')
  })

  it('interpolates parameters properly', () => {
    setLanguage('fr')
    expect(t('altCountBadge', { n: 3 })).toBe('3 alt.')
    expect(t('adjustDeckTo60', { n: 58 })).toBe('Ajustez le deck (58 / 60 cartes requises)')

    setLanguage('en')
    expect(t('adjustDeckTo60', { n: 58 })).toBe('Adjust deck (58 / 60 cards required)')
  })

  describe('getLocalizedCardName', () => {
    const cardMock = {
      cardId: 'sfa_feurisson',
      nameFr: 'Feurisson',
      nameEn: 'Quilava',
      identity: {
        nameFr: 'Feurisson',
        nameEn: 'Quilava',
      },
    }

    it('returns French name when lang is fr', () => {
      setLanguage('fr')
      expect(getLocalizedCardName(cardMock)).toBe('Feurisson')
      expect(getLocalizedCardName(cardMock, 'fr')).toBe('Feurisson')
    })

    it('returns English name when lang is en', () => {
      setLanguage('en')
      expect(getLocalizedCardName(cardMock)).toBe('Quilava')
      expect(getLocalizedCardName(cardMock, 'en')).toBe('Quilava')
    })

    it('handles synergy items with cardNameFr and cardNameEn', () => {
      const synergyMock = {
        cardNameFr: 'Lanssorien-ex',
        cardNameEn: 'Dragapult ex',
      }
      expect(getLocalizedCardName(synergyMock, 'fr')).toBe('Lanssorien-ex')
      expect(getLocalizedCardName(synergyMock, 'en')).toBe('Dragapult ex')
    })

    it('handles telemetry items with nameFr and nameEn', () => {
      const telemetryMock = {
        nameFr: 'Poffin Copain-Copain',
        nameEn: 'Buddy-Buddy Poffin',
      }
      expect(getLocalizedCardName(telemetryMock, 'fr')).toBe('Poffin Copain-Copain')
      expect(getLocalizedCardName(telemetryMock, 'en')).toBe('Buddy-Buddy Poffin')
    })

    it('falls back gracefully when English name is absent', () => {
      const frOnly = {
        nameFr: 'Carte Mystère',
      }
      expect(getLocalizedCardName(frOnly, 'en')).toBe('Carte Mystère')
    })
  })

  describe('getLocalizedCardRules', () => {
    const dualRulesCard = {
      identity: {
        rawRulesText: [
          '[Attaque FR: Morsure (30 dégâts)] Inflige 30 dégâts au Pokémon Défenseur.',
          '[Attack EN: Bite (30 damage)] Does 30 damage to Defender.',
          '[Talent FR: Flamme Vive] Piochez 1 carte.',
          '[Ability EN: Flash Flame] Draw 1 card.',
        ],
      },
    }

    it('filters out English lines and cleans French tags when lang is fr', () => {
      setLanguage('fr')
      const rules = getLocalizedCardRules(dualRulesCard, 'fr')
      expect(rules).toHaveLength(2)
      expect(rules[0]).toBe('[Attaque: Morsure (30 dégâts)] Inflige 30 dégâts au Pokémon Défenseur.')
      expect(rules[1]).toBe('[Talent: Flamme Vive] Piochez 1 carte.')
    })

    it('filters out French lines and cleans English tags when lang is en', () => {
      setLanguage('en')
      const rules = getLocalizedCardRules(dualRulesCard, 'en')
      expect(rules).toHaveLength(2)
      expect(rules[0]).toBe('[Attack: Bite (30 damage)] Does 30 damage to Defender.')
      expect(rules[1]).toBe('[Ability: Flash Flame] Draw 1 card.')
    })

    it('handles cards with single language rules cleanly', () => {
      const enOnly = {
        identity: {
          rawRulesText: ['Attach 2 Energy cards from discard pile to your Bench.'],
        },
      }
      const rulesFr = getLocalizedCardRules(enOnly, 'fr')
      const rulesEn = getLocalizedCardRules(enOnly, 'en')
      expect(rulesFr).toEqual(['Attach 2 Energy cards from discard pile to your Bench.'])
      expect(rulesEn).toEqual(['Attach 2 Energy cards from discard pile to your Bench.'])
    })
  })

  describe('getLocalizedSubCategory', () => {
    it('translates standard categories into French', () => {
      expect(getLocalizedSubCategory('BASIC', 'fr')).toBe('Base')
      expect(getLocalizedSubCategory('STAGE_1', 'fr')).toBe('Niveau 1')
      expect(getLocalizedSubCategory('STAGE_2', 'fr')).toBe('Niveau 2')
      expect(getLocalizedSubCategory('SUPPORTER', 'fr')).toBe('Supporter')
      expect(getLocalizedSubCategory('ITEM', 'fr')).toBe('Objet')
      expect(getLocalizedSubCategory('TOOL', 'fr')).toBe('Outil Pokémon')
      expect(getLocalizedSubCategory('STADIUM', 'fr')).toBe('Stade')
      expect(getLocalizedSubCategory('BASIC_ENERGY', 'fr')).toBe('Énergie de base')
      expect(getLocalizedSubCategory('SPECIAL_ENERGY', 'fr')).toBe('Énergie Spéciale')
    })

    it('translates standard categories into English', () => {
      expect(getLocalizedSubCategory('BASIC', 'en')).toBe('Basic')
      expect(getLocalizedSubCategory('STAGE_1', 'en')).toBe('Stage 1')
      expect(getLocalizedSubCategory('STAGE_2', 'en')).toBe('Stage 2')
      expect(getLocalizedSubCategory('SUPPORTER', 'en')).toBe('Supporter')
      expect(getLocalizedSubCategory('ITEM', 'en')).toBe('Item')
      expect(getLocalizedSubCategory('TOOL', 'en')).toBe('Pokémon Tool')
      expect(getLocalizedSubCategory('STADIUM', 'en')).toBe('Stadium')
      expect(getLocalizedSubCategory('BASIC_ENERGY', 'en')).toBe('Basic Energy')
      expect(getLocalizedSubCategory('SPECIAL_ENERGY', 'en')).toBe('Special Energy')
    })
  })
})
