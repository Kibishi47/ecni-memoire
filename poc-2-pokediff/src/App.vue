<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { INITIAL_CARDS } from './data/defaultDeck'
import { SCENARIOS } from './data/scenarios'
import { runSameSeedSimulation, getSamplePairedSeeds } from './services/seedEngine'
import type { Card, ScenarioPreset, DeckDiff, SimulationResult } from './types/deck'

import HeaderNav from './components/HeaderNav.vue'
import ScenarioSelector from './components/ScenarioSelector.vue'
import DiffSummary from './components/DiffSummary.vue'
import DeckDiffEditor from './components/DeckDiffEditor.vue'
import SimulationTrigger from './components/SimulationTrigger.vue'
import DeltaMatrix from './components/DeltaMatrix.vue'
import CriticalMetrics from './components/CriticalMetrics.vue'
import AnalyticalVerdict from './components/AnalyticalVerdict.vue'
import SameSeedInspectorModal from './components/SameSeedInspectorModal.vue'

// Reactive State
const cards = ref<Card[]>(JSON.parse(JSON.stringify(INITIAL_CARDS)))
const activeScenarioId = ref<string | null>('scenario-1')
const isSimulating = ref(false)
const currentSeed = ref(42890)
const isInspectorOpen = ref(false)

// Initialize with Scenario 1 by default so the user immediately sees a live comparison!
function applyScenario(scenario: ScenarioPreset) {
  // Reset all to baseline A first
  for (const c of cards.value) {
    c.countB = c.countA
  }
  // Apply specific changes
  for (const change of scenario.changes) {
    const target = cards.value.find((c) => c.id === change.cardId)
    if (target) {
      target.countB = Math.max(target.min, Math.min(target.max, target.countB + change.delta))
    }
  }
  activeScenarioId.value = scenario.id
}

onMounted(() => {
  // Apply Scenario 1 by default for zero-friction user testing
  applyScenario(SCENARIOS[0])
})

// Counts
const deckACount = computed(() => {
  return cards.value.reduce((acc, c) => acc + c.countA, 0)
})

const deckBCount = computed(() => {
  return cards.value.reduce((acc, c) => acc + c.countB, 0)
})

const isValid = computed(() => {
  return deckACount.value === 60 && deckBCount.value === 60
})

// Diffs
const diffs = computed<DeckDiff[]>(() => {
  return cards.value
    .filter((c) => c.countB !== c.countA)
    .map((c) => ({
      cardId: c.id,
      cardName: c.name,
      cardNameEn: c.nameEn,
      category: c.category,
      delta: c.countB - c.countA,
      from: c.countA,
      to: c.countB,
    }))
})

// Simulation Result (computed dynamically or triggered)
const simulationResult = computed<SimulationResult>(() => {
  return runSameSeedSimulation(cards.value, currentSeed.value, 10000)
})

// Sample paired seeds for inspector
const samplePairedSeeds = computed(() => {
  return getSamplePairedSeeds(cards.value, 4)
})

// Event Handlers
function handleSelectScenario(scenario: ScenarioPreset) {
  applyScenario(scenario)
}

function handleSelectBaseline() {
  for (const c of cards.value) {
    c.countB = c.countA
  }
  activeScenarioId.value = 'baseline'
}

function handleUpdateCardB(cardId: string, newCount: number) {
  const card = cards.value.find((c) => c.id === cardId)
  if (card) {
    card.countB = newCount
    // Check if current configuration matches any preset
    checkIfMatchesPreset()
  }
}

function handleAddFlexCard(cardId: string) {
  const card = cards.value.find((c) => c.id === cardId)
  if (card && card.countB < card.max) {
    card.countB++
    checkIfMatchesPreset()
  }
}

function checkIfMatchesPreset() {
  // Compare current diffs with presets
  for (const sc of SCENARIOS) {
    const matchesAll = sc.changes.every((ch) => {
      const c = cards.value.find((card) => card.id === ch.cardId)
      return c && c.countB - c.countA === ch.delta
    })
    const noOtherChanges = diffs.value.length === sc.changes.length
    if (matchesAll && noOtherChanges) {
      activeScenarioId.value = sc.id
      return
    }
  }

  if (diffs.value.length === 0) {
    activeScenarioId.value = 'baseline'
  } else {
    activeScenarioId.value = null // Custom user adjustments
  }
}

function handleRunSimulation() {
  isSimulating.value = true
  // Generates new random seed for fresh 10,000 paired sample
  currentSeed.value = Math.floor(Math.random() * 90000) + 10000

  setTimeout(() => {
    isSimulating.value = false
  }, 400)
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
    <!-- Top Navigation Header -->
    <HeaderNav
      :deck-a-count="deckACount"
      :deck-b-count="deckBCount"
      :is-valid="isValid"
      :seed="currentSeed"
      :sim-count="simulationResult.sampleSize"
      @reset="handleSelectBaseline"
      @open-inspector="isInspectorOpen = true"
    />

    <!-- Main Container -->
    <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <!-- Context & UX Hero Banner ("Wizard of Oz") -->
      <section class="p-4 sm:p-5 rounded-2xl bg-slate-900/50 border border-slate-800 text-xs sm:text-sm text-slate-300 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div class="space-y-1">
          <div class="flex items-center space-x-2">
            <span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[11px] font-bold">
              47,5 % des Joueurs Compétitifs
            </span>
            <span class="text-slate-400 font-medium">
              changent 1 à 3 cartes au feeling la veille d'un tournoi majeur.
            </span>
          </div>
          <p class="text-slate-400 text-xs">
            Ce comparateur élimine le doute en simulant <strong class="text-slate-200">l'impact statistique exact</strong> de votre arbitrage sur une séquence couplée de <strong class="text-indigo-400">10 000 tirages à graine identique ("Same-Seed Testing")</strong>.
          </p>
        </div>

        <div class="flex items-center space-x-3 shrink-0">
          <div class="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 font-mono text-xs">
            <span class="text-sky-400 font-bold">A : Dracaufeu / Roucarnage</span>
            <span class="text-slate-500">vs</span>
            <span class="text-violet-400 font-bold">B : Variante Test</span>
          </div>
        </div>
      </section>

      <!-- Section A: Scenario Presets Selector -->
      <section>
        <ScenarioSelector
          :active-scenario-id="activeScenarioId"
          @select-scenario="handleSelectScenario"
          @select-baseline="handleSelectBaseline"
        />
      </section>

      <!-- Section A (cont.): Diff Summary (Git Diff Style) -->
      <section>
        <DiffSummary
          :diffs="diffs"
          :deck-a-count="deckACount"
          :deck-b-count="deckBCount"
          :is-valid="isValid"
          @sync-b-to-a="handleSelectBaseline"
        />
      </section>

      <!-- Section B: Coupled Simulation Trigger Button (400ms visual animation) -->
      <section>
        <SimulationTrigger
          :is-simulating="isSimulating"
          :sample-size="simulationResult.sampleSize"
          :seed="currentSeed"
          :duration-ms="simulationResult.durationMs"
          :is-valid="isValid"
          @run-simulation="handleRunSimulation"
          @open-inspector="isInspectorOpen = true"
        />
      </section>

      <!-- Section C: Delta Dashboard (The Core Analytical Experience) -->
      <section class="space-y-6">
        <!-- 1. Matchup Delta Matrix (3 Columns) -->
        <DeltaMatrix :matchups="simulationResult.matchups" />

        <!-- 2. Critical Metrics Dual Bars -->
        <CriticalMetrics :metrics="simulationResult.criticalMetrics" />

        <!-- 3. Automated Analytical Verdict -->
        <AnalyticalVerdict
          :verdict="simulationResult.verdict"
          :is-valid="isValid"
        />
      </section>

      <!-- Section A (Editor): Side-by-Side A/B Deck Diff Editor -->
      <section>
        <DeckDiffEditor
          :cards="cards"
          :deck-a-count="deckACount"
          :deck-b-count="deckBCount"
          @update-card-b="handleUpdateCardB"
          @add-flex-card="handleAddFlexCard"
        />
      </section>
    </main>

    <!-- Footer -->
    <footer class="border-t border-slate-800/80 bg-slate-950 py-6 text-center text-xs text-slate-500">
      <div class="max-w-7xl mx-auto px-4 space-y-1">
        <p>
          PokéDiff Matchup Comparator • POC Interactif Haute-Fidélité pour Tests Utilisateurs UX/UI (Piste 2).
        </p>
        <p class="text-[11px] text-slate-600 font-mono">
          Same-Seed Coupled Monte-Carlo Engine (Mulberry32 PRNG) • 10 000 tirages simultanés appariés.
        </p>
      </div>
    </footer>

    <!-- Same-Seed Inspector Modal -->
    <SameSeedInspectorModal
      :is-open="isInspectorOpen"
      :samples="samplePairedSeeds"
      @close="isInspectorOpen = false"
    />
  </div>
</template>
