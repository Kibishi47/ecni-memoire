<script setup lang="ts">
import { Check } from 'lucide-vue-next'

const props = defineProps<{
  currentStep: number // 1, 2, or 3
}>()

const emit = defineEmits<{
  (e: 'go-to-step', step: number): void
}>()

const steps = [
  { number: 1, title: 'Deck de départ' },
  { number: 2, title: 'Changement de cartes' },
  { number: 3, title: 'Comparaison' },
]

function handleClick(stepNumber: number) {
  // Only allow jumping back to a previous step
  if (stepNumber < props.currentStep) {
    emit('go-to-step', stepNumber)
  }
}
</script>

<template>
  <header class="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <!-- Logo & App Title -->
      <div class="flex items-center space-x-3">
        <div class="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
          ⚡
        </div>
        <div>
          <h1 class="text-base font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <span>PokéDiff</span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium border border-slate-200">
              Assistant TCG
            </span>
          </h1>
          <p class="text-xs text-slate-500">
            Comparez l'impact réel de vos micro-changements de cartes en 3 étapes
          </p>
        </div>
      </div>

      <!-- 3-Step Breadcrumb Bar -->
      <nav aria-label="Étapes du comparateur" class="flex items-center space-x-1 sm:space-x-2">
        <template v-for="(step, index) in steps" :key="step.number">
          <!-- Step Pill -->
          <button
            type="button"
            @click="handleClick(step.number)"
            :disabled="step.number > currentStep"
            class="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition"
            :class="[
              step.number === currentStep
                ? 'bg-blue-600 text-white font-semibold shadow-xs'
                : step.number < currentStep
                  ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer border border-blue-200'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
            ]"
          >
            <!-- Number or Checkmark -->
            <span
              class="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold"
              :class="[
                step.number === currentStep
                  ? 'bg-white/20 text-white'
                  : step.number < currentStep
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-200 text-slate-500'
              ]"
            >
              <Check v-if="step.number < currentStep" class="w-3 h-3 stroke-[3]" />
              <span v-else>{{ step.number }}</span>
            </span>
            <span class="hidden sm:inline">{{ step.title }}</span>
          </button>

          <!-- Chevron separator -->
          <span v-if="index < steps.length - 1" class="text-slate-300 text-sm select-none">
            ➔
          </span>
        </template>
      </nav>
    </div>
  </header>
</template>
