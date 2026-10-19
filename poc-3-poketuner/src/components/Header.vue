<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'
</script>

<template>
  <header class="bg-white border-b border-slate-200 sticky top-0 z-30">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
      <!-- Logo & title -->
      <div class="flex items-center space-x-3">
        <div class="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm">
          <Sparkles class="w-5 h-5" />
        </div>
        <div>
          <div class="flex items-center space-x-2">
            <h1 class="font-bold text-lg text-slate-900 tracking-tight">
              PokéTuner
            </h1>
            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
              Assistant Ratios
            </span>
          </div>
          <p class="text-xs text-slate-500 hidden sm:block">
            Calculez la composition idéale de votre deck Pokémon
          </p>
        </div>
      </div>

      <!-- Quick help note -->
      <div class="text-xs text-slate-500 font-medium">
        Format Standard SV6
      </div>
    </div>
  </header>
</template>
