import type { OpponentOption } from '../types/pokemon-tcg'

export const OPPONENT_OPTIONS: OpponentOption[] = [
  {
    id: 'goldfish',
    name: 'Test à vide (Seul)',
    shortDesc: 'Vérifier si le deck sort bien sans adversaire.'
  },
  {
    id: 'aggro_turbo',
    name: 'Contre un deck Rapide (Ire-Foudre ex)',
    shortDesc: 'Vous devez être prêt dès le Tour 2.'
  },
  {
    id: 'mirror_setup',
    name: 'Contre un deck Évolution (Dracaufeu ex)',
    shortDesc: 'Course à la mise en place au Tour 2.'
  },
  {
    id: 'disruption',
    name: 'Contre un deck Perturbation (Gardevoir / Mashynn)',
    shortDesc: 'Votre main est réduite au Tour 3.'
  }
]
