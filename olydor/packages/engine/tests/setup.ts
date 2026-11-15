import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerCompiledCards } from '../src/cardCatalog.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const candidatePaths = [
  path.resolve(__dirname, '../../../tools/card-compiler/data/cards_database.json'),
  path.resolve(__dirname, '../data/cards_database.json'),
  path.resolve(process.cwd(), '../../tools/card-compiler/data/cards_database.json'),
  path.resolve(process.cwd(), 'data/cards_database.json'),
]

const dbPath = candidatePaths.find((p) => fs.existsSync(p))
if (!dbPath) {
  throw new Error(`[engine/tests/setup] cards_database.json introuvable (${candidatePaths.join(', ')})`)
}

const rawJson = JSON.parse(fs.readFileSync(dbPath, 'utf8')) as unknown
const rawList: unknown[] = Array.isArray(rawJson)
  ? rawJson
  : rawJson && typeof rawJson === 'object' && 'cards' in rawJson && (rawJson as { cards?: unknown }).cards
    ? Object.values((rawJson as { cards: Record<string, unknown> }).cards)
    : []

registerCompiledCards(rawList)
