import type { ExportOptions, ParsedDeckEntry } from '../types/deck'
import { formatEnergyName } from './energy'

/**
 * Exporte la liste de cartes courante au format texte officiel Pokémon TCG Live (PTCGL),
 * groupée par `Pokémon: X`, `Trainer: Y`, `Energy: Z` (ou leurs équivalents FR).
 */
export function exportDeckToPtcgl(cards: ParsedDeckEntry[], options: ExportOptions = {}): string {
  const lang = options.lang ?? 'en'
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
  card: ParsedDeckEntry,
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
