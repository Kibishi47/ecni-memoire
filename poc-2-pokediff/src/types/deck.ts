export type CardCategory = 'pokemon' | 'supporter' | 'item' | 'tool' | 'stadium' | 'energy'

export interface Card {
  id: string
  name: string
  nameEn: string
  category: CardCategory
  typeIcon: string // color or icon identifier
  hp?: number
  subtypes?: string[] // e.g. ['Basic', 'ex', 'Radiant', 'Search', 'Draw', 'Gust', 'Recovery']
  countA: number // count in Reference Deck A (fixed default 60)
  countB: number // count in Variant Deck B (editable)
  min: number
  max: number
  roleDescription: string
  isFlexSpot?: boolean
  artUrl?: string
}

export interface DeckDiff {
  cardId: string
  cardName: string
  cardNameEn: string
  category: CardCategory
  delta: number // +1, -1, etc.
  from: number
  to: number
}

export interface ScenarioPreset {
  id: string
  title: string
  subtitle: string
  tag: string
  description: string
  changes: {
    cardId: string
    delta: number
  }[]
  verdictContext: {
    pro: string
    con: string
    recommendation: string
  }
}

export interface MatchupScore {
  name: string
  opponentDeck: string
  opponentArchetype: 'Aggro' | 'Setup' | 'Disruption'
  keyMetricName: string
  metricDescription: string
  rateA: number
  rateB: number
  delta: number
  favorableVariant: 'A' | 'B' | 'neutral'
  badgeLabel: string
  tooltip: string
}

export interface CriticalMetric {
  id: string
  name: string
  description: string
  rateA: number
  rateB: number
  delta: number
  lowerIsBetter?: boolean
  unit: string
  benchmarkNote: string
}

export interface SimulationResult {
  seed: number
  sampleSize: number
  durationMs: number
  deckACount: number
  deckBCount: number
  isValidComparison: boolean
  matchups: MatchupScore[]
  criticalMetrics: CriticalMetric[]
  verdict: {
    summary: string
    strategicRecommendation: string
    confidenceScore: number // e.g. 98.4%
    keyTradeOff: string
    archetypeFocus: string
  }
}

export interface PairedSeedSample {
  seedIndex: number
  seedHash: string
  deckAHand: string[]
  deckBHand: string[]
  deckAPrizes: string[]
  deckBPrizes: string[]
  deckAT1BenchCount: number
  deckBT1BenchCount: number
  deckAT2CandySuccess: boolean
  deckBT2CandySuccess: boolean
  outcomeDiff: string
}
