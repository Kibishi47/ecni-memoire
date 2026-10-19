import type { DeckProfile, KeyCardItem, PresetChange } from '../types/wizard'

export const DECK_PROFILES: Record<'dracaufeu' | 'lanssorien', DeckProfile> = {
  dracaufeu: {
    id: 'dracaufeu',
    name: 'Dracaufeu ex',
    subtitle: 'Liste standard compétitive (Tournoi)',
    badge: 'Tier 1 Métagame',
    energyName: 'Énergie Feu',
    energyId: 'energy',
    energyDefaultCount: 6,
    keyCardsSummary: '4 Salamèche • 3 Dracaufeu ex • 2 Roucarnage ex • 3 Poffin • 3 Super Bonbon',
    description: 'Le deck de référence : énorme puissance de frappe (330 PV) et accélération d’énergies dès l’évolution.',
  },
  lanssorien: {
    id: 'lanssorien',
    name: 'Lanssorien ex',
    subtitle: 'Liste standard compétitive (Tournoi)',
    badge: 'Tier 1 Métagame',
    energyName: 'Énergie Psy',
    energyId: 'energy',
    energyDefaultCount: 5,
    keyCardsSummary: '4 Fantominus • 3 Lanssorien ex • 1 Drakkarmin • 3 Poffin • 3 Super Bonbon',
    description: 'Attaquant rapide : 200 dégâts sur le Pokémon actif + 6 marqueurs de dégâts à poser sur le banc adverse.',
  },
}

export function getDefaultKeyCards(deckId: 'dracaufeu' | 'lanssorien'): KeyCardItem[] {
  const energyName = deckId === 'dracaufeu' ? 'Énergie Feu de base' : 'Énergie Psy de base'
  const energyCount = deckId === 'dracaufeu' ? 6 : 5

  return [
    {
      id: 'poffin',
      name: 'Poffin Pote-Pote',
      role: 'Pose 2 Pokémon de base sur le banc au T1',
      icon: '🎒',
      defaultCount: 3,
      currentCount: 3,
      min: 1,
      max: 4,
    },
    {
      id: 'candy',
      name: 'Super Bonbon',
      role: 'Évolution directe au Niveau 2 dès le T2',
      icon: '🍬',
      defaultCount: 3,
      currentCount: 3,
      min: 1,
      max: 4,
    },
    {
      id: 'boss',
      name: 'Ordres du Boss',
      role: 'Cible un Pokémon du banc adverse',
      icon: '🎯',
      defaultCount: 2,
      currentCount: 2,
      min: 0,
      max: 4,
    },
    {
      id: 'ultra',
      name: 'Hyper Ball',
      role: 'Cherche n’importe quel Pokémon dans le deck',
      icon: '⚽',
      defaultCount: 4,
      currentCount: 4,
      min: 1,
      max: 4,
    },
    {
      id: 'energy',
      name: energyName,
      role: 'Alimente les attaques de vos Pokémon',
      icon: '⚡',
      defaultCount: energyCount,
      currentCount: energyCount,
      min: 3,
      max: 10,
    },
    {
      id: 'stretcher',
      name: 'Civière Nocturne',
      role: 'Récupère 1 Pokémon ou 1 Énergie en main',
      icon: '🩹',
      defaultCount: 1,
      currentCount: 1,
      min: 0,
      max: 3,
    },
  ]
}

export function getPresetChanges(deckId: 'dracaufeu' | 'lanssorien'): PresetChange[] {
  const energyName = deckId === 'dracaufeu' ? 'Énergie Feu' : 'Énergie Psy'
  const attackerName = deckId === 'dracaufeu' ? 'Dracaufeu' : 'Lanssorien'

  return [
    {
      id: 'stability',
      title: 'Plus de stabilité au Tour 1',
      tag: 'Sécurité de départ',
      removeCardId: 'boss',
      removeCardName: 'Ordres du Boss',
      addCardId: 'poffin',
      addCardName: 'Poffin Pote-Pote',
      description: 'Retire 1 Ordres du Boss ➔ Ajoute 1 Poffin Pote-Pote (+1)',
    },
    {
      id: 'speed',
      title: `Sortir ${attackerName} plus vite`,
      tag: 'Vitesse Tour 2',
      removeCardId: 'ultra',
      removeCardName: 'Hyper Ball',
      addCardId: 'candy',
      addCardName: 'Super Bonbon',
      description: 'Retire 1 Hyper Ball ➔ Ajoute 1 Super Bonbon (+1)',
    },
    {
      id: 'late_game',
      title: 'Sécuriser la fin de partie',
      tag: 'Récupération post-K.O.',
      removeCardId: 'energy',
      removeCardName: energyName,
      addCardId: 'stretcher',
      addCardName: 'Civière Nocturne',
      description: `Retire 1 ${energyName} ➔ Ajoute 1 Civière Nocturne (+1)`,
    },
  ]
}
