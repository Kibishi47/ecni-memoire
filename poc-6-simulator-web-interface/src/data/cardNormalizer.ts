/**
 * Normaliseur déterministe de cartes Pokémon TCG (`cardNormalizer.ts`).
 * Aligné à 100 % sur `card-compiler/compiler/schemas.py`.
 */

import type {
  ActionType,
  AIRole,
  AtomicEffect,
  CardCategory,
  CardIdentity,
  CardSubCategory,
  EffectPrimitive,
  EngineCardModel,
  PlayableAction,
  PokemonStats,
  StrategicEvaluator,
  TimingPhase,
  TypeModifier,
} from '../types/cardModel'
import { targetFilterToDsl } from '../core/filterDsl'

export function coerceCardCategory(val: any): CardCategory {
  const s = String(val || '').trim().toUpperCase()
  if (s.includes('POK')) return 'POKEMON'
  if (s.includes('ENERG')) return 'ENERGY'
  if (
    s === 'TRAINER' ||
    s === 'DRESSEUR' ||
    s === 'SUPPORTER' ||
    s === 'ITEM' ||
    s === 'OBJET' ||
    s === 'STADIUM' ||
    s === 'STADE' ||
    s === 'TOOL' ||
    s === 'OUTIL'
  ) {
    return 'TRAINER'
  }
  return 'POKEMON'
}

export function coerceCardSubCategory(val: any): CardSubCategory {
  const s = String(val || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  const map: Record<string, CardSubCategory> = {
    BASIC: 'BASIC',
    BASE: 'BASIC',
    STAGE_1: 'STAGE_1',
    STAGE1: 'STAGE_1',
    NIVEAU_1: 'STAGE_1',
    STAGE_2: 'STAGE_2',
    STAGE2: 'STAGE_2',
    NIVEAU_2: 'STAGE_2',
    SUPPORTER: 'SUPPORTER',
    ITEM: 'ITEM',
    OBJET: 'ITEM',
    STADIUM: 'STADIUM',
    STADE: 'STADIUM',
    TOOL: 'TOOL',
    POKEMON_TOOL: 'TOOL',
    OUTIL: 'TOOL',
    BASIC_ENERGY: 'BASIC_ENERGY',
    ENERGIE_DE_BASE: 'BASIC_ENERGY',
    SPECIAL_ENERGY: 'SPECIAL_ENERGY',
    ENERGIE_SPECIALE: 'SPECIAL_ENERGY',
  }
  return map[s] || 'BASIC'
}

export function coerceActionType(val: any, actionId = ''): ActionType {
  const s = String(val || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (s === 'PLAY_FROM_HAND' || s === 'TRAINER_PLAY' || s === 'PLAY_CARD' || s === 'PLAY_POKEMON') {
    return 'PLAY_FROM_HAND'
  }
  if (s === 'EVOLVE' || s === 'EVOLVE_POKEMON') return 'EVOLVE'
  if (
    s === 'USE_ABILITY' ||
    s === 'ABILITY' ||
    s.startsWith('ABILITY_') ||
    s.includes('TALENT')
  ) {
    return 'USE_ABILITY'
  }
  if (s === 'ATTACH_ENERGY' || s === 'ENERGY_ATTACHMENT' || s === 'SPECIAL_ENERGY_EFFECT') {
    return 'ATTACH_ENERGY'
  }
  if (s === 'RETREAT' || s === 'RETREAT_ACTION') return 'RETREAT'
  if (s === 'ATTACK' || s.includes('ATTAQUE')) return 'ATTACK'

  if (actionId.startsWith('attack')) return 'ATTACK'
  if (actionId.startsWith('ability')) return 'USE_ABILITY'
  if (actionId.startsWith('retreat')) return 'RETREAT'
  if (actionId.startsWith('evolve')) return 'EVOLVE'
  if (actionId.startsWith('attach')) return 'ATTACH_ENERGY'
  return 'PLAY_FROM_HAND'
}

export function coerceTimingPhase(val: any, actionType: ActionType): TimingPhase {
  const s = String(val || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  if (s === 'PREPARATION' || s === 'SETUP') return 'PREPARATION'
  if (s === 'MAIN_PHASE_2' || s === 'BETWEEN_TURNS_CHECKUP') return 'MAIN_PHASE_2'
  if (s === 'ATTACK_PHASE' || s === 'END_OF_TURN_ATTACK' || s === 'ATTACK') return 'ATTACK_PHASE'
  if (actionType === 'ATTACK') return 'ATTACK_PHASE'
  return 'MAIN_PHASE_1'
}

export function coerceEffectPrimitive(val: any): EffectPrimitive {
  const s = String(val || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  const map: Record<string, EffectPrimitive> = {
    SEARCH_DECK: 'SEARCH_DECK',
    SEARCH_DECK_TO_HAND: 'SEARCH_DECK',
    SEARCH_DECK_TO_BENCH: 'SEARCH_DECK',
    SEARCH_DECK_AND_PUT_ON_BENCH: 'SEARCH_DECK',
    SEARCH_CARD: 'SEARCH_DECK',
    SEARCH: 'SEARCH_DECK',
    TUTOR: 'SEARCH_DECK',
    LOOK_TOP_DECK: 'SEARCH_DECK',
    LOOK_TOP_DECK_PICK: 'SEARCH_DECK',

    DRAW_CARDS: 'DRAW_CARDS',
    DRAW: 'DRAW_CARDS',
    DRAW_CARD: 'DRAW_CARDS',
    DRAW_UNTIL_HAND_SIZE: 'DRAW_CARDS',
    DRAW_UNTIL: 'DRAW_CARDS',

    DAMAGE_ACTIVE: 'DAMAGE_ACTIVE',
    DEAL_DAMAGE_ACTIVE: 'DAMAGE_ACTIVE',
    DEAL_DAMAGE: 'DAMAGE_ACTIVE',
    DAMAGE: 'DAMAGE_ACTIVE',
    ATTACK_DAMAGE: 'DAMAGE_ACTIVE',
    COIN_FLIP_DAMAGE: 'DAMAGE_ACTIVE',
    BONUS_DAMAGE: 'DAMAGE_ACTIVE',
    EXTRA_DAMAGE: 'DAMAGE_ACTIVE',
    PASSIVE_DAMAGE_BOOST: 'DAMAGE_ACTIVE',

    DAMAGE_BENCH: 'DAMAGE_BENCH',
    DEAL_DAMAGE_BENCH: 'DAMAGE_BENCH',
    PLACE_DAMAGE_COUNTERS: 'DAMAGE_BENCH',
    PUT_DAMAGE_COUNTERS: 'DAMAGE_BENCH',
    SNIPE_BENCH: 'DAMAGE_BENCH',
    SPREAD_DAMAGE: 'DAMAGE_BENCH',
    DISTRIBUTE_DAMAGE_COUNTERS_BENCH: 'DAMAGE_BENCH',

    ATTACH_ENERGY: 'ATTACH_ENERGY',
    ATTACH_ENERGY_FROM_HAND: 'ATTACH_ENERGY',
    ATTACH_ENERGY_FROM_DISCARD: 'ATTACH_ENERGY',
    ATTACH_ENERGY_FROM_DECK: 'ATTACH_ENERGY',
    SEARCH_AND_ATTACH_ENERGY: 'ATTACH_ENERGY',
    ATTACH_EXTRA_ENERGY_FROM_HAND: 'ATTACH_ENERGY',
    ACCELERATE_ENERGY: 'ATTACH_ENERGY',
    MOVE_ENERGY_BETWEEN_POKEMON: 'ATTACH_ENERGY',
    MOVE_ENERGY: 'ATTACH_ENERGY',
    PROVIDE_ENERGY: 'ATTACH_ENERGY',

    DISCARD_CARDS: 'DISCARD_CARDS',
    DISCARD: 'DISCARD_CARDS',
    DISCARD_FROM_HAND: 'DISCARD_CARDS',
    DISCARD_HAND: 'DISCARD_CARDS',
    DISCARD_ENERGY: 'DISCARD_CARDS',
    DISCARD_STADIUM: 'DISCARD_CARDS',
    DISCARD_TOOL: 'DISCARD_CARDS',
    DISCARD_TOOL_OR_STADIUM: 'DISCARD_CARDS',
    DISCARD_OPPONENT_ENERGY: 'DISCARD_CARDS',
    MILL_OPPONENT_DECK: 'DISCARD_CARDS',
    DISCARD_FROM_OPPONENT_HAND: 'DISCARD_CARDS',

    HEAL: 'HEAL',
    HEAL_DAMAGE: 'HEAL',
    HEAL_POKEMON: 'HEAL',
    REMOVE_DAMAGE_COUNTERS: 'HEAL',
    PASSIVE_DAMAGE_REDUCTION: 'HEAL',
    PASSIVE_PREVENT_DAMAGE_OR_EFFECTS: 'HEAL',

    SWITCH_ACTIVE: 'SWITCH_ACTIVE',
    SWITCH_ACTIVE_POKEMON: 'SWITCH_ACTIVE',
    GUST_OPPONENT_BENCH_TO_ACTIVE: 'SWITCH_ACTIVE',
    GUST_OPPONENT_BENCH: 'SWITCH_ACTIVE',
    SWITCH_OPPONENT_ACTIVE: 'SWITCH_ACTIVE',
    SWITCH: 'SWITCH_ACTIVE',
    GUST: 'SWITCH_ACTIVE',
    RETREAT: 'SWITCH_ACTIVE',
    PASSIVE_RETREAT_COST_MOD: 'SWITCH_ACTIVE',

    APPLY_SPECIAL_CONDITION: 'APPLY_SPECIAL_CONDITION',
    SPECIAL_CONDITION: 'APPLY_SPECIAL_CONDITION',
    STATUS_CONDITION: 'APPLY_SPECIAL_CONDITION',
    POISON: 'APPLY_SPECIAL_CONDITION',
    BURN: 'APPLY_SPECIAL_CONDITION',
    SLEEP: 'APPLY_SPECIAL_CONDITION',
    PARALYZE: 'APPLY_SPECIAL_CONDITION',
    CONFUSE: 'APPLY_SPECIAL_CONDITION',
    PASSIVE_ABILITY_OR_ITEM_LOCK: 'APPLY_SPECIAL_CONDITION',

    EVOLVE_POKEMON: 'EVOLVE_POKEMON',
    EVOLVE_SKIP_STAGE_1: 'EVOLVE_POKEMON',
    EVOLVE_SKIP_STAGE1: 'EVOLVE_POKEMON',
    EVOLVE_FROM_HAND: 'EVOLVE_POKEMON',
    EVOLVE_FROM_DECK: 'EVOLVE_POKEMON',
    EVOLVE_NORMAL: 'EVOLVE_POKEMON',
    EVOLVE: 'EVOLVE_POKEMON',
    USE_STAGE_2_CARD: 'EVOLVE_POKEMON',
    DEVOLVE_OPPONENT_POKEMON: 'EVOLVE_POKEMON',

    SHUFFLE_HAND_DRAW: 'SHUFFLE_HAND_DRAW',
    SHUFFLE_HAND_AND_DRAW: 'SHUFFLE_HAND_DRAW',
    DISCARD_HAND_AND_DRAW: 'SHUFFLE_HAND_DRAW',
    SHUFFLE_HAND_BOTTOM_DRAW_PRIZES: 'SHUFFLE_HAND_DRAW',
    SHUFFLE_AND_DRAW: 'SHUFFLE_HAND_DRAW',
    RESET_HAND: 'SHUFFLE_HAND_DRAW',
    IONO_EFFECT: 'SHUFFLE_HAND_DRAW',

    RECOVER_FROM_DISCARD: 'RECOVER_FROM_DISCARD',
    RECOVER_FROM_DISCARD_TO_HAND: 'RECOVER_FROM_DISCARD',
    RECOVER_FROM_DISCARD_TO_DECK: 'RECOVER_FROM_DISCARD',
    RECOVER_FROM_DISCARD_TO_BENCH: 'RECOVER_FROM_DISCARD',
    RECOVER_DISCARD_TO_HAND: 'RECOVER_FROM_DISCARD',
    SHUFFLE_DISCARD_TO_DECK: 'RECOVER_FROM_DISCARD',
    RECOVER_CARDS: 'RECOVER_FROM_DISCARD',
    RECOVER: 'RECOVER_FROM_DISCARD',
  }

  if (map[s]) return map[s]
  if (s.includes('SEARCH') && s.includes('ENERG')) return 'ATTACH_ENERGY'
  if (s.includes('SEARCH') || s.includes('TUTOR')) return 'SEARCH_DECK'
  if (s.includes('SHUFFLE') && s.includes('DRAW')) return 'SHUFFLE_HAND_DRAW'
  if (s.includes('DRAW') || s.includes('PIOCH')) return 'DRAW_CARDS'
  if (s.includes('BENCH') && (s.includes('DAMAGE') || s.includes('COUNTER'))) return 'DAMAGE_BENCH'
  if (s.includes('DAMAGE') || s.includes('DEGAT')) return 'DAMAGE_ACTIVE'
  if (s.includes('ATTACH') || s.includes('ENERG')) return 'ATTACH_ENERGY'
  if (s.includes('DISCARD') || s.includes('DEFAUSS')) return 'DISCARD_CARDS'
  if (s.includes('HEAL') || s.includes('SOIN')) return 'HEAL'
  if (s.includes('SWITCH') || s.includes('GUST')) return 'SWITCH_ACTIVE'
  if (s.includes('EVOLV')) return 'EVOLVE_POKEMON'
  if (s.includes('RECOVER')) return 'RECOVER_FROM_DISCARD'
  return 'DRAW_CARDS'
}

export function coerceAIRole(val: any): AIRole {
  const s = String(val || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  const map: Record<string, AIRole> = {
    MAIN_ATTACKER: 'MAIN_ATTACKER',
    PRIMARY_ATTACKER: 'MAIN_ATTACKER',
    ATTACKER: 'MAIN_ATTACKER',
    SWEEPER: 'MAIN_ATTACKER',
    SECONDARY_ATTACKER: 'SECONDARY_ATTACKER',
    FINISHER: 'SECONDARY_ATTACKER',
    BENCH_SNIPER: 'SECONDARY_ATTACKER',
    SUB_ATTACKER: 'SECONDARY_ATTACKER',
    DRAW_ENGINE: 'DRAW_ENGINE',
    DRAW_ENGINE_POKEMON: 'DRAW_ENGINE',
    DRAW_SUPPORT: 'DRAW_ENGINE',
    DRAW: 'DRAW_ENGINE',
    ENERGY_ACCELERATOR: 'ENERGY_ACCELERATOR',
    RESOURCE_ENERGY: 'ENERGY_ACCELERATOR',
    ENERGY_PROVIDER: 'ENERGY_ACCELERATOR',
    RAMP: 'ENERGY_ACCELERATOR',
    GUEST_TECH: 'GUEST_TECH',
    TECH: 'GUEST_TECH',
    TECH_UTILITY: 'GUEST_TECH',
    UTILITY: 'GUEST_TECH',
    SUPPORT_UTILITY: 'GUEST_TECH',
    PIVOT_MOBILITY: 'GUEST_TECH',
    RECOVERY_UTILITY: 'GUEST_TECH',
    RECOVERY_RECYCLER: 'GUEST_TECH',
    MOBILITY_SWITCH: 'GUEST_TECH',
    DISRUPTION: 'DISRUPTION',
    GUST_BOSS_EFFECT: 'DISRUPTION',
    HAND_DISRUPTION: 'DISRUPTION',
    CONTROL_LOCK_DISRUPTION: 'DISRUPTION',
    CONTROL_STALL: 'DISRUPTION',
    CONTROL: 'DISRUPTION',
    STALL: 'DISRUPTION',
    DEFENSIVE_TANK_WALL: 'DISRUPTION',
    CONSISTENCY_BOOSTER: 'CONSISTENCY_BOOSTER',
    BENCH_DEPLOYER: 'CONSISTENCY_BOOSTER',
    CONSISTENCY_TUTOR: 'CONSISTENCY_BOOSTER',
    EVOLUTION_ACCELERATOR: 'CONSISTENCY_BOOSTER',
    TUTOR_ENGINE_POKEMON: 'CONSISTENCY_BOOSTER',
  }

  if (map[s]) return map[s]
  if (s.includes('MAIN') || s.includes('ATTACK')) return 'MAIN_ATTACKER'
  if (s.includes('SECOND') || s.includes('SNIP')) return 'SECONDARY_ATTACKER'
  if (s.includes('DRAW')) return 'DRAW_ENGINE'
  if (s.includes('ENERG')) return 'ENERGY_ACCELERATOR'
  if (s.includes('DISRUPT') || s.includes('GUST') || s.includes('CONTROL')) return 'DISRUPTION'
  if (s.includes('CONSIST') || s.includes('TUTOR') || s.includes('EVOLV')) return 'CONSISTENCY_BOOSTER'
  return 'GUEST_TECH'
}

/**
 * Normalise un modèle de carte brut vers le contrat strict `EngineCardModel`.
 */
export function normalizeCardModel(raw: any): EngineCardModel {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid raw card object')
  }

  const rawIdent = raw.identity || {}
  const cardId = String(raw.cardId || rawIdent.cardId || 'unknown-id').trim()
  const category = coerceCardCategory(raw.category || rawIdent.category)
  const subCategory = coerceCardSubCategory(raw.subCategory || rawIdent.subCategory)

  // 1. Identity
  const isRuleBox = Boolean(
    rawIdent.isRuleBox ??
      raw.pokemonStats?.isRuleBox ??
      raw.isRuleBox ??
      false,
  )

  let prizeCardsGiven = 1
  if (rawIdent.prizeCardsGiven != null) {
    prizeCardsGiven = Math.max(1, Math.min(3, Number(rawIdent.prizeCardsGiven)))
  } else if (raw.pokemonStats?.prizeCardsGiven != null) {
    prizeCardsGiven = Math.max(1, Math.min(3, Number(raw.pokemonStats.prizeCardsGiven)))
  } else if (isRuleBox) {
    prizeCardsGiven = 2
  }

  const regulationMark = rawIdent.regulationMark ? String(rawIdent.regulationMark).toUpperCase() : null
  const legalStandard = Boolean(
    rawIdent.legalStandard ??
      (subCategory === 'BASIC_ENERGY' || ['G', 'H', 'I'].includes(regulationMark || '')),
  )

  const identity: CardIdentity = {
    cardId,
    nameFr: String(rawIdent.nameFr || raw.nameFr || cardId),
    nameEn: rawIdent.nameEn ? String(rawIdent.nameEn) : null,
    setId: String(rawIdent.setId || raw.setId || ''),
    setName: rawIdent.setName ? String(rawIdent.setName) : null,
    category,
    subCategory,
    isRuleBox,
    prizeCardsGiven,
    isAceSpec: Boolean(rawIdent.isAceSpec ?? false),
    isAncient: Boolean(rawIdent.isAncient ?? rawIdent.mechanicTag === 'ANCIENT'),
    isFuture: Boolean(rawIdent.isFuture ?? rawIdent.mechanicTag === 'FUTURE'),
    isTera: Boolean(rawIdent.isTera ?? raw.pokemonStats?.isTera ?? false),
    legalStandard,
    legalExpanded: Boolean(rawIdent.legalExpanded ?? true),
    localId: rawIdent.localId ? String(rawIdent.localId) : null,
    regulationMark,
    rarity: rawIdent.rarity ? String(rawIdent.rarity) : null,
    imageUrl: rawIdent.imageUrl ? String(rawIdent.imageUrl) : null,
    isTechnicalMachine: Boolean(rawIdent.isTechnicalMachine ?? false),
    rawRulesText: Array.isArray(rawIdent.rawRulesText) ? rawIdent.rawRulesText.map(String) : [],
    mechanicTag: rawIdent.mechanicTag ?? (rawIdent.isAncient ? 'ANCIENT' : rawIdent.isFuture ? 'FUTURE' : null),
  }

  // 2. Pokemon Stats
  let pokemonStats: PokemonStats | null = null
  if (category === 'POKEMON' || raw.pokemonStats) {
    const rawStats = raw.pokemonStats || {}
    let stage = String(rawStats.stage || 'Base').trim()
    const lowStage = stage.toLowerCase()
    if (lowStage.includes('2')) stage = 'Niveau 2'
    else if (lowStage.includes('1') || lowStage.includes('vmax') || lowStage.includes('vstar')) stage = 'Niveau 1'
    else stage = 'Base'

    const evoChain = Array.isArray(rawStats.evolutionChain) ? rawStats.evolutionChain.map(String) : []
    const evolvesFrom = rawStats.evolvesFrom ? String(rawStats.evolvesFrom) : null
    let rootBasicName = String(rawStats.rootBasicName || '')
    if (!rootBasicName) {
      if (evoChain.length > 0) rootBasicName = evoChain[0]
      else if (evolvesFrom) rootBasicName = evolvesFrom
      else rootBasicName = identity.nameFr
    }

    // Weaknesses
    const weaknesses: TypeModifier[] = []
    const rawW = rawStats.weaknesses
    if (Array.isArray(rawW)) {
      for (const item of rawW) {
        if (typeof item === 'string') {
          weaknesses.push({ type: item, value: '×2' })
        } else if (item && typeof item === 'object') {
          weaknesses.push({
            type: String(item.type || 'Incolore'),
            value: String(item.value || '×2'),
          })
        }
      }
    }

    // Resistances
    const resistances: TypeModifier[] = []
    const rawR = rawStats.resistances
    if (Array.isArray(rawR)) {
      for (const item of rawR) {
        if (typeof item === 'string') {
          resistances.push({ type: item, value: '-30' })
        } else if (item && typeof item === 'object') {
          resistances.push({
            type: String(item.type || 'Incolore'),
            value: String(item.value || '-30'),
          })
        }
      }
    }

    pokemonStats = {
      hp: Math.max(0, Number(rawStats.hp || 0)),
      types: Array.isArray(rawStats.types) ? rawStats.types.map(String) : ['Incolore'],
      stage,
      evolvesFrom,
      rootBasicName,
      evolutionChain: evoChain,
      retreatCost: Math.max(0, Number(rawStats.retreatCost || 0)),
      weaknesses,
      resistances,
      prizeCardsGiven,
      isRuleBox,
      isTera: identity.isTera,
      isAncient: identity.isAncient,
      isFuture: identity.isFuture,
      canAttackTwice: Boolean(rawStats.canAttackTwice || raw.canAttackTwice),
    }
  }

  // 3. Playable Actions
  const rawActions = Array.isArray(raw.playableActions) ? raw.playableActions : []
  const playableActions: PlayableAction[] = rawActions.map((rawAct: any, idx: number) => {
    const actionId = String(rawAct.actionId || rawAct.id || `action_${idx}`)
    const actionType = coerceActionType(rawAct.actionType || rawAct.sourceType, actionId)
    const timingPhase = coerceTimingPhase(rawAct.timingPhase || rawAct.timing, actionType)

    // Cost: Dict[str, int]
    const cost: Record<string, number> = {}
    if (rawAct.cost && typeof rawAct.cost === 'object' && !Array.isArray(rawAct.cost)) {
      for (const [k, v] of Object.entries(rawAct.cost)) {
        const num = Number(v)
        if (!isNaN(num) && num > 0) cost[k] = num
      }
    } else if (Array.isArray(rawAct.energyCost)) {
      for (const item of rawAct.energyCost) {
        if (typeof item === 'string' && item.trim()) {
          const k = item.trim()
          cost[k] = (cost[k] || 0) + 1
        }
      }
    }

    // Preconditions: string[]
    const preconditions: string[] = []
    if (Array.isArray(rawAct.preconditions)) {
      for (const p of rawAct.preconditions) {
        if (typeof p === 'string' && p.trim()) {
          preconditions.push(p.trim())
        } else if (p && typeof p === 'object') {
          const typeStr = String(p.type || p.condition || '').trim()
          if (typeStr === 'HAND_MIN_OTHER_CARDS' && p.minCount != null) {
            preconditions.push(`HAND_MIN_OTHER_CARDS_${p.minCount}`)
          } else if (typeStr) {
            preconditions.push(typeStr)
          }
        }
      }
    }

    // Costs conversion (e.g. DISCARD_FROM_HAND 2 -> effect + precondition)
    const extraEffects: AtomicEffect[] = []
    if (Array.isArray(rawAct.costs)) {
      for (const c of rawAct.costs) {
        if (c && c.type === 'DISCARD_FROM_HAND') {
          const count = Number(c.count) || 1
          const preKey = `HAND_MIN_OTHER_CARDS_${count}`
          if (!preconditions.includes(preKey)) {
            preconditions.push(preKey)
          }
          extraEffects.push({
            primitive: 'DISCARD_CARDS',
            target: 'PLAYER',
            count,
            zone: 'HAND',
            upTo: false,
            optional: false,
          })
        }
      }
    }

    // Effects: AtomicEffect[]
    const rawEffects = Array.isArray(rawAct.effects) ? rawAct.effects : []
    const mappedEffects: AtomicEffect[] = rawEffects.map((rawEff: any) => {
      const primitive = coerceEffectPrimitive(rawEff.primitive || rawEff.type)
      const target = rawEff.target != null ? String(rawEff.target) : rawEff.targetZone ? String(rawEff.targetZone) : null
      const zone = rawEff.zone != null ? String(rawEff.zone) : rawEff.sourceZone ? String(rawEff.sourceZone) : null

      let val: number | null = null
      if (rawEff.value != null) val = Number(rawEff.value)
      else if (rawEff.baseDamage != null) val = Number(rawEff.baseDamage)
      else if (rawEff.damage != null) val = Number(rawEff.damage)

      let count: number | null = null
      if (rawEff.count != null) count = Number(rawEff.count)

      let filter: string | null = null
      if (typeof rawEff.filter === 'string') {
        filter = rawEff.filter
      } else if (rawEff.targetFilter) {
        filter = targetFilterToDsl(rawEff.targetFilter)
      }

      return {
        primitive,
        target,
        value: val != null && !isNaN(val) ? val : null,
        count: count != null && !isNaN(count) ? count : null,
        zone,
        filter,
        upTo: Boolean(rawEff.upTo ?? false),
        optional: Boolean(rawEff.optional ?? false),
        baseDamage: val,
      }
    })

    const effects = [...extraEffects, ...mappedEffects]

    // Dead Card Condition
    let deadCardCondition: string | null = null
    if (typeof rawAct.deadCardCondition === 'string') {
      deadCardCondition = rawAct.deadCardCondition.trim() || null
    } else if (Array.isArray(rawAct.deadCardCondition)) {
      deadCardCondition = rawAct.deadCardCondition.join('|')
    }

    return {
      actionId,
      label: String(rawAct.label || rawAct.name || actionId),
      actionType,
      timingPhase,
      canUseTurn1GoingFirst: Boolean(
        rawAct.canUseTurn1GoingFirst ?? (actionType !== 'ATTACK' && actionType !== 'EVOLVE'),
      ),
      canUseTurn1GoingSecond: Boolean(rawAct.canUseTurn1GoingSecond ?? actionType !== 'EVOLVE'),
      cost,
      preconditions,
      effects,
      deadCardCondition,
      canAttackTwice: Boolean(rawAct.canAttackTwice),
      sourceType: actionType,
      timing: timingPhase,
    }
  })

  // 4. Strategic Evaluator
  const rawStrat = raw.strategicEvaluator || {}
  const aiRole = coerceAIRole(rawStrat.aiRole || rawStrat.primaryRole || rawStrat.role)

  const rawWeights = rawStrat.turnPhaseWeights || {}
  const clampWeight = (val: any, def = 0.8): number => {
    const num = Number(val)
    if (isNaN(num)) return def
    return Math.max(0.0, Math.min(1.0, num))
  }

  const turnPhaseWeights = {
    turn1: clampWeight(rawWeights.turn1 ?? rawWeights.T1 ?? rawWeights.turn_1, 0.8),
    turn2: clampWeight(rawWeights.turn2 ?? rawWeights.T2 ?? rawWeights.turn_2, 0.8),
    turn3: clampWeight(rawWeights.turn3 ?? rawWeights.T3 ?? rawWeights.turn_3, 0.8),
    turn4Plus: clampWeight(rawWeights.turn4Plus ?? rawWeights.T4 ?? rawWeights.turn4_plus, 0.8),
  }

  const decklistSynergyRequirements: string[] = []
  if (Array.isArray(rawStrat.decklistSynergyRequirements)) {
    for (const syn of rawStrat.decklistSynergyRequirements) {
      if (typeof syn === 'string' && syn.trim()) {
        decklistSynergyRequirements.push(syn.trim())
      } else if (syn && typeof syn === 'object') {
        const rf = syn.requiredFilter || {}
        if (rf.energyType) decklistSynergyRequirements.push(`requires_energy_type:${rf.energyType}`)
        else if (rf.specificCardName) decklistSynergyRequirements.push(`requires_evolution_line:${rf.specificCardName}`)
        else if (rf.subCategory) decklistSynergyRequirements.push(`requires_subcategory:${rf.subCategory}`)
        else if (rf.category) decklistSynergyRequirements.push(`requires_category:${rf.category}`)
      }
    }
  }

  const strategicEvaluator: StrategicEvaluator = {
    aiRole,
    turnPhaseWeights,
    decklistSynergyRequirements: Array.from(new Set(decklistSynergyRequirements)),
    primaryRole: aiRole,
  }

  return {
    cardId,
    identity,
    pokemonStats,
    category,
    subCategory,
    playableActions,
    strategicEvaluator,
    compilationMetadata: raw.compilationMetadata || null,
  }
}
