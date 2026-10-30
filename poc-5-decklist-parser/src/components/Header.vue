<script setup lang="ts">
import { Database, Layers, Code2 } from 'lucide-vue-next'

defineProps<{
  totalSets: number
  totalCards: number
  uniqueCards: number
}>()
</script>

<template>
  <header class="bg-white border-b border-slate-200 sticky top-0 z-30">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <!-- Logo & App Title -->
      <div class="flex items-center space-x-3">
        <div class="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shrink-0">
          <Code2 class="w-5 h-5" />
        </div>
        <div>
          <div class="flex items-center space-x-2">
            <h1 class="font-bold text-base text-slate-900 tracking-tight">
              PokéParser Studio
            </h1>
            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
              POC #5
            </span>
          </div>
          <p class="text-xs text-slate-500 hidden sm:block">
            Extracteur d'IDs TCGdex (<code class="font-mono text-slate-700">sv01-166</code>), modificateur de ratios & exportateur PTCGL
          </p>
        </div>
      </div>

      <!-- Quick status badges -->
      <div class="flex items-center space-x-2 sm:space-x-3 text-xs">
        <div class="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 font-medium">
          <Database class="w-3.5 h-3.5 text-blue-600" />
          <span>{{ totalSets }} extensions TCGdex</span>
        </div>

        <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 font-medium">
          <Layers class="w-3.5 h-3.5 text-slate-500" />
          <span>{{ uniqueCards }} cartes</span>
          <span class="text-slate-300">•</span>
          <span
            :class="[
              'font-mono font-bold',
              totalCards === 60 ? 'text-emerald-600' : totalCards > 60 ? 'text-rose-600' : 'text-amber-600'
            ]"
          >
            {{ totalCards }}/60
          </span>
        </div>
      </div>
    </div>
  </header>
</template>
