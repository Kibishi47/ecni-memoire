/**
 * Parseur principal de decklistes PTCGL & Limitless (FR et EN)
 */

import type { CardCategory, ParsedCard, ParsedDeck, ParseWarning } from '../types/deck'
import { inferFormat, isCardLine, isSectionLine, isTotalLine, splitCardTokens } from './lines'
import { resolveParsedCard } from './id-resolver'

export function parsePtcglDecklist(text: string): ParsedDeck {
  const rawLines = text.split(/\r?\n/)
  const cards: ParsedCard[] = []
  const warnings: ParseWarning[] = []
  const format = inferFormat(text)

  let currentCategory: CardCategory = 'pokemon'
  let declaredTotal: number | undefined

  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = i + 1
    const rawLine = rawLines[i] ?? ''
    const trimmed = rawLine.trim()

    if (!trimmed) continue
    // Ignorer les commentaires éventuels (# ou //)
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue

    const section = isSectionLine(trimmed)
    if (section) {
      currentCategory = section.category
      continue
    }

    const total = isTotalLine(trimmed)
    if (total !== undefined) {
      declaredTotal = total
      continue
    }

    const cardLine = isCardLine(trimmed)
    if (!cardLine) {
      warnings.push({
        line: lineNum,
        message: `Ligne non reconnue ignorée : "${trimmed}"`,
      })
      continue
    }

    if (cardLine.quantity <= 0) {
      warnings.push({
        line: lineNum,
        message: `Quantité nulle ou négative ignorée : "${trimmed}"`,
      })
      continue
    }

    const split = splitCardTokens(cardLine.rest)
    const cardName = split.nameTokens.join(' ').trim()

    if (!cardName) {
      warnings.push({
        line: lineNum,
        message: `Nom de carte manquant à la ligne ${lineNum}`,
      })
      continue
    }

    const resolved = resolveParsedCard({
      quantity: cardLine.quantity,
      rawName: cardName,
      setCode: split.setCode,
      number: split.number,
      foil: split.foil,
      categoryHint: currentCategory,
      line: lineNum,
      rawLine: trimmed,
    })

    cards.push(resolved)
  }

  return computeDeckSummary(cards, format, warnings, declaredTotal)
}

export function computeDeckSummary(
  cards: ParsedCard[],
  format: 'ptcgl' | 'limitless' = 'ptcgl',
  baseWarnings: ParseWarning[] = [],
  declaredTotal?: number,
): ParsedDeck {
  const activeCards = cards.filter((c) => c.quantity > 0)

  const pokemonCount = activeCards
    .filter((c) => c.category === 'pokemon')
    .reduce((sum, c) => sum + c.quantity, 0)

  const trainerCount = activeCards
    .filter((c) => c.category === 'trainer')
    .reduce((sum, c) => sum + c.quantity, 0)

  const energyCount = activeCards
    .filter((c) => c.category === 'energy')
    .reduce((sum, c) => sum + c.quantity, 0)

  const totalCards = pokemonCount + trainerCount + energyCount
  const uniqueIds = new Set(activeCards.map((c) => c.cardId))

  const warnings = [...baseWarnings]
  if (declaredTotal !== undefined && declaredTotal !== totalCards && baseWarnings.length === 0) {
    warnings.push({
      message: `Le total déclaré (${declaredTotal}) diffère du nombre réel de cartes comptées (${totalCards}).`,
    })
  }

  return {
    format,
    cards: activeCards,
    totalCards,
    pokemonCount,
    trainerCount,
    energyCount,
    uniqueCardCount: uniqueIds.size,
    warnings,
  }
}
