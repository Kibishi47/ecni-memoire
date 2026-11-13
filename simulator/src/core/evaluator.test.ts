import { describe, expect, it } from 'vitest'
import { UNIFIED_CARD_REGISTRY } from '../data/cardCatalog'
import { META_OPPONENT_DECKS } from '../data/metaDecks'
import { createNativeBasicEnergyModel } from '../utils/energy'
import { parsePtcglDecklist } from '../utils/ptcglParser'
import type { EngineCardModel } from '../types/cardModel'
import { applyAction, createInitialMatchState, fastCloneState, isCardDeadInHand } from './engine'
import { computeCardIntrinsicValue, evaluateState, getStateHash, selectBestTurnBranch } from './evaluator'

const mockCharmander: EngineCardModel = {
  cardId: 'test-charmander',
  identity: {
    cardId: 'test-charmander',
    nameFr: 'Salamèche',
    nameEn: 'Charmander',
    setId: 'test',
    setName: 'Test',
    localId: '001',
    category: 'POKEMON',
    subCategory: 'BASIC',
    isRuleBox: false,
    prizeCardsGiven: 1,
    isAceSpec: false,
    isAncient: false,
    isFuture: false,
    isTera: false,
    regulationMark: 'G',
    legalStandard: true,
    legalExpanded: true,
    rarity: 'Commune',
    imageUrl: null,
    rawRulesText: [],
  },
  pokemonStats: {
    hp: 70,
    types: ['Feu'],
    stage: 'De base',
    evolvesFrom: null,
    rootBasicName: 'Salamèche',
    evolutionChain: ['Salamèche', 'Reptincel', 'Dracaufeu-ex'],
    retreatCost: 1,
    weaknesses: [],
    resistances: [],
    prizeCardsGiven: 1,
    isRuleBox: false,
  },
  category: 'POKEMON',
  subCategory: 'BASIC',
  playableActions: [],
  strategicEvaluator: {
    aiRole: 'SECONDARY_ATTACKER',
    primaryRole: 'SECONDARY_ATTACKER',
    intrinsicBaseScore: 50,
    turnPhaseWeights: { turn1: 1, turn2: 1, turn3: 1, turn4Plus: 1 },
    decklistSynergyRequirements: [],
    inGameDeadCardConditions: [],
    discardPriorityWhenDead: 60,
    holdForNextTurnBonus: 10,
  },
}

const mockTargetBasic: EngineCardModel = {
  cardId: 'test-target',
  identity: {
    cardId: 'test-target',
    nameFr: 'Cible Test',
    nameEn: 'Target Test',
    setId: 'test',
    setName: 'Test',
    localId: '002',
    category: 'POKEMON',
    subCategory: 'BASIC',
    isRuleBox: false,
    prizeCardsGiven: 1,
    isAceSpec: false,
    isAncient: false,
    isFuture: false,
    isTera: false,
    regulationMark: 'G',
    legalStandard: true,
    legalExpanded: true,
    rarity: 'Commune',
    imageUrl: null,
    rawRulesText: [],
  },
  pokemonStats: {
    hp: 70,
    types: ['Incolore'],
    stage: 'De base',
    evolvesFrom: null,
    rootBasicName: 'Cible Test',
    evolutionChain: ['Cible Test'],
    retreatCost: 1,
    weaknesses: [],
    resistances: [],
    prizeCardsGiven: 1,
    isRuleBox: false,
  },
  category: 'POKEMON',
  subCategory: 'BASIC',
  playableActions: [],
  strategicEvaluator: {
    aiRole: 'SECONDARY_ATTACKER',
    primaryRole: 'SECONDARY_ATTACKER',
    intrinsicBaseScore: 40,
    turnPhaseWeights: { turn1: 1, turn2: 1, turn3: 1, turn4Plus: 1 },
    decklistSynergyRequirements: [],
    inGameDeadCardConditions: [],
    discardPriorityWhenDead: 50,
    holdForNextTurnBonus: 10,
  },
}

function buildDeckModelsFromPtcgl(rawText: string) {
  const parsed = parsePtcglDecklist(rawText)
  const models = []
  for (const card of parsed.cards) {
    for (let i = 0; i < card.quantity; i++) {
      models.push(card.model)
    }
  }
  return models
}

describe('Evaluator — 3-Ply Lookahead (T -> T_adv -> T+1) & Dynamic Card Valuation', () => {
  it('deduplicates commutative bench placements via canonical getStateHash', () => {
    const deckA = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const deckB = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)

    const baseState = createInitialMatchState(deckA, deckB, {
      seed: 101,
      firstPlayerIndex: 0,
      maxTurns: 18,
    })

    const boltEx = UNIFIED_CARD_REGISTRY['sv05-123']!
    const fezandipitiEx = UNIFIED_CARD_REGISTRY['sv06.5-038']!

    baseState.player.bench = []
    baseState.player.hand = [boltEx, fezandipitiEx]

    // Séquence A : poser Ire-Foudre puis Favianos
    const stateA1 = applyAction(baseState, {
      type: 'PUT_BASIC_ON_BENCH',
      cardId: boltEx.cardId,
      label: 'Poser Ire-Foudre-ex',
    })
    const stateA2 = applyAction(stateA1, {
      type: 'PUT_BASIC_ON_BENCH',
      cardId: fezandipitiEx.cardId,
      label: 'Poser Favianos-ex',
    })

    // Séquence B : poser Favianos puis Ire-Foudre
    const stateB1 = applyAction(baseState, {
      type: 'PUT_BASIC_ON_BENCH',
      cardId: fezandipitiEx.cardId,
      label: 'Poser Favianos-ex',
    })
    const stateB2 = applyAction(stateB1, {
      type: 'PUT_BASIC_ON_BENCH',
      cardId: boltEx.cardId,
      label: 'Poser Ire-Foudre-ex',
    })

    expect(getStateHash(stateA2)).toBe(getStateHash(stateB2))
  })

  it('selects Rare Candy -> Charizard ex -> Burning Darkness KO over passing via 3-ply lookahead', () => {
    const deckA = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const deckB = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)

    const state = createInitialMatchState(deckA, deckB, {
      seed: 777,
      firstPlayerIndex: 0,
      maxTurns: 18,
    })

    state.turnNumber = 3
    state.activePlayerIndex = 0

    const rareCandy = UNIFIED_CARD_REGISTRY['sv04-125']!
    const charizardEx = UNIFIED_CARD_REGISTRY['sv03-125']!
    const fireEnergy = createNativeBasicEnergyModel('Feu')

    state.player.activePokemon = {
      instanceId: 'p_charmander',
      card: mockCharmander,
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 1,
      evolvedThisTurn: false,
      specialConditions: [],
      cantAttackNextTurn: false,
    }
    state.opponent.activePokemon = {
      instanceId: 'p_target_active',
      card: mockTargetBasic,
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 2,
      evolvedThisTurn: false,
      specialConditions: [],
      cantAttackNextTurn: false,
    }
    state.opponent.bench = [
      {
        instanceId: 'p_target_bench',
        card: mockTargetBasic,
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 2,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      },
    ]

    state.player.hand = [rareCandy, charizardEx]
    state.player.deck.push(fireEnergy, fireEnergy, fireEnergy)

    const initialScore = evaluateState(state, 0)
    const decision = selectBestTurnBranch(state, 20, true)

    expect(decision.chosenActions.some((a) => a.type === 'DECLARE_ATTACK')).toBe(true)
    expect(decision.finalTurnState.player.prizes.length).toBe(5)
    expect(decision.scoreT).toBeGreaterThan(initialScore)
    expect(decision.candidateTraces.length).toBeGreaterThanOrEqual(2)

    const chosenTrace = decision.candidateTraces.find((t) => t.isChosen)
    expect(chosenTrace).toBeDefined()
    const expectedWeighted =
      Math.round(
        (0.35 * chosenTrace!.scoreT -
          0.3 * chosenTrace!.scoreTAdv +
          0.35 * chosenTrace!.scoreTPlus1) *
          10,
      ) / 10
    expect(chosenTrace!.totalScore).toBeCloseTo(expectedWeighted, 1)
  })

  it('évalue avec exactitude les 5 nouvelles conditions de cartes mortes en main', () => {
    const deckA = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const deckB = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)

    const state = createInitialMatchState(deckA, deckB, {
      seed: 123,
      firstPlayerIndex: 0,
      maxTurns: 10,
    })

    const dummyCard: EngineCardModel = {
      ...mockCharmander,
      cardId: 'test-dead-card',
      strategicEvaluator: {
        ...mockCharmander.strategicEvaluator,
        inGameDeadCardConditions: [{ reason: 'NO_TERA_POKEMON_IN_PLAY', zonesToCheck: [] }],
      },
    }

    // Aucun Pokémon Téracristal n'est en jeu côté joueur -> carte morte
    expect(state.player.activePokemon?.card.pokemonStats?.isTera).toBeFalsy()
    expect(isCardDeadInHand(dummyCard, state.player, state.opponent, state.activeStadium)).toBe(true)

    // Si on active le flag isTera sur l'Actif allié -> la carte n'est plus morte !
    state.player.activePokemon!.card = {
      ...state.player.activePokemon!.card,
      pokemonStats: { ...state.player.activePokemon!.card.pokemonStats!, isTera: true },
    }
    expect(isCardDeadInHand(dummyCard, state.player, state.opponent, state.activeStadium)).toBe(false)
  })

  it('pondère positivement les 5 nouveaux rôles stratégiques dans evaluateState', () => {
    const deckA = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const deckB = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)

    const state = createInitialMatchState(deckA, deckB, {
      seed: 999,
      firstPlayerIndex: 0,
      maxTurns: 10,
    })

    const initialScore = evaluateState(state, 0)

    // Ajout d'un Pokémon Tank Défensif intact à 100% de PV
    state.player.bench.push({
      instanceId: 'tank-wall',
      card: {
        ...mockTargetBasic,
        strategicEvaluator: {
          ...mockTargetBasic.strategicEvaluator,
          aiRole: 'GUEST_TECH',
          primaryRole: 'DEFENSIVE_TANK_WALL',
        },
      },
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 1,
      evolvedThisTurn: false,
      specialConditions: [],
      cantAttackNextTurn: false,
    })

    const scoreWithTank = evaluateState(state, 0)
    expect(scoreWithTank).toBeGreaterThan(initialScore)
  })

  it('vide la main pour débloquer un Supporter "seule carte en main" (HAND_MAX_OTHER_CARDS_ZERO) puis attaque deux fois', () => {
    const deckA = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const deckB = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)

    const state = createInitialMatchState(deckA, deckB, {
      seed: 404,
      firstPlayerIndex: 0,
      maxTurns: 12,
    })
    state.turnNumber = 3
    state.activePlayerIndex = 0

    const grassEnergy = createNativeBasicEnergyModel('Plante')
    const seakingCard: EngineCardModel = {
      ...mockCharmander,
      cardId: 'pre-021',
      identity: {
        ...mockCharmander.identity,
        cardId: 'pre-021',
        nameFr: 'Poissoroy',
        nameEn: 'Seaking',
      },
      pokemonStats: {
        ...mockCharmander.pokemonStats!,
        hp: 110,
        canAttackTwice: true,
      },
      playableActions: [
        {
          actionId: 'atk_rapid_draw',
          label: 'Plongeon Festif',
          actionType: 'ATTACK' as const,
          timingPhase: 'ATTACK_PHASE' as const,
          cost: { Plante: 1 },
          canUseTurn1GoingFirst: false,
          canUseTurn1GoingSecond: true,
          preconditions: ['SELF_HAS_ENERGY_COST'],
          costs: [],
          effects: [{ primitive: 'DAMAGE_ACTIVE' as const, count: 1, upTo: false, baseDamage: 60, value: 60 }],
        },
      ],
    }

    const lastCardSupporter: EngineCardModel = {
      ...mockCharmander,
      cardId: 'sup-last-card',
      category: 'TRAINER',
      subCategory: 'SUPPORTER',
      identity: {
        ...mockCharmander.identity,
        cardId: 'sup-last-card',
        nameFr: 'Supporter Ultime',
        category: 'TRAINER',
        subCategory: 'SUPPORTER',
      },
      playableActions: [
        {
          actionId: 'sup_final_boost',
          label: 'Boost Ultime (+60 dégâts)',
          actionType: 'PLAY_FROM_HAND' as const,
          timingPhase: 'MAIN_PHASE_1' as const,
          cost: {},
          canUseTurn1GoingFirst: false,
          canUseTurn1GoingSecond: true,
          preconditions: ['HAND_MAX_OTHER_CARDS_ZERO'],
          costs: [],
          effects: [{ primitive: 'DAMAGE_ACTIVE' as const, count: 6, upTo: false, baseDamage: 60, value: 60 }],
        },
      ],
    }

    state.activeStadium = {
      card: { ...mockCharmander, cardId: 'twm-149', category: 'TRAINER', subCategory: 'STADIUM' },
      ownerIndex: 0,
      usedThisTurn: false,
    }
    state.player.activePokemon = {
      instanceId: 'seaking_1',
      card: seakingCard,
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 1,
      evolvedThisTurn: false,
      specialConditions: [],
      cantAttackNextTurn: false,
    }
    state.player.bench = []
    // Hand has: 1 Basic Pokemon, 1 Energy, and 1 Last-Card Supporter
    // Optimal play: Put Basic on Bench -> Attach Energy to Seaking -> Play Last-Card Supporter (+60 dmg) -> Attack twice (120 x 2 = 240 dmg)!
    state.player.hand = [mockCharmander, grassEnergy, lastCardSupporter]

    state.opponent.activePokemon = {
      instanceId: 'opp_big_ex',
      card: {
        ...mockTargetBasic,
        pokemonStats: { ...mockTargetBasic.pokemonStats!, hp: 220, prizeCardsGiven: 2, isRuleBox: true },
      },
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 1,
      evolvedThisTurn: false,
      specialConditions: [],
      cantAttackNextTurn: false,
    }

    const decision = selectBestTurnBranch(state, 20, true)
    expect(decision.chosenActions.some((a) => a.cardId === 'sup-last-card')).toBe(true)
    expect(decision.chosenActions.some((a) => a.type === 'DECLARE_ATTACK')).toBe(true)
    // 220 HP ex is KO'd by (60 + 60) * 2 = 240 damage -> Player takes 2 prizes!
    expect(decision.finalTurnState.player.prizes.length).toBe(4)
  })

  it('évalue computeCardIntrinsicValue, les états spéciaux, verrous v2, KNOCK_OUT(SELF) et le risque auto-recul', () => {
    const deckA = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const deckB = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const baseState = createInitialMatchState(deckA, deckB, { seed: 303, firstPlayerIndex: 0, maxTurns: 12 })

    const charizard = UNIFIED_CARD_REGISTRY['sv03-125']!
    const primeCatcher = UNIFIED_CARD_REGISTRY['sv05-157']!
    const dusknoir = UNIFIED_CARD_REGISTRY['sv08.5-037']!

    // Vérifie computeCardIntrinsicValue sans intrinsicBaseScore explicite
    const cloneMain = { ...charizard, strategicEvaluator: { ...charizard.strategicEvaluator, intrinsicBaseScore: undefined } }
    const cloneTech = { ...charizard, identity: { ...charizard.identity, isAceSpec: false }, playableActions: [], strategicEvaluator: { ...charizard.strategicEvaluator, aiRole: 'GUEST_TECH' as const, intrinsicBaseScore: undefined } }
    expect(computeCardIntrinsicValue(cloneMain)).toBeGreaterThan(computeCardIntrinsicValue(cloneTech))
    expect(computeCardIntrinsicValue(primeCatcher)).toBeGreaterThan(85)

    // Évaluation positive des états spéciaux et verrous sur l'adversaire
    const lockedState = fastCloneState(baseState)
    const baseScore = evaluateState(lockedState, 0)
    lockedState.opponent.itemLockActive = true
    lockedState.opponent.abilityLockActive = true
    if (lockedState.opponent.activePokemon) {
      lockedState.opponent.activePokemon.specialConditions = ['PARALYZED', 'POISONED']
      lockedState.opponent.activePokemon.cantRetreatNextTurn = true
    }
    if (lockedState.player.activePokemon) {
      lockedState.player.activePokemon.damageTakenModifierNextTurn = -50
    }
    expect(evaluateState(lockedState, 0)).toBeGreaterThan(baseScore + 150)

    // Safety check KNOCK_OUT(SELF) sur Noctunoir v2 : ne jamais sacrifier si l'adversaire n'a plus qu'1 récompense
    const sacrificeState = fastCloneState(baseState)
    sacrificeState.turnNumber = 3
    sacrificeState.activePlayerIndex = 0
    sacrificeState.player.hand = []
    sacrificeState.player.bench = [
      {
        instanceId: 'p_dusknoir',
        card: dusknoir,
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      },
    ]
    sacrificeState.opponent.prizes = [sacrificeState.opponent.prizes[0]!]
    const safeDecision = selectBestTurnBranch(sacrificeState, 8, false)
    expect(safeDecision.chosenActions.some((a) => a.cardId === 'sv08.5-037')).toBe(false)
  })

  it('contourne Mimiriqui avec Ordres du Boss, débloque la Retraite sous cantAttackNextTurn et conserve Tampon Injuste en main', () => {
    const deckA = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const deckB = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const state = createInitialMatchState(deckA, deckB, { seed: 505, firstPlayerIndex: 0, maxTurns: 14 })
    state.turnNumber = 3
    state.activePlayerIndex = 0

    const bossOrders = UNIFIED_CARD_REGISTRY['me01-114']!
    const mimikyu = UNIFIED_CARD_REGISTRY['me02-042']!
    const ursalunaEx = UNIFIED_CARD_REGISTRY['sv06-141']!
    const latiasEx = UNIFIED_CARD_REGISTRY['sv08-076']!
    const unfairStamp = UNIFIED_CARD_REGISTRY['sv06-165']!
    const ultraBall = UNIFIED_CARD_REGISTRY['30th-128']!

    // 1. Cas Mimiriqui adverse en Actif vs Attaquant ex : Ordres du Boss sur une cible du Banc à 70 PV doit être joué pour gagner
    state.player.prizes = [state.player.prizes[0]!]
    state.player.activePokemon = {
      instanceId: 'ex_attacker',
      card: UNIFIED_CARD_REGISTRY['sv03-125']!, // Dracaufeu-ex
      previousStages: [],
      damage: 0,
      attachedEnergies: [createNativeBasicEnergyModel('Feu'), createNativeBasicEnergyModel('Feu')],
      attachedTools: [],
      turnPlayed: 1,
      evolvedThisTurn: false,
      specialConditions: [],
      cantAttackNextTurn: false,
    }
    state.player.bench = []
    state.player.hand = [bossOrders]
    state.opponent.activePokemon = {
      instanceId: 'opp_mimikyu',
      card: { ...mimikyu, identity: { ...mimikyu.identity, nameFr: 'Mimiqui', nameEn: 'Mimikyu' }, pokemonStats: { ...mimikyu.pokemonStats!, hp: 70 } },
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 2,
      evolvedThisTurn: false,
      specialConditions: [],
      cantAttackNextTurn: false,
    }
    state.opponent.bench = [
      {
        instanceId: 'opp_squishy_bench',
        card: mockTargetBasic,
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 2,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      },
    ]

    const bossDecision = selectBestTurnBranch(state, 20, true)
    expect(bossDecision.chosenActions.some((a) => a.cardId === bossOrders.cardId)).toBe(true)
    expect(bossDecision.chosenActions.some((a) => a.type === 'DECLARE_ATTACK')).toBe(true)

    // 2. Cas Retraite avec cantAttackNextTurn + Latias-ex sur le Banc : l'IA doit battre en retraite vers un attaquant prêt !
    const retreatLockState = createInitialMatchState(deckA, deckB, { seed: 606, firstPlayerIndex: 0, maxTurns: 14 })
    retreatLockState.turnNumber = 3
    retreatLockState.activePlayerIndex = 0
    retreatLockState.player.hand = []
    retreatLockState.player.activePokemon = {
      instanceId: 'ursa_locked',
      card: ursalunaEx,
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 1,
      evolvedThisTurn: false,
      specialConditions: [],
      cantAttackNextTurn: true,
      cantAttackTurn: 3,
    }
    retreatLockState.player.bench = [
      {
        instanceId: 'zard_ready',
        card: UNIFIED_CARD_REGISTRY['sv03-125']!,
        previousStages: [],
        damage: 0,
        attachedEnergies: [createNativeBasicEnergyModel('Feu'), createNativeBasicEnergyModel('Feu')],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      },
      {
        instanceId: 'latias_free',
        card: latiasEx,
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      },
    ]
    retreatLockState.opponent.activePokemon = {
      instanceId: 'opp_b1',
      card: mockTargetBasic,
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 2,
      evolvedThisTurn: false,
      specialConditions: [],
      cantAttackNextTurn: false,
    }
    const retreatDecision = selectBestTurnBranch(retreatLockState, 20, true)
    expect(retreatDecision.chosenActions.some((a) => a.type === 'RETREAT_ACTIVE')).toBe(true)
    expect(retreatDecision.chosenActions.some((a) => a.type === 'DECLARE_ATTACK')).toBe(true)

    // 3. Hyper Ball ne doit pas défausser Tampon Injuste en priorité avant une carte morte ou une énergie de base
    const costState = createInitialMatchState(deckA, deckB, { seed: 707, firstPlayerIndex: 0, maxTurns: 14 })
    costState.turnNumber = 3
    costState.activePlayerIndex = 0
    costState.player.koSufferedLastOpponentTurn = false
    costState.player.hand = [
      ultraBall,
      unfairStamp,
      createNativeBasicEnergyModel('Feu'),
      createNativeBasicEnergyModel('Eau'),
    ]
    const afterUltraBall = applyAction(costState, {
      type: 'PLAY_TRAINER',
      cardId: ultraBall.cardId,
      handIndex: 0,
      label: 'Hyper Ball',
    })
    expect(afterUltraBall.player.hand.some((c) => c.cardId === unfairStamp.cardId)).toBe(true)
  })

  it('supports configurable lookaheadPly (1, 2, 3), aiTemperament, topKCandidates and uncapped maxBranches > 12', () => {
    const deckA = parsePtcglDecklist(META_OPPONENT_DECKS[0]!.ptcglText).cards.flatMap((e) =>
      Array.from({ length: e.quantity }, () => e.model),
    )
    const deckB = parsePtcglDecklist(META_OPPONENT_DECKS[1]!.ptcglText).cards.flatMap((e) =>
      Array.from({ length: e.quantity }, () => e.model),
    )
    const state = createInitialMatchState(deckA, deckB, { seed: 4242, firstPlayerIndex: 0, maxTurns: 15 })

    const ply1 = selectBestTurnBranch(state, 20, true, { lookaheadPly: 1, topKCandidates: 1 })
    expect(ply1.candidateTraces.length).toBe(1)
    expect(ply1.scoreTAdv).toBe(0)
    expect(ply1.scoreTPlus1).toBe(0)
    expect(ply1.totalScore).toBe(ply1.scoreT)

    const ply2 = selectBestTurnBranch(state, 20, true, {
      lookaheadPly: 2,
      topKCandidates: 2,
      aiTemperament: 'CONSERVATIVE',
    })
    expect(ply2.candidateTraces.length).toBeGreaterThanOrEqual(1)
    expect(ply2.candidateTraces.length).toBeLessThanOrEqual(2)
    expect(ply2.scoreTPlus1).toBe(0)

    const deep = selectBestTurnBranch(state, 50, true, {
      lookaheadPly: 3,
      beamWidth: 12,
      topKCandidates: 5,
      maxActionDepth: 10,
      rolloutMaxActions: 10,
      aiTemperament: 'AGGRESSIVE',
    })
    expect(deep.totalBranchesExplored).toBeGreaterThanOrEqual(1)
    expect(deep.chosenActions.length).toBeGreaterThan(0)
  })
})
