import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OLYDOR_SVG } from '@olydor/ui'
import {
  clearCompiledCards,
  decodeDeckFromUrl,
  encodeDeckForUrl,
  exportDeckToPtcgl,
  parsePtcglDecklist,
  registerCompiledCards,
} from '@olydor/engine'
import { getCardImageUrl } from '../utils/cardImage'
import { getLocalizedCardRules, setLanguage, t } from '../utils/i18n'
import {
  calibrateHardwareProfile,
  computeAiIntelligence,
  computeStatisticalVolume,
  estimateSimulationDurationSeconds,
} from '../services/hardwareBenchmark'
import {
  fetchAlternativesFromApi,
  fetchMetaDecks,
  isUsingOfflineCatalog,
  resolveCardsFromApi,
  searchCatalogCards,
} from '../services/apiClient'
import { mapApiMetaDecks } from '../services/metaDeckAdapter'
import { SimulationWorkerPool } from '../worker/workerPool'

const SIM_ROOT = resolve(__dirname, '..')
const LOCAL_DB_PATH = [
  resolve(SIM_ROOT, '../../tools/card-compiler/data/cards_database.json'),
  resolve(SIM_ROOT, 'public/cards_database.json'),
].find((p) => existsSync(p))
if (!LOCAL_DB_PATH) {
  throw new Error('cards_database.json introuvable pour les tests @olydor/insight')
}
const LOCAL_CARDS_JSON = JSON.parse(readFileSync(LOCAL_DB_PATH, 'utf8')) as unknown[]

afterEach(() => {
  vi.unstubAllGlobals()
  clearCompiledCards()
  isUsingOfflineCatalog.value = false
  setLanguage('fr')
})

describe('@olydor/insight migrated simulator suite', () => {
  it('uses the exact official SVG for public/favicon.svg and ships full local cards_database.json', () => {
    const favicon = readFileSync(resolve(SIM_ROOT, 'public/favicon.svg'), 'utf8').trim()
    expect(favicon).toBe(OLYDOR_SVG)
    expect(Object.keys(LOCAL_CARDS_JSON).length).toBeGreaterThan(800)
  })

  it('resolves basic energy images and TCGdex card URLs cleanly', () => {
    expect(getCardImageUrl({ nameFr: 'Énergie Feu', category: 'energy', number: '2' }, 'high')).toContain('SVE_002')
    expect(getCardImageUrl({ setCode: 'MEE', number: '15' })).toContain('SVE_007')
    const zardUrl = getCardImageUrl({ cardId: 'sv03-125' }, 'high')
    expect(zardUrl).toContain('high.webp')
  })

  it('switches language FR/EN and exposes Olydor simulator localization keys', () => {
    setLanguage('fr')
    expect(t('appTitle')).toBe('Olydor Insight')
    expect(t('debugModeBadge')).toContain('?debug=true')
    setLanguage('en')
    expect(t('sendToArena')).toContain('Arena')
    const rules = getLocalizedCardRules({
      rawRulesText: ['[Attaque FR: Lancer de Flamboyance]', '[Attack EN: Burning Darkness]'],
    }, 'en')
    expect(rules).toEqual(['[Attack: Burning Darkness]'])
  })

  it('calibrates hardware profile and estimates simulation duration cleanly', () => {
    const profile = calibrateHardwareProfile(true)
    expect(profile.logicalCores).toBeGreaterThanOrEqual(1)
    expect(profile.singleThreadGamesPerSec).toBeGreaterThan(0)

    const vol = computeStatisticalVolume('STANDARD')
    const ai = computeAiIntelligence('COMPETITIVE')
    const est = estimateSimulationDurationSeconds({ ...vol, ...ai, workerCount: 2 }, profile)
    expect(est.estimatedSeconds).toBeGreaterThan(0)
    expect(est.formattedDuration.length).toBeGreaterThan(0)
  })

  it('seamlessly falls back to /cards_database.json when API endpoints are unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/cards_database.json')) {
          return new Response(JSON.stringify(LOCAL_CARDS_JSON), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new TypeError('Failed to fetch')
      }),
    )

    const metaDecks = await fetchMetaDecks()
    expect(isUsingOfflineCatalog.value).toBe(true)
    expect(metaDecks.length).toBeGreaterThanOrEqual(1)
    expect(metaDecks[0]!.cards.length).toBeGreaterThan(0)

    const mapped = mapApiMetaDecks(metaDecks)
    expect(mapped[0]!.descriptor.models.length).toBe(60)

    const searchRes = await searchCatalogCards({ q: 'Dracaufeu', limit: 10 })
    expect(searchRes.items.length).toBeGreaterThan(0)

    const resolveRes = await resolveCardsFromApi([
      { key: 'OBF-125', candidateIds: ['sv03-125'], name: 'Charizard ex' },
    ])
    expect(Object.keys(resolveRes.resolved)).toContain('OBF-125')

    const alts = await fetchAlternativesFromApi({ cardIds: [searchRes.items[0]!.cardId], limitPerCard: 5 })
    expect(alts).toBeTypeOf('object')
  })

  it('runs a mini traced simulation in debugMode and encodes Arena ?deck= deep links cleanly', async () => {
    registerCompiledCards(LOCAL_CARDS_JSON)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline')
      }),
    )

    const metaDecks = await fetchMetaDecks()
    const mapped = mapApiMetaDecks(metaDecks)
    const firstDeck = mapped[0]!
    const parsedDeck = parsePtcglDecklist(firstDeck.metaDeck.ptcglText)
    expect(parsedDeck.isValid60).toBe(true)
    expect(parsedDeck.isFullyResolved).toBe(true)

    // Test URL round-trip for Arena handoff
    const exportedText = exportDeckToPtcgl(parsedDeck.cards, { lang: 'en', format: 'ptcgl' })
    const encoded = encodeDeckForUrl(exportedText)
    const decoded = decodeDeckFromUrl(encoded)
    expect(decoded).toContain('60')

    // Run 4 quick games with debugMode=true via SimulationWorkerPool fallback
    const pool = new SimulationWorkerPool()
    const summary = await pool.runSimulation(
      parsedDeck,
      {
        iterations: 4,
        maxTurns: 8,
        maxBranches: 8,
        lookaheadPly: 1,
        opponentLookaheadPly: 1,
        opponentMaxBranches: 8,
        selectedOpponentIds: [firstDeck.descriptor.id],
        firstPlayerMode: 'RANDOM',
        workerCount: 1,
        fixedSeed: 12345,
        debugMode: true,
        collectDetailedTelemetry: true,
      },
      undefined,
      [firstDeck.descriptor],
    )

    expect(summary.totalGamesSimulated).toBe(4)
    expect(summary.tracedGames?.length).toBeGreaterThan(0)
    expect(summary.tracedGames![0]!.turns.length).toBeGreaterThan(0)
  })

  it('wires BetaTesterBanner, AppNavbar, AppFooter, Step3 Arena CTA, and legal pages', () => {
    const layout = readFileSync(resolve(SIM_ROOT, 'layouts/default.vue'), 'utf8')
    const step3 = readFileSync(resolve(SIM_ROOT, 'components/Step3DashboardAndComparator.vue'), 'utf8')
    const mentions = readFileSync(resolve(SIM_ROOT, 'pages/mentions-legales.vue'), 'utf8')
    const privacy = readFileSync(resolve(SIM_ROOT, 'pages/confidentialite.vue'), 'utf8')
    const cgu = readFileSync(resolve(SIM_ROOT, 'pages/cgu.vue'), 'utf8')

    expect(layout).toContain('<BetaTesterBanner')
    expect(layout).toContain('active-app="insight"')
    expect(step3).toContain('arenaDeckUrl')
    expect(step3).toContain('DebugInspectorPanel')
    expect(mentions).toContain('LegalMentionsContent')
    expect(privacy).toContain('PrivacyPolicyContent')
    expect(cgu).toContain('TermsContent')
  })
})
