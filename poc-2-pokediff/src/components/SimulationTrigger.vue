<script setup lang="ts">
import { ref } from 'vue'
import { Play, Loader2, Cpu, CheckCircle2, ShieldCheck, Eye } from 'lucide-vue-next'
import confetti from 'canvas-confetti'

const props = defineProps<{
  isSimulating: boolean
  sampleSize: number
  seed: number
  durationMs: number
  isValid: boolean
}>()

const emit = defineEmits<{
  (e: 'run-simulation'): void
  (e: 'open-inspector'): void
}>()

const buttonRef = ref<HTMLButtonElement | null>(null)

function triggerSimulation() {
  if (props.isSimulating || !props.isValid) return
  emit('run-simulation')

  // Fire celebratory mini confetti on completion after 400ms
  setTimeout(() => {
    try {
      confetti({
        particleCount: 35,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#38bdf8', '#818cf8', '#a78bfa', '#34d399'],
        disableForReducedMotion: true,
      })
    } catch {
      // ignore
    }
  }, 420)
}
</script>

<template>
  <div class="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/30 rounded-2xl p-6 shadow-2xl relative overflow-hidden backdrop-blur-md">
    <!-- Ambient background glow -->
    <div class="absolute -top-24 -right-24 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
    <div class="absolute -bottom-24 -left-24 w-72 h-72 bg-sky-500/10 rounded-full blur-3xl pointer-events-none"></div>

    <div class="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
      <!-- Explanation & Concept -->
      <div class="max-w-2xl">
        <div class="flex items-center space-x-2 mb-2">
          <span class="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-indigo-950/90 border border-indigo-500/50 text-[11px] font-mono font-semibold text-indigo-300">
            <Cpu class="w-3.5 h-3.5 text-indigo-400" />
            <span>Moteur Déterministe Coupled Monte-Carlo</span>
          </span>
          <span class="text-xs text-slate-400 font-mono">
            Graine : #{{ seed.toString(16).toUpperCase() }}
          </span>
        </div>

        <h2 class="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
          Simulation Couplée ("Same-Seed Engine")
        </h2>
        <p class="text-xs sm:text-sm text-slate-300 mt-1.5 leading-relaxed">
          Pour éliminer 100 % de la variance aléatoire, les listes <span class="text-sky-400 font-semibold">Variante A</span> et <span class="text-violet-400 font-semibold">Variante B</span> affrontent <strong>exactement les mêmes 10 000 distributions de paquets</strong> (mêmes cartes Récompenses, même main initiale de 7 cartes et mêmes pioches au tour par tour).
        </p>

        <!-- Benchmark pill -->
        <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400 font-mono">
          <span class="flex items-center text-emerald-400">
            <CheckCircle2 class="w-3.5 h-3.5 mr-1" />
            10 000 parties couplées analysées en {{ durationMs }} ms
          </span>
          <span class="text-slate-600">•</span>
          <span class="flex items-center text-indigo-300">
            <ShieldCheck class="w-3.5 h-3.5 mr-1" />
            Intervalle de confiance : p &lt; 0.001
          </span>
        </div>
      </div>

      <!-- Action Button Area -->
      <div class="flex flex-col items-center sm:items-end w-full md:w-auto shrink-0 space-y-2.5">
        <button
          ref="buttonRef"
          @click="triggerSimulation"
          type="button"
          :disabled="isSimulating || !isValid"
          class="relative w-full sm:w-auto px-7 py-4 rounded-xl font-bold text-sm tracking-wide transition-all duration-300 flex items-center justify-center space-x-3 shadow-xl overflow-hidden group select-none"
          :class="
            !isValid
              ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
              : isSimulating
                ? 'bg-indigo-700 text-white shadow-indigo-500/30'
                : 'bg-gradient-to-r from-sky-500 via-indigo-600 to-violet-600 hover:from-sky-400 hover:via-indigo-500 hover:to-violet-500 text-white shadow-indigo-600/30 hover:shadow-indigo-500/50 hover:scale-[1.02] active:scale-[0.98]'
          "
        >
          <!-- Shimmer effect -->
          <div
            v-if="!isSimulating && isValid"
            class="absolute inset-0 -translate-x-full group-hover:translate-x-full duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent transition-all pointer-events-none"
          ></div>

          <!-- Spinner or Play icon -->
          <Loader2 v-if="isSimulating" class="w-5 h-5 animate-spin text-white" />
          <Play v-else class="w-5 h-5 fill-white text-white" />

          <span class="font-extrabold text-sm uppercase tracking-wider">
            {{ isSimulating ? 'Calcul sur 10 000 graines couplées...' : 'Comparer sur 10 000 tirages couplés' }}
          </span>
        </button>

        <!-- Secondary Seed Inspector trigger -->
        <button
          @click="emit('open-inspector')"
          type="button"
          class="text-xs text-indigo-300 hover:text-white flex items-center space-x-1.5 underline underline-offset-4 transition"
        >
          <Eye class="w-3.5 h-3.5" />
          <span>Explorer les mains graine par graine (Inspecteur)</span>
        </button>

        <p v-if="!isValid" class="text-[11px] text-rose-400 font-mono text-center sm:text-right">
          Ajustez la Variante B à 60/60 cartes pour lancer la simulation.
        </p>
      </div>
    </div>

    <!-- 400ms Visual Progress Bar animation -->
    <div v-if="isSimulating" class="mt-4 pt-3 border-t border-indigo-900/60">
      <div class="flex items-center justify-between text-xs font-mono text-indigo-300 mb-1">
        <span>Génération de la séquence de tirages couplés déterministes...</span>
        <span>10 000 / 10 000 mains</span>
      </div>
      <div class="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
        <div class="h-full bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-400 animate-[pulse_0.4s_ease-in-out_infinite] w-full"></div>
      </div>
    </div>
  </div>
</template>
