/**
 * Parseur et évaluateur DSL de filtres pour cartes Pokémon TCG.
 * Syntaxe normalisée : KEY:VALUE|KEY:VALUE (ex: "CATEGORY:POKEMON|STAGE:BASIC|MAX_HP:70")
 */

import type { EngineCardModel } from '../types/cardModel'

export type ParsedDslFilter = Record<string, string>

interface CompiledDslSegment {
  key: string
  val: string
  valUpper: string
  valNorm: string
  valNum: number
}

const parsedFilterCache = new Map<string, ParsedDslFilter>()
const compiledSegmentsCache = new Map<string, CompiledDslSegment[]>()
const dslMatchCache = new Map<string, WeakMap<EngineCardModel, boolean>>()
const normStrCache = new Map<string, string>()

const TYPE_GROUP_ALIASES: Record<string, string[]> = {
  g: ['plante', 'grass'],
  plante: ['plante', 'grass'],
  grass: ['plante', 'grass'],
  r: ['feu', 'fire'],
  feu: ['feu', 'fire'],
  fire: ['feu', 'fire'],
  w: ['eau', 'water'],
  eau: ['eau', 'water'],
  water: ['eau', 'water'],
  l: ['electrique', 'electrik', 'lightning'],
  electrique: ['electrique', 'electrik', 'lightning'],
  electrik: ['electrique', 'electrik', 'lightning'],
  lightning: ['electrique', 'electrik', 'lightning'],
  p: ['psy', 'psychic'],
  psy: ['psy', 'psychic'],
  psychic: ['psy', 'psychic'],
  f: ['combat', 'fighting'],
  combat: ['combat', 'fighting'],
  fighting: ['combat', 'fighting'],
  d: ['obscurite', 'darkness', 'dark'],
  obscurite: ['obscurite', 'darkness', 'dark'],
  darkness: ['obscurite', 'darkness', 'dark'],
  dark: ['obscurite', 'darkness', 'dark'],
  m: ['metal'],
  metal: ['metal'],
  y: ['fee', 'fairy'],
  fee: ['fee', 'fairy'],
  fairy: ['fee', 'fairy'],
  c: ['incolore', 'colorless'],
  incolore: ['incolore', 'colorless'],
  colorless: ['incolore', 'colorless'],
  n: ['dragon'],
  dragon: ['dragon'],
}

function getNormalizedTypeAliases(rawType: string): string[] {
  const cleaned = normalizeStr(rawType.replace(/[{}]/g, ''))
  if (TYPE_GROUP_ALIASES[cleaned]) {
    return TYPE_GROUP_ALIASES[cleaned]!
  }
  return cleaned ? [cleaned] : []
}

function cardHasAbility(card: EngineCardModel): boolean {
  if (card.pokemonStats?.hasAbility) return true
  return card.playableActions.some(
    (a) =>
      a.actionType === 'USE_ABILITY' ||
      a.actionType === 'TRIGGERED_ABILITY' ||
      a.actionType === 'PASSIVE_ABILITY',
  )
}

function normalizeStr(str: string): string {
  if (!str) return ''
  const cached = normStrCache.get(str)
  if (cached !== undefined) return cached
  const normalized = str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  normStrCache.set(str, normalized)
  return normalized
}

/**
 * Convertit un ancien objet targetFilter (ou un dictionnaire) en chaîne DSL standardisée.
 */
export function targetFilterToDsl(rawFilter: any): string | null {
  if (!rawFilter) return null
  if (typeof rawFilter === 'string') {
    const s = rawFilter.trim()
    return s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'none' ? s : null
  }
  if (typeof rawFilter !== 'object') return null

  const parts: string[] = []

  // Category
  if (rawFilter.category) {
    parts.push(`CATEGORY:${String(rawFilter.category).toUpperCase()}`)
  }

  // SubCategory / Sub
  const sub = rawFilter.subCategory || rawFilter.sub || rawFilter.subcategory
  if (sub) {
    parts.push(`SUB:${String(sub).toUpperCase()}`)
  }

  // Stage
  const stage = rawFilter.stage || (rawFilter.subCategory === 'BASIC' ? 'BASIC' : null)
  if (stage && !parts.some((p) => p.startsWith('SUB:BASIC') && stage === 'BASIC')) {
    parts.push(`STAGE:${String(stage).toUpperCase()}`)
  }

  // Energy / Pokemon Type
  const energyType = rawFilter.energyType || rawFilter.type
  if (energyType) {
    parts.push(`TYPE:${String(energyType)}`)
  }

  // Max HP
  const maxHp = rawFilter.maxHp ?? rawFilter.maxHP
  if (typeof maxHp === 'number' && !isNaN(maxHp)) {
    parts.push(`MAX_HP:${maxHp}`)
  }

  // Min HP
  const minHp = rawFilter.minHp ?? rawFilter.minHP
  if (typeof minHp === 'number' && !isNaN(minHp)) {
    parts.push(`MIN_HP:${minHp}`)
  }

  // Name
  const name = rawFilter.specificCardName || rawFilter.name || rawFilter.cardName
  if (name) {
    parts.push(`NAME:${String(name)}`)
  }

  // Rule Box
  const isRuleBox = rawFilter.isRuleBox ?? rawFilter.ruleBox
  if (typeof isRuleBox === 'boolean') {
    parts.push(`RULE_BOX:${isRuleBox ? 'TRUE' : 'FALSE'}`)
  }

  // Tera
  const isTera = rawFilter.isTera ?? rawFilter.tera
  if (typeof isTera === 'boolean') {
    parts.push(`TERA:${isTera ? 'TRUE' : 'FALSE'}`)
  }

  // Ancient
  const isAncient = rawFilter.isAncient ?? rawFilter.ancient
  if (typeof isAncient === 'boolean') {
    parts.push(`ANCIENT:${isAncient ? 'TRUE' : 'FALSE'}`)
  }

  // Future
  const isFuture = rawFilter.isFuture ?? rawFilter.future
  if (typeof isFuture === 'boolean') {
    parts.push(`FUTURE:${isFuture ? 'TRUE' : 'FALSE'}`)
  }

  // Has ability
  const hasAbility = rawFilter.hasAbility
  if (typeof hasAbility === 'boolean') {
    parts.push(`HAS_ABILITY:${hasAbility ? 'TRUE' : 'FALSE'}`)
  }

  return parts.length > 0 ? parts.join('|') : null
}

function addCompiledToken(
  result: ParsedDslFilter,
  compiled: CompiledDslSegment[],
  rawKey: string,
  val: string,
): void {
  result[rawKey] = val
  compiled.push({
    key: rawKey,
    val,
    valUpper: val.toUpperCase(),
    valNorm: normalizeStr(val),
    valNum: parseInt(val, 10),
  })
}

/**
 * Parse une chaîne DSL en dictionnaire clé-valeur avec mise en cache mémoire.
 * Supporte aussi les jetons nus générés par le compilateur (`BASIC_ENERGY`, `SPECIAL_ENERGY`,
 * `TOOL`, `SUPPORTER`, `ITEM`, `STADIUM`, `EVOLUTION_FOR_SELF`, `IN_PLAY`, etc.).
 */
export function parseDslFilter(filterStr: string): ParsedDslFilter {
  const trimmed = filterStr.trim()
  if (!trimmed) return {}

  const cached = parsedFilterCache.get(trimmed)
  if (cached) return cached

  const result: ParsedDslFilter = {}
  const compiled: CompiledDslSegment[] = []
  const rawSegments = trimmed.split(/\s*(?:\||,|\bAND\b)\s*/i)

  for (const rawSeg of rawSegments) {
    const seg = rawSeg.trim()
    if (!seg) continue

    const colonIdx = seg.indexOf(':')
    if (colonIdx > 0) {
      const rawKey = seg.slice(0, colonIdx).trim().toUpperCase()
      const val = seg.slice(colonIdx + 1).trim()
      addCompiledToken(result, compiled, rawKey, val)
      continue
    }

    const tokenUpper = seg.toUpperCase().replace(/[\s-]+/g, '_')
    switch (tokenUpper) {
      case 'POKEMON':
      case 'TRAINER':
      case 'ENERGY':
        addCompiledToken(result, compiled, 'CATEGORY', tokenUpper)
        break
      case 'BASIC_ENERGY':
      case 'SPECIAL_ENERGY':
      case 'TOOL':
      case 'SUPPORTER':
      case 'ITEM':
      case 'STADIUM':
        addCompiledToken(result, compiled, 'SUB', tokenUpper)
        break
      case 'POKEMON_TOOL':
        addCompiledToken(result, compiled, 'SUB', 'TOOL')
        break
      case 'OBJECT':
        addCompiledToken(result, compiled, 'SUB', 'ITEM')
        break
      case 'BASIC':
      case 'BASE':
      case 'BASIC_POKEMON':
        addCompiledToken(result, compiled, 'CATEGORY', 'POKEMON')
        addCompiledToken(result, compiled, 'SUB', 'BASIC')
        break
      case 'STAGE_1':
      case 'STAGE1':
        addCompiledToken(result, compiled, 'SUB', 'STAGE_1')
        break
      case 'STAGE_2':
      case 'STAGE2':
        addCompiledToken(result, compiled, 'SUB', 'STAGE_2')
        break
      case 'EVOLUTION':
      case 'EVOLUTION_POKEMON':
        addCompiledToken(result, compiled, 'STAGE', 'EVOLUTION')
        break
      case 'EVOLUTION_FOR_SELF':
      case 'EVOLUTION_OF_SELF':
        addCompiledToken(result, compiled, 'EVOLUTION_FOR_SELF', 'TRUE')
        break
      case 'POKEMON_EX':
      case 'RULE_BOX':
        addCompiledToken(result, compiled, 'CATEGORY', 'POKEMON')
        addCompiledToken(result, compiled, 'RULE_BOX', 'TRUE')
        break
      case 'NO_RULE_BOX':
        addCompiledToken(result, compiled, 'RULE_BOX', 'FALSE')
        break
      case 'MEGA_EVOLUTION':
      case 'MEGA_EVOLUTION_EX':
        addCompiledToken(result, compiled, 'MEGA', 'TRUE')
        break
      case 'ANCIENT':
        addCompiledToken(result, compiled, 'ANCIENT', 'TRUE')
        break
      case 'FUTURE':
        addCompiledToken(result, compiled, 'FUTURE', 'TRUE')
        break
      case 'TERA':
        addCompiledToken(result, compiled, 'TERA', 'TRUE')
        break
      case 'HAS_ABILITY':
        addCompiledToken(result, compiled, 'HAS_ABILITY', 'TRUE')
        break
      default: {
        const cleanedType = tokenUpper.replace(/[{}]/g, '')
        if (TYPE_GROUP_ALIASES[cleanedType.toLowerCase()]) {
          addCompiledToken(result, compiled, 'TYPE', cleanedType)
        } else if (tokenUpper.startsWith('IN_PLAY')) {
          addCompiledToken(result, compiled, 'IN_PLAY', seg)
        }
        break
      }
    }
  }

  parsedFilterCache.set(trimmed, result)
  compiledSegmentsCache.set(trimmed, compiled)
  return result
}

function getCompiledSegments(trimmed: string): CompiledDslSegment[] {
  const cached = compiledSegmentsCache.get(trimmed)
  if (cached) return cached
  parseDslFilter(trimmed)
  return compiledSegmentsCache.get(trimmed) || []
}

function evaluateMatchesDslFilter(
  card: EngineCardModel,
  segments: CompiledDslSegment[],
  sourceContextName?: string,
): boolean {
  for (let i = 0; i < segments.length; i++) {
    const { key, val, valUpper, valNorm, valNum } = segments[i]!

    switch (key) {
      case 'CATEGORY': {
        const cat = (card.identity.category || card.category || '').toUpperCase()
        const sub = (card.identity.subCategory || card.subCategory || '').toUpperCase()
        if (valUpper === 'POKEMON' || valUpper === 'TRAINER' || valUpper === 'ENERGY') {
          if (cat !== valUpper) return false
        } else if (
          valUpper === 'STADIUM' ||
          valUpper === 'ITEM' ||
          valUpper === 'SUPPORTER' ||
          valUpper === 'TOOL' ||
          valUpper === 'BASIC_ENERGY' ||
          valUpper === 'SPECIAL_ENERGY'
        ) {
          if (sub !== valUpper) return false
        } else if (valUpper === 'POKEMON_TOOL') {
          if (sub !== 'TOOL') return false
        } else if (valUpper === 'OBJECT') {
          if (sub !== 'ITEM') return false
        } else if (valUpper === 'EVOLUTION') {
          if (sub !== 'STAGE_1' && sub !== 'STAGE_2') return false
        } else if (valUpper === 'FUTURE') {
          if (!card.identity.isFuture && !card.pokemonStats?.isFuture) return false
        } else if (valUpper === 'ANCIENT') {
          if (!card.identity.isAncient && !card.pokemonStats?.isAncient) return false
        } else if (valUpper === 'MEGA_EVOLUTION' || valUpper === 'MEGA_EVOLUTION_EX') {
          const nf = normalizeStr(card.identity.nameFr)
          if (cat !== 'POKEMON' || !nf.includes('mega')) return false
        } else if (cat !== valUpper && sub !== valUpper) {
          return false
        }
        break
      }

      case 'SUB':
      case 'SUBCATEGORY': {
        const sub = (card.identity.subCategory || card.subCategory || '').toUpperCase()
        const normSub = valUpper === 'POKEMON_TOOL' ? 'TOOL' : valUpper === 'OBJECT' ? 'ITEM' : valUpper
        if (sub !== normSub) return false
        break
      }

      case 'STAGE': {
        const stage = (card.pokemonStats?.stage || '').toUpperCase()
        const sub = (card.identity.subCategory || card.subCategory || '').toUpperCase()
        if (valUpper === 'BASIC' || valUpper === 'BASE') {
          if (sub === 'BASIC_ENERGY') {
            // Permet `CATEGORY:ENERGY|STAGE:BASE` pour filtrer les Énergies de Base
            break
          }
          if (stage !== 'BASE' && stage !== 'BASIC' && sub !== 'BASIC') return false
        } else if (valUpper === 'STAGE_1' || valUpper === 'STAGE1' || valUpper === 'NIVEAU_1' || valUpper === 'NIVEAU 1') {
          if (stage !== 'NIVEAU 1' && stage !== 'STAGE_1' && sub !== 'STAGE_1') return false
        } else if (valUpper === 'STAGE_2' || valUpper === 'STAGE2' || valUpper === 'NIVEAU_2' || valUpper === 'NIVEAU 2') {
          if (stage !== 'NIVEAU 2' && stage !== 'STAGE_2' && sub !== 'STAGE_2') return false
        } else if (valUpper === 'EVOLUTION' || valUpper === 'HIGHEST') {
          if (sub !== 'STAGE_1' && sub !== 'STAGE_2') return false
        } else if (valUpper === 'EX') {
          if (!card.identity.isRuleBox) return false
        } else if (valUpper.includes('MEGA')) {
          if (!normalizeStr(card.identity.nameFr).includes('mega')) return false
        } else if (stage !== valUpper && sub !== valUpper) {
          return false
        }
        break
      }

      case 'EVOLUTION_FOR_SELF': {
        if (card.category !== 'POKEMON') return false
        if (card.subCategory !== 'STAGE_1' && card.subCategory !== 'STAGE_2') return false
        if (sourceContextName) {
          const srcNorm = normalizeStr(sourceContextName)
          const evoFromNorm = normalizeStr(card.pokemonStats?.evolvesFrom || '')
          const rootNorm = normalizeStr(card.pokemonStats?.rootBasicName || '')
          if (evoFromNorm !== srcNorm && rootNorm !== srcNorm) return false
        }
        break
      }

      case 'FROM':
      case 'EVOLUTION_FROM': {
        if (card.category !== 'POKEMON') return false
        const evoFromNorm = normalizeStr(card.pokemonStats?.evolvesFrom || '')
        const rootNorm = normalizeStr(card.pokemonStats?.rootBasicName || '')
        if (evoFromNorm !== valNorm && rootNorm !== valNorm) return false
        break
      }

      case 'TYPE':
      case 'COLOR':
      case 'ENERGYTYPE':
      case 'TAG': {
        const aliases = getNormalizedTypeAliases(val)
        if (aliases.length === 0) break
        const pokeTypes = (card.pokemonStats?.types || []).map((t) => normalizeStr(t))
        const matchPoke = pokeTypes.some((t) => aliases.includes(t))
        const nameFrNorm = normalizeStr(card.identity.nameFr)
        const nameEnNorm = normalizeStr(card.identity.nameEn || '')
        const rulesNorm = normalizeStr((card.identity.rawRulesText || []).join(' '))
        const isEnergy = card.category === 'ENERGY'
        const isLuminous =
          card.subCategory === 'SPECIAL_ENERGY' &&
          (nameFrNorm.includes('lumineuse') || nameEnNorm.includes('luminous') || nameFrNorm.includes('prisme') || nameEnNorm.includes('prism'))
        const matchEnergyName =
          isEnergy &&
          (isLuminous ||
            aliases.some((al) => nameFrNorm.includes(al) || nameEnNorm.includes(al) || rulesNorm.includes(al)))
        if (!matchPoke && !matchEnergyName) return false
        break
      }

      case 'MAX_HP':
      case 'MAXHP': {
        if (!isNaN(valNum)) {
          const cardHp = card.pokemonStats?.hp ?? 0
          if (cardHp <= 0 || cardHp > valNum) return false
        }
        break
      }

      case 'MIN_HP':
      case 'MINHP': {
        if (!isNaN(valNum)) {
          const cardHp = card.pokemonStats?.hp ?? 0
          if (cardHp < valNum) return false
        }
        break
      }

      case 'NAME':
      case 'CARDNAME':
      case 'SPECIFICCARDNAME': {
        const nameFrNorm = normalizeStr(card.identity.nameFr)
        const nameEnNorm = normalizeStr(card.identity.nameEn || '')
        if (nameFrNorm !== valNorm && nameEnNorm !== valNorm) {
          if (!nameFrNorm.includes(valNorm) && !nameEnNorm.includes(valNorm)) {
            return false
          }
        }
        break
      }

      case 'RULE_BOX':
      case 'ISRULEBOX':
      case 'EX': {
        const req = valUpper === 'TRUE' || valUpper === '1'
        if (Boolean(card.identity.isRuleBox) !== req) return false
        break
      }

      case 'MEGA': {
        const req = valUpper === 'TRUE' || valUpper === '1'
        const isMega = normalizeStr(card.identity.nameFr).includes('mega') || normalizeStr(card.identity.nameEn || '').includes('mega')
        if (isMega !== req) return false
        break
      }

      case 'TERA':
      case 'ISTERA': {
        const req = valUpper === 'TRUE' || valUpper === '1'
        if (Boolean(card.identity.isTera) !== req) return false
        break
      }

      case 'ANCIENT':
      case 'ISANCIENT': {
        const req = valUpper === 'TRUE' || valUpper === '1'
        if (Boolean(card.identity.isAncient) !== req) return false
        break
      }

      case 'FUTURE':
      case 'ISFUTURE': {
        const req = valUpper === 'TRUE' || valUpper === '1'
        if (Boolean(card.identity.isFuture) !== req) return false
        break
      }

      case 'HAS_ABILITY': {
        const req = valUpper === 'TRUE' || valUpper === '1'
        const has = cardHasAbility(card)
        if (has !== req) return false
        break
      }

      case 'IN_PLAY': {
        const nameFrNorm = normalizeStr(card.identity.nameFr)
        const nameEnNorm = normalizeStr(card.identity.nameEn || '')
        const evoNorm = normalizeStr(card.pokemonStats?.evolvesFrom || '')
        if (valNorm && nameFrNorm !== valNorm && nameEnNorm !== valNorm && evoNorm !== valNorm) {
          if (!nameFrNorm.includes(valNorm) && !nameEnNorm.includes(valNorm)) {
            return false
          }
        }
        break
      }

      default:
        break
    }
  }

  return true
}

/**
 * Vérifie si au moins une condition `IN_PLAY:<Nom>` d'une liste est satisfaite par les cartes en jeu.
 */
export function matchesInPlayConditions(
  inPlayConditions: string[],
  cardsInPlay: EngineCardModel[],
  requireAll = false,
): boolean {
  if (!inPlayConditions || inPlayConditions.length === 0) return true
  const checkSingle = (cond: string): boolean => {
    const clean = cond.replace(/^IN_PLAY\s*:\s*/i, '').trim()
    if (!clean) return true
    const targetNorm = normalizeStr(clean)
    return cardsInPlay.some((c) => {
      const nFr = normalizeStr(c.identity.nameFr)
      const nEn = normalizeStr(c.identity.nameEn || '')
      return nFr === targetNorm || nEn === targetNorm || nFr.includes(targetNorm) || nEn.includes(targetNorm)
    })
  }
  return requireAll ? inPlayConditions.every(checkSingle) : inPlayConditions.some(checkSingle)
}

/**
 * Évalue si une carte satisfait le filtre DSL donné.
 */
export function matchesDslFilter(
  card: EngineCardModel,
  filterStr: string | null | undefined,
  sourceContextName?: string,
): boolean {
  if (!filterStr) return true
  const trimmed = filterStr.trim()
  if (!trimmed) return true

  if (!sourceContextName) {
    let inner = dslMatchCache.get(trimmed)
    if (inner) {
      const cached = inner.get(card)
      if (cached !== undefined) return cached
    } else {
      inner = new WeakMap<EngineCardModel, boolean>()
      dslMatchCache.set(trimmed, inner)
    }

    const segments = getCompiledSegments(trimmed)
    const result = evaluateMatchesDslFilter(card, segments)
    inner.set(card, result)
    return result
  }

  const segments = getCompiledSegments(trimmed)
  return evaluateMatchesDslFilter(card, segments, sourceContextName)
}
