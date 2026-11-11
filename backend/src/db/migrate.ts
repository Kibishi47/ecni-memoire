import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Pool } from 'pg'
import { getBackendRoot } from '../config/env.js'
import { closePool, getPool } from './pool.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface MigrationResult {
  applied: string[]
  skipped: string[]
}

/**
 * Resolves the directory containing `.sql` migration files.
 */
export function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(getBackendRoot(), 'src/migrations'),
    path.resolve(__dirname, '../migrations'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(`[db:migrate] Dossier de migrations introuvable (cherché dans : ${candidates.join(', ')})`)
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Applies all pending SQL migrations in deterministic lexicographical order.
 */
export async function runMigrations(pool: Pool = getPool(), migrationsDir: string = resolveMigrationsDir()): Promise<MigrationResult> {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))

  const applied: string[] = []
  const skipped: string[] = []

  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        checksum VARCHAR(64) NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `)

    const existingRes = await client.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM schema_migrations ORDER BY filename ASC',
    )
    const appliedMap = new Map(existingRes.rows.map((r) => [r.filename, r.checksum]))

    for (const filename of files) {
      const fullPath = path.join(migrationsDir, filename)
      const sql = fs.readFileSync(fullPath, 'utf8')
      const checksum = sha256(sql)

      const existingChecksum = appliedMap.get(filename)
      if (existingChecksum !== undefined) {
        if (existingChecksum !== checksum) {
          throw new Error(
            `[db:migrate] Checksum mismatch pour la migration déjà appliquée "${filename}" (attendu ${existingChecksum}, actuel ${checksum}).`,
          )
        }
        skipped.push(filename)
        continue
      }

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
          filename,
          checksum,
        ])
        await client.query('COMMIT')
        applied.push(filename)
        console.log(`[db:migrate] Migration appliquée : ${filename}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  } finally {
    client.release()
  }

  return { applied, skipped }
}

async function main(): Promise<void> {
  try {
    const result = await runMigrations()
    if (result.applied.length === 0) {
      console.log(`[db:migrate] Base à jour (${result.skipped.length} migration(s) déjà appliquée(s)).`)
    } else {
      console.log(
        `[db:migrate] Terminé : ${result.applied.length} appliquée(s), ${result.skipped.length} déjà présente(s).`,
      )
    }
  } finally {
    await closePool()
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1]!)).href

if (isDirectExecution) {
  main().catch((err) => {
    console.error('[db:migrate] Échec des migrations :', err)
    process.exit(1)
  })
}
