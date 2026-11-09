/**
 * Helper d'inspection du modèle IA d'une carte pour le mode debug.
 * Nettoie les données transcrites par l'IA (supprime les clés null / undefined / vides)
 * et formate les actions, préconditions, coûts et effets pour une lisibilité optimale.
 */

import type { AtomicEffect, EngineCardModel, PlayableAction } from '../types/cardModel'
import type { ParsedDeckEntry } from '../types/deck'
import type { Language } from './i18n'

/**
 * Supprime récursivement les clés null, undefined, chaînes vides, tableaux vides et objets vides.
 */
export function stripNullAndEmpty(value: any): any {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'object') {
    if (typeof value === 'string' && value.trim() === '') return undefined
    return value
  }

  if (Array.isArray(value)) {
    const cleanedArr = value
      .map(stripNullAndEmpty)
      .filter((v) => v !== undefined && v !== null)
    return cleanedArr.length > 0 ? cleanedArr : undefined
  }

  const result: Record<string, any> = {}
  for (const [key, val] of Object.entries(value)) {
    if (val === null || val === undefined) continue
    if (typeof val === 'string' && val.trim() === '') continue
    const cleaned = stripNullAndEmpty(val)
    if (cleaned !== undefined) {
      result[key] = cleaned
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Traduit le rôle stratégique assigné par l'IA en libellé compréhensible.
 */
export function getHumanReadableAiRole(role: string | null | undefined, lang: Language = 'fr'): string {
  if (!role) return ''
  const mapFr: Record<string, string> = {
    MAIN_ATTACKER: 'Attaquant Principal',
    SECONDARY_ATTACKER: 'Attaquant Secondaire',
    DRAW_ENGINE: 'Moteur de Pioche',
    ENERGY_ACCELERATOR: 'Accélérateur d Énergie',
    DISRUPTION: 'Perturbation & Contrôle',
    GUEST_TECH: 'Tech Situationnelle',
    CONSISTENCY_BOOSTER: 'Stabilisateur de Consistance',
  }

  const mapEn: Record<string, string> = {
    MAIN_ATTACKER: 'Main Attacker',
    SECONDARY_ATTACKER: 'Secondary Attacker',
    DRAW_ENGINE: 'Draw Engine',
    ENERGY_ACCELERATOR: 'Energy Accelerator',
    DISRUPTION: 'Disruption & Control',
    GUEST_TECH: 'Guest Tech',
    CONSISTENCY_BOOSTER: 'Consistency Booster',
  }

  const normalized = role.toUpperCase()
  return (lang === 'en' ? mapEn[normalized] : mapFr[normalized]) || role
}

/**
 * Traduit le type d'action.
 */
export function getHumanReadableActionType(actionType: string | null | undefined, lang: Language = 'fr'): string {
  if (!actionType) return ''
  const mapFr: Record<string, string> = {
    ATTACK: 'Attaque',
    USE_ABILITY: 'Talent',
    PLAY_FROM_HAND: 'Jouer / Poser',
    EVOLVE: 'Évolution',
    RETREAT: 'Retraite',
    ATTACH_ENERGY: 'Attacher Énergie',
  }

  const mapEn: Record<string, string> = {
    ATTACK: 'Attack',
    USE_ABILITY: 'Ability',
    PLAY_FROM_HAND: 'Play / Bench',
    EVOLVE: 'Evolution',
    RETREAT: 'Retreat',
    ATTACH_ENERGY: 'Attach Energy',
  }

  const normalized = actionType.toUpperCase()
  return (lang === 'en' ? mapEn[normalized] : mapFr[normalized]) || actionType
}

/**
 * Traduit la phase de timing du moteur.
 */
export function getHumanReadableTimingPhase(phase: string | null | undefined, lang: Language = 'fr'): string {
  if (!phase) return ''
  const mapFr: Record<string, string> = {
    MAIN_PHASE_1: 'Phase Principale 1',
    MAIN_PHASE_2: 'Phase Principale 2',
    ATTACK_PHASE: 'Phase d Attaque',
    PREPARATION: 'Préparation',
  }

  const mapEn: Record<string, string> = {
    MAIN_PHASE_1: 'Main Phase 1',
    MAIN_PHASE_2: 'Main Phase 2',
    ATTACK_PHASE: 'Attack Phase',
    PREPARATION: 'Preparation',
  }

  const normalized = phase.toUpperCase()
  return (lang === 'en' ? mapEn[normalized] : mapFr[normalized]) || phase
}

/**
 * Traduit une précondition de l'engine en explication claire pour un joueur.
 */
export function getHumanReadablePrecondition(precond: string, lang: Language = 'fr'): string {
  if (!precond) return ''

  if (precond === 'SELF_IS_ACTIVE') {
    return lang === 'en' ? 'Must be the Active Pokémon' : 'Doit être le Pokémon Actif'
  }
  if (precond === 'SELF_IS_ON_BENCH') {
    return lang === 'en' ? 'Must be on the Bench' : 'Doit être sur le Banc'
  }
  if (precond === 'BENCH_HAS_EMPTY_SLOT' || precond === 'BENCH_HAS_EMPTY_SLOTS') {
    return lang === 'en' ? 'Bench must have an empty slot' : 'Le banc doit avoir une place libre'
  }
  if (precond === 'OPPONENT_HAS_BENCHED_POKEMON') {
    return lang === 'en' ? 'Opponent must have a benched Pokémon' : 'L adversaire doit avoir au moins un Pokémon sur son banc'
  }
  if (precond === 'BENCH_HAS_POKEMON') {
    return lang === 'en' ? 'Must have at least 1 benched Pokémon' : 'Au moins un Pokémon doit être sur votre banc'
  }
  if (precond === 'TARGET_IN_PLAY_SINCE_PREVIOUS_TURN') {
    return lang === 'en'
      ? 'Target Pokémon must be in play since previous turn'
      : 'La cible doit être en jeu depuis le tour précédent (évolution standard)'
  }
  if (precond.startsWith('IN_PLAY:')) {
    const target = precond.replace('IN_PLAY:', '')
    return lang === 'en' ? `Evolves from ${target} in play` : `Évolue depuis ${target} en jeu`
  }
  if (precond.startsWith('ATTACHED_ENERGY_COUNT:')) {
    const parts = precond.split(':')
    const count = parts[1] || '1'
    const energyType = parts[2] ? ` ${parts[2]}` : ''
    return lang === 'en'
      ? `Requires ${count}${energyType} Energy attached`
      : `Requiert ${count} Énergie(s)${energyType} attachée(s)`
  }
  if (precond === 'KO_SUFFERED_LAST_TURN') {
    return lang === 'en'
      ? 'An ally Pokémon was Knocked Out last turn'
      : 'Un de vos Pokémon a été mis K.O. au tour précédent'
  }
  if (precond === 'PLAYER_BEHIND_ON_PRIZES') {
    return lang === 'en'
      ? 'Player is behind on Prize cards'
      : 'Avoir plus de cartes Récompenses restantes que l adversaire'
  }
  if (precond.startsWith('HAND_MIN_OTHER_CARDS:')) {
    const count = precond.split(':')[1] || '1'
    return lang === 'en' ? `At least ${count} other card(s) in hand` : `Au moins ${count} autre(s) carte(s) en main`
  }
  if (precond === 'OPPONENT_ACTIVE_HAS_SPECIAL_CONDITION') {
    return lang === 'en'
      ? 'Opponent Active Pokémon must have a special condition'
      : 'Le Pokémon Actif adverse doit avoir un État Spécial'
  }
  if (precond === 'STADIUM_IN_PLAY') {
    return lang === 'en' ? 'A Stadium must be in play' : 'Un Stade doit être en jeu'
  }
  if (precond === 'SECOND_PLAYER_TURN_1') {
    return lang === 'en' ? 'Second player on Turn 1' : 'Joueur 2 au Tour 1'
  }

  // Formatage par défaut d'une chaîne SNAKE_CASE
  return precond
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
}

/**
 * Traduit le nom d'un effet primitif du moteur.
 */
export function getHumanReadablePrimitive(primitive: string, lang: Language = 'fr'): string {
  if (!primitive) return ''
  const mapFr: Record<string, string> = {
    DAMAGE_ACTIVE: 'Dégâts au Pokémon Actif',
    DAMAGE_BENCH: 'Dégâts au Banc',
    ATTACH_ENERGY: 'Attachement d Énergie',
    SEARCH_DECK: 'Recherche dans le Deck',
    DRAW_CARDS: 'Pioche de Cartes',
    DISCARD_CARDS: 'Défausse de Cartes',
    HEAL: 'Soin de PV',
    SWITCH_ACTIVE: 'Échange du Pokémon Actif',
    APPLY_SPECIAL_CONDITION: 'Application d un État Spécial',
    EVOLVE_POKEMON: 'Évolution de Pokémon',
    SHUFFLE_HAND_DRAW: 'Mélanger la main et repiocher',
    RECOVER_FROM_DISCARD: 'Récupération depuis la Défausse',
  }

  const mapEn: Record<string, string> = {
    DAMAGE_ACTIVE: 'Damage Active Pokémon',
    DAMAGE_BENCH: 'Damage Bench',
    ATTACH_ENERGY: 'Attach Energy',
    SEARCH_DECK: 'Search Deck',
    DRAW_CARDS: 'Draw Cards',
    DISCARD_CARDS: 'Discard Cards',
    HEAL: 'Heal HP',
    SWITCH_ACTIVE: 'Switch Active Pokémon',
    APPLY_SPECIAL_CONDITION: 'Apply Special Condition',
    EVOLVE_POKEMON: 'Evolve Pokémon',
    SHUFFLE_HAND_DRAW: 'Shuffle Hand & Draw',
    RECOVER_FROM_DISCARD: 'Recover from Discard',
  }

  const normalized = primitive.toUpperCase()
  return (lang === 'en' ? mapEn[normalized] : mapFr[normalized]) || primitive
}

/**
 * Formate les détails atomiques d'un effet en un ensemble de clés/valeurs lisibles sans nulls.
 */
export function getHumanReadableEffectDetails(
  effect: AtomicEffect,
  lang: Language = 'fr',
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = []

  const dmg = effect.baseDamage ?? effect.value
  if (dmg !== null && dmg !== undefined && dmg > 0) {
    if (effect.primitive === 'HEAL') {
      details.push({
        label: lang === 'en' ? 'Healed HP' : 'PV Soignés',
        value: `${dmg} PV`,
      })
    } else if (effect.primitive === 'DAMAGE_ACTIVE' || effect.primitive === 'DAMAGE_BENCH') {
      details.push({
        label: lang === 'en' ? 'Base Damage' : 'Dégâts de base',
        value: `${dmg}`,
      })
    } else {
      details.push({
        label: lang === 'en' ? 'Value' : 'Valeur',
        value: `${dmg}`,
      })
    }
  }

  if (effect.count !== null && effect.count !== undefined && effect.count > 0) {
    details.push({
      label: lang === 'en' ? 'Card Count' : 'Nombre de cartes',
      value: `${effect.count}`,
    })
  }

  if (effect.target) {
    const targetMapFr: Record<string, string> = {
      OPPONENT_ACTIVE: 'Pokémon Actif Adverse',
      OPPONENT_BENCH: 'Banc Adverse',
      OPPONENT: 'Adversaire',
      SELF: 'Soi-même (Ce Pokémon)',
      PLAYER_BENCH: 'Banc du Joueur',
      PLAYER_ACTIVE: 'Votre Pokémon Actif',
    }
    const targetMapEn: Record<string, string> = {
      OPPONENT_ACTIVE: 'Opponent Active Pokémon',
      OPPONENT_BENCH: 'Opponent Bench',
      OPPONENT: 'Opponent',
      SELF: 'Self (This Pokémon)',
      PLAYER_BENCH: 'Player Bench',
      PLAYER_ACTIVE: 'Player Active Pokémon',
    }
    const targetLabel = (lang === 'en' ? targetMapEn[effect.target] : targetMapFr[effect.target]) || effect.target
    details.push({
      label: lang === 'en' ? 'Target' : 'Cible',
      value: targetLabel,
    })
  }

  if (effect.zone) {
    details.push({
      label: 'Zone',
      value: effect.zone,
    })
  }

  if (effect.filter) {
    details.push({
      label: lang === 'en' ? 'Filter' : 'Filtre de recherche',
      value: String(effect.filter),
    })
  }

  if (effect.specialCondition) {
    details.push({
      label: lang === 'en' ? 'Condition' : 'État infligé',
      value: effect.specialCondition,
    })
  }

  if (effect.damageScalingType) {
    details.push({
      label: lang === 'en' ? 'Damage Scaling' : 'Augmentation de dégâts',
      value: `${effect.damageScalingType} (+${effect.damageScalingValue ?? 0})`,
    })
  }

  if (effect.optional) {
    details.push({
      label: 'Option',
      value: lang === 'en' ? 'Optional' : 'Optionnel',
    })
  }

  if (effect.upTo) {
    details.push({
      label: 'Limite',
      value: lang === 'en' ? 'Up to' : 'Jusqu à',
    })
  }

  return details
}

/**
 * Extrait UNIQUEMENT les informations transcrites par l'IA (rôle, actions, coûts, conditions, effets)
 * et les retourne sous forme d'objet épuré (sans aucune clé null/vide).
 */
export function extractCleanAiTranscriptions(
  card: ParsedDeckEntry | EngineCardModel | null | undefined,
): Record<string, any> | null {
  if (!card) return null

  const model: EngineCardModel | null =
    'model' in card && card.model ? card.model : ('playableActions' in card ? (card as EngineCardModel) : null)

  if (!model) return null

  const cleanedRawActions = (model.playableActions || []).map((action: PlayableAction) => {
    const rawAction: Record<string, any> = {
      label: action.label,
      actionType: action.actionType,
      timingPhase: action.timingPhase,
      canUseTurn1GoingFirst: action.canUseTurn1GoingFirst,
      canUseTurn1GoingSecond: action.canUseTurn1GoingSecond,
    }

    if (action.cost && Object.keys(action.cost).length > 0) {
      rawAction.cost = action.cost
    }

    if (action.preconditions && action.preconditions.length > 0) {
      rawAction.preconditions = action.preconditions
    }

    if (action.effects && action.effects.length > 0) {
      rawAction.effects = action.effects.map((e) => stripNullAndEmpty(e))
    }

    if (action.deadCardCondition) {
      rawAction.deadCardCondition = action.deadCardCondition
    }

    return stripNullAndEmpty(rawAction)
  })

  const rawStructure: Record<string, any> = {
    cardId: model.cardId,
    nameFr: model.identity.nameFr,
    nameEn: model.identity.nameEn,
    aiRole: model.strategicEvaluator?.aiRole,
    decklistSynergyRequirements:
      model.strategicEvaluator?.decklistSynergyRequirements?.length > 0
        ? model.strategicEvaluator.decklistSynergyRequirements
        : undefined,
    turnPhaseWeights: model.strategicEvaluator?.turnPhaseWeights,
    playableActions: cleanedRawActions,
  }

  return stripNullAndEmpty(rawStructure) || null
}
