export type CardCategory = 'pokemon' | 'supporter' | 'item' | 'tool' | 'stadium' | 'ace_spec' | 'energy'

export interface Card {
  id: string
  name: string
  nameEn: string
  category: CardCategory
  count: number
  set: string
  number: string
  rarity?: string
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
  sensitivityCategory: 'energy' | 'search' | 'draw' | 'setup'
  impactText: string
}

export interface Archetype {
  id: 'dragapult-xatu' | 'charizard-pidgeot'
  name: string
  nameEn: string
  subname: string
  tier: string
  coreCount: number
  flexSlotsCount: number
  description: string
  primaryColor: string
  accentColor: string
  badgeText: string
  coreCards: Card[]
  candidates: CandidateCard[]
  standardFlexAllocation: Record<string, number>
  baseStats: {
    turn2SetupRate: number
    deadHandRisk: number
    disruptionResilience: number
  }
}

export interface TournamentMeta {
  aggroRate: number // e.g. 45% (Ire-Foudre ex, Rugit-Lune)
  evolutionRate: number // e.g. 35% (Dracaufeu ex, Lanssorien ex)
  controlRate: number // e.g. 20% (Gardevoir ex, Ronflex Stall)
}

export type OptimizationTargetId = 'turn2_speed' | 'anti_brick' | 'late_game_resilience'

export interface OptimizationTarget {
  id: OptimizationTargetId
  label: string
  shortLabel: string
  description: string
  impactSummary: string
  icon: string
}

export interface EnergySensitivityPoint {
  energyCount: number
  underpowerRisk: number // Underpowered / cannot attack T2 (%)
  brickRisk: number // Drawing dead with too many energies (%)
  optimalScore: number // Overall efficiency (0-100)
  status: 'critical_low' | 'suboptimal' | 'optimal' | 'surcharge'
  recommendation: string
}

export interface OptimizationResult {
  archetypeId: string
  prescribedAllocation: Record<string, number>
  standardAllocation: Record<string, number>
  totalFlexSlots: number
  standardScore: number
  optimizedScore: number
  gainPercentage: number
  rationaleList: {
    cardId: string
    cardName: string
    diff: number // e.g. +1, -1, 0
    recommendedCount: number
    standardCount: number
    reason: string
  }[]
  matchupPerformance: {
    aggro: { standard: number; optimized: number }
    evolution: { standard: number; optimized: number }
    control: { standard: number; optimized: number }
  }
  energySensitivity: EnergySensitivityPoint[]
  exploredPermutations: number
  evaluationTimeMs: number
}
