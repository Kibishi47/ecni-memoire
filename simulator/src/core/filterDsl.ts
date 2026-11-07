/**
 * Parseur et évaluateur DSL de filtres pour cartes Pokémon TCG.
 * Syntaxe normalisée : KEY:VALUE|KEY:VALUE (ex: "CATEGORY:POKEMON|STAGE:BASIC|MAX_HP:70")
 */

import type { EngineCardModel } from '../types/cardModel'

export type ParsedDslFilter = Record<string, string>

const parsedFilterCache = new Map<string, ParsedDslFilter>()

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
  const segments = trimmed.split('|')
  for (const seg of segments) {
    const colonIdx = seg.indexOf(':')
    if (colonIdx > 0) {
      const rawKey = seg.slice(0, colonIdx).trim().toUpperCase()
      const val = seg.slice(colonIdx + 1).trim()
      result[rawKey] = val
    }
  }

  parsedFilterCache.set(trimmed, result)
  return result
}

function normalizeStr(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Évalue si une carte satisfait le filtre DSL donné.
 */
export function matchesDslFilter(
  card: EngineCardModel,
  filterStr: string | null | undefined,
): boolean {
  if (!filterStr || !filterStr.trim()) return true

  const filter = parseDslFilter(filterStr)

  for (const [key, val] of Object.entries(filter)) {
    const valUpper = val.toUpperCase()

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
        // Types can match pokemon types or basic energy name/type
        const pokeTypes = card.pokemonStats?.types || []
        const matchPoke = pokeTypes.some(
          (t) => normalizeStr(t) === normalizeStr(val) || t.toUpperCase() === valUpper,
        )
        const matchName =
          normalizeStr(card.identity.nameFr).includes(normalizeStr(val)) ||
          normalizeStr(card.identity.nameEn || '').includes(normalizeStr(val))
        if (!matchPoke && !matchName) return false
        break
      }

      case 'MAX_HP':
      case 'MAXHP': {
        const hpLimit = parseInt(val, 10)
        if (!isNaN(hpLimit)) {
          const cardHp = card.pokemonStats?.hp ?? 0
          if (cardHp <= 0 || cardHp > hpLimit) return false
        }
        break
      }

      case 'MIN_HP':
      case 'MINHP': {
        const hpMin = parseInt(val, 10)
        if (!isNaN(hpMin)) {
          const cardHp = card.pokemonStats?.hp ?? 0
          if (cardHp < hpMin) return false
        }
        break
      }

      case 'NAME':
      case 'CARDNAME':
      case 'SPECIFICCARDNAME': {
        const targetNorm = normalizeStr(val)
        const nameFrNorm = normalizeStr(card.identity.nameFr)
        const nameEnNorm = normalizeStr(card.identity.nameEn || '')
        if (nameFrNorm !== targetNorm && nameEnNorm !== targetNorm) {
          // Allow substring for evolution line, e.g. "Salamèche" matches "Salamèche"
          if (!nameFrNorm.includes(targetNorm) && !nameEnNorm.includes(targetNorm)) {
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
        // Ignore unrecognized filter keys gracefully
        break
    }
  }

  return true
}
