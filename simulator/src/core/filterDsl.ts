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

/**
 * Parse une chaîne DSL en dictionnaire clé-valeur avec mise en cache mémoire.
 */
export function parseDslFilter(filterStr: string): ParsedDslFilter {
  const trimmed = filterStr.trim()
  if (!trimmed) return {}

  const cached = parsedFilterCache.get(trimmed)
  if (cached) return cached

  const result: ParsedDslFilter = {}
  const compiled: CompiledDslSegment[] = []
  const segments = trimmed.split('|')
  for (const seg of segments) {
    const colonIdx = seg.indexOf(':')
    if (colonIdx > 0) {
      const rawKey = seg.slice(0, colonIdx).trim().toUpperCase()
      const val = seg.slice(colonIdx + 1).trim()
      result[rawKey] = val
      compiled.push({
        key: rawKey,
        val,
        valUpper: val.toUpperCase(),
        valNorm: normalizeStr(val),
        valNum: parseInt(val, 10),
      })
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
): boolean {
  for (let i = 0; i < segments.length; i++) {
    const { key, valUpper, valNorm, valNum } = segments[i]!

    switch (key) {
      case 'CATEGORY': {
        const cat = (card.identity.category || card.category || '').toUpperCase()
        if (cat !== valUpper) return false
        break
      }

      case 'SUB':
      case 'SUBCATEGORY': {
        const sub = (card.identity.subCategory || card.subCategory || '').toUpperCase()
        if (sub !== valUpper) return false
        break
      }

      case 'STAGE': {
        const stage = (card.pokemonStats?.stage || '').toUpperCase()
        const sub = (card.identity.subCategory || card.subCategory || '').toUpperCase()
        if (valUpper === 'BASIC' || valUpper === 'BASE') {
          if (stage !== 'BASE' && stage !== 'BASIC' && sub !== 'BASIC') return false
        } else if (valUpper === 'STAGE_1' || valUpper === 'NIVEAU_1' || valUpper === 'NIVEAU 1') {
          if (stage !== 'NIVEAU 1' && stage !== 'STAGE_1' && sub !== 'STAGE_1') return false
        } else if (valUpper === 'STAGE_2' || valUpper === 'NIVEAU_2' || valUpper === 'NIVEAU 2') {
          if (stage !== 'NIVEAU 2' && stage !== 'STAGE_2' && sub !== 'STAGE_2') return false
        } else if (stage !== valUpper && sub !== valUpper) {
          return false
        }
        break
      }

      case 'TYPE':
      case 'ENERGYTYPE': {
        const pokeTypes = card.pokemonStats?.types || []
        const matchPoke = pokeTypes.some(
          (t) => normalizeStr(t) === valNorm || t.toUpperCase() === valUpper,
        )
        const matchName =
          normalizeStr(card.identity.nameFr).includes(valNorm) ||
          normalizeStr(card.identity.nameEn || '').includes(valNorm)
        if (!matchPoke && !matchName) return false
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
      case 'ISRULEBOX': {
        const req = valUpper === 'TRUE' || valUpper === '1'
        if (Boolean(card.identity.isRuleBox) !== req) return false
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
        const has = card.playableActions.some((a) => a.actionType === 'USE_ABILITY')
        if (has !== req) return false
        break
      }

      default:
        break
    }
  }

  return true
}

/**
 * Évalue si une carte satisfait le filtre DSL donné.
 */
export function matchesDslFilter(
  card: EngineCardModel,
  filterStr: string | null | undefined,
): boolean {
  if (!filterStr) return true
  const trimmed = filterStr.trim()
  if (!trimmed) return true

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
