/**
 * Table d'alias de codes d'extension PTCGL / Limitless vers TCGdex
 * Adaptée de osamc/pokemon-tcg-deck-parser
 */
export const SET_CODE_ALIASES: Record<string, string> = {
  // Mega Evolution
  ASC: 'me02.5',
  HER: 'me02.5',
  POR: 'me03',
  ORP: 'me03',
  MEG: 'me01',
  PFL: 'me02',
  PFF: 'me02',
  CRI: 'me04',
  CHA: 'me04',
  PBL: 'me05',
  DKN: 'me05',
  MEE: 'mee',
  MEP: 'mep',
  'PR-ME': 'mep',
  '30C': '30th',
  '30TH': '30th',
  '30CC': '30th-c',
  '30TH-C': '30th-c',

  // Scarlet & Violet
  WHT: 'sv10.5w',
  BLK: 'sv10.5b',
  'PR-SV': 'svp',
  'PR-SVI': 'svp',
  SVP: 'svp',
  SVE: 'sve',

  // Sword & Shield
  'PR-SW': 'swshp',
  'PR-SWSH': 'swshp',
  SWSHP: 'swshp',
  SWSH: 'swshp',
  TRR: 'ex7',

  // Sun & Moon
  'PR-SM': 'smp',
  SMP: 'smp',

  // XY
  'PR-XY': 'xyp',
  XYP: 'xyp',

  // Black & White
  'PR-BW': 'bwp',
  'PR-BLW': 'bwp',
  BWP: 'bwp',
  'PR-HS': 'hgssp',
  HGSSP: 'hgssp',
  'PR-DP': 'dpp',
  DPP: 'dpp',
  'PR-NP': 'np',
  NP: 'np',
  ENERGY: 'sve',
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
