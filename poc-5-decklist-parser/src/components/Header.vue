<script setup lang="ts">
import { Database, Sparkles, Layers, Code2 } from 'lucide-vue-next'

defineProps<{
  totalSets: number
  totalCards: number
  uniqueCards: number
}>()
</script>

<template>
  <header class="border-b border-slate-800/80 bg-slate-900/70 backdrop-blur-md sticky top-0 z-30">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div class="flex items-center gap-3.5">
        <div class="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-0.5 shadow-lg shadow-indigo-500/20">
          <div class="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
            <Code2 class="w-6 h-6 text-indigo-400" />
          </div>
        </div>
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-lg sm:text-xl font-bold tracking-tight text-white">
              PokéParser Studio
            </h1>
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              <Sparkles class="w-3 h-3" />
              POC #5
            </span>
          </div>
          <p class="text-xs sm:text-sm text-slate-400">
            Extracteur d'IDs TCGdex (<code class="text-indigo-300 font-mono">sv01-166</code>), modificateur de ratios & exportateur PTCGL
          </p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
        <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/70 text-slate-300">
          <Database class="w-3.5 h-3.5 text-emerald-400" />
          <span>Mapping TCGdex :</span>
          <strong class="text-white font-semibold">{{ totalSets }} extensions</strong>
        </div>

        <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/70 text-slate-300">
          <Layers class="w-3.5 h-3.5 text-indigo-400" />
          <span>Cartes uniques :</span>
          <strong class="text-white font-semibold">{{ uniqueCards }}</strong>
          <span class="text-slate-500">|</span>
          <strong
            :class="[
              'font-mono font-bold',
              totalCards === 60 ? 'text-emerald-400' : totalCards > 60 ? 'text-rose-400' : 'text-amber-400'
            ]"
          >
            {{ totalCards }}/60
          </strong>
        </div>
      </div>
    </div>
  </header>
</template>
