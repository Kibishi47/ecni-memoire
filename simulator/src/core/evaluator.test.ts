import { describe, expect, it } from 'vitest'
import { UNIFIED_CARD_REGISTRY } from '../data/cardCatalog'
import { META_OPPONENT_DECKS } from '../data/metaDecks'
import { createNativeBasicEnergyModel } from '../utils/energy'
import { parsePtcglDecklist } from '../utils/ptcglParser'
import type { EngineCardModel } from '../types/cardModel'
import { applyAction, createInitialMatchState, isCardDeadInHand } from './engine'
import { evaluateState, getStateHash, selectBestTurnBranch } from './evaluator'

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
          sourceType: 'ATTACK',
          timing: 'END_OF_TURN_ATTACK',
          canUseTurn1GoingFirst: false,
          canUseTurn1GoingSecond: true,
          preconditions: [{ type: 'SELF_HAS_ENERGY_COST', minCount: 1 }],
          costs: [],
          effects: [{ primitive: 'DEAL_DAMAGE_ACTIVE', count: 1, upTo: false, baseDamage: 60 }],
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
          sourceType: 'TRAINER_PLAY',
          timing: 'ONCE_PER_TURN_SUPPORTER',
          canUseTurn1GoingFirst: false,
          canUseTurn1GoingSecond: true,
          preconditions: [{ type: 'HAND_MAX_OTHER_CARDS_ZERO', minCount: 0 }],
          costs: [],
          effects: [{ primitive: 'PASSIVE_DAMAGE_BOOST', count: 6, upTo: false, baseDamage: 60 }],
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
})
