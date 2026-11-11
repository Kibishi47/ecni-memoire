/**
 * Boucle de Match Complet (`src/core/gameLoop.ts`) & Agrégateur de Shards Multi-Workers.
 *
 * Exécute des parties complètes de Pokémon TCG du Tour 1 jusqu'à la victoire
 * (`ALL_PRIZES_TAKEN`, `NO_POKEMON_IN_PLAY`, `DECK_OUT`) ou `maxTurns`.
 * Les deux joueurs (Joueur ET Adversaire) utilisent l'Évaluateur 3-Ply (`selectBestTurnBranch`) à chaque tour.
 */

import type { EngineCardModel, PlayableAction } from '../types/cardModel'
import type {
  BossFlexibilityStats,
  CardUsageMetrics,
  ConditionalComboStatRecord,
  MatchupStatRecord,
  PostDisruptionResilienceStats,
  SetupTurnHistogram,
  SimulationConfig,
  SimulationMetricsSummary,
  TracedBoardSnapshot,
  TracedGameRecord,
  TracedPokemonSnapshot,
  TracedTurnRecord,
  TurnOrderSplitStats,
} from '../types/simulator'
import { normalizeCardNameForMatch } from '../data/cardCatalog'
import {
  applyDebugPerturbationIfConfigured,
  createInitialMatchState,
  endTurnAndAdvance,
  getMainAttackEnergyRequirement,
  getPokemonMaxHp,
  getRemainingHp,
  handleKnockOut,
  isCardDeadInHand,
  isZeroEnergyItemLockAttack,
  startTurn,
  type GameAction,
  type InPlayPokemon,
  type MatchState,
  type PlayerBoardState,
  type WinReason,
} from './engine'
import { selectBestTurnBranch } from './evaluator'
import { deriveGameSeed } from './prng'

export const MAX_TRACED_GAMES = 20

export interface OpponentDeckDescriptor {
  id: string
  name: string
  nameEn?: string
  archetypeTag: string
  archetypeTagEn?: string
  accentColor: string
  models: EngineCardModel[]
}

export interface ShardCardCounter {
  cardId: string
  nameFr: string
  nameEn?: string
  category: string
  subCategory: string
  quantityInDeck: number
  gamesInDeck: number
  gamesDrawn: number
  gamesPlayed: number
  gamesDiscardedUnused: number
  turnsStuckDeadInHand: number
  gamesAllCopiesPrized: number
  winsWhenAllPrized: number
}

export interface ShardComboCounter {
  comboId: string
  label: string
  cardId: string
  cardNameFr: string
  conditionSummary: string
  sourceType: PlayableAction['sourceType']
  actionId: string
  gamesTriggered: number
  totalTriggersCount: number
  sumFirstTriggerTurn: number
  sumDamageWhenTriggered: number
}

export interface ShardTelemetryAccumulator {
  cardCounters: Record<string, ShardCardCounter>
  comboCounters: Record<string, ShardComboCounter>
}

export interface SingleGameOutcome {
  gameIndex: number
  opponentId: string
  opponentName: string
  firstPlayerIndex: 0 | 1
  winner: 'PLAYER' | 'OPPONENT' | 'DRAW'
  winReason: WinReason
  turnsPlayed: number
  playerPrizesWon: number
  opponentPrizesWon: number
  playerMulligans: number
  opponentMulligans: number
  hadPlayerTurn1BenchSetup: boolean
  hadPlayerTurn2AttackerReady: boolean
  setupTurnPlayerIndex: number | null
  activeKOsSuffered: number
  revengeAttacksSucceeded: number
  disruptionsSuffered: number
  postDisruptionAttacks: number
  attackTurnsCount: number
  supporterFreeAttackTurns: number
  hadBossPlusAttackCombo: boolean
  playerTurnsCount: number
  totalPlayerDamageDealt: number
  hadJ2Turn1AttackOrLock: boolean
  hadJ2Turn1ItemLock: boolean
  tracedGame?: TracedGameRecord
}

export interface SimulationShardInput {
  shardId: number
  startGameIndex: number
  gameCount: number
  baseSeed: number
  config: SimulationConfig
  playerDeckModels: EngineCardModel[]
  opponentDecks: OpponentDeckDescriptor[]
}

export interface SimulationShardResult {
  shardId: number
  outcomes: SingleGameOutcome[]
  tracedGames: TracedGameRecord[]
  telemetry?: ShardTelemetryAccumulator
}

function snapshotPokemon(poke: InPlayPokemon): TracedPokemonSnapshot {
  return {
    instanceId: poke.instanceId,
    cardId: poke.card.cardId,
    nameFr: poke.card.identity.nameFr,
    subCategory: poke.card.subCategory,
    currentHp: getRemainingHp(poke),
    maxHp: getPokemonMaxHp(poke),
    damage: poke.damage,
    attachedEnergies: poke.attachedEnergies.map((e) => e.identity.nameFr),
    attachedTools: poke.attachedTools.map((t) => t.identity.nameFr),
    isRuleBox: Boolean(poke.card.pokemonStats?.isRuleBox),
  }
}

export function snapshotBoardForTrace(board: PlayerBoardState): TracedBoardSnapshot {
  return {
    active: board.activePokemon ? snapshotPokemon(board.activePokemon) : null,
    bench: board.bench.map(snapshotPokemon),
    hand: board.hand.map((c) => c.identity.nameFr),
    prizesRemaining: board.prizes.length,
    prizesList: board.prizes.map((c) => c.identity.nameFr),
    prizesKnownByPlayer: board.prizesKnownByPlayer,
    deckCount: board.deck.length,
    discardCount: board.discard.length,
    discardTopNames: board.discard.slice(-6).map((c) => c.identity.nameFr),
  }
}

function describeComboCondition(card: EngineCardModel, action: PlayableAction): string {
  const normCardName = normalizeCardNameForMatch(card.identity.nameFr)
  const canDouble =
    Boolean(action.canAttackTwice) ||
    Boolean(card.pokemonStats?.canAttackTwice) ||
    normCardName.includes('pomdramour') ||
    normCardName.includes('poissoroy')

  if (canDouble && (action.actionType === 'ATTACK' || action.sourceType === 'ATTACK')) {
    return 'Double attaque sous Stade (Fête Battante)'
  }

  for (const rawPre of action.preconditions) {
    const preType = typeof rawPre === 'string' ? rawPre : (rawPre as any).type
    if (preType === 'HAND_MAX_OTHER_CARDS_ZERO' || preType === 'HAND_IS_EMPTY') {
      return 'Seule carte en main (0 autre carte)'
    }
    if (preType === 'KO_SUFFERED_LAST_TURN' || preType === 'OPPONENT_CAUSED_KO_LAST_TURN') {
      return 'Après K.O. subi au tour précédent'
    }
    if (preType === 'PLAYER_BEHIND_ON_PRIZES') {
      return 'Retard aux Récompenses'
    }
    if (preType.startsWith('OPPONENT_PRIZES_EXACT_COUNT') || preType.startsWith('OPPONENT_PRIZES_EQUAL:')) {
      const minCount = preType.includes(':')
        ? preType.split(':')[1] || '1'
        : typeof rawPre === 'object'
          ? (rawPre as any).minCount ?? 1
          : 1
      return `Adversaire à ${minCount} Récompense(s)`
    }
    if (preType === 'STADIUM_IN_PLAY') {
      return 'Stade en jeu requis'
    }
    if (preType === 'OPPONENT_ACTIVE_HAS_SPECIAL_CONDITION') {
      return 'Actif adverse sous État Spécial'
    }
    if (preType === 'HAS_TERA_POKEMON_IN_PLAY') {
      return 'Pokémon Téracristal en jeu requis'
    }
    if (preType === 'SECOND_PLAYER_TURN_1') {
      return 'Joueur 2 dès le Tour 1'
    }
  }

  for (const eff of action.effects) {
    if (eff.scalingMetric) {
      return `Dégâts dynamiques (${eff.scalingMetric})`
    }
    if (eff.coinFlipMode) {
      return `Lancer de pièce (${eff.coinFlipMode})`
    }
    if (eff.damageScalingType) {
      return `Dégâts dynamiques (${eff.damageScalingType})`
    }
    if (eff.damageScalingPerOpponentPrizeTaken) {
      return `Dégâts progressifs (+${eff.damageScalingPerOpponentPrizeTaken}/Récompense)`
    }
    if (
      eff.primitive === 'LOCK_ITEMS' ||
      eff.primitive === 'LOCK_ABILITIES' ||
      eff.primitive === 'APPLY_SPECIAL_CONDITION' ||
      (eff as any).primitive === 'PASSIVE_ABILITY_OR_ITEM_LOCK'
    ) {
      return "Verrouillage & Contrôle"
    }
    if (eff.primitive === 'PLACE_DAMAGE_COUNTERS') {
      return 'Placement de marqueurs de dégâts'
    }
    if (eff.primitive === 'KNOCK_OUT' && eff.target === 'SELF') {
      return 'Sacrifice stratégique (K.O.)'
    }
  }

  if (action.actionType === 'ATTACK' || action.sourceType === 'ATTACK') {
    const costLen =
      action.cost && typeof action.cost === 'object' && !Array.isArray(action.cost)
        ? Object.values(action.cost).reduce((a, b) => a + Number(b), 0)
        : action.energyCost?.length ?? 0
    return costLen === 0 ? 'Attaque à 0 Énergie' : `Attaque (${costLen} Énergie${costLen > 1 ? 's' : ''})`
  }

  return 'Condition tactique spécifique'
}

export function createShardTelemetryAccumulator(
  playerDeckModels: EngineCardModel[],
): ShardTelemetryAccumulator {
  const cardCounters: Record<string, ShardCardCounter> = {}
  const comboCounters: Record<string, ShardComboCounter> = {}

  for (const model of playerDeckModels) {
    const existing = cardCounters[model.cardId]
    if (existing) {
      existing.quantityInDeck += 1
    } else {
      cardCounters[model.cardId] = {
        cardId: model.cardId,
        nameFr: model.identity.nameFr,
        nameEn: model.identity.nameEn || model.identity.nameFr,
        category: model.category,
        subCategory: model.subCategory,
        quantityInDeck: 1,
        gamesInDeck: 0,
        gamesDrawn: 0,
        gamesPlayed: 0,
        gamesDiscardedUnused: 0,
        turnsStuckDeadInHand: 0,
        gamesAllCopiesPrized: 0,
        winsWhenAllPrized: 0,
      }
    }
  }

  for (const cardId of Object.keys(cardCounters)) {
    const sampleModel = playerDeckModels.find((m) => m.cardId === cardId)!
    for (const pAction of sampleModel.playableActions) {
      const hasNonTrivialPrecondition = pAction.preconditions.some((p) => {
        const pType = typeof p === 'string' ? p : (p as any).type
        return (
          pType !== 'SELF_HAS_ENERGY_COST' &&
          pType !== 'SELF_IS_ACTIVE' &&
          pType !== 'BENCH_HAS_EMPTY_SLOT' &&
          pType !== 'BENCH_HAS_EMPTY_SLOTS' &&
          pType !== 'SELF_IS_IN_HAND'
        )
      })
      const hasDynamicDmg = pAction.effects.some((e) =>
        Boolean(
          e.scalingMetric ||
            e.coinFlipMode ||
            e.damageScalingType ||
            e.damageScalingPerOpponentPrizeTaken,
        ),
      )
      const hasDoubleAtk =
        Boolean(pAction.canAttackTwice) || Boolean(sampleModel.pokemonStats?.canAttackTwice)
      const isAttack = pAction.actionType === 'ATTACK' || pAction.sourceType === 'ATTACK'

      if (hasNonTrivialPrecondition || hasDynamicDmg || hasDoubleAtk || isAttack) {
        const comboId = `${sampleModel.cardId}::${pAction.actionId}`
        if (!comboCounters[comboId]) {
          comboCounters[comboId] = {
            comboId,
            label: `${sampleModel.identity.nameFr} — ${pAction.label}`,
            cardId: sampleModel.cardId,
            cardNameFr: sampleModel.identity.nameFr,
            conditionSummary: describeComboCondition(sampleModel, pAction),
            sourceType: (pAction.actionType || pAction.sourceType) as any,
            actionId: pAction.actionId,
            gamesTriggered: 0,
            totalTriggersCount: 0,
            sumFirstTriggerTurn: 0,
            sumDamageWhenTriggered: 0,
          }
        }
      }
    }
  }

  return { cardCounters, comboCounters }
}

function isGustEffect(e: { primitive: string; target?: string | null; sourceZone?: string | null; targetZone?: string | null }): boolean {
  if ((e as any).primitive === 'GUST_OPPONENT_BENCH') return true
  if (e.primitive !== 'SWITCH_ACTIVE') return false
  const t = (e.target || '').toUpperCase()
  const tz = (e.targetZone || '').toUpperCase()
  const sz = (e.sourceZone || '').toUpperCase()
  return (
    t === 'OPPONENT_BENCH' ||
    t === 'OPPONENT_BENCH_SINGLE' ||
    t === 'OPPONENT_ACTIVE' ||
    t === 'OPPONENT' ||
    t === 'OPPONENT_POKEMON_ANY' ||
    tz === 'OPPONENT_BENCH' ||
    (sz === 'BENCH' && t !== 'OWN_BENCH' && t !== 'OWN_BENCH_SINGLE' && t !== 'OWN_ACTIVE' && t !== 'SELF')
  )
}

function isGustAction(action: GameAction, deckLookup: Map<string, EngineCardModel>): boolean {
  if (!action.cardId) return false
  const model = deckLookup.get(action.cardId)
  if (model) {
    const hasGustPrimitive = model.playableActions.some((pa) => pa.effects.some(isGustEffect))
    if (hasGustPrimitive) return true
    const norm = normalizeCardNameForMatch(model.identity.nameFr)
    if (
      norm.includes('ordres du boss') ||
      norm.includes('attrape-riposte') ||
      norm.includes('attrape-supreme')
    ) {
      return true
    }
  }
  const normLabel = normalizeCardNameForMatch(action.label)
  return (
    normLabel.includes('ordres du boss') ||
    normLabel.includes('attrape-riposte') ||
    normLabel.includes('attrape-supreme')
  )
}

function isDrawOrSearchSupporterAction(
  action: GameAction,
  deckLookup: Map<string, EngineCardModel>,
): boolean {
  if (action.type !== 'PLAY_TRAINER' || !action.cardId) return false
  const model = deckLookup.get(action.cardId)
  if (!model || model.subCategory !== 'SUPPORTER') return false

  // Si c'est un Supporter de Gust pur ou offensif (ex: Ordres du Boss), ce n'est pas un Supporter de pioche
  const isOffensiveOrGustSupporter = model.playableActions.some((pa) =>
    pa.effects.some(
      (e) =>
        isGustEffect(e) ||
        e.primitive === 'MODIFY_DAMAGE_DEALT' ||
        e.primitive === 'LOCK_ITEMS' ||
        e.primitive === 'TAKE_EXTRA_PRIZE' ||
        (e as any).primitive === 'PASSIVE_DAMAGE_BOOST' ||
        (e as any).primitive === 'TAKE_EXTRA_PRIZE_CARDS',
    ),
  )
  if (isOffensiveOrGustSupporter) return false
  return true
}

function didOpponentPlayHandDisruption(
  actions: GameAction[],
  stateAfter: MatchState,
  prevPlayerHandLen: number,
): boolean {
  for (const act of actions) {
    if (act.type !== 'PLAY_TRAINER' && act.type !== 'USE_ABILITY' && act.type !== 'DECLARE_ATTACK') {
      continue
    }
    const normLabel = normalizeCardNameForMatch(act.label)
    if (
      act.cardId === 'sv02-185' ||
      act.cardId === 'sv06-165' ||
      act.cardId === 'sv01-176' ||
      normLabel.includes('mashynn') ||
      normLabel.includes('iono') ||
      normLabel.includes('tampon injuste') ||
      normLabel.includes('unfair stamp') ||
      normLabel.includes('juge') ||
      normLabel.includes('judge') ||
      normLabel.includes('roxanne')
    ) {
      return stateAfter.player.hand.length <= 4 || stateAfter.player.hand.length < prevPlayerHandLen
    }
  }
  return false
}

function collectInPlayCardIds(
  board: PlayerBoardState,
  seenSet: Set<string>,
  playedSet: Set<string>,
): void {
  const allInPlay = [...(board.activePokemon ? [board.activePokemon] : []), ...board.bench]
  for (const poke of allInPlay) {
    seenSet.add(poke.card.cardId)
    playedSet.add(poke.card.cardId)
    for (const prev of poke.previousStages) {
      seenSet.add(prev.cardId)
      playedSet.add(prev.cardId)
    }
    for (const en of poke.attachedEnergies) {
      seenSet.add(en.cardId)
      playedSet.add(en.cardId)
    }
    for (const tool of poke.attachedTools) {
      seenSet.add(tool.cardId)
      playedSet.add(tool.cardId)
    }
  }
}

/**
 * Joue une partie complète de Pokémon TCG du Tour 1 jusqu'à la victoire ou `config.maxTurns`.
 */
export function playFullGame(
  playerDeckModels: EngineCardModel[],
  opponentDeck: OpponentDeckDescriptor,
  gameIndex: number,
  seed: number,
  config: SimulationConfig,
  recordTrace: boolean,
  telemetryAcc?: ShardTelemetryAccumulator,
): SingleGameOutcome {
  const firstPlayerIndex: 0 | 1 =
    config.firstPlayerMode === 'PLAYER'
      ? 0
      : config.firstPlayerMode === 'OPPONENT'
        ? 1
        : gameIndex % 2 === 0
          ? 0
          : 1

  let state = createInitialMatchState(playerDeckModels, opponentDeck.models, {
    seed,
    firstPlayerIndex,
    maxTurns: config.maxTurns,
    perturbationType: config.perturbationType,
    perturbationTurn: config.perturbationTurn,
  })

  const deckLookup = new Map<string, EngineCardModel>()
  for (const m of playerDeckModels) {
    if (!deckLookup.has(m.cardId)) {
      deckLookup.set(m.cardId, m)
    }
  }

  // Initialisation de la télémétrie par carte pour cette partie
  const seenCardIds = new Set<string>()
  const playedCardIds = new Set<string>()
  const allPrizedCardIds = new Set<string>()
  const deadTurnsByCardId = new Map<string, number>()
  const firstComboTriggerTurn = new Map<string, number>()

  if (telemetryAcc) {
    const prizeCounts = new Map<string, number>()
    for (const pCard of state.player.prizes) {
      prizeCounts.set(pCard.cardId, (prizeCounts.get(pCard.cardId) ?? 0) + 1)
    }
    for (const [cardId, counter] of Object.entries(telemetryAcc.cardCounters)) {
      counter.gamesInDeck += 1
      if ((prizeCounts.get(cardId) ?? 0) >= counter.quantityInDeck && counter.quantityInDeck > 0) {
        allPrizedCardIds.add(cardId)
        counter.gamesAllCopiesPrized += 1
      }
    }
  }

  for (const c of state.player.hand) {
    seenCardIds.add(c.cardId)
  }
  collectInPlayCardIds(state.player, seenCardIds, playedCardIds)

  const tracedTurns: TracedTurnRecord[] = []
  let hadPlayerTurn1BenchSetup = state.player.bench.length >= 2
  let hadPlayerTurn2AttackerReady = false
  let setupTurnPlayerIndex: number | null = null

  let pendingRevengeAfterKo = false
  let pendingPostDisruption = false
  let activeKOsSuffered = 0
  let revengeAttacksSucceeded = 0
  let disruptionsSuffered = 0
  let postDisruptionAttacks = 0
  let attackTurnsCount = 0
  let supporterFreeAttackTurns = 0
  let hadBossPlusAttackCombo = false
  let playerTurnsCount = 0
  let totalPlayerDamageDealt = 0
  let hadJ2Turn1AttackOrLock = false
  let hadJ2Turn1ItemLock = false

  let safetyLoopGuard = 0
  const maxLoopSteps = Math.max(4, config.maxTurns) + 4

  while (state.winner === null && safetyLoopGuard < maxLoopSteps) {
    safetyLoopGuard++
    const currentTurnNumber = state.turnNumber
    const actingPlayer: 'PLAYER' | 'OPPONENT' =
      state.activePlayerIndex === 0 ? 'PLAYER' : 'OPPONENT'

    const { drawnCard } = startTurn(state)
    const perturbationNote = applyDebugPerturbationIfConfigured(
      state,
      config.perturbationType,
      config.perturbationTurn,
    )

    if (
      perturbationNote !== null &&
      config.perturbationType === 'FORCE_OPPONENT_IONO' &&
      currentTurnNumber >= 2
    ) {
      pendingPostDisruption = true
    }

    if (actingPlayer === 'PLAYER') {
      if (drawnCard) {
        seenCardIds.add(drawnCard.cardId)
      }
      for (const c of state.player.hand) {
        seenCardIds.add(c.cardId)
      }
    }

    if (state.winner !== null) {
      break
    }

    const playerBoardBefore = recordTrace ? snapshotBoardForTrace(state.player) : null
    const opponentBoardBefore = recordTrace ? snapshotBoardForTrace(state.opponent) : null

    const prevPlayerActiveId = state.player.activePokemon?.instanceId ?? null
    const prevOpponentPrizes = state.opponent.prizes.length
    const prevPlayerHandLen = state.player.hand.length

    const decision = selectBestTurnBranch(state, config.maxBranches, recordTrace)
    state = decision.finalTurnState

    if (actingPlayer === 'PLAYER') {
      playerTurnsCount++
      const playerTurnOrdinal = Math.ceil(currentTurnNumber / 2)

      const playedThisTurnCardIds = new Set<string>()
      for (const act of decision.chosenActions) {
        if (act.cardId && act.type !== 'PASS_TURN') {
          seenCardIds.add(act.cardId)
          playedCardIds.add(act.cardId)
          playedThisTurnCardIds.add(act.cardId)
        }
        // Si Super Bonbon fait évoluer un Stage 2 depuis la main, le Stage 2 est également joué
        if (act.type === 'PLAY_TRAINER' && act.targetCardIds && act.cardId === 'sv04-125') {
          for (const tid of act.targetCardIds) {
            seenCardIds.add(tid)
            playedCardIds.add(tid)
            playedThisTurnCardIds.add(tid)
          }
        }
      }

      collectInPlayCardIds(state.player, seenCardIds, playedCardIds)
      for (const c of state.player.hand) {
        seenCardIds.add(c.cardId)
      }

      // Cartes restées bloquées ("mortes") en main en fin de tour du joueur
      if (telemetryAcc) {
        const uniqueEndHandIds = new Set<string>()
        for (const c of state.player.hand) {
          if (uniqueEndHandIds.has(c.cardId)) continue
          uniqueEndHandIds.add(c.cardId)
          if (playedThisTurnCardIds.has(c.cardId)) continue

          const isStuck =
            isCardDeadInHand(c, state.player, state.opponent) ||
            (c.category === 'POKEMON' && c.subCategory !== 'BASIC') ||
            (c.category === 'TRAINER' && c.subCategory === 'ITEM' && state.player.itemLockActive)
          if (isStuck) {
            deadTurnsByCardId.set(c.cardId, (deadTurnsByCardId.get(c.cardId) ?? 0) + 1)
          }
        }
      }

      const attackAction = decision.chosenActions.find((a) => a.type === 'DECLARE_ATTACK')
      const didAttackThisTurn = Boolean(attackAction)
      const attackDamageDealt = attackAction?.estimatedDamage ?? 0
      totalPlayerDamageDealt += attackDamageDealt

      // Suivi des combos et attaques déclenchées
      if (telemetryAcc) {
        for (const act of decision.chosenActions) {
          if (!act.cardId) continue
          for (const combo of Object.values(telemetryAcc.comboCounters)) {
            if (combo.cardId !== act.cardId) continue
            const matchesAction =
              act.actionId === combo.actionId ||
              (act.type === 'DECLARE_ATTACK' && combo.sourceType === 'ATTACK')
            if (matchesAction) {
              combo.totalTriggersCount += 1
              combo.sumDamageWhenTriggered += act.estimatedDamage ?? 0
              if (!firstComboTriggerTurn.has(combo.comboId)) {
                firstComboTriggerTurn.set(combo.comboId, playerTurnOrdinal)
              }
            }
          }
        }
      }

      // 1. Vitesse de Setup (Attaquant opérationnel + >= 1 Pokémon sur le Banc)
      const playerAllInPlay = [
        ...(state.player.activePokemon ? [state.player.activePokemon] : []),
        ...state.player.bench,
      ]
      const hasOperationalAttacker =
        didAttackThisTurn ||
        playerAllInPlay.some((p) => {
          const req = getMainAttackEnergyRequirement(p.card)
          return (
            p.attachedEnergies.length >= req &&
            (p.card.strategicEvaluator.primaryRole === 'MAIN_ATTACKER' ||
              p.card.subCategory !== 'BASIC' ||
              p.card.playableActions.some((a) => a.actionType === 'ATTACK' || a.sourceType === 'ATTACK'))
          )
        })

      if (setupTurnPlayerIndex === null && state.player.bench.length >= 1 && hasOperationalAttacker) {
        setupTurnPlayerIndex = playerTurnOrdinal
      }

      // 2. Continuité d'attaque sous One-Shot (Attacker Streaming)
      if (pendingRevengeAfterKo) {
        activeKOsSuffered += 1
        if (didAttackThisTurn) {
          revengeAttacksSucceeded += 1
        }
        pendingRevengeAfterKo = false
      }

      // 3. Résilience Post-Perturbation (Mashynn / Tampon Injuste / Juge)
      if (pendingPostDisruption) {
        disruptionsSuffered += 1
        if (didAttackThisTurn) {
          postDisruptionAttacks += 1
        }
        pendingPostDisruption = false
      }

      // 4. Indice de Flexibilité Ordres du Boss
      const playedGust = decision.chosenActions.some((a) => isGustAction(a, deckLookup))
      if (playedGust && didAttackThisTurn) {
        hadBossPlusAttackCombo = true
      }

      if (currentTurnNumber >= 2 && didAttackThisTurn) {
        attackTurnsCount += 1
        const playedDrawSearchSupporter = decision.chosenActions.some((a) =>
          isDrawOrSearchSupporterAction(a, deckLookup),
        )
        if (!playedDrawSearchSupporter) {
          supporterFreeAttackTurns += 1
        }
      }

      // 6. Impact J2 Tour 1 (Attaque ou Item-Lock dès le premier tour en second)
      if (firstPlayerIndex === 1 && currentTurnNumber === 2) {
        const appliedItemLock =
          Boolean(state.opponent.itemLockActive) ||
          decision.chosenActions.some((a) => {
            if (a.type !== 'DECLARE_ATTACK' || !a.cardId) return false
            const card = deckLookup.get(a.cardId)
            return Boolean(card?.playableActions.some(isZeroEnergyItemLockAttack))
          })
        if (appliedItemLock) {
          hadJ2Turn1ItemLock = true
          hadJ2Turn1AttackOrLock = true
        } else if (didAttackThisTurn) {
          hadJ2Turn1AttackOrLock = true
        }
      }
    } else {
      // Tour de l'adversaire (`actingPlayer === 'OPPONENT'`)
      // Mode Stress-Test "One-Shot par tour" optionnel à partir du Tour 3
      if (config.stressTestOhkoEachTurn && currentTurnNumber >= 3 && state.winner === null) {
        const alreadyKoed =
          state.player.koSufferedLastOpponentTurn ||
          state.opponent.prizes.length < prevOpponentPrizes
        if (!alreadyKoed && state.player.activePokemon) {
          handleKnockOut(state, state.opponent, state.player, 'ACTIVE')
        }
      }

      const playerActiveWasKoed =
        state.player.koSufferedLastOpponentTurn ||
        (prevPlayerActiveId !== null &&
          state.player.activePokemon?.instanceId !== prevPlayerActiveId &&
          state.opponent.prizes.length < prevOpponentPrizes)

      if (currentTurnNumber >= 2 && playerActiveWasKoed && state.winner === null) {
        pendingRevengeAfterKo = true
      }

      if (
        currentTurnNumber >= 2 &&
        state.winner === null &&
        (didOpponentPlayHandDisruption(decision.chosenActions, state, prevPlayerHandLen) ||
          (state.player.hand.length <= 4 && state.player.hand.length < prevPlayerHandLen))
      ) {
        pendingPostDisruption = true
      }
    }

    // Checkpoints analytiques historiques de stabilité du deck joueur
    if (currentTurnNumber <= 2 && state.player.bench.length >= 2) {
      hadPlayerTurn1BenchSetup = true
    }
    if (currentTurnNumber <= 4) {
      const playerAll = [
        ...(state.player.activePokemon ? [state.player.activePokemon] : []),
        ...state.player.bench,
      ]
      if (
        playerAll.some(
          (p) =>
            (p.card.subCategory === 'STAGE_2' ||
              p.card.strategicEvaluator.primaryRole === 'MAIN_ATTACKER') &&
            p.attachedEnergies.length >= 2,
        )
      ) {
        hadPlayerTurn2AttackerReady = true
      }
    }

    if (recordTrace && playerBoardBefore && opponentBoardBefore) {
      tracedTurns.push({
        turnNumber: currentTurnNumber,
        actingPlayer,
        drawnCardName: drawnCard ? drawnCard.identity.nameFr : null,
        perturbationNote,
        playerBoardBefore,
        opponentBoardBefore,
        playerBoardAfter: snapshotBoardForTrace(state.player),
        opponentBoardAfter: snapshotBoardForTrace(state.opponent),
        chosenActionSequence: decision.chosenActionLabels,
        scoreT: decision.scoreT,
        scoreTAdv: decision.scoreTAdv,
        scoreTPlus1: decision.scoreTPlus1,
        totalScore: decision.totalScore,
        branchesExplored: decision.totalBranchesExplored,
        candidateBranches: decision.candidateTraces,
      })
    }

    if (state.winner !== null) {
      break
    }
  }

  if (state.winner === null) {
    endTurnAndAdvance(state)
    if (state.winner === null) {
      state.winReason = 'MAX_TURNS_REACHED'
      if (state.player.prizes.length < state.opponent.prizes.length) {
        state.winner = 'PLAYER'
      } else if (state.opponent.prizes.length < state.player.prizes.length) {
        state.winner = 'OPPONENT'
      } else {
        state.winner = 'DRAW'
      }
    }
  }

  // Consolidation de la télémétrie par carte et par combo en fin de partie
  if (telemetryAcc) {
    const discardIds = new Set(state.player.discard.map((c) => c.cardId))
    for (const dId of discardIds) {
      seenCardIds.add(dId)
    }

    for (const [cardId, counter] of Object.entries(telemetryAcc.cardCounters)) {
      if (seenCardIds.has(cardId)) {
        counter.gamesDrawn += 1
      }
      if (playedCardIds.has(cardId)) {
        counter.gamesPlayed += 1
      } else if (discardIds.has(cardId)) {
        counter.gamesDiscardedUnused += 1
      }
      counter.turnsStuckDeadInHand += deadTurnsByCardId.get(cardId) ?? 0
      if (allPrizedCardIds.has(cardId) && state.winner === 'PLAYER') {
        counter.winsWhenAllPrized += 1
      }
    }

    for (const [comboId, firstTurn] of firstComboTriggerTurn.entries()) {
      const combo = telemetryAcc.comboCounters[comboId]
      if (combo) {
        combo.gamesTriggered += 1
        combo.sumFirstTriggerTurn += firstTurn
      }
    }
  }

  const playerPrizesWon = Math.max(0, 6 - state.player.prizes.length)
  const opponentPrizesWon = Math.max(0, 6 - state.opponent.prizes.length)

  const tracedGame: TracedGameRecord | undefined = recordTrace
    ? {
        gameIndex: gameIndex + 1,
        seed,
        opponentId: opponentDeck.id,
        opponentName: opponentDeck.name,
        firstPlayer: firstPlayerIndex === 0 ? 'PLAYER' : 'OPPONENT',
        winner: state.winner,
        winReason: state.winReason,
        totalTurns: state.turnNumber,
        playerPrizesWon,
        opponentPrizesWon,
        playerMulligans: state.player.mulliganCount,
        opponentMulligans: state.opponent.mulliganCount,
        playerInitialHand: state.player.initialHandSnapshot,
        playerInitialPrizes: state.player.initialPrizesSnapshot,
        opponentInitialHand: state.opponent.initialHandSnapshot,
        opponentInitialPrizes: state.opponent.initialPrizesSnapshot,
        turns: tracedTurns,
      }
    : undefined

  return {
    gameIndex: gameIndex + 1,
    opponentId: opponentDeck.id,
    opponentName: opponentDeck.name,
    firstPlayerIndex,
    winner: state.winner,
    winReason: state.winReason,
    turnsPlayed: state.turnNumber,
    playerPrizesWon,
    opponentPrizesWon,
    playerMulligans: state.player.mulliganCount,
    opponentMulligans: state.opponent.mulliganCount,
    hadPlayerTurn1BenchSetup,
    hadPlayerTurn2AttackerReady,
    setupTurnPlayerIndex,
    activeKOsSuffered,
    revengeAttacksSucceeded,
    disruptionsSuffered,
    postDisruptionAttacks,
    attackTurnsCount,
    supporterFreeAttackTurns,
    hadBossPlusAttackCombo,
    playerTurnsCount,
    totalPlayerDamageDealt,
    hadJ2Turn1AttackOrLock,
    hadJ2Turn1ItemLock,
    tracedGame,
  }
}

/**
 * Exécute un lot (Shard) de parties et notifie la progression en temps réel.
 */
export function runSimulationShard(
  input: SimulationShardInput,
  onProgress?: (completedCountInShard: number) => void,
): SimulationShardResult {
  const outcomes: SingleGameOutcome[] = []
  const tracedGames: TracedGameRecord[] = []
  const oppCount = Math.max(1, input.opponentDecks.length)
  const telemetry = createShardTelemetryAccumulator(input.playerDeckModels)

  for (let i = 0; i < input.gameCount; i++) {
    const globalGameIdx = input.startGameIndex + i
    const oppDeck = input.opponentDecks[globalGameIdx % oppCount]!
    const gameSeed = deriveGameSeed(input.baseSeed, globalGameIdx + 1)
    const shouldTrace = Boolean(input.config.debugMode) && globalGameIdx < MAX_TRACED_GAMES

    try {
      const outcome = playFullGame(
        input.playerDeckModels,
        oppDeck,
        globalGameIdx,
        gameSeed,
        input.config,
        shouldTrace,
        telemetry,
      )

      outcomes.push(outcome)
      if (outcome.tracedGame) {
        tracedGames.push(outcome.tracedGame)
      }
    } catch (err) {
      console.error(
        `[gameLoop] Exception in game #${globalGameIdx + 1} (Seed: ${gameSeed}) vs ${oppDeck.name}:`,
        err,
      )
      throw err
    }

    const reportInterval =
      input.gameCount >= 10000
        ? 1000
        : input.gameCount >= 2000
          ? 500
          : input.gameCount >= 500
            ? 50
            : input.gameCount >= 100
              ? 10
              : 2

    if (onProgress && ((i + 1) % reportInterval === 0 || i === input.gameCount - 1)) {
      onProgress(i + 1)
    }
  }

  return {
    shardId: input.shardId,
    outcomes,
    tracedGames,
    telemetry,
  }
}

/**
 * Fusionne les résultats de tous les Shards Web Workers pour produire les 8 KPIs obligatoires,
 * les 6 familles d'analyses tactiques compétitives et les parties tracées pour l'Inspecteur Debug.
 */
export function mergeSimulationShards(
  shards: SimulationShardResult[],
  opponentDecks: OpponentDeckDescriptor[],
  config: SimulationConfig,
  baseSeed: number,
  totalDurationMs: number,
): SimulationMetricsSummary {
  const allOutcomes: SingleGameOutcome[] = []
  const allTraced: TracedGameRecord[] = []
  const mergedCardCounters: Record<string, ShardCardCounter> = {}
  const mergedComboCounters: Record<string, ShardComboCounter> = {}

  for (const shard of shards) {
    allOutcomes.push(...shard.outcomes)
    allTraced.push(...shard.tracedGames)

    if (shard.telemetry) {
      for (const [cardId, c] of Object.entries(shard.telemetry.cardCounters)) {
        const existing = mergedCardCounters[cardId]
        if (!existing) {
          mergedCardCounters[cardId] = { ...c }
        } else {
          existing.gamesInDeck += c.gamesInDeck
          existing.gamesDrawn += c.gamesDrawn
          existing.gamesPlayed += c.gamesPlayed
          existing.gamesDiscardedUnused += c.gamesDiscardedUnused
          existing.turnsStuckDeadInHand += c.turnsStuckDeadInHand
          existing.gamesAllCopiesPrized += c.gamesAllCopiesPrized
          existing.winsWhenAllPrized += c.winsWhenAllPrized
        }
      }

      for (const [comboId, cb] of Object.entries(shard.telemetry.comboCounters)) {
        const existing = mergedComboCounters[comboId]
        if (!existing) {
          mergedComboCounters[comboId] = { ...cb }
        } else {
          existing.gamesTriggered += cb.gamesTriggered
          existing.totalTriggersCount += cb.totalTriggersCount
          existing.sumFirstTriggerTurn += cb.sumFirstTriggerTurn
          existing.sumDamageWhenTriggered += cb.sumDamageWhenTriggered
        }
      }
    }
  }

  allOutcomes.sort((a, b) => a.gameIndex - b.gameIndex)
  allTraced.sort((a, b) => a.gameIndex - b.gameIndex)

  const totalGames = allOutcomes.length
  let wins = 0
  let losses = 0
  let draws = 0
  let totalPlayerMulligans = 0
  let gamesWithMulliganCount = 0
  let sumPlayerPrizes = 0
  let sumOpponentPrizes = 0
  let sumTurns = 0
  let turn1BenchSetupCount = 0
  let turn2AttackerReadyCount = 0

  // Accumulateurs pour les 6 familles d'analyses tactiques
  let setupGamesCount = 0
  let sumSetupTurn = 0
  let setupT1Count = 0
  let setupT2Count = 0
  let setupT3Count = 0
  let setupT4PlusCount = 0
  let setupFailedCount = 0

  let totalActiveKOsSuffered = 0
  let revengeAttackSuccessCount = 0

  let disruptionsSufferedCount = 0
  let postDisruptionAttackCount = 0

  let totalAttackTurnsCount = 0
  let supporterFreeAttackCount = 0
  let gamesWithBossPlusAttackCount = 0

  let totalPlayerTurnsCount = 0
  let totalPlayerDamageDealt = 0

  let gamesGoingFirst = 0
  let winsGoingFirst = 0
  let gamesGoingSecond = 0
  let winsGoingSecond = 0
  let turn1AttackOrItemLockCountJ2 = 0
  let turn1ItemLockCountJ2 = 0

  const winReasons = {
    ALL_PRIZES_TAKEN: 0,
    NO_POKEMON_IN_PLAY: 0,
    DECK_OUT: 0,
    MAX_TURNS_REACHED: 0,
  }

  const byOpponent = new Map<
    string,
    {
      desc: OpponentDeckDescriptor
      games: number
      wins: number
      losses: number
      draws: number
      playerPrizes: number
      opponentPrizes: number
    }
  >()

  for (const opp of opponentDecks) {
    byOpponent.set(opp.id, {
      desc: opp,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      playerPrizes: 0,
      opponentPrizes: 0,
    })
  }

  for (const o of allOutcomes) {
    if (o.winner === 'PLAYER') wins++
    else if (o.winner === 'OPPONENT') losses++
    else draws++

    totalPlayerMulligans += o.playerMulligans
    if (o.playerMulligans >= 1) gamesWithMulliganCount++

    sumPlayerPrizes += o.playerPrizesWon
    sumOpponentPrizes += o.opponentPrizesWon
    sumTurns += o.turnsPlayed

    if (o.hadPlayerTurn1BenchSetup) turn1BenchSetupCount++
    if (o.hadPlayerTurn2AttackerReady) turn2AttackerReadyCount++

    if (o.winReason && o.winReason in winReasons) {
      winReasons[o.winReason]++
    }

    // Famille 2 : Vitesse de Setup & Continuité d'Attaque sous One-Shot
    if (o.setupTurnPlayerIndex !== null && o.setupTurnPlayerIndex !== undefined) {
      setupGamesCount++
      sumSetupTurn += o.setupTurnPlayerIndex
      if (o.setupTurnPlayerIndex <= 1) setupT1Count++
      else if (o.setupTurnPlayerIndex === 2) setupT2Count++
      else if (o.setupTurnPlayerIndex === 3) setupT3Count++
      else setupT4PlusCount++
    } else {
      setupFailedCount++
    }

    totalActiveKOsSuffered += o.activeKOsSuffered ?? 0
    revengeAttackSuccessCount += o.revengeAttacksSucceeded ?? 0

    // Famille 3 : Résilience Post-Perturbation
    disruptionsSufferedCount += o.disruptionsSuffered ?? 0
    postDisruptionAttackCount += o.postDisruptionAttacks ?? 0

    // Famille 4 : Indice de Flexibilité Ordres du Boss
    totalAttackTurnsCount += o.attackTurnsCount ?? 0
    supporterFreeAttackCount += o.supporterFreeAttackTurns ?? 0
    if (o.hadBossPlusAttackCombo) gamesWithBossPlusAttackCount++

    // Famille 5 : Dégâts moyens par tour
    totalPlayerTurnsCount += o.playerTurnsCount ?? 0
    totalPlayerDamageDealt += o.totalPlayerDamageDealt ?? 0

    // Famille 6 : Split J1 (1er) vs J2 (2d)
    if (o.firstPlayerIndex === 0) {
      gamesGoingFirst++
      if (o.winner === 'PLAYER') winsGoingFirst++
    } else {
      gamesGoingSecond++
      if (o.winner === 'PLAYER') winsGoingSecond++
      if (o.hadJ2Turn1AttackOrLock) turn1AttackOrItemLockCountJ2++
      if (o.hadJ2Turn1ItemLock) turn1ItemLockCountJ2++
    }

    const bucket = byOpponent.get(o.opponentId)
    if (bucket) {
      bucket.games++
      if (o.winner === 'PLAYER') bucket.wins++
      else if (o.winner === 'OPPONENT') bucket.losses++
      else bucket.draws++
      bucket.playerPrizes += o.playerPrizesWon
      bucket.opponentPrizes += o.opponentPrizesWon
    }
  }

  const matchupBreakdown: MatchupStatRecord[] = Array.from(byOpponent.values()).map((b) => ({
    opponentId: b.desc.id,
    opponentName: b.desc.name,
    opponentNameEn: b.desc.nameEn || b.desc.name,
    archetypeTag: b.desc.archetypeTag,
    archetypeTagEn: b.desc.archetypeTagEn || b.desc.archetypeTag,
    accentColor: b.desc.accentColor,
    gamesPlayed: b.games,
    wins: b.wins,
    losses: b.losses,
    draws: b.draws,
    winRate: b.games > 0 ? Math.round((b.wins / b.games) * 1000) / 10 : 0,
    avgPlayerPrizesWon: b.games > 0 ? Math.round((b.playerPrizes / b.games) * 100) / 100 : 0,
    avgOpponentPrizesWon: b.games > 0 ? Math.round((b.opponentPrizes / b.games) * 100) / 100 : 0,
  }))

  const safeDurationSec = Math.max(0.001, totalDurationMs / 1000)
  const gamesPerSecond = Math.round((totalGames / safeDurationSec) * 10) / 10
  const globalWinRate = totalGames > 0 ? Math.round((wins / totalGames) * 1000) / 10 : 0

  // Calcul final de `cardTelemetry`
  const cardTelemetry: Record<string, CardUsageMetrics> = {}
  const safePlayerTurns = Math.max(1, totalPlayerTurnsCount)
  for (const [cardId, c] of Object.entries(mergedCardCounters)) {
    const gamesInDeck = Math.max(1, c.gamesInDeck)
    const winRateWhenAllPrized =
      c.gamesAllCopiesPrized > 0
        ? Math.round((c.winsWhenAllPrized / c.gamesAllCopiesPrized) * 1000) / 10
        : globalWinRate
    const winRateImpactWhenAllPrized =
      c.gamesAllCopiesPrized > 0
        ? Math.round((winRateWhenAllPrized - globalWinRate) * 10) / 10
        : 0

    cardTelemetry[cardId] = {
      cardId: c.cardId,
      nameFr: c.nameFr,
      nameEn: c.nameEn || c.nameFr,
      category: c.category,
      subCategory: c.subCategory,
      quantityInDeck: c.quantityInDeck,
      gamesInDeck: c.gamesInDeck,
      gamesDrawn: c.gamesDrawn,
      gamesPlayed: c.gamesPlayed,
      gamesDiscardedUnused: c.gamesDiscardedUnused,
      turnsStuckDeadInHand: c.turnsStuckDeadInHand,
      gamesAllCopiesPrized: c.gamesAllCopiesPrized,
      winsWhenAllPrized: c.winsWhenAllPrized,
      winRateWhenAllPrized,
      winRateImpactWhenAllPrized,
      effectivePlayRate: Math.round((c.gamesPlayed / gamesInDeck) * 1000) / 10,
      drawnRate: Math.round((c.gamesDrawn / gamesInDeck) * 1000) / 10,
      discardedUnusedRate: Math.round((c.gamesDiscardedUnused / gamesInDeck) * 1000) / 10,
      deadHandTurnRate: Math.round((c.turnsStuckDeadInHand / safePlayerTurns) * 1000) / 10,
      allCopiesPrizedRate: Math.round((c.gamesAllCopiesPrized / gamesInDeck) * 1000) / 10,
    }
  }

  // Calcul final de `setupTurnHistogram` & `averageSetupTurn`
  const averageSetupTurn =
    setupGamesCount > 0 ? Math.round((sumSetupTurn / setupGamesCount) * 10) / 10 : 0
  const setupTurnHistogram: SetupTurnHistogram = {
    T1: totalGames > 0 ? Math.round((setupT1Count / totalGames) * 1000) / 10 : 0,
    T2: totalGames > 0 ? Math.round((setupT2Count / totalGames) * 1000) / 10 : 0,
    T3: totalGames > 0 ? Math.round((setupT3Count / totalGames) * 1000) / 10 : 0,
    T4Plus: totalGames > 0 ? Math.round((setupT4PlusCount / totalGames) * 1000) / 10 : 0,
    failed: totalGames > 0 ? Math.round((setupFailedCount / totalGames) * 1000) / 10 : 0,
  }

  // Calcul final de `attackerStreamingRate`
  const attackerStreamingRate =
    totalActiveKOsSuffered > 0
      ? Math.round((revengeAttackSuccessCount / totalActiveKOsSuffered) * 1000) / 10
      : totalGames > 0
        ? Math.round((turn2AttackerReadyCount / totalGames) * 1000) / 10
        : 0

  // Calcul final de `postDisruptionResilience`
  const postDisruptionAttackRate =
    disruptionsSufferedCount > 0
      ? Math.round((postDisruptionAttackCount / disruptionsSufferedCount) * 1000) / 10
      : 0
  const postDisruptionBrickRate =
    disruptionsSufferedCount > 0
      ? Math.round(
          ((disruptionsSufferedCount - postDisruptionAttackCount) / disruptionsSufferedCount) *
            1000,
        ) / 10
      : 0
  const postDisruptionResilience: PostDisruptionResilienceStats = {
    disruptionsSufferedCount,
    postDisruptionAttackCount,
    postDisruptionAttackRate,
    postDisruptionBrickRate,
  }

  // Calcul final de `bossFlexibility`
  const supporterFreeAttackRate =
    totalAttackTurnsCount > 0
      ? Math.round((supporterFreeAttackCount / totalAttackTurnsCount) * 1000) / 10
      : 0
  const bossPlusAttackComboRate =
    totalGames > 0 ? Math.round((gamesWithBossPlusAttackCount / totalGames) * 1000) / 10 : 0
  const bossFlexibility: BossFlexibilityStats = {
    totalAttackTurnsCount,
    supporterFreeAttackCount,
    supporterFreeAttackRate,
    gamesWithBossPlusAttackCount,
    bossPlusAttackComboRate,
  }

  // Calcul final de `conditionalComboStats` & `averageDamagePerTurn`
  const conditionalComboStats: ConditionalComboStatRecord[] = Object.values(mergedComboCounters)
    .map((cb) => ({
      comboId: cb.comboId,
      label: cb.label,
      cardId: cb.cardId,
      cardNameFr: cb.cardNameFr,
      conditionSummary: cb.conditionSummary,
      gamesTriggered: cb.gamesTriggered,
      totalTriggersCount: cb.totalTriggersCount,
      triggerRate: totalGames > 0 ? Math.round((cb.gamesTriggered / totalGames) * 1000) / 10 : 0,
      avgTriggerTurn:
        cb.gamesTriggered > 0 ? Math.round((cb.sumFirstTriggerTurn / cb.gamesTriggered) * 10) / 10 : 0,
      avgDamageWhenTriggered:
        cb.totalTriggersCount > 0 ? Math.round(cb.sumDamageWhenTriggered / cb.totalTriggersCount) : 0,
    }))
    .sort((a, b) => b.triggerRate - a.triggerRate)

  const averageDamagePerTurn =
    totalPlayerTurnsCount > 0 ? Math.round(totalPlayerDamageDealt / totalPlayerTurnsCount) : 0

  // Calcul final de `turnOrderSplitStats`
  const turnOrderSplitStats: TurnOrderSplitStats = {
    gamesGoingFirst,
    winsGoingFirst,
    winRateGoingFirst:
      gamesGoingFirst > 0 ? Math.round((winsGoingFirst / gamesGoingFirst) * 1000) / 10 : 0,
    gamesGoingSecond,
    winsGoingSecond,
    winRateGoingSecond:
      gamesGoingSecond > 0 ? Math.round((winsGoingSecond / gamesGoingSecond) * 1000) / 10 : 0,
    turn1AttackOrItemLockCountJ2,
    turn1AttackOrItemLockRateJ2:
      gamesGoingSecond > 0
        ? Math.round((turn1AttackOrItemLockCountJ2 / gamesGoingSecond) * 1000) / 10
        : 0,
    turn1ItemLockCountJ2,
    turn1ItemLockRateJ2:
      gamesGoingSecond > 0
        ? Math.round((turn1ItemLockCountJ2 / gamesGoingSecond) * 1000) / 10
        : 0,
  }

  return {
    totalDurationMs: Math.round(totalDurationMs),
    totalGamesSimulated: totalGames,
    gamesPerSecond,
    globalWinRate,
    wins,
    losses,
    draws,
    matchupBreakdown,
    totalPlayerMulligans,
    gamesWithMulliganCount,
    gamesWithMulliganRate:
      totalGames > 0 ? Math.round((gamesWithMulliganCount / totalGames) * 1000) / 10 : 0,
    avgPlayerPrizesWon:
      totalGames > 0 ? Math.round((sumPlayerPrizes / totalGames) * 100) / 100 : 0,
    avgOpponentPrizesWon:
      totalGames > 0 ? Math.round((sumOpponentPrizes / totalGames) * 100) / 100 : 0,
    avgTurnsPlayed: totalGames > 0 ? Math.round((sumTurns / totalGames) * 10) / 10 : 0,
    turn1BenchSetupRate:
      totalGames > 0 ? Math.round((turn1BenchSetupCount / totalGames) * 1000) / 10 : 0,
    turn2AttackerReadyRate:
      totalGames > 0 ? Math.round((turn2AttackerReadyCount / totalGames) * 1000) / 10 : 0,
    winReasons,
    cardTelemetry,
    averageSetupTurn,
    setupTurnHistogram,
    attackerStreamingRate,
    totalActiveKOsSuffered,
    revengeAttackSuccessCount,
    postDisruptionResilience,
    bossFlexibility,
    bossFlexibilityRate: supporterFreeAttackRate,
    conditionalComboStats,
    averageDamagePerTurn,
    turnOrderSplitStats,
    configUsed: config,
    baseSeedUsed: baseSeed,
    tracedGames: allTraced.slice(0, MAX_TRACED_GAMES),
  }
}
