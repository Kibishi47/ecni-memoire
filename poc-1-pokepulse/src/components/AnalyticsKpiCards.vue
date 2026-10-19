<script setup lang="ts">
import { computed } from 'vue'
import type { SimulationResult } from '../types/pokemon-tcg'
import { 
  ShieldCheck, 
  Target, 
  AlertOctagon, 
  RotateCcw, 
  ArrowUpRight, 
  ArrowDownRight,
  TrendingUp,
  Gift
} from 'lucide-vue-next'

const props = defineProps<{
  result: SimulationResult
}>()

const getScoreColor = (score: number) => {
  if (score >= 80) return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'
  if (score >= 70) return 'text-amber-400 border-amber-500/40 bg-amber-500/10'
  return 'text-rose-400 border-rose-500/40 bg-rose-500/10'
}

const getScoreRingStroke = (score: number) => {
  if (score >= 80) return '#10b981'
  if (score >= 70) return '#f59e0b'
  return '#f43f5e'
}

const circumference = 2 * Math.PI * 34 // radius 34
const strokeDashoffset = computed(() => {
  const percent = Math.min(100, Math.max(0, props.result.consistencyScore))
  return circumference - (percent / 100) * circumference
})
</script>

<template>
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    <!-- KPI 1: Score de Régularité Sous Pression -->
    <div class="relative bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 shadow-lg flex flex-col justify-between overflow-hidden transition-all duration-300">
      <div class="flex items-start justify-between gap-3">
        <div>
          <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Score de Régularité
          </span>
          <div class="flex items-baseline gap-2 mt-1">
            <span class="text-3xl font-black text-white tracking-tight">
              {{ result.consistencyScore }}%
            </span>
            <span 
              :class="[
                'text-[11px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-0.5',
                getScoreColor(result.consistencyScore)
              ]"
            >
              <TrendingUp class="w-3 h-3" />
              <span>Sous pression</span>
            </span>
          </div>
          <p class="text-[11px] text-slate-400 mt-1.5 leading-snug">
            Probabilité d'exécuter la boucle de jeu principale face à l'horloge adverse.
          </p>
        </div>

        <!-- Radial progress ring -->
        <div class="relative w-16 h-16 shrink-0 flex items-center justify-center">
          <svg class="w-full h-full -rotate-90" viewBox="0 0 80 80">
            <circle
              cx="40"
              cy="40"
              r="34"
              stroke="#1e293b"
              stroke-width="6"
              fill="transparent"
            />
            <circle
              cx="40"
              cy="40"
              r="34"
              :stroke="getScoreRingStroke(result.consistencyScore)"
              stroke-width="6"
              stroke-linecap="round"
              fill="transparent"
              :stroke-dasharray="circumference"
              :stroke-dashoffset="strokeDashoffset"
              class="transition-all duration-700 ease-out"
            />
          </svg>
          <div class="absolute inset-0 flex items-center justify-center">
            <ShieldCheck class="w-5 h-5 text-indigo-400" />
          </div>
        </div>
      </div>

      <div class="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
        <span class="text-slate-500">Benchmark méta :</span>
        <span class="font-mono font-semibold text-slate-300">Moyenne 75.0%</span>
      </div>
    </div>

    <!-- KPI 2: Probabilité de Setup Idéal Tour 2 -->
    <div class="bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 shadow-lg flex flex-col justify-between transition-all duration-300">
      <div>
        <div class="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          <span>Setup Idéal Tour 2</span>
          <span class="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Target class="w-3.5 h-3.5" />
          </span>
        </div>

        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-3xl font-black text-indigo-400 tracking-tight">
            {{ result.idealSetupT2Rate }}%
          </span>
          <span class="text-xs font-semibold text-slate-400">
            (±0.4%)
          </span>
        </div>

        <p class="text-[11px] text-slate-400 mt-2 leading-snug">
          Parties où le banc clé et la 1ère attaque ou évolution sont verrouillés au T2.
        </p>
      </div>

      <div class="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
        <span class="text-slate-500">Seuil compétitif :</span>
        <span class="font-mono font-semibold text-emerald-400">> 70.0% requis</span>
      </div>
    </div>

    <!-- KPI 3: Taux de Main Morte / Brick T1 -->
    <div class="bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 shadow-lg flex flex-col justify-between transition-all duration-300">
      <div>
        <div class="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          <span>Main Morte / Brick T1</span>
          <span class="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertOctagon class="w-3.5 h-3.5" />
          </span>
        </div>

        <div class="flex items-baseline gap-2 mt-2">
          <span 
            :class="[
              'text-3xl font-black tracking-tight',
              result.t1BrickRate > 15 ? 'text-rose-400' : 'text-amber-400'
            ]"
          >
            {{ result.t1BrickRate }}%
          </span>
          <span 
            v-if="result.t1BrickRate > 12" 
            class="text-[11px] font-bold text-rose-400 flex items-center"
          >
            <ArrowUpRight class="w-3 h-3" /> Risque
          </span>
          <span v-else class="text-[11px] font-bold text-emerald-400 flex items-center">
            <ArrowDownRight class="w-3 h-3" /> Faible
          </span>
        </div>

        <p class="text-[11px] text-slate-400 mt-2 leading-snug">
          Passer son Tour 1 sans poser de second Pokémon ni jouer de tuteur de recherche.
        </p>
      </div>

      <div class="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
        <span class="text-slate-500">Taux acceptable :</span>
        <span class="font-mono font-semibold text-slate-300">< 12.0%</span>
      </div>
    </div>

    <!-- KPI 4: Taux de Mulligan Forcé -->
    <div class="bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 shadow-lg flex flex-col justify-between transition-all duration-300">
      <div>
        <div class="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          <span>Mulligan Forcé</span>
          <span class="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <RotateCcw class="w-3.5 h-3.5" />
          </span>
        </div>

        <div class="flex items-baseline gap-2 mt-2">
          <span class="text-3xl font-black text-purple-400 tracking-tight">
            {{ result.forcedMulliganRate }}%
          </span>
          <span class="text-xs font-semibold text-slate-400">
            (0 base en main)
          </span>
        </div>

        <div class="mt-2 flex items-center gap-1.5 text-[11px] text-slate-300 bg-slate-950/70 p-2 rounded-lg border border-slate-800">
          <Gift class="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Cartes offertes : <strong class="text-amber-400 font-mono">+{{ result.avgMulligansGifted }}</strong> / match</span>
        </div>
      </div>

      <div class="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
        <span class="text-slate-500">Calcul Hypergéométrique :</span>
        <span class="font-mono font-semibold text-slate-300">Exact</span>
      </div>
    </div>
  </div>
</template>
