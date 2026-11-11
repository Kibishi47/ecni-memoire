import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parsePtcglDeckFile } from '../src/services/deckParserService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const META_DECKS_DIR = path.resolve(__dirname, '../meta_decks')

describe('deckParserService', () => {
  it('parses comment metadata and resolves PTCGL set aliases and padding', () => {
    const sample = `
# Name: Dracaufeu-ex / Roucarnage-ex | Archetype: Midrange Setup
Pokémon: 5
4 Charmander MEW 4 PH
1 Charizard ex OBF 125

Trainer: 2
2 Buddy-Buddy Poffin TEF 144

Energy: 3
3 Basic {R} Energy Energy 29

Total Cards: 10
`
    const parsed = parsePtcglDeckFile(sample, 'charizard_pidgeot.txt')
    expect(parsed.name).toBe('Dracaufeu-ex / Roucarnage-ex')
    expect(parsed.archetype).toBe('Midrange Setup')
    expect(parsed.totalCards).toBe(10)
    expect(parsed.warnings).toEqual([])

    expect(parsed.cards[0]).toMatchObject({
      count: 4,
      cardId: 'sv03.5-004',
      foil: 'PH',
      category: 'pokemon',
    })
    expect(parsed.cards[1]).toMatchObject({
      count: 1,
      cardId: 'sv03-125',
      category: 'pokemon',
    })
    expect(parsed.cards[2]).toMatchObject({
      count: 2,
      cardId: 'sv05-144',
      category: 'trainer',
    })
    expect(parsed.cards[3]).toMatchObject({
      count: 3,
      setId: 'sve',
      category: 'energy',
    })
    expect(parsed.cards[3]!.candidateCardIds).toContain('sve-002')
  })

  it('falls back to humanized filename when header metadata is absent', () => {
    const parsed = parsePtcglDeckFile('4 Dreepy TWM 128\n', 'raging_bolt.txt')
    expect(parsed.name).toBe('Raging Bolt')
    expect(parsed.archetype).toBeNull()
    expect(parsed.cards[0]!.cardId).toBe('sv06-128')
  })

  it('parses all meta_decks/*.txt files to exactly 60 cards without warnings', () => {
    const files = fs.readdirSync(META_DECKS_DIR).filter((f) => f.endsWith('.txt'))
    expect(files.length).toBeGreaterThanOrEqual(3)

    for (const file of files) {
      const content = fs.readFileSync(path.join(META_DECKS_DIR, file), 'utf8')
      const parsed = parsePtcglDeckFile(content, file)
      expect(parsed.warnings).toEqual([])
      expect(parsed.totalCards).toBe(60)
      expect(parsed.name.length).toBeGreaterThan(0)
      expect(parsed.archetype).toBeTruthy()
    }
  })
})
