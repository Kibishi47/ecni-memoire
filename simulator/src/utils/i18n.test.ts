import { describe, expect, it } from 'vitest'
import { currentLang, setLanguage, t, toggleLanguage } from './i18n'

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
})
