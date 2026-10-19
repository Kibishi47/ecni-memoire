import { TournamentMeta, OptimizationTarget } from '../types/deck'

export interface MetaPreset {
  id: string
  name: string
  tagline: string
  icon: string
  meta: TournamentMeta
  description: string
  typicalDecks: string
}

export const META_PRESETS: MetaPreset[] = [
  {
    id: 'local_aggro',
    name: 'Boutique Locale Aggro',
    tagline: 'Méta rapide, punitif & explosif',
    icon: 'Zap',
    meta: {
      aggroRate: 55,
      evolutionRate: 30,
      controlRate: 15,
    },
    description: 'Forte présence de decks tape-dur dès le Tour 1-2. La vitesse de déploiement et la présence d\'énergies immédiates sont critiques.',
    typicalDecks: 'Ire-Foudre ex / Ogerpon, Rugit-Lune ex, Miraidon ex',
  },
  {
    id: 'regional_balanced',
    name: 'Régional Équilibré',
    tagline: 'Standard des tournois majeurs',
    icon: 'Scale',
    meta: {
      aggroRate: 35,
      evolutionRate: 45,
      controlRate: 20,
    },
    description: 'Métagame représentatif des championnats régionaux. Équilibre entre montées en puissance T2-T3 et réponses tactiques.',
    typicalDecks: 'Dracaufeu ex, Lanssorien ex, Ire-Foudre ex, Gardevoir ex',
  },
  {
    id: 'control_stall',
    name: 'Salle Contrôle / Lente',
    tagline: 'Guerre d\'usure et blocage de ressources',
    icon: 'ShieldAlert',
    meta: {
      aggroRate: 15,
      evolutionRate: 35,
      controlRate: 50,
    },
    description: 'Forte concentration de decks de meule, déni d\'énergie et manipulation de main. La résilience des tuteurs et du recyclage est primordiale.',
    typicalDecks: 'Ronflex Stall, Gardevoir ex, Poncchien / Pidgeot Control',
  },
]

export const OPTIMIZATION_TARGETS: OptimizationTarget[] = [
  {
    id: 'turn2_speed',
    label: 'Maximiser l\'explosivité Tour 2',
    shortLabel: 'Vitesse T2',
    description: 'Priorise le taux de sortie agressive au T2 (attaque immédiate à 200+ dégâts). Idéal contre les decks rapides qui punissent les setups lents.',
    impactSummary: '+Tuteurs rapides (Poffin, Faiblo) & Bonbons, -Supporters passifs',
    icon: 'Flame',
  },
  {
    id: 'anti_brick',
    label: 'Minimiser le risque de Main Morte (Stabilité max)',
    shortLabel: 'Anti-Brick',
    description: 'Élimine les mains injouables au T1-T2 via un ratio de consistance renforcé. Parfait pour les rondes suisses longues (7 à 9 rondes).',
    impactSummary: 'Équilibrage strict des énergies (6-7), Hyper Ball + Supporters de pioche',
    icon: 'ShieldCheck',
  },
  {
    id: 'late_game_resilience',
    label: 'Maximiser la résilience post-Mashynn (Fin de partie)',
    shortLabel: 'Résilience Mashynn',
    description: 'Assure de pouvoir reconstituer son board et piocher ses finisseurs après une réduction de main à 1 ou 2 cartes par l\'adversaire.',
    impactSummary: '+Tuteurs d\'évolution (Hyper Ball, Xatu), moteurs secondaires & ressources',
    icon: 'RefreshCw',
  },
]
