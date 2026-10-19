import type { ScenarioPreset } from '../types/deck'

export const SCENARIOS: ScenarioPreset[] = [
  {
    id: 'scenario-1',
    title: 'Scénario 1 : Stabilité T1 vs Puissance Fin de Partie',
    subtitle: 'Sécuriser le banc contre les sorties agressives au détriment d’un Gust décisif',
    tag: 'Consistance T1',
    description:
      'Vous coupez 1 Ordres du Boss et 1 Énergie Feu pour ajouter 1 Poffin Pote-Pote (4e) et 1 Faiblo Ball (3e). Idéal face à une meta agressive (Ire-Foudre ex, Miraidon ex) où perdre un tour sans banc signifie une défaite immédiate.',
    changes: [
      { cardId: 'ordres-du-boss', delta: -1 },
      { cardId: 'energie-feu', delta: -1 },
      { cardId: 'poffin-pote-pote', delta: +1 },
      { cardId: 'faiblo-ball', delta: +1 },
    ],
    verdictContext: {
      pro: 'Gain massif en stabilité T1 (+5,8 % de banc 2+ Salamèche) et réduction du taux de mains mortes (-3,4 %).',
      con: 'Perte de pression de ciblage sur le Banc adverse en fin de partie et risque accru de manquer d’Énergie Feu au Tour 3 (+3,1 %).',
      recommendation: 'Fortement recommandé si la métropole locale ou le tournoi attend une forte représentation de decks Aggro (Ire-Foudre, Rugit-Lune).',
    },
  },
  {
    id: 'scenario-2',
    title: 'Scénario 2 : Accélération vs Régularité Supporter',
    subtitle: 'Maxer le combo Arven + Super Bonbon T2 en réduisant la pioche brute',
    tag: 'Speed Évolution T2',
    description:
      'Vous passez à 4 Arven et 4 Super Bonbon en retirant 1 Recherche Professorale et 1 Hyper Ball. L’objectif est de toucher l’évolution Dracaufeu ex dès le Tour 2 de manière ultra-systématique.',
    changes: [
      { cardId: 'recherche-professorale', delta: -1 },
      { cardId: 'hyper-ball', delta: -1 },
      { cardId: 'arven', delta: +1 },
      { cardId: 'super-bonbon', delta: +1 },
    ],
    verdictContext: {
      pro: 'Taux record de Super Bonbon T2 réussi (+7,2 %) et tutorisation optimisée de l’Outil VSTAR.',
      con: 'Capacité de recyclage amoindrie sans Recherche Professorale en cas de réinitialisation de main adverse à 1-2 cartes.',
      recommendation: 'Optimal en tournoi miroir (Dracaufeu / Lanssorien) où le premier joueur à établir Roucarnage / Dracaufeu prend un avantage décisif.',
    },
  },
  {
    id: 'scenario-3',
    title: 'Scénario 3 : Tech Anti-Contrôle & Stall',
    subtitle: 'Intégrer Plan du Professeur Turo et une 2e Civière contre la neutralisation',
    tag: 'Tech Anti-Stall',
    description:
      'Vous préparez le deck aux pièges de Ronflex Blocage, Craparoi / Pidgeot Control ou Gardevoir ex en remplaçant 1 Mashynn et 1 Énergie Feu par 1 Plan du Professeur Turo et 1 Civière Nocturne supplémentaire.',
    changes: [
      { cardId: 'mashynn', delta: -1 },
      { cardId: 'energie-feu', delta: -1 },
      { cardId: 'civiere-nocturne', delta: +1 },
      { cardId: 'plan-turo', delta: +1 },
    ],
    verdictContext: {
      pro: 'Capacité à sauver un Motisma V / Luminéon V piégé en actif (+11,4 % de sortie de lock) et réutilisation de Félicis-ex.',
      con: 'Légère baisse du contrôle de main adverse (-2,8 % de disruption T3) et gestion d’énergie plus tendue.',
      recommendation: 'Indispensable si des listes Contrôle, Ronflex Stall ou Feraligatr sont pressenties dans le top table.',
    },
  },
]
