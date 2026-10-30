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
  computeAttackDamageToActive,
  fastCloneState,
  getActiveBoard,
  getMainAttackEnergyRequirement,
  getPassiveBoard,
  getRemainingHp,
  getLegalActions,
  isCardDeadInHand,
  startTurn,
  type GameAction,
  type InPlayPokemon,
  type MatchState,
  type PlayerBoardState,
} from './engine'

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
  const baseScore = card.strategicEvaluator.intrinsicBaseScore
  const phaseMult = getTurnPhaseWeight(card, turnNumber)
  const role = card.strategicEvaluator.primaryRole

  let score = baseScore * phaseMult * 0.55

  // Bonus de stade d'évolution
  if (card.subCategory === 'STAGE_2') score += 65
  else if (card.subCategory === 'STAGE_1') score += 30

  // Bonus de rôle stratégique sur le plateau
  if (role === 'MAIN_ATTACKER') score += 45
  else if (role === 'TUTOR_ENGINE_POKEMON') score += 55
  else if (role === 'DRAW_ENGINE_POKEMON') score += 35
  else if (role === 'ENERGY_ACCELERATOR') score += 40

  // Valeur des énergies attachées jusqu'au coût d'attaque principal
  const reqEnergy = getMainAttackEnergyRequirement(card)
  const attachedCount = poke.attachedEnergies.length
  const effectiveEnergies = Math.min(attachedCount, reqEnergy + 1)
  score += effectiveEnergies * 22
  if (attachedCount >= reqEnergy && (role === 'MAIN_ATTACKER' || card.subCategory === 'STAGE_2')) {
    score += 35
  }

  // Outils attachés
  score += poke.attachedTools.length * 16

  // Pénalité de dégâts subis (et vulnérabilité de Pokémon à 2 Récompenses blessé)
  const remHp = getRemainingHp(poke)
  const maxHp = Math.max(40, poke.card.pokemonStats?.hp ?? 70)
  const hpRatio = remHp / maxHp
  score *= 0.55 + 0.45 * hpRatio

  if (isActiveSlot && role === 'MAIN_ATTACKER' && attachedCount >= reqEnergy) {
    score += 25
  }

  return score
}

/**
 * Fonction d'évaluation dynamique d'un état $V(S)$ du point de vue du joueur `perspectiveIndex` (`0` = PLAYER, `1` = OPPONENT).
 * S'appuie intégralement sur les propriétés `strategicEvaluator` de chaque `EngineCardModel`.
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
  if (myBoard.activePokemon) {
    totalScore += computePokemonThreatScore(myBoard.activePokemon, state.turnNumber, true)
  } else {
    totalScore -= 300
  }

  for (const bPoke of myBoard.bench) {
    totalScore += computePokemonThreatScore(bPoke, state.turnNumber, false)
  }

  // Bonus de stabilité du Banc (avoir au moins 2-3 Pokémon sur le Banc protège contre le KO unique et prépare les lignées)
  if (myBoard.bench.length === 0) {
    totalScore -= 85
  } else if (myBoard.bench.length === 1) {
    totalScore -= 25
  } else {
    totalScore += Math.min(4, myBoard.bench.length) * 14
  }

  // Soustraction de la valeur du plateau adverse
  if (oppBoard.activePokemon) {
    totalScore -= computePokemonThreatScore(oppBoard.activePokemon, state.turnNumber, true) * 0.92
    // Bonus de pression offensive si l'Actif adverse est déjà affaibli
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

  // 4. Évaluation dynamique de la Main (`intrinsicBaseScore`, `turnPhaseWeights`, `inGameDeadCardConditions`, `holdForNextTurnBonus`)
  const seenHandCardIds = new Set<string>()
  for (const card of myBoard.hand) {
    if (isCardDeadInHand(card, myBoard, oppBoard)) {
      // Une carte morte en main vaut 0 point stratégique
      continue
    }
    const base = card.strategicEvaluator.intrinsicBaseScore
    const phaseWeight = getTurnPhaseWeight(card, state.turnNumber)
    const holdBonus = card.strategicEvaluator.holdForNextTurnBonus
    const isDuplicateInHand = seenHandCardIds.has(card.cardId)
    seenHandCardIds.add(card.cardId)

    const duplicateFactor = isDuplicateInHand ? 0.45 : 1.0
    totalScore += (base * phaseWeight * 0.14 + holdBonus * 0.18) * duplicateFactor
  }

  // 5. Synergie avec le Cimetière (Énergies de base en défausse pour Gardevoir-ex / Pelage-Sablé / Méga Canne)
  let basicEnergiesInDiscard = 0
  for (const dCard of myBoard.discard) {
    if (dCard.category === 'ENERGY' && dCard.subCategory === 'BASIC_ENERGY') {
      basicEnergiesInDiscard++
    }
  }
  const hasDiscardEnergyAccelerator =
    myBoard.activePokemon?.card.cardId === 'sv01-086' ||
    myBoard.bench.some((b) => b.card.cardId === 'sv01-086' || b.card.cardId === 'sv04-123')
  if (hasDiscardEnergyAccelerator) {
    totalScore += Math.min(6, basicEnergiesInDiscard) * 14
  }

  // Pénalité si le deck approche dangereusement du Deck-Out
  if (myBoard.deck.length <= 3) {
    totalScore -= (4 - myBoard.deck.length) * 35
  }

  return Math.round(totalScore * 10) / 10
}

/**
 * Calcule l'empreinte canonique (`getStateHash(state)`) d'un `MatchState` à un instant T.
 * Permet de dédoublonner les séquences d'actions commutatives (ex: poser Salamèche puis Roucool vs Roucool puis Salamèche).
 */
export function getStateHash(state: MatchState): string {
  const hashBoard = (b: PlayerBoardState): string => {
    const activeStr = b.activePokemon
      ? `${b.activePokemon.card.cardId}:${b.activePokemon.damage}:${b.activePokemon.attachedEnergies.length}:${b.activePokemon.evolvedThisTurn ? 1 : 0}:${b.activePokemon.attachedTools.length}`
      : 'NONE'

    const benchStr = b.bench
      .map(
        (p) =>
          `${p.card.cardId}:${p.damage}:${p.attachedEnergies.length}:${p.evolvedThisTurn ? 1 : 0}:${p.attachedTools.length}`,
      )
      .sort()
      .join(',')

    const handStr = b.hand
      .map((c) => c.cardId)
      .sort()
      .join(',')

    const abilitiesStr = Array.from(b.usedOncePerTurnAbilities).sort().join(',')

    return [
      activeStr,
      `B[${benchStr}]`,
      `H[${handStr}]`,
      `P:${b.prizes.length}`,
      `D:${b.deck.length}`,
      `G:${b.discard.length}`,
      `Flags:${b.supporterPlayedThisTurn ? 1 : 0}${b.energyAttachedThisTurn ? 1 : 0}${b.retreatUsedThisTurn ? 1 : 0}${b.vstarPowerUsed ? 1 : 0}`,
      `Ab[${abilitiesStr}]`,
    ].join('|')
  }

  return `T${state.turnNumber}_P${state.activePlayerIndex}_W${state.winner || 'N'}__${hashBoard(state.player)}__${hashBoard(state.opponent)}`
}

/**
 * Trie et filtre les actions atomiques légales à l'intérieur d'un tour pour prioriser les coups à haute valeur
 * (ex: Évolutions, Tuteurs de Banc au T1, Talents de pioche, Gust sur une cible qu'on peut mettre KO).
 */
function scoreAtomicActionHeuristic(state: MatchState, action: GameAction): number {
  const activeBoard = getActiveBoard(state)
  const passiveBoard = getPassiveBoard(state)

  switch (action.type) {
    case 'DECLARE_ATTACK':
      return 300 + (action.estimatedDamage || 0)

    case 'NORMAL_EVOLVE':
      return 240

    case 'PLAY_TRAINER': {
      if (action.cardId === 'sv04-125') return 260 // Super Bonbon
      if (action.cardId === 'sv05-144') return state.turnNumber <= 2 ? 250 : 160 // Poffin Copain-Copain
      if (action.cardId === 'sv01-181') return state.turnNumber <= 2 ? 235 : 155 // Faiblo Ball

      // Évaluation fine du Gust (Ordres du Boss / Attrape-Riposte / Attrape-Suprême)
      if (action.targetBenchIndex !== undefined && passiveBoard.bench[action.targetBenchIndex]) {
        const oppTarget = passiveBoard.bench[action.targetBenchIndex]!
        const targetHp = getRemainingHp(oppTarget)
        const targetPrizes = oppTarget.card.pokemonStats?.prizeCardsGiven ?? 1
        // Vérifie si notre Pokémon Actif peut mettre KO cette cible
        let maxOurDmg = 0
        if (activeBoard.activePokemon) {
          for (const pAct of activeBoard.activePokemon.card.playableActions) {
            if (pAct.sourceType === 'ATTACK') {
              const dmg = computeAttackDamageToActive(activeBoard, passiveBoard, pAct).activeDamage
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

      return 185
    }

    case 'USE_ABILITY':
      if (action.endsTurnImmediately) return 140
      return 225

    case 'ATTACH_MANUAL_ENERGY':
      return action.targetSlot === 'ACTIVE' ? 210 : 195

    case 'PUT_BASIC_ON_BENCH':
      return state.turnNumber <= 2 ? 220 : 165

    case 'RETREAT_ACTIVE': {
      // Battre en retraite n'est pertinent que si l'Actif ne peut pas attaquer et que le Pokémon promu le peut (ou a un meilleur rôle)
      const activePoke = activeBoard.activePokemon
      const benchPoke =
        action.targetBenchIndex !== undefined ? activeBoard.bench[action.targetBenchIndex] : null
      if (!activePoke || !benchPoke) return 30
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
  const numericLimit = maxBranches === 'INFINITE' ? 12 : Math.min(Number(maxBranches), 12)
  const perStepBeamWidth = customBeamWidth ?? Math.min(numericLimit, 8)

  const visitedIntermediateHashes = new Set<string>()
  const completedByHash = new Map<string, PartialTurnNode>()

  let frontier: PartialTurnNode[] = [
    {
      state: turnStartState,
      actions: [],
      heuristicScore: evaluateState(turnStartState, perspectiveIndex),
    },
  ]
  visitedIntermediateHashes.add(getStateHash(turnStartState))

  let totalExplored = 0

  for (let depth = 0; depth < maxActionDepth && frontier.length > 0; depth++) {
    const nextFrontier: PartialTurnNode[] = []

    for (const node of frontier) {
      if (node.state.winner !== null || node.state.activePlayerIndex !== perspectiveIndex) {
        const finHash = getStateHash(node.state)
        const existing = completedByHash.get(finHash)
        if (!existing || node.actions.length < existing.actions.length) {
          completedByHash.set(finHash, node)
        }
        continue
      }

      const legalActions = getLegalActions(node.state)
      legalActions.sort(
        (a, b) => scoreAtomicActionHeuristic(node.state, b) - scoreAtomicActionHeuristic(node.state, a),
      )

      // Si on est à la dernière profondeur autorisée, ne garde que les actions de clôture de tour
      const isLastDepth = depth === maxActionDepth - 1
      const filteredActions = isLastDepth
        ? legalActions.filter((a) => a.endsTurnImmediately)
        : legalActions

      for (const action of filteredActions) {
        // Évite de battre en retraite si aucune raison tactique et qu'on a déjà fait plusieurs actions
        if (
          action.type === 'RETREAT_ACTIVE' &&
          scoreAtomicActionHeuristic(node.state, action) < 100
        ) {
          continue
        }
        // Évite de gaspiller un Gust (Ordres du Boss / Attrape-Riposte) qui ne permet pas de KO
        if (
          action.type === 'PLAY_TRAINER' &&
          action.targetBenchIndex !== undefined &&
          scoreAtomicActionHeuristic(node.state, action) < 100
        ) {
          continue
        }

        const nextState = applyAction(node.state, action, false)
        totalExplored++
        const nextActions = [...node.actions, action]
        const nextScore = evaluateState(nextState, perspectiveIndex)
        const stateHash = getStateHash(nextState)

        if (
          action.endsTurnImmediately ||
          nextState.winner !== null ||
          nextState.activePlayerIndex !== perspectiveIndex
        ) {
          const existing = completedByHash.get(stateHash)
          if (!existing || nextScore > existing.heuristicScore) {
            completedByHash.set(stateHash, {
              state: nextState,
              actions: nextActions,
              heuristicScore: nextScore,
            })
          }
        } else {
          if (!visitedIntermediateHashes.has(stateHash)) {
            visitedIntermediateHashes.add(stateHash)
            nextFrontier.push({
              state: nextState,
              actions: nextActions,
              heuristicScore: nextScore,
            })
          }
        }
      }
    }

    // Trie la frontière intermédiaire par score heuristique et applique le Beam Width
    nextFrontier.sort((a, b) => b.heuristicScore - a.heuristicScore)
    frontier = nextFrontier.slice(0, perStepBeamWidth)
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

  // Si on a au moins une branche qui attaque avec des dégâts positifs, privilégie les branches offensives tout en gardant la meilleure branche de passe pour comparaison
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
 * Ne fait aucun embranchement combinatoire : choisit séquentiellement le meilleur coup heuristique
 * immédiat jusqu'à clôture du tour (attaque ou fin de tour).
 */
function fastGreedySingleTurnRollout(
  postPreviousTurnState: MatchState,
): { bestEndState: MatchState; bestActions: GameAction[]; bestPerspectiveScore: number } {
  if (postPreviousTurnState.winner !== null) {
    const pIdx = postPreviousTurnState.activePlayerIndex
    return {
      bestEndState: postPreviousTurnState,
      bestActions: [],
      bestPerspectiveScore: evaluateState(postPreviousTurnState, pIdx),
    }
  }

  let state = fastCloneState(postPreviousTurnState, false)
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

    for (const act of legalActions) {
      const actScore = scoreAtomicActionHeuristic(state, act)
      if (actScore > bestActionScore) {
        bestActionScore = actScore
        bestAction = act
      }
    }

    state = applyAction(state, bestAction, false)
    actionsTaken.push(bestAction)

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
 * - Rollout Rapide (W = 1, Greedy Optimal) pour T_adv et T+1
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
  const opponentIndex: 0 | 1 = perspectiveIndex === 0 ? 1 : 0

  const { completedBranches, totalExplored } = exploreTurnBranches(turnStartState, maxBranches, 8)

  // Sélection stricte des Top-3 (K = 3) meilleures feuilles du tour T
  const candidatesToEvaluate = completedBranches.slice(0, 3)

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

  for (let i = 0; i < candidatesToEvaluate.length; i++) {
    const candidate = candidatesToEvaluate[i]!
    const stateT = candidate.state

    // Étape 1 : Score à la fin du tour courant T
    const scoreT = evaluateState(stateT, perspectiveIndex)

    // Si la branche donne la victoire immédiate à T, son score est maximal !
    const myWinnerLabel = perspectiveIndex === 0 ? 'PLAYER' : 'OPPONENT'
    if (stateT.winner === myWinnerLabel) {
      const totalScore = WIN_SCORE
      evaluatedResults.push({
        node: candidate,
        scoreT: WIN_SCORE,
        scoreTAdv: -WIN_SCORE,
        scoreTPlus1: WIN_SCORE,
        totalScore,
        opponentReactionSummary: 'Partie remportée immédiatement (Victoire au Tour T)',
        reboundSummary: 'Victoire acquise',
      })
      if (totalScore > bestTotalScore) {
        bestTotalScore = totalScore
        bestIdx = i
      }
      continue
    }

    // Étape 2 : Projection rapide du tour adverse T_adv (Rollout glouton W = 1)
    const advRollout = fastGreedySingleTurnRollout(stateT)
    const stateTAdv = advRollout.bestEndState
    const scoreTAdv = evaluateState(stateTAdv, opponentIndex)
    const opponentReactionSummary = summarizeActionSequence(advRollout.bestActions)

    // Étape 3 : Projection rapide du rebond Joueur T+1 (Rollout glouton W = 1)
    let scoreTPlus1: number
    let reboundSummary: string
    if (stateTAdv.winner !== null) {
      scoreTPlus1 = evaluateState(stateTAdv, perspectiveIndex)
      reboundSummary =
        stateTAdv.winner === myWinnerLabel
          ? 'Victoire sur épuisement adverse'
          : 'Défaite subie lors de la riposte adverse (T_adv)'
    } else {
      const reboundRollout = fastGreedySingleTurnRollout(stateTAdv)
      scoreTPlus1 = evaluateState(reboundRollout.bestEndState, perspectiveIndex)
      reboundSummary = summarizeActionSequence(reboundRollout.bestActions)
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
    chosenActionLabels: chosen.node.actions.map((a) => a.label),
    finalTurnState: chosen.node.state,
    scoreT: chosen.scoreT,
    scoreTAdv: chosen.scoreTAdv,
    scoreTPlus1: chosen.scoreTPlus1,
    totalScore: chosen.totalScore,
    totalBranchesExplored: Math.max(totalExplored, completedBranches.length),
    candidateTraces,
  }
}
