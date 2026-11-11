import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Pool } from 'pg'
import { getBackendRoot } from '../config/env.js'
import { closePool, getPool } from '../db/pool.js'
import { parsePtcglDeckFile } from '../services/deckParserService.js'

export interface SeedDeckResult {
  decksCount: number
  missingCards: Array<{ file: string; cardId: string; name: string; line: number }>
}

/**
 * Resolves the `meta_decks/` directory containing `.txt` PTCGL decklists.
 */
export function resolveMetaDecksDir(explicitDir?: string): string {
  const candidates = [
    explicitDir,
    path.resolve(getBackendRoot(), 'meta_decks'),
    path.resolve(process.cwd(), 'meta_decks'),
  ].filter((p): p is string => Boolean(p && p.trim()))

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (fs.existsSync(resolved)) {
      return resolved
    }
  }

  throw new Error(
    `[seedMetaDecks] Dossier meta_decks/ introuvable (cherché dans : ${candidates.join(', ')})`,
  )
}

/**
 * Reads `.txt` PTCGL decklists from `meta_decks/`, verifies card existence in PostgreSQL,
 * and replaces active meta decks inside a single transaction.
 */
export async function seedMetaDecks(
  pool: Pool = getPool(),
  metaDecksDir: string = resolveMetaDecksDir(),
): Promise<SeedDeckResult> {
  const files = fs
    .readdirSync(metaDecksDir)
    .filter((file) => file.endsWith('.txt'))
    .sort((a, b) => a.localeCompare(b))

  if (files.length === 0) {
    console.warn(`[seedMetaDecks] Aucun fichier .txt trouvé dans ${metaDecksDir}.`)
    return { decksCount: 0, missingCards: [] }
  }

  const parsedDecks = files.map((file) => {
    const content = fs.readFileSync(path.join(metaDecksDir, file), 'utf8')
    return {
      file,
      parsed: parsePtcglDeckFile(content, file),
    }
  })

  const allCandidateIds = new Set<string>()
  for (const item of parsedDecks) {
    for (const card of item.parsed.cards) {
      for (const candidate of card.candidateCardIds) {
        allCandidateIds.add(candidate)
      }
    }
  }

  const missingCards: SeedDeckResult['missingCards'] = []
  let decksCount = 0

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Remplace proprement les decks méta existants dans la transaction
    await client.query('DELETE FROM card_deck')
    await client.query('DELETE FROM decks')
    await client.query("SELECT setval(pg_get_serial_sequence('decks', 'id'), 1, false)")

    const cardRows = await client.query<{ id: number; card_id: string }>(
      'SELECT id, card_id FROM cards WHERE card_id = ANY($1::varchar[])',
      [Array.from(allCandidateIds)],
    )
    const dbCardIdMap = new Map(cardRows.rows.map((row) => [row.card_id, row.id]))

    for (const { file, parsed } of parsedDecks) {
      for (const warn of parsed.warnings) {
        console.warn(`[seedMetaDecks] Warning (${file}) : ${warn}`)
      }

      const aggregatedCounts = new Map<number, number>()
      let resolvedTotal = 0

      for (const entry of parsed.cards) {
        let dbId: number | undefined
        for (const candidate of entry.candidateCardIds) {
          const hit = dbCardIdMap.get(candidate)
          if (hit !== undefined) {
            dbId = hit
            break
          }
        }

        if (dbId === undefined) {
          console.warn(
            `[seedMetaDecks] WARNING (${file}) : Carte manquante dans la table cards -> "${entry.name}" (${entry.cardId}) [ligne ${entry.line}]`,
          )
          missingCards.push({
            file,
            cardId: entry.cardId,
            name: entry.name,
            line: entry.line,
          })
          continue
        }

        aggregatedCounts.set(dbId, (aggregatedCounts.get(dbId) ?? 0) + entry.count)
        resolvedTotal += entry.count
      }

      if (resolvedTotal !== 60) {
        console.warn(
          `[seedMetaDecks] WARNING (${file}) : ${resolvedTotal}/60 cartes résolues dans PostgreSQL pour "${parsed.name}".`,
        )
      }

      const insertDeckRes = await client.query<{ id: number }>(
        'INSERT INTO decks (name, archetype, is_active) VALUES ($1, $2, TRUE) RETURNING id',
        [parsed.name, parsed.archetype],
      )
      const deckId = insertDeckRes.rows[0]!.id

      for (const [cardDbId, count] of aggregatedCounts.entries()) {
        if (count < 1 || count > 59) {
          console.warn(
            `[seedMetaDecks] WARNING (${file}) : Quantité invalide (${count}) ignorée pour id_card=${cardDbId}.`,
          )
          continue
        }
        await client.query(
          'INSERT INTO card_deck (id_deck, id_card, count) VALUES ($1, $2, $3)',
          [deckId, cardDbId, count],
        )
      }

      decksCount += 1
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  console.log(`[seedMetaDecks] ${decksCount} decks méta enregistrés avec succès.`)
  return { decksCount, missingCards }
}

async function main(): Promise<void> {
  try {
    await seedMetaDecks()
  } finally {
    await closePool()
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1]!)).href

if (isDirectExecution) {
  main().catch((err) => {
    console.error('[seedMetaDecks] Erreur lors de l’importation des decks méta :', err)
    process.exit(1)
  })
}
