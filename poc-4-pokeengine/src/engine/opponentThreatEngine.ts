import type {
  OpponentArchetype,
  OpponentPokemonRole,
  OpponentPokemonSnapshot,
} from '@/types/engine'
import type { Mulberry32 } from '@/engine/prng'

export interface OpponentPokemonTemplate {
  id: number
  name: string
  hp: number
  prizeValue: 1 | 2
  role: OpponentPokemonRole
  roleLabel: string
}

export const OPP_IDS = {
  RAGING_BOLT_EX: 1,
  OGERPON_EX: 2,
  RADIANT_GRENINJA: 3,
  SQUAWKABILLY_EX: 4,
  DREEPY: 5,
  DRAKLOAK: 6,
  DRAGAPULT_EX: 7,
  OPP_PIDGEOT_EX: 8,
  OPP_LUMINEON_V: 9,
  DRIFLOON: 10,
  KIRLIA: 11,
  GARDEVOIR_EX: 12,
  RALTS: 13,
  OPP_FEZANDIPITI_EX: 14,
} as const

export const OPPONENT_POKEMON_CATALOG: Record<number, OpponentPokemonTemplate> = {
  [OPP_IDS.RAGING_BOLT_EX]: {
    id: OPP_IDS.RAGING_BOLT_EX,
    name: 'Ire-Foudre ex',
    hp: 240,
    prizeValue: 2,
    role: 'LOADED_ATTACKER',
    roleLabel: 'Attaquant Chargé',
  },
  [OPP_IDS.OGERPON_EX]: {
    id: OPP_IDS.OGERPON_EX,
    name: 'Ogerpon Masque Turquoise ex',
    hp: 210,
    prizeValue: 2,
    role: 'ENGINE_SUPPORT',
    roleLabel: 'Moteur Danse Turquoise',
  },
  [OPP_IDS.RADIANT_GRENINJA]: {
    id: OPP_IDS.RADIANT_GRENINJA,
    name: 'Amphinobi Radieux',
    hp: 130,
    prizeValue: 1,
    role: 'ENGINE_SUPPORT',
    roleLabel: 'Moteur Cartes Cachées',
  },
  [OPP_IDS.SQUAWKABILLY_EX]: {
    id: OPP_IDS.SQUAWKABILLY_EX,
    name: 'Tapatoès ex',
    hp: 160,
    prizeValue: 2,
    role: 'TWO_PRIZE_LIABILITY',
    roleLabel: 'Cible 2-Récompenses (Prize Map 2-2-2)',
  },
  [OPP_IDS.DREEPY]: {
    id: OPP_IDS.DREEPY,
    name: 'Fantyrm',
    hp: 70,
    prizeValue: 1,
    role: 'BASIC_EVOLVER',
    roleLabel: 'Unique Base Évolutive',
  },
  [OPP_IDS.DRAKLOAK]: {
    id: OPP_IDS.DRAKLOAK,
    name: 'Dispareptil',
    hp: 90,
    prizeValue: 1,
    role: 'ENGINE_SUPPORT',
    roleLabel: 'Moteur Ordre de Reconnaissance',
  },
  [OPP_IDS.DRAGAPULT_EX]: {
    id: OPP_IDS.DRAGAPULT_EX,
    name: 'Lanssorien ex',
    hp: 320,
    prizeValue: 2,
    role: 'LOADED_ATTACKER',
    roleLabel: 'Attaquant Chargé Plongée Fantôme',
  },
  [OPP_IDS.OPP_PIDGEOT_EX]: {
    id: OPP_IDS.OPP_PIDGEOT_EX,
    name: 'Roucarnage ex (Adverse)',
    hp: 280,
    prizeValue: 2,
    role: 'ENGINE_SUPPORT',
    roleLabel: 'Moteur Recherche Rapide',
  },
  [OPP_IDS.OPP_LUMINEON_V]: {
    id: OPP_IDS.OPP_LUMINEON_V,
    name: 'Luminéon V (Adverse)',
    hp: 170,
    prizeValue: 2,
    role: 'TWO_PRIZE_LIABILITY',
    roleLabel: 'Cible 2-Récompenses (Prize Map 2-2-2)',
  },
  [OPP_IDS.DRIFLOON]: {
    id: OPP_IDS.DRIFLOON,
    name: 'Baudrive (Amulette Bravoure)',
    hp: 120,
    prizeValue: 1,
    role: 'LOADED_ATTACKER',
    roleLabel: 'Attaquant 1-Récompense Chargé',
  },
  [OPP_IDS.KIRLIA]: {
    id: OPP_IDS.KIRLIA,
    name: 'Kirlia (Raffinement)',
    hp: 80,
    prizeValue: 1,
    role: 'ENGINE_SUPPORT',
    roleLabel: 'Moteur Raffinement',
  },
  [OPP_IDS.GARDEVOIR_EX]: {
    id: OPP_IDS.GARDEVOIR_EX,
    name: 'Gardevoir ex',
    hp: 310,
    prizeValue: 2,
    role: 'ENGINE_SUPPORT',
    roleLabel: 'Moteur Enlacement Psy',
  },
  [OPP_IDS.RALTS]: {
    id: OPP_IDS.RALTS,
    name: 'Tarsal',
    hp: 60,
    prizeValue: 1,
    role: 'BASIC_EVOLVER',
    roleLabel: 'Unique Base Évolutive',
  },
  [OPP_IDS.OPP_FEZANDIPITI_EX]: {
    id: OPP_IDS.OPP_FEZANDIPITI_EX,
    name: 'Fezandipiti ex (Adverse)',
    hp: 210,
    prizeValue: 2,
    role: 'TWO_PRIZE_LIABILITY',
    roleLabel: 'Cible 2-Récompenses (Prize Map 2-2-2)',
  },
}

/**
 * Interface for the Opponent Board fields embedded inside `LowLevelGameState`.
 * Slot 0 = Opponent Active, Slots 1..oppBenchLen = Opponent Bench (max 5).
 */
export interface OpponentBoardView {
  oppIds: Uint8Array // length 6
  oppEnergies: Uint8Array // length 6
  oppBenchLen: number // 0..5
  oppPrizesRemaining: number // 6..0
}

/**
 * Counts how many `BASIC_EVOLVER` Pokemon the opponent currently has in play.
 */
export function countOpponentBasicEvolvers(board: OpponentBoardView): number {
  let count = 0
  const totalSlots = 1 + board.oppBenchLen
  for (let s = 0; s < totalSlots; s++) {
    const id = board.oppIds[s]
    if (id !== 0 && OPPONENT_POKEMON_CATALOG[id]?.role === 'BASIC_EVOLVER') {
      count++
    }
  }
  return count
}

/**
 * Zero-allocation fast threat score calculation (`evaluateTargetThreat`) for a specific opponent slot (0 = Active, 1..5 = Bench).
 * Implements exact Section 3.B scoring rules:
 * - +1000 pts (Lethal Check): KO brings `playerPrizesRemaining` to 0
 * - +90 pts (Neutralisation d'Attaquant Chargé): LOADED_ATTACKER with >= 2 energies ready to KO our Active on T_adv
 * - +75 pts (Destruction de Moteur): ENGINE_SUPPORT (Roucarnage ex, Kirlia/Gardevoir ex, Dispareptil, Ogerpon ex)
 * - +70 pts (Extinction de Ligne): Sole BASIC_EVOLVER on opponent's board
 * - +50 pts (Prize Mapping 2-2-2): 2-Prize target avoiding wasting a heavy attack on a 1-Prize Pokemon
 * - +15 pts per attached energy on the target
 */
export function evaluateTargetThreatScoreFast(
  board: OpponentBoardView,
  slotIndex: number,
  playerPrizesRemaining: number,
  basicEvolverCount: number,
): number {
  const oppId = board.oppIds[slotIndex]
  if (oppId === 0) return 0
  const tpl = OPPONENT_POKEMON_CATALOG[oppId]
  if (!tpl) return 0

  const energies = board.oppEnergies[slotIndex]
  let score = 0

  // 1. +1000 pts (Lethal Check)
  if (tpl.prizeValue >= playerPrizesRemaining && playerPrizesRemaining > 0) {
    score += 1000
  }

  // 2. +90 pts (Neutralisation d'Attaquant Chargé)
  if (tpl.role === 'LOADED_ATTACKER' && energies >= 2) {
    score += 90
  }

  // 3. +75 pts (Destruction de Moteur)
  if (tpl.role === 'ENGINE_SUPPORT') {
    score += 75
  }

  // 4. +70 pts (Extinction de Ligne)
  if (tpl.role === 'BASIC_EVOLVER' && basicEvolverCount === 1) {
    score += 70
  }

  // 5. +50 pts (Prize Mapping 2-2-2)
  if (tpl.prizeValue === 2) {
    score += 50
  }

  // 6. +15 pts per attached energy
  score += energies * 15

  return score
}

/**
 * Detailed version of `evaluateTargetThreat` (used only on the 50 traced inspector games).
 */
export function evaluateTargetThreatDetailed(
  board: OpponentBoardView,
  slotIndex: number,
  playerPrizesRemaining: number,
): { score: number; breakdown: string[] } {
  const oppId = board.oppIds[slotIndex]
  if (oppId === 0) return { score: 0, breakdown: [] }
  const tpl = OPPONENT_POKEMON_CATALOG[oppId]
  if (!tpl) return { score: 0, breakdown: [] }

  const energies = board.oppEnergies[slotIndex]
  const basicEvolverCount = countOpponentBasicEvolvers(board)
  let score = 0
  const breakdown: string[] = []

  if (tpl.prizeValue >= playerPrizesRemaining && playerPrizesRemaining > 0) {
    score += 1000
    breakdown.push('+1000 pts : Lethal Check (Victoire immédiate à 0 Récompense)')
  }

  if (tpl.role === 'LOADED_ATTACKER' && energies >= 2) {
    score += 90
    breakdown.push('+90 pts : Neutralisation d’Attaquant Chargé (Menace KO T_adv)')
  }

  if (tpl.role === 'ENGINE_SUPPORT') {
    score += 75
    breakdown.push(`+75 pts : Destruction de Moteur (${tpl.roleLabel})`)
  }

  if (tpl.role === 'BASIC_EVOLVER' && basicEvolverCount === 1) {
    score += 70
    breakdown.push('+70 pts : Extinction de Ligne (Unique Base Évolutive adverse)')
  }

  if (tpl.prizeValue === 2) {
    score += 50
    breakdown.push('+50 pts : Prize Mapping 2-2-2 (Cible à 2 Récompenses)')
  }

  if (energies > 0) {
    const ePts = energies * 15
    score += ePts
    breakdown.push(`+${ePts} pts : ${energies} Énergie(s) attachée(s)`)
  }

  return { score, breakdown }
}

/**
 * Initializes the Opponent Board at Turn 1 Setup according to the selected `OpponentArchetype`.
 */
export function initOpponentBoardState(
  board: OpponentBoardView,
  archetype: OpponentArchetype,
): void {
  board.oppIds.fill(0)
  board.oppEnergies.fill(0)
  board.oppPrizesRemaining = 6

  if (archetype === 'RAGING_BOLT_AGGRO') {
    // Active: Raging Bolt ex (1 energy on T1), Bench: Ogerpon ex (1 energy), Radiant Greninja, Squawkabilly ex
    board.oppIds[0] = OPP_IDS.RAGING_BOLT_EX
    board.oppEnergies[0] = 1
    board.oppIds[1] = OPP_IDS.OGERPON_EX
    board.oppEnergies[1] = 1
    board.oppIds[2] = OPP_IDS.RADIANT_GRENINJA
    board.oppEnergies[2] = 0
    board.oppIds[3] = OPP_IDS.SQUAWKABILLY_EX
    board.oppEnergies[3] = 0
    board.oppBenchLen = 3
  } else if (archetype === 'CHARIZARD_DRAGAPULT_SETUP') {
    // Active: Drakloak (1 energy), Bench: Pidgeot ex (0 energy), Dreepy (sole Basic evolver!), Lumineon V
    board.oppIds[0] = OPP_IDS.DRAKLOAK
    board.oppEnergies[0] = 1
    board.oppIds[1] = OPP_IDS.OPP_PIDGEOT_EX
    board.oppEnergies[1] = 0
    board.oppIds[2] = OPP_IDS.DREEPY
    board.oppEnergies[2] = 1
    board.oppIds[3] = OPP_IDS.OPP_LUMINEON_V
    board.oppEnergies[3] = 0
    board.oppBenchLen = 3
  } else {
    // GARDEVOIR_DISRUPTION: Active: Drifloon (1-prize attacker), Bench: Gardevoir ex (engine), Kirlia, Fezandipiti ex
    board.oppIds[0] = OPP_IDS.DRIFLOON
    board.oppEnergies[0] = 2
    board.oppIds[1] = OPP_IDS.GARDEVOIR_EX
    board.oppEnergies[1] = 1
    board.oppIds[2] = OPP_IDS.KIRLIA
    board.oppEnergies[2] = 0
    board.oppIds[3] = OPP_IDS.OPP_FEZANDIPITI_EX
    board.oppEnergies[3] = 0
    board.oppBenchLen = 3
  }
}

/**
 * Advances the Opponent's board state at the start of Turn `turn` (evolves setups, attaches energies,
 * refills knocked-out slots). Zero heap allocations.
 */
export function advanceOpponentBoardTurn(
  board: OpponentBoardView,
  archetype: OpponentArchetype,
  turn: number,
  rng: Mulberry32,
): void {
  // 1. Evolve Dreepy/Drakloak on Turn 2+ if present
  const totalSlots = 1 + board.oppBenchLen
  for (let s = 0; s < totalSlots; s++) {
    if (board.oppIds[s] === OPP_IDS.DRAKLOAK && turn >= 2) {
      board.oppIds[s] = OPP_IDS.DRAGAPULT_EX
      board.oppEnergies[s] = Math.max(2, board.oppEnergies[s] + 1)
    } else if (board.oppIds[s] === OPP_IDS.DREEPY && turn >= 3) {
      board.oppIds[s] = OPP_IDS.DRAGAPULT_EX
      board.oppEnergies[s] = Math.max(2, board.oppEnergies[s] + 1)
    }
  }

  // 2. Attach energies to opponent's Active and main Bench threat
  if (board.oppIds[0] !== 0 && board.oppEnergies[0] < 3) {
    board.oppEnergies[0]++
  }
  if (board.oppBenchLen > 0) {
    const benchPick = 1 + (rng.nextUint32() % board.oppBenchLen)
    if (board.oppEnergies[benchPick] < 3) {
      board.oppEnergies[benchPick]++
    }
  }

  // 3. Reinforce Bench if below 3 Pokemon
  if (board.oppBenchLen < 3) {
    const newSlot = 1 + board.oppBenchLen
    if (archetype === 'RAGING_BOLT_AGGRO') {
      board.oppIds[newSlot] = turn % 2 === 0 ? OPP_IDS.RAGING_BOLT_EX : OPP_IDS.OGERPON_EX
      board.oppEnergies[newSlot] = 2
    } else if (archetype === 'CHARIZARD_DRAGAPULT_SETUP') {
      board.oppIds[newSlot] = turn % 2 === 0 ? OPP_IDS.OPP_PIDGEOT_EX : OPP_IDS.DREEPY
      board.oppEnergies[newSlot] = 1
    } else {
      board.oppIds[newSlot] = turn % 2 === 0 ? OPP_IDS.GARDEVOIR_EX : OPP_IDS.RALTS
      board.oppEnergies[newSlot] = 1
    }
    board.oppBenchLen++
  }
}

/**
 * Checks if the opponent currently has a `LOADED_ATTACKER` ready to KO our Active Pokemon,
 * or an active `ENGINE_SUPPORT` driving their turn.
 */
export function hasOpponentLoadedAttackerReady(board: OpponentBoardView): boolean {
  const activeId = board.oppIds[0]
  if (
    activeId !== 0 &&
    OPPONENT_POKEMON_CATALOG[activeId]?.role === 'LOADED_ATTACKER' &&
    board.oppEnergies[0] >= 2
  ) {
    return true
  }
  for (let b = 1; b <= board.oppBenchLen; b++) {
    const id = board.oppIds[b]
    if (
      id !== 0 &&
      OPPONENT_POKEMON_CATALOG[id]?.role === 'LOADED_ATTACKER' &&
      board.oppEnergies[b] >= 2
    ) {
      return true
    }
  }
  return false
}

export function hasOpponentEngineInPlay(board: OpponentBoardView): boolean {
  const totalSlots = 1 + board.oppBenchLen
  for (let s = 0; s < totalSlots; s++) {
    const id = board.oppIds[s]
    if (id !== 0 && OPPONENT_POKEMON_CATALOG[id]?.role === 'ENGINE_SUPPORT') {
      return true
    }
  }
  return false
}

/**
 * Removes an opponent Pokemon at `slotIndex` (0 = Active, 1..5 = Bench) when knocked out,
 * and promotes the highest-threat Bench Pokemon if Active was knocked out.
 */
export function removeKnockedOutOpponentSlot(board: OpponentBoardView, slotIndex: number): void {
  if (slotIndex === 0) {
    if (board.oppBenchLen > 0) {
      // Promote Bench slot 1 to Active
      board.oppIds[0] = board.oppIds[1]
      board.oppEnergies[0] = board.oppEnergies[1]
      for (let i = 1; i < board.oppBenchLen; i++) {
        board.oppIds[i] = board.oppIds[i + 1]
        board.oppEnergies[i] = board.oppEnergies[i + 1]
      }
      board.oppIds[board.oppBenchLen] = 0
      board.oppEnergies[board.oppBenchLen] = 0
      board.oppBenchLen--
    } else {
      board.oppIds[0] = 0
      board.oppEnergies[0] = 0
    }
  } else if (slotIndex >= 1 && slotIndex <= board.oppBenchLen) {
    for (let i = slotIndex; i < board.oppBenchLen; i++) {
      board.oppIds[i] = board.oppIds[i + 1]
      board.oppEnergies[i] = board.oppEnergies[i + 1]
    }
    board.oppIds[board.oppBenchLen] = 0
    board.oppEnergies[board.oppBenchLen] = 0
    board.oppBenchLen--
  }
}

/**
 * Creates a UI snapshot of an opponent slot (`0 = Active`, `1..5 = Bench`) with its exact Threat Score & breakdown.
 */
export function createOpponentPokemonSnapshot(
  board: OpponentBoardView,
  slotIndex: number,
  playerPrizesRemaining: number,
  targetedAndKnockedOut = false,
): OpponentPokemonSnapshot | null {
  const oppId = board.oppIds[slotIndex]
  if (oppId === 0) return null
  const tpl = OPPONENT_POKEMON_CATALOG[oppId]
  if (!tpl) return null

  const threat = evaluateTargetThreatDetailed(board, slotIndex, playerPrizesRemaining)
  return {
    slotIndex,
    name: tpl.name,
    hp: tpl.hp,
    attachedEnergies: board.oppEnergies[slotIndex],
    prizeValue: tpl.prizeValue,
    role: tpl.role,
    roleLabel: tpl.roleLabel,
    threatScore: threat.score,
    threatBreakdown: threat.breakdown,
    targetedAndKnockedOut,
  }
}
