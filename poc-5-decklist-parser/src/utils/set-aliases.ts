/**
 * Table d'alias de codes d'extension PTCGL / Limitless vers TCGdex
 * Adaptée de osamc/pokemon-tcg-deck-parser
 */
export const SET_CODE_ALIASES: Record<string, string> = {
  'PR-SW': 'swshp',
  'PR-SWSH': 'swshp',
  SWSHP: 'swshp',
  SWSH: 'swshp',
  'PR-SV': 'svp',
  'PR-SVI': 'svp',
  SVP: 'svp',
  'PR-SM': 'smp',
  SMP: 'smp',
  'PR-XY': 'xyp',
  XYP: 'xyp',
  'PR-BW': 'bwp',
  'PR-BLW': 'bwp',
  BWP: 'bwp',
  'PR-HS': 'hgssp',
  HGSSP: 'hgssp',
  'PR-DP': 'dpp',
  DPP: 'dpp',
  'PR-NP': 'np',
  NP: 'np',
  MEP: 'mep',
  'PR-ME': 'mep',
  SVE: 'sve',
  MEE: 'sve',
  ENERGY: 'sve',
  TRR: 'ex7',
}

export const AMBIGUOUS_SET_CODES: Record<string, string[]> = {
  RR: ['ex7', 'pl2'],
  TRR: ['ex7'],
}

export const PROMO_LOCAL_ID_PREFIX: Record<string, string> = {
  swshp: 'SWSH',
  svp: 'SVP',
  smp: 'SM',
  xyp: 'XY',
  bwp: 'BW',
  hgssp: 'HGSS',
  dpp: 'DP',
  np: 'NP',
  mep: 'MEP',
}

const ALT_SET_RE = /^(?:SWSH|SM|SV|XY|BW)?ALT$/i

export function isAltSetCode(code: string | undefined): boolean {
  return Boolean(code && ALT_SET_RE.test(code))
}

export function isPseudoSetCode(code: string | undefined): boolean {
  return isAltSetCode(code) || Boolean(code && /^energy$/i.test(code))
}

export function aliasSetCode(code: string): string | undefined {
  return SET_CODE_ALIASES[code.toUpperCase()]
}

export function galleryKind(number: string | undefined): 'tg' | 'gg' | undefined {
  if (!number) return undefined
  const upper = number.toUpperCase()
  if (upper.startsWith('TG')) return 'tg'
  if (upper.startsWith('GG')) return 'gg'
  return undefined
}
