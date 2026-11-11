/**
 * Moteur de Règles Data-Driven Pokémon TCG (`src/core/engine.ts`).
 *
 * L'`Engine` ne prend aucune décision stratégique : il modélise l'état exact d'un duel
 * (Joueur vs Adversaire), applique les règles officielles (Setup, Mulligans, Récompenses,
 * Évolutions, Coûts, Effets atomiques, KOs) et détermine tous les coups légaux possibles
 * à un instant T à partir des modèles JSON `EngineCardModel` (`cards_database.json` + `fallbackCardModels.ts`).
 */

import type {
  ActionCost,
  ActionPrecondition,
  AtomicEffect,
  CardFilter,
  DeadCardCondition,
  EngineCardModel,
  PlayableAction,
  SpecialConditionType,
  ZoneType,
} from '../types/cardModel'
import { getCardFastMeta, matchesCardFilter, normalizeCardNameForMatch } from '../data/cardCatalog'
import { matchesDslFilter } from './filterDsl'
import { fisherYatesShuffle, Mulberry32 } from './prng'

export function cardMatchesEffectFilter(card: EngineCardModel, eff: AtomicEffect): boolean {
  if (eff.filter) return matchesDslFilter(card, eff.filter)
  if (eff.targetFilter) return matchesCardFilter(card, eff.targetFilter)
  return true
}

export type PlayerKey = 'PLAYER' | 'OPPONENT'
export type MatchWinner = null | 'PLAYER' | 'OPPONENT' | 'DRAW'
export type WinReason =
  | null
  | 'ALL_PRIZES_TAKEN'
  | 'NO_POKEMON_IN_PLAY'
  | 'DECK_OUT'
  | 'MAX_TURNS_REACHED'

export type DebugPerturbationType =
  | 'NONE'
  | 'FORCE_OPPONENT_IONO'
  | 'FORCE_KO_ACTIVE'
  | 'FORCE_KEY_CARD_PRIZED'

export interface InPlayPokemon {
  instanceId: string
  card: EngineCardModel
  previousStages: EngineCardModel[]
  damage: number
  attachedEnergies: EngineCardModel[]
  attachedTools: EngineCardModel[]
  turnPlayed: number
  evolvedThisTurn: boolean
  specialConditions: SpecialConditionType[]
  cantAttackNextTurn: boolean
  cantAttackTurn?: number
  cantRetreatNextTurn?: boolean
  cantRetreatTurn?: number
  preventDamageOrEffectsNextTurn?: boolean
  preventDamageOrEffectsTurn?: number
  damageTakenModifierNextTurn?: number
  damageTakenModifierTurn?: number
  damageDealtModifierNextTurn?: number
  damageDealtModifierTurn?: number
  hpBonus?: number
  retreatCostModifier?: number
}

export interface PlayerBoardState {
  deck: EngineCardModel[]
  hand: EngineCardModel[]
  prizes: EngineCardModel[]
  discard: EngineCardModel[]
  activePokemon: InPlayPokemon | null
  bench: InPlayPokemon[]
  lostZone: EngineCardModel[]
  extraTurnGranted: boolean
  itemLockActive: boolean
  abilityLockActive?: boolean
  abilityLockTurn?: number
  maxBenchSlotsOverride?: number | null
  supporterPlayedThisTurn: boolean
  energyAttachedThisTurn: boolean
  retreatUsedThisTurn: boolean
  usedOncePerTurnAbilities: Set<string>
  abilityUsageCountsThisTurn: Record<string, number>
  vstarPowerUsed: boolean
  koSufferedLastOpponentTurn: boolean
  mulliganCount: number
  initialHandSnapshot: string[]
  initialPrizesSnapshot: string[]
  prizesKnownByPlayer: boolean
  firstSearchTurn: number | null
  turnDamageBoost?: number
}

export type ActiveStadiumState = { card: EngineCardModel; ownerIndex: 0 | 1; usedThisTurn: boolean }

export interface MatchState {
  player: PlayerBoardState
  opponent: PlayerBoardState
  turnNumber: number
  maxTurns: number
  activePlayerIndex: 0 | 1
  firstPlayerIndex: 0 | 1
  winner: MatchWinner
  winReason: WinReason
  rngState: number
  nextInstanceSeq: number
  lastActionLog: string[]
  activeStadium: ActiveStadiumState | null
}

export type GameActionType =
  | 'PUT_BASIC_ON_BENCH'
  | 'ATTACH_MANUAL_ENERGY'
  | 'NORMAL_EVOLVE'
  | 'RETREAT_ACTIVE'
  | 'PLAY_TRAINER'
  | 'USE_ABILITY'
  | 'DECLARE_ATTACK'
  | 'PASS_TURN'

export interface GameAction {
  type: GameActionType
  label: string
  cardId?: string
  actionId?: string
  handIndex?: number
  sourceSlot?: 'ACTIVE' | number
  targetSlot?: 'ACTIVE' | number
  targetBenchIndex?: number
  targetCardIds?: string[]
  discardCardIds?: string[]
  estimatedDamage?: number
  endsTurnImmediately?: boolean
}

export interface CreateMatchOptions {
  seed: number
  firstPlayerIndex: 0 | 1
  maxTurns: number
  perturbationType?: DebugPerturbationType
  perturbationTurn?: number
}

const energyTypeNormCache = new Map<string, string>()

/**
 * Normalise un type d'énergie (Français / Anglais / Abrégé).
 */
export function normalizeEnergyType(type: string): string {
  const cached = energyTypeNormCache.get(type)
  if (cached !== undefined) return cached
  const norm = normalizeCardNameForMatch(type)
  let res = 'incolore'
  if (norm === 'feu' || norm === 'fire' || norm === 'r') res = 'feu'
  else if (norm === 'eau' || norm === 'water' || norm === 'w') res = 'eau'
  else if (norm === 'plante' || norm === 'grass' || norm === 'g') res = 'plante'
  else if (norm === 'electrique' || norm === 'electrik' || norm === 'lightning' || norm === 'l') res = 'electrique'
  else if (norm === 'psy' || norm === 'psychic' || norm === 'p') res = 'psy'
  else if (norm === 'combat' || norm === 'fighting' || norm === 'f') res = 'combat'
  else if (norm === 'obscurite' || norm === 'darkness' || norm === 'dark' || norm === 'd') res = 'obscurite'
  else if (norm === 'metal' || norm === 'm') res = 'metal'
  else if (norm === 'fee' || norm === 'fairy' || norm === 'y') res = 'fee'
  energyTypeNormCache.set(type, res)
  return res
}

interface ParsedEnergyCost {
  totalRequired: number
  colorlessRequired: number
  specificPairs: Array<[string, number]>
}

const parsedEnergyCostCache = new WeakMap<object, ParsedEnergyCost>()

function getParsedEnergyCost(energyCost: Record<string, number> | string[]): ParsedEnergyCost {
  const cached = parsedEnergyCostCache.get(energyCost)
  if (cached !== undefined) return cached

  let totalRequired = 0
  let colorlessRequired = 0
  const specificMap = new Map<string, number>()

  if (Array.isArray(energyCost)) {
    for (let i = 0; i < energyCost.length; i++) {
      const norm = normalizeEnergyType(energyCost[i]!)
      totalRequired++
      if (norm === 'incolore') {
        colorlessRequired++
      } else {
        specificMap.set(norm, (specificMap.get(norm) || 0) + 1)
      }
    }
  } else {
    for (const [k, count] of Object.entries(energyCost)) {
      const c = Number(count) || 0
      if (c <= 0) continue
      const norm = normalizeEnergyType(k)
      totalRequired += c
      if (norm === 'incolore') {
        colorlessRequired += c
      } else {
        specificMap.set(norm, (specificMap.get(norm) || 0) + c)
      }
    }
  }

  const parsed: ParsedEnergyCost = {
    totalRequired,
    colorlessRequired,
    specificPairs: Array.from(specificMap.entries()),
  }
  parsedEnergyCostCache.set(energyCost, parsed)
  return parsed
}

/**
 * Résout le coût énergétique complet d'une attaque ou d'un talent (multi-type et incolore).
 * Optimisé zéro allocation : utilise `getCardFastMeta` et `ParsedEnergyCost` mis en cache.
 */
export function canPayEnergyCost(
  attachedEnergies: EngineCardModel[],
  energyCost?: Record<string, number> | string[],
): boolean {
  if (!energyCost) return true
  const parsed = getParsedEnergyCost(energyCost)
  if (parsed.totalRequired === 0) return true
  if (attachedEnergies.length === 0) return false

  let totalUnits = 0
  let wildcardCount = 0

  for (let i = 0; i < attachedEnergies.length; i++) {
    const meta = getCardFastMeta(attachedEnergies[i]!)
    if (meta.energyUnitKind === 'DOUBLE_TURBO') {
      totalUnits += 2
    } else if (meta.energyUnitKind === 'WILDCARD') {
      totalUnits += 1
      wildcardCount += 1
    } else {
      totalUnits += 1
    }
  }

  if (totalUnits < parsed.totalRequired) return false
  if (parsed.specificPairs.length === 0) return true

  let wildcardsNeeded = 0
  for (let s = 0; s < parsed.specificPairs.length; s++) {
    const [reqType, reqCount] = parsed.specificPairs[s]!
    let haveExact = 0
    for (let i = 0; i < attachedEnergies.length; i++) {
      const meta = getCardFastMeta(attachedEnergies[i]!)
      if (meta.energyUnitKind === 'SINGLE' && meta.energyProvidedType === reqType) {
        haveExact++
      }
    }
    if (haveExact < reqCount) {
      wildcardsNeeded += reqCount - haveExact
      if (wildcardsNeeded > wildcardCount) return false
    }
  }

  return true
}

/**
 * Calcule le coût énergétique effectif d'une attaque, en intégrant les réductions
 * de coût conditionnelles (ex: Compétence Maîtrisée d'Ursaking Lune Vermeille-ex sv06-141).
 */
export function getEffectiveAttackCost(
  attacker: InPlayPokemon,
  action: PlayableAction,
  state: MatchState,
  passiveBoard?: PlayerBoardState,
): Record<string, number> {
  const baseCost: Record<string, number> = {}

  if (action.cost && typeof action.cost === 'object' && Object.keys(action.cost).length > 0) {
    for (const [k, v] of Object.entries(action.cost)) {
      baseCost[k] = Number(v) || 0
    }
  } else if (action.energyCost && typeof action.energyCost === 'object') {
    if (Array.isArray(action.energyCost)) {
      for (const t of action.energyCost) {
        baseCost[t] = (baseCost[t] || 0) + 1
      }
    } else {
      for (const [k, v] of Object.entries(action.energyCost)) {
        baseCost[k] = Number(v) || 0
      }
    }
  } else if ((attacker.card.pokemonStats as any)?.attacks) {
    const matchedAtk = (attacker.card.pokemonStats as any).attacks.find(
      (a: any) => a.actionId === action.actionId || a.name === action.label || a.nameFr === action.label,
    )
    if (matchedAtk) {
      if (matchedAtk.cost && typeof matchedAtk.cost === 'object') {
        for (const [k, v] of Object.entries(matchedAtk.cost)) {
          baseCost[k] = Number(v) || 0
        }
      } else if (matchedAtk.energyCost) {
        if (Array.isArray(matchedAtk.energyCost)) {
          for (const t of matchedAtk.energyCost) {
            baseCost[t] = (baseCost[t] || 0) + 1
          }
        }
      }
    }
  }

  // Talent Compétence Maîtrisée (Ursaking Lune Vermeille-ex / Bloodmoon Ursaluna ex sv06-141)
  // Lune Rouge coûte {C} de moins pour chaque carte Récompense que votre adversaire a récupérée.
  if (
    (attacker.card.cardId === 'sv06-141' ||
      /ursaking.*lune vermeille|bloodmoon.*ursaluna/i.test(attacker.card.identity.nameFr)) &&
    /lune rouge|blood moon/i.test(`${action.label || ''} ${action.actionId || ''}`)
  ) {
    const oppBoard =
      passiveBoard ||
      (state.activePlayerIndex === 0 ? state.opponent : state.player)
    const prizesTaken = Math.max(0, 6 - (oppBoard.prizes?.length ?? 6))
    for (const [k, v] of Object.entries(baseCost)) {
      if (normalizeEnergyType(k) === 'incolore') {
        baseCost[k] = Math.max(0, v - prizesTaken)
      }
    }
  }

  return baseCost
}

/**
 * Détermine si un Pokémon est actuellement bloqué et dans l'incapacité totale d'attaquer.
 * Vérifie :
 * - Les états spéciaux Sommeil (ASLEEP) et Paralysie (PARALYZED)
 * - Les verrous d'attaque "Pendant votre prochain tour, ce Pokémon ne peut pas attaquer" (cantAttackNextTurn)
 */
export function isPokemonAttackBlocked(
  poke: InPlayPokemon | null | undefined,
  state: MatchState,
): boolean {
  if (!poke) return true
  const conditions = poke.specialConditions || []
  if (conditions.includes('ASLEEP') || conditions.includes('PARALYZED')) {
    return true
  }
  if (poke.cantAttackNextTurn) {
    if (poke.cantAttackTurn === undefined || poke.cantAttackTurn === state.turnNumber) {
      return true
    }
  }
  return false
}

export function isJammingTowerActive(state?: MatchState): boolean {
  if (!state?.activeStadium) return false
  return getCardFastMeta(state.activeStadium.card).isJammingTowerStadium
}

export function isAbilityLockedByPassive(
  state: MatchState,
  poke: InPlayPokemon,
  ownerBoard: PlayerBoardState,
): boolean {
  if (ownerBoard.abilityLockActive) return true

  if (state.activeStadium) {
    const stadMeta = getCardFastMeta(state.activeStadium.card)
    if (stadMeta.hasLockAbilitiesPassive) {
      // Tour d'Observation de la Team Rocket : bloque les talents des Pokémon Incolores
      if (stadMeta.normCombinedName.includes('team rocket') || stadMeta.normCombinedName.includes('observation')) {
        if (getCardFastMeta(poke.card).normPokeTypes.includes('incolore')) {
          return true
        }
      } else {
        return true
      }
    }
  }

  const oppBoard = state.player === ownerBoard ? state.opponent : state.player
  const oppActive = oppBoard.activePokemon
  if (oppActive) {
    const oppMeta = getCardFastMeta(oppActive.card)
    if (oppMeta.hasLockAbilitiesPassive) {
      // Épine-de-Fer-ex : bloque les talents des Pokémon à Règle non-Futur
      if (oppActive.card.cardId === 'sv06-077' || oppActive.card.cardId === 'sv06-196') {
        const targetIsRuleBox = Boolean(poke.card.identity.isRuleBox || poke.card.pokemonStats?.isRuleBox)
        const targetIsFuture = Boolean(poke.card.identity.isFuture || poke.card.pokemonStats?.isFuture)
        if (targetIsRuleBox && !targetIsFuture) return true
      } else {
        return true
      }
    }
  }

  return false
}

export function hasEffectiveItemLock(state: MatchState, targetBoard: PlayerBoardState): boolean {
  if (targetBoard.itemLockActive) return true
  const oppBoard = state.player === targetBoard ? state.opponent : state.player
  if (oppBoard.activePokemon && getCardFastMeta(oppBoard.activePokemon.card).hasLockItemsPassive) {
    if (!isAbilityLockedByPassive(state, oppBoard.activePokemon, oppBoard)) return true
  }
  for (const b of oppBoard.bench) {
    if (getCardFastMeta(b.card).hasLockItemsPassive && !isAbilityLockedByPassive(state, b, oppBoard)) {
      return true
    }
  }
  return false
}

export function isBenchProtectedByPassive(
  state: MatchState,
  defenderBoard: PlayerBoardState,
): boolean {
  const allDefenderPokes = [
    ...(defenderBoard.activePokemon ? [defenderBoard.activePokemon] : []),
    ...defenderBoard.bench,
  ]
  for (const p of allDefenderPokes) {
    const meta = getCardFastMeta(p.card)
    if (meta.protectsBenchFromDamage && !isAbilityLockedByPassive(state, p, defenderBoard)) {
      return true
    }
  }
  return false
}

/**
 * Calcule le coût de retraite effectif d'un Pokémon, en tenant compte des talents en jeu
 * (ex: Taxi Aérien / Skyliner de Latias-ex sv08-076), des Outils (Ballon, Planche de Sauvetage),
 * et des effets temporaires `MODIFY_RETREAT_COST`.
 */
export function getPokemonRetreatCost(
  poke: InPlayPokemon,
  board: PlayerBoardState,
  state?: MatchState,
): number {
  let cost = poke.card.pokemonStats?.retreatCost ?? 1
  const pokeMeta = getCardFastMeta(poke.card)

  if (poke.card.subCategory === 'BASIC') {
    const hasLatias =
      (board.activePokemon &&
        (board.activePokemon.card.cardId === 'sv08-076' ||
          /latias.*ex/i.test(board.activePokemon.card.identity.nameFr))) ||
      board.bench.some(
        (b) => b.card.cardId === 'sv08-076' || /latias.*ex/i.test(b.card.identity.nameFr),
      )
    if (hasLatias) {
      const latiasPoke =
        board.activePokemon &&
        (board.activePokemon.card.cardId === 'sv08-076' || /latias.*ex/i.test(board.activePokemon.card.identity.nameFr))
          ? board.activePokemon
          : board.bench.find(
              (b) => b.card.cardId === 'sv08-076' || /latias.*ex/i.test(b.card.identity.nameFr),
            )
      if (!state || !latiasPoke || !isAbilityLockedByPassive(state, latiasPoke, board)) {
        return 0
      }
    }
  }

  if (pokeMeta.setsZeroRetreatWhenNoEnergy && (poke.attachedEnergies?.length || 0) === 0) {
    if (!state || !isAbilityLockedByPassive(state, poke, board)) {
      return 0
    }
  }

  if (pokeMeta.retreatCostDelta !== 0) {
    if (!state || !isAbilityLockedByPassive(state, poke, board)) {
      cost += pokeMeta.retreatCostDelta
    }
  }

  // Outils attachés (désactivés par Tour de Brouillage)
  const attachedTools = poke.attachedTools || []
  if (!isJammingTowerActive(state) && attachedTools.length > 0) {
    for (const tool of attachedTools) {
      const toolMeta = getCardFastMeta(tool)
      if (tool.cardId === 'sv05-159' || tool.cardId === 'sv06-225') {
        if (getPokemonMaxHp(poke, state) - poke.damage <= 30) {
          return 0
        }
        cost -= 1
      } else {
        cost += toolMeta.retreatCostDelta
        for (const act of tool.playableActions) {
          for (const eff of act.effects) {
            if (eff.primitive === 'MODIFY_RETREAT_COST' && typeof eff.value === 'number' && eff.value > 0) {
              cost += eff.value
            }
          }
        }
      }
    }
  }

  // Modificateur passif adverse (ex: Méga-Lugulabre-ex +1) ou stade (ex: Hôtel -1)
  if (state) {
    const oppBoard = state.player === board ? state.opponent : state.player
    if (oppBoard.activePokemon && !isAbilityLockedByPassive(state, oppBoard.activePokemon, oppBoard)) {
      for (const act of oppBoard.activePokemon.card.playableActions) {
        if (act.actionType === 'PASSIVE_ABILITY') {
          for (const eff of act.effects) {
            if (
              eff.primitive === 'MODIFY_RETREAT_COST' &&
              eff.target === 'OPPONENT_ACTIVE' &&
              typeof eff.value === 'number'
            ) {
              cost += eff.value
            }
          }
        }
      }
    }
    if (state.activeStadium) {
      for (const act of state.activeStadium.card.playableActions) {
        for (const eff of act.effects) {
          if (eff.primitive === 'MODIFY_RETREAT_COST' && typeof eff.value === 'number') {
            cost += eff.value
          }
        }
      }
    }
  }

  cost += poke.retreatCostModifier || 0
  return Math.max(0, cost)
}

/**
 * Calcule la capacité maximale de Banc (5 par défaut, 8 avec Abîme Zéro + Téracristal en jeu ou `maxBenchSlotsOverride`).
 */
export function getMaxBenchSlots(
  board: PlayerBoardState,
  activeStadium: MatchState['activeStadium'],
): number {
  let maxSlots = board.maxBenchSlotsOverride ?? 5
  if (activeStadium && getCardFastMeta(activeStadium.card).expandsBenchToEight) {
    const hasTera = Boolean(
      board.activePokemon?.card.pokemonStats?.isTera ||
        board.bench.some((p) => p.card.pokemonStats?.isTera),
    )
    if (hasTera || !getCardFastMeta(activeStadium.card).isAreaZeroStadium) {
      maxSlots = Math.max(maxSlots, 8)
    }
  }
  return maxSlots
}

/**
 * Réduit le banc à sa capacité max si elle a diminué (défausse les Pokémon excédentaires).
 */
export function enforceBenchCapacity(board: PlayerBoardState, maxSlots: number): void {
  while (board.bench.length > maxSlots) {
    const excess = board.bench.pop()
    if (excess) {
      board.discard.push(excess.card)
      for (const st of excess.previousStages) board.discard.push(st)
      for (const en of excess.attachedEnergies) board.discard.push(en)
      for (const tool of excess.attachedTools) board.discard.push(tool)
    }
  }
}

/**
 * Clone profond ultra-rapide d'un `InPlayPokemon`.
 */
export function cloneInPlayPokemon(p: InPlayPokemon): InPlayPokemon {
  return {
    instanceId: p.instanceId,
    card: p.card,
    previousStages: p.previousStages.slice(),
    damage: p.damage,
    attachedEnergies: p.attachedEnergies.slice(),
    attachedTools: p.attachedTools.slice(),
    turnPlayed: p.turnPlayed,
    evolvedThisTurn: p.evolvedThisTurn,
    specialConditions: p.specialConditions ? p.specialConditions.slice() : [],
    cantAttackNextTurn: p.cantAttackNextTurn ?? false,
    cantAttackTurn: p.cantAttackTurn,
    cantRetreatNextTurn: p.cantRetreatNextTurn ?? false,
    cantRetreatTurn: p.cantRetreatTurn,
    preventDamageOrEffectsNextTurn: p.preventDamageOrEffectsNextTurn ?? false,
    preventDamageOrEffectsTurn: p.preventDamageOrEffectsTurn,
    damageTakenModifierNextTurn: p.damageTakenModifierNextTurn ?? 0,
    damageTakenModifierTurn: p.damageTakenModifierTurn,
    damageDealtModifierNextTurn: p.damageDealtModifierNextTurn ?? 0,
    damageDealtModifierTurn: p.damageDealtModifierTurn,
    hpBonus: p.hpBonus ?? 0,
    retreatCostModifier: p.retreatCostModifier ?? 0,
  }
}

/**
 * Clone profond ultra-rapide d'un `PlayerBoardState`.
 */
export function clonePlayerBoard(b: PlayerBoardState): PlayerBoardState {
  return {
    deck: b.deck.slice(),
    hand: b.hand.slice(),
    prizes: b.prizes.slice(),
    discard: b.discard.slice(),
    activePokemon: b.activePokemon ? cloneInPlayPokemon(b.activePokemon) : null,
    bench: b.bench.map(cloneInPlayPokemon),
    lostZone: b.lostZone ? b.lostZone.slice() : [],
    extraTurnGranted: b.extraTurnGranted ?? false,
    itemLockActive: b.itemLockActive ?? false,
    abilityLockActive: b.abilityLockActive ?? false,
    abilityLockTurn: b.abilityLockTurn,
    maxBenchSlotsOverride: b.maxBenchSlotsOverride ?? null,
    supporterPlayedThisTurn: b.supporterPlayedThisTurn,
    energyAttachedThisTurn: b.energyAttachedThisTurn,
    retreatUsedThisTurn: b.retreatUsedThisTurn,
    usedOncePerTurnAbilities: new Set(b.usedOncePerTurnAbilities),
    abilityUsageCountsThisTurn: b.abilityUsageCountsThisTurn ? { ...b.abilityUsageCountsThisTurn } : {},
    vstarPowerUsed: b.vstarPowerUsed,
    koSufferedLastOpponentTurn: b.koSufferedLastOpponentTurn,
    mulliganCount: b.mulliganCount,
    initialHandSnapshot: b.initialHandSnapshot,
    initialPrizesSnapshot: b.initialPrizesSnapshot,
    prizesKnownByPlayer: b.prizesKnownByPlayer,
    firstSearchTurn: b.firstSearchTurn,
    turnDamageBoost: b.turnDamageBoost ?? 0,
  }
}

/**
 * Clone superficiel ultra-rapide d'un `MatchState` (`fastCloneState`).
 * Ne clone pas les modèles de cartes immuables et n'alloue l'historique d'actions que si demandé.
 */
export function fastCloneState(state: MatchState, includeActionLog = false): MatchState {
  return {
    player: clonePlayerBoard(state.player),
    opponent: clonePlayerBoard(state.opponent),
    turnNumber: state.turnNumber,
    maxTurns: state.maxTurns,
    activePlayerIndex: state.activePlayerIndex,
    firstPlayerIndex: state.firstPlayerIndex,
    winner: state.winner,
    winReason: state.winReason,
    rngState: state.rngState,
    nextInstanceSeq: state.nextInstanceSeq,
    lastActionLog: includeActionLog ? state.lastActionLog.slice() : [],
    activeStadium: state.activeStadium
      ? {
          card: state.activeStadium.card,
          ownerIndex: state.activeStadium.ownerIndex,
          usedThisTurn: state.activeStadium.usedThisTurn,
        }
      : null,
  }
}

/**
 * Clone profond de compatibilité d'un `MatchState`.
 */
export function cloneMatchState(state: MatchState): MatchState {
  return fastCloneState(state, true)
}

export function getActiveBoard(state: MatchState): PlayerBoardState {
  return state.activePlayerIndex === 0 ? state.player : state.opponent
}

export function getPassiveBoard(state: MatchState): PlayerBoardState {
  return state.activePlayerIndex === 0 ? state.opponent : state.player
}

export function getPokemonMaxHp(poke: InPlayPokemon, state?: MatchState): number {
  const baseHp = poke.card.pokemonStats?.hp ?? 70
  let bonusHp = poke.hpBonus || 0

  if (!isJammingTowerActive(state) && poke.attachedTools.length > 0) {
    for (let i = 0; i < poke.attachedTools.length; i++) {
      const tool = poke.attachedTools[i]!
      const toolMeta = getCardFastMeta(tool)
      if (toolMeta.isBraveryCharm) {
        if (poke.card.subCategory === 'BASIC') bonusHp += 50
      } else if (toolMeta.hpBonusValue > 0) {
        bonusHp += toolMeta.hpBonusValue
      }
    }
  }

  return baseHp + bonusHp
}

export function getRemainingHp(poke: InPlayPokemon, state?: MatchState): number {
  return Math.max(0, getPokemonMaxHp(poke, state) - poke.damage)
}

/**
 * Vérifie si un Pokémon en jeu peut évoluer en `evoCard`.
 */
export function canPokemonEvolveInto(
  poke: InPlayPokemon,
  evoCard: EngineCardModel,
  currentTurnNumber: number,
  allowRareCandySkipStage1 = false,
): boolean {
  if (poke.evolvedThisTurn) return false
  if (poke.turnPlayed >= currentTurnNumber) return false
  if (evoCard.category !== 'POKEMON' || !evoCard.pokemonStats) return false

  const pokeMeta = getCardFastMeta(poke.card)
  const evoMeta = getCardFastMeta(evoCard)

  if (allowRareCandySkipStage1) {
    if (poke.card.subCategory !== 'BASIC' || evoCard.subCategory !== 'STAGE_2') {
      return false
    }
    const rootNorm = evoMeta.normRootBasicName
    return Boolean(
      rootNorm && (rootNorm === pokeMeta.normNameFr || rootNorm === pokeMeta.normNameEn),
    )
  }

  if (evoCard.subCategory !== 'STAGE_1' && evoCard.subCategory !== 'STAGE_2') {
    return false
  }
  const evolvesFromNorm = evoMeta.normEvolvesFrom
  return Boolean(
    evolvesFromNorm &&
      (evolvesFromNorm === pokeMeta.normNameFr || evolvesFromNorm === pokeMeta.normNameEn),
  )
}

/**
 * Vérifie si un Pokémon possède les énergies requises pour une précondition `SELF_HAS_ENERGY_COST`.
 */
export function hasRequiredEnergyForPrecondition(
  poke: InPlayPokemon,
  pre: ActionPrecondition | string,
  action?: PlayableAction,
): boolean {
  if (action?.cost && Object.keys(action.cost).length > 0) {
    return canPayEnergyCost(poke.attachedEnergies, action.cost)
  }
  if (action?.energyCost && action.energyCost.length > 0) {
    return canPayEnergyCost(poke.attachedEnergies, action.energyCost)
  }
  const minCount = typeof pre === 'object' ? pre.minCount || 1 : 1
  if (poke.attachedEnergies.length < minCount) {
    return false
  }
  const reqType = typeof pre === 'object' ? pre.targetFilter?.energyType : null
  if (!reqType) return true
  const normReq = normalizeEnergyType(reqType)
  if (normReq === 'incolore') {
    return poke.attachedEnergies.length >= minCount
  }
  return canPayEnergyCost(poke.attachedEnergies, { [normReq]: minCount })
}

/**
 * Détermine si un Pokémon Actif peut attaquer 2 fois durant ce tour
 * (ex: Talent "Fête Battante" / "Festival Lead" de Pomdramour ou Poissoroy lorsqu'un Stade est en jeu).
 */
export function canPokemonAttackTwice(poke: InPlayPokemon | null, state: MatchState): boolean {
  if (!poke || !state.activeStadium) return false
  return getCardFastMeta(poke.card).canAttackTwiceStatic
}

/**
 * Détermine si une attaque est une attaque à 0 énergie infligeant un Item-Lock (ex: Pollen Démangeant de Rozbouton / Budew).
 */
export function isZeroEnergyItemLockAttack(action: PlayableAction): boolean {
  if (action.actionType !== 'ATTACK' && action.sourceType !== 'ATTACK') return false
  const hasCostObj = action.cost && Object.keys(action.cost).length > 0
  const hasCostArr = action.energyCost && action.energyCost.length > 0
  const hasPreCost = action.preconditions.some(
    (p: any) =>
      (typeof p === 'string' ? p : p.type) === 'SELF_HAS_ENERGY_COST' &&
      ((p as any).minCount || 0) > 0,
  )
  if (hasCostObj || hasCostArr || hasPreCost) return false

  return (
    action.effects.some(
      (e) =>
        e.primitive === 'LOCK_ITEMS' ||
        e.primitive === 'APPLY_SPECIAL_CONDITION' ||
        (e.primitive as any) === 'PASSIVE_ABILITY_OR_ITEM_LOCK',
    ) ||
    /pollen_demangeant|pollen démangeant|itchy_pollen|itchy pollen|item_lock/i.test(
      `${action.actionId} ${action.label}`,
    )
  )
}

function areConditionalBonusPreconditionsMet(
  action: PlayableAction,
  attackerBoard: PlayerBoardState,
  defenderBoard: PlayerBoardState,
  state?: MatchState,
): boolean {
  const attacker = attackerBoard.activePokemon
  const defender = defenderBoard.activePokemon
  if (!attacker || !defender) return false

  let sawExplicitCondition = false
  for (const rawPre of action.preconditions || []) {
    const p = (typeof rawPre === 'string' ? rawPre : (rawPre as any)?.type || '').trim().toUpperCase()
    if (!p || p === 'SELF_IS_ACTIVE' || p === 'ATTACK_PHASE' || p === 'NOT_FIRST_TURN' || p === 'OPPONENT_TURN') {
      continue
    }
    sawExplicitCondition = true
    if (p === 'OPPONENT_CAUSED_KO_LAST_TURN' || p === 'KO_SUFFERED_LAST_TURN') {
      if (!attackerBoard.koSufferedLastOpponentTurn) return false
    } else if (p === 'OPPONENT_ACTIVE_HAS_DAMAGE') {
      if (defender.damage <= 0) return false
    } else if (p === 'OPPONENT_ACTIVE_IS_EX_OR_V' || p === 'OPPONENT_ACTIVE_IS_RULE_BOX') {
      if (!defender.card.pokemonStats?.isRuleBox && !defender.card.identity.isRuleBox) return false
    } else if (p === 'OPPONENT_ACTIVE_IS_BURNED') {
      if (!defender.specialConditions.includes('BURNED')) return false
    } else if (p === 'OPPONENT_ACTIVE_IS_POISONED') {
      if (!defender.specialConditions.includes('POISONED')) return false
    } else if (p === 'OPPONENT_ACTIVE_HAS_SPECIAL_CONDITION') {
      if (defender.specialConditions.length === 0) return false
    } else if (p === 'HAND_IS_EMPTY') {
      if (attackerBoard.hand.length !== 0) return false
    } else if (p === 'BENCH_POKEMON_HAS_DAMAGE' || p === 'BENCH_HAS_POKEMON_WITH_DAMAGE') {
      if (!attackerBoard.bench.some((b) => b.damage > 0)) return false
    } else if (p === 'STADIUM_IN_PLAY') {
      if (!state?.activeStadium) return false
    } else if (p.startsWith('OPPONENT_PRIZES_EQUAL:')) {
      const n = parseInt(p.split(':')[1] || '6', 10)
      if (defenderBoard.prizes.length !== n) return false
    } else if (p === 'ATTACHED_ENERGY_LIGHTNING') {
      if (!attacker.attachedEnergies.some((e) => getCardFastMeta(e).energyProvidedType === 'electrique')) {
        return false
      }
    }
  }
  return sawExplicitCondition
}

function resolveEffectScalingUnits(
  metric: string,
  eff: AtomicEffect,
  action: PlayableAction,
  attackerBoard: PlayerBoardState,
  defenderBoard: PlayerBoardState,
  state?: MatchState,
): { units: number; discardedEnergy: number } {
  const attacker = attackerBoard.activePokemon!
  const defender = defenderBoard.activePokemon!
  const stepDmg = Math.max(1, eff.bonusValue ?? eff.value ?? eff.baseDamage ?? 10)

  switch (metric) {
    case 'PER_ENERGY_ON_SELF':
      return { units: attacker.attachedEnergies.length, discardedEnergy: 0 }
    case 'PER_ENERGY_ON_OPPONENT_ACTIVE':
      return { units: defender.attachedEnergies.length, discardedEnergy: 0 }
    case 'PER_ENERGY_ON_BOTH_ACTIVES':
      return {
        units: attacker.attachedEnergies.length + defender.attachedEnergies.length,
        discardedEnergy: 0,
      }
    case 'PER_ENERGY_IN_PLAY':
      return {
        units: countMatchingEnergiesInPlay(attackerBoard) + countMatchingEnergiesInPlay(defenderBoard),
        discardedEnergy: 0,
      }
    case 'PER_ENERGY_DISCARDED': {
      const filterObj: CardFilter = eff.targetFilter ||
        (eff.filter && !eff.filter.includes('SPECIAL_RULE')
          ? { category: 'ENERGY', subCategory: eff.filter.includes('BASIC') ? 'BASIC_ENERGY' : undefined }
          : { category: 'ENERGY', subCategory: 'BASIC_ENERGY' })
      const discardEff = action.effects.find((other) => other.primitive === 'DISCARD_CARDS')
      const fromHand = discardEff?.sourceZone === 'HAND' || eff.sourceZone === 'HAND'
      const availableEnergies = fromHand
        ? attackerBoard.hand.filter((c) => matchesCardFilter(c, filterObj)).length
        : countMatchingEnergiesInPlay(attackerBoard, filterObj)
      if (availableEnergies <= 0) return { units: 0, discardedEnergy: 0 }
      const defHpLeft = getRemainingHp(defender, state)
      const neededCards = Math.max(1, Math.ceil(defHpLeft / stepDmg))
      const chosenDiscard = Math.min(availableEnergies, Math.max(1, neededCards))
      return { units: chosenDiscard, discardedEnergy: fromHand ? 0 : chosenDiscard }
    }
    case 'PER_DAMAGE_COUNTER_ON_SELF':
      return { units: Math.floor(attacker.damage / 10), discardedEnergy: 0 }
    case 'PER_DAMAGE_COUNTER_ON_OPPONENT_ACTIVE':
      return { units: Math.floor(defender.damage / 10), discardedEnergy: 0 }
    case 'PER_BENCHED_POKEMON_WITH_DAMAGE': {
      const hasOpp = action.preconditions.some((p) => String(p).toUpperCase().includes('OPPONENT'))
      const pool = hasOpp ? defenderBoard.bench : attackerBoard.bench
      return { units: pool.filter((b) => b.damage > 0).length, discardedEnergy: 0 }
    }
    case 'PER_OWN_BENCH_POKEMON':
      return { units: attackerBoard.bench.length, discardedEnergy: 0 }
    case 'PER_OPPONENT_BENCH_POKEMON':
      return { units: defenderBoard.bench.length, discardedEnergy: 0 }
    case 'PER_BOTH_BENCH_POKEMON':
      return {
        units: attackerBoard.bench.length + defenderBoard.bench.length,
        discardedEnergy: 0,
      }
    case 'PER_PRIZE_TAKEN_BY_OPPONENT':
      return { units: Math.max(0, 6 - defenderBoard.prizes.length), discardedEnergy: 0 }
    case 'PER_PRIZE_TAKEN_BY_PLAYER':
      return { units: Math.max(0, 6 - attackerBoard.prizes.length), discardedEnergy: 0 }
    case 'PER_PRIZE_REMAINING_PLAYER':
      return { units: attackerBoard.prizes.length, discardedEnergy: 0 }
    case 'PER_CARD_IN_OWN_HAND':
      return { units: attackerBoard.hand.length, discardedEnergy: 0 }
    case 'PER_CARD_IN_OPPONENT_HAND':
      return { units: defenderBoard.hand.length, discardedEnergy: 0 }
    case 'CONDITIONAL_FLAT_BONUS':
      return {
        units: areConditionalBonusPreconditionsMet(action, attackerBoard, defenderBoard, state) ? 1 : 0,
        discardedEnergy: 0,
      }
    default:
      return { units: 0, discardedEnergy: 0 }
  }
}

function flipCoinHeadsCount(
  mode: string,
  coinCount: number,
  rng?: Mulberry32,
): { heads: number; hit: boolean; twoTails: boolean } {
  if (!rng) {
    // Espérance mathématique exacte (évaluateur 3-ply sans mutation PRNG)
    if (mode === 'SINGLE_HEADS_REQUIRED') {
      const prob = Math.pow(0.5, Math.max(1, coinCount))
      return { heads: prob, hit: true, twoTails: false }
    }
    if (mode === 'SINGLE_HEADS_BONUS') return { heads: 0.5, hit: true, twoTails: false }
    if (mode === 'MULTI_COIN_PER_HEADS') return { heads: Math.max(1, coinCount) * 0.5, hit: true, twoTails: false }
    if (mode === 'UNTIL_TAILS_PER_HEADS') return { heads: 1.0, hit: true, twoTails: false }
    if (mode === 'TWO_TAILS_SELF_DAMAGE') return { heads: 1, hit: true, twoTails: false }
    return { heads: 1, hit: true, twoTails: false }
  }

  if (mode === 'SINGLE_HEADS_REQUIRED') {
    const flips = Math.max(1, coinCount)
    let allHeads = true
    for (let i = 0; i < flips; i++) {
      if (rng.nextFloat() >= 0.5) {
        allHeads = false
      }
    }
    return { heads: allHeads ? 1 : 0, hit: allHeads, twoTails: false }
  }
  if (mode === 'SINGLE_HEADS_BONUS') {
    const isHeads = rng.nextFloat() < 0.5
    return { heads: isHeads ? 1 : 0, hit: isHeads, twoTails: false }
  }
  if (mode === 'MULTI_COIN_PER_HEADS') {
    const flips = Math.max(1, coinCount)
    let heads = 0
    for (let i = 0; i < flips; i++) {
      if (rng.nextFloat() < 0.5) heads++
    }
    return { heads, hit: heads > 0, twoTails: false }
  }
  if (mode === 'UNTIL_TAILS_PER_HEADS') {
    let heads = 0
    for (let i = 0; i < 20; i++) {
      if (rng.nextFloat() < 0.5) heads++
      else break
    }
    return { heads, hit: heads > 0, twoTails: false }
  }
  if (mode === 'TWO_TAILS_SELF_DAMAGE') {
    const f1 = rng.nextFloat() < 0.5
    const f2 = rng.nextFloat() < 0.5
    return { heads: (f1 ? 1 : 0) + (f2 ? 1 : 0), hit: true, twoTails: !f1 && !f2 }
  }
  return { heads: 1, hit: true, twoTails: false }
}

/**
 * Calcule les dégâts réels qu'infligerait une attaque du Pokémon Actif sur le Pokémon Actif adverse,
 * ainsi que les dégâts au Banc, les dégâts d'auto-recul (`SELF`), et le nombre d'énergies à défausser.
 */
export function computeAttackDamageToActive(
  attackerBoard: PlayerBoardState,
  defenderBoard: PlayerBoardState,
  action: PlayableAction,
  state?: MatchState,
  rng?: Mulberry32,
): {
  activeDamage: number
  benchDamage: number
  selfRecoilDamage: number
  expectedActiveDamage: number
  expectedBenchDamage: number
  expectedSelfRecoil: number
  energyToDiscard: number
} {
  const attacker = attackerBoard.activePokemon
  const defender = defenderBoard.activePokemon
  if (!attacker || !defender) {
    return {
      activeDamage: 0,
      benchDamage: 0,
      selfRecoilDamage: 0,
      expectedActiveDamage: 0,
      expectedBenchDamage: 0,
      expectedSelfRecoil: 0,
      energyToDiscard: 0,
    }
  }

  let activeDamage = 0
  let expectedActiveDamage = 0
  let benchDamage = 0
  let expectedBenchDamage = 0
  let selfRecoilDamage = 0
  let expectedSelfRecoil = 0
  let energyToDiscard = 0

  if (Array.isArray(action.costs)) {
    for (const cost of action.costs) {
      if (cost.type === 'DISCARD_ENERGY_FROM_PLAY') {
        energyToDiscard = Math.max(1, cost.count || 1)
      }
    }
  }

  for (const eff of action.effects) {
    if (eff.primitive === 'DAMAGE_ACTIVE' || (eff as any).primitive === 'DEAL_DAMAGE_ACTIVE') {
      const rawVal = eff.value ?? eff.baseDamage ?? 0
      if (rawVal < 0) continue

      const isSelfTarget =
        eff.target === 'SELF' ||
        eff.target === 'OWN_ACTIVE' ||
        eff.target === 'OWN_BENCH_SINGLE' ||
        eff.target === 'OWN_BENCH_ALL' ||
        eff.target === 'OWN_POKEMON_ANY' ||
        eff.target === 'OWN_ALL_POKEMON'

      const baseVal = Math.max(0, rawVal)
      const bonusVal = Math.max(0, eff.bonusValue ?? baseVal)
      let dmg = baseVal
      let expDmg = baseVal

      // 1. Champs historiques de compatibilité (tests)
      const scalingType = eff.damageScalingType
      const scalingValue = eff.damageScalingValue ?? 0

      if (eff.damageScalingPerOpponentPrizeTaken) {
        const oppPrizesTaken = Math.max(0, 6 - defenderBoard.prizes.length)
        const add = oppPrizesTaken * eff.damageScalingPerOpponentPrizeTaken
        dmg += add
        expDmg += add
      }

      if (scalingType && scalingValue > 0) {
        let extra = 0
        switch (scalingType) {
          case 'PER_OPPONENT_PRIZE_TAKEN':
            extra = Math.max(0, 6 - defenderBoard.prizes.length) * scalingValue
            break
          case 'PER_COIN_FLIP_HEADS':
            extra = Math.round((eff.count || 2) * 0.5) * scalingValue
            break
          case 'PER_ENERGY_ATTACHED_SELF':
            extra = attacker.attachedEnergies.length * scalingValue
            break
          case 'PER_ENERGY_ATTACHED_ALL':
            extra =
              (countMatchingEnergiesInPlay(attackerBoard) +
                countMatchingEnergiesInPlay(defenderBoard)) *
              scalingValue
            break
          case 'PER_ENERGY_ATTACHED_TARGET':
            extra = defender.attachedEnergies.length * scalingValue
            break
          case 'PER_DAMAGE_COUNTER_ON_SELF':
            extra = Math.floor(attacker.damage / 10) * scalingValue
            break
          case 'PER_DAMAGE_COUNTER_ON_FRIENDLY': {
            const totalCounters = [attacker, ...attackerBoard.bench].reduce(
              (sum, p) => sum + Math.floor(p.damage / 10),
              0,
            )
            extra = totalCounters * scalingValue
            break
          }
          case 'PER_ENERGY_DISCARDED': {
            const totalEnergiesInPlay = countMatchingEnergiesInPlay(
              attackerBoard,
              eff.targetFilter || { category: 'ENERGY', subCategory: 'BASIC_ENERGY' },
            )
            if (totalEnergiesInPlay > 0) {
              const defHpLeft = getRemainingHp(defender, state)
              const neededCards = Math.max(1, Math.ceil(defHpLeft / scalingValue))
              const chosenDiscard = Math.min(totalEnergiesInPlay, Math.max(2, neededCards))
              energyToDiscard = chosenDiscard
              extra = chosenDiscard * scalingValue
            }
            break
          }
          case 'IF_TARGET_IS_EX_OR_EVOLUTION': {
            const isExOrEvo = Boolean(
              defender.card.pokemonStats?.isRuleBox || defender.card.subCategory !== 'BASIC',
            )
            if (isExOrEvo) extra = scalingValue
            break
          }
          case 'PER_DAMAGE_COUNTER_ON_TARGET':
            extra = Math.floor(defender.damage / 10) * scalingValue
            break
          case 'PER_BENCHED_POKEMON':
            extra = attackerBoard.bench.length * scalingValue
            break
          case 'PER_CARD_IN_DISCARD_OR_LOST_ZONE': {
            const discCount = attackerBoard.discard.filter((c) =>
              matchesCardFilter(c, eff.targetFilter),
            ).length
            const lostCount = (attackerBoard.lostZone || []).filter((c) =>
              matchesCardFilter(c, eff.targetFilter),
            ).length
            extra = (discCount + lostCount) * scalingValue
            break
          }
        }
        dmg += extra
        expDmg += extra
      }

      // 2. Schéma v2 : coinFlipMode + scalingMetric + scalingOperator + bonusValue
      if (!scalingType) {
        if (eff.coinFlipMode) {
          const cfExp = flipCoinHeadsCount(eff.coinFlipMode, eff.coinCount ?? 1, undefined)
          const cfLive = rng ? flipCoinHeadsCount(eff.coinFlipMode, eff.coinCount ?? 1, rng) : cfExp

          if (eff.coinFlipMode === 'SINGLE_HEADS_REQUIRED') {
            expDmg = baseVal * cfExp.heads
            dmg = rng ? (cfLive.hit ? baseVal : 0) : Math.round(expDmg)
          } else if (eff.coinFlipMode === 'SINGLE_HEADS_BONUS') {
            const addExp = eff.bonusValue != null ? bonusVal * 0.5 : 0
            expDmg = baseVal + addExp
            dmg = rng
              ? baseVal + (cfLive.hit && eff.bonusValue != null ? bonusVal : 0)
              : Math.round(expDmg)
          } else if (
            eff.coinFlipMode === 'MULTI_COIN_PER_HEADS' ||
            eff.coinFlipMode === 'UNTIL_TAILS_PER_HEADS'
          ) {
            const multPerHead = bonusVal
            if (eff.scalingOperator === 'MULTIPLY') {
              expDmg = cfExp.heads * multPerHead
              dmg = rng ? cfLive.heads * multPerHead : Math.round(expDmg)
            } else {
              expDmg = baseVal + cfExp.heads * multPerHead
              dmg = rng ? baseVal + cfLive.heads * multPerHead : Math.round(expDmg)
            }
          } else if (eff.coinFlipMode === 'TWO_TAILS_SELF_DAMAGE') {
            const recoilAmt = eff.bonusValue ?? (baseVal > 0 ? baseVal : 30)
            expDmg = isSelfTarget ? recoilAmt * 0.25 : baseVal
            dmg = isSelfTarget
              ? rng
                ? cfLive.twoTails
                  ? recoilAmt
                  : 0
                : Math.round(recoilAmt * 0.25)
              : baseVal
            if (!isSelfTarget && rng && cfLive.twoTails) {
              selfRecoilDamage += recoilAmt
            }
            if (!isSelfTarget) {
              expectedSelfRecoil += recoilAmt * 0.25
              if (!rng) selfRecoilDamage += Math.round(recoilAmt * 0.25)
            }
          }
        }

        if (eff.scalingMetric && (eff.coinFlipMode !== 'SINGLE_HEADS_BONUS' || eff.scalingMetric !== 'CONDITIONAL_FLAT_BONUS')) {
          const { units, discardedEnergy } = resolveEffectScalingUnits(
            eff.scalingMetric,
            eff,
            action,
            attackerBoard,
            defenderBoard,
            state,
          )
          if (discardedEnergy > 0) {
            energyToDiscard = Math.max(energyToDiscard, discardedEnergy)
          }
          if (eff.scalingOperator === 'MULTIPLY') {
            dmg = units * bonusVal
            expDmg = units * bonusVal
          } else if (eff.coinFlipMode === 'SINGLE_HEADS_REQUIRED') {
            // Conditional flat bonus + coin flip already gated
            if (units > 0) {
              expDmg += bonusVal * 0.5
              dmg = rng ? (dmg > 0 ? baseVal + bonusVal : 0) : Math.round(expDmg)
            }
          } else {
            dmg += units * bonusVal
            expDmg += units * bonusVal
          }
        }
      }

      if (isSelfTarget) {
        selfRecoilDamage += dmg
        expectedSelfRecoil += expDmg
      } else {
        activeDamage += dmg
        expectedActiveDamage += expDmg
      }
    } else if (
      eff.primitive === 'DAMAGE_BENCH' ||
      eff.primitive === 'PLACE_DAMAGE_COUNTERS' ||
      (eff as any).primitive === 'DISTRIBUTE_DAMAGE_COUNTERS_BENCH' ||
      (eff as any).primitive === 'DEAL_DAMAGE_BENCH'
    ) {
      let bDmg = eff.value ?? eff.baseDamage ?? (eff.count ? eff.count * 10 : 0)
      if (eff.scalingMetric) {
        const { units } = resolveEffectScalingUnits(
          eff.scalingMetric,
          eff,
          action,
          attackerBoard,
          defenderBoard,
          state,
        )
        const bonusVal = eff.bonusValue ?? bDmg
        bDmg = eff.scalingOperator === 'MULTIPLY' ? units * bonusVal : bDmg + units * bonusVal
      }
      benchDamage += Math.max(0, bDmg)
      expectedBenchDamage += Math.max(0, bDmg)
    }
  }

  // Application des modificateurs globaux, faiblesses, résistances et protections aux dégâts adverses
  if (activeDamage > 0 || expectedActiveDamage > 0) {
    let flatBonus = 0
    if (attackerBoard.turnDamageBoost) {
      flatBonus += attackerBoard.turnDamageBoost
    }
    if (attacker.damageDealtModifierNextTurn) {
      flatBonus += attacker.damageDealtModifierNextTurn
    }

    // Outils attaquant (désactivés par Tour de Brouillage)
    if (!isJammingTowerActive(state)) {
      for (let tIdx = 0; tIdx < attacker.attachedTools.length; tIdx++) {
        const tool = attacker.attachedTools[tIdx]!
        const toolMeta = getCardFastMeta(tool)
        const toolNameNorm = toolMeta.normCombinedName
        if (toolNameNorm.includes('ceinture vitalite') || toolNameNorm.includes('vitality band')) {
          flatBonus += 10
        } else if (
          toolNameNorm.includes('ceinture maximum') ||
          toolNameNorm.includes('ceinture maximale') ||
          toolNameNorm.includes('maximum belt')
        ) {
          if (defender.card.pokemonStats?.isRuleBox) {
            flatBonus += 50
          }
        } else if (toolNameNorm.includes('ceinture choix') || toolNameNorm.includes('choice belt')) {
          if (defender.card.pokemonStats?.isRuleBox) {
            flatBonus += 30
          }
        } else if (
          toolNameNorm.includes('bracelet vaillant') ||
          toolNameNorm.includes('defiance band')
        ) {
          if (
            (toolNameNorm.includes('bracelet vaillant') &&
              attacker.card.subCategory === 'BASIC' &&
              !attacker.card.pokemonStats?.isRuleBox &&
              defender.card.pokemonStats?.isRuleBox) ||
            (toolNameNorm.includes('defiance band') &&
              attackerBoard.prizes.length > defenderBoard.prizes.length)
          ) {
            flatBonus += 30
          }
        } else if (toolMeta.passiveDamageDealtDelta > 0) {
          flatBonus += toolMeta.passiveDamageDealtDelta
        }
      }
    }

    const applyPipeline = (raw: number): number => {
      if (raw <= 0) return 0
      let d = raw + flatBonus
      const defMeta = getCardFastMeta(defender.card)
      const defAbilityActive = !isAbilityLockedByPassive(state || ({ player: attackerBoard, opponent: defenderBoard, activeStadium: null } as any), defender, defenderBoard)

      // Prévention de dégâts next-turn (ex: Espièglerie de Margie, Mimiriqui, Pingoléon-ex)
      if (defender.preventDamageOrEffectsNextTurn) {
        return 0
      }
      if (
        defAbilityActive &&
        (defMeta.normNameFr.includes('mimiriqui') || defMeta.normNameEn.includes('mimikyu')) &&
        attacker.card.pokemonStats?.isRuleBox
      ) {
        return 0
      }

      const atkTypes = getCardFastMeta(attacker.card).normPokeTypes
      const rawWeaknesses = defender.card.pokemonStats?.weaknesses
      if (rawWeaknesses && rawWeaknesses.length > 0 && atkTypes.length > 0) {
        let weakHit = false
        for (let wIdx = 0; wIdx < rawWeaknesses.length; wIdx++) {
          const wRaw = rawWeaknesses[wIdx] as any
          const wNorm = normalizeCardNameForMatch(typeof wRaw === 'string' ? wRaw : wRaw?.type || '')
          if (atkTypes.includes(wNorm)) {
            weakHit = true
            break
          }
        }
        if (weakHit) d *= 2
      }

      const rawResistances = defender.card.pokemonStats?.resistances
      if (rawResistances && rawResistances.length > 0 && atkTypes.length > 0) {
        let resHit = false
        for (let rIdx = 0; rIdx < rawResistances.length; rIdx++) {
          const rRaw = rawResistances[rIdx] as any
          const rNorm = normalizeCardNameForMatch(typeof rRaw === 'string' ? rRaw : rRaw?.type || '')
          if (atkTypes.includes(rNorm)) {
            resHit = true
            break
          }
        }
        if (resHit) {
          const resMod = defender.card.pokemonStats?.resistanceModifier ?? -30
          d = Math.max(0, d + resMod)
        }
      }

      // Réductions de dégâts subis (next-turn + Outils + Passifs comme Némélios / Pikachu / Méga-Diancie-ex)
      if (defender.damageTakenModifierNextTurn) {
        d = Math.max(0, d + defender.damageTakenModifierNextTurn)
      }
      if (!isJammingTowerActive(state)) {
        for (const t of defender.attachedTools) {
          const tm = getCardFastMeta(t)
          if (tm.passiveDamageTakenDelta < 0) {
            d = Math.max(0, d + tm.passiveDamageTakenDelta)
          }
        }
      }
      if (defAbilityActive && defMeta.passiveDamageTakenDelta < 0) {
        d = Math.max(0, d + defMeta.passiveDamageTakenDelta)
      }

      return Math.max(0, d)
    }

    activeDamage = applyPipeline(activeDamage)
    expectedActiveDamage = applyPipeline(expectedActiveDamage)
  }

  return {
    activeDamage,
    benchDamage,
    selfRecoilDamage,
    expectedActiveDamage,
    expectedBenchDamage,
    expectedSelfRecoil,
    energyToDiscard,
  }
}

export function countMatchingEnergiesInPlay(
  board: PlayerBoardState,
  filter?: CardFilter | null,
): number {
  let count = 0
  if (board.activePokemon) {
    for (const en of board.activePokemon.attachedEnergies) {
      if (matchesCardFilter(en, filter)) count++
    }
  }
  for (const b of board.bench) {
    for (const en of b.attachedEnergies) {
      if (matchesCardFilter(en, filter)) count++
    }
  }
  return count
}

/**
 * Détermine si une carte en main est actuellement une "Carte Morte" selon `inGameDeadCardConditions`.
 */
export function isCardDeadInHand(
  card: EngineCardModel,
  myBoard: PlayerBoardState,
  oppBoard: PlayerBoardState,
  activeStadium?: ActiveStadiumState | null,
): boolean {
  for (const act of card.playableActions) {
    // Seules les actions jouables directement depuis la main indiquent si la carte en main est morte
    if (
      act.actionType !== 'PLAY_FROM_HAND' &&
      act.actionType !== 'EVOLVE' &&
      act.actionType !== 'ATTACH_ENERGY'
    ) {
      continue
    }
    if (act.deadCardCondition) {
      // Sur EVOLVE (ex: NO_REPTINCEL_IN_PLAY sur Dracaufeu-ex / NO_DISPAREPTIL_IN_PLAY sur Lanssorien-ex),
      // l'évolution reste une carte maîtresse jouable via Super Bonbon ou au tour suivant : ne pas la marquer morte en main.
      const condUpper = act.deadCardCondition.trim().toUpperCase()
      if (act.actionType === 'EVOLVE' && condUpper.startsWith('NO_') && condUpper.endsWith('_IN_PLAY')) {
        continue
      }
      if (evaluateDeadStringCondition(act.deadCardCondition, myBoard, oppBoard, activeStadium, card)) {
        return true
      }
    }
  }

  const conditions = card.strategicEvaluator.inGameDeadCardConditions || []
  for (const cond of conditions) {
    if (evaluateDeadCondition(cond, myBoard, oppBoard, activeStadium, card)) {
      return true
    }
  }
  return false
}

function hasMatchingCardForCardEffects(
  pile: EngineCardModel[],
  card: EngineCardModel | undefined,
  primitives: string[],
): boolean {
  if (pile.length === 0) return false
  if (!card) return pile.length > 0
  const searchEffs = card.playableActions
    .flatMap((a) => a.effects)
    .filter((e) => primitives.includes(e.primitive))
  if (searchEffs.length === 0) return pile.length > 0
  return searchEffs.some((eff) => pile.some((c) => cardMatchesEffectFilter(c, eff)))
}

function evaluateDeadStringCondition(
  condStr: string,
  myBoard: PlayerBoardState,
  oppBoard: PlayerBoardState,
  activeStadium?: ActiveStadiumState | null,
  cardBeingEvaluated?: EngineCardModel,
): boolean {
  const parts = condStr.split('|')
  for (const part of parts) {
    const p = part.trim().toUpperCase()
    if (!p) continue

    if (p === 'BENCH_FULL' || p === 'BENCH_ALREADY_FULL') {
      const maxSlots = getMaxBenchSlots(myBoard, activeStadium ?? null)
      if (myBoard.bench.length >= maxSlots) return true
    } else if (p === 'BENCH_IS_EMPTY' || p === 'NO_POKEMON_ON_BENCH') {
      if (myBoard.bench.length === 0) return true
    } else if (p === 'OPPONENT_BENCH_EMPTY' || p === 'NO_POKEMON_ON_OPPONENT_BENCH') {
      if (oppBoard.bench.length === 0) return true
    } else if (p === 'NOT_BEHIND_ON_PRIZES' || p === 'PLAYER_NOT_BEHIND_ON_PRIZES') {
      if (myBoard.prizes.length <= oppBoard.prizes.length) return true
    } else if (p === 'NO_KO_LAST_TURN' || p === 'NO_KO_SUFFERED_LAST_TURN') {
      if (!myBoard.koSufferedLastOpponentTurn) return true
    } else if (p === 'DECK_IS_EMPTY') {
      if (myBoard.deck.length === 0) return true
    } else if (p === 'NO_VALID_TARGET_IN_DECK') {
      if (!hasMatchingCardForCardEffects(myBoard.deck, cardBeingEvaluated, ['SEARCH_DECK', 'ATTACH_ENERGY'])) {
        return true
      }
    } else if (p === 'NO_VALID_TARGET_IN_DISCARD') {
      if (!hasMatchingCardForCardEffects(myBoard.discard, cardBeingEvaluated, ['RECOVER_FROM_DISCARD', 'ATTACH_ENERGY'])) {
        return true
      }
    } else if (p === 'BENCH_FULL_OR_NO_TARGET_IN_DECK') {
      const maxSlots = getMaxBenchSlots(myBoard, activeStadium ?? null)
      if (
        myBoard.bench.length >= maxSlots ||
        !hasMatchingCardForCardEffects(myBoard.deck, cardBeingEvaluated, ['SEARCH_DECK'])
      ) {
        return true
      }
    } else if (p === 'NO_STAGE_2_IN_HAND_OR_NO_BASIC_IN_PLAY') {
      const hasS2 = myBoard.hand.some((c) => c.category === 'POKEMON' && c.subCategory === 'STAGE_2')
      const allInPlay = [myBoard.activePokemon, ...myBoard.bench].filter((x): x is InPlayPokemon => x !== null)
      const hasBasic = allInPlay.some((x) => x.card.subCategory === 'BASIC')
      if (!hasS2 || !hasBasic) return true
    } else if (p === 'NO_TERA_IN_PLAY' || p === 'NO_TERA_POKEMON_IN_PLAY') {
      const allInPlay = [myBoard.activePokemon, ...myBoard.bench].filter((x): x is InPlayPokemon => x !== null)
      if (!allInPlay.some((x) => Boolean(x.card.identity.isTera || x.card.pokemonStats?.isTera))) return true
    } else if (p === 'DISCARD_EMPTY' || p === 'DISCARD_PILE_EMPTY') {
      if (myBoard.discard.length === 0) return true
    } else if (p === 'NO_ENERGY_IN_DISCARD') {
      if (!myBoard.discard.some((c) => c.category === 'ENERGY')) return true
    } else if (p === 'NO_POKEMON_IN_DISCARD') {
      if (!myBoard.discard.some((c) => c.category === 'POKEMON')) return true
    } else if (p === 'HAND_EMPTY' || p === 'HAND_IS_EMPTY' || p === 'NO_CARDS_IN_HAND') {
      if (myBoard.hand.length <= 1) return true
    } else if (p === 'HAND_NOT_EMPTY') {
      if (myBoard.hand.length > 1) return true
    } else if (p.startsWith('HAND_FEWER_THAN_')) {
      const m = p.match(/^HAND_FEWER_THAN_(\d+)_OTHER_CARDS$/)
      if (m) {
        const req = parseInt(m[1]!, 10)
        if (myBoard.hand.length - 1 < req) return true
      }
    } else if (p === 'NO_STADIUM_IN_PLAY') {
      if (!activeStadium) return true
    } else if (p === 'STADIUM_ALREADY_IN_PLAY_SAME_NAME') {
      if (
        activeStadium &&
        cardBeingEvaluated &&
        (activeStadium.card.cardId === cardBeingEvaluated.cardId ||
          normalizeCardNameForMatch(activeStadium.card.identity.nameFr) ===
            normalizeCardNameForMatch(cardBeingEvaluated.identity.nameFr))
      ) {
        return true
      }
    } else if (p.startsWith('NO_') && p.endsWith('_IN_PLAY')) {
      const rawTargetName = p.slice(3, -8).replace(/_/g, ' ')
      const targetNorm = normalizeCardNameForMatch(rawTargetName)
      if (targetNorm) {
        const allInPlay = [myBoard.activePokemon, ...myBoard.bench].filter((x): x is InPlayPokemon => x !== null)
        const found = allInPlay.some((x) => {
          const pm = getCardFastMeta(x.card)
          return pm.normNameFr.includes(targetNorm) || pm.normNameEn.includes(targetNorm)
        })
        if (!found) return true
      }
    }
  }
  return false
}

function evaluateDeadCondition(
  cond: DeadCardCondition,
  myBoard: PlayerBoardState,
  oppBoard: PlayerBoardState,
  activeStadium?: ActiveStadiumState | null,
  cardBeingEvaluated?: EngineCardModel,
): boolean {
  switch (cond.reason) {
    case 'BENCH_ALREADY_FULL': {
      const maxSlots = getMaxBenchSlots(myBoard, activeStadium ?? null)
      return myBoard.bench.length >= maxSlots
    }

    case 'NOT_BEHIND_ON_PRIZES':
      return myBoard.prizes.length <= oppBoard.prizes.length

    case 'DISCARD_PILE_EMPTY':
      if (!cond.targetFilter) return myBoard.discard.length === 0
      return countMatchingCardsInZones(myBoard, ['DISCARD'], cond.targetFilter) === 0

    case 'NO_VALID_TARGET_IN_DECK':
    case 'NO_STAGE2_LEFT_IN_DECK_OR_HAND':
    case 'NO_BASE_POKEMON_LINE_LEFT': {
      const zones = cond.zonesToCheck.length > 0 ? cond.zonesToCheck : (['DECK'] as ZoneType[])
      return countMatchingCardsInZones(myBoard, zones, cond.targetFilter) === 0
    }

    case 'NO_TERA_POKEMON_IN_PLAY': {
      const allInPlay = [myBoard.activePokemon, ...myBoard.bench].filter(
        (p): p is InPlayPokemon => p !== null,
      )
      return !allInPlay.some((p) => Boolean(p.card.pokemonStats?.isTera))
    }

    case 'HAND_ALREADY_FULL_OR_AT_LIMIT': {
      return myBoard.hand.length >= 7
    }

    case 'NO_DAMAGE_ON_OWN_POKEMON': {
      const allInPlay = [myBoard.activePokemon, ...myBoard.bench].filter(
        (p): p is InPlayPokemon => p !== null,
      )
      return !allInPlay.some((p) => p.damage > 0)
    }

    case 'NO_KO_LAST_TURN': {
      return !myBoard.koSufferedLastOpponentTurn
    }

    case 'STADIUM_ALREADY_IN_PLAY_SAME_NAME': {
      if (!activeStadium) return false
      if (cardBeingEvaluated && activeStadium.card.cardId === cardBeingEvaluated.cardId) return true
      if (
        cardBeingEvaluated &&
        normalizeCardNameForMatch(activeStadium.card.identity.nameFr) ===
          normalizeCardNameForMatch(cardBeingEvaluated.identity.nameFr)
      ) {
        return true
      }
      return false
    }

    default:
      return false
  }
}

export function countMatchingCardsInZones(
  board: PlayerBoardState,
  zones: ZoneType[],
  filter?: CardFilter | null,
): number {
  let count = 0
  for (const z of zones) {
    if (z === 'DECK') {
      for (const c of board.deck) if (matchesCardFilter(c, filter)) count++
    } else if (z === 'HAND') {
      for (const c of board.hand) if (matchesCardFilter(c, filter)) count++
    } else if (z === 'DISCARD') {
      for (const c of board.discard) if (matchesCardFilter(c, filter)) count++
    } else if (z === 'PRIZES') {
      for (const c of board.prizes) if (matchesCardFilter(c, filter)) count++
    } else if (z === 'ACTIVE') {
      if (board.activePokemon && matchesCardFilter(board.activePokemon.card, filter)) count++
    } else if (z === 'BENCH') {
      for (const b of board.bench) if (matchesCardFilter(b.card, filter)) count++
    } else if (z === 'IN_PLAY_ALL') {
      if (board.activePokemon && matchesCardFilter(board.activePokemon.card, filter)) count++
      for (const b of board.bench) if (matchesCardFilter(b.card, filter)) count++
    }
  }
  return count
}

/**
 * Initialise l'état complet d'un match (`MatchState`) avec mélange Fisher-Yates,
 * résolution des Mulligans officiels, placement initial Actif/Banc et 6 cartes Récompenses.
 */
export function createInitialMatchState(
  playerDeckModels: EngineCardModel[],
  opponentDeckModels: EngineCardModel[],
  options: CreateMatchOptions,
): MatchState {
  const rng = new Mulberry32(options.seed)
  let instanceSeq = 1

  const setupSingleBoard = (
    deckModels: EngineCardModel[],
    forcePrizeKeyCard: boolean,
  ): PlayerBoardState => {
    const deck = deckModels.slice()
    let hand: EngineCardModel[] = []
    let mulliganCount = 0

    // Boucle officielle de Mulligan : tant qu'aucun Pokémon BASIC n'est dans les 7 cartes
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidateDeck = deck.slice()
      fisherYatesShuffle(candidateDeck, rng)
      const drawn = candidateDeck.splice(0, 7)
      const hasBasic = drawn.some((c) => c.category === 'POKEMON' && c.subCategory === 'BASIC')
      if (hasBasic || attempt === 49) {
        // Fallback de sécurité si un deck avait très peu de bases et n'en a pas tiré après 49 essais
        if (!hasBasic) {
          const basicIdx = candidateDeck.findIndex(
            (c) => c.category === 'POKEMON' && c.subCategory === 'BASIC',
          )
          if (basicIdx !== -1 && drawn.length > 0) {
            const basicCard = candidateDeck.splice(basicIdx, 1)[0]!
            const replaced = drawn.pop()!
            candidateDeck.push(replaced)
            drawn.push(basicCard)
          }
        }
        deck.length = 0
        deck.push(...candidateDeck)
        hand = drawn
        break
      }
      mulliganCount++
    }

    // Choix intelligent du Pokémon Actif initial et des Pokémon de Banc initiaux (Tour 0)
    const basicIndices: number[] = []
    hand.forEach((c, idx) => {
      if (c.category === 'POKEMON' && c.subCategory === 'BASIC') {
        basicIndices.push(idx)
      }
    })

    // Préfère en Actif un Pokémon de mobilité (Mélofée 0 retraite) ou un attaquant de base solide (Ire-Foudre, Ogerpon, Salamèche)
    basicIndices.sort((idxA, idxB) => {
      const a = hand[idxA]!
      const b = hand[idxB]!
      const scoreStartActive = (c: EngineCardModel): number => {
        const ret = c.pokemonStats?.retreatCost ?? 1
        const hp = c.pokemonStats?.hp ?? 70
        const role = c.strategicEvaluator.primaryRole
        if (ret === 0) return 120
        if (role === 'MAIN_ATTACKER') return 110
        if (role === 'ENERGY_ACCELERATOR') return 95
        return hp - ret * 10
      }
      return scoreStartActive(b) - scoreStartActive(a)
    })

    const activeHandIdx = basicIndices[0] ?? 0
    const activeCard = hand.splice(activeHandIdx, 1)[0]!
    const activePokemon: InPlayPokemon = {
      instanceId: `p_${instanceSeq++}`,
      card: activeCard,
      previousStages: [],
      damage: 0,
      attachedEnergies: [],
      attachedTools: [],
      turnPlayed: 0,
      evolvedThisTurn: false,
      specialConditions: [],
      cantAttackNextTurn: false,
    }

    // Pose les autres Pokémon de Base de la main initiale sur le Banc (en gardant Luminéon V en main pour son talent)
    const bench: InPlayPokemon[] = []
    for (let i = hand.length - 1; i >= 0; i--) {
      if (bench.length >= 5) break
      const c = hand[i]!
      if (c.category === 'POKEMON' && c.subCategory === 'BASIC') {
        const normName = normalizeCardNameForMatch(c.identity.nameFr)
        if (normName.includes('lumineon')) continue
        hand.splice(i, 1)
        bench.push({
          instanceId: `p_${instanceSeq++}`,
          card: c,
          previousStages: [],
          damage: 0,
          attachedEnergies: [],
          attachedTools: [],
          turnPlayed: 0,
          evolvedThisTurn: false,
          specialConditions: [],
          cantAttackNextTurn: false,
        })
      }
    }

    // Perturbation Debug optionnelle : Forcer le blocage de cartes clés (Super Bonbon / Attaquant STAGE_2) en Récompenses
    if (forcePrizeKeyCard) {
      const keyIndices: number[] = []
      deck.forEach((c, idx) => {
        if (
          c.cardId === 'sv04-125' ||
          c.subCategory === 'STAGE_2' ||
          c.strategicEvaluator.primaryRole === 'MAIN_ATTACKER'
        ) {
          keyIndices.push(idx)
        }
      })
      for (let k = 0; k < Math.min(3, keyIndices.length); k++) {
        const targetIdx = keyIndices[k]!
        const tmp = deck[k]!
        deck[k] = deck[targetIdx]!
        deck[targetIdx] = tmp
      }
    }

    // Mise de côté des 6 cartes Récompenses
    const prizes = deck.splice(0, 6)

    const initialHandSnapshot = [
      activePokemon.card.identity.nameFr,
      ...bench.map((b) => b.card.identity.nameFr),
      ...hand.map((h) => h.identity.nameFr),
    ]
    const initialPrizesSnapshot = prizes.map((p) => p.identity.nameFr)

    return {
      deck,
      hand,
      prizes,
      discard: [],
      activePokemon,
      bench,
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
      mulliganCount,
      initialHandSnapshot,
      initialPrizesSnapshot,
      prizesKnownByPlayer: false,
      firstSearchTurn: null,
      turnDamageBoost: 0,
    }
  }

  const forceKeyPrized = options.perturbationType === 'FORCE_KEY_CARD_PRIZED'
  const playerBoard = setupSingleBoard(playerDeckModels, forceKeyPrized)
  const opponentBoard = setupSingleBoard(opponentDeckModels, false)

  // Compensation officielle de Mulligan : le joueur ayant subi moins de mulligans pioche jusqu'à la différence (max 2 pour ne pas se meuler)
  if (opponentBoard.mulliganCount > playerBoard.mulliganCount) {
    const bonusDraws = Math.min(2, opponentBoard.mulliganCount - playerBoard.mulliganCount)
    for (let i = 0; i < bonusDraws && playerBoard.deck.length > 0; i++) {
      playerBoard.hand.push(playerBoard.deck.shift()!)
    }
  } else if (playerBoard.mulliganCount > opponentBoard.mulliganCount) {
    const bonusDraws = Math.min(2, playerBoard.mulliganCount - opponentBoard.mulliganCount)
    for (let i = 0; i < bonusDraws && opponentBoard.deck.length > 0; i++) {
      opponentBoard.hand.push(opponentBoard.deck.shift()!)
    }
  }

  return {
    player: playerBoard,
    opponent: opponentBoard,
    turnNumber: 1,
    maxTurns: options.maxTurns,
    activePlayerIndex: options.firstPlayerIndex,
    firstPlayerIndex: options.firstPlayerIndex,
    winner: null,
    winReason: null,
    rngState: rng.getState(),
    nextInstanceSeq: instanceSeq,
    lastActionLog: [],
    activeStadium: null,
  }
}

/**
 * Démarre le tour du joueur actif (`startTurn`) :
 * - Réinitialise les compteurs par tour (`supporterPlayedThisTurn`, `energyAttachedThisTurn`, `retreatUsedThisTurn`, `usedOncePerTurnAbilities`, `evolvedThisTurn`)
 * - Pioche la carte de début de tour (ou déclenche la défaite par `DECK_OUT` si le deck est vide).
 */
export function startTurn(state: MatchState): { drawnCard: EngineCardModel | null; perturbationNote: string | null } {
  if (state.winner !== null) {
    return { drawnCard: null, perturbationNote: null }
  }

  const activeBoard = getActiveBoard(state)
  activeBoard.supporterPlayedThisTurn = false
  activeBoard.energyAttachedThisTurn = false
  activeBoard.retreatUsedThisTurn = false
  activeBoard.turnDamageBoost = 0
  activeBoard.usedOncePerTurnAbilities.clear()

  if (activeBoard.activePokemon) {
    activeBoard.activePokemon.evolvedThisTurn = false
  }
  for (const b of activeBoard.bench) {
    b.evolvedThisTurn = false
  }

  // Vérification de Deck-Out au moment de la pioche obligatoire de début de tour
  if (activeBoard.deck.length === 0) {
    state.winner = state.activePlayerIndex === 0 ? 'OPPONENT' : 'PLAYER'
    state.winReason = 'DECK_OUT'
    return { drawnCard: null, perturbationNote: null }
  }

  const drawnCard = activeBoard.deck.shift()!
  activeBoard.hand.push(drawnCard)
  state.lastActionLog = []

  return { drawnCard, perturbationNote: null }
}

/**
 * Injecte une perturbation de test (Mode Debug `?debug=true`) au début d'un tour donné.
 */
export function applyDebugPerturbationIfConfigured(
  state: MatchState,
  perturbationType: DebugPerturbationType | undefined,
  perturbationTurn: number | undefined,
): string | null {
  if (!perturbationType || perturbationType === 'NONE') return null
  if (perturbationTurn !== state.turnNumber) return null

  const rng = new Mulberry32(state.rngState)

  if (perturbationType === 'FORCE_OPPONENT_IONO') {
    for (const board of [state.player, state.opponent]) {
      if (board.hand.length > 0) {
        const handCards = board.hand.splice(0, board.hand.length)
        fisherYatesShuffle(handCards, rng)
        board.deck.push(...handCards)
      }
      const maxResetCards = board === state.player ? Math.min(4, board.prizes.length) : board.prizes.length
      const drawCount = Math.min(board.deck.length, maxResetCards)
      for (let i = 0; i < drawCount; i++) {
        board.hand.push(board.deck.shift()!)
      }
    }
    state.rngState = rng.getState()
    return `Perturbation Debug (Tour ${state.turnNumber}) : Mashynn / Iono forcée (mains mélangées sous le deck, pioche réduite <= 4 cartes).`
  }

  if (perturbationType === 'FORCE_KO_ACTIVE' && state.player.activePokemon) {
    const koedName = state.player.activePokemon.card.identity.nameFr
    handleKnockOut(state, state.opponent, state.player, 'ACTIVE')
    return `Perturbation Debug (Tour ${state.turnNumber}) : KO forcé de notre Pokémon Actif (${koedName}).`
  }

  if (perturbationType === 'FORCE_KEY_CARD_PRIZED') {
    return `Perturbation Debug : Pièces maîtresses verrouillées dans les 6 Récompenses à l'ouverture.`
  }

  return null
}

const GLOBAL_ONCE_PER_TURN_ABILITY_IDS = new Set([
  'ability_quick_search',
  'ability_flip_the_script',
  'ability_squawk_and_seize',
  'ability_instant_charge',
  'ability_luminous_sign',
])

/**
 * Vérifie si toutes les `preconditions` d'une `PlayableAction` du modèle JSON sont satisfaites.
 */
export function checkActionPreconditions(
  state: MatchState,
  activeBoard: PlayerBoardState,
  passiveBoard: PlayerBoardState,
  sourceCard: EngineCardModel,
  action: PlayableAction,
  sourcePokemon?: InPlayPokemon,
  handIndexIfFromHand?: number,
): boolean {
  const isTurn1FirstPlayer = state.turnNumber === 1 && state.activePlayerIndex === state.firstPlayerIndex
  const isTurn1SecondPlayer =
    state.turnNumber === 2 && state.activePlayerIndex !== state.firstPlayerIndex

  if (isTurn1FirstPlayer && !action.canUseTurn1GoingFirst) {
    return false
  }
  if (isTurn1SecondPlayer && !action.canUseTurn1GoingSecond) {
    return false
  }

  // Verrou Item Lock (via attaque ou talent passif)
  const isItem = sourceCard.subCategory === 'ITEM'
  if (
    (action.actionType === 'PLAY_FROM_HAND' || action.sourceType === 'TRAINER_PLAY') &&
    isItem &&
    hasEffectiveItemLock(state, activeBoard)
  ) {
    return false
  }

  // Verrous de timing globaux
  const isSupporter = sourceCard.subCategory === 'SUPPORTER'
  if (
    isSupporter &&
    (action.timingPhase === 'MAIN_PHASE_1' || action.timing === 'ONCE_PER_TURN_SUPPORTER') &&
    activeBoard.supporterPlayedThisTurn
  ) {
    return false
  }
  if (isSupporter && isTurn1FirstPlayer) {
    return false
  }
  if (action.actionId.includes('vstar') && activeBoard.vstarPowerUsed) {
    return false
  }

  const isManualOrTriggerAbility =
    action.actionType === 'USE_ABILITY' ||
    action.actionType === 'TRIGGERED_ABILITY' ||
    (action.sourceType && action.sourceType.startsWith('ABILITY'))

  if (action.actionType === 'PASSIVE_ABILITY') {
    return false
  }

  if (isManualOrTriggerAbility) {
    if (sourcePokemon && isAbilityLockedByPassive(state, sourcePokemon, activeBoard)) {
      return false
    }
    const normLabel = normalizeCardNameForMatch(action.label || '')
    const isSquawk =
      action.actionId === 'ability_squawk_and_seize' ||
      /squawk.*seize|mise en page|tapatoes|prise tapageuse/i.test(`${action.actionId} ${normLabel}`)
    if (isSquawk && state.turnNumber > 2) {
      return false
    }
    const isGlobalOncePerTurn =
      GLOBAL_ONCE_PER_TURN_ABILITY_IDS.has(action.actionId) ||
      /recherche rapide|quick search|taper le pied|flip the script|instant charge|luminous sign|signe lumineux|squawk/i.test(
        normLabel,
      )
    const abilityKey = isGlobalOncePerTurn
      ? isSquawk
        ? 'ability_squawk_and_seize'
        : normLabel || action.actionId
      : `${sourcePokemon?.instanceId || sourceCard.cardId}:${action.actionId}`
    if (activeBoard.usedOncePerTurnAbilities.has(abilityKey)) {
      return false
    }
  }

  // Verrous stricts propres aux Attaques
  const isAttack = action.actionType === 'ATTACK' || action.sourceType === 'ATTACK'
  if (isAttack) {
    // 1. Un joueur débutant ne peut jamais attaquer au Tour 1
    if (isTurn1FirstPlayer) {
      return false
    }

    // 2. Seul le Pokémon Actif peut déclarer une attaque
    if (!sourcePokemon || activeBoard.activePokemon?.instanceId !== sourcePokemon.instanceId) {
      return false
    }

    // 3. Les états spéciaux Sommeil et Paralysie bloquent totalement l'attaque
    // 4. Verrou cantAttackNextTurn ("Pendant votre prochain tour, ce Pokémon ne peut pas attaquer")
    if (isPokemonAttackBlocked(sourcePokemon, state)) {
      return false
    }

    // 5. Coût énergétique de l'attaque : Le Pokémon Actif DOIT avoir les énergies nécessaires attachées
    const effectiveCost = getEffectiveAttackCost(sourcePokemon, action, state, passiveBoard)
    if (!canPayEnergyCost(sourcePokemon.attachedEnergies, effectiveCost)) {
      return false
    }
  } else if (sourcePokemon && (action.cost || action.energyCost)) {
    // Pour toute autre action liée à un Pokémon possédant un coût en énergie (ex: talent à coût d'énergie)
    const cost = action.cost || action.energyCost
    if (cost && Object.keys(cost).length > 0) {
      if (!canPayEnergyCost(sourcePokemon.attachedEnergies, cost as any)) {
        return false
      }
    }
  }

  const isConditionalBonusAttack =
    isAttack && action.effects.some((e) => e.scalingMetric === 'CONDITIONAL_FLAT_BONUS')

  for (let pIdx = 0; pIdx < action.preconditions.length; pIdx++) {
    const rawPre = action.preconditions[pIdx]!
    const preType = String(typeof rawPre === 'string' ? rawPre : (rawPre as any).type || '').trim()
    const preUpper = preType.toUpperCase()
    const minCount = typeof rawPre === 'object' ? (rawPre as any).minCount ?? 1 : 1
    const targetFilter = typeof rawPre === 'object' ? (rawPre as any).targetFilter : null

    if (preUpper === 'OPPONENT_TURN') continue
    if (isAttack && (preUpper === 'NOT_FIRST_TURN' || isConditionalBonusAttack)) {
      if (preUpper !== 'SELF_IS_ACTIVE') continue
    }

    if (preUpper === 'BENCH_HAS_EMPTY_SLOTS' || preUpper === 'BENCH_HAS_EMPTY_SLOT') {
      const maxSlots = getMaxBenchSlots(activeBoard, state.activeStadium)
      if (activeBoard.bench.length > maxSlots - Math.max(1, minCount)) return false
    } else if (preUpper.startsWith('HAND_MIN_OTHER_CARDS')) {
      const m = preUpper.match(/HAND_MIN_OTHER_CARDS[:_](\d+)/)
      const countReq = m ? parseInt(m[1]!, 10) : minCount
      const otherHandCount =
        handIndexIfFromHand !== undefined
          ? activeBoard.hand.length - 1
          : activeBoard.hand.length
      if (otherHandCount < countReq) return false
    } else if (preUpper === 'HAND_MAX_OTHER_CARDS_ZERO' || preUpper === 'HAND_IS_EMPTY') {
      const otherHandCount =
        handIndexIfFromHand !== undefined
          ? activeBoard.hand.length - 1
          : activeBoard.hand.some((c) => c.cardId === sourceCard.cardId)
            ? activeBoard.hand.length - 1
            : activeBoard.hand.length
      if (otherHandCount > 0) return false
    } else if (preUpper === 'HAND_NOT_EMPTY') {
      const otherHandCount =
        handIndexIfFromHand !== undefined ? activeBoard.hand.length - 1 : activeBoard.hand.length
      if (otherHandCount < 1) return false
    } else if (
      preUpper === 'PLAYER_BEHIND_ON_PRIZES' ||
      preUpper === 'OPPONENT_HAS_FEWER_PRIZES' ||
      preUpper === 'PLAYER_PRIZES_LEFT_>_OPPONENT_PRIZES_LEFT'
    ) {
      if (activeBoard.prizes.length <= passiveBoard.prizes.length) return false
    } else if (preUpper === 'KO_SUFFERED_LAST_TURN' || preUpper === 'OPPONENT_CAUSED_KO_LAST_TURN') {
      if (!activeBoard.koSufferedLastOpponentTurn) return false
    } else if (
      preUpper === 'BASIC_IN_PLAY_PREVIOUS_TURN' ||
      preUpper === 'BASIC_POKEMON_IN_PLAY_SINCE_LAST_TURN' ||
      preUpper === 'BASIC_POKEMON_IN_PLAY'
    ) {
      if (state.turnNumber <= 2 && preUpper !== 'BASIC_POKEMON_IN_PLAY') return false
      const allInPlay = [
        ...(activeBoard.activePokemon ? [activeBoard.activePokemon] : []),
        ...activeBoard.bench,
      ]
      if (preUpper === 'BASIC_POKEMON_IN_PLAY') {
        if (!allInPlay.some((p) => p.card.subCategory === 'BASIC')) return false
      } else {
        const stage2InHand = activeBoard.hand.filter(
          (c) => c.category === 'POKEMON' && c.subCategory === 'STAGE_2',
        )
        if (stage2InHand.length === 0) return false
        const canRareCandyAny = allInPlay.some((poke) =>
          stage2InHand.some((s2) => canPokemonEvolveInto(poke, s2, state.turnNumber, true)),
        )
        if (!canRareCandyAny) return false
      }
    } else if (preUpper === 'STAGE_2_CARD_IN_HAND' || preUpper === 'STAGE_2_IN_HAND') {
      const hasS2 = activeBoard.hand.some(
        (c) => c.category === 'POKEMON' && c.subCategory === 'STAGE_2',
      )
      if (!hasS2) return false
    } else if (preUpper === 'NOT_FIRST_TURN') {
      if (state.turnNumber === 1 && state.activePlayerIndex === state.firstPlayerIndex) return false
    } else if (preUpper === 'SELF_IS_ACTIVE') {
      if (!sourcePokemon || activeBoard.activePokemon?.instanceId !== sourcePokemon.instanceId) {
        return false
      }
    } else if (preUpper === 'SELF_HAS_ENERGY_COST') {
      if (!sourcePokemon) return false
      if (action.cost && Object.keys(action.cost).length > 0) {
        if (!canPayEnergyCost(sourcePokemon.attachedEnergies, action.cost)) return false
      } else if (action.energyCost && action.energyCost.length > 0) {
        if (!canPayEnergyCost(sourcePokemon.attachedEnergies, action.energyCost)) return false
      } else if (typeof rawPre === 'object') {
        if (!hasRequiredEnergyForPrecondition(sourcePokemon, rawPre, action)) return false
      }
    } else if (preUpper === 'HAS_TERA_POKEMON_IN_PLAY') {
      const hasTera =
        Boolean(
          activeBoard.activePokemon?.card.identity.isTera ||
            activeBoard.activePokemon?.card.pokemonStats?.isTera,
        ) ||
        activeBoard.bench.some((p) =>
          Boolean(p.card.identity.isTera || p.card.pokemonStats?.isTera),
        )
      if (!hasTera) return false
    } else if (preUpper === 'STADIUM_IN_PLAY') {
      if (!state.activeStadium) return false
      if (targetFilter && !matchesCardFilter(state.activeStadium.card, targetFilter)) {
        return false
      }
    } else if (preUpper === 'OPPONENT_ACTIVE_HAS_SPECIAL_CONDITION') {
      const oppActive = passiveBoard.activePokemon
      if (!oppActive || !oppActive.specialConditions || oppActive.specialConditions.length === 0) {
        return false
      }
    } else if (preUpper === 'OPPONENT_ACTIVE_HAS_DAMAGE') {
      if (!passiveBoard.activePokemon || passiveBoard.activePokemon.damage <= 0) return false
    } else if (preUpper === 'OPPONENT_ACTIVE_IS_EX_OR_V' || preUpper === 'OPPONENT_ACTIVE_IS_RULE_BOX') {
      if (
        !passiveBoard.activePokemon?.card.pokemonStats?.isRuleBox &&
        !passiveBoard.activePokemon?.card.identity.isRuleBox
      ) {
        return false
      }
    } else if (preUpper === 'OPPONENT_PRIZES_EXACT_COUNT' || preUpper.startsWith('OPPONENT_PRIZES_EQUAL:')) {
      const targetN = preUpper.includes(':') ? parseInt(preUpper.split(':')[1] || '6', 10) : minCount
      if (passiveBoard.prizes.length !== targetN) return false
    } else if (preUpper === 'OPPONENT_PRIZES_LTE_2' || preUpper.startsWith('OPPONENT_PRIZES_LTE:')) {
      const targetN = preUpper.includes(':') ? parseInt(preUpper.split(':')[1] || '2', 10) : 2
      if (passiveBoard.prizes.length > targetN) return false
    } else if (preUpper === 'SELF_IS_ON_BENCH' || preUpper === 'SELF_ON_BENCH') {
      if (
        !sourcePokemon ||
        !activeBoard.bench.some((b) => b.instanceId === sourcePokemon.instanceId)
      ) {
        return false
      }
    } else if (preUpper === 'BENCH_HAS_POKEMON') {
      if (activeBoard.bench.length === 0) return false
    } else if (
      preUpper === 'OPPONENT_HAS_BENCH_POKEMON' ||
      preUpper === 'OPPONENT_HAS_BENCHED_POKEMON' ||
      preUpper === 'OPPONENT_BENCH_NOT_EMPTY'
    ) {
      if (passiveBoard.bench.length === 0) return false
    } else if (preUpper === 'DISCARD_NOT_EMPTY' || preUpper === 'DISCARD_PILE_NOT_EMPTY') {
      if (activeBoard.discard.length === 0) return false
    } else if (preUpper === 'DECK_NOT_EMPTY') {
      if (activeBoard.deck.length === 0) return false
    } else if (preUpper === 'NO_ATTACHED_ENERGY' || preUpper === 'SELF_NO_ATTACHED_ENERGY' || preUpper === 'NO_ENERGY_IN_PLAY') {
      if (sourcePokemon) {
        if (sourcePokemon.attachedEnergies.length > 0) return false
      } else {
        const totalEnergies =
          (activeBoard.activePokemon?.attachedEnergies.length || 0) +
          activeBoard.bench.reduce((sum, b) => sum + b.attachedEnergies.length, 0)
        if (totalEnergies > 0) return false
      }
    } else if (preUpper.startsWith('IN_PLAY:')) {
      const reqName = normalizeCardNameForMatch(preType.slice('IN_PLAY:'.length))
      if (reqName) {
        const allPokes = [
          ...(activeBoard.activePokemon ? [activeBoard.activePokemon] : []),
          ...activeBoard.bench,
        ]
        const found = allPokes.some((p) => {
          const pm = getCardFastMeta(p.card)
          return pm.normNameFr.includes(reqName) || pm.normNameEn.includes(reqName)
        })
        if (!found) return false
      }
    } else if (preUpper.startsWith('ON_BENCH:') || preUpper.startsWith('BENCH_HAS_POKEMON_WITH_NAME:')) {
      const reqName = normalizeCardNameForMatch(preType.split(':')[1] || '')
      if (reqName) {
        const found = activeBoard.bench.some((p) => {
          const pm = getCardFastMeta(p.card)
          return pm.normNameFr.includes(reqName) || pm.normNameEn.includes(reqName)
        })
        if (!found) return false
      }
    } else if (preUpper === 'SECOND_PLAYER_TURN_1') {
      if (state.turnNumber !== 2 || state.activePlayerIndex === state.firstPlayerIndex) {
        return false
      }
    } else if (preUpper === 'ZONE_HAS_MATCHING_CARD') {
      const effectWithFilter = action.effects.find((e) => e.filter || e.targetFilter)
      const targetZone =
        (typeof rawPre === 'object' && (rawPre as any).zone) ||
        effectWithFilter?.sourceZone ||
        effectWithFilter?.zone ||
        'DECK'
      if (targetZone === 'HAND') {
        let matchCount = 0
        for (let idx = 0; idx < activeBoard.hand.length; idx++) {
          if (handIndexIfFromHand !== undefined && idx === handIndexIfFromHand) continue
          const c = activeBoard.hand[idx]!
          if (handIndexIfFromHand === undefined && c === sourceCard) continue
          const ok = effectWithFilter
            ? cardMatchesEffectFilter(c, effectWithFilter)
            : targetFilter
              ? matchesCardFilter(c, targetFilter)
              : true
          if (ok && ++matchCount >= minCount) break
        }
        if (matchCount < minCount) return false
      } else {
        const cardsInZone = targetZone === 'DISCARD' ? activeBoard.discard : activeBoard.deck
        let matchCount = 0
        for (let idx = 0; idx < cardsInZone.length; idx++) {
          const c = cardsInZone[idx]!
          const ok = effectWithFilter
            ? cardMatchesEffectFilter(c, effectWithFilter)
            : targetFilter
              ? matchesCardFilter(c, targetFilter)
              : true
          if (ok && ++matchCount >= minCount) break
        }
        if (matchCount < minCount) return false
      }
    }
  }

  // Vérifications additionnelles spécifiques aux effets de changement de poste (Trainers/Retraite)
  if (action.actionType === 'PLAY_FROM_HAND' || action.actionType === 'RETREAT') {
    for (const eff of action.effects) {
      if (eff.primitive !== 'SWITCH_ACTIVE' || eff.optional) continue
      const t = (eff.target || '').toUpperCase()
      const tz = ((eff as any).targetZone || '').toUpperCase()
      const sz = (eff.sourceZone || '').toUpperCase()
      const isOppSwitch =
        t === 'OPPONENT_BENCH' ||
        t === 'OPPONENT_BENCH_SINGLE' ||
        t === 'OPPONENT_ACTIVE' ||
        t === 'OPPONENT' ||
        t === 'OPPONENT_POKEMON_ANY' ||
        tz === 'OPPONENT_BENCH' ||
        (eff as any).primitive === 'GUST_OPPONENT_BENCH' ||
        (t === '' && sz === 'BENCH')
      if (isOppSwitch && passiveBoard.bench.length === 0) {
        return false
      }
      const isOwnSwitch =
        t === 'OWN_BENCH' ||
        t === 'OWN_BENCH_SINGLE' ||
        t === 'OWN_ACTIVE' ||
        t === 'SELF' ||
        (eff as any).primitive === 'SWITCH_ACTIVE_POKEMON'
      if (isOwnSwitch && activeBoard.bench.length === 0) {
        return false
      }
    }
  }

  return true
}

/**
 * Retourne la liste exacte des coups légaux à l'instant T (`getLegalActions(state)`)
 * avec regroupement canonique (`Typed Move Grouping`) pour éviter les doublons commutatifs.
 */
export function getLegalActions(state: MatchState): GameAction[] {
  if (state.winner !== null) return []

  const activeBoard = getActiveBoard(state)
  const passiveBoard = getPassiveBoard(state)
  const actions: GameAction[] = []

  const isFirstTurnOfPlayer = state.turnNumber <= 2

  // ==========================================================================
  // 1. POSER UN POKÉMON DE BASE SUR LE BANC (`PUT_BASIC_ON_BENCH`)
  // ==========================================================================
  const maxBenchSlots = getMaxBenchSlots(activeBoard, state.activeStadium)
  if (activeBoard.bench.length < maxBenchSlots) {
    const seenBasicIds = new Set<string>()
    activeBoard.hand.forEach((card, handIdx) => {
      if (card.category === 'POKEMON' && card.subCategory === 'BASIC') {
        if (seenBasicIds.has(card.cardId)) return
        seenBasicIds.add(card.cardId)
        actions.push({
          type: 'PUT_BASIC_ON_BENCH',
          cardId: card.cardId,
          handIndex: handIdx,
          label: `Poser ${card.identity.nameFr} sur le Banc`,
        })
      }
    })
  }

  // ==========================================================================
  // 2. ÉVOLUTION NORMALE DEPUIS LA MAIN (`NORMAL_EVOLVE`)
  // ==========================================================================
  if (!isFirstTurnOfPlayer) {
    const seenEvoPairs = new Set<string>()
    activeBoard.hand.forEach((card, handIdx) => {
      if (
        card.category === 'POKEMON' &&
        (card.subCategory === 'STAGE_1' || card.subCategory === 'STAGE_2')
      ) {
        if (
          activeBoard.activePokemon &&
          canPokemonEvolveInto(activeBoard.activePokemon, card, state.turnNumber, false)
        ) {
          const key = `${card.cardId}->ACTIVE`
          if (!seenEvoPairs.has(key)) {
            seenEvoPairs.add(key)
            actions.push({
              type: 'NORMAL_EVOLVE',
              cardId: card.cardId,
              handIndex: handIdx,
              targetSlot: 'ACTIVE',
              label: `Faire évoluer ${activeBoard.activePokemon.card.identity.nameFr} (Actif) en ${card.identity.nameFr}`,
            })
          }
        }

        activeBoard.bench.forEach((bPoke, bIdx) => {
          if (canPokemonEvolveInto(bPoke, card, state.turnNumber, false)) {
            const key = `${card.cardId}->BENCH_${bPoke.card.cardId}_${bPoke.attachedEnergies.length}`
            if (!seenEvoPairs.has(key)) {
              seenEvoPairs.add(key)
              actions.push({
                type: 'NORMAL_EVOLVE',
                cardId: card.cardId,
                handIndex: handIdx,
                targetSlot: bIdx,
                label: `Faire évoluer ${bPoke.card.identity.nameFr} (Banc #${bIdx + 1}) en ${card.identity.nameFr}`,
              })
            }
          }
        })
      }
    })
  }

  // ==========================================================================
  // 3. ATTACHER UNE ÉNERGIE MANUELLE (`ATTACH_MANUAL_ENERGY`)
  // ==========================================================================
  if (!activeBoard.energyAttachedThisTurn) {
    const seenEnergyIds = new Set<string>()
    activeBoard.hand.forEach((card, handIdx) => {
      if (card.category === 'ENERGY' && !seenEnergyIds.has(card.cardId)) {
        seenEnergyIds.add(card.cardId)

        if (activeBoard.activePokemon) {
          actions.push({
            type: 'ATTACH_MANUAL_ENERGY',
            cardId: card.cardId,
            handIndex: handIdx,
            targetSlot: 'ACTIVE',
            label: `Attacher ${card.identity.nameFr} à ${activeBoard.activePokemon.card.identity.nameFr} (Actif)`,
          })
        }

        const seenBenchTargetKeys = new Set<string>()
        activeBoard.bench.forEach((bPoke, bIdx) => {
          const targetKey = `${bPoke.card.cardId}_${bPoke.attachedEnergies.length}`
          if (seenBenchTargetKeys.has(targetKey)) return
          seenBenchTargetKeys.add(targetKey)
          actions.push({
            type: 'ATTACH_MANUAL_ENERGY',
            cardId: card.cardId,
            handIndex: handIdx,
            targetSlot: bIdx,
            label: `Attacher ${card.identity.nameFr} à ${bPoke.card.identity.nameFr} (Banc #${bIdx + 1})`,
          })
        })
      }
    })
  }

  // ==========================================================================
  // 4. CARTES DRESSEUR EN MAIN (`PLAY_TRAINER`)
  // ==========================================================================
  const seenTrainerIds = new Set<string>()
  activeBoard.hand.forEach((card, handIdx) => {
    if (card.category !== 'TRAINER') return
    if (seenTrainerIds.has(card.cardId)) return
    seenTrainerIds.add(card.cardId)

    // Blocage par Item Lock (attaque ou talent passif)
    if (card.subCategory === 'ITEM' && hasEffectiveItemLock(state, activeBoard)) return

    // Cas des cartes Stade : impossible de poser un stade du même nom
    if (card.subCategory === 'STADIUM') {
      if (
        state.activeStadium &&
        normalizeCardNameForMatch(state.activeStadium.card.identity.nameFr) ===
          normalizeCardNameForMatch(card.identity.nameFr)
      ) {
        return
      }
      actions.push({
        type: 'PLAY_TRAINER',
        cardId: card.cardId,
        handIndex: handIdx,
        label: `Jouer le Stade ${card.identity.nameFr}`,
      })
      return
    }

    // Tout Outil Pokémon (`TOOL`) s'attache directement à un Pokémon en jeu sans Outil (même s'il porte des `effects` passifs comme Cape Héroïque / Ballon)
    if (card.subCategory === 'TOOL') {
      if (activeBoard.activePokemon && activeBoard.activePokemon.attachedTools.length === 0) {
        actions.push({
          type: 'PLAY_TRAINER',
          cardId: card.cardId,
          handIndex: handIdx,
          targetSlot: 'ACTIVE',
          label: `Attacher ${card.identity.nameFr} à ${activeBoard.activePokemon.card.identity.nameFr} (Actif)`,
        })
      }
      activeBoard.bench.forEach((bPoke, bIdx) => {
        if (bPoke.attachedTools.length === 0) {
          actions.push({
            type: 'PLAY_TRAINER',
            cardId: card.cardId,
            handIndex: handIdx,
            targetSlot: bIdx,
            label: `Attacher ${card.identity.nameFr} à ${bPoke.card.identity.nameFr} (Banc #${bIdx + 1})`,
          })
        }
      })
      return
    }

    for (const pAction of card.playableActions) {
      if (pAction.actionType !== 'PLAY_FROM_HAND' && pAction.sourceType !== 'TRAINER_PLAY') continue
      if (
        !checkActionPreconditions(
          state,
          activeBoard,
          passiveBoard,
          card,
          pAction,
          undefined,
          handIdx,
        )
      ) {
        continue
      }

      // Cas A : Super Bonbon (`EVOLVE_POKEMON` / `EVOLVE_SKIP_STAGE1`) -> Générer une action par couple (Base en jeu -> Stage 2 en main)
      const isRareCandy =
        pAction.effects.some(
          (e) => e.primitive === 'EVOLVE_POKEMON' || (e as any).primitive === 'EVOLVE_SKIP_STAGE1',
        ) &&
        /super.*bonbon|rare.*candy|evolve.*stage.*2/i.test(`${card.identity.nameFr} ${pAction.label}`)
      if (isRareCandy) {
        const stage2InHand = activeBoard.hand.filter(
          (c) => c.category === 'POKEMON' && c.subCategory === 'STAGE_2',
        )
        const seenCandyCombos = new Set<string>()
        for (const s2 of stage2InHand) {
          if (
            activeBoard.activePokemon &&
            canPokemonEvolveInto(activeBoard.activePokemon, s2, state.turnNumber, true)
          ) {
            const comboKey = `ACTIVE->${s2.cardId}`
            if (!seenCandyCombos.has(comboKey)) {
              seenCandyCombos.add(comboKey)
              actions.push({
                type: 'PLAY_TRAINER',
                cardId: card.cardId,
                actionId: pAction.actionId,
                handIndex: handIdx,
                targetSlot: 'ACTIVE',
                targetCardIds: [s2.cardId],
                label: `Jouer ${card.identity.nameFr} : ${activeBoard.activePokemon.card.identity.nameFr} (Actif) → ${s2.identity.nameFr}`,
              })
            }
          }
          activeBoard.bench.forEach((bPoke, bIdx) => {
            if (canPokemonEvolveInto(bPoke, s2, state.turnNumber, true)) {
              const comboKey = `BENCH_${bPoke.card.cardId}->${s2.cardId}`
              if (!seenCandyCombos.has(comboKey)) {
                seenCandyCombos.add(comboKey)
                actions.push({
                  type: 'PLAY_TRAINER',
                  cardId: card.cardId,
                  actionId: pAction.actionId,
                  handIndex: handIdx,
                  targetSlot: bIdx,
                  targetCardIds: [s2.cardId],
                  label: `Jouer ${card.identity.nameFr} : ${bPoke.card.identity.nameFr} (Banc #${bIdx + 1}) → ${s2.identity.nameFr}`,
                })
              }
            }
          })
        }
        continue
      }

      // Cas B : Gust du Banc adverse (`SWITCH_ACTIVE` ciblant le Banc/Actif adverse ou `GUST_OPPONENT_BENCH`)
      const hasGust = pAction.effects.some((e) => {
        if ((e as any).primitive === 'GUST_OPPONENT_BENCH') return true
        if (e.primitive !== 'SWITCH_ACTIVE') return false
        const t = (e.target || '').toUpperCase()
        const tz = ((e as any).targetZone || '').toUpperCase()
        const sz = (e.sourceZone || '').toUpperCase()
        return (
          t === 'OPPONENT_BENCH' ||
          t === 'OPPONENT_BENCH_SINGLE' ||
          t === 'OPPONENT_ACTIVE' ||
          t === 'OPPONENT' ||
          t === 'OPPONENT_POKEMON_ANY' ||
          tz === 'OPPONENT_BENCH' ||
          (sz === 'BENCH' &&
            t !== 'OWN_BENCH' &&
            t !== 'OWN_BENCH_SINGLE' &&
            t !== 'OWN_ACTIVE' &&
            t !== 'SELF')
        )
      })
      if (hasGust) {
        const seenOppTargets = new Set<string>()
        passiveBoard.bench.forEach((oppBench, obIdx) => {
          const oppKey = `${oppBench.card.cardId}_${oppBench.damage}_${oppBench.attachedEnergies.length}`
          if (seenOppTargets.has(oppKey)) return
          seenOppTargets.add(oppKey)
          actions.push({
            type: 'PLAY_TRAINER',
            cardId: card.cardId,
            actionId: pAction.actionId,
            handIndex: handIdx,
            targetBenchIndex: obIdx,
            label: `Jouer ${card.identity.nameFr} → Cibler ${oppBench.card.identity.nameFr} adverse (${getRemainingHp(oppBench, state)} PV)`,
          })
        })
        continue
      }

      // Cas C : Recherche ciblée d'1 Pokémon dans le deck vers la main (ex: Hyper Ball)
      const searchEffects = pAction.effects.filter(
        (e) => e.primitive === 'SEARCH_DECK' || (e as any).primitive === 'SEARCH_DECK_TO_HAND',
      )
      const isSinglePokemonTutor =
        searchEffects.length === 1 &&
        !pAction.effects.some(
          (e) => e.primitive !== 'DISCARD_CARDS' && e.primitive !== 'SEARCH_DECK',
        ) &&
        (searchEffects[0]!.count ?? 1) === 1 &&
        searchEffects[0]!.destinationZone !== 'BENCH' &&
        (searchEffects[0]!.filter?.toUpperCase().includes('POKEMON') ||
          searchEffects[0]!.targetFilter?.category === 'POKEMON')
      if (isSinglePokemonTutor) {
        const topCandidates = selectBestDeckTutorTargets(
          state,
          activeBoard,
          passiveBoard,
          searchEffects[0]!,
          2,
        )
        for (const targetModel of topCandidates) {
          actions.push({
            type: 'PLAY_TRAINER',
            cardId: card.cardId,
            actionId: pAction.actionId,
            handIndex: handIdx,
            targetCardIds: [targetModel.cardId],
            label: `Jouer ${card.identity.nameFr} → Chercher ${targetModel.identity.nameFr}`,
          })
        }
        continue
      }

      // Cas D : Autres Dresseurs (Poffin Copain-Copain, Faiblo Ball, Pepper, Mashynn, Recherches, Urne Terrestre, etc.)
      actions.push({
        type: 'PLAY_TRAINER',
        cardId: card.cardId,
        actionId: pAction.actionId,
        handIndex: handIdx,
        label: `Jouer ${card.identity.nameFr}`,
      })
    }
  })

  // ==========================================================================
  // 5. TALENTS ACTIVABLES EN JEU (`USE_ABILITY`)
  // ==========================================================================
  const allInPlayWithSlot: Array<{ poke: InPlayPokemon; slot: 'ACTIVE' | number }> = []
  if (activeBoard.activePokemon) {
    allInPlayWithSlot.push({ poke: activeBoard.activePokemon, slot: 'ACTIVE' })
  }
  activeBoard.bench.forEach((bPoke, bIdx) => {
    allInPlayWithSlot.push({ poke: bPoke, slot: bIdx })
  })

  for (const { poke, slot } of allInPlayWithSlot) {
    for (const pAction of poke.card.playableActions) {
      if (pAction.actionType !== 'USE_ABILITY' && pAction.sourceType !== 'ABILITY_ACTIVATED') continue
      // Exclure les talents passifs / réactifs / checkup
      if (
        pAction.timingPhase === 'ATTACK_PHASE' ||
        pAction.timing === 'PASSIVE_CONTINUOUS' ||
        pAction.timing === 'ON_DAMAGED_OR_KO_TRIGGER' ||
        pAction.timing === 'BETWEEN_TURNS_CHECKUP'
      ) {
        continue
      }
      // Verrou AS_OFTEN_AS_YOU_LIKE (max 6 utilisations par tour)
      if (pAction.timing === 'AS_OFTEN_AS_YOU_LIKE') {
        const usageCount = activeBoard.abilityUsageCountsThisTurn?.[pAction.actionId] || 0
        if (usageCount >= 6) continue
      }
      if (!checkActionPreconditions(state, activeBoard, passiveBoard, poke.card, pAction, poke)) {
        continue
      }

      const endsTurn =
        Array.isArray(pAction.costs) &&
        pAction.costs.some((c) => c.type === 'END_TURN_IMMEDIATELY')

      // Si c'est Recherche Rapide (Roucarnage-ex), génère jusqu'à 2 meilleures cibles stratégiques du deck
      const isQuickSearch =
        pAction.actionId === 'ability_quick_search' ||
        /recherche rapide|quick search/i.test(pAction.label || '')
      if (isQuickSearch) {
        const bestTargets = selectBestDeckTutorTargets(state, activeBoard, passiveBoard, null, 2)
        for (const targetModel of bestTargets) {
          actions.push({
            type: 'USE_ABILITY',
            sourceSlot: slot,
            cardId: poke.card.cardId,
            actionId: pAction.actionId,
            targetCardIds: [targetModel.cardId],
            endsTurnImmediately: endsTurn,
            label: `Talent ${pAction.label} (${poke.card.identity.nameFr}) → Tutorer ${targetModel.identity.nameFr}`,
          })
        }
      } else {
        actions.push({
          type: 'USE_ABILITY',
          sourceSlot: slot,
          cardId: poke.card.cardId,
          actionId: pAction.actionId,
          endsTurnImmediately: endsTurn,
          label: `Talent ${pAction.label} (${poke.card.identity.nameFr})`,
        })
      }
    }
  }

  // 5b. Effet activable de Stade en jeu (`ONCE_PER_TURN_STADIUM`)
  if (state.activeStadium && !state.activeStadium.usedThisTurn) {
    for (const stadAction of state.activeStadium.card.playableActions) {
      if (
        stadAction.timingPhase === 'MAIN_PHASE_1' ||
        stadAction.timing === 'ONCE_PER_TURN_STADIUM' ||
        stadAction.actionType === 'PLAY_FROM_HAND' ||
        stadAction.sourceType === 'STADIUM_EFFECT'
      ) {
        if (
          checkActionPreconditions(
            state,
            activeBoard,
            passiveBoard,
            state.activeStadium.card,
            stadAction,
          )
        ) {
          actions.push({
            type: 'USE_ABILITY',
            cardId: state.activeStadium.card.cardId,
            actionId: stadAction.actionId,
            label: `Stade ${state.activeStadium.card.identity.nameFr} : ${stadAction.label}`,
          })
        }
      }
    }
  }

  // ==========================================================================
  // 6. RETRAITE DU POKÉMON ACTIF (`RETREAT_ACTIVE`)
  // ==========================================================================
  const activeConditions = activeBoard.activePokemon?.specialConditions || []
  const isImmobilized =
    activeConditions.includes('ASLEEP') ||
    activeConditions.includes('PARALYZED') ||
    Boolean(activeBoard.activePokemon?.cantRetreatNextTurn)
  if (
    !activeBoard.retreatUsedThisTurn &&
    activeBoard.activePokemon &&
    activeBoard.bench.length > 0 &&
    !isImmobilized
  ) {
    const retreatCost = getPokemonRetreatCost(activeBoard.activePokemon, activeBoard, state)
    if (canPayEnergyCost(activeBoard.activePokemon.attachedEnergies, { Incolore: retreatCost })) {
      const seenRetreatTargets = new Set<string>()
      activeBoard.bench.forEach((bPoke, bIdx) => {
        const key = `${bPoke.card.cardId}_${bPoke.attachedEnergies.length}_${bPoke.damage}`
        if (seenRetreatTargets.has(key)) return
        seenRetreatTargets.add(key)
        actions.push({
          type: 'RETREAT_ACTIVE',
          targetBenchIndex: bIdx,
          label: `Battre en retraite (${activeBoard.activePokemon!.card.identity.nameFr}, -${retreatCost} NRJ) → Promouvoir ${bPoke.card.identity.nameFr}`,
        })
      })
    }
  }

  // ==========================================================================
  // 7. DÉCLARER UNE ATTAQUE (`DECLARE_ATTACK`) — CLÔTURE DE TOUR
  // ==========================================================================
  const activePoke = activeBoard.activePokemon
  const isAttackBlocked = isPokemonAttackBlocked(activePoke, state)
  if (activePoke && !isAttackBlocked) {
    // 7a. Attaques propres au Pokémon Actif
    for (const pAction of activePoke.card.playableActions) {
      if (pAction.actionType !== 'ATTACK' && pAction.sourceType !== 'ATTACK') continue
      if (
        !checkActionPreconditions(
          state,
          activeBoard,
          passiveBoard,
          activePoke.card,
          pAction,
          activePoke,
        )
      ) {
        continue
      }

      const dmgInfo = computeAttackDamageToActive(activeBoard, passiveBoard, pAction, state)
      const isDoubleAtk = canPokemonAttackTwice(activePoke, state)
      const totalEstimatedActiveDmg = isDoubleAtk ? dmgInfo.activeDamage * 2 : dmgInfo.activeDamage
      const totalEstimatedBenchDmg = isDoubleAtk ? dmgInfo.benchDamage * 2 : dmgInfo.benchDamage
      const oppActiveName = passiveBoard.activePokemon?.card.identity.nameFr || 'Actif adverse'
      const dmgLabel =
        dmgInfo.activeDamage > 0
          ? `${dmgInfo.activeDamage}${isDoubleAtk ? ' ×2 (Fête Battante)' : ''} dégâts sur ${oppActiveName}${dmgInfo.benchDamage > 0 ? ` + ${dmgInfo.benchDamage} Banc` : ''}`
          : 'Effet tactique'

      actions.push({
        type: 'DECLARE_ATTACK',
        cardId: activePoke.card.cardId,
        actionId: pAction.actionId,
        estimatedDamage: totalEstimatedActiveDmg + totalEstimatedBenchDmg,
        endsTurnImmediately: true,
        label: `Attaque ${pAction.label} (${activePoke.card.identity.nameFr}) : ${dmgLabel}`,
      })
    }

    // 7b. Attaques conférées par les Machines Techniques attachées
    for (const tool of activePoke.attachedTools) {
      if (
        tool.identity.isTechnicalMachine ||
        tool.playableActions.some((a) => a.actionType === 'ATTACK' || a.sourceType === 'ATTACK')
      ) {
        for (const tmAction of tool.playableActions) {
          if (tmAction.actionType !== 'ATTACK' && tmAction.sourceType !== 'ATTACK') continue
          if (
            !checkActionPreconditions(
              state,
              activeBoard,
              passiveBoard,
              tool,
              tmAction,
              activePoke,
            )
          ) {
            continue
          }
          const dmgInfo = computeAttackDamageToActive(activeBoard, passiveBoard, tmAction, state)
          actions.push({
            type: 'DECLARE_ATTACK',
            cardId: tool.cardId,
            actionId: tmAction.actionId,
            estimatedDamage: dmgInfo.activeDamage + dmgInfo.benchDamage,
            endsTurnImmediately: true,
            label: `Attaque TM ${tmAction.label} (${tool.identity.nameFr}) : ${dmgInfo.activeDamage > 0 ? `${dmgInfo.activeDamage} dégâts` : 'Effet tactique'}`,
          })
        }
      }
    }
  }

  // ==========================================================================
  // 8. PASSER LE TOUR SANS ATTAQUER (`PASS_TURN`) — CLÔTURE DE TOUR
  // ==========================================================================
  actions.push({
    type: 'PASS_TURN',
    endsTurnImmediately: true,
    label: 'Terminer le tour sans attaquer',
  })

  return actions
}

/**
 * Sélectionne les meilleures cibles distinctes dans le deck lors d'un effet de recherche (`SEARCH_DECK_TO_HAND`).
 */
export function selectBestDeckTutorTargets(
  state: MatchState,
  activeBoard: PlayerBoardState,
  passiveBoard: PlayerBoardState,
  filterOrEff: CardFilter | AtomicEffect | string | null | undefined,
  maxDistinctTargets = 2,
): EngineCardModel[] {
  const matchesFilter = (card: EngineCardModel): boolean => {
    if (!filterOrEff) return true
    if (typeof filterOrEff === 'string') return matchesDslFilter(card, filterOrEff)
    if ('primitive' in filterOrEff) return cardMatchesEffectFilter(card, filterOrEff)
    return matchesCardFilter(card, filterOrEff)
  }

  const uniqueByCardId = new Map<string, EngineCardModel>()
  for (const card of activeBoard.deck) {
    if (!uniqueByCardId.has(card.cardId) && matchesFilter(card)) {
      uniqueByCardId.set(card.cardId, card)
    }
  }

  const candidates = Array.from(uniqueByCardId.values())
  if (candidates.length <= maxDistinctTargets) return candidates

  const allInPlay = [
    ...(activeBoard.activePokemon ? [activeBoard.activePokemon] : []),
    ...activeBoard.bench,
  ]
  const hasCandyInHand = activeBoard.hand.some((c) => c.cardId === 'sv04-125')
  const hasStage2InHand = activeBoard.hand.some(
    (c) => c.category === 'POKEMON' && c.subCategory === 'STAGE_2',
  )
  const canEvolveReadyBasic = allInPlay.some(
    (p) => p.card.subCategory === 'BASIC' && p.turnPlayed < state.turnNumber && !p.evolvedThisTurn,
  )

  const scoreCandidate = (c: EngineCardModel): number => {
    let score = c.strategicEvaluator.intrinsicBaseScore ?? (c.strategicEvaluator.aiRole === 'MAIN_ATTACKER' ? 90 : 70)
    if (isCardDeadInHand(c, activeBoard, passiveBoard)) return -100

    // Si on a Super Bonbon en main et une base prête, un Stage 2 évoluable (Dracaufeu-ex / Roucarnage-ex) est prioritaire absolu !
    if (c.category === 'POKEMON' && c.subCategory === 'STAGE_2') {
      const canEvoNow =
        hasCandyInHand &&
        allInPlay.some((p) => canPokemonEvolveInto(p, c, state.turnNumber, true))
      const canNormalEvoNow = allInPlay.some((p) =>
        canPokemonEvolveInto(p, c, state.turnNumber, false),
      )
      if (canEvoNow || canNormalEvoNow) {
        score += 120
        if ((c.strategicEvaluator.aiRole as string) === 'MAIN_ATTACKER' || c.strategicEvaluator.primaryRole === 'MAIN_ATTACKER') score += 25
        if ((c.strategicEvaluator.aiRole as string) === 'CONSISTENCY_BOOSTER' || (c.strategicEvaluator.primaryRole as string) === 'TUTOR_ENGINE_POKEMON') score += 20
      } else if (state.turnNumber === 1) {
        score -= 40
      }
    }

    // Si on a un Stage 2 en main et une base prête, Super Bonbon est prioritaire absolu !
    if (c.cardId === 'sv04-125' && hasStage2InHand && canEvolveReadyBasic) {
      score += 130
    }

    // Au Tour 1, privilégier les Pokémon de base ou déployeurs de banc
    if (state.turnNumber <= 2 && c.category === 'POKEMON' && c.subCategory === 'BASIC') {
      const alreadyCount = allInPlay.filter((p) => p.card.cardId === c.cardId).length
      if (alreadyCount === 0) score += 45
    }

    // Si un Pokémon en jeu peut évoluer en ce Stage 1 maintenant (ex: Dispareptil, Kirlia, Reptincel)
    if (c.category === 'POKEMON' && c.subCategory === 'STAGE_1') {
      const canStage1Now = allInPlay.some((p) =>
        canPokemonEvolveInto(p, c, state.turnNumber, false),
      )
      if (canStage1Now) score += 85
    }

    return score
  }

  const scored = candidates.map((c) => ({ card: c, score: scoreCandidate(c) }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, maxDistinctTargets).map((s) => s.card)
}

/**
 * Choisit les cartes les moins utiles (ou cartes mortes en priorité via `discardPriorityWhenDead`)
 * à défausser de la main pour payer un coût `DISCARD_FROM_HAND`.
 */
function discardCardsFromHandForCost(
  activeBoard: PlayerBoardState,
  passiveBoard: PlayerBoardState,
  cost: ActionCost,
): void {
  const countToDiscard = cost.count || 1
  for (let i = 0; i < countToDiscard; i++) {
    if (activeBoard.hand.length === 0) break

    let bestDiscardIdx = -1
    let bestDiscardScore = -99999

    activeBoard.hand.forEach((c, idx) => {
      if (!matchesCardFilter(c, cost.targetFilter)) return
      const isLastCardComboTarget =
        !activeBoard.supporterPlayedThisTurn &&
        c.playableActions.some((a) =>
          a.preconditions.some((p) => (typeof p === 'string' ? p : (p as any)?.type) === 'HAND_MAX_OTHER_CARDS_ZERO'),
        )
      if (isLastCardComboTarget && activeBoard.hand.length > 1) {
        if (-5000 > bestDiscardScore) {
          bestDiscardScore = -5000
          bestDiscardIdx = idx
        }
        return
      }
      const isDead = isCardDeadInHand(c, activeBoard, passiveBoard)
      // Dans un deck Gardevoir/Ire-Foudre, défausser une Énergie de base est souvent synergique !
      const isSynergisticBasicEnergy = c.category === 'ENERGY' && c.subCategory === 'BASIC_ENERGY'
      const discardScore = isDead
        ? 1000 + (c.strategicEvaluator.discardPriorityWhenDead ?? 10)
        : isSynergisticBasicEnergy
          ? 220 - (c.strategicEvaluator.intrinsicBaseScore ?? 70)
          : 120 - (c.strategicEvaluator.intrinsicBaseScore ?? 70)
      if (discardScore > bestDiscardScore) {
        bestDiscardScore = discardScore
        bestDiscardIdx = idx
      }
    })

    if (bestDiscardIdx === -1) {
      bestDiscardIdx = 0
    }
    const discarded = activeBoard.hand.splice(bestDiscardIdx, 1)[0]
    if (discarded) {
      activeBoard.discard.push(discarded)
    }
  }
}

/**
 * Exécute un coup atomique sur une copie de `state` (ou en place si `mutateInPlace = true`) et retourne l'état (`applyAction`).
 */
export function applyAction(
  inputState: MatchState,
  action: GameAction,
  includeActionLog = false,
  mutateInPlace = false,
): MatchState {
  const state = mutateInPlace ? inputState : fastCloneState(inputState, includeActionLog)
  if (state.winner !== null) return state

  const activeBoard = getActiveBoard(state)
  const passiveBoard = getPassiveBoard(state)
  const rng = new Mulberry32(state.rngState)

  const markDeckSearched = () => {
    if (!activeBoard.prizesKnownByPlayer) {
      activeBoard.prizesKnownByPlayer = true
      activeBoard.firstSearchTurn = state.turnNumber
    }
  }

  switch (action.type) {
    // ------------------------------------------------------------------------
    // 1. POSER UN POKÉMON DE BASE SUR LE BANC
    // ------------------------------------------------------------------------
    case 'PUT_BASIC_ON_BENCH': {
      const idx =
        action.handIndex !== undefined &&
        activeBoard.hand[action.handIndex]?.cardId === action.cardId
          ? action.handIndex
          : activeBoard.hand.findIndex((c) => c.cardId === action.cardId)
      const maxSlots = getMaxBenchSlots(activeBoard, state.activeStadium)
      if (idx !== -1 && activeBoard.bench.length < maxSlots) {
        const card = activeBoard.hand.splice(idx, 1)[0]!
        const newBenchPoke: InPlayPokemon = {
          instanceId: `p_${state.nextInstanceSeq++}`,
          card,
          previousStages: [],
          damage: 0,
          attachedEnergies: [],
          attachedTools: [],
          turnPlayed: state.turnNumber,
          evolvedThisTurn: false,
          specialConditions: [],
          cantAttackNextTurn: false,
        }
        activeBoard.bench.push(newBenchPoke)
        state.lastActionLog.push(action.label)

        // Déclencher uniquement les talents réactifs à la pose de la main (TRIGGERED_ABILITY / ABILITY_ON_PLAY_FROM_HAND)
        for (const pAction of card.playableActions) {
          const rulesJoined = `${pAction.label} ${(card.identity.rawRulesText || []).join(' ')}`
          const isReactionToDamageOrKo =
            pAction.timing === 'ON_DAMAGED_OR_KO_TRIGGER' ||
            pAction.timing === 'ON_EVOLVE_TRIGGER' ||
            pAction.sourceType === 'ABILITY_ON_EVOLVE' ||
            /subit des d[eé]g[aâ]ts|d[eé]g[aâ]ts d'une attaque|damaged by an opponent|mise? k\.?o\.?|knocked out/i.test(
              rulesJoined,
            ) ||
            (pAction.preconditions || []).some((p) =>
              /SELF_IS_DAMAGED|KO|EVOLV/i.test(String(p)),
            )
          const isExplicitOnPlayTrigger =
            pAction.sourceType === 'ABILITY_ON_PLAY_FROM_HAND' ||
            pAction.timing === 'ON_PLAY_FROM_HAND_TRIGGER' ||
            (pAction.actionType === 'TRIGGERED_ABILITY' && !isReactionToDamageOrKo)

          if (
            isExplicitOnPlayTrigger &&
            !isAbilityLockedByPassive(state, newBenchPoke, activeBoard) &&
            checkActionPreconditions(state, activeBoard, passiveBoard, card, pAction, newBenchPoke)
          ) {
            const normLabel = normalizeCardNameForMatch(pAction.label || '')
            if (
              pAction.actionId === 'ability_squawk_and_seize' ||
              /squawk.*seize|mise en page|tapatoes|prise tapageuse/i.test(
                `${pAction.actionId} ${normLabel}`,
              )
            ) {
              activeBoard.usedOncePerTurnAbilities.add('ability_squawk_and_seize')
            }
            for (const eff of pAction.effects) {
              resolveAtomicEffect(
                state,
                activeBoard,
                passiveBoard,
                eff,
                action,
                rng,
                markDeckSearched,
                { sourcePoke: newBenchPoke },
              )
            }
          }
        }
      }
      break
    }

    // ------------------------------------------------------------------------
    // 2. ATTACHER UNE ÉNERGIE MANUELLE DE LA MAIN
    // ------------------------------------------------------------------------
    case 'ATTACH_MANUAL_ENERGY': {
      const idx =
        action.handIndex !== undefined &&
        activeBoard.hand[action.handIndex]?.cardId === action.cardId
          ? action.handIndex
          : activeBoard.hand.findIndex((c) => c.cardId === action.cardId)
      if (idx !== -1 && !activeBoard.energyAttachedThisTurn) {
        const energyCard = activeBoard.hand.splice(idx, 1)[0]!
        const targetPoke =
          action.targetSlot === 'ACTIVE'
            ? activeBoard.activePokemon
            : typeof action.targetSlot === 'number'
              ? activeBoard.bench[action.targetSlot] ?? null
              : activeBoard.activePokemon
        if (targetPoke) {
          targetPoke.attachedEnergies.push(energyCard)
          activeBoard.energyAttachedThisTurn = true
          state.lastActionLog.push(action.label)
        } else {
          activeBoard.hand.push(energyCard)
        }
      }
      break
    }

    // ------------------------------------------------------------------------
    // 3. ÉVOLUTION NORMALE DEPUIS LA MAIN
    // ------------------------------------------------------------------------
    case 'NORMAL_EVOLVE': {
      const idx =
        action.handIndex !== undefined &&
        activeBoard.hand[action.handIndex]?.cardId === action.cardId
          ? action.handIndex
          : activeBoard.hand.findIndex((c) => c.cardId === action.cardId)
      if (idx !== -1) {
        const targetPoke =
          action.targetSlot === 'ACTIVE'
            ? activeBoard.activePokemon
            : typeof action.targetSlot === 'number'
              ? activeBoard.bench[action.targetSlot] ?? null
              : null
        if (targetPoke && canPokemonEvolveInto(targetPoke, activeBoard.hand[idx]!, state.turnNumber, false)) {
          const evoCard = activeBoard.hand.splice(idx, 1)[0]!
          evolveInPlayPokemon(state, activeBoard, targetPoke, evoCard, markDeckSearched)
          state.lastActionLog.push(action.label)
        }
      }
      break
    }

    // ------------------------------------------------------------------------
    // 4. BATTRE EN RETRAITE
    // ------------------------------------------------------------------------
    case 'RETREAT_ACTIVE': {
      const benchIdx = action.targetBenchIndex ?? 0
      const activePoke = activeBoard.activePokemon
      const benchPoke = activeBoard.bench[benchIdx]
      if (activePoke && benchPoke && !activeBoard.retreatUsedThisTurn && !activePoke.cantRetreatNextTurn) {
        const retreatCost = getPokemonRetreatCost(activePoke, activeBoard, state)
        for (let i = 0; i < retreatCost && activePoke.attachedEnergies.length > 0; i++) {
          const discardedEn = activePoke.attachedEnergies.pop()!
          activeBoard.discard.push(discardedEn)
        }
        activePoke.specialConditions = []
        activePoke.cantAttackNextTurn = false
        activePoke.cantAttackTurn = undefined
        activePoke.cantRetreatNextTurn = false
        activePoke.cantRetreatTurn = undefined

        activeBoard.activePokemon = benchPoke
        activeBoard.bench[benchIdx] = activePoke
        activeBoard.retreatUsedThisTurn = true
        state.lastActionLog.push(action.label)
      }
      break
    }

    // ------------------------------------------------------------------------
    // 5. JOUER UNE CARTE DRESSEUR DEPUIS LA MAIN
    // ------------------------------------------------------------------------
    case 'PLAY_TRAINER': {
      const idx =
        action.handIndex !== undefined &&
        activeBoard.hand[action.handIndex]?.cardId === action.cardId
          ? action.handIndex
          : activeBoard.hand.findIndex((c) => c.cardId === action.cardId)
      if (idx === -1) break

      const trainerCard = activeBoard.hand.splice(idx, 1)[0]!

      // Cas d'un Stade
      if (trainerCard.subCategory === 'STADIUM') {
        if (state.activeStadium) {
          const prevOwner = state.activeStadium.ownerIndex === 0 ? state.player : state.opponent
          prevOwner.discard.push(state.activeStadium.card)
        }
        state.activeStadium = {
          card: trainerCard,
          ownerIndex: state.activePlayerIndex,
          usedThisTurn: false,
        }
        enforceBenchCapacity(activeBoard, getMaxBenchSlots(activeBoard, state.activeStadium))
        enforceBenchCapacity(passiveBoard, getMaxBenchSlots(passiveBoard, state.activeStadium))
        state.lastActionLog.push(action.label)
        break
      }

      // Tout Outil Pokémon s'attache au Pokémon ciblé (même si le modèle déclare des effets passifs)
      if (trainerCard.subCategory === 'TOOL') {
        const targetPoke =
          action.targetSlot === 'ACTIVE'
            ? activeBoard.activePokemon
            : typeof action.targetSlot === 'number'
              ? activeBoard.bench[action.targetSlot] ?? activeBoard.activePokemon
              : activeBoard.activePokemon
        if (targetPoke) {
          targetPoke.attachedTools.push(trainerCard)
          state.lastActionLog.push(action.label)
        } else {
          activeBoard.discard.push(trainerCard)
        }
        break
      }

      const pAction =
        trainerCard.playableActions.find((a) => a.actionId === action.actionId) ||
        trainerCard.playableActions[0]

      if (trainerCard.subCategory === 'SUPPORTER' || pAction?.timing === 'ONCE_PER_TURN_SUPPORTER') {
        activeBoard.supporterPlayedThisTurn = true
      }
      if (pAction?.timing === 'ONCE_PER_GAME_VSTAR') {
        activeBoard.vstarPowerUsed = true
      }

      // Cas spécifique Tampon Injuste / Unfair Stamp (`sv06-165` ou `play_unfair_stamp`)
      const isUnfairStamp =
        trainerCard.cardId === 'sv06-165' ||
        action.actionId === 'play_unfair_stamp' ||
        /tampon injuste|unfair stamp/i.test(trainerCard.identity.nameFr)

      if (isUnfairStamp) {
        const myHand = activeBoard.hand.splice(0, activeBoard.hand.length)
        activeBoard.deck.push(...myHand)
        fisherYatesShuffle(activeBoard.deck, rng)
        for (let i = 0; i < 5 && activeBoard.deck.length > 0; i++) {
          activeBoard.hand.push(activeBoard.deck.shift()!)
        }
        const oppHand = passiveBoard.hand.splice(0, passiveBoard.hand.length)
        passiveBoard.deck.push(...oppHand)
        fisherYatesShuffle(passiveBoard.deck, rng)
        for (let i = 0; i < 2 && passiveBoard.deck.length > 0; i++) {
          passiveBoard.hand.push(passiveBoard.deck.shift()!)
        }
      } else if (pAction) {
        // Paiement des coûts (ex: défausse de 2 cartes pour Hyper Ball, 1 carte pour Urne Terrestre)
        for (const cost of (pAction.costs || [])) {
          if (cost.type === 'DISCARD_FROM_HAND') {
            discardCardsFromHandForCost(activeBoard, passiveBoard, cost)
          }
        }

        let handledIonoBottomDeck = false
        // Exécution ordonnée des primitives d'effets
        for (const eff of pAction.effects) {
          if (
            handledIonoBottomDeck &&
            eff.primitive === 'PUT_ON_TOP_OR_BOTTOM_OF_DECK' &&
            eff.sourceZone === 'HAND' &&
            eff.destinationZone === 'BOTTOM_OF_DECK'
          ) {
            continue
          }
          if (
            eff.primitive === 'SHUFFLE_HAND_DRAW' &&
            (eff.scalingMetric === 'PER_PRIZE_REMAINING_PLAYER' ||
              trainerCard.cardId === 'sv02-185' ||
              /mashynn|iono/i.test(trainerCard.identity.nameFr))
          ) {
            handledIonoBottomDeck = true
          }
          resolveAtomicEffect(
            state,
            activeBoard,
            passiveBoard,
            eff,
            action,
            rng,
            markDeckSearched,
            { trainerCard },
          )
        }
      }

      activeBoard.discard.push(trainerCard)
      state.lastActionLog.push(action.label)
      break
    }

    // ------------------------------------------------------------------------
    // 6. ACTIVER UN TALENT DE POKÉMON EN JEU
    // ------------------------------------------------------------------------
    case 'USE_ABILITY': {
      let pAction: PlayableAction | undefined
      let sourcePoke: InPlayPokemon | null = null
      if (state.activeStadium && state.activeStadium.card.cardId === action.cardId) {
        pAction = state.activeStadium.card.playableActions.find((a) => a.actionId === action.actionId)
        state.activeStadium.usedThisTurn = true
      } else {
        sourcePoke =
          action.sourceSlot === 'ACTIVE'
            ? activeBoard.activePokemon
            : typeof action.sourceSlot === 'number'
              ? activeBoard.bench[action.sourceSlot] ?? null
              : activeBoard.activePokemon

        if (!sourcePoke) break
        pAction = sourcePoke.card.playableActions.find((a) => a.actionId === action.actionId)
        if (!pAction) break

        if (pAction.timing === 'AS_OFTEN_AS_YOU_LIKE') {
          activeBoard.abilityUsageCountsThisTurn[pAction.actionId] =
            (activeBoard.abilityUsageCountsThisTurn[pAction.actionId] || 0) + 1
        }

        const normLabel = normalizeCardNameForMatch(pAction.label || '')
        const isSquawk =
          pAction.actionId === 'ability_squawk_and_seize' ||
          /squawk.*seize|mise en page|tapatoes|prise tapageuse/i.test(
            `${pAction.actionId} ${normLabel}`,
          )
        const isGlobalOncePerTurn =
          GLOBAL_ONCE_PER_TURN_ABILITY_IDS.has(pAction.actionId) ||
          /recherche rapide|quick search|taper le pied|flip the script|instant charge|luminous sign|signe lumineux|squawk/i.test(
            normLabel,
          )
        const abilityKey = isGlobalOncePerTurn
          ? isSquawk
            ? 'ability_squawk_and_seize'
            : normLabel || pAction.actionId
          : `${sourcePoke.instanceId}:${pAction.actionId}`
        activeBoard.usedOncePerTurnAbilities.add(abilityKey)
      }

      if (!pAction) break

      // Paiement des coûts du talent (ex: Raffinement de Kirlia, Cartes Cachées d'Amphinobi Radieux, Enlacement Psy, Explosion Maudite)
      let endsTurn = false
      for (const cost of (pAction.costs || [])) {
        if (cost.type === 'DISCARD_FROM_HAND') {
          discardCardsFromHandForCost(activeBoard, passiveBoard, cost)
        } else if (cost.type === 'PUT_DAMAGE_COUNTERS_ON_SELF') {
          // Pour Enlacement Psy (Gardevoir-ex), les marqueurs vont sur le Pokémon recevant l'énergie (géré dans ATTACH_ENERGY_FROM_DISCARD)
        } else if (cost.type === 'END_TURN_IMMEDIATELY') {
          endsTurn = true
        } else if (cost.type === 'KNOCK_OUT_SELF') {
          const isSourceActive =
            sourcePoke && activeBoard.activePokemon?.instanceId === sourcePoke.instanceId
          if (sourcePoke) {
            activeBoard.discard.push(sourcePoke.card)
            for (const st of sourcePoke.previousStages) activeBoard.discard.push(st)
            for (const en of sourcePoke.attachedEnergies) activeBoard.discard.push(en)
            for (const tool of sourcePoke.attachedTools) activeBoard.discard.push(tool)

            if (isSourceActive) {
              activeBoard.activePokemon = null
              if (activeBoard.bench.length > 0) {
                activeBoard.activePokemon = activeBoard.bench.shift()!
              }
            } else {
              const bIdx = activeBoard.bench.findIndex(
                (b) => b.instanceId === sourcePoke.instanceId,
              )
              if (bIdx !== -1) activeBoard.bench.splice(bIdx, 1)
            }

            const prizes = sourcePoke.card.pokemonStats?.prizeCardsGiven ?? 1
            for (let p = 0; p < prizes && passiveBoard.prizes.length > 0; p++) {
              passiveBoard.hand.push(passiveBoard.prizes.shift()!)
            }
            if (passiveBoard.prizes.length === 0) {
              state.winner = activeBoard === state.player ? 'OPPONENT' : 'PLAYER'
              state.winReason = 'ALL_PRIZES_TAKEN'
            }
          }
        } else if (cost.type === 'SELF_DAMAGE') {
          if (sourcePoke) {
            sourcePoke.damage += (cost.count || 1) * 10
            if (sourcePoke.damage >= getPokemonMaxHp(sourcePoke)) {
              const isSourceActive = activeBoard.activePokemon?.instanceId === sourcePoke.instanceId
              handleKnockOut(state, passiveBoard, activeBoard, isSourceActive ? 'ACTIVE' : 0)
            }
          }
        } else if (cost.type === 'SHUFFLE_ATTACHED_ENERGY_TO_DECK') {
          if (sourcePoke) {
            while (sourcePoke.attachedEnergies.length > 0) {
              activeBoard.deck.push(sourcePoke.attachedEnergies.pop()!)
            }
            fisherYatesShuffle(activeBoard.deck, rng)
          }
        } else if (cost.type === 'PUT_HAND_CARD_BOTTOM_DECK') {
          if (activeBoard.hand.length > 0) {
            activeBoard.deck.push(activeBoard.hand.pop()!)
          }
        } else if (cost.type === 'CANT_ATTACK_NEXT_TURN') {
          if (sourcePoke) {
            sourcePoke.cantAttackNextTurn = true
            sourcePoke.cantAttackTurn = state.turnNumber + 2
          }
        }
      }

      for (const eff of pAction.effects) {
        resolveAtomicEffect(
          state,
          activeBoard,
          passiveBoard,
          eff,
          action,
          rng,
          markDeckSearched,
          { sourcePoke },
        )
      }

      state.lastActionLog.push(action.label)

      if (endsTurn) {
        state.rngState = rng.getState()
        endTurnAndAdvance(state)
        return state
      }
      break
    }

    // ------------------------------------------------------------------------
    // 7. DÉCLARER UNE ATTAQUE (FIN DE TOUR)
    // ------------------------------------------------------------------------
    case 'DECLARE_ATTACK': {
      const attacker = activeBoard.activePokemon
      if (!attacker) break
      if (isPokemonAttackBlocked(attacker, state)) break

      const pAction =
        attacker.card.playableActions.find((a) => a.actionId === action.actionId) ||
        attacker.attachedTools
          .flatMap((t) => t.playableActions)
          .find((a) => a.actionId === action.actionId)
      if (!pAction) break

      const effectiveCost = getEffectiveAttackCost(attacker, pAction, state, passiveBoard)
      if (!canPayEnergyCost(attacker.attachedEnergies, effectiveCost)) {
        break
      }

      // Confusion : flip d'attaque (50% de chance d'échec + 30 dégâts sur soi-même)
      if (attacker.specialConditions && attacker.specialConditions.includes('CONFUSED')) {
        const flipSuccess = rng.nextFloat() >= 0.5
        if (!flipSuccess) {
          attacker.damage += 30
          state.lastActionLog.push(`${attacker.card.identity.nameFr} est confus et s'inflige 30 dégâts !`)
          if (attacker.damage >= getPokemonMaxHp(attacker)) {
            handleKnockOut(state, passiveBoard, activeBoard, 'ACTIVE')
          }
          state.rngState = rng.getState()
          endTurnAndAdvance(state)
          return state
        }
      }

      // Enregistrement de cantAttackNextTurn si l'attaque l'impose
      const hasCantAttackNextTurnRule =
        (pAction.costs || []).some((c) => c.type === 'CANT_ATTACK_NEXT_TURN') ||
        (pAction.effects || []).some(
          (e) =>
            ((e.primitive as string) === 'LOCK_NEXT_TURN_ATTACK' && e.target === 'SELF') ||
            (e.primitive as string) === 'CANT_ATTACK_NEXT_TURN',
        ) ||
        /ne peut pas attaquer pendant votre prochain tour|pendant votre prochain tour.*ne peut pas attaquer|during your next turn.*can'?t attack|can'?t attack during your next turn/i.test(
          `${pAction.label} ${attacker.card.identity.rawRulesText?.join(' ') || ''}`,
        )
      if (hasCantAttackNextTurnRule) {
        attacker.cantAttackTurn = state.turnNumber + 2
        attacker.cantAttackNextTurn = true
      }

      // Reset du drapeau KO subi au tour précédent puisque le joueur termine son tour
      activeBoard.koSufferedLastOpponentTurn = false
      passiveBoard.koSufferedLastOpponentTurn = false

      const totalExecutions = canPokemonAttackTwice(attacker, state) ? 2 : 1

      for (let execIdx = 0; execIdx < totalExecutions; execIdx++) {
        if (state.winner !== null || !activeBoard.activePokemon || !passiveBoard.activePokemon) {
          break
        }

        const dmgInfo = computeAttackDamageToActive(activeBoard, passiveBoard, pAction, state, rng)
        let enemyKnockedOutThisAttack = false

        // Défausse d'énergies en jeu si coût d'attaque (ex: Tempête Éclats d'Ire-Foudre-ex)
        if (execIdx === 0 && dmgInfo.energyToDiscard > 0) {
          discardEnergiesFromPlayForAttack(activeBoard, dmgInfo.energyToDiscard)
        }

        if (isZeroEnergyItemLockAttack(pAction)) {
          passiveBoard.itemLockActive = true
        }

        for (const eff of pAction.effects) {
          if (eff.primitive === 'DAMAGE_ACTIVE' || (eff.primitive as any) === 'DEAL_DAMAGE_ACTIVE') {
            const isSelfDmg =
              eff.target === 'SELF' ||
              eff.target === 'OWN_ACTIVE' ||
              eff.target === 'OWN_BENCH_SINGLE' ||
              eff.target === 'OWN_BENCH_ALL' ||
              eff.target === 'OWN_POKEMON_ANY' ||
              eff.target === 'OWN_ALL_POKEMON'
            if (!isSelfDmg && passiveBoard.activePokemon && dmgInfo.activeDamage > 0) {
              passiveBoard.activePokemon.damage += dmgInfo.activeDamage
              triggerOnAttackDamageReactions(
                state,
                activeBoard,
                passiveBoard,
                passiveBoard.activePokemon,
                rng,
                markDeckSearched,
              )
              if (
                passiveBoard.activePokemon &&
                passiveBoard.activePokemon.damage >= getPokemonMaxHp(passiveBoard.activePokemon, state)
              ) {
                enemyKnockedOutThisAttack = true
                handleKnockOut(state, activeBoard, passiveBoard, 'ACTIVE')
              }
            }
          } else if (eff.primitive === 'DAMAGE_BENCH' || (eff.primitive as any) === 'DEAL_DAMAGE_BENCH') {
            // DAMAGE_BENCH inflige des DÉGÂTS au Banc : bloqué par les Téracristals et les talents protecteurs (ex: Manaphy / Bastiodon / Pikachu)
            if (passiveBoard.bench.length > 0 && !isBenchProtectedByPassive(state, passiveBoard)) {
              const benchDmg = dmgInfo.benchDamage > 0
                ? dmgInfo.benchDamage
                : Math.max(0, eff.value ?? eff.baseDamage ?? (eff.count || 1) * 10)
              if (eff.target === 'OPPONENT_BENCH_SINGLE' || eff.target === 'OPPONENT_POKEMON_ANY') {
                let bestIdx = -1
                let bestScore = -9999
                passiveBoard.bench.forEach((bPoke, bIdx) => {
                  if (bPoke.card.pokemonStats?.isTera || bPoke.preventDamageOrEffectsNextTurn) return
                  const remHp = getRemainingHp(bPoke, state)
                  const s = (remHp <= benchDmg ? 500 : 0) + (bPoke.card.strategicEvaluator.intrinsicBaseScore ?? 70) - remHp * 0.4
                  if (s > bestScore) {
                    bestScore = s
                    bestIdx = bIdx
                  }
                })
                if (bestIdx !== -1 && benchDmg > 0) {
                  const targetB = passiveBoard.bench[bestIdx]!
                  targetB.damage += benchDmg
                  if (targetB.damage >= getPokemonMaxHp(targetB, state)) {
                    enemyKnockedOutThisAttack = true
                    handleKnockOut(state, activeBoard, passiveBoard, bestIdx)
                  }
                }
              } else {
                for (let bIdx = passiveBoard.bench.length - 1; bIdx >= 0; bIdx--) {
                  const bPoke = passiveBoard.bench[bIdx]!
                  if (bPoke.card.pokemonStats?.isTera || bPoke.preventDamageOrEffectsNextTurn) continue
                  bPoke.damage += benchDmg
                  if (bPoke.damage >= getPokemonMaxHp(bPoke, state)) {
                    enemyKnockedOutThisAttack = true
                    handleKnockOut(state, activeBoard, passiveBoard, bIdx)
                  }
                }
              }
            }
          } else if (
            eff.primitive === 'PLACE_DAMAGE_COUNTERS' ||
            (eff.primitive as any) === 'DISTRIBUTE_DAMAGE_COUNTERS_BENCH'
          ) {
            if (placeDamageCountersEffect(state, activeBoard, passiveBoard, eff, action, dmgInfo.benchDamage)) {
              enemyKnockedOutThisAttack = true
            }
          } else if (eff.primitive === 'TAKE_EXTRA_PRIZE' || (eff.primitive as any) === 'TAKE_EXTRA_PRIZE_CARDS') {
            if (enemyKnockedOutThisAttack && activeBoard.prizes.length > 0) {
              const extraCount = eff.count || eff.value || 1
              for (let i = 0; i < extraCount && activeBoard.prizes.length > 0; i++) {
                activeBoard.hand.push(activeBoard.prizes.shift()!)
              }
              if (activeBoard.prizes.length === 0) {
                state.winner = activeBoard === state.player ? 'PLAYER' : 'OPPONENT'
                state.winReason = 'ALL_PRIZES_TAKEN'
              }
            }
          } else if (eff.primitive === 'DISCARD_CARDS' && eff.target === 'SELF' && eff.sourceZone === 'ATTACHED_CARDS' && dmgInfo.energyToDiscard > 0) {
            // Déjà défaussé avant la boucle pour PER_ENERGY_DISCARDED
          } else {
            const hadKo = resolveAtomicEffect(
              state,
              activeBoard,
              passiveBoard,
              eff,
              action,
              rng,
              markDeckSearched,
              { enemyKnockedOutThisAttack, dmgInfo, sourcePoke: attacker },
            )
            if (hadKo) enemyKnockedOutThisAttack = true
          }
        }

        // Auto-recul (`DAMAGE_ACTIVE(SELF)` ou `TWO_TAILS_SELF_DAMAGE`)
        if (dmgInfo.selfRecoilDamage > 0 && activeBoard.activePokemon) {
          activeBoard.activePokemon.damage += dmgInfo.selfRecoilDamage
          if (activeBoard.activePokemon.damage >= getPokemonMaxHp(activeBoard.activePokemon, state)) {
            handleKnockOut(state, passiveBoard, activeBoard, 'ACTIVE')
          }
        }
      }

      state.lastActionLog.push(action.label)
      state.rngState = rng.getState()
      endTurnAndAdvance(state)
      return state
    }

    // ------------------------------------------------------------------------
    // 8. PASSER LE TOUR SANS ATTAQUER
    // ------------------------------------------------------------------------
    case 'PASS_TURN': {
      activeBoard.koSufferedLastOpponentTurn = false
      passiveBoard.koSufferedLastOpponentTurn = false
      state.lastActionLog.push(action.label)
      state.rngState = rng.getState()
      endTurnAndAdvance(state)
      return state
    }
  }

  state.rngState = rng.getState()
  return state
}

function evolveInPlayPokemon(
  state: MatchState,
  activeBoard: PlayerBoardState,
  targetPoke: InPlayPokemon,
  evoCard: EngineCardModel,
  markDeckSearched: () => void,
): void {
  targetPoke.previousStages.push(targetPoke.card)
  targetPoke.card = evoCard
  targetPoke.evolvedThisTurn = true
  // L'évolution guérit tous les États Spéciaux et verrous d'attaque/retraite
  targetPoke.specialConditions = []
  targetPoke.cantAttackNextTurn = false
  targetPoke.cantAttackTurn = undefined
  targetPoke.cantRetreatNextTurn = false
  targetPoke.cantRetreatTurn = undefined

  // Résolution automatique uniquement des talents réactifs à l'évolution (TRIGGERED_ABILITY / ABILITY_ON_EVOLVE)
  const passiveBoard = getPassiveBoard(state)
  for (const pAction of evoCard.playableActions) {
    const isEvolveTrigger =
      pAction.sourceType === 'ABILITY_ON_EVOLVE' ||
      pAction.timing === 'ON_EVOLVE_TRIGGER' ||
      (pAction.actionType === 'TRIGGERED_ABILITY' &&
        pAction.timing !== 'ON_DAMAGED_OR_KO_TRIGGER' &&
        !(pAction.preconditions || []).some((p) => /SELF_IS_DAMAGED|KO/i.test(String(p))))

    if (
      isEvolveTrigger &&
      !isAbilityLockedByPassive(state, targetPoke, activeBoard)
    ) {
      const rng = new Mulberry32(state.rngState)
      for (const eff of pAction.effects) {
        resolveAtomicEffect(
          state,
          activeBoard,
          passiveBoard,
          eff,
          { type: 'USE_ABILITY', label: pAction.label, actionId: pAction.actionId },
          rng,
          markDeckSearched,
          { sourcePoke: targetPoke },
        )
      }
      state.rngState = rng.getState()
    }
  }
}

function applySpecialConditionToPoke(poke: InPlayPokemon, cond: SpecialConditionType): void {
  if (poke.preventDamageOrEffectsNextTurn) return
  poke.specialConditions = poke.specialConditions || []
  if (cond === 'ASLEEP' || cond === 'CONFUSED' || cond === 'PARALYZED') {
    poke.specialConditions = poke.specialConditions.filter(
      (c) => c === 'POISONED' || c === 'BURNED',
    )
  }
  if (!poke.specialConditions.includes(cond)) {
    poke.specialConditions.push(cond)
  }
}

function resolveGustSwitch(
  _activeBoard: PlayerBoardState,
  passiveBoard: PlayerBoardState,
  targetBenchIdx?: number,
): void {
  if (passiveBoard.bench.length === 0) return
  let chosenIdx =
    targetBenchIdx !== undefined && passiveBoard.bench[targetBenchIdx] ? targetBenchIdx : -1
  if (chosenIdx === -1) {
    // Choisir intelligemment la cible du Banc adverse (RuleBox faible PV d'abord)
    let bestScore = -9999
    passiveBoard.bench.forEach((bPoke, bIdx) => {
      const remHp = getRemainingHp(bPoke)
      const s =
        (bPoke.card.pokemonStats?.prizeCardsGiven ?? 1) * 100 -
        remHp * 0.4 +
        bPoke.attachedEnergies.length * 15
      if (s > bestScore) {
        bestScore = s
        chosenIdx = bIdx
      }
    })
  }
  if (chosenIdx < 0) chosenIdx = 0
  const newOppActive = passiveBoard.bench[chosenIdx]!
  const oldOppActive = passiveBoard.activePokemon
  passiveBoard.activePokemon = newOppActive
  if (oldOppActive) {
    oldOppActive.specialConditions = []
    oldOppActive.cantAttackNextTurn = false
    oldOppActive.cantAttackTurn = undefined
    oldOppActive.cantRetreatNextTurn = false
    oldOppActive.cantRetreatTurn = undefined
    passiveBoard.bench[chosenIdx] = oldOppActive
  } else {
    passiveBoard.bench.splice(chosenIdx, 1)
  }
}

function resolveSelfSwitch(activeBoard: PlayerBoardState): void {
  if (activeBoard.bench.length === 0) return
  let bestBenchIdx = 0
  let bestScore = -9999
  activeBoard.bench.forEach((bPoke, bIdx) => {
    const s =
      bPoke.attachedEnergies.length * 45 +
      (bPoke.card.strategicEvaluator.intrinsicBaseScore ?? 80) -
      bPoke.damage * 0.2
    if (s > bestScore) {
      bestScore = s
      bestBenchIdx = bIdx
    }
  })
  const newActive = activeBoard.bench[bestBenchIdx]!
  const oldActive = activeBoard.activePokemon
  activeBoard.activePokemon = newActive
  if (oldActive) {
    oldActive.specialConditions = []
    oldActive.cantAttackNextTurn = false
    oldActive.cantAttackTurn = undefined
    oldActive.cantRetreatNextTurn = false
    oldActive.cantRetreatTurn = undefined
    activeBoard.bench[bestBenchIdx] = oldActive
  } else {
    activeBoard.bench.splice(bestBenchIdx, 1)
  }
}

function pickBestOpponentPokeSlot(
  oppBoard: PlayerBoardState,
  dmgToPlace: number,
  allowActive: boolean,
  allowBench: boolean,
): { slot: 'ACTIVE' | number; poke: InPlayPokemon } | null {
  const candidates: Array<{ slot: 'ACTIVE' | number; poke: InPlayPokemon }> = []
  if (allowActive && oppBoard.activePokemon) {
    candidates.push({ slot: 'ACTIVE', poke: oppBoard.activePokemon })
  }
  if (allowBench) {
    oppBoard.bench.forEach((bPoke, bIdx) => candidates.push({ slot: bIdx, poke: bPoke }))
  }
  if (candidates.length === 0) return null

  let best = candidates[0]!
  let bestScore = -99999
  for (const cand of candidates) {
    const remHp = getRemainingHp(cand.poke)
    const willKo = remHp <= dmgToPlace
    const prizeVal = cand.poke.card.pokemonStats?.prizeCardsGiven ?? 1
    const s =
      (willKo ? 500 + prizeVal * 200 : 0) +
      (cand.poke.card.strategicEvaluator.intrinsicBaseScore ?? 70) -
      remHp * 0.4 +
      cand.poke.attachedEnergies.length * 15
    if (s > bestScore) {
      bestScore = s
      best = cand
    }
  }
  return best
}

function placeDamageCountersEffect(
  state: MatchState,
  attackerBoard: PlayerBoardState,
  defenderBoard: PlayerBoardState,
  eff: AtomicEffect,
  _action: GameAction,
  fallbackBenchDmg = 0,
): boolean {
  let enemyKo = false
  const totalDmg =
    eff.value ?? eff.baseDamage ?? (eff.count ? eff.count * 10 : fallbackBenchDmg)
  if (totalDmg <= 0) return false

  const targetUpper = (eff.target || '').toUpperCase()

  if (targetUpper === 'OPPONENT_ALL_POKEMON') {
    if (defenderBoard.activePokemon) {
      defenderBoard.activePokemon.damage += totalDmg
      if (defenderBoard.activePokemon.damage >= getPokemonMaxHp(defenderBoard.activePokemon, state)) {
        enemyKo = true
        handleKnockOut(state, attackerBoard, defenderBoard, 'ACTIVE')
      }
    }
    for (let bIdx = defenderBoard.bench.length - 1; bIdx >= 0; bIdx--) {
      const bPoke = defenderBoard.bench[bIdx]!
      bPoke.damage += totalDmg
      if (bPoke.damage >= getPokemonMaxHp(bPoke, state)) {
        enemyKo = true
        handleKnockOut(state, attackerBoard, defenderBoard, bIdx)
      }
    }
    return enemyKo
  }

  if (targetUpper === 'OPPONENT_BENCH_ALL') {
    // Répartition intelligente des marqueurs (10 par 10) sur le Banc adverse (ex: Plongée Fantôme 60)
    let remainingDmg = totalDmg
    while (remainingDmg > 0 && defenderBoard.bench.length > 0 && state.winner === null) {
      const picked = pickBestOpponentPokeSlot(defenderBoard, remainingDmg, false, true)
      if (!picked || picked.slot === 'ACTIVE') break
      const neededToKo = Math.max(10, Math.ceil(getRemainingHp(picked.poke, state) / 10) * 10)
      const chunk = Math.min(remainingDmg, neededToKo)
      picked.poke.damage += chunk
      remainingDmg -= chunk
      if (picked.poke.damage >= getPokemonMaxHp(picked.poke, state)) {
        enemyKo = true
        handleKnockOut(state, attackerBoard, defenderBoard, picked.slot)
      }
    }
    return enemyKo
  }

  if (targetUpper === 'OWN_BENCH_SINGLE' || targetUpper === 'OWN_ALL_POKEMON' || targetUpper === 'SELF') {
    const pTarget = attackerBoard.activePokemon
    if (pTarget) {
      pTarget.damage += totalDmg
      if (pTarget.damage >= getPokemonMaxHp(pTarget, state)) {
        handleKnockOut(state, defenderBoard, attackerBoard, 'ACTIVE')
      }
    }
    return false
  }

  // Cible unique (OPPONENT_ACTIVE, OPPONENT_BENCH_SINGLE, OPPONENT_POKEMON_ANY, OPPONENT)
  const allowActive =
    targetUpper !== 'OPPONENT_BENCH_SINGLE' && targetUpper !== 'OPPONENT_BENCH'
  const allowBench = targetUpper !== 'OPPONENT_ACTIVE'
  const picked = pickBestOpponentPokeSlot(defenderBoard, totalDmg, allowActive, allowBench)
  if (!picked) return false

  picked.poke.damage += totalDmg
  if (picked.poke.damage >= getPokemonMaxHp(picked.poke, state)) {
    enemyKo = true
    handleKnockOut(state, attackerBoard, defenderBoard, picked.slot)
  }
  return enemyKo
}

function triggerOnAttackDamageReactions(
  state: MatchState,
  attackerBoard: PlayerBoardState,
  defenderBoard: PlayerBoardState,
  damagedPoke: InPlayPokemon,
  rng: Mulberry32,
  markDeckSearched: () => void,
): void {
  if (isAbilityLockedByPassive(state, damagedPoke, defenderBoard)) return
  const rulesText = (damagedPoke.card.identity.rawRulesText || []).join(' ')
  for (const pAction of damagedPoke.card.playableActions) {
    if (pAction.actionType !== 'TRIGGERED_ABILITY') continue
    const isDamageTrigger =
      pAction.timing === 'ON_DAMAGED_OR_KO_TRIGGER' ||
      /subit des d[eé]g[aâ]ts|d[eé]g[aâ]ts d'une attaque|damaged by an opponent|contre-attaque group[eé]e/i.test(
        `${pAction.label} ${rulesText}`,
      ) ||
      (pAction.preconditions || []).some((p) =>
        /DAMAGED|KO|ATTACKED/i.test(String(p)),
      )
    if (!isDamageTrigger) continue

    const isSelfActiveReq = (pAction.preconditions || []).some(
      (p) => String(p).toUpperCase() === 'SELF_IS_ACTIVE',
    )
    if (isSelfActiveReq && defenderBoard.activePokemon?.instanceId !== damagedPoke.instanceId) {
      continue
    }

    for (const eff of pAction.effects) {
      resolveAtomicEffect(
        state,
        defenderBoard,
        attackerBoard,
        eff,
        { type: 'USE_ABILITY', label: pAction.label, actionId: pAction.actionId },
        rng,
        markDeckSearched,
        { sourcePoke: damagedPoke },
      )
    }
  }
}

function resolveSelfKnockOut(
  state: MatchState,
  ownerBoard: PlayerBoardState,
  oppBoard: PlayerBoardState,
  sourcePoke: InPlayPokemon | null | undefined,
): void {
  if (!sourcePoke) return
  const isSourceActive = ownerBoard.activePokemon?.instanceId === sourcePoke.instanceId
  const bIdx = ownerBoard.bench.findIndex((b) => b.instanceId === sourcePoke.instanceId)
  if (!isSourceActive && bIdx === -1) return

  ownerBoard.discard.push(
    ...sourcePoke.previousStages,
    sourcePoke.card,
    ...sourcePoke.attachedEnergies,
    ...sourcePoke.attachedTools,
  )

  if (isSourceActive) {
    ownerBoard.activePokemon = null
    if (ownerBoard.bench.length > 0) {
      ownerBoard.activePokemon = ownerBoard.bench.shift()!
    }
  } else {
    ownerBoard.bench.splice(bIdx, 1)
  }

  const prizes = sourcePoke.card.pokemonStats?.prizeCardsGiven ?? 1
  for (let p = 0; p < prizes && oppBoard.prizes.length > 0; p++) {
    oppBoard.hand.push(oppBoard.prizes.shift()!)
  }
  if (oppBoard.prizes.length === 0) {
    state.winner = ownerBoard === state.player ? 'OPPONENT' : 'PLAYER'
    state.winReason = 'ALL_PRIZES_TAKEN'
  } else if (!ownerBoard.activePokemon && ownerBoard.bench.length === 0) {
    state.winner = ownerBoard === state.player ? 'OPPONENT' : 'PLAYER'
    state.winReason = 'NO_POKEMON_IN_PLAY'
  }
}

/**
 * Exécute une primitive atomique de `AtomicEffect` issue du modèle JSON (29 primitives v2 + alias historiques).
 */
function resolveAtomicEffect(
  state: MatchState,
  activeBoard: PlayerBoardState,
  passiveBoard: PlayerBoardState,
  eff: AtomicEffect,
  action: GameAction,
  rng: Mulberry32,
  markDeckSearched: () => void,
  context?: {
    sourcePoke?: InPlayPokemon | null
    trainerCard?: EngineCardModel
    enemyKnockedOutThisAttack?: boolean
    dmgInfo?: {
      activeDamage: number
      benchDamage: number
      selfRecoilDamage: number
      energyToDiscard: number
    }
  },
): boolean {
  if (eff.coinFlipMode && eff.primitive !== 'DAMAGE_ACTIVE') {
    const cf = flipCoinHeadsCount(eff.coinFlipMode, eff.coinCount ?? 1, rng)
    if (
      (eff.coinFlipMode === 'SINGLE_HEADS_REQUIRED' || eff.coinFlipMode === 'SINGLE_HEADS_BONUS') &&
      !cf.hit
    ) {
      return false
    }
  }

  const prim = eff.primitive as string
  switch (prim) {
    case 'SEARCH_DECK':
    case 'SEARCH_DECK_TO_BENCH':
    case 'SEARCH_DECK_TO_HAND': {
      markDeckSearched()
      const maxCount = eff.count || 1
      const isFromDiscard = eff.sourceZone === 'DISCARD'
      const isToBench =
        prim === 'SEARCH_DECK_TO_BENCH' ||
        eff.destinationZone === 'BENCH' ||
        eff.target === 'OWN_BENCH' ||
        eff.zone === 'BENCH' ||
        (eff as any).targetZone === 'BENCH'

      if (isFromDiscard) {
        for (let i = 0; i < maxCount; i++) {
          const foundIdx = activeBoard.discard.findIndex((c) => cardMatchesEffectFilter(c, eff))
          if (foundIdx === -1) break
          const card = activeBoard.discard.splice(foundIdx, 1)[0]!
          if (eff.destinationZone === 'DECK') activeBoard.deck.push(card)
          else activeBoard.hand.push(card)
        }
        fisherYatesShuffle(activeBoard.deck, rng)
        break
      }

      if (isToBench) {
        const maxSlots = getMaxBenchSlots(activeBoard, state.activeStadium)
        for (let i = 0; i < maxCount; i++) {
          let chosenIdx = selectBestBasicInDeckForBench(activeBoard, eff)
          if (chosenIdx === -1) {
            chosenIdx = activeBoard.deck.findIndex((c) => cardMatchesEffectFilter(c, eff))
          }
          if (chosenIdx === -1) break
          const card = activeBoard.deck[chosenIdx]!
          if (card.category === 'ENERGY') {
            activeBoard.deck.splice(chosenIdx, 1)
            const targetPoke = selectBestPokemonForEnergyAttachment(activeBoard)
            if (targetPoke) targetPoke.attachedEnergies.push(card)
            else activeBoard.hand.push(card)
            continue
          }
          if (activeBoard.bench.length >= maxSlots || card.category !== 'POKEMON') break
          activeBoard.deck.splice(chosenIdx, 1)
          activeBoard.bench.push({
            instanceId: `p_${state.nextInstanceSeq++}`,
            card,
            previousStages: [],
            damage: 0,
            attachedEnergies: [],
            attachedTools: [],
            turnPlayed: state.turnNumber,
            evolvedThisTurn: false,
            specialConditions: [],
            cantAttackNextTurn: false,
          })
        }
      } else {
        for (let i = 0; i < maxCount; i++) {
          let chosenIdx = -1
          if (action.targetCardIds && action.targetCardIds[i]) {
            chosenIdx = activeBoard.deck.findIndex(
              (c) => c.cardId === action.targetCardIds![i] && cardMatchesEffectFilter(c, eff),
            )
          }
          if (chosenIdx === -1) {
            const bestModels = selectBestDeckTutorTargets(state, activeBoard, passiveBoard, eff, 1)
            if (bestModels.length > 0) {
              chosenIdx = activeBoard.deck.findIndex((c) => c.cardId === bestModels[0]!.cardId)
            }
          }
          if (chosenIdx === -1) {
            chosenIdx = activeBoard.deck.findIndex((c) => cardMatchesEffectFilter(c, eff))
          }
          if (chosenIdx === -1) break
          const foundCard = activeBoard.deck.splice(chosenIdx, 1)[0]!
          if (eff.destinationZone === 'TOP_OF_DECK') {
            activeBoard.deck.unshift(foundCard)
          } else {
            activeBoard.hand.push(foundCard)
          }
        }
      }
      fisherYatesShuffle(activeBoard.deck, rng)
      break
    }

    case 'DRAW_CARDS': {
      const targetBoard = eff.target === 'OPPONENT' ? passiveBoard : activeBoard
      const count = eff.count ?? eff.value ?? 1
      for (let i = 0; i < count && targetBoard.deck.length > 0; i++) {
        targetBoard.hand.push(targetBoard.deck.shift()!)
      }
      break
    }

    case 'DRAW_UNTIL_HAND_SIZE': {
      const limit = eff.count || 5
      while (activeBoard.hand.length < limit && activeBoard.deck.length > 0) {
        activeBoard.hand.push(activeBoard.deck.shift()!)
      }
      break
    }

    case 'LOOK_TOP_DECK_PICK': {
      if (activeBoard.deck.length === 0) break
      const topSliceCount = Math.min(2, activeBoard.deck.length)
      const topCards = activeBoard.deck.splice(0, topSliceCount)
      topCards.sort(
        (a, b) =>
          (b.strategicEvaluator.intrinsicBaseScore ?? 70) -
          (a.strategicEvaluator.intrinsicBaseScore ?? 70),
      )
      const picked = topCards.shift()!
      if (!eff.targetFilter || matchesCardFilter(picked, eff.targetFilter)) {
        activeBoard.hand.push(picked)
      } else {
        activeBoard.discard.push(picked)
      }
      activeBoard.deck.push(...topCards)
      break
    }

    case 'PUT_ON_TOP_OR_BOTTOM_OF_DECK': {
      const destTop = eff.destinationZone === 'TOP_OF_DECK'
      const src = eff.sourceZone || eff.zone
      if (src === 'HAND') {
        const moveCount = Math.min(eff.count || 1, activeBoard.hand.length)
        for (let i = 0; i < moveCount; i++) {
          const card = activeBoard.hand.pop()!
          if (destTop) activeBoard.deck.unshift(card)
          else activeBoard.deck.push(card)
        }
      } else if (src === 'DECK' && destTop && activeBoard.deck.length > 1) {
        // Ex: Cryptomane / Ciphermaniac -> trie les meilleures cartes stratégiques au-dessus du deck
        const best = selectBestDeckTutorTargets(state, activeBoard, passiveBoard, eff, eff.count || 2)
        for (let i = best.length - 1; i >= 0; i--) {
          const idx = activeBoard.deck.findIndex((c) => c.cardId === best[i]!.cardId)
          if (idx > 0) {
            const [picked] = activeBoard.deck.splice(idx, 1)
            if (picked) activeBoard.deck.unshift(picked)
          }
        }
      }
      break
    }

    case 'ATTACH_ENERGY':
    case 'SEARCH_AND_ATTACH_ENERGY':
    case 'ATTACH_ENERGY_FROM_DISCARD':
    case 'ATTACH_EXTRA_ENERGY_FROM_HAND': {
      const srcZone =
        prim === 'ATTACH_ENERGY_FROM_DISCARD'
          ? 'DISCARD'
          : prim === 'ATTACH_EXTRA_ENERGY_FROM_HAND'
            ? 'HAND'
            : prim === 'SEARCH_AND_ATTACH_ENERGY'
              ? 'DECK'
              : eff.sourceZone || eff.zone || 'DECK'
      const maxCount = eff.count || (prim === 'SEARCH_AND_ATTACH_ENERGY' ? 3 : 1)
      const isPsychicEmbrace =
        action.actionId === 'ability_psychic_embrace' ||
        /enlacement psy|psychic embrace/i.test(action.label || '')

      const pickEnergyIndexForTarget = (
        pile: EngineCardModel[],
        targetPoke: InPlayPokemon | null,
      ): number => {
        if (targetPoke) {
          const preferredTypes = new Set<string>()
          for (const pa of targetPoke.card.playableActions) {
            if ((pa.actionType === 'ATTACK' || pa.sourceType === 'ATTACK') && pa.cost) {
              for (const k of Object.keys(pa.cost)) {
                const nk = normalizeEnergyType(k)
                if (nk !== 'incolore') preferredTypes.add(nk)
              }
            }
          }
          if (preferredTypes.size === 0 && targetPoke.card.pokemonStats?.types) {
            for (const pt of targetPoke.card.pokemonStats.types) {
              const nk = normalizeEnergyType(pt)
              if (nk !== 'incolore') preferredTypes.add(nk)
            }
          }
          if (preferredTypes.size > 0) {
            const matchedIdx = pile.findIndex((c) => {
              if (!cardMatchesEffectFilter(c, eff)) return false
              const pm = getCardFastMeta(c)
              return pm.energyUnitKind === 'WILDCARD' || preferredTypes.has(pm.energyProvidedType)
            })
            if (matchedIdx !== -1) return matchedIdx
          }
        }
        return pile.findIndex((c) => cardMatchesEffectFilter(c, eff))
      }

      if (srcZone === 'DISCARD') {
        for (let i = 0; i < maxCount; i++) {
          const targetPoke = selectBestPokemonForEnergyAttachment(activeBoard)
          if (!targetPoke) break
          const enIdx = pickEnergyIndexForTarget(activeBoard.discard, targetPoke)
          if (enIdx === -1) break
          if (isPsychicEmbrace) {
            if (getRemainingHp(targetPoke, state) <= 20) break
            targetPoke.damage += 20
          }
          targetPoke.attachedEnergies.push(activeBoard.discard.splice(enIdx, 1)[0]!)
        }
      } else if (srcZone === 'HAND') {
        for (let i = 0; i < maxCount; i++) {
          const targetPoke = selectBestPokemonForEnergyAttachment(activeBoard)
          const enIdx = pickEnergyIndexForTarget(activeBoard.hand, targetPoke)
          if (enIdx === -1) break
          const energyCard = activeBoard.hand.splice(enIdx, 1)[0]!
          if (targetPoke) targetPoke.attachedEnergies.push(energyCard)
          else activeBoard.hand.push(energyCard)
        }
      } else {
        markDeckSearched()
        for (let i = 0; i < maxCount; i++) {
          const targetPoke = selectBestPokemonForEnergyAttachment(activeBoard)
          const enIdx = pickEnergyIndexForTarget(activeBoard.deck, targetPoke)
          if (enIdx === -1) break
          const energyCard = activeBoard.deck.splice(enIdx, 1)[0]!
          if (targetPoke) targetPoke.attachedEnergies.push(energyCard)
          else activeBoard.discard.push(energyCard)
        }
        fisherYatesShuffle(activeBoard.deck, rng)
      }
      break
    }

    case 'MOVE_ENERGY':
    case 'MOVE_ENERGY_BETWEEN_POKEMON': {
      const count = eff.count || 1
      for (let i = 0; i < count; i++) {
        if (activeBoard.activePokemon && activeBoard.bench.length > 0) {
          const bPoke = activeBoard.bench.find((b) => b.attachedEnergies.length > 0)
          if (bPoke) {
            activeBoard.activePokemon.attachedEnergies.push(bPoke.attachedEnergies.pop()!)
          }
        }
      }
      break
    }

    case 'DISCARD_CARDS':
    case 'DISCARD_OPPONENT_ENERGY':
    case 'DISCARD_TOOL_OR_STADIUM':
    case 'DISCARD_FROM_OPPONENT_HAND': {
      const filterUpper = (eff.filter || '').toUpperCase()
      const targetUpper = (eff.target || '').toUpperCase()
      const srcUpper = (eff.sourceZone || eff.zone || '').toUpperCase()

      if (prim === 'DISCARD_TOOL_OR_STADIUM' || filterUpper.includes('STADIUM')) {
        if (state.activeStadium) {
          const prevOwner = state.activeStadium.ownerIndex === 0 ? state.player : state.opponent
          prevOwner.discard.push(state.activeStadium.card)
          state.activeStadium = null
          enforceBenchCapacity(activeBoard, getMaxBenchSlots(activeBoard, null))
          enforceBenchCapacity(passiveBoard, getMaxBenchSlots(passiveBoard, null))
        } else if (
          (prim === 'DISCARD_TOOL_OR_STADIUM' || filterUpper.includes('TOOL')) &&
          passiveBoard.activePokemon &&
          passiveBoard.activePokemon.attachedTools.length > 0
        ) {
          passiveBoard.discard.push(passiveBoard.activePokemon.attachedTools.pop()!)
        }
        break
      }

      if (filterUpper.includes('TOOL') && passiveBoard.activePokemon?.attachedTools.length) {
        passiveBoard.discard.push(passiveBoard.activePokemon.attachedTools.pop()!)
        break
      }

      if (
        prim === 'DISCARD_OPPONENT_ENERGY' ||
        ((targetUpper === 'OPPONENT' || targetUpper === 'OPPONENT_ACTIVE') &&
          (srcUpper === 'ATTACHED_CARDS' || filterUpper.includes('ENERGY')))
      ) {
        const oppPoke = passiveBoard.activePokemon || passiveBoard.bench[0]
        const cnt = eff.count || 1
        if (oppPoke) {
          for (let i = 0; i < cnt && oppPoke.attachedEnergies.length > 0; i++) {
            passiveBoard.discard.push(oppPoke.attachedEnergies.pop()!)
          }
        }
        break
      }

      if (prim === 'DISCARD_FROM_OPPONENT_HAND' || (targetUpper === 'OPPONENT' && srcUpper !== 'DECK')) {
        const count = eff.count || 1
        for (let i = 0; i < count && passiveBoard.hand.length > 0; i++) {
          passiveBoard.discard.push(passiveBoard.hand.pop()!)
        }
        break
      }

      if (srcUpper === 'DECK') {
        const millBoard = targetUpper === 'OPPONENT' ? passiveBoard : activeBoard
        const count = eff.count || 1
        for (let i = 0; i < count && millBoard.deck.length > 0; i++) {
          millBoard.discard.push(millBoard.deck.shift()!)
        }
        break
      }

      if (targetUpper === 'SELF' && srcUpper === 'ATTACHED_CARDS') {
        const atk = context?.sourcePoke || activeBoard.activePokemon
        if (atk) {
          const count = eff.count ?? 1
          for (let i = 0; i < count && atk.attachedEnergies.length > 0; i++) {
            activeBoard.discard.push(atk.attachedEnergies.pop()!)
          }
        }
        break
      }

      // Défausse depuis la main du joueur (toute la main si count === null && !eff.filter, sinon N cartes)
      if (eff.count == null && !eff.filter && !eff.targetFilter) {
        while (activeBoard.hand.length > 0) {
          activeBoard.discard.push(activeBoard.hand.pop()!)
        }
      } else {
        const count = eff.count || 1
        discardCardsFromHandForCost(activeBoard, passiveBoard, {
          type: 'DISCARD_FROM_HAND',
          count,
          targetFilter: eff.targetFilter,
        })
      }
      break
    }

    case 'HEAL':
    case 'HEAL_DAMAGE': {
      const healAmt = eff.value ?? eff.baseDamage ?? (eff.count || 1) * 30
      if (eff.target === 'OWN_ALL_POKEMON' || eff.target === 'OWN_BENCH_ALL') {
        if (eff.target === 'OWN_ALL_POKEMON' && activeBoard.activePokemon) {
          activeBoard.activePokemon.damage = Math.max(0, activeBoard.activePokemon.damage - healAmt)
        }
        for (const b of activeBoard.bench) {
          b.damage = Math.max(0, b.damage - healAmt)
        }
      } else {
        const target =
          action.targetSlot === 'ACTIVE'
            ? activeBoard.activePokemon
            : typeof action.targetSlot === 'number'
              ? activeBoard.bench[action.targetSlot] ?? activeBoard.activePokemon
              : context?.sourcePoke || activeBoard.activePokemon
        if (target) {
          target.damage = Math.max(0, target.damage - healAmt)
        }
      }
      break
    }

    case 'SWITCH_ACTIVE':
    case 'GUST_OPPONENT_BENCH':
    case 'SWITCH_ACTIVE_POKEMON': {
      const t = (eff.target || '').toUpperCase()
      const tz = ((eff as any).targetZone || '').toUpperCase()
      const sz = (eff.sourceZone || '').toUpperCase()
      const isGust =
        prim === 'GUST_OPPONENT_BENCH' ||
        t === 'OPPONENT_BENCH' ||
        t === 'OPPONENT_BENCH_SINGLE' ||
        t === 'OPPONENT_ACTIVE' ||
        t === 'OPPONENT' ||
        t === 'OPPONENT_POKEMON_ANY' ||
        tz === 'OPPONENT_BENCH' ||
        (sz === 'BENCH' && t !== 'OWN_BENCH' && t !== 'OWN_BENCH_SINGLE' && t !== 'OWN_ACTIVE' && t !== 'SELF')

      if (isGust) {
        resolveGustSwitch(activeBoard, passiveBoard, action.targetBenchIndex)
      } else {
        resolveSelfSwitch(activeBoard)
      }
      break
    }

    case 'APPLY_SPECIAL_CONDITION': {
      const cond = (eff.specialCondition || 'POISONED') as SpecialConditionType
      const target = eff.target === 'SELF' ? activeBoard.activePokemon : passiveBoard.activePokemon
      if (target) applySpecialConditionToPoke(target, cond)
      break
    }

    case 'EVOLVE_POKEMON':
    case 'EVOLVE_SKIP_STAGE1': {
      const targetPoke =
        action.targetSlot === 'ACTIVE'
          ? activeBoard.activePokemon
          : typeof action.targetSlot === 'number'
            ? activeBoard.bench[action.targetSlot] ?? null
            : null
      const wantedStage2Id = action.targetCardIds?.[0]
      const handIdx = activeBoard.hand.findIndex(
        (c) =>
          c.category === 'POKEMON' &&
          (!wantedStage2Id || c.cardId === wantedStage2Id) &&
          targetPoke !== null &&
          canPokemonEvolveInto(targetPoke, c, state.turnNumber, true),
      )
      if (targetPoke && handIdx !== -1) {
        const evoCard = activeBoard.hand.splice(handIdx, 1)[0]!
        evolveInPlayPokemon(state, activeBoard, targetPoke, evoCard, markDeckSearched)
      }
      break
    }

    case 'SHUFFLE_HAND_DRAW':
    case 'SHUFFLE_HAND_AND_DRAW':
    case 'DISCARD_HAND_AND_DRAW':
    case 'SHUFFLE_HAND_BOTTOM_DRAW_PRIZES': {
      if (prim === 'DISCARD_HAND_AND_DRAW') {
        while (activeBoard.hand.length > 0) {
          activeBoard.discard.push(activeBoard.hand.pop()!)
        }
        const drawCount = eff.count || 7
        for (let i = 0; i < drawCount && activeBoard.deck.length > 0; i++) {
          activeBoard.hand.push(activeBoard.deck.shift()!)
        }
        break
      }

      if (action.actionId === 'play_unfair_stamp' || context?.trainerCard?.cardId === 'sv06-165') {
        const myHand = activeBoard.hand.splice(0, activeBoard.hand.length)
        activeBoard.deck.push(...myHand)
        fisherYatesShuffle(activeBoard.deck, rng)
        for (let i = 0; i < 5 && activeBoard.deck.length > 0; i++) {
          activeBoard.hand.push(activeBoard.deck.shift()!)
        }
        const oppHand = passiveBoard.hand.splice(0, passiveBoard.hand.length)
        passiveBoard.deck.push(...oppHand)
        fisherYatesShuffle(passiveBoard.deck, rng)
        for (let i = 0; i < 2 && passiveBoard.deck.length > 0; i++) {
          passiveBoard.hand.push(passiveBoard.deck.shift()!)
        }
      } else if (
        prim === 'SHUFFLE_HAND_BOTTOM_DRAW_PRIZES' ||
        eff.scalingMetric === 'PER_PRIZE_REMAINING_PLAYER' ||
        action.actionId?.includes('iono') ||
        action.actionId?.includes('mashynn') ||
        context?.trainerCard?.cardId === 'sv02-185'
      ) {
        for (const board of [activeBoard, passiveBoard]) {
          if (board.hand.length > 0) {
            const oldHand = board.hand.splice(0, board.hand.length)
            fisherYatesShuffle(oldHand, rng)
            board.deck.push(...oldHand)
          }
          const prizeDraw = Math.min(board.deck.length, board.prizes.length)
          for (let i = 0; i < prizeDraw; i++) {
            board.hand.push(board.deck.shift()!)
          }
        }
      } else if (eff.target === 'ALL_POKEMON_IN_PLAY') {
        const drawCount = eff.count || 4
        for (const board of [activeBoard, passiveBoard]) {
          const h = board.hand.splice(0, board.hand.length)
          board.deck.push(...h)
          fisherYatesShuffle(board.deck, rng)
          for (let i = 0; i < drawCount && board.deck.length > 0; i++) {
            board.hand.push(board.deck.shift()!)
          }
        }
      } else if (eff.target === 'OPPONENT' || (eff as any).targetZone === 'OPPONENT_HAND') {
        const oppHand = passiveBoard.hand.splice(0, passiveBoard.hand.length)
        passiveBoard.deck.push(...oppHand)
        fisherYatesShuffle(passiveBoard.deck, rng)
        const drawCount = eff.count || 2
        for (let i = 0; i < drawCount && passiveBoard.deck.length > 0; i++) {
          passiveBoard.hand.push(passiveBoard.deck.shift()!)
        }
      } else {
        const myHand = activeBoard.hand.splice(0, activeBoard.hand.length)
        activeBoard.deck.push(...myHand)
        fisherYatesShuffle(activeBoard.deck, rng)
        const drawCount = eff.count || 5
        for (let i = 0; i < drawCount && activeBoard.deck.length > 0; i++) {
          activeBoard.hand.push(activeBoard.deck.shift()!)
        }
      }
      break
    }

    case 'RECOVER_FROM_DISCARD':
    case 'RECOVER_DISCARD_TO_HAND':
    case 'SHUFFLE_DISCARD_TO_DECK': {
      const toHand =
        prim === 'RECOVER_DISCARD_TO_HAND' ||
        (prim !== 'SHUFFLE_DISCARD_TO_DECK' &&
          eff.destinationZone !== 'DECK' &&
          eff.target !== 'DECK' &&
          eff.zone !== 'DECK')
      const maxCount = eff.count || (toHand ? 1 : 3)

      if (toHand) {
        for (let step = 0; step < maxCount; step++) {
          let bestIdx = -1
          let bestScore = -1
          activeBoard.discard.forEach((c, idx) => {
            if (
              cardMatchesEffectFilter(c, eff) ||
              (!eff.filter &&
                !eff.targetFilter &&
                (c.category === 'POKEMON' ||
                  (c.category === 'ENERGY' && c.subCategory === 'BASIC_ENERGY')))
            ) {
              const s = c.strategicEvaluator.intrinsicBaseScore ?? 75
              if (s > bestScore) {
                bestScore = s
                bestIdx = idx
              }
            }
          })
          if (bestIdx === -1) break
          activeBoard.hand.push(activeBoard.discard.splice(bestIdx, 1)[0]!)
        }
      } else {
        let moved = 0
        for (let i = activeBoard.discard.length - 1; i >= 0 && moved < maxCount; i--) {
          const c = activeBoard.discard[i]!
          if (
            cardMatchesEffectFilter(c, eff) ||
            (!eff.filter &&
              !eff.targetFilter &&
              (c.category === 'POKEMON' ||
                (c.category === 'ENERGY' && c.subCategory === 'BASIC_ENERGY')))
          ) {
            activeBoard.deck.push(activeBoard.discard.splice(i, 1)[0]!)
            moved++
          }
        }
        if (moved > 0) fisherYatesShuffle(activeBoard.deck, rng)
      }
      break
    }

    case 'PLACE_DAMAGE_COUNTERS': {
      return placeDamageCountersEffect(state, activeBoard, passiveBoard, eff, action, 0)
    }

    case 'DEAL_DAMAGE_BENCH':
    case 'DAMAGE_BENCH': {
      if (isBenchProtectedByPassive(state, passiveBoard)) break
      const dmg = Math.max(0, eff.value ?? eff.baseDamage ?? (eff.count || 1) * 10)
      let ko = false
      for (let bIdx = passiveBoard.bench.length - 1; bIdx >= 0; bIdx--) {
        const bPoke = passiveBoard.bench[bIdx]!
        if (bPoke.card.pokemonStats?.isTera || bPoke.preventDamageOrEffectsNextTurn) continue
        bPoke.damage += dmg
        if (bPoke.damage >= getPokemonMaxHp(bPoke, state)) {
          ko = true
          handleKnockOut(state, activeBoard, passiveBoard, bIdx)
        }
      }
      return ko
    }

    case 'MOVE_DAMAGE_COUNTERS': {
      const dmg = Math.max(10, eff.value ?? (eff.count || 1) * 10)
      const friendlyPokes = [
        ...(activeBoard.activePokemon ? [activeBoard.activePokemon] : []),
        ...activeBoard.bench,
      ]
      const damagedSource = friendlyPokes.find((p) => p.damage > 0)
      const picked = pickBestOpponentPokeSlot(passiveBoard, dmg, true, true)
      if (damagedSource && picked) {
        const moveAmt = Math.min(dmg, damagedSource.damage)
        damagedSource.damage -= moveAmt
        picked.poke.damage += moveAmt
        if (picked.poke.damage >= getPokemonMaxHp(picked.poke, state)) {
          handleKnockOut(state, activeBoard, passiveBoard, picked.slot)
          return true
        }
      }
      break
    }

    case 'MODIFY_DAMAGE_TAKEN': {
      const modVal = eff.value ?? -30
      if (eff.target === 'OWN_ALL_POKEMON') {
        for (const p of [activeBoard.activePokemon, ...activeBoard.bench]) {
          if (p) {
            p.damageTakenModifierNextTurn = (p.damageTakenModifierNextTurn || 0) + modVal
            p.damageTakenModifierTurn = state.turnNumber + 1
          }
        }
      } else if (activeBoard.activePokemon) {
        activeBoard.activePokemon.damageTakenModifierNextTurn =
          (activeBoard.activePokemon.damageTakenModifierNextTurn || 0) + modVal
        activeBoard.activePokemon.damageTakenModifierTurn = state.turnNumber + 1
      }
      break
    }

    case 'MODIFY_DAMAGE_DEALT':
    case 'PASSIVE_DAMAGE_BOOST': {
      if (
        eff.filter === 'SPECIAL_RULE_EFFECT' ||
        (typeof eff.filter === 'string' && eff.filter.startsWith('EFFECT:')) ||
        eff.value == null
      ) {
        break
      }
      const modVal = eff.value
      if (modVal < 0 || eff.target === 'OPPONENT_ACTIVE' || eff.target === 'OPPONENT') {
        if (passiveBoard.activePokemon) {
          passiveBoard.activePokemon.damageDealtModifierNextTurn =
            (passiveBoard.activePokemon.damageDealtModifierNextTurn || 0) + modVal
          passiveBoard.activePokemon.damageDealtModifierTurn = state.turnNumber + 1
        }
      } else if (modVal > 0) {
        activeBoard.turnDamageBoost = (activeBoard.turnDamageBoost || 0) + modVal
      }
      break
    }

    case 'MODIFY_HP': {
      const delta = eff.value || 0
      if (delta !== 0) {
        const targets =
          eff.target === 'OWN_ALL_POKEMON'
            ? [...(activeBoard.activePokemon ? [activeBoard.activePokemon] : []), ...activeBoard.bench]
            : activeBoard.activePokemon
              ? [activeBoard.activePokemon]
              : []
        for (const t of targets) {
          t.hpBonus = (t.hpBonus || 0) + delta
        }
      }
      break
    }

    case 'MODIFY_RETREAT_COST': {
      const delta = eff.value ?? 0
      const target = eff.target === 'OPPONENT_ACTIVE' ? passiveBoard.activePokemon : activeBoard.activePokemon
      if (target) {
        target.retreatCostModifier = (target.retreatCostModifier || 0) + delta
      }
      break
    }

    case 'PREVENT_DAMAGE_OR_EFFECTS': {
      if (activeBoard.activePokemon) {
        activeBoard.activePokemon.preventDamageOrEffectsNextTurn = true
        activeBoard.activePokemon.preventDamageOrEffectsTurn = state.turnNumber + 1
      }
      break
    }

    case 'LOCK_NEXT_TURN_ATTACK':
    case 'CANT_ATTACK_NEXT_TURN': {
      if (eff.target === 'SELF' || prim === 'CANT_ATTACK_NEXT_TURN') {
        if (activeBoard.activePokemon) {
          activeBoard.activePokemon.cantAttackNextTurn = true
          activeBoard.activePokemon.cantAttackTurn = state.turnNumber + 2
        }
      } else if (passiveBoard.activePokemon) {
        passiveBoard.activePokemon.cantAttackNextTurn = true
        passiveBoard.activePokemon.cantAttackTurn = state.turnNumber + 1
      }
      break
    }

    case 'LOCK_RETREAT': {
      if (eff.target === 'SELF') {
        if (activeBoard.activePokemon) {
          activeBoard.activePokemon.cantRetreatNextTurn = true
          activeBoard.activePokemon.cantRetreatTurn = state.turnNumber + 2
        }
      } else if (passiveBoard.activePokemon) {
        passiveBoard.activePokemon.cantRetreatNextTurn = true
        passiveBoard.activePokemon.cantRetreatTurn = state.turnNumber + 1
      }
      break
    }

    case 'LOCK_ABILITIES': {
      passiveBoard.abilityLockActive = true
      passiveBoard.abilityLockTurn = state.turnNumber + 1
      break
    }

    case 'LOCK_ITEMS':
    case 'PASSIVE_ABILITY_OR_ITEM_LOCK': {
      passiveBoard.itemLockActive = true
      break
    }

    case 'EXPAND_BENCH': {
      const size = Math.max(5, eff.value ?? 8)
      activeBoard.maxBenchSlotsOverride = size
      if (eff.target === 'ALL_POKEMON_IN_PLAY') {
        passiveBoard.maxBenchSlotsOverride = size
      }
      break
    }

    case 'KNOCK_OUT': {
      if (eff.target === 'SELF') {
        resolveSelfKnockOut(
          state,
          activeBoard,
          passiveBoard,
          context?.sourcePoke || activeBoard.activePokemon,
        )
        return false
      }
      const allowActive = eff.target !== 'OPPONENT_BENCH_SINGLE'
      const allowBench = eff.target !== 'OPPONENT_ACTIVE'
      const picked = pickBestOpponentPokeSlot(passiveBoard, 9999, allowActive, allowBench)
      if (picked) {
        handleKnockOut(state, activeBoard, passiveBoard, picked.slot)
        return true
      }
      break
    }

    case 'MILL_DECK':
    case 'MILL_OPPONENT_DECK': {
      const targetBoard =
        eff.target === 'PLAYER' || eff.target === 'SELF' ? activeBoard : passiveBoard
      const count = eff.count || 1
      for (let i = 0; i < count && targetBoard.deck.length > 0; i++) {
        targetBoard.discard.push(targetBoard.deck.shift()!)
      }
      break
    }

    case 'TAKE_EXTRA_PRIZE':
    case 'TAKE_EXTRA_PRIZE_CARDS': {
      // Garde strict : uniquement lors d'un K.O. adverse pendant l'attaque
      if (context?.enemyKnockedOutThisAttack && activeBoard.prizes.length > 0) {
        const extraCount = eff.count || eff.value || 1
        for (let i = 0; i < extraCount && activeBoard.prizes.length > 0; i++) {
          activeBoard.hand.push(activeBoard.prizes.shift()!)
        }
        if (activeBoard.prizes.length === 0) {
          state.winner = activeBoard === state.player ? 'PLAYER' : 'OPPONENT'
          state.winReason = 'ALL_PRIZES_TAKEN'
        }
      }
      break
    }

    case 'RETURN_POKEMON_TO_HAND': {
      const target =
        action.targetSlot === 'ACTIVE'
          ? activeBoard.activePokemon
          : typeof action.targetSlot === 'number'
            ? activeBoard.bench[action.targetSlot] ?? null
            : null
      if (target) {
        activeBoard.hand.push(target.card)
        for (const st of target.previousStages) activeBoard.hand.push(st)
        for (const en of target.attachedEnergies) activeBoard.hand.push(en)
        for (const tool of target.attachedTools) activeBoard.hand.push(tool)
        if (action.targetSlot === 'ACTIVE') {
          activeBoard.activePokemon = null
          if (activeBoard.bench.length > 0) {
            activeBoard.activePokemon = activeBoard.bench.shift()!
          }
        } else if (typeof action.targetSlot === 'number') {
          activeBoard.bench.splice(action.targetSlot, 1)
        }
      }
      break
    }

    case 'DEVOLVE_OPPONENT_POKEMON': {
      const allOppPokes = [
        ...(passiveBoard.activePokemon ? [passiveBoard.activePokemon] : []),
        ...passiveBoard.bench,
      ]
      for (const oppPoke of allOppPokes) {
        if (oppPoke.previousStages.length > 0) {
          const topStage = oppPoke.card
          const lowerStage = oppPoke.previousStages.pop()!
          oppPoke.card = lowerStage
          passiveBoard.hand.push(topStage)
          if (oppPoke.damage >= getPokemonMaxHp(oppPoke, state)) {
            const slot =
              passiveBoard.activePokemon?.instanceId === oppPoke.instanceId ? 'ACTIVE' : 0
            handleKnockOut(state, activeBoard, passiveBoard, slot)
          }
        }
      }
      break
    }

    case 'DAMAGE_ACTIVE': {
      // Hors DECLARE_ATTACK : auto-dégâts ciblés SELF ou bonus temporaire de Dresseur legacy
      const rawVal = eff.value ?? eff.baseDamage ?? 0
      if (rawVal <= 0) break
      if (eff.target === 'SELF' && context?.sourcePoke) {
        context.sourcePoke.damage += rawVal
        if (context.sourcePoke.damage >= getPokemonMaxHp(context.sourcePoke, state)) {
          const slot =
            activeBoard.activePokemon?.instanceId === context.sourcePoke.instanceId ? 'ACTIVE' : 0
          handleKnockOut(state, passiveBoard, activeBoard, slot)
        }
      } else if (action.type === 'PLAY_TRAINER') {
        const hasPairedModifyDealt = context?.trainerCard?.playableActions.some((a) =>
          a.effects.some(
            (other) =>
              other.primitive === 'MODIFY_DAMAGE_DEALT' &&
              other.filter !== 'SPECIAL_RULE_EFFECT' &&
              !(typeof other.filter === 'string' && other.filter.startsWith('EFFECT:')) &&
              typeof other.value === 'number' &&
              other.value > 0,
          ),
        )
        if (!hasPairedModifyDealt) {
          activeBoard.turnDamageBoost = (activeBoard.turnDamageBoost || 0) + rawVal
        }
      }
      break
    }

    default:
      break
  }
  return false
}

function selectBestBasicInDeckForBench(
  activeBoard: PlayerBoardState,
  filterOrEff?: CardFilter | AtomicEffect | string | null,
): number {
  const matchesFilter = (card: EngineCardModel): boolean => {
    if (!filterOrEff) return true
    if (typeof filterOrEff === 'string') return matchesDslFilter(card, filterOrEff)
    if ('primitive' in filterOrEff) return cardMatchesEffectFilter(card, filterOrEff)
    return matchesCardFilter(card, filterOrEff)
  }

  const allInPlay = [
    ...(activeBoard.activePokemon ? [activeBoard.activePokemon] : []),
    ...activeBoard.bench,
  ]

  let bestIdx = -1
  let bestScore = -9999

  activeBoard.deck.forEach((c, idx) => {
    if (!matchesFilter(c)) return
    const normName = normalizeCardNameForMatch(c.identity.nameFr)
    if (normName.includes('lumineon')) return

    const inPlayCount = allInPlay.filter((p) => p.card.cardId === c.cardId).length
    let score = c.strategicEvaluator.intrinsicBaseScore ?? 70
    // Diversifie le Banc : au moins 2 Salamèche / Fantyrm / Tarsal et 1 Roucool / Natu / Ogerpon
    if (inPlayCount === 0) score += 45
    else if (inPlayCount === 1) score += 20
    else score -= inPlayCount * 18

    if (score > bestScore) {
      bestScore = score
      bestIdx = idx
    }
  })

  return bestIdx
}

/**
 * Sélectionne le meilleur Pokémon en jeu pour recevoir une accélération d'Énergie
 * (priorité à l'attaquant principal en Poste Actif jusqu'à son coût d'attaque, puis Energy Banking sur le Banc).
 */
function selectBestPokemonForEnergyAttachment(
  activeBoard: PlayerBoardState,
): InPlayPokemon | null {
  const allInPlay = [
    ...(activeBoard.activePokemon ? [activeBoard.activePokemon] : []),
    ...activeBoard.bench,
  ]
  if (allInPlay.length === 0) return null

  let bestPoke: InPlayPokemon = allInPlay[0]!
  let bestScore = -9999

  for (const poke of allInPlay) {
    const isActive = activeBoard.activePokemon?.instanceId === poke.instanceId
    const reqEnergy = getMainAttackEnergyRequirement(poke.card)
    const currentEnergy = poke.attachedEnergies.length
    const needsEnergyForAttack = currentEnergy < reqEnergy

    let score = poke.card.strategicEvaluator.intrinsicBaseScore ?? 70
    if (isActive && needsEnergyForAttack) {
      score += 150
    } else if (!isActive && needsEnergyForAttack && ((poke.card.strategicEvaluator.aiRole as string) === 'MAIN_ATTACKER' || poke.card.strategicEvaluator.primaryRole === 'MAIN_ATTACKER')) {
      score += 110
    } else if (!isActive && needsEnergyForAttack) {
      score += 65
    } else if (poke.card.cardId === 'sv01-089') {
      // Baudrive gagne +60 dégâts par exécution d'Enlacement Psy
      score += 95
    } else {
      score -= currentEnergy * 25
    }

    if (score > bestScore) {
      bestScore = score
      bestPoke = poke
    }
  }

  return bestPoke
}

const mainAttackEnergyReqCache = new WeakMap<EngineCardModel, number>()

export function getMainAttackEnergyRequirement(card: EngineCardModel): number {
  const cached = mainAttackEnergyReqCache.get(card)
  if (cached !== undefined) return cached

  let maxReq = 1
  for (const act of card.playableActions) {
    if (act.actionType === 'ATTACK' || act.sourceType === 'ATTACK') {
      if (act.cost && typeof act.cost === 'object' && !Array.isArray(act.cost)) {
        const total = Object.values(act.cost).reduce((a, b) => a + Number(b), 0)
        if (total > 0) maxReq = Math.max(maxReq, total)
      } else if (act.energyCost && act.energyCost.length > 0) {
        maxReq = Math.max(maxReq, act.energyCost.length)
      } else {
        for (const rawPre of act.preconditions) {
          const preType = typeof rawPre === 'string' ? rawPre : (rawPre as any).type
          if (preType === 'SELF_HAS_ENERGY_COST') {
            const minC = typeof rawPre === 'object' ? (rawPre as any).minCount : 1
            maxReq = Math.max(maxReq, minC || 1)
          }
        }
      }
    }
  }
  mainAttackEnergyReqCache.set(card, maxReq)
  return maxReq
}

function discardEnergiesFromPlayForAttack(
  activeBoard: PlayerBoardState,
  countToDiscard: number,
): void {
  let remaining = countToDiscard
  // Défausse d'abord sur le Banc (ex: Ogerpon Masque Turquoise-ex), puis sur l'Actif
  for (const bPoke of activeBoard.bench) {
    while (remaining > 0 && bPoke.attachedEnergies.length > 0) {
      activeBoard.discard.push(bPoke.attachedEnergies.pop()!)
      remaining--
    }
  }
  if (activeBoard.activePokemon) {
    while (remaining > 0 && activeBoard.activePokemon.attachedEnergies.length > 0) {
      activeBoard.discard.push(activeBoard.activePokemon.attachedEnergies.pop()!)
      remaining--
    }
  }
}

/**
 * Résout la mise K.O. d'un Pokémon (`handleKnockOut`) :
 * - Déplace le Pokémon, ses pré-évolutions, ses énergies et ses outils vers `discard`
 * - Fait piocher `prizeCardsGiven` (1 ou 2) cartes Récompenses à l'attaquant
 * - Positionne `koSufferedLastOpponentTurn = true` sur le défenseur (débloque *Attrape-Riposte* / *Tampon Injuste* / *Favianos-ex*)
 * - Promeut le meilleur Pokémon du Banc adverse si le Poste Actif est vide
 * - Vérifie immédiatement les conditions de victoire (`ALL_PRIZES_TAKEN` ou `NO_POKEMON_IN_PLAY`).
 */
export function handleKnockOut(
  state: MatchState,
  attackerBoard: PlayerBoardState,
  defenderBoard: PlayerBoardState,
  targetSlot: 'ACTIVE' | number,
): void {
  const koedPoke =
    targetSlot === 'ACTIVE'
      ? defenderBoard.activePokemon
      : defenderBoard.bench[targetSlot] ?? null

  if (!koedPoke) return

  const prizesToTake = koedPoke.card.pokemonStats?.prizeCardsGiven ?? 1

  // Envoi dans la pile de défausse
  defenderBoard.discard.push(
    ...koedPoke.previousStages,
    koedPoke.card,
    ...koedPoke.attachedEnergies,
    ...koedPoke.attachedTools,
  )

  if (targetSlot === 'ACTIVE') {
    defenderBoard.activePokemon = null
  } else {
    defenderBoard.bench.splice(targetSlot, 1)
  }

  defenderBoard.koSufferedLastOpponentTurn = true

  // Prise des cartes Récompenses par l'attaquant
  for (let i = 0; i < prizesToTake && attackerBoard.prizes.length > 0; i++) {
    attackerBoard.hand.push(attackerBoard.prizes.shift()!)
  }

  const attackerWinnerLabel: MatchWinner =
    attackerBoard === state.player ? 'PLAYER' : 'OPPONENT'

  if (attackerBoard.prizes.length === 0) {
    state.winner = attackerWinnerLabel
    state.winReason = 'ALL_PRIZES_TAKEN'
    return
  }

  // Promotion d'un nouveau Pokémon Actif si le Poste Actif du défenseur est vide
  if (!defenderBoard.activePokemon) {
    if (defenderBoard.bench.length === 0) {
      state.winner = attackerWinnerLabel
      state.winReason = 'NO_POKEMON_IN_PLAY'
      return
    }
    let bestBenchIdx = 0
    let bestPromoteScore = -9999
    defenderBoard.bench.forEach((bPoke, bIdx) => {
      const reqEn = getMainAttackEnergyRequirement(bPoke.card)
      const readyToAttack = bPoke.attachedEnergies.length >= reqEn
      const s =
        (readyToAttack ? 120 : 0) +
        (bPoke.card.strategicEvaluator.intrinsicBaseScore ?? 70) +
        getRemainingHp(bPoke) * 0.25
      if (s > bestPromoteScore) {
        bestPromoteScore = s
        bestBenchIdx = bIdx
      }
    })
    defenderBoard.activePokemon = defenderBoard.bench.splice(bestBenchIdx, 1)[0]!
  }
}

/**
 * Termine le tour courant et passe au joueur suivant ou conclut au plafond `maxTurns`.
 */
/**
 * Exécute le Checkup entre deux tours (Between-Turns Checkup) :
 * - Poison (+10 dégâts)
 * - Brûlure (+20 dégâts + flip de guérison)
 * - Sommeil (flip de réveil)
 * - Paralysie (fin au tour du joueur affecté)
 * - Vérification des K.O.
 */
export function runBetweenTurnsCheckup(state: MatchState): void {
  if (state.winner !== null) return

  const boards = [state.player, state.opponent]
  const rng = new Mulberry32(state.rngState)

  for (let boardIdx = 0; boardIdx < 2; boardIdx++) {
    const board = boards[boardIdx]!
    const oppBoard = boards[1 - boardIdx]!
    const active = board.activePokemon
    if (!active) continue

    const conds = active.specialConditions || []
    const remainingConds: SpecialConditionType[] = []

    for (const cond of conds) {
      if (cond === 'POISONED') {
        active.damage += 10
        remainingConds.push('POISONED')
      } else if (cond === 'BURNED') {
        active.damage += 20
        const flip = rng.nextFloat() >= 0.5
        if (!flip) {
          remainingConds.push('BURNED')
        }
      } else if (cond === 'ASLEEP') {
        const flip = rng.nextFloat() >= 0.5
        if (!flip) {
          remainingConds.push('ASLEEP')
        }
      } else if (cond === 'PARALYZED') {
        if (state.activePlayerIndex !== boardIdx) {
          remainingConds.push('PARALYZED')
        }
      } else if (cond === 'CONFUSED') {
        remainingConds.push('CONFUSED')
      }
    }

    active.specialConditions = remainingConds

    if (active.damage >= getPokemonMaxHp(active)) {
      handleKnockOut(state, oppBoard, board, 'ACTIVE')
    }
  }

  state.rngState = rng.getState()
}

function clearExpiredTurnFlagsOnPokemon(poke: InPlayPokemon, turnNumber: number, isEndingOwnerTurn: boolean): void {
  if (poke.cantAttackTurn !== undefined) {
    if (turnNumber >= poke.cantAttackTurn) {
      poke.cantAttackNextTurn = false
      poke.cantAttackTurn = undefined
    }
  } else if (isEndingOwnerTurn) {
    poke.cantAttackNextTurn = false
  }

  if (poke.cantRetreatTurn !== undefined) {
    if (turnNumber >= poke.cantRetreatTurn) {
      poke.cantRetreatNextTurn = false
      poke.cantRetreatTurn = undefined
    }
  } else if (isEndingOwnerTurn) {
    poke.cantRetreatNextTurn = false
  }

  if (poke.preventDamageOrEffectsTurn !== undefined) {
    if (turnNumber >= poke.preventDamageOrEffectsTurn) {
      poke.preventDamageOrEffectsNextTurn = false
      poke.preventDamageOrEffectsTurn = undefined
    }
  }

  if (poke.damageTakenModifierTurn !== undefined) {
    if (turnNumber >= poke.damageTakenModifierTurn) {
      poke.damageTakenModifierNextTurn = 0
      poke.damageTakenModifierTurn = undefined
    }
  }

  if (poke.damageDealtModifierTurn !== undefined) {
    if (turnNumber >= poke.damageDealtModifierTurn) {
      poke.damageDealtModifierNextTurn = 0
      poke.damageDealtModifierTurn = undefined
    }
  }
}

/**
 * Termine le tour courant et passe au joueur suivant ou conclut au plafond `maxTurns`.
 */
export function endTurnAndAdvance(state: MatchState): void {
  if (state.winner !== null) return

  // Défausse des Machines Techniques attachées et réinitialisation des verrous de tour
  const endingBoard = getActiveBoard(state)
  const otherBoard = getPassiveBoard(state)
  const allEndingPokes = [
    ...(endingBoard.activePokemon ? [endingBoard.activePokemon] : []),
    ...endingBoard.bench,
  ]
  for (const poke of allEndingPokes) {
    clearExpiredTurnFlagsOnPokemon(poke, state.turnNumber, true)
    for (let i = poke.attachedTools.length - 1; i >= 0; i--) {
      const tool = poke.attachedTools[i]!
      if (tool.identity.isTechnicalMachine) {
        poke.attachedTools.splice(i, 1)
        endingBoard.discard.push(tool)
      }
    }
  }

  const allOtherPokes = [
    ...(otherBoard.activePokemon ? [otherBoard.activePokemon] : []),
    ...otherBoard.bench,
  ]
  for (const poke of allOtherPokes) {
    clearExpiredTurnFlagsOnPokemon(poke, state.turnNumber, false)
  }

  // Réinitialiser le talent de stade
  if (state.activeStadium) {
    state.activeStadium.usedThisTurn = false
  }

  endingBoard.abilityUsageCountsThisTurn = {}
  endingBoard.itemLockActive = false
  if (endingBoard.abilityLockTurn === undefined || state.turnNumber >= endingBoard.abilityLockTurn) {
    endingBoard.abilityLockActive = false
    endingBoard.abilityLockTurn = undefined
  }
  endingBoard.turnDamageBoost = 0

  // Exécution du Checkup officiel entre les deux tours
  runBetweenTurnsCheckup(state)
  if (state.winner !== null) return

  if (state.turnNumber >= state.maxTurns) {
    state.winReason = 'MAX_TURNS_REACHED'
    if (state.player.prizes.length < state.opponent.prizes.length) {
      state.winner = 'PLAYER'
    } else if (state.opponent.prizes.length < state.player.prizes.length) {
      state.winner = 'OPPONENT'
    } else {
      state.winner = 'DRAW'
    }
    return
  }

  state.turnNumber += 1
  state.activePlayerIndex = state.activePlayerIndex === 0 ? 1 : 0
}
