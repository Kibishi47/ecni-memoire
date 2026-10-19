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

const archetypes = ref(ARCHETYPES)
const selectedArchetypeId = ref<string>('dragapult-xatu')
const currentStep = ref<number>(1)
const hasCalculated = ref<boolean>(false)
const latestResult = ref<OptimizationResult | null>(null)

// Tournament meta sliders state (defaults to Regional Balanced)
const tournamentMeta = ref<TournamentMeta>({
  aggroRate: META_PRESETS[1].meta.aggroRate,
  evolutionRate: META_PRESETS[1].meta.evolutionRate,
  controlRate: META_PRESETS[1].meta.controlRate,
})

// Priority target state
const selectedTargetId = ref<OptimizationTargetId>('anti_brick')

const activeArchetype = computed(() => {
  return archetypes.value.find(a => a.id === selectedArchetypeId.value) || archetypes.value[0]
})

function handleSelectArchetype(id: string) {
  selectedArchetypeId.value = id
  hasCalculated.value = false
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

function handleGoToStep1() {
  currentStep.value = 1
}

function handleUpdateMeta(newMeta: TournamentMeta) {
  tournamentMeta.value = newMeta
  hasCalculated.value = false
}

function handleUpdateTarget(newTargetId: OptimizationTargetId) {
  selectedTargetId.value = newTargetId
  hasCalculated.value = false
}

function handleCalculationFinished(result: OptimizationResult) {
  latestResult.value = result
  hasCalculated.value = true
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
    <!-- Main Header -->
    <Header :activeArchetypeTitle="activeArchetype.name" />

    <!-- Content Area -->
    <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      <!-- Top Step Pipeline Navigation -->
      <StepNavigation
        :currentStep="currentStep"
        :hasCalculated="hasCalculated"
        @selectStep="handleSelectStep"
      />

      <!-- Step 1: Core Deck Selection -->
      <div v-show="currentStep === 1">
        <Step1CoreSelection
          :archetypes="archetypes"
          :selectedArchetypeId="selectedArchetypeId"
          @selectArchetype="handleSelectArchetype"
          @nextStep="handleNextStep"
        />
      </div>

      <!-- Step 2: Tournament Meta Sliders & Optimization Target -->
      <div v-show="currentStep === 2">
        <Step2MetaConfiguration
          :meta="tournamentMeta"
          :selectedTargetId="selectedTargetId"
          :archetypeName="activeArchetype.name"
          @updateMeta="handleUpdateMeta"
          @updateTarget="handleUpdateTarget"
          @previousStep="handlePreviousStep"
          @nextStep="handleNextStep"
        />
      </div>

      <!-- Step 3: Heuristic Convergence Animation & Ratio Recommendation View -->
      <div v-show="currentStep === 3">
        <Step3OptimizationResult
          :archetype="activeArchetype"
          :meta="tournamentMeta"
          :targetId="selectedTargetId"
          @previousStep="handlePreviousStep"
          @goToStep1="handleGoToStep1"
          @calculationFinished="handleCalculationFinished"
        />
      </div>

    </main>

    <!-- Footer -->
    <footer class="border-t border-slate-900 bg-slate-950/80 py-6 text-center text-xs text-slate-500 font-mono">
      <div class="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>
          PokéTuner Engine • Mémoire POC 3 — Optimiseur Combinatoire Sous Contrainte Méta
        </div>
        <div class="flex items-center space-x-3">
          <span>Format PTCGL SV6+</span>
          <span>•</span>
          <span class="text-amber-500/80">Simulations Heuristiques & Monte-Carlo</span>
        </div>
      </div>
    </footer>
  </div>
</template>
