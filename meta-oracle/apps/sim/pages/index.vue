<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw } from 'vue'
import type {
  EngineCardModel,
  MetaOpponentDeck,
  ParsedDeck,
  ParsedDeckEntry,
  SimulationConfig,
  SimulationMetricsSummary,
} from '@meta-oracle/types'
import {
  META_OPPONENT_DECKS,
  buildDeckEntryFromModel,
  computeDeckSummary,
  decodeDeckFromUrl,
  parsePtcglDecklist,
  parsePtcglDecklistWithApi,
  type OpponentDeckDescriptor,
} from '@meta-oracle/engine'
import {
  ensureLocalCatalogLoaded,
  fetchMetaDecks,
  resolveCardsFromApi,
  setApiBaseUrl,
} from '../services/apiClient'
import { mapApiMetaDecks } from '../services/metaDeckAdapter'
import { SimulationWorkerPool } from '../worker/workerPool'
import {
  calibrateHardwareProfile,
  computeAiIntelligence,
  computeHardwareAllocation,
  computeStatisticalVolume,
  getRecommendedPresetsForProfile,
  recordActualSimulationThroughput,
  type HardwareProfile,
} from '../services/hardwareBenchmark'
import { useI18n } from '../utils/i18n'
import WizardHeader from '../components/WizardHeader.vue'
import Step1DeckImport from '../components/Step1DeckImport.vue'
import Step2SimConfig from '../components/Step2SimConfig.vue'
import Step3DashboardAndComparator, {
  type DeckVersionEntry,
} from '../components/Step3DashboardAndComparator.vue'

const config = useRuntimeConfig()
setApiBaseUrl(config.public.apiUrl)

const currentStep = ref<1 | 2 | 3>(1)
const isDebugMode = ref<boolean>(false)
const { t } = useI18n()

const hardwareProfile = ref<HardwareProfile>(calibrateHardwareProfile(false))
const maxHardwareWorkers = computed(() => hardwareProfile.value.workerThreadsMax)
const initialPresets = getRecommendedPresetsForProfile(hardwareProfile.value)

const rawDeckText = ref<string>('')
const baselineDeck = ref<ParsedDeck>(parsePtcglDecklist(''))
const editableDeck = ref<ParsedDeck>(parsePtcglDecklist(''))

const deckVersions = ref<DeckVersionEntry[]>([])
const activeVersionId = ref<string>('')

const metaOpponents = ref<MetaOpponentDeck[]>([])
const metaOpponentDescriptors = ref<OpponentDeckDescriptor[]>([])
const metaLoading = ref<boolean>(false)
const metaError = ref<string | null>(null)
const isResolvingDeck = ref<boolean>(false)
const deckResolveError = ref<string | null>(null)

const simConfig = ref<SimulationConfig>({
  ...computeStatisticalVolume(initialPresets.volume),
  ...computeAiIntelligence(initialPresets.ai),
  ...computeHardwareAllocation(initialPresets.cpu, hardwareProfile.value.workerThreadsMax),
  selectedOpponentIds: [],
  firstPlayerMode: 'RANDOM',
  fixedSeed: null,
  debugMode: false,
  perturbationType: 'NONE',
  perturbationTurn: 2,
  stressTestOhkoEachTurn: false,
  collectDetailedTelemetry: true,
})

const baselineSummary = ref<SimulationMetricsSummary | null>(null)
const currentSummary = ref<SimulationMetricsSummary | null>(null)

const isSimulating = ref<boolean>(false)
const simulationError = ref<string | null>(null)
const cancelNotice = ref<string | null>(null)
let cancelNoticeTimeout: ReturnType<typeof setTimeout> | null = null
const progressCompleted = ref<number>(0)
const progressTotal = ref<number>(0)
const progressElapsedMs = ref<number>(0)

const progressPercent = computed(() => {
  if (progressTotal.value <= 0) return 0
  return Math.min(100, Math.round((progressCompleted.value / progressTotal.value) * 100))
})

const liveThroughput = computed(() => {
  if (progressElapsedMs.value <= 0) return 0
  const sec = progressElapsedMs.value / 1000
  return Math.round(progressCompleted.value / sec)
})

const workerPool = new SimulationWorkerPool()

function detectUrlParams() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const debugActive = params.get('debug') === 'true' || params.get('debug') === '1'
  isDebugMode.value = debugActive
  simConfig.value.debugMode = debugActive
}

async function applyInitialDeckFromUrl() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const encodedDeck = params.get('deck')
  if (encodedDeck) {
    const decoded = decodeDeckFromUrl(encodedDeck)
    if (decoded && decoded.trim().length > 0) {
      await handleValidateDeck(decoded)
      return
    }
  }
  const preset = params.get('preset')?.toLowerCase().trim()
  if (preset && META_OPPONENT_DECKS.length > 0) {
    const matched =
      META_OPPONENT_DECKS.find(
        (d) => d.id.toLowerCase().includes(preset) || d.name.toLowerCase().includes(preset),
      ) ?? META_OPPONENT_DECKS[0]
    if (matched) {
      await ensureLocalCatalogLoaded()
      await handleValidateDeck(matched.ptcglText)
    }
  }
}

function handleCancelSimulation() {
  workerPool.cancelSimulation()
  isSimulating.value = false
  simulationError.value = null
  cancelNotice.value = t('simulationCancelled')
  if (cancelNoticeTimeout) clearTimeout(cancelNoticeTimeout)
  cancelNoticeTimeout = setTimeout(() => {
    cancelNotice.value = null
  }, 4500)
}

async function loadMetaDecks() {
  metaLoading.value = true
  metaError.value = null
  try {
    const apiDecks = await fetchMetaDecks()
    const mapped = mapApiMetaDecks(apiDecks)
    metaOpponents.value = mapped.map((m) => m.metaDeck)
    metaOpponentDescriptors.value = mapped.map((m) => m.descriptor)
    const availableIds = new Set(metaOpponents.value.map((d) => d.id))
    const preserved = simConfig.value.selectedOpponentIds.filter((id) => availableIds.has(id))
    simConfig.value.selectedOpponentIds =
      preserved.length > 0 ? preserved : metaOpponents.value.map((d) => d.id)
  } catch (err) {
    metaError.value = err instanceof Error ? err.message : String(err)
  } finally {
    metaLoading.value = false
  }
}

onMounted(() => {
  detectUrlParams()
  void ensureLocalCatalogLoaded()
  void loadMetaDecks()
  void applyInitialDeckFromUrl()
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', detectUrlParams)
  }
})

onBeforeUnmount(() => {
  workerPool.terminateAll()
  if (typeof window !== 'undefined') {
    window.removeEventListener('popstate', detectUrlParams)
  }
})

const canGoStep2 = computed(
  () =>
    baselineDeck.value.isValid60 &&
    baselineDeck.value.isFullyResolved &&
    baselineDeck.value.cards.length > 0,
)
const canGoStep3 = computed(() => currentSummary.value !== null || isSimulating.value)

let resolveDeckSeq = 0

async function handleValidateDeck(newRawText: string) {
  rawDeckText.value = newRawText
  deckResolveError.value = null
  isResolvingDeck.value = true
  const seq = ++resolveDeckSeq

  try {
    await ensureLocalCatalogLoaded()
    const parsed = await parsePtcglDecklistWithApi(newRawText, resolveCardsFromApi)
    if (seq !== resolveDeckSeq) return
    baselineDeck.value = parsed
    editableDeck.value = parsePtcglDecklist(newRawText)
    baselineSummary.value = null
    currentSummary.value = null

    const v1: DeckVersionEntry = {
      id: 'v1',
      versionNumber: 1,
      label: 'Version 1 (Initiale)',
      deck: parsePtcglDecklist(newRawText),
      summary: null,
      timestamp: Date.now(),
      isBaseline: true,
    }
    deckVersions.value = [v1]
    activeVersionId.value = 'v1'
  } catch (err) {
    if (seq !== resolveDeckSeq) return
    deckResolveError.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (seq === resolveDeckSeq) {
      isResolvingDeck.value = false
    }
  }
}

function handleSelectStep(step: 1 | 2 | 3) {
  if (step === 2 && !canGoStep2.value) return
  if (step === 3 && !canGoStep3.value) return
  currentStep.value = step
}

function handleUpdateConfig(updated: SimulationConfig) {
  simConfig.value = {
    ...updated,
    debugMode: isDebugMode.value,
  }
}

async function executeInitialSimulation() {
  if (!baselineDeck.value.isValid60 || !baselineDeck.value.isFullyResolved || isSimulating.value) return
  simulationError.value = null
  currentStep.value = 3
  isSimulating.value = true
  progressCompleted.value = 0
  progressTotal.value = simConfig.value.iterations
  progressElapsedMs.value = 0

  try {
    if (metaOpponentDescriptors.value.length === 0) {
      await loadMetaDecks()
    }
    if (metaError.value || metaOpponentDescriptors.value.length === 0) {
      throw new Error(metaError.value || t('noMetaDecksAvailable'))
    }
    const rawDeck = toRaw(baselineDeck.value)
    const rawConfig = { ...toRaw(simConfig.value), debugMode: isDebugMode.value }
    const rawOpponents = toRaw(metaOpponentDescriptors.value)
    const summary = await workerPool.runSimulation(
      JSON.parse(JSON.stringify(rawDeck)),
      JSON.parse(JSON.stringify(rawConfig)),
      (completed, total, elapsed) => {
        progressCompleted.value = completed
        progressTotal.value = total
        progressElapsedMs.value = elapsed
      },
      JSON.parse(JSON.stringify(rawOpponents)),
    )
    baselineSummary.value = summary
    currentSummary.value = summary
    recordActualSimulationThroughput(summary.gamesPerSecond, rawConfig)
    hardwareProfile.value = calibrateHardwareProfile(false)
    if (deckVersions.value.length > 0 && deckVersions.value[0]) {
      deckVersions.value[0].summary = summary
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('annulée')) {
      cancelNotice.value = t('simulationCancelled')
      simulationError.value = null
    } else {
      simulationError.value = err instanceof Error ? err.message : String(err)
      console.error('Erreur lors de la simulation initiale :', err)
    }
  } finally {
    isSimulating.value = false
  }
}

async function executeComparisonSimulation() {
  if (
    editableDeck.value.totalCards !== 60 ||
    !editableDeck.value.hasAtLeastOneBasic ||
    !editableDeck.value.isFullyResolved ||
    isSimulating.value
  ) {
    return
  }

  const activeVer = deckVersions.value.find((v) => v.id === activeVersionId.value)
  let targetVersion: DeckVersionEntry
  if (activeVer && activeVer.versionNumber === 1 && deckVersions.value.length === 1) {
    const v2: DeckVersionEntry = {
      id: 'v2',
      versionNumber: 2,
      label: 'Version 2 (Variante)',
      deck: computeDeckSummary(editableDeck.value.cards.map((c) => ({ ...c })), editableDeck.value.format),
      summary: null,
      timestamp: Date.now(),
      isBaseline: false,
    }
    deckVersions.value.push(v2)
    activeVersionId.value = 'v2'
    targetVersion = v2
  } else if (activeVer) {
    targetVersion = activeVer
    targetVersion.deck = computeDeckSummary(editableDeck.value.cards.map((c) => ({ ...c })), editableDeck.value.format)
  } else {
    const newNum = deckVersions.value.length + 1
    const newVer: DeckVersionEntry = {
      id: `v${newNum}`,
      versionNumber: newNum,
      label: `Version ${newNum}`,
      deck: computeDeckSummary(editableDeck.value.cards.map((c) => ({ ...c })), editableDeck.value.format),
      summary: null,
      timestamp: Date.now(),
      isBaseline: false,
    }
    deckVersions.value.push(newVer)
    activeVersionId.value = newVer.id
    targetVersion = newVer
  }

  simulationError.value = null
  isSimulating.value = true
  progressCompleted.value = 0
  progressTotal.value = simConfig.value.iterations
  progressElapsedMs.value = 0

  try {
    if (metaOpponentDescriptors.value.length === 0) {
      await loadMetaDecks()
    }
    if (metaError.value || metaOpponentDescriptors.value.length === 0) {
      throw new Error(metaError.value || t('noMetaDecksAvailable'))
    }
    const rawDeck = toRaw(editableDeck.value)
    const rawConfig = { ...toRaw(simConfig.value), debugMode: isDebugMode.value }
    const rawOpponents = toRaw(metaOpponentDescriptors.value)
    const summary = await workerPool.runSimulation(
      JSON.parse(JSON.stringify(rawDeck)),
      JSON.parse(JSON.stringify(rawConfig)),
      (completed, total, elapsed) => {
        progressCompleted.value = completed
        progressTotal.value = total
        progressElapsedMs.value = elapsed
      },
      JSON.parse(JSON.stringify(rawOpponents)),
    )
    if (!baselineSummary.value) {
      baselineSummary.value = summary
    }
    currentSummary.value = summary
    targetVersion.summary = summary
    recordActualSimulationThroughput(summary.gamesPerSecond, rawConfig)
    hardwareProfile.value = calibrateHardwareProfile(false)
  } catch (err) {
    if (err instanceof Error && err.message.includes('annulée')) {
      cancelNotice.value = t('simulationCancelled')
      simulationError.value = null
    } else {
      simulationError.value = err instanceof Error ? err.message : String(err)
      console.error('Erreur lors de la simulation comparative :', err)
    }
  } finally {
    isSimulating.value = false
  }
}

function handleSelectVersion(versionId: string) {
  const found = deckVersions.value.find((v) => v.id === versionId)
  if (!found) return
  activeVersionId.value = versionId
  editableDeck.value = computeDeckSummary(
    found.deck.cards.map((c) => ({ ...c })),
    found.deck.format,
  )
  if (found.summary) {
    currentSummary.value = found.summary
  }
}

function handleSaveAsNewVersion() {
  const nextNum = deckVersions.value.length + 1
  const newVer: DeckVersionEntry = {
    id: `v${nextNum}`,
    versionNumber: nextNum,
    label: `Version ${nextNum}`,
    deck: computeDeckSummary(editableDeck.value.cards.map((c) => ({ ...c })), editableDeck.value.format),
    summary: currentSummary.value,
    timestamp: Date.now(),
    isBaseline: false,
  }
  deckVersions.value.push(newVer)
  activeVersionId.value = newVer.id
}

function handleSetBaselineVersion(versionId: string) {
  const target = deckVersions.value.find((v) => v.id === versionId)
  if (!target) return
  for (const v of deckVersions.value) {
    v.isBaseline = v.id === versionId
  }
  baselineDeck.value = computeDeckSummary(
    target.deck.cards.map((c) => ({ ...c })),
    target.deck.format,
  )
  if (target.summary) {
    baselineSummary.value = target.summary
  }
}

function rebuildEditableDeck(cards: ParsedDeckEntry[]) {
  editableDeck.value = computeDeckSummary(cards, editableDeck.value.format)
}

function handleAdjustCardQty(cardId: string, delta: number) {
  const clonedCards = editableDeck.value.cards.map((c) => ({ ...c }))
  const target = clonedCards.find((c) => c.cardId === cardId)
  if (!target) return

  const maxAllowed =
    target.category === 'energy' && target.subCategory === 'BASIC_ENERGY' ? 59 : 4
  const nextQty = Math.max(0, Math.min(maxAllowed, target.quantity + delta))
  target.quantity = nextQty

  rebuildEditableDeck(clonedCards.filter((c) => c.quantity > 0))
}

function handleRemoveCard(cardId: string) {
  const remaining = editableDeck.value.cards
    .filter((c) => c.cardId !== cardId)
    .map((c) => ({ ...c }))
  rebuildEditableDeck(remaining)
}

function handleAddCatalogCard(model: EngineCardModel) {
  const clonedCards = editableDeck.value.cards.map((c) => ({ ...c }))
  const existing = clonedCards.find((c) => c.cardId === model.cardId)
  if (existing) {
    const maxAllowed =
      existing.category === 'energy' && existing.subCategory === 'BASIC_ENERGY'
        ? 59
        : model.identity.isAceSpec
          ? 1
          : 4
    if (existing.quantity < maxAllowed) {
      existing.quantity += 1
    }
  } else {
    clonedCards.push(buildDeckEntryFromModel(model, 1, clonedCards.length + 1))
  }
  rebuildEditableDeck(clonedCards)
}

function handleReplaceCardInDeck(oldCardId: string, newModel: EngineCardModel) {
  const clonedCards = editableDeck.value.cards.map((c) => ({ ...c }))
  const oldIdx = clonedCards.findIndex((c) => c.cardId === oldCardId)
  const qtyToTransfer = oldIdx !== -1 ? clonedCards[oldIdx]!.quantity : 1

  if (oldIdx !== -1) {
    clonedCards.splice(oldIdx, 1)
  }

  const maxAllowed =
    newModel.category === 'ENERGY' && newModel.subCategory === 'BASIC_ENERGY'
      ? 59
      : newModel.identity.isAceSpec
        ? 1
        : 4

  const existingNew = clonedCards.find((c) => c.cardId === newModel.cardId)
  if (existingNew) {
    existingNew.quantity = Math.min(maxAllowed, existingNew.quantity + qtyToTransfer)
  } else {
    const safeQty = Math.min(maxAllowed, qtyToTransfer)
    clonedCards.push(buildDeckEntryFromModel(newModel, safeQty, clonedCards.length + 1))
  }

  rebuildEditableDeck(clonedCards)
}

useSeoMeta({
  title: 'Meta Oracle Simulator — Laboratoire Monte-Carlo & Atelier A/B Pokémon TCG',
  description:
    'Importez votre decklist PTCGL, vérifiez ses 60 cartes et lancez des simulations Monte-Carlo 3-ply multi-threads avec comparateur A/B.',
  ogTitle: 'Meta Oracle Simulator — sim.meta-oracle.com',
  ogDescription:
    '8 KPIs compétitifs, 6 analyses méta, suggestions d’alternatives et inspecteur 3-ply pour Pokémon TCG Standard.',
})
</script>

<template>
  <div style="background-color: var(--bg-canvas); color: var(--text-primary)">
    <!-- En-tête Stepper du Simulateur -->
    <WizardHeader
      :current-step="currentStep"
      :can-go-step2="canGoStep2"
      :can-go-step3="canGoStep3"
      :is-debug-mode="isDebugMode"
      :deck-total-cards="currentStep === 3 ? editableDeck.totalCards : baselineDeck.totalCards"
      @select-step="handleSelectStep"
    />

    <!-- BANDEAU DE PROGRESSION EN DIRECT -->
    <div
      v-if="isSimulating"
      class="sticky top-16 z-30 border-b backdrop-blur"
      style="
        border-color: rgba(255, 107, 0, 0.4);
        background-color: rgba(19, 24, 35, 0.96);
        box-shadow: var(--brand-glow);
      "
    >
      <div class="mx-auto max-w-7xl px-4 py-3 sm:px-6">
        <div class="flex flex-wrap items-center justify-between gap-3 text-xs font-semibold sm:text-sm">
          <div class="flex items-center gap-2.5" style="color: var(--text-primary)">
            <svg
              class="h-5 w-5 animate-spin shrink-0"
              style="color: var(--brand-primary)"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span>
              Simulation en cours sur {{ simConfig.workerCount }} cœurs : {{ progressCompleted.toLocaleString('fr-FR') }} / {{ progressTotal.toLocaleString('fr-FR') }} parties ({{ progressPercent }} %)...
            </span>
          </div>

          <div class="flex items-center gap-4 font-mono text-xs" style="color: var(--text-secondary)">
            <span style="color: var(--brand-amber)">Débit : ~{{ liveThroughput.toLocaleString('fr-FR') }} parties/sec</span>
            <span>•</span>
            <span>Temps écoulé : {{ (progressElapsedMs / 1000).toFixed(1) }} s</span>
            <button
              type="button"
              @click="handleCancelSimulation"
              class="rounded-lg border px-3 py-1 text-xs font-bold text-white transition hover:brightness-110"
              style="border-color: var(--status-negative); background-color: var(--status-negative)"
            >
              🛑 Annuler la simulation
            </button>
          </div>
        </div>

        <div class="mt-2.5 h-2 w-full overflow-hidden rounded-full" style="background-color: var(--border-subtle)">
          <div
            class="h-2 rounded-full transition-all duration-150"
            style="background: var(--brand-gradient)"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
      </div>
    </div>

    <!-- Notification d'annulation -->
    <div v-if="cancelNotice" class="mx-auto mt-4 max-w-7xl px-4 sm:px-6">
      <div
        class="flex items-center justify-between gap-3 rounded-xl border p-3.5 text-xs"
        style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-secondary)"
      >
        <span>{{ cancelNotice }}</span>
        <button type="button" @click="cancelNotice = null" class="hover:text-white">
          {{ t('closeModal') }}
        </button>
      </div>
    </div>

    <!-- Bannière d'Erreur -->
    <div v-if="simulationError" class="mx-auto mt-4 max-w-7xl px-4 sm:px-6">
      <div
        class="flex items-center justify-between gap-3 rounded-xl border-2 p-4"
        style="border-color: rgba(239, 68, 68, 0.55); background-color: rgba(127, 29, 29, 0.25); color: #fecaca"
      >
        <div>
          <div class="text-sm font-bold">{{ t('simulationErrorHeading') }}</div>
          <div class="mt-0.5 font-mono text-xs opacity-90">{{ simulationError }}</div>
        </div>
        <button
          type="button"
          @click="simulationError = null"
          class="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-white/10"
          style="border-color: rgba(239, 68, 68, 0.5)"
        >
          {{ t('closeAlert') }}
        </button>
      </div>
    </div>

    <!-- Étape active -->
    <div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Step1DeckImport
        v-if="currentStep === 1"
        :raw-deck-text="rawDeckText"
        :validated-deck="baselineDeck"
        :is-resolving="isResolvingDeck"
        :resolve-error="deckResolveError"
        @validate-deck="handleValidateDeck"
        @proceed-step2="currentStep = 2"
      />

      <Step2SimConfig
        v-else-if="currentStep === 2"
        :config="simConfig"
        :deck="baselineDeck"
        :is-debug-mode="isDebugMode"
        :hardware-profile="hardwareProfile"
        :max-hardware-workers="maxHardwareWorkers"
        :meta-opponents="metaOpponents"
        :meta-loading="metaLoading"
        :meta-error="metaError"
        :is-simulating="isSimulating"
        :progress-percent="progressPercent"
        @update-config="handleUpdateConfig"
        @back-step1="currentStep = 1"
        @launch-simulation="executeInitialSimulation"
        @cancel-simulation="handleCancelSimulation"
        @retry-meta-decks="loadMetaDecks"
      />

      <Step3DashboardAndComparator
        v-else
        :baseline-deck="baselineDeck"
        :editable-deck="editableDeck"
        :baseline-summary="baselineSummary"
        :current-summary="currentSummary"
        :is-simulating="isSimulating"
        :progress-completed="progressCompleted"
        :progress-total="progressTotal"
        :progress-elapsed-ms="progressElapsedMs"
        :is-debug-mode="isDebugMode"
        :arena-url="config.public.arenaUrl"
        :deck-versions="deckVersions"
        :active-version-id="activeVersionId"
        :meta-opponents="metaOpponents"
        @adjust-card-qty="handleAdjustCardQty"
        @remove-card="handleRemoveCard"
        @add-catalog-card="handleAddCatalogCard"
        @replace-card-in-deck="handleReplaceCardInDeck"
        @rerun-and-compare="executeComparisonSimulation"
        @select-version="handleSelectVersion"
        @save-as-new-version="handleSaveAsNewVersion"
        @set-baseline-version="handleSetBaselineVersion"
        @cancel-simulation="handleCancelSimulation"
        @back-step2="currentStep = 2"
      />
    </div>
  </div>
</template>
