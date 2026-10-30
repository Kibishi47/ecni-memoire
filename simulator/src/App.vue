<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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

const defaultRawPtcglText = META_OPPONENT_DECKS[0]!.ptcglText
const rawDeckText = ref<string>(defaultRawPtcglText)

const initialParsed = parsePtcglDecklist(defaultRawPtcglText)
const baselineDeck = ref<ParsedDeck>(initialParsed)
const editableDeck = ref<ParsedDeck>(parsePtcglDecklist(defaultRawPtcglText))

const simConfig = ref<SimulationConfig>({
  iterations: 50,
  maxTurns: 18,
  maxBranches: 20,
  selectedOpponentIds: META_OPPONENT_DECKS.map((d) => d.id),
  firstPlayerMode: 'RANDOM',
  debugMode: false,
  workerCount: Math.min(4, maxHardwareWorkers),
  fixedSeed: null,
  perturbationType: 'NONE',
  perturbationTurn: 2,
})

const baselineSummary = ref<SimulationMetricsSummary | null>(null)
const currentSummary = ref<SimulationMetricsSummary | null>(null)

const isSimulating = ref<boolean>(false)
const progressCompleted = ref<number>(0)
const progressTotal = ref<number>(0)
const progressElapsedMs = ref<number>(0)

const workerPool = new SimulationWorkerPool()

function detectDebugModeFromUrl() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const debugActive = params.get('debug') === 'true' || params.get('debug') === '1'
  isDebugMode.value = debugActive
  simConfig.value.debugMode = debugActive
}

function toggleDebugMode() {
  isDebugMode.value = !isDebugMode.value
  simConfig.value.debugMode = isDebugMode.value
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href)
    if (isDebugMode.value) {
      url.searchParams.set('debug', 'true')
    } else {
      url.searchParams.delete('debug')
    }
    window.history.replaceState({}, '', url.toString())
  }
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

const canGoStep2 = computed(() => baselineDeck.value.isValid60)
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
  if (!baselineDeck.value.isValid60 || isSimulating.value) return
  currentStep.value = 3
  isSimulating.value = true
  progressCompleted.value = 0
  progressTotal.value = simConfig.value.iterations
  progressElapsedMs.value = 0

  try {
    const summary = await workerPool.runSimulation(
      baselineDeck.value,
      simConfig.value,
      (completed, total, elapsed) => {
        progressCompleted.value = completed
        progressTotal.value = total
        progressElapsedMs.value = elapsed
      },
    )
    baselineSummary.value = summary
    currentSummary.value = summary
  } finally {
    isSimulating.value = false
  }
}

async function executeComparisonSimulation() {
  if (
    editableDeck.value.totalCards !== 60 ||
    !editableDeck.value.hasAtLeastOneBasic ||
    isSimulating.value
  ) {
    return
  }

  isSimulating.value = true
  progressCompleted.value = 0
  progressTotal.value = simConfig.value.iterations
  progressElapsedMs.value = 0

  try {
    const summary = await workerPool.runSimulation(
      editableDeck.value,
      simConfig.value,
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
      existing.category === 'energy' && existing.subCategory === 'BASIC_ENERGY' ? 59 : 4
    if (existing.quantity < maxAllowed) {
      existing.quantity += 1
    }
  } else {
    clonedCards.push(buildDeckEntryFromModel(model, 1, clonedCards.length + 1))
  }
  rebuildEditableDeck(clonedCards)
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
      @toggle-debug="toggleDebugMode"
    />

    <!-- Contenu Principal par Étape -->
    <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <Step1DeckImport
        v-if="currentStep === 1"
        :raw-deck-text="rawDeckText"
        :validated-deck="baselineDeck"
        @validate-deck="handleValidateDeck"
        @proceed-step2="currentStep = 2"
      />

      <Step2SimConfig
        v-else-if="currentStep === 2"
        :config="simConfig"
        :is-debug-mode="isDebugMode"
        :max-hardware-workers="maxHardwareWorkers"
        @update-config="handleUpdateConfig"
        @back-step1="currentStep = 1"
        @launch-simulation="executeInitialSimulation"
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
        @adjust-card-qty="handleAdjustCardQty"
        @remove-card="handleRemoveCard"
        @add-catalog-card="handleAddCatalogCard"
        @rerun-and-compare="executeComparisonSimulation"
        @promote-current-as-baseline="handlePromoteCurrentAsBaseline"
        @reset-to-baseline="handleResetToBaseline"
        @back-step2="currentStep = 2"
      />
    </main>
  </div>
</template>
