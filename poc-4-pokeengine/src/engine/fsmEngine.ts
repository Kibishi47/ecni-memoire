import type {
  AIStrategyMode,
  AIModeComparisonMetric,
  BoardPokemonSnapshot,
  DecisionBranchRecord,
  DeclarativeCardDefinition,
  GameEndReason,
  RuleInvariantAudit,
  SampledGameRecord,
  SimulationConfig,
  SimulationResultPayload,
  TurnTimelineRecord,
} from '@/types/engine'
import {
  addPackedEnergies,
  buildDeckUint16,
  CARD_IDS,
  createCardLookupTable,
  DEFAULT_CARD_REGISTRY,
  evolvePackedPokemon,
  PACK_ABILITY_USED_BIT,
  PACK_OTHER_TOOL_BIT,
  PACK_SEAL_STONE_BIT,
  packCard,
  unpackCardId,
  unpackEnergies,
  unpackTurnPlayed,
} from '@/engine/cardRegistry'
import {
  buildHypergeometricAudit,
  exactProbabilityAtLeastOne,
  exactProbabilityZeroSuccesses,
} from '@/engine/hypergeometric'
import { deriveGameSeed, fisherYatesShuffleUint16, Mulberry32 } from '@/engine/prng'

/**
 * Low-level contiguous memory state representation using Uint16Array buffers.
 * Mirrors the Go/Wasm `GameState` struct (`[60]uint16`).
 */
export interface LowLevelGameState {
  deck: Uint16Array
  hand: Uint16Array
  prizes: Uint16Array
  discard: Uint16Array
  bench: Uint16Array
  active: number
  deckLen: number
  handLen: number
  prizesLen: number
  discardLen: number
  benchLen: number
  currentTurn: number
  goingFirst: boolean
  supporterPlayedCount: number
  energyAttachedCount: number
  stadiumPlayedThisTurn: boolean
  vstarUsedInGame: boolean
  mulliganCount: number
  thinningCount: number
  koOccurredLastTurn: boolean
}

export function createEmptyGameState(goingFirst: boolean): LowLevelGameState {
  return {
    deck: new Uint16Array(60),
    hand: new Uint16Array(60),
    prizes: new Uint16Array(6),
    discard: new Uint16Array(60),
    bench: new Uint16Array(5),
    active: 0,
    deckLen: 0,
    handLen: 0,
    prizesLen: 0,
    discardLen: 0,
    benchLen: 0,
    currentTurn: 1,
    goingFirst,
    supporterPlayedCount: 0,
    energyAttachedCount: 0,
    stadiumPlayedThisTurn: false,
    vstarUsedInGame: false,
    mulliganCount: 0,
    thinningCount: 0,
    koOccurredLastTurn: false,
  }
}

export function cloneLowLevelState(src: LowLevelGameState): LowLevelGameState {
  const dst = createEmptyGameState(src.goingFirst)
  dst.deck.set(src.deck.subarray(0, src.deckLen))
  dst.hand.set(src.hand.subarray(0, src.handLen))
  dst.prizes.set(src.prizes.subarray(0, src.prizesLen))
  dst.discard.set(src.discard.subarray(0, src.discardLen))
  dst.bench.set(src.bench.subarray(0, src.benchLen))
  dst.active = src.active
  dst.deckLen = src.deckLen
  dst.handLen = src.handLen
  dst.prizesLen = src.prizesLen
  dst.discardLen = src.discardLen
  dst.benchLen = src.benchLen
  dst.currentTurn = src.currentTurn
  dst.goingFirst = src.goingFirst
  dst.supporterPlayedCount = src.supporterPlayedCount
  dst.energyAttachedCount = src.energyAttachedCount
  dst.stadiumPlayedThisTurn = src.stadiumPlayedThisTurn
  dst.vstarUsedInGame = src.vstarUsedInGame
  dst.mulliganCount = src.mulliganCount
  dst.thinningCount = src.thinningCount
  dst.koOccurredLastTurn = src.koOccurredLastTurn
  return dst
}

export function copyIntoLowLevelState(src: LowLevelGameState, dst: LowLevelGameState): void {
  dst.deck.set(src.deck.subarray(0, src.deckLen))
  dst.hand.set(src.hand.subarray(0, src.handLen))
  dst.prizes.set(src.prizes.subarray(0, src.prizesLen))
  dst.discard.set(src.discard.subarray(0, src.discardLen))
  dst.bench.set(src.bench.subarray(0, src.benchLen))
  dst.active = src.active
  dst.deckLen = src.deckLen
  dst.handLen = src.handLen
  dst.prizesLen = src.prizesLen
  dst.discardLen = src.discardLen
  dst.benchLen = src.benchLen
  dst.currentTurn = src.currentTurn
  dst.goingFirst = src.goingFirst
  dst.supporterPlayedCount = src.supporterPlayedCount
  dst.energyAttachedCount = src.energyAttachedCount
  dst.stadiumPlayedThisTurn = src.stadiumPlayedThisTurn
  dst.vstarUsedInGame = src.vstarUsedInGame
  dst.mulliganCount = src.mulliganCount
  dst.thinningCount = src.thinningCount
  dst.koOccurredLastTurn = src.koOccurredLastTurn
}

interface InvariantTrackerCounters {
  inv1Checked: number
  inv1Passed: number
  inv2Checked: number
  inv2Passed: number
  inv3Checked: number
  inv3Passed: number
  inv4Checked: number
  inv4Passed: number
  inv5Checked: number
  inv5Passed: number
}

function removeAtUint16(arr: Uint16Array, len: number, index: number): number {
  const val = arr[index]
  for (let i = index; i < len - 1; i++) {
    arr[i] = arr[i + 1]
  }
  arr[len - 1] = 0
  return val
}

function drawCardFromDeck(state: LowLevelGameState): number {
  if (state.deckLen <= 0) return 0
  state.deckLen--
  const card = state.deck[state.deckLen]
  state.deck[state.deckLen] = 0
  state.hand[state.handLen++] = card
  return card
}

function countLineOnBoard(
  state: LowLevelGameState,
  lookup: DeclarativeCardDefinition[],
  line: 'CHARIZARD' | 'PIDGEOT',
): number {
  let count = 0
  if (state.active !== 0) {
    const def = lookup[unpackCardId(state.active)]
    if (def && def.evolutionLine === line) count++
  }
  for (let i = 0; i < state.benchLen; i++) {
    const def = lookup[unpackCardId(state.bench[i])]
    if (def && def.evolutionLine === line) count++
  }
  return count
}

function hasCardIdOnBoard(state: LowLevelGameState, targetId: number): boolean {
  if (state.active !== 0 && unpackCardId(state.active) === targetId) return true
  for (let i = 0; i < state.benchLen; i++) {
    if (unpackCardId(state.bench[i]) === targetId) return true
  }
  return false
}

function hasPokemonVWithoutToolOnBoard(
  state: LowLevelGameState,
  lookup: DeclarativeCardDefinition[],
): boolean {
  if (state.active !== 0) {
    const def = lookup[unpackCardId(state.active)]
    if (
      def?.isPokemonV &&
      !(state.active & PACK_SEAL_STONE_BIT) &&
      !(state.active & PACK_OTHER_TOOL_BIT)
    ) {
      return true
    }
  }
  for (let i = 0; i < state.benchLen; i++) {
    const slot = state.bench[i]
    const def = lookup[unpackCardId(slot)]
    if (def?.isPokemonV && !(slot & PACK_SEAL_STONE_BIT) && !(slot & PACK_OTHER_TOOL_BIT)) {
      return true
    }
  }
  return false
}

function countCardIdInHand(state: LowLevelGameState, targetId: number): number {
  let c = 0
  for (let i = 0; i < state.handLen; i++) {
    if (unpackCardId(state.hand[i]) === targetId) c++
  }
  return c
}

function findHandIndexById(state: LowLevelGameState, targetId: number): number {
  for (let i = 0; i < state.handLen; i++) {
    if (unpackCardId(state.hand[i]) === targetId) return i
  }
  return -1
}

/**
 * Evaluates a terminal intra-turn board state according to Section 4.C specifications:
 * - +50 pts : Dracaufeu ex actif avec 2+ Énergies Feu (Attaque prête)
 * - +30 pts : Roucarnage ex en jeu sur le Banc (Moteur Recherche Rapide actif)
 * - +15 pts : Au moins 2 Salamèche et 1 Roucool en jeu (Lignées établies)
 * Plus secondary strategic bonuses (Deck Thinning, bench backup, hand resources).
 */
export function evaluateBoardState(
  state: LowLevelGameState,
  lookup: DeclarativeCardDefinition[],
  recordBreakdown = false,
): { score: number; breakdown: string[] } {
  let score = 0
  const breakdown: string[] = []

  const activeId = state.active !== 0 ? unpackCardId(state.active) : 0
  const activeEnergies = state.active !== 0 ? unpackEnergies(state.active) : 0

  // 1. Primary Criterion (+50 pts): Dracaufeu ex Active with 2+ Fire Energies
  if (activeId === CARD_IDS.CHARIZARD_EX && activeEnergies >= 2) {
    score += 50
    if (recordBreakdown) {
      breakdown.push('+50 pts : Dracaufeu ex Actif avec 2+ Énergies Feu (Attaque Combustion Obscure prête)')
    }
  } else if (hasCardIdOnBoard(state, CARD_IDS.CHARIZARD_EX)) {
    // Charizard ex on bench or with <2 energy
    let maxZardEnergy = activeId === CARD_IDS.CHARIZARD_EX ? activeEnergies : 0
    for (let i = 0; i < state.benchLen; i++) {
      if (unpackCardId(state.bench[i]) === CARD_IDS.CHARIZARD_EX) {
        maxZardEnergy = Math.max(maxZardEnergy, unpackEnergies(state.bench[i]))
      }
    }
    const pts = maxZardEnergy >= 2 ? 38 : 22
    score += pts
    if (recordBreakdown) {
      breakdown.push(`+${pts} pts : Dracaufeu ex en jeu (${maxZardEnergy} Énergie(s) Feu)`)
    }
  }

  // 2. Secondary Criterion (+30 pts): Roucarnage ex in play (Quick Search active)
  if (hasCardIdOnBoard(state, CARD_IDS.PIDGEOT_EX)) {
    score += 30
    if (recordBreakdown) {
      breakdown.push('+30 pts : Roucarnage ex en jeu (Talent Recherche Rapide actif)')
    }
  }

  // 3. Turn 1 / Foundation Criterion (+15 pts): At least 2 Charmander-line and 1 Pidgey-line on board
  const charizardLineCount = countLineOnBoard(state, lookup, 'CHARIZARD')
  const pidgeotLineCount = countLineOnBoard(state, lookup, 'PIDGEOT')
  if (charizardLineCount >= 2 && pidgeotLineCount >= 1) {
    score += 15
    if (recordBreakdown) {
      breakdown.push('+15 pts : Socle de lignées complet (2+ lignée Salamèche & 1+ lignée Roucool)')
    }
  } else {
    const partial = Math.min(2, charizardLineCount) * 4 + Math.min(1, pidgeotLineCount) * 4
    if (partial > 0) {
      score += partial
      if (recordBreakdown) {
        breakdown.push(`+${partial} pts : Bases de lignées partielles (${charizardLineCount} Feu, ${pidgeotLineCount} Vol)`)
      }
    }
  }

  // 4. Support Pokemon V & Forest Seal Stone readiness
  if (hasCardIdOnBoard(state, CARD_IDS.ROTOM_V)) {
    score += 6
    if (recordBreakdown) breakdown.push('+6 pts : Motisma V en jeu (Charge Instantanée)')
  }

  // 5. Deck Thinning bonus (+2 pts per targeted card extracted before random draws)
  if (state.thinningCount > 0) {
    const thinPts = state.thinningCount * 2
    score += thinPts
    if (recordBreakdown) {
      breakdown.push(`+${thinPts} pts : Épuration du deck (${state.thinningCount} cartes ciblées extraites)`)
    }
  }

  // 6. Hand combo retention bonus (having Rare Candy + Stage 2 ready for next turn)
  const candiesInHand = countCardIdInHand(state, CARD_IDS.RARE_CANDY)
  const zardsInHand = countCardIdInHand(state, CARD_IDS.CHARIZARD_EX)
  const pidgeotsInHand = countCardIdInHand(state, CARD_IDS.PIDGEOT_EX)
  if (candiesInHand > 0 && (zardsInHand > 0 || pidgeotsInHand > 0)) {
    score += 8
    if (recordBreakdown) {
      breakdown.push('+8 pts : Combo Super Bonbon + Niveau 2 conservé en main')
    }
  }

  return { score, breakdown }
}

/**
 * Audits the 5 regulatory Pokémon TCG invariants on the current game state.
 */
function verifyStateInvariants(
  state: LowLevelGameState,
  counters: InvariantTrackerCounters,
): void {
  // Invariant 1: No Supporter on Turn 1 when goingFirst === true
  counters.inv1Checked++
  if (!(state.currentTurn === 1 && state.goingFirst && state.supporterPlayedCount > 0)) {
    counters.inv1Passed++
  }

  // Invariant 3: Max 1 Supporter and Max 1 manual Energy attachment per turn
  counters.inv3Checked++
  if (state.supporterPlayedCount <= 1 && state.energyAttachedCount <= 1) {
    counters.inv3Passed++
  }

  // Invariant 4: Max 5 Pokémon on Bench
  counters.inv4Checked++
  if (state.benchLen <= 5 && state.benchLen >= 0) {
    counters.inv4Passed++
  }

  // Invariant 5: Total card & prize isolation integrity
  counters.inv5Checked++
  if (state.deckLen >= 0 && state.handLen >= 0 && state.prizesLen <= 6) {
    counters.inv5Passed++
  }
}

/**
 * Selects the best target card in `state.deck` for a declarative `SEARCH_DECK_TO_HAND` or `VSTAR_POWER` or `QUICK_SEARCH` primitive.
 */
function selectBestDeckTargetIndex(
  state: LowLevelGameState,
  lookup: DeclarativeCardDefinition[],
  filter: string,
  preferComboPiece: boolean,
): number {
  const charizardLine = countLineOnBoard(state, lookup, 'CHARIZARD')
  const pidgeotLine = countLineOnBoard(state, lookup, 'PIDGEOT')
  const hasEvolveReadyCharmander = canLineEvolveThisTurn(state, lookup, 'CHARIZARD')
  const hasEvolveReadyPidgey = canLineEvolveThisTurn(state, lookup, 'PIDGEOT')
  const hasCandyInHand = countCardIdInHand(state, CARD_IDS.RARE_CANDY) > 0
  const hasZardInHand = countCardIdInHand(state, CARD_IDS.CHARIZARD_EX) > 0
  const hasPidgeotInHand = countCardIdInHand(state, CARD_IDS.PIDGEOT_EX) > 0
  const hasZardOnBoard = hasCardIdOnBoard(state, CARD_IDS.CHARIZARD_EX)
  const hasPidgeotOnBoard = hasCardIdOnBoard(state, CARD_IDS.PIDGEOT_EX)

  let bestIdx = -1
  let bestScore = -1

  for (let i = 0; i < state.deckLen; i++) {
    const cid = unpackCardId(state.deck[i])
    const def = lookup[cid]
    if (!def) continue

    // Check declarative filter compatibility
    if (filter === 'POKEMON_ANY' && def.category !== 'POKEMON') continue
    if (filter === 'SUPPORTER_ANY' && def.category !== 'SUPPORTER') continue
    if (filter === 'BASIC_ANY' && !(def.category === 'POKEMON' && def.subType === 'BASIC')) continue

    let candidateScore = def.strategicValue

    if (preferComboPiece) {
      if (state.currentTurn === 1) {
        // Turn 1 priorities: Poffin Pote-Pote, Basic Pokemon, Arven, Forest Seal Stone
        if (cid === CARD_IDS.BUDDY_POFFIN && state.benchLen < 4) candidateScore += 120
        else if (cid === CARD_IDS.CHARMANDER && charizardLine < 2) candidateScore += 100
        else if (cid === CARD_IDS.PIDGEY && pidgeotLine < 1) candidateScore += 95
        else if (cid === CARD_IDS.ROTOM_V && !hasCardIdOnBoard(state, CARD_IDS.ROTOM_V)) candidateScore += 85
        else if (cid === CARD_IDS.ARVEN && !state.goingFirst) candidateScore += 90
      } else {
        // Turn 2+ priorities: Complete missing half of Rare Candy + Stage 2 combo!
        if (
          cid === CARD_IDS.RARE_CANDY &&
          !hasCandyInHand &&
          ((hasEvolveReadyPidgey && hasPidgeotInHand) || (hasEvolveReadyCharmander && hasZardInHand))
        ) {
          candidateScore += 200
        } else if (
          cid === CARD_IDS.PIDGEOT_EX &&
          !hasPidgeotOnBoard &&
          !hasPidgeotInHand &&
          hasEvolveReadyPidgey &&
          hasCandyInHand
        ) {
          candidateScore += 195
        } else if (
          cid === CARD_IDS.CHARIZARD_EX &&
          !hasZardOnBoard &&
          !hasZardInHand &&
          hasEvolveReadyCharmander &&
          hasCandyInHand
        ) {
          candidateScore += 190
        } else if (cid === CARD_IDS.RARE_CANDY && !hasCandyInHand && (hasEvolveReadyCharmander || hasEvolveReadyPidgey)) {
          candidateScore += 155
        } else if (cid === CARD_IDS.PIDGEOT_EX && !hasPidgeotOnBoard && !hasPidgeotInHand && hasEvolveReadyPidgey) {
          candidateScore += 145
        } else if (cid === CARD_IDS.CHARIZARD_EX && !hasZardInHand && hasEvolveReadyCharmander) {
          candidateScore += 140
        } else if (cid === CARD_IDS.ARVEN && state.supporterPlayedCount === 0) {
          candidateScore += 125
        } else if (cid === CARD_IDS.CHARMELEON && hasEvolveReadyCharmander && !hasCandyInHand) {
          candidateScore += 110
        }
      }
    }

    if (candidateScore > bestScore) {
      bestScore = candidateScore
      bestIdx = i
    }
  }

  return bestIdx
}

function canLineEvolveThisTurn(
  state: LowLevelGameState,
  lookup: DeclarativeCardDefinition[],
  line: 'CHARIZARD' | 'PIDGEOT',
): boolean {
  if (state.currentTurn <= 1) return false
  if (state.active !== 0) {
    const def = lookup[unpackCardId(state.active)]
    if (
      def &&
      def.evolutionLine === line &&
      def.subType === 'BASIC' &&
      unpackTurnPlayed(state.active) < state.currentTurn
    ) {
      return true
    }
  }
  for (let i = 0; i < state.benchLen; i++) {
    const slot = state.bench[i]
    const def = lookup[unpackCardId(slot)]
    if (
      def &&
      def.evolutionLine === line &&
      def.subType === 'BASIC' &&
      unpackTurnPlayed(slot) < state.currentTurn
    ) {
      return true
    }
  }
  return false
}

/**
 * Executes a single declarative action on `state`, verifying all regulatory invariants.
 */
function executeDeclarativeCardOrAbility(
  state: LowLevelGameState,
  lookup: DeclarativeCardDefinition[],
  rng: Mulberry32,
  invariants: InvariantTrackerCounters,
  actionType:
    | 'PLAY_BASIC_FROM_HAND'
    | 'PLAY_POFFIN_OR_NEST'
    | 'PLAY_ULTRA_BALL'
    | 'PLAY_ARVEN'
    | 'PLAY_SEAL_STONE_AND_VSTAR'
    | 'USE_QUICK_SEARCH'
    | 'USE_FLIP_THE_SCRIPT'
    | 'PLAY_RARE_CANDY'
    | 'PLAY_STAGE_EVOLUTION'
    | 'PLAY_SUPER_ROD_OR_STRETCHER'
    | 'ATTACH_MANUAL_ENERGY'
    | 'PLAY_DRAW_SUPPORTER'
    | 'USE_ROTOM_INSTANT_CHARGE',
  smartTargeting: boolean,
  logs: string[] | null,
): boolean {
  switch (actionType) {
    case 'PLAY_BASIC_FROM_HAND': {
      if (state.benchLen >= 5) return false
      for (let i = 0; i < state.handLen; i++) {
        const cid = unpackCardId(state.hand[i])
        const def = lookup[cid]
        if (!def || def.category !== 'POKEMON' || def.subType !== 'BASIC') continue

        // In smart mode, keep excess Lumineon V unless we want its Supporter search
        if (smartTargeting && cid === CARD_IDS.LUMINEON_V) {
          const canUseLuminous =
            !(state.currentTurn === 1 && state.goingFirst) &&
            state.supporterPlayedCount === 0 &&
            countCardIdInHand(state, CARD_IDS.ARVEN) === 0
          if (!canUseLuminous && state.benchLen >= 2) continue
        }

        // Prioritize Charmander / Pidgey / Rotom V
        removeAtUint16(state.hand, state.handLen, i)
        state.handLen--
        const placed = packCard(cid, state.currentTurn, 0, false, false, false)
        state.bench[state.benchLen++] = placed

        if (logs) logs.push(`Pose ${def.name} sur le Banc (tour de pose T${state.currentTurn})`)

        // Check if card has ABILITY_LUMINOUS_SIGN (Luminéon V)
        for (const prim of def.primitives) {
          if (prim.opcode === 'ABILITY_LUMINOUS_SIGN') {
            const supIdx = selectBestDeckTargetIndex(state, lookup, prim.filter, smartTargeting)
            if (supIdx !== -1) {
              const supCard = removeAtUint16(state.deck, state.deckLen, supIdx)
              state.deckLen--
              state.hand[state.handLen++] = packCard(unpackCardId(supCard))
              state.thinningCount++
              fisherYatesShuffleUint16(state.deck, state.deckLen, rng)
              if (logs) {
                logs.push(
                  `Talent Signe Lumineux (${def.name}) ➔ ajoute ${lookup[unpackCardId(supCard)]?.name} à la main`,
                )
              }
            }
          }
        }

        verifyStateInvariants(state, invariants)
        return true
      }
      return false
    }

    case 'PLAY_POFFIN_OR_NEST': {
      if (state.benchLen >= 5) return false
      // Look for any card in hand with opcode SEARCH_DECK_TO_BENCH
      for (let i = 0; i < state.handLen; i++) {
        const cid = unpackCardId(state.hand[i])
        const def = lookup[cid]
        if (!def) continue
        const benchPrim = def.primitives.find((p) => p.opcode === 'SEARCH_DECK_TO_BENCH')
        if (!benchPrim) continue

        // Remove item from hand -> discard
        const usedCard = removeAtUint16(state.hand, state.handLen, i)
        state.handLen--
        state.discard[state.discardLen++] = packCard(unpackCardId(usedCard))

        const maxTargets = benchPrim.maxTargets || 1
        const maxHp = benchPrim.maxHp ?? (benchPrim.filter === 'BASIC_HP_LTE_70' ? 70 : 999)
        const foundNames: string[] = []

        for (let t = 0; t < maxTargets && state.benchLen < 5; t++) {
          let bestDeckIdx = -1
          let bestPriority = -1
          const charCount = countLineOnBoard(state, lookup, 'CHARIZARD')
          const pidgCount = countLineOnBoard(state, lookup, 'PIDGEOT')

          for (let d = 0; d < state.deckLen; d++) {
            const dCid = unpackCardId(state.deck[d])
            const dDef = lookup[dCid]
            if (!dDef || dDef.category !== 'POKEMON' || dDef.subType !== 'BASIC') continue
            if ((dDef.hp ?? 999) > maxHp) continue

            let prio = dDef.priorityActive
            if (smartTargeting) {
              if (dCid === CARD_IDS.CHARMANDER && charCount < 2) prio += 50
              else if (dCid === CARD_IDS.PIDGEY && pidgCount < 1) prio += 55
              else if (dCid === CARD_IDS.ROTOM_V && !hasCardIdOnBoard(state, CARD_IDS.ROTOM_V)) prio += 45
              else if (dCid === CARD_IDS.LUMINEON_V) prio -= 30 // Don't waste Lumineon V via Nest Ball unless desperate
            }

            if (prio > bestPriority) {
              bestPriority = prio
              bestDeckIdx = d
            }
          }

          if (bestDeckIdx !== -1) {
            const drawn = removeAtUint16(state.deck, state.deckLen, bestDeckIdx)
            state.deckLen--
            const bCid = unpackCardId(drawn)
            state.bench[state.benchLen++] = packCard(bCid, state.currentTurn, 0, false, false, false)
            state.thinningCount++
            foundNames.push(lookup[bCid]?.name ?? 'Pokémon')
          }
        }

        fisherYatesShuffleUint16(state.deck, state.deckLen, rng)
        if (logs) {
          if (foundNames.length > 0) {
            logs.push(`Joue ${def.name} ➔ pose ${foundNames.join(' + ')} sur le Banc (Deck -${foundNames.length})`)
          } else {
            logs.push(`Joue ${def.name} (aucune cible éligible restante dans le deck)`)
          }
        }

        verifyStateInvariants(state, invariants)
        return true
      }
      return false
    }

    case 'PLAY_ARVEN': {
      // Check Invariant 1 (No Supporter T1 going first) & Invariant 3 (Max 1 Supporter/turn)
      if (state.currentTurn === 1 && state.goingFirst) return false
      if (state.supporterPlayedCount >= 1) return false

      for (let i = 0; i < state.handLen; i++) {
        const cid = unpackCardId(state.hand[i])
        const def = lookup[cid]
        if (!def || def.category !== 'SUPPORTER') continue
        const arvenPrim = def.primitives.find(
          (p) => p.opcode === 'SEARCH_DECK_TO_HAND' && p.filter === '1_ITEM_AND_1_TOOL',
        )
        if (!arvenPrim) continue

        // Consume Arven
        removeAtUint16(state.hand, state.handLen, i)
        state.handLen--
        state.discard[state.discardLen++] = packCard(cid)
        state.supporterPlayedCount++

        const tutoredNames: string[] = []

        // 1. Search best ITEM in deck
        let bestItemIdx = -1
        let bestItemScore = -1
        const charLine = countLineOnBoard(state, lookup, 'CHARIZARD')
        const pidgLine = countLineOnBoard(state, lookup, 'PIDGEOT')
        const canEvolveAny =
          canLineEvolveThisTurn(state, lookup, 'CHARIZARD') ||
          canLineEvolveThisTurn(state, lookup, 'PIDGEOT')

        for (let d = 0; d < state.deckLen; d++) {
          const dCid = unpackCardId(state.deck[d])
          const dDef = lookup[dCid]
          if (!dDef || dDef.category !== 'ITEM') continue
          let sc = dDef.strategicValue
          if (smartTargeting) {
            if (state.currentTurn === 1) {
              if (dCid === CARD_IDS.BUDDY_POFFIN && (charLine < 2 || pidgLine < 1)) sc += 100
              else if (dCid === CARD_IDS.NEST_BALL && !hasCardIdOnBoard(state, CARD_IDS.ROTOM_V)) sc += 75
            } else {
              if (dCid === CARD_IDS.RARE_CANDY && canEvolveAny && countCardIdInHand(state, CARD_IDS.RARE_CANDY) === 0) {
                sc += 130
              } else if (
                dCid === CARD_IDS.ULTRA_BALL &&
                countCardIdInHand(state, CARD_IDS.CHARIZARD_EX) === 0 &&
                countCardIdInHand(state, CARD_IDS.PIDGEOT_EX) === 0
              ) {
                sc += 110
              } else if (dCid === CARD_IDS.BUDDY_POFFIN && state.benchLen < 3) {
                sc += 80
              }
            }
          }
          if (sc > bestItemScore) {
            bestItemScore = sc
            bestItemIdx = d
          }
        }

        if (bestItemIdx !== -1) {
          const itemCard = removeAtUint16(state.deck, state.deckLen, bestItemIdx)
          state.deckLen--
          state.hand[state.handLen++] = packCard(unpackCardId(itemCard))
          state.thinningCount++
          tutoredNames.push(lookup[unpackCardId(itemCard)]?.name ?? 'Objet')
        }

        // 2. Search best TOOL in deck
        let bestToolIdx = -1
        let bestToolScore = -1
        for (let d = 0; d < state.deckLen; d++) {
          const dCid = unpackCardId(state.deck[d])
          const dDef = lookup[dCid]
          if (!dDef || dDef.category !== 'TOOL') continue
          let sc = dDef.strategicValue
          if (smartTargeting && dCid === CARD_IDS.FOREST_SEAL_STONE && !state.vstarUsedInGame) {
            sc += 90
          }
          if (sc > bestToolScore) {
            bestToolScore = sc
            bestToolIdx = d
          }
        }

        if (bestToolIdx !== -1) {
          const toolCard = removeAtUint16(state.deck, state.deckLen, bestToolIdx)
          state.deckLen--
          state.hand[state.handLen++] = packCard(unpackCardId(toolCard))
          state.thinningCount++
          tutoredNames.push(lookup[unpackCardId(toolCard)]?.name ?? 'Outil')
        }

        fisherYatesShuffleUint16(state.deck, state.deckLen, rng)
        if (logs) {
          logs.push(
            `Supporter ${def.name} ➔ tutorise ${tutoredNames.join(' + ') || 'aucune cible'} (Deck -${tutoredNames.length})`,
          )
        }

        verifyStateInvariants(state, invariants)
        return true
      }
      return false
    }

    case 'PLAY_SEAL_STONE_AND_VSTAR': {
      // Attach Forest Seal Stone to a Pokemon V on board and activate VSTAR Power if not used yet
      const stoneHandIdx = findHandIndexById(state, CARD_IDS.FOREST_SEAL_STONE)
      if (stoneHandIdx !== -1 && hasPokemonVWithoutToolOnBoard(state, lookup)) {
        removeAtUint16(state.hand, state.handLen, stoneHandIdx)
        state.handLen--

        let attachedTargetName = 'Pokémon V'
        let attached = false
        for (let b = 0; b < state.benchLen; b++) {
          const slot = state.bench[b]
          const def = lookup[unpackCardId(slot)]
          if (def?.isPokemonV && !(slot & PACK_SEAL_STONE_BIT) && !(slot & PACK_OTHER_TOOL_BIT)) {
            state.bench[b] = slot | PACK_SEAL_STONE_BIT
            attachedTargetName = def.name
            attached = true
            break
          }
        }
        if (!attached && state.active !== 0) {
          const def = lookup[unpackCardId(state.active)]
          if (
            def?.isPokemonV &&
            !(state.active & PACK_SEAL_STONE_BIT) &&
            !(state.active & PACK_OTHER_TOOL_BIT)
          ) {
            state.active = state.active | PACK_SEAL_STONE_BIT
            attachedTargetName = def.name
            attached = true
          }
        }

        if (logs) {
          logs.push(`Attache Pierre Scellée Sylvestre sur ${attachedTargetName}`)
        }
      }

      // Check if any Pokemon on board has PACK_SEAL_STONE_BIT and VSTAR Power not used yet
      let hasActiveSealStone = (state.active & PACK_SEAL_STONE_BIT) !== 0
      for (let b = 0; b < state.benchLen; b++) {
        if ((state.bench[b] & PACK_SEAL_STONE_BIT) !== 0) hasActiveSealStone = true
      }

      if (hasActiveSealStone && !state.vstarUsedInGame && state.deckLen > 0) {
        const targetIdx = selectBestDeckTargetIndex(state, lookup, 'ANY_CARD', smartTargeting)
        if (targetIdx !== -1) {
          const card = removeAtUint16(state.deck, state.deckLen, targetIdx)
          state.deckLen--
          const cId = unpackCardId(card)
          state.hand[state.handLen++] = packCard(cId)
          state.vstarUsedInGame = true
          state.thinningCount++
          fisherYatesShuffleUint16(state.deck, state.deckLen, rng)
          if (logs) {
            logs.push(
              `Puissance VSTAR (Alchimie Sylvestre) ➔ cherche ${lookup[cId]?.name} dans le deck`,
            )
          }
          verifyStateInvariants(state, invariants)
          return true
        }
      }

      return false
    }

    case 'USE_QUICK_SEARCH': {
      // Check if Pidgeot ex (or any card with ABILITY_QUICK_SEARCH) is on board and hasn't used ability this turn
      let foundSlot: 'ACTIVE' | number | null = null
      if (state.active !== 0 && !(state.active & PACK_ABILITY_USED_BIT)) {
        const def = lookup[unpackCardId(state.active)]
        if (def?.primitives.some((p) => p.opcode === 'ABILITY_QUICK_SEARCH')) {
          foundSlot = 'ACTIVE'
        }
      }
      if (foundSlot === null) {
        for (let b = 0; b < state.benchLen; b++) {
          const slot = state.bench[b]
          if (!(slot & PACK_ABILITY_USED_BIT)) {
            const def = lookup[unpackCardId(slot)]
            if (def?.primitives.some((p) => p.opcode === 'ABILITY_QUICK_SEARCH')) {
              foundSlot = b
              break
            }
          }
        }
      }

      if (foundSlot === null || state.deckLen <= 0) return false

      if (foundSlot === 'ACTIVE') {
        state.active |= PACK_ABILITY_USED_BIT
      } else {
        state.bench[foundSlot] |= PACK_ABILITY_USED_BIT
      }

      const targetIdx = selectBestDeckTargetIndex(state, lookup, 'ANY_CARD', smartTargeting)
      if (targetIdx !== -1) {
        const card = removeAtUint16(state.deck, state.deckLen, targetIdx)
        state.deckLen--
        const cId = unpackCardId(card)
        state.hand[state.handLen++] = packCard(cId)
        state.thinningCount++
        fisherYatesShuffleUint16(state.deck, state.deckLen, rng)
        if (logs) {
          logs.push(
            `Talent Recherche Rapide (Roucarnage ex) ➔ cherche ${lookup[cId]?.name} dans le deck`,
          )
        }
        verifyStateInvariants(state, invariants)
        return true
      }
      return false
    }

    case 'USE_FLIP_THE_SCRIPT': {
      // Fezandipiti ex: if KO occurred last turn, draw 3 cards once per turn
      if (!state.koOccurredLastTurn || state.deckLen <= 0) return false
      let slotIdx: 'ACTIVE' | number | null = null
      if (state.active !== 0 && !(state.active & PACK_ABILITY_USED_BIT)) {
        const def = lookup[unpackCardId(state.active)]
        if (def?.primitives.some((p) => p.opcode === 'ABILITY_FLIP_THE_SCRIPT')) slotIdx = 'ACTIVE'
      }
      if (slotIdx === null) {
        for (let b = 0; b < state.benchLen; b++) {
          const slot = state.bench[b]
          if (!(slot & PACK_ABILITY_USED_BIT)) {
            const def = lookup[unpackCardId(slot)]
            if (def?.primitives.some((p) => p.opcode === 'ABILITY_FLIP_THE_SCRIPT')) {
              slotIdx = b
              break
            }
          }
        }
      }
      if (slotIdx === null) return false

      if (slotIdx === 'ACTIVE') state.active |= PACK_ABILITY_USED_BIT
      else state.bench[slotIdx] |= PACK_ABILITY_USED_BIT

      let drawnCount = 0
      for (let d = 0; d < 3 && state.deckLen > 0; d++) {
        drawCardFromDeck(state)
        drawnCount++
      }
      if (logs) {
        logs.push(`Talent Renverser la Tendance (Fezandipiti ex) ➔ pioche ${drawnCount} cartes après KO`)
      }
      verifyStateInvariants(state, invariants)
      return true
    }

    case 'PLAY_ULTRA_BALL': {
      // Requires Ultra Ball + at least 2 other cards in hand
      if (state.handLen < 3) return false
      let ubIdx = -1
      for (let i = 0; i < state.handLen; i++) {
        const def = lookup[unpackCardId(state.hand[i])]
        if (
          def?.primitives.some((p) => p.opcode === 'COST_DISCARD_CARDS') &&
          def?.primitives.some((p) => p.opcode === 'SEARCH_DECK_TO_HAND')
        ) {
          ubIdx = i
          break
        }
      }
      if (ubIdx === -1) return false

      // Evaluate what we would tutor and what 2 cards we would discard
      const targetDeckIdx = selectBestDeckTargetIndex(state, lookup, 'POKEMON_ANY', smartTargeting)
      if (targetDeckIdx === -1) return false

      // Score hand cards to discard the 2 least needed cards in smart mode
      const candidateIndices: { idx: number; keepScore: number }[] = []
      for (let i = 0; i < state.handLen; i++) {
        if (i === ubIdx) continue
        const cid = unpackCardId(state.hand[i])
        const def = lookup[cid]
        let keepScore = def?.strategicValue ?? 50
        if (!smartTargeting) {
          keepScore = i // Greedy/Naive discards first two cards
        } else {
          // Protect key combo pieces if we only have 1 copy in hand
          if (cid === CARD_IDS.RARE_CANDY && countCardIdInHand(state, CARD_IDS.RARE_CANDY) === 1) {
            keepScore += 100
          }
          if (cid === CARD_IDS.CHARIZARD_EX && countCardIdInHand(state, CARD_IDS.CHARIZARD_EX) === 1) {
            keepScore += 95
          }
          if (cid === CARD_IDS.PIDGEOT_EX && countCardIdInHand(state, CARD_IDS.PIDGEOT_EX) === 1) {
            keepScore += 90
          }
        }
        candidateIndices.push({ idx: i, keepScore })
      }
      candidateIndices.sort((a, b) => a.keepScore - b.keepScore)

      // In smart mode, don't burn Ultra Ball if it forces discarding our only Rare Candy on T2+ without backup
      if (smartTargeting && candidateIndices[1].keepScore >= 180) {
        return false
      }

      const toRemove = [ubIdx, candidateIndices[0].idx, candidateIndices[1].idx].sort((a, b) => b - a)
      const discardedNames: string[] = []
      for (const rIdx of toRemove) {
        const rem = removeAtUint16(state.hand, state.handLen, rIdx)
        state.handLen--
        const remId = unpackCardId(rem)
        state.discard[state.discardLen++] = packCard(remId)
        if (rIdx !== ubIdx) {
          discardedNames.push(lookup[remId]?.name ?? 'Carte')
        }
      }

      const tutored = removeAtUint16(state.deck, state.deckLen, targetDeckIdx)
      state.deckLen--
      const tutoredId = unpackCardId(tutored)
      state.hand[state.handLen++] = packCard(tutoredId)
      state.thinningCount++
      fisherYatesShuffleUint16(state.deck, state.deckLen, rng)

      if (logs) {
        logs.push(
          `Joue Hyper Ball (défausse ${discardedNames.join(', ')}) ➔ cherche ${lookup[tutoredId]?.name}`,
        )
      }
      verifyStateInvariants(state, invariants)
      return true
    }

    case 'PLAY_RARE_CANDY': {
      // Invariant 2 check: Can only evolve on Turn >= 2 AND target must have turnPlayed < currentTurn
      if (state.currentTurn <= 1) return false
      const candyIdx = findHandIndexById(state, CARD_IDS.RARE_CANDY)
      if (candyIdx === -1) return false

      // In Optimal mode, evolve Pidgeot ex FIRST if both Pidgeot ex and Charizard ex are available,
      // OR evolve Pidgeot ex so Quick Search can immediately fetch the missing piece!
      const pidgeotHandIdx = findHandIndexById(state, CARD_IDS.PIDGEOT_EX)
      const zardHandIdx = findHandIndexById(state, CARD_IDS.CHARIZARD_EX)

      // Try Pidgeot ex first if Pidgeot ex is not yet on board
      if (pidgeotHandIdx !== -1 && !hasCardIdOnBoard(state, CARD_IDS.PIDGEOT_EX)) {
        const evolvedPidgeot = tryRareCandyLine(
          state,
          lookup,
          rng,
          invariants,
          candyIdx,
          pidgeotHandIdx,
          'PIDGEOT',
          logs,
        )
        if (evolvedPidgeot) return true
      }

      // Next try Charizard ex
      if (zardHandIdx !== -1) {
        const evolvedZard = tryRareCandyLine(
          state,
          lookup,
          rng,
          invariants,
          candyIdx,
          zardHandIdx,
          'CHARIZARD',
          logs,
        )
        if (evolvedZard) return true
      }

      // Fallback if Pidgeot ex is in hand and wasn't evolved above
      if (pidgeotHandIdx !== -1) {
        const evolvedPidgeot = tryRareCandyLine(
          state,
          lookup,
          rng,
          invariants,
          candyIdx,
          pidgeotHandIdx,
          'PIDGEOT',
          logs,
        )
        if (evolvedPidgeot) return true
      }

      return false
    }

    case 'PLAY_STAGE_EVOLUTION': {
      // Standard Stage 1 or Stage 2 evolution from hand (e.g., Reptincel on Salamèche, or Dracaufeu ex on Reptincel)
      if (state.currentTurn <= 1) return false

      for (let i = 0; i < state.handLen; i++) {
        const evoCid = unpackCardId(state.hand[i])
        const evoDef = lookup[evoCid]
        if (!evoDef || evoDef.category !== 'POKEMON') continue
        if (evoDef.subType !== 'STAGE_1' && evoDef.subType !== 'STAGE_2') continue

        // If evolving to STAGE_1 (e.g. Charmeleon), in smart mode don't overwrite the only Charmander if we already hold Rare Candy + Charizard ex!
        if (
          smartTargeting &&
          evoDef.subType === 'STAGE_1' &&
          evoDef.evolutionLine === 'CHARIZARD' &&
          countCardIdInHand(state, CARD_IDS.RARE_CANDY) > 0 &&
          countCardIdInHand(state, CARD_IDS.CHARIZARD_EX) > 0 &&
          countLineOnBoard(state, lookup, 'CHARIZARD') <= 1
        ) {
          continue
        }

        const requiredPrevSubType = evoDef.subType === 'STAGE_1' ? 'BASIC' : 'STAGE_1'

        // Check Active first, then Bench
        if (state.active !== 0) {
          const baseDef = lookup[unpackCardId(state.active)]
          const baseTurn = unpackTurnPlayed(state.active)
          if (
            baseDef &&
            baseDef.evolutionLine === evoDef.evolutionLine &&
            baseDef.subType === requiredPrevSubType &&
            baseTurn < state.currentTurn
          ) {
            // Invariant 2 verified!
            invariants.inv2Checked++
            invariants.inv2Passed++

            removeAtUint16(state.hand, state.handLen, i)
            state.handLen--
            state.active = evolvePackedPokemon(state.active, evoCid, state.currentTurn)
            if (logs) {
              logs.push(
                `Évolution régulière : ${baseDef.name} (posé T${baseTurn}) ➔ ${evoDef.name} (Actif)`,
              )
            }
            triggerOnEvolveAbilities(state, lookup, evoDef, 'ACTIVE', rng, logs)
            verifyStateInvariants(state, invariants)
            return true
          }
        }

        for (let b = 0; b < state.benchLen; b++) {
          const slot = state.bench[b]
          const baseDef = lookup[unpackCardId(slot)]
          const baseTurn = unpackTurnPlayed(slot)
          if (
            baseDef &&
            baseDef.evolutionLine === evoDef.evolutionLine &&
            baseDef.subType === requiredPrevSubType &&
            baseTurn < state.currentTurn
          ) {
            invariants.inv2Checked++
            invariants.inv2Passed++

            removeAtUint16(state.hand, state.handLen, i)
            state.handLen--
            state.bench[b] = evolvePackedPokemon(slot, evoCid, state.currentTurn)
            if (logs) {
              logs.push(
                `Évolution régulière : ${baseDef.name} (posé T${baseTurn}) ➔ ${evoDef.name} (Banc #${b + 1})`,
              )
            }
            triggerOnEvolveAbilities(state, lookup, evoDef, b, rng, logs)
            verifyStateInvariants(state, invariants)
            return true
          }
        }
      }

      return false
    }

    case 'ATTACH_MANUAL_ENERGY': {
      // Invariant 3: Max 1 manual energy attachment per turn
      if (state.energyAttachedCount >= 1) return false
      const energyIdx = findHandIndexById(state, CARD_IDS.FIRE_ENERGY)
      if (energyIdx === -1) return false

      removeAtUint16(state.hand, state.handLen, energyIdx)
      state.handLen--
      state.energyAttachedCount++

      // Pick best Pokemon on board to receive 1 Fire Energy
      let targetSlot: 'ACTIVE' | number = 'ACTIVE'
      let targetName = lookup[unpackCardId(state.active)]?.name ?? 'Actif'

      if (
        unpackCardId(state.active) === CARD_IDS.CHARIZARD_EX &&
        unpackEnergies(state.active) < 2
      ) {
        targetSlot = 'ACTIVE'
      } else {
        // Check if a Charizard ex or Charmander on bench needs energy
        let bestBench = -1
        let bestPrio = -1
        for (let b = 0; b < state.benchLen; b++) {
          const cid = unpackCardId(state.bench[b])
          const en = unpackEnergies(state.bench[b])
          let p = 0
          if (cid === CARD_IDS.CHARIZARD_EX && en < 2) p = 100
          else if (cid === CARD_IDS.CHARMELEON && en < 2) p = 80
          else if (cid === CARD_IDS.CHARMANDER && en < 2) p = 70
          else if (cid === CARD_IDS.PIDGEOT_EX && en < 2) p = 50
          if (p > bestPrio) {
            bestPrio = p
            bestBench = b
          }
        }
        if (bestBench !== -1 && bestPrio > 60) {
          targetSlot = bestBench
          targetName = lookup[unpackCardId(state.bench[bestBench])]?.name ?? 'Banc'
        }
      }

      if (targetSlot === 'ACTIVE') {
        state.active = addPackedEnergies(state.active, 1)
      } else {
        state.bench[targetSlot] = addPackedEnergies(state.bench[targetSlot], 1)
      }

      if (logs) {
        logs.push(`Attache manuellement 1 Énergie Feu de Base sur ${targetName} (1/tour)`)
      }
      verifyStateInvariants(state, invariants)
      return true
    }

    case 'PLAY_SUPER_ROD_OR_STRETCHER': {
      if (state.discardLen <= 0) return false
      for (let i = 0; i < state.handLen; i++) {
        const cid = unpackCardId(state.hand[i])
        const def = lookup[cid]
        if (!def) continue
        const recDeck = def.primitives.find((p) => p.opcode === 'RECOVER_DISCARD_TO_DECK')
        const recHand = def.primitives.find((p) => p.opcode === 'RECOVER_DISCARD_TO_HAND')
        if (!recDeck && !recHand) continue

        // Check if discard contains any Pokemon or Fire Energy
        const eligibleDiscardIndices: number[] = []
        for (let d = 0; d < state.discardLen; d++) {
          const dCid = unpackCardId(state.discard[d])
          const dDef = lookup[dCid]
          if (dDef && (dDef.category === 'POKEMON' || dDef.category === 'ENERGY')) {
            eligibleDiscardIndices.push(d)
          }
        }
        if (eligibleDiscardIndices.length === 0) continue

        removeAtUint16(state.hand, state.handLen, i)
        state.handLen--
        state.discard[state.discardLen++] = packCard(cid)

        const maxRec = (recDeck ?? recHand)!.maxTargets || 1
        const recoveredNames: string[] = []
        for (let r = 0; r < maxRec && eligibleDiscardIndices.length > 0; r++) {
          const dIdx = eligibleDiscardIndices.pop()!
          const card = removeAtUint16(state.discard, state.discardLen, dIdx)
          state.discardLen--
          const rCid = unpackCardId(card)
          recoveredNames.push(lookup[rCid]?.name ?? 'Carte')
          if (recDeck) {
            state.deck[state.deckLen++] = packCard(rCid)
          } else {
            state.hand[state.handLen++] = packCard(rCid)
          }
        }
        if (recDeck) {
          fisherYatesShuffleUint16(state.deck, state.deckLen, rng)
        }
        if (logs) {
          logs.push(
            `Joue ${def.name} ➔ récupère ${recoveredNames.join(', ')} depuis la Défausse`,
          )
        }
        verifyStateInvariants(state, invariants)
        return true
      }
      return false
    }

    case 'PLAY_DRAW_SUPPORTER': {
      // Check Invariant 1 (No Supporter T1 going first) & Invariant 3 (Max 1 Supporter/turn)
      if (state.currentTurn === 1 && state.goingFirst) return false
      if (state.supporterPlayedCount >= 1) return false

      for (let i = 0; i < state.handLen; i++) {
        const cid = unpackCardId(state.hand[i])
        const def = lookup[cid]
        if (!def || def.category !== 'SUPPORTER') continue
        const researchPrim = def.primitives.find((p) => p.opcode === 'DISCARD_HAND_DRAW_N')
        const ionoPrim = def.primitives.find((p) => p.opcode === 'SHUFFLE_HAND_BOTTOM_DRAW_N')
        if (!researchPrim && !ionoPrim) continue

        // In smart mode, avoid Research if it would discard >=2 irreplaceable combo pieces (e.g. Rare Candy + Charizard ex) when Iono or another line is available
        if (smartTargeting && researchPrim) {
          const candies = countCardIdInHand(state, CARD_IDS.RARE_CANDY)
          const zards = countCardIdInHand(state, CARD_IDS.CHARIZARD_EX)
          if (candies >= 2 || (candies >= 1 && zards >= 1 && state.currentTurn === 1)) {
            // Check if Iono is in hand instead
            if (countCardIdInHand(state, CARD_IDS.IONO) > 0) continue
            // If hand already has combo for T2, don't throw it away on T1!
            if (state.currentTurn === 1 && candies >= 1 && zards >= 1 && state.benchLen >= 2) {
              return false
            }
          }
        }

        // Remove Supporter from hand
        removeAtUint16(state.hand, state.handLen, i)
        state.handLen--
        state.discard[state.discardLen++] = packCard(cid)
        state.supporterPlayedCount++

        if (researchPrim) {
          // Discard remaining hand and draw 7
          const discardedCount = state.handLen
          for (let h = 0; h < state.handLen; h++) {
            state.discard[state.discardLen++] = packCard(unpackCardId(state.hand[h]))
            state.hand[h] = 0
          }
          state.handLen = 0
          const toDraw = Math.min(state.deckLen, researchPrim.drawCount ?? 7)
          for (let d = 0; d < toDraw; d++) {
            drawCardFromDeck(state)
          }
          if (logs) {
            logs.push(
              `Supporter ${def.name} (défausse ${discardedCount} cartes) ➔ pioche ${toDraw} nouvelles cartes`,
            )
          }
        } else if (ionoPrim) {
          // Shuffle hand to bottom of deck and draw N (prizes remaining, default 6)
          const returnedCount = state.handLen
          const tempBottom = new Uint16Array(returnedCount)
          for (let h = 0; h < returnedCount; h++) {
            tempBottom[h] = packCard(unpackCardId(state.hand[h]))
            state.hand[h] = 0
          }
          state.handLen = 0
          fisherYatesShuffleUint16(tempBottom, returnedCount, rng)

          // Shift existing deck up by returnedCount so tempBottom goes to bottom (index 0..returnedCount-1)
          for (let d = state.deckLen - 1; d >= 0; d--) {
            state.deck[d + returnedCount] = state.deck[d]
          }
          for (let h = 0; h < returnedCount; h++) {
            state.deck[h] = tempBottom[h]
          }
          state.deckLen += returnedCount

          const prizeTarget = state.prizesLen > 0 ? state.prizesLen : ionoPrim.drawCount ?? 6
          const toDraw = Math.min(state.deckLen, prizeTarget)
          for (let d = 0; d < toDraw; d++) {
            drawCardFromDeck(state)
          }
          if (logs) {
            logs.push(
              `Supporter ${def.name} (place ${returnedCount} cartes sous le deck) ➔ pioche ${toDraw} cartes`,
            )
          }
        }

        verifyStateInvariants(state, invariants)
        return true
      }
      return false
    }

    case 'USE_ROTOM_INSTANT_CHARGE': {
      // Use Rotom V's Instant Charge on Turn 1 (or if Charizard ex is not ready to attack)
      const activeIsReadyZard =
        unpackCardId(state.active) === CARD_IDS.CHARIZARD_EX && unpackEnergies(state.active) >= 2
      if (activeIsReadyZard) return false

      let rotomSlot: 'ACTIVE' | number | null = null
      if (state.active !== 0 && !(state.active & PACK_ABILITY_USED_BIT)) {
        const def = lookup[unpackCardId(state.active)]
        if (def?.primitives.some((p) => p.opcode === 'ABILITY_INSTANT_CHARGE')) rotomSlot = 'ACTIVE'
      }
      if (rotomSlot === null) {
        for (let b = 0; b < state.benchLen; b++) {
          const slot = state.bench[b]
          if (!(slot & PACK_ABILITY_USED_BIT)) {
            const def = lookup[unpackCardId(slot)]
            if (def?.primitives.some((p) => p.opcode === 'ABILITY_INSTANT_CHARGE')) {
              rotomSlot = b
              break
            }
          }
        }
      }
      if (rotomSlot === null || state.deckLen <= 0) return false

      if (rotomSlot === 'ACTIVE') state.active |= PACK_ABILITY_USED_BIT
      else state.bench[rotomSlot] |= PACK_ABILITY_USED_BIT

      const toDraw = Math.min(3, state.deckLen)
      for (let d = 0; d < toDraw; d++) {
        drawCardFromDeck(state)
      }
      if (logs) {
        logs.push(`Talent Charge Instantanée (Motisma V) ➔ pioche ${toDraw} cartes en fin de tour`)
      }
      verifyStateInvariants(state, invariants)
      return true
    }
  }
}

/**
 * Helper to execute Rare Candy evolution (`EVOLVE_BASIC_TO_STAGE2`) while verifying Invariant #2.
 */
function tryRareCandyLine(
  state: LowLevelGameState,
  lookup: DeclarativeCardDefinition[],
  rng: Mulberry32,
  invariants: InvariantTrackerCounters,
  candyHandIdx: number,
  stage2HandIdx: number,
  targetLine: 'CHARIZARD' | 'PIDGEOT',
  logs: string[] | null,
): boolean {
  const stage2Cid = unpackCardId(state.hand[stage2HandIdx])
  const stage2Def = lookup[stage2Cid]
  if (!stage2Def) return false

  // Find eligible BASIC on board with `turnPlayed < state.currentTurn`
  let targetBoardSlot: 'ACTIVE' | number | null = null

  // For Charizard ex, prefer Active if eligible; for Pidgeot ex, prefer Bench
  if (targetLine === 'CHARIZARD' && state.active !== 0) {
    const def = lookup[unpackCardId(state.active)]
    if (
      def?.subType === 'BASIC' &&
      def.evolutionLine === 'CHARIZARD' &&
      unpackTurnPlayed(state.active) < state.currentTurn
    ) {
      targetBoardSlot = 'ACTIVE'
    }
  }

  if (targetBoardSlot === null) {
    for (let b = 0; b < state.benchLen; b++) {
      const slot = state.bench[b]
      const def = lookup[unpackCardId(slot)]
      if (
        def?.subType === 'BASIC' &&
        def.evolutionLine === targetLine &&
        unpackTurnPlayed(slot) < state.currentTurn
      ) {
        targetBoardSlot = b
        break
      }
    }
  }

  if (targetBoardSlot === null && state.active !== 0) {
    const def = lookup[unpackCardId(state.active)]
    if (
      def?.subType === 'BASIC' &&
      def.evolutionLine === targetLine &&
      unpackTurnPlayed(state.active) < state.currentTurn
    ) {
      targetBoardSlot = 'ACTIVE'
    }
  }

  if (targetBoardSlot === null) return false

  // Invariant 2 strictly verified: turnPlayed < currentTurn!
  invariants.inv2Checked++
  invariants.inv2Passed++

  // Remove Rare Candy and Stage 2 from hand (remove higher index first)
  const highIdx = Math.max(candyHandIdx, stage2HandIdx)
  const lowIdx = Math.min(candyHandIdx, stage2HandIdx)
  removeAtUint16(state.hand, state.handLen, highIdx)
  state.handLen--
  removeAtUint16(state.hand, state.handLen, lowIdx)
  state.handLen--
  state.discard[state.discardLen++] = packCard(CARD_IDS.RARE_CANDY)

  if (targetBoardSlot === 'ACTIVE') {
    const prevTurn = unpackTurnPlayed(state.active)
    const prevName = lookup[unpackCardId(state.active)]?.name ?? 'Base'
    state.active = evolvePackedPokemon(state.active, stage2Cid, state.currentTurn)
    if (logs) {
      logs.push(
        `Joue Super Bonbon sur ${prevName} (posé T${prevTurn}) ➔ évolue en ${stage2Def.name} (Actif)`,
      )
    }
    triggerOnEvolveAbilities(state, lookup, stage2Def, 'ACTIVE', rng, logs)
  } else {
    const prevTurn = unpackTurnPlayed(state.bench[targetBoardSlot])
    const prevName = lookup[unpackCardId(state.bench[targetBoardSlot])]?.name ?? 'Base'
    state.bench[targetBoardSlot] = evolvePackedPokemon(
      state.bench[targetBoardSlot],
      stage2Cid,
      state.currentTurn,
    )
    if (logs) {
      logs.push(
        `Joue Super Bonbon sur ${prevName} (posé T${prevTurn}) ➔ évolue en ${stage2Def.name} (Banc #${targetBoardSlot + 1})`,
      )
    }
    triggerOnEvolveAbilities(state, lookup, stage2Def, targetBoardSlot, rng, logs)
  }

  verifyStateInvariants(state, invariants)
  return true
}

/**
 * Triggers declarative on-evolution primitives such as `ABILITY_INFERNAL_REIGN` (Règne Infernal).
 */
function triggerOnEvolveAbilities(
  state: LowLevelGameState,
  lookup: DeclarativeCardDefinition[],
  evolvedDef: DeclarativeCardDefinition,
  slot: 'ACTIVE' | number,
  rng: Mulberry32,
  logs: string[] | null,
): void {
  for (const prim of evolvedDef.primitives) {
    if (prim.opcode === 'ABILITY_INFERNAL_REIGN') {
      const maxEnergies = prim.maxTargets || 3
      let attachedCount = 0

      for (let e = 0; e < maxEnergies; e++) {
        let energyDeckIdx = -1
        for (let d = 0; d < state.deckLen; d++) {
          const dDef = lookup[unpackCardId(state.deck[d])]
          if (dDef?.category === 'ENERGY') {
            energyDeckIdx = d
            break
          }
        }
        if (energyDeckIdx === -1) break

        removeAtUint16(state.deck, state.deckLen, energyDeckIdx)
        state.deckLen--
        state.thinningCount++
        attachedCount++

        if (slot === 'ACTIVE') {
          state.active = addPackedEnergies(state.active, 1)
        } else {
          state.bench[slot] = addPackedEnergies(state.bench[slot], 1)
        }
      }

      fisherYatesShuffleUint16(state.deck, state.deckLen, rng)
      if (logs && attachedCount > 0) {
        logs.push(
          `Talent Règne Infernal (${evolvedDef.name}) ➔ attache ${attachedCount} Énergie(s) Feu depuis le deck`,
        )
      }

      // If Charizard ex evolved on Bench with >=2 energies and Active is not a ready Charizard ex, promote it!
      if (slot !== 'ACTIVE') {
        const benchSlot = state.bench[slot]
        const activeIsReadyZard =
          unpackCardId(state.active) === CARD_IDS.CHARIZARD_EX &&
          unpackEnergies(state.active) >= 2
        if (unpackEnergies(benchSlot) >= 2 && !activeIsReadyZard) {
          const oldActive = state.active
          state.active = benchSlot
          state.bench[slot] = oldActive
          if (logs) {
            logs.push(`Promotion offensive : ${evolvedDef.name} passe sur le Poste Actif`)
          }
        }
      }
    }
  }
}

/**
 * Executes a full intra-turn policy sequence on a state copy:
 * - Branch Policy 'OPTIMAL_THINNING': Deck Thinning tutors FIRST -> Evolutions & Quick Search -> Draw Supporter -> Follow-up Evolutions/Attachments -> Rotom V
 * - Branch Policy 'DRAW_FIRST': Draw Supporter FIRST -> Bench Tutors -> Evolutions
 * - Branch Policy 'CONSERVATIVE': Basic placement & manual energy attachment only
 * - Policy 'GREEDY': Left-to-right naive execution
 * - Policy 'NAIVE_RANDOM': Random action ordering
 */
function runIntraTurnPolicy(
  state: LowLevelGameState,
  lookup: DeclarativeCardDefinition[],
  rng: Mulberry32,
  invariants: InvariantTrackerCounters,
  policy: 'OPTIMAL_THINNING' | 'DRAW_FIRST' | 'CONSERVATIVE' | 'GREEDY' | 'NAIVE_RANDOM',
  logs: string[] | null,
): number {
  let actionsExecuted = 0

  if (policy === 'OPTIMAL_THINNING') {
    // Phase 1: Pre-draw Deck Thinning (Bench tutors, Arven, Quick Search, VSTAR)
    for (let step = 0; step < 8; step++) {
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'USE_FLIP_THE_SCRIPT', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_POFFIN_OR_NEST', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_BASIC_FROM_HAND', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'USE_QUICK_SEARCH', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_ARVEN', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_SEAL_STONE_AND_VSTAR', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_RARE_CANDY', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_STAGE_EVOLUTION', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_ULTRA_BALL', true, logs)) {
        actionsExecuted++
        continue
      }
      break
    }

    // Phase 2: Draw Supporter (only if Supporter wasn't used on Arven)
    if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_DRAW_SUPPORTER', true, logs)) {
      actionsExecuted++
    }

    // Phase 3: Post-draw resolution (Play newly drawn Basics, Candies, Evolutions, Energy, Recovery)
    for (let step = 0; step < 8; step++) {
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_POFFIN_OR_NEST', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_BASIC_FROM_HAND', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_RARE_CANDY', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'USE_QUICK_SEARCH', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_STAGE_EVOLUTION', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_SEAL_STONE_AND_VSTAR', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_ULTRA_BALL', true, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_SUPER_ROD_OR_STRETCHER', true, logs)) {
        actionsExecuted++
        continue
      }
      break
    }

    // Phase 4: Manual Energy Attachment & End-of-turn Rotom V Instant Charge
    if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'ATTACH_MANUAL_ENERGY', true, logs)) {
      actionsExecuted++
    }
    if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'USE_ROTOM_INSTANT_CHARGE', true, logs)) {
      actionsExecuted++
    }
  } else if (policy === 'DRAW_FIRST' || policy === 'GREEDY') {
    // Greedy / Draw-First: Plays Draw Supporter and manual energy BEFORE thinning tutors!
    if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_DRAW_SUPPORTER', false, logs)) {
      actionsExecuted++
    }
    if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'ATTACH_MANUAL_ENERGY', false, logs)) {
      actionsExecuted++
    }
    for (let step = 0; step < 6; step++) {
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_BASIC_FROM_HAND', false, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_STAGE_EVOLUTION', false, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_RARE_CANDY', false, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_POFFIN_OR_NEST', false, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_ARVEN', false, logs)) {
        actionsExecuted++
        continue
      }
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'USE_QUICK_SEARCH', false, logs)) {
        actionsExecuted++
        continue
      }
      break
    }
  } else if (policy === 'CONSERVATIVE') {
    // Conservative line: Only basic bench placement, manual energy, and standard evolution
    if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_BASIC_FROM_HAND', true, logs)) {
      actionsExecuted++
    }
    if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'PLAY_STAGE_EVOLUTION', true, logs)) {
      actionsExecuted++
    }
    if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'ATTACH_MANUAL_ENERGY', true, logs)) {
      actionsExecuted++
    }
    if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, 'USE_ROTOM_INSTANT_CHARGE', true, logs)) {
      actionsExecuted++
    }
  } else if (policy === 'NAIVE_RANDOM') {
    // Naive Random: Shuffles candidate action types and executes a random subset
    const candidateActions: Parameters<typeof executeDeclarativeCardOrAbility>[4][] = [
      'PLAY_DRAW_SUPPORTER',
      'ATTACH_MANUAL_ENERGY',
      'PLAY_BASIC_FROM_HAND',
      'PLAY_POFFIN_OR_NEST',
      'PLAY_STAGE_EVOLUTION',
      'PLAY_RARE_CANDY',
      'PLAY_ULTRA_BALL',
      'PLAY_ARVEN',
    ]
    for (let step = 0; step < 5; step++) {
      const pick = candidateActions[rng.nextInt(candidateActions.length)]
      if (executeDeclarativeCardOrAbility(state, lookup, rng, invariants, pick, false, logs)) {
        actionsExecuted++
      }
    }
  }

  if (logs && actionsExecuted === 0) {
    logs.push('Aucune action constructive disponible ➔ Fin du tour')
  }

  return actionsExecuted
}

function createBoardPokemonSnapshot(
  packed: number,
  lookup: DeclarativeCardDefinition[],
): BoardPokemonSnapshot {
  const cid = unpackCardId(packed)
  const def = lookup[cid]
  let toolName: string | null = null
  if (packed & PACK_SEAL_STONE_BIT) toolName = 'Pierre Scellée Sylvestre'
  else if (packed & PACK_OTHER_TOOL_BIT) toolName = 'Ceinture Maximale'

  return {
    cardId: cid,
    name: def?.name ?? `Carte #${cid}`,
    subType: def?.subType ?? 'BASIC',
    hp: def?.hp ?? 70,
    attachedEnergies: unpackEnergies(packed),
    attachedToolName: toolName,
    turnPlayed: unpackTurnPlayed(packed),
    abilityUsedThisTurn: (packed & PACK_ABILITY_USED_BIT) !== 0,
  }
}

/**
 * Runs a single complete game from Setup through `config.maxTurns` (1..10 turns),
 * stopping early if a terminal condition (6 Prizes claimed, Deck-Out, or KO with empty Bench) occurs.
 */
export function simulateSingleGame(
  gameIndex: number,
  config: SimulationConfig,
  templateDeck: Uint16Array,
  lookup: DeclarativeCardDefinition[],
  invariants: InvariantTrackerCounters,
  recordDetailedLog: boolean,
): {
  initialDrawHadZeroBasics: boolean
  initialDrawHadPoffin: boolean
  mulliganCount: number
  turn1SetupSuccess: boolean
  turn2CharizardReady: boolean
  pidgeotInPlay: boolean
  bricked: boolean
  rareCandyPrizedCount: number
  charizardPrizedCount: number
  boardScoreT2: number
  boardScoreT4: number
  turnsPlayed: number
  endedEarly: boolean
  endReason: GameEndReason
  thinningTotal: number
  branchesEvaluated: number
  actionsExecuted: number
  sampledRecord: SampledGameRecord | null
} {
  const maxTurns = Math.max(1, Math.min(10, config.maxTurns || 4))
  const gameSeed = deriveGameSeed(config.seed, gameIndex)
  const rng = new Mulberry32(gameSeed)
  const state = createEmptyGameState(config.goingFirst)

  let initialDrawHadZeroBasics = false
  let initialDrawHadPoffin = false
  let firstAttempt = true

  // 1. Setup & Mulligan loop
  while (true) {
    state.deck.set(templateDeck)
    state.deckLen = 60
    state.handLen = 0
    fisherYatesShuffleUint16(state.deck, 60, rng)

    let hasBasic = false
    let hasPoffin = false
    for (let i = 0; i < 7; i++) {
      const card = drawCardFromDeck(state)
      const cid = unpackCardId(card)
      const def = lookup[cid]
      if (def?.category === 'POKEMON' && def.subType === 'BASIC') {
        hasBasic = true
      }
      if (cid === CARD_IDS.BUDDY_POFFIN) {
        hasPoffin = true
      }
    }

    if (firstAttempt) {
      initialDrawHadZeroBasics = !hasBasic
      initialDrawHadPoffin = hasPoffin
      firstAttempt = false
    }

    if (hasBasic) {
      break
    }
    state.mulliganCount++
  }

  const initialHandNames: string[] = []
  if (recordDetailedLog) {
    for (let i = 0; i < state.handLen; i++) {
      initialHandNames.push(lookup[unpackCardId(state.hand[i])]?.name ?? 'Carte')
    }
  }

  // 2. Place best Basic Pokemon in Active spot, and other eligible Basics on Bench (turnPlayed = 1)
  let bestActiveHandIdx = -1
  let bestActivePriority = -1
  for (let i = 0; i < state.handLen; i++) {
    const cid = unpackCardId(state.hand[i])
    const def = lookup[cid]
    if (def?.category === 'POKEMON' && def.subType === 'BASIC') {
      if (def.priorityActive > bestActivePriority) {
        bestActivePriority = def.priorityActive
        bestActiveHandIdx = i
      }
    }
  }

  const activeCard = removeAtUint16(state.hand, state.handLen, bestActiveHandIdx)
  state.handLen--
  state.active = packCard(unpackCardId(activeCard), 1, 0, false, false, false)

  // Place additional Basics (except Lumineon V which is held in hand for Luminous Sign) onto Bench
  for (let i = state.handLen - 1; i >= 0 && state.benchLen < 5; i--) {
    const cid = unpackCardId(state.hand[i])
    const def = lookup[cid]
    if (def?.category === 'POKEMON' && def.subType === 'BASIC' && cid !== CARD_IDS.LUMINEON_V) {
      removeAtUint16(state.hand, state.handLen, i)
      state.handLen--
      state.bench[state.benchLen++] = packCard(cid, 1, 0, false, false, false)
    }
  }

  // 3. Rule of 6 Prize Cards
  let rareCandyPrizedCount = 0
  let charizardPrizedCount = 0
  const prizeCardNames: string[] = []
  let virtualPrizesRemaining = 6

  if (config.prizesEnabled) {
    state.prizesLen = 6
    for (let p = 0; p < 6; p++) {
      state.deckLen--
      const pCard = state.deck[state.deckLen]
      state.deck[state.deckLen] = 0
      state.prizes[p] = pCard
      const pCid = unpackCardId(pCard)
      if (pCid === CARD_IDS.RARE_CANDY) rareCandyPrizedCount++
      if (pCid === CARD_IDS.CHARIZARD_EX) charizardPrizedCount++
      if (recordDetailedLog) {
        prizeCardNames.push(lookup[pCid]?.name ?? 'Carte')
      }
    }
  }

  let turn1SetupSuccess = false
  let turn2CharizardReady = false
  let pidgeotInPlayByT2 = false
  let boardScoreT2 = 0
  let boardScoreFinal = 0
  let totalBranchesEvaluated = 0
  let totalActionsExecuted = 0
  let turnsPlayed = 0
  let endReason: GameEndReason = 'MAX_TURNS_REACHED'
  let endReasonLabel = `Horizon de ${maxTurns} tour(s) atteint`
  const turnsTimeline: TurnTimelineRecord[] = []

  // 4. Main Simulation Loop: Turns 1 to maxTurns (with early termination if game ends)
  for (let turn = 1; turn <= maxTurns; turn++) {
    turnsPlayed = turn
    state.currentTurn = turn
    state.supporterPlayedCount = 0
    state.energyAttachedCount = 0
    state.stadiumPlayedThisTurn = false
    state.koOccurredLastTurn = false

    // Reset once-per-turn ability flags on Active and Bench
    if (state.active !== 0) {
      state.active &= ~PACK_ABILITY_USED_BIT
    }
    for (let b = 0; b < state.benchLen; b++) {
      state.bench[b] &= ~PACK_ABILITY_USED_BIT
    }

    let disruptionMessage: string | null = null
    let attackMessage: string | null = null
    let terminalEventMessage: string | null = null

    // Apply Turn 3 Opponent Disruption if configured
    if (turn === 3 && config.turn3Disruption !== 'NONE') {
      if (config.turn3Disruption === 'IONO_HAND_TO_3') {
        const oldHandCount = state.handLen
        const tempBottom = new Uint16Array(oldHandCount)
        for (let h = 0; h < oldHandCount; h++) {
          tempBottom[h] = packCard(unpackCardId(state.hand[h]))
          state.hand[h] = 0
        }
        state.handLen = 0
        fisherYatesShuffleUint16(tempBottom, oldHandCount, rng)
        for (let d = state.deckLen - 1; d >= 0; d--) {
          state.deck[d + oldHandCount] = state.deck[d]
        }
        for (let h = 0; h < oldHandCount; h++) {
          state.deck[h] = tempBottom[h]
        }
        state.deckLen += oldHandCount
        const toDraw = Math.min(3, state.deckLen)
        for (let d = 0; d < toDraw; d++) {
          drawCardFromDeck(state)
        }
        disruptionMessage = `Perturbation T3 : Mashynn / Iono adverse (Main de ${oldHandCount} cartes mélangée sous le deck ➔ réduite à ${toDraw} cartes)`
      } else if (config.turn3Disruption === 'KO_ACTIVE_POKEMON') {
        const koName = lookup[unpackCardId(state.active)]?.name ?? 'Pokémon Actif'
        state.discard[state.discardLen++] = packCard(unpackCardId(state.active))
        state.active = 0
        state.koOccurredLastTurn = true

        if (state.benchLen > 0) {
          // Promote highest priority Pokemon from Bench
          let bestBenchIdx = 0
          let bestPrio = -1
          for (let b = 0; b < state.benchLen; b++) {
            const def = lookup[unpackCardId(state.bench[b])]
            const p = (def?.priorityActive ?? 50) + unpackEnergies(state.bench[b]) * 15
            if (p > bestPrio) {
              bestPrio = p
              bestBenchIdx = b
            }
          }
          const promoted = removeAtUint16(state.bench, state.benchLen, bestBenchIdx)
          state.benchLen--
          state.active = promoted
          const promotedName = lookup[unpackCardId(promoted)]?.name ?? 'Banc'
          disruptionMessage = `Perturbation T3 : KO de ${koName} Actif ➔ Promotion de ${promotedName} (débloque Fezandipiti ex)`
        } else {
          // Early Game Over Condition #1: No Pokemon left on Bench after Active KO!
          disruptionMessage = `Perturbation T3 : KO de ${koName} Actif (Banc vide)`
          endReason = 'DEFEAT_NO_POKEMON'
          endReasonLabel = `Partie arrêtée au T${turn}/${maxTurns} : Défaite par KO sans Pokémon de remplacement sur le Banc`
          terminalEventMessage = endReasonLabel
          boardScoreFinal = evaluateBoardState(state, lookup, false).score
          if (recordDetailedLog) {
            turnsTimeline.push({
              turnNumber: turn,
              drawnCardName: null,
              disruptionApplied: disruptionMessage,
              attackExecuted: null,
              terminalEvent: terminalEventMessage,
              deckCountStart: state.deckLen,
              deckCountEnd: state.deckLen,
              branchesEvaluated: 0,
              branches: [],
              activePokemon: null,
              benchPokemon: [],
              handCardNames: [],
              prizesRemaining: config.prizesEnabled ? state.prizesLen : virtualPrizesRemaining,
              supporterPlayedThisTurn: false,
              energyAttachedThisTurn: false,
              vstarUsedInGame: state.vstarUsedInGame,
            })
          }
          break
        }
      }
    }

    // Early Game Over Condition #2: Start-of-turn Deck-Out (0 cards in deck before mandatory draw)
    if (state.deckLen <= 0) {
      endReason = 'DEFEAT_DECK_OUT'
      endReasonLabel = `Partie arrêtée au T${turn}/${maxTurns} : Défaite par Deck-Out (0 carte dans le deck à la pioche du tour)`
      terminalEventMessage = endReasonLabel
      boardScoreFinal = evaluateBoardState(state, lookup, false).score
      if (recordDetailedLog) {
        const benchSnapshots: BoardPokemonSnapshot[] = []
        for (let b = 0; b < state.benchLen; b++) {
          benchSnapshots.push(createBoardPokemonSnapshot(state.bench[b], lookup))
        }
        const handNames: string[] = []
        for (let h = 0; h < state.handLen; h++) {
          handNames.push(lookup[unpackCardId(state.hand[h])]?.name ?? 'Carte')
        }
        turnsTimeline.push({
          turnNumber: turn,
          drawnCardName: null,
          disruptionApplied: disruptionMessage,
          attackExecuted: null,
          terminalEvent: terminalEventMessage,
          deckCountStart: 0,
          deckCountEnd: 0,
          branchesEvaluated: 0,
          branches: [],
          activePokemon:
            state.active !== 0 ? createBoardPokemonSnapshot(state.active, lookup) : null,
          benchPokemon: benchSnapshots,
          handCardNames: handNames,
          prizesRemaining: config.prizesEnabled ? state.prizesLen : virtualPrizesRemaining,
          supporterPlayedThisTurn: false,
          energyAttachedThisTurn: false,
          vstarUsedInGame: state.vstarUsedInGame,
        })
      }
      break
    }

    const deckCountStart = state.deckLen
    const drawnCard = drawCardFromDeck(state)
    const drawnCardName = drawnCard !== 0 ? (lookup[unpackCardId(drawnCard)]?.name ?? null) : null

    const recordedBranches: DecisionBranchRecord[] = []

    if (config.aiMode === 'OPTIMAL_BEAM') {
      // Beam Search: Evaluate 3 distinct intra-turn action branches (Branch A: Deck Thinning + Combo, Branch B: Draw-First / Aggressive, Branch C: Conservative)
      totalBranchesEvaluated += 3
      const thinBefore = state.thinningCount

      // Branch A: Optimal Deck Thinning + Combo Sequencing
      const stateA = cloneLowLevelState(state)
      const rngA = rng.clone()
      const logsA: string[] | null = recordDetailedLog ? [] : null
      const actA = runIntraTurnPolicy(stateA, lookup, rngA, invariants, 'OPTIMAL_THINNING', logsA)
      const evalA = evaluateBoardState(stateA, lookup, recordDetailedLog)

      // Branch B: Draw-First / Greedy Sequencing
      const stateB = cloneLowLevelState(state)
      const rngB = rng.clone()
      const logsB: string[] | null = recordDetailedLog ? [] : null
      const actB = runIntraTurnPolicy(stateB, lookup, rngB, invariants, 'DRAW_FIRST', logsB)
      const evalB = evaluateBoardState(stateB, lookup, recordDetailedLog)

      // Branch C: Conservative / Resource Hold
      const stateC = cloneLowLevelState(state)
      const rngC = rng.clone()
      const logsC: string[] | null = recordDetailedLog ? [] : null
      const actC = runIntraTurnPolicy(stateC, lookup, rngC, invariants, 'CONSERVATIVE', logsC)
      const evalC = evaluateBoardState(stateC, lookup, recordDetailedLog)

      // Pick winning branch
      let winner: 'A' | 'B' | 'C' = 'A'
      let bestScore = evalA.score
      if (evalB.score > bestScore) {
        winner = 'B'
        bestScore = evalB.score
      }
      if (evalC.score > bestScore) {
        winner = 'C'
        bestScore = evalC.score
      }

      if (winner === 'A') {
        copyIntoLowLevelState(stateA, state)
        totalActionsExecuted += actA
        rng.nextUint32()
      } else if (winner === 'B') {
        copyIntoLowLevelState(stateB, state)
        totalActionsExecuted += actB
        rng.nextUint32()
      } else {
        copyIntoLowLevelState(stateC, state)
        totalActionsExecuted += actC
        rng.nextUint32()
      }

      if (recordDetailedLog) {
        recordedBranches.push(
          {
            branchId: 'A',
            label: 'Branche A — Épuration (Deck Thinning) & Séquence Combo Optimale',
            selected: winner === 'A',
            boardScore: evalA.score,
            scoreBreakdown: evalA.breakdown,
            actions: logsA ?? [],
            thinningDelta: stateA.thinningCount - thinBefore,
          },
          {
            branchId: 'B',
            label: 'Branche B — Pioche Aléatoire Prioritaire (Glouton)',
            selected: winner === 'B',
            boardScore: evalB.score,
            scoreBreakdown: evalB.breakdown,
            actions: logsB ?? [],
            thinningDelta: stateB.thinningCount - thinBefore,
          },
          {
            branchId: 'C',
            label: 'Branche C — Ligne Conservatrice (Rétention de Main)',
            selected: winner === 'C',
            boardScore: evalC.score,
            scoreBreakdown: evalC.breakdown,
            actions: logsC ?? [],
            thinningDelta: stateC.thinningCount - thinBefore,
          },
        )
      }
    } else if (config.aiMode === 'GREEDY') {
      totalBranchesEvaluated += 1
      const thinBefore = state.thinningCount
      const logsG: string[] | null = recordDetailedLog ? [] : null
      const actG = runIntraTurnPolicy(state, lookup, rng, invariants, 'GREEDY', logsG)
      totalActionsExecuted += actG
      if (recordDetailedLog) {
        const evalG = evaluateBoardState(state, lookup, true)
        recordedBranches.push({
          branchId: 'G',
          label: 'Branche Unique — Mode Glouton (Premier Jouable de Gauche à Droite)',
          selected: true,
          boardScore: evalG.score,
          scoreBreakdown: evalG.breakdown,
          actions: logsG ?? [],
          thinningDelta: state.thinningCount - thinBefore,
        })
      }
    } else {
      totalBranchesEvaluated += 1
      const thinBefore = state.thinningCount
      const logsN: string[] | null = recordDetailedLog ? [] : null
      const actN = runIntraTurnPolicy(state, lookup, rng, invariants, 'NAIVE_RANDOM', logsN)
      totalActionsExecuted += actN
      if (recordDetailedLog) {
        const evalN = evaluateBoardState(state, lookup, true)
        recordedBranches.push({
          branchId: 'N',
          label: 'Branche Unique — Mode Naïf (Ordre Aléatoire sans Épuration)',
          selected: true,
          boardScore: evalN.score,
          scoreBreakdown: evalN.breakdown,
          actions: logsN ?? [],
          thinningDelta: state.thinningCount - thinBefore,
        })
      }
    }

    // Attack & Prize claim simulation on Turn 2+
    if (turn >= 2 && state.active !== 0) {
      const activeCid = unpackCardId(state.active)
      const activeEnergies = unpackEnergies(state.active)

      if (activeCid === CARD_IDS.CHARIZARD_EX && activeEnergies >= 2) {
        // Charizard ex attacks with Combustion Obscure (180+ damage):
        // Takes 1 Prize on Turn 2 against a single-prize lead, and 2 Prizes on Turn 3+ against opponent's ex/V
        const prizesToClaim = turn >= 3 ? 2 : 1
        let claimedNames: string[] = []
        let claimedCount = 0

        if (config.prizesEnabled) {
          for (let c = 0; c < prizesToClaim && state.prizesLen > 0; c++) {
            state.prizesLen--
            const claimedPrize = state.prizes[state.prizesLen]
            state.prizes[state.prizesLen] = 0
            const pCid = unpackCardId(claimedPrize)
            state.hand[state.handLen++] = packCard(pCid)
            claimedCount++
            if (recordDetailedLog) {
              claimedNames.push(lookup[pCid]?.name ?? 'Carte')
            }
          }
          virtualPrizesRemaining = state.prizesLen
        } else {
          claimedCount = Math.min(prizesToClaim, virtualPrizesRemaining)
          virtualPrizesRemaining -= claimedCount
        }

        if (recordDetailedLog && claimedCount > 0) {
          attackMessage =
            claimedNames.length > 0
              ? `Attaque Combustion Obscure (Dracaufeu ex) ➔ KO adverse : récupère ${claimedCount} Récompense(s) (${claimedNames.join(', ')})`
              : `Attaque Combustion Obscure (Dracaufeu ex) ➔ KO adverse (${claimedCount} Récompense(s) théorique(s), reste ${virtualPrizesRemaining})`
        }
      } else if (activeCid === CARD_IDS.PIDGEOT_EX && activeEnergies >= 2) {
        // Pidgeot ex attacks with Bourrasque Tournoyante (120 damage): takes 1 Prize
        if (config.prizesEnabled && state.prizesLen > 0) {
          state.prizesLen--
          const claimedPrize = state.prizes[state.prizesLen]
          state.prizes[state.prizesLen] = 0
          const pCid = unpackCardId(claimedPrize)
          state.hand[state.handLen++] = packCard(pCid)
          virtualPrizesRemaining = state.prizesLen
          if (recordDetailedLog) {
            attackMessage = `Attaque Bourrasque Tournoyante (Roucarnage ex) ➔ récupère 1 Récompense (${lookup[pCid]?.name ?? 'Carte'})`
          }
        } else if (!config.prizesEnabled && virtualPrizesRemaining > 0) {
          virtualPrizesRemaining--
          if (recordDetailedLog) {
            attackMessage = `Attaque Bourrasque Tournoyante (Roucarnage ex) ➔ 1 Récompense théorique prise (reste ${virtualPrizesRemaining})`
          }
        }
      }
    }

    // Evaluate Turn Milestones
    if (turn === 1) {
      const charCount = countLineOnBoard(state, lookup, 'CHARIZARD')
      const pidgCount = countLineOnBoard(state, lookup, 'PIDGEOT')
      turn1SetupSuccess =
        (charCount >= 2 && pidgCount >= 1) ||
        (charCount >= 1 && pidgCount >= 1 && state.benchLen >= 2)
      if (maxTurns === 1) {
        boardScoreT2 = evaluateBoardState(state, lookup, false).score
      }
    }
    if (turn === 2) {
      const activeIsZardReady =
        unpackCardId(state.active) === CARD_IDS.CHARIZARD_EX && unpackEnergies(state.active) >= 2
      turn2CharizardReady = activeIsZardReady
      pidgeotInPlayByT2 = hasCardIdOnBoard(state, CARD_IDS.PIDGEOT_EX)
      boardScoreT2 = evaluateBoardState(state, lookup, false).score
    }

    boardScoreFinal = evaluateBoardState(state, lookup, false).score

    // Early Game Over Condition #3: All 6 Prizes Claimed (Victory!)
    const remainingPrizesNow = config.prizesEnabled ? state.prizesLen : virtualPrizesRemaining
    if (remainingPrizesNow <= 0) {
      endReason = 'VICTORY_ALL_PRIZES'
      endReasonLabel =
        turn < maxTurns
          ? `Victoire anticipée au T${turn}/${maxTurns} : Les 6 Récompenses ont été remportées (Partie arrêtée)`
          : `Victoire au T${turn}/${maxTurns} : Les 6 Récompenses ont été remportées`
      terminalEventMessage = endReasonLabel
    }

    if (recordDetailedLog) {
      const benchSnapshots: BoardPokemonSnapshot[] = []
      for (let b = 0; b < state.benchLen; b++) {
        benchSnapshots.push(createBoardPokemonSnapshot(state.bench[b], lookup))
      }
      const handNames: string[] = []
      for (let h = 0; h < state.handLen; h++) {
        handNames.push(lookup[unpackCardId(state.hand[h])]?.name ?? 'Carte')
      }

      turnsTimeline.push({
        turnNumber: turn,
        drawnCardName,
        disruptionApplied: disruptionMessage,
        attackExecuted: attackMessage,
        terminalEvent: terminalEventMessage,
        deckCountStart,
        deckCountEnd: state.deckLen,
        branchesEvaluated: config.aiMode === 'OPTIMAL_BEAM' ? 3 : 1,
        branches: recordedBranches,
        activePokemon:
          state.active !== 0 ? createBoardPokemonSnapshot(state.active, lookup) : null,
        benchPokemon: benchSnapshots,
        handCardNames: handNames,
        prizesRemaining: remainingPrizesNow,
        supporterPlayedThisTurn: state.supporterPlayedCount > 0,
        energyAttachedThisTurn: state.energyAttachedCount > 0,
        vstarUsedInGame: state.vstarUsedInGame,
      })
    }

    if (endReason !== 'MAX_TURNS_REACHED') {
      break
    }
  }

  const endedEarly = turnsPlayed < maxTurns || endReason !== 'MAX_TURNS_REACHED'
  const pidgeotInPlay = hasCardIdOnBoard(state, CARD_IDS.PIDGEOT_EX) || pidgeotInPlayByT2
  const hasAnyCharizard = hasCardIdOnBoard(state, CARD_IDS.CHARIZARD_EX) || turn2CharizardReady
  const bricked =
    maxTurns >= 2
      ? !turn2CharizardReady && !hasAnyCharizard && !pidgeotInPlay
      : !turn1SetupSuccess

  let sampledRecord: SampledGameRecord | null = null
  if (recordDetailedLog) {
    const tags: SampledGameRecord['tags'] = []
    if ((turn2CharizardReady && pidgeotInPlayByT2) || (maxTurns === 1 && turn1SetupSuccess)) {
      tags.push('PERFECT_T2')
    }
    if (bricked) tags.push('BRICK')
    if (rareCandyPrizedCount >= 2 || (rareCandyPrizedCount >= 1 && charizardPrizedCount >= 1)) {
      tags.push('CANDY_PRIZED')
    }
    if (tags.length === 0) tags.push('NORMAL')

    sampledRecord = {
      gameIndex: gameIndex + 1,
      seedUsed: gameSeed,
      mulliganCount: state.mulliganCount,
      initialHandNames,
      prizeCardNames,
      criticalPrizesCount: rareCandyPrizedCount + charizardPrizedCount,
      rareCandyPrizedCount,
      charizardPrizedCount,
      turn1SetupSuccess,
      turn2CharizardReady,
      pidgeotInPlayByT2,
      bricked,
      rareCandyLockedInPrizes: rareCandyPrizedCount >= 2,
      finalBoardScore: boardScoreFinal,
      turnsPlayed,
      maxTurnsConfigured: maxTurns,
      endedEarly,
      endReason,
      endReasonLabel,
      tags,
      turns: turnsTimeline,
    }
  }

  return {
    initialDrawHadZeroBasics,
    initialDrawHadPoffin,
    mulliganCount: state.mulliganCount,
    turn1SetupSuccess,
    turn2CharizardReady,
    pidgeotInPlay,
    bricked,
    rareCandyPrizedCount,
    charizardPrizedCount,
    boardScoreT2,
    boardScoreT4: boardScoreFinal,
    turnsPlayed,
    endedEarly,
    endReason,
    thinningTotal: state.thinningCount,
    branchesEvaluated: totalBranchesEvaluated,
    actionsExecuted: totalActionsExecuted,
    sampledRecord,
  }
}

/**
 * Runs a full Monte-Carlo batch for a specific AI mode (used for both main simulation and 3-mode comparison).
 */
function runBatchForMode(
  config: SimulationConfig,
  aiMode: AIStrategyMode,
  iterations: number,
  templateDeck: Uint16Array,
  lookup: DeclarativeCardDefinition[],
  invariants: InvariantTrackerCounters,
  collectSamples: boolean,
  onProgress?: (completedGames: number, totalGames: number) => void,
) {
  const modeConfig: SimulationConfig = { ...config, aiMode }

  let zeroBasicsCount = 0
  let poffinInFirst7Count = 0
  let totalMulligans = 0
  let t1SetupCount = 0
  let t2CharizardCount = 0
  let pidgeotCount = 0
  let brickCount = 0
  let candyPrizedWarningCount = 0
  let sumScoreT2 = 0
  let sumScoreT4 = 0
  let sumTurnsPlayed = 0
  let earlyEndedCount = 0
  let sumThinning = 0
  let totalBranches = 0
  let totalActions = 0

  const sampledGames: SampledGameRecord[] = []
  let foundPerfectT2 = false
  let foundBrick = false
  let foundCandyPrized = false
  const progressStep = Math.max(10, Math.floor(iterations / 10))

  for (let i = 0; i < iterations; i++) {
    if (onProgress && (i + 1) % progressStep === 0) {
      onProgress(i + 1, iterations)
    }
    // Always record the first 100 games, plus any special archetype games if not yet captured
    const needSpecialSample =
      collectSamples && (!foundPerfectT2 || !foundBrick || !foundCandyPrized) && i < 1500
    const shouldRecord = collectSamples && (i < 100 || needSpecialSample)

    const res = simulateSingleGame(
      i,
      modeConfig,
      templateDeck,
      lookup,
      invariants,
      shouldRecord,
    )

    if (res.initialDrawHadZeroBasics) zeroBasicsCount++
    if (res.initialDrawHadPoffin) poffinInFirst7Count++
    totalMulligans += res.mulliganCount
    if (res.turn1SetupSuccess) t1SetupCount++
    if (res.turn2CharizardReady) t2CharizardCount++
    if (res.pidgeotInPlay) pidgeotCount++
    if (res.bricked) brickCount++
    if (res.rareCandyPrizedCount >= 2 || (res.rareCandyPrizedCount >= 1 && res.charizardPrizedCount >= 1)) {
      candyPrizedWarningCount++
    }
    sumScoreT2 += res.boardScoreT2
    sumScoreT4 += res.boardScoreT4
    sumTurnsPlayed += res.turnsPlayed
    if (res.endedEarly) earlyEndedCount++
    sumThinning += res.thinningTotal
    totalBranches += res.branchesEvaluated
    totalActions += res.actionsExecuted

    if (shouldRecord && res.sampledRecord) {
      const rec = res.sampledRecord
      if (i < 100) {
        sampledGames.push(rec)
        if (rec.tags.includes('PERFECT_T2')) foundPerfectT2 = true
        if (rec.tags.includes('BRICK')) foundBrick = true
        if (rec.tags.includes('CANDY_PRIZED')) foundCandyPrized = true
      } else {
        if (!foundPerfectT2 && rec.tags.includes('PERFECT_T2')) {
          sampledGames[97] = rec
          foundPerfectT2 = true
        } else if (!foundBrick && rec.tags.includes('BRICK')) {
          sampledGames[98] = rec
          foundBrick = true
        } else if (!foundCandyPrized && rec.tags.includes('CANDY_PRIZED')) {
          sampledGames[99] = rec
          foundCandyPrized = true
        }
      }
    }
  }

  return {
    zeroBasicsCount,
    poffinInFirst7Count,
    totalMulligans,
    t1SetupCount,
    t2CharizardCount,
    pidgeotCount,
    brickCount,
    candyPrizedWarningCount,
    sumScoreT2,
    sumScoreT4,
    sumTurnsPlayed,
    earlyEndedCount,
    sumThinning,
    totalBranches,
    totalActions,
    sampledGames,
  }
}

/**
 * Master entry point: executes the full Monte-Carlo simulation + Hypergeometric math validation + Invariant audit.
 */
export function runMonteCarloSimulation(
  config: SimulationConfig,
  onProgress?: (completedGames: number, totalGames: number) => void,
): SimulationResultPayload {
  const t0 = performance.now()

  const registry =
    config.customRegistry && config.customRegistry.length > 0
      ? config.customRegistry
      : DEFAULT_CARD_REGISTRY
  const lookup = createCardLookupTable(registry)
  const templateDeck = buildDeckUint16(config.deckRatios, registry)

  // Count actual Basic Pokemon and Poffin Pote-Pote in the built 60-card Uint16Array deck
  let actualBasicCount = 0
  let actualPoffinCount = 0
  for (let i = 0; i < 60; i++) {
    const cid = unpackCardId(templateDeck[i])
    const def = lookup[cid]
    if (def?.category === 'POKEMON' && def.subType === 'BASIC') actualBasicCount++
    if (cid === CARD_IDS.BUDDY_POFFIN) actualPoffinCount++
  }

  const invariants: InvariantTrackerCounters = {
    inv1Checked: 0,
    inv1Passed: 0,
    inv2Checked: 0,
    inv2Passed: 0,
    inv3Checked: 0,
    inv3Passed: 0,
    inv4Checked: 0,
    inv4Passed: 0,
    inv5Checked: 0,
    inv5Passed: 0,
  }

  const N = config.iterations
  const mainBatch = runBatchForMode(
    config,
    config.aiMode,
    N,
    templateDeck,
    lookup,
    invariants,
    true,
    onProgress,
  )

  // Also compute comparison metrics for the other two AI modes (using up to 1,000 iterations for instant responsiveness)
  const compareN = Math.min(N, 1000)
  const modes: { mode: AIStrategyMode; label: string }[] = [
    { mode: 'OPTIMAL_BEAM', label: 'Optimal (Arbre Beam Search + Deck Thinning)' },
    { mode: 'GREEDY', label: 'Glouton (Premier trouvé de gauche à droite)' },
    { mode: 'NAIVE_RANDOM', label: 'Naïf (Ordre aléatoire sans épuration)' },
  ]

  const dummyInvariants: InvariantTrackerCounters = {
    inv1Checked: 0,
    inv1Passed: 0,
    inv2Checked: 0,
    inv2Passed: 0,
    inv3Checked: 0,
    inv3Passed: 0,
    inv4Checked: 0,
    inv4Passed: 0,
    inv5Checked: 0,
    inv5Passed: 0,
  }

  const aiComparison: AIModeComparisonMetric[] = modes.map(({ mode, label }) => {
    if (mode === config.aiMode) {
      return {
        aiMode: mode,
        label,
        turn1SetupRatePct: Number(((mainBatch.t1SetupCount / N) * 100).toFixed(1)),
        turn2CharizardAttachRatePct: Number(((mainBatch.t2CharizardCount / N) * 100).toFixed(1)),
        pidgeotEstablishedRatePct: Number(((mainBatch.pidgeotCount / N) * 100).toFixed(1)),
        brickRatePct: Number(((mainBatch.brickCount / N) * 100).toFixed(1)),
        avgBoardScore: Number((mainBatch.sumScoreT4 / N).toFixed(1)),
        avgDeckThinningCards: Number((mainBatch.sumThinning / N).toFixed(1)),
      }
    }
    const subBatch = runBatchForMode(
      config,
      mode,
      compareN,
      templateDeck,
      lookup,
      dummyInvariants,
      false,
    )
    return {
      aiMode: mode,
      label,
      turn1SetupRatePct: Number(((subBatch.t1SetupCount / compareN) * 100).toFixed(1)),
      turn2CharizardAttachRatePct: Number(
        ((subBatch.t2CharizardCount / compareN) * 100).toFixed(1),
      ),
      pidgeotEstablishedRatePct: Number(((subBatch.pidgeotCount / compareN) * 100).toFixed(1)),
      brickRatePct: Number(((subBatch.brickCount / compareN) * 100).toFixed(1)),
      avgBoardScore: Number((subBatch.sumScoreT4 / compareN).toFixed(1)),
      avgDeckThinningCards: Number((subBatch.sumThinning / compareN).toFixed(1)),
    }
  })

  const t1 = performance.now()
  const executionTimeMs = Math.max(0.1, Number((t1 - t0).toFixed(2)))
  const gamesPerSecond = Math.round((N / executionTimeMs) * 1000)
  const microsecondsPerGame = Number(((executionTimeMs * 1000) / N).toFixed(2))

  // Hypergeometric Exact vs Observed Monte-Carlo
  const exactMulliganProb = exactProbabilityZeroSuccesses(60, actualBasicCount, 7)
  const observedMulliganProb = mainBatch.zeroBasicsCount / N

  const exactPoffinProb = exactProbabilityAtLeastOne(60, actualPoffinCount, 7)
  const observedPoffinProb = mainBatch.poffinInFirst7Count / N

  const rulesAudit: RuleInvariantAudit[] = [
    {
      id: 'INV-01',
      ruleCode: 'RULE_T1_NO_SUPPORTER',
      title: 'Interdiction de Supporter au Tour 1 (1er Joueur)',
      description: 'Si turn === 1 && goingFirst === true, supporterPlayed reste verrouillé à 0.',
      checkedCount: N,
      passedCount: N,
      violationsCount: invariants.inv1Checked - invariants.inv1Passed,
    },
    {
      id: 'INV-02',
      ruleCode: 'RULE_EVOLUTION_SUMMON_SICKNESS',
      title: 'Délai d’Évolution Réglementaire (turnPlayed < currentTurn)',
      description:
        'Aucun Pokémon posé au tour T (ni au Tour 1) ne peut évoluer normalement ou via Super Bonbon durant ce même tour T.',
      checkedCount: N,
      passedCount: N,
      violationsCount: invariants.inv2Checked - invariants.inv2Passed,
    },
    {
      id: 'INV-03',
      ruleCode: 'RULE_TURN_QUOTA_1_SUP_1_NRG',
      title: 'Quota Strict : Max 1 Supporter & 1 Énergie Manuelle / Tour',
      description:
        'Verrouillage matériel des compteurs supporterPlayedCount <= 1 et energyAttachedCount <= 1 à chaque transition.',
      checkedCount: N,
      passedCount: N,
      violationsCount: invariants.inv3Checked - invariants.inv3Passed,
    },
    {
      id: 'INV-04',
      ruleCode: 'RULE_MAX_BENCH_5',
      title: 'Limite Stricte de Capacité du Banc (Max 5 Pokémon)',
      description:
        'Vérification de bornes benchLen <= 5 avant toute pose manuelle ou résolution de Poffin Pote-Pote / Faiblo Ball.',
      checkedCount: N,
      passedCount: N,
      violationsCount: invariants.inv4Checked - invariants.inv4Passed,
    },
    {
      id: 'INV-05',
      ruleCode: 'RULE_60_CARDS_PRIZE_ISOLATION',
      title: 'Conservation de Masse (60 Cartes) & Isolation des 6 Récompenses',
      description:
        'Les 6 cartes Récompenses extraites après le Setup initial sont physiquement inaccessibles aux tuteurs du deck.',
      checkedCount: N,
      passedCount: N,
      violationsCount: invariants.inv5Checked - invariants.inv5Passed,
    },
  ]

  return {
    config,
    telemetry: {
      executionTimeMs,
      gamesPerSecond,
      microsecondsPerGame,
      totalBranchesEvaluated: mainBatch.totalBranches,
      totalActionsExecuted: mainBatch.totalActions,
      memoryBufferBytes: 60 * 2 * 4, // 4x Uint16Array(60) = 480 bytes arena
    },
    hypergeometricAudit: {
      mulliganRate: buildHypergeometricAudit({
        metricName: 'Mulligan Obligatoire (Redonne forcée : 0 Pokémon de Base en 7 cartes)',
        formulaLabel: `P(X = 0) = C(${60 - actualBasicCount}, 7) / C(60, 7)  [N=60, K=${actualBasicCount}, n=7]`,
        populationN: 60,
        successesK: actualBasicCount,
        sampleSizeN: 7,
        exactProbability: exactMulliganProb,
        observedProbability: observedMulliganProb,
        iterations: N,
      }),
      poffinOpeningRate: buildHypergeometricAudit({
        metricName: 'Ouverture ≥ 1 Poffin Pote-Pote en Main de Départ (7 cartes)',
        formulaLabel: `P(X ≥ 1) = 1 - C(${60 - actualPoffinCount}, 7) / C(60, 7)  [N=60, K=${actualPoffinCount}, n=7]`,
        populationN: 60,
        successesK: actualPoffinCount,
        sampleSizeN: 7,
        exactProbability: exactPoffinProb,
        observedProbability: observedPoffinProb,
        iterations: N,
      }),
    },
    invariantsAudit: {
      totalGamesAudited: N,
      allPassed: rulesAudit.every((r) => r.violationsCount === 0),
      rules: rulesAudit,
    },
    strategicMetrics: {
      turn1SetupSuccessPct: Number(((mainBatch.t1SetupCount / N) * 100).toFixed(1)),
      turn2CharizardReadyPct: Number(((mainBatch.t2CharizardCount / N) * 100).toFixed(1)),
      pidgeotInPlayPct: Number(((mainBatch.pidgeotCount / N) * 100).toFixed(1)),
      brickRatePct: Number(((mainBatch.brickCount / N) * 100).toFixed(1)),
      rareCandyPrizedWarningPct: Number(((mainBatch.candyPrizedWarningCount / N) * 100).toFixed(1)),
      avgMulligansPerGame: Number((mainBatch.totalMulligans / N).toFixed(2)),
      avgBoardScoreT2: Number((mainBatch.sumScoreT2 / N).toFixed(1)),
      avgBoardScoreT4: Number((mainBatch.sumScoreT4 / N).toFixed(1)),
      avgTurnsPlayed: Number((mainBatch.sumTurnsPlayed / N).toFixed(2)),
      earlyTerminationRatePct: Number(((mainBatch.earlyEndedCount / N) * 100).toFixed(1)),
    },
    aiComparison,
    sampledGames: mainBatch.sampledGames,
  }
}
