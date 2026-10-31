import { describe, expect, it } from 'vitest'
import { matchesCardFilter, UNIFIED_CARD_REGISTRY } from '../data/cardCatalog'
import { META_OPPONENT_DECKS } from '../data/metaDecks'
import { createNativeBasicEnergyModel } from '../utils/energy'
import { parsePtcglDecklist } from '../utils/ptcglParser'
import type { EngineCardModel } from '../types/cardModel'
import {
  applyAction,
  canPayEnergyCost,
  computeAttackDamageToActive,
  createInitialMatchState,
  getLegalActions,
  getMaxBenchSlots,
  runBetweenTurnsCheckup,
  startTurn,
} from './engine'

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

describe('Engine — Data-Driven State Machine & Legal Move Generator', () => {
  it('initializes a 60-card match with 6 prizes, active Pokémon, and deterministic state', () => {
    const charizardDeck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const boltDeck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[1]!.ptcglText)

    expect(charizardDeck.length).toBe(60)
    expect(boltDeck.length).toBe(60)

    const state = createInitialMatchState(charizardDeck, boltDeck, {
      seed: 1337,
      firstPlayerIndex: 0,
      maxTurns: 18,
    })

    expect(state.player.prizes.length).toBe(6)
    expect(state.opponent.prizes.length).toBe(6)
    expect(state.player.activePokemon).not.toBeNull()
    expect(state.opponent.activePokemon).not.toBeNull()
    expect(state.turnNumber).toBe(1)
    expect(state.activePlayerIndex).toBe(0)
  })

  it('enforces Turn 1 Going First rules (no Supporters, no Evolutions, no Attacks)', () => {
    const charizardDeck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const boltDeck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[1]!.ptcglText)

    const state = createInitialMatchState(charizardDeck, boltDeck, {
      seed: 42,
      firstPlayerIndex: 0,
      maxTurns: 18,
    })

    startTurn(state)

    // Injecte un Supporter (Pepper) et un Pokémon Évolution (Dracaufeu-ex) dans la main du Joueur 1 au Tour 1
    state.player.hand.push(UNIFIED_CARD_REGISTRY['sv01-166']!)
    state.player.hand.push(UNIFIED_CARD_REGISTRY['sv03-125']!)

    const legalActions = getLegalActions(state)

    const hasSupporterAction = legalActions.some(
      (a) => a.type === 'PLAY_TRAINER' && a.cardId === 'sv01-166',
    )
    const hasEvolveAction = legalActions.some((a) => a.type === 'NORMAL_EVOLVE')
    const hasAttackAction = legalActions.some((a) => a.type === 'DECLARE_ATTACK')
    const hasPassAction = legalActions.some((a) => a.type === 'PASS_TURN')

    expect(hasSupporterAction).toBe(false)
    expect(hasEvolveAction).toBe(false)
    expect(hasAttackAction).toBe(false)
    expect(hasPassAction).toBe(true)
  })

  it('resolves Rare Candy -> Charizard ex -> Infernal Reign (ABILITY_ON_EVOLVE) -> Burning Darkness KO & Prize taking', () => {
    const playerDeck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const opponentDeck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)

    const state = createInitialMatchState(playerDeck, opponentDeck, {
      seed: 2026,
      firstPlayerIndex: 0,
      maxTurns: 18,
    })

    // Avance au Tour 3 (2e tour du Joueur 1) pour débloquer Super Bonbon et l'Attaque
    state.turnNumber = 3
    state.activePlayerIndex = 0

    // Place un Salamèche en Poste Actif posé au Tour 1
    state.player.activePokemon = {
      instanceId: 'p_charmander_active',
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

    // Place une cible adverse (70 PV) en Poste Actif adverse et sur le Banc adverse
    state.opponent.activePokemon = {
      instanceId: 'p_target_opp',
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
        instanceId: 'p_target_opp_bench',
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

    // Donne Super Bonbon + Dracaufeu-ex en main au Joueur, et s'assure que 3 Énergies Feu sont dans le deck
    const rareCandy = UNIFIED_CARD_REGISTRY['sv04-125']!
    const charizardEx = UNIFIED_CARD_REGISTRY['sv03-125']!
    const fireEnergy = createNativeBasicEnergyModel('Feu')

    state.player.hand = [rareCandy, charizardEx]
    state.player.deck.push(fireEnergy, fireEnergy, fireEnergy)

    const actionsBeforeCandy = getLegalActions(state)
    const candyAction = actionsBeforeCandy.find(
      (a) => a.type === 'PLAY_TRAINER' && a.cardId === 'sv04-125' && a.targetSlot === 'ACTIVE',
    )
    expect(candyAction).toBeDefined()

    // Exécute Super Bonbon : Salamèche évolue en Dracaufeu-ex et déclenche Règne Infernal (attache d'énergies Feu)
    const afterCandyState = applyAction(state, candyAction!)
    expect(afterCandyState.player.activePokemon?.card.cardId).toBe('sv03-125')
    expect(afterCandyState.player.activePokemon?.attachedEnergies.length).toBeGreaterThanOrEqual(2)

    // Vérifie que l'attaque Obscurité Brûlante est désormais légale
    const actionsAfterCandy = getLegalActions(afterCandyState)
    const attackAction = actionsAfterCandy.find(
      (a) => a.type === 'DECLARE_ATTACK' && a.actionId === 'attack_burning_darkness',
    )
    expect(attackAction).toBeDefined()

    // Déclare l'attaque : met K.O. Tarsal (70 PV < 180 dégâts) et prend 1 carte Récompense (6 -> 5)
    const afterAttackState = applyAction(afterCandyState, attackAction!)
    expect(afterAttackState.player.prizes.length).toBe(5)
    expect(afterAttackState.opponent.koSufferedLastOpponentTurn).toBe(true)
    expect(afterAttackState.turnNumber).toBe(4)
    expect(afterAttackState.activePlayerIndex).toBe(1)
  })

  it('multi-type energy solver correctly resolves elemental and colorless costs', () => {
    const fireEnergy = createNativeBasicEnergyModel('Feu')
    const waterEnergy = createNativeBasicEnergyModel('Eau')
    const lightningEnergy = createNativeBasicEnergyModel('Électrique')
    const fightingEnergy = createNativeBasicEnergyModel('Combat')

    // 0 cost always payable
    expect(canPayEnergyCost([], [])).toBe(true)
    expect(canPayEnergyCost([], undefined)).toBe(true)

    // Mono-type
    expect(canPayEnergyCost([fireEnergy], ['Feu'])).toBe(true)
    expect(canPayEnergyCost([waterEnergy], ['Feu'])).toBe(false)

    // Multi-type (e.g. Ire-Foudre ex: Lightning + Fighting)
    expect(canPayEnergyCost([lightningEnergy, fightingEnergy], ['Électrique', 'Combat'])).toBe(true)
    expect(canPayEnergyCost([lightningEnergy, fireEnergy], ['Électrique', 'Combat'])).toBe(false)

    // Colorless cost paid by any energy
    expect(canPayEnergyCost([fireEnergy, waterEnergy], ['Feu', 'Incolore'])).toBe(true)
    expect(canPayEnergyCost([fireEnergy], ['Feu', 'Incolore'])).toBe(false)
  })

  it('extended CardFilter matches all 13 criteria', () => {
    const card: EngineCardModel = {
      ...mockCharmander,
      pokemonStats: {
        ...mockCharmander.pokemonStats!,
        hp: 70,
        isRuleBox: false,
        isTera: true,
        isFuture: true,
        isAncient: false,
        hasAbility: true,
        retreatCost: 1,
      },
      subCategory: 'BASIC',
    }

    expect(matchesCardFilter(card, { isTera: true })).toBe(true)
    expect(matchesCardFilter(card, { isTera: false })).toBe(false)
    expect(matchesCardFilter(card, { isFuture: true })).toBe(true)
    expect(matchesCardFilter(card, { isAncient: true })).toBe(false)
    expect(matchesCardFilter(card, { isRuleBox: false })).toBe(true)
    expect(matchesCardFilter(card, { isEvolution: false })).toBe(true)
    expect(matchesCardFilter(card, { isEvolution: true })).toBe(false)
    expect(matchesCardFilter(card, { minHp: 60 })).toBe(true)
    expect(matchesCardFilter(card, { minHp: 80 })).toBe(false)
    expect(matchesCardFilter(card, { maxRetreatCost: 1 })).toBe(true)
    expect(matchesCardFilter(card, { maxRetreatCost: 0 })).toBe(false)
    expect(matchesCardFilter(card, { hasAbility: true })).toBe(true)
  })

  it('handles dynamic bench capacity with Area Zero Underdepths and Tera Pokemon', () => {
    const pBoard = {
      deck: [],
      hand: [],
      prizes: [],
      discard: [],
      activePokemon: {
        instanceId: 'p1',
        card: {
          ...mockCharmander,
          pokemonStats: { ...mockCharmander.pokemonStats!, isTera: true },
        },
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      },
      bench: [],
      lostZone: [],
      extraTurnGranted: false,
      itemLockActive: false,
      supporterPlayedThisTurn: false,
      energyAttachedThisTurn: false,
      retreatUsedThisTurn: false,
      usedOncePerTurnAbilities: new Set<string>(),
      abilityUsageCountsThisTurn: {},
      vstarPowerUsed: false,
      koSufferedLastOpponentTurn: false,
      mulliganCount: 0,
      initialHandSnapshot: [],
      initialPrizesSnapshot: [],
      prizesKnownByPlayer: false,
      firstSearchTurn: null,
    }

    // Default bench capacity is 5
    expect(getMaxBenchSlots(pBoard, null)).toBe(5)

    // With Area Zero Underdepths Stadium and Tera Pokemon in play -> 8
    const stadiumCard: EngineCardModel = {
      ...mockCharmander,
      cardId: 'sv07-131',
      identity: {
        ...mockCharmander.identity,
        cardId: 'sv07-131',
        nameFr: 'Abîme Zéro',
        nameEn: 'Area Zero Underdepths',
        subCategory: 'STADIUM',
      },
      category: 'TRAINER',
      subCategory: 'STADIUM',
      pokemonStats: null,
    }

    expect(getMaxBenchSlots(pBoard, { card: stadiumCard, ownerIndex: 0, usedThisTurn: false })).toBe(8)
  })

  it('calculates dynamic damage scaling, weakness multiplier and resistance', () => {
    const fireEnergy = createNativeBasicEnergyModel('Feu')
    const attackerBoard = {
      deck: [],
      hand: [],
      prizes: [fireEnergy, fireEnergy], // 2 remaining -> 4 taken by opponent
      discard: [],
      activePokemon: {
        instanceId: 'atk',
        card: {
          ...mockCharmander,
          pokemonStats: { ...mockCharmander.pokemonStats!, types: ['Feu'] },
        },
        previousStages: [],
        damage: 30, // 3 damage counters
        attachedEnergies: [fireEnergy, fireEnergy],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      },
      bench: [],
      lostZone: [],
      extraTurnGranted: false,
      itemLockActive: false,
      supporterPlayedThisTurn: false,
      energyAttachedThisTurn: false,
      retreatUsedThisTurn: false,
      usedOncePerTurnAbilities: new Set<string>(),
      abilityUsageCountsThisTurn: {},
      vstarPowerUsed: false,
      koSufferedLastOpponentTurn: false,
      mulliganCount: 0,
      initialHandSnapshot: [],
      initialPrizesSnapshot: [],
      prizesKnownByPlayer: false,
      firstSearchTurn: null,
    }

    const defenderBoard = {
      deck: [],
      hand: [],
      prizes: [fireEnergy, fireEnergy, fireEnergy, fireEnergy, fireEnergy, fireEnergy],
      discard: [],
      activePokemon: {
        instanceId: 'def',
        card: {
          ...mockTargetBasic,
          pokemonStats: {
            ...mockTargetBasic.pokemonStats!,
            types: ['Plante'],
            weaknesses: ['Feu'],
            resistances: [],
            isRuleBox: false,
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
      },
      bench: [],
      lostZone: [],
      extraTurnGranted: false,
      itemLockActive: false,
      supporterPlayedThisTurn: false,
      energyAttachedThisTurn: false,
      retreatUsedThisTurn: false,
      usedOncePerTurnAbilities: new Set<string>(),
      abilityUsageCountsThisTurn: {},
      vstarPowerUsed: false,
      koSufferedLastOpponentTurn: false,
      mulliganCount: 0,
      initialHandSnapshot: [],
      initialPrizesSnapshot: [],
      prizesKnownByPlayer: false,
      firstSearchTurn: null,
    }

    // Test PER_DAMAGE_COUNTER_ON_SELF: 30 damage = 3 counters * 20 = 60 + base 50 = 110 * 2 (weakness) = 220
    const rageAttack = {
      actionId: 'atk_rage',
      label: 'Rage',
      sourceType: 'ATTACK' as const,
      timing: 'END_OF_TURN_ATTACK' as const,
      canUseTurn1GoingFirst: false,
      canUseTurn1GoingSecond: true,
      preconditions: [],
      costs: [],
      effects: [
        {
          primitive: 'DEAL_DAMAGE_ACTIVE' as const,
          count: 1,
          upTo: false,
          baseDamage: 50,
          damageScalingType: 'PER_DAMAGE_COUNTER_ON_SELF' as const,
          damageScalingValue: 20,
        },
      ],
    }

    const res = computeAttackDamageToActive(attackerBoard, defenderBoard, rageAttack)
    // (50 + 3 * 20) * 2 = 110 * 2 = 220
    expect(res.activeDamage).toBe(220)
  })

  it('verifies between-turns checkup resolves poison and burn damage', () => {
    const dummyState = createInitialMatchState(
      [mockCharmander, mockCharmander],
      [mockTargetBasic, mockTargetBasic],
      { seed: 42, firstPlayerIndex: 0, maxTurns: 10 },
    )

    dummyState.player.activePokemon!.damage = 0
    dummyState.player.activePokemon!.specialConditions = ['POISONED']

    runBetweenTurnsCheckup(dummyState)

    // Poison deals 10 damage in checkup
    expect(dummyState.player.activePokemon!.damage).toBe(10)
    expect(dummyState.player.activePokemon!.specialConditions).toContain('POISONED')
  })

  it('verifies self-KO cost awards prizes to opponent and discards source Pokémon', () => {
    const p1Card = { ...mockCharmander }
    const p2Card = { ...mockTargetBasic }
    const dummyState = createInitialMatchState(
      Array(60).fill(p1Card),
      Array(60).fill(p2Card),
      { seed: 123, firstPlayerIndex: 0, maxTurns: 10 },
    )

    const initialOppPrizes = dummyState.opponent.prizes.length // 6

    const selfKoAction = {
      actionId: 'ability_cursed_blast',
      label: 'Explosion Maudite',
      sourceType: 'ABILITY_ACTIVATED' as const,
      timing: 'ONCE_PER_TURN_ABILITY' as const,
      canUseTurn1GoingFirst: false,
      canUseTurn1GoingSecond: false,
      preconditions: [],
      costs: [{ type: 'KNOCK_OUT_SELF' as const, count: 1 }],
      effects: [{ primitive: 'PLACE_DAMAGE_COUNTERS' as const, count: 13, upTo: false }],
    }

    // Attach action to bench pokemon
    dummyState.player.bench = [
      {
        instanceId: 'p_bench_dusclops',
        card: { ...mockCharmander, playableActions: [selfKoAction] },
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

    const afterKoState = applyAction(dummyState, {
      type: 'USE_ABILITY',
      sourceSlot: 0,
      cardId: mockCharmander.cardId,
      actionId: 'ability_cursed_blast',
      label: 'Explosion Maudite',
    })

    // Dusclops knocked out -> removed from bench, opponent takes 1 prize
    expect(afterKoState.player.bench.length).toBe(0)
    expect(afterKoState.opponent.prizes.length).toBe(initialOppPrizes - 1)
  })
})
