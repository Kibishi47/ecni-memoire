<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { DeckPreset, CardItem, OpponentId, SimulationResult } from './types/pokemon-tcg'
import { DECK_PRESETS } from './data/presets'
import { OPPONENT_GAUNTLETS } from './data/opponents'
import { computeSimulation } from './data/simulations'
import { parsePtcglText } from './utils/deck-parser'
import DeckPresetsSelector from './components/DeckPresetsSelector.vue'
import DeckImportDrawer from './components/DeckImportDrawer.vue'
import DeckTaxonomyView from './components/DeckTaxonomyView.vue'
import OpponentGauntletSelector from './components/OpponentGauntletSelector.vue'
import SimulationTriggerBar from './components/SimulationTriggerBar.vue'
import AnalyticsKpiCards from './components/AnalyticsKpiCards.vue'
import TurnByTurnChart from './components/TurnByTurnChart.vue'
import BrickBreakdownCard from './components/BrickBreakdownCard.vue'
import ActionableAlertBox from './components/ActionableAlertBox.vue'
import LiveHandSimulator from './components/LiveHandSimulator.vue'
import { 
  Swords, 
  Layers, 
  BarChart2, 
  Sparkles,
  ChevronDown,
  ChevronUp
} from 'lucide-vue-next'

// Active deck state
const currentPreset = ref<DeckPreset>(DECK_PRESETS[0])
const isCustomDeck = ref(false)
const customCards = ref<CardItem[]>([])
const customPtcglText = ref('')
const isImportModalOpen = ref(false)
const isTaxonomyExpanded = ref(true)

// Active matchup & simulation state
const activeOpponentId = ref<OpponentId>('aggro_turbo')
const goingFirst = ref(true)
const isSimulating = ref(false)
const simulationResult = ref<SimulationResult | null>(null)

const activeCards = computed<CardItem[]>(() => {
  if (isCustomDeck.value) {
    return customCards.value
  }
  return currentPreset.value.cards
})

const activeDeckName = computed(() => {
  if (isCustomDeck.value) {
    return 'Deck Personnalisé'
  }
  return currentPreset.value.name
})

const activeOpponent = computed(() => {
  return OPPONENT_GAUNTLETS.find(o => o.id === activeOpponentId.value) || OPPONENT_GAUNTLETS[0]
})

const totalCards = computed(() => {
  return activeCards.value.reduce((acc, c) => acc + c.count, 0)
})

// Trigger simulated run (500ms Wizard of Oz)
const runSimulation = () => {
  if (isSimulating.value) return
  isSimulating.value = true

  setTimeout(() => {
    simulationResult.value = computeSimulation(
      isCustomDeck.value ? 'custom' : currentPreset.value.id,
      activeOpponentId.value,
      goingFirst.value,
      activeCards.value
    )
    isSimulating.value = false
  }, 550)
}

const onSelectPreset = (preset: DeckPreset) => {
  currentPreset.value = preset
  isCustomDeck.value = false
  runSimulation()
}

const onSelectOpponent = (opponentId: OpponentId) => {
  activeOpponentId.value = opponentId
  runSimulation()
}

const onImportDeck = (ptcglText: string) => {
  const parsed = parsePtcglText(ptcglText)
  if (parsed.length > 0) {
    customCards.value = parsed
    customPtcglText.value = ptcglText
    isCustomDeck.value = true
    runSimulation()
  }
}

watch(goingFirst, () => {
  runSimulation()
})

// Initialize with a simulation on mount
onMounted(() => {
  runSimulation()
})
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased">
    <!-- Navbar / Header -->
    <header class="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-emerald-400 p-0.5 flex items-center justify-center shadow-glow-indigo">
            <div class="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Swords class="w-5 h-5 text-indigo-400" />
            </div>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-base sm:text-lg font-extrabold tracking-tight text-white flex items-center gap-1.5">
                PokéPulse <span class="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-emerald-400">Arena</span>
              </h1>
              <span class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                POC UX Test
              </span>
            </div>
            <p class="text-[11px] text-slate-400 hidden sm:block">
              Banc d'essai décisionnel et confrontation de sorties Pokémon TCG (Wizard of Oz)
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3 text-xs">
          <div class="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] font-mono">
            <span class="text-slate-500">Méta :</span>
            <span class="text-slate-200 font-semibold">Standard SV9</span>
          </div>

          <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            10 000 runs Wasm
          </span>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6 flex-1 w-full">
      <!-- Section 1: Deck Presets & Import -->
      <DeckPresetsSelector
        :active-preset-id="currentPreset.id"
        :is-custom-deck="isCustomDeck"
        :total-card-count="totalCards"
        @select-preset="onSelectPreset"
        @toggle-import-modal="isImportModalOpen = true"
      />

      <!-- Section 2: Opponent Gauntlet Selector -->
      <OpponentGauntletSelector
        :active-opponent-id="activeOpponentId"
        v-model:goingFirst="goingFirst"
        @select-opponent="onSelectOpponent"
      />

      <!-- Section 3: Hero Simulation Trigger Bar -->
      <SimulationTriggerBar
        :deck-name="activeDeckName"
        :opponent-name="activeOpponent.name"
        :is-simulating="isSimulating"
        @run-simulation="runSimulation"
      />

      <!-- Section 4: Analytics Dashboard (Revealed upon simulation) -->
      <div v-if="simulationResult" class="space-y-6 animate-in fade-in duration-300">
        <!-- Section Header -->
        <div class="flex items-center justify-between pb-1 border-b border-slate-800">
          <div class="flex items-center gap-2">
            <span class="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <BarChart2 class="w-4 h-4" />
            </span>
            <h2 class="text-lg font-bold text-slate-100 tracking-tight">
              3. Résultats de Simulation & Tableau de Bord Analytique
            </h2>
          </div>
          <span class="text-xs font-mono text-slate-500">
            N = {{ simulationResult.sampleRuns.toLocaleString() }} itérations
          </span>
        </div>

        <!-- 4 Global Top KPIs -->
        <AnalyticsKpiCards :result="simulationResult" />

        <!-- Actionable Alert Box -->
        <ActionableAlertBox
          :alert="simulationResult.alert"
          :deck-name="activeDeckName"
          :opponent-name="activeOpponent.name"
        />

        <!-- Turn-by-Turn Chart & Brick Breakdown Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TurnByTurnChart
            :turn-data="simulationResult.turnProgression"
            :deck-name="activeDeckName"
            :opponent-name="activeOpponent.name"
          />

          <BrickBreakdownCard
            :breakdown="simulationResult.brickBreakdown"
            :total-brick-rate="simulationResult.t1BrickRate"
          />
        </div>

        <!-- Live Hand Simulator (Interactive Hands-On Test for Testers) -->
        <LiveHandSimulator
          :cards="activeCards"
          :deck-name="activeDeckName"
        />
      </div>

      <!-- Section 5: Automatic Taxonomy of the 60 cards (Collapsible) -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <button
            type="button"
            @click="isTaxonomyExpanded = !isTaxonomyExpanded"
            class="flex items-center gap-2 text-sm font-bold text-slate-300 hover:text-white transition-colors"
          >
            <Layers class="w-4 h-4 text-emerald-400" />
            <span>Inspection Détaillée de la Taxonomie ({{ totalCards }} cartes)</span>
            <component :is="isTaxonomyExpanded ? ChevronUp : ChevronDown" class="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div v-show="isTaxonomyExpanded" class="animate-in fade-in duration-200">
          <DeckTaxonomyView
            :cards="activeCards"
            :deck-name="activeDeckName"
          />
        </div>
      </div>
    </main>

    <!-- Modal Drawer for Import -->
    <DeckImportDrawer
      :is-open="isImportModalOpen"
      :initial-text="isCustomDeck ? customPtcglText : currentPreset.ptcglText"
      @close="isImportModalOpen = false"
      @import-deck="onImportDeck"
    />

    <!-- Footer -->
    <footer class="border-t border-slate-800/80 bg-slate-900/40 mt-12 py-6 text-xs text-slate-500">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <Sparkles class="w-4 h-4 text-indigo-400" />
          <span><strong>PokéPulse Arena</strong> — Banc d'essai décisionnel Pokémon TCG (Piste 1 UX/UI)</span>
        </div>
        <div class="flex items-center gap-4 text-[11px]">
          <span>Prototype "Wizard of Oz" pour tests utilisateurs</span>
          <span>•</span>
          <span class="text-slate-400">Régularité TCG & Évaluation de sorties</span>
        </div>
      </div>
    </footer>
  </div>
</template>
