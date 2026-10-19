<script setup lang="ts">
import { Shield, Sliders, Cpu, CheckCircle2 } from 'lucide-vue-next'

defineProps<{
  currentStep: number
  hasCalculated: boolean
}>()

const emit = defineEmits<{
  (e: 'selectStep', step: number): void
}>()

const steps = [
  {
    number: 1,
    title: '1. Squelette Core',
    subtitle: 'Archétype & Cartes verrouillées',
    icon: Shield,
  },
  {
    number: 2,
    title: '2. Méta de Salle',
    subtitle: 'Curseurs tournoi & Objectif',
    icon: Sliders,
  },
  {
    number: 3,
    title: '3. Ratios Optimaux',
    subtitle: 'Prescription & Heatmap 60 cartes',
    icon: Cpu,
  },
]
</script>

<template>
  <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-2.5 backdrop-blur-sm shadow-xl">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
      <button
        v-for="step in steps"
        :key="step.number"
        type="button"
        @click="emit('selectStep', step.number)"
        :class="[
          'relative flex items-center p-3 rounded-xl transition-all duration-200 text-left group overflow-hidden border',
          currentStep === step.number
            ? 'bg-gradient-to-r from-slate-800/90 to-slate-800/50 border-amber-500/50 shadow-md shadow-amber-500/5'
            : currentStep > step.number || (step.number === 3 && hasCalculated)
            ? 'bg-slate-950/40 border-slate-800/70 hover:bg-slate-800/40 hover:border-slate-700 text-slate-300'
            : 'bg-slate-950/20 border-transparent hover:bg-slate-900/50 text-slate-500'
        ]"
      >
        <!-- Active indicator bar -->
        <div
          v-if="currentStep === step.number"
          class="absolute left-0 top-0 bottom-0 w-1 bg-amber-500 rounded-r"
        ></div>

        <!-- Step Icon / Number -->
        <div
          :class="[
            'w-10 h-10 rounded-lg flex items-center justify-center mr-3 shrink-0 transition-colors',
            currentStep === step.number
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : (currentStep > step.number || (step.number === 3 && hasCalculated))
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-slate-800/60 text-slate-500 border border-slate-700/40'
          ]"
        >
          <component
            :is="(currentStep > step.number || (step.number === 3 && hasCalculated)) && currentStep !== step.number ? CheckCircle2 : step.icon"
            class="w-5 h-5"
          />
        </div>

        <!-- Text details -->
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between">
            <span
              :class="[
                'text-sm font-semibold truncate',
                currentStep === step.number ? 'text-white' : 'text-slate-300'
              ]"
            >
              {{ step.title }}
            </span>
            <span
              v-if="currentStep === step.number"
              class="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 ml-2"
            >
              Actif
            </span>
          </div>
          <p class="text-xs text-slate-400 truncate mt-0.5">
            {{ step.subtitle }}
          </p>
        </div>
      </button>
    </div>
  </div>
</template>
