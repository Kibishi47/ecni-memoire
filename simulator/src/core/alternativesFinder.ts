/**
 * Moteur de Suggestion d'Alternatives Intelligentes (`src/core/alternativesFinder.ts`).
 *
 * Analyse les primitives d'effet (`EffectPrimitive`), les filtres cibles (`CardFilter`),
 * les rôles stratégiques (`primaryRole`) et les profils d'attaque dans `cards_database.json` pour :
 * 1. Suggérer des remplacements "Supporter -> Objet / Outil / Talent" (Gain d'Économie d'Action).
 * 2. Suggérer des équivalents fonctionnels entre cartes Dresseur / Pokémon de soutien.
 * 3. Comparer côte à côte les Attaquants Alternatifs (PV, Coût en énergie, Dégâts de base/max, Coût de retraite, Double attaque).
 */

import { getAllCatalogModels, normalizeCardNameForMatch } from '../data/cardCatalog'
import type {
  CardFilter,
  EffectPrimitive,
  EngineCardModel,
  PlayableAction,
} from '../types/cardModel'
import { getMainAttackEnergyRequirement } from './engine'

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

export interface SmartAlternativeSuggestion {
  targetCardId: string
  targetCardNameFr: string
  alternativeModel: EngineCardModel
  alternativeCardId: string
  alternativeNameFr: string
  alternativeCategory: string
  alternativeSubCategory: string
  suggestionType:
    | 'SUPPORTER_TO_ITEM_OR_ABILITY'
    | 'FUNCTIONAL_EQUIVALENT'
    | 'ALTERNATIVE_ATTACKER'
  sharedPrimitives: EffectPrimitive[]
  actionEconomyBadge: string
  strategicReason: string
  relevanceScore: number
  attackerComparison?: AttackerComparisonRow
}

const TUTOR_PRIMITIVES = new Set<EffectPrimitive>([
  'SEARCH_DECK',
])

const DRAW_REFRESH_PRIMITIVES = new Set<EffectPrimitive>([
  'DRAW_CARDS',
  'SHUFFLE_HAND_DRAW',
])

const ENERGY_ACCEL_PRIMITIVES = new Set<EffectPrimitive>([
  'ATTACH_ENERGY',
])

const RECOVERY_PRIMITIVES = new Set<EffectPrimitive>([
  'RECOVER_FROM_DISCARD',
])

const GUST_SWITCH_PRIMITIVES = new Set<string>([
  'SWITCH_ACTIVE',
  'SWITCH_ACTIVE_POKEMON',
  'GUST_OPPONENT_BENCH',
])

function arePrimitivesCompatible(p1: EffectPrimitive, p2: EffectPrimitive): boolean {
  if (p1 === p2) return true
  if (TUTOR_PRIMITIVES.has(p1) && TUTOR_PRIMITIVES.has(p2)) return true
  if (DRAW_REFRESH_PRIMITIVES.has(p1) && DRAW_REFRESH_PRIMITIVES.has(p2)) return true
  if (ENERGY_ACCEL_PRIMITIVES.has(p1) && ENERGY_ACCEL_PRIMITIVES.has(p2)) return true
  if (RECOVERY_PRIMITIVES.has(p1) && RECOVERY_PRIMITIVES.has(p2)) return true
  if (GUST_SWITCH_PRIMITIVES.has(p1) && GUST_SWITCH_PRIMITIVES.has(p2)) return true
  return false
}

function areTargetFiltersCompatible(
  f1?: CardFilter | null,
  f2?: CardFilter | null,
): boolean {
  if (!f1 || !f2) return true
  if (f1.category && f2.category && f1.category !== f2.category) {
    return false
  }
  return true
}

function estimateAttackDamageBounds(
  model: EngineCardModel,
  attack: PlayableAction,
): { baseDamage: number; estimatedMaxDamage: number; damageSummary: string } {
  const normName = normalizeCardNameForMatch(model.identity.nameFr)
  const canDouble =
    Boolean(attack.canAttackTwice) ||
    Boolean(model.pokemonStats?.canAttackTwice) ||
    normName.includes('pomdramour') ||
    normName.includes('poissoroy')

  let base = 0
  let max = 0

  for (const eff of attack.effects) {
    const b = eff.baseDamage ?? 0
    base += b
    let localMax = b

    if (eff.damageScalingPerOpponentPrizeTaken) {
      localMax = b + eff.damageScalingPerOpponentPrizeTaken * 5
    } else if (eff.damageScalingType) {
      const sv = eff.damageScalingValue ?? 30
      switch (eff.damageScalingType) {
        case 'PER_ENERGY_DISCARDED':
        case 'PER_ENERGY_ATTACHED_ALL':
        case 'PER_ENERGY_ATTACHED_SELF':
          localMax = Math.max(b, b + sv * 5)
          break
        case 'PER_BENCHED_POKEMON':
          localMax = b + sv * 5
          break
        case 'PER_OPPONENT_PRIZE_TAKEN':
          localMax = b + sv * 5
          break
        case 'IF_TARGET_IS_EX_OR_EVOLUTION':
          localMax = b + sv
          break
        default:
          localMax = b + sv * 3
          break
      }
    } else if (attack.actionId === 'attack_bellowing_thunder' || (b === 70 && normName.includes('ire foudre'))) {
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
 * Extrait la ligne de comparaison côte à côte d'un Pokémon (PV, Coût en énergie, Dégâts base/max, Retraite, Double attaque).
 */
export function extractAttackerComparisonRow(
  model: EngineCardModel,
): AttackerComparisonRow | null {
  if (model.category !== 'POKEMON' || !model.pokemonStats) return null

  const attacks = model.playableActions.filter(
    (a) => a.actionType === 'ATTACK' || a.sourceType === 'ATTACK',
  )
  const mainAttack = attacks[attacks.length - 1] ?? attacks[0] ?? null
  const reqEnergy = getMainAttackEnergyRequirement(model)
  const energyLabels: string[] = []
  if (mainAttack?.cost && typeof mainAttack.cost === 'object' && !Array.isArray(mainAttack.cost)) {
    for (const [k, v] of Object.entries(mainAttack.cost)) {
      for (let i = 0; i < (Number(v) || 0); i++) energyLabels.push(k)
    }
  } else if (mainAttack?.energyCost && mainAttack.energyCost.length > 0) {
    energyLabels.push(...mainAttack.energyCost)
  }
  if (energyLabels.length === 0) {
    for (let i = 0; i < reqEnergy; i++) energyLabels.push('Incolore')
  }

  const dmgBounds = mainAttack
    ? estimateAttackDamageBounds(model, mainAttack)
    : { baseDamage: 0, estimatedMaxDamage: 0, damageSummary: '0' }

  const normName = normalizeCardNameForMatch(model.identity.nameFr)
  const canAttackTwice =
    Boolean(model.pokemonStats.canAttackTwice) ||
    model.playableActions.some((a) => Boolean(a.canAttackTwice)) ||
    normName.includes('pomdramour') ||
    normName.includes('poissoroy')

  return {
    cardId: model.cardId,
    nameFr: model.identity.nameFr,
    subCategory: model.subCategory,
    hp: model.pokemonStats.hp,
    types: model.pokemonStats.types,
    energyCostCount: energyLabels.length,
    energyCostLabels: energyLabels,
    baseDamage: dmgBounds.baseDamage,
    estimatedMaxDamage: dmgBounds.estimatedMaxDamage,
    damageSummary: dmgBounds.damageSummary,
    retreatCost: model.pokemonStats.retreatCost,
    prizeCardsGiven: model.identity.prizeCardsGiven ?? model.pokemonStats.prizeCardsGiven ?? 1,
    canAttackTwice,
    primaryRole: (model.strategicEvaluator.aiRole || model.strategicEvaluator.primaryRole) as any,
    mainAttackLabel: mainAttack?.label ?? 'Soutien / Talent',
  }
}

/**
 * Compare deux Pokémon côte à côte pour l'Atelier d'Optimisation A/B.
 */
export function compareAttackersSideBySide(
  cardA: EngineCardModel,
  cardB: EngineCardModel,
): { attackerA: AttackerComparisonRow; attackerB: AttackerComparisonRow } | null {
  const rowA = extractAttackerComparisonRow(cardA)
  const rowB = extractAttackerComparisonRow(cardB)
  if (!rowA || !rowB) return null
  return { attackerA: rowA, attackerB: rowB }
}

/**
 * Trouve les alternatives intelligentes dans `cards_database.json` pour une carte donnée :
 * - Conversion Supporter -> Objet / Outil / Talent (Économie d'Action)
 * - Équivalents fonctionnels (Tutorat, Gust, Pioche)
 * - Attaquants alternatifs avec statistiques comparées côte à côte
 */
export function findAlternativesForCard(
  targetModel: EngineCardModel,
  catalogModels?: EngineCardModel[],
): SmartAlternativeSuggestion[] {
  if (targetModel.category === 'ENERGY' && targetModel.subCategory === 'BASIC_ENERGY') {
    return []
  }

  const allModels = (catalogModels ?? getAllCatalogModels()).filter(
    (m) => !(m.category === 'ENERGY' && m.subCategory === 'BASIC_ENERGY'),
  )

  // Un attaquant principal (MAIN_ATTACKER) est le coeur du deck et ne doit jamais etre remplace
  if (targetModel.category === 'POKEMON') {
    const role = targetModel.strategicEvaluator.aiRole || targetModel.strategicEvaluator.primaryRole
    if (role === 'MAIN_ATTACKER') {
      return []
    }
    // De meme, la lignee de base / sous-evolution d'un attaquant principal ne doit pas etre remplacee
    const chain = targetModel.pokemonStats?.evolutionChain || []
    if (chain.length > 1 && (targetModel.subCategory === 'BASIC' || targetModel.subCategory === 'STAGE_1')) {
      const isCoreLine = allModels.some(
        (m) =>
          m.category === 'POKEMON' &&
          (m.strategicEvaluator.aiRole === 'MAIN_ATTACKER' || m.strategicEvaluator.primaryRole === 'MAIN_ATTACKER') &&
          m.pokemonStats?.evolutionChain?.some((c) => chain.includes(c)),
      )
      if (isCoreLine) {
        return []
      }
    }
  }

  const suggestions: SmartAlternativeSuggestion[] = []
  const targetPrimitives = new Map<EffectPrimitive, CardFilter | null | undefined>()

  for (const act of targetModel.playableActions) {
    for (const eff of act.effects) {
      if (!targetPrimitives.has(eff.primitive)) {
        targetPrimitives.set(eff.primitive, eff.targetFilter)
      }
    }
  }

  for (const candidate of allModels) {
    if (candidate.cardId === targetModel.cardId) continue

    // Ne pas proposer l'attaquant principal d'un autre deck pour remplacer un slot utilitaire ou tech
    if (candidate.category === 'POKEMON') {
      const candRole = candidate.strategicEvaluator.aiRole || candidate.strategicEvaluator.primaryRole
      if (candRole === 'MAIN_ATTACKER') {
        continue
      }
    }

    // Cas 1 : La carte cible est un SUPPORTER -> Priorité absolue aux alternatives OBJET / OUTIL / TALENT POKÉMON
    if (targetModel.subCategory === 'SUPPORTER') {
      const isEconomyCandidate =
        candidate.subCategory === 'ITEM' ||
        candidate.subCategory === 'TOOL' ||
        (candidate.category === 'POKEMON' &&
          candidate.playableActions.some(
            (a) => a.actionType === 'USE_ABILITY' || (a.sourceType && a.sourceType.startsWith('ABILITY')),
          ))

      if (!isEconomyCandidate && candidate.subCategory !== 'SUPPORTER') continue

      const sharedPrimitives: EffectPrimitive[] = []
      for (const cAct of candidate.playableActions) {
        if (
          candidate.category === 'POKEMON' &&
          cAct.actionType !== 'USE_ABILITY' &&
          (!cAct.sourceType || !cAct.sourceType.startsWith('ABILITY'))
        ) {
          continue
        }
        for (const cEff of cAct.effects) {
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

      if (sharedPrimitives.length > 0) {
        const isActionEconomyUpgrade = isEconomyCandidate
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
          suggestionType: isActionEconomyUpgrade
            ? 'SUPPORTER_TO_ITEM_OR_ABILITY'
            : 'FUNCTIONAL_EQUIVALENT',
          sharedPrimitives,
          actionEconomyBadge: isActionEconomyUpgrade
            ? `Gain d'Économie d'Action (Supporter -> ${targetTypeLabel})`
            : 'Supporter Alternatif',
          strategicReason: isActionEconomyUpgrade
            ? "Gain d'Économie d'Action : Passer cet effet de Supporter vers Objet/Talent libère votre Supporter du tour (ex: pour jouer Ordres du Boss)."
            : `Alternative de Supporter partageant la mécanique ${sharedPrimitives.join(', ')}.`,
          relevanceScore:
            (isActionEconomyUpgrade ? 120 : 65) +
            sharedPrimitives.length * 15 +
            (candidate.strategicEvaluator.intrinsicBaseScore ?? 80) * 0.2,
          attackerComparison: extractAttackerComparisonRow(candidate) ?? undefined,
        })
      }
      continue
    }

    // Cas 2 : La carte cible est un Dresseur (ITEM / TOOL / STADIUM) -> Chercher les équivalents Objet / Talent
    if (targetModel.category === 'TRAINER') {
      const sharedPrimitives: EffectPrimitive[] = []
      for (const cAct of candidate.playableActions) {
        if (
          candidate.category === 'POKEMON' &&
          cAct.actionType !== 'USE_ABILITY' &&
          (!cAct.sourceType || !cAct.sourceType.startsWith('ABILITY'))
        ) {
          continue
        }
        for (const cEff of cAct.effects) {
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

      if (sharedPrimitives.length > 0 && candidate.subCategory !== 'SUPPORTER') {
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
            (candidate.strategicEvaluator.intrinsicBaseScore ?? 80) * 0.2,
          attackerComparison: extractAttackerComparisonRow(candidate) ?? undefined,
        })
      }
      continue
    }

    // Cas 3 : La carte cible est un POKÉMON -> Comparateur d'Attaquants ou de Moteurs de Soutien
    if (targetModel.category === 'POKEMON' && candidate.category === 'POKEMON') {
      const targetRow = extractAttackerComparisonRow(targetModel)
      const candRow = extractAttackerComparisonRow(candidate)
      if (!targetRow || !candRow) continue

      const sameRole =
        (targetModel.strategicEvaluator.aiRole || targetModel.strategicEvaluator.primaryRole) ===
        (candidate.strategicEvaluator.aiRole || candidate.strategicEvaluator.primaryRole)
      const bothAttackers =
        targetModel.playableActions.some(
          (a) => a.actionType === 'ATTACK' || a.sourceType === 'ATTACK',
        ) &&
        candidate.playableActions.some(
          (a) => a.actionType === 'ATTACK' || a.sourceType === 'ATTACK',
        )
        candidate.playableActions.some((a) => a.sourceType === 'ATTACK')
      const bothDoubleAttackers = targetRow.canAttackTwice && candRow.canAttackTwice

      const sharedPrimitives: EffectPrimitive[] = []
      for (const cAct of candidate.playableActions) {
        for (const cEff of cAct.effects) {
          for (const [tPrim] of targetPrimitives.entries()) {
            if (arePrimitivesCompatible(tPrim, cEff.primitive)) {
              if (!sharedPrimitives.includes(cEff.primitive)) {
                sharedPrimitives.push(cEff.primitive)
              }
            }
          }
        }
      }

      if (sameRole || bothAttackers || bothDoubleAttackers || sharedPrimitives.length > 0) {
        let score = 70 + (candidate.strategicEvaluator.intrinsicBaseScore ?? 70) * 0.25
        if (sameRole) score += 35
        if (bothDoubleAttackers) score += 45
        if (targetRow.subCategory === candRow.subCategory) score += 15

        const diffHp = candRow.hp - targetRow.hp
        const diffHpLabel = diffHp > 0 ? `+${diffHp} PV` : diffHp < 0 ? `${diffHp} PV` : 'PV identiques'

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
  return suggestions
}

/**
 * Calcule le dictionnaire complet des suggestions d'alternatives pour toutes les cartes uniques d'un deck.
 */
export function findSmartDeckAlternatives(
  deckModels: EngineCardModel[],
  catalogModels?: EngineCardModel[],
): Record<string, SmartAlternativeSuggestion[]> {
  const result: Record<string, SmartAlternativeSuggestion[]> = {}
  const seenCardIds = new Set<string>()

  for (const model of deckModels) {
    if (seenCardIds.has(model.cardId)) continue
    seenCardIds.add(model.cardId)
    result[model.cardId] = findAlternativesForCard(model, catalogModels)
  }

  return result
}
