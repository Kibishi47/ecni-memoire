import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const candidateSourcePaths = [
  path.resolve(__dirname, '../../card-compiler/data/cards_database.json'),
  path.resolve(process.cwd(), '../card-compiler/data/cards_database.json'),
  path.resolve(process.cwd(), 'card-compiler/data/cards_database.json'),
]

const targetPath = path.resolve(__dirname, '../src/data/cards_database.json')

let sourcePath = null
for (const p of candidateSourcePaths) {
  if (fs.existsSync(p)) {
    sourcePath = p
    break
  }
}

const targetDir = path.dirname(targetPath)
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true })
}

if (sourcePath && fs.existsSync(sourcePath)) {
  try {
    const rawContent = fs.readFileSync(sourcePath, 'utf-8')
    const parsed = JSON.parse(rawContent)
    const cardCount = parsed && parsed.cards ? Object.keys(parsed.cards).length : 0

    fs.copyFileSync(sourcePath, targetPath)
    console.log(
      `[syncCardDatabase] Base de cartes synchronisée avec succès (${cardCount} carte(s)) depuis ${sourcePath}`,
    )
  } catch (err) {
    console.error(`[syncCardDatabase] Erreur lors de la lecture de ${sourcePath} :`, err)
    ensureStubFile()
  }
} else {
  console.warn(
    `[syncCardDatabase] Fichier source card-compiler/data/cards_database.json introuvable.`,
  )
  ensureStubFile()
}

function ensureStubFile() {
  if (!fs.existsSync(targetPath)) {
    const stub = {
      schemaVersion: '1.0.0',
      updatedAtIso: new Date().toISOString(),
      totalCards: 0,
      cards: {},
    }
    fs.writeFileSync(targetPath, JSON.stringify(stub, null, 2), 'utf-8')
    console.log(`[syncCardDatabase] Fichier stub vide créé : ${targetPath}`)
  } else {
    console.log(`[syncCardDatabase] Le fichier cible existant est conservé : ${targetPath}`)
  }
}
