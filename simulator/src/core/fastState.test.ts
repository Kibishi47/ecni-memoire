import { describe, expect, it } from 'vitest'
import { getCardFastMeta, UNIFIED_CARD_REGISTRY } from '../data/cardCatalog'
import { META_OPPONENT_DECKS } from '../data/metaDecks'
import { parsePtcglDecklist } from '../utils/ptcglParser'
import { applyAction, createInitialMatchState, fastCloneState } from './engine'
import {
  cloneFlatBuffer,
  computeFlatBufferHash,
  computeNumericStateHash,
  encodeStateToFlatBuffer,
  FLAT_STATE_WORD_LENGTH,
} from './fastState'
import { runSimulationShard } from './gameLoop'

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

describe('FastState — Zobrist / Murmur3 Numeric Hashing, Flat Int32Array Buffer & In-Place Engine Mutation', () => {
  it('assigns deterministic CardFastMeta and numericId across identical card models', () => {
    const zard = UNIFIED_CARD_REGISTRY['sv03-125']!
    const candy = UNIFIED_CARD_REGISTRY['sv04-125']!
    const metaZard1 = getCardFastMeta(zard)
    const metaZard2 = getCardFastMeta(structuredClone(zard))
    const metaCandy = getCardFastMeta(candy)

    expect(metaZard1.numericId).toBeGreaterThan(0)
    expect(metaZard1.numericId).toBe(metaZard2.numericId)
    expect(metaZard1.numericId).not.toBe(metaCandy.numericId)
    expect(metaZard1.normRootBasicName).toBe('salameche')
  })

  it('produces identical 53-bit numeric state hashes for commutative bench and hand permutations', () => {
    const deckA = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const deckB = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)

    const baseState = createInitialMatchState(deckA, deckB, {
      seed: 2026,
      firstPlayerIndex: 0,
      maxTurns: 18,
    })

    const boltEx = UNIFIED_CARD_REGISTRY['sv05-123']!
    const fezandipitiEx = UNIFIED_CARD_REGISTRY['sv06.5-038']!

    baseState.player.bench = []
    baseState.player.hand = [boltEx, fezandipitiEx]

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

    expect(computeNumericStateHash(stateA2)).toBe(computeNumericStateHash(stateB2))
  })

  it('encodes and clones MatchState into a contiguous Int32Array(128) buffer', () => {
    const deckA = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const deckB = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[1]!.ptcglText)

    const state = createInitialMatchState(deckA, deckB, {
      seed: 555,
      firstPlayerIndex: 0,
      maxTurns: 16,
    })

    const flatBuf = encodeStateToFlatBuffer(state)
    expect(flatBuf).toBeInstanceOf(Int32Array)
    expect(flatBuf.length).toBe(FLAT_STATE_WORD_LENGTH)
    expect(flatBuf[0]).toBe(state.turnNumber)
    expect(flatBuf[1]).toBe(16)

    const clonedBuf = cloneFlatBuffer(flatBuf)
    expect(computeFlatBufferHash(flatBuf)).toBe(computeFlatBufferHash(clonedBuf))

    clonedBuf[0] = 99
    expect(computeFlatBufferHash(flatBuf)).not.toBe(computeFlatBufferHash(clonedBuf))
  })

  it('produces identical state via in-place applyAction(mutateInPlace = true) vs cloned applyAction', () => {
    const deckA = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const deckB = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)

    const initial = createInitialMatchState(deckA, deckB, {
      seed: 888,
      firstPlayerIndex: 0,
      maxTurns: 18,
    })

    const passAction = {
      type: 'PASS_TURN' as const,
      endsTurnImmediately: true,
      label: 'Fin de tour',
    }

    const clonedOut = applyAction(initial, passAction, false, false)
    const inPlaceTarget = fastCloneState(initial, false)
    const inPlaceOut = applyAction(inPlaceTarget, passAction, false, true)

    expect(inPlaceOut).toBe(inPlaceTarget)
    expect(computeNumericStateHash(clonedOut)).toBe(computeNumericStateHash(inPlaceOut))
  })

  it('executes 100 full 3-ply games at high throughput (> 150 games/sec single-threaded)', () => {
    const deckA = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[0]!.ptcglText)
    const deckB = buildDeckModelsFromPtcgl(META_OPPONENT_DECKS[1]!.ptcglText)

    const t0 = performance.now()
    const shardRes = runSimulationShard({
      shardId: 0,
      startGameIndex: 0,
      gameCount: 100,
      baseSeed: 20260711,
      config: {
        iterations: 100,
        maxTurns: 14,
        maxBranches: 8,
        firstPlayerMode: 'ALTERNATE',
        selectedOpponentIds: [META_OPPONENT_DECKS[1]!.id],
        fixedSeed: 20260711,
      },
      playerDeckModels: deckA,
      opponentDecks: [
        {
          id: META_OPPONENT_DECKS[1]!.id,
          name: META_OPPONENT_DECKS[1]!.name,
          archetypeTag: META_OPPONENT_DECKS[1]!.archetypeBadge,
          accentColor: META_OPPONENT_DECKS[1]!.badgeColor,
          models: deckB,
        },
      ],
    })
    const elapsedMs = performance.now() - t0
    const gamesPerSec = Math.round((100 / elapsedMs) * 1000)
    console.info(`[Benchmark 3-Ply] 100 games in ${elapsedMs.toFixed(1)} ms (${gamesPerSec} games/sec single-thread)`)

    expect(shardRes.outcomes.length).toBe(100)
    expect(gamesPerSec).toBeGreaterThan(150)
  })
})
