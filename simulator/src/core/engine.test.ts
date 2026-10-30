import { describe, expect, it } from 'vitest'
import { UNIFIED_CARD_REGISTRY } from '../data/cardCatalog'
import { META_OPPONENT_DECKS } from '../data/metaDecks'
import { parsePtcglDecklist } from '../utils/ptcglParser'
import {
  applyAction,
  createInitialMatchState,
  getLegalActions,
  startTurn,
} from './engine'

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

    // Injecte un Supporter (Pepper) et un Stage 1 (Reptincel) dans la main du Joueur 1 au Tour 1
    state.player.hand.push(UNIFIED_CARD_REGISTRY['sv01-166']!)
    state.player.hand.push(UNIFIED_CARD_REGISTRY['sv03-027']!)

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
    const charizardDeck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const gardevoirDeck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[3]!.ptcglText)

    const state = createInitialMatchState(charizardDeck, gardevoirDeck, {
      seed: 2026,
      firstPlayerIndex: 0,
      maxTurns: 18,
    })

    // Avance au Tour 3 (2e tour du Joueur 1) pour débloquer Super Bonbon et l'Attaque
    state.turnNumber = 3
    state.activePlayerIndex = 0

    // Place un Salamèche en Poste Actif posé au Tour 1
    const charmander = UNIFIED_CARD_REGISTRY['sv03.5-004']!
    state.player.activePokemon = {
      instanceId: 'p_charmander_active',
      card: charmander,
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 1,
      evolvedThisTurn: false,
    }

    // Place un Tarsal (70 PV) en Poste Actif adverse et un second Tarsal sur le Banc adverse
    const ralts = UNIFIED_CARD_REGISTRY['swsh10-060']!
    state.opponent.activePokemon = {
      instanceId: 'p_ralts_opp',
      card: ralts,
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 2,
      evolvedThisTurn: false,
    }
    state.opponent.bench = [
      {
        instanceId: 'p_ralts_opp_bench',
        card: ralts,
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 2,
        evolvedThisTurn: false,
      },
    ]

    // Donne Super Bonbon + Dracaufeu-ex en main au Joueur, et s'assure que 3 Énergies Feu sont dans le deck
    const rareCandy = UNIFIED_CARD_REGISTRY['sv04-125']!
    const charizardEx = UNIFIED_CARD_REGISTRY['sv03-125']!
    const fireEnergy = UNIFIED_CARD_REGISTRY['sve-002']!

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
})
