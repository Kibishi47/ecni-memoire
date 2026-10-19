<script setup lang="ts">
import { ref, computed } from 'vue'
import { DECK_PROFILES, getDefaultKeyCards } from './data/wizardData'
import { evaluateWizardComparison } from './services/wizardSimulator'
import type { DeckArchetype, KeyCardItem, PresetChange, WizardResult } from './types/wizard'

import WizardHeader from './components/WizardHeader.vue'
import Step1DeckChoice from './components/Step1DeckChoice.vue'
import Step2CardSwap from './components/Step2CardSwap.vue'
import Step3Comparison from './components/Step3Comparison.vue'

// Wizard Step State: 1, 2, or 3 (Only ONE screen visible at a time)
const currentStep = ref<number>(1)

// Selected Deck Archetype
const selectedDeckId = ref<DeckArchetype>('dracaufeu')

// 6 Key Cards for the selected deck
const keyCards = ref<KeyCardItem[]>(getDefaultKeyCards('dracaufeu'))

// Active Preset ID (defaults to 'stability')
const activePresetId = ref<string | null>('stability')

// Initial setup with preset 'stability' applied so that when user reaches step 2, a realistic swap is already loaded
function applyInitialPreset() {
  const defaultList = getDefaultKeyCards(selectedDeckId.value)
  const boss = defaultList.find((c) => c.id === 'boss')
  const poffin = defaultList.find((c) => c.id === 'poffin')
  if (boss && poffin) {
    boss.currentCount = Math.max(0, boss.defaultCount - 1)
    poffin.currentCount = poffin.defaultCount + 1
  }
  keyCards.value = defaultList
  activePresetId.value = 'stability'
}

applyInitialPreset()

// Handlers for Step 1
function handleSelectDeck(deckId: DeckArchetype) {
  selectedDeckId.value = deckId
  applyInitialPreset()
}

function handleGoToStep2() {
  currentStep.value = 2
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// Handlers for Step 2
function handleApplyPreset(preset: PresetChange) {
  // Reset all to defaults first
  const resetList = getDefaultKeyCards(selectedDeckId.value)
  const removeCard = resetList.find((c) => c.id === preset.removeCardId)
  const addCard = resetList.find((c) => c.id === preset.addCardId)

  if (removeCard && addCard) {
    removeCard.currentCount = Math.max(removeCard.min, removeCard.defaultCount - 1)
    addCard.currentCount = Math.min(addCard.max, addCard.defaultCount + 1)
  }

  keyCards.value = resetList
  activePresetId.value = preset.id
}

function handleUpdateCardCount(cardId: string, delta: number) {
  const card = keyCards.value.find((c) => c.id === cardId)
  if (card) {
    const nextCount = card.currentCount + delta
    if (nextCount >= card.min && nextCount <= card.max) {
      card.currentCount = nextCount
      activePresetId.value = null // Custom user adjustment
    }
  }
}

function handleResetChanges() {
  keyCards.value = getDefaultKeyCards(selectedDeckId.value)
  activePresetId.value = null
}

function handleGoToStep3() {
  currentStep.value = 3
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// Comparison Evaluation (Computed dynamically for Step 3)
const comparisonResult = computed<WizardResult>(() => {
  return evaluateWizardComparison(selectedDeckId.value, keyCards.value)
})
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans antialiased">
    <!-- Top Stepper Header (1. Deck ➔ 2. Changement ➔ 3. Comparaison) -->
    <WizardHeader
      :current-step="currentStep"
      @go-to-step="(step) => { currentStep = step }"
    />

    <!-- Main Container: ONLY ONE SCREEN VISIBLE AT A TIME -->
    <main class="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <!-- SCREEN 1: Deck de départ -->
      <transition name="fade" mode="out-in">
        <div v-if="currentStep === 1" key="step-1">
          <Step1DeckChoice
            :selected-deck-id="selectedDeckId"
            @select-deck="handleSelectDeck"
            @next-step="handleGoToStep2"
          />
        </div>

        <!-- SCREEN 2: Changer 1 à 3 cartes -->
        <div v-else-if="currentStep === 2" key="step-2">
          <Step2CardSwap
            :deck-id="selectedDeckId"
            :cards="keyCards"
            :active-preset-id="activePresetId"
            @prev-step="currentStep = 1"
            @next-step="handleGoToStep3"
            @apply-preset="handleApplyPreset"
            @update-card-count="handleUpdateCardCount"
            @reset-changes="handleResetChanges"
          />
        </div>

        <!-- SCREEN 3: Quel est l'impact de ce changement ? -->
        <div v-else-if="currentStep === 3" key="step-3">
          <Step3Comparison
            :deck="DECK_PROFILES[selectedDeckId]"
            :result="comparisonResult"
            @back-to-step2="currentStep = 2"
            @back-to-step1="currentStep = 1"
          />
        </div>
      </transition>
    </main>

    <!-- Clean Minimalist Footer -->
    <footer class="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400">
      <div class="max-w-5xl mx-auto px-4">
        <span>PokéDiff • Assistant d'arbitrage de cartes Pokémon TCG • Prototype UX/UI en 3 étapes</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease-in-out;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
