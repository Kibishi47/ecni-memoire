<script setup lang="ts">
import { SlidersHorizontal, CheckCircle2 } from 'lucide-vue-next'
import { SCENARIOS } from '../data/scenarios'
import type { ScenarioPreset } from '../types/deck'

defineProps<{
  activeScenarioId: string | null
}>()

const emit = defineEmits<{
  (e: 'select-scenario', scenario: ScenarioPreset): void
  (e: 'select-baseline'): void
}>()
</script>

<template>
  <div class="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-sm">
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
      <div>
        <div class="flex items-center space-x-2">
          <SlidersHorizontal class="w-5 h-5 text-indigo-400" />
          <h2 class="text-base font-bold text-slate-100 uppercase tracking-wider text-xs">
            Dilemmes du Vendredi Soir (Presets A/B Pré-configurés)
          </h2>
        </div>
        <p class="text-xs text-slate-400 mt-0.5">
          Sélectionnez un scénario d'arbitrage compétitif classique ou modifiez manuellement les cartes dans l'éditeur ci-dessous.
        </p>
      </div>

      <!-- Baseline Reset Pill -->
      <button
        @click="emit('select-baseline')"
        type="button"
        class="inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition"
        :class="
          activeScenarioId === 'baseline'
            ? 'bg-slate-800 border-sky-400/60 text-sky-300 ring-2 ring-sky-500/20'
            : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
        "
      >
        <span class="w-2 h-2 rounded-full" :class="activeScenarioId === 'baseline' ? 'bg-sky-400' : 'bg-slate-500'"></span>
        <span>Baseline Référence (A = B)</span>
      </button>
    </div>

    <!-- 3 Preset Buttons Grid -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <!-- Scenario 1 -->
      <div
        @click="emit('select-scenario', SCENARIOS[0])"
        class="relative group rounded-xl p-4 border cursor-pointer transition-all duration-200 text-left flex flex-col justify-between"
        :class="
          activeScenarioId === SCENARIOS[0].id
            ? 'bg-gradient-to-br from-indigo-950/70 to-slate-900 border-indigo-500 shadow-lg shadow-indigo-500/10 ring-2 ring-indigo-500/30'
            : 'bg-slate-900/60 hover:bg-slate-800/80 border-slate-800 hover:border-slate-700'
        "
      >
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold bg-emerald-950/80 border border-emerald-700/60 text-emerald-400">
              {{ SCENARIOS[0].tag }}
            </span>
            <CheckCircle2
              v-if="activeScenarioId === SCENARIOS[0].id"
              class="w-4 h-4 text-emerald-400"
            />
          </div>
          <h3 class="text-sm font-bold text-slate-100 group-hover:text-sky-300 transition-colors">
            1. Stabilité T1 vs Puissance Fin
          </h3>
          <p class="text-xs text-slate-400 mt-1 line-clamp-2">
            Renforce les sorties T1 contre l'Aggro au détriment d'un Ordre du Boss et d'une Énergie.
          </p>
        </div>

        <div class="mt-3 pt-3 border-t border-slate-800/80 font-mono text-[11px] space-y-1">
          <div class="flex items-center text-rose-400 font-medium">
            <span class="w-3.5 text-center mr-1">−</span>
            <span>1 Ordres du Boss, 1 Énergie Feu</span>
          </div>
          <div class="flex items-center text-emerald-400 font-medium">
            <span class="w-3.5 text-center mr-1">+</span>
            <span>1 Poffin Pote-Pote, 1 Faiblo Ball</span>
          </div>
        </div>
      </div>

      <!-- Scenario 2 -->
      <div
        @click="emit('select-scenario', SCENARIOS[1])"
        class="relative group rounded-xl p-4 border cursor-pointer transition-all duration-200 text-left flex flex-col justify-between"
        :class="
          activeScenarioId === SCENARIOS[1].id
            ? 'bg-gradient-to-br from-indigo-950/70 to-slate-900 border-indigo-500 shadow-lg shadow-indigo-500/10 ring-2 ring-indigo-500/30'
            : 'bg-slate-900/60 hover:bg-slate-800/80 border-slate-800 hover:border-slate-700'
        "
      >
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold bg-amber-950/80 border border-amber-700/60 text-amber-400">
              {{ SCENARIOS[1].tag }}
            </span>
            <CheckCircle2
              v-if="activeScenarioId === SCENARIOS[1].id"
              class="w-4 h-4 text-emerald-400"
            />
          </div>
          <h3 class="text-sm font-bold text-slate-100 group-hover:text-amber-300 transition-colors">
            2. Accélération vs Régularité
          </h3>
          <p class="text-xs text-slate-400 mt-1 line-clamp-2">
            Maximise le combo Arven + Super Bonbon T2 en réduisant la pioche brute de Recherche.
          </p>
        </div>

        <div class="mt-3 pt-3 border-t border-slate-800/80 font-mono text-[11px] space-y-1">
          <div class="flex items-center text-rose-400 font-medium">
            <span class="w-3.5 text-center mr-1">−</span>
            <span>1 Recherche Prof., 1 Hyper Ball</span>
          </div>
          <div class="flex items-center text-emerald-400 font-medium">
            <span class="w-3.5 text-center mr-1">+</span>
            <span>1 Arven, 1 Super Bonbon</span>
          </div>
        </div>
      </div>

      <!-- Scenario 3 -->
      <div
        @click="emit('select-scenario', SCENARIOS[2])"
        class="relative group rounded-xl p-4 border cursor-pointer transition-all duration-200 text-left flex flex-col justify-between"
        :class="
          activeScenarioId === SCENARIOS[2].id
            ? 'bg-gradient-to-br from-indigo-950/70 to-slate-900 border-indigo-500 shadow-lg shadow-indigo-500/10 ring-2 ring-indigo-500/30'
            : 'bg-slate-900/60 hover:bg-slate-800/80 border-slate-800 hover:border-slate-700'
        "
      >
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold bg-purple-950/80 border border-purple-700/60 text-purple-400">
              {{ SCENARIOS[2].tag }}
            </span>
            <CheckCircle2
              v-if="activeScenarioId === SCENARIOS[2].id"
              class="w-4 h-4 text-emerald-400"
            />
          </div>
          <h3 class="text-sm font-bold text-slate-100 group-hover:text-purple-300 transition-colors">
            3. Tech Anti-Contrôle & Stall
          </h3>
          <p class="text-xs text-slate-400 mt-1 line-clamp-2">
            Sauve Motisma/Luminéon du lock actif avec Turo et double la Civière Nocturne.
          </p>
        </div>

        <div class="mt-3 pt-3 border-t border-slate-800/80 font-mono text-[11px] space-y-1">
          <div class="flex items-center text-rose-400 font-medium">
            <span class="w-3.5 text-center mr-1">−</span>
            <span>1 Mashynn, 1 Énergie Feu</span>
          </div>
          <div class="flex items-center text-emerald-400 font-medium">
            <span class="w-3.5 text-center mr-1">+</span>
            <span>1 Civière Nocturne, 1 Plan Turo</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
