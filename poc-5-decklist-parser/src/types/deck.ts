export type CardCategory = 'pokemon' | 'trainer' | 'energy'
export type DeckFormat = 'ptcgl' | 'limitless'

export interface UserCardIdentity {
  cardId: string
  nameFr: string
  nameEn: string
  setId: string
  setName: string
  localId: string
  category: 'POKEMON' | 'TRAINER' | 'ENERGY'
  subCategory: string
  regulationMark: string
  legalStandard: boolean
  legalExpanded: boolean
  rarity: string
  imageUrl: string
  rawRulesText: string[]
}

export interface TargetCardObject {
  cardId: string
  count: number
  identity: UserCardIdentity
}

export interface ParsedCard {
  uid: string
  quantity: number
  name: string
  nameFr: string
  nameEn: string
  setCode: string
  number: string
  paddedNumber: string
  foil?: string
  category: CardCategory
  subCategory: string
  setId: string
  setName: string
  serie: string
  cardId: string       // ex: "sv01-166" ou "sv03.5-004"
  unpaddedCardId: string // ex: "sv01-166" ou "sv03.5-4"
  ptcglId: string      // ex: "SVI-166" ou "MEW-4"
  imageUrl: string     // ex: "https://assets.tcgdex.net/fr/sv/sv01/166"
  isMapped: boolean
  isAceSpec?: boolean
  isRadiant?: boolean
  isEx?: boolean
  line: number
  raw: string
  identity: UserCardIdentity
}

export interface ParseWarning {
  line?: number
  message: string
}

export interface ParsedDeck {
  format: DeckFormat
  cards: ParsedCard[]
  totalCards: number
  pokemonCount: number
  trainerCount: number
  energyCount: number
  uniqueCardCount: number
  warnings: ParseWarning[]
}

export interface ExportOptions {
  lang?: 'fr' | 'en'
  format?: DeckFormat
  includeTotalCards?: boolean
}

export type IdFormatMode = 'tcgdex-padded' | 'tcgdex-raw' | 'ptcgl-code'
export type IdOutputStyle = 'list' | 'quantities' | 'target-json' | 'csv'

export interface SampleDeckPreset {
  id: string
  name: string
  subtitle: string
  lang: 'FR' | 'EN'
  badgeColor: string
  ptcglText: string
}
