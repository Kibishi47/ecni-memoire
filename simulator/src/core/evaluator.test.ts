import { describe, expect, it } from 'vitest'
import { UNIFIED_CARD_REGISTRY } from '../data/cardCatalog'
import { META_OPPONENT_DECKS } from '../data/metaDecks'
import { parsePtcglDecklist } from '../utils/ptcglParser'
import { applyAction, createInitialMatchState } from './engine'
import { evaluateState, getStateHash, selectBestTurnBranch } from './evaluator'

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
    const charizardDeck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const boltDeck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[1]!.ptcglText)

    const baseState = createInitialMatchState(charizardDeck, boltDeck, {
      seed: 101,
      firstPlayerIndex: 0,
      maxTurns: 18,
    })

    const charmander = UNIFIED_CARD_REGISTRY['sv03.5-004']!
    const pidgey = UNIFIED_CARD_REGISTRY['sv03.5-016']!

    baseState.player.bench = []
    baseState.player.hand = [charmander, pidgey]

    // Séquence A : poser Salamèche puis Roucool
    const stateA1 = applyAction(baseState, {
      type: 'PUT_BASIC_ON_BENCH',
      cardId: charmander.cardId,
      label: 'Poser Salamèche',
    })
    const stateA2 = applyAction(stateA1, {
      type: 'PUT_BASIC_ON_BENCH',
      cardId: pidgey.cardId,
      label: 'Poser Roucool',
    })

    // Séquence B : poser Roucool puis Salamèche
    const stateB1 = applyAction(baseState, {
      type: 'PUT_BASIC_ON_BENCH',
      cardId: pidgey.cardId,
      label: 'Poser Roucool',
    })
    const stateB2 = applyAction(stateB1, {
      type: 'PUT_BASIC_ON_BENCH',
      cardId: charmander.cardId,
      label: 'Poser Salamèche',
    })

    expect(getStateHash(stateA2)).toBe(getStateHash(stateB2))
  })

  it('selects Rare Candy -> Charizard ex -> Burning Darkness KO over passing via 3-ply lookahead', () => {
    const charizardDeck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const gardevoirDeck = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[3]!.ptcglText)

    const state = createInitialMatchState(charizardDeck, gardevoirDeck, {
      seed: 777,
      firstPlayerIndex: 0,
      maxTurns: 18,
    })

    state.turnNumber = 3
    state.activePlayerIndex = 0

    const charmander = UNIFIED_CARD_REGISTRY['sv03.5-004']!
    const ralts = UNIFIED_CARD_REGISTRY['swsh10-060']!
    const rareCandy = UNIFIED_CARD_REGISTRY['sv04-125']!
    const charizardEx = UNIFIED_CARD_REGISTRY['sv03-125']!
    const fireEnergy = UNIFIED_CARD_REGISTRY['sve-002']!

    state.player.activePokemon = {
      instanceId: 'p_charmander',
      card: charmander,
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 1,
      evolvedThisTurn: false,
    }
    state.opponent.activePokemon = {
      instanceId: 'p_ralts_active',
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
        instanceId: 'p_ralts_bench',
        card: ralts,
        previousStages: [],
        damage: 0,
        attachedEnergies: [],
        attachedTools: [],
        turnPlayed: 2,
        evolvedThisTurn: false,
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
})
