<script setup lang="ts">
import { Swords, Zap, RefreshCw, Skull, ArrowUpRight, ArrowDownRight, Minus, HelpCircle } from 'lucide-vue-next'
import type { MatchupScore } from '../types/deck'

defineProps<{
  matchups: MatchupScore[]
}>()

function getArchetypeIcon(archetype: string) {
  switch (archetype) {
    case 'Aggro':
      return Zap
    case 'Setup':
      return RefreshCw
    case 'Disruption':
      return Skull
    default:
      return Swords
  }
}

function getArchetypeTagColor(archetype: string) {
  switch (archetype) {
    case 'Aggro':
      return 'bg-amber-950/80 text-amber-300 border-amber-600/50'
    case 'Setup':
      return 'bg-sky-950/80 text-sky-300 border-sky-600/50'
    case 'Disruption':
      return 'bg-purple-950/80 text-purple-300 border-purple-600/50'
    default:
      return 'bg-slate-800 text-slate-300 border-slate-700'
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Section Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-2">
        <Swords class="w-5 h-5 text-indigo-400" />
        <h2 class="text-base font-bold text-slate-100 uppercase tracking-wider text-xs">
          Matrice des Deltas par Matchup Clé (3 Colonnes Compétitives)
        </h2>
      </div>
      <span class="text-xs font-mono text-slate-400 hidden sm:inline">
        Impact mesuré sur 10 000 graines appariées
      </span>
    </div>

    <!-- 3-Column Grid -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div
        v-for="m in matchups"
        :key="m.name"
        class="bg-slate-900/80 border rounded-2xl p-5 flex flex-col justify-between shadow-xl backdrop-blur-sm transition hover:border-slate-700 relative overflow-hidden"
        :class="
          m.delta > 0
            ? 'border-emerald-500/30'
            : m.delta < 0
              ? 'border-rose-500/30'
              : 'border-slate-800'
        "
      >
        <!-- Top Accent line -->
        <div
          class="absolute top-0 left-0 right-0 h-1"
          :class="
            m.delta > 0
              ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
              : m.delta < 0
                ? 'bg-gradient-to-r from-rose-500 to-amber-500'
                : 'bg-slate-700'
          "
        ></div>

        <!-- Header -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <span
              class="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border font-bold flex items-center space-x-1"
              :class="getArchetypeTagColor(m.opponentArchetype)"
            >
              <component :is="getArchetypeIcon(m.opponentArchetype)" class="w-3 h-3 mr-1" />
              <span>{{ m.opponentArchetype }}</span>
            </span>

            <span class="text-[11px] text-slate-400 font-sans font-medium truncate max-w-[150px]">
              {{ m.opponentDeck }}
            </span>
          </div>

          <h3 class="text-base font-extrabold text-white tracking-tight">
            {{ m.name }}
          </h3>
          <p class="text-xs text-indigo-300 font-medium mt-0.5">
            {{ m.keyMetricName }}
          </p>
          <p class="text-[11px] text-slate-400 mt-1 leading-relaxed line-clamp-2">
            {{ m.metricDescription }}
          </p>
        </div>

        <!-- Metric Rates Comparison (A vs B) & Big Delta Badge -->
        <div class="my-4 pt-4 border-t border-slate-800/80">
          <div class="flex items-end justify-between mb-3">
            <!-- Rate A -->
            <div>
              <span class="text-[10px] font-mono text-slate-400 block uppercase">Variante A (Réf)</span>
              <span class="text-2xl font-black font-mono text-sky-400">
                {{ m.rateA.toFixed(1) }} %
              </span>
            </div>

            <!-- Big Delta Badge -->
            <div class="flex flex-col items-center">
              <span class="text-[10px] font-mono uppercase text-slate-500 mb-0.5">Impact Net</span>
              <div
                class="px-3 py-1 rounded-xl font-mono font-black text-sm border flex items-center space-x-1 shadow-md"
                :class="
                  m.delta > 0
                    ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-400 shadow-emerald-500/20'
                    : m.delta < 0
                      ? 'bg-rose-950/80 border-rose-500/80 text-rose-400 shadow-rose-500/20'
                      : 'bg-slate-800 border-slate-700 text-slate-300'
                "
              >
                <ArrowUpRight v-if="m.delta > 0" class="w-4 h-4 stroke-[3]" />
                <ArrowDownRight v-else-if="m.delta < 0" class="w-4 h-4 stroke-[3]" />
                <Minus v-else class="w-4 h-4" />
                <span>{{ m.badgeLabel }}</span>
              </div>
            </div>

            <!-- Rate B -->
            <div class="text-right">
              <span class="text-[10px] font-mono text-slate-400 block uppercase">Variante B (Test)</span>
              <span class="text-2xl font-black font-mono text-violet-400">
                {{ m.rateB.toFixed(1) }} %
              </span>
            </div>
          </div>

          <!-- Dual Visual Comparison Bar -->
          <div class="space-y-1.5">
            <!-- Bar A -->
            <div class="flex items-center space-x-2 text-[10px] font-mono">
              <span class="w-4 text-sky-400 font-bold">A</span>
              <div class="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  class="bg-sky-400 h-full rounded-full transition-all duration-500"
                  :style="{ width: `${Math.min(m.rateA, 100)}%` }"
                ></div>
              </div>
            </div>
            <!-- Bar B -->
            <div class="flex items-center space-x-2 text-[10px] font-mono">
              <span class="w-4 text-violet-400 font-bold">B</span>
              <div class="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  class="bg-violet-400 h-full rounded-full transition-all duration-500"
                  :style="{ width: `${Math.min(m.rateB, 100)}%` }"
                ></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer Callout -->
        <div class="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
          <span
            class="font-semibold flex items-center space-x-1"
            :class="
              m.favorableVariant === 'B'
                ? 'text-emerald-400'
                : m.favorableVariant === 'A'
                  ? 'text-rose-400'
                  : 'text-slate-400'
            "
          >
            <span>
              {{
                m.favorableVariant === 'B'
                  ? '⭐ Avantage Variante B'
                  : m.favorableVariant === 'A'
                    ? '⚠️ Variante A plus stable'
                    : 'Impact neutre'
              }}
            </span>
          </span>

          <span class="text-[10px] font-mono text-slate-500 flex items-center" :title="m.tooltip">
            <HelpCircle class="w-3 h-3 mr-1" />
            Détails
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
