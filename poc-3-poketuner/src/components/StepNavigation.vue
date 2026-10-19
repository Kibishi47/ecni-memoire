<script setup lang="ts">
import { Check, ChevronRight } from 'lucide-vue-next'

defineProps<{
  currentStep: number
}>()

const emit = defineEmits<{
  (e: 'selectStep', step: number): void
}>()

const steps = [
  { number: 1, label: '1. Mon Deck' },
  { number: 2, label: '2. Mon Tournoi' },
  { number: 3, label: '3. Ratios Recommandés' },
]
</script>

<template>
  <nav aria-label="Progression" class="bg-white border border-slate-200 rounded-2xl p-2 shadow-sm">
    <ol class="grid grid-cols-3 gap-2">
      <li v-for="(step, idx) in steps" :key="step.number" class="relative">
        <button
          type="button"
          @click="emit('selectStep', step.number)"
          :class="[
            'w-full flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all',
            currentStep === step.number
              ? 'bg-blue-600 text-white shadow-sm'
              : currentStep > step.number
              ? 'bg-blue-50 text-blue-700 hover:bg-blue-100/80'
              : 'bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600'
          ]"
        >
          <!-- Completed checkmark -->
          <Check v-if="currentStep > step.number" class="w-4 h-4 text-blue-600 stroke-[2.5]" />
          
          <!-- Step label -->
          <span>{{ step.label }}</span>
        </button>

        <!-- Right arrow separator (except last) -->
        <div
          v-if="idx < steps.length - 1"
          class="hidden sm:block absolute -right-2 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none z-10"
        >
          <ChevronRight class="w-3.5 h-3.5" />
        </div>
      </li>
    </ol>
  </nav>
</template>
