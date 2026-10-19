<script setup lang="ts">
import type { BrickBreakdown } from '../types/pokemon-tcg'
import { 
  Search, 
  Flame, 
  Gift, 
  Skull,
  PieChart
} from 'lucide-vue-next'

defineProps<{
  breakdown: BrickBreakdown
  totalBrickRate: number
}>()
</script>

<template>
  <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl space-y-5">
    <!-- Header -->
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <span class="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <PieChart class="w-4 h-4" />
        </span>
        <div>
          <h3 class="text-base font-bold text-slate-100">
            Diagnostic des Causes d'Échec (Breakdown des Bricks)
          </h3>
          <p class="text-xs text-slate-400 mt-0.5">
            Répartition des facteurs limitants sur l'ensemble des parties simulées ayant échoué.
          </p>
        </div>
      </div>

      <span class="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-slate-950 border border-slate-800 text-slate-300">
        Cumul Bricks : <span class="text-rose-400 font-bold">{{ totalBrickRate }}%</span>
      </span>
    </div>

    <!-- 4 Diagnostic Factors -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Factor 1: Manque de Pokémon de Base -->
      <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
        <div class="flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <span class="p-1 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Search class="w-3.5 h-3.5" />
            </span>
            <span class="font-bold text-slate-200">Manque de Pokémon de Base</span>
          </div>
          <span class="font-mono font-bold text-cyan-400 text-sm">
            {{ breakdown.missingBasics }}%
          </span>
        </div>
        
        <div class="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
          <div 
            class="h-full bg-cyan-400 rounded-full transition-all duration-500"
            :style="{ width: `${Math.min(100, breakdown.missingBasics * 5)}%` }"
          />
        </div>
        <p class="text-[11px] text-slate-400 leading-tight">
          Poffin Pote-Pote / Faiblo Ball non piochés ou banc insuffisant pour encaisser le premier tour.
        </p>
      </div>

      <!-- Factor 2: Sécheresse d'Énergie -->
      <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
        <div class="flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <span class="p-1 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Flame class="w-3.5 h-3.5" />
            </span>
            <span class="font-bold text-slate-200">Sécheresse d'Énergie</span>
          </div>
          <span class="font-mono font-bold text-amber-400 text-sm">
            {{ breakdown.energyDrought }}%
          </span>
        </div>
        
        <div class="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
          <div 
            class="h-full bg-amber-400 rounded-full transition-all duration-500"
            :style="{ width: `${Math.min(100, breakdown.energyDrought * 5)}%` }"
          />
        </div>
        <p class="text-[11px] text-slate-400 leading-tight">
          Attachement manuel raté au Tour 1 ou Tour 2 retardant l'offensive.
        </p>
      </div>

      <!-- Factor 3: Pièces maîtresses bloquées en Récompenses -->
      <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
        <div class="flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <span class="p-1 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Gift class="w-3.5 h-3.5" />
            </span>
            <span class="font-bold text-slate-200">Pièces Clés Prized (6 Récompenses)</span>
          </div>
          <span class="font-mono font-bold text-purple-400 text-sm">
            {{ breakdown.prizedPieces }}%
          </span>
        </div>
        
        <div class="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
          <div 
            class="h-full bg-purple-400 rounded-full transition-all duration-500"
            :style="{ width: `${Math.min(100, breakdown.prizedPieces * 5)}%` }"
          />
        </div>
        <p class="text-[11px] text-slate-400 leading-tight">
          2+ Super Bonbon ou attaquants pivots séquestrés dans les 6 cartes Récompenses initiales.
        </p>
      </div>

      <!-- Factor 4: Asphyxie post-Mashynn T3 -->
      <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
        <div class="flex items-center justify-between text-xs">
          <div class="flex items-center gap-2">
            <span class="p-1 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <Skull class="w-3.5 h-3.5" />
            </span>
            <span class="font-bold text-slate-200">Asphyxie post-Disruption T3</span>
          </div>
          <span class="font-mono font-bold text-rose-400 text-sm">
            {{ breakdown.postDisruption }}%
          </span>
        </div>
        
        <div class="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
          <div 
            class="h-full bg-rose-500 rounded-full transition-all duration-500"
            :style="{ width: `${Math.min(100, breakdown.postDisruption * 5)}%` }"
          />
        </div>
        <p class="text-[11px] text-slate-400 leading-tight">
          Effondrement de la main suite à une Mashynn ou un Tampon Injuste subi au Tour 3 sans moteur passif sur table.
        </p>
      </div>
    </div>
  </div>
</template>
