/**
 * Service de parsing de decklists au format PTCGL / Limitless (FR et EN).
 * Reprend la logique et les tables de correspondance de `poc-5-decklist-parser` et `simulator`.
 */

export type DeckSectionCategory = 'pokemon' | 'trainer' | 'energy'

export interface SetMappingEntry {
  setId: string
  ptcglCode: string
  aliases: string[]
  nameFr: string
  nameEn: string
  serie: string
}

export interface BasicEnergyInfo {
  code: string
  nameEn: string
  nameFr: string
  sveNumber: string
}

export interface ParsedDeckLine {
  line: number
  raw: string
  count: number
  name: string
  setCode: string
  number: string
  paddedNumber: string
  foil?: string
  category: DeckSectionCategory
  setId: string
  cardId: string
  unpaddedCardId: string
  candidateCardIds: string[]
}

export interface ParsedDeckMetadata {
  name: string
  archetype: string | null
  declaredTotal?: number
  totalCards: number
  cards: ParsedDeckLine[]
  warnings: string[]
}

const SECTION_RE =
  /^(pok[eé]mons?|dresseurs?|trainers?|[eé]nergies?|energy)\s*(?:\(\d+\))?\s*[:：]?\s*(\d+)?\s*$/i
const TOTAL_RE = /^(?:total\s+cards?|total\s+de\s+cartes?|cartes?\s+totales?)\s*[:：]?\s*(\d+)\s*$/i
const CARD_LINE_RE = /^(\d{1,3})\s*[x×]?\s+(.+)$/i

const NUMBER_RE = /^[A-Za-z]{0,5}\d{1,4}[A-Za-z]?$/
const ALPHA_NUMBER_RE = /^[A-Za-z!?]$/
const SETCODE_RE = /^[A-Z][A-Z0-9]{0,6}(?:-[A-Z0-9]{1,4})?$/
const FOIL_MARKERS = new Set(['PH', 'RH', 'SH'])

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
  g: BASIC_ENERGIES[0]!,
  grass: BASIC_ENERGIES[0]!,
  plante: BASIC_ENERGIES[0]!,
  r: BASIC_ENERGIES[1]!,
  fire: BASIC_ENERGIES[1]!,
  feu: BASIC_ENERGIES[1]!,
  w: BASIC_ENERGIES[2]!,
  water: BASIC_ENERGIES[2]!,
  eau: BASIC_ENERGIES[2]!,
  l: BASIC_ENERGIES[3]!,
  lightning: BASIC_ENERGIES[3]!,
  electrik: BASIC_ENERGIES[3]!,
  électrik: BASIC_ENERGIES[3]!,
  électrique: BASIC_ENERGIES[3]!,
  p: BASIC_ENERGIES[4]!,
  psychic: BASIC_ENERGIES[4]!,
  psy: BASIC_ENERGIES[4]!,
  f: BASIC_ENERGIES[5]!,
  fighting: BASIC_ENERGIES[5]!,
  combat: BASIC_ENERGIES[5]!,
  d: BASIC_ENERGIES[6]!,
  darkness: BASIC_ENERGIES[6]!,
  dark: BASIC_ENERGIES[6]!,
  obscurité: BASIC_ENERGIES[6]!,
  obscurite: BASIC_ENERGIES[6]!,
  m: BASIC_ENERGIES[7]!,
  metal: BASIC_ENERGIES[7]!,
  métal: BASIC_ENERGIES[7]!,
}

const ENERGY_TRAINER_NAMES = [
  'energy switch',
  'energy search',
  'energy retrieval',
  'superior energy retrieval',
  'energy sticker',
  'energy lotto',
  'energy recycler',
  'energy spinner',
  "échange d'énergie",
  "recherche d'énergie",
  "récupération d'énergie",
  "recupération d'énergie",
]

export const VERIFIED_SETS: SetMappingEntry[] = [
  // === Mega Evolution ===
  { setId: 'me01', ptcglCode: 'MEG', aliases: ['ME01', 'ME1'], nameFr: 'Méga-Évolution', nameEn: 'Mega Evolution', serie: 'me' },
  { setId: 'me02', ptcglCode: 'PFL', aliases: ['PFF', 'ME02', 'ME2'], nameFr: 'Flammes Fantasmagoriques', nameEn: 'Phantasmal Flames', serie: 'me' },
  { setId: 'me02.5', ptcglCode: 'ASC', aliases: ['HER', 'ME02.5', 'ME02PT5', 'ME2.5'], nameFr: 'Héros Transcendants', nameEn: 'Ascended Heroes', serie: 'me' },
  { setId: 'me03', ptcglCode: 'POR', aliases: ['ORP', 'ME03', 'ME3'], nameFr: 'Équilibre Parfait', nameEn: 'Perfect Order', serie: 'me' },
  { setId: 'me04', ptcglCode: 'CRI', aliases: ['CHA', 'ME04', 'ME4'], nameFr: 'Chaos Ascendant', nameEn: 'Chaos Rising', serie: 'me' },
  { setId: 'me05', ptcglCode: 'PBL', aliases: ['DKN', 'PIT', 'ME05', 'ME5'], nameFr: 'Nuit Noire', nameEn: 'Pitch Black', serie: 'me' },
  { setId: '30th', ptcglCode: '30C', aliases: ['30TH'], nameFr: '30ᵉ Anniversaire', nameEn: '30th Anniversary', serie: 'me' },
  { setId: '30th-c', ptcglCode: '30CC', aliases: ['30TH-C', '30THC'], nameFr: 'Collection Classique 30ᵉ Anniversaire', nameEn: '30th Classic Collection', serie: 'me' },
  { setId: 'mee', ptcglCode: 'MEE', aliases: ['ENERGY-ME', 'ME-ENERGY'], nameFr: 'Méga-Évolution Énergie', nameEn: 'Mega Evolution Energy', serie: 'me' },
  { setId: 'mep', ptcglCode: 'MEP', aliases: ['PR-ME'], nameFr: 'MEP Black Star Promos', nameEn: 'MEP Black Star Promos', serie: 'me' },

  // === Scarlet & Violet ===
  { setId: 'sv01', ptcglCode: 'SVI', aliases: ['SV1', 'SV01'], nameFr: 'Écarlate et Violet', nameEn: 'Scarlet & Violet', serie: 'sv' },
  { setId: 'sv02', ptcglCode: 'PAL', aliases: ['SV2', 'SV02'], nameFr: 'Évolutions à Paldea', nameEn: 'Paldea Evolved', serie: 'sv' },
  { setId: 'sv03', ptcglCode: 'OBF', aliases: ['SV3', 'SV03'], nameFr: 'Flammes Obsidiennes', nameEn: 'Obsidian Flames', serie: 'sv' },
  { setId: 'sv03.5', ptcglCode: 'MEW', aliases: ['151', 'SV3.5', 'SV03.5', 'SV3PT5'], nameFr: '151', nameEn: '151', serie: 'sv' },
  { setId: 'sv04', ptcglCode: 'PAR', aliases: ['SV4', 'SV04'], nameFr: 'Faille Paradoxe', nameEn: 'Paradox Rift', serie: 'sv' },
  { setId: 'sv04.5', ptcglCode: 'PAF', aliases: ['SV4.5', 'SV04.5', 'SV4PT5'], nameFr: 'Destinées de Paldea', nameEn: 'Paldean Fates', serie: 'sv' },
  { setId: 'sv05', ptcglCode: 'TEF', aliases: ['SV5', 'SV05'], nameFr: 'Forces Temporelles', nameEn: 'Temporal Forces', serie: 'sv' },
  { setId: 'sv06', ptcglCode: 'TWM', aliases: ['SV6', 'SV06'], nameFr: 'Mascarade Crépusculaire', nameEn: 'Twilight Masquerade', serie: 'sv' },
  { setId: 'sv06.5', ptcglCode: 'SFA', aliases: ['SV6.5', 'SV06.5', 'SV6PT5'], nameFr: 'Fable Nébuleuse', nameEn: 'Shrouded Fable', serie: 'sv' },
  { setId: 'sv07', ptcglCode: 'SCR', aliases: ['SV7', 'SV07'], nameFr: 'Couronne Stellaire', nameEn: 'Stellar Crown', serie: 'sv' },
  { setId: 'sv08', ptcglCode: 'SSP', aliases: ['SV8', 'SV08'], nameFr: 'Étincelles Déferlantes', nameEn: 'Surging Sparks', serie: 'sv' },
  { setId: 'sv08.5', ptcglCode: 'PRE', aliases: ['SV8.5', 'SV08.5', 'SV8PT5'], nameFr: 'Évolutions Prismatiques', nameEn: 'Prismatic Evolutions', serie: 'sv' },
  { setId: 'sv09', ptcglCode: 'JTG', aliases: ['SV9', 'SV09'], nameFr: 'Aventures Ensemble', nameEn: 'Journey Together', serie: 'sv' },
  { setId: 'sv10', ptcglCode: 'DRI', aliases: ['SV10'], nameFr: 'Rivalités Destinées', nameEn: 'Destined Rivals', serie: 'sv' },
  { setId: 'sv10.5w', ptcglCode: 'WHT', aliases: ['SV10.5W', 'WHITE'], nameFr: 'Flamme Blanche', nameEn: 'White Flare', serie: 'sv' },
  { setId: 'sv10.5b', ptcglCode: 'BLK', aliases: ['SV10.5B', 'BLACK'], nameFr: 'Foudre Noire', nameEn: 'Black Bolt', serie: 'sv' },
  { setId: 'svp', ptcglCode: 'PR-SV', aliases: ['SVP', 'PR-SVI'], nameFr: 'SVP Black Star Promos', nameEn: 'SVP Black Star Promos', serie: 'sv' },
  { setId: 'sve', ptcglCode: 'SVE', aliases: ['ENERGY', 'MEE-BASE'], nameFr: 'Écarlate et Violet Énergie', nameEn: 'Scarlet & Violet Energy', serie: 'sv' },

  // === Sword & Shield ===
  { setId: 'swsh1', ptcglCode: 'SSH', aliases: ['SWSH1', 'SWSH01'], nameFr: 'Épée et Bouclier', nameEn: 'Sword & Shield', serie: 'swsh' },
  { setId: 'swsh2', ptcglCode: 'RCL', aliases: ['SWSH2', 'SWSH02'], nameFr: 'Clash des Rebelles', nameEn: 'Rebel Clash', serie: 'swsh' },
  { setId: 'swsh3', ptcglCode: 'DAA', aliases: ['SWSH3', 'SWSH03'], nameFr: 'Ténèbres Embrasées', nameEn: 'Darkness Ablaze', serie: 'swsh' },
  { setId: 'swsh3.5', ptcglCode: 'CPA', aliases: ['SWSH3.5', 'SWSH03.5'], nameFr: 'La Voie du Maître', nameEn: "Champion's Path", serie: 'swsh' },
  { setId: 'swsh4', ptcglCode: 'VIV', aliases: ['SWSH4', 'SWSH04'], nameFr: 'Voltage Éclatant', nameEn: 'Vivid Voltage', serie: 'swsh' },
  { setId: 'swsh4.5', ptcglCode: 'SHF', aliases: ['SWSH4.5', 'SWSH04.5'], nameFr: 'Destinées Radieuses', nameEn: 'Shining Fates', serie: 'swsh' },
  { setId: 'swsh5', ptcglCode: 'BST', aliases: ['SWSH5', 'SWSH05'], nameFr: 'Styles de combat', nameEn: 'Battle Styles', serie: 'swsh' },
  { setId: 'swsh6', ptcglCode: 'CRE', aliases: ['SWSH6', 'SWSH06'], nameFr: 'Règne de Glace', nameEn: 'Chilling Reign', serie: 'swsh' },
  { setId: 'swsh7', ptcglCode: 'EVS', aliases: ['SWSH7', 'SWSH07'], nameFr: 'Évolution Céleste', nameEn: 'Evolving Skies', serie: 'swsh' },
  { setId: 'swsh7.5', ptcglCode: 'CEL', aliases: ['CEL25', 'SWSH7.5'], nameFr: 'Célébrations', nameEn: 'Celebrations', serie: 'swsh' },
  { setId: 'swsh8', ptcglCode: 'FST', aliases: ['SWSH8', 'SWSH08'], nameFr: 'Poing de Fusion', nameEn: 'Fusion Strike', serie: 'swsh' },
  { setId: 'swsh9', ptcglCode: 'BRS', aliases: ['SWSH9', 'SWSH09'], nameFr: 'Stars Étincelantes', nameEn: 'Brilliant Stars', serie: 'swsh' },
  { setId: 'swsh10', ptcglCode: 'ASR', aliases: ['SWSH10'], nameFr: 'Astres Radieux', nameEn: 'Astral Radiance', serie: 'swsh' },
  { setId: 'swsh10.5', ptcglCode: 'PGO', aliases: ['SWSH10.5'], nameFr: 'Pokémon GO', nameEn: 'Pokémon GO', serie: 'swsh' },
  { setId: 'swsh11', ptcglCode: 'LOR', aliases: ['SWSH11'], nameFr: 'Origine Perdue', nameEn: 'Lost Origin', serie: 'swsh' },
  { setId: 'swsh12', ptcglCode: 'SIT', aliases: ['SWSH12'], nameFr: 'Tempête Argentée', nameEn: 'Silver Tempest', serie: 'swsh' },
  { setId: 'swsh12.5', ptcglCode: 'CRZ', aliases: ['SWSH12.5'], nameFr: 'Zénith Suprême', nameEn: 'Crown Zenith', serie: 'swsh' },
  { setId: 'swshp', ptcglCode: 'PR-SW', aliases: ['SWSHP', 'PR-SWSH', 'SWSH'], nameFr: 'Promo SWSH', nameEn: 'SWSH Black Star Promos', serie: 'swsh' },

  // === Sun & Moon ===
  { setId: 'sm1', ptcglCode: 'SUM', aliases: ['SM1'], nameFr: 'Soleil et Lune', nameEn: 'Sun & Moon', serie: 'sm' },
  { setId: 'sm2', ptcglCode: 'GRI', aliases: ['SM2'], nameFr: 'Gardiens Ascendants', nameEn: 'Guardians Rising', serie: 'sm' },
  { setId: 'sm3', ptcglCode: 'BUS', aliases: ['SM3'], nameFr: 'Ombres Ardentes', nameEn: 'Burning Shadows', serie: 'sm' },
  { setId: 'sm3.5', ptcglCode: 'SLG', aliases: ['SM3.5'], nameFr: 'Légendes Brillantes', nameEn: 'Shining Legends', serie: 'sm' },
  { setId: 'sm4', ptcglCode: 'CIN', aliases: ['SM4'], nameFr: 'Invasion Carmin', nameEn: 'Crimson Invasion', serie: 'sm' },
  { setId: 'sm5', ptcglCode: 'UPR', aliases: ['SM5'], nameFr: 'Ultra-Prisme', nameEn: 'Ultra Prism', serie: 'sm' },
  { setId: 'sm6', ptcglCode: 'FLI', aliases: ['SM6'], nameFr: 'Lumière Interdite', nameEn: 'Forbidden Light', serie: 'sm' },
  { setId: 'sm7', ptcglCode: 'CES', aliases: ['SM7'], nameFr: 'Tempête Céleste', nameEn: 'Celestial Storm', serie: 'sm' },
  { setId: 'sm7.5', ptcglCode: 'DRM', aliases: ['SM7.5'], nameFr: 'Majesté Des Dragons', nameEn: 'Dragon Majesty', serie: 'sm' },
  { setId: 'sm8', ptcglCode: 'LOT', aliases: ['SM8'], nameFr: 'Tonnerre Perdu', nameEn: 'Lost Thunder', serie: 'sm' },
  { setId: 'sm9', ptcglCode: 'TEU', aliases: ['SM9'], nameFr: 'Duo de Choc', nameEn: 'Team Up', serie: 'sm' },
  { setId: 'sm10', ptcglCode: 'UNB', aliases: ['SM10'], nameFr: 'Alliance Infaillible', nameEn: 'Unbroken Bonds', serie: 'sm' },
  { setId: 'sm11', ptcglCode: 'UNM', aliases: ['SM11'], nameFr: 'Harmonie des Esprits', nameEn: 'Unified Minds', serie: 'sm' },
  { setId: 'sm115', ptcglCode: 'HIF', aliases: ['SM11.5', 'SM115'], nameFr: 'Destinées Occultes', nameEn: 'Hidden Fates', serie: 'sm' },
  { setId: 'sm12', ptcglCode: 'CEC', aliases: ['SM12'], nameFr: 'Éclipse Cosmique', nameEn: 'Cosmic Eclipse', serie: 'sm' },
  { setId: 'smp', ptcglCode: 'PR-SM', aliases: ['SMP'], nameFr: 'Promo SM', nameEn: 'SM Black Star Promos', serie: 'sm' },

  // === XY ===
  { setId: 'xy1', ptcglCode: 'XY', aliases: ['XY1'], nameFr: 'XY', nameEn: 'XY', serie: 'xy' },
  { setId: 'xy2', ptcglCode: 'FLF', aliases: ['XY2'], nameFr: 'Étincelles', nameEn: 'Flashfire', serie: 'xy' },
  { setId: 'xy3', ptcglCode: 'FFI', aliases: ['XY3'], nameFr: 'Poings Furieux', nameEn: 'Furious Fists', serie: 'xy' },
  { setId: 'xy4', ptcglCode: 'PHF', aliases: ['XY4'], nameFr: 'Vigueur Spectrale', nameEn: 'Phantom Forces', serie: 'xy' },
  { setId: 'xy5', ptcglCode: 'PRC', aliases: ['XY5'], nameFr: 'Primo-Choc', nameEn: 'Primal Clash', serie: 'xy' },
  { setId: 'xy6', ptcglCode: 'ROS', aliases: ['XY6'], nameFr: 'Ciel Rugissant', nameEn: 'Roaring Skies', serie: 'xy' },
  { setId: 'xy7', ptcglCode: 'AOR', aliases: ['XY7'], nameFr: 'Origines Antiques', nameEn: 'Ancient Origins', serie: 'xy' },
  { setId: 'xy8', ptcglCode: 'BKT', aliases: ['XY8'], nameFr: 'Impulsion Turbo', nameEn: 'BREAKthrough', serie: 'xy' },
  { setId: 'xy9', ptcglCode: 'BKP', aliases: ['XY9'], nameFr: 'Rupture Turbo', nameEn: 'BREAKpoint', serie: 'xy' },
  { setId: 'xy10', ptcglCode: 'FCO', aliases: ['XY10'], nameFr: 'Impact des Destins', nameEn: 'Fates Collide', serie: 'xy' },
  { setId: 'xy11', ptcglCode: 'STS', aliases: ['XY11'], nameFr: 'Offensive Vapeur', nameEn: 'Steam Siege', serie: 'xy' },
  { setId: 'xy12', ptcglCode: 'EVO', aliases: ['XY12'], nameFr: 'Évolutions', nameEn: 'Evolutions', serie: 'xy' },
  { setId: 'g1', ptcglCode: 'GEN', aliases: ['G1'], nameFr: 'Générations', nameEn: 'Generations', serie: 'xy' },
  { setId: 'xyp', ptcglCode: 'PR-XY', aliases: ['XYP'], nameFr: 'Promo XY', nameEn: 'XY Black Star Promos', serie: 'xy' },
]

const byPtcglCode = new Map<string, SetMappingEntry>()
const byTcgdexId = new Map<string, SetMappingEntry>()

for (const entry of VERIFIED_SETS) {
  byPtcglCode.set(entry.ptcglCode.toUpperCase(), entry)
  byTcgdexId.set(entry.setId.toLowerCase(), entry)
  for (const alias of entry.aliases) {
    const upper = alias.toUpperCase()
    if (!byPtcglCode.has(upper)) {
      byPtcglCode.set(upper, entry)
    }
  }
}

export function lookupSetMapping(setCode: string | undefined): SetMappingEntry {
  const upper = (setCode || 'SVI').toUpperCase()
  const direct = byPtcglCode.get(upper) ?? byTcgdexId.get(upper.toLowerCase())
  if (direct) return direct

  let serie = 'sv'
  if (/^ME/i.test(upper)) serie = 'me'
  else if (/^SWSH/i.test(upper)) serie = 'swsh'
  else if (/^SM/i.test(upper)) serie = 'sm'
  else if (/^XY/i.test(upper)) serie = 'xy'

  return {
    setId: upper.toLowerCase(),
    ptcglCode: upper,
    aliases: [upper],
    nameFr: `Extension ${upper}`,
    nameEn: `Set ${upper}`,
    serie,
  }
}

function isEnergySetCode(code: string | undefined): boolean {
  return Boolean(code && /^(?:sve|mee|energy|sm1e|xye)$/i.test(code))
}

function isEnergyTrainerName(name: string): boolean {
  const lower = name.toLowerCase().trim()
  return ENERGY_TRAINER_NAMES.some((t) => lower.includes(t))
}

function isNumberedEnergyTrainerName(name: string): boolean {
  return /energy\s+search\s+pro/i.test(name)
}

function isEnergyCardName(name: string): boolean {
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
  const braceMatch = name.match(/\{([A-Za-z])\}/)
  if (braceMatch && braceMatch[1]) {
    const code = braceMatch[1].toLowerCase()
    if (ENERGY_TYPE_MAP[code]) return ENERGY_TYPE_MAP[code]
  }

  if (!isEnergyCardName(name)) return undefined

  const lower = name.toLowerCase()
  if (
    lower.includes('basic') ||
    lower.includes('de base') ||
    /^(?:grass|fire|water|lightning|psychic|fighting|darkness|metal)\s+energy$/i.test(lower.trim()) ||
    /^énergie\s+(?:plante|feu|eau|électrik|electrik|électrique|psy|combat|obscurité|obscurite|métal|metal)$/i.test(
      lower.trim(),
    )
  ) {
    for (const [key, info] of Object.entries(ENERGY_TYPE_MAP)) {
      if (key.length > 1 && lower.includes(key)) {
        return info
      }
    }
  }

  if (number && (lower.includes('basic') || lower.includes('de base'))) {
    const num = parseInt(number, 10)
    if (num >= 1 && num <= 8) return BASIC_ENERGIES[num - 1]
    if (num >= 9 && num <= 16) return BASIC_ENERGIES[num - 9]
  }

  return undefined
}

export function padLocalNumber(rawNumber: string): string {
  const trimmed = rawNumber.trim()
  if (!/^\d+$/.test(trimmed)) return trimmed
  return String(parseInt(trimmed, 10)).padStart(3, '0')
}

export function stripLeadingZeros(rawNumber: string): string {
  const trimmed = rawNumber.trim()
  if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10))
  return trimmed
}

function sectionCategory(label: string): DeckSectionCategory {
  if (/^pok/i.test(label)) return 'pokemon'
  if (/^(?:train|dress)/i.test(label)) return 'trainer'
  if (/^[eé]nerg/i.test(label)) return 'energy'
  return 'pokemon'
}

function looksLikeCollectorNumber(token: string, allowAlpha = false): boolean {
  if (NUMBER_RE.test(token)) return true
  return allowAlpha && ALPHA_NUMBER_RE.test(token)
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

interface SplitTokens {
  nameTokens: string[]
  setCode?: string
  number?: string
  foil?: string
}

function splitCardTokens(rest: string): SplitTokens {
  let tokens = rest.trim().split(/\s+/)
  let foil: string | undefined

  const last = tokens[tokens.length - 1]
  if (last && FOIL_MARKERS.has(last.toUpperCase()) && tokens.length > 1) {
    foil = last.toUpperCase()
    tokens = tokens.slice(0, -1)
  }

  // Cas spécifique PTCGL : "11 Basic {W} Energy Energy 29"
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

  // Cas standard : "4 Dreepy TWM 128" ou "1 Charizard ex PR-SV 56"
  if (
    tokens.length >= 3 &&
    looksLikeCollectorNumber(tokens[tokens.length - 1] ?? '', true) &&
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

  // Cas sans code de set mais avec numéro final
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

function humanizeDeckFilename(filename: string): string {
  const base = filename.replace(/\.txt$/i, '').replace(/[_-]+/g, ' ').trim()
  if (!base) return 'Meta Deck'
  return base.replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function extractCommentMetadata(
  commentBody: string,
  meta: { name?: string; archetype?: string },
): void {
  // Format combiné : "# Name: Dracaufeu-ex / Roucarnage-ex | Archetype: Midrange Setup"
  const segments = commentBody.split('|')
  for (const rawSeg of segments) {
    const seg = rawSeg.trim()
    const nameMatch = /^name\s*[:=]\s*(.+)$/i.exec(seg)
    if (nameMatch?.[1]) {
      meta.name = nameMatch[1].trim()
      continue
    }
    const archMatch = /^archetype\s*[:=]\s*(.+)$/i.exec(seg)
    if (archMatch?.[1]) {
      meta.archetype = archMatch[1].trim()
    }
  }
}

/**
 * Parses a PTCGL `.txt` decklist and extracts deck metadata + resolved `cardId`s.
 */
export function parsePtcglDeckFile(content: string, filename = 'deck.txt'): ParsedDeckMetadata {
  const rawLines = content.split(/\r?\n/)
  const cards: ParsedDeckLine[] = []
  const warnings: string[] = []
  const headerMeta: { name?: string; archetype?: string } = {}

  let currentCategory: DeckSectionCategory = 'pokemon'
  let declaredTotal: number | undefined

  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = i + 1
    const trimmed = (rawLines[i] ?? '').trim()
    if (!trimmed) continue

    if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
      const commentBody = trimmed.replace(/^(?:#|\/\/)+\s*/, '')
      extractCommentMetadata(commentBody, headerMeta)
      continue
    }

    const sectionMatch = SECTION_RE.exec(trimmed)
    if (sectionMatch) {
      currentCategory = sectionCategory(sectionMatch[1] ?? '')
      continue
    }

    const totalMatch = TOTAL_RE.exec(trimmed)
    if (totalMatch) {
      declaredTotal = Number(totalMatch[1])
      continue
    }

    const cardMatch = CARD_LINE_RE.exec(trimmed)
    if (!cardMatch) {
      warnings.push(`Ligne ${lineNum} non reconnue ignorée : "${trimmed}"`)
      continue
    }

    const count = Number(cardMatch[1])
    const rest = cardMatch[2]!.trim()
    if (count <= 0) {
      warnings.push(`Ligne ${lineNum} ignorée (quantité <= 0) : "${trimmed}"`)
      continue
    }

    const split = splitCardTokens(rest)
    const cardName = split.nameTokens.join(' ').trim()
    if (!cardName) {
      warnings.push(`Ligne ${lineNum} ignorée (nom de carte manquant) : "${trimmed}"`)
      continue
    }

    let setCode = split.setCode?.toUpperCase() || 'SVI'
    let rawNumber = split.number || '1'

    const basicEnergy = detectBasicEnergy(cardName, rawNumber)
    if (basicEnergy && (!split.setCode || /^energy$/i.test(split.setCode) || setCode === 'SVE')) {
      setCode = 'SVE'
      if (!split.number || parseInt(rawNumber, 10) > 16) {
        rawNumber = basicEnergy.sveNumber
      }
    }

    const mapping = lookupSetMapping(setCode)
    const setId = mapping.setId
    const cleanNumber = stripLeadingZeros(rawNumber)
    const paddedNumber = padLocalNumber(cleanNumber)
    const cardId = `${setId}-${paddedNumber}`
    const unpaddedCardId = `${setId}-${cleanNumber}`

    const candidateSet = new Set<string>([cardId, unpaddedCardId])
    if (basicEnergy) {
      candidateSet.add(`sve-${padLocalNumber(basicEnergy.sveNumber)}`)
    }

    let category: DeckSectionCategory = currentCategory
    if (basicEnergy || isEnergyCardName(cardName) || setCode === 'SVE') {
      category = 'energy'
    }

    cards.push({
      line: lineNum,
      raw: trimmed,
      count,
      name: cardName,
      setCode: mapping.ptcglCode,
      number: cleanNumber,
      paddedNumber,
      foil: split.foil,
      category,
      setId,
      cardId,
      unpaddedCardId,
      candidateCardIds: Array.from(candidateSet),
    })
  }

  const totalCards = cards.reduce((sum, c) => sum + c.count, 0)
  if (declaredTotal !== undefined && declaredTotal !== totalCards) {
    warnings.push(
      `Le total déclaré (${declaredTotal}) diffère du total réel (${totalCards}).`,
    )
  }

  return {
    name: headerMeta.name || humanizeDeckFilename(filename),
    archetype: headerMeta.archetype ?? null,
    declaredTotal,
    totalCards,
    cards,
    warnings,
  }
}
