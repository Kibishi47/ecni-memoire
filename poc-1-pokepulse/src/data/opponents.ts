import type { OpponentGauntlet } from '../types/pokemon-tcg'

export const OPPONENT_GAUNTLETS: OpponentGauntlet[] = [
  {
    id: 'goldfish',
    name: 'Dans le vide (Goldfishing pur)',
    archetype: 'Benchmark Solo / Horloge Neutre',
    subtitle: 'Zéro disruption adverse pour mesurer le plein potentiel théorique de votre deck.',
    pressureLevel: 'Nulle',
    pressureRating: 1,
    clockDescription: 'Horloge passive : aucun KO subi avant le Tour 5+',
    criticalTurn: 4,
    badgeColor: 'border-slate-500/40 text-slate-400 bg-slate-500/10',
    threatDescription: 'Aucune pression sur vos Pokémon de banc. Évalue la pure consistance mathématique de votre chaîne de tutorat et de vos sorties.',
    tacticalRequirement: 'Objectif : Atteindre votre moteur complet (Roucarnage ex / Kirlia / 6+ Énergies) sans accroc.',
    iconName: 'Compass'
  },
  {
    id: 'aggro_turbo',
    name: 'Face à Aggro Turbo (Ire-Foudre ex)',
    archetype: 'Menace Létale Immédiate Tour 2',
    subtitle: 'Pression maximale dès le Tour 2 : exige 2 Pokémon de base posés T1 sous peine de KO direct.',
    pressureLevel: 'Critique T2',
    pressureRating: 9.5,
    clockDescription: 'Horloge T2 : 140-280 dégâts assurés dès l\'attaque adverse',
    criticalTurn: 2,
    badgeColor: 'border-rose-500/40 text-rose-400 bg-rose-500/10',
    threatDescription: 'Si vous ne parvenez pas à poser au moins 2 Pokémon de base au Tour 1, votre unique attaquant/pivot subira un KO direct au Tour 2, provoquant une défaite prématurée (Donk / Game-over).',
    tacticalRequirement: 'Exigence absolue : Résoudre Poffin Pote-Pote ou Faiblo Ball dès le T1 pour sécuriser un double banc.',
    iconName: 'Flame'
  },
  {
    id: 'mirror_setup',
    name: 'Face à Setup Miroir (Dracaufeu / Lanssorien ex)',
    archetype: 'Course au Super Bonbon Tour 2',
    subtitle: 'Bataille de tempo : le premier à sortir Roucarnage ex ou Lanssorien ex prend un avantage décisif.',
    pressureLevel: 'Élevée T2',
    pressureRating: 7.5,
    clockDescription: 'Horloge T2-T3 : Menace de Drake Fantôme ou Poing Enflammé T2',
    criticalTurn: 2,
    badgeColor: 'border-amber-500/40 text-amber-400 bg-amber-500/10',
    threatDescription: 'En miroir ou face à Lanssorien ex, concéder un tour de retard sur l\'évolution Niv.2 permet à l\'adversaire de placer 6 marqueurs de dégâts sur vos petits Salamèche/Tarsal ou de cibler votre moteur.',
    tacticalRequirement: 'Exigence : Obtenir la combinaison [Pokémon de Base + Super Bonbon + Évolution Niv.2] au Tour 2.',
    iconName: 'Swords'
  },
  {
    id: 'disruption',
    name: 'Face à Disruption / Contrôle (Gardevoir / Mashynn)',
    archetype: 'Asphyxie de Main & Tampon Injuste Tour 3',
    subtitle: 'Simule l\'impact d\'une Mashynn ou d\'un Tampon Injuste au Tour 3 réduisant votre main à 2 cartes.',
    pressureLevel: 'Asphyxie T3',
    pressureRating: 8.5,
    clockDescription: 'Horloge T3 : Rupture de main forcée à 2 cartes après la première prise de récompense',
    criticalTurn: 3,
    badgeColor: 'border-purple-500/40 text-purple-400 bg-purple-500/10',
    threatDescription: 'Au Tour 3, l\'adversaire déclenche Mashynn (Iono) ou Tampon Injuste (Unfair Stamp), vous réduisant à 2 cartes. Si vous n\'avez pas un moteur passif sur table (Roucarnage ex Rapide Recherche ou Kirlia Raffinement), votre partie s\'effondre.',
    tacticalRequirement: 'Exigence : Avoir établi un moteur de pioche sur le banc avant le Tour 3 pour survivre au reset de main.',
    iconName: 'Skull'
  }
]
