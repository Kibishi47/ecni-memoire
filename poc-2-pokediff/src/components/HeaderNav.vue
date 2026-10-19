<script setup lang="ts">
import { Sparkles, Dna, RotateCcw, Eye, ShieldCheck } from 'lucide-vue-next'

defineProps<{
  deckACount: number
  deckBCount: number
  isValid: boolean
  seed: number
  simCount: number
}>()

defineEmits<{
  (e: 'reset'): void
  (e: 'open-inspector'): void
}>()
</script>

<template>
  <header class="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 shadow-lg">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <!-- Title & Branding -->
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 via-indigo-500 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-500/20 ring-1 ring-white/20">
          <Dna class="w-5 h-5 text-white" />
        </div>
        <div>
          <div class="flex items-center space-x-2">
            <span class="font-extrabold text-lg tracking-tight bg-gradient-to-r from-sky-400 via-indigo-300 to-violet-400 bg-clip-text text-transparent">
              PokéDiff
            </span>
            <span class="text-xs font-mono px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-700/50 text-indigo-300 font-medium">
              Matchup Comparator
            </span>
            <span class="hidden md:inline-flex items-center text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              <Sparkles class="w-3 h-3 text-amber-400 mr-1" />
              Piste 2 : Wizard of Oz POC
            </span>
          </div>
          <p class="text-xs text-slate-400 hidden sm:block">
            Comparateur différentiel A/B de micro-ajustements Pokémon TCG (Same-Seed 10 000 tirages)
          </p>
        </div>
      </div>

      <!-- Live Engine Badges & Controls -->
      <div class="flex items-center space-x-2 sm:space-x-3">
        <!-- Deck size pill -->
        <div class="hidden sm:flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-slate-800/80 border border-slate-700/80 text-xs font-mono">
          <span class="flex items-center text-sky-400 font-semibold">
            <span class="w-2 h-2 rounded-full bg-sky-400 mr-1.5"></span>
            A: {{ deckACount }}/60
          </span>
          <span class="text-slate-500">|</span>
          <span
            class="flex items-center font-semibold"
            :class="isValid ? 'text-violet-400' : 'text-rose-400 animate-pulse'"
          >
            <span
              class="w-2 h-2 rounded-full mr-1.5"
              :class="isValid ? 'bg-violet-400' : 'bg-rose-400'"
            ></span>
            B: {{ deckBCount }}/60
          </span>
        </div>

        <!-- Same-Seed Inspector Trigger -->
        <button
          @click="$emit('open-inspector')"
          type="button"
          class="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 text-slate-200 transition shadow-sm"
          title="Voir des tirages couplés concrets"
        >
          <Eye class="w-3.5 h-3.5 text-indigo-400" />
          <span class="hidden md:inline">Inspecteur de Graines</span>
        </button>

        <!-- Reset Button -->
        <button
          @click="$emit('reset')"
          type="button"
          class="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition"
          title="Réinitialiser la variante B sur la référence A"
        >
          <RotateCcw class="w-3.5 h-3.5" />
          <span class="hidden sm:inline">Réinitialiser (A = B)</span>
        </button>

        <!-- Seed indicator -->
        <div class="hidden lg:flex items-center space-x-1 px-2.5 py-1 rounded-md bg-indigo-950/40 border border-indigo-900/60 text-[11px] font-mono text-indigo-300">
          <ShieldCheck class="w-3.5 h-3.5 text-emerald-400" />
          <span>Seed: #{{ seed.toString(16).toUpperCase() }}</span>
        </div>
      </div>
    </div>
  </header>
</template>
