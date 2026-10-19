import { TournamentMeta, OptimizationTarget } from '../types/deck'

export interface MetaPreset {
  id: string
  name: string
  subtitle: string
  icon: string
  meta: TournamentMeta
}

export const META_PRESETS: MetaPreset[] = [
  {
    id: 'local_aggro',
    name: 'Boutique locale',
    subtitle: 'Beaucoup de decks rapides (Ire-Foudre, Rugit-Lune)',
    icon: 'Zap',
    meta: {
      aggroRate: 55,
      evolutionRate: 30,
      controlRate: 15,
    },
  },
  {
    id: 'regional_balanced',
    name: 'Grand tournoi régional',
    subtitle: 'Équilibré (Dracaufeu, Lanssorien, T1 variés)',
    icon: 'Scale',
    meta: {
      aggroRate: 35,
      evolutionRate: 45,
      controlRate: 20,
    },
  },
  {
    id: 'control_stall',
    name: 'Tournoi défensif',
    subtitle: 'Beaucoup de decks lents / contrôle (Ronflex Stall, Gardevoir)',
    icon: 'Shield',
    meta: {
      aggroRate: 15,
      evolutionRate: 35,
      controlRate: 50,
    },
  },
]

export const OPTIMIZATION_TARGETS: OptimizationTarget[] = [
  {
    id: 'anti_brick',
    label: 'Je veux éviter les mains mortes (Sécurité)',
    shortLabel: 'Sécurité anti-brique',
    description: 'Stabiliser la main de départ et assurer d\'avoir toujours une action à chaque tour.',
  },
  {
    id: 'turn2_speed',
    label: 'Je veux sortir le plus vite possible (Vitesse)',
    shortLabel: 'Sortie rapide T2',
    description: 'Maximiser les chances d\'attaquer à pleine puissance dès le Tour 2.',
  },
]
