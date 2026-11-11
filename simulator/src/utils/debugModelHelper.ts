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

  if (effect.filter) {
    details.push({
      label: lang === 'en' ? 'Filter' : 'Filtre de recherche',
      value: String(effect.filter),
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
