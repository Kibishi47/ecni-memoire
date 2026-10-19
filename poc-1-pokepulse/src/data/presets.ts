import type { DeckPreset } from '../types/pokemon-tcg'

export const DECK_PRESETS: DeckPreset[] = [
  {
    id: 'charizard_pidgeot',
    name: 'Dracaufeu ex / Roucarnage ex',
    archetype: 'Évolution Niveau 2 / Engine Search',
    description: 'Archétype de contrôle progressif qui exploite Super Bonbon pour installer Roucarnage ex (Moteur de recherche universel) et Dracaufeu ex (DPS exponentiel en fin de partie).',
    difficulty: 'Intermédiaire',
    tempo: 'Midrange Niv.2',
    coverCard: 'Dracaufeu ex',
    badgeColor: 'border-amber-500/40 text-amber-400 bg-amber-500/10',
    ptcglText: `Pokémon: 16
4 Salamèche MEW 4
1 Reptincel OBF 27
2 Dracaufeu ex OBF 125
2 Roucool MEW 16
2 Roucarnage ex OBF 164
1 Motisma V CRZ 45
1 Lumineon V BRS 40
1 Tapatoès ex PAL 169
1 Manaphy BRS 41
1 Feunnec SIT 25

Dresseurs: 36
4 Poffin Pote-Pote TEF 144
4 Hyper Ball SVI 196
4 Faiblo Ball SVI 181
4 Super Bonbon SVI 191
2 Civière Nocturne SFA 61
2 Canne Ordinaire PAL 188
1 Tambour Éveillé TEF 141
1 Aspirateur Perdu CRZ 135
2 Ceinture Vitalité TEF 162
4 Arven SVI 166
3 Mashynn PAL 185
3 Ordres du Boss PAL 172
2 Professeur Turum PAR 171

Énergies: 8
7 Énergie Feu de base SVE 2
1 Énergie Obscurité de base SVE 7`,
    cards: [
      { id: 'salameche', name: 'Charmander', frenchName: 'Salamèche', count: 4, role: 'basic_pokemon', set: 'MEW', setNumber: '4', hp: 70, tag: 'Setup Clé' },
      { id: 'reptincel', name: 'Charmeleon', frenchName: 'Reptincel', count: 1, role: 'evolution_pokemon', set: 'OBF', setNumber: '27', hp: 90, tag: 'Pivot Niv.1' },
      { id: 'dracaufeu_ex', name: 'Charizard ex', frenchName: 'Dracaufeu ex', count: 2, role: 'evolution_pokemon', set: 'OBF', setNumber: '125', hp: 330, isEx: true, tag: 'Attaquant Principal' },
      { id: 'roucool', name: 'Pidgey', frenchName: 'Roucool', count: 2, role: 'basic_pokemon', set: 'MEW', setNumber: '16', hp: 60, tag: 'Setup Moteur' },
      { id: 'roucarnage_ex', name: 'Pidgeot ex', frenchName: 'Roucarnage ex', count: 2, role: 'evolution_pokemon', set: 'OBF', setNumber: '164', hp: 280, isEx: true, tag: 'Moteur Universel' },
      { id: 'motisma_v', name: 'Rotom V', frenchName: 'Motisma V', count: 1, role: 'basic_pokemon', set: 'CRZ', setNumber: '45', hp: 190, isV: true, tag: 'Pioche T1' },
      { id: 'lumineon_v', name: 'Lumineon V', frenchName: 'Lumineon V', count: 1, role: 'basic_pokemon', set: 'BRS', setNumber: '40', hp: 170, isV: true, tag: 'Tuteur Supporter' },
      { id: 'tapatoes_ex', name: 'Squawkabilly ex', frenchName: 'Tapatoès ex', count: 1, role: 'basic_pokemon', set: 'PAL', setNumber: '169', hp: 160, isEx: true, tag: 'Relance T1' },
      { id: 'manaphy', name: 'Manaphy', frenchName: 'Manaphy', count: 1, role: 'basic_pokemon', set: 'BRS', setNumber: '41', hp: 70, tag: 'Protection Banc' },
      { id: 'feunnec', name: 'Fennekin', frenchName: 'Feunnec', count: 1, role: 'basic_pokemon', set: 'SIT', setNumber: '25', hp: 60, tag: 'Pivot' },
      
      { id: 'poffin', name: 'Buddy-Buddy Poffin', frenchName: 'Poffin Pote-Pote', count: 4, role: 'search_engine', set: 'TEF', setNumber: '144', tag: 'Moteur T1' },
      { id: 'hyper_ball', name: 'Ultra Ball', frenchName: 'Hyper Ball', count: 4, role: 'search_engine', set: 'SVI', setNumber: '196', tag: 'Recherche Évolution' },
      { id: 'faiblo_ball', name: 'Nest Ball', frenchName: 'Faiblo Ball', count: 4, role: 'search_engine', set: 'SVI', setNumber: '181', tag: 'Recherche Base' },

      { id: 'super_bonbon', name: 'Rare Candy', frenchName: 'Super Bonbon', count: 4, role: 'accelerator_item', set: 'SVI', setNumber: '191', tag: 'Accélérateur Clé' },
      { id: 'civiere_nocturne', name: 'Night Stretcher', frenchName: 'Civière Nocturne', count: 2, role: 'accelerator_item', set: 'SFA', setNumber: '61', tag: 'Récupération' },
      { id: 'canne_ordinaire', name: 'Super Rod', frenchName: 'Canne Ordinaire', count: 2, role: 'accelerator_item', set: 'PAL', setNumber: '188', tag: 'Recyclage' },
      { id: 'tambour_eveille', name: 'Awakening Drum', frenchName: 'Tambour Éveillé', count: 1, role: 'accelerator_item', set: 'TEF', setNumber: '141', isAceSpec: true, tag: 'ACE SPEC' },
      { id: 'aspirateur_perdu', name: 'Lost Vacuum', frenchName: 'Aspirateur Perdu', count: 1, role: 'accelerator_item', set: 'CRZ', setNumber: '135', tag: 'Tech Anti-Stade' },
      { id: 'ceinture_vitalite', name: 'Vitality Band', frenchName: 'Ceinture Vitalité', count: 2, role: 'accelerator_item', set: 'TEF', setNumber: '162', tag: 'Outil Dégâts' },

      { id: 'arven', name: 'Arven', frenchName: 'Arven', count: 4, role: 'supporter', set: 'SVI', setNumber: '166', tag: 'Tuteur Clé T1' },
      { id: 'mashynn', name: 'Iono', frenchName: 'Mashynn', count: 3, role: 'supporter', set: 'PAL', setNumber: '185', tag: 'Disruption / Pioche' },
      { id: 'ordres_boss', name: "Boss's Orders", frenchName: 'Ordres du Boss', count: 3, role: 'supporter', set: 'PAL', setNumber: '172', tag: 'Ciblage Banc' },
      { id: 'prof_turum', name: "Professor Turo's Scenario", frenchName: 'Professeur Turum', count: 2, role: 'supporter', set: 'PAR', setNumber: '171', tag: 'Soins / Économie' },

      { id: 'energy_fire', name: 'Basic Fire Energy', frenchName: 'Énergie Feu de base', count: 7, role: 'energy', set: 'SVE', setNumber: '2', energyType: 'fire', tag: 'Énergie' },
      { id: 'energy_dark', name: 'Basic Darkness Energy', frenchName: 'Énergie Obscurité de base', count: 1, role: 'energy', set: 'SVE', setNumber: '7', energyType: 'darkness', tag: 'Énergie Tech' },
    ]
  },
  {
    id: 'raging_bolt_ogerpon',
    name: 'Ire-Foudre ex / Ogerpon Masque Turquoise ex',
    archetype: 'Aggro Turbo / Accélération Énergie',
    description: 'Deck ultra-agressif basé sur la génération massive d\'énergies dès le Tour 1-2 avec Vitalité de la Professeure Olim et Danse Verdoyante pour infliger 280+ dégâts immédiatement.',
    difficulty: 'Facile',
    tempo: 'Aggro T1/T2',
    coverCard: 'Ire-Foudre ex',
    badgeColor: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10',
    ptcglText: `Pokémon: 13
3 Ire-Foudre ex TEF 123
4 Ogerpon Masque Turquoise ex TWM 25
1 Rugit-Lune TEF 109
1 Tapatoès ex PAL 169
1 Plumeline OBF 162
1 Fongus-Furie PAR 124
1 Grenousse TWM 112
1 Mew ex MEW 151

Dresseurs: 36
4 Faiblo Ball SVI 181
4 Hyper Ball SVI 196
4 Poffin Pote-Pote TEF 144
4 Récupération d'Énergie Supérieure PAL 189
4 Échange d'Énergie SVI 173
3 Capsule Énergie Booster Temps Passé TEF 140
2 Civière Nocturne SFA 61
1 Attrape-Riposte PAR 160
1 PokéStop PGO 68
4 Vitalité de la Professeure Olim PAR 170
2 Mashynn PAL 185
2 Ordres du Boss PAL 172
1 Arven SVI 166

Énergies: 11
6 Énergie Plante de base SVE 1
3 Énergie Électrique de base SVE 4
2 Énergie Combat de base SVE 6`,
    cards: [
      { id: 'ire_foudre_ex', name: 'Raging Bolt ex', frenchName: 'Ire-Foudre ex', count: 3, role: 'basic_pokemon', set: 'TEF', setNumber: '123', hp: 240, isEx: true, tag: 'Attaquant Turbo' },
      { id: 'ogerpon_ex', name: 'Teal Mask Ogerpon ex', frenchName: 'Ogerpon Masque Turquoise ex', count: 4, role: 'basic_pokemon', set: 'TWM', setNumber: '25', hp: 210, isEx: true, tag: 'Moteur Énergie' },
      { id: 'rugit_lune', name: 'Roaring Moon', frenchName: 'Rugit-Lune', count: 1, role: 'basic_pokemon', set: 'TEF', setNumber: '109', hp: 140, tag: 'Attaquant 1-Prize' },
      { id: 'tapatoes_ex_bolt', name: 'Squawkabilly ex', frenchName: 'Tapatoès ex', count: 1, role: 'basic_pokemon', set: 'PAL', setNumber: '169', hp: 160, isEx: true, tag: 'Relance T1' },
      { id: 'plumeline', name: 'Oricorio', frenchName: 'Plumeline', count: 1, role: 'basic_pokemon', set: 'OBF', setNumber: '162', hp: 90, tag: 'Support' },
      { id: 'fongus_furie', name: 'Brute Bonnet', frenchName: 'Fongus-Furie', count: 1, role: 'basic_pokemon', set: 'PAR', setNumber: '124', hp: 120, tag: 'Poison Status' },
      { id: 'grenousse', name: 'Froakie', frenchName: 'Grenousse', count: 1, role: 'basic_pokemon', set: 'TWM', setNumber: '112', hp: 60, tag: 'Base' },
      { id: 'mew_ex', name: 'Mew ex', frenchName: 'Mew ex', count: 1, role: 'basic_pokemon', set: 'MEW', setNumber: '151', hp: 180, isEx: true, tag: 'Pioche / Mobilité' },

      { id: 'faiblo_ball_bolt', name: 'Nest Ball', frenchName: 'Faiblo Ball', count: 4, role: 'search_engine', set: 'SVI', setNumber: '181', tag: 'Recherche Base' },
      { id: 'hyper_ball_bolt', name: 'Ultra Ball', frenchName: 'Hyper Ball', count: 4, role: 'search_engine', set: 'SVI', setNumber: '196', tag: 'Recherche & Défausse' },
      { id: 'poffin_bolt', name: 'Buddy-Buddy Poffin', frenchName: 'Poffin Pote-Pote', count: 4, role: 'search_engine', set: 'TEF', setNumber: '144', tag: 'Moteur T1' },

      { id: 'recup_energie_sup', name: 'Superior Energy Retrieval', frenchName: "Récupération d'Énergie Supérieure", count: 4, role: 'accelerator_item', set: 'PAL', setNumber: '189', tag: 'Carburant Dégâts' },
      { id: 'echange_energie', name: 'Energy Switch', frenchName: "Échange d'Énergie", count: 4, role: 'accelerator_item', set: 'SVI', setNumber: '173', tag: 'Accélération Active' },
      { id: 'capsule_booster', name: 'Ancient Booster Energy Capsule', frenchName: 'Capsule Énergie Booster Temps Passé', count: 3, role: 'accelerator_item', set: 'TEF', setNumber: '140', tag: '+60 PV' },
      { id: 'civiere_nocturne_bolt', name: 'Night Stretcher', frenchName: 'Civière Nocturne', count: 2, role: 'accelerator_item', set: 'SFA', setNumber: '61', tag: 'Récupération' },
      { id: 'attrape_riposte', name: 'Counter Catcher', frenchName: 'Attrape-Riposte', count: 1, role: 'accelerator_item', set: 'PAR', setNumber: '160', tag: 'Ciblage Gust' },
      { id: 'pokestop', name: 'PokéStop', frenchName: 'PokéStop', count: 1, role: 'accelerator_item', set: 'PGO', setNumber: '68', tag: 'Stade Turbo' },

      { id: 'prof_sada', name: "Professor Sada's Vitality", frenchName: 'Vitalité de la Professeure Olim', count: 4, role: 'supporter', set: 'PAR', setNumber: '170', tag: 'Moteur Supporter T1' },
      { id: 'mashynn_bolt', name: 'Iono', frenchName: 'Mashynn', count: 2, role: 'supporter', set: 'PAL', setNumber: '185', tag: 'Disruption' },
      { id: 'ordres_boss_bolt', name: "Boss's Orders", frenchName: 'Ordres du Boss', count: 2, role: 'supporter', set: 'PAL', setNumber: '172', tag: 'Ciblage Banc' },
      { id: 'arven_bolt', name: 'Arven', frenchName: 'Arven', count: 1, role: 'supporter', set: 'SVI', setNumber: '166', tag: 'Tuteur Clé' },

      { id: 'energy_grass', name: 'Basic Grass Energy', frenchName: 'Énergie Plante de base', count: 6, role: 'energy', set: 'SVE', setNumber: '1', energyType: 'grass', tag: 'Énergie Principale' },
      { id: 'energy_lightning', name: 'Basic Lightning Energy', frenchName: 'Énergie Électrique de base', count: 3, role: 'energy', set: 'SVE', setNumber: '4', energyType: 'lightning', tag: 'Énergie Attaque' },
      { id: 'energy_fighting', name: 'Basic Fighting Energy', frenchName: 'Énergie Combat de base', count: 2, role: 'energy', set: 'SVE', setNumber: '6', energyType: 'fighting', tag: 'Énergie Attaque' },
    ]
  },
  {
    id: 'gardevoir_munkidori',
    name: 'Gardevoir ex / Fortusimia',
    archetype: 'Setup / Disruption & Manipulation de Dégâts',
    description: 'Archétype résilient qui défausse des énergies psychiques pour les attacher en boucle via Étreinte Psychique, tout en transférant les marqueurs sur le banc adverse avec Fortusimia.',
    difficulty: 'Expert',
    tempo: 'Contrôle Setup',
    coverCard: 'Gardevoir ex',
    badgeColor: 'border-pink-500/40 text-pink-400 bg-pink-500/10',
    ptcglText: `Pokémon: 15
4 Tarsal SVI 84
3 Kirlia SIT 68
2 Gardevoir ex SVI 86
1 Fortusimia TWM 95
1 Hurlasse PAR 86
1 Amphinobi Radieux ASR 46
1 Mimiqui PAL 97
1 Manaphy BRS 41
1 Trousselin SVI 96

Dresseurs: 34
4 Poffin Pote-Pote TEF 144
4 Hyper Ball SVI 196
3 Faiblo Ball SVI 181
1 Encens d'Évolution TEF 151
2 Super Bonbon SVI 191
3 Civière Nocturne SFA 61
2 Canne Ordinaire PAL 188
1 Tampon Injuste TWM 165
2 Cape d'Endurance SVI 169
1 Urne Terrestre PAR 164
4 Arven SVI 166
3 Mashynn PAL 185
2 Ordres du Boss PAL 172
1 Professeur Turum PAR 171
1 Tulipe PAR 181

Énergies: 11
9 Énergie Psychique de base SVE 5
2 Énergie Obscurité de base SVE 7`,
    cards: [
      { id: 'tarsal', name: 'Ralts', frenchName: 'Tarsal', count: 4, role: 'basic_pokemon', set: 'SVI', setNumber: '84', hp: 70, tag: 'Setup Clé' },
      { id: 'kirlia', name: 'Kirlia', frenchName: 'Kirlia', count: 3, role: 'evolution_pokemon', set: 'SIT', setNumber: '68', hp: 80, tag: 'Moteur Pioche' },
      { id: 'gardevoir_ex', name: 'Gardevoir ex', frenchName: 'Gardevoir ex', count: 2, role: 'evolution_pokemon', set: 'SVI', setNumber: '86', hp: 310, isEx: true, tag: 'Accélérateur Infini' },
      { id: 'fortusimia', name: 'Munkidori', frenchName: 'Fortusimia', count: 1, role: 'basic_pokemon', set: 'TWM', setNumber: '95', hp: 110, tag: 'Snipe Marqueurs' },
      { id: 'hurlasse', name: 'Scream Tail', frenchName: 'Hurlasse', count: 1, role: 'basic_pokemon', set: 'PAR', setNumber: '86', hp: 90, tag: 'Snipe Banc' },
      { id: 'amphinobi_radieux', name: 'Radiant Greninja', frenchName: 'Amphinobi Radieux', count: 1, role: 'basic_pokemon', set: 'ASR', setNumber: '46', hp: 130, isRadiant: true, tag: 'Moteur Défausse' },
      { id: 'mimiqui', name: 'Mimikyu', frenchName: 'Mimiqui', count: 1, role: 'basic_pokemon', set: 'PAL', setNumber: '97', hp: 70, tag: 'Mur ex / V' },
      { id: 'manaphy_gardy', name: 'Manaphy', frenchName: 'Manaphy', count: 1, role: 'basic_pokemon', set: 'BRS', setNumber: '41', hp: 70, tag: 'Protection Banc' },
      { id: 'trousselin', name: 'Klefki', frenchName: 'Trousselin', count: 1, role: 'basic_pokemon', set: 'SVI', setNumber: '96', hp: 70, tag: 'Lock Talents T1' },

      { id: 'poffin_gardy', name: 'Buddy-Buddy Poffin', frenchName: 'Poffin Pote-Pote', count: 4, role: 'search_engine', set: 'TEF', setNumber: '144', tag: 'Moteur T1' },
      { id: 'hyper_ball_gardy', name: 'Ultra Ball', frenchName: 'Hyper Ball', count: 4, role: 'search_engine', set: 'SVI', setNumber: '196', tag: 'Recherche Évolution' },
      { id: 'faiblo_ball_gardy', name: 'Nest Ball', frenchName: 'Faiblo Ball', count: 3, role: 'search_engine', set: 'SVI', setNumber: '181', tag: 'Recherche Base' },
      { id: 'encens_evo', name: 'Evolution Incense', frenchName: "Encens d'Évolution", count: 1, role: 'search_engine', set: 'TEF', setNumber: '151', tag: 'Tuteur Kirlia' },

      { id: 'super_bonbon_gardy', name: 'Rare Candy', frenchName: 'Super Bonbon', count: 2, role: 'accelerator_item', set: 'SVI', setNumber: '191', tag: 'Accélérateur Gardevoir' },
      { id: 'civiere_gardy', name: 'Night Stretcher', frenchName: 'Civière Nocturne', count: 3, role: 'accelerator_item', set: 'SFA', setNumber: '61', tag: 'Récupération' },
      { id: 'canne_gardy', name: 'Super Rod', frenchName: 'Canne Ordinaire', count: 2, role: 'accelerator_item', set: 'PAL', setNumber: '188', tag: 'Recyclage Énergies' },
      { id: 'tampon_injuste', name: 'Unfair Stamp', frenchName: 'Tampon Injuste', count: 1, role: 'accelerator_item', set: 'TWM', setNumber: '165', isAceSpec: true, tag: 'ACE SPEC Disruption' },
      { id: 'cape_endurance', name: 'Bravery Charm', frenchName: "Cape d'Endurance", count: 2, role: 'accelerator_item', set: 'SVI', setNumber: '169', tag: '+50 PV' },
      { id: 'urne_terrestre', name: 'Earthen Vessel', frenchName: 'Urne Terrestre', count: 1, role: 'accelerator_item', set: 'PAR', setNumber: '164', tag: 'Recherche Énergies' },

      { id: 'arven_gardy', name: 'Arven', frenchName: 'Arven', count: 4, role: 'supporter', set: 'SVI', setNumber: '166', tag: 'Tuteur Clé T1' },
      { id: 'mashynn_gardy', name: 'Iono', frenchName: 'Mashynn', count: 3, role: 'supporter', set: 'PAL', setNumber: '185', tag: 'Disruption & Main' },
      { id: 'ordres_boss_gardy', name: "Boss's Orders", frenchName: 'Ordres du Boss', count: 2, role: 'supporter', set: 'PAL', setNumber: '172', tag: 'Ciblage Banc' },
      { id: 'prof_turum_gardy', name: "Professor Turo's Scenario", frenchName: 'Professeur Turum', count: 1, role: 'supporter', set: 'PAR', setNumber: '171', tag: 'Économie Prix' },
      { id: 'tulipe', name: 'Tulip', frenchName: 'Tulipe', count: 1, role: 'supporter', set: 'PAR', setNumber: '181', tag: 'Récupération Psychique' },

      { id: 'energy_psychic', name: 'Basic Psychic Energy', frenchName: 'Énergie Psychique de base', count: 9, role: 'energy', set: 'SVE', setNumber: '5', energyType: 'psychic', tag: 'Énergie Principale' },
      { id: 'energy_dark_gardy', name: 'Basic Darkness Energy', frenchName: 'Énergie Obscurité de base', count: 2, role: 'energy', set: 'SVE', setNumber: '7', energyType: 'darkness', tag: 'Pour Fortusimia' },
    ]
  }
]
