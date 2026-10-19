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
  energyType?: 'fire' | 'water' | 'grass' | 'lightning' | 'psychic' | 'fighting' | 'darkness' | 'metal' | 'colorless'
}

export interface DeckPreset {
  id: string
  name: string
  archetype: string
  description: string
  difficulty: 'Facile' | 'Intermédiaire' | 'Expert'
  tempo: 'Aggro T1/T2' | 'Midrange Niv.2' | 'Contrôle Setup'
  coverCard: string
  badgeColor: string
  ptcglText: string
  cards: CardItem[]
}

export type OpponentId = 'goldfish' | 'aggro_turbo' | 'mirror_setup' | 'disruption'

export interface OpponentGauntlet {
  id: OpponentId
  name: string
  archetype: string
  subtitle: string
  pressureLevel: 'Nulle' | 'Critique T2' | 'Élevée T2' | 'Asphyxie T3'
  pressureRating: number // 0 to 10
  clockDescription: string
  criticalTurn: number
  badgeColor: string
  threatDescription: string
  tacticalRequirement: string
  iconName: string
}

export interface TurnDataPoint {
  turn: number
  label: string
  playerSuccessRate: number
  opponentThreatLevel: number
  status: 'safe' | 'contested' | 'danger'
  turnInsight: string
}

export interface BrickBreakdown {
  missingBasics: number // %
  energyDrought: number // %
  prizedPieces: number // %
  postDisruption: number // %
}

export interface ActionableAlert {
  type: 'danger' | 'warning' | 'info' | 'success'
  headline: string
  detail: string
  statHighlight: string
  recommendation: string
}

export interface SimulationResult {
  deckId: string
  opponentId: OpponentId
  goingFirst: boolean
  sampleRuns: number // 10000
  consistencyScore: number // Score de Régularité Sous Pression (e.g. 82.4%)
  idealSetupT2Rate: number // Setup Idéal Tour 2 (e.g. 76.8%)
  t1BrickRate: number // Main Morte / Brick T1 (e.g. 11.2%)
  forcedMulliganRate: number // Mulligan forcé (e.g. 7.6%)
  avgMulligansGifted: number // Cartes offertes moyennes (e.g. 0.12)
  turnProgression: TurnDataPoint[]
  brickBreakdown: BrickBreakdown
  alert: ActionableAlert
  simulatedAt: number
}

export interface RoleMetadata {
  id: CardRole
  label: string
  shortLabel: string
  description: string
  color: string
  badgeBg: string
  badgeText: string
  borderColor: string
  icon: string
}
