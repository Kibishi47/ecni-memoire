<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { 
  Play, 
  RefreshCw, 
  Activity
} from 'lucide-vue-next'

const props = defineProps<{
  deckName: string
  opponentName: string
  isSimulating: boolean
}>()

const emit = defineEmits<{
  (e: 'run-simulation'): void
}>()

const simulationSteps = [
  'Génération de 10 000 mains de départ & vérification des Mulligans...',
  'Résolution des chaînes Arven -> Poffin Pote-Pote + Super Bonbon...',
  'Calcul des cartes clés piégées dans les 6 Récompenses (Prized)...',
  'Application de la pression adverse et de l\'horloge T2-T4...',
  'Agrégation des 10 000 itérations Monte-Carlo...'
]

const currentStepText = ref(simulationSteps[0])
const progressPercentage = ref(0)
const simulatedRunsCount = ref(0)

let timerInterval: any = null

watch(() => props.isSimulating, (newVal) => {
  if (newVal) {
    progressPercentage.value = 0
    simulatedRunsCount.value = 0
    currentStepText.value = simulationSteps[0]

    const startTime = Date.now()
    const totalDuration = 550 // 550ms total realistic fast wasm time

    if (timerInterval) clearInterval(timerInterval)

    timerInterval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(100, Math.floor((elapsed / totalDuration) * 100))
      progressPercentage.value = progress
      simulatedRunsCount.value = Math.min(10000, Math.floor((progress / 100) * 10000))

      // Update text steps
      const stepIdx = Math.min(
        simulationSteps.length - 1,
        Math.floor((progress / 100) * simulationSteps.length)
      )
      currentStepText.value = simulationSteps[stepIdx]

      if (progress >= 100) {
        clearInterval(timerInterval)
      }
    }, 25)
  } else {
    progressPercentage.value = 100
    simulatedRunsCount.value = 10000
    if (timerInterval) clearInterval(timerInterval)
  }
})

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval)
})
</script>

<template>
  <div class="relative rounded-2xl overflow-hidden border border-slate-800 bg-slate-900/90 shadow-2xl p-5 md:p-6 backdrop-blur-md">
    <!-- Background subtle gradient pulse -->
    <div class="absolute -top-24 -right-24 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
    <div class="absolute -bottom-24 -left-24 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

    <div class="relative z-10 flex flex-col md:flex-row items-center justify-between gap-5">
      <!-- Left Info: Targets & Description -->
      <div class="space-y-1.5 text-center md:text-left">
        <div class="flex items-center justify-center md:justify-start gap-2">
          <span class="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full">
            <Activity class="w-3 h-3 animate-pulse" />
            Moteur Monte-Carlo Wasm
          </span>
          <span class="text-xs text-slate-500 font-mono">N = 10 000 tirages</span>
        </div>

        <div class="flex flex-wrap items-center justify-center md:justify-start gap-2 text-sm text-slate-300 font-medium">
          <span class="text-white font-bold">{{ deckName }}</span>
          <span class="text-slate-500">VS</span>
          <span class="text-rose-400 font-bold">{{ opponentName }}</span>
        </div>
      </div>

      <!-- Right Action: Big Button or Active Loader -->
      <div class="w-full md:w-auto flex flex-col items-center md:items-end">
        <button
          v-if="!isSimulating"
          @click="emit('run-simulation')"
          type="button"
          class="w-full md:w-auto group relative inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl font-extrabold text-sm text-white bg-gradient-to-r from-indigo-500 via-indigo-600 to-emerald-500 hover:from-indigo-600 hover:to-emerald-600 shadow-glow-indigo transition-all duration-300 transform active:scale-95 cursor-pointer"
        >
          <div class="p-1 rounded-lg bg-white/20">
            <Play class="w-4 h-4 fill-white text-white group-hover:scale-110 transition-transform" />
          </div>
          <span>Lancer 10 000 simulations (Moteur Wasm)</span>
          <span class="text-xs font-mono font-normal opacity-80 pl-1 border-l border-white/20">
            ~500ms
          </span>
        </button>

        <!-- Simulating State (Wizard of Oz) -->
        <div v-else class="w-full md:w-80 space-y-2">
          <div class="flex items-center justify-between text-xs font-mono">
            <span class="text-indigo-400 flex items-center gap-1.5 font-bold">
              <RefreshCw class="w-3.5 h-3.5 animate-spin text-indigo-400" />
              Calcul en cours...
            </span>
            <span class="text-emerald-400 font-bold">
              {{ simulatedRunsCount.toLocaleString() }} / 10 000
            </span>
          </div>

          <!-- Progress Bar -->
          <div class="h-3 w-full bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-700">
            <div 
              class="h-full bg-gradient-to-r from-indigo-500 via-emerald-400 to-indigo-400 rounded-full transition-all duration-75 relative overflow-hidden"
              :style="{ width: `${progressPercentage}%` }"
            >
              <div class="absolute inset-0 bg-white/20 animate-pulse" />
            </div>
          </div>

          <p class="text-[11px] text-slate-400 truncate text-center md:text-right font-medium">
            {{ currentStepText }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
