<script setup lang="ts">
import { ref, computed } from 'vue'
import Header from './components/Header.vue'
import StepNavigation from './components/StepNavigation.vue'
import Step1CoreSelection from './components/Step1CoreSelection.vue'
import Step2MetaConfiguration from './components/Step2MetaConfiguration.vue'
import Step3OptimizationResult from './components/Step3OptimizationResult.vue'
import { ARCHETYPES } from './data/archetypes'
import { META_PRESETS } from './data/metaPresets'
import { TournamentMeta, OptimizationTargetId, OptimizationResult } from './types/deck'
import { calculateRecommendedRatios } from './utils/optimizer'

const archetypes = ref(ARCHETYPES)
const selectedArchetypeId = ref<string>('charizard-pidgeot') // Base Dracaufeu ex first!
const currentStep = ref<number>(1)
const isCalculating = ref<boolean>(false)

// Tournament meta sliders state (default: Boutique locale)
const tournamentMeta = ref<TournamentMeta>({
  aggroRate: META_PRESETS[0].meta.aggroRate,
  evolutionRate: META_PRESETS[0].meta.evolutionRate,
  controlRate: META_PRESETS[0].meta.controlRate,
})

// Priority target state (default: Sécurité anti-brique)
const selectedTargetId = ref<OptimizationTargetId>('anti_brick')

const activeArchetype = computed(() => {
  return archetypes.value.find(a => a.id === selectedArchetypeId.value) || archetypes.value[0]
})

const activePresetName = computed(() => {
  const match = META_PRESETS.find(
    p =>
      p.meta.aggroRate === tournamentMeta.value.aggroRate &&
      p.meta.evolutionRate === tournamentMeta.value.evolutionRate &&
      p.meta.controlRate === tournamentMeta.value.controlRate
  )
  return match ? match.name : 'Personnalisé'
})

// Computed / cached result
const optimizationResult = ref<OptimizationResult>(
  calculateRecommendedRatios(
    activeArchetype.value,
    tournamentMeta.value,
    selectedTargetId.value,
    activePresetName.value
  )
)

function handleSelectArchetype(id: string) {
  selectedArchetypeId.value = id
}

function handleSelectStep(step: number) {
  currentStep.value = step
}

function handleNextStep() {
  if (currentStep.value < 3) {
    currentStep.value++
  }
}

function handlePreviousStep() {
  if (currentStep.value > 1) {
    currentStep.value--
  }
}

function handleUpdateMeta(newMeta: TournamentMeta) {
  tournamentMeta.value = newMeta
}

function handleUpdateTarget(newTargetId: OptimizationTargetId) {
  selectedTargetId.value = newTargetId
}

// 400ms subtle loading simulation before showing Screen 3
function handleStartCalculation() {
  isCalculating.value = true
  setTimeout(() => {
    optimizationResult.value = calculateRecommendedRatios(
      activeArchetype.value,
      tournamentMeta.value,
      selectedTargetId.value,
      activePresetName.value
    )
    isCalculating.value = false
    currentStep.value = 3
  }, 400)
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
    <!-- Clean Light Header -->
    <Header />

    <!-- Content Area -->
    <main class="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      
      <!-- Top Step Pipeline Navigation -->
      <StepNavigation
        :currentStep="currentStep"
        @selectStep="handleSelectStep"
      />

      <!-- Écran 1 : Quel deck préparez-vous ? -->
      <div v-show="currentStep === 1">
        <Step1CoreSelection
          :archetypes="archetypes"
          :selectedArchetypeId="selectedArchetypeId"
          @selectArchetype="handleSelectArchetype"
          @nextStep="handleNextStep"
        />
      </div>

      <!-- Écran 2 : Quels adversaires attendez-vous en tournoi ? -->
      <div v-show="currentStep === 2">
        <Step2MetaConfiguration
          :meta="tournamentMeta"
          :selectedTargetId="selectedTargetId"
          :archetypeName="activeArchetype.name"
          :isCalculating="isCalculating"
          @updateMeta="handleUpdateMeta"
          @updateTarget="handleUpdateTarget"
          @previousStep="handlePreviousStep"
          @startCalculation="handleStartCalculation"
        />
      </div>

      <!-- Écran 3 : Vos cartes recommandées -->
      <div v-show="currentStep === 3">
        <Step3OptimizationResult
          :archetype="activeArchetype"
          :result="optimizationResult"
          @previousStep="handlePreviousStep"
        />
      </div>

    </main>

    <!-- Clean Light Footer -->
    <footer class="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-400">
      <div class="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>
          PokéTuner • Assistant de ratios pour deck Pokémon TCG
        </div>
        <div>
          Compatible avec Pokémon TCG Live
        </div>
      </div>
    </footer>
  </div>
</template>
