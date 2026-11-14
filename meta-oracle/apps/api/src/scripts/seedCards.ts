import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Pool } from 'pg'
import { getBackendRoot } from '../config/env.js'
import { closePool, getPool } from '../db/pool.js'

const BATCH_SIZE = 100

export interface RawEngineCard {
  cardId?: string
  nameFr?: string
  setId?: string
  identity?: {
    cardId?: string
    nameFr?: string
    nameEn?: string | null
    setId?: string
  }
  [key: string]: unknown
}

export interface NormalizedCardRow {
  cardId: string
  nameFr: string
  nameEn: string | null
  setId: string
  data: RawEngineCard
}

/**
 * Resolves the consolidated `cards_database.json` path from explicit path or standard repo locations.
 */
export function resolveCardsDatabasePath(explicitPath?: string): string {
  const candidates = [
    explicitPath,
    process.env.CARDS_DATABASE_PATH,
    path.resolve(getBackendRoot(), 'data/cards_database.json'),
    path.resolve(getBackendRoot(), '../card-compiler/data/cards_database.json'),
    path.resolve(getBackendRoot(), '../simulator/src/data/cards_database.json'),
    path.resolve(process.cwd(), 'data/cards_database.json'),
    path.resolve(process.cwd(), '../card-compiler/data/cards_database.json'),
    path.resolve(process.cwd(), '../simulator/src/data/cards_database.json'),
  ].filter((p): p is string => Boolean(p && p.trim()))

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (fs.existsSync(resolved)) {
      return resolved
    }
  }

  throw new Error(
    `[seedCards] Fichier cards_database.json introuvable. Chemins vérifiés :\n${candidates
      .map((c) => `  - ${path.resolve(c)}`)
      .join('\n')}`,
  )
}

/**
 * Extracts card entries from either `EngineCardModel[]` or `{ cards: Record<string, EngineCardModel> }`.
 */
export function extractCardsFromJson(parsed: unknown): NormalizedCardRow[] {
  let rawList: RawEngineCard[] = []

  if (Array.isArray(parsed)) {
    rawList = parsed as RawEngineCard[]
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    'cards' in parsed &&
    (parsed as { cards?: unknown }).cards &&
    typeof (parsed as { cards: unknown }).cards === 'object'
  ) {
    rawList = Object.values((parsed as { cards: Record<string, RawEngineCard> }).cards)
  } else {
    throw new Error(
      '[seedCards] Format JSON invalide : attendu EngineCardModel[] ou { cards: Record<string, EngineCardModel> }.',
    )
  }

  const deduped = new Map<string, NormalizedCardRow>()

  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue
    const cardId = String(raw.cardId ?? raw.identity?.cardId ?? '').trim()
    if (!cardId) continue

    const nameFr = String(raw.identity?.nameFr ?? raw.nameFr ?? cardId).trim()
    const rawNameEn = raw.identity?.nameEn
    const nameEn =
      typeof rawNameEn === 'string' && rawNameEn.trim().length > 0 ? rawNameEn.trim() : null
    const fallbackSetId = cardId.includes('-') ? cardId.split('-')[0]! : 'unknown'
    const setId = String(raw.identity?.setId ?? raw.setId ?? fallbackSetId).trim()

    deduped.set(cardId, {
      cardId,
      nameFr,
      nameEn,
      setId,
      data: raw,
    })
  }

  return Array.from(deduped.values())
}

/**
 * Upserts cards in PostgreSQL in batches of 100 inside a single transaction.
 */
export async function seedCards(
  pool: Pool = getPool(),
  databaseFilePath?: string,
): Promise<{ total: number; sourcePath: string }> {
  const sourcePath = resolveCardsDatabasePath(databaseFilePath)
  const rawContent = fs.readFileSync(sourcePath, 'utf8')
  const parsed = JSON.parse(rawContent) as unknown
  const cards = extractCardsFromJson(parsed)

  if (cards.length === 0) {
    console.warn(`[seedCards] Aucune carte valide trouvée dans ${sourcePath}.`)
    return { total: 0, sourcePath }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (let i = 0; i < cards.length; i += BATCH_SIZE) {
      const batch = cards.slice(i, i + BATCH_SIZE)
      const valuesClause: string[] = []
      const params: unknown[] = []

      for (let idx = 0; idx < batch.length; idx++) {
        const card = batch[idx]!
        const offset = idx * 5
        valuesClause.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}::jsonb, NOW())`,
        )
        params.push(
          card.cardId,
          card.nameFr,
          card.nameEn,
          card.setId,
          JSON.stringify(card.data),
        )
      }

      const sql = `
        INSERT INTO cards (card_id, name_fr, name_en, set_id, data, updated_at)
        VALUES ${valuesClause.join(',\n               ')}
        ON CONFLICT (card_id) DO UPDATE SET
          name_fr = EXCLUDED.name_fr,
          name_en = EXCLUDED.name_en,
          set_id = EXCLUDED.set_id,
          data = EXCLUDED.data,
          updated_at = NOW();
      `

      await client.query(sql, params)
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  console.log(`[seedCards] Synchronisation terminée : ${cards.length} cartes insérées/mises à jour.`)
  return { total: cards.length, sourcePath }
}

function parseCliFileArg(argv: string[]): string | undefined {
  const fileFlagIdx = argv.indexOf('--file')
  if (fileFlagIdx !== -1 && argv[fileFlagIdx + 1]) {
    return argv[fileFlagIdx + 1]
  }
  return undefined
}

async function main(): Promise<void> {
  try {
    const fileArg = parseCliFileArg(process.argv.slice(2))
    await seedCards(getPool(), fileArg)
  } finally {
    await closePool()
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1]!)).href

if (isDirectExecution) {
  main().catch((err) => {
    console.error('[seedCards] Erreur lors de la synchronisation des cartes :', err)
    process.exit(1)
  })
}
