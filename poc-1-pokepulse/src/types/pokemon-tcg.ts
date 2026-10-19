export type CardRole = 
  | 'basic_pokemon'
  | 'evolution_pokemon'
  | 'search_engine'
  | 'accelerator_item'
  | 'supporter'
  | 'energy'

export interface CardItem {
  id: string
  name: string
  frenchName: string
  count: number
  role: CardRole
  set: string
  setNumber: string
  hp?: number
  isEx?: boolean
  isV?: boolean
  isAceSpec?: boolean
  isRadiant?: boolean
  tag?: string
  energyType?: string
}

export interface DeckPreset {
  id: string
  name: string
  subtitle: string
  coverCard: string
  ptcglText: string
  cards: CardItem[]
}

export type OpponentId = 'goldfish' | 'aggro_turbo' | 'mirror_setup' | 'disruption'

export interface OpponentOption {
  id: OpponentId
  name: string
  shortDesc: string
}

export interface SimplifiedResult {
  deckName: string
  opponentName: string
  scorePercent: number // e.g. 78
  verdictSentence: string
  turn1ReadyPercent: number // e.g. 86
  turn2AttackPercent: number // e.g. 78
  brickRiskPercent: number // e.g. 14
  failureCauses: {
    label: string
    percent: number
  }[]
}
