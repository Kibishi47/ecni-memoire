/**
 * Représentation binaire plate (`Int32Array`) et Hachage Numérique Commutatif Zobrist / Murmur3 (`fastState.ts`).
 *
 * Ce module remplace les concaténations de chaînes et `.sort()` coûteux par un hachage
 * entier 53 bits déterministe et commutatif (zéro allocation mémoire sur le chemin critique),
 * ainsi qu'un encodeur binaire `Int32Array` pour les snapshots d'état ultra-rapides.
 */

import { getCardFastMeta } from '../data/cardCatalog'
import type { InPlayPokemon, MatchState, PlayerBoardState } from './engine'

const stringHashCache = new Map<string, number>()

/**
 * Mélangeur d'avalanche 32 bits (MurmurHash3 finalizer) utilisant `Math.imul`.
 */
export function mix32(k: number, seed = 0): number {
  let h = (k ^ seed) | 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * Hache une chaîne de caractères en entier 32 bits non signé avec mise en cache.
 */
export function hashStringFast(str: string): number {
  const cached = stringHashCache.get(str)
  if (cached !== undefined) return cached
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  const finalHash = mix32(h)
  stringHashCache.set(str, finalHash)
  return finalHash
}

function getSpecialConditionMask(conds?: readonly string[]): number {
  if (!conds || conds.length === 0) return 0
  let mask = 0
  for (let i = 0; i < conds.length; i++) {
    const c = conds[i]
    if (c === 'POISONED') mask |= 1
    else if (c === 'BURNED') mask |= 2
    else if (c === 'ASLEEP') mask |= 4
    else if (c === 'PARALYZED') mask |= 8
    else if (c === 'CONFUSED') mask |= 16
  }
  return mask
}

function getPokemonStatusBits(p: InPlayPokemon): number {
  return (
    (p.evolvedThisTurn ? 1 : 0) |
    (p.cantAttackNextTurn ? 2 : 0) |
    (p.cantRetreatNextTurn ? 4 : 0) |
    (p.preventDamageOrEffectsNextTurn ? 8 : 0) |
    (getSpecialConditionMask(p.specialConditions) << 4)
  )
}

/**
 * Calcule l'empreinte 32 bits d'un `InPlayPokemon` (indépendante de son `instanceId`
 * pour préserver la commutativité des placements sur le Banc).
 */
export function hashInPlayPokemon(p: InPlayPokemon): number {
  const cardIdNum = getCardFastMeta(p.card).numericId
  let h = mix32(cardIdNum, 0x13579bdf)
  h = mix32(p.damage, h)
  h = mix32(p.attachedEnergies.length, h)
  h = mix32(getPokemonStatusBits(p), h)
  const modPack =
    ((p.damageTakenModifierNextTurn || 0) & 0xfff) |
    (((p.damageDealtModifierNextTurn || 0) & 0xfff) << 12) |
    (((p.retreatCostModifier || 0) & 0xff) << 24)
  h = mix32(modPack ^ (p.hpBonus || 0), h)

  // Hachage commutatif des outils attachés
  let toolsSum = 0
  let toolsXor = 0
  for (let i = 0; i < p.attachedTools.length; i++) {
    const toolNum = getCardFastMeta(p.attachedTools[i]!).numericId
    const th = mix32(toolNum, 0x2468ace0)
    toolsSum = (toolsSum + th) | 0
    toolsXor ^= th
  }
  h = mix32(toolsSum, h)
  h = mix32(toolsXor, h)
  return h >>> 0
}

/**
 * Calcule une paire de hachages 32 bits `(h1, h2)` pour un `PlayerBoardState`.
 * Les ensembles non ordonnés (`bench`, `hand`, `usedOncePerTurnAbilities`) sont
 * combinés de manière strictement commutative (`sum` + `xor` d'entiers mélangés)
 * sans aucun tri `.sort()` ni allocation de tableau.
 */
export function computeNumericBoardHash(b: PlayerBoardState): { h1: number; h2: number } {
  const activeHash = b.activePokemon ? hashInPlayPokemon(b.activePokemon) : 0xdeadbeef

  // 1. Banc (commutatif : l'ordre de pose sur le banc ne doit pas créer de doublons d'état)
  let benchSum = 0
  let benchXor = 0
  for (let i = 0; i < b.bench.length; i++) {
    const ph = hashInPlayPokemon(b.bench[i]!)
    benchSum = (benchSum + ph) | 0
    benchXor ^= mix32(ph, 0x9e3779b9)
  }

  // 2. Main (multiset commutatif de cartes)
  let handSum = 0
  let handXor = 0
  for (let i = 0; i < b.hand.length; i++) {
    const cid = getCardFastMeta(b.hand[i]!).numericId
    const ch = mix32(cid, 0x517cc1b7)
    handSum = (handSum + ch) | 0
    handXor = (handXor + Math.imul(ch, ch | 1)) | 0
  }

  // 3. Talents utilisés ce tour (ensemble commutatif)
  let abilSum = 0
  let abilXor = 0
  if (b.usedOncePerTurnAbilities.size > 0) {
    for (const abilKey of b.usedOncePerTurnAbilities) {
      const ah = hashStringFast(abilKey)
      abilSum = (abilSum + ah) | 0
      abilXor ^= ah
    }
  }

  const flags =
    (b.supporterPlayedThisTurn ? 1 : 0) |
    ((b.energyAttachedThisTurn ? 1 : 0) << 1) |
    ((b.retreatUsedThisTurn ? 1 : 0) << 2) |
    ((b.vstarPowerUsed ? 1 : 0) << 3) |
    ((b.itemLockActive ? 1 : 0) << 4) |
    ((b.extraTurnGranted ? 1 : 0) << 5) |
    ((b.abilityLockActive ? 1 : 0) << 6) |
    ((b.stadiumPlayedThisTurn ? 1 : 0) << 7) |
    (((b.maxBenchSlotsOverride || 0) & 0xf) << 8)

  let h1 = mix32(activeHash, 0x10203040)
  h1 = mix32(benchSum, h1)
  h1 = mix32(handSum, h1)
  h1 = mix32(abilSum, h1)
  h1 = mix32(flags, h1)
  h1 = mix32((b.deck.length << 16) | (b.prizes.length << 8) | (b.discard.length & 0xff), h1)
  h1 = mix32((b.turnDamageBoost || 0) ^ (((b.lostZone?.length || 0) & 0xff) << 16), h1)

  let h2 = mix32(activeHash, 0xa5a5a5a5)
  h2 = mix32(benchXor, h2)
  h2 = mix32(handXor, h2)
  h2 = mix32(abilXor, h2)
  h2 = mix32(b.bench.length | (b.hand.length << 8) | (((b.lostZone?.length || 0) & 0xff) << 16), h2)
  h2 = mix32(flags ^ 0x5a5a, h2)

  return { h1: h1 >>> 0, h2: h2 >>> 0 }
}

/**
 * Calcule une empreinte numérique 53 bits (`Number.MAX_SAFE_INTEGER`) pour un `MatchState`.
 * Aucune allocation de chaîne ni de tableau temporaire.
 */
export function computeNumericStateHash(state: MatchState): number {
  const p = computeNumericBoardHash(state.player)
  const o = computeNumericBoardHash(state.opponent)
  const stadNum = state.activeStadium ? getCardFastMeta(state.activeStadium.card).numericId : 0
  const stadUsed = state.activeStadium?.usedThisTurn ? 1 : 0

  let h1 = mix32(p.h1, 0x11111111)
  h1 = mix32(o.h1, h1)
  h1 = mix32(state.activePlayerIndex, h1)
  h1 = mix32((stadNum << 1) | stadUsed, h1)

  let h2 = mix32(p.h2, 0x22222222)
  h2 = mix32(o.h2, h2)
  h2 = mix32(state.activePlayerIndex ^ 1, h2)
  h2 = mix32(stadNum ^ 0x3333, h2)

  // Combine h1 (32 bits) et les 21 bits de poids faible de h2 en un entier sûr 53 bits
  return (h1 >>> 0) * 2097152 + ((h2 >>> 0) & 0x1fffff)
}

/**
 * Taille fixe en mots de 32 bits (`Int32Array`) d'un buffer d'état binaire plat.
 */
export const FLAT_STATE_WORD_LENGTH = 128

/**
 * Encode un `MatchState` dans un buffer binaire plat `Int32Array(128)` orienté données (DOD).
 * Permet des copies mémoire instantanées (`new Int32Array(buf)`) et des comparaisons vectorisées.
 */
export function encodeStateToFlatBuffer(
  state: MatchState,
  target: Int32Array = new Int32Array(FLAT_STATE_WORD_LENGTH),
): Int32Array {
  target.fill(0)

  // En-tête global (mots 0..7)
  target[0] = state.turnNumber
  target[1] = state.maxTurns
  target[2] = state.activePlayerIndex
  target[3] = state.firstPlayerIndex
  target[4] = state.winner === null ? 0 : state.winner === 'PLAYER' ? 1 : state.winner === 'OPPONENT' ? 2 : 3
  target[5] = state.rngState | 0
  target[6] = state.activeStadium ? getCardFastMeta(state.activeStadium.card).numericId : 0
  target[7] = state.activeStadium?.usedThisTurn ? 1 : 0

  encodePlayerBoardToSlice(state.player, target, 8)
  encodePlayerBoardToSlice(state.opponent, target, 68)

  return target
}

function encodePlayerBoardToSlice(b: PlayerBoardState, buf: Int32Array, offset: number): void {
  buf[offset + 0] = b.deck.length
  buf[offset + 1] = b.hand.length
  buf[offset + 2] = b.prizes.length
  buf[offset + 3] = b.discard.length
  buf[offset + 4] = b.bench.length
  buf[offset + 5] =
    (b.supporterPlayedThisTurn ? 1 : 0) |
    ((b.energyAttachedThisTurn ? 1 : 0) << 1) |
    ((b.retreatUsedThisTurn ? 1 : 0) << 2) |
    ((b.vstarPowerUsed ? 1 : 0) << 3) |
    ((b.itemLockActive ? 1 : 0) << 4) |
    ((b.extraTurnGranted ? 1 : 0) << 5) |
    ((b.abilityLockActive ? 1 : 0) << 6) |
    ((b.stadiumPlayedThisTurn ? 1 : 0) << 7) |
    (((b.maxBenchSlotsOverride || 0) & 0xf) << 8)
  buf[offset + 6] = b.turnDamageBoost || 0

  // Pokémon Actif (mots offset+7 .. offset+12)
  if (b.activePokemon) {
    buf[offset + 7] =
      ((b.activePokemon.damageTakenModifierNextTurn || 0) & 0xffff) ^
      (((b.activePokemon.hpBonus || 0) & 0xffff) << 16)
    buf[offset + 8] = getCardFastMeta(b.activePokemon.card).numericId
    buf[offset + 9] = b.activePokemon.damage
    buf[offset + 10] = b.activePokemon.attachedEnergies.length
    buf[offset + 11] = getPokemonStatusBits(b.activePokemon)
    buf[offset + 12] = b.activePokemon.attachedTools[0]
      ? getCardFastMeta(b.activePokemon.attachedTools[0]).numericId
      : 0
  }

  // Banc (jusqu'à 8 emplacements * 5 mots = 40 mots, offset+13 .. offset+52)
  const maxBench = Math.min(8, b.bench.length)
  for (let i = 0; i < maxBench; i++) {
    const p = b.bench[i]!
    const base = offset + 13 + i * 5
    buf[base + 0] = getCardFastMeta(p.card).numericId
    buf[base + 1] = p.damage
    buf[base + 2] = p.attachedEnergies.length
    buf[base + 3] = getPokemonStatusBits(p)
    buf[base + 4] = p.attachedTools[0] ? getCardFastMeta(p.attachedTools[0]).numericId : 0
  }

  // Hachages de zone pré-calculés (mots offset+54 .. offset+55)
  const bh = computeNumericBoardHash(b)
  buf[offset + 54] = bh.h1 | 0
  buf[offset + 55] = bh.h2 | 0
}

/**
 * Clone un buffer plat `Int32Array` par copie mémoire native ultra-rapide.
 */
export function cloneFlatBuffer(buf: Int32Array): Int32Array {
  return new Int32Array(buf)
}

/**
 * Calcule une empreinte 53 bits directement depuis un buffer plat `Int32Array`.
 */
export function computeFlatBufferHash(buf: Int32Array): number {
  let h1 = 0x811c9dc5
  let h2 = 0x1b873593
  for (let i = 0; i < buf.length; i++) {
    h1 = mix32(buf[i]!, h1)
    h2 = mix32(buf[i]! ^ i, h2)
  }
  return (h1 >>> 0) * 2097152 + ((h2 >>> 0) & 0x1fffff)
}
