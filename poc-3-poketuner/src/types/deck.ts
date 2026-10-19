export type CardCategory = 'pokemon' | 'supporter' | 'item' | 'tool' | 'stadium' | 'ace_spec' | 'energy'

export interface Card {
  id: string
  name: string
  nameEn: string
  category: CardCategory
  count: number
  set: string
  number: string
  roleDescription?: string
}

export interface CandidateCard {
  id: string
  name: string
  nameEn: string
  category: CardCategory
  minCount: number
  maxCount: number
  standardCount: number
  set: string
  number: string
  role: string
}

export interface Archetype {
  id: 'charizard-pidgeot' | 'dragapult-xatu'
  name: string
  nameEn: string
  subtitle: string
  coreCount: number
  flexSlotsCount: number
  description: string
  iconName: string
  badgeColor: string
  coreCards: Card[]
  candidates: CandidateCard[]
  standardFlexAllocation: Record<string, number>
}

export interface TournamentMeta {
  aggroRate: number // e.g. 50%
  evolutionRate: number // e.g. 35%
  controlRate: number // e.g. 15%
}

export type OptimizationTargetId = 'anti_brick' | 'turn2_speed'

export interface OptimizationTarget {
  id: OptimizationTargetId
  label: string
  shortLabel: string
  description: string
}

export interface RecommendedCardItem {
  cardId: string
  cardName: string
  recommendedCount: number
  standardCount: number
  diff: number
  badgeText?: string
  badgeType?: 'success' | 'info' | 'neutral'
  simpleExplanation: string
}

export interface OptimizationResult {
  archetypeId: string
  archetypeName: string
  metaPresetName: string
  totalFlexSlots: number
  recommendedCards: RecommendedCardItem[]
  prescribedAllocation: Record<string, number>
  whyText: string
  deadHandReductionPercent: number
  energyRecommendationSummary: string
}
