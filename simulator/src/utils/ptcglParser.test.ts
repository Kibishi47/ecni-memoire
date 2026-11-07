import { describe, expect, it } from 'vitest'
import { parsePtcglDecklist } from './ptcglParser'
import { exportDeckToPtcgl } from './ptcglExporter'
import { META_OPPONENT_DECKS } from '../data/metaDecks'
import { getCompiledCardsCount, hasCompiledCardData, UNIFIED_CARD_REGISTRY } from '../data/cardCatalog'

describe('Catalogue EngineCardModel & Parseur PTCGL', () => {
  it('charge correctement cards_database.json et gère les énergies de base nativement', () => {
    expect(UNIFIED_CARD_REGISTRY['sv04-125']).toBeDefined()
    expect(UNIFIED_CARD_REGISTRY['sv04-125']?.identity.nameFr).toBe('Super Bonbon')
    expect(UNIFIED_CARD_REGISTRY['sv03-125']?.identity.nameFr).toBe('Dracaufeu-ex')
    expect(UNIFIED_CARD_REGISTRY['sv03-164']?.identity.nameFr).toBe('Roucarnage-ex')
    expect(UNIFIED_CARD_REGISTRY['sv05-123']?.identity.nameFr).toBe('Ire-Foudre-ex')
    expect(UNIFIED_CARD_REGISTRY['sv06.5-038']?.identity.nameFr).toBe('Favianos-ex')
    expect(getCompiledCardsCount()).toBe(854)
  })

  it('valide les 3 decks méta de référence à 60 cartes avec 100 % de cartes résolues', () => {
    expect(META_OPPONENT_DECKS.length).toBe(3)
    expect(META_OPPONENT_DECKS.map((d) => d.name)).toEqual([
      'Lanssorien-ex',
      'Méga-Kangourex-ex',
      'Roigada',
    ])

    for (const deck of META_OPPONENT_DECKS) {
      const parsed = parsePtcglDecklist(deck.ptcglText)
      expect(parsed.totalCards).toBe(60)
      expect(parsed.isValid60).toBe(true)
      expect(parsed.hasAtLeastOneBasic).toBe(true)
      expect(parsed.isFullyResolved).toBe(true)
      expect(parsed.unresolvedCount).toBe(0)
      expect(parsed.unresolvedCards.length).toBe(0)
      expect(parsed.warnings.length).toBe(0)

      const compiledCards = parsed.cards.filter((c) => c.resolvedFromSource === 'compiled_db')
      const nativeEnergies = parsed.cards.filter((c) => c.resolvedFromSource === 'native_basic_energy')
      expect(compiledCards.length).toBeGreaterThan(0)
      expect(nativeEnergies.length).toBeGreaterThan(0)
    }
  })

  it('résout nativement les 9 types d\'énergies de base', () => {
    const text9Energies = `Pokémon: 6
4 Ire-Foudre-ex TEF 123
2 Favianos-ex SFA 38

Dresseurs: 28
4 Pepper SVI 166
4 Mashynn PAL 185
4 Hyper Ball SVI 196
4 Faiblo Ball SVI 181
4 Poffin Copain-Copain TEF 144
4 Super Bonbon PAF 125
4 Attrape-Riposte PAR 160

Énergies: 26
3 Énergie Plante de base SVE 1
3 Énergie Feu de base SVE 2
3 Énergie Eau de base SVE 3
3 Énergie Électrik de base SVE 4
3 Énergie Psy de base SVE 5
3 Énergie Combat de base SVE 6
3 Énergie Obscurité de base SVE 7
3 Énergie Métal de base SVE 8
2 Énergie Fée de base SVE 9

Total Cards: 60`

    const parsed = parsePtcglDecklist(text9Energies)
    expect(parsed.totalCards).toBe(60)
    expect(parsed.isValid60).toBe(true)
    expect(parsed.isFullyResolved).toBe(true)
    expect(parsed.energyCount).toBe(26)
  })

  it('bloque strictement la simulation si au moins une carte hors énergie de base est absente de cards_database.json', () => {
    const textWithMissing = `Pokémon: 6
4 Ire-Foudre-ex TEF 123
2 Carte Inconnue XXX 999

Dresseurs: 28
4 Pepper SVI 166
4 Mashynn PAL 185
4 Hyper Ball SVI 196
4 Faiblo Ball SVI 181
4 Poffin Copain-Copain TEF 144
4 Super Bonbon PAF 125
4 Attrape-Riposte PAR 160

Énergies: 26
15 Énergie Combat de base SVE 6
11 Énergie Électrik de base SVE 4

Total Cards: 60`

    const parsed = parsePtcglDecklist(textWithMissing)
    expect(parsed.totalCards).toBe(60)
    expect(parsed.isFullyResolved).toBe(false)
    expect(parsed.isValid60).toBe(false) // Bloqué car la carte n'est pas dans cards_database.json !
    expect(parsed.unresolvedCount).toBe(2)
    expect(parsed.unresolvedCards.length).toBe(1)
    expect(parsed.unresolvedCards[0]!.name).toBe('Carte Inconnue')
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

  it('détecte la présence des modèles compilés de cards_database.json', () => {
    expect(hasCompiledCardData()).toBe(true)
    expect(getCompiledCardsCount()).toBeGreaterThanOrEqual(1)
    const parsed = parsePtcglDecklist(META_OPPONENT_DECKS[0]!.ptcglText)
    expect(parsed.isDatabaseLoaded).toBe(true)
  })

  it('invalide un deck contenant plus d\'une carte ACE SPEC', () => {
    // Deck contenant 2 ACE SPECs
    const text2AceSpecs = `Pokémon: 6
4 Ire-Foudre-ex TEF 123
2 Favianos-ex SFA 38

Dresseurs: 28
4 Pepper SVI 166
4 Mashynn PAL 185
4 Hyper Ball SVI 196
4 Faiblo Ball SVI 181
4 Poffin Copain-Copain TEF 144
4 Super Bonbon PAF 125
2 Attrape-Suprême TEF 162
2 Attrape-Riposte PAR 160

Énergies: 26
15 Énergie Combat de base SVE 6
11 Énergie Électrik de base SVE 4

Total Cards: 60`

    const parsed = parsePtcglDecklist(text2AceSpecs)
    expect(parsed.totalCards).toBe(60)
    expect(parsed.aceSpecCount).toBe(2)
    expect(parsed.isValid60).toBe(false)
    expect(
      parsed.warnings.some((w) =>
        w.message.includes('Le deck contient 2 cartes HIGH-TECH (ACE SPEC). Une seule carte HIGH-TECH est autorisée par deck.'),
      ),
    ).toBe(true)
  })

  it('valide la légalité Standard des cartes régulées G, H, I et énergies de base', () => {
    const parsed = parsePtcglDecklist(META_OPPONENT_DECKS[0]!.ptcglText)
    expect(parsed.isStandardLegal).toBe(true)
  })
})
