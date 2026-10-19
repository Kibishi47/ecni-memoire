<script setup lang="ts">
import { Check } from 'lucide-vue-next'

defineProps<{
  currentStep: number // 1, 2, or 3
}>()

const emit = defineEmits<{
  (e: 'go-to-step', step: number): void
}>()

const steps = [
  { number: 1, label: 'Mon Deck' },
  { number: 2, label: 'Mon Adversaire' },
  { number: 3, label: 'Résultats' }
]
</script>

<template>
  <nav aria-label="Progression du test" class="flex items-center justify-center">
    <ol class="flex items-center gap-2 sm:gap-4 text-sm font-medium text-slate-500">
      <li 
        v-for="(step, index) in steps" 
        :key="step.number"
        class="flex items-center gap-2 sm:gap-4"
      >
        <button
          type="button"
          :disabled="step.number > currentStep"
          @click="step.number < currentStep && emit('go-to-step', step.number)"
          :class="[
            'flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-xs sm:text-sm',
            currentStep === step.number 
              ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200' 
              : step.number < currentStep
                ? 'text-slate-700 hover:text-slate-900 cursor-pointer'
                : 'text-slate-400 cursor-not-allowed'
          ]"
        >
          <span 
            :class="[
              'w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold',
              currentStep === step.number
                ? 'bg-blue-600 text-white'
                : step.number < currentStep
                  ? 'bg-slate-200 text-slate-700'
                  : 'bg-slate-100 text-slate-400'
            ]"
          >
            <Check v-if="step.number < currentStep" class="w-3 h-3 stroke-[3]" />
            <span v-else>{{ step.number }}</span>
          </span>
          <span>{{ step.label }}</span>
        </button>

        <!-- Separator arrow -->
        <span v-if="index < steps.length - 1" class="text-slate-300 font-normal select-none">
          →
        </span>
      </li>
    </ol>
  </nav>
</template>
