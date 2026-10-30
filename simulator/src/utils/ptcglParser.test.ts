import { describe, expect, it } from 'vitest'
import { parsePtcglDecklist } from './ptcglParser'
import { exportDeckToPtcgl } from './ptcglExporter'
import { META_OPPONENT_DECKS } from '../data/metaDecks'
import { UNIFIED_CARD_REGISTRY } from '../data/cardCatalog'

describe('Catalogue EngineCardModel & Parseur PTCGL', () => {
  it('charge correctement cards_database.json et fallbackCardModels.ts', () => {
    expect(UNIFIED_CARD_REGISTRY['sv04-125']).toBeDefined()
    expect(UNIFIED_CARD_REGISTRY['sv04-125']?.identity.nameFr).toBe('Super Bonbon')
    expect(UNIFIED_CARD_REGISTRY['sv03-125']?.identity.nameFr).toBe('Dracaufeu-ex')
    expect(UNIFIED_CARD_REGISTRY['sv03-164']?.identity.nameFr).toBe('Roucarnage-ex')
    expect(UNIFIED_CARD_REGISTRY['sv05-123']?.identity.nameFr).toBe('Ire-Foudre-ex')
    expect(UNIFIED_CARD_REGISTRY['sv06.5-038']?.identity.nameFr).toBe('Favianos-ex')
    expect(UNIFIED_CARD_MODELS_COUNT()).toBeGreaterThanOrEqual(35)
  })

  it('valide les 4 decks méta adverses à exactement 60 cartes sans carte synthétisée', () => {
    expect(META_OPPONENT_DECKS.length).toBeGreaterThanOrEqual(4)
    for (const metaDeck of META_OPPONENT_DECKS) {
      const parsed = parsePtcglDecklist(metaDeck.ptcglText)
      expect(parsed.totalCards).toBe(60)
      expect(parsed.isValid60).toBe(true)
      expect(parsed.hasAtLeastOneBasic).toBe(true)
      expect(parsed.warnings.length).toBe(0)
      const synthesized = parsed.cards.filter((c) => c.resolvedFromSource === 'synthesized')
      expect(synthesized.length).toBe(0)
    }
  })

  it('exporte et réimporte fidèlement une decklist au format PTCGL', () => {
    const original = parsePtcglDecklist(META_OPPONENT_DECKS[0]!.ptcglText)
    const exportedText = exportDeckToPtcgl(original.cards, { lang: 'fr' })
    const reParsed = parsePtcglDecklist(exportedText)
    expect(reParsed.totalCards).toBe(60)
    expect(reParsed.pokemonCount).toBe(original.pokemonCount)
    expect(reParsed.trainerCount).toBe(original.trainerCount)
    expect(reParsed.energyCount).toBe(original.energyCount)
  })
})

function UNIFIED_CARD_MODELS_COUNT(): number {
  return Object.keys(UNIFIED_CARD_REGISTRY).length
}
