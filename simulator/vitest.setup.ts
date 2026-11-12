import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerCompiledCards } from './src/data/cardCatalog'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const candidatePaths = [
  path.resolve(__dirname, '../card-compiler/data/cards_database.json'),
  path.resolve(process.cwd(), '../card-compiler/data/cards_database.json'),
  path.resolve(process.cwd(), 'card-compiler/data/cards_database.json'),
]

const dbPath = candidatePaths.find((p) => fs.existsSync(p))
if (dbPath) {
  const rawJson = JSON.parse(fs.readFileSync(dbPath, 'utf8')) as unknown
  const rawList: unknown[] = Array.isArray(rawJson)
    ? rawJson
    : rawJson && typeof rawJson === 'object' && 'cards' in rawJson && (rawJson as { cards?: unknown }).cards
      ? Object.values((rawJson as { cards: Record<string, unknown> }).cards)
      : []
  registerCompiledCards(rawList)
}
