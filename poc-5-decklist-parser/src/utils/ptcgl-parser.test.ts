import { describe, it, expect } from 'vitest'
import { parsePtcglDecklist, computeDeckSummary } from './ptcgl-parser'
import {
  exportDeckToPtcgl,
  extractCardIdsList,
  exportTargetIdentityJson,
  exportCleanDecklistWithoutIds,
} from './export'
import { SAMPLE_DECKS } from '../data/sample-decks'

describe('PTCGL Decklist Parser & ID Resolver', () => {
  it('résout correctement "4 Pepper SVI 166" et "4 Arven SVI 166" vers "sv01-166" avec le schéma identity exact', () => {
    const deck = parsePtcglDecklist(`Dresseurs: 4\n4 Pepper SVI 166`)
    expect(deck.totalCards).toBe(4)
    expect(deck.cards).toHaveLength(1)

    const card = deck.cards[0]!
    expect(card.cardId).toBe('sv01-166')
    expect(card.setId).toBe('sv01')
    expect(card.identity.cardId).toBe('sv01-166')
    expect(card.identity.nameFr).toBe('Pepper')
    expect(card.identity.nameEn).toBe('Arven')
    expect(card.identity.setId).toBe('sv01')
    expect(card.identity.setName).toBe('Écarlate et Violet')
    expect(card.identity.localId).toBe('166')
    expect(card.identity.category).toBe('TRAINER')
    expect(card.identity.subCategory).toBe('SUPPORTER')
    expect(card.identity.imageUrl).toBe('https://assets.tcgdex.net/fr/sv/sv01/166')
  })

  it('padde correctement les numéros à 3 chiffres pour TCGdex (ex: MEW 4 -> sv03.5-004) et conserve le mode non-padé', () => {
    const deck = parsePtcglDecklist(`Pokémon: 6\n4 Salamèche MEW 4\n2 Dracaufeu ex OBF 125`)
    expect(deck.cards[0]!.cardId).toBe('sv03.5-004')
    expect(deck.cards[0]!.unpaddedCardId).toBe('sv03.5-4')
    expect(deck.cards[0]!.ptcglId).toBe('MEW-4')
    expect(deck.cards[0]!.imageUrl).toBe('https://assets.tcgdex.net/fr/sv/sv03.5/004')

    expect(deck.cards[1]!.cardId).toBe('sv03-125')
    expect(deck.cards[1]!.imageUrl).toBe('https://assets.tcgdex.net/fr/sv/sv03/125')
  })

  it('gère les suffixes foils (PH), les cartes Promos (PR-SV) et les énergies PTCGL ({W} Energy)', () => {
    const raw = `
Pokémon: 1
1 Charizard ex PR-SV 56
Trainer: 1
1 Switch SVI 194 PH
Energy: 11
9 Basic {W} Energy Energy 29
2 Basic {L} Energy SVE 4 PH
`
    const deck = parsePtcglDecklist(raw)
    expect(deck.totalCards).toBe(13)

    const zard = deck.cards[0]!
    expect(zard.setId).toBe('svp')
    expect(zard.cardId).toBe('svp-056')

    const sw = deck.cards[1]!
    expect(sw.cardId).toBe('sv01-194')
    expect(sw.foil).toBe('PH')

    const water = deck.cards[2]!
    expect(water.category).toBe('energy')
    expect(water.setId).toBe('sve')
    expect(water.cardId).toBe('sve-003')
  })

  it('gère parfaitement les séries Mega Evolution (ASC, POR, MEG) et futures sans aucun warning', () => {
    const raw = `
Pokémon: 4
2 Mega Dragonite ex ASC 152
1 Mega Eelektross ex ASC 61
1 Meowth ex POR 62
Trainer: 3
2 Lillie's Determination MEG 120
1 Poké Pad POR 110
1 Carte Future Inconnue FUT 42
`
    const deck = parsePtcglDecklist(raw)
    expect(deck.totalCards).toBe(8)
    // Aucun warning d'extension manquante
    expect(deck.warnings).toHaveLength(0)

    const dragonite = deck.cards[0]!
    expect(dragonite.setId).toBe('me02.5')
    expect(dragonite.cardId).toBe('me02.5-152')
    expect(dragonite.imageUrl).toBe('https://assets.tcgdex.net/fr/me/me02.5/152')

    const eelektross = deck.cards[1]!
    expect(eelektross.setId).toBe('me02.5')
    expect(eelektross.cardId).toBe('me02.5-061')

    const meowth = deck.cards[2]!
    expect(meowth.setId).toBe('me03')
    expect(meowth.cardId).toBe('me03-062')

    const lillie = deck.cards[3]!
    expect(lillie.setId).toBe('me01')
    expect(lillie.cardId).toBe('me01-120')

    // Anticipation future : code inconnu résolu proprement en fallback sans warning
    const futureCard = deck.cards[5]!
    expect(futureCard.setId).toBe('fut')
    expect(futureCard.cardId).toBe('fut-042')
  })

  it('analyse un deck complet de 60 cartes et permet de modifier les ratios puis de réexporter au format PTCGL', () => {
    const preset = SAMPLE_DECKS[0]!
    const deck = parsePtcglDecklist(preset.ptcglText)
    expect(deck.totalCards).toBe(60)
    expect(deck.pokemonCount).toBe(16)
    expect(deck.trainerCount).toBe(36)
    expect(deck.energyCount).toBe(8)

    // Modification des ratios : passer Salamèche de 4 à 2 et Dracaufeu ex de 2 à 4
    const modifiedCards = deck.cards.map((c) => {
      if (c.cardId === 'sv03.5-004') return { ...c, quantity: 2 }
      if (c.cardId === 'sv03-125') return { ...c, quantity: 4 }
      return c
    })

    const updatedSummary = computeDeckSummary(modifiedCards)
    expect(updatedSummary.totalCards).toBe(60)

    // Réexportation au format PTCGL (FR et EN)
    const exportedFr = exportDeckToPtcgl(modifiedCards, { lang: 'fr' })
    expect(exportedFr).toContain('2 Salamèche MEW 4')
    expect(exportedFr).toContain('4 Dracaufeu ex OBF 125')
    expect(exportedFr).toContain('Total Cards: 60')

    const exportedEn = exportDeckToPtcgl(modifiedCards, { lang: 'en' })
    expect(exportedEn).toContain('2 Charmander MEW 4')
    expect(exportedEn).toContain('4 Charizard ex OBF 125')
    expect(exportedEn).toContain('4 Arven SVI 166')

    // Round-trip : le texte réexporté doit redonner exactement 60 cartes
    const reparsed = parsePtcglDecklist(exportedFr)
    expect(reparsed.totalCards).toBe(60)
    expect(reparsed.cards.find((c) => c.cardId === 'sv03-125')?.quantity).toBe(4)
  })

  it('extrait correctement les listes d\'IDs, le JSON identity et la liste épurée sans IDs', () => {
    const deck = parsePtcglDecklist(`Pokémon: 2\n2 Dracaufeu ex OBF 125\nDresseurs: 4\n4 Pepper SVI 166`)

    const uniqueIds = extractCardIdsList(deck.cards, { uniqueOnly: true })
    expect(uniqueIds).toEqual(['sv03-125', 'sv01-166'])

    const allIds = extractCardIdsList(deck.cards, { uniqueOnly: false })
    expect(allIds).toHaveLength(6)

    const withQty = extractCardIdsList(deck.cards, { withQuantities: true })
    expect(withQty).toEqual(['2x sv03-125', '4x sv01-166'])

    const targetJson = exportTargetIdentityJson(deck.cards)
    expect(targetJson).toHaveLength(2)
    expect(targetJson[1]?.cardId).toBe('sv01-166')
    expect(targetJson[1]?.identity.nameFr).toBe('Pepper')

    const cleanText = exportCleanDecklistWithoutIds(deck.cards, 'fr')
    expect(cleanText).toContain('2 Dracaufeu ex')
    expect(cleanText).toContain('4 Pepper')
    expect(cleanText).not.toContain('SVI 166')
  })
})
