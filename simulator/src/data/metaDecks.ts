import type { MetaOpponentDeck } from '../types/deck'

/**
 * Les 4 decks méta complets de 60 cartes requis pour les affrontements (et disponibles en chargement rapide).
 * Chaque liste totalise exactement 60 cartes et toutes ses cartes sont résolues dans le catalogue `EngineCardModel`.
 */
export const META_OPPONENT_DECKS: MetaOpponentDeck[] = [
  {
    id: 'meta_charizard_pidgeot',
    name: 'Dracaufeu-ex / Roucarnage-ex',
    archetypeBadge: 'Midrange Setup',
    strategySubtitle: 'Accélération Règne Infernal + Tutorat universel Recherche Rapide',
    description:
      'Établit Roucarnage-ex et Dracaufeu-ex dès le Tour 2 via Super Bonbon et Pepper, puis prend l\'avantage aux Récompenses avec Combustion Obscure (180 à 330 dégâts) et Attrape-Riposte.',
    keyThreats: ['Dracaufeu-ex (330 PV)', 'Roucarnage-ex (Recherche Rapide)', 'Favianos-ex (Pioche 3)'],
    badgeColor: 'bg-orange-50 text-orange-700 border-orange-200',
    ptcglText: `Pokémon: 17
4 Salamèche MEW 4
1 Reptincel OBF 27
3 Dracaufeu-ex OBF 125
2 Roucool MEW 16
1 Roucoups OBF 163
2 Roucarnage-ex OBF 164
1 Favianos-ex SFA 38
1 Motisma V CRZ 45
1 Luminéon V BRS 40
1 Mélofée OBF 80

Dresseurs: 36
4 Pepper SVI 166
4 Mashynn PAL 185
3 Ordres du Boss PAL 172
1 Plan du Professeur Turum PAR 171
4 Poffin Copain-Copain TEF 144
4 Hyper Ball SVI 196
3 Faiblo Ball SVI 181
4 Super Bonbon PAF 125
2 Attrape-Riposte PAR 160
2 Civière Nocturne SFA 61
2 Méga Canne PAL 188
1 Tampon Injuste TWM 165
1 Pierre Scellée Sylvestre SIT 156
1 Ceinture Vitalité SVI 197

Énergies: 7
7 Énergie Feu de base SVE 2

Total Cards: 60`,
  },
  {
    id: 'meta_raging_bolt_ogerpon',
    name: 'Ire-Foudre-ex / Ogerpon-ex',
    archetypeBadge: 'Turbo Aggro',
    strategySubtitle: 'Accélération Danse Turquoise + Vitalité d\'Olim pour OHKO dès le T1/T2',
    description:
      'Inonde le plateau d\'énergies de base avec Ogerpon Masque Turquoise-ex et Vitalité de la Professeure Olim pour infliger 210 à 350 dégâts dès les premiers tours avec Tempête Éclats.',
    keyThreats: ['Ire-Foudre-ex (Tempête Éclats 70×)', 'Ogerpon Masque Turquoise-ex', 'Attrape-Suprême'],
    badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
    ptcglText: `Pokémon: 12
4 Ire-Foudre-ex TEF 123
4 Ogerpon Masque Turquoise-ex TWM 25
1 Pelage-Sablé-ex PAR 123
1 Tapatoès-ex PAL 169
1 Amphinobi Radieux ASR 46
1 Favianos-ex SFA 38

Dresseurs: 36
4 Vitalité de la Professeure Olim PAR 170
2 Ordres du Boss PAL 172
2 Mashynn PAL 185
1 Recherches Professorales SVI 189
4 Faiblo Ball SVI 181
4 Hyper Ball SVI 196
4 Urne Terrestre PAR 163
3 Civière Nocturne SFA 61
2 Méga Canne PAL 188
1 Attrape-Suprême TEF 157
3 Échange SVI 194
3 Amulette Bravoure PAL 173
3 PokéStop PGO 68

Énergies: 12
6 Énergie Plante de base SVE 1
3 Énergie Électrik de base SVE 4
3 Énergie Combat de base SVE 6

Total Cards: 60`,
  },
  {
    id: 'meta_dragapult_drakloak',
    name: 'Lanssorien-ex / Dispareptil',
    archetypeBadge: 'Spread & Tempo',
    strategySubtitle: 'Moteur de pioche Reconnaissance Aérienne + Plongée Fantôme (200 + 60 Banc)',
    description:
      'Accumule les cartes avec plusieurs Dispareptil sur le Banc et Xatu, puis met sous pression tout le plateau adverse avec Plongée Fantôme (200 sur l\'Actif + 6 marqueurs sur le Banc).',
    keyThreats: ['Lanssorien-ex (200 + 60 Spread)', 'Dispareptil (Reconnaissance Aérienne)', 'Xatu'],
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    ptcglText: `Pokémon: 18
4 Fantyrm TWM 128
4 Dispareptil TWM 129
3 Lanssorien-ex TWM 130
2 Natu PAR 71
2 Xatu PAR 72
1 Motisma V CRZ 45
1 Luminéon V BRS 40
1 Favianos-ex SFA 38

Dresseurs: 35
4 Pepper SVI 166
4 Mashynn PAL 185
2 Ordres du Boss PAL 172
1 Recherches Professorales SVI 189
4 Poffin Copain-Copain TEF 144
4 Hyper Ball SVI 196
2 Faiblo Ball SVI 181
3 Super Bonbon PAF 125
2 Urne Terrestre PAR 163
2 Attrape-Riposte PAR 160
2 Civière Nocturne SFA 61
2 Méga Canne PAL 188
1 Tampon Injuste TWM 165
1 Pierre Scellée Sylvestre SIT 156
1 CT : Évolution PAR 178

Énergies: 7
4 Énergie Psy de base SVE 5
3 Énergie Feu de base SVE 2

Total Cards: 60`,
  },
  {
    id: 'meta_gardevoir_fezandipiti',
    name: 'Gardevoir-ex / Favianos-ex',
    archetypeBadge: 'Contre-Tempo',
    strategySubtitle: 'Raffinement de Kirlia + Enlacement Psy sur Baudrive / Hurle-Queue',
    description:
      'Défausse ses Énergies Psy avec Kirlia et Hyper Ball pour charger des attaquants à 1 Récompense (Baudrive, Hurle-Queue) via Gardevoir-ex tout en perturbant la main adverse avec Mashynn et Tampon Injuste.',
    keyThreats: ['Gardevoir-ex (Enlacement Psy)', 'Baudrive (OHKO 1-Prize)', 'Hurle-Queue'],
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
    ptcglText: `Pokémon: 17
4 Tarsal ASR 60
4 Kirlia SIT 68
2 Gardevoir-ex SVI 86
2 Baudrive SVI 89
1 Hurle-Queue PAR 86
1 Fort-Usinier TEF 60
1 Mimiriqui PAL 97
1 Amphinobi Radieux ASR 46
1 Favianos-ex SFA 38

Dresseurs: 34
4 Mashynn PAL 185
4 Pepper SVI 166
2 Ordres du Boss PAL 172
1 Plan du Professeur Turum PAR 171
4 Poffin Copain-Copain TEF 144
4 Hyper Ball SVI 196
2 Faiblo Ball SVI 181
1 Super Bonbon PAF 125
2 Urne Terrestre PAR 163
2 Attrape-Riposte PAR 160
2 Civière Nocturne SFA 61
2 Méga Canne PAL 188
1 Tampon Injuste TWM 165
3 Amulette Bravoure PAL 173

Énergies: 9
9 Énergie Psy de base SVE 5

Total Cards: 60`,
  },
]
