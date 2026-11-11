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
  getEffectiveAttackCost,
  getLegalActions,
  getMaxBenchSlots,
  getPokemonMaxHp,
  getPokemonRetreatCost,
  isCardDeadInHand,
  isPokemonAttackBlocked,
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
      (a) =>
        a.type === 'DECLARE_ATTACK' &&
        (a.actionId === 'attack_burning_darkness' ||
          a.actionId === 'attack_0' ||
          /obscurité brûlante/i.test(a.label)),
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
            weaknesses: [{ type: 'Feu', value: '×2' }],
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
      actionType: 'ATTACK' as const,
      timingPhase: 'ATTACK_PHASE' as const,
      cost: {},
      sourceType: 'ATTACK' as const,
      timing: 'END_OF_TURN_ATTACK' as const,
      canUseTurn1GoingFirst: false,
      canUseTurn1GoingSecond: true,
      preconditions: [],
      costs: [],
      effects: [
        {
          primitive: 'DAMAGE_ACTIVE' as const,
          count: 1,
          upTo: false,
          baseDamage: 50,
          value: 50,
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
      actionType: 'USE_ABILITY' as const,
      timingPhase: 'MAIN_PHASE_1' as const,
      cost: {},
      sourceType: 'ABILITY_ACTIVATED' as const,
      timing: 'ONCE_PER_TURN_ABILITY' as const,
      canUseTurn1GoingFirst: false,
      canUseTurn1GoingSecond: false,
      preconditions: [],
      costs: [{ type: 'KNOCK_OUT_SELF' as const, count: 1 }],
      effects: [{ primitive: 'DAMAGE_BENCH' as const, count: 13, upTo: false }],
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

  it('executes double attack (Fête Battante / Festival Lead) when a Stadium is in play', () => {
    const grassEnergy = createNativeBasicEnergyModel('Plante')
    const dipplinCard: EngineCardModel = {
      ...mockCharmander,
      cardId: 'twm-018',
      identity: {
        ...mockCharmander.identity,
        cardId: 'twm-018',
        nameFr: 'Pomdramour',
        nameEn: 'Dipplin',
        rawRulesText: ['Talent : Fête Battante - Si Terrain de la Fête est en jeu, ce Pokémon peut utiliser une attaque une deuxième fois.'],
      },
      pokemonStats: {
        ...mockCharmander.pokemonStats!,
        hp: 80,
        types: ['Plante'],
        canAttackTwice: true,
      },
      playableActions: [
        {
          actionId: 'ability_festival_lead',
          label: 'Fête Battante',
          actionType: 'USE_ABILITY' as const,
          timingPhase: 'MAIN_PHASE_1' as const,
          cost: {},
          sourceType: 'ABILITY_PASSIVE',
          timing: 'PASSIVE_CONTINUOUS',
          canUseTurn1GoingFirst: true,
          canUseTurn1GoingSecond: true,
          preconditions: [],
          costs: [],
          effects: [],
          canAttackTwice: true,
        },
        {
          actionId: 'atk_do_the_wave',
          label: 'Ronde Festive',
          actionType: 'ATTACK' as const,
          timingPhase: 'ATTACK_PHASE' as const,
          cost: {},
          sourceType: 'ATTACK',
          timing: 'END_OF_TURN_ATTACK',
          canUseTurn1GoingFirst: false,
          canUseTurn1GoingSecond: true,
          preconditions: [],
          costs: [],
          effects: [{ primitive: 'DAMAGE_ACTIVE' as const, count: 1, upTo: false, baseDamage: 100 }],
        },
      ],
    }

    const festivalGrounds: EngineCardModel = {
      ...mockCharmander,
      cardId: 'twm-149',
      category: 'TRAINER',
      subCategory: 'STADIUM',
      identity: {
        ...mockCharmander.identity,
        cardId: 'twm-149',
        nameFr: 'Terrain de la Fête',
        category: 'TRAINER',
        subCategory: 'STADIUM',
      },
    }

    const dummyState = createInitialMatchState(
      Array(60).fill(dipplinCard),
      Array(60).fill(mockTargetBasic),
      { seed: 77, firstPlayerIndex: 0, maxTurns: 10 },
    )
    dummyState.turnNumber = 2
    dummyState.activeStadium = { card: festivalGrounds, ownerIndex: 0, usedThisTurn: false }
    dummyState.player.activePokemon = {
      instanceId: 'dipplin_active',
      card: dipplinCard,
      previousStages: [],
      damage: 0,
      attachedEnergies: [grassEnergy],
      attachedTools: [],
      turnPlayed: 1,
      evolvedThisTurn: false,
      specialConditions: [],
      cantAttackNextTurn: false,
    }
    // Opponent has 70 HP Active + 70 HP Bench -> 2 hits of 100 damage should KO BOTH and take 2 prizes!
    dummyState.opponent.activePokemon = {
      instanceId: 'opp_active_1',
      card: mockTargetBasic,
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 1,
      evolvedThisTurn: false,
      specialConditions: [],
      cantAttackNextTurn: false,
    }
    dummyState.opponent.bench = [
      {
        instanceId: 'opp_bench_1',
        card: mockTargetBasic,
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      },
      {
        instanceId: 'opp_bench_2',
        card: mockTargetBasic,
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

    const afterAttack = applyAction(dummyState, {
      type: 'DECLARE_ATTACK',
      cardId: dipplinCard.cardId,
      actionId: 'atk_do_the_wave',
      label: 'Ronde Festive',
      endsTurnImmediately: true,
    })

    // Player took 2 prizes in a single turn thanks to Festival Lead double attack!
    expect(afterAttack.player.prizes.length).toBe(4)
    expect(afterAttack.opponent.bench.length).toBe(0)
  })

  it('maintains Item-Lock (Pollen Démangeant / Budew) across the opponent turn and blocks ITEM play', () => {
    const budewCard: EngineCardModel = {
      ...mockCharmander,
      cardId: 'pre-004',
      identity: {
        ...mockCharmander.identity,
        cardId: 'pre-004',
        nameFr: 'Rozbouton',
        nameEn: 'Budew',
      },
      pokemonStats: {
        ...mockCharmander.pokemonStats!,
        hp: 30,
        retreatCost: 0,
      },
      playableActions: [
        {
          actionId: 'atk_itchy_pollen',
          label: 'Pollen Démangeant',
          actionType: 'ATTACK' as const,
          timingPhase: 'ATTACK_PHASE' as const,
          cost: {},
          sourceType: 'ATTACK',
          timing: 'END_OF_TURN_ATTACK',
          canUseTurn1GoingFirst: false,
          canUseTurn1GoingSecond: true,
          preconditions: [],
          costs: [],
          effects: [
            { primitive: 'DAMAGE_ACTIVE' as const, count: 1, upTo: false, baseDamage: 10 },
            { primitive: 'APPLY_SPECIAL_CONDITION' as const, count: 1, upTo: false },
          ],
          energyCost: [],
        },
      ],
    }

    const dummyState = createInitialMatchState(
      Array(60).fill(budewCard),
      Array(60).fill(mockTargetBasic),
      { seed: 88, firstPlayerIndex: 1, maxTurns: 10 },
    )
    // Player (index 0) is Going Second on Turn 2
    dummyState.turnNumber = 2
    dummyState.activePlayerIndex = 0
    dummyState.player.activePokemon = {
      instanceId: 'budew_1',
      card: budewCard,
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 2,
      evolvedThisTurn: false,
      specialConditions: [],
      cantAttackNextTurn: false,
    }

    const afterBudewAtk = applyAction(dummyState, {
      type: 'DECLARE_ATTACK',
      cardId: budewCard.cardId,
      actionId: 'atk_itchy_pollen',
      label: 'Pollen Démangeant',
      endsTurnImmediately: true,
    })

    // Now it is Opponent's turn (Turn 3, activePlayerIndex = 1)
    expect(afterBudewAtk.activePlayerIndex).toBe(1)
    expect(afterBudewAtk.opponent.itemLockActive).toBe(true)

    startTurn(afterBudewAtk)
    // Item lock must still be active during opponent's turn!
    expect(afterBudewAtk.opponent.itemLockActive).toBe(true)
    const oppActions = getLegalActions(afterBudewAtk)
    expect(oppActions.some((a) => a.type === 'PLAY_TRAINER')).toBe(false)
  })

  describe('Strict Attack Energy Costs and Attack Lock Validation', () => {
    const fireEnergy = createNativeBasicEnergyModel('Feu')
    const waterEnergy = createNativeBasicEnergyModel('Eau')
    const grassEnergy = createNativeBasicEnergyModel('Plante')

    const doubleTurboEnergy: EngineCardModel = {
      cardId: 'sv01-181',
      identity: {
        cardId: 'sv01-181',
        nameFr: 'Énergie Double Turbo',
        nameEn: 'Double Turbo Energy',
        setId: 'sv01',
        setName: 'Écarlate et Violet',
        localId: '181',
        category: 'ENERGY',
        subCategory: 'SPECIAL_ENERGY',
        isRuleBox: false,
        prizeCardsGiven: 0,
        isAceSpec: false,
        isAncient: false,
        isFuture: false,
        isTera: false,
        regulationMark: 'G',
        legalStandard: true,
        legalExpanded: true,
        rarity: 'Peu Commune',
        imageUrl: null,
        rawRulesText: [],
      },
      category: 'ENERGY',
      subCategory: 'SPECIAL_ENERGY',
      pokemonStats: null,
      playableActions: [],
      strategicEvaluator: {
        aiRole: 'ENERGY_ACCELERATOR',
        primaryRole: 'ENERGY_ACCELERATOR',
        intrinsicBaseScore: 50,
        turnPhaseWeights: { turn1: 1, turn2: 1, turn3: 1, turn4Plus: 1 },
        decklistSynergyRequirements: [],
        inGameDeadCardConditions: [],
        discardPriorityWhenDead: 50,
        holdForNextTurnBonus: 10,
      },
    }

    it('validates canPayEnergyCost with colored, colorless, and double turbo energies', () => {
      // 0 energy cannot pay colored cost
      expect(canPayEnergyCost([], { Feu: 1 })).toBe(false)

      // 1 Fire cannot pay 1 Fire + 1 Colorless
      expect(canPayEnergyCost([fireEnergy], { Feu: 1, Incolore: 1 })).toBe(false)

      // Any energy satisfies Colorless requirement (e.g. 1 Fire + 1 Water for { Feu: 1, Incolore: 1 })
      expect(canPayEnergyCost([fireEnergy, waterEnergy], { Feu: 1, Incolore: 1 })).toBe(true)

      // 1 Grass satisfies 1 Colorless requirement
      expect(canPayEnergyCost([grassEnergy], { Incolore: 1 })).toBe(true)

      // Double Turbo provides 2 Colorless
      expect(canPayEnergyCost([doubleTurboEnergy], { Incolore: 2 })).toBe(true)
      expect(canPayEnergyCost([doubleTurboEnergy, fireEnergy], { Feu: 1, Incolore: 2 })).toBe(true)

      // Double Turbo cannot pay colored costs
      expect(canPayEnergyCost([doubleTurboEnergy], { Feu: 1 })).toBe(false)

      // 0 cost is payable with 0 energy
      expect(canPayEnergyCost([], {})).toBe(true)
    })

    it('blocks attacks when active Pokemon lacks energy and allows attack once paid', () => {
      const attackerCard: EngineCardModel = {
        ...mockCharmander,
        cardId: 'test-attacker-1',
        playableActions: [
          {
            actionId: 'atk_flamethrower',
            label: 'Lance-Flammes',
            actionType: 'ATTACK',
            timingPhase: 'ATTACK_PHASE',
            cost: { Feu: 1, Incolore: 1 },
            sourceType: 'ATTACK',
            timing: 'END_OF_TURN_ATTACK',
            canUseTurn1GoingFirst: false,
            canUseTurn1GoingSecond: true,
            preconditions: ['SELF_IS_ACTIVE'],
            costs: [],
            effects: [{ primitive: 'DAMAGE_ACTIVE', count: 1, upTo: false, baseDamage: 50 }],
            energyCost: ['Feu', 'Incolore'],
          },
        ],
      }

      const match = createInitialMatchState(
        Array(60).fill(attackerCard),
        Array(60).fill(mockTargetBasic),
        { seed: 100, firstPlayerIndex: 0, maxTurns: 10 },
      )
      // Turn 2: player turn (going first player's turn 2 = match turn 3, or turn 2 going second)
      match.turnNumber = 2
      match.activePlayerIndex = 0
      match.player.activePokemon = {
        instanceId: 'char_1',
        card: attackerCard,
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      }
      match.opponent.activePokemon = {
        instanceId: 'target_1',
        card: mockTargetBasic,
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      }

      // 1. With 0 energy, DECLARE_ATTACK is not available
      let actions = getLegalActions(match)
      expect(actions.some((a) => a.type === 'DECLARE_ATTACK')).toBe(false)

      // 2. With only 1 Fire energy, DECLARE_ATTACK is still not available (needs 1 Fire + 1 Colorless)
      match.player.activePokemon.attachedEnergies = [fireEnergy]
      actions = getLegalActions(match)
      expect(actions.some((a) => a.type === 'DECLARE_ATTACK')).toBe(false)

      // 3. With 1 Fire + 1 Water (Water fulfills Colorless), DECLARE_ATTACK is legal
      match.player.activePokemon.attachedEnergies = [fireEnergy, waterEnergy]
      actions = getLegalActions(match)
      const attackAction = actions.find((a) => a.type === 'DECLARE_ATTACK')
      expect(attackAction).toBeDefined()

      // 4. Declaring attack deals 50 damage
      const stateAfterAttack = applyAction(match, attackAction!)
      expect(stateAfterAttack.opponent.activePokemon?.damage).toBe(50)
    })

    it('allows 0-cost attack (e.g. Rozbouton Pollen Demangeant) with zero attached energies', () => {
      const freeAttackerCard: EngineCardModel = {
        ...mockCharmander,
        cardId: 'test-free-attacker',
        playableActions: [
          {
            actionId: 'atk_free',
            label: 'Pollen Démangeant',
            actionType: 'ATTACK',
            timingPhase: 'ATTACK_PHASE',
            cost: {},
            sourceType: 'ATTACK',
            timing: 'END_OF_TURN_ATTACK',
            canUseTurn1GoingFirst: false,
            canUseTurn1GoingSecond: true,
            preconditions: ['SELF_IS_ACTIVE'],
            costs: [],
            effects: [{ primitive: 'DAMAGE_ACTIVE', count: 1, upTo: false, baseDamage: 10 }],
            energyCost: [],
          },
        ],
      }

      const match = createInitialMatchState(
        Array(60).fill(freeAttackerCard),
        Array(60).fill(mockTargetBasic),
        { seed: 101, firstPlayerIndex: 0, maxTurns: 10 },
      )
      match.turnNumber = 2
      match.activePlayerIndex = 0
      match.player.activePokemon = {
        instanceId: 'free_1',
        card: freeAttackerCard,
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      }

      const actions = getLegalActions(match)
      const freeAtk = actions.find((a) => a.type === 'DECLARE_ATTACK')
      expect(freeAtk).toBeDefined()
    })

    it('strictly blocks attack when Pokemon is Asleep or Paralyzed', () => {
      const attackerCard: EngineCardModel = {
        ...mockCharmander,
        cardId: 'test-attacker-status',
        playableActions: [
          {
            actionId: 'atk_strike',
            label: 'Frappe',
            actionType: 'ATTACK',
            timingPhase: 'ATTACK_PHASE',
            cost: { Feu: 1 },
            sourceType: 'ATTACK',
            timing: 'END_OF_TURN_ATTACK',
            canUseTurn1GoingFirst: false,
            canUseTurn1GoingSecond: true,
            preconditions: ['SELF_IS_ACTIVE'],
            costs: [],
            effects: [{ primitive: 'DAMAGE_ACTIVE', count: 1, upTo: false, baseDamage: 30 }],
            energyCost: ['Feu'],
          },
        ],
      }

      const match = createInitialMatchState(
        Array(60).fill(attackerCard),
        Array(60).fill(mockTargetBasic),
        { seed: 102, firstPlayerIndex: 0, maxTurns: 10 },
      )
      match.turnNumber = 2
      match.activePlayerIndex = 0
      match.player.activePokemon = {
        instanceId: 'status_1',
        card: attackerCard,
        previousStages: [],
        damage: 0,
        attachedEnergies: [fireEnergy, fireEnergy],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: ['ASLEEP'],
        cantAttackNextTurn: false,
      }

      expect(isPokemonAttackBlocked(match.player.activePokemon, match)).toBe(true)
      let actions = getLegalActions(match)
      expect(actions.some((a) => a.type === 'DECLARE_ATTACK')).toBe(false)

      // Test PARALYZED
      match.player.activePokemon.specialConditions = ['PARALYZED']
      expect(isPokemonAttackBlocked(match.player.activePokemon, match)).toBe(true)
      actions = getLegalActions(match)
      expect(actions.some((a) => a.type === 'DECLARE_ATTACK')).toBe(false)
    })

    it('enforces cantAttackNextTurn on subsequent turn and clears on retreat', () => {
      const gigaImpactCard: EngineCardModel = {
        ...mockCharmander,
        cardId: 'test-giga-impact',
        playableActions: [
          {
            actionId: 'atk_giga',
            label: 'Giga Impact',
            actionType: 'ATTACK',
            timingPhase: 'ATTACK_PHASE',
            cost: { Feu: 1 },
            sourceType: 'ATTACK',
            timing: 'END_OF_TURN_ATTACK',
            canUseTurn1GoingFirst: false,
            canUseTurn1GoingSecond: true,
            preconditions: ['SELF_IS_ACTIVE'],
            costs: [{ type: 'CANT_ATTACK_NEXT_TURN' }],
            effects: [
              { primitive: 'DAMAGE_ACTIVE', count: 1, upTo: false, baseDamage: 120 },
            ],
            energyCost: ['Feu'],
          },
        ],
      }

      const match = createInitialMatchState(
        Array(60).fill(gigaImpactCard),
        Array(60).fill(mockTargetBasic),
        { seed: 103, firstPlayerIndex: 0, maxTurns: 10 },
      )
      match.turnNumber = 2
      match.activePlayerIndex = 0
      match.player.activePokemon = {
        instanceId: 'giga_1',
        card: gigaImpactCard,
        previousStages: [],
        damage: 0,
        attachedEnergies: [fireEnergy, fireEnergy],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      }

      // Apply attack: sets cantAttackNextTurn = true and cantAttackTurn = turnNumber + 2 (turn 4)
      const afterAtk = applyAction(match, {
        type: 'DECLARE_ATTACK',
        cardId: gigaImpactCard.cardId,
        actionId: 'atk_giga',
        label: 'Giga Impact',
        endsTurnImmediately: true,
      })

      const attackerPoke = afterAtk.player.activePokemon!
      expect(attackerPoke.cantAttackNextTurn).toBe(true)
      expect(attackerPoke.cantAttackTurn).toBe(4)

      // Fast forward to turn 4 (Player turn)
      afterAtk.turnNumber = 4
      afterAtk.activePlayerIndex = 0
      expect(isPokemonAttackBlocked(attackerPoke, afterAtk)).toBe(true)
      const turn4Actions = getLegalActions(afterAtk)
      expect(turn4Actions.some((a) => a.type === 'DECLARE_ATTACK')).toBe(false)

      // If switched or retreated to bench, lock is immediately reset
      afterAtk.player.bench = [
        {
          instanceId: 'benched_1',
          card: mockTargetBasic,
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
      const afterRetreat = applyAction(afterAtk, {
        type: 'RETREAT_ACTIVE',
        label: 'Retraite vers Banc 0',
        targetBenchIndex: 0,
      })
      // Old active is now on bench, lock cleared
      const nowBenched = afterRetreat.player.bench[0]!
      expect(nowBenched.cantAttackNextTurn).toBe(false)
      expect(nowBenched.cantAttackTurn).toBeUndefined()
    })

    it('handles Bloodmoon Ursaluna ex ability cost reduction based on opponent prizes taken', () => {
      const bloodmoonCard: EngineCardModel = {
        ...mockCharmander,
        cardId: 'sv06-141',
        identity: {
          ...mockCharmander.identity,
          cardId: 'sv06-141',
          nameFr: 'Ursaking Lune Vermeille-ex',
          nameEn: 'Bloodmoon Ursaluna ex',
        },
        pokemonStats: {
          ...mockCharmander.pokemonStats!,
        },
        playableActions: [
          {
            actionId: 'atk_bloodmoon',
            label: 'Lune Rouge',
            actionType: 'ATTACK',
            timingPhase: 'ATTACK_PHASE',
            cost: { Incolore: 5 },
            sourceType: 'ATTACK',
            timing: 'END_OF_TURN_ATTACK',
            canUseTurn1GoingFirst: false,
            canUseTurn1GoingSecond: true,
            preconditions: ['SELF_IS_ACTIVE'],
            costs: [],
            effects: [{ primitive: 'DAMAGE_ACTIVE', count: 1, upTo: false, baseDamage: 240 }],
            energyCost: ['Incolore', 'Incolore', 'Incolore', 'Incolore', 'Incolore'],
          },
        ],
      }

      const match = createInitialMatchState(
        Array(60).fill(bloodmoonCard),
        Array(60).fill(mockTargetBasic),
        { seed: 104, firstPlayerIndex: 0, maxTurns: 10 },
      )
      match.turnNumber = 2
      match.activePlayerIndex = 0
      match.player.activePokemon = {
        instanceId: 'urs_1',
        card: bloodmoonCard,
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      }

      const attackAction = bloodmoonCard.playableActions[0]!

      // Opponent has 6 prizes remaining -> 0 prizes taken -> cost is 5 Colorless
      let effCost = getEffectiveAttackCost(match.player.activePokemon, attackAction, match)
      expect(effCost['Incolore']).toBe(5)
      expect(canPayEnergyCost([], effCost)).toBe(false)

      // Opponent has taken 5 prizes (1 prize remaining) -> cost reduced by 5 -> 0 Colorless!
      match.opponent.prizes = [match.opponent.prizes[0]!]
      effCost = getEffectiveAttackCost(match.player.activePokemon, attackAction, match)
      expect(effCost['Incolore']).toBe(0)
      expect(canPayEnergyCost([], effCost)).toBe(true)

      const actions = getLegalActions(match)
      expect(actions.some((a) => a.actionId === 'atk_bloodmoon')).toBe(true)
    })

    it('calculates retreat cost and applies Latias-ex free retreat for basic Pokemon', () => {
      const basicWithRetreat: EngineCardModel = {
        ...mockCharmander,
        pokemonStats: {
          ...mockCharmander.pokemonStats!,
          retreatCost: 2,
        },
      }
      const poke: any = {
        card: basicWithRetreat,
      }
      const boardWithoutLatias: any = {
        activePokemon: poke,
        bench: [],
      }
      expect(getPokemonRetreatCost(poke, boardWithoutLatias)).toBe(2)

      const latiasCard: EngineCardModel = {
        ...mockCharmander,
        cardId: 'sv08-076',
        identity: {
          ...mockCharmander.identity,
          cardId: 'sv08-076',
          nameFr: 'Latias-ex',
          nameEn: 'Latias ex',
        },
      }
      const boardWithLatias: any = {
        activePokemon: poke,
        bench: [{ card: latiasCard }],
      }
      expect(getPokemonRetreatCost(poke, boardWithLatias)).toBe(0)
    })
  })

  describe('Schéma v2 — Nouvelles Primitives, CoinFlipMode, Self-Recoil, Triggers & Immunités', () => {
    it('gère DAMAGE_ACTIVE(SELF) comme auto-recul sans blesser adversaire et déclenche TRIGGERED_ABILITY sur attaque', () => {
      const hariyama = UNIFIED_CARD_REGISTRY['me01-073']!
      const wishiwashi = UNIFIED_CARD_REGISTRY['30th-022']!
      expect(hariyama).toBeDefined()
      expect(wishiwashi).toBeDefined()

      const deck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
      const state = createInitialMatchState(deck, deck, { seed: 42, firstPlayerIndex: 0, maxTurns: 14 })
      state.turnNumber = 3
      state.activePlayerIndex = 0

      // Froussardine (30th-022) : poser sur le Banc ne doit PAS déclencher Contre-Attaque Groupée (trigger d'attaque subie)
      state.opponent.hand = [wishiwashi]
      const putOnBenchState = applyAction(
        { ...state, activePlayerIndex: 1, turnNumber: 2 },
        {
          type: 'PUT_BASIC_ON_BENCH',
          cardId: wishiwashi.cardId,
          handIndex: 0,
          label: 'Poser Froussardine',
        },
      )
      expect(putOnBenchState.player.activePokemon?.damage).toBe(0)

      // Test SELF recoil sur computeAttackDamageToActive
      const recoilAttack = {
        actionId: 'atk_recoil_test',
        label: 'Charge Sauvage',
        actionType: 'ATTACK' as const,
        timingPhase: 'ATTACK_PHASE' as const,
        cost: {},
        canUseTurn1GoingFirst: false,
        canUseTurn1GoingSecond: true,
        preconditions: ['SELF_IS_ACTIVE'],
        effects: [
          { primitive: 'DAMAGE_ACTIVE' as const, target: 'OPPONENT_ACTIVE', value: 120, baseDamage: 120 },
          { primitive: 'DAMAGE_ACTIVE' as const, target: 'SELF', value: 30, baseDamage: 30 },
        ],
      }

      const dmgPreview = computeAttackDamageToActive(state.player, state.opponent, recoilAttack, state)
      expect(dmgPreview.activeDamage).toBeGreaterThanOrEqual(120)
      expect(dmgPreview.selfRecoilDamage).toBe(30)

      state.player.activePokemon = {
        instanceId: 'atk_recoil',
        card: { ...hariyama, playableActions: [recoilAttack] },
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
        instanceId: 'def_wishiwashi',
        card: { ...wishiwashi, pokemonStats: { ...wishiwashi.pokemonStats!, hp: 180 } },
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      }

      const afterRecoilAtk = applyAction(state, {
        type: 'DECLARE_ATTACK',
        cardId: hariyama.cardId,
        actionId: 'atk_recoil_test',
        endsTurnImmediately: true,
        label: 'Charge Sauvage',
      })
      // Froussardine déclenche Contre-Attaque Groupée (+30 compteurs sur Hariyama) + 30 recul = 60 sur l'attaquant
      expect(afterRecoilAtk.player.activePokemon?.damage).toBe(60)
      expect(afterRecoilAtk.opponent.activePokemon?.damage).toBeGreaterThanOrEqual(120)
    })

    it('calcule correctement les 5 CoinFlipMode en espérance et résout PLACE_DAMAGE_COUNTERS sur Banc Tera', () => {
      const deck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
      const state = createInitialMatchState(deck, deck, { seed: 99, firstPlayerIndex: 0, maxTurns: 14 })
      state.turnNumber = 3
      state.activePlayerIndex = 0
      state.player.activePokemon = {
        instanceId: 'p_coin_atk',
        card: { ...mockCharmander, pokemonStats: { ...mockCharmander.pokemonStats!, weaknesses: [], resistances: [] } },
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
        instanceId: 'p_coin_def',
        card: { ...mockTargetBasic, pokemonStats: { ...mockTargetBasic.pokemonStats!, hp: 300, weaknesses: [], resistances: [] } },
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 2,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      }

      const makeFlipAtk = (eff: any) => ({
        actionId: 'coin_atk',
        label: 'Flip',
        actionType: 'ATTACK' as const,
        timingPhase: 'ATTACK_PHASE' as const,
        cost: {},
        canUseTurn1GoingFirst: false,
        canUseTurn1GoingSecond: true,
        preconditions: [],
        effects: [eff],
      })

      expect(
        computeAttackDamageToActive(
          state.player,
          state.opponent,
          makeFlipAtk({ primitive: 'DAMAGE_ACTIVE', target: 'OPPONENT_ACTIVE', value: 100, coinFlipMode: 'SINGLE_HEADS_REQUIRED', coinCount: 1 }),
        ).expectedActiveDamage,
      ).toBe(50)

      expect(
        computeAttackDamageToActive(
          state.player,
          state.opponent,
          makeFlipAtk({ primitive: 'DAMAGE_ACTIVE', target: 'OPPONENT_ACTIVE', value: 80, bonusValue: 40, coinFlipMode: 'SINGLE_HEADS_BONUS', coinCount: 1 }),
        ).expectedActiveDamage,
      ).toBe(100)

      expect(
        computeAttackDamageToActive(
          state.player,
          state.opponent,
          makeFlipAtk({ primitive: 'DAMAGE_ACTIVE', target: 'OPPONENT_ACTIVE', value: 50, bonusValue: 50, coinFlipMode: 'MULTI_COIN_PER_HEADS', coinCount: 3, scalingOperator: 'MULTIPLY' }),
        ).expectedActiveDamage,
      ).toBe(75)

      expect(
        computeAttackDamageToActive(
          state.player,
          state.opponent,
          makeFlipAtk({ primitive: 'DAMAGE_ACTIVE', target: 'OPPONENT_ACTIVE', value: 60, bonusValue: 60, coinFlipMode: 'UNTIL_TAILS_PER_HEADS', scalingOperator: 'MULTIPLY' }),
        ).expectedActiveDamage,
      ).toBe(60)

      expect(
        computeAttackDamageToActive(
          state.player,
          state.opponent,
          makeFlipAtk({ primitive: 'DAMAGE_ACTIVE', target: 'OPPONENT_ACTIVE', value: 120, bonusValue: 40, coinFlipMode: 'TWO_TAILS_SELF_DAMAGE', coinCount: 2 }),
        ).expectedSelfRecoil,
      ).toBe(10)

      // PLACE_DAMAGE_COUNTERS (Plongée Fantôme Lanssorien-ex me02.5-160) : 60 totaux (pas 600!) et contourne Téracristal sur le Banc
      const dragapultEx = UNIFIED_CARD_REGISTRY['me02.5-160']!
      expect(dragapultEx).toBeDefined()
      expect(isCardDeadInHand(dragapultEx, state.player, { ...state.opponent, bench: [] })).toBe(false)

      const charizardEx = UNIFIED_CARD_REGISTRY['sv03-125']!
      state.player.activePokemon.card = dragapultEx
      state.opponent.bench = [
        {
          instanceId: 'opp_tera_bench',
          card: charizardEx,
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
      state.player.activePokemon.attachedEnergies = [
        createNativeBasicEnergyModel('Feu'),
        createNativeBasicEnergyModel('Psy'),
      ]

      const phantomDive = dragapultEx.playableActions.find((a) => /plongée fantôme/i.test(a.label))!
      const afterDive = applyAction(state, {
        type: 'DECLARE_ATTACK',
        cardId: dragapultEx.cardId,
        actionId: phantomDive.actionId,
        endsTurnImmediately: true,
        label: phantomDive.label,
      })
      expect(afterDive.opponent.bench[0]?.damage).toBe(60)
    })

    it('applique LOCK_RETREAT, MODIFY_DAMAGE_TAKEN, MODIFY_HP (Cape/Tour de Brouillage), LOCK_ABILITIES et TAKE_EXTRA_PRIZE strictement sur KO', () => {
      const deck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
      const state = createInitialMatchState(deck, deck, { seed: 77, firstPlayerIndex: 0, maxTurns: 14 })
      state.turnNumber = 3
      state.activePlayerIndex = 0

      // Cape Héroïque (sv05-152) attachée directement +100 PV ; neutralisée par Tour de Brouillage (sv06-153)
      const heroicCape = UNIFIED_CARD_REGISTRY['sv05-152']!
      const jammingTower = UNIFIED_CARD_REGISTRY['sv06-153']!
      state.player.hand = [heroicCape, jammingTower]
      state.player.activePokemon = {
        instanceId: 'p_caped',
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
      state.player.bench = [
        {
          instanceId: 'p_bench_switch',
          card: mockTargetBasic,
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

      const attachCapeState = applyAction(state, {
        type: 'PLAY_TRAINER',
        cardId: heroicCape.cardId,
        handIndex: 0,
        targetSlot: 'ACTIVE',
        label: 'Attacher Cape Héroïque',
      })
      expect(attachCapeState.player.activePokemon?.attachedTools.length).toBe(1)
      expect(getPokemonMaxHp(attachCapeState.player.activePokemon!, attachCapeState)).toBe(170)

      const withJammingState = applyAction(attachCapeState, {
        type: 'PLAY_TRAINER',
        cardId: jammingTower.cardId,
        handIndex: 0,
        label: 'Jouer Tour de Brouillage',
      })
      expect(getPokemonMaxHp(withJammingState.player.activePokemon!, withJammingState)).toBe(70)

      // LOCK_RETREAT + MODIFY_DAMAGE_TAKEN + TAKE_EXTRA_PRIZE sans KO
      const specialAttack = {
        actionId: 'atk_lock_and_shield',
        label: 'Piège Bouclier',
        actionType: 'ATTACK' as const,
        timingPhase: 'ATTACK_PHASE' as const,
        cost: {},
        canUseTurn1GoingFirst: false,
        canUseTurn1GoingSecond: true,
        preconditions: [],
        effects: [
          { primitive: 'DAMAGE_ACTIVE' as const, target: 'OPPONENT_ACTIVE', value: 20, baseDamage: 20 },
          { primitive: 'LOCK_RETREAT' as const, target: 'OPPONENT_ACTIVE' },
          { primitive: 'MODIFY_DAMAGE_TAKEN' as const, target: 'SELF', value: -30 },
          { primitive: 'TAKE_EXTRA_PRIZE' as const, target: 'PLAYER', count: 1 },
        ],
      }
      withJammingState.player.activePokemon!.card = {
        ...mockCharmander,
        pokemonStats: { ...mockCharmander.pokemonStats!, weaknesses: [], resistances: [] },
        playableActions: [specialAttack],
      }
      withJammingState.opponent.activePokemon = {
        instanceId: 'opp_big',
        card: { ...mockTargetBasic, pokemonStats: { ...mockTargetBasic.pokemonStats!, hp: 200, weaknesses: [], resistances: [] } },
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 2,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      }
      withJammingState.opponent.bench = [
        {
          instanceId: 'opp_b',
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

      const afterLockAtk = applyAction(withJammingState, {
        type: 'DECLARE_ATTACK',
        cardId: 'sv03-026',
        actionId: 'atk_lock_and_shield',
        endsTurnImmediately: true,
        label: 'Piège Bouclier',
      })
      // Aucun KO => TAKE_EXTRA_PRIZE ne doit PAS donner de récompense gratuite
      expect(afterLockAtk.player.prizes.length).toBe(6)
      // Adversaire bloqué de retraite pendant son tour
      expect(afterLockAtk.opponent.activePokemon?.cantRetreatNextTurn).toBe(true)
      const oppLegal = getLegalActions(afterLockAtk)
      expect(oppLegal.some((a) => a.type === 'RETREAT_ACTIVE')).toBe(false)

      // L'adversaire attaque avec 50 -> réduit de 30 par MODIFY_DAMAGE_TAKEN (-30) -> 20 dégâts
      const oppAtk = {
        actionId: 'atk_50',
        label: 'Charge 50',
        actionType: 'ATTACK' as const,
        timingPhase: 'ATTACK_PHASE' as const,
        cost: {},
        canUseTurn1GoingFirst: false,
        canUseTurn1GoingSecond: true,
        preconditions: [],
        effects: [{ primitive: 'DAMAGE_ACTIVE' as const, target: 'OPPONENT_ACTIVE', value: 50, baseDamage: 50 }],
      }
      afterLockAtk.opponent.activePokemon!.card = {
        ...mockTargetBasic,
        pokemonStats: { ...mockTargetBasic.pokemonStats!, hp: 200, weaknesses: [], resistances: [] },
        playableActions: [oppAtk],
      }
      const afterOppHit = applyAction(afterLockAtk, {
        type: 'DECLARE_ATTACK',
        cardId: 'opp_id',
        actionId: 'atk_50',
        endsTurnImmediately: true,
        label: 'Charge 50',
      })
      expect(afterOppHit.player.activePokemon?.damage).toBe(20)
      // Le bouclier expire à la fin du tour adverse
      expect(afterOppHit.player.activePokemon?.damageTakenModifierNextTurn).toBe(0)
    })

    it('exécute KNOCK_OUT(SELF) v2 sur Noctunoir (sv08.5-037 Explosion Maudite)', () => {
      const dusknoir = UNIFIED_CARD_REGISTRY['sv08.5-037']!
      expect(dusknoir).toBeDefined()
      const deck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
      const state = createInitialMatchState(deck, deck, { seed: 55, firstPlayerIndex: 0, maxTurns: 14 })
      state.turnNumber = 3
      state.activePlayerIndex = 0
      state.player.bench = [
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
      state.opponent.activePokemon = {
        instanceId: 'opp_fragile',
        card: { ...mockTargetBasic, pokemonStats: { ...mockTargetBasic.pokemonStats!, hp: 120, prizeCardsGiven: 1 } },
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
          instanceId: 'opp_backup',
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

      const abilityAct = getLegalActions(state).find(
        (a) => a.type === 'USE_ABILITY' && a.cardId === 'sv08.5-037',
      )
      expect(abilityAct).toBeDefined()

      const afterBlast = applyAction(state, abilityAct!)
      // Noctunoir est défaussé et l'adversaire prend 1 récompense ; l'actif adverse (120 PV < 130) est K.O. et le joueur prend 1 récompense
      expect(afterBlast.player.bench.length).toBe(0)
      expect(afterBlast.opponent.prizes.length).toBe(5)
      expect(afterBlast.player.prizes.length).toBe(5)
    })

    it('valide les deadCardCondition normalisées, SINGLE_HEADS_REQUIRED multi-pièces et le non-blocage en main sur attaque conditionnelle', () => {
      const deck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
      const state = createInitialMatchState(deck, deck, { seed: 88, firstPlayerIndex: 0, maxTurns: 14 })
      state.player.hand = [mockCharmander, mockCharmander]

      // 1. Une condition HAND_NOT_EMPTY sur une ATTACK ne rend JAMAIS un Pokémon mort en main
      const pokeWithCondAtk: EngineCardModel = {
        ...mockCharmander,
        playableActions: [
          {
            actionId: 'atk_cond',
            label: 'Attaque Conditionnelle',
            actionType: 'ATTACK',
            timingPhase: 'ATTACK_PHASE',
            cost: {},
            canUseTurn1GoingFirst: false,
            canUseTurn1GoingSecond: true,
            preconditions: ['HAND_IS_EMPTY'],
            deadCardCondition: 'HAND_NOT_EMPTY',
            effects: [{ primitive: 'DAMAGE_ACTIVE', target: 'OPPONENT_ACTIVE', value: 60 }],
          },
        ],
      }
      expect(isCardDeadInHand(pokeWithCondAtk, state.player, state.opponent)).toBe(false)

      // 2. Conditions de carte morte sur actions jouables depuis la main (PLAY_FROM_HAND / EVOLVE)
      const makeDeadCheck = (deadCond: string, extraEffects: any[] = []): EngineCardModel => ({
        ...mockCharmander,
        category: 'TRAINER',
        subCategory: 'ITEM',
        playableActions: [
          {
            actionId: 'trainer_0',
            label: 'Test',
            actionType: 'PLAY_FROM_HAND',
            timingPhase: 'MAIN_PHASE_1',
            cost: {},
            canUseTurn1GoingFirst: true,
            canUseTurn1GoingSecond: true,
            preconditions: [],
            deadCardCondition: deadCond,
            effects: extraEffects,
          },
        ],
      })

      state.player.hand = [mockCharmander]
      expect(isCardDeadInHand(makeDeadCheck('HAND_FEWER_THAN_2_OTHER_CARDS'), state.player, state.opponent)).toBe(true)
      expect(isCardDeadInHand(makeDeadCheck('NO_KO_SUFFERED_LAST_TURN'), state.player, state.opponent)).toBe(true)
      expect(isCardDeadInHand(makeDeadCheck('NO_REPTINCEL_IN_PLAY'), state.player, state.opponent)).toBe(true)
      state.player.deck = []
      expect(isCardDeadInHand(makeDeadCheck('DECK_IS_EMPTY'), state.player, state.opponent)).toBe(true)
      expect(
        isCardDeadInHand(
          makeDeadCheck('NO_VALID_TARGET_IN_DECK', [{ primitive: 'SEARCH_DECK', filter: 'CATEGORY:POKEMON' }]),
          state.player,
          state.opponent,
        ),
      ).toBe(true)

      // 3. SINGLE_HEADS_REQUIRED avec coinCount = 2 -> probabilité 0.25 en estimation
      const twoCoinReq = {
        actionId: 'atk_2coins',
        label: 'Double Face',
        actionType: 'ATTACK' as const,
        timingPhase: 'ATTACK_PHASE' as const,
        cost: {},
        canUseTurn1GoingFirst: false,
        canUseTurn1GoingSecond: true,
        preconditions: [],
        effects: [
          {
            primitive: 'DAMAGE_ACTIVE' as const,
            target: 'OPPONENT_ACTIVE',
            value: 100,
            coinFlipMode: 'SINGLE_HEADS_REQUIRED' as const,
            coinCount: 2,
          },
        ],
      }
      state.player.activePokemon = {
        instanceId: 'p_2coin_a',
        card: { ...mockCharmander, pokemonStats: { ...mockCharmander.pokemonStats!, weaknesses: [], resistances: [] } },
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
        instanceId: 'p_2coin_d',
        card: { ...mockTargetBasic, pokemonStats: { ...mockTargetBasic.pokemonStats!, weaknesses: [], resistances: [] } },
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      }
      expect(
        computeAttackDamageToActive(state.player, state.opponent, twoCoinReq, state).expectedActiveDamage,
      ).toBe(25)
    })
  })

  describe('Conformité Règles Officielles — Étape F, Stades, Double Turbo, Checkup, Lost Zone & Désevolutions', () => {
    it('diffère la résolution des K.O. à la fin de l’attaque (Étape F) sans affecter le Pokémon promu et gère la victoire simultanée (2 vs 1 / DRAW)', () => {
      const deck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
      const state = createInitialMatchState(deck, deck, { seed: 12, firstPlayerIndex: 0, maxTurns: 14 })
      state.turnNumber = 3
      state.activePlayerIndex = 0

      // Attaque : 80 dégâts + Paralyse l'Actif adverse + 80 recul sur soi-même
      const finisherRecoilAtk = {
        actionId: 'atk_finish_recoil',
        label: 'Charge Finale',
        actionType: 'ATTACK' as const,
        timingPhase: 'ATTACK_PHASE' as const,
        cost: {},
        canUseTurn1GoingFirst: false,
        canUseTurn1GoingSecond: true,
        preconditions: [],
        effects: [
          { primitive: 'DAMAGE_ACTIVE' as const, target: 'OPPONENT_ACTIVE', value: 80, baseDamage: 80 },
          { primitive: 'APPLY_SPECIAL_CONDITION' as const, target: 'OPPONENT_ACTIVE', specialCondition: 'PARALYZED' as const },
          { primitive: 'DAMAGE_ACTIVE' as const, target: 'SELF', value: 80, baseDamage: 80 },
        ],
      }

      state.player.activePokemon = {
        instanceId: 'p_recoil_atk',
        card: { ...mockCharmander, pokemonStats: { ...mockCharmander.pokemonStats!, hp: 70, weaknesses: [], resistances: [] }, playableActions: [finisherRecoilAtk] },
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      }
      state.player.bench = [
        {
          instanceId: 'p_backup',
          card: mockCharmander,
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
      state.opponent.activePokemon = {
        instanceId: 'o_ko_target',
        card: { ...mockTargetBasic, pokemonStats: { ...mockTargetBasic.pokemonStats!, hp: 70, weaknesses: [], resistances: [] } },
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
          instanceId: 'o_promoted_later',
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

      // Le Pokémon Actif promu du Banc adverse ne doit PAS être paralysé après le K.O.
      const resMid = applyAction(state, {
        type: 'DECLARE_ATTACK',
        cardId: 'atk',
        actionId: 'atk_finish_recoil',
        endsTurnImmediately: true,
        label: 'Charge Finale',
      })
      expect(resMid.winner).toBeNull()
      expect(resMid.opponent.activePokemon?.instanceId).toBe('o_promoted_later')
      expect(resMid.opponent.activePokemon?.specialConditions).toEqual([])
      expect(resMid.player.prizes.length).toBe(5)
      expect(resMid.opponent.prizes.length).toBe(5)

      // Test victoire simultanée 2 conditions vs 1 condition :
      // Player n'a plus de Banc (perd par NO_POKEMON_IN_PLAY quand il meurt de recul) ET Opponent a 2 Récompenses,
      // tandis que Player prend sa dernière Récompense ET vide le Banc adverse (2 conditions contre 1 => Player gagne !)
      const simWinState = createInitialMatchState(deck, deck, { seed: 13, firstPlayerIndex: 0, maxTurns: 14 })
      simWinState.turnNumber = 3
      simWinState.activePlayerIndex = 0
      simWinState.player.prizes = [simWinState.player.prizes[0]!]
      simWinState.opponent.prizes = [simWinState.opponent.prizes[0]!]
      simWinState.player.bench = [
        {
          instanceId: 'p_keep_alive',
          card: mockCharmander,
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
      simWinState.player.activePokemon = {
        ...state.player.activePokemon!,
        damage: 0,
      }
      simWinState.opponent.activePokemon = {
        ...state.opponent.activePokemon!,
        damage: 0,
      }
      simWinState.opponent.bench = [] // L'adversaire n'a plus de Banc !

      const afterSimWin = applyAction(simWinState, {
        type: 'DECLARE_ATTACK',
        cardId: 'atk',
        actionId: 'atk_finish_recoil',
        endsTurnImmediately: true,
        label: 'Charge Finale',
      })
      // Player remplit 2 conditions (ALL_PRIZES + NO_POKEMON_IN_PLAY) vs Opponent 1 condition (ALL_PRIZES) => PLAYER gagne !
      expect(afterSimWin.winner).toBe('PLAYER')
    })

    it('limite à 1 Stade par tour et réduit le Banc de 8 à 5 quand Abîme Zéro quitte le jeu', () => {
      const deck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
      const state = createInitialMatchState(deck, deck, { seed: 44, firstPlayerIndex: 0, maxTurns: 14 })
      state.turnNumber = 3
      state.activePlayerIndex = 0

      const areaZero = UNIFIED_CARD_REGISTRY['sv07-131']!
      const jammingTower = UNIFIED_CARD_REGISTRY['sv06-153']!
      state.player.hand = [areaZero, jammingTower]
      state.player.activePokemon = {
        instanceId: 'tera_active',
        card: { ...mockCharmander, pokemonStats: { ...mockCharmander.pokemonStats!, isTera: true } },
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

      // Joue Abîme Zéro : passe la capacité max à 8 et pose stadiumPlayedThisTurn = true
      const afterAreaZero = applyAction(state, {
        type: 'PLAY_TRAINER',
        cardId: areaZero.cardId,
        handIndex: 0,
        label: 'Jouer le Stade Abîme Zéro',
      })
      expect(afterAreaZero.player.stadiumPlayedThisTurn).toBe(true)
      expect(getMaxBenchSlots(afterAreaZero.player, afterAreaZero.activeStadium)).toBe(8)

      // Un second Stade ne peut pas être proposé légalement dans le même tour
      const legalSameTurn = getLegalActions(afterAreaZero)
      expect(legalSameTurn.some((a) => a.cardId === jammingTower.cardId)).toBe(false)

      // Remplir le Banc à 7 Pokémon puis défausser le Stade au tour suivant doit ramener le Banc à 5
      while (afterAreaZero.player.bench.length < 7) {
        afterAreaZero.player.bench.push({
          instanceId: `b_${afterAreaZero.player.bench.length}`,
          card: mockCharmander,
          previousStages: [],
          damage: 0,
          attachedEnergies: [],
          attachedTools: [],
          turnPlayed: 1,
          evolvedThisTurn: false,
          specialConditions: [],
          cantAttackNextTurn: false,
        })
      }
      afterAreaZero.player.stadiumPlayedThisTurn = false
      const afterReplace = applyAction(afterAreaZero, {
        type: 'PLAY_TRAINER',
        cardId: jammingTower.cardId,
        handIndex: 0,
        label: 'Jouer Tour de Brouillage',
      })
      expect(getMaxBenchSlots(afterReplace.player, afterReplace.activeStadium)).toBe(5)
      expect(afterReplace.player.bench.length).toBe(5)
    })

    it('applique -20 de Double Turbo avant Faiblesse, coupe à 0, économise 1 carte en Retraite et applique Zone Féérique', () => {
      const doubleTurbo: EngineCardModel = {
        ...mockCharmander,
        cardId: 'test-dt',
        category: 'ENERGY',
        subCategory: 'SPECIAL_ENERGY',
        pokemonStats: null,
        identity: { ...mockCharmander.identity, nameFr: 'Énergie Double Turbo', nameEn: 'Double Turbo Energy', category: 'ENERGY', subCategory: 'SPECIAL_ENERGY' },
      }
      const fireEnergy = createNativeBasicEnergyModel('Feu')
      const deck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
      const state = createInitialMatchState(deck, deck, { seed: 55, firstPlayerIndex: 0, maxTurns: 14 })
      state.turnNumber = 3
      state.activePlayerIndex = 0

      // 20 dégâts de base + Double Turbo (-20) = 0 AVANT Faiblesse x2 -> total = 0 (et non -40 ou +40) !
      const atk20 = {
        actionId: 'atk_20',
        label: 'Flammèche 20',
        actionType: 'ATTACK' as const,
        timingPhase: 'ATTACK_PHASE' as const,
        cost: {},
        canUseTurn1GoingFirst: false,
        canUseTurn1GoingSecond: true,
        preconditions: [],
        effects: [{ primitive: 'DAMAGE_ACTIVE' as const, target: 'OPPONENT_ACTIVE', value: 20, baseDamage: 20 }],
      }
      state.player.activePokemon = {
        instanceId: 'dt_atk',
        card: { ...mockCharmander, pokemonStats: { ...mockCharmander.pokemonStats!, types: ['Feu'], retreatCost: 2 }, playableActions: [atk20] },
        previousStages: [],
        damage: 0,
        attachedEnergies: [fireEnergy, doubleTurbo],
        attachedTools: [],
        turnPlayed: 1,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      }
      state.opponent.activePokemon = {
        instanceId: 'grass_def',
        card: { ...mockTargetBasic, pokemonStats: { ...mockTargetBasic.pokemonStats!, types: ['Plante'], weaknesses: [{ type: 'Feu', value: '×2' }], resistances: [] } },
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 2,
        evolvedThisTurn: false,
        specialConditions: [],
        cantAttackNextTurn: false,
      }
      expect(computeAttackDamageToActive(state.player, state.opponent, atk20, state).activeDamage).toBe(0)

      // Retraite coût 2 avec [Fire, DoubleTurbo] -> ne doit défausser que DoubleTurbo (reste Fire attachée)
      state.player.bench = [
        {
          instanceId: 'pivot',
          card: mockTargetBasic,
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
      const afterRetreat = applyAction(state, {
        type: 'RETREAT_ACTIVE',
        targetBenchIndex: 0,
        label: 'Retraite',
      })
      const retreatedPoke = afterRetreat.player.bench[0]!
      expect(retreatedPoke.attachedEnergies.length).toBe(1)
      expect(retreatedPoke.attachedEnergies[0]?.category).toBe('ENERGY')

      // Test Mélofée-ex de Lilie (Zone Féérique) rendant Lanssorien-ex (Dragon) faible x2 au Psy
      const clefairyEx = UNIFIED_CARD_REGISTRY['me02.5-076']!
      const dragapultEx = UNIFIED_CARD_REGISTRY['me02.5-160']!
      state.player.bench = [
        {
          instanceId: 'clefairy_bench',
          card: clefairyEx,
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
      state.player.activePokemon.card = {
        ...mockCharmander,
        pokemonStats: { ...mockCharmander.pokemonStats!, types: ['Psy'] },
        playableActions: [atk20],
      }
      state.player.activePokemon.attachedEnergies = []
      state.opponent.activePokemon.card = dragapultEx
      // 20 dégâts Psy x2 grâce à Zone Féérique = 40 dégâts !
      expect(computeAttackDamageToActive(state.player, state.opponent, atk20, state).activeDamage).toBe(40)
    })

    it('nettoie tous les effets temporaires sur Retraite/Dévolution, respecte l’ordre Checkup + K.O. simultanés et protège Civière Nocturne', () => {
      const deck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
      const state = createInitialMatchState(deck, deck, { seed: 66, firstPlayerIndex: 0, maxTurns: 14 })
      state.turnNumber = 3
      state.activePlayerIndex = 0

      // 1. Checkup simultané Poison + Brûlure ne doit PAS mettre koSufferedLastOpponentTurn = true
      state.player.activePokemon!.card = mockCharmander
      state.opponent.activePokemon!.card = mockTargetBasic
      state.player.activePokemon!.specialConditions = ['PARALYZED', 'POISONED']
      state.player.activePokemon!.damage = getPokemonMaxHp(state.player.activePokemon!) - 10
      state.opponent.activePokemon!.specialConditions = ['BURNED']
      state.opponent.activePokemon!.damage = getPokemonMaxHp(state.opponent.activePokemon!) - 20
      state.player.bench = [
        {
          instanceId: 'p_sub',
          card: mockCharmander,
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
      state.opponent.bench = [
        {
          instanceId: 'o_sub',
          card: mockTargetBasic,
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
      runBetweenTurnsCheckup(state)
      expect(state.player.activePokemon?.instanceId).toBe('p_sub')
      expect(state.opponent.activePokemon?.instanceId).toBe('o_sub')
      expect(state.player.prizes.length).toBe(5)
      expect(state.opponent.prizes.length).toBe(5)
      expect(state.player.koSufferedLastOpponentTurn).toBe(false)
      expect(state.opponent.koSufferedLastOpponentTurn).toBe(false)

      // 2. Retraite purge damageTakenModifierNextTurn, damageDealtModifierNextTurn et preventDamageOrEffectsNextTurn
      state.player.activePokemon!.damageTakenModifierNextTurn = -30
      state.player.activePokemon!.damageDealtModifierNextTurn = -40
      state.player.activePokemon!.preventDamageOrEffectsNextTurn = true
      state.player.activePokemon!.attachedEnergies = []
      state.player.bench = [
        {
          instanceId: 'p_pivot2',
          card: { ...mockCharmander, pokemonStats: { ...mockCharmander.pokemonStats!, retreatCost: 0 } },
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
      state.player.activePokemon!.card = {
        ...mockCharmander,
        pokemonStats: { ...mockCharmander.pokemonStats!, retreatCost: 0 },
      }
      const afterCleanRetreat = applyAction(state, {
        type: 'RETREAT_ACTIVE',
        targetBenchIndex: 0,
        label: 'Retraite propre',
      })
      const benchedAfter = afterCleanRetreat.player.bench[0]!
      expect(benchedAfter.damageTakenModifierNextTurn).toBe(0)
      expect(benchedAfter.damageDealtModifierNextTurn).toBe(0)
      expect(benchedAfter.preventDamageOrEffectsNextTurn).toBe(false)

      // 3. Civière Nocturne (me02.5-196) ne doit jamais retirer d'énergie sur notre Pokémon Actif
      const stretcher = UNIFIED_CARD_REGISTRY['me02.5-196']!
      const fireEnergy = createNativeBasicEnergyModel('Feu')
      const stretcherState = createInitialMatchState(deck, deck, { seed: 67, firstPlayerIndex: 0, maxTurns: 14 })
      stretcherState.turnNumber = 3
      stretcherState.activePlayerIndex = 0
      stretcherState.player.hand = [stretcher]
      stretcherState.player.discard = [mockCharmander]
      stretcherState.player.activePokemon!.attachedEnergies = [fireEnergy]
      const afterStretcher = applyAction(stretcherState, {
        type: 'PLAY_TRAINER',
        cardId: stretcher.cardId,
        handIndex: 0,
        label: 'Jouer Civière Nocturne',
      })
      expect(afterStretcher.player.activePokemon?.attachedEnergies.length).toBe(1)
      expect(afterStretcher.player.hand.some((c) => c.cardId === mockCharmander.cardId)).toBe(true)

      // 4. Zone Perdue (destinationZone: 'LOST_ZONE') envoie la carte dans board.lostZone et non discard
      const millLostCard: EngineCardModel = {
        ...mockCharmander,
        category: 'TRAINER',
        subCategory: 'ITEM',
        playableActions: [
          {
            actionId: 'lost_mill',
            label: 'Envoyer en Zone Perdue',
            actionType: 'PLAY_FROM_HAND',
            timingPhase: 'MAIN_PHASE_1',
            cost: {},
            canUseTurn1GoingFirst: true,
            canUseTurn1GoingSecond: true,
            preconditions: [],
            effects: [{ primitive: 'MILL_DECK', target: 'OPPONENT', count: 2, destinationZone: 'LOST_ZONE' }],
          },
        ],
      }
      const lostState = createInitialMatchState(deck, deck, { seed: 68, firstPlayerIndex: 0, maxTurns: 14 })
      lostState.player.hand = [millLostCard]
      const prevOppDiscard = lostState.opponent.discard.length
      const afterLost = applyAction(lostState, {
        type: 'PLAY_TRAINER',
        cardId: millLostCard.cardId,
        handIndex: 0,
        label: 'Zone Perdue',
      })
      expect(afterLost.opponent.lostZone.length).toBe(2)
      expect(afterLost.opponent.discard.length).toBe(prevOppDiscard)
    })
  })
})
