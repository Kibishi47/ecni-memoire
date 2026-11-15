import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BETA_FEEDBACK_FORM_URL, OLYDOR_SVG } from '@olydor/ui'
import {
  META_OPPONENT_DECKS,
  decodeDeckFromUrl,
  encodeDeckForUrl,
  parsePtcglDecklist,
  registerCompiledCards,
} from '@olydor/engine'

const ARENA_ROOT = resolve(__dirname, '..')
const LOCAL_DB_PATH = [
  resolve(ARENA_ROOT, '../../tools/card-compiler/data/cards_database.json'),
  resolve(ARENA_ROOT, 'public/cards_database.json'),
].find((p) => existsSync(p))
if (!LOCAL_DB_PATH) {
  throw new Error('cards_database.json introuvable pour les tests @olydor/arena')
}
const LOCAL_CARDS_JSON = JSON.parse(readFileSync(LOCAL_DB_PATH, 'utf8')) as unknown[]

describe('@olydor/arena Coming Soon & Deep-Link suite', () => {
  it('uses the exact official SVG for public/favicon.svg', () => {
    const favicon = readFileSync(resolve(ARENA_ROOT, 'public/favicon.svg'), 'utf8').trim()
    expect(favicon).toBe(OLYDOR_SVG.trim())
  })

  it('decodes ?deck= base64url payloads and validates 60-card PTCGL decklists against the engine catalog', () => {
    registerCompiledCards(LOCAL_CARDS_JSON)
    const samplePtcgl = META_OPPONENT_DECKS[0]!.ptcglText
    const encoded = encodeDeckForUrl(samplePtcgl)
    const decoded = decodeDeckFromUrl(encoded)
    expect(decoded).toContain('Dragapult ex')

    const parsed = parsePtcglDecklist(decoded)
    expect(parsed.totalCards).toBe(60)
    expect(parsed.isValid60).toBe(true)
    expect(parsed.isFullyResolved).toBe(true)
  })

  it('renders Pythia 3-Ply showcase, 62% - 38% Win Probability bar, Blunder Analysis, ?deck= banner and Beta Google Form CTA', () => {
    const indexSrc = readFileSync(resolve(ARENA_ROOT, 'pages/index.vue'), 'utf8')

    expect(indexSrc).toContain('ARÈNE TACTIQUE 1v1 — EN DÉVELOPPEMENT (COMING SOON)')
    expect(indexSrc).toContain('Pythia')
    expect(indexSrc).toContain('Win Probability Bar : {{ activeScenario.playerWinPct }}% - {{ activeScenario.pythiaWinPct }}%')
    expect(indexSrc).toContain('playerWinPct: 62')
    expect(indexSrc).toContain('pythiaWinPct: 38')
    expect(indexSrc).toContain('Blunder Analysis')
    expect(indexSrc).toContain('-14.8% EV')
    expect(indexSrc).toContain('+9.2% EV')
    expect(indexSrc).toContain("Votre deck de 60 cartes est prêt et validé pour l'Arène ! En attendant l'ouverture des duels")
    expect(indexSrc).toContain('BETA_FEEDBACK_FORM_URL')
    expect(BETA_FEEDBACK_FORM_URL).toBe('https://forms.gle/6FC4YYmw7nMkj3wT9')
    expect(indexSrc).toContain('Takeback')
    expect(indexSrc).toContain('Coach en direct')
    expect(indexSrc).toContain('Puzzles de fin de partie')
  })

  it('wires SSR Nuxt config, shared UI layout (active-app="arena"), SEO sitemap, and all 3 legal routes', () => {
    const nuxtConfig = readFileSync(resolve(ARENA_ROOT, 'nuxt.config.ts'), 'utf8')
    const layoutSrc = readFileSync(resolve(ARENA_ROOT, 'layouts/default.vue'), 'utf8')
    const mentions = readFileSync(resolve(ARENA_ROOT, 'pages/mentions-legales.vue'), 'utf8')
    const confidentialite = readFileSync(resolve(ARENA_ROOT, 'pages/confidentialite.vue'), 'utf8')
    const cgu = readFileSync(resolve(ARENA_ROOT, 'pages/cgu.vue'), 'utf8')
    const sitemap = readFileSync(resolve(ARENA_ROOT, 'public/sitemap.xml'), 'utf8')

    expect(nuxtConfig).toContain('ssr: true')
    expect(nuxtConfig).toContain('@olydor/ui/theme.css')
    expect(nuxtConfig).toContain("transpile: ['@olydor/ui', '@olydor/engine']")
    expect(nuxtConfig).toContain("include: ['lucide-vue-next']")
    expect(layoutSrc).toContain('<BetaTesterBanner')
    expect(layoutSrc).toContain('active-app="arena"')
    expect(layoutSrc).toContain('<AppFooter')
    expect(mentions).toContain('<LegalMentionsContent')
    expect(confidentialite).toContain('<PrivacyPolicyContent')
    expect(cgu).toContain('<TermsContent')
    expect(sitemap).toContain('https://arena.olydor.app/')
  })
})
