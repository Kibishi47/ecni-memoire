/**
 * Gestion des cartes Énergie (syntaxe PTCGL {W}, {R}, etc., FR et EN)
 * Adaptée et enrichie en français depuis osamc/pokemon-tcg-deck-parser
 */

import type { DeckFormat } from '../types/deck'

export interface BasicEnergyInfo {
  code: string
  nameEn: string
  nameFr: string
  sveNumber: string
}

export const BASIC_ENERGIES: BasicEnergyInfo[] = [
  { code: 'G', nameEn: 'Basic {G} Energy', nameFr: 'Énergie Plante de base', sveNumber: '1' },
  { code: 'R', nameEn: 'Basic {R} Energy', nameFr: 'Énergie Feu de base', sveNumber: '2' },
  { code: 'W', nameEn: 'Basic {W} Energy', nameFr: 'Énergie Eau de base', sveNumber: '3' },
  { code: 'L', nameEn: 'Basic {L} Energy', nameFr: 'Énergie Électrik de base', sveNumber: '4' },
  { code: 'P', nameEn: 'Basic {P} Energy', nameFr: 'Énergie Psy de base', sveNumber: '5' },
  { code: 'F', nameEn: 'Basic {F} Energy', nameFr: 'Énergie Combat de base', sveNumber: '6' },
  { code: 'D', nameEn: 'Basic {D} Energy', nameFr: 'Énergie Obscurité de base', sveNumber: '7' },
  { code: 'M', nameEn: 'Basic {M} Energy', nameFr: 'Énergie Métal de base', sveNumber: '8' },
]

const ENERGY_TYPE_MAP: Record<string, BasicEnergyInfo> = {
  g: BASIC_ENERGIES[0],
  grass: BASIC_ENERGIES[0],
  plante: BASIC_ENERGIES[0],
  r: BASIC_ENERGIES[1],
  fire: BASIC_ENERGIES[1],
  feu: BASIC_ENERGIES[1],
  w: BASIC_ENERGIES[2],
  water: BASIC_ENERGIES[2],
  eau: BASIC_ENERGIES[2],
  l: BASIC_ENERGIES[3],
  lightning: BASIC_ENERGIES[3],
  electrik: BASIC_ENERGIES[3],
  électrik: BASIC_ENERGIES[3],
  électrique: BASIC_ENERGIES[3],
  p: BASIC_ENERGIES[4],
  psychic: BASIC_ENERGIES[4],
  psy: BASIC_ENERGIES[4],
  f: BASIC_ENERGIES[5],
  fighting: BASIC_ENERGIES[5],
  combat: BASIC_ENERGIES[5],
  d: BASIC_ENERGIES[6],
  darkness: BASIC_ENERGIES[6],
  dark: BASIC_ENERGIES[6],
  obscurité: BASIC_ENERGIES[6],
  obscurite: BASIC_ENERGIES[6],
  m: BASIC_ENERGIES[7],
  metal: BASIC_ENERGIES[7],
  métal: BASIC_ENERGIES[7],
}

const ENERGY_TRAINER_NAMES = [
  'energy switch',
  'energy search',
  'energy retrieval',
  'energy sticker',
  'energy lotto',
  'energy recycler',
  'energy spinner',
  'échange d\'énergie',
  'recherche d\'énergie',
  'récupération d\'énergie',
  'recupération d\'énergie',
]

export function isEnergySetCode(code: string | undefined): boolean {
  if (!code) return false
  return /^(?:sve|mee|energy|sm1e|xye)$/i.test(code)
}

export function isEnergyTrainerName(name: string): boolean {
  const lower = name.toLowerCase().trim()
  return ENERGY_TRAINER_NAMES.some((t) => lower.includes(t))
}

export function isNumberedEnergyTrainerName(name: string): boolean {
  return /energy\s+search\s+pro/i.test(name)
}

export function isEnergyCardName(name: string): boolean {
  if (isEnergyTrainerName(name)) return false
  const lower = name.toLowerCase()
  return (
    lower.includes('energy') ||
    lower.includes('énergie') ||
    lower.includes('energie') ||
    /\{[grwlpfdm]\}/i.test(name)
  )
}

export function detectBasicEnergy(name: string, number?: string): BasicEnergyInfo | undefined {
  // Check {R}, {W} shorthand
  const braceMatch = name.match(/\{([A-Za-z])\}/)
  if (braceMatch) {
    const code = braceMatch[1].toLowerCase()
    if (ENERGY_TYPE_MAP[code]) return ENERGY_TYPE_MAP[code]
  }

  if (!isEnergyCardName(name)) {
    return undefined
  }

  const lower = name.toLowerCase()
  if (
    lower.includes('basic') ||
    lower.includes('de base') ||
    /^(?:grass|fire|water|lightning|psychic|fighting|darkness|metal)\s+energy$/i.test(lower.trim()) ||
    /^énergie\s+(?:plante|feu|eau|électrik|electrik|psy|combat|obscurité|obscurite|métal|metal)$/i.test(lower.trim())
  ) {
    for (const [key, info] of Object.entries(ENERGY_TYPE_MAP)) {
      if (key.length > 1 && lower.includes(key)) {
        return info
      }
    }
  }

  // Check SVE number 1..8 or 9..16 only for energy cards
  if (number && (lower.includes('basic') || lower.includes('de base'))) {
    const num = parseInt(number, 10)
    if (num >= 1 && num <= 8) return BASIC_ENERGIES[num - 1]
    if (num >= 9 && num <= 16) return BASIC_ENERGIES[num - 9]
  }

  return undefined
}

export function formatEnergyName(name: string, format: DeckFormat, lang: 'fr' | 'en' = 'fr'): string {
  const basic = detectBasicEnergy(name)
  if (!basic) return name
  if (lang === 'fr') return basic.nameFr
  return format === 'ptcgl' ? basic.nameEn : basic.nameEn.replace(/^Basic\s+\{[A-Z]\}\s+/, `${ getEnglishTypeWord(basic.code) } `)
}

function getEnglishTypeWord(code: string): string {
  const map: Record<string, string> = {
    G: 'Grass',
    R: 'Fire',
    W: 'Water',
    L: 'Lightning',
    P: 'Psychic',
    F: 'Fighting',
    D: 'Darkness',
    M: 'Metal',
  }
  return map[code] || code
}
