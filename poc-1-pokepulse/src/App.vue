<script setup lang="ts">
import { ref, computed } from 'vue'
import type { DeckPreset, CardItem, OpponentId, SimplifiedResult } from './types/pokemon-tcg'
import { DECK_PRESETS } from './data/presets'
import { OPPONENT_OPTIONS } from './data/opponents'
import { computeSimplifiedSimulation } from './data/simulations'
import WizardStepper from './components/WizardStepper.vue'
import Step1DeckSelection from './components/Step1DeckSelection.vue'
import Step2OpponentSelection from './components/Step2OpponentSelection.vue'
import Step3Results from './components/Step3Results.vue'
import SoberLoader from './components/SoberLoader.vue'

// Wizard Step: 1 = Mon Deck, 2 = Mon Adversaire, 3 = Résultats
const currentStep = ref<number>(1)
const isLoading = ref<boolean>(false)

// Step 1: Selected Deck
const selectedPreset = ref<DeckPreset>(DECK_PRESETS[0])
const isCustomDeck = ref<boolean>(false)
const customCards = ref<CardItem[]>([])
const customPtcglText = ref<string>('')

// Step 2: Selected Opponent
const selectedOpponentId = ref<OpponentId>('aggro_turbo')

// Step 3: Computed Result
const simulationResult = ref<SimplifiedResult | null>(null)

const activeCards = computed<CardItem[]>(() => {
  if (isCustomDeck.value) return customCards.value
  return selectedPreset.value.cards
})

const activeDeckName = computed<string>(() => {
  if (isCustomDeck.value) return 'Deck Personnalisé'
  return selectedPreset.value.name
})

const activeOpponentName = computed<string>(() => {
  const found = OPPONENT_OPTIONS.find(o => o.id === selectedOpponentId.value)
  return found ? found.name : 'Adversaire Rapide'
})

// Event Handlers
const onSelectPreset = (preset: DeckPreset) => {
  selectedPreset.value = preset
  isCustomDeck.value = false
}

const onUpdateCustomDeck = (text: string, cards: CardItem[]) => {
  customPtcglText.value = text
  customCards.value = cards
  isCustomDeck.value = true
}

const onSelectOpponent = (id: OpponentId) => {
  selectedOpponentId.value = id
}

const startSimulation = () => {
  isLoading.value = true

  // 400ms sober loading transition
  setTimeout(() => {
    simulationResult.value = computeSimplifiedSimulation(
      isCustomDeck.value ? 'custom' : selectedPreset.value.id,
      activeDeckName.value,
      selectedOpponentId.value,
      activeOpponentName.value,
      activeCards.value
    )
    isLoading.value = false
    currentStep.value = 3
  }, 400)
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900 flex flex-col antialiased">
    <!-- Clean Minimalist Header -->
    <header class="border-b border-slate-200 bg-white sticky top-0 z-30">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <span class="w-3 h-3 rounded-full bg-blue-600"></span>
          <span class="font-bold text-sm tracking-tight text-slate-900">
            PokéPulse Arena
          </span>
          <span class="text-xs text-slate-400 font-normal hidden sm:inline">
            • Test de stabilité Pokémon TCG
          </span>
        </div>

        <span class="text-xs text-slate-400 font-medium">
          Format Standard
        </span>
      </div>
    </header>

    <!-- Main Wizard Container -->
    <main class="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex-1 w-full space-y-8">
      <!-- 3-Step Progress Stepper -->
      <WizardStepper 
        :current-step="currentStep" 
        @go-to-step="(step) => currentStep = step"
      />

      <!-- Sober Loading Screen (400ms transition) -->
      <SoberLoader v-if="isLoading" />

      <!-- Step 1: Mon Deck -->
      <Step1DeckSelection
        v-else-if="currentStep === 1"
        :selected-preset-id="selectedPreset.id"
        :is-custom-deck="isCustomDeck"
        :custom-cards="customCards"
        :custom-ptcgl-text="customPtcglText"
        @select-preset="onSelectPreset"
        @update-custom-deck="onUpdateCustomDeck"
        @next-step="currentStep = 2"
      />

      <!-- Step 2: Mon Adversaire -->
      <Step2OpponentSelection
        v-else-if="currentStep === 2"
        :selected-opponent-id="selectedOpponentId"
        @select-opponent="onSelectOpponent"
        @previous-step="currentStep = 1"
        @submit-simulation="startSimulation"
      />

      <!-- Step 3: Résultats -->
      <Step3Results
        v-else-if="currentStep === 3 && simulationResult"
        :result="simulationResult"
        @modify-test="currentStep = 2"
        @change-deck="currentStep = 1"
        @change-opponent="currentStep = 2"
      />
    </main>

    <!-- Discreet Minimalist Footer -->
    <footer class="border-t border-slate-200 bg-white py-5 text-center text-xs text-slate-400">
      <div class="max-w-4xl mx-auto px-4">
        PokéPulse Arena • Outil d'aide à la décision Pokémon TCG
      </div>
    </footer>
  </div>
</template>
