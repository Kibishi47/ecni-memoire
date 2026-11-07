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
 * Calcule la capacité maximale de Banc (5 par défaut, 8 avec Abîme Zéro + Téracristal en jeu).
 */
export function getMaxBenchSlots(
  board: PlayerBoardState,
  activeStadium: MatchState['activeStadium'],
): number {
  if (!activeStadium) return 5
  if (!getCardFastMeta(activeStadium.card).isAreaZeroStadium) return 5

  const hasTera = Boolean(
    board.activePokemon?.card.pokemonStats?.isTera ||
      board.bench.some((p) => p.card.pokemonStats?.isTera),
  )
  return hasTera ? 8 : 5
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

export function getPokemonMaxHp(poke: InPlayPokemon): number {
  const baseHp = poke.card.pokemonStats?.hp ?? 70
  let bonusHp = 0
  if (poke.card.subCategory === 'BASIC' && poke.attachedTools.length > 0) {
    for (let i = 0; i < poke.attachedTools.length; i++) {
      if (getCardFastMeta(poke.attachedTools[i]!).isBraveryCharm) {
        bonusHp += 50
      }
    }
  }
  return baseHp + bonusHp
}

export function getRemainingHp(poke: InPlayPokemon): number {
  return Math.max(0, getPokemonMaxHp(poke) - poke.damage)
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
        e.primitive === 'APPLY_SPECIAL_CONDITION' ||
        (e.primitive as any) === 'PASSIVE_ABILITY_OR_ITEM_LOCK',
    ) ||
    /pollen_demangeant|pollen démangeant|itchy_pollen|itchy pollen|item_lock/i.test(
      `${action.actionId} ${action.label}`,
    )
  )
}

/**
 * Calcule les dégâts réels qu'infligerait une attaque du Pokémon Actif sur le Pokémon Actif adverse.
 */
export function computeAttackDamageToActive(
  attackerBoard: PlayerBoardState,
  defenderBoard: PlayerBoardState,
  action: PlayableAction,
): { activeDamage: number; benchDamage: number; energyToDiscard: number } {
  const attacker = attackerBoard.activePokemon
  const defender = defenderBoard.activePokemon
  if (!attacker || !defender) {
    return { activeDamage: 0, benchDamage: 0, energyToDiscard: 0 }
  }

  let activeDamage = 0
  let benchDamage = 0
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
      let dmg = eff.baseDamage ?? 0
      const scalingType = eff.damageScalingType
      const scalingValue = eff.damageScalingValue ?? 0

      if (eff.damageScalingPerOpponentPrizeTaken) {
        const oppPrizesTaken = Math.max(0, 6 - attackerBoard.prizes.length)
        dmg += oppPrizesTaken * eff.damageScalingPerOpponentPrizeTaken
      }

      if (scalingType && scalingValue > 0) {
        switch (scalingType) {
          case 'PER_OPPONENT_PRIZE_TAKEN': {
            const oppPrizesTaken = Math.max(0, 6 - attackerBoard.prizes.length)
            dmg += oppPrizesTaken * scalingValue
            break
          }
          case 'PER_COIN_FLIP_HEADS': {
            dmg += Math.round((eff.count || 2) * 0.5) * scalingValue
            break
          }
          case 'PER_ENERGY_ATTACHED_SELF': {
            dmg += attacker.attachedEnergies.length * scalingValue
            break
          }
          case 'PER_ENERGY_ATTACHED_ALL': {
            const allEnergies =
              countMatchingEnergiesInPlay(attackerBoard) +
              countMatchingEnergiesInPlay(defenderBoard)
            dmg += allEnergies * scalingValue
            break
          }
          case 'PER_ENERGY_ATTACHED_TARGET': {
            dmg += defender.attachedEnergies.length * scalingValue
            break
          }
          case 'PER_DAMAGE_COUNTER_ON_SELF': {
            const counters = Math.floor(attacker.damage / 10)
            dmg += counters * scalingValue
            break
          }
          case 'PER_DAMAGE_COUNTER_ON_FRIENDLY': {
            const allPokes = [attacker, ...attackerBoard.bench]
            const totalCounters = allPokes.reduce(
              (sum, p) => sum + Math.floor(p.damage / 10),
              0,
            )
            dmg += totalCounters * scalingValue
            break
          }
          case 'PER_ENERGY_DISCARDED': {
            const totalEnergiesInPlay = countMatchingEnergiesInPlay(
              attackerBoard,
              eff.targetFilter || {
                category: 'ENERGY',
                subCategory: 'BASIC_ENERGY',
              },
            )
            if (totalEnergiesInPlay > 0) {
              const defHpLeft = getRemainingHp(defender)
              const neededCards = Math.max(1, Math.ceil(defHpLeft / scalingValue))
              const chosenDiscard = Math.min(totalEnergiesInPlay, Math.max(2, neededCards))
              energyToDiscard = chosenDiscard
              dmg += chosenDiscard * scalingValue
            }
            break
          }
          case 'IF_TARGET_IS_EX_OR_EVOLUTION': {
            const isExOrEvo = Boolean(
              defender.card.pokemonStats?.isRuleBox || defender.card.subCategory !== 'BASIC',
            )
            if (isExOrEvo) {
              dmg += scalingValue
            }
            break
          }
          case 'PER_DAMAGE_COUNTER_ON_TARGET': {
            const counters = Math.floor(defender.damage / 10)
            dmg += counters * scalingValue
            break
          }
          case 'PER_BENCHED_POKEMON': {
            dmg += attackerBoard.bench.length * scalingValue
            break
          }
          case 'PER_CARD_IN_DISCARD_OR_LOST_ZONE': {
            const discCount = attackerBoard.discard.filter((c) =>
              matchesCardFilter(c, eff.targetFilter),
            ).length
            const lostCount = (attackerBoard.lostZone || []).filter((c) =>
              matchesCardFilter(c, eff.targetFilter),
            ).length
            dmg += (discCount + lostCount) * scalingValue
            break
          }
        }
      }

      // Cas spécifique Tempête Éclats (Ire-Foudre-ex) si non couvert par scalingType
      if (
        !scalingType &&
        (action.actionId === 'attack_bellowing_thunder' || (energyToDiscard > 0 && dmg === 70))
      ) {
        const totalBasicEnergiesInPlay = countMatchingEnergiesInPlay(attackerBoard, {
          category: 'ENERGY',
          subCategory: 'BASIC_ENERGY',
        })
        if (totalBasicEnergiesInPlay > 0) {
          const defHpLeft = getRemainingHp(defender)
          const neededCards = Math.max(1, Math.ceil(defHpLeft / 70))
          const chosenDiscard = Math.min(totalBasicEnergiesInPlay, Math.max(2, neededCards))
          energyToDiscard = chosenDiscard
          dmg = 70 * chosenDiscard
        }
      }

      activeDamage += dmg
    } else if (
      eff.primitive === 'DAMAGE_BENCH' ||
      (eff as any).primitive === 'DISTRIBUTE_DAMAGE_COUNTERS_BENCH' ||
      (eff as any).primitive === 'PLACE_DAMAGE_COUNTERS' ||
      (eff as any).primitive === 'DEAL_DAMAGE_BENCH'
    ) {
      benchDamage += eff.baseDamage ?? (eff.count || 1) * 10
    }
  }

  if (activeDamage > 0) {
    if (attackerBoard.turnDamageBoost) {
      activeDamage += attackerBoard.turnDamageBoost
    }
    // Bonus d'Outil attaquant (ex: Ceinture Vitalité +10, Maximum Belt +50 contre Pokémon ex)
    for (let tIdx = 0; tIdx < attacker.attachedTools.length; tIdx++) {
      const toolNameNorm = getCardFastMeta(attacker.attachedTools[tIdx]!).normCombinedName
      if (toolNameNorm.includes('ceinture vitalite') || toolNameNorm.includes('vitality band')) {
        activeDamage += 10
      } else if (
        toolNameNorm.includes('ceinture maximum') ||
        toolNameNorm.includes('maximum belt')
      ) {
        if (defender.card.pokemonStats?.isRuleBox) {
          activeDamage += 50
        }
      } else if (toolNameNorm.includes('ceinture choix') || toolNameNorm.includes('choice belt')) {
        if (defender.card.pokemonStats?.isRuleBox) {
          activeDamage += 30
        }
      }
    }

    // Immunité de Mimiriqui (Rune Protectrice contre Pokémon-ex / V)
    const defMeta = getCardFastMeta(defender.card)
    if (
      (defMeta.normNameFr.includes('mimiriqui') || defMeta.normNameEn.includes('mimikyu')) &&
      attacker.card.pokemonStats?.isRuleBox
    ) {
      activeDamage = 0
    } else {
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
        if (weakHit) {
          activeDamage *= 2
        }
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
          activeDamage = Math.max(0, activeDamage + resMod)
        }
      }
    }
  }

  return { activeDamage, benchDamage, energyToDiscard }
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
    if (act.deadCardCondition) {
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
    if (p === 'BENCH_FULL' || p === 'BENCH_ALREADY_FULL') {
      const maxSlots = activeStadium?.card.cardId === 'sv07-141' ? 8 : 5
      if (myBoard.bench.length >= maxSlots) return true
    } else if (p === 'NOT_BEHIND_ON_PRIZES') {
      if (myBoard.prizes.length <= oppBoard.prizes.length) return true
    } else if (p === 'NO_KO_LAST_TURN') {
      if (!myBoard.koSufferedLastOpponentTurn) return true
    } else if (p === 'NO_TERA_IN_PLAY' || p === 'NO_TERA_POKEMON_IN_PLAY') {
      const allInPlay = [myBoard.activePokemon, ...myBoard.bench].filter((x): x is InPlayPokemon => x !== null)
      if (!allInPlay.some((x) => Boolean(x.card.identity.isTera || x.card.pokemonStats?.isTera))) return true
    } else if (p === 'DISCARD_EMPTY' || p === 'DISCARD_PILE_EMPTY') {
      if (myBoard.discard.length === 0) return true
    } else if (p === 'STADIUM_ALREADY_IN_PLAY_SAME_NAME') {
      if (
        activeStadium &&
        cardBeingEvaluated &&
        normalizeCardNameForMatch(activeStadium.card.identity.nameFr) ===
          normalizeCardNameForMatch(cardBeingEvaluated.identity.nameFr)
      ) {
        return true
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
      const maxSlots = activeStadium?.card.cardId === 'sv07-141' ? 8 : 5
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

  // Verrou Item Lock
  const isItem = sourceCard.subCategory === 'ITEM'
  if (
    (action.actionType === 'PLAY_FROM_HAND' || action.sourceType === 'TRAINER_PLAY') &&
    isItem &&
    activeBoard.itemLockActive
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
  if (
    action.actionType === 'USE_ABILITY' ||
    (action.sourceType && action.sourceType.startsWith('ABILITY'))
  ) {
    if (action.actionId === 'ability_squawk_and_seize' && state.turnNumber > 2) {
      return false
    }
    const abilityKey = GLOBAL_ONCE_PER_TURN_ABILITY_IDS.has(action.actionId)
      ? action.actionId
      : `${sourcePokemon?.instanceId || sourceCard.cardId}:${action.actionId}`
    if (activeBoard.usedOncePerTurnAbilities.has(abilityKey)) {
      return false
    }
  }

  for (let pIdx = 0; pIdx < action.preconditions.length; pIdx++) {
    const rawPre = action.preconditions[pIdx]!
    const preType = typeof rawPre === 'string' ? rawPre : (rawPre as any).type
    const minCount = typeof rawPre === 'object' ? (rawPre as any).minCount ?? 1 : 1
    const targetFilter = typeof rawPre === 'object' ? (rawPre as any).targetFilter : null

    if (preType === 'BENCH_HAS_EMPTY_SLOTS' || preType === 'BENCH_HAS_EMPTY_SLOT') {
      const maxSlots = getMaxBenchSlots(activeBoard, state.activeStadium)
      if (activeBoard.bench.length > maxSlots - Math.max(1, minCount)) return false
    } else if (preType.startsWith('HAND_MIN_OTHER_CARDS')) {
      const countReq = preType.includes('_')
        ? parseInt(preType.split('_').pop() || '1', 10) || minCount
        : minCount
      const otherHandCount =
        handIndexIfFromHand !== undefined
          ? activeBoard.hand.length - 1
          : activeBoard.hand.length
      if (otherHandCount < countReq) return false
    } else if (preType === 'HAND_MAX_OTHER_CARDS_ZERO') {
      const otherHandCount =
        handIndexIfFromHand !== undefined
          ? activeBoard.hand.length - 1
          : activeBoard.hand.some((c) => c.cardId === sourceCard.cardId)
            ? activeBoard.hand.length - 1
            : activeBoard.hand.length
      if (otherHandCount > 0) return false
    } else if (preType === 'PLAYER_BEHIND_ON_PRIZES') {
      if (activeBoard.prizes.length <= passiveBoard.prizes.length) return false
    } else if (preType === 'KO_SUFFERED_LAST_TURN') {
      if (!activeBoard.koSufferedLastOpponentTurn) return false
    } else if (preType === 'BASIC_IN_PLAY_PREVIOUS_TURN' || preType === 'BASIC_POKEMON_IN_PLAY') {
      if (state.turnNumber <= 2 && preType === 'BASIC_IN_PLAY_PREVIOUS_TURN') return false
      const allInPlay = [
        ...(activeBoard.activePokemon ? [activeBoard.activePokemon] : []),
        ...activeBoard.bench,
      ]
      if (preType === 'BASIC_POKEMON_IN_PLAY') {
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
    } else if (preType === 'STAGE_2_CARD_IN_HAND') {
      const hasS2 = activeBoard.hand.some(
        (c) => c.category === 'POKEMON' && c.subCategory === 'STAGE_2',
      )
      if (!hasS2) return false
    } else if (preType === 'NOT_FIRST_TURN') {
      if (state.turnNumber === 1 && state.activePlayerIndex === state.firstPlayerIndex) return false
    } else if (preType === 'SELF_IS_ACTIVE') {
      if (!sourcePokemon || activeBoard.activePokemon?.instanceId !== sourcePokemon.instanceId) {
        return false
      }
    } else if (preType === 'SELF_HAS_ENERGY_COST') {
      if (!sourcePokemon) return false
      if (action.cost && Object.keys(action.cost).length > 0) {
        if (!canPayEnergyCost(sourcePokemon.attachedEnergies, action.cost)) return false
      } else if (action.energyCost && action.energyCost.length > 0) {
        if (!canPayEnergyCost(sourcePokemon.attachedEnergies, action.energyCost)) return false
      } else if (typeof rawPre === 'object') {
        if (!hasRequiredEnergyForPrecondition(sourcePokemon, rawPre, action)) return false
      }
    } else if (preType === 'HAS_TERA_POKEMON_IN_PLAY') {
      const hasTera =
        Boolean(
          activeBoard.activePokemon?.card.identity.isTera ||
            activeBoard.activePokemon?.card.pokemonStats?.isTera,
        ) ||
        activeBoard.bench.some((p) =>
          Boolean(p.card.identity.isTera || p.card.pokemonStats?.isTera),
        )
      if (!hasTera) return false
    } else if (preType === 'STADIUM_IN_PLAY') {
      if (!state.activeStadium) return false
      if (targetFilter && !matchesCardFilter(state.activeStadium.card, targetFilter)) {
        return false
      }
    } else if (preType === 'OPPONENT_ACTIVE_HAS_SPECIAL_CONDITION') {
      const oppActive = passiveBoard.activePokemon
      if (!oppActive || !oppActive.specialConditions || oppActive.specialConditions.length === 0) {
        return false
      }
    } else if (preType === 'OPPONENT_PRIZES_EXACT_COUNT') {
      if (passiveBoard.prizes.length !== minCount) return false
    } else if (preType === 'SELF_IS_ON_BENCH') {
      if (
        !sourcePokemon ||
        !activeBoard.bench.some((b) => b.instanceId === sourcePokemon.instanceId)
      ) {
        return false
      }
    } else if (preType === 'NO_ENERGY_IN_PLAY') {
      if (sourcePokemon) {
        if (sourcePokemon.attachedEnergies.length > 0) return false
      } else {
        const totalEnergies =
          (activeBoard.activePokemon?.attachedEnergies.length || 0) +
          activeBoard.bench.reduce((sum, b) => sum + b.attachedEnergies.length, 0)
        if (totalEnergies > 0) return false
      }
    } else if (preType === 'SECOND_PLAYER_TURN_1') {
      if (state.turnNumber !== 2 || state.activePlayerIndex === state.firstPlayerIndex) {
        return false
      }
    } else if (preType === 'ZONE_HAS_MATCHING_CARD') {
      const effectWithFilter = action.effects.find((e) => e.filter || e.targetFilter)
      const targetZone =
        (typeof rawPre === 'object' && (rawPre as any).zone) ||
        effectWithFilter?.zone ||
        (effectWithFilter as any)?.sourceZone ||
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

  // Vérifications additionnelles spécifiques aux effets
  for (const eff of action.effects) {
    if (
      eff.primitive === 'SWITCH_ACTIVE' &&
      (eff.target === 'OPPONENT_BENCH' || (eff as any).targetZone === 'OPPONENT_BENCH' || (eff as any).primitive === 'GUST_OPPONENT_BENCH') &&
      passiveBoard.bench.length === 0
    ) {
      return false
    }
    if (
      eff.primitive === 'SWITCH_ACTIVE' &&
      (eff.target === 'OWN_BENCH' || eff.target === 'SELF' || (eff as any).primitive === 'SWITCH_ACTIVE_POKEMON') &&
      activeBoard.bench.length === 0
    ) {
      return false
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

    // Blocage par Item Lock
    if (card.subCategory === 'ITEM' && activeBoard.itemLockActive) return

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

    // Cas des Outils d'équipement sans effet immédiat (TM ou Outil stat)
    if (
      card.subCategory === 'TOOL' &&
      card.playableActions.every(
        (a) => a.effects.length === 0 || a.actionType === 'ATTACK' || a.sourceType === 'ATTACK',
      )
    ) {
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

      // Cas B : Gust du Banc adverse (`SWITCH_ACTIVE` avec target OPPONENT_BENCH ou `GUST_OPPONENT_BENCH`)
      const hasGust = pAction.effects.some(
        (e) =>
          (e.primitive === 'SWITCH_ACTIVE' &&
            (e.target === 'OPPONENT_BENCH' || (e as any).targetZone === 'OPPONENT_BENCH')) ||
          (e as any).primitive === 'GUST_OPPONENT_BENCH',
      )
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
            label: `Jouer ${card.identity.nameFr} → Cibler ${oppBench.card.identity.nameFr} adverse (${getRemainingHp(oppBench)} PV)`,
          })
        })
        continue
      }

      // Cas C : Recherche ciblée d'1 Pokémon dans le deck vers la main (ex: Hyper Ball)
      const isSinglePokemonTutor =
        pAction.effects.length === 1 &&
        (pAction.effects[0]?.primitive === 'SEARCH_DECK' ||
          (pAction.effects[0] as any)?.primitive === 'SEARCH_DECK_TO_HAND') &&
        (pAction.effects[0]?.filter?.includes('POKEMON') ||
          pAction.effects[0]?.targetFilter?.category === 'POKEMON')
      if (isSinglePokemonTutor) {
        const topCandidates = selectBestDeckTutorTargets(
          state,
          activeBoard,
          passiveBoard,
          pAction.effects[0]!.targetFilter,
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
      if (pAction.actionId === 'ability_quick_search') {
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
    activeConditions.includes('ASLEEP') || activeConditions.includes('PARALYZED')
  if (
    !activeBoard.retreatUsedThisTurn &&
    activeBoard.activePokemon &&
    activeBoard.bench.length > 0 &&
    !isImmobilized
  ) {
    const retreatCost = activeBoard.activePokemon.card.pokemonStats?.retreatCost ?? 1
    if (activeBoard.activePokemon.attachedEnergies.length >= retreatCost) {
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
  if (
    activeBoard.activePokemon &&
    !activeBoard.activePokemon.cantAttackNextTurn &&
    !isImmobilized
  ) {
    // 7a. Attaques propres au Pokémon Actif
    for (const pAction of activeBoard.activePokemon.card.playableActions) {
      if (pAction.actionType !== 'ATTACK' && pAction.sourceType !== 'ATTACK') continue
      if (
        !checkActionPreconditions(
          state,
          activeBoard,
          passiveBoard,
          activeBoard.activePokemon.card,
          pAction,
          activeBoard.activePokemon,
        )
      ) {
        continue
      }

      const dmgInfo = computeAttackDamageToActive(activeBoard, passiveBoard, pAction)
      const isDoubleAtk = canPokemonAttackTwice(activeBoard.activePokemon, state)
      const totalEstimatedActiveDmg = isDoubleAtk ? dmgInfo.activeDamage * 2 : dmgInfo.activeDamage
      const totalEstimatedBenchDmg = isDoubleAtk ? dmgInfo.benchDamage * 2 : dmgInfo.benchDamage
      const oppActiveName = passiveBoard.activePokemon?.card.identity.nameFr || 'Actif adverse'
      const dmgLabel =
        dmgInfo.activeDamage > 0
          ? `${dmgInfo.activeDamage}${isDoubleAtk ? ' ×2 (Fête Battante)' : ''} dégâts sur ${oppActiveName}${dmgInfo.benchDamage > 0 ? ` + ${dmgInfo.benchDamage} Banc` : ''}`
          : 'Effet tactique'

      actions.push({
        type: 'DECLARE_ATTACK',
        cardId: activeBoard.activePokemon.card.cardId,
        actionId: pAction.actionId,
        estimatedDamage: totalEstimatedActiveDmg + totalEstimatedBenchDmg,
        endsTurnImmediately: true,
        label: `Attaque ${pAction.label} (${activeBoard.activePokemon.card.identity.nameFr}) : ${dmgLabel}`,
      })
    }

    // 7b. Attaques conférées par les Machines Techniques attachées
    for (const tool of activeBoard.activePokemon.attachedTools) {
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
              activeBoard.activePokemon,
            )
          ) {
            continue
          }
          const dmgInfo = computeAttackDamageToActive(activeBoard, passiveBoard, tmAction)
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
  filter: CardFilter | null | undefined,
  maxDistinctTargets = 2,
): EngineCardModel[] {
  const uniqueByCardId = new Map<string, EngineCardModel>()
  for (const card of activeBoard.deck) {
    if (!uniqueByCardId.has(card.cardId) && matchesCardFilter(card, filter)) {
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

        // Déclencher les talents à la pose de la main (ABILITY_ON_PLAY_FROM_HAND)
        for (const pAction of card.playableActions) {
          if (
            pAction.actionType === 'USE_ABILITY' ||
            pAction.sourceType === 'ABILITY_ON_PLAY_FROM_HAND' ||
            pAction.timing === 'ON_PLAY_FROM_HAND_TRIGGER'
          ) {
            for (const eff of pAction.effects) {
              resolveAtomicEffect(
                state,
                activeBoard,
                passiveBoard,
                eff,
                action,
                rng,
                markDeckSearched,
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
      if (activePoke && benchPoke && !activeBoard.retreatUsedThisTurn) {
        const retreatCost = activePoke.card.pokemonStats?.retreatCost ?? 1
        for (let i = 0; i < retreatCost && activePoke.attachedEnergies.length > 0; i++) {
          const discardedEn = activePoke.attachedEnergies.pop()!
          activeBoard.discard.push(discardedEn)
        }
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

      // Cas d'un Outil attaché directement à un Pokémon (Ceinture Vitalité, Amulette Bravoure, TM)
      if (
        trainerCard.subCategory === 'TOOL' &&
        trainerCard.playableActions.every(
          (a) => a.effects.length === 0 || a.actionType === 'ATTACK' || a.sourceType === 'ATTACK',
        )
      ) {
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

      if (pAction) {
        // Paiement des coûts (ex: défausse de 2 cartes pour Hyper Ball, 1 carte pour Urne Terrestre)
        for (const cost of (pAction.costs || [])) {
          if (cost.type === 'DISCARD_FROM_HAND') {
            discardCardsFromHandForCost(activeBoard, passiveBoard, cost)
          }
        }

        // Exécution ordonnée des primitives d'effets
        for (const eff of pAction.effects) {
          resolveAtomicEffect(
            state,
            activeBoard,
            passiveBoard,
            eff,
            action,
            rng,
            markDeckSearched,
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

        const globalOncePerTurnIds = new Set([
          'ability_quick_search',
          'ability_flip_the_script',
          'ability_squawk_and_seize',
          'ability_instant_charge',
          'ability_luminous_sign',
        ])
        const abilityKey = globalOncePerTurnIds.has(pAction.actionId)
          ? pAction.actionId
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
      const pAction =
        attacker.card.playableActions.find((a) => a.actionId === action.actionId) ||
        attacker.attachedTools
          .flatMap((t) => t.playableActions)
          .find((a) => a.actionId === action.actionId)
      if (!pAction) break

      if ((pAction.costs || []).some((c) => c.type === 'CANT_ATTACK_NEXT_TURN')) {
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

        const dmgInfo = computeAttackDamageToActive(activeBoard, passiveBoard, pAction)

        // Défausse d'énergies en jeu si coût d'attaque (ex: Tempête Éclats d'Ire-Foudre-ex)
        if (execIdx === 0 && dmgInfo.energyToDiscard > 0) {
          discardEnergiesFromPlayForAttack(activeBoard, dmgInfo.energyToDiscard)
        }

        if (isZeroEnergyItemLockAttack(pAction)) {
          passiveBoard.itemLockActive = true
        }

        for (const eff of pAction.effects) {
          if (eff.primitive === 'DAMAGE_ACTIVE' || (eff.primitive as any) === 'DEAL_DAMAGE_ACTIVE') {
            if (passiveBoard.activePokemon && dmgInfo.activeDamage > 0) {
              passiveBoard.activePokemon.damage += dmgInfo.activeDamage
              if (passiveBoard.activePokemon.damage >= getPokemonMaxHp(passiveBoard.activePokemon)) {
                handleKnockOut(state, activeBoard, passiveBoard, 'ACTIVE')
              }
            }
          } else if (eff.primitive === 'DAMAGE_BENCH' || (eff.primitive as any) === 'DEAL_DAMAGE_BENCH') {
            // DEAL_DAMAGE_BENCH / DAMAGE_BENCH inflige des DÉGÂTS au Banc.
            // Les Pokémon Téracristal (isTera === true) sont immunisés aux dégâts sur le Banc !
            if (passiveBoard.bench.length > 0) {
              const benchDmg = eff.baseDamage ?? eff.value ?? (eff.count || 1) * 10
              for (let bIdx = passiveBoard.bench.length - 1; bIdx >= 0; bIdx--) {
                const bPoke = passiveBoard.bench[bIdx]!
                if (bPoke.card.pokemonStats?.isTera) continue
                bPoke.damage += benchDmg
                if (bPoke.damage >= getPokemonMaxHp(bPoke)) {
                  handleKnockOut(state, activeBoard, passiveBoard, bIdx)
                }
              }
            }
          } else if (
            (eff.primitive as any) === 'DISTRIBUTE_DAMAGE_COUNTERS_BENCH' ||
            (eff.primitive as any) === 'PLACE_DAMAGE_COUNTERS'
          ) {
            // PLACE_DAMAGE_COUNTERS place des MARQUEURS de dégâts.
            // Les marqueurs contournent la prévention des dégâts et affectent les Pokémon Téracristal normalement !
            if (passiveBoard.bench.length > 0 && dmgInfo.benchDamage > 0) {
              let bestBenchIdx = 0
              let bestBenchScore = -9999
              passiveBoard.bench.forEach((bPoke, bIdx) => {
                const remHp = getRemainingHp(bPoke)
                const willKo = remHp <= dmgInfo.benchDamage
                const s =
                  (willKo ? 500 : 0) +
                  (bPoke.card.strategicEvaluator.intrinsicBaseScore ?? 70) -
                  remHp * 0.4
                if (s > bestBenchScore) {
                  bestBenchScore = s
                  bestBenchIdx = bIdx
                }
              })
              const targetBench = passiveBoard.bench[bestBenchIdx]
              if (targetBench) {
                targetBench.damage += dmgInfo.benchDamage
                if (targetBench.damage >= getPokemonMaxHp(targetBench)) {
                  handleKnockOut(state, activeBoard, passiveBoard, bestBenchIdx)
                }
              }
            }
          } else {
            resolveAtomicEffect(
              state,
              activeBoard,
              passiveBoard,
              eff,
              action,
              rng,
              markDeckSearched,
            )
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

  // Résolution automatique des talents `ABILITY_ON_EVOLVE` (ex: Règne Infernal de Dracaufeu-ex)
  for (const pAction of evoCard.playableActions) {
    if (
      pAction.actionType === 'USE_ABILITY' ||
      pAction.sourceType === 'ABILITY_ON_EVOLVE' ||
      pAction.timing === 'ON_EVOLVE_TRIGGER'
    ) {
      const rng = new Mulberry32(state.rngState)
      for (const eff of pAction.effects) {
        resolveAtomicEffect(
          state,
          activeBoard,
          getPassiveBoard(state),
          eff,
          { type: 'USE_ABILITY', label: pAction.label, actionId: pAction.actionId },
          rng,
          markDeckSearched,
        )
      }
      state.rngState = rng.getState()
    }
  }
}

/**
 * Exécute une primitive atomique de `AtomicEffect` issue du modèle JSON.
 */
function resolveAtomicEffect(
  state: MatchState,
  activeBoard: PlayerBoardState,
  passiveBoard: PlayerBoardState,
  eff: AtomicEffect,
  action: GameAction,
  rng: Mulberry32,
  markDeckSearched: () => void,
): void {
  switch (eff.primitive as string) {
    case 'SEARCH_DECK': {
      markDeckSearched()
      const maxCount = eff.count || 1
      const isToBench =
        eff.target === 'OWN_BENCH' ||
        eff.target === 'BENCH' ||
        eff.zone === 'BENCH' ||
        (eff as any).targetZone === 'BENCH'

      if (isToBench) {
        const maxSlots = getMaxBenchSlots(activeBoard, state.activeStadium)
        for (let i = 0; i < maxCount; i++) {
          if (activeBoard.bench.length >= maxSlots) break
          const chosenIdx = activeBoard.deck.findIndex((c) => cardMatchesEffectFilter(c, eff))
          if (chosenIdx === -1) break
          const card = activeBoard.deck.splice(chosenIdx, 1)[0]!
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
            chosenIdx = activeBoard.deck.findIndex((c) => cardMatchesEffectFilter(c, eff))
          }
          if (chosenIdx === -1) break
          const foundCard = activeBoard.deck.splice(chosenIdx, 1)[0]!
          activeBoard.hand.push(foundCard)
        }
      }
      fisherYatesShuffle(activeBoard.deck, rng)
      break
    }

    case 'ATTACH_ENERGY': {
      const isFromDiscard = eff.zone === 'DISCARD' || (eff as any).sourceZone === 'DISCARD'
      const isFromHand = eff.zone === 'HAND' || (eff as any).sourceZone === 'HAND'
      const maxCount = eff.count || 1

      if (isFromDiscard) {
        for (let i = 0; i < maxCount; i++) {
          const enIdx = activeBoard.discard.findIndex((c) => cardMatchesEffectFilter(c, eff))
          if (enIdx === -1) break
          const targetPoke = selectBestPokemonForEnergyAttachment(activeBoard)
          if (!targetPoke) break
          if (action.actionId === 'ability_psychic_embrace') {
            if (getRemainingHp(targetPoke) <= 20) break
            targetPoke.damage += 20
          }
          const energyCard = activeBoard.discard.splice(enIdx, 1)[0]!
          targetPoke.attachedEnergies.push(energyCard)
        }
      } else if (isFromHand) {
        for (let i = 0; i < maxCount; i++) {
          const enIdx = activeBoard.hand.findIndex((c) => cardMatchesEffectFilter(c, eff))
          if (enIdx === -1) break
          const energyCard = activeBoard.hand.splice(enIdx, 1)[0]!
          const targetPoke = selectBestPokemonForEnergyAttachment(activeBoard)
          if (targetPoke) {
            targetPoke.attachedEnergies.push(energyCard)
          } else {
            activeBoard.hand.push(energyCard)
          }
        }
      } else {
        markDeckSearched()
        for (let i = 0; i < maxCount; i++) {
          const enIdx = activeBoard.deck.findIndex((c) => cardMatchesEffectFilter(c, eff))
          if (enIdx === -1) break
          const energyCard = activeBoard.deck.splice(enIdx, 1)[0]!
          const targetPoke = selectBestPokemonForEnergyAttachment(activeBoard)
          if (targetPoke) {
            targetPoke.attachedEnergies.push(energyCard)
          } else {
            activeBoard.discard.push(energyCard)
          }
        }
        fisherYatesShuffle(activeBoard.deck, rng)
      }
      break
    }

    case 'DISCARD_CARDS': {
      const count = eff.count || 1
      for (let i = 0; i < count && activeBoard.hand.length > 0; i++) {
        activeBoard.discard.push(activeBoard.hand.pop()!)
      }
      break
    }

    case 'HEAL': {
      const healAmt = eff.value ?? eff.baseDamage ?? (eff.count || 1) * 30
      const target =
        action.targetSlot === 'ACTIVE'
          ? activeBoard.activePokemon
          : typeof action.targetSlot === 'number'
            ? activeBoard.bench[action.targetSlot] ?? activeBoard.activePokemon
            : activeBoard.activePokemon
      if (target) {
        target.damage = Math.max(0, target.damage - healAmt)
      }
      break
    }

    case 'SWITCH_ACTIVE': {
      const isGust =
        eff.target === 'OPPONENT_BENCH' || (eff as any).targetZone === 'OPPONENT_BENCH'
      if (isGust) {
        if (passiveBoard.bench.length === 0) break
        const targetBenchIdx =
          action.targetBenchIndex !== undefined && passiveBoard.bench[action.targetBenchIndex]
            ? action.targetBenchIndex
            : 0
        const newOppActive = passiveBoard.bench[targetBenchIdx]!
        const oldOppActive = passiveBoard.activePokemon
        passiveBoard.activePokemon = newOppActive
        if (oldOppActive) {
          passiveBoard.bench[targetBenchIdx] = oldOppActive
        } else {
          passiveBoard.bench.splice(targetBenchIdx, 1)
        }
      } else {
        if (activeBoard.bench.length === 0) break
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
          activeBoard.bench[bestBenchIdx] = oldActive
        } else {
          activeBoard.bench.splice(bestBenchIdx, 1)
        }
      }
      break
    }

    case 'EVOLVE_POKEMON': {
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
          c.subCategory === 'STAGE_2' &&
          (!wantedStage2Id || c.cardId === wantedStage2Id) &&
          targetPoke !== null &&
          canPokemonEvolveInto(targetPoke, c, state.turnNumber, true),
      )
      if (targetPoke && handIdx !== -1) {
        const stage2Card = activeBoard.hand.splice(handIdx, 1)[0]!
        evolveInPlayPokemon(state, activeBoard, targetPoke, stage2Card, markDeckSearched)
      }
      break
    }

    case 'SHUFFLE_HAND_DRAW': {
      if (action.actionId === 'play_unfair_stamp') {
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
      } else if (eff.target === 'OPPONENT' || (eff as any).targetZone === 'OPPONENT_HAND') {
        const oppHand = passiveBoard.hand.splice(0, passiveBoard.hand.length)
        passiveBoard.deck.push(...oppHand)
        fisherYatesShuffle(passiveBoard.deck, rng)
        const drawCount = eff.count || 2
        for (let i = 0; i < drawCount && passiveBoard.deck.length > 0; i++) {
          passiveBoard.hand.push(passiveBoard.deck.shift()!)
        }
      } else if (
        action.actionId?.includes('iono') ||
        action.actionId?.includes('mashynn') ||
        (eff as any).primitive === 'SHUFFLE_HAND_BOTTOM_DRAW_PRIZES'
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

    case 'RECOVER_FROM_DISCARD': {
      const isToHand = eff.target !== 'DECK' && eff.zone !== 'DECK'
      if (isToHand) {
        let bestIdx = -1
        let bestScore = -1
        activeBoard.discard.forEach((c, idx) => {
          if (cardMatchesEffectFilter(c, eff) || c.category === 'POKEMON' || (c.category === 'ENERGY' && c.subCategory === 'BASIC_ENERGY')) {
            const s = c.strategicEvaluator.intrinsicBaseScore ?? 80
            if (s > bestScore) {
              bestScore = s
              bestIdx = idx
            }
          }
        })
        if (bestIdx !== -1) {
          activeBoard.hand.push(activeBoard.discard.splice(bestIdx, 1)[0]!)
        }
      } else {
        const maxCount = eff.count || 3
        let moved = 0
        for (let i = activeBoard.discard.length - 1; i >= 0 && moved < maxCount; i--) {
          const c = activeBoard.discard[i]!
          if (cardMatchesEffectFilter(c, eff) || c.category === 'POKEMON' || (c.category === 'ENERGY' && c.subCategory === 'BASIC_ENERGY')) {
            activeBoard.deck.push(activeBoard.discard.splice(i, 1)[0]!)
            moved++
          }
        }
        if (moved > 0) {
          fisherYatesShuffle(activeBoard.deck, rng)
        }
      }
      break
    }

    case 'SEARCH_DECK_TO_BENCH': {
      markDeckSearched()
      const maxCount = eff.count || 1
      const maxSlots = getMaxBenchSlots(activeBoard, state.activeStadium)
      for (let i = 0; i < maxCount; i++) {
        if (activeBoard.bench.length >= maxSlots) break
        const chosenIdx = selectBestBasicInDeckForBench(activeBoard, eff.targetFilter)
        if (chosenIdx === -1) break
        const card = activeBoard.deck.splice(chosenIdx, 1)[0]!
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
      fisherYatesShuffle(activeBoard.deck, rng)
      break
    }

    case 'SEARCH_DECK_TO_HAND': {
      markDeckSearched()
      const maxCount = eff.count || 1
      for (let i = 0; i < maxCount; i++) {
        let chosenIdx = -1
        if (action.targetCardIds && action.targetCardIds[i]) {
          chosenIdx = activeBoard.deck.findIndex(
            (c) => c.cardId === action.targetCardIds![i] && matchesCardFilter(c, eff.targetFilter),
          )
        }
        if (chosenIdx === -1) {
          const bestModels = selectBestDeckTutorTargets(
            state,
            activeBoard,
            passiveBoard,
            eff.targetFilter,
            1,
          )
          if (bestModels.length > 0) {
            chosenIdx = activeBoard.deck.findIndex((c) => c.cardId === bestModels[0]!.cardId)
          }
        }
        if (chosenIdx === -1) break
        const foundCard = activeBoard.deck.splice(chosenIdx, 1)[0]!
        activeBoard.hand.push(foundCard)
      }
      fisherYatesShuffle(activeBoard.deck, rng)
      break
    }

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
          c.subCategory === 'STAGE_2' &&
          (!wantedStage2Id || c.cardId === wantedStage2Id) &&
          targetPoke !== null &&
          canPokemonEvolveInto(targetPoke, c, state.turnNumber, true),
      )
      if (targetPoke && handIdx !== -1) {
        const stage2Card = activeBoard.hand.splice(handIdx, 1)[0]!
        evolveInPlayPokemon(state, activeBoard, targetPoke, stage2Card, markDeckSearched)
      }
      break
    }

    case 'SEARCH_AND_ATTACH_ENERGY': {
      markDeckSearched()
      const maxCount = eff.count || 3
      for (let i = 0; i < maxCount; i++) {
        const enIdx = activeBoard.deck.findIndex((c) => matchesCardFilter(c, eff.targetFilter))
        if (enIdx === -1) break
        const energyCard = activeBoard.deck.splice(enIdx, 1)[0]!
        const targetPoke = selectBestPokemonForEnergyAttachment(activeBoard)
        if (targetPoke) {
          targetPoke.attachedEnergies.push(energyCard)
        } else {
          activeBoard.discard.push(energyCard)
        }
      }
      fisherYatesShuffle(activeBoard.deck, rng)
      break
    }

    case 'ATTACH_ENERGY_FROM_DISCARD': {
      const maxCount = eff.count || 1
      for (let i = 0; i < maxCount; i++) {
        const enIdx = activeBoard.discard.findIndex((c) => matchesCardFilter(c, eff.targetFilter))
        if (enIdx === -1) break
        const targetPoke = selectBestPokemonForEnergyAttachment(activeBoard)
        if (!targetPoke) break
        // Si c'est Enlacement Psy (Gardevoir-ex), vérifie qu'on ne met pas KO notre propre Pokémon avec les 20 dégâts
        if (action.actionId === 'ability_psychic_embrace') {
          if (getRemainingHp(targetPoke) <= 20) break
          targetPoke.damage += 20
        }
        const energyCard = activeBoard.discard.splice(enIdx, 1)[0]!
        targetPoke.attachedEnergies.push(energyCard)
      }
      break
    }

    case 'ATTACH_EXTRA_ENERGY_FROM_HAND': {
      const enIdx = activeBoard.hand.findIndex((c) => matchesCardFilter(c, eff.targetFilter))
      if (enIdx !== -1) {
        const energyCard = activeBoard.hand.splice(enIdx, 1)[0]!
        const targetPoke = selectBestPokemonForEnergyAttachment(activeBoard)
        if (targetPoke) {
          targetPoke.attachedEnergies.push(energyCard)
        } else {
          activeBoard.hand.push(energyCard)
        }
      }
      break
    }

    case 'DRAW_CARDS': {
      const count = eff.count || 1
      for (let i = 0; i < count && activeBoard.deck.length > 0; i++) {
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
          (b.strategicEvaluator.intrinsicBaseScore ?? 70) - (a.strategicEvaluator.intrinsicBaseScore ?? 70),
      )
      const picked = topCards.shift()!
      if (!eff.targetFilter || matchesCardFilter(picked, eff.targetFilter)) {
        activeBoard.hand.push(picked)
      } else {
        activeBoard.discard.push(picked)
      }
      // Le reste va sous le deck
      activeBoard.deck.push(...topCards)
      break
    }

    case 'DISCARD_HAND_AND_DRAW': {
      while (activeBoard.hand.length > 0) {
        activeBoard.discard.push(activeBoard.hand.pop()!)
      }
      const drawCount = eff.count || 7
      for (let i = 0; i < drawCount && activeBoard.deck.length > 0; i++) {
        activeBoard.hand.push(activeBoard.deck.shift()!)
      }
      break
    }

    case 'SHUFFLE_HAND_AND_DRAW': {
      // Tampon Injuste : vous mélangez votre main et piochez 5, l'adversaire mélange sa main et pioche 2
      if (action.actionId === 'play_unfair_stamp') {
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
      } else if (eff.targetZone === 'OPPONENT_HAND') {
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

    case 'SHUFFLE_HAND_BOTTOM_DRAW_PRIZES': {
      // Mashynn / Iono : chaque joueur mélange sa main sous son deck et pioche selon ses Récompenses restantes
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
      break
    }

    case 'RECOVER_DISCARD_TO_HAND': {
      // Civière Nocturne : récupère le meilleur Pokémon ou Énergie de base de la défausse vers la main
      let bestIdx = -1
      let bestScore = -1
      activeBoard.discard.forEach((c, idx) => {
        if (c.category === 'POKEMON' || (c.category === 'ENERGY' && c.subCategory === 'BASIC_ENERGY')) {
          const s = c.strategicEvaluator.intrinsicBaseScore ?? 70
          if (s > bestScore) {
            bestScore = s
            bestIdx = idx
          }
        }
      })
      if (bestIdx !== -1) {
        activeBoard.hand.push(activeBoard.discard.splice(bestIdx, 1)[0]!)
      }
      break
    }

    case 'SHUFFLE_DISCARD_TO_DECK': {
      const maxCount = eff.count || 3
      let moved = 0
      for (let i = activeBoard.discard.length - 1; i >= 0 && moved < maxCount; i--) {
        const c = activeBoard.discard[i]!
        if (c.category === 'POKEMON' || (c.category === 'ENERGY' && c.subCategory === 'BASIC_ENERGY')) {
          activeBoard.deck.push(activeBoard.discard.splice(i, 1)[0]!)
          moved++
        }
      }
      if (moved > 0) {
        fisherYatesShuffle(activeBoard.deck, rng)
      }
      break
    }

    case 'GUST_OPPONENT_BENCH': {
      if (passiveBoard.bench.length === 0) break
      const targetBenchIdx =
        action.targetBenchIndex !== undefined && passiveBoard.bench[action.targetBenchIndex]
          ? action.targetBenchIndex
          : 0
      const newOppActive = passiveBoard.bench[targetBenchIdx]!
      const oldOppActive = passiveBoard.activePokemon
      passiveBoard.activePokemon = newOppActive
      if (oldOppActive) {
        passiveBoard.bench[targetBenchIdx] = oldOppActive
      } else {
        passiveBoard.bench.splice(targetBenchIdx, 1)
      }
      break
    }

    case 'SWITCH_ACTIVE_POKEMON': {
      if (activeBoard.bench.length === 0) break
      let bestBenchIdx = 0
      let bestScore = -9999
      activeBoard.bench.forEach((bPoke, bIdx) => {
        const s =
          bPoke.attachedEnergies.length * 45 +
          (bPoke.card.strategicEvaluator.intrinsicBaseScore ?? 70) -
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
        activeBoard.bench[bestBenchIdx] = oldActive
      } else {
        activeBoard.bench.splice(bestBenchIdx, 1)
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

    case 'HEAL_DAMAGE': {
      const healAmt = eff.baseDamage ?? (eff.count || 1) * 10
      const target =
        action.targetSlot === 'ACTIVE'
          ? activeBoard.activePokemon
          : typeof action.targetSlot === 'number'
            ? activeBoard.bench[action.targetSlot] ?? activeBoard.activePokemon
            : activeBoard.activePokemon
      if (target) {
        target.damage = Math.max(0, target.damage - healAmt)
      }
      break
    }

    case 'PLACE_DAMAGE_COUNTERS': {
      const counters = eff.count || 1
      const dmg = counters * 10
      const target =
        action.targetSlot === 'ACTIVE'
          ? passiveBoard.activePokemon
          : typeof action.targetSlot === 'number'
            ? passiveBoard.bench[action.targetSlot] ?? passiveBoard.activePokemon
            : passiveBoard.activePokemon
      if (target) {
        target.damage += dmg
        if (target.damage >= getPokemonMaxHp(target)) {
          const slot =
            action.targetSlot === 'ACTIVE' ? 'ACTIVE' : (action.targetSlot as number) ?? 'ACTIVE'
          handleKnockOut(state, activeBoard, passiveBoard, slot)
        }
      }
      break
    }

    case 'DEAL_DAMAGE_BENCH': {
      const dmg = eff.baseDamage ?? (eff.count || 1) * 10
      for (let bIdx = passiveBoard.bench.length - 1; bIdx >= 0; bIdx--) {
        const bPoke = passiveBoard.bench[bIdx]!
        if (bPoke.card.pokemonStats?.isTera) continue
        bPoke.damage += dmg
        if (bPoke.damage >= getPokemonMaxHp(bPoke)) {
          handleKnockOut(state, activeBoard, passiveBoard, bIdx)
        }
      }
      break
    }

    case 'APPLY_SPECIAL_CONDITION': {
      const cond = (eff.specialCondition || 'POISONED') as SpecialConditionType
      const target = passiveBoard.activePokemon
      if (target) {
        target.specialConditions = target.specialConditions || []
        if (cond === 'ASLEEP' || cond === 'CONFUSED' || cond === 'PARALYZED') {
          target.specialConditions = target.specialConditions.filter(
            (c) => c === 'POISONED' || c === 'BURNED',
          )
        }
        if (!target.specialConditions.includes(cond)) {
          target.specialConditions.push(cond)
        }
      }
      break
    }

    case 'MOVE_ENERGY_BETWEEN_POKEMON': {
      if (activeBoard.activePokemon && activeBoard.bench.length > 0) {
        const bPoke = activeBoard.bench.find((b) => b.attachedEnergies.length > 0)
        if (bPoke) {
          const en = bPoke.attachedEnergies.pop()!
          activeBoard.activePokemon.attachedEnergies.push(en)
        }
      }
      break
    }

    case 'MOVE_DAMAGE_COUNTERS': {
      const counters = eff.count || 1
      const dmg = counters * 10
      if (
        activeBoard.activePokemon &&
        activeBoard.activePokemon.damage >= dmg &&
        passiveBoard.activePokemon
      ) {
        activeBoard.activePokemon.damage -= dmg
        passiveBoard.activePokemon.damage += dmg
        if (passiveBoard.activePokemon.damage >= getPokemonMaxHp(passiveBoard.activePokemon)) {
          handleKnockOut(state, activeBoard, passiveBoard, 'ACTIVE')
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

    case 'DISCARD_OPPONENT_ENERGY': {
      const oppPoke = passiveBoard.activePokemon || passiveBoard.bench[0]
      if (oppPoke && oppPoke.attachedEnergies.length > 0) {
        const discarded = oppPoke.attachedEnergies.pop()!
        passiveBoard.discard.push(discarded)
      }
      break
    }

    case 'DISCARD_TOOL_OR_STADIUM': {
      if (state.activeStadium) {
        const prevOwner = state.activeStadium.ownerIndex === 0 ? state.player : state.opponent
        prevOwner.discard.push(state.activeStadium.card)
        state.activeStadium = null
        enforceBenchCapacity(activeBoard, getMaxBenchSlots(activeBoard, null))
        enforceBenchCapacity(passiveBoard, getMaxBenchSlots(passiveBoard, null))
      } else if (passiveBoard.activePokemon && passiveBoard.activePokemon.attachedTools.length > 0) {
        const tool = passiveBoard.activePokemon.attachedTools.pop()!
        passiveBoard.discard.push(tool)
      }
      break
    }

    case 'MILL_OPPONENT_DECK': {
      const count = eff.count || 1
      for (let i = 0; i < count && passiveBoard.deck.length > 0; i++) {
        passiveBoard.discard.push(passiveBoard.deck.shift()!)
      }
      break
    }

    case 'DISCARD_FROM_OPPONENT_HAND': {
      const count = eff.count || 1
      for (let i = 0; i < count && passiveBoard.hand.length > 0; i++) {
        passiveBoard.discard.push(passiveBoard.hand.pop()!)
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
          if (oppPoke.damage >= getPokemonMaxHp(oppPoke)) {
            const slot =
              passiveBoard.activePokemon?.instanceId === oppPoke.instanceId ? 'ACTIVE' : 0
            handleKnockOut(state, activeBoard, passiveBoard, slot)
          }
        }
      }
      break
    }

    case 'TAKE_EXTRA_PRIZE_CARDS': {
      if (activeBoard.prizes.length > 0) {
        const extraCount = eff.count || 1
        for (let i = 0; i < extraCount && activeBoard.prizes.length > 0; i++) {
          activeBoard.hand.push(activeBoard.prizes.shift()!)
        }
      }
      break
    }

    case 'PASSIVE_ABILITY_OR_ITEM_LOCK': {
      passiveBoard.itemLockActive = true
      break
    }

    case 'PASSIVE_DAMAGE_BOOST':
    case 'DAMAGE_ACTIVE': {
      if ((eff.primitive as string) === 'PASSIVE_DAMAGE_BOOST' || action.type === 'PLAY_TRAINER' || eff.target === 'SELF') {
        const boostAmount = eff.value ?? eff.baseDamage ?? (eff.count ? eff.count * 10 : 60)
        activeBoard.turnDamageBoost = (activeBoard.turnDamageBoost || 0) + boostAmount
      }
      break
    }

    default:
      break
  }
}

function selectBestBasicInDeckForBench(
  activeBoard: PlayerBoardState,
  filter?: CardFilter | null,
): number {
  const allInPlay = [
    ...(activeBoard.activePokemon ? [activeBoard.activePokemon] : []),
    ...activeBoard.bench,
  ]

  let bestIdx = -1
  let bestScore = -9999

  activeBoard.deck.forEach((c, idx) => {
    if (!matchesCardFilter(c, filter)) return
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

/**
 * Termine le tour courant et passe au joueur suivant ou conclut au plafond `maxTurns`.
 */
export function endTurnAndAdvance(state: MatchState): void {
  if (state.winner !== null) return

  // Défausse des Machines Techniques attachées et réinitialisation des verrous de tour
  const endingBoard = getActiveBoard(state)
  const allEndingPokes = [
    ...(endingBoard.activePokemon ? [endingBoard.activePokemon] : []),
    ...endingBoard.bench,
  ]
  for (const poke of allEndingPokes) {
    poke.cantAttackNextTurn = false
    for (let i = poke.attachedTools.length - 1; i >= 0; i--) {
      const tool = poke.attachedTools[i]!
      if (tool.identity.isTechnicalMachine) {
        poke.attachedTools.splice(i, 1)
        endingBoard.discard.push(tool)
      }
    }
  }

  // Réinitialiser le talent de stade
  if (state.activeStadium) {
    state.activeStadium.usedThisTurn = false
  }

  endingBoard.abilityUsageCountsThisTurn = {}
  endingBoard.itemLockActive = false
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
