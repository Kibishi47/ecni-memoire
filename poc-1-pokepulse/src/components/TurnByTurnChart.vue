<script setup lang="ts">
import { ref } from 'vue'
import type { TurnDataPoint } from '../types/pokemon-tcg'
import { 
  BarChart3, 
  Info
} from 'lucide-vue-next'

defineProps<{
  turnData: TurnDataPoint[]
  opponentName: string
  deckName: string
}>()

const activeSelectedTurn = ref<number>(2) // Default focus on T2

const selectTurn = (turn: number) => {
  activeSelectedTurn.value = turn
}
</script>

<template>
  <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl space-y-5">
    <!-- Header with title & Legend -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <span class="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <BarChart3 class="w-4 h-4" />
          </span>
          <h3 class="text-base font-bold text-slate-100">
            Confrontation Tour par Tour (Tours 1 à 4)
          </h3>
        </div>
        <p class="text-xs text-slate-400 mt-1">
          Comparaison entre votre probabilité d'exécution et le seuil de danger de l'horloge adverse.
        </p>
      </div>

      <!-- Legend -->
      <div class="flex flex-wrap items-center gap-4 text-xs">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded bg-gradient-to-r from-emerald-500 to-indigo-500"></span>
          <span class="text-slate-300 font-medium">{{ deckName }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded bg-rose-500/80"></span>
          <span class="text-slate-300 font-medium">{{ opponentName }}</span>
        </div>
      </div>
    </div>

    <!-- Chart Visualization Area (SVG / CSS Hybrid) -->
    <div class="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-6">
      <!-- 4 Columns Grid for Turns 1 to 4 -->
      <div class="grid grid-cols-4 gap-2 sm:gap-6 pt-6 pb-2">
        <div
          v-for="point in turnData"
          :key="point.turn"
          @click="selectTurn(point.turn)"
          :class="[
            'cursor-pointer group flex flex-col items-center p-2 rounded-xl transition-all duration-200 border',
            activeSelectedTurn === point.turn
              ? 'bg-slate-900/90 border-indigo-500 shadow-glow-indigo'
              : 'hover:bg-slate-900/40 border-transparent'
          ]"
        >
          <!-- Bars Container (Height 160px) -->
          <div class="relative w-full h-44 flex items-end justify-center gap-2 sm:gap-3 px-1 border-b border-slate-800">
            <!-- Background grid lines -->
            <div class="absolute inset-0 pointer-events-none flex flex-col justify-between opacity-15">
              <div class="border-b border-dashed border-slate-400 w-full"></div>
              <div class="border-b border-dashed border-slate-400 w-full"></div>
              <div class="border-b border-dashed border-slate-400 w-full"></div>
              <div class="border-b border-dashed border-slate-400 w-full"></div>
            </div>

            <!-- Player Bar -->
            <div class="relative flex flex-col items-center flex-1 max-w-[36px] h-full justify-end z-10">
              <span class="text-[10px] sm:text-xs font-mono font-bold text-emerald-400 mb-1 group-hover:scale-110 transition-transform">
                {{ point.playerSuccessRate }}%
              </span>
              <div 
                class="w-full rounded-t-lg bg-gradient-to-t from-indigo-600 via-indigo-500 to-emerald-400 transition-all duration-500 group-hover:brightness-110 shadow-sm"
                :style="{ height: `${point.playerSuccessRate}%` }"
              />
            </div>

            <!-- Opponent Threat Bar -->
            <div class="relative flex flex-col items-center flex-1 max-w-[36px] h-full justify-end z-10">
              <span class="text-[10px] sm:text-xs font-mono font-bold text-rose-400 mb-1 group-hover:scale-110 transition-transform">
                {{ point.opponentThreatLevel }}%
              </span>
              <div 
                class="w-full rounded-t-lg bg-gradient-to-t from-rose-700 to-rose-500 transition-all duration-500 group-hover:brightness-110 shadow-sm opacity-85"
                :style="{ height: `${point.opponentThreatLevel}%` }"
              />
            </div>
          </div>

          <!-- Turn Label & Status Pill -->
          <div class="mt-3 text-center space-y-1 w-full">
            <span class="text-xs font-bold text-slate-200 block group-hover:text-white">
              Tour {{ point.turn }}
            </span>

            <span 
              :class="[
                'text-[10px] font-semibold px-2 py-0.5 rounded-full inline-block truncate max-w-full',
                point.status === 'safe' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
                point.status === 'contested' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
                'bg-rose-500/10 text-rose-400 border border-rose-500/30'
              ]"
            >
              {{ point.status === 'safe' ? 'Favorable' : point.status === 'contested' ? 'Contesté' : 'Critique' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Selected Turn Deep-Dive Box -->
      <div 
        v-if="turnData.find(p => p.turn === activeSelectedTurn)"
        class="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in duration-200"
      >
        <div class="flex items-start gap-3">
          <div class="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0 mt-0.5">
            <Info class="w-4 h-4" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-slate-100">
                Diagnostic tactique Tour {{ activeSelectedTurn }} :
              </span>
              <span class="text-indigo-400 font-mono font-bold">
                Écart net : {{ turnData[activeSelectedTurn - 1].playerSuccessRate - turnData[activeSelectedTurn - 1].opponentThreatLevel > 0 ? '+' : '' }}{{ turnData[activeSelectedTurn - 1].playerSuccessRate - turnData[activeSelectedTurn - 1].opponentThreatLevel }}%
              </span>
            </div>
            <p class="text-slate-300 mt-1 leading-relaxed">
              {{ turnData[activeSelectedTurn - 1].turnInsight }}
            </p>
          </div>
        </div>

        <div class="text-[11px] text-slate-500 shrink-0 font-mono self-end sm:self-center">
          Cliquez sur un autre tour pour inspecter
        </div>
      </div>
    </div>
  </div>
</template>
