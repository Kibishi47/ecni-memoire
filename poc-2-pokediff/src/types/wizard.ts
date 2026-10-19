export type DeckArchetype = 'dracaufeu' | 'lanssorien'

export interface DeckProfile {
  id: DeckArchetype
  name: string
  subtitle: string
  badge: string
  energyName: string
  energyId: string
  energyDefaultCount: number
  keyCardsSummary: string
  description: string
}

export interface KeyCardItem {
  id: string
  name: string
  role: string
  icon: string
  defaultCount: number
  currentCount: number
  min: number
  max: number
}

export interface PresetChange {
  id: string
  title: string
  tag: string
  removeCardId: string
  removeCardName: string
  addCardId: string
  addCardName: string
  description: string
}

export interface MetricCardData {
  label: string
  sublabel: string
  before: number
  after: number
  delta: number
  badgeText: string
  badgeType: 'positive' | 'negative' | 'neutral'
  description: string
}

export interface OpponentImpactItem {
  category: string
  archetypeExample: string
  impactBadge: string
  impactType: 'positive' | 'negative' | 'neutral'
  description: string
}

export interface WizardResult {
  changeSummary: string
  verdictOneLiner: string
  isRecommended: boolean
  stabilityT1: MetricCardData
  speedT2: MetricCardData
  energyRisk: MetricCardData
  opponentImpacts: OpponentImpactItem[]
}
