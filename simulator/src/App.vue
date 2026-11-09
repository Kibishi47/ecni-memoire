<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw } from 'vue'
import type { EngineCardModel } from './types/cardModel'
import type { ParsedDeck, ParsedDeckEntry } from './types/deck'
import type { SimulationConfig, SimulationMetricsSummary } from './types/simulator'
import { META_OPPONENT_DECKS } from './data/metaDecks'
import {
  buildDeckEntryFromModel,
  computeDeckSummary,
  parsePtcglDecklist,
} from './utils/ptcglParser'
import { SimulationWorkerPool } from './worker/workerPool'
import WizardHeader from './components/WizardHeader.vue'
import Step1DeckImport from './components/Step1DeckImport.vue'
import Step2SimConfig from './components/Step2SimConfig.vue'
import Step3DashboardAndComparator from './components/Step3DashboardAndComparator.vue'

const currentStep = ref<1 | 2 | 3>(1)
const isDebugMode = ref<boolean>(false)

const maxHardwareWorkers =
  typeof navigator !== 'undefined' && navigator.hardwareConcurrency
    ? Math.max(1, Math.min(16, navigator.hardwareConcurrency))
    : 4

const rawDeckText = ref<string>('')

const initialParsed = parsePtcglDecklist('')
const baselineDeck = ref<ParsedDeck>(initialParsed)
const editableDeck = ref<ParsedDeck>(parsePtcglDecklist(''))

const simConfig = ref<SimulationConfig>({
  iterations: 100,
  maxTurns: 15,
  maxBranches: 20,
  selectedOpponentIds: META_OPPONENT_DECKS.map((d) => d.id),
  firstPlayerMode: 'RANDOM',
  debugMode: false,
  workerCount: Math.min(4, maxHardwareWorkers),
  fixedSeed: null,
  perturbationType: 'NONE',
  perturbationTurn: 2,
  stressTestOhkoEachTurn: false,
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

function handleCancelSimulation() {
  workerPool.cancelSimulation()
  isSimulating.value = false
  simulationError.value = null
  cancelNotice.value = 'Simulation interrompue par l\'utilisateur.'
  if (cancelNoticeTimeout) clearTimeout(cancelNoticeTimeout)
  cancelNoticeTimeout = setTimeout(() => {
    cancelNotice.value = null
  }, 4500)
}

function detectDebugModeFromUrl() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const debugActive = params.get('debug') === 'true' || params.get('debug') === '1'
  isDebugMode.value = debugActive
  simConfig.value.debugMode = debugActive
}

onMounted(() => {
  detectDebugModeFromUrl()
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', detectDebugModeFromUrl)
  }
})

onBeforeUnmount(() => {
  workerPool.terminateAll()
  if (typeof window !== 'undefined') {
    window.removeEventListener('popstate', detectDebugModeFromUrl)
  }
})

const canGoStep2 = computed(
  () =>
    baselineDeck.value.isValid60 &&
    baselineDeck.value.isFullyResolved &&
    baselineDeck.value.cards.length > 0,
)
const canGoStep3 = computed(() => currentSummary.value !== null || isSimulating.value)

function handleValidateDeck(newRawText: string) {
  rawDeckText.value = newRawText
  const parsed = parsePtcglDecklist(newRawText)
  baselineDeck.value = parsed
  editableDeck.value = parsePtcglDecklist(newRawText)
  baselineSummary.value = null
  currentSummary.value = null
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
    const rawDeck = toRaw(baselineDeck.value)
    const rawConfig = toRaw(simConfig.value)
    const summary = await workerPool.runSimulation(
      JSON.parse(JSON.stringify(rawDeck)),
      JSON.parse(JSON.stringify(rawConfig)),
      (completed, total, elapsed) => {
        progressCompleted.value = completed
        progressTotal.value = total
        progressElapsedMs.value = elapsed
      },
    )
    baselineSummary.value = summary
    currentSummary.value = summary
  } catch (err) {
    if (err instanceof Error && err.message.includes('annulée')) {
      cancelNotice.value = 'Simulation interrompue par l\'utilisateur.'
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

  simulationError.value = null
  isSimulating.value = true
  progressCompleted.value = 0
  progressTotal.value = simConfig.value.iterations
  progressElapsedMs.value = 0

  try {
    const rawDeck = toRaw(editableDeck.value)
    const rawConfig = toRaw(simConfig.value)
    const summary = await workerPool.runSimulation(
      JSON.parse(JSON.stringify(rawDeck)),
      JSON.parse(JSON.stringify(rawConfig)),
      (completed, total, elapsed) => {
        progressCompleted.value = completed
        progressTotal.value = total
        progressElapsedMs.value = elapsed
      },
    )
    if (!baselineSummary.value) {
      baselineSummary.value = summary
    }
    currentSummary.value = summary
  } catch (err) {
    if (err instanceof Error && err.message.includes('annulée')) {
      cancelNotice.value = 'Simulation interrompue par l\'utilisateur.'
      simulationError.value = null
    } else {
      simulationError.value = err instanceof Error ? err.message : String(err)
      console.error('Erreur lors de la simulation comparative :', err)
    }
  } finally {
    isSimulating.value = false
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

function handleToggleStressOhko(enabled: boolean) {
  simConfig.value = {
    ...simConfig.value,
    stressTestOhkoEachTurn: enabled,
  }
}

function handlePromoteCurrentAsBaseline() {
  baselineDeck.value = computeDeckSummary(
    editableDeck.value.cards.map((c) => ({ ...c })),
    editableDeck.value.format,
  )
  if (currentSummary.value) {
    baselineSummary.value = currentSummary.value
  }
}

function handleResetToBaseline() {
  editableDeck.value = computeDeckSummary(
    baselineDeck.value.cards.map((c) => ({ ...c })),
    baselineDeck.value.format,
  )
  if (baselineSummary.value) {
    currentSummary.value = baselineSummary.value
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <!-- Barre de Navigation & Stepper Wizard -->
    <WizardHeader
      :current-step="currentStep"
      :can-go-step2="canGoStep2"
      :can-go-step3="canGoStep3"
      :is-debug-mode="isDebugMode"
      :deck-total-cards="currentStep === 3 ? editableDeck.totalCards : baselineDeck.totalCards"
      @select-step="handleSelectStep"
    />

    <!-- BANDEAU DE PROGRESSION EN DIRECT (FEEDBACK VISUEL) -->
    <div
      v-if="isSimulating"
      class="sticky top-[61px] z-30 border-b border-indigo-200 bg-indigo-50/95 text-indigo-900 shadow-sm backdrop-blur"
    >
      <div class="mx-auto max-w-7xl px-4 py-3 sm:px-6">
        <div class="flex flex-wrap items-center justify-between gap-3 text-xs font-semibold sm:text-sm">
          <div class="flex items-center gap-2.5">
            <svg
              class="h-5 w-5 animate-spin text-indigo-600 shrink-0"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              ></circle>
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              ></path>
            </svg>
            <span>
              Simulation en cours sur {{ simConfig.workerCount }} cœurs : {{ progressCompleted.toLocaleString('fr-FR') }} / {{ progressTotal.toLocaleString('fr-FR') }} parties ({{ progressPercent }} %)...
            </span>
          </div>

          <div class="flex items-center gap-4 font-mono text-xs text-indigo-800">
            <span>Débit : ~{{ liveThroughput.toLocaleString('fr-FR') }} parties/sec</span>
            <span>•</span>
            <span>Temps écoulé : {{ (progressElapsedMs / 1000).toFixed(1) }} s</span>
            <button
              type="button"
              @click="handleCancelSimulation"
              class="rounded-lg border border-rose-600 bg-rose-600 px-3 py-1 text-xs font-bold text-white shadow-xs transition hover:bg-rose-700 active:bg-rose-800"
            >
              Annuler la simulation
            </button>
          </div>
        </div>

        <!-- Barre de progression animée fluide -->
        <div class="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-indigo-200/80">
          <div
            class="h-2 rounded-full bg-indigo-600 transition-all duration-150"
            :style="{ width: `${progressPercent}%` }"
          ></div>
        </div>
      </div>
    </div>

    <!-- Information discrète lors de l'annulation d'une simulation -->
    <div
      v-if="cancelNotice"
      class="mx-auto mt-4 max-w-7xl px-4 sm:px-6"
    >
      <div class="flex items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white p-3.5 text-slate-700 shadow-xs">
        <div class="flex items-center gap-2 text-xs font-medium">
          <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{{ cancelNotice }}</span>
        </div>
        <button
          type="button"
          @click="cancelNotice = null"
          class="text-xs text-slate-400 hover:text-slate-600"
        >
          Fermer
        </button>
      </div>
    </div>

    <!-- Bannière d'Erreur si une exception survient pendant la simulation -->
    <div
      v-if="simulationError"
      class="mx-auto mt-4 max-w-7xl px-4 sm:px-6"
    >
      <div class="flex items-center justify-between gap-3 rounded-xl border-2 border-red-400 bg-red-50 p-4 text-red-950 shadow-xs">
        <div class="flex items-center gap-2.5">
          <svg class="h-5 w-5 shrink-0 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <div>
            <div class="text-sm font-bold text-red-900">Une erreur est survenue pendant l'exécution de la simulation</div>
            <div class="mt-0.5 font-mono text-xs text-red-800">{{ simulationError }}</div>
          </div>
        </div>
        <button
          type="button"
          @click="simulationError = null"
          class="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-900 shadow-2xs hover:bg-red-50"
        >
          Fermer l'alerte
        </button>
      </div>
    </div>

    <!-- Contenu Principal par Étape -->
    <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Step1DeckImport
        v-if="currentStep === 1"
        :raw-deck-text="rawDeckText"
        :validated-deck="baselineDeck"
        :is-debug-mode="isDebugMode"
        @validate-deck="handleValidateDeck"
        @proceed-step2="currentStep = 2"
      />

      <Step2SimConfig
        v-else-if="currentStep === 2"
        :config="simConfig"
        :deck="baselineDeck"
        :is-debug-mode="isDebugMode"
        :max-hardware-workers="maxHardwareWorkers"
        :is-simulating="isSimulating"
        :progress-percent="progressPercent"
        @update-config="handleUpdateConfig"
        @back-step1="currentStep = 1"
        @launch-simulation="executeInitialSimulation"
        @cancel-simulation="handleCancelSimulation"
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
        :stress-test-ohko="Boolean(simConfig.stressTestOhkoEachTurn)"
        @adjust-card-qty="handleAdjustCardQty"
        @remove-card="handleRemoveCard"
        @add-catalog-card="handleAddCatalogCard"
        @replace-card-in-deck="handleReplaceCardInDeck"
        @toggle-stress-ohko="handleToggleStressOhko"
        @rerun-and-compare="executeComparisonSimulation"
        @cancel-simulation="handleCancelSimulation"
        @promote-current-as-baseline="handlePromoteCurrentAsBaseline"
        @reset-to-baseline="handleResetToBaseline"
        @back-step2="currentStep = 2"
      />
    </main>
  </div>
</template>
