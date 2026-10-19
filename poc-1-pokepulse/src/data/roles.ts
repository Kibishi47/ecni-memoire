import type { CardRole, RoleMetadata } from '../types/pokemon-tcg'

export const CARD_ROLES: Record<CardRole, RoleMetadata> = {
  basic_pokemon: {
    id: 'basic_pokemon',
    label: 'Pokémon de Base',
    shortLabel: 'Base',
    description: 'Nécessaires en main de départ pour éviter le Mulligan et ancrer le banc T1.',
    color: '#10b981', // emerald-500
    badgeBg: 'bg-emerald-500/15',
    badgeText: 'text-emerald-400',
    borderColor: 'border-emerald-500/30',
    icon: 'Shield'
  },
  evolution_pokemon: {
    id: 'evolution_pokemon',
    label: 'Évolutions Niv. 1 & 2',
    shortLabel: 'Évolutions',
    description: 'Attaquants principaux et piliers de tempo nécessitant un setup préalable.',
    color: '#8b5cf6', // purple-500
    badgeBg: 'bg-purple-500/15',
    badgeText: 'text-purple-400',
    borderColor: 'border-purple-500/30',
    icon: 'Zap'
  },
  search_engine: {
    id: 'search_engine',
    label: 'Moteurs de recherche / Balls',
    shortLabel: 'Tuteurs & Balls',
    description: 'Cartes assurant la consistance et le tutorat des pièces clés dès le T1.',
    color: '#06b6d4', // cyan-500
    badgeBg: 'bg-cyan-500/15',
    badgeText: 'text-cyan-400',
    borderColor: 'border-cyan-500/30',
    icon: 'Search'
  },
  accelerator_item: {
    id: 'accelerator_item',
    label: 'Accélérateurs & Objets clés',
    shortLabel: 'Objets Clés',
    description: 'Super Bonbon, civières, outils et accélérateurs sans restriction de supporter.',
    color: '#f59e0b', // amber-500
    badgeBg: 'bg-amber-500/15',
    badgeText: 'text-amber-400',
    borderColor: 'border-amber-500/30',
    icon: 'Sparkles'
  },
  supporter: {
    id: 'supporter',
    label: 'Supporters de pioche/disruption',
    shortLabel: 'Supporters',
    description: '1 seule utilisation par tour : pioche massive, tutorat ou disruption adverse.',
    color: '#ec4899', // pink-500
    badgeBg: 'bg-pink-500/15',
    badgeText: 'text-pink-400',
    borderColor: 'border-pink-500/30',
    icon: 'UserCheck'
  },
  energy: {
    id: 'energy',
    label: 'Énergies',
    shortLabel: 'Énergies',
    description: 'Carburant pour les attaques et retraites manuelles par tour.',
    color: '#eab308', // yellow-500
    badgeBg: 'bg-yellow-500/15',
    badgeText: 'text-yellow-400',
    borderColor: 'border-yellow-500/30',
    icon: 'Flame'
  }
}
