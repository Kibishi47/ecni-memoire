import type { MetaOpponentDeck } from '@olydor/types'

export const DECK_LANSSORIEN_EX_PTCGL = `Pokémon: 19
4 Dreepy TWM 128
4 Drakloak TWM 129
3 Dragapult ex TWM 130
2 Munkidori TWM 95
2 Budew ASC 16
1 Dunsparce TEF 128
1 Dudunsparce TEF 129
1 Meowth ex POR 62
1 Fezandipiti ex ASC 142

Trainer: 32
4 Lillie's Determination MEG 119
3 Boss's Orders MEG 114
2 Crispin SCR 133
1 Rosa's Encouragement POR 84
1 Judge POR 76
4 Buddy-Buddy Poffin TEF 144
4 Poké Pad POR 81
4 Crushing Hammer POR 71
3 Ultra Ball MEG 131
3 Night Stretcher ASC 196
1 Unfair Stamp TWM 165
2 Risky Ruins MEG 127

Energy: 9
3 Fire Energy MEE 10
3 Psychic Energy MEE 13
3 Darkness Energy MEE 15

Total Cards: 60`

export const DECK_MEGA_KANGOUREX_EX_PTCGL = `Pokémon: 20
4 Mega Kangaskhan ex MEG 104
4 Meowth ex POR 62
2 Teal Mask Ogerpon ex TWM 25
2 Latias ex SSP 76
2 Lillie's Clefairy ex JTG 56
1 Chien-Pao SSP 56
1 Iron Leaves ex TEF 25
1 Fezandipiti ex ASC 142
1 Koraidon ex ASC 121
1 Bloodmoon Ursaluna ex TWM 141
1 Wellspring Mask Ogerpon ex TWM 64

Trainer: 27
4 Crispin SCR 133
3 Boss's Orders MEG 114
2 Cyrano SSP 170
1 Ciphermaniac's Codebreaking TEF 145
1 Judge POR 76
4 Energy Switch MEG 115
4 Ultra Ball MEG 131
2 Night Stretcher ASC 196
1 Special Red Card CRI 82
1 Hero's Cape TEF 152
4 Area Zero Underdepths SCR 131

Energy: 13
7 Grass Energy MEE 9
3 Psychic Energy MEE 13
2 Fighting Energy MEE 14
1 Water Energy MEE 11

Total Cards: 60`

export const DECK_ROIGADA_PTCGL = `Pokémon: 22
4 Slowpoke SCR 57
3 Slowking SCR 58
4 Mega Kangaskhan ex MEG 104
2 Latias ex SSP 76
2 Metagross CRI 61
2 Kyurem SFA 47
1 Fezandipiti ex ASC 142
1 Zeraora DRI 78
1 Lillie's Clefairy ex JTG 56
1 Meowth ex POR 62
1 Mew ex 30C 66

Trainer: 28
4 Ciphermaniac's Codebreaking TEF 145
4 Lillie's Determination MEG 119
4 Ultra Ball MEG 131
4 Poké Pad POR 81
3 Wondrous Patch PFL 94
2 Night Stretcher ASC 196
1 Switch MEG 130
1 Secret Box TWM 163
1 Lucky Helmet TWM 158
4 Academy at Night SFA 54

Energy: 10
4 Psychic Energy MEE 13
4 Telepathic Psychic Energy POR 88
2 Boomerang Energy TWM 166

Total Cards: 60`

export const DECK_ALAKAZAM_PTCGL = `Pokémon: 21
4 Abra MEG 54
4 Kadabra MEG 55
3 Alakazam MEG 56
3 Dunsparce JTG 120
2 Dudunsparce TEF 129
1 Flutter Mane TEF 78
1 Elgyem BLK 40
1 Genesect SFA 40
1 Fezandipiti ex ASC 142
1 Lillie's Clefairy ex JTG 56

Trainer: 31
4 Dawn PFL 87
3 Hilda WHT 84
2 Boss's Orders MEG 114
1 Eri TEF 146
4 Buddy-Buddy Poffin TEF 144
4 Poké Pad POR 81
2 Rare Candy MEG 125
2 Wondrous Patch PFL 94
1 Night Stretcher ASC 196
1 Sacred Ash DRI 168
1 Special Red Card CRI 82
2 Lillie's Pearl JTG 151
1 Handheld Fan TWM 150
2 Nighttime Mine ASC 197
1 Battle Cage PFL 85

Energy: 8
4 Telepathic Psychic Energy POR 88
2 Psychic Energy MEE 13
1 Mist Energy TEF 161
1 Enriching Energy SSP 191

Total Cards: 60`

export const DECK_BRANETTE_SINISTRAIL_PTCGL = `Pokémon: 25
4 Poltchageist PBL 5
2 Sinistcha PBL 6
4 Dhelmise PBL 39
3 Dunsparce JTG 120
2 Dudunsparce TEF 129
2 Shuppet PBL 33
4 Banette PBL 34
2 Lillie's Clefairy ex JTG 56
1 Bloodmoon Ursaluna ex TWM 141
1 Latias ex SSP 76

Trainer: 28
4 Lillie's Determination MEG 119
4 Gwynn PBL 78
3 Boss's Orders MEG 114
2 Explorer's Guidance TEF 147
1 Black Belt's Training JTG 143
4 Ultra Ball MEG 131
4 Poké Pad POR 81
3 Night Stretcher ASC 196
3 Prism Tower CRI 80

Energy: 7
4 Telepathic Psychic Energy POR 88
2 Psychic Energy MEE 13
1 Legacy Energy TWM 167

Total Cards: 60`

/**
 * Les 5 decks top méta du moment servant d'adversaires de référence.
 * 100 % des 60 cartes sont résolues dans cards_database.json et les énergies natives.
 */
export const META_OPPONENT_DECKS: MetaOpponentDeck[] = [
  {
    id: 'meta_lanssorien_ex',
    name: 'Lanssorien-ex',
    nameEn: 'Dragapult ex',
    archetypeBadge: 'Spread & Contrôle',
    archetypeBadgeEn: 'Spread & Control',
    strategySubtitle: 'Moteur de pioche Dispareptil + Plongée Fantôme (200 + 60 Banc)',
    strategySubtitleEn: 'Drakloak draw engine + Phantom Dive (200 + 60 Bench)',
    description:
      'Deck méta combinant le moteur de pioche de Dispareptil avec Lanssorien-ex (Plongée Fantôme), Munkidori pour manipuler les marqueurs de dégâts, et Rozbouton pour bloquer les Objets adverses.',
    descriptionEn:
      'Meta deck combining Drakloak Recon Directive engine with Dragapult ex (Phantom Dive), Munkidori damage manipulation, and Budew Item Lock.',
    keyThreats: ['Lanssorien-ex (200 + 60 Spread)', 'Dispareptil (Reconnaissance Aérienne)', 'Rozbouton (Item Lock)'],
    keyThreatsEn: ['Dragapult ex (200 + 60 Spread)', 'Drakloak (Recon Directive)', 'Budew (Item Lock)'],
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    ptcglText: DECK_LANSSORIEN_EX_PTCGL,
  },
  {
    id: 'meta_mega_kangourex_ex',
    name: 'Méga-Kangourex-ex',
    nameEn: 'Mega Kangaskhan ex',
    archetypeBadge: 'Accélération & Multi-Attaquants',
    archetypeBadgeEn: 'Acceleration & Multi-Attackers',
    strategySubtitle: 'Abîme Zéro à 8 places de Banc + Transfert d\'Énergies multi-types',
    strategySubtitleEn: 'Area Zero Underdepths 8-bench + Multi-type Energy Switch acceleration',
    description:
      'Deck massif exploitant les 8 places de Banc conférées par Abîme Zéro, l\'accélération d\'énergies via Échange d\'Énergie / Crispin et la force de frappe de Méga-Kangourex-ex, Ogerpon-ex et Koraidon-ex.',
    descriptionEn:
      'Massive deck utilizing Area Zero Underdepths 8-bench capacity, Energy Switch / Crispin acceleration, and heavy hitters Mega Kangaskhan ex, Ogerpon ex, and Koraidon ex.',
    keyThreats: ['Méga-Kangourex-ex', 'Ogerpon Masque Turquoise-ex', 'Abîme Zéro'],
    keyThreatsEn: ['Mega Kangaskhan ex', 'Teal Mask Ogerpon ex', 'Area Zero Underdepths'],
    badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
    ptcglText: DECK_MEGA_KANGOUREX_EX_PTCGL,
  },
  {
    id: 'meta_roigada',
    name: 'Roigada',
    nameEn: 'Slowking',
    archetypeBadge: 'Combo & Manipulation de Deck',
    archetypeBadgeEn: 'Combo & Deck Manipulation',
    strategySubtitle: 'Manipulation du dessus du deck avec Décodage du Cryptologue & Académie de Nuit',
    strategySubtitleEn: 'Top-deck manipulation with Ciphermaniac & Academy at Night',
    description:
      'Deck combo exploitant les synergies de Roigada avec Décodage du Cryptologue et Académie de Nuit pour ordonner le dessus du deck, soutenu par Méga-Kangourex-ex, Métalosse et Kyurem.',
    descriptionEn:
      'Combo deck leveraging Slowking synergies with Ciphermaniac and Academy at Night for top-deck ordering, supported by Mega Kangaskhan ex, Metagross, and Kyurem.',
    keyThreats: ['Roigada', 'Décodage du Cryptologue', 'Kyurem'],
    keyThreatsEn: ['Slowking', 'Ciphermaniac\'s Codebreaking', 'Kyurem'],
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
    ptcglText: DECK_ROIGADA_PTCGL,
  },
  {
    id: 'meta_alakazam',
    name: 'Alakazam',
    nameEn: 'Alakazam',
    archetypeBadge: 'Pioche & Dégâts Main',
    archetypeBadgeEn: 'Draw & Hand Scaling',
    strategySubtitle: 'Pioche Psy + Deusolourdo pour amplifier Main Puissante',
    strategySubtitleEn: 'Psychic Draw + Dudunsparce to scale Powerful Hand',
    description:
      'Deck à 1 Récompense accumulant une main massive via Alakazam (Pioche Psy), Kadabra, Deusolourdo et Énergie Enrichissante pour placer des marqueurs de dégâts massifs avec Main Puissante.',
    descriptionEn:
      'Single-prize deck building a massive hand through Alakazam (Psychic Draw), Kadabra, Dudunsparce, and Enriching Energy to place huge damage counters with Powerful Hand.',
    keyThreats: ['Alakazam (Main Puissante)', 'Deusolourdo (Pioche Fuyante)', 'Genesect (Annihilateur HIGH)'],
    keyThreatsEn: ['Alakazam (Powerful Hand)', 'Dudunsparce (Run Away Draw)', 'Genesect (ACE Nullifier)'],
    badgeColor: 'bg-sky-50 text-sky-700 border-sky-200',
    ptcglText: DECK_ALAKAZAM_PTCGL,
  },
  {
    id: 'meta_branette_sinistrail',
    name: 'Branette / Sinistrail',
    nameEn: 'Banette / Dhelmise',
    archetypeBadge: 'Défausse & Cachette en Douce',
    archetypeBadgeEn: 'Discard & Hide \'n\' Sneak',
    strategySubtitle: 'Alimente la défausse en Cachette en Douce pour Ancre Vengeresse & Pirouette Matcha',
    strategySubtitleEn: 'Feeds discard with Hide \'n\' Sneak Pokémon for Vengeful Anchor & Matcha Spin',
    description:
      'Deck combo à 1 Récompense qui remplit la pile de défausse avec Albia et Tour Prismatique en Pokémon dotés de Cachette en Douce (Branette, Théffroyable) pour frapper fort avec Sinistrail et spreader le Banc.',
    descriptionEn:
      'Single-prize combo deck filling the discard pile via Gwynn and Prism Tower with Hide \'n\' Sneak Pokémon (Banette, Sinistcha) to hit hard with Dhelmise and spread damage with Sinistcha.',
    keyThreats: ['Sinistrail (Ancre Vengeresse)', 'Théffroyable (Pirouette Matcha)', 'Branette (Poupée Piocheuse)'],
    keyThreatsEn: ['Dhelmise (Vengeful Anchor)', 'Sinistcha (Matcha Spin)', 'Banette (Puppet Pull)'],
    badgeColor: 'bg-rose-50 text-rose-700 border-rose-200',
    ptcglText: DECK_BRANETTE_SINISTRAIL_PTCGL,
  },
]
