import { isEnergyCardName, isEnergySetCode, isNumberedEnergyTrainerName } from './energy'
import type { DeckFormat, DeckSectionCategory } from '../types/deck'

const SECTION_RE =
  /^(pok[eé]mons?|dresseurs?|trainers?|[eé]nergies?|energy)\s*(?:\(\d+\))?\s*[:：]?\s*(\d+)?\s*$/i
const TOTAL_RE = /^(?:total\s+cards?|total\s+de\s+cartes?|cartes?\s+totales?)\s*[:：]?\s*(\d+)\s*$/i
const CARD_LINE_RE = /^(\d{1,3})\s*[x×]?\s+(.+)$/i

const NUMBER_RE = /^[A-Za-z]{0,5}\d{1,4}[A-Za-z]?$/
const ALPHA_NUMBER_RE = /^[A-Za-z!?]$/
const SETCODE_RE = /^[A-Z][A-Z0-9]{0,6}(?:-[A-Z0-9]{1,4})?$/
const FOIL_MARKERS = new Set(['PH', 'RH', 'SH'])

export function sectionCategory(label: string): DeckSectionCategory {
  if (/^pok/i.test(label)) return 'pokemon'
  if (/^(?:train|dress)/i.test(label)) return 'trainer'
  if (/^[eé]nerg/i.test(label)) return 'energy'
  return 'pokemon'
}

export function isSectionLine(line: string): { category: DeckSectionCategory; count?: number } | undefined {
  const match = SECTION_RE.exec(line.trim())
  if (!match) return undefined
  const category = sectionCategory(match[1] ?? '')
  const count = match[2] ? Number(match[2]) : undefined
  return { category, count }
}

export function isTotalLine(line: string): number | undefined {
  const match = TOTAL_RE.exec(line.trim())
  return match ? Number(match[1]) : undefined
}

export function isCardLine(line: string): { quantity: number; rest: string } | undefined {
  const match = CARD_LINE_RE.exec(line.trim())
  if (!match) return undefined
  return { quantity: Number(match[1]), rest: match[2]!.trim() }
}

export interface SplitCardTokens {
  nameTokens: string[]
  setCode?: string
  number?: string
  foil?: string
}

export function splitCardTokens(rest: string): SplitCardTokens {
  let tokens = rest.trim().split(/\s+/)
  let foil: string | undefined

  const last = tokens[tokens.length - 1]
  if (last && FOIL_MARKERS.has(last.toUpperCase()) && tokens.length > 1) {
    foil = last.toUpperCase()
    tokens = tokens.slice(0, -1)
  }

  if (
    tokens.length >= 3 &&
    looksLikeCollectorNumber(tokens[tokens.length - 1] ?? '') &&
    /^energy$/i.test(tokens[tokens.length - 2] ?? '') &&
    isEnergyCardName(tokens.slice(0, -2).join(' '))
  ) {
    return {
      nameTokens: tokens.slice(0, -2),
      setCode: 'SVE',
      number: tokens[tokens.length - 1],
      foil,
    }
  }

  if (
    tokens.length >= 3 &&
    looksLikeCollectorNumber(tokens[tokens.length - 1] ?? '', { allowAlpha: true }) &&
    looksLikeSetCode(tokens[tokens.length - 2] ?? '') &&
    !isLoneEnergyTrainerName(tokens.slice(0, -2), tokens[tokens.length - 2])
  ) {
    return {
      nameTokens: tokens.slice(0, -2),
      setCode: tokens[tokens.length - 2]!.toUpperCase(),
      number: tokens[tokens.length - 1],
      foil,
    }
  }

  if (
    tokens.length >= 2 &&
    looksLikeCollectorNumber(tokens[tokens.length - 1] ?? '') &&
    !isNumberedEnergyTrainerName(tokens.join(' '))
  ) {
    return {
      nameTokens: tokens.slice(0, -1),
      number: tokens[tokens.length - 1],
      foil,
    }
  }

  return { nameTokens: tokens, foil }
}

function looksLikeCollectorNumber(
  token: string,
  options: { allowAlpha?: boolean } = {},
): boolean {
  if (NUMBER_RE.test(token)) return true
  return Boolean(options.allowAlpha && ALPHA_NUMBER_RE.test(token))
}

function looksLikeSetCode(token: string): boolean {
  if (!token) return false
  const uniformCase = token === token.toUpperCase() || token === token.toLowerCase()
  if (!uniformCase) return false
  return SETCODE_RE.test(token.toUpperCase())
}

function isLoneEnergyTrainerName(nameTokens: string[], maybeSet: string | undefined): boolean {
  return (
    nameTokens.length === 1 &&
    /^[eé]nerg(?:y|ie)$/i.test(nameTokens[0] ?? '') &&
    !isEnergySetCode(maybeSet)
  )
}

export function inferFormat(_text: string): DeckFormat {
  return 'ptcgl'
}
