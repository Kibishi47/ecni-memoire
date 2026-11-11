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

import type { EngineCardModel } from '../types/cardModel'
import {
  applyAction,
  canPokemonAttackTwice,
  computeAttackDamageToActive,
  fastCloneState,
  getActiveBoard,
  getMainAttackEnergyRequirement,
  getPassiveBoard,
  getPokemonMaxHp,
  getRemainingHp,
  getLegalActions,
  hasEffectiveItemLock,
  isCardDeadInHand,
  isZeroEnergyItemLockAttack,
  startTurn,
  type GameAction,
  type InPlayPokemon,
  type MatchState,
} from './engine'
import { computeNumericStateHash } from './fastState'

export type MaxBranchesSetting = 8 | 20 | 50 | 'INFINITE'

export interface EvaluatedBranchTrace {
  branchId: string
  isChosen: boolean
  actions: string[]
  scoreT: number
  scoreTAdv: number
  scoreTPlus1: number
  totalScore: number
  opponentReactionSummary: string
  reboundSummary: string
}

export interface TurnBranchDecision {
  chosenActions: GameAction[]
  chosenActionLabels: string[]
  finalTurnState: MatchState
  scoreT: number
  scoreTAdv: number
  scoreTPlus1: number
  totalScore: number
  totalBranchesExplored: number
  candidateTraces: EvaluatedBranchTrace[]
}

interface PartialTurnNode {
  state: MatchState
  actions: GameAction[]
  heuristicScore: number
}

const WIN_SCORE = 10000

const intrinsicValueCache = new WeakMap<EngineCardModel, number>()

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

  if (card.identity.isAceSpec) score += 18

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

/**
 * Fonction d'évaluation dynamique d'un état $V(S)$ du point de vue du joueur `perspectiveIndex` (`0` = PLAYER, `1` = OPPONENT).
 * S'appuie intégralement sur les propriétés `strategicEvaluator` de chaque `EngineCardModel` et les états v2.
 */
export function evaluateState(state: MatchState, perspectiveIndex: 0 | 1): number {
  const myBoard = perspectiveIndex === 0 ? state.player : state.opponent
  const oppBoard = perspectiveIndex === 0 ? state.opponent : state.player
  const myWinnerLabel = perspectiveIndex === 0 ? 'PLAYER' : 'OPPONENT'
  const oppWinnerLabel = perspectiveIndex === 0 ? 'OPPONENT' : 'PLAYER'

  // 1. Conditions terminales de victoire / défaite
  if (state.winner === myWinnerLabel) {
    return WIN_SCORE
  }
  if (state.winner === oppWinnerLabel) {
    return -WIN_SCORE
  }

  let totalScore = 0

  // 2. Différentiel de cartes Récompenses (coeur de la course aux 6 Récompenses)
  const myPrizesTaken = 6 - myBoard.prizes.length
  const oppPrizesTaken = 6 - oppBoard.prizes.length
  totalScore += (myPrizesTaken - oppPrizesTaken) * 145

  // Bonus supplémentaire quand il ne reste plus qu'1 ou 2 Récompenses à prendre
  if (myBoard.prizes.length <= 2) {
    totalScore += (3 - myBoard.prizes.length) * 45
  }
  if (oppBoard.prizes.length <= 2) {
    totalScore -= (3 - oppBoard.prizes.length) * 45
  }

  // 3. Évaluation du Plateau du Joueur vs Plateau de l'Adversaire
  const myAllPoke = [myBoard.activePokemon, ...myBoard.bench].filter(
    (p): p is InPlayPokemon => p !== null,
  )

  if (myBoard.activePokemon) {
    totalScore += computePokemonThreatScore(myBoard.activePokemon, state.turnNumber, true)
  } else {
    totalScore -= 300
  }

  for (const bPoke of myBoard.bench) {
    totalScore += computePokemonThreatScore(bPoke, state.turnNumber, false)
  }

  // Bonus de stabilité du Banc (et bonus EXPAND_BENCH si > 5 slots utilisés)
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

  // Pondération des rôles et effets en jeu :
  const hasBenchPressure = myAllPoke.some(
    (p) =>
      p.card.strategicEvaluator.aiRole === 'SECONDARY_ATTACKER' ||
      (p.card.strategicEvaluator.primaryRole as string) === 'SNIPER_BENCH_ATTACKER' ||
      p.card.playableActions.some((a) =>
        a.effects.some(
          (e) => e.primitive === 'DAMAGE_BENCH' || e.primitive === 'PLACE_DAMAGE_COUNTERS',
        ),
      ),
  )
  if (hasBenchPressure) {
    const fragileOppTargets = oppBoard.bench.filter((p) => {
      const rem = getRemainingHp(p, state)
      return rem <= 90 || (Boolean(p.card.pokemonStats?.isRuleBox) && p.damage >= 50)
    })
    totalScore += fragileOppTargets.length * 25
  }

  // Contrôle & Verrous adverses / propres (`LOCK_ITEMS`, `LOCK_ABILITIES`, `LOCK_RETREAT`, `LOCK_NEXT_TURN_ATTACK`)
  const oppItemsLocked = hasEffectiveItemLock(state, oppBoard)
  const myItemsLocked = hasEffectiveItemLock(state, myBoard)
  if (oppItemsLocked) totalScore += state.turnNumber <= 2 ? 120 : 55
  if (myItemsLocked) totalScore -= state.turnNumber <= 2 ? 95 : 45
  if (oppBoard.abilityLockActive) totalScore += 65
  if (myBoard.abilityLockActive) totalScore -= 65

  if (oppBoard.activePokemon?.cantRetreatNextTurn) totalScore += 25
  if (myBoard.activePokemon?.cantRetreatNextTurn) totalScore -= 25
  if (oppBoard.activePokemon?.cantAttackNextTurn) totalScore += 40
  if (myBoard.activePokemon?.cantAttackNextTurn) totalScore -= 40
  if (myBoard.activePokemon?.preventDamageOrEffectsNextTurn) totalScore += 90
  if (oppBoard.activePokemon?.preventDamageOrEffectsNextTurn) totalScore -= 90
  if (myBoard.activePokemon?.damageTakenModifierNextTurn && myBoard.activePokemon.damageTakenModifierNextTurn < 0) {
    totalScore += Math.min(80, Math.abs(myBoard.activePokemon.damageTakenModifierNextTurn) * 1.1)
  }
  if (oppBoard.activePokemon?.damageTakenModifierNextTurn && oppBoard.activePokemon.damageTakenModifierNextTurn < 0) {
    totalScore -= Math.min(80, Math.abs(oppBoard.activePokemon.damageTakenModifierNextTurn) * 1.1)
  }

  // États Spéciaux sur les Actifs (`PARALYZED`, `ASLEEP`, `CONFUSED`, `POISONED`, `BURNED`)
  const scoreConditions = (conds?: readonly string[]): number => {
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
  totalScore += scoreConditions(oppBoard.activePokemon?.specialConditions)
  totalScore -= scoreConditions(myBoard.activePokemon?.specialConditions)

  const hasControlLock = myAllPoke.some((p) => {
    const r = (p.card.strategicEvaluator.aiRole || p.card.strategicEvaluator.primaryRole) as string
    return r === 'DISRUPTION' || r === 'CONTROL_LOCK_DISRUPTION'
  })
  if (hasControlLock) totalScore += 35

  // Réduction / Tank / Buff / Heal basés sur les primitives & PV réels
  for (const p of myAllPoke) {
    const hasDefOrBuff = p.card.playableActions.some((a) =>
      a.effects.some(
        (e) =>
          e.primitive === 'MODIFY_DAMAGE_TAKEN' ||
          e.primitive === 'MODIFY_HP' ||
          e.primitive === 'PREVENT_DAMAGE_OR_EFFECTS',
      ),
    )
    const r = (p.card.strategicEvaluator.aiRole || p.card.strategicEvaluator.primaryRole) as string
    if (hasDefOrBuff || r === 'GUEST_TECH' || r === 'DEFENSIVE_TANK_WALL' || r === 'PASSIVE_STAT_BUFFER') {
      const maxHp = Math.max(40, getPokemonMaxHp(p, state))
      const remHp = Math.max(0, maxHp - p.damage)
      if (remHp >= maxHp * 0.7) {
        totalScore += 28 + Math.round((remHp / maxHp) * 18)
      }
    }
    if (
      r === 'HEALER_SUPPORT' ||
      p.card.playableActions.some((a) => a.effects.some((e) => e.primitive === 'HEAL'))
    ) {
      const damagedKeyPoke = myAllPoke.filter(
        (kp) =>
          (kp.card.subCategory === 'STAGE_2' || Boolean(kp.card.pokemonStats?.isRuleBox)) &&
          kp.damage > 0,
      )
      totalScore += Math.min(45, damagedKeyPoke.length * 15)
    }
  }

  // Bonus TAKE_EXTRA_PRIZE sur l'attaque de l'Actif
  if (
    myBoard.activePokemon?.card.playableActions.some(
      (a) =>
        a.actionType === 'ATTACK' &&
        a.effects.some(
          (e) => e.primitive === 'TAKE_EXTRA_PRIZE' || (e as any).primitive === 'TAKE_EXTRA_PRIZE_CARDS',
        ),
    )
  ) {
    totalScore += 60
  }

  // Bonus Double Attaque ("Fête Battante" / Festival Lead sous Stade) & Bonus de dégâts du tour
  const isDoubleAttacker = canPokemonAttackTwice(myBoard.activePokemon, state)
  if (isDoubleAttacker) {
    totalScore += 75
  }
  if (myBoard.turnDamageBoost && myBoard.turnDamageBoost > 0) {
    totalScore += myBoard.turnDamageBoost * (isDoubleAttacker ? 2.2 : 1.2)
  }

  // Soustraction de la valeur du plateau adverse
  if (oppBoard.activePokemon) {
    totalScore -= computePokemonThreatScore(oppBoard.activePokemon, state.turnNumber, true) * 0.92
    if (oppBoard.activePokemon.damage > 0) {
      totalScore += Math.min(90, oppBoard.activePokemon.damage * 0.25)
    }
  }
  for (const oppBench of oppBoard.bench) {
    totalScore -= computePokemonThreatScore(oppBench, state.turnNumber, false) * 0.92
    if (oppBench.damage > 0) {
      totalScore += Math.min(60, oppBench.damage * 0.2)
    }
  }

  // 4. Évaluation dynamique de la Main (`computeCardIntrinsicValue`, `turnPhaseWeights`, `inGameDeadCardConditions`, `holdForNextTurnBonus`)
  const seenHandCardIds = new Set<string>()
  for (const card of myBoard.hand) {
    if (isCardDeadInHand(card, myBoard, oppBoard, state.activeStadium)) {
      continue
    }
    const base = computeCardIntrinsicValue(card)
    const phaseWeight = getTurnPhaseWeight(card, state.turnNumber)
    const holdBonus = card.strategicEvaluator.holdForNextTurnBonus ?? 15
    const isDuplicateInHand = seenHandCardIds.has(card.cardId)
    seenHandCardIds.add(card.cardId)

    const duplicateFactor = isDuplicateInHand ? 0.45 : 1.0
    totalScore += (base * phaseWeight * 0.14 + holdBonus * 0.18) * duplicateFactor
  }

  // 5. Synergie avec le Cimetière et `decklistSynergyRequirements`
  let basicEnergiesInDiscard = 0
  for (const dCard of myBoard.discard) {
    if (dCard.category === 'ENERGY' && dCard.subCategory === 'BASIC_ENERGY') {
      basicEnergiesInDiscard++
    }
  }
  const hasDiscardEnergyAccelerator = myAllPoke.some(
    (p) =>
      p.card.cardId === 'sv01-086' ||
      p.card.cardId === 'sv04-123' ||
      p.card.playableActions.some((a) =>
        a.effects.some(
          (e) =>
            e.primitive === 'ATTACH_ENERGY' &&
            (e.sourceZone === 'DISCARD' || e.zone === 'DISCARD'),
        ),
      ),
  )
  if (hasDiscardEnergyAccelerator) {
    totalScore += Math.min(6, basicEnergiesInDiscard) * 14
  }

  // Synergies déclarées (`decklistSynergyRequirements` : tera, stage2, hp<=70, discard, type d'énergie, lignée)
  for (const p of myAllPoke) {
    const reqs = p.card.strategicEvaluator.decklistSynergyRequirements
    if (!reqs || reqs.length === 0) continue
    for (const req of reqs) {
      if (req === 'requires_tera_pokemon') {
        if (myAllPoke.some((m) => Boolean(m.card.identity.isTera || m.card.pokemonStats?.isTera))) {
          totalScore += 8
        }
      } else if (req === 'requires_stage_2_pokemon') {
        if (myAllPoke.some((m) => m.card.subCategory === 'STAGE_2') || myBoard.hand.some((c) => c.subCategory === 'STAGE_2')) {
          totalScore += 8
        }
      } else if (req === 'requires_basic_hp_lte_70') {
        if (myAllPoke.some((m) => m.card.subCategory === 'BASIC' && (m.card.pokemonStats?.hp ?? 999) <= 70)) {
          totalScore += 6
        }
      } else if (req === 'requires_discard_synergy') {
        if (myBoard.discard.length >= 2) totalScore += 6
      } else if (req === 'requires_ancient_pokemon') {
        if (myAllPoke.some((m) => Boolean(m.card.identity.isAncient || m.card.pokemonStats?.isAncient))) {
          totalScore += 6
        }
      } else if (req.startsWith('requires_energy_type:')) {
        const reqType = req.slice('requires_energy_type:'.length).toLowerCase()
        const hasType =
          p.attachedEnergies.some((e) => e.identity.nameFr.toLowerCase().includes(reqType)) ||
          myBoard.discard.some((e) => e.category === 'ENERGY' && e.identity.nameFr.toLowerCase().includes(reqType))
        if (hasType) totalScore += 6
      } else if (req.startsWith('requires_evolution_line:')) {
        const lineName = req.slice('requires_evolution_line:'.length).toLowerCase()
        if (myAllPoke.some((m) => m.card.identity.nameFr.toLowerCase().includes(lineName))) {
          totalScore += 6
        }
      }
    }
  }

  // Bonus potentiel de K.O. par marqueurs de dégâts (`PLACE_DAMAGE_COUNTERS` en jeu)
  const allOppEval = [oppBoard.activePokemon, ...oppBoard.bench].filter(
    (p): p is InPlayPokemon => p !== null,
  )
  for (const p of myAllPoke) {
    for (const pa of p.card.playableActions) {
      if (pa.actionType === 'ATTACK' || pa.actionType === 'USE_ABILITY') {
        const counterEff = pa.effects.find((e) => e.primitive === 'PLACE_DAMAGE_COUNTERS')
        if (counterEff) {
          const val = counterEff.value ?? counterEff.baseDamage ?? (counterEff.count ? counterEff.count * 10 : 0)
          if (val > 0) {
            const koCount = allOppEval.filter((op) => getRemainingHp(op, state) <= val).length
            totalScore += Math.min(40, koCount * 14)
          }
        }
      }
    }
  }

  // Pénalité si le deck approche dangereusement du Deck-Out
  if (myBoard.deck.length <= 3) {
    totalScore -= (4 - myBoard.deck.length) * 35
  }

  return Math.round(totalScore * 10) / 10
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
        const attackAction = activeBoard.activePokemon.card.playableActions.find(
          (a) => a.actionId === action.actionId,
        )
        if (attackAction) {
          const dmgInfo = computeAttackDamageToActive(activeBoard, passiveBoard, attackAction, state)
          if (dmgInfo.selfRecoilDamage > 0) {
            const myRemHp = getRemainingHp(activeBoard.activePokemon, state)
            const oppKOs =
              passiveBoard.activePokemon != null &&
              dmgInfo.expectedActiveDamage >= getRemainingHp(passiveBoard.activePokemon, state)
            const oppPrizesAfterKo = oppKOs
              ? passiveBoard.prizes.length - (passiveBoard.activePokemon?.card.pokemonStats?.prizeCardsGiven ?? 1)
              : passiveBoard.prizes.length
            // Si le recul met K.O. notre propre Actif sans clore immédiatement la victoire, pénaliser fortement
            if (dmgInfo.selfRecoilDamage >= myRemHp && !(oppKOs && oppPrizesAfterKo <= 0)) {
              atkScore -= passiveBoard.prizes.length <= (activeBoard.activePokemon.card.pokemonStats?.prizeCardsGiven ?? 1) ? 500 : 180
            } else {
              atkScore -= dmgInfo.expectedSelfRecoil * 0.35
            }
          }
          if (
            attackAction.effects.some(
              (e) =>
                e.primitive === 'TAKE_EXTRA_PRIZE' || (e as any).primitive === 'TAKE_EXTRA_PRIZE_CARDS',
            )
          ) {
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
      return 240 + handReducesBonus

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
      if (
        trainerCard?.subCategory !== 'TOOL' &&
        trainerCard?.playableActions.some((a) =>
          a.effects.some(
            (e) =>
              e.primitive === 'TAKE_EXTRA_PRIZE' || (e as any).primitive === 'TAKE_EXTRA_PRIZE_CARDS',
          ),
        )
      ) {
        return 340
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

      // Bonus pour vider la main si un Supporter "seule carte en main" attend d'être débloqué
      const hasDiscardCost = trainerCard?.playableActions.some(
        (a) =>
          (Array.isArray(a.costs) && a.costs.some((c) => c.type === 'DISCARD_FROM_HAND')) ||
          a.effects.some((e) => e.primitive === 'DISCARD_CARDS'),
      )

      // Bonus en J2 Tour 1 pour un échange (Switch) amenant un Pokémon Item-Lock à 0 énergie (ex: Rozbouton)
      if (
        isTurn1GoingSecond &&
        trainerCard?.playableActions.some((a) =>
          a.effects.some(
            (e) =>
              e.primitive === 'SWITCH_ACTIVE' || (e as any).primitive === 'SWITCH_ACTIVE_POKEMON',
          ),
        ) &&
        action.targetBenchIndex !== undefined &&
        activeBoard.bench[action.targetBenchIndex]
      ) {
        const targetBenchPoke = activeBoard.bench[action.targetBenchIndex]!
        if (targetBenchPoke.card.playableActions.some(isZeroEnergyItemLockAttack)) {
          return 295
        }
      }

      if (action.cardId === 'sv04-125') return 260 + handReducesBonus // Super Bonbon
      if (action.cardId === 'sv05-144') return (state.turnNumber <= 2 ? 250 : 160) + handReducesBonus // Poffin Copain-Copain
      if (action.cardId === 'sv01-181') return (state.turnNumber <= 2 ? 235 : 155) + handReducesBonus // Faiblo Ball

      // Évaluation fine du Gust (Ordres du Boss / Attrape-Riposte / Attrape-Suprême)
      if (action.targetBenchIndex !== undefined && passiveBoard.bench[action.targetBenchIndex]) {
        const oppTarget = passiveBoard.bench[action.targetBenchIndex]!
        const targetHp = getRemainingHp(oppTarget, state)
        const targetPrizes = oppTarget.card.pokemonStats?.prizeCardsGiven ?? 1
        // Vérifie si notre Pokémon Actif peut mettre KO cette cible
        let maxOurDmg = 0
        if (activeBoard.activePokemon) {
          for (const pAct of activeBoard.activePokemon.card.playableActions) {
            if (pAct.actionType === 'ATTACK' || pAct.sourceType === 'ATTACK') {
              const dmg = computeAttackDamageToActive(activeBoard, passiveBoard, pAct, state).activeDamage
              if (dmg > maxOurDmg) maxOurDmg = dmg
            }
          }
        }
        const canKoTarget = maxOurDmg >= targetHp && maxOurDmg > 0
        if (canKoTarget) {
          return 255 + targetPrizes * 70 + computePokemonThreatScore(oppTarget, state.turnNumber, false) * 0.5
        }
        // Si on ne peut pas mettre KO la cible, évite de gaspiller Ordres du Boss / Attrape-Riposte
        return 40
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
          for (const act of activeBoard.activePokemon.card.playableActions) {
            if (act.actionType === 'ATTACK' || act.sourceType === 'ATTACK') {
              const d = computeAttackDamageToActive(activeBoard, passiveBoard, act, state).activeDamage
              if (d > maxActiveDmg) maxActiveDmg = d
            }
          }
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

      if (
        pAction?.effects.some(
          (e) => e.primitive === 'TAKE_EXTRA_PRIZE' || (e as any).primitive === 'TAKE_EXTRA_PRIZE_CARDS',
        )
      ) {
        return 350
      }

      if (action.endsTurnImmediately) return 140
      return 225
    }

    case 'ATTACH_MANUAL_ENERGY':
      return (action.targetSlot === 'ACTIVE' ? 210 : 195) + handReducesBonus

    case 'PUT_BASIC_ON_BENCH':
      return (state.turnNumber <= 2 ? 220 : 165) + handReducesBonus

    case 'RETREAT_ACTIVE': {
      // Battre en retraite n'est pertinent que si l'Actif ne peut pas attaquer et que le Pokémon promu le peut (ou a un meilleur rôle)
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
      const activeReady = activePoke.attachedEnergies.length >= activeReq
      const benchReady = benchPoke.attachedEnergies.length >= benchReq
      if (!activeReady && benchReady) return 215
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

  const numericLimit = maxBranches === 'INFINITE' ? 12 : Math.min(Number(maxBranches), 12)
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
  const maxActions = 8

  for (let step = 0; step < maxActions; step++) {
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
): TurnBranchDecision {
  const perspectiveIndex = turnStartState.activePlayerIndex

  const { completedBranches, totalExplored } = exploreTurnBranches(turnStartState, maxBranches, 8)

  // Sélection stricte des Top-3 (K = 3) meilleures feuilles du tour T
  const candidatesToEvaluate = completedBranches.slice(0, 3)

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

    const stateTHash = computeNumericStateHash(stateT)
    const cachedRollout = rolloutTranspositionTable.get(stateTHash)

    let scoreTAdv: number
    let scoreTPlus1: number
    let opponentReactionSummary: string
    let reboundSummary: string

    if (cachedRollout) {
      scoreTAdv = cachedRollout.scoreTAdv
      scoreTPlus1 = cachedRollout.scoreTPlus1
      opponentReactionSummary = cachedRollout.opponentReactionSummary
      reboundSummary = cachedRollout.reboundSummary
    } else {
      // Étape 2 : Projection rapide du tour adverse T_adv (Rollout glouton W = 1 en place)
      const advRollout = fastGreedySingleTurnRollout(stateT, recordTrace)
      const stateTAdv = advRollout.bestEndState
      scoreTAdv = advRollout.bestPerspectiveScore
      opponentReactionSummary = recordTrace ? summarizeActionSequence(advRollout.bestActions) : ''

      // Étape 3 : Projection rapide du rebond Joueur T+1 (Rollout glouton W = 1 en place)
      if (stateTAdv.winner !== null) {
        scoreTPlus1 = evaluateState(stateTAdv, perspectiveIndex)
        reboundSummary = recordTrace
          ? stateTAdv.winner === myWinnerLabel
            ? 'Victoire sur épuisement adverse'
            : 'Défaite subie lors de la riposte adverse (T_adv)'
          : ''
      } else {
        const reboundRollout = fastGreedySingleTurnRollout(stateTAdv, recordTrace)
        scoreTPlus1 = reboundRollout.bestPerspectiveScore
        reboundSummary = recordTrace ? summarizeActionSequence(reboundRollout.bestActions) : ''
      }

      rolloutTranspositionTable.set(stateTHash, {
        scoreTAdv,
        scoreTPlus1,
        opponentReactionSummary,
        reboundSummary,
      })
    }

    // Formule officielle de pondération 3-Ply :
    // Score(B) = 0.35 * V(S_T) - 0.30 * V_adv(S_{T_adv}) + 0.35 * V(S_{T+1})
    const totalScore =
      Math.round((0.35 * scoreT - 0.3 * scoreTAdv + 0.35 * scoreTPlus1) * 10) / 10

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
