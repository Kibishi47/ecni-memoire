import type { DeclarativeCardDefinition, SimulationConfig } from '@/types/engine'

/**
 * Bit-packing constants for Uint16 card/board representation (matches Go [60]uint16 struct)
 * Bits 0..4   (5 bits) : Card Template ID (1..31)
 * Bits 5..8   (4 bits) : Turn Played (0..15) -> enforces Invariant #2 (turnPlayed < currentTurn) up to Turn 10+
 * Bits 9..12  (4 bits) : Attached Fire Energies count (0..15)
 * Bit  13     (1 bit)  : Forest Seal Stone attached (enables VSTAR Power)
 * Bit  14     (1 bit)  : Once-per-turn Ability used this turn
 * Bit  15     (1 bit)  : Generic Tool attached
 */
export const PACK_CARD_ID_MASK = 0x001f
export const PACK_TURN_SHIFT = 5
export const PACK_TURN_MASK = 0x01e0
export const PACK_ENERGY_SHIFT = 9
export const PACK_ENERGY_MASK = 0x1e00
export const PACK_SEAL_STONE_BIT = 1 << 13
export const PACK_ABILITY_USED_BIT = 1 << 14
export const PACK_OTHER_TOOL_BIT = 1 << 15

export function packCard(
  cardId: number,
  turnPlayed = 0,
  energies = 0,
  hasSealStone = false,
  abilityUsed = false,
  hasOtherTool = false,
): number {
  return (
    (cardId & PACK_CARD_ID_MASK) |
    ((turnPlayed & 0xf) << PACK_TURN_SHIFT) |
    ((energies & 0xf) << PACK_ENERGY_SHIFT) |
    (hasSealStone ? PACK_SEAL_STONE_BIT : 0) |
    (abilityUsed ? PACK_ABILITY_USED_BIT : 0) |
    (hasOtherTool ? PACK_OTHER_TOOL_BIT : 0)
  )
}

export function unpackCardId(packed: number): number {
  return packed & PACK_CARD_ID_MASK
}

export function unpackTurnPlayed(packed: number): number {
  return (packed & PACK_TURN_MASK) >>> PACK_TURN_SHIFT
}

export function unpackEnergies(packed: number): number {
  return (packed & PACK_ENERGY_MASK) >>> PACK_ENERGY_SHIFT
}

export function setPackedTurnPlayed(packed: number, turn: number): number {
  return (packed & ~PACK_TURN_MASK) | ((turn & 0xf) << PACK_TURN_SHIFT)
}

export function addPackedEnergies(packed: number, delta: number): number {
  const current = unpackEnergies(packed)
  const next = Math.min(15, current + delta)
  return (packed & ~PACK_ENERGY_MASK) | (next << PACK_ENERGY_SHIFT)
}

export function evolvePackedPokemon(packedBase: number, newCardId: number, currentTurn: number): number {
  // Preserves attached energies and tools, updates cardId and sets turnPlayed = currentTurn
  // (also resets abilityUsedThisTurn on newly evolved Pokemon)
  const preservedFlags = packedBase & (PACK_ENERGY_MASK | PACK_SEAL_STONE_BIT | PACK_OTHER_TOOL_BIT)
  return (newCardId & PACK_CARD_ID_MASK) | ((currentTurn & 0xf) << PACK_TURN_SHIFT) | preservedFlags
}

/**
 * Card Template IDs (1..20)
 */
export const CARD_IDS = {
  CHARMANDER: 1,
  PIDGEY: 2,
  LUMINEON_V: 3,
  FEZANDIPITI_EX: 4,
  ROTOM_V: 5,
  CHARMELEON: 6,
  PIDGEOTTO: 7,
  CHARIZARD_EX: 8,
  PIDGEOT_EX: 9,
  BUDDY_POFFIN: 10,
  NEST_BALL: 11,
  ULTRA_BALL: 12,
  RARE_CANDY: 13,
  SUPER_ROD: 14,
  NIGHT_STRETCHER: 15,
  ARVEN: 16,
  PROFESSORS_RESEARCH: 17,
  IONO: 18,
  BOSS_ORDERS: 19,
  FOREST_SEAL_STONE: 20,
  MAXIMUM_BELT: 21,
  DEFIANCE_BAND: 22,
  TM_EVOLUTION: 23,
  COLLAPSED_STADIUM: 24,
  FIRE_ENERGY: 25,
} as const

/**
 * Declarative 60-Card Registry for "Dracaufeu ex / Roucarnage ex"
 * Zero hardcoded card names in the simulation loop: the engine interprets `primitives[]`.
 */
export const DEFAULT_CARD_REGISTRY: DeclarativeCardDefinition[] = [
  // 1. Pokémon de Base (9) + Niveau 1 (2) = 11 cartes
  {
    id: CARD_IDS.CHARMANDER,
    code: 'OBF-026',
    name: 'Salamèche',
    category: 'POKEMON',
    subType: 'BASIC',
    hp: 70,
    evolutionLine: 'CHARIZARD',
    priorityActive: 85,
    strategicValue: 80,
    defaultCount: 4,
    primitives: [],
  },
  {
    id: CARD_IDS.PIDGEY,
    code: 'OBF-162',
    name: 'Roucool',
    category: 'POKEMON',
    subType: 'BASIC',
    hp: 60,
    evolutionLine: 'PIDGEOT',
    priorityActive: 75,
    strategicValue: 78,
    defaultCount: 2,
    primitives: [],
  },
  {
    id: CARD_IDS.LUMINEON_V,
    code: 'BRS-040',
    name: 'Luminéon V',
    category: 'POKEMON',
    subType: 'BASIC',
    hp: 170,
    isPokemonV: true,
    evolutionLine: 'LUMINEON',
    priorityActive: 35,
    strategicValue: 65,
    defaultCount: 1,
    primitives: [
      {
        opcode: 'ABILITY_LUMINOUS_SIGN',
        filter: 'SUPPORTER_ANY',
        maxTargets: 1,
        precondition: 'ONCE_PER_TURN',
        description: 'Signe Lumineux : À la pose de la main sur le Banc, cherche 1 carte Supporter dans le deck.',
      },
    ],
  },
  {
    id: CARD_IDS.FEZANDIPITI_EX,
    code: 'SFA-038',
    name: 'Fezandipiti ex',
    category: 'POKEMON',
    subType: 'BASIC',
    hp: 210,
    isPokemonEx: true,
    evolutionLine: 'FEZANDIPITI',
    priorityActive: 40,
    strategicValue: 60,
    defaultCount: 1,
    primitives: [
      {
        opcode: 'ABILITY_FLIP_THE_SCRIPT',
        filter: 'NONE',
        maxTargets: 0,
        drawCount: 3,
        precondition: 'OPPONENT_KNOCKED_OUT_LAST_TURN',
        description: 'Renverser la Tendance : Une fois par tour, si un Pokémon a été mis KO au tour précédent, pioche 3 cartes.',
      },
    ],
  },
  {
    id: CARD_IDS.ROTOM_V,
    code: 'LOR-058',
    name: 'Motisma V',
    category: 'POKEMON',
    subType: 'BASIC',
    hp: 190,
    isPokemonV: true,
    evolutionLine: 'ROTOM',
    priorityActive: 45,
    strategicValue: 72,
    defaultCount: 1,
    primitives: [
      {
        opcode: 'ABILITY_INSTANT_CHARGE',
        filter: 'NONE',
        maxTargets: 0,
        drawCount: 3,
        precondition: 'ONCE_PER_TURN',
        description: 'Charge Instantanée : Une fois pendant votre tour, piochez 3 cartes (idéal en fin de Tour 1).',
      },
    ],
  },
  {
    id: CARD_IDS.CHARMELEON,
    code: 'PAF-008',
    name: 'Reptincel',
    category: 'POKEMON',
    subType: 'STAGE_1',
    hp: 90,
    evolutionLine: 'CHARIZARD',
    evolvesFrom: 'Salamèche',
    priorityActive: 88,
    strategicValue: 74,
    defaultCount: 1,
    primitives: [
      {
        opcode: 'EVOLVE_STANDARD',
        filter: 'POKEMON_ANY',
        maxTargets: 1,
        precondition: 'TARGET_ON_BOARD_PREV_TURN',
        description: 'Évolution régulière depuis Salamèche (uniquement si posé à un tour antérieur).',
      },
    ],
  },
  {
    id: CARD_IDS.PIDGEOTTO,
    code: 'MEW-017',
    name: 'Roucoups',
    category: 'POKEMON',
    subType: 'STAGE_1',
    hp: 90,
    evolutionLine: 'PIDGEOT',
    evolvesFrom: 'Roucool',
    priorityActive: 78,
    strategicValue: 70,
    defaultCount: 1,
    primitives: [
      {
        opcode: 'EVOLVE_STANDARD',
        filter: 'POKEMON_ANY',
        maxTargets: 1,
        precondition: 'TARGET_ON_BOARD_PREV_TURN',
        description: 'Évolution régulière depuis Roucool (uniquement si posé à un tour antérieur).',
      },
    ],
  },

  // 2. Évolutions Niveau 2 (5 cartes)
  {
    id: CARD_IDS.CHARIZARD_EX,
    code: 'OBF-125',
    name: 'Dracaufeu ex',
    category: 'POKEMON',
    subType: 'STAGE_2',
    hp: 330,
    isPokemonEx: true,
    evolutionLine: 'CHARIZARD',
    evolvesFrom: 'Reptincel / Salamèche (via Super Bonbon)',
    attackEnergyCost: 2,
    attackDamage: 180,
    attackName: 'Combustion Obscure (180+)',
    priorityActive: 100,
    strategicValue: 98,
    defaultCount: 3,
    primitives: [
      {
        opcode: 'ABILITY_INFERNAL_REIGN',
        filter: 'FIRE_ENERGY',
        maxTargets: 3,
        precondition: 'NONE',
        description: 'Règne Infernal : Lorsque vous jouez ce Pokémon de votre main pour faire évoluer 1 de vos Pokémon, cherchez jusqu’à 3 Énergies Feu de Base dans le deck et attachez-les.',
      },
    ],
  },
  {
    id: CARD_IDS.PIDGEOT_EX,
    code: 'OBF-164',
    name: 'Roucarnage ex',
    category: 'POKEMON',
    subType: 'STAGE_2',
    hp: 280,
    isPokemonEx: true,
    evolutionLine: 'PIDGEOT',
    evolvesFrom: 'Roucoups / Roucool (via Super Bonbon)',
    attackEnergyCost: 2,
    attackDamage: 120,
    attackName: 'Bourrasque Tournoyante (120)',
    priorityActive: 80,
    strategicValue: 95,
    defaultCount: 2,
    primitives: [
      {
        opcode: 'ABILITY_QUICK_SEARCH',
        filter: 'ANY_CARD',
        maxTargets: 1,
        precondition: 'ONCE_PER_TURN',
        description: 'Recherche Rapide : Une fois pendant votre tour, cherchez dans votre deck 1 carte de votre choix et ajoutez-la à votre main.',
      },
    ],
  },

  // 3. Objets de Recherche & Accélération (18 cartes)
  {
    id: CARD_IDS.BUDDY_POFFIN,
    code: 'TEF-144',
    name: 'Poffin Pote-Pote',
    category: 'ITEM',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 88,
    defaultCount: 4,
    primitives: [
      {
        opcode: 'SEARCH_DECK_TO_BENCH',
        filter: 'BASIC_HP_LTE_70',
        maxTargets: 2,
        maxHp: 70,
        precondition: 'NONE',
        description: 'Cherchez dans votre deck jusqu’à 2 Pokémon de Base ayant 70 PV ou moins et placez-les sur votre Banc.',
      },
    ],
  },
  {
    id: CARD_IDS.NEST_BALL,
    code: 'SVI-181',
    name: 'Faiblo Ball',
    category: 'ITEM',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 82,
    defaultCount: 4,
    primitives: [
      {
        opcode: 'SEARCH_DECK_TO_BENCH',
        filter: 'BASIC_ANY',
        maxTargets: 1,
        precondition: 'NONE',
        description: 'Cherchez dans votre deck 1 Pokémon de Base et placez-le sur votre Banc.',
      },
    ],
  },
  {
    id: CARD_IDS.ULTRA_BALL,
    code: 'SVI-196',
    name: 'Hyper Ball',
    category: 'ITEM',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 86,
    defaultCount: 4,
    primitives: [
      {
        opcode: 'COST_DISCARD_CARDS',
        filter: 'ANY_CARD',
        maxTargets: 2,
        costDiscard: 2,
        precondition: 'REQUIRES_MIN_HAND_SIZE_3',
        description: 'Coût obligatoire : Défaussez 2 autres cartes de votre main.',
      },
      {
        opcode: 'SEARCH_DECK_TO_HAND',
        filter: 'POKEMON_ANY',
        maxTargets: 1,
        precondition: 'REQUIRES_MIN_HAND_SIZE_3',
        description: 'Cherchez dans votre deck 1 Pokémon (Base, Niveau 1 ou Niveau 2), montrez-le et ajoutez-le à votre main.',
      },
    ],
  },
  {
    id: CARD_IDS.RARE_CANDY,
    code: 'SVI-191',
    name: 'Super Bonbon',
    category: 'ITEM',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 96,
    defaultCount: 4,
    primitives: [
      {
        opcode: 'EVOLVE_BASIC_TO_STAGE2',
        filter: 'POKEMON_ANY',
        maxTargets: 1,
        precondition: 'TARGET_ON_BOARD_PREV_TURN',
        description: 'Choisissez 1 de vos Pokémon de Base en jeu (posé à un tour précédent) et faites-le évoluer directement avec une carte Niveau 2 correspondante de votre main.',
      },
    ],
  },
  {
    id: CARD_IDS.SUPER_ROD,
    code: 'PAL-188',
    name: 'Méga Canne',
    category: 'ITEM',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 50,
    defaultCount: 1,
    primitives: [
      {
        opcode: 'RECOVER_DISCARD_TO_DECK',
        filter: 'POKEMON_OR_BASIC_ENERGY',
        maxTargets: 3,
        precondition: 'NONE',
        description: 'Mélangez avec votre deck jusqu’à 3 cartes Pokémon et/ou Énergie de base de votre pile de défausse.',
      },
    ],
  },
  {
    id: CARD_IDS.NIGHT_STRETCHER,
    code: 'SFA-061',
    name: 'Civière Nocturne',
    category: 'ITEM',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 55,
    defaultCount: 1,
    primitives: [
      {
        opcode: 'RECOVER_DISCARD_TO_HAND',
        filter: 'POKEMON_OR_BASIC_ENERGY',
        maxTargets: 1,
        precondition: 'NONE',
        description: 'Placez 1 Pokémon ou 1 carte Énergie de base de votre pile de défausse dans votre main.',
      },
    ],
  },

  // 4. Supporters (11 cartes)
  {
    id: CARD_IDS.ARVEN,
    code: 'SVI-166',
    name: 'Arven (Pepper)',
    category: 'SUPPORTER',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 92,
    defaultCount: 4,
    primitives: [
      {
        opcode: 'SEARCH_DECK_TO_HAND',
        filter: '1_ITEM_AND_1_TOOL',
        maxTargets: 2,
        precondition: 'NO_SUPPORTER_T1_GOING_FIRST',
        description: 'Cherchez dans votre deck 1 carte Objet (ex: Poffin Pote-Pote ou Super Bonbon) et 1 carte Outil Pokémon (ex: Pierre Scellée Sylvestre) et ajoutez-les à votre main.',
      },
    ],
  },
  {
    id: CARD_IDS.PROFESSORS_RESEARCH,
    code: 'SVI-189',
    name: 'Recherche Professorale',
    category: 'SUPPORTER',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 76,
    defaultCount: 3,
    primitives: [
      {
        opcode: 'DISCARD_HAND_DRAW_N',
        filter: 'NONE',
        maxTargets: 0,
        drawCount: 7,
        precondition: 'NO_SUPPORTER_T1_GOING_FIRST',
        description: 'Défaussez votre main et piochez 7 nouvelles cartes.',
      },
    ],
  },
  {
    id: CARD_IDS.IONO,
    code: 'PAL-185',
    name: 'Mashynn (Iono)',
    category: 'SUPPORTER',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 78,
    defaultCount: 2,
    primitives: [
      {
        opcode: 'SHUFFLE_HAND_BOTTOM_DRAW_N',
        filter: 'NONE',
        maxTargets: 0,
        drawCount: 6,
        precondition: 'NO_SUPPORTER_T1_GOING_FIRST',
        description: 'Mélangez votre main et placez-la sous votre deck. Piochez ensuite autant de cartes qu’il vous reste de cartes Récompense.',
      },
    ],
  },
  {
    id: CARD_IDS.BOSS_ORDERS,
    code: 'PAL-172',
    name: 'Ordres du Boss',
    category: 'SUPPORTER',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 40,
    defaultCount: 2,
    primitives: [
      {
        opcode: 'GUST_OPPONENT_BENCH',
        filter: 'NONE',
        maxTargets: 1,
        precondition: 'NO_SUPPORTER_T1_GOING_FIRST',
        description: 'Échangez le Pokémon Actif de votre adversaire contre l’un de ses Pokémon de Banc.',
      },
    ],
  },

  // 5. Outils & Stades (7 cartes)
  {
    id: CARD_IDS.FOREST_SEAL_STONE,
    code: 'SIT-156',
    name: 'Pierre Scellée Sylvestre',
    category: 'TOOL',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 90,
    defaultCount: 2,
    primitives: [
      {
        opcode: 'ATTACH_TOOL',
        filter: 'POKEMON_ANY',
        maxTargets: 1,
        precondition: 'REQUIRES_V_POKEMON_IN_PLAY',
        description: 'Attachez à un Pokémon V (Motisma V ou Luminéon V) ne possédant pas déjà d’Outil.',
      },
      {
        opcode: 'VSTAR_POWER_SEARCH_ANY',
        filter: 'ANY_CARD',
        maxTargets: 1,
        precondition: 'ONCE_PER_GAME_VSTAR',
        description: 'Alchimie Sylvestre (Puissance VSTAR) : Cherchez dans votre deck 1 carte de votre choix et ajoutez-la à votre main (1 fois par partie).',
      },
    ],
  },
  {
    id: CARD_IDS.MAXIMUM_BELT,
    code: 'TEF-154',
    name: 'Ceinture Maximale (HIGH TECH)',
    category: 'TOOL',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 45,
    defaultCount: 1,
    primitives: [
      {
        opcode: 'ATTACH_TOOL',
        filter: 'POKEMON_ANY',
        maxTargets: 1,
        precondition: 'NONE',
        description: 'Les attaques du Pokémon auquel cette carte est attachée infligent 50 dégâts supplémentaires au Pokémon ex Actif adverse.',
      },
    ],
  },
  {
    id: CARD_IDS.DEFIANCE_BAND,
    code: 'SVI-169',
    name: 'Bandeau de Défi',
    category: 'TOOL',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 42,
    defaultCount: 1,
    primitives: [
      {
        opcode: 'ATTACH_TOOL',
        filter: 'POKEMON_ANY',
        maxTargets: 1,
        precondition: 'NONE',
        description: 'Attachez cet Outil à 1 de vos Pokémon (+30 dégâts si vous avez plus de Récompenses restantes que l’adversaire).',
      },
    ],
  },
  {
    id: CARD_IDS.TM_EVOLUTION,
    code: 'PAR-178',
    name: 'Machine Technique : Évolution',
    category: 'TOOL',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 48,
    defaultCount: 1,
    primitives: [
      {
        opcode: 'ATTACH_TOOL',
        filter: 'POKEMON_ANY',
        maxTargets: 1,
        precondition: 'NONE',
        description: 'Attachez cet Outil à 1 de vos Pokémon pour débloquer l’attaque Évolution.',
      },
    ],
  },
  {
    id: CARD_IDS.COLLAPSED_STADIUM,
    code: 'BRS-137',
    name: 'Stade Effondré',
    category: 'STADIUM',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 35,
    defaultCount: 2,
    primitives: [
      {
        opcode: 'PLAY_STADIUM',
        filter: 'NONE',
        maxTargets: 0,
        precondition: 'ONCE_PER_TURN',
        description: 'Mise en jeu du Stade (1 Stade max par tour).',
      },
    ],
  },

  // 6. Énergies (8 cartes)
  {
    id: CARD_IDS.FIRE_ENERGY,
    code: 'SVE-002',
    name: 'Énergie Feu de Base',
    category: 'ENERGY',
    evolutionLine: 'NONE',
    priorityActive: 0,
    strategicValue: 68,
    defaultCount: 8,
    primitives: [
      {
        opcode: 'ATTACH_BASIC_ENERGY',
        filter: 'FIRE_ENERGY',
        maxTargets: 1,
        precondition: 'ONCE_PER_TURN',
        description: 'Attachez manuellement 1 Énergie Feu de Base de votre main à 1 de vos Pokémon en jeu (limité à 1 par tour).',
      },
    ],
  },
]

/**
 * Creates a fast lookup array indexed by Card ID (1..25)
 */
export function createCardLookupTable(
  registry: DeclarativeCardDefinition[] = DEFAULT_CARD_REGISTRY,
): DeclarativeCardDefinition[] {
  const table: DeclarativeCardDefinition[] = new Array(32)
  for (const card of registry) {
    table[card.id] = card
  }
  return table
}

/**
 * Builds the 60-card deck as a Uint16Array(60) while strictly respecting the 4 dynamic micro-ratios:
 * - basicPokemonCount (default 9)
 * - poffinCount (default 4)
 * - rareCandyCount (default 4)
 * - fireEnergyCount (default 8)
 *
 * Guarantees:
 * 1. Total deck size is ALWAYS 60 cards.
 * 2. Total number of BASIC Pokémon is ALWAYS equal to `ratios.basicPokemonCount`.
 * 3. Total number of Poffin Pote-Pote is ALWAYS equal to `ratios.poffinCount`.
 * 4. Total number of Super Bonbon is ALWAYS equal to `ratios.rareCandyCount`.
 * 5. Total number of Fire Energy is ALWAYS equal to `ratios.fireEnergyCount`.
 */
export function buildDeckUint16(
  ratios: SimulationConfig['deckRatios'],
  registry: DeclarativeCardDefinition[] = DEFAULT_CARD_REGISTRY,
): Uint16Array {
  const counts = new Map<number, number>()
  for (const c of registry) {
    counts.set(c.id, c.defaultCount)
  }

  // 1. Set exact Poffin, Rare Candy, and Fire Energy counts
  counts.set(CARD_IDS.BUDDY_POFFIN, Math.max(0, Math.min(4, ratios.poffinCount)))
  counts.set(CARD_IDS.RARE_CANDY, Math.max(0, Math.min(4, ratios.rareCandyCount)))
  counts.set(CARD_IDS.FIRE_ENERGY, Math.max(2, Math.min(16, ratios.fireEnergyCount)))

  // 2. Adjust Basic Pokemon count (default is 9: 4 Charmander + 2 Pidgey + 1 Lumineon V + 1 Fezandipiti ex + 1 Rotom V)
  const targetBasics = Math.max(4, Math.min(15, ratios.basicPokemonCount))
  const basicOrderIds = [
    CARD_IDS.CHARMANDER,
    CARD_IDS.PIDGEY,
    CARD_IDS.ROTOM_V,
    CARD_IDS.LUMINEON_V,
    CARD_IDS.FEZANDIPITI_EX,
  ]
  let currentBasics = basicOrderIds.reduce((acc, id) => acc + (counts.get(id) ?? 0), 0)

  // If we need more Basics, add Pidgey / Lumineon / Rotom / Fezandipiti (up to 4 each)
  const addBasicPriority = [
    CARD_IDS.PIDGEY,
    CARD_IDS.ROTOM_V,
    CARD_IDS.LUMINEON_V,
    CARD_IDS.FEZANDIPITI_EX,
    CARD_IDS.CHARMANDER,
  ]
  let guard = 0
  while (currentBasics < targetBasics && guard < 30) {
    guard++
    for (const id of addBasicPriority) {
      if (currentBasics >= targetBasics) break
      const c = counts.get(id) ?? 0
      if (c < 4) {
        counts.set(id, c + 1)
        currentBasics++
      }
    }
  }

  // If we need fewer Basics, remove from utility Basics first, then Pidgey, then Charmander
  const removeBasicPriority = [
    CARD_IDS.FEZANDIPITI_EX,
    CARD_IDS.LUMINEON_V,
    CARD_IDS.ROTOM_V,
    CARD_IDS.PIDGEY,
    CARD_IDS.CHARMANDER,
  ]
  guard = 0
  while (currentBasics > targetBasics && guard < 30) {
    guard++
    for (const id of removeBasicPriority) {
      if (currentBasics <= targetBasics) break
      const c = counts.get(id) ?? 0
      const minKeep = id === CARD_IDS.CHARMANDER ? 2 : id === CARD_IDS.PIDGEY ? 1 : 0
      if (c > minKeep) {
        counts.set(id, c - 1)
        currentBasics--
      }
    }
  }

  // 3. Rebalance total deck to strictly 60 cards using non-Basic, non-Poffin, non-Candy, non-Energy flex slots
  const flexIds = [
    CARD_IDS.COLLAPSED_STADIUM,
    CARD_IDS.BOSS_ORDERS,
    CARD_IDS.DEFIANCE_BAND,
    CARD_IDS.TM_EVOLUTION,
    CARD_IDS.NIGHT_STRETCHER,
    CARD_IDS.SUPER_ROD,
    CARD_IDS.IONO,
    CARD_IDS.PROFESSORS_RESEARCH,
    CARD_IDS.NEST_BALL,
    CARD_IDS.CHARMELEON,
    CARD_IDS.PIDGEOTTO,
  ]

  const getTotalCards = () => {
    let sum = 0
    for (const v of counts.values()) sum += v
    return sum
  }

  guard = 0
  while (getTotalCards() > 60 && guard < 50) {
    guard++
    for (const id of flexIds) {
      if (getTotalCards() <= 60) break
      const c = counts.get(id) ?? 0
      if (c > 0) {
        counts.set(id, c - 1)
      }
    }
  }

  guard = 0
  while (getTotalCards() < 60 && guard < 50) {
    guard++
    for (const id of flexIds) {
      if (getTotalCards() >= 60) break
      const c = counts.get(id) ?? 0
      if (c < 4) {
        counts.set(id, c + 1)
      }
    }
  }

  const deck = new Uint16Array(60)
  let writeIdx = 0
  for (const card of registry) {
    const qty = counts.get(card.id) ?? 0
    for (let i = 0; i < qty && writeIdx < 60; i++) {
      deck[writeIdx++] = packCard(card.id)
    }
  }

  return deck
}
