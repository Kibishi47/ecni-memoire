import type { Pool } from 'pg'
import { parsePtcglDeckFile } from './deckParserService.js'

export interface ResolveCardItemInput {
  key: string
  candidateIds: string[]
  name?: string
}

export type ResolutionMatchType = 'card_id' | 'alias_id' | 'name'

export interface ResolvedCardEntry {
  matchedBy: ResolutionMatchType
  card: Record<string, unknown>
}

export interface ResolveCardsResult {
  resolved: Record<string, ResolvedCardEntry>
  unresolved: string[]
}

/**
 * Known aliases mapping alternate/reprint/legacy cardIds to canonical cardIds in DB.
 * Aligned with `simulator/src/data/cardCatalog.ts`.
 */
export const CARD_ID_ALIASES: Record<string, string> = {
  'sv01-191': 'sv04-125', // Super Bonbon (Écarlate et Violet) -> Faille Paradoxe
  'svp-056': 'sv03-125', // Dracaufeu ex Promo -> Flammes Obsidiennes
  'sv04.5-054': 'sv03-125', // Dracaufeu ex Destinées de Paldea -> Flammes Obsidiennes
  'sv05-144': 'sv05-144', // Poffin Copain-Copain
  'me02.5-142': 'sv06.5-038', // Favianos ex
  '30c-066': '30th-066', // Mew ex (alias PTCGL)
  '30c-66': '30th-066',
  '30th-66': '30th-066',
}

/**
 * Normalized card name synonyms mapping common FR/EN variants to canonical cardIds.
 * Aligned with `simulator/src/data/cardCatalog.ts`.
 */
export const NAME_SYNONYMS: Record<string, string> = {
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
  mashynn: 'sv02-185',
  iono: 'sv02-185',
  pepper: 'sv01-166',
  arven: 'sv01-166',
  'attrape riposte': 'sv04-160',
  'counter catcher': 'sv04-160',
  'attrape ultime': 'sv05-157',
  'attrape supreme': 'sv05-157',
  'prime catcher': 'sv05-157',
  'mew ex': '30th-066',
}

/** PostgreSQL TRANSLATE source/target for case- and accent-insensitive normalization */
export const SQL_ACCENT_SOURCE = 'àâäãåéèêëíìîïóòôöõúùûüýÿçñ'
export const SQL_ACCENT_TARGET = 'aaaaaeeeeiiiiooooouuuuyycn'

export const SQL_NAME_NORM_SOURCE = `${SQL_ACCENT_SOURCE}''’-`
export const SQL_NAME_NORM_TARGET = `${SQL_ACCENT_TARGET}   `

/**
 * Normalizes a card name for tolerant matching (lowercase, stripped diacritics, punctuation collapsed).
 */
export function normalizeCardNameForMatch(rawName: string): string {
  return rawName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface CardRow {
  card_id: string
  name_fr?: string
  name_en?: string | null
  data: Record<string, unknown>
}

function resolveAliasTarget(candidateId: string): string | undefined {
  return CARD_ID_ALIASES[candidateId] ?? CARD_ID_ALIASES[candidateId.toLowerCase()]
}

/**
 * Resolves card items against PostgreSQL using 3 progressive tiers:
 * 1. Exact `card_id` match against `candidateIds`
 * 2. Known `CARD_ID_ALIASES` lookup
 * 3. Normalized `name_fr` / `name_en` (and `NAME_SYNONYMS`) fallback
 */
export async function resolveCardItems(
  pool: Pool,
  items: ResolveCardItemInput[],
): Promise<ResolveCardsResult> {
  const resolved: Record<string, ResolvedCardEntry> = {}
  const pendingItems: ResolveCardItemInput[] = []

  // Step 1: Exact card_id match
  const directCandidates = Array.from(
    new Set(items.flatMap((item) => item.candidateIds).filter((id) => id.length > 0)),
  )

  const directCardsById = new Map<string, Record<string, unknown>>()
  if (directCandidates.length > 0) {
    const directRes = await pool.query<CardRow>(
      'SELECT card_id, data FROM cards WHERE card_id = ANY($1)',
      [directCandidates],
    )
    for (const row of directRes.rows) {
      directCardsById.set(row.card_id, row.data)
    }
  }

  for (const item of items) {
    const matchedId = item.candidateIds.find((cid) => directCardsById.has(cid))
    if (matchedId) {
      resolved[item.key] = {
        matchedBy: 'card_id',
        card: directCardsById.get(matchedId)!,
      }
    } else {
      pendingItems.push(item)
    }
  }

  if (pendingItems.length === 0) {
    return { resolved, unresolved: [] }
  }

  // Step 2: CARD_ID_ALIASES match (single SQL query for unresolved candidates with aliases)
  const aliasIdsToFetch = new Set<string>()
  for (const item of pendingItems) {
    for (const cid of item.candidateIds) {
      const target = resolveAliasTarget(cid)
      if (target && !directCardsById.has(target)) {
        aliasIdsToFetch.add(target)
      }
    }
  }

  if (aliasIdsToFetch.size > 0) {
    const aliasRes = await pool.query<CardRow>(
      'SELECT card_id, data FROM cards WHERE card_id = ANY($1)',
      [Array.from(aliasIdsToFetch)],
    )
    for (const row of aliasRes.rows) {
      directCardsById.set(row.card_id, row.data)
    }
  }

  const remainingAfterAlias: ResolveCardItemInput[] = []
  for (const item of pendingItems) {
    let matchedCard: Record<string, unknown> | undefined
    for (const cid of item.candidateIds) {
      const target = resolveAliasTarget(cid)
      if (target && directCardsById.has(target)) {
        matchedCard = directCardsById.get(target)
        break
      }
    }

    if (matchedCard) {
      resolved[item.key] = {
        matchedBy: 'alias_id',
        card: matchedCard,
      }
    } else {
      remainingAfterAlias.push(item)
    }
  }

  if (remainingAfterAlias.length === 0) {
    return { resolved, unresolved: [] }
  }

  // Step 3: Normalized name fallback (including NAME_SYNONYMS)
  const itemsWithNames = remainingAfterAlias
    .map((item) => ({
      item,
      normalizedName: item.name ? normalizeCardNameForMatch(item.name) : '',
    }))
    .filter((entry) => entry.normalizedName.length > 0)

  const cardsByNormalizedFr = new Map<string, Record<string, unknown>>()
  const cardsByNormalizedEn = new Map<string, Record<string, unknown>>()

  if (itemsWithNames.length > 0) {
    const normalizedNames = Array.from(new Set(itemsWithNames.map((entry) => entry.normalizedName)))
    const synonymCardIds = Array.from(
      new Set(
        normalizedNames
          .map((norm) => NAME_SYNONYMS[norm])
          .filter((id): id is string => id !== undefined && id.length > 0 && !directCardsById.has(id)),
      ),
    )

    const nameRes = await pool.query<CardRow>(
      `SELECT card_id, name_fr, name_en, data
       FROM cards
       WHERE card_id = ANY($1)
          OR BTRIM(REGEXP_REPLACE(TRANSLATE(LOWER(COALESCE(name_fr, '')), '${SQL_NAME_NORM_SOURCE}', '${SQL_NAME_NORM_TARGET}'), '\\s+', ' ', 'g')) = ANY($2)
          OR BTRIM(REGEXP_REPLACE(TRANSLATE(LOWER(COALESCE(name_en, '')), '${SQL_NAME_NORM_SOURCE}', '${SQL_NAME_NORM_TARGET}'), '\\s+', ' ', 'g')) = ANY($2)
       ORDER BY set_id ASC, card_id ASC`,
      [synonymCardIds, normalizedNames],
    )

    for (const row of nameRes.rows) {
      directCardsById.set(row.card_id, row.data)
      if (row.name_fr) {
        const normFr = normalizeCardNameForMatch(row.name_fr)
        if (!cardsByNormalizedFr.has(normFr)) {
          cardsByNormalizedFr.set(normFr, row.data)
        }
      }
      if (row.name_en) {
        const normEn = normalizeCardNameForMatch(row.name_en)
        if (!cardsByNormalizedEn.has(normEn)) {
          cardsByNormalizedEn.set(normEn, row.data)
        }
      }
    }
  }

  const unresolved: string[] = []
  for (const item of remainingAfterAlias) {
    const normalizedName = item.name ? normalizeCardNameForMatch(item.name) : ''
    let matchedCard: Record<string, unknown> | undefined

    if (normalizedName) {
      const synonymId = NAME_SYNONYMS[normalizedName]
      if (synonymId) {
        matchedCard = directCardsById.get(synonymId)
      }
      if (!matchedCard) {
        matchedCard =
          cardsByNormalizedFr.get(normalizedName) ?? cardsByNormalizedEn.get(normalizedName)
      }
    }

    if (matchedCard) {
      resolved[item.key] = {
        matchedBy: 'name',
        card: matchedCard,
      }
    } else {
      unresolved.push(item.key)
    }
  }

  return { resolved, unresolved }
}

/**
 * Resolves cards directly from a raw PTCGL/Limitless decklist text.
 */
export async function resolvePtcglDeckText(
  pool: Pool,
  ptcglText: string,
): Promise<ResolveCardsResult> {
  const parsed = parsePtcglDeckFile(ptcglText)
  if (parsed.cards.length === 0) {
    return { resolved: {}, unresolved: [] }
  }

  const uniqueItems = new Map<string, ResolveCardItemInput>()
  for (const line of parsed.cards) {
    const key = line.cardId || line.unpaddedCardId || line.name
    if (!uniqueItems.has(key)) {
      uniqueItems.set(key, {
        key,
        candidateIds: line.candidateCardIds,
        name: line.name,
      })
    }
  }

  return resolveCardItems(pool, Array.from(uniqueItems.values()))
}
