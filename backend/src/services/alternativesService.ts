import type { Pool } from 'pg'
import { normalizeCardNameForMatch } from './cardResolutionService.js'

export interface EngineCardFilter {
  category?: string | null
  subCategory?: string | null
  [key: string]: unknown
}

export interface EngineAtomicEffect {
  primitive: string
  target?: string | null
  value?: number | null
  count?: number | null
  baseDamage?: number | null
  targetFilter?: EngineCardFilter | null
  coinFlipMode?: string | null
  coinCount?: number | null
  scalingOperator?: 'ADD' | 'MULTIPLY' | string | null
  scalingMetric?: string | null
  bonusValue?: number | null
  damageScalingPerOpponentPrizeTaken?: number | null
  damageScalingType?: string | null
  damageScalingValue?: number | null
  [key: string]: unknown
}

export interface EngineActionCostObject {
  type?: string
  minCount?: number
  [key: string]: unknown
}

export interface EnginePlayableAction {
  actionId: string
  label: string
  actionType: string
  sourceType?: string
  cost?: Record<string, number>
  costs?: EngineActionCostObject[]
  energyCost?: string[]
  canAttackTwice?: boolean
  effects: EngineAtomicEffect[]
  [key: string]: unknown
}

export interface EngineCardIdentity {
  cardId: string
  nameFr: string
  nameEn?: string | null
  setId: string
  category: string
  subCategory: string
  prizeCardsGiven?: number
  isAceSpec?: boolean
  [key: string]: unknown
}

export interface EnginePokemonStats {
  hp: number
  types: string[]
  stage?: string
  evolutionChain?: string[]
  retreatCost: number
  prizeCardsGiven?: number
  canAttackTwice?: boolean
  [key: string]: unknown
}

export interface EngineStrategicEvaluator {
  aiRole?: string
  primaryRole?: string
  intrinsicBaseScore?: number | null
  [key: string]: unknown
}

export interface EngineCardModel {
  cardId: string
  identity: EngineCardIdentity
  pokemonStats: EnginePokemonStats | null
  category: string
  subCategory: string
  playableActions: EnginePlayableAction[]
  strategicEvaluator: EngineStrategicEvaluator
  [key: string]: unknown
}

export interface AttackerComparisonRow {
  cardId: string
  nameFr: string
  subCategory: string
  hp: number
  types: string[]
  energyCostCount: number
  energyCostLabels: string[]
  baseDamage: number
  estimatedMaxDamage: number
  damageSummary: string
  retreatCost: number
  prizeCardsGiven: number
  canAttackTwice: boolean
  primaryRole: string
  mainAttackLabel: string
}

export type SuggestionType =
  | 'SUPPORTER_TO_ITEM_OR_ABILITY'
  | 'FUNCTIONAL_EQUIVALENT'
  | 'ALTERNATIVE_ATTACKER'

export interface SmartAlternativeSuggestion {
  targetCardId: string
  targetCardNameFr: string
  alternativeModel: EngineCardModel
  alternativeCardId: string
  alternativeNameFr: string
  alternativeCategory: string
  alternativeSubCategory: string
  suggestionType: SuggestionType
  sharedPrimitives: string[]
  actionEconomyBadge: string
  strategicReason: string
  relevanceScore: number
  attackerComparison?: AttackerComparisonRow
}

const TUTOR_PRIMITIVES = new Set(['SEARCH_DECK', 'PUT_ON_TOP_OR_BOTTOM_OF_DECK'])
const DRAW_REFRESH_PRIMITIVES = new Set(['DRAW_CARDS', 'SHUFFLE_HAND_DRAW'])
const ENERGY_ACCEL_PRIMITIVES = new Set(['ATTACH_ENERGY', 'MOVE_ENERGY'])
const RECOVERY_PRIMITIVES = new Set(['RECOVER_FROM_DISCARD'])
const GUST_SWITCH_PRIMITIVES = new Set([
  'SWITCH_ACTIVE',
  'SWITCH_ACTIVE_POKEMON',
  'GUST_OPPONENT_BENCH',
])
const BENCH_PRESSURE_PRIMITIVES = new Set([
  'DAMAGE_BENCH',
  'PLACE_DAMAGE_COUNTERS',
  'MOVE_DAMAGE_COUNTERS',
])
const CONTROL_LOCK_PRIMITIVES = new Set([
  'LOCK_ITEMS',
  'LOCK_ABILITIES',
  'LOCK_RETREAT',
  'LOCK_NEXT_TURN_ATTACK',
  'APPLY_SPECIAL_CONDITION',
  'MILL_DECK',
])
const DEFENSE_PRIMITIVES = new Set([
  'MODIFY_DAMAGE_TAKEN',
  'MODIFY_HP',
  'PREVENT_DAMAGE_OR_EFFECTS',
  'HEAL',
])

const ABILITY_ACTION_TYPES = new Set([
  'USE_ABILITY',
  'TRIGGERED_ABILITY',
  'PASSIVE_ABILITY',
])

const ROLE_INTRINSIC_SCORES: Record<string, number> = {
  MAIN_ATTACKER: 95,
  CONSISTENCY_BOOSTER: 90,
  ENERGY_ACCELERATOR: 88,
  DRAW_ENGINE: 88,
  SECONDARY_ATTACKER: 82,
  DISRUPTION: 80,
}

function isAbilityAction(action: EnginePlayableAction): boolean {
  return (
    ABILITY_ACTION_TYPES.has(action.actionType) ||
    Boolean(action.sourceType && action.sourceType.startsWith('ABILITY'))
  )
}

function isAttackAction(action: EnginePlayableAction): boolean {
  return action.actionType === 'ATTACK' || action.sourceType === 'ATTACK'
}

function getCardRole(model: EngineCardModel): string {
  return model.strategicEvaluator?.aiRole || model.strategicEvaluator?.primaryRole || ''
}

function arePrimitivesCompatible(p1: string, p2: string): boolean {
  if (p1 === p2) return true
  if (TUTOR_PRIMITIVES.has(p1) && TUTOR_PRIMITIVES.has(p2)) return true
  if (DRAW_REFRESH_PRIMITIVES.has(p1) && DRAW_REFRESH_PRIMITIVES.has(p2)) return true
  if (ENERGY_ACCEL_PRIMITIVES.has(p1) && ENERGY_ACCEL_PRIMITIVES.has(p2)) return true
  if (RECOVERY_PRIMITIVES.has(p1) && RECOVERY_PRIMITIVES.has(p2)) return true
  if (GUST_SWITCH_PRIMITIVES.has(p1) && GUST_SWITCH_PRIMITIVES.has(p2)) return true
  if (BENCH_PRESSURE_PRIMITIVES.has(p1) && BENCH_PRESSURE_PRIMITIVES.has(p2)) return true
  if (CONTROL_LOCK_PRIMITIVES.has(p1) && CONTROL_LOCK_PRIMITIVES.has(p2)) return true
  if (DEFENSE_PRIMITIVES.has(p1) && DEFENSE_PRIMITIVES.has(p2)) return true
  return false
}

function areTargetFiltersCompatible(
  f1?: EngineCardFilter | null,
  f2?: EngineCardFilter | null,
): boolean {
  if (!f1 || !f2) return true
  if (f1.category && f2.category && f1.category !== f2.category) {
    return false
  }
  return true
}

/**
 * Computes the main attack's total energy requirement (aligned with `engine.ts`).
 */
export function getMainAttackEnergyRequirement(card: EngineCardModel): number {
  let req = 1
  for (const act of card.playableActions || []) {
    if (!isAttackAction(act)) continue

    if (act.cost && typeof act.cost === 'object' && !Array.isArray(act.cost)) {
      const sum = Object.values(act.cost).reduce((acc, v) => acc + (Number(v) || 0), 0)
      if (sum > req) req = sum
      continue
    }

    if (act.energyCost && act.energyCost.length > 0) {
      if (act.energyCost.length > req) req = act.energyCost.length
    } else if (act.costs) {
      for (const c of act.costs) {
        if (c.type === 'SELF_HAS_ENERGY_COST' && c.minCount && c.minCount > req) {
          req = c.minCount
        }
      }
    }
  }
  return req
}

/**
 * Computes intrinsic card value (aligned with `evaluator.ts`).
 */
export function computeCardIntrinsicValue(card: EngineCardModel): number {
  if (card.strategicEvaluator?.intrinsicBaseScore != null) {
    return card.strategicEvaluator.intrinsicBaseScore
  }

  let score = ROLE_INTRINSIC_SCORES[getCardRole(card)] ?? 68

  if (card.identity?.isAceSpec) {
    score += 18
  }

  let maxDmg = 0
  let utilityBonus = 0

  for (const action of card.playableActions || []) {
    for (const effect of action.effects || []) {
      if (effect.primitive === 'DAMAGE_ACTIVE') {
        const dmg = effect.value ?? effect.baseDamage ?? 0
        if (dmg > maxDmg) maxDmg = dmg
      } else if (effect.primitive === 'SEARCH_DECK') {
        utilityBonus = Math.max(utilityBonus, 10)
      } else if (effect.primitive === 'DRAW_CARDS') {
        utilityBonus = Math.max(utilityBonus, 8)
      } else if (effect.primitive === 'ATTACH_ENERGY') {
        utilityBonus = Math.max(utilityBonus, 10)
      } else if (effect.primitive === 'PLACE_DAMAGE_COUNTERS') {
        utilityBonus = Math.max(utilityBonus, 10)
      } else if (
        effect.primitive === 'SWITCH_ACTIVE' &&
        (effect.target === 'OPPONENT_BENCH_SINGLE' ||
          effect.target === 'OPPONENT_ACTIVE' ||
          effect.targetZone === 'OPPONENT_BENCH')
      ) {
        utilityBonus = Math.max(utilityBonus, 12)
      } else if (
        effect.primitive === 'LOCK_ITEMS' ||
        effect.primitive === 'LOCK_ABILITIES'
      ) {
        utilityBonus = Math.max(utilityBonus, 10)
      } else if (
        effect.primitive === 'PREVENT_DAMAGE_OR_EFFECTS' ||
        effect.primitive === 'EXPAND_BENCH'
      ) {
        utilityBonus = Math.max(utilityBonus, 8)
      }
    }
  }

  if (maxDmg >= 200) score += 12
  else if (maxDmg >= 120) score += 6

  return score + utilityBonus
}

function estimateAttackDamageBounds(
  model: EngineCardModel,
  attack: EnginePlayableAction,
): { baseDamage: number; estimatedMaxDamage: number; damageSummary: string } {
  const normName = normalizeCardNameForMatch(model.identity?.nameFr || '')
  const canDouble =
    Boolean(attack.canAttackTwice) ||
    Boolean(model.pokemonStats?.canAttackTwice) ||
    normName.includes('pomdramour') ||
    normName.includes('poissoroy')

  let base = 0
  let max = 0

  for (const eff of attack.effects || []) {
    if (eff.target === 'SELF') continue
    if (
      eff.primitive !== 'DAMAGE_ACTIVE' &&
      eff.primitive !== 'DAMAGE_BENCH' &&
      eff.primitive !== 'PLACE_DAMAGE_COUNTERS'
    ) {
      continue
    }

    const rawVal =
      eff.value ??
      eff.baseDamage ??
      (eff.primitive === 'PLACE_DAMAGE_COUNTERS' && eff.count ? eff.count * 10 : 0)
    if (rawVal < 0) continue

    const b = eff.scalingOperator === 'MULTIPLY' ? 0 : rawVal
    base += b
    let localMax = rawVal

    if (eff.damageScalingPerOpponentPrizeTaken) {
      localMax = rawVal + eff.damageScalingPerOpponentPrizeTaken * 5
    } else if (eff.damageScalingType) {
      const sv = eff.damageScalingValue ?? 30
      switch (eff.damageScalingType) {
        case 'PER_ENERGY_DISCARDED':
        case 'PER_ENERGY_ATTACHED_ALL':
        case 'PER_ENERGY_ATTACHED_SELF':
          localMax = Math.max(rawVal, rawVal + sv * 5)
          break
        case 'PER_BENCHED_POKEMON':
        case 'PER_OPPONENT_PRIZE_TAKEN':
          localMax = rawVal + sv * 5
          break
        case 'IF_TARGET_IS_EX_OR_EVOLUTION':
          localMax = rawVal + sv
          break
        default:
          localMax = rawVal + sv * 3
          break
      }
    } else if (eff.coinFlipMode || eff.scalingMetric) {
      const bv = eff.bonusValue ?? rawVal
      if (eff.coinFlipMode === 'MULTI_COIN_PER_HEADS') {
        const coins = eff.coinCount ?? 2
        localMax = eff.scalingOperator === 'MULTIPLY' ? coins * bv : rawVal + coins * bv
      } else if (eff.coinFlipMode === 'UNTIL_TAILS_PER_HEADS') {
        localMax = eff.scalingOperator === 'MULTIPLY' ? 3 * bv : rawVal + 3 * bv
      } else if (eff.coinFlipMode === 'SINGLE_HEADS_BONUS') {
        localMax = rawVal + bv
      } else if (eff.scalingMetric === 'CONDITIONAL_FLAT_BONUS') {
        localMax = rawVal + bv
      } else if (eff.scalingOperator === 'MULTIPLY') {
        localMax = bv * 5
      } else if (eff.scalingMetric) {
        localMax = rawVal + bv * 4
      }
    } else if (
      attack.actionId === 'attack_bellowing_thunder' ||
      (rawVal === 70 && normName.includes('ire foudre'))
    ) {
      localMax = 350
    }

    max += localMax
  }

  if (canDouble) {
    max = max * 2
  }

  let damageSummary = `${base}`
  if (canDouble && base > 0) {
    damageSummary = `${base} ×2 (${max} max)`
  } else if (max > base) {
    damageSummary = `${base} → ${max}`
  } else if (base === 0) {
    damageSummary = 'Effet tactique (0)'
  }

  return {
    baseDamage: base,
    estimatedMaxDamage: Math.max(base, max),
    damageSummary,
  }
}

/**
 * Extracts side-by-side attacker comparison stats for a Pokemon model.
 */
export function extractAttackerComparisonRow(
  model: EngineCardModel,
): AttackerComparisonRow | null {
  if (model.category !== 'POKEMON' || !model.pokemonStats) return null

  const attacks = (model.playableActions || []).filter(isAttackAction)
  const mainAttack = attacks[attacks.length - 1] ?? attacks[0] ?? null
  const reqEnergy = getMainAttackEnergyRequirement(model)
  const energyLabels: string[] = []

  if (
    mainAttack?.cost &&
    typeof mainAttack.cost === 'object' &&
    !Array.isArray(mainAttack.cost)
  ) {
    for (const [k, v] of Object.entries(mainAttack.cost)) {
      for (let i = 0; i < (Number(v) || 0); i++) {
        energyLabels.push(k)
      }
    }
  } else if (mainAttack?.energyCost && mainAttack.energyCost.length > 0) {
    energyLabels.push(...mainAttack.energyCost)
  }

  if (energyLabels.length === 0) {
    for (let i = 0; i < reqEnergy; i++) {
      energyLabels.push('Incolore')
    }
  }

  const dmgBounds = mainAttack
    ? estimateAttackDamageBounds(model, mainAttack)
    : { baseDamage: 0, estimatedMaxDamage: 0, damageSummary: '0' }

  const normName = normalizeCardNameForMatch(model.identity?.nameFr || '')
  const canAttackTwice =
    Boolean(model.pokemonStats.canAttackTwice) ||
    (model.playableActions || []).some((a) => Boolean(a.canAttackTwice)) ||
    normName.includes('pomdramour') ||
    normName.includes('poissoroy')

  return {
    cardId: model.cardId,
    nameFr: model.identity.nameFr,
    subCategory: model.subCategory,
    hp: model.pokemonStats.hp,
    types: model.pokemonStats.types || [],
    energyCostCount: energyLabels.length,
    energyCostLabels: energyLabels,
    baseDamage: dmgBounds.baseDamage,
    estimatedMaxDamage: dmgBounds.estimatedMaxDamage,
    damageSummary: dmgBounds.damageSummary,
    retreatCost: model.pokemonStats.retreatCost ?? 0,
    prizeCardsGiven:
      model.identity?.prizeCardsGiven ?? model.pokemonStats.prizeCardsGiven ?? 1,
    canAttackTwice,
    primaryRole: getCardRole(model),
    mainAttackLabel: mainAttack?.label ?? 'Soutien / Talent',
  }
}

function collectCompatiblePrimitives(
  candidate: EngineCardModel,
  targetPrimitives: Map<string, EngineCardFilter | null | undefined>,
  pokemonAbilityOnly: boolean,
): string[] {
  const sharedPrimitives: string[] = []

  for (const cAct of candidate.playableActions || []) {
    if (pokemonAbilityOnly && candidate.category === 'POKEMON' && !isAbilityAction(cAct)) {
      continue
    }

    for (const cEff of cAct.effects || []) {
      for (const [tPrim, tFilter] of targetPrimitives.entries()) {
        if (
          arePrimitivesCompatible(tPrim, cEff.primitive) &&
          areTargetFiltersCompatible(tFilter, cEff.targetFilter)
        ) {
          if (!sharedPrimitives.includes(cEff.primitive)) {
            sharedPrimitives.push(cEff.primitive)
          }
        }
      }
    }
  }

  return sharedPrimitives
}

export interface FindAlternativesOptions {
  excludeCardIds?: ReadonlySet<string>
  limitPerCard?: number
}

/**
 * Computes smart alternative suggestions for a single target card against a catalog.
 * Strictly aligned with `simulator/src/core/alternativesFinder.ts`.
 */
export function findAlternativesForCard(
  targetModel: EngineCardModel,
  catalogModels: EngineCardModel[],
  options: FindAlternativesOptions = {},
): SmartAlternativeSuggestion[] {
  if (targetModel.category === 'ENERGY' && targetModel.subCategory === 'BASIC_ENERGY') {
    return []
  }

  const allModels = catalogModels.filter(
    (m) => !(m.category === 'ENERGY' && m.subCategory === 'BASIC_ENERGY'),
  )

  if (targetModel.category === 'POKEMON') {
    if (getCardRole(targetModel) === 'MAIN_ATTACKER') {
      return []
    }

    const chain = targetModel.pokemonStats?.evolutionChain || []
    if (
      chain.length > 1 &&
      (targetModel.subCategory === 'BASIC' || targetModel.subCategory === 'STAGE_1')
    ) {
      const isCoreLine = allModels.some(
        (m) =>
          m.category === 'POKEMON' &&
          getCardRole(m) === 'MAIN_ATTACKER' &&
          m.pokemonStats?.evolutionChain?.some((c) => chain.includes(c)),
      )
      if (isCoreLine) {
        return []
      }
    }
  }

  const targetPrimitives = new Map<string, EngineCardFilter | null | undefined>()
  for (const act of targetModel.playableActions || []) {
    for (const eff of act.effects || []) {
      if (!targetPrimitives.has(eff.primitive)) {
        targetPrimitives.set(eff.primitive, eff.targetFilter)
      }
    }
  }

  const excludeSet = options.excludeCardIds
  const suggestions: SmartAlternativeSuggestion[] = []

  for (const candidate of allModels) {
    if (candidate.cardId === targetModel.cardId) continue
    if (excludeSet?.has(candidate.cardId)) continue

    if (candidate.category === 'POKEMON' && getCardRole(candidate) === 'MAIN_ATTACKER') {
      continue
    }

    // Case 1: Target is a SUPPORTER -> Prioritize Item / Tool / Pokemon Ability
    if (targetModel.subCategory === 'SUPPORTER') {
      const isEconomyCandidate =
        candidate.subCategory === 'ITEM' ||
        candidate.subCategory === 'TOOL' ||
        (candidate.category === 'POKEMON' &&
          (candidate.playableActions || []).some(isAbilityAction))

      if (!isEconomyCandidate && candidate.subCategory !== 'SUPPORTER') continue

      const sharedPrimitives = collectCompatiblePrimitives(candidate, targetPrimitives, true)
      if (sharedPrimitives.length > 0) {
        const targetTypeLabel =
          candidate.category === 'POKEMON'
            ? 'Talent Pokémon'
            : candidate.subCategory === 'TOOL'
              ? 'Outil'
              : 'Objet'

        suggestions.push({
          targetCardId: targetModel.cardId,
          targetCardNameFr: targetModel.identity.nameFr,
          alternativeModel: candidate,
          alternativeCardId: candidate.cardId,
          alternativeNameFr: candidate.identity.nameFr,
          alternativeCategory: candidate.category,
          alternativeSubCategory: candidate.subCategory,
          suggestionType: isEconomyCandidate
            ? 'SUPPORTER_TO_ITEM_OR_ABILITY'
            : 'FUNCTIONAL_EQUIVALENT',
          sharedPrimitives,
          actionEconomyBadge: isEconomyCandidate
            ? `Gain d'Économie d'Action (Supporter -> ${targetTypeLabel})`
            : 'Supporter Alternatif',
          strategicReason: isEconomyCandidate
            ? "Gain d'Économie d'Action : Passer cet effet de Supporter vers Objet/Talent libère votre Supporter du tour (ex: pour jouer Ordres du Boss)."
            : `Alternative de Supporter partageant la mécanique ${sharedPrimitives.join(', ')}.`,
          relevanceScore:
            (isEconomyCandidate ? 120 : 65) +
            sharedPrimitives.length * 15 +
            computeCardIntrinsicValue(candidate) * 0.2,
          attackerComparison: extractAttackerComparisonRow(candidate) ?? undefined,
        })
      }
      continue
    }

    // Case 2: Target is a non-Supporter TRAINER -> Item / Tool / Stadium / Pokemon Ability
    if (targetModel.category === 'TRAINER') {
      if (candidate.subCategory === 'SUPPORTER') continue

      const sharedPrimitives = collectCompatiblePrimitives(candidate, targetPrimitives, true)
      if (sharedPrimitives.length > 0) {
        suggestions.push({
          targetCardId: targetModel.cardId,
          targetCardNameFr: targetModel.identity.nameFr,
          alternativeModel: candidate,
          alternativeCardId: candidate.cardId,
          alternativeNameFr: candidate.identity.nameFr,
          alternativeCategory: candidate.category,
          alternativeSubCategory: candidate.subCategory,
          suggestionType: 'FUNCTIONAL_EQUIVALENT',
          sharedPrimitives,
          actionEconomyBadge:
            candidate.category === 'POKEMON' ? 'Alternative Talent Pokémon' : 'Alternative Objet',
          strategicReason: `Partage la fonction tactique (${sharedPrimitives.join(', ')}) sans consommer le Supporter du tour.`,
          relevanceScore:
            85 +
            sharedPrimitives.length * 15 +
            computeCardIntrinsicValue(candidate) * 0.2,
          attackerComparison: extractAttackerComparisonRow(candidate) ?? undefined,
        })
      }
      continue
    }

    // Case 3: Target is a POKEMON -> Attacker / Support Engine comparison
    if (targetModel.category === 'POKEMON' && candidate.category === 'POKEMON') {
      const targetRow = extractAttackerComparisonRow(targetModel)
      const candRow = extractAttackerComparisonRow(candidate)
      if (!targetRow || !candRow) continue

      const sameRole = getCardRole(targetModel) === getCardRole(candidate)
      const bothAttackers =
        (targetModel.playableActions || []).some(isAttackAction) &&
        (candidate.playableActions || []).some(isAttackAction)
      const bothDoubleAttackers = targetRow.canAttackTwice && candRow.canAttackTwice
      const sharedPrimitives = collectCompatiblePrimitives(candidate, targetPrimitives, false)

      if (sameRole || bothAttackers || bothDoubleAttackers || sharedPrimitives.length > 0) {
        let score = 70 + computeCardIntrinsicValue(candidate) * 0.25
        if (sameRole) score += 35
        if (bothDoubleAttackers) score += 45
        if (targetRow.subCategory === candRow.subCategory) score += 15

        const diffHp = candRow.hp - targetRow.hp
        const diffHpLabel =
          diffHp > 0 ? `+${diffHp} PV` : diffHp < 0 ? `${diffHp} PV` : 'PV identiques'

        suggestions.push({
          targetCardId: targetModel.cardId,
          targetCardNameFr: targetModel.identity.nameFr,
          alternativeModel: candidate,
          alternativeCardId: candidate.cardId,
          alternativeNameFr: candidate.identity.nameFr,
          alternativeCategory: candidate.category,
          alternativeSubCategory: candidate.subCategory,
          suggestionType: 'ALTERNATIVE_ATTACKER',
          sharedPrimitives,
          actionEconomyBadge: sameRole
            ? `Même rôle (${candRow.primaryRole})`
            : 'Profil Pokémon Alternatif',
          strategicReason: `${candRow.nameFr} (${candRow.hp} PV, ${diffHpLabel}) — Coût : ${candRow.energyCostCount} Énergie(s), Dégâts : ${candRow.damageSummary}, Retraite : ${candRow.retreatCost}.`,
          relevanceScore: score,
          attackerComparison: candRow,
        })
      }
    }
  }

  suggestions.sort((a, b) => b.relevanceScore - a.relevanceScore)

  if (options.limitPerCard !== undefined) {
    return suggestions.slice(0, options.limitPerCard)
  }

  return suggestions
}

export interface CardCatalogSnapshot {
  models: EngineCardModel[]
  byCardId: Map<string, EngineCardModel>
  loadedAtMs: number
}

export interface CardCatalogCacheOptions {
  pool: Pool
  ttlMs?: number
  now?: () => number
}

const DEFAULT_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000

/**
 * In-memory catalog cache backed by PostgreSQL (`SELECT card_id, data FROM cards`).
 * Deduplicates concurrent refreshes and supports manual invalidation.
 */
export class CardCatalogCache {
  private readonly pool: Pool
  private readonly ttlMs: number
  private readonly now: () => number
  private snapshot: CardCatalogSnapshot | null = null
  private inFlightLoad: Promise<CardCatalogSnapshot> | null = null

  constructor(options: CardCatalogCacheOptions) {
    this.pool = options.pool
    this.ttlMs = options.ttlMs ?? DEFAULT_CATALOG_CACHE_TTL_MS
    this.now = options.now ?? (() => Date.now())
  }

  invalidate(): void {
    this.snapshot = null
  }

  async getSnapshot(): Promise<CardCatalogSnapshot> {
    if (this.snapshot && this.now() - this.snapshot.loadedAtMs < this.ttlMs) {
      return this.snapshot
    }

    if (!this.inFlightLoad) {
      this.inFlightLoad = this.loadFromDatabase().finally(() => {
        this.inFlightLoad = null
      })
    }

    return this.inFlightLoad
  }

  private async loadFromDatabase(): Promise<CardCatalogSnapshot> {
    const result = await this.pool.query<{ card_id: string; data: EngineCardModel }>(
      'SELECT card_id, data FROM cards',
    )

    const models: EngineCardModel[] = []
    const byCardId = new Map<string, EngineCardModel>()

    for (const row of result.rows) {
      const model = row.data
      if (!model) continue
      const effectiveId = model.cardId || row.card_id
      models.push(model)
      byCardId.set(effectiveId, model)
      if (row.card_id !== effectiveId) {
        byCardId.set(row.card_id, model)
      }
    }

    const snapshot: CardCatalogSnapshot = {
      models,
      byCardId,
      loadedAtMs: this.now(),
    }
    this.snapshot = snapshot
    return snapshot
  }
}

export interface AlternativesBatchRequest {
  cardIds: string[]
  excludeCardIds?: string[]
  limitPerCard?: number
}

/**
 * Service calculating smart alternative suggestions using an in-memory catalog cache.
 */
export class AlternativesService {
  private readonly catalogCache: CardCatalogCache

  constructor(catalogCache: CardCatalogCache) {
    this.catalogCache = catalogCache
  }

  async findAlternativesForCards(
    request: AlternativesBatchRequest,
  ): Promise<Record<string, SmartAlternativeSuggestion[]>> {
    const snapshot = await this.catalogCache.getSnapshot()
    const excludeSet =
      request.excludeCardIds && request.excludeCardIds.length > 0
        ? new Set(request.excludeCardIds)
        : undefined
    const limitPerCard = request.limitPerCard ?? 10

    const results: Record<string, SmartAlternativeSuggestion[]> = {}
    const uniqueTargetIds = Array.from(new Set(request.cardIds))

    for (const cardId of uniqueTargetIds) {
      const targetModel = snapshot.byCardId.get(cardId)
      if (!targetModel) {
        results[cardId] = []
        continue
      }

      results[cardId] = findAlternativesForCard(targetModel, snapshot.models, {
        excludeCardIds: excludeSet,
        limitPerCard,
      })
    }

    return results
  }
}
