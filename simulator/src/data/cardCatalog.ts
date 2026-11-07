/**
 * Table de résolution et catalogue unifié des cartes (`cardCatalog.ts`).
 * Chargeur universel supportant Array (EngineCardModel[]) et Record ({ cards: { ... } }),
 * avec normalisation déterministe, alias d'extensions et résolution intelligente.
 */

import rawDatabase from './cards_database.json'
import type {
  CardCategory,
  CardFilter,
  CardSubCategory,
  EngineCardModel,
} from '../types/cardModel'
import { normalizeCardModel } from './cardNormalizer'
import { BASIC_ENERGIES, createNativeBasicEnergyModel, detectBasicEnergy, isEnergyCardName } from '../utils/energy'

// Chargeur universel : gère aussi bien un tableau JSON qu'un objet avec clé `cards`
const rawList: any[] = Array.isArray(rawDatabase)
  ? (rawDatabase as any[])
  : rawDatabase && typeof rawDatabase === 'object' && 'cards' in rawDatabase && (rawDatabase as any).cards
  ? Object.values((rawDatabase as any).cards)
  : []

const compiledCards: Record<string, EngineCardModel> = {}

for (const rawCard of rawList) {
  try {
    const normalized = normalizeCardModel(rawCard)
    compiledCards[normalized.cardId] = normalized
  } catch (err) {
    console.warn(`[cardCatalog] Impossible de normaliser la carte:`, err)
  }
}

export function getCompiledCardsCount(): number {
  return Object.keys(compiledCards).length
}

export function hasCompiledCardData(): boolean {
  return getCompiledCardsCount() > 0
}

export function normalizeCardNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Catalogue consolidé : la SEULE source de vérité autorisée est `cards_database.json`
export const UNIFIED_CARD_REGISTRY: Record<string, EngineCardModel> = {
  ...compiledCards,
}

// Alias d'identifiants fréquents vers les modèles compilés de cards_database.json
const CARD_ID_ALIASES: Record<string, string> = {
  'sv01-191': 'sv04-125', // Super Bonbon SVI 191 -> Modèle compilé sv04-125
  'svp-056': 'sv03-125', // Dracaufeu-ex Promo -> sv03-125
  'sv04.5-054': 'sv03-125', // Dracaufeu-ex PAF -> sv03-125
  'sv05-144': 'sv05-144', // Poffin Copain-Copain / Poffin Pote-Pote
  'me02.5-142': 'sv06.5-038', // Favianos-ex ASC -> Favianos-ex
}

const byNormalizedName = new Map<string, { model: EngineCardModel; source: 'compiled_db' }>()

for (const model of Object.values(compiledCards)) {
  const normFr = normalizeCardNameForMatch(model.identity.nameFr)
  byNormalizedName.set(normFr, { model, source: 'compiled_db' })
  if (model.identity.nameEn) {
    byNormalizedName.set(normalizeCardNameForMatch(model.identity.nameEn), {
      model,
      source: 'compiled_db',
    })
  }
}

// Synonymes bilingues courants ciblant les modèles compilés
const NAME_SYNONYMS: Record<string, string> = {
  'poffin pote pote': 'sv05-144',
  'poffin copain copain': 'sv05-144',
  'buddy buddy poffin': 'sv05-144',
  'dracaufeu ex': 'sv03-125',
  'charizard ex': 'sv03-125',
  'roucarnage ex': 'sv03-164',
  'pidgeot ex': 'sv03-164',
  'ire foudre ex': 'sv05-123',
  'raging bolt ex': 'sv05-123',
  'favianos ex': 'sv06.5-038',
  'fezandipiti ex': 'sv06.5-038',
  'super bonbon': 'sv04-125',
  'rare candy': 'sv04-125',
  'faiblo ball': 'sv01-181',
  'nest ball': 'sv01-181',
  'hyper ball': 'sv01-196',
  'ultra ball': 'sv01-196',
  'mashynn': 'sv02-185',
  'iono': 'sv02-185',
  'pepper': 'sv01-166',
  'arven': 'sv01-166',
  'attrape riposte': 'sv04-160',
  'counter catcher': 'sv04-160',
}

export function resolveCardModel(params: {
  cardId: string
  unpaddedCardId?: string
  rawName: string
  categoryHint?: 'pokemon' | 'trainer' | 'energy'
  setId?: string
  setName?: string
  localId?: string
  imageUrl?: string
}): {
  model: EngineCardModel
  source: 'compiled_db' | 'native_basic_energy' | 'unresolved'
} {
  const { cardId, unpaddedCardId, rawName } = params

  // 1. Correspondance directe par ID dans `cards_database.json`
  if (compiledCards[cardId]) {
    return { model: structuredClone(compiledCards[cardId]!), source: 'compiled_db' }
  }
  const aliasedId = CARD_ID_ALIASES[cardId] || (unpaddedCardId ? CARD_ID_ALIASES[unpaddedCardId] : undefined)
  if (aliasedId && compiledCards[aliasedId]) {
    return { model: structuredClone(compiledCards[aliasedId]!), source: 'compiled_db' }
  }

  // 2. Exception native absolue pour les Énergies de Base (pas besoin d'être dans cards_database.json)
  const basicEnergy = detectBasicEnergy(rawName, params.localId)
  if (basicEnergy || (params.categoryHint === 'energy' && detectBasicEnergy(rawName))) {
    const nativeModel = createNativeBasicEnergyModel(rawName, cardId, params.setName, params.localId)
    return { model: nativeModel, source: 'native_basic_energy' }
  }

  // 3. Recherche par synonyme direct dans cards_database.json
  const normName = normalizeCardNameForMatch(rawName)
  const synTargetId = NAME_SYNONYMS[normName]
  if (synTargetId && compiledCards[synTargetId]) {
    return { model: structuredClone(compiledCards[synTargetId]!), source: 'compiled_db' }
  }

  // 4. Recherche par nom FR / EN normalisé dans cards_database.json
  const byNameHit = byNormalizedName.get(normName)
  if (byNameHit) {
    return { model: structuredClone(byNameHit.model), source: 'compiled_db' }
  }

  // 5. Carte non résolue dans la base de données compilée
  return {
    model: synthesizeFallbackModel(params),
    source: 'unresolved',
  }
}

function synthesizeFallbackModel(params: {
  cardId: string
  rawName: string
  categoryHint?: 'pokemon' | 'trainer' | 'energy'
  setId?: string
  setName?: string
  localId?: string
  imageUrl?: string
}): EngineCardModel {
  const { cardId, rawName, categoryHint } = params
  const lower = rawName.toLowerCase()
  const isEnergy = categoryHint === 'energy' || isEnergyCardName(rawName)
  const isTrainer = categoryHint === 'trainer' && !isEnergy

  let category: CardCategory = 'POKEMON'
  let subCategory: CardSubCategory = 'BASIC'

  if (isEnergy) {
    category = 'ENERGY'
    subCategory = detectBasicEnergy(rawName) ? 'BASIC_ENERGY' : 'SPECIAL_ENERGY'
  } else if (isTrainer) {
    category = 'TRAINER'
    if (
      lower.includes('ball') ||
      lower.includes('poffin') ||
      lower.includes('bonbon') ||
      lower.includes('candy') ||
      lower.includes('urne') ||
      lower.includes('vessel') ||
      lower.includes('canne') ||
      lower.includes('rod') ||
      lower.includes('stretcher') ||
      lower.includes('civière')
    ) {
      subCategory = 'ITEM'
    } else if (
      lower.includes('pierre') ||
      lower.includes('stone') ||
      lower.includes('ceinture') ||
      lower.includes('band') ||
      lower.includes('amulette') ||
      lower.includes('charm')
    ) {
      subCategory = 'TOOL'
    } else if (lower.includes('pokéstop') || lower.includes('stade')) {
      subCategory = 'STADIUM'
    } else {
      subCategory = 'SUPPORTER'
    }
  } else {
    category = 'POKEMON'
    subCategory = 'BASIC'
  }

  const isRuleBox = /\b(ex|v|vstar|vmax|radieux|radiant)\b/i.test(rawName)
  const prizes = /\b(ex|v|vstar)\b/i.test(rawName) ? 2 : 1

  const rawModel = {
    cardId,
    identity: {
      cardId,
      nameFr: rawName,
      nameEn: rawName,
      setId: params.setId || 'sv01',
      setName: params.setName || 'Standard',
      localId: params.localId || '001',
      category,
      subCategory,
      regulationMark: 'G',
      legalStandard: true,
      legalExpanded: true,
      rarity: isRuleBox ? 'Double Rare' : 'Commune',
      imageUrl: params.imageUrl || null,
      rawRulesText: [`[Carte Non Résolue] ${rawName}`],
      isRuleBox,
      prizeCardsGiven: prizes,
    },
    pokemonStats:
      category === 'POKEMON'
        ? {
            hp: isRuleBox ? 210 : 80,
            types: ['Incolore'],
            stage: 'Base',
            evolvesFrom: null,
            rootBasicName: rawName,
            evolutionChain: [rawName],
            retreatCost: 1,
            weaknesses: [],
            resistances: [],
            prizeCardsGiven: prizes,
            isRuleBox,
          }
        : null,
    category,
    subCategory,
    playableActions:
      category === 'POKEMON'
        ? [
            {
              actionId: `attack_${cardId.replace(/[^a-z0-9]/gi, '_')}`,
              label: 'Attaque Standard',
              actionType: 'ATTACK',
              timingPhase: 'ATTACK_PHASE',
              canUseTurn1GoingFirst: false,
              canUseTurn1GoingSecond: true,
              cost: { Incolore: 2 },
              preconditions: ['SELF_IS_ACTIVE'],
              effects: [
                {
                  primitive: 'DAMAGE_ACTIVE',
                  target: 'OPPONENT_ACTIVE',
                  value: isRuleBox ? 140 : 50,
                  count: 1,
                  upTo: false,
                  optional: false,
                },
              ],
            },
          ]
        : [],
    strategicEvaluator: {
      aiRole: category === 'ENERGY' ? 'ENERGY_ACCELERATOR' : category === 'TRAINER' ? 'GUEST_TECH' : 'SECONDARY_ATTACKER',
      turnPhaseWeights: { turn1: 1.0, turn2: 1.0, turn3: 1.0, turn4Plus: 1.0 },
      decklistSynergyRequirements: [],
    },
  }

  return normalizeCardModel(rawModel)
}

/**
 * Vérifie si un `EngineCardModel` satisfait un `CardFilter`.
 */
export function matchesCardFilter(card: EngineCardModel, filter?: CardFilter | null): boolean {
  if (!filter) return true

  if (filter.category && card.category !== filter.category) {
    return false
  }
  if (filter.subCategory && card.subCategory !== filter.subCategory) {
    return false
  }
  if (filter.maxHp !== null && filter.maxHp !== undefined) {
    if (!card.pokemonStats || card.pokemonStats.hp > filter.maxHp) {
      return false
    }
  }
  if (filter.minHp !== null && filter.minHp !== undefined) {
    if (!card.pokemonStats || card.pokemonStats.hp < filter.minHp) {
      return false
    }
  }
  if (filter.energyType) {
    const reqType = normalizeCardNameForMatch(filter.energyType)
    if (reqType !== 'incolore' && reqType !== 'colorless') {
      if (card.category === 'ENERGY') {
        const cardNameNorm = normalizeCardNameForMatch(card.identity.nameFr + ' ' + (card.identity.nameEn || ''))
        const isLuminous = card.subCategory === 'SPECIAL_ENERGY' && cardNameNorm.includes('lumineuse')
        if (!isLuminous) {
          const basic = detectBasicEnergy(card.identity.nameFr) || detectBasicEnergy(card.identity.nameEn || '')
          const cardTypeNorm = basic
            ? normalizeCardNameForMatch(basic.energyTypeFr)
            : normalizeCardNameForMatch(cardNameNorm)
          const targetTypeNorm = normalizeCardNameForMatch(reqType)

          const typeAliases: Record<string, string[]> = {
            feu: ['fire', 'feu'],
            plante: ['grass', 'plante'],
            eau: ['water', 'eau'],
            electrique: ['lightning', 'electrik', 'electrique'],
            psy: ['psychic', 'psy'],
            combat: ['fighting', 'combat'],
            obscurite: ['darkness', 'obscurite'],
            metal: ['metal'],
            fee: ['fairy', 'fee'],
          }
          const targetAliases = typeAliases[targetTypeNorm] || [targetTypeNorm]
          const matches = targetAliases.some(
            (al) => cardTypeNorm.includes(al) || cardNameNorm.includes(al),
          )
          if (!matches) {
            return false
          }
        }
      } else if (card.pokemonStats) {
        const pokeTypes = card.pokemonStats.types.map((t) => normalizeCardNameForMatch(t))
        if (!pokeTypes.includes(reqType)) {
          return false
        }
      }
    }
  }
  if (filter.specificCardName) {
    const targetNorm = normalizeCardNameForMatch(filter.specificCardName)
    const frNorm = normalizeCardNameForMatch(card.identity.nameFr)
    const enNorm = card.identity.nameEn ? normalizeCardNameForMatch(card.identity.nameEn) : ''
    const rootNorm = card.pokemonStats?.rootBasicName
      ? normalizeCardNameForMatch(card.pokemonStats.rootBasicName)
      : ''
    if (
      frNorm !== targetNorm &&
      enNorm !== targetNorm &&
      rootNorm !== targetNorm &&
      !frNorm.includes(targetNorm) &&
      !enNorm.includes(targetNorm)
    ) {
      return false
    }
  }
  if (filter.isRuleBox !== null && filter.isRuleBox !== undefined) {
    const ruleBox = Boolean(card.identity.isRuleBox || card.pokemonStats?.isRuleBox)
    if (ruleBox !== filter.isRuleBox) {
      return false
    }
  }
  if (filter.isEvolution !== null && filter.isEvolution !== undefined) {
    const isEvo = card.subCategory === 'STAGE_1' || card.subCategory === 'STAGE_2'
    if (isEvo !== filter.isEvolution) {
      return false
    }
  }
  if (filter.isFuture !== null && filter.isFuture !== undefined) {
    const isFuture = Boolean(
      card.pokemonStats?.isFuture || card.identity.isFuture || card.identity.mechanicTag === 'FUTURE',
    )
    if (isFuture !== filter.isFuture) {
      return false
    }
  }
  if (filter.isAncient !== null && filter.isAncient !== undefined) {
    const isAncient = Boolean(
      card.pokemonStats?.isAncient || card.identity.isAncient || card.identity.mechanicTag === 'ANCIENT',
    )
    if (isAncient !== filter.isAncient) {
      return false
    }
  }
  if (filter.isTera !== null && filter.isTera !== undefined) {
    const isTera = Boolean(card.pokemonStats?.isTera || card.identity.isTera)
    if (isTera !== filter.isTera) {
      return false
    }
  }
  if (filter.hasAbility !== null && filter.hasAbility !== undefined) {
    const hasAbil = Boolean(
      card.pokemonStats?.hasAbility ||
        card.playableActions.some((a) => a.actionType === 'USE_ABILITY'),
    )
    if (hasAbil !== filter.hasAbility) {
      return false
    }
  }
  if (filter.maxRetreatCost !== null && filter.maxRetreatCost !== undefined) {
    if (!card.pokemonStats || card.pokemonStats.retreatCost > filter.maxRetreatCost) {
      return false
    }
  }

  return true
}

/**
 * Retourne la liste complète de tous les modèles du catalogue (pour l'ajout de cartes dans l'éditeur A/B).
 */
export function getAllCatalogModels(): EngineCardModel[] {
  const map = new Map<string, EngineCardModel>()
  for (const model of Object.values(compiledCards)) {
    map.set(model.cardId, model)
  }
  for (const energy of BASIC_ENERGIES) {
    const energyModel = createNativeBasicEnergyModel(energy.nameEn)
    if (!map.has(energyModel.cardId)) {
      map.set(energyModel.cardId, energyModel)
    }
  }
  return Array.from(map.values())
}
