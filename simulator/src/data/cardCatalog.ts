/**
 * Table de résolution et catalogue unifié des cartes (`cardCatalog.ts`).
 * Combine `cards_database.json` (11 cartes compilées de référence) et `fallbackCardModels.ts`,
 * avec résolution intelligente par ID (`sv03-125`), variante non-paddée (`sv03.5-4`),
 * alias d'extension (ex: `sv01-191` <-> `sv04-125` pour Super Bonbon) et nom FR/EN normalisé.
 */

import rawDatabase from './cards_database.json'
import { FALLBACK_CARD_MODELS } from './fallbackCardModels'
import type {
  CardCategory,
  CardFilter,
  CardSubCategory,
  ConsolidatedCardsDatabase,
  EngineCardModel,
} from '../types/cardModel'
import { detectBasicEnergy, isEnergyCardName } from '../utils/energy'

const compiledDb = (rawDatabase || {}) as unknown as ConsolidatedCardsDatabase
const compiledCards: Record<string, EngineCardModel> =
  compiledDb && typeof compiledDb === 'object' && compiledDb.cards ? compiledDb.cards : {}

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

// Catalogue consolidé : `cards_database.json` est prioritaire, complété par `FALLBACK_CARD_MODELS`
export const UNIFIED_CARD_REGISTRY: Record<string, EngineCardModel> = {
  ...FALLBACK_CARD_MODELS,
  ...compiledCards,
}

// Alias d'identifiants fréquents entre extensions PTCGL (ex: réimpressions ou promos)
const CARD_ID_ALIASES: Record<string, string> = {
  'sv01-191': 'sv04-125', // Super Bonbon SVI 191 -> Modèle compilé sv04-125
  'svp-056': 'sv03-125',  // Dracaufeu-ex Promo -> sv03-125
  'sv04.5-054': 'sv03-125', // Dracaufeu-ex PAF -> sv03-125
  'sv03-026': 'sv03.5-004', // Salamèche OBF -> Salamèche
  'sv04.5-007': 'sv03.5-004', // Salamèche PAF -> Salamèche
  'sv04.5-008': 'sv03-027', // Reptincel PAF -> Reptincel
  'sv03-162': 'sv03.5-016', // Roucool OBF -> Roucool
  'sv01-084': 'swsh10-060', // Tarsal SVI -> Tarsal
  'me02.5-142': 'sv06.5-038', // Favianos-ex ASC -> Favianos-ex
  'me02.5-196': 'sv06.5-061', // Civière Nocturne ASC -> Civière Nocturne
  'me01-114': 'sv02-172', // Ordres du Boss MEG -> Ordres du Boss
  'me01-132': 'sv01-189', // Recherches Professorales -> sv01-189
  'sv05-144': 'sv05-144', // Poffin Copain-Copain / Poffin Pote-Pote
}

const byNormalizedName = new Map<string, { model: EngineCardModel; source: 'compiled_db' | 'fallback_registry' }>()

// Indexation initiale
for (const model of Object.values(FALLBACK_CARD_MODELS)) {
  const normFr = normalizeCardNameForMatch(model.identity.nameFr)
  byNormalizedName.set(normFr, { model, source: 'fallback_registry' })
  if (model.identity.nameEn) {
    byNormalizedName.set(normalizeCardNameForMatch(model.identity.nameEn), {
      model,
      source: 'fallback_registry',
    })
  }
  // Variantes avec/sans tiret avant "ex"
  byNormalizedName.set(normFr.replace(/\s+ex$/, ' ex'), { model, source: 'fallback_registry' })
}

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

// Synonymes bilingues courants (ex: "Poffin Pote-Pote" <-> "Poffin Copain-Copain", "Canne Ordinaire" <-> "Méga Canne")
const NAME_SYNONYMS: Record<string, string> = {
  'poffin pote pote': 'sv05-144',
  'poffin copain copain': 'sv05-144',
  'buddy buddy poffin': 'sv05-144',
  'canne ordinaire': 'sv02-188',
  'mega canne': 'sv02-188',
  'super rod': 'sv02-188',
  'recherche professorale': 'sv01-189',
  'recherches professorales': 'sv01-189',
  'professors research': 'sv01-189',
  'ordres du boss': 'sv02-172',
  'bosss orders': 'sv02-172',
  'dracaufeu ex': 'sv03-125',
  'charizard ex': 'sv03-125',
  'roucarnage ex': 'sv03-164',
  'pidgeot ex': 'sv03-164',
  'ire foudre ex': 'sv05-123',
  'raging bolt ex': 'sv05-123',
  'favianos ex': 'sv06.5-038',
  'fezandipiti ex': 'sv06.5-038',
  'ogerpon masque turquoise ex': 'sv06-025',
  'ogerpon ex': 'sv06-025',
  'teal mask ogerpon ex': 'sv06-025',
  'lanssorien ex': 'sv06-130',
  'dragapult ex': 'sv06-130',
  'gardevoir ex': 'sv01-086',
  'tapatoes ex': 'sv02-169',
  'squawkabilly ex': 'sv02-169',
  'pelage sable ex': 'sv04-123',
  'sandy shocks ex': 'sv04-123',
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
  source: 'compiled_db' | 'fallback_registry' | 'synthesized'
} {
  const { cardId, unpaddedCardId, rawName } = params

  // 1. Correspondance directe par ID dans `cards_database.json`
  if (compiledDb.cards[cardId]) {
    return { model: structuredClone(compiledDb.cards[cardId]!), source: 'compiled_db' }
  }
  const aliasedId = CARD_ID_ALIASES[cardId] || (unpaddedCardId ? CARD_ID_ALIASES[unpaddedCardId] : undefined)
  if (aliasedId && compiledDb.cards[aliasedId]) {
    return { model: structuredClone(compiledDb.cards[aliasedId]!), source: 'compiled_db' }
  }

  // 2. Correspondance directe par ID dans `fallbackCardModels.ts`
  if (FALLBACK_CARD_MODELS[cardId]) {
    return { model: structuredClone(FALLBACK_CARD_MODELS[cardId]!), source: 'fallback_registry' }
  }
  if (aliasedId && FALLBACK_CARD_MODELS[aliasedId]) {
    return { model: structuredClone(FALLBACK_CARD_MODELS[aliasedId]!), source: 'fallback_registry' }
  }

  // 3. Vérification si c'est une énergie de base
  const basicEnergy = detectBasicEnergy(rawName, params.localId)
  if (basicEnergy) {
    const sveId = `sve-${basicEnergy.sveNumber.padStart(3, '0')}`
    if (FALLBACK_CARD_MODELS[sveId]) {
      return { model: structuredClone(FALLBACK_CARD_MODELS[sveId]!), source: 'fallback_registry' }
    }
  }

  // 4. Recherche par synonyme ou nom normalisé FR / EN
  const normName = normalizeCardNameForMatch(rawName)
  const synTargetId = NAME_SYNONYMS[normName]
  if (synTargetId) {
    if (compiledDb.cards[synTargetId]) {
      return { model: structuredClone(compiledDb.cards[synTargetId]!), source: 'compiled_db' }
    }
    if (FALLBACK_CARD_MODELS[synTargetId]) {
      return { model: structuredClone(FALLBACK_CARD_MODELS[synTargetId]!), source: 'fallback_registry' }
    }
  }

  const byNameHit = byNormalizedName.get(normName)
  if (byNameHit) {
    return { model: structuredClone(byNameHit.model), source: byNameHit.source }
  }

  // 5. Synthèse intelligente de secours garantissant qu'aucune carte exotique ne plante le moteur
  return {
    model: synthesizeFallbackModel(params),
    source: 'synthesized',
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
    if (lower.includes('ball') || lower.includes('poffin') || lower.includes('bonbon') || lower.includes('candy') || lower.includes('urne') || lower.includes('vessel') || lower.includes('canne') || lower.includes('rod') || lower.includes('stretcher') || lower.includes('civière')) {
      subCategory = 'ITEM'
    } else if (lower.includes('pierre') || lower.includes('stone') || lower.includes('ceinture') || lower.includes('band') || lower.includes('amulette') || lower.includes('charm')) {
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

  return {
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
      rawRulesText: [`[Carte Synthétisée] ${rawName}`],
    },
    pokemonStats:
      category === 'POKEMON'
        ? {
            hp: isRuleBox ? 210 : 80,
            types: ['Incolore'],
            stage: 'De base',
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
              sourceType: 'ATTACK',
              timing: 'END_OF_TURN_ATTACK',
              canUseTurn1GoingFirst: false,
              canUseTurn1GoingSecond: true,
              preconditions: [
                { type: 'SELF_IS_ACTIVE', zone: 'ACTIVE', minCount: 1, targetFilter: null },
                {
                  type: 'SELF_HAS_ENERGY_COST',
                  zone: 'ACTIVE',
                  minCount: 2,
                  targetFilter: { category: 'ENERGY', energyType: 'Incolore' },
                },
              ],
              costs: [],
              effects: [
                {
                  primitive: 'DEAL_DAMAGE_ACTIVE',
                  sourceZone: 'ACTIVE',
                  targetZone: 'ACTIVE',
                  count: 1,
                  upTo: false,
                  targetFilter: null,
                  baseDamage: isRuleBox ? 140 : 50,
                  damageScalingPerOpponentPrizeTaken: null,
                },
              ],
            },
          ]
        : [],
    strategicEvaluator: {
      primaryRole: category === 'ENERGY' ? 'RESOURCE_ENERGY' : category === 'TRAINER' ? 'TECH_UTILITY' : 'SECONDARY_ATTACKER',
      intrinsicBaseScore: 70,
      turnPhaseWeights: { turn1: 1.0, turn2: 1.0, turn3: 1.0, turn4Plus: 1.0 },
      decklistSynergyRequirements: [],
      inGameDeadCardConditions: [],
      discardPriorityWhenDead: 65,
      holdForNextTurnBonus: 15,
    },
  }
}

/**
 * Vérifie si un `EngineCardModel` satisfait un `CardFilter` issu de `cards_database.json`.
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
  if (filter.energyType) {
    const reqType = normalizeCardNameForMatch(filter.energyType)
    if (reqType !== 'incolore' && reqType !== 'colorless') {
      if (card.category === 'ENERGY') {
        const cardNameNorm = normalizeCardNameForMatch(card.identity.nameFr + ' ' + (card.identity.nameEn || ''))
        const isLuminous = card.subCategory === 'SPECIAL_ENERGY' && cardNameNorm.includes('lumineuse')
        if (!isLuminous && !cardNameNorm.includes(reqType)) {
          // Check English equivalents (Fire <-> Feu, Grass <-> Plante, etc.)
          const typeAliases: Record<string, string[]> = {
            feu: ['fire', 'r', 'feu'],
            plante: ['grass', 'g', 'plante'],
            eau: ['water', 'w', 'eau'],
            electrique: ['lightning', 'electrik', 'l', 'electrique'],
            psy: ['psychic', 'p', 'psy'],
            combat: ['fighting', 'f', 'combat'],
            obscurite: ['darkness', 'd', 'obscurite'],
            metal: ['metal', 'm'],
          }
          const aliases = typeAliases[reqType] || [reqType]
          if (!aliases.some((al) => cardNameNorm.includes(al))) {
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
    if (frNorm !== targetNorm && enNorm !== targetNorm && !frNorm.includes(targetNorm)) {
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
  for (const model of Object.values(FALLBACK_CARD_MODELS)) {
    if (!map.has(model.cardId)) {
      map.set(model.cardId, model)
    }
  }
  return Array.from(map.values())
}
