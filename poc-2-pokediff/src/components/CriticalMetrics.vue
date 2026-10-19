<script setup lang="ts">
import { BarChart3, TrendingUp, TrendingDown, Minus, Info } from 'lucide-vue-next'
import type { CriticalMetric } from '../types/deck'

defineProps<{
  metrics: CriticalMetric[]
}>()

function isDeltaFavorable(m: CriticalMetric): boolean {
  if (m.lowerIsBetter) {
    return m.delta < 0
  }
  return m.delta > 0
}

function getDeltaBadgeClass(m: CriticalMetric): string {
  if (m.delta === 0) {
    return 'bg-slate-800 border-slate-700 text-slate-300'
  }
  if (isDeltaFavorable(m)) {
    return 'bg-emerald-950/80 border-emerald-500/70 text-emerald-300 shadow-sm'
  }
  return 'bg-rose-950/80 border-rose-500/70 text-rose-300 shadow-sm'
}

function formatDelta(m: CriticalMetric): string {
  if (m.delta > 0) return `+${m.delta.toFixed(1)} %`
  if (m.delta < 0) return `${m.delta.toFixed(1)} %`
  return `0,0 %`
}
</script>

<template>
  <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-sm">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center space-x-2">
        <BarChart3 class="w-5 h-5 text-indigo-400" />
        <h2 class="text-base font-bold text-slate-100 uppercase tracking-wider text-xs">
          Métriques Critiques d'Ouverture & Exécution (Barres Doubles A vs B)
        </h2>
      </div>
      <div class="flex items-center space-x-4 text-xs font-mono">
        <span class="flex items-center text-sky-400">
          <span class="w-3 h-3 rounded bg-sky-400 mr-1.5"></span>
          Variante A (Réf)
        </span>
        <span class="flex items-center text-violet-400">
          <span class="w-3 h-3 rounded bg-violet-400 mr-1.5"></span>
          Variante B (Micro-ajustée)
        </span>
      </div>
    </div>

    <!-- 4 Metrics Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div
        v-for="m in metrics"
        :key="m.id"
        class="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition"
      >
        <!-- Header -->
        <div class="flex items-start justify-between gap-2 mb-2">
          <div>
            <h3 class="text-sm font-bold text-slate-100">{{ m.name }}</h3>
            <p class="text-[11px] text-slate-400 mt-0.5">{{ m.description }}</p>
          </div>

          <!-- Delta Tag -->
          <div
            class="px-2.5 py-1 rounded-lg text-xs font-mono font-black border flex items-center space-x-1 shrink-0"
            :class="getDeltaBadgeClass(m)"
          >
            <TrendingUp v-if="m.delta > 0" class="w-3.5 h-3.5" />
            <TrendingDown v-else-if="m.delta < 0" class="w-3.5 h-3.5" />
            <Minus v-else class="w-3.5 h-3.5" />
            <span>{{ formatDelta(m) }}</span>
          </div>
        </div>

        <!-- Comparative Double Bars -->
        <div class="space-y-2 mt-3">
          <!-- Deck A Bar -->
          <div>
            <div class="flex justify-between text-[11px] font-mono mb-1">
              <span class="text-sky-400 font-semibold">Variante A</span>
              <span class="text-slate-300 font-bold">{{ m.rateA.toFixed(1) }} %</span>
            </div>
            <div class="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                class="h-full bg-sky-400 rounded-full transition-all duration-500"
                :style="{ width: `${Math.min(m.rateA, 100)}%` }"
              ></div>
            </div>
          </div>

          <!-- Deck B Bar -->
          <div>
            <div class="flex justify-between text-[11px] font-mono mb-1">
              <span class="text-violet-400 font-semibold">Variante B</span>
              <span class="text-slate-300 font-bold">{{ m.rateB.toFixed(1) }} %</span>
            </div>
            <div class="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                class="h-full bg-violet-400 rounded-full transition-all duration-500"
                :style="{ width: `${Math.min(m.rateB, 100)}%` }"
              ></div>
            </div>
          </div>
        </div>

        <!-- Benchmark Footer -->
        <div class="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500 font-mono">
          <span class="flex items-center">
            <Info class="w-3 h-3 text-slate-500 mr-1" />
            {{ m.benchmarkNote }}
          </span>
          <span
            v-if="m.lowerIsBetter"
            class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px] uppercase"
          >
            Objectif : Plus bas
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
