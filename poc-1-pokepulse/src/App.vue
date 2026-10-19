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
import { Swords } from 'lucide-vue-next'

// Active deck state
const currentPreset = ref<DeckPreset>(DECK_PRESETS[0])
const isCustomDeck = ref(false)
const customCards = ref<CardItem[]>([])
const customPtcglText = ref('')
const isImportModalOpen = ref(false)

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

// Trigger simulated run (500ms)
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
    <header class="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-emerald-400 p-0.5 flex items-center justify-center shadow-glow-indigo">
            <div class="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Swords class="w-4 h-4 text-indigo-400" />
            </div>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-base font-extrabold tracking-tight text-white flex items-center gap-1.5">
                PokéPulse <span class="text-indigo-400">Arena</span>
              </h1>
              <span class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                POC v1.0
              </span>
            </div>
            <p class="text-[11px] text-slate-400">
              Banc d'essai décisionnel et confrontation de sorties Pokémon TCG
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 text-xs">
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Moteur Wasm Simulé (10 000 runs)
          </span>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6 flex-1 w-full">
      <!-- Section A: Deck Presets & Import -->
      <DeckPresetsSelector
        :active-preset-id="currentPreset.id"
        :is-custom-deck="isCustomDeck"
        :total-card-count="totalCards"
        @select-preset="onSelectPreset"
        @toggle-import-modal="isImportModalOpen = true"
      />

      <!-- Section B: Opponent Gauntlet Selector -->
      <OpponentGauntletSelector
        :active-opponent-id="activeOpponentId"
        v-model:goingFirst="goingFirst"
        @select-opponent="onSelectOpponent"
      />

      <!-- Section C.1: Hero Simulation Trigger Bar -->
      <SimulationTriggerBar
        :deck-name="activeDeckName"
        :opponent-name="activeOpponent.name"
        :is-simulating="isSimulating"
        @run-simulation="runSimulation"
      />

      <!-- Section A.2: Automatic Taxonomy View (Collapsible or Full) -->
      <DeckTaxonomyView
        :cards="activeCards"
        :deck-name="activeDeckName"
      />
    </main>

    <!-- Modal Drawer for Import -->
    <DeckImportDrawer
      :is-open="isImportModalOpen"
      :initial-text="isCustomDeck ? customPtcglText : currentPreset.ptcglText"
      @close="isImportModalOpen = false"
      @import-deck="onImportDeck"
    />
  </div>
</template>
