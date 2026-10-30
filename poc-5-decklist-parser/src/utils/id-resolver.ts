/**
 * Résolveur d'identifiants TCGdex & constructeur du schéma `identity` cible
 */

import mappingData from '../data/mapping_ptcgl_to_tcgdex.json'
import type { MappingDatabase, SetMappingEntry } from '../types/tcgdex-mapping'
import type { CardCategory, ParsedCard, UserCardIdentity } from '../types/deck'
import { aliasSetCode } from './set-aliases'
import { detectBasicEnergy, isEnergyCardName } from './energy'

const db = mappingData as unknown as MappingDatabase

interface CardLexiconEntry {
  nameFr: string
  nameEn: string
  category?: CardCategory
  subCategory: string
  regulationMark?: string
  rarity?: string
  rulesFr?: string
  rulesEn?: string
}

/**
 * Dictionnaire bilingue FR <-> EN des cartes compétitives fréquentes
 * Permet d'enrichir automatiquement `nameFr`, `nameEn`, `subCategory` et `rawRulesText`
 */
const COMPETITIVE_LEXICON: CardLexiconEntry[] = [
  {
    nameFr: 'Pepper',
    nameEn: 'Arven',
    category: 'trainer',
    subCategory: 'SUPPORTER',
    regulationMark: 'G',
    rarity: 'Peu Commune',
    rulesFr: '[Effet FR] Cherchez dans votre deck une carte Objet et une carte Outil Pokémon, montrez-les, puis ajoutez-les à votre main. Mélangez ensuite votre deck.',
    rulesEn: '[Effect EN] Search your deck for an Item card and a Pokémon Tool card, reveal them, and put them into your hand. Then, shuffle your deck.',
  },
  {
    nameFr: 'Mashynn',
    nameEn: 'Iono',
    category: 'trainer',
    subCategory: 'SUPPORTER',
    regulationMark: 'G',
    rarity: 'Peu Commune',
    rulesFr: '[Effet FR] Chaque joueur mélange sa main et la place sous son deck. Ensuite, chaque joueur pioche une carte pour chacune de ses cartes Récompense restantes.',
    rulesEn: '[Effect EN] Each player shuffles their hand and puts it on the bottom of their deck. Then, each player draws a card for each of their remaining Prize cards.',
  },
  {
    nameFr: 'Ordres du Boss',
    nameEn: "Boss's Orders",
    category: 'trainer',
    subCategory: 'SUPPORTER',
    regulationMark: 'G',
    rarity: 'Rare',
    rulesFr: '[Effet FR] Envoyez l\'un des Pokémon de Banc de votre adversaire sur le Poste Actif.',
    rulesEn: '[Effect EN] Switch in 1 of your opponent\'s Benched Pokémon to the Active Spot.',
  },
  {
    nameFr: 'Recherches Professorales',
    nameEn: "Professor's Research",
    category: 'trainer',
    subCategory: 'SUPPORTER',
    regulationMark: 'G',
    rarity: 'Rare',
    rulesFr: '[Effet FR] Défaussez votre main, puis piochez 7 cartes.',
    rulesEn: '[Effect EN] Discard your hand and draw 7 cards.',
  },
  {
    nameFr: 'Plan du Professeur Turum',
    nameEn: "Professor Turo's Scenario",
    category: 'trainer',
    subCategory: 'SUPPORTER',
    regulationMark: 'G',
    rarity: 'Peu Commune',
    rulesFr: '[Effet FR] Placez l\'un de vos Pokémon en jeu dans votre main. Défaussez toutes les cartes attachées à ce Pokémon.',
    rulesEn: '[Effect EN] Put 1 of your Pokémon in play into your hand. (Discard all attached cards.)',
  },
  {
    nameFr: 'Vitalité de la Professeure Olim',
    nameEn: "Professor Sada's Vitality",
    category: 'trainer',
    subCategory: 'SUPPORTER',
    regulationMark: 'G',
    rarity: 'Peu Commune',
  },
  {
    nameFr: 'Poffin Pote-Pote',
    nameEn: 'Buddy-Buddy Poffin',
    category: 'trainer',
    subCategory: 'ITEM',
    regulationMark: 'H',
    rarity: 'Peu Commune',
    rulesFr: '[Effet FR] Cherchez dans votre deck jusqu\'à 2 Pokémon de base ayant 70 PV ou moins et placez-les sur votre Banc. Mélangez ensuite votre deck.',
    rulesEn: '[Effect EN] Search your deck for up to 2 Basic Pokémon with 70 HP or less and put them onto your Bench. Then, shuffle your deck.',
  },
  {
    nameFr: 'Hyper Ball',
    nameEn: 'Ultra Ball',
    category: 'trainer',
    subCategory: 'ITEM',
    regulationMark: 'G',
    rarity: 'Peu Commune',
    rulesFr: '[Effet FR] Défaussez 2 cartes de votre main. Cherchez dans votre deck un Pokémon, montrez-le, puis ajoutez-le à votre main.',
    rulesEn: '[Effect EN] Discard 2 cards from your hand. Search your deck for a Pokémon, reveal it, and put it into your hand.',
  },
  {
    nameFr: 'Faiblo Ball',
    nameEn: 'Nest Ball',
    category: 'trainer',
    subCategory: 'ITEM',
    regulationMark: 'G',
    rarity: 'Peu Commune',
    rulesFr: '[Effet FR] Cherchez dans votre deck un Pokémon de base et placez-le sur votre Banc.',
    rulesEn: '[Effect EN] Search your deck for a Basic Pokémon and put it onto your Bench.',
  },
  {
    nameFr: 'Super Bonbon',
    nameEn: 'Rare Candy',
    category: 'trainer',
    subCategory: 'ITEM',
    regulationMark: 'G',
    rarity: 'Peu Commune',
    rulesFr: '[Effet FR] Choisissez l\'un de vos Pokémon de base en jeu et faites-le évoluer directement en Pokémon de Niveau 2 depuis votre main.',
    rulesEn: '[Effect EN] Choose 1 of your Basic Pokémon in play and evolve it into a Stage 2 Pokémon from your hand.',
  },
  {
    nameFr: 'Civière Nocturne',
    nameEn: 'Night Stretcher',
    category: 'trainer',
    subCategory: 'ITEM',
    regulationMark: 'H',
    rarity: 'Peu Commune',
    rulesFr: '[Effet FR] Placez un Pokémon ou une carte Énergie de base de votre pile de défausse dans votre main.',
    rulesEn: '[Effect EN] Put a Pokémon or a Basic Energy card from your discard pile into your hand.',
  },
  {
    nameFr: 'Canne Ordinaire',
    nameEn: 'Super Rod',
    category: 'trainer',
    subCategory: 'ITEM',
    regulationMark: 'G',
    rarity: 'Peu Commune',
  },
  {
    nameFr: 'Attrape-Suprême',
    nameEn: 'Prime Catcher',
    category: 'trainer',
    subCategory: 'ITEM_ACE_SPEC',
    regulationMark: 'H',
    rarity: 'ACE SPEC Rare',
  },
  {
    nameFr: 'Tampon Injuste',
    nameEn: 'Unfair Stamp',
    category: 'trainer',
    subCategory: 'ITEM_ACE_SPEC',
    regulationMark: 'H',
    rarity: 'ACE SPEC Rare',
  },
  {
    nameFr: 'Tambour Éveillé',
    nameEn: 'Awakening Drum',
    category: 'trainer',
    subCategory: 'ITEM_ACE_SPEC',
    regulationMark: 'H',
    rarity: 'ACE SPEC Rare',
  },
  {
    nameFr: 'Attrape-Riposte',
    nameEn: 'Counter Catcher',
    category: 'trainer',
    subCategory: 'ITEM',
    regulationMark: 'G',
    rarity: 'Peu Commune',
  },
  {
    nameFr: 'Urne Terrestre',
    nameEn: 'Earthen Vessel',
    category: 'trainer',
    subCategory: 'ITEM',
    regulationMark: 'G',
    rarity: 'Peu Commune',
  },
  {
    nameFr: 'Aspirateur Perdu',
    nameEn: 'Lost Vacuum',
    category: 'trainer',
    subCategory: 'ITEM',
    regulationMark: 'F',
    rarity: 'Peu Commune',
  },
  {
    nameFr: 'Échange',
    nameEn: 'Switch',
    category: 'trainer',
    subCategory: 'ITEM',
    regulationMark: 'G',
    rarity: 'Commune',
  },
  {
    nameFr: 'Ceinture Vitalité',
    nameEn: 'Vitality Band',
    category: 'trainer',
    subCategory: 'TOOL',
    regulationMark: 'G',
    rarity: 'Peu Commune',
  },
  {
    nameFr: 'Pierre Scellée Sylvestre',
    nameEn: 'Forest Seal Stone',
    category: 'trainer',
    subCategory: 'TOOL',
    regulationMark: 'F',
    rarity: 'Rare Holo',
  },
  {
    nameFr: 'Salamèche',
    nameEn: 'Charmander',
    category: 'pokemon',
    subCategory: 'BASIC',
    regulationMark: 'G',
    rarity: 'Commune',
  },
  {
    nameFr: 'Reptincel',
    nameEn: 'Charmeleon',
    category: 'pokemon',
    subCategory: 'STAGE_1',
    regulationMark: 'G',
    rarity: 'Peu Commune',
  },
  {
    nameFr: 'Dracaufeu ex',
    nameEn: 'Charizard ex',
    category: 'pokemon',
    subCategory: 'STAGE_2_EX',
    regulationMark: 'G',
    rarity: 'Double Rare',
  },
  {
    nameFr: 'Roucool',
    nameEn: 'Pidgey',
    category: 'pokemon',
    subCategory: 'BASIC',
    regulationMark: 'G',
    rarity: 'Commune',
  },
  {
    nameFr: 'Roucarnage ex',
    nameEn: 'Pidgeot ex',
    category: 'pokemon',
    subCategory: 'STAGE_2_EX',
    regulationMark: 'G',
    rarity: 'Double Rare',
  },
  {
    nameFr: 'Motisma V',
    nameEn: 'Rotom V',
    category: 'pokemon',
    subCategory: 'BASIC_V',
    regulationMark: 'F',
    rarity: 'Ultra Rare',
  },
  {
    nameFr: 'Luminéon V',
    nameEn: 'Lumineon V',
    category: 'pokemon',
    subCategory: 'BASIC_V',
    regulationMark: 'F',
    rarity: 'Ultra Rare',
  },
  {
    nameFr: 'Tapatoès ex',
    nameEn: 'Squawkabilly ex',
    category: 'pokemon',
    subCategory: 'BASIC_EX',
    regulationMark: 'G',
    rarity: 'Double Rare',
  },
  {
    nameFr: 'Amphinobi Radieux',
    nameEn: 'Radiant Greninja',
    category: 'pokemon',
    subCategory: 'BASIC_RADIANT',
    regulationMark: 'F',
    rarity: 'Radieux Rare',
  },
  {
    nameFr: 'Baojian ex',
    nameEn: 'Chien-Pao ex',
    category: 'pokemon',
    subCategory: 'BASIC_EX',
    regulationMark: 'G',
    rarity: 'Double Rare',
  },
  {
    nameFr: 'Frigodo',
    nameEn: 'Frigibax',
    category: 'pokemon',
    subCategory: 'BASIC',
    regulationMark: 'G',
    rarity: 'Commune',
  },
  {
    nameFr: 'glaivodo',
    nameEn: 'Baxcalibur',
    category: 'pokemon',
    subCategory: 'STAGE_2',
    regulationMark: 'G',
    rarity: 'Rare Holo',
  },
  {
    nameFr: 'Rugit-Lune ex',
    nameEn: 'Roaring Moon ex',
    category: 'pokemon',
    subCategory: 'BASIC_EX',
    regulationMark: 'G',
    rarity: 'Double Rare',
  },
  {
    nameFr: 'Tarsal',
    nameEn: 'Ralts',
    category: 'pokemon',
    subCategory: 'BASIC',
    regulationMark: 'G',
    rarity: 'Commune',
  },
  {
    nameFr: 'Kirlia',
    nameEn: 'Kirlia',
    category: 'pokemon',
    subCategory: 'STAGE_1',
    regulationMark: 'F',
    rarity: 'Peu Commune',
  },
  {
    nameFr: 'Gardevoir ex',
    nameEn: 'Gardevoir ex',
    category: 'pokemon',
    subCategory: 'STAGE_2_EX',
    regulationMark: 'G',
    rarity: 'Double Rare',
  },
]

export function lookupSetMapping(setCode: string | undefined): SetMappingEntry | undefined {
  if (!setCode) return undefined
  const upper = setCode.toUpperCase()
  if (db.byPtcglCode[upper]) {
    return db.byPtcglCode[upper]
  }
  const aliasId = aliasSetCode(upper) || db.setCodeAliases[upper]
  if (aliasId && db.byTcgdexId[aliasId.toLowerCase()]) {
    return db.byTcgdexId[aliasId.toLowerCase()]
  }
  if (db.byTcgdexId[upper.toLowerCase()]) {
    return db.byTcgdexId[upper.toLowerCase()]
  }
  return undefined
}

export function padLocalNumber(rawNumber: string, setId: string): string {
  const trimmed = rawNumber.trim()
  // Si alphanumérique (ex: GG14, TG01, SWSH098), on le conserve tel quel
  if (!/^\d+$/.test(trimmed)) {
    return trimmed
  }
  const num = parseInt(trimmed, 10)
  // Les sets SV, SWSH, SVE, SVP utilisent un padding sur 3 chiffres dans TCGdex ("004", "166")
  if (setId.startsWith('sv') || setId.startsWith('swsh')) {
    return String(num).padStart(3, '0')
  }
  return String(num)
}

export function stripLeadingZeros(rawNumber: string): string {
  const trimmed = rawNumber.trim()
  if (/^\d+$/.test(trimmed)) {
    return String(parseInt(trimmed, 10))
  }
  return trimmed
}

function findLexiconMatch(rawName: string): CardLexiconEntry | undefined {
  const lower = rawName.toLowerCase().trim()
  // Clean parenthesized suffix like "Arven (SVI)" or "Professeur Turum"
  const baseLower = lower.replace(/\s*\([^)]*\)\s*/g, '').trim()

  for (const entry of COMPETITIVE_LEXICON) {
    const fr = entry.nameFr.toLowerCase()
    const en = entry.nameEn.toLowerCase()
    if (lower === fr || lower === en || baseLower === fr || baseLower === en) {
      return entry
    }
    if (lower.includes(fr) || lower.includes(en)) {
      return entry
    }
  }
  return undefined
}

function inferSubCategory(name: string, category: CardCategory, lexicon?: CardLexiconEntry): string {
  if (lexicon?.subCategory) return lexicon.subCategory
  const lower = name.toLowerCase()
  if (category === 'energy') {
    return detectBasicEnergy(name) ? 'BASIC_ENERGY' : 'SPECIAL_ENERGY'
  }
  if (category === 'trainer') {
    if (lower.includes('ball') || lower.includes('poffin') || lower.includes('bonbon') || lower.includes('candy') || lower.includes('stretcher') || lower.includes('civière') || lower.includes('canne') || lower.includes('rod') || lower.includes('vessel') || lower.includes('urne') || lower.includes('switch') || lower.includes('échange') || lower.includes('catcher') || lower.includes('attrape')) {
      return 'ITEM'
    }
    if (lower.includes('stade') || lower.includes('stadium') || lower.includes('artazon') || lower.includes('pokéstop') || lower.includes('pokestop')) {
      return 'STADIUM'
    }
    if (lower.includes('band') || lower.includes('ceinture') || lower.includes('stone') || lower.includes('pierre') || lower.includes('machine') || lower.includes('cape') || lower.includes('charm') || lower.includes('amulette')) {
      return 'TOOL'
    }
    return 'SUPPORTER'
  }
  if (lower.includes(' ex')) return 'POKEMON_EX'
  if (lower.includes(' vstar')) return 'POKEMON_VSTAR'
  if (lower.includes(' vmax')) return 'POKEMON_VMAX'
  if (lower.includes(' v')) return 'POKEMON_V'
  if (lower.includes('radieux') || lower.includes('radiant')) return 'RADIANT_POKEMON'
  return 'POKEMON'
}

export interface ResolveCardInput {
  quantity: number
  rawName: string
  setCode?: string
  number?: string
  foil?: string
  categoryHint?: CardCategory
  line: number
  rawLine: string
}

export function resolveParsedCard(input: ResolveCardInput): ParsedCard {
  let setCode = input.setCode?.toUpperCase() || 'SVI'
  let rawNumber = input.number || '1'

  // Vérification si c'est une énergie de base
  const basicEnergy = detectBasicEnergy(input.rawName, rawNumber)
  if (basicEnergy && (!input.setCode || /^energy$/i.test(input.setCode) || setCode === 'SVE')) {
    setCode = 'SVE'
    if (!input.number || parseInt(rawNumber, 10) > 16) {
      rawNumber = basicEnergy.sveNumber
    }
  }

  const mapping = lookupSetMapping(setCode)
  const isMapped = Boolean(mapping)
  const setId = mapping ? mapping.setId : setCode.toLowerCase()
  const serie = mapping ? mapping.serie : (setId.startsWith('swsh') ? 'swsh' : 'sv')
  const setName = mapping ? mapping.nameFr : setCode

  const cleanNumber = stripLeadingZeros(rawNumber)
  const paddedNumber = padLocalNumber(cleanNumber, setId)

  // Le cardId TCGdex utilise le numéro padé (ex: sv01-166, sv03.5-004, sve-002)
  const cardId = `${setId}-${paddedNumber}`
  const unpaddedCardId = `${setId}-${cleanNumber}`
  const ptcglId = `${setCode}-${cleanNumber}`

  const lexicon = findLexiconMatch(input.rawName)

  // Détermination de la catégorie
  let category: CardCategory = input.categoryHint || 'pokemon'
  if (basicEnergy || isEnergyCardName(input.rawName) || setCode === 'SVE') {
    category = 'energy'
  } else if (lexicon?.category) {
    category = lexicon.category
  }

  const nameFr = basicEnergy
    ? basicEnergy.nameFr
    : lexicon
      ? lexicon.nameFr
      : input.rawName

  const nameEn = basicEnergy
    ? basicEnergy.nameEn
    : lexicon
      ? lexicon.nameEn
      : input.rawName

  const subCategory = inferSubCategory(input.rawName, category, lexicon)
  const imageUrl = `https://assets.tcgdex.net/fr/${serie}/${setId}/${paddedNumber}`

  const isAceSpec =
    subCategory.includes('ACE_SPEC') ||
    /attrape-suprême|prime catcher|tampon injuste|unfair stamp|tambour éveillé|awakening drum|secret box|chariot précieux|precious trolley/i.test(
      input.rawName,
    )
  const isRadiant = /radieux|radiant/i.test(input.rawName)
  const isEx = /\bex\b/i.test(input.rawName)

  const upperCategory: 'POKEMON' | 'TRAINER' | 'ENERGY' =
    category === 'pokemon' ? 'POKEMON' : category === 'trainer' ? 'TRAINER' : 'ENERGY'

  const identity: UserCardIdentity = {
    cardId,
    nameFr,
    nameEn,
    setId,
    setName,
    localId: paddedNumber,
    category: upperCategory,
    subCategory,
    regulationMark: lexicon?.regulationMark || (serie === 'sv' ? 'G' : 'F'),
    legalStandard: mapping ? mapping.legalStandard : true,
    legalExpanded: mapping ? mapping.legalExpanded : true,
    rarity: lexicon?.rarity || (isAceSpec ? 'ACE SPEC Rare' : isEx ? 'Double Rare' : 'Peu Commune'),
    imageUrl,
    rawRulesText:
      lexicon?.rulesFr && lexicon?.rulesEn
        ? [lexicon.rulesFr, lexicon.rulesEn]
        : [
            `[Effet FR] Carte ${nameFr} (${setName} #${paddedNumber}).`,
            `[Effect EN] Card ${nameEn} (${mapping?.nameEn || setCode} #${paddedNumber}).`,
          ],
  }

  return {
    uid: `${cardId}_${input.line}`,
    quantity: input.quantity,
    name: input.rawName,
    nameFr,
    nameEn,
    setCode: mapping ? mapping.ptcglCode : setCode,
    number: cleanNumber,
    paddedNumber,
    foil: input.foil,
    category,
    subCategory,
    setId,
    setName,
    serie,
    cardId,
    unpaddedCardId,
    ptcglId,
    imageUrl,
    isMapped,
    isAceSpec,
    isRadiant,
    isEx,
    line: input.line,
    raw: input.rawLine,
    identity,
  }
}

export function getAllMappedSets(): SetMappingEntry[] {
  return Object.values(db.byTcgdexId)
}
