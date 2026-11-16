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
  getApiBaseUrl,
  isUsingOfflineCatalog,
  resolveCardsFromApi,
  searchCatalogCards,
  setApiBaseUrl,
} from '../services/apiClient'
import { mapApiMetaDecks } from '../services/metaDeckAdapter'
import {
  SimulationWorkerPool,
  areDecksEquivalent,
  generateRandomBaseSeed,
  resolveRunSeed,
} from '../worker/workerPool'

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

  it('switches language FR/EN without hardcoded 854 card counts and shares i18n with @olydor/ui', () => {
    setLanguage('fr')
    expect(t('appTitle')).toBe('Olydor Insight')
    expect(t('debugModeBadge')).toContain('?debug=true')
    expect(t('debugModeBadge')).toBe('MODE DEBUG (?debug=true)')
    expect(t('offlineCatalogBanner')).not.toContain('854')
    expect(t('winInitial')).toBe('V')
    expect(t('simStopBtn')).toContain('Annuler')
    setLanguage('en')
    expect(t('debugModeBadge')).toBe('DEBUG MODE (?debug=true)')
    expect(t('sendToArena')).toContain('Arena')
    expect(t('offlineCatalogBanner')).not.toContain('854')
    expect(t('winInitial')).toBe('W')
    expect(t('simStopBtn')).toContain('Cancel')
    const rules = getLocalizedCardRules({
      rawRulesText: ['[Attaque FR: Lancer de Flamboyance]', '[Attack EN: Burning Darkness]'],
    }, 'en')
    expect(rules).toEqual(['[Attack: Burning Darkness]'])
  })

  it('resolves local API URL automatically in local dev via apiClient', () => {
    setApiBaseUrl('https://api.olydor.app')
    expect(getApiBaseUrl()).toBe('http://localhost:3000')
    setApiBaseUrl('http://localhost:3456')
    expect(getApiBaseUrl()).toBe('http://localhost:3456')
    setApiBaseUrl('')
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

    // Run 4 quick games with traceSampleLimit=50 and debugMode=false via SimulationWorkerPool fallback
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
        debugMode: false,
        traceSampleLimit: 50,
        collectDetailedTelemetry: true,
      },
      undefined,
      [firstDeck.descriptor],
    )

    expect(summary.totalGamesSimulated).toBe(4)
    expect(summary.tracedGames?.length).toBeGreaterThan(0)
    expect(summary.tracedGames![0]!.turns.length).toBeGreaterThan(0)
  })

  it('streamlines WizardHeader, removes old Step1 Hero, disables Arena buttons, and wires layout + legal routes', () => {
    const nuxtConfig = readFileSync(resolve(SIM_ROOT, 'nuxt.config.ts'), 'utf8')
    const layout = readFileSync(resolve(SIM_ROOT, 'layouts/default.vue'), 'utf8')
    const wizardHeader = readFileSync(resolve(SIM_ROOT, 'components/WizardHeader.vue'), 'utf8')
    const step1 = readFileSync(resolve(SIM_ROOT, 'components/Step1DeckImport.vue'), 'utf8')
    const step2 = readFileSync(resolve(SIM_ROOT, 'components/Step2SimConfig.vue'), 'utf8')
    const step3 = readFileSync(resolve(SIM_ROOT, 'components/Step3DashboardAndComparator.vue'), 'utf8')
    const cardZoomModal = readFileSync(resolve(SIM_ROOT, 'components/CardZoomModal.vue'), 'utf8')
    const debugPanel = readFileSync(resolve(SIM_ROOT, 'components/DebugInspectorPanel.vue'), 'utf8')
    const indexPage = readFileSync(resolve(SIM_ROOT, 'pages/index.vue'), 'utf8')
    const mentions = readFileSync(resolve(SIM_ROOT, 'pages/mentions-legales.vue'), 'utf8')
    const privacy = readFileSync(resolve(SIM_ROOT, 'pages/confidentialite.vue'), 'utf8')
    const cgu = readFileSync(resolve(SIM_ROOT, 'pages/cgu.vue'), 'utf8')

    expect(nuxtConfig).toContain("transpile: ['@olydor/ui', '@olydor/engine']")
    expect(nuxtConfig).toContain("include: ['lucide-vue-next']")
    expect(nuxtConfig).toContain('http://localhost:3000')

    // WizardHeader keeps only steps + deck counter + status badges (no duplicate title or lang toggle)
    expect(wizardHeader).toContain('data-testid="wizard-header"')
    expect(wizardHeader).toContain('`wizard-step-${step.num}`')
    expect(wizardHeader).not.toContain('appTitle')
    expect(wizardHeader).not.toContain('setLanguage')

    // Step1 opens directly into deck import without old Hero section
    expect(step1).not.toContain('SECTION HERO INTUITIVE')
    expect(step1).not.toContain('from-slate-900')
    expect(step1).not.toContain('currentLang ===')
    expect(step2).not.toContain('currentLang ===')

    // Step3 keeps arenaDeckUrl computation for later launch while rendering disabled buttons
    expect(layout).toContain('<AlphaTesterBanner')
    expect(layout).not.toContain('<AlphaOnboardingModal')
    expect(layout).toContain('active-app="insight"')
    expect(step3).toContain('arenaDeckUrl')
    expect(step3).toContain('data-testid="step3-arena-disabled"')
    expect(step3).toContain('data-testid="step3-export-arena-disabled"')
    expect(step3).not.toContain('<a\n            v-if="editableDeck.totalCards === 60"\n            :href="arenaDeckUrl"')
    expect(step3).not.toContain('currentLang ===')
    expect(cardZoomModal).not.toContain('bg-[#ff6b00] text-white shadow-2xl')
    expect(cardZoomModal).not.toContain('bg-[#ff6b00] p-2 text-xs')
    expect(cardZoomModal).not.toContain('bg-[#ff6b00]/80')
    expect(cardZoomModal).not.toContain('text-amber-200')
    expect(debugPanel).not.toContain('bg-[#ff6b00] px-4 py-3')
    expect(debugPanel).not.toContain('?debug=true')
    expect(debugPanel).not.toContain('\\rightarrow')
    expect(step2).not.toContain('?debug=true')
    expect(step2).not.toContain('!isDebugMode')
    expect(wizardHeader).toContain('?debug=true')
    for (const src of [step1, step2, step3, cardZoomModal, debugPanel]) {
      expect(src).not.toMatch(/\/450\b/)
      expect(src).not.toMatch(/\/(?:35|45|60)\/(?:25|40|50|60|70)\b/)
    }
    expect(step3).toContain('data-testid="toggle-ai-inspector"')
    expect(step3).toContain('<DebugInspectorPanel :traced-games="currentSummary.tracedGames" />')
    expect(step3).not.toContain('v-if="isDebugMode && currentSummary?.tracedGames')
    expect(debugPanel).toContain('data-testid="inspector-prev-game"')
    expect(debugPanel).toContain('data-testid="inspector-next-game"')
    expect(debugPanel).toContain('data-testid="inspector-game-select"')
    expect(indexPage).toContain('traceSampleLimit: 50')
    expect(step3).toContain('sm:flex-row sm:items-center sm:justify-between')
    expect(step3).toContain('min-w-0 flex-1')
    expect(step3).toContain('bg-emerald-500')
    expect(step3).toContain('bg-red-500')
    expect(indexPage).not.toContain('Simulation en cours sur')
    expect(indexPage).toContain('Number.parseInt')
    expect(indexPage).toContain('meta_api_${presetNum}')
    expect(indexPage).not.toContain('d.name.toLowerCase().includes(preset)')
    expect(mentions).toContain('LegalMentionsContent')
    expect(privacy).toContain('PrivacyPolicyContent')
    expect(cgu).toContain('TermsContent')
    expect(indexPage).toContain('resolveRunSeed')
    expect(indexPage).toContain('areDecksEquivalent')
    expect(step3).toContain('data-testid="step3-base-seed"')
  })

  it('changes random seed on rerun when fixedSeed is unset, and preserves baseline seed only for deck variants', async () => {
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
    const parsedA = parsePtcglDecklist(firstDeck.metaDeck.ptcglText)
    const parsedB = parsePtcglDecklist(mapped[1]!.metaDeck.ptcglText)

    expect(areDecksEquivalent(parsedA, parsePtcglDecklist(firstDeck.metaDeck.ptcglText))).toBe(true)
    expect(areDecksEquivalent(parsedA, parsedB)).toBe(false)

    // 1. Rerun without fixedSeed on the same deck -> seed changes
    const s1 = resolveRunSeed({ configuredFixedSeed: null, reuseBaselineSeed: false })
    const s2 = resolveRunSeed({
      configuredFixedSeed: null,
      reuseBaselineSeed: false,
      baselineSeed: s1,
      previousSeed: s1,
    })
    expect(s2).not.toBe(s1)

    // 2. Rerun without fixedSeed on another deck version -> seed stays equal to baselineSeed
    const variantSeed = resolveRunSeed({
      configuredFixedSeed: null,
      reuseBaselineSeed: true,
      baselineSeed: s1,
      previousSeed: s2,
    })
    expect(variantSeed).toBe(s1)

    // 3. Explicit fixedSeed always takes precedence
    expect(
      resolveRunSeed({
        configuredFixedSeed: 987654,
        reuseBaselineSeed: false,
        baselineSeed: s1,
        previousSeed: s1,
      }),
    ).toBe(987654)
    expect(generateRandomBaseSeed(123456)).not.toBe(123456)

    // 4. SimulationWorkerPool with fixedSeed: null produces different random baseSeedUsed across consecutive runs
    const pool = new SimulationWorkerPool()
    const baseCfg = {
      iterations: 1,
      maxTurns: 4,
      maxBranches: 8 as const,
      lookaheadPly: 1 as const,
      opponentLookaheadPly: 1 as const,
      opponentMaxBranches: 8 as const,
      selectedOpponentIds: [firstDeck.descriptor.id],
      firstPlayerMode: 'RANDOM' as const,
      workerCount: 1,
      fixedSeed: null,
      debugMode: false,
      collectDetailedTelemetry: false,
    }
    const run1 = await pool.runSimulation(parsedA, baseCfg, undefined, [firstDeck.descriptor])
    const run2 = await pool.runSimulation(parsedA, baseCfg, undefined, [firstDeck.descriptor])
    expect(run1.baseSeedUsed).toBeGreaterThan(0)
    expect(run2.baseSeedUsed).not.toBe(run1.baseSeedUsed)
  })
})
