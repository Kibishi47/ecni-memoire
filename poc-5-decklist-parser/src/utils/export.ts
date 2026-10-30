/**
 * Fonctions d'export :
 * 1. Réexportation au format officiel PTCGL (FR ou EN) après modification des ratios
 * 2. Extraction des IDs (liste simple, avec quantités, JSON cible `identity`, CSV)
 * 3. Deckliste épurée (retrait des codes d'extension et numéros)
 */

import type {
  ExportOptions,
  IdFormatMode,
  ParsedCard,
  TargetCardObject,
} from '../types/deck'
import { formatEnergyName } from './energy'

/**
 * Réexporte les cartes (avec leurs ratios actuels) au format officiel PTCGL
 */
export function exportDeckToPtcgl(cards: ParsedCard[], options: ExportOptions = {}): string {
  const lang = options.lang ?? 'fr'
  const format = options.format ?? 'ptcgl'
  const includeTotal = options.includeTotalCards ?? true
  const isFr = lang === 'fr'

  const active = cards.filter((c) => c.quantity > 0)
  const pokemons = active.filter((c) => c.category === 'pokemon')
  const trainers = active.filter((c) => c.category === 'trainer')
  const energies = active.filter((c) => c.category === 'energy')

  const lines: string[] = []

  if (pokemons.length > 0) {
    const count = pokemons.reduce((s, c) => s + c.quantity, 0)
    lines.push(`Pokémon: ${count}`)
    for (const c of pokemons) {
      lines.push(formatPtcglLine(c, isFr, format))
    }
    lines.push('')
  }

  if (trainers.length > 0) {
    const count = trainers.reduce((s, c) => s + c.quantity, 0)
    lines.push(`${isFr ? 'Dresseurs' : 'Trainer'}: ${count}`)
    for (const c of trainers) {
      lines.push(formatPtcglLine(c, isFr, format))
    }
    lines.push('')
  }

  if (energies.length > 0) {
    const count = energies.reduce((s, c) => s + c.quantity, 0)
    lines.push(`${isFr ? 'Énergies' : 'Energy'}: ${count}`)
    for (const c of energies) {
      lines.push(formatPtcglLine(c, isFr, format))
    }
    lines.push('')
  }

  const total = active.reduce((s, c) => s + c.quantity, 0)
  if (includeTotal && total > 0) {
    lines.push(`Total Cards: ${total}`)
  }

  return lines.join('\n').trim()
}

function formatPtcglLine(
  card: ParsedCard,
  isFr: boolean,
  format: 'ptcgl' | 'limitless',
): string {
  let displayName = isFr ? card.nameFr || card.name : card.nameEn || card.name
  if (card.category === 'energy') {
    displayName = formatEnergyName(displayName, format, isFr ? 'fr' : 'en')
  }
  const parts = [String(card.quantity), displayName, card.setCode, card.number]
  if (card.foil) {
    parts.push(card.foil.toUpperCase())
  }
  return parts.join(' ')
}

/**
 * Retourne l'identifiant d'une carte selon le mode choisi
 */
export function getCardIdByMode(card: ParsedCard, mode: IdFormatMode = 'tcgdex-padded'): string {
  if (mode === 'tcgdex-raw') return card.unpaddedCardId
  if (mode === 'ptcgl-code') return card.ptcglId
  return card.cardId
}

/**
 * Extrait la liste des IDs (uniques ou répétés selon la quantité)
 */
export function extractCardIdsList(
  cards: ParsedCard[],
  options: {
    mode?: IdFormatMode
    uniqueOnly?: boolean
    withQuantities?: boolean
  } = {},
): string[] {
  const mode = options.mode ?? 'tcgdex-padded'
  const uniqueOnly = options.uniqueOnly ?? true
  const withQuantities = options.withQuantities ?? false

  const active = cards.filter((c) => c.quantity > 0)

  if (withQuantities) {
    // Regrouper par ID au cas où deux lignes auraient le même ID
    const counts = new Map<string, number>()
    for (const c of active) {
      const id = getCardIdByMode(c, mode)
      counts.set(id, (counts.get(id) ?? 0) + c.quantity)
    }
    return Array.from(counts.entries()).map(([id, qty]) => `${qty}x ${id}`)
  }

  if (uniqueOnly) {
    const seen = new Set<string>()
    for (const c of active) {
      seen.add(getCardIdByMode(c, mode))
    }
    return Array.from(seen)
  }

  // Liste complète étendue (ex: 60 lignes pour 60 cartes)
  const expanded: string[] = []
  for (const c of active) {
    const id = getCardIdByMode(c, mode)
    for (let i = 0; i < c.quantity; i++) {
      expanded.push(id)
    }
  }
  return expanded
}

/**
 * Génère le tableau d'objets JSON conforme au schéma cible de l'utilisateur
 */
export function exportTargetIdentityJson(
  cards: ParsedCard[],
  mode: IdFormatMode = 'tcgdex-padded',
): TargetCardObject[] {
  const active = cards.filter((c) => c.quantity > 0)
  return active.map((c) => {
    const chosenId = getCardIdByMode(c, mode)
    return {
      cardId: chosenId,
      count: c.quantity,
      identity: {
        ...c.identity,
        cardId: chosenId,
      },
    }
  })
}

/**
 * Génère un export CSV complet
 */
export function exportCardsToCsv(
  cards: ParsedCard[],
  mode: IdFormatMode = 'tcgdex-padded',
): string {
  const header = 'cardId,quantity,nameFr,nameEn,category,subCategory,setId,ptcglCode,localId,imageUrl'
  const rows = cards
    .filter((c) => c.quantity > 0)
    .map((c) => {
      const id = getCardIdByMode(c, mode)
      const escape = (val: string) => `"${val.replace(/"/g, '""')}"`
      return [
        id,
        c.quantity,
        escape(c.nameFr),
        escape(c.nameEn),
        c.identity.category,
        c.subCategory,
        c.setId,
        c.setCode,
        c.paddedNumber,
        c.imageUrl,
      ].join(',')
    })
  return [header, ...rows].join('\n')
}

/**
 * Génère une deckliste épurée (sans les codes d'extension ni les numéros)
 */
export function exportCleanDecklistWithoutIds(
  cards: ParsedCard[],
  lang: 'fr' | 'en' = 'fr',
): string {
  const isFr = lang === 'fr'
  const active = cards.filter((c) => c.quantity > 0)
  const pokemons = active.filter((c) => c.category === 'pokemon')
  const trainers = active.filter((c) => c.category === 'trainer')
  const energies = active.filter((c) => c.category === 'energy')

  const lines: string[] = []

  if (pokemons.length > 0) {
    const count = pokemons.reduce((s, c) => s + c.quantity, 0)
    lines.push(`Pokémon (${count})`)
    for (const c of pokemons) {
      lines.push(`${c.quantity} ${isFr ? c.nameFr : c.nameEn}`)
    }
    lines.push('')
  }

  if (trainers.length > 0) {
    const count = trainers.reduce((s, c) => s + c.quantity, 0)
    lines.push(`${isFr ? 'Dresseurs' : 'Trainers'} (${count})`)
    for (const c of trainers) {
      lines.push(`${c.quantity} ${isFr ? c.nameFr : c.nameEn}`)
    }
    lines.push('')
  }

  if (energies.length > 0) {
    const count = energies.reduce((s, c) => s + c.quantity, 0)
    lines.push(`${isFr ? 'Énergies' : 'Energies'} (${count})`)
    for (const c of energies) {
      lines.push(`${c.quantity} ${isFr ? c.nameFr : c.nameEn}`)
    }
  }

  return lines.join('\n').trim()
}
