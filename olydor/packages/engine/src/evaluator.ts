/**
 * Évaluateur Stratégique 3-Ply (`src/core/evaluator.ts`) — Anticipation T -> T_adv -> T+1.
 *
 * Utilise exclusivement `Engine` (`getLegalActions`, `applyAction`, `startTurn`) et les poids
 * déclaratifs de `strategicEvaluator` (`EngineCardModel`) pour :
 * 1. Explorer toutes les branches d'actions complètes d'un tour (avec dédoublonnage par Hash Canonique `getStateHash`).
 * 2. Respecter le plafond `maxBranches` (`8`, `20`, `50` ou `'INFINITE'`).
 * 3. Évaluer chaque branche candidate sur 3 demi-tours (3-Ply Lookahead : Fin de Tour T -> Réaction Optimale Adverse T_adv -> Rebond Joueur T+1).
 * 4. Calculer le score final : Score(B) = 0.35 * V(S_T) - 0.30 * V_adv(S_{T_adv}) + 0.35 * V(S_{T+1}).
 */

import type {
  AiTemperament,
  EngineCardModel,
  EvaluatedBranchTrace,
  EvaluatorOptions,
  LookaheadPly,
  MaxBranchesSetting,
  PlayableAction,
  TurnBranchDecision,
} from '@olydor/types'
import { getCardFastMeta } from './cardCatalog.js'
import {
  applyAction,
  canPayEnergyCost,
  canPokemonAttackTwice,
  computeAttackDamageToActive,
  endTurnAndAdvance,
  fastCloneState,
  getActiveBoard,
  getEffectiveAttackCost,
  getMainAttackEnergyRequirement,
  getPassiveBoard,
  getPokemonMaxHp,
  getPokemonRetreatCost,
  getRemainingHp,
  getLegalActions,
  hasEffectiveItemLock,
  isCardDeadInHand,
  isCardTemporallyWaiting,
  isPokemonAttackBlocked,
  isZeroEnergyItemLockAttack,
  startTurn,
  type GameAction,
  type InPlayPokemon,
  type MatchState,
  type PlayerBoardState,
} from './engine.js'
import { computeNumericStateHash } from './fastState.js'

export type {
  AiTemperament,
  EvaluatedBranchTrace,
  EvaluatorOptions,
  LookaheadPly,
  MaxBranchesSetting,
  TurnBranchDecision,
}

function resolvePlyWeights(temperament: AiTemperament = 'BALANCED'): {
  wT: number
  wAdv: number
  wRebound: number
} {
  switch (temperament) {
    case 'AGGRESSIVE':
      return { wT: 0.45, wAdv: 0.25, wRebound: 0.3 }
    case 'CONSERVATIVE':
      return { wT: 0.25, wAdv: 0.45, wRebound: 0.3 }
    case 'BALANCED':
    default:
      return { wT: 0.35, wAdv: 0.3, wRebound: 0.35 }
  }
}

interface PartialTurnNode {
  state: MatchState
  actions: GameAction[]
  heuristicScore: number
}

const WIN_SCORE = 10000

const intrinsicValueCache = new WeakMap<EngineCardModel, number>()

/**
 * Calcule les dégâts garantis du Contrôle Pokémon entre deux tours (Poison +10, Brûlure +20 avant lancer de pièce).
 */
function getGuaranteedCheckupDamage(
  poke: InPlayPokemon | null | undefined,
  pendingEffects?: PlayableAction['effects'],
): number {
  let dmg = 0
  let hasPoison = Boolean(poke?.specialConditions?.includes('POISONED'))
  let hasBurn = Boolean(poke?.specialConditions?.includes('BURNED'))
  if (pendingEffects) {
    for (let i = 0; i < pendingEffects.length; i++) {
      const eff = pendingEffects[i]!
      if (eff.primitive === 'APPLY_SPECIAL_CONDITION' && eff.target !== 'SELF') {
        if (eff.specialCondition === 'BURNED') hasBurn = true
        else if (!eff.specialCondition || eff.specialCondition === 'POISONED') hasPoison = true
      }
    }
  }
  if (hasPoison) dmg += 10
  if (hasBurn) dmg += 20
  return dmg
}

/**
 * Estime les dégâts maximums qu'un Pokémon Actif peut immédiatement infliger avec ses attaques payables.
 */
function getMaxImmediateAttackDamage(
  attackerBoard: PlayerBoardState,
  defenderBoard: PlayerBoardState,
  state: MatchState,
  atkPoke: InPlayPokemon | null,
): number {
  if (!atkPoke || !defenderBoard.activePokemon) return 0
  if (isPokemonAttackBlocked(atkPoke, state)) return 0
  let maxDmg = 0
  const mult = canPokemonAttackTwice(atkPoke, state) ? 2 : 1
  for (const pAct of atkPoke.card.playableActions) {
    if (pAct.actionType !== 'ATTACK' && pAct.sourceType !== 'ATTACK') continue
    const effCost = getEffectiveAttackCost(atkPoke, pAct, state, defenderBoard)
    if (!canPayEnergyCost(atkPoke.attachedEnergies, effCost)) continue
    const dmgInfo = computeAttackDamageToActive(attackerBoard, defenderBoard, pAct, state)
    const checkup = getGuaranteedCheckupDamage(defenderBoard.activePokemon, pAct.effects)
    const total = dmgInfo.expectedActiveDamage * mult + (dmgInfo.expectedActiveDamage > 0 || checkup > 0 ? checkup : 0)
    if (total > maxDmg) maxDmg = total
  }
  return maxDmg
}

/**
 * Calcule dynamiquement la valeur intrinsèque d'une carte (mise en cache O(1))
 * à partir de son rôle v2, de ses stats et de ses primitives d'effets.
 */
export function computeCardIntrinsicValue(card: EngineCardModel): number {
  if (card.strategicEvaluator.intrinsicBaseScore != null) {
    return card.strategicEvaluator.intrinsicBaseScore
  }
  const cached = intrinsicValueCache.get(card)
  if (cached !== undefined) return cached

  const role = card.strategicEvaluator.aiRole || card.strategicEvaluator.primaryRole || 'GUEST_TECH'
  let score = 68
  if (role === 'MAIN_ATTACKER') score = 95
  else if (role === 'CONSISTENCY_BOOSTER') score = 90
  else if (role === 'ENERGY_ACCELERATOR') score = 88
  else if (role === 'DRAW_ENGINE') score = 88
  else if (role === 'SECONDARY_ATTACKER') score = 82
  else if (role === 'DISRUPTION') score = 80

  if (card.category !== 'POKEMON' && card.identity.isAceSpec) score += 18

  let maxDmg = 0
  let utilityBonus = 0
  for (const act of card.playableActions) {
    for (const eff of act.effects) {
      if (eff.primitive === 'DAMAGE_ACTIVE' && eff.target !== 'SELF') {
        const d = eff.value ?? eff.baseDamage ?? 0
        if (d > maxDmg) maxDmg = d
      } else if (eff.primitive === 'SEARCH_DECK') utilityBonus = Math.max(utilityBonus, 10)
      else if (eff.primitive === 'DRAW_CARDS') utilityBonus = Math.max(utilityBonus, 8)
      else if (eff.primitive === 'ATTACH_ENERGY') utilityBonus = Math.max(utilityBonus, 10)
      else if (eff.primitive === 'PLACE_DAMAGE_COUNTERS') utilityBonus = Math.max(utilityBonus, 10)
      else if (
        eff.primitive === 'SWITCH_ACTIVE' &&
        (eff.target === 'OPPONENT_BENCH_SINGLE' || eff.target === 'OPPONENT_ACTIVE' || (eff.target as string) === 'OPPONENT_BENCH')
      ) {
        utilityBonus = Math.max(utilityBonus, 12)
      } else if (eff.primitive === 'LOCK_ITEMS' || eff.primitive === 'LOCK_ABILITIES') {
        utilityBonus = Math.max(utilityBonus, 10)
      } else if (eff.primitive === 'PREVENT_DAMAGE_OR_EFFECTS' || eff.primitive === 'EXPAND_BENCH') {
        utilityBonus = Math.max(utilityBonus, 8)
      }
    }
  }
  if (maxDmg >= 200) score += 12
  else if (maxDmg >= 120) score += 6
  score += utilityBonus

  intrinsicValueCache.set(card, score)
  return score
}

/**
 * Retourne le multiplicateur temporel `turnPhaseWeights` d'une carte selon le numéro de tour.
 */
export function getTurnPhaseWeight(card: EngineCardModel, turnNumber: number): number {
  const weights = card.strategicEvaluator.turnPhaseWeights
  // En Pokémon TCG, Tour 1 et 2 du match = Tour 1 de chaque joueur ; Tour 3 et 4 = Tour 2 de chaque joueur, etc.
  const playerTurnIndex = Math.ceil(turnNumber / 2)
  if (playerTurnIndex <= 1) return weights.turn1
  if (playerTurnIndex === 2) return weights.turn2
  if (playerTurnIndex === 3) return weights.turn3
  return weights.turn4Plus
}

/**
 * Calcule le score de menace (`Threat Score`) d'un Pokémon en jeu :
 * utilisé à la fois dans `evaluateState` et pour cibler intelligemment avec *Ordres du Boss* / *Attrape-Riposte*.
 */
export function computePokemonThreatScore(
  poke: InPlayPokemon,
  turnNumber: number,
  isActiveSlot: boolean,
): number {
  const card = poke.card
  const baseScore = computeCardIntrinsicValue(card)
  const phaseMult = getTurnPhaseWeight(card, turnNumber)
  const role = (card.strategicEvaluator.aiRole || card.strategicEvaluator.primaryRole || 'GUEST_TECH') as string

  let score = baseScore * phaseMult * 0.55

  // Bonus de stade d'évolution
  if (card.subCategory === 'STAGE_2') score += 65
  else if (card.subCategory === 'STAGE_1') score += 30

  // Bonus de rôle stratégique officiel v2 (+ compatibilité alias)
  if (role === 'MAIN_ATTACKER') score += 45
  else if (role === 'CONSISTENCY_BOOSTER' || role === 'TUTOR_ENGINE_POKEMON') score += 55
  else if (role === 'DRAW_ENGINE' || role === 'DRAW_ENGINE_POKEMON') score += 35
  else if (role === 'ENERGY_ACCELERATOR') score += 40
  else if (role === 'SECONDARY_ATTACKER' || role === 'SNIPER_BENCH_ATTACKER') score += 40
  else if (role === 'DISRUPTION' || role === 'CONTROL_LOCK_DISRUPTION') score += 35
  else if (role === 'GUEST_TECH' || role === 'DEFENSIVE_TANK_WALL' || role === 'PASSIVE_STAT_BUFFER' || role === 'HEALER_SUPPORT') score += 30

  // Valeur des énergies attachées jusqu'au coût d'attaque principal
  const reqEnergy = getMainAttackEnergyRequirement(card)
  const attachedCount = poke.attachedEnergies.length
  const effectiveEnergies = Math.min(attachedCount, reqEnergy + 1)
  score += effectiveEnergies * 22
  if (attachedCount >= reqEnergy && (role === 'MAIN_ATTACKER' || card.subCategory === 'STAGE_2')) {
    score += 35
  }

  // Outils attachés & bonus PV dynamiques
  score += poke.attachedTools.length * 16
  if (poke.hpBonus && poke.hpBonus > 0) {
    score += Math.min(40, poke.hpBonus * 0.25)
  }

  // Pénalité de dégâts subis (et vulnérabilité de Pokémon à 2 Récompenses blessé)
  const maxHp = Math.max(40, getPokemonMaxHp(poke))
  const remHp = Math.max(0, maxHp - poke.damage)
  const hpRatio = remHp / maxHp
  score *= 0.55 + 0.45 * hpRatio

  if (isActiveSlot && role === 'MAIN_ATTACKER' && attachedCount >= reqEnergy) {
    score += 25
  }

  return score
}

function scoreConditions(conds?: readonly string[]): number {
  if (!conds || conds.length === 0) return 0
  let val = 0
  for (const c of conds) {
    if (c === 'PARALYZED') val += 55
    else if (c === 'ASLEEP') val += 30
    else if (c === 'CONFUSED') val += 28
    else if (c === 'POISONED') val += 18
    else if (c === 'BURNED') val += 18
  }
  return val
}

const _seenHandIds: string[] = []

function markSeenHandId(cardId: string): boolean {
  for (let i = 0; i < _seenHandIds.length; i++) {
    if (_seenHandIds[i] === cardId) return true
  }
  _seenHandIds.push(cardId)
  return false
}

function getPokeAt(board: PlayerBoardState, idx: number, hasActive: boolean): InPlayPokemon {
  if (hasActive) {
    return idx === 0 ? board.activePokemon! : board.bench[idx - 1]!
  }
  return board.bench[idx]!
}

function computePerspectiveSideScore(state: MatchState, sideIndex: 0 | 1): number {
  const myBoard = sideIndex === 0 ? state.player : state.opponent
  const oppBoard = sideIndex === 0 ? state.opponent : state.player

  let totalScore = 0

  // Récompenses déjà prises + urgence fin de partie
  const myPrizesTaken = 6 - myBoard.prizes.length
  totalScore += myPrizesTaken * 145
  if (myBoard.prizes.length <= 2) {
    totalScore += (3 - myBoard.prizes.length) * 45
  }

  const myHasActive = myBoard.activePokemon !== null
  const myPokeCount = (myHasActive ? 1 : 0) + myBoard.bench.length

  if (myBoard.activePokemon) {
    totalScore += computePokemonThreatScore(myBoard.activePokemon, state.turnNumber, true)
    if (myBoard.activePokemon.damage > 0) {
      totalScore -= Math.min(90, myBoard.activePokemon.damage * 0.25)
    }
  } else {
    totalScore -= 300
  }

  for (let i = 0; i < myBoard.bench.length; i++) {
    const bPoke = myBoard.bench[i]!
    totalScore += computePokemonThreatScore(bPoke, state.turnNumber, false)
    if (bPoke.damage > 0) {
      totalScore -= Math.min(60, bPoke.damage * 0.2)
    }
  }

  // Stabilité du Banc (et bonus EXPAND_BENCH si > 5 slots utilisés)
  if (myBoard.bench.length === 0) {
    totalScore -= 85
  } else if (myBoard.bench.length === 1) {
    totalScore -= 25
  } else {
    totalScore += Math.min(4, myBoard.bench.length) * 14
    if (myBoard.bench.length > 5) {
      totalScore += (myBoard.bench.length - 5) * 18
    }
  }

  // Passage unique sur les Pokémon propres en jeu pour agréger rôles, dégâts, synergies & primitives
  let hasBenchPressure = false
  let hasControlLock = false
  let hasDiscardEnergyAccelerator = false
  let hasTeraInPlay = false
  let hasStage2InPlay = false
  let hasBasicHpLte70InPlay = false
  let hasAncientInPlay = false
  let damagedKeyCount = 0

  for (let i = 0; i < myPokeCount; i++) {
    const p = getPokeAt(myBoard, i, myHasActive)
    const stats = p.card.pokemonStats
    const strat = p.card.strategicEvaluator
    const r = (strat.aiRole || strat.primaryRole) as string
    if (r === 'DISRUPTION' || r === 'CONTROL_LOCK_DISRUPTION') hasControlLock = true
    if (r === 'SECONDARY_ATTACKER' || (strat.primaryRole as string) === 'SNIPER_BENCH_ATTACKER') {
      hasBenchPressure = true
    }
    if (p.card.cardId === 'sv01-086' || p.card.cardId === 'sv04-123') {
      hasDiscardEnergyAccelerator = true
    }
    if (p.card.identity.isTera || stats?.isTera) hasTeraInPlay = true
    if (p.card.subCategory === 'STAGE_2') hasStage2InPlay = true
    if (p.card.subCategory === 'BASIC' && (stats?.hp ?? 999) <= 70) hasBasicHpLte70InPlay = true
    if (p.card.identity.isAncient || stats?.isAncient) hasAncientInPlay = true
    if ((p.card.subCategory === 'STAGE_2' || Boolean(stats?.isRuleBox)) && p.damage > 0) {
      damagedKeyCount++
    }
  }

  const oppHasActive = oppBoard.activePokemon !== null
  const oppPokeCount = (oppHasActive ? 1 : 0) + oppBoard.bench.length

  for (let i = 0; i < myPokeCount; i++) {
    const p = getPokeAt(myBoard, i, myHasActive)
    const strat = p.card.strategicEvaluator
    const r = (strat.aiRole || strat.primaryRole) as string
    let hasDefOrBuff = false
    let hasHealPrim = false

    const actions = p.card.playableActions
    for (let ai = 0; ai < actions.length; ai++) {
      const pa = actions[ai]!
      const effects = pa.effects
      for (let ei = 0; ei < effects.length; ei++) {
        const prim = effects[ei]!.primitive
        if (prim === 'DAMAGE_BENCH' || prim === 'PLACE_DAMAGE_COUNTERS') {
          hasBenchPressure = true
          if (pa.actionType === 'ATTACK' || pa.actionType === 'USE_ABILITY') {
            if (prim === 'PLACE_DAMAGE_COUNTERS') {
              const eff = effects[ei]!
              const val = eff.value ?? eff.baseDamage ?? (eff.count ? eff.count * 10 : 0)
              if (val > 0) {
                let koCount = 0
                for (let oi = 0; oi < oppPokeCount; oi++) {
                  if (getRemainingHp(getPokeAt(oppBoard, oi, oppHasActive), state) <= val) {
                    koCount++
                  }
                }
                totalScore += Math.min(40, koCount * 14)
              }
            }
          }
        } else if (
          prim === 'MODIFY_DAMAGE_TAKEN' ||
          prim === 'MODIFY_HP' ||
          prim === 'PREVENT_DAMAGE_OR_EFFECTS'
        ) {
          hasDefOrBuff = true
        } else if (prim === 'HEAL') {
          hasHealPrim = true
        } else if (
          prim === 'ATTACH_ENERGY' &&
          (effects[ei]!.sourceZone === 'DISCARD' || effects[ei]!.zone === 'DISCARD')
        ) {
          hasDiscardEnergyAccelerator = true
        }
      }
      // Break out of further action scan for PLACE_DAMAGE_COUNTERS? No, match exact `pa.effects.find` (max 1 PLACE_DAMAGE_COUNTERS contribution per `pa`).
    }

    if (hasDefOrBuff || r === 'GUEST_TECH' || r === 'DEFENSIVE_TANK_WALL' || r === 'PASSIVE_STAT_BUFFER') {
      const maxHp = Math.max(40, getPokemonMaxHp(p, state))
      const remHp = Math.max(0, maxHp - p.damage)
      if (remHp >= maxHp * 0.7) {
        totalScore += 28 + Math.round((remHp / maxHp) * 18)
      }
    }
    if (r === 'HEALER_SUPPORT' || hasHealPrim) {
      totalScore += Math.min(45, damagedKeyCount * 15)
    }

    const reqs = strat.decklistSynergyRequirements
    if (reqs && reqs.length > 0) {
      for (let ri = 0; ri < reqs.length; ri++) {
        const req = reqs[ri]!
        if (req === 'requires_tera_pokemon') {
          if (hasTeraInPlay) totalScore += 8
        } else if (req === 'requires_stage_2_pokemon') {
          let hasS2 = hasStage2InPlay
          if (!hasS2) {
            for (let hi = 0; hi < myBoard.hand.length; hi++) {
              if (myBoard.hand[hi]!.subCategory === 'STAGE_2') {
                hasS2 = true
                break
              }
            }
          }
          if (hasS2) totalScore += 8
        } else if (req === 'requires_basic_hp_lte_70') {
          if (hasBasicHpLte70InPlay) totalScore += 6
        } else if (req === 'requires_discard_synergy') {
          if (myBoard.discard.length >= 2) totalScore += 6
        } else if (req === 'requires_ancient_pokemon') {
          if (hasAncientInPlay) totalScore += 6
        } else if (req.startsWith('requires_energy_type:')) {
          const reqType = req.slice('requires_energy_type:'.length).toLowerCase()
          let hasType = false
          for (let ei = 0; ei < p.attachedEnergies.length; ei++) {
            if (p.attachedEnergies[ei]!.identity.nameFr.toLowerCase().includes(reqType)) {
              hasType = true
              break
            }
          }
          if (!hasType) {
            for (let di = 0; di < myBoard.discard.length; di++) {
              const dc = myBoard.discard[di]!
              if (dc.category === 'ENERGY' && dc.identity.nameFr.toLowerCase().includes(reqType)) {
                hasType = true
                break
              }
            }
          }
          if (hasType) totalScore += 6
        } else if (req.startsWith('requires_evolution_line:')) {
          const lineName = req.slice('requires_evolution_line:'.length).toLowerCase()
          for (let mi = 0; mi < myPokeCount; mi++) {
            if (getPokeAt(myBoard, mi, myHasActive).card.identity.nameFr.toLowerCase().includes(lineName)) {
              totalScore += 6
              break
            }
          }
        }
      }
    }
  }

  // Pression sur le Banc adverse
  if (hasBenchPressure) {
    let fragileCount = 0
    for (let i = 0; i < oppBoard.bench.length; i++) {
      const p = oppBoard.bench[i]!
      const rem = getRemainingHp(p, state)
      if (rem <= 90 || (Boolean(p.card.pokemonStats?.isRuleBox) && p.damage >= 50)) {
        fragileCount++
      }
    }
    totalScore += fragileCount * 25
  }

  // Verrous, protections & États Spéciaux propres (symétrisés par différence dans evaluateState)
  if (hasEffectiveItemLock(state, myBoard)) {
    totalScore -= state.turnNumber <= 2 ? 110 : 50
  }
  if (myBoard.abilityLockActive) totalScore -= 65
  if (myBoard.activePokemon?.cantRetreatNextTurn) totalScore -= 25
  if (myBoard.activePokemon?.cantAttackNextTurn) totalScore -= 40
  if (myBoard.activePokemon?.preventDamageOrEffectsNextTurn) totalScore += 90
  if (myBoard.activePokemon?.damageTakenModifierNextTurn && myBoard.activePokemon.damageTakenModifierNextTurn < 0) {
    totalScore += Math.min(80, Math.abs(myBoard.activePokemon.damageTakenModifierNextTurn) * 1.1)
  }
  totalScore -= scoreConditions(myBoard.activePokemon?.specialConditions)

  if (hasControlLock) totalScore += 35

  // Bonus TAKE_EXTRA_PRIZE sur l'attaque de l'Actif
  if (myBoard.activePokemon) {
    const activeActions = myBoard.activePokemon.card.playableActions
    let hasExtraPrize = false
    for (let ai = 0; ai < activeActions.length && !hasExtraPrize; ai++) {
      const a = activeActions[ai]!
      if (a.actionType !== 'ATTACK') continue
      for (let ei = 0; ei < a.effects.length; ei++) {
        const prim = a.effects[ei]!.primitive as string
        if (prim === 'TAKE_EXTRA_PRIZE' || prim === 'TAKE_EXTRA_PRIZE_CARDS') {
          hasExtraPrize = true
          break
        }
      }
    }
    if (hasExtraPrize) totalScore += 60
  }

  // Bonus Double Attaque ("Fête Battante" / Festival Lead sous Stade) & Bonus de dégâts du tour
  const isDoubleAttacker = canPokemonAttackTwice(myBoard.activePokemon, state)
  if (isDoubleAttacker) {
    totalScore += 75
  }
  if (myBoard.turnDamageBoost && myBoard.turnDamageBoost > 0) {
    totalScore += myBoard.turnDamageBoost * (isDoubleAttacker ? 2.2 : 1.2)
  }

  // Risque d'exposition d'un Pokémon à 2 ou 3 Récompenses
  if (myBoard.activePokemon && oppBoard.activePokemon) {
    const myActivePrizes = myBoard.activePokemon.card.pokemonStats?.prizeCardsGiven ?? 1
    const myActiveRemHp = getRemainingHp(myBoard.activePokemon, state)
    if (myActivePrizes >= 2) {
      const oppMaxDmg = getMaxImmediateAttackDamage(oppBoard, myBoard, state, oppBoard.activePokemon)
      if (oppMaxDmg >= myActiveRemHp) {
        totalScore -= myActivePrizes >= oppBoard.prizes.length ? 170 : oppBoard.prizes.length <= 2 || myActivePrizes >= 3 ? 75 : 25
      }
    }
    const checkupSelfRisk = getGuaranteedCheckupDamage(myBoard.activePokemon)
    if (checkupSelfRisk > 0 && myActiveRemHp <= checkupSelfRisk) {
      totalScore -= myActivePrizes * 40
    }
  }

  // Évaluation dynamique de la Main
  _seenHandIds.length = 0
  for (let i = 0; i < myBoard.hand.length; i++) {
    const card = myBoard.hand[i]!
    if (isCardDeadInHand(card, myBoard, oppBoard, state.activeStadium)) {
      if (isCardTemporallyWaiting(card, myBoard, oppBoard, state.activeStadium)) {
        const base = computeCardIntrinsicValue(card)
        const holdBonus = card.strategicEvaluator.holdForNextTurnBonus ?? 20
        const duplicateFactor = markSeenHandId(card.cardId) ? 0.35 : 1.0
        totalScore += (base * 0.08 + holdBonus * 0.35) * duplicateFactor
      }
      continue
    }
    const base = computeCardIntrinsicValue(card)
    const phaseWeight = getTurnPhaseWeight(card, state.turnNumber)
    const holdBonus = card.strategicEvaluator.holdForNextTurnBonus ?? 15
    const isDuplicateInHand = markSeenHandId(card.cardId)

    const duplicateFactor = isDuplicateInHand ? 0.45 : 1.0
    totalScore += (base * phaseWeight * 0.14 + holdBonus * 0.18) * duplicateFactor
  }

  // Synergie avec le Cimetière
  if (hasDiscardEnergyAccelerator) {
    let basicEnergiesInDiscard = 0
    for (let i = 0; i < myBoard.discard.length; i++) {
      const dCard = myBoard.discard[i]!
      if (dCard.category === 'ENERGY' && dCard.subCategory === 'BASIC_ENERGY') {
        basicEnergiesInDiscard++
      }
    }
    totalScore += Math.min(6, basicEnergiesInDiscard) * 14
  }

  // Pénalité si le deck approche dangereusement du Deck-Out
  if (myBoard.deck.length <= 3) {
    totalScore -= (4 - myBoard.deck.length) * 35
  }

  return totalScore
}

/**
 * Fonction d'évaluation dynamique d'un état $V(S)$ du point de vue du joueur `perspectiveIndex` (`0` = PLAYER, `1` = OPPONENT).
 * Strictement à somme nulle ($V(S, 0) = -V(S, 1)$) et nulle en cas de match nul (`DRAW`).
 */
export function evaluateState(state: MatchState, perspectiveIndex: 0 | 1): number {
  const myWinnerLabel = perspectiveIndex === 0 ? 'PLAYER' : 'OPPONENT'
  const oppWinnerLabel = perspectiveIndex === 0 ? 'OPPONENT' : 'PLAYER'

  // 1. Conditions terminales de victoire / défaite / match nul
  if (state.winner === myWinnerLabel) {
    return WIN_SCORE
  }
  if (state.winner === oppWinnerLabel) {
    return -WIN_SCORE
  }
  if (state.winner === 'DRAW') {
    return 0
  }

  const oppIndex: 0 | 1 = perspectiveIndex === 0 ? 1 : 0
  const diff =
    computePerspectiveSideScore(state, perspectiveIndex) -
    computePerspectiveSideScore(state, oppIndex)
  const rounded = Math.round(diff * 10) / 10
  return rounded === 0 ? 0 : rounded
}

/**
 * Calcule l'empreinte canonique (`getStateHash(state)`) d'un `MatchState` à un instant T.
 * Utilise le hachage numérique commutatif Zobrist / Murmur3 (`computeNumericStateHash`)
 * pour dédoublonner les séquences d'actions commutatives sans tri ni allocation mémoire.
 */
export function getStateHash(state: MatchState): string {
  return `T${state.turnNumber}_P${state.activePlayerIndex}_W${state.winner || 'N'}_${computeNumericStateHash(state).toString(36)}`
}

/**
 * Trie et filtre les actions atomiques légales à l'intérieur d'un tour pour prioriser les coups à haute valeur
 * (ex: Évolutions, Tuteurs de Banc au T1, Talents de pioche, Gust sur une cible qu'on peut mettre KO).
 */
function scoreAtomicActionHeuristic(state: MatchState, action: GameAction): number {
  const activeBoard = getActiveBoard(state)
  const passiveBoard = getPassiveBoard(state)

  const isTurn1GoingSecond =
    (state.turnNumber === 1 || state.turnNumber === 2) &&
    state.activePlayerIndex !== state.firstPlayerIndex

  const hasLastCardComboInHand =
    !activeBoard.supporterPlayedThisTurn &&
    activeBoard.hand.some((c) =>
      c.playableActions.some((a) =>
        a.preconditions.some((p) => {
          const pt = (typeof p === 'string' ? p : (p as any)?.type || '').toUpperCase()
          return pt === 'HAND_MAX_OTHER_CARDS_ZERO' || pt === 'HAND_IS_EMPTY'
        }),
      ),
    )
  const handReducesBonus = hasLastCardComboInHand && activeBoard.hand.length > 1 ? 95 : 0

  switch (action.type) {
    case 'DECLARE_ATTACK': {
      let atkScore = 300 + (action.estimatedDamage || 0)
      if (activeBoard.activePokemon) {
        const attackAction =
          activeBoard.activePokemon.card.playableActions.find((a) => a.actionId === action.actionId) ||
          activeBoard.activePokemon.attachedTools
            .flatMap((t) => t.playableActions)
            .find((a) => a.actionId === action.actionId)
        if (attackAction) {
          const dmgInfo = computeAttackDamageToActive(activeBoard, passiveBoard, attackAction, state)
          const checkupBonus = passiveBoard.activePokemon
            ? getGuaranteedCheckupDamage(passiveBoard.activePokemon, attackAction.effects)
            : 0
          const mult = canPokemonAttackTwice(activeBoard.activePokemon, state) ? 2 : 1
          const projectedOppDmg = dmgInfo.expectedActiveDamage * mult + checkupBonus
          const oppRemHp = passiveBoard.activePokemon
            ? getRemainingHp(passiveBoard.activePokemon, state)
            : 9999
          const oppPrizes = passiveBoard.activePokemon?.card.pokemonStats?.prizeCardsGiven ?? 1
          const hasExtraPrize = attackAction.effects.some(
            (e) =>
              e.primitive === 'TAKE_EXTRA_PRIZE' || (e as any).primitive === 'TAKE_EXTRA_PRIZE_CARDS',
          )

          if (passiveBoard.activePokemon && projectedOppDmg >= oppRemHp && projectedOppDmg > 0) {
            const prizeGain = oppPrizes + (hasExtraPrize ? 1 : 0)
            if (activeBoard.prizes.length <= prizeGain || passiveBoard.bench.length === 0) {
              atkScore += 900
            } else {
              atkScore += prizeGain * 95
            }
          }

          if (dmgInfo.selfRecoilDamage > 0) {
            const myRemHp = getRemainingHp(activeBoard.activePokemon, state)
            const oppKOs = passiveBoard.activePokemon != null && projectedOppDmg >= oppRemHp
            const oppPrizesAfterKo = oppKOs ? activeBoard.prizes.length - oppPrizes : activeBoard.prizes.length
            // Si le recul met K.O. notre propre Actif sans clore immédiatement la victoire, pénaliser fortement
            if (dmgInfo.selfRecoilDamage >= myRemHp && !(oppKOs && oppPrizesAfterKo <= 0)) {
              atkScore -=
                passiveBoard.prizes.length <= (activeBoard.activePokemon.card.pokemonStats?.prizeCardsGiven ?? 1)
                  ? 500
                  : 180
            } else {
              atkScore -= dmgInfo.expectedSelfRecoil * 0.35
            }
          }
          if (hasExtraPrize) {
            atkScore += 180
          }
          if (isTurn1GoingSecond && isZeroEnergyItemLockAttack(attackAction)) {
            atkScore += 140
          }
        }
      }
      return atkScore
    }

    case 'NORMAL_EVOLVE':
      return 244 + handReducesBonus

    case 'PLAY_TRAINER': {
      const trainerCard = activeBoard.hand.find((c) => c.cardId === action.cardId)
      if (
        trainerCard?.playableActions.some((a) =>
          a.preconditions.some((p) => {
            const pt = (typeof p === 'string' ? p : (p as any)?.type || '').toUpperCase()
            return pt === 'HAND_MAX_OTHER_CARDS_ZERO' || pt === 'HAND_IS_EMPTY'
          }),
        )
      ) {
        return 380
      }

      // Évaluation prioritaire du Gust (Ordres du Boss / Attrape-Riposte / Attrape-Suprême)
      // Simule la cible du Banc en Actif adverse pour évaluer Faiblesse, Résistance, Checkup et immunités (Mimiriqui)
      if (action.targetBenchIndex !== undefined && passiveBoard.bench[action.targetBenchIndex]) {
        const oppTarget = passiveBoard.bench[action.targetBenchIndex]!
        const targetHp = getRemainingHp(oppTarget, state)
        const targetPrizes = oppTarget.card.pokemonStats?.prizeCardsGiven ?? 1

        let currentActiveMaxDmg = 0
        let maxTargetDmg = 0
        if (activeBoard.activePokemon) {
          const simDefBoard: PlayerBoardState = { ...passiveBoard, activePokemon: oppTarget }
          const simState: MatchState =
            passiveBoard === state.opponent
              ? { ...state, opponent: simDefBoard }
              : { ...state, player: simDefBoard }
          currentActiveMaxDmg = getMaxImmediateAttackDamage(
            activeBoard,
            passiveBoard,
            state,
            activeBoard.activePokemon,
          )
          maxTargetDmg = getMaxImmediateAttackDamage(
            activeBoard,
            simDefBoard,
            simState,
            activeBoard.activePokemon,
          )
        }

        const canKoTarget = maxTargetDmg >= targetHp && maxTargetDmg > 0
        const breaksImmunityWall = currentActiveMaxDmg === 0 && maxTargetDmg >= 20
        if (canKoTarget) {
          const lethalWinBonus = activeBoard.prizes.length <= targetPrizes ? 250 : 0
          return (
            275 +
            lethalWinBonus +
            targetPrizes * 70 +
            computePokemonThreatScore(oppTarget, state.turnNumber, false) * 0.5
          )
        }
        if (breaksImmunityWall) {
          return 235 + targetPrizes * 35
        }
        // Si on ne peut ni mettre K.O. ni contourner un mur immunisé, éviter de gaspiller le Gust
        return 40
      }

      // Priorité au Stade si un Pokémon "Fête Battante" (canAttackTwice) est en jeu
      if (trainerCard?.subCategory === 'STADIUM' && !state.activeStadium) {
        const fakeStadState: MatchState = {
          ...state,
          activeStadium: { card: trainerCard, ownerIndex: state.activePlayerIndex, usedThisTurn: false },
        }
        const allMyPokes = [
          ...(activeBoard.activePokemon ? [activeBoard.activePokemon] : []),
          ...activeBoard.bench,
        ]
        if (allMyPokes.some((p) => canPokemonAttackTwice(p, fakeStadState))) {
          return 315
        }
      }

      const pAction =
        trainerCard?.playableActions.find((a) => a.actionId === action.actionId) ||
        trainerCard?.playableActions[0]

      // Échange de soi (Échange / Switch) pour purger Paralysie, Sommeil, Confusion, Verrou ou Recul fatal
      const isSelfSwitchTrainer = pAction?.effects.some((e) => {
        if (e.primitive !== 'SWITCH_ACTIVE' && (e as any).primitive !== 'SWITCH_ACTIVE_POKEMON') return false
        const t = (e.target || '').toUpperCase()
        return t === 'SELF' || t === 'OWN_BENCH_SINGLE' || t === 'OWN_BENCH' || t === 'OWN_ACTIVE'
      })
      if (isSelfSwitchTrainer && activeBoard.activePokemon) {
        const activeP = activeBoard.activePokemon
        if (
          isTurn1GoingSecond &&
          action.targetBenchIndex !== undefined &&
          activeBoard.bench[action.targetBenchIndex]?.card.playableActions.some(isZeroEnergyItemLockAttack)
        ) {
          return 295
        }
        const conds = activeP.specialConditions || []
        const crippled =
          conds.includes('PARALYZED') ||
          conds.includes('ASLEEP') ||
          conds.includes('CONFUSED') ||
          Boolean(activeP.cantAttackNextTurn) ||
          (activeP.damageDealtModifierNextTurn || 0) < 0 ||
          getRemainingHp(activeP, state) <= getGuaranteedCheckupDamage(activeP)
        if (crippled && activeBoard.bench.length > 0) {
          return 268
        }
      }

      const hasDiscardCost = trainerCard?.playableActions.some(
        (a) =>
          (Array.isArray(a.costs) && a.costs.some((c) => c.type === 'DISCARD_FROM_HAND')) ||
          a.effects.some((e) => e.primitive === 'DISCARD_CARDS'),
      )

      if (action.cardId === 'sv04-125') return 260 + handReducesBonus // Super Bonbon
      if (action.cardId === 'sv05-144') return (state.turnNumber <= 2 ? 258 : 246) + handReducesBonus // Poffin Copain-Copain
      if (action.cardId === 'sv01-181') return (state.turnNumber <= 2 ? 254 : 242) + handReducesBonus // Faiblo Ball

      // Séquencement pro intra-tour : Épuration / Recherche (252) -> Préparation dessus de deck (236) -> Pioche/Mélange (228) -> Énergie manuelle (205) -> Outils/Divers (185)
      if (pAction && trainerCard?.subCategory !== 'TOOL') {
        const hasSearchOrRecover = pAction.effects.some(
          (e) => e.primitive === 'SEARCH_DECK' || e.primitive === 'RECOVER_FROM_DISCARD',
        )
        const hasShuffleOrDraw = pAction.effects.some(
          (e) =>
            e.primitive === 'SHUFFLE_HAND_DRAW' ||
            e.primitive === 'DRAW_CARDS' ||
            (e as any).primitive === 'DISCARD_HAND_AND_DRAW' ||
            (e as any).primitive === 'DRAW_UNTIL_HAND_SIZE',
        )
        const hasTopDeckStack = pAction.effects.some(
          (e) => e.primitive === 'PUT_ON_TOP_OR_BOTTOM_OF_DECK' && e.destinationZone === 'TOP_OF_DECK',
        )
        if (hasSearchOrRecover && !hasShuffleOrDraw) {
          return 252 + handReducesBonus
        }
        if (hasTopDeckStack) {
          return 236 + handReducesBonus
        }
        if (hasShuffleOrDraw) {
          return 228 + handReducesBonus
        }
      }

      return 185 + (hasDiscardCost ? handReducesBonus : 0)
    }

    case 'USE_ABILITY': {
      const sourcePoke =
        action.sourceSlot === 'ACTIVE'
          ? activeBoard.activePokemon
          : typeof action.sourceSlot === 'number'
            ? activeBoard.bench[action.sourceSlot] ?? null
            : null
      const pAction = sourcePoke?.card.playableActions.find((a) => a.actionId === action.actionId)

      // Gestion stratégique du coût KNOCK_OUT_SELF (historique cost[] OU v2 effects[] KNOCK_OUT(SELF))
      const hasSelfKoCost =
        (Array.isArray(pAction?.costs) && pAction.costs.some((c) => c.type === 'KNOCK_OUT_SELF')) ||
        Boolean(pAction?.effects.some((e) => e.primitive === 'KNOCK_OUT' && e.target === 'SELF'))
      if (hasSelfKoCost) {
        // Condition 1 : L'adversaire doit avoir >= 2 cartes Récompense restantes (ne pas donner la dernière Récompense de victoire !)
        if (passiveBoard.prizes.length <= 1) {
          return -500
        }

        // Condition 2 : Le sacrifice doit permettre d'éliminer immédiatement un Pokémon adverse clé (Rule Box, attaquant principal) ou préparer un KO décisif
        const dmgEff = pAction?.effects.find(
          (e) =>
            e.primitive === 'DAMAGE_ACTIVE' ||
            e.primitive === 'DAMAGE_BENCH' ||
            e.primitive === 'PLACE_DAMAGE_COUNTERS' ||
            (e as any).primitive === 'DEAL_DAMAGE_ACTIVE' ||
            (e as any).primitive === 'DEAL_DAMAGE_BENCH',
        )
        const dmgToDeal = dmgEff?.value ?? dmgEff?.baseDamage ?? (dmgEff?.count ? dmgEff.count * 10 : 0)

        const allOppPokes = [passiveBoard.activePokemon, ...passiveBoard.bench].filter(
          (p): p is InPlayPokemon => p !== null,
        )
        const canKoKey = allOppPokes.some((p) => {
          const rem = getRemainingHp(p, state)
          const isKey =
            Boolean(p.card.pokemonStats?.isRuleBox) ||
            p.card.strategicEvaluator.primaryRole === 'MAIN_ATTACKER' ||
            p.card.strategicEvaluator.aiRole === 'MAIN_ATTACKER' ||
            p.card.subCategory === 'STAGE_2'
          return isKey && rem <= dmgToDeal
        })

        // Combo KO avec le Pokémon actif ce tour
        let maxActiveDmg = 0
        if (activeBoard.activePokemon) {
          maxActiveDmg = getMaxImmediateAttackDamage(
            activeBoard,
            passiveBoard,
            state,
            activeBoard.activePokemon,
          )
        }
        const canComboKoActive =
          passiveBoard.activePokemon &&
          getRemainingHp(passiveBoard.activePokemon, state) <= dmgToDeal + maxActiveDmg &&
          (Boolean(passiveBoard.activePokemon.card.pokemonStats?.isRuleBox) ||
            passiveBoard.activePokemon.card.subCategory === 'STAGE_2')

        if (canKoKey || canComboKoActive) {
          return 320
        } else {
          return -200
        }
      }

      // Valorisation des placements de marqueurs non-suicidaires (PLACE_DAMAGE_COUNTERS / MOVE_DAMAGE_COUNTERS)
      const counterEff = pAction?.effects.find(
        (e) => e.primitive === 'PLACE_DAMAGE_COUNTERS' || e.primitive === 'MOVE_DAMAGE_COUNTERS',
      )
      if (counterEff) {
        const val = counterEff.value ?? counterEff.baseDamage ?? (counterEff.count ? counterEff.count * 10 : 0)
        const allOpp = [passiveBoard.activePokemon, ...passiveBoard.bench].filter(
          (p): p is InPlayPokemon => p !== null,
        )
        const koTargets = allOpp.filter((op) => getRemainingHp(op, state) <= val).length
        if (koTargets > 0) return 295 + Math.min(80, koTargets * 40)
      }

      if (action.endsTurnImmediately) return 140
      const isDrawOrSearchAbility = pAction?.effects.some(
        (e) =>
          e.primitive === 'DRAW_CARDS' ||
          e.primitive === 'SEARCH_DECK' ||
          (e as any).primitive === 'DRAW_UNTIL_HAND_SIZE',
      )
      return isDrawOrSearchAbility ? 234 : 222
    }

    case 'ATTACH_MANUAL_ENERGY':
      return (action.targetSlot === 'ACTIVE' ? 205 : 192) + handReducesBonus

    case 'PUT_BASIC_ON_BENCH': {
      const card = activeBoard.hand.find((c) => c.cardId === action.cardId)
      if (card) {
        const meta = getCardFastMeta(card)
        const role = (card.strategicEvaluator.aiRole || card.strategicEvaluator.primaryRole) as string
        const hp = card.pokemonStats?.hp ?? 70
        // Évite d'exposer gratuitement un Pokémon à 2 Récompenses fragile hors Tour 1 ou dont le talent T1 est expiré
        if (
          card.pokemonStats?.isRuleBox &&
          hp <= 180 &&
          state.turnNumber > 2 &&
          role !== 'MAIN_ATTACKER' &&
          meta.normCombinedName.includes('squawkabilly')
        ) {
          return 45
        }
      }
      return (state.turnNumber <= 2 ? 220 : 165) + handReducesBonus
    }

    case 'RETREAT_ACTIVE': {
      const activePoke = activeBoard.activePokemon
      const benchPoke =
        action.targetBenchIndex !== undefined ? activeBoard.bench[action.targetBenchIndex] : null
      if (!activePoke || !benchPoke) return 30
      if (
        isTurn1GoingSecond &&
        benchPoke.card.playableActions.some(isZeroEnergyItemLockAttack) &&
        !activePoke.card.playableActions.some(isZeroEnergyItemLockAttack)
      ) {
        return 285
      }
      const activeReq = getMainAttackEnergyRequirement(activePoke.card)
      const benchReq = getMainAttackEnergyRequirement(benchPoke.card)
      const activeBlocked = isPokemonAttackBlocked(activePoke, state)
      const benchBlocked = isPokemonAttackBlocked(benchPoke, state)
      const activeReady = !activeBlocked && activePoke.attachedEnergies.length >= activeReq
      const benchReady = !benchBlocked && benchPoke.attachedEnergies.length >= benchReq

      const hasCripplingCondition =
        (activePoke.specialConditions || []).includes('CONFUSED') ||
        (activePoke.damageDealtModifierNextTurn || 0) < 0
      const checkupFatal =
        getRemainingHp(activePoke, state) <= getGuaranteedCheckupDamage(activePoke)
      const retreatCost = getPokemonRetreatCost(activePoke, activeBoard, state)

      // Déblocage : si l'Actif a cantAttackNextTurn, est Confus ou va mourir au Checkup, autoriser et prioriser la Retraite !
      if (activeBlocked || hasCripplingCondition || checkupFatal) {
        if (benchReady || retreatCost === 0 || checkupFatal) {
          return 235
        }
      }
      if (!activeReady && benchReady) return 215
      // Pivoter un Pokémon à >=2 Récompenses gravement blessé si le coût de retraite est faible et le Banc prêt
      if (
        (activePoke.card.pokemonStats?.prizeCardsGiven ?? 1) >= 2 &&
        getRemainingHp(activePoke, state) <= 60 &&
        benchReady &&
        retreatCost <= 1
      ) {
        return 205
      }
      return 35
    }

    case 'PASS_TURN':
      return 50
  }
}

/**
 * Explore l'arbre des séquences d'actions légales à l'intérieur d'un même tour,
 * depuis le début du tour jusqu'aux actions de clôture (`DECLARE_ATTACK`, `PASS_TURN`, ou talent terminant le tour).
 *
 * - Dédoublonne les états intermédiaires et finaux via `getStateHash(S)`.
 * - Respecte le plafond `maxBranches` (`8`, `20`, `50` ou `'INFINITE'`).
 */
export function exploreTurnBranches(
  turnStartState: MatchState,
  maxBranches: MaxBranchesSetting,
  maxActionDepth = 8,
  customBeamWidth?: number,
): { completedBranches: PartialTurnNode[]; totalExplored: number } {
  const perspectiveIndex = turnStartState.activePlayerIndex

  // Fast-path : si le seul coup légal au départ clôt le tour (ex: PASS_TURN forcé), exécute-le immédiatement
  if (turnStartState.winner === null && turnStartState.activePlayerIndex === perspectiveIndex) {
    const initialActions = getLegalActions(turnStartState)
    if (initialActions.length === 1 && initialActions[0]!.endsTurnImmediately) {
      const onlyAction = initialActions[0]!
      const nextState = applyAction(turnStartState, onlyAction, false)
      return {
        completedBranches: [
          {
            state: nextState,
            actions: [onlyAction],
            heuristicScore: evaluateState(nextState, perspectiveIndex),
          },
        ],
        totalExplored: 1,
      }
    }
  }

  // Permet jusqu'à 60 branches explorées (mode 'INFINITE' ou réglages avancés) tout en conservant le Beam par défaut rapide si customBeamWidth n'est pas fourni
  const numericLimit = maxBranches === 'INFINITE' ? 60 : Math.min(Math.max(1, Number(maxBranches)), 60)
  const perStepBeamWidth = customBeamWidth ?? Math.min(numericLimit, 8)
  const maxActionsPerNode = Math.max(perStepBeamWidth + 3, 7)

  const visitedIntermediateHashes = new Set<number>()
  const completedByHash = new Map<number, PartialTurnNode>()

  let frontier: PartialTurnNode[] = [
    {
      state: turnStartState,
      actions: [],
      heuristicScore: evaluateState(turnStartState, perspectiveIndex),
    },
  ]
  visitedIntermediateHashes.add(computeNumericStateHash(turnStartState))

  let totalExplored = 0

  for (let depth = 0; depth < maxActionDepth && frontier.length > 0; depth++) {
    const nextFrontier: PartialTurnNode[] = []
    const isLastDepth = depth === maxActionDepth - 1

    for (let fIdx = 0; fIdx < frontier.length; fIdx++) {
      const node = frontier[fIdx]!
      if (node.state.winner !== null || node.state.activePlayerIndex !== perspectiveIndex) {
        const finHash = computeNumericStateHash(node.state)
        const existing = completedByHash.get(finHash)
        if (!existing || node.actions.length < existing.actions.length) {
          completedByHash.set(finHash, node)
        }
        continue
      }

      const legalActions = getLegalActions(node.state)

      // Pré-calcul O(N) des scores heuristiques et élagage immédiat des retraites / Gusts inutiles
      const scoredActions: Array<{ action: GameAction; score: number }> = []
      for (let aIdx = 0; aIdx < legalActions.length; aIdx++) {
        const action = legalActions[aIdx]!
        if (isLastDepth && !action.endsTurnImmediately) continue

        const score = scoreAtomicActionHeuristic(node.state, action)
        if (action.type === 'RETREAT_ACTIVE' && score < 100) continue
        if (
          action.type === 'PLAY_TRAINER' &&
          action.targetBenchIndex !== undefined &&
          score < 100
        ) {
          continue
        }
        scoredActions.push({ action, score })
      }

      scoredActions.sort((a, b) => b.score - a.score)
      const expandCount = Math.min(scoredActions.length, maxActionsPerNode)

      for (let sIdx = 0; sIdx < expandCount; sIdx++) {
        const { action } = scoredActions[sIdx]!
        const nextState = applyAction(node.state, action, false)
        totalExplored++
        const stateHash = computeNumericStateHash(nextState)

        if (
          action.endsTurnImmediately ||
          nextState.winner !== null ||
          nextState.activePlayerIndex !== perspectiveIndex
        ) {
          const nextScore = evaluateState(nextState, perspectiveIndex)
          const existing = completedByHash.get(stateHash)
          if (!existing || nextScore > existing.heuristicScore) {
            completedByHash.set(stateHash, {
              state: nextState,
              actions: [...node.actions, action],
              heuristicScore: nextScore,
            })
          }
        } else {
          if (!visitedIntermediateHashes.has(stateHash)) {
            visitedIntermediateHashes.add(stateHash)
            const nextScore = evaluateState(nextState, perspectiveIndex)
            nextFrontier.push({
              state: nextState,
              actions: [...node.actions, action],
              heuristicScore: nextScore,
            })
          }
        }
      }
    }

    // Trie la frontière intermédiaire par score heuristique et applique le Beam Width
    nextFrontier.sort((a, b) => b.heuristicScore - a.heuristicScore)
    frontier =
      nextFrontier.length > perStepBeamWidth
        ? nextFrontier.slice(0, perStepBeamWidth)
        : nextFrontier
  }

  let completedBranches = Array.from(completedByHash.values())
  if (completedBranches.length === 0) {
    // Fallback de sécurité : passer le tour
    const passAction: GameAction = {
      type: 'PASS_TURN',
      endsTurnImmediately: true,
      label: 'Terminer le tour sans attaquer',
    }
    const passedState = applyAction(turnStartState, passAction)
    completedBranches = [
      {
        state: passedState,
        actions: [passAction],
        heuristicScore: evaluateState(passedState, perspectiveIndex),
      },
    ]
  }

  completedBranches.sort((a, b) => b.heuristicScore - a.heuristicScore)

  if (maxBranches !== 'INFINITE' && completedBranches.length > maxBranches) {
    completedBranches = completedBranches.slice(0, maxBranches)
  } else if (maxBranches === 'INFINITE' && completedBranches.length > numericLimit) {
    completedBranches = completedBranches.slice(0, numericLimit)
  }

  return { completedBranches, totalExplored }
}

/**
 * Résume une séquence d'actions en une chaîne lisible pour l'Inspecteur Debug.
 */
function summarizeActionSequence(actions: GameAction[]): string {
  if (actions.length === 0) return 'Aucune action'
  const meaningful = actions.filter((a) => a.type !== 'PASS_TURN' || actions.length === 1)
  return meaningful
    .slice(0, 4)
    .map((a) => a.label)
    .join(' → ')
}

/**
 * Rollout Rapide Glouton (W = 1, Greedy Optimal) pour l'anticipation de T_adv et T+1.
 * Utilise un seul clone initial puis mute l'état en place (`mutateInPlace = true`)
 * pour éviter jusqu'à 16 clonages complets par candidat.
 */
function fastGreedySingleTurnRollout(
  postPreviousTurnState: MatchState,
  needActionsList = false,
  maxActions = 8,
): { bestEndState: MatchState; bestActions: GameAction[]; bestPerspectiveScore: number } {
  if (postPreviousTurnState.winner !== null) {
    const pIdx = postPreviousTurnState.activePlayerIndex
    return {
      bestEndState: postPreviousTurnState,
      bestActions: [],
      bestPerspectiveScore: evaluateState(postPreviousTurnState, pIdx),
    }
  }

  const state = fastCloneState(postPreviousTurnState, false)
  const actingPlayerIdx = state.activePlayerIndex
  startTurn(state)

  if (state.winner !== null) {
    return {
      bestEndState: state,
      bestActions: [],
      bestPerspectiveScore: evaluateState(state, actingPlayerIdx),
    }
  }

  const actionsTaken: GameAction[] = []
  const rolloutStepCap = Math.max(1, maxActions)

  for (let step = 0; step < rolloutStepCap; step++) {
    if (state.winner !== null || state.activePlayerIndex !== actingPlayerIdx) {
      break
    }

    const legalActions = getLegalActions(state)
    if (legalActions.length === 0) {
      break
    }

    // Sélection gloutonne immédiate du meilleur coup atomique (W = 1)
    let bestAction = legalActions[0]!
    let bestActionScore = -Infinity

    for (let i = 0; i < legalActions.length; i++) {
      const act = legalActions[i]!
      const actScore = scoreAtomicActionHeuristic(state, act)
      if (actScore > bestActionScore) {
        bestActionScore = actScore
        bestAction = act
      }
    }

    applyAction(state, bestAction, false, true)
    if (needActionsList) {
      actionsTaken.push(bestAction)
    }

    if (bestAction.endsTurnImmediately) {
      break
    }
  }

  // Si la boucle greedy a consommé maxActions en Phase Principale sans encore déclarer d'attaque,
  // exécuter la meilleure attaque légale disponible, sinon clore explicitement le tour.
  if (state.winner === null && state.activePlayerIndex === actingPlayerIdx) {
    const postLoopActions = getLegalActions(state)
    const attackActions = postLoopActions.filter((a) => a.type === 'DECLARE_ATTACK')
    let attacked = false
    if (attackActions.length > 0) {
      let bestAttack = attackActions[0]!
      let bestAttackScore = scoreAtomicActionHeuristic(state, bestAttack)
      for (let i = 1; i < attackActions.length; i++) {
        const atk = attackActions[i]!
        const s = scoreAtomicActionHeuristic(state, atk)
        if (s > bestAttackScore) {
          bestAttackScore = s
          bestAttack = atk
        }
      }
      const passAct = postLoopActions.find((a) => a.type === 'PASS_TURN')
      const passScore = passAct ? scoreAtomicActionHeuristic(state, passAct) : 0
      if (bestAttackScore > passScore) {
        applyAction(state, bestAttack, false, true)
        if (needActionsList) {
          actionsTaken.push(bestAttack)
        }
        attacked = true
      }
    }
    if (!attacked && state.winner === null && state.activePlayerIndex === actingPlayerIdx) {
      const passAct = postLoopActions.find((a) => a.type === 'PASS_TURN')
      if (passAct) {
        applyAction(state, passAct, false, true)
        if (needActionsList) {
          actionsTaken.push(passAct)
        }
      } else {
        endTurnAndAdvance(state)
      }
    }
  }

  return {
    bestEndState: state,
    bestActions: actionsTaken,
    bestPerspectiveScore: evaluateState(state, actingPlayerIdx),
  }
}

/**
 * Sélectionne la meilleure branche de tour complet via l'anticipation asymétrique 3-ply :
 * - Tour T : Beam Search élagué (maxBranches ≤ 12, profondeur ≤ 8)
 * - Top-3 : Sélection des K = 3 meilleures feuilles de fin de tour T
 * - Rollout Rapide (W = 1, Greedy Optimal) pour T_adv et T+1 avec Table de Transposition
 *
 * Formule officielle de pondération :
 * Score(B) = 0.35 * V(S_T) - 0.30 * V_adv(S_{T_adv}) + 0.35 * V(S_{T+1})
 */
export function selectBestTurnBranch(
  turnStartState: MatchState,
  maxBranches: MaxBranchesSetting,
  recordTrace = false,
  options?: EvaluatorOptions,
): TurnBranchDecision {
  const perspectiveIndex = turnStartState.activePlayerIndex
  const maxActionDepth = Math.max(1, options?.maxActionDepth ?? 8)
  const topKCandidates = Math.max(1, options?.topKCandidates ?? 3)
  const lookaheadPly: LookaheadPly = options?.lookaheadPly ?? 3
  const rolloutMaxActions = Math.max(1, options?.rolloutMaxActions ?? 8)
  const aiTemperament: AiTemperament = options?.aiTemperament ?? 'BALANCED'
  const weights = resolvePlyWeights(aiTemperament)

  const { completedBranches, totalExplored } = exploreTurnBranches(
    turnStartState,
    maxBranches,
    maxActionDepth,
    options?.beamWidth,
  )

  const candidatesToEvaluate = completedBranches.slice(0, topKCandidates)

  // Fast-path Monte Carlo : si une seule branche unique existe et qu'on n'enregistre pas de trace UI,
  // inutile de projeter T_adv et T+1 puisque l'unique branche sera nécessairement choisie !
  if (!recordTrace && candidatesToEvaluate.length === 1) {
    const only = candidatesToEvaluate[0]!
    const roundedScoreT = Math.round(only.heuristicScore * 10) / 10
    return {
      chosenActions: only.actions,
      chosenActionLabels: [],
      finalTurnState: only.state,
      scoreT: roundedScoreT,
      scoreTAdv: 0,
      scoreTPlus1: roundedScoreT,
      totalScore: roundedScoreT,
      totalBranchesExplored: Math.max(totalExplored, completedBranches.length),
      candidateTraces: [],
    }
  }

  let bestIdx = 0
  let bestTotalScore = -Infinity

  const evaluatedResults: Array<{
    node: PartialTurnNode
    scoreT: number
    scoreTAdv: number
    scoreTPlus1: number
    totalScore: number
    opponentReactionSummary: string
    reboundSummary: string
  }> = []

  // Table de transposition locale pour éviter de recalculer T_adv -> T+1 sur deux états équivalents
  const rolloutTranspositionTable = new Map<
    number,
    {
      scoreTAdv: number
      scoreTPlus1: number
      opponentReactionSummary: string
      reboundSummary: string
    }
  >()

  const myWinnerLabel = perspectiveIndex === 0 ? 'PLAYER' : 'OPPONENT'

  for (let i = 0; i < candidatesToEvaluate.length; i++) {
    const candidate = candidatesToEvaluate[i]!
    const stateT = candidate.state

    // Étape 1 : Réutilise le score heuristique déjà calculé à la fin du tour courant T
    const scoreT = candidate.heuristicScore

    // Si la branche donne la victoire immédiate à T, son score est maximal !
    if (stateT.winner === myWinnerLabel) {
      const totalScore = WIN_SCORE
      evaluatedResults.push({
        node: candidate,
        scoreT: WIN_SCORE,
        scoreTAdv: -WIN_SCORE,
        scoreTPlus1: WIN_SCORE,
        totalScore,
        opponentReactionSummary: recordTrace
          ? 'Partie remportée immédiatement (Victoire au Tour T)'
          : '',
        reboundSummary: recordTrace ? 'Victoire acquise' : '',
      })
      if (totalScore > bestTotalScore) {
        bestTotalScore = totalScore
        bestIdx = i
      }
      if (!recordTrace) {
        break
      }
      continue
    }

    let scoreTAdv = 0
    let scoreTPlus1 = 0
    let opponentReactionSummary = ''
    let reboundSummary = ''

    if (lookaheadPly >= 2) {
      const stateTHash = computeNumericStateHash(stateT)
      const cachedRollout = rolloutTranspositionTable.get(stateTHash)

      if (cachedRollout) {
        scoreTAdv = cachedRollout.scoreTAdv
        scoreTPlus1 = cachedRollout.scoreTPlus1
        opponentReactionSummary = cachedRollout.opponentReactionSummary
        reboundSummary = cachedRollout.reboundSummary
      } else {
        // Étape 2 : Projection rapide du tour adverse T_adv (Rollout glouton W = 1 en place)
        const advRollout = fastGreedySingleTurnRollout(stateT, recordTrace, rolloutMaxActions)
        const stateTAdv = advRollout.bestEndState
        scoreTAdv = advRollout.bestPerspectiveScore
        opponentReactionSummary = recordTrace ? summarizeActionSequence(advRollout.bestActions) : ''

        // Étape 3 : Projection rapide du rebond Joueur T+1 si lookaheadPly === 3
        if (lookaheadPly === 3) {
          if (stateTAdv.winner !== null) {
            scoreTPlus1 = evaluateState(stateTAdv, perspectiveIndex)
            reboundSummary = recordTrace
              ? stateTAdv.winner === myWinnerLabel
                ? 'Victoire sur épuisement adverse'
                : 'Défaite subie lors de la riposte adverse (T_adv)'
              : ''
          } else {
            const reboundRollout = fastGreedySingleTurnRollout(
              stateTAdv,
              recordTrace,
              rolloutMaxActions,
            )
            scoreTPlus1 = reboundRollout.bestPerspectiveScore
            reboundSummary = recordTrace ? summarizeActionSequence(reboundRollout.bestActions) : ''
          }
        }

        rolloutTranspositionTable.set(stateTHash, {
          scoreTAdv,
          scoreTPlus1,
          opponentReactionSummary,
          reboundSummary,
        })
      }
    }

    let rawTotalScore: number
    if (lookaheadPly === 1) {
      rawTotalScore = scoreT
    } else if (lookaheadPly === 2) {
      const denom = weights.wT + weights.wAdv
      rawTotalScore = (weights.wT * scoreT - weights.wAdv * scoreTAdv) / (denom > 0 ? denom : 1)
    } else {
      rawTotalScore = weights.wT * scoreT - weights.wAdv * scoreTAdv + weights.wRebound * scoreTPlus1
    }
    const totalScore = Math.round(rawTotalScore * 10) / 10

    evaluatedResults.push({
      node: candidate,
      scoreT: Math.round(scoreT * 10) / 10,
      scoreTAdv: Math.round(scoreTAdv * 10) / 10,
      scoreTPlus1: Math.round(scoreTPlus1 * 10) / 10,
      totalScore,
      opponentReactionSummary,
      reboundSummary,
    })

    if (totalScore > bestTotalScore) {
      bestTotalScore = totalScore
      bestIdx = i
    }
  }

  const chosen = evaluatedResults[bestIdx]!
  const candidateTraces: EvaluatedBranchTrace[] = recordTrace
    ? evaluatedResults
        .map((res, idx) => ({
          branchId: `B${idx + 1}`,
          isChosen: idx === bestIdx,
          actions: res.node.actions.map((a) => a.label),
          scoreT: res.scoreT,
          scoreTAdv: res.scoreTAdv,
          scoreTPlus1: res.scoreTPlus1,
          totalScore: res.totalScore,
          opponentReactionSummary: res.opponentReactionSummary,
          reboundSummary: res.reboundSummary,
        }))
        .sort((a, b) => b.totalScore - a.totalScore)
    : []

  return {
    chosenActions: chosen.node.actions,
    chosenActionLabels: recordTrace ? chosen.node.actions.map((a) => a.label) : [],
    finalTurnState: chosen.node.state,
    scoreT: chosen.scoreT,
    scoreTAdv: chosen.scoreTAdv,
    scoreTPlus1: chosen.scoreTPlus1,
    totalScore: chosen.totalScore,
    totalBranchesExplored: Math.max(totalExplored, completedBranches.length),
    candidateTraces,
  }
}

export const evaluateBestTurnBranch = selectBestTurnBranch
