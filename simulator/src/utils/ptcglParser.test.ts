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
      expect(parsed.isFullyResolved).toBe(true)
      expect(parsed.unresolvedCount).toBe(0)
      expect(parsed.unresolvedCards.length).toBe(0)
      expect(parsed.warnings.length).toBe(0)
      const synthesized = parsed.cards.filter((c) => c.resolvedFromSource === 'synthesized')
      expect(synthesized.length).toBe(0)
    }
  })

  it('bloque la simulation si une carte est manquante dans la base de données', () => {
    const textWithUnknown = `Pokémon: 18
4 Salamèche MEW 4
2 InconnuCardInexistante XYZ 999
3 Dracaufeu-ex OBF 125
2 Roucool MEW 16
1 Roucoups OBF 163
2 Roucarnage-ex OBF 164
1 Favianos-ex SFA 38
1 Motisma V CRZ 45
1 Luminéon V BRS 40
1 Mélofée OBF 80

Dresseurs: 35
4 Pepper SVI 166
4 Mashynn PAL 185
3 Ordres du Boss PAL 172
1 Plan du Professeur Turum PAR 171
4 Poffin Copain-Copain TEF 144
4 Hyper Ball SVI 196
3 Faiblo Ball SVI 181
4 Super Bonbon PAF 125
2 Attrape-Riposte PAR 160
2 Civière Nocturne SFA 61
2 Méga Canne PAL 188
1 Tampon Injuste TWM 165
1 Ceinture Vitalité SVI 197

Énergies: 7
7 Énergie Feu de base SVE 2`

    const parsed = parsePtcglDecklist(textWithUnknown)
    expect(parsed.totalCards).toBe(60)
    expect(parsed.isFullyResolved).toBe(false)
    expect(parsed.isValid60).toBe(false) // Bloqué car carte non résolue !
    expect(parsed.unresolvedCount).toBe(2)
    expect(parsed.unresolvedCards.length).toBe(1)
    expect(parsed.unresolvedCards[0]!.name).toBe('InconnuCardInexistante')
    expect(parsed.warnings.some((w) => w.message.includes('Simulation impossible'))).toBe(true)
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
