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
    TRIGGERED_ABILITY: 'Talent Déclenché',
    PASSIVE_ABILITY: 'Talent Passif',
    PLAY_FROM_HAND: 'Jouer / Poser',
    EVOLVE: 'Évolution',
    RETREAT: 'Retraite',
    ATTACH_ENERGY: 'Attacher Énergie',
  }

  const mapEn: Record<string, string> = {
    ATTACK: 'Attack',
    USE_ABILITY: 'Ability',
    TRIGGERED_ABILITY: 'Triggered Ability',
    PASSIVE_ABILITY: 'Passive Ability',
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
  const pUpper = precond.toUpperCase()

  if (pUpper === 'SELF_IS_ACTIVE') {
    return lang === 'en' ? 'Must be the Active Pokémon' : 'Doit être le Pokémon Actif'
  }
  if (pUpper === 'SELF_IS_ON_BENCH' || pUpper === 'SELF_ON_BENCH') {
    return lang === 'en' ? 'Must be on the Bench' : 'Doit être sur le Banc'
  }
  if (pUpper === 'SELF_IN_PLAY') {
    return lang === 'en' ? 'Must be in play' : 'Doit être en jeu'
  }
  if (pUpper === 'SELF_IS_IN_HAND') {
    return lang === 'en' ? 'Must be in hand' : 'Doit être en main'
  }
  if (pUpper === 'BENCH_HAS_EMPTY_SLOT' || pUpper === 'BENCH_HAS_EMPTY_SLOTS') {
    return lang === 'en' ? 'Bench must have an empty slot' : 'Le banc doit avoir une place libre'
  }
  if (pUpper === 'OPPONENT_HAS_BENCHED_POKEMON' || pUpper === 'OPPONENT_HAS_BENCH_POKEMON' || pUpper === 'OPPONENT_BENCH_NOT_EMPTY') {
    return lang === 'en' ? 'Opponent must have a benched Pokémon' : "L'adversaire doit avoir au moins un Pokémon sur son banc"
  }
  if (pUpper === 'BENCH_HAS_POKEMON') {
    return lang === 'en' ? 'Must have at least 1 benched Pokémon' : 'Au moins un Pokémon doit être sur votre banc'
  }
  if (pUpper === 'HAND_IS_EMPTY' || pUpper === 'HAND_MAX_OTHER_CARDS_ZERO') {
    return lang === 'en' ? 'Must be the only card in hand' : 'Doit être la seule carte en main'
  }
  if (pUpper === 'HAND_NOT_EMPTY') {
    return lang === 'en' ? 'Hand must not be empty' : 'La main ne doit pas être vide'
  }
  if (pUpper === 'NOT_FIRST_TURN') {
    return lang === 'en' ? 'Cannot be used on first turn' : 'Ne peut pas être utilisé au Tour 1'
  }
  if (pUpper === 'NO_ATTACHED_ENERGY' || pUpper === 'SELF_NO_ATTACHED_ENERGY') {
    return lang === 'en' ? 'Must have no attached Energy' : 'Aucune Énergie attachée'
  }
  if (pUpper === 'TARGET_IN_PLAY_SINCE_PREVIOUS_TURN') {
    return lang === 'en'
      ? 'Target Pokémon must be in play since previous turn'
      : 'La cible doit être en jeu depuis le tour précédent (évolution standard)'
  }
  if (pUpper.startsWith('IN_PLAY:')) {
    const target = precond.slice('IN_PLAY:'.length)
    return lang === 'en' ? `Evolves from ${target} in play` : `Évolue depuis ${target} en jeu`
  }
  if (pUpper.startsWith('ATTACHED_ENERGY_COUNT:')) {
    const parts = precond.split(':')
    const count = parts[1] || '1'
    const energyType = parts[2] ? ` ${parts[2]}` : ''
    return lang === 'en'
      ? `Requires ${count}${energyType} Energy attached`
      : `Requiert ${count} Énergie(s)${energyType} attachée(s)`
  }
  if (pUpper === 'KO_SUFFERED_LAST_TURN' || pUpper === 'OPPONENT_CAUSED_KO_LAST_TURN') {
    return lang === 'en'
      ? 'An ally Pokémon was Knocked Out last turn'
      : 'Un de vos Pokémon a été mis K.O. au tour précédent'
  }
  if (pUpper === 'PLAYER_BEHIND_ON_PRIZES' || pUpper === 'OPPONENT_HAS_FEWER_PRIZES') {
    return lang === 'en'
      ? 'Player is behind on Prize cards'
      : "Avoir plus de cartes Récompenses restantes que l'adversaire"
  }
  if (pUpper.startsWith('OPPONENT_PRIZES_LTE')) {
    const n = precond.split(':')[1] || precond.split('_').pop() || '2'
    return lang === 'en' ? `Opponent has ≤ ${n} Prize card(s)` : `Adversaire à ≤ ${n} Récompense(s)`
  }
  if (pUpper.startsWith('OPPONENT_PRIZES_EQUAL')) {
    const n = precond.split(':')[1] || '6'
    return lang === 'en' ? `Opponent has exactly ${n} Prize card(s)` : `Adversaire à exactement ${n} Récompense(s)`
  }
  if (pUpper.startsWith('HAND_MIN_OTHER_CARDS')) {
    const m = pUpper.match(/HAND_MIN_OTHER_CARDS[:_](\d+)/)
    const count = m ? m[1] : '1'
    return lang === 'en' ? `At least ${count} other card(s) in hand` : `Au moins ${count} autre(s) carte(s) en main`
  }
  if (pUpper === 'OPPONENT_ACTIVE_HAS_SPECIAL_CONDITION') {
    return lang === 'en'
      ? 'Opponent Active Pokémon must have a special condition'
      : 'Le Pokémon Actif adverse doit avoir un État Spécial'
  }
  if (pUpper === 'OPPONENT_ACTIVE_HAS_DAMAGE') {
    return lang === 'en' ? 'Opponent Active must already have damage' : 'Le Pokémon Actif adverse doit déjà avoir des dégâts'
  }
  if (pUpper === 'OPPONENT_ACTIVE_IS_EX_OR_V' || pUpper === 'OPPONENT_ACTIVE_IS_RULE_BOX') {
    return lang === 'en' ? 'Opponent Active must be Pokémon ex/V' : 'Le Pokémon Actif adverse doit être Pokémon-ex / V'
  }
  if (pUpper === 'OPPONENT_ACTIVE_IS_BURNED') {
    return lang === 'en' ? 'Opponent Active must be Burned' : 'Le Pokémon Actif adverse doit être Brûlé'
  }
  if (pUpper === 'OPPONENT_ACTIVE_IS_POISONED') {
    return lang === 'en' ? 'Opponent Active must be Poisoned' : 'Le Pokémon Actif adverse doit être Empoisonné'
  }
  if (pUpper === 'STADIUM_IN_PLAY') {
    return lang === 'en' ? 'A Stadium must be in play' : 'Un Stade doit être en jeu'
  }
  if (pUpper === 'SECOND_PLAYER_TURN_1') {
    return lang === 'en' ? 'Second player on Turn 1' : 'Joueur 2 au Tour 1'
  }

  // Formatage par défaut d'une chaîne SNAKE_CASE
  return precond
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
}

/**
 * Traduit le nom d'un effet primitif du moteur (29 primitives v2).
 */
export function getHumanReadablePrimitive(primitive: string, lang: Language = 'fr'): string {
  if (!primitive) return ''
  const mapFr: Record<string, string> = {
    DAMAGE_ACTIVE: 'Dégâts au Pokémon Actif',
    DAMAGE_BENCH: 'Dégâts au Banc',
    PLACE_DAMAGE_COUNTERS: 'Placement de Marqueurs de Dégâts',
    MOVE_DAMAGE_COUNTERS: 'Déplacement de Marqueurs de Dégâts',
    ATTACH_ENERGY: "Attachement d'Énergie",
    MOVE_ENERGY: "Déplacement d'Énergie",
    SEARCH_DECK: 'Recherche dans le Deck',
    DRAW_CARDS: 'Pioche de Cartes',
    DISCARD_CARDS: 'Défausse de Cartes',
    HEAL: 'Soin de PV',
    SWITCH_ACTIVE: 'Échange du Pokémon Actif',
    APPLY_SPECIAL_CONDITION: "Application d'un État Spécial",
    EVOLVE_POKEMON: 'Évolution de Pokémon',
    SHUFFLE_HAND_DRAW: 'Mélanger la main et repiocher',
    RECOVER_FROM_DISCARD: 'Récupération depuis la Défausse',
    MODIFY_DAMAGE_TAKEN: 'Modificateur de Dégâts Subis',
    MODIFY_DAMAGE_DEALT: 'Modificateur de Dégâts Infligés',
    MODIFY_HP: 'Modification des PV Max',
    MODIFY_RETREAT_COST: 'Modification du Coût de Retraite',
    PREVENT_DAMAGE_OR_EFFECTS: 'Prévention de Dégâts ou Effets',
    LOCK_NEXT_TURN_ATTACK: "Blocage d'Attaque au Prochain Tour",
    LOCK_RETREAT: 'Blocage de Retraite',
    LOCK_ABILITIES: 'Blocage des Talents',
    LOCK_ITEMS: 'Blocage des Objets (Item-Lock)',
    EXPAND_BENCH: 'Extension du Banc',
    KNOCK_OUT: 'Mise K.O. Directe',
    MILL_DECK: 'Meule du Deck',
    TAKE_EXTRA_PRIZE: 'Carte Récompense Supplémentaire',
    PUT_ON_TOP_OR_BOTTOM_OF_DECK: 'Placer Dessus / Dessous du Deck',
  }

  const mapEn: Record<string, string> = {
    DAMAGE_ACTIVE: 'Damage Active Pokémon',
    DAMAGE_BENCH: 'Damage Bench',
    PLACE_DAMAGE_COUNTERS: 'Place Damage Counters',
    MOVE_DAMAGE_COUNTERS: 'Move Damage Counters',
    ATTACH_ENERGY: 'Attach Energy',
    MOVE_ENERGY: 'Move Energy',
    SEARCH_DECK: 'Search Deck',
    DRAW_CARDS: 'Draw Cards',
    DISCARD_CARDS: 'Discard Cards',
    HEAL: 'Heal HP',
    SWITCH_ACTIVE: 'Switch Active Pokémon',
    APPLY_SPECIAL_CONDITION: 'Apply Special Condition',
    EVOLVE_POKEMON: 'Evolve Pokémon',
    SHUFFLE_HAND_DRAW: 'Shuffle Hand & Draw',
    RECOVER_FROM_DISCARD: 'Recover from Discard',
    MODIFY_DAMAGE_TAKEN: 'Modify Damage Taken',
    MODIFY_DAMAGE_DEALT: 'Modify Damage Dealt',
    MODIFY_HP: 'Modify Max HP',
    MODIFY_RETREAT_COST: 'Modify Retreat Cost',
    PREVENT_DAMAGE_OR_EFFECTS: 'Prevent Damage or Effects',
    LOCK_NEXT_TURN_ATTACK: 'Lock Next Turn Attack',
    LOCK_RETREAT: 'Lock Retreat',
    LOCK_ABILITIES: 'Lock Abilities',
    LOCK_ITEMS: 'Lock Items (Item-Lock)',
    EXPAND_BENCH: 'Expand Bench Capacity',
    KNOCK_OUT: 'Direct Knock Out',
    MILL_DECK: 'Mill Deck',
    TAKE_EXTRA_PRIZE: 'Take Extra Prize Card',
    PUT_ON_TOP_OR_BOTTOM_OF_DECK: 'Put on Top or Bottom of Deck',
  }

  const normalized = primitive.toUpperCase()
  return (lang === 'en' ? mapEn[normalized] : mapFr[normalized]) || primitive
}

function formatHumanZone(zone: string, lang: Language): string {
  const zFr: Record<string, string> = {
    DECK: 'Deck',
    TOP_OF_DECK: 'Dessus du Deck',
    BOTTOM_OF_DECK: 'Dessous du Deck',
    HAND: 'Main',
    DISCARD: 'Défausse',
    BENCH: 'Banc',
    ACTIVE: 'Poste Actif',
    PRIZES: 'Récompenses',
    LOST_ZONE: 'Zone Perdue',
    ATTACHED_CARDS: 'Cartes Attachées',
  }
  const zEn: Record<string, string> = {
    DECK: 'Deck',
    TOP_OF_DECK: 'Top of Deck',
    BOTTOM_OF_DECK: 'Bottom of Deck',
    HAND: 'Hand',
    DISCARD: 'Discard Pile',
    BENCH: 'Bench',
    ACTIVE: 'Active Spot',
    PRIZES: 'Prize Cards',
    LOST_ZONE: 'Lost Zone',
    ATTACHED_CARDS: 'Attached Cards',
  }
  const up = zone.toUpperCase()
  return (lang === 'en' ? zEn[up] : zFr[up]) || zone
}

function formatScalingMetric(metric: string, lang: Language): string {
  const mFr: Record<string, string> = {
    PER_ENERGY_ON_SELF: 'Par Énergie sur ce Pokémon',
    PER_ENERGY_ON_OPPONENT_ACTIVE: "Par Énergie sur l'Actif adverse",
    PER_ENERGY_ON_BOTH_ACTIVES: 'Par Énergie sur les deux Actifs',
    PER_ENERGY_IN_PLAY: 'Par Énergie en jeu',
    PER_ENERGY_DISCARDED: 'Par Énergie défaussée',
    PER_DAMAGE_COUNTER_ON_SELF: 'Par marqueur de dégâts sur soi',
    PER_DAMAGE_COUNTER_ON_OPPONENT_ACTIVE: "Par marqueur de dégâts sur l'Actif adverse",
    PER_BENCHED_POKEMON_WITH_DAMAGE: 'Par Pokémon blessé sur le Banc',
    PER_OWN_BENCH_POKEMON: 'Par Pokémon sur votre Banc',
    PER_OPPONENT_BENCH_POKEMON: 'Par Pokémon sur le Banc adverse',
    PER_BOTH_BENCH_POKEMON: 'Par Pokémon sur les deux Bancs',
    PER_PRIZE_TAKEN_BY_OPPONENT: "Par Récompense prise par l'adversaire",
    PER_PRIZE_TAKEN_BY_PLAYER: 'Par Récompense prise par vous',
    PER_PRIZE_REMAINING_PLAYER: 'Selon vos Récompenses restantes',
    PER_CARD_IN_OWN_HAND: 'Par carte dans votre main',
    PER_CARD_IN_OPPONENT_HAND: 'Par carte dans la main adverse',
    CONDITIONAL_FLAT_BONUS: 'Bonus conditionnel fixe',
  }
  const mEn: Record<string, string> = {
    PER_ENERGY_ON_SELF: 'Per Energy on this Pokémon',
    PER_ENERGY_ON_OPPONENT_ACTIVE: 'Per Energy on Opponent Active',
    PER_ENERGY_ON_BOTH_ACTIVES: 'Per Energy on both Actives',
    PER_ENERGY_IN_PLAY: 'Per Energy in play',
    PER_ENERGY_DISCARDED: 'Per discarded Energy',
    PER_DAMAGE_COUNTER_ON_SELF: 'Per damage counter on self',
    PER_DAMAGE_COUNTER_ON_OPPONENT_ACTIVE: 'Per damage counter on Opponent Active',
    PER_BENCHED_POKEMON_WITH_DAMAGE: 'Per damaged Benched Pokémon',
    PER_OWN_BENCH_POKEMON: 'Per own Benched Pokémon',
    PER_OPPONENT_BENCH_POKEMON: 'Per Opponent Benched Pokémon',
    PER_BOTH_BENCH_POKEMON: 'Per Benched Pokémon on both sides',
    PER_PRIZE_TAKEN_BY_OPPONENT: 'Per Prize taken by Opponent',
    PER_PRIZE_TAKEN_BY_PLAYER: 'Per Prize taken by Player',
    PER_PRIZE_REMAINING_PLAYER: 'Equal to remaining Prize cards',
    PER_CARD_IN_OWN_HAND: 'Per card in own hand',
    PER_CARD_IN_OPPONENT_HAND: "Per card in Opponent's hand",
    CONDITIONAL_FLAT_BONUS: 'Conditional flat bonus',
  }
  const up = metric.toUpperCase()
  return (lang === 'en' ? mEn[up] : mFr[up]) || metric
}

/**
 * Formate les détails atomiques d'un effet en un ensemble de clés/valeurs lisibles sans nulls.
 */
export function getHumanReadableEffectDetails(
  effect: AtomicEffect,
  lang: Language = 'fr',
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = []

  const dmg = effect.value ?? effect.baseDamage
  if (dmg !== null && dmg !== undefined && (dmg !== 0 || effect.primitive === 'MODIFY_RETREAT_COST')) {
    if (effect.primitive === 'HEAL') {
      details.push({ label: lang === 'en' ? 'Healed HP' : 'PV Soignés', value: `${dmg} PV` })
    } else if (effect.primitive === 'MODIFY_HP') {
      details.push({ label: lang === 'en' ? 'HP Modifier' : 'Bonus PV Max', value: `${dmg > 0 ? `+${dmg}` : dmg} PV` })
    } else if (effect.primitive === 'MODIFY_RETREAT_COST') {
      details.push({
        label: lang === 'en' ? 'Retreat Cost' : 'Coût de Retraite',
        value: dmg === 0 ? (lang === 'en' ? 'Free (0)' : 'Gratuit (0)') : `${dmg > 0 ? `+${dmg}` : dmg}`,
      })
    } else if (effect.primitive === 'EXPAND_BENCH') {
      details.push({ label: lang === 'en' ? 'Bench Slots' : 'Places de Banc', value: `${dmg}` })
    } else if (effect.primitive === 'PLACE_DAMAGE_COUNTERS') {
      details.push({ label: lang === 'en' ? 'Damage Counters Value' : 'Marqueurs de dégâts', value: `${dmg}` })
    } else if (effect.primitive === 'DAMAGE_ACTIVE' || effect.primitive === 'DAMAGE_BENCH') {
      details.push({ label: lang === 'en' ? 'Base Damage' : 'Dégâts de base', value: `${dmg}` })
    } else {
      details.push({ label: lang === 'en' ? 'Value' : 'Valeur', value: `${dmg}` })
    }
  }

  if (effect.count !== null && effect.count !== undefined && effect.count > 0) {
    details.push({
      label: lang === 'en' ? 'Count' : 'Quantité',
      value: `${effect.count}`,
    })
  }

  if (effect.target) {
    const targetMapFr: Record<string, string> = {
      SELF: 'Soi-même (Ce Pokémon)',
      OPPONENT_ACTIVE: 'Pokémon Actif Adverse',
      OPPONENT_BENCH_SINGLE: '1 Pokémon du Banc Adverse',
      OPPONENT_BENCH_ALL: 'Tout le Banc Adverse',
      OPPONENT_POKEMON_ANY: "N'importe quel Pokémon Adverse",
      OPPONENT_ALL_POKEMON: 'Tous les Pokémon Adverses',
      OWN_ACTIVE: 'Votre Pokémon Actif',
      OWN_BENCH_SINGLE: '1 Pokémon de votre Banc',
      OWN_BENCH_ALL: 'Tout votre Banc',
      OWN_POKEMON_ANY: "N'importe lequel de vos Pokémon",
      OWN_ALL_POKEMON: 'Tous vos Pokémon',
      ALL_POKEMON_IN_PLAY: 'Tous les Pokémon en Jeu',
      PLAYER: 'Vous (Joueur)',
      OPPONENT: 'Adversaire',
      OPPONENT_BENCH: 'Banc Adverse',
      PLAYER_BENCH: 'Votre Banc',
      PLAYER_ACTIVE: 'Votre Pokémon Actif',
    }
    const targetMapEn: Record<string, string> = {
      SELF: 'Self (This Pokémon)',
      OPPONENT_ACTIVE: 'Opponent Active Pokémon',
      OPPONENT_BENCH_SINGLE: '1 Opponent Benched Pokémon',
      OPPONENT_BENCH_ALL: 'All Opponent Benched Pokémon',
      OPPONENT_POKEMON_ANY: 'Any Opponent Pokémon',
      OPPONENT_ALL_POKEMON: 'All Opponent Pokémon',
      OWN_ACTIVE: 'Your Active Pokémon',
      OWN_BENCH_SINGLE: '1 of your Benched Pokémon',
      OWN_BENCH_ALL: 'All your Benched Pokémon',
      OWN_POKEMON_ANY: 'Any of your Pokémon',
      OWN_ALL_POKEMON: 'All your Pokémon',
      ALL_POKEMON_IN_PLAY: 'All Pokémon in Play',
      PLAYER: 'Player (You)',
      OPPONENT: 'Opponent',
      OPPONENT_BENCH: 'Opponent Bench',
      PLAYER_BENCH: 'Player Bench',
      PLAYER_ACTIVE: 'Player Active Pokémon',
    }
    const targetLabel = (lang === 'en' ? targetMapEn[effect.target] : targetMapFr[effect.target]) || effect.target
    details.push({
      label: lang === 'en' ? 'Target' : 'Cible',
      value: targetLabel,
    })
  }

  if (effect.sourceZone) {
    details.push({
      label: lang === 'en' ? 'Source Zone' : 'Zone Source',
      value: formatHumanZone(effect.sourceZone, lang),
    })
  }
  if (effect.destinationZone) {
    details.push({
      label: lang === 'en' ? 'Destination Zone' : 'Zone Destination',
      value: formatHumanZone(effect.destinationZone, lang),
    })
  } else if (effect.zone && !effect.sourceZone) {
    details.push({
      label: 'Zone',
      value: formatHumanZone(effect.zone, lang),
    })
  }

  const rawFilter = effect.filter ?? effect.targetFilter
  if (rawFilter) {
    details.push({
      label: lang === 'en' ? 'Filter' : 'Filtre de recherche',
      value: typeof rawFilter === 'string' ? rawFilter : formatHumanCardFilter(rawFilter, lang),
    })
  }

  if (effect.specialCondition) {
    const scFr: Record<string, string> = {
      POISONED: 'Empoisonné',
      BURNED: 'Brûlé',
      ASLEEP: 'Endormi',
      PARALYZED: 'Paralysé',
      CONFUSED: 'Confus',
    }
    const scEn: Record<string, string> = {
      POISONED: 'Poisoned',
      BURNED: 'Burned',
      ASLEEP: 'Asleep',
      PARALYZED: 'Paralyzed',
      CONFUSED: 'Confused',
    }
    const scLabel = (lang === 'en' ? scEn[effect.specialCondition] : scFr[effect.specialCondition]) || effect.specialCondition
    details.push({
      label: lang === 'en' ? 'Condition' : 'État infligé',
      value: scLabel,
    })
  }

  if (effect.coinFlipMode) {
    const cfFr: Record<string, string> = {
      SINGLE_HEADS_REQUIRED: '1 pièce : Face requis',
      SINGLE_HEADS_BONUS: '1 pièce : Bonus si Face',
      MULTI_COIN_PER_HEADS: `${effect.coinCount ?? 'N'} lancers : par Face`,
      UNTIL_TAILS_PER_HEADS: "Lancer jusqu'à Pile",
      TWO_TAILS_SELF_DAMAGE: '2 pièces : Auto-dégâts si 2 Piles',
    }
    const cfEn: Record<string, string> = {
      SINGLE_HEADS_REQUIRED: '1 coin: Heads required',
      SINGLE_HEADS_BONUS: '1 coin: Bonus on Heads',
      MULTI_COIN_PER_HEADS: `${effect.coinCount ?? 'N'} flips: per Heads`,
      UNTIL_TAILS_PER_HEADS: 'Flip until Tails',
      TWO_TAILS_SELF_DAMAGE: '2 coins: Self-damage on 2 Tails',
    }
    details.push({
      label: lang === 'en' ? 'Coin Flip' : 'Lancer de pièce',
      value: (lang === 'en' ? cfEn[effect.coinFlipMode] : cfFr[effect.coinFlipMode]) || effect.coinFlipMode,
    })
  }

  if (effect.scalingMetric) {
    const opSymbol = effect.scalingOperator === 'MULTIPLY' ? '×' : '+'
    const bonusStr = effect.bonusValue != null ? ` (${opSymbol}${effect.bonusValue})` : ''
    details.push({
      label: lang === 'en' ? 'Scaling' : 'Modulateur',
      value: `${formatScalingMetric(effect.scalingMetric, lang)}${bonusStr}`,
    })
  } else if (effect.damageScalingType) {
    details.push({
      label: lang === 'en' ? 'Damage Scaling' : 'Augmentation de dégâts',
      value: `${effect.damageScalingType} (+${effect.damageScalingValue ?? 0})`,
    })
  } else if (effect.bonusValue != null && effect.coinFlipMode) {
    const opSymbol = effect.scalingOperator === 'MULTIPLY' ? '×' : '+'
    details.push({
      label: lang === 'en' ? 'Bonus Value' : 'Valeur bonus',
      value: `${opSymbol}${effect.bonusValue}`,
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

// ============================================================================
// INTERPRÉTEUR PÉDAGOGIQUE POUR UTILISATEUR NON-DÉVELOPPEUR (ONGLET MODÈLE IA)
// ============================================================================

export interface HumanReadableAiPhasePriority {
  key: 'turn1' | 'turn2' | 'turn3' | 'turn4Plus'
  label: string
  pct: number
  tier: 'high' | 'medium' | 'low'
  badge: string
}

export interface HumanReadableAiActionSummary {
  actionId: string
  title: string
  actionTypeLabel: string
  timingLabel: string
  turn1Hints: string[]
  costs: string[]
  preconditions: string[]
  effectSentences: string[]
  deadConditionNote: string | null
}

export interface HumanReadableAiBreakdown {
  roleLabel: string
  roleDescription: string
  traitBadges: string[]
  evolutionChainText: string | null
  retreatText: string | null
  phasePriorities: HumanReadableAiPhasePriority[]
  behaviorInsights: string[]
  synergies: Array<{ text: string; critical: boolean }>
  deadConditions: string[]
  actions: HumanReadableAiActionSummary[]
}

export function formatHumanCardFilter(filter: unknown, lang: Language = 'fr'): string {
  if (!filter) return lang === 'en' ? 'Any card' : "N'importe quelle carte"
  if (typeof filter === 'string') return filter
  if (typeof filter !== 'object') return String(filter)

  const f = filter as Record<string, any>
  const parts: string[] = []

  if (f.specificCardName) {
    parts.push(lang === 'en' ? `Card named "${f.specificCardName}"` : `Carte « ${f.specificCardName} »`)
  } else if (f.subCategory) {
    const subFr: Record<string, string> = {
      BASIC: 'Pokémon de Base',
      STAGE_1: 'Pokémon Niveau 1',
      STAGE_2: 'Pokémon Niveau 2',
      ITEM: 'Objet',
      SUPPORTER: 'Supporter',
      TOOL: 'Outil Pokémon',
      STADIUM: 'Stade',
      BASIC_ENERGY: 'Énergie de Base',
      SPECIAL_ENERGY: 'Énergie Spéciale',
    }
    const subEn: Record<string, string> = {
      BASIC: 'Basic Pokémon',
      STAGE_1: 'Stage 1 Pokémon',
      STAGE_2: 'Stage 2 Pokémon',
      ITEM: 'Item card',
      SUPPORTER: 'Supporter card',
      TOOL: 'Pokémon Tool',
      STADIUM: 'Stadium card',
      BASIC_ENERGY: 'Basic Energy',
      SPECIAL_ENERGY: 'Special Energy',
    }
    const up = String(f.subCategory).toUpperCase()
    parts.push((lang === 'en' ? subEn[up] : subFr[up]) || f.subCategory)
  } else if (f.category) {
    const catFr: Record<string, string> = { POKEMON: 'Pokémon', TRAINER: 'Dresseur', ENERGY: 'Énergie' }
    const catEn: Record<string, string> = { POKEMON: 'Pokémon', TRAINER: 'Trainer', ENERGY: 'Energy' }
    const up = String(f.category).toUpperCase()
    parts.push((lang === 'en' ? catEn[up] : catFr[up]) || f.category)
  }

  if (f.energyType) {
    parts.push(lang === 'en' ? `Type: ${f.energyType}` : `Type ${f.energyType}`)
  }
  if (typeof f.maxHp === 'number') {
    parts.push(lang === 'en' ? `${f.maxHp} HP or less` : `${f.maxHp} PV ou moins`)
  }
  if (typeof f.minHp === 'number') {
    parts.push(lang === 'en' ? `${f.minHp} HP or more` : `${f.minHp} PV ou plus`)
  }
  if (f.isEvolution === true) parts.push(lang === 'en' ? 'Evolution Pokémon' : 'Pokémon Évolutif')
  if (f.isRuleBox === true) parts.push(lang === 'en' ? 'Rule Box (ex/V)' : 'Pokémon à Règle (ex)')
  if (f.isRuleBox === false) parts.push(lang === 'en' ? 'Without Rule Box' : 'Sans encadré Règle')
  if (f.isTera === true) parts.push(lang === 'en' ? 'Tera Pokémon' : 'Téracristal')
  if (f.isAncient === true) parts.push(lang === 'en' ? 'Ancient' : 'Temps Passé')
  if (f.isFuture === true) parts.push(lang === 'en' ? 'Future' : 'Temps Futur')
  if (f.hasAbility === true) parts.push(lang === 'en' ? 'With an Ability' : 'Possédant un Talent')
  if (typeof f.maxRetreatCost === 'number') {
    parts.push(lang === 'en' ? `Retreat ≤ ${f.maxRetreatCost}` : `Retraite ≤ ${f.maxRetreatCost}`)
  }

  if (parts.length > 0) return parts.join(' • ')
  return lang === 'en' ? 'Matching cards' : 'Cartes compatibles'
}

export function formatHumanPreconditionItem(rawPre: unknown, lang: Language = 'fr'): string {
  if (!rawPre) return ''
  if (typeof rawPre === 'string') {
    return getHumanReadablePrecondition(rawPre, lang)
  }
  if (typeof rawPre === 'object') {
    const obj = rawPre as Record<string, any>
    const baseType = String(obj.type || '')
    if (baseType === 'ZONE_HAS_MATCHING_CARD') {
      const zoneStr = obj.zone ? formatHumanZone(obj.zone, lang) : lang === 'en' ? 'Deck' : 'Deck'
      const filterStr = obj.targetFilter ? formatHumanCardFilter(obj.targetFilter, lang) : ''
      const min = obj.minCount ?? 1
      return lang === 'en'
        ? `At least ${min} matching card (${filterStr || 'compatible'}) in ${zoneStr}`
        : `Au moins ${min} carte compatible (${filterStr || 'ciblée'}) dans : ${zoneStr}`
    }
    if (baseType === 'HAND_MIN_OTHER_CARDS') {
      const min = obj.minCount ?? 1
      return lang === 'en'
        ? `Requires at least ${min} other card(s) in hand`
        : `Nécessite au moins ${min} autre(s) carte(s) en main`
    }
    if (baseType === 'OPPONENT_PRIZES_EXACT_COUNT') {
      const count = obj.minCount ?? 1
      return lang === 'en'
        ? `Opponent must have exactly ${count} Prize card(s) left`
        : `L'adversaire doit avoir exactement ${count} Récompense(s) restante(s)`
    }
    return getHumanReadablePrecondition(baseType, lang)
  }
  return String(rawPre)
}

export function getAiRoleDescription(role: string | null | undefined, lang: Language = 'fr'): string {
  const up = (role || '').toUpperCase().trim()
  const descFr: Record<string, string> = {
    MAIN_ATTACKER: 'Pièce maîtresse offensive : l’IA cherche en priorité à poser, faire évoluer et charger ce Pokémon pour prendre des Récompenses.',
    SECONDARY_ATTACKER: 'Attaquant de soutien ou de relance : l’IA l’utilise pour finir un K.O., contourner un blocage ou punir certains matchups.',
    DRAW_ENGINE: 'Moteur de pioche : sa présence en jeu augmente fortement la régularité et les options disponibles à chaque tour.',
    ENERGY_ACCELERATOR: 'Accélérateur d’Énergie : permet d’attacher plusieurs Énergies en un tour et de maintenir la pression offensive.',
    GUEST_TECH: 'Carte technique situationnelle : l’IA la garde pour répondre à une menace précise du métagame ou saisir une ouverture tactique.',
    DISRUPTION: 'Perturbation et contrôle : sert à ralentir le plan de jeu adverse (dérégler la main, piéger l’Actif ou bloquer les Objets).',
    CONSISTENCY_BOOSTER: 'Accélérateur de stabilité : fluidifie la sortie de début de partie et permet de trouver rapidement les Pokémon ou Ressources clés.',
  }
  const descEn: Record<string, string> = {
    MAIN_ATTACKER: 'Primary win condition: the AI prioritizes getting this Pokémon set up and powered with Energy to take Prize cards.',
    SECONDARY_ATTACKER: 'Backup attacker: deployed to finish KOs, answer specific threats, or keep pressure while conserving resources.',
    DRAW_ENGINE: 'Consistency engine: keeping this card active provides reliable card flow and better branching choices each turn.',
    ENERGY_ACCELERATOR: 'Energy acceleration: enables multi-attachment turns so your attackers stay online right on curve.',
    GUEST_TECH: 'Situational tech card: held by the AI to counter specific board states or swing critical prize trades.',
    DISRUPTION: 'Disruption & control: played to shrink the opponent’s options, trap a weak Active, or lock key trainers.',
    CONSISTENCY_BOOSTER: 'Setup & consistency card: smooths out early turns to locate essential Pokémon and resources reliably.',
  }
  const map = lang === 'en' ? descEn : descFr
  return (
    map[up] ||
    (lang === 'en'
      ? 'Evaluated dynamically according to board state and prize race progression.'
      : 'Évaluée dynamiquement selon la situation du plateau et la course aux Récompenses.')
  )
}

export function formatHumanActionCosts(action: PlayableAction, lang: Language = 'fr'): string[] {
  const pills: string[] = []

  if (action.cost && typeof action.cost === 'object' && !Array.isArray(action.cost)) {
    const entries = Object.entries(action.cost).filter(([, v]) => Number(v) > 0)
    if (entries.length > 0) {
      const energyStr = entries.map(([k, v]) => `${v}× ${k}`).join(', ')
      pills.push(lang === 'en' ? `Energy: ${energyStr}` : `Énergie : ${energyStr}`)
    }
  } else if (Array.isArray(action.energyCost) && action.energyCost.length > 0) {
    pills.push(
      lang === 'en'
        ? `Energy: ${action.energyCost.join(', ')}`
        : `Énergie : ${action.energyCost.join(', ')}`,
    )
  }

  if (Array.isArray(action.costs)) {
    for (const c of action.costs) {
      if (!c) continue
      const cType = String(c.type || '').toUpperCase()
      const cnt = c.count ?? 1
      const filterDesc = c.targetFilter ? ` (${formatHumanCardFilter(c.targetFilter, lang)})` : ''
      if (cType.includes('DISCARD')) {
        pills.push(
          lang === 'en'
            ? `Discard ${cnt} card(s)${filterDesc}`
            : `Défausser ${cnt} carte(s)${filterDesc}`,
        )
      } else if (cType.includes('SHUFFLE')) {
        pills.push(
          lang === 'en'
            ? `Shuffle ${cnt} card(s) into deck`
            : `Remélanger ${cnt} carte(s) dans le deck`,
        )
      } else if (cnt > 0 && cType) {
        pills.push(`${cType}: ${cnt}`)
      }
    }
  }

  if (pills.length === 0 && (action.actionType === 'ATTACK' || action.sourceType === 'ATTACK')) {
    pills.push(lang === 'en' ? '0 Energy' : '0 Énergie')
  }

  return pills
}

export function describePlainAtomicEffect(effect: AtomicEffect, lang: Language = 'fr'): string {
  const prim = String(effect.primitive || '').toUpperCase()
  const dmg = effect.value ?? effect.baseDamage ?? 0
  const count = effect.count ?? 1
  const upToText = effect.upTo ? (lang === 'en' ? 'up to ' : "jusqu'à ") : ''
  const targetDetail = getHumanReadableEffectDetails(effect, lang).find((d) => d.label === 'Target' || d.label === 'Cible')?.value
  const srcZone = effect.sourceZone ? formatHumanZone(effect.sourceZone, lang) : null
  const dstZone = effect.destinationZone || effect.zone ? formatHumanZone((effect.destinationZone || effect.zone)!, lang) : null
  const filterRaw = effect.filter ?? effect.targetFilter
  const filterTxt = filterRaw
    ? typeof filterRaw === 'string'
      ? filterRaw
      : formatHumanCardFilter(filterRaw, lang)
    : null

  let core = ''
  switch (prim) {
    case 'DAMAGE_ACTIVE':
      core =
        lang === 'en'
          ? `Deals ${dmg} damage to ${targetDetail || "Opponent's Active Pokémon"}`
          : `Inflige ${dmg} dégâts à : ${targetDetail || 'Pokémon Actif Adverse'}`
      break
    case 'DAMAGE_BENCH':
      core =
        lang === 'en'
          ? `Deals ${dmg} bench damage to ${targetDetail || 'Opponent Benched Pokémon'}`
          : `Inflige ${dmg} dégâts de banc sur : ${targetDetail || 'Banc Adverse'}`
      break
    case 'PLACE_DAMAGE_COUNTERS':
      core =
        lang === 'en'
          ? `Places ${dmg} damage value (${Math.round(dmg / 10)} counters) on ${targetDetail || 'Opponent Pokémon'}`
          : `Place ${dmg} dégâts en marqueurs (${Math.round(dmg / 10)} marqueur(s)) sur : ${targetDetail || 'Pokémon Adverse'}`
      break
    case 'MOVE_DAMAGE_COUNTERS':
      core =
        lang === 'en'
          ? `Moves damage counters between Pokémon (${targetDetail || 'board'})`
          : `Déplace des marqueurs de dégâts sur le plateau`
      break
    case 'SEARCH_DECK':
      core =
        lang === 'en'
          ? `Searches ${srcZone || 'Deck'} for ${upToText}${count} ${filterTxt || 'card(s)'} and puts them into ${dstZone || 'Hand'}`
          : `Cherche ${upToText}${count} carte(s)${filterTxt ? ` (${filterTxt})` : ''} dans ${srcZone || 'le Deck'} vers ${dstZone || 'la Main'}`
      break
    case 'DRAW_CARDS':
      core =
        lang === 'en'
          ? `Draws ${upToText}${count} card(s)`
          : `Pioche ${upToText}${count} carte(s)`
      break
    case 'SHUFFLE_HAND_DRAW':
      core =
        lang === 'en'
          ? `Shuffles hand into deck, then draws ${count} card(s)`
          : `Remélange la main dans le deck puis pioche ${count} carte(s)`
      break
    case 'ATTACH_ENERGY':
      core =
        lang === 'en'
          ? `Attaches ${upToText}${count} Energy card(s)${filterTxt ? ` (${filterTxt})` : ''} from ${srcZone || 'Hand/Deck'} to ${targetDetail || 'your Pokémon'}`
          : `Attache ${upToText}${count} Énergie(s)${filterTxt ? ` (${filterTxt})` : ''} depuis ${srcZone || 'Main/Deck'} sur ${targetDetail || 'vos Pokémon'}`
      break
    case 'RECOVER_FROM_DISCARD':
      core =
        lang === 'en'
          ? `Recovers ${upToText}${count} ${filterTxt || 'card(s)'} from Discard Pile to ${dstZone || 'Hand/Deck'}`
          : `Récupère ${upToText}${count} carte(s)${filterTxt ? ` (${filterTxt})` : ''} depuis la Défausse vers ${dstZone || 'Main/Deck'}`
      break
    case 'DISCARD_CARDS':
      core =
        lang === 'en'
          ? `Discards ${upToText}${count} card(s)${filterTxt ? ` (${filterTxt})` : ''}${srcZone ? ` from ${srcZone}` : ''}`
          : `Défausse ${upToText}${count} carte(s)${filterTxt ? ` (${filterTxt})` : ''}${srcZone ? ` depuis ${srcZone}` : ''}`
      break
    case 'SWITCH_ACTIVE':
      if (String(effect.target || '').toUpperCase().includes('OPPONENT')) {
        core =
          lang === 'en'
            ? "Switches Opponent's Active Pokémon with a Benched Pokémon (Gust)"
            : 'Envoie un Pokémon du Banc Adverse sur son Poste Actif (Rafale)'
      } else {
        core =
          lang === 'en'
            ? 'Switches your Active Pokémon with a Benched Pokémon'
            : 'Échange votre Pokémon Actif avec un Pokémon de votre Banc'
      }
      break
    case 'EVOLVE_POKEMON':
      core =
        lang === 'en'
          ? 'Evolves a Pokémon directly in play (e.g. skipping Stage 1 via Rare Candy)'
          : 'Fait évoluer un Pokémon en jeu directement (saut vers Niveau 2 possible)'
      break
    case 'HEAL':
      core =
        lang === 'en'
          ? `Heals ${dmg} damage from ${targetDetail || 'Pokémon'}`
          : `Soigne ${dmg} PV sur : ${targetDetail || 'Pokémon'}`
      break
    case 'APPLY_SPECIAL_CONDITION':
      core =
        lang === 'en'
          ? `Applies a Special Condition to ${targetDetail || "Opponent's Active"}`
          : `Inflige un État Spécial à : ${targetDetail || 'Pokémon Actif Adverse'}`
      break
    case 'MOVE_ENERGY':
      core =
        lang === 'en'
          ? `Moves ${upToText}${count} attached Energy card(s) to another Pokémon`
          : `Déplace ${upToText}${count} Énergie(s) attachée(s) vers un autre Pokémon`
      break
    case 'LOCK_ITEMS':
      core =
        lang === 'en'
          ? 'Prevents Opponent from playing Item cards next turn'
          : "Bloque les cartes Objet de l'adversaire au prochain tour"
      break
    case 'LOCK_ABILITIES':
      core =
        lang === 'en'
          ? 'Shuts off targeted Pokémon Abilities'
          : 'Neutralise les Talents des Pokémon ciblés'
      break
    case 'LOCK_NEXT_TURN_ATTACK':
      core =
        lang === 'en'
          ? 'Blocks the defending Pokémon or self from attacking next turn'
          : "Empêche d'attaquer au prochain tour"
      break
    case 'LOCK_RETREAT':
      core =
        lang === 'en'
          ? "Prevents Opponent's Active Pokémon from retreating"
          : "Empêche le Pokémon Actif Adverse de battre en retraite"
      break
    case 'MODIFY_DAMAGE_DEALT':
      core =
        lang === 'en'
          ? `Increases damage dealt by ${dmg}`
          : `Augmente les dégâts infligés (+${dmg})`
      break
    case 'MODIFY_DAMAGE_TAKEN':
      core =
        lang === 'en'
          ? `Reduces incoming damage by ${Math.abs(dmg)}`
          : `Réduit les dégâts subis (${dmg})`
      break
    case 'MODIFY_HP':
      core =
        lang === 'en'
          ? `Modifies Maximum HP by ${dmg > 0 ? `+${dmg}` : dmg}`
          : `Modifie les PV Max de ${dmg > 0 ? `+${dmg}` : dmg}`
      break
    case 'MODIFY_RETREAT_COST':
      core =
        dmg === 0
          ? lang === 'en'
            ? 'Sets Retreat Cost to 0'
            : 'Rend le Coût de Retraite gratuit (0)'
          : lang === 'en'
            ? `Adjusts Retreat Cost by ${dmg > 0 ? `+${dmg}` : dmg}`
            : `Modifie le Coût de Retraite de ${dmg > 0 ? `+${dmg}` : dmg}`
      break
    case 'PREVENT_DAMAGE_OR_EFFECTS':
      core =
        lang === 'en'
          ? 'Prevents attack damage and/or effects on target Pokémon'
          : 'Protège le Pokémon contre les dégâts ou effets d’attaques'
      break
    case 'EXPAND_BENCH':
      core =
        lang === 'en'
          ? `Expands Bench size up to ${dmg || 8} slots`
          : `Agrandit le Banc jusqu'à ${dmg || 8} emplacements`
      break
    case 'TAKE_EXTRA_PRIZE':
      core =
        lang === 'en'
          ? `Takes ${count} extra Prize card(s) on Knock Out`
          : `Permet de récupérer ${count} Récompense(s) supplémentaire(s) sur K.O.`
      break
    case 'PUT_ON_TOP_OR_BOTTOM_OF_DECK':
      core =
        lang === 'en'
          ? `Places ${count} card(s) on top/bottom of the Deck`
          : `Replace ${count} carte(s) au-dessus ou en dessous du Deck`
      break
    case 'MILL_DECK':
      core =
        lang === 'en'
          ? `Discards ${count} card(s) from the top of the Deck`
          : `Défausse ${count} carte(s) du dessus du Deck`
      break
    case 'KNOCK_OUT':
      core =
        lang === 'en'
          ? `Immediately Knocks Out ${targetDetail || 'target Pokémon'}`
          : `Met immédiatement K.O. : ${targetDetail || 'Pokémon ciblé'}`
      break
    default:
      core = getHumanReadablePrimitive(prim, lang)
  }

  const qualifiers: string[] = []
  if (effect.scalingMetric) {
    const op = effect.scalingOperator === 'MULTIPLY' ? '×' : '+'
    const val = effect.bonusValue != null ? ` ${op}${effect.bonusValue}` : ''
    qualifiers.push(`${formatScalingMetric(effect.scalingMetric, lang)}${val}`)
  } else if (effect.damageScalingType) {
    qualifiers.push(
      lang === 'en'
        ? `Bonus scaling (+${effect.damageScalingValue ?? 0})`
        : `Dégâts variables (+${effect.damageScalingValue ?? 0})`,
    )
  } else if (effect.damageScalingPerOpponentPrizeTaken) {
    qualifiers.push(
      lang === 'en'
        ? `+${effect.damageScalingPerOpponentPrizeTaken} per Prize taken by Opponent`
        : `+${effect.damageScalingPerOpponentPrizeTaken} par Récompense prise par l'adversaire`,
    )
  }

  if (effect.coinFlipMode) {
    const cf = getHumanReadableEffectDetails(effect, lang).find(
      (d) => d.label === 'Coin Flip' || d.label === 'Lancer de pièce',
    )?.value
    if (cf) qualifiers.push(cf)
  }
  if (effect.optional) {
    qualifiers.push(lang === 'en' ? 'Optional' : 'Effet optionnel')
  }

  return qualifiers.length > 0 ? `${core} — ${qualifiers.join(' • ')}` : core
}

export function formatDeadCardCondition(cond: unknown, lang: Language = 'fr'): string {
  if (!cond) return ''
  if (typeof cond === 'string') {
    const up = cond.toUpperCase()
    if (up.includes('NO_BASIC')) {
      return lang === 'en' ? 'Useless if no Basic Pokémon needs to be searched' : 'Inutile s’il n’y a plus de Pokémon de Base à chercher'
    }
    if (up.includes('BENCH_FULL')) {
      return lang === 'en' ? 'Unplayable when the Bench is completely full' : 'Injouable lorsque le Banc est complet'
    }
    if (up.includes('NO_ENERGY')) {
      return lang === 'en' ? 'Dead card if no matching Energy remains' : 'Carte morte s’il ne reste plus d’Énergie compatible'
    }
    return cond
  }
  if (typeof cond === 'object') {
    const obj = cond as Record<string, any>
    const reason = String(obj.reason || '').toUpperCase()
    const filterTxt = obj.targetFilter ? formatHumanCardFilter(obj.targetFilter, lang) : ''
    const zonesTxt = Array.isArray(obj.zonesToCheck)
      ? obj.zonesToCheck.map((z: string) => formatHumanZone(z, lang)).join(', ')
      : ''
    if (reason.includes('NO_MATCHING_TARGET') || reason.includes('EMPTY')) {
      return lang === 'en'
        ? `Considered dead if no ${filterTxt || 'compatible target'} remains${zonesTxt ? ` in ${zonesTxt}` : ''}`
        : `Considérée comme carte morte s’il ne reste aucun(e) ${filterTxt || 'cible compatible'}${zonesTxt ? ` dans : ${zonesTxt}` : ''}`
    }
    if (reason) return `${reason}${filterTxt ? ` (${filterTxt})` : ''}`
  }
  return String(cond)
}

export function formatSynergyRequirementItem(
  req: unknown,
  lang: Language = 'fr',
): { text: string; critical: boolean } {
  if (typeof req === 'string') {
    if (req.startsWith('requires_energy_type:')) {
      const energyType = req.replace('requires_energy_type:', '').trim()
      return {
        text:
          lang === 'en'
            ? `Needs ${energyType} Energy cards in the deck`
            : `Fonctionne avec des Énergies ${energyType} dans le deck`,
        critical: true,
      }
    }
    if (req.startsWith('requires_evolution_line:')) {
      const evo = req.replace('requires_evolution_line:', '').trim()
      return {
        text:
          lang === 'en'
            ? `Requires pre-evolution line "${evo}" in the deck`
            : `Dépend de la lignée évolutive « ${evo} » dans le deck`,
        critical: true,
      }
    }
    return { text: req, critical: false }
  }

  if (req && typeof req === 'object') {
    const obj = req as Record<string, any>
    const minCount = obj.minCountInDeck ?? 1
    const critical = Boolean(obj.ifMissingSetValueToZero)
    const filterTxt = obj.requiredFilter
      ? formatHumanCardFilter(obj.requiredFilter, lang)
      : lang === 'en'
        ? 'compatible card'
        : 'carte compatible'
    return {
      text:
        lang === 'en'
          ? `Expects at least ${minCount}× ${filterTxt}${critical ? ' (essential to function)' : ''}`
          : `Attend au moins ${minCount}× ${filterTxt}${critical ? ' (indispensable)' : ''}`,
      critical,
    }
  }

  return { text: String(req), critical: false }
}

export function buildHumanReadableAiBreakdown(
  card: ParsedDeckEntry | EngineCardModel | null | undefined,
  lang: Language = 'fr',
): HumanReadableAiBreakdown | null {
  if (!card) return null
  const model: EngineCardModel | null =
    'model' in card && card.model ? card.model : 'playableActions' in card ? (card as EngineCardModel) : null
  if (!model) return null

  const evaluator = model.strategicEvaluator || ({} as EngineCardModel['strategicEvaluator'])
  const roleKey = evaluator.aiRole || evaluator.primaryRole || 'CONSISTENCY_BOOSTER'
  const roleLabel = getHumanReadableAiRole(roleKey, lang)
  const roleDescription = getAiRoleDescription(roleKey, lang)

  const traitBadges: string[] = []
  if (model.identity.isRuleBox) {
    traitBadges.push(
      lang === 'en'
        ? `Rule Box (${model.identity.prizeCardsGiven || 2} Prizes)`
        : `Encadré Règle (${model.identity.prizeCardsGiven || 2} Récompenses)`,
    )
  }
  if (model.identity.isAceSpec) traitBadges.push(lang === 'en' ? 'ACE SPEC (Max 1/deck)' : 'HIGH-TECH (Max 1/deck)')
  if (model.identity.isTera) traitBadges.push(lang === 'en' ? 'Tera Pokémon' : 'Téracristal')
  if (model.identity.isAncient) traitBadges.push(lang === 'en' ? 'Ancient' : 'Temps Passé')
  if (model.identity.isFuture) traitBadges.push(lang === 'en' ? 'Future' : 'Temps Futur')
  if (model.pokemonStats?.canAttackTwice) traitBadges.push(lang === 'en' ? 'Can attack twice/turn' : 'Double attaque / tour')

  const evoChain = model.pokemonStats?.evolutionChain
  const evolutionChainText =
    Array.isArray(evoChain) && evoChain.length > 1 ? evoChain.join(' -> ') : null

  const retreatCost = model.pokemonStats?.retreatCost
  const retreatText =
    typeof retreatCost === 'number'
      ? retreatCost === 0
        ? lang === 'en'
          ? 'Free Retreat (0)'
          : 'Retraite gratuite (0)'
        : lang === 'en'
          ? `Retreat cost: ${retreatCost} Energy`
          : `Coût de retraite : ${retreatCost} Énergie${retreatCost > 1 ? 's' : ''}`
      : null

  const weights = evaluator.turnPhaseWeights || { turn1: 0.5, turn2: 0.5, turn3: 0.5, turn4Plus: 0.5 }
  const phaseDefs: Array<{ key: 'turn1' | 'turn2' | 'turn3' | 'turn4Plus'; fr: string; en: string }> = [
    { key: 'turn1', fr: 'Tour 1 (Ouverture)', en: 'Turn 1 (Opening)' },
    { key: 'turn2', fr: 'Tour 2 (Mise en place)', en: 'Turn 2 (Setup)' },
    { key: 'turn3', fr: 'Tour 3 (Milieu de jeu)', en: 'Turn 3 (Mid-game)' },
    { key: 'turn4Plus', fr: 'Tour 4+ (Fin de partie)', en: 'Turn 4+ (Late-game)' },
  ]
  const phasePriorities: HumanReadableAiPhasePriority[] = phaseDefs.map((def) => {
    const raw = Number(weights[def.key] ?? 0.5)
    const pct = Math.max(0, Math.min(100, Math.round((raw <= 1 ? raw : raw / 100) * 100)))
    const tier: 'high' | 'medium' | 'low' = pct >= 70 ? 'high' : pct >= 35 ? 'medium' : 'low'
    const badge =
      pct >= 85
        ? lang === 'en'
          ? 'Top priority'
          : 'Priorité max'
        : pct >= 60
          ? lang === 'en'
            ? 'Very useful'
            : 'Très importante'
          : pct >= 35
            ? lang === 'en'
              ? 'Moderate'
              : 'Modérée'
            : pct > 0
              ? lang === 'en'
                ? 'Situational'
                : 'Situationnelle'
              : lang === 'en'
                ? 'Inactive / Wait'
                : 'En attente'
    return {
      key: def.key,
      label: lang === 'en' ? def.en : def.fr,
      pct,
      tier,
      badge,
    }
  })

  const behaviorInsights: string[] = []
  if (typeof evaluator.intrinsicBaseScore === 'number') {
    const score = evaluator.intrinsicBaseScore
    if (score >= 80) {
      behaviorInsights.push(
        lang === 'en'
          ? 'Core deck card: the AI strongly protects and searches for it.'
          : 'Carte centrale du deck : l’IA la recherche et la protège en priorité.',
      )
    } else if (score <= 35) {
      behaviorInsights.push(
        lang === 'en'
          ? 'Contextual card: played mainly when a specific tactical opening appears.'
          : 'Carte contextuelle : jouée uniquement lorsque la situation du plateau s’y prête.',
      )
    }
  }
  if (typeof evaluator.holdForNextTurnBonus === 'number' && evaluator.holdForNextTurnBonus > 0.25) {
    behaviorInsights.push(
      lang === 'en'
        ? 'Timing discipline: the AI tends to hold this card for the right turn instead of wasting it early.'
        : 'Gestion du timing : l’IA préfère parfois garder cette carte en réserve pour un tour plus rentable.',
    )
  } else {
    behaviorInsights.push(
      lang === 'en'
        ? 'Proactive usage: the AI plays or activates this card as soon as a valid target exists.'
        : 'Utilisation proactive : l’IA joue ou active cette carte dès qu’une bonne opportunité se présente.',
    )
  }

  if (typeof evaluator.discardPriorityWhenDead === 'number') {
    if (evaluator.discardPriorityWhenDead >= 6) {
      behaviorInsights.push(
        lang === 'en'
          ? 'Discard fodder: if not needed this matchup, the AI willingly discards it for Ultra Ball or Research.'
          : 'Facile à défausser : si elle est inutile dans le matchup, l’IA s’en défausse volontiers (Hyper Ball, Professeur…).',
      )
    } else if (evaluator.discardPriorityWhenDead <= 3) {
      behaviorInsights.push(
        lang === 'en'
          ? 'High retention: the AI avoids discarding this card unless forced to.'
          : 'Carte précieuse : l’IA évite de s’en défausser sauf nécessité absolue.',
      )
    }
  }

  const synergies = (evaluator.decklistSynergyRequirements || []).map((req) =>
    formatSynergyRequirementItem(req, lang),
  )

  const deadConditions = (evaluator.inGameDeadCardConditions || [])
    .map((c) => formatDeadCardCondition(c, lang))
    .filter(Boolean)

  const actions: HumanReadableAiActionSummary[] = (model.playableActions || []).map((act) => {
    const turn1Hints: string[] = []
    if (act.canUseTurn1GoingFirst) {
      turn1Hints.push(lang === 'en' ? 'Usable Turn 1 (Going 1st)' : 'Jouable Tour 1 (en 1er)')
    } else if (act.canUseTurn1GoingSecond) {
      turn1Hints.push(lang === 'en' ? 'Usable Turn 1 (Going 2nd)' : 'Jouable Tour 1 (en 2e)')
    } else {
      turn1Hints.push(lang === 'en' ? 'Not usable on Turn 1' : 'Pas dès le Tour 1')
    }

    const preconditions = (act.preconditions || [])
      .map((p) => formatHumanPreconditionItem(p, lang))
      .filter((txt) => Boolean(txt))

    const effectSentences = (act.effects || []).map((eff) => describePlainAtomicEffect(eff, lang))

    return {
      actionId: act.actionId,
      title: act.label || getHumanReadableActionType(act.actionType || act.sourceType || '', lang),
      actionTypeLabel: getHumanReadableActionType(act.actionType || act.sourceType || '', lang),
      timingLabel: getHumanReadableTimingPhase(act.timingPhase || act.timing || '', lang),
      turn1Hints,
      costs: formatHumanActionCosts(act, lang),
      preconditions,
      effectSentences,
      deadConditionNote: act.deadCardCondition ? formatDeadCardCondition(act.deadCardCondition, lang) : null,
    }
  })

  return {
    roleLabel,
    roleDescription,
    traitBadges,
    evolutionChainText,
    retreatText,
    phasePriorities,
    behaviorInsights,
    synergies,
    deadConditions,
    actions,
  }
}
