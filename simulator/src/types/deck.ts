import type { CardCategory, CardSubCategory, EngineCardModel, SynergyRequirement } from './cardModel'

export type DeckSectionCategory = 'pokemon' | 'trainer' | 'energy'
export type DeckFormat = 'ptcgl' | 'limitless'

export interface ParsedDeckEntry {
  uid: string
  quantity: number
  name: string
  nameFr: string
  nameEn: string
  setCode: string
  number: string
  paddedNumber: string
  foil?: string
  category: DeckSectionCategory
  upperCategory: CardCategory
  subCategory: CardSubCategory
  setId: string
  setName: string
  serie: string
  cardId: string
  unpaddedCardId: string
  ptcglId: string
  imageUrl: string
  isAceSpec?: boolean
  isRadiant?: boolean
  isEx?: boolean
  line: number
  raw: string
  model: EngineCardModel
  resolvedFromSource: 'compiled_db' | 'fallback_registry' | 'synthesized'
}

export interface ParseWarning {
  line?: number
  message: string
}

export interface SynergyAuditItem {
  cardId: string
  cardNameFr: string
  requirement: SynergyRequirement
  matchingCountInDeck: number
  satisfied: boolean
  criticalZeroValue: boolean
  description: string
}

export interface ParsedDeck {
  format: DeckFormat
  cards: ParsedDeckEntry[]
  totalCards: number
  pokemonCount: number
  trainerCount: number
  energyCount: number
  basicPokemonCount: number
  uniqueCardCount: number
  isValid60: boolean
  hasAtLeastOneBasic: boolean
  warnings: ParseWarning[]
  synergyAudit: SynergyAuditItem[]
}

export interface ExportOptions {
  lang?: 'fr' | 'en'
  format?: DeckFormat
  includeTotalCards?: boolean
}

export interface MetaOpponentDeck {
  id: string
  name: string
  archetypeBadge: string
  strategySubtitle: string
  description: string
  keyThreats: string[]
  badgeColor: string
  ptcglText: string
}
