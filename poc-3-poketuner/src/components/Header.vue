<script setup lang="ts">
import { Cpu, BookOpen, Layers } from 'lucide-vue-next'

defineProps<{
  activeArchetypeTitle: string
}>()
</script>

<template>
  <header class="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <!-- Left: Logo & Engine Identification -->
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20 ring-1 ring-amber-400/30">
          <Cpu class="w-5 h-5 text-slate-950 stroke-[2.5]" />
        </div>
        <div>
          <div class="flex items-center space-x-2">
            <h1 class="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              PokéTuner <span class="text-amber-400 font-mono text-base">Engine</span>
            </h1>
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 font-mono">
              POC v1.4
            </span>
          </div>
          <p class="text-xs text-slate-400 flex items-center space-x-1.5 hidden sm:flex">
            <span>Optimiseur combinatoire des ratios sous contrainte du métagame</span>
          </p>
        </div>
      </div>

      <!-- Center: Active Archetype Badge -->
      <div class="hidden md:flex items-center space-x-2 bg-slate-900/90 border border-slate-800 rounded-full px-3.5 py-1 text-xs">
        <Layers class="w-3.5 h-3.5 text-cyan-400" />
        <span class="text-slate-400">Archétype actif :</span>
        <span class="font-semibold text-slate-200">{{ activeArchetypeTitle }}</span>
      </div>

      <!-- Right: Engine Status & Standard Meta Badge -->
      <div class="flex items-center space-x-3">
        <div class="flex items-center space-x-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span class="text-slate-300 font-medium">Heuristique Go</span>
          <span class="text-slate-500 hidden sm:inline">|</span>
          <span class="text-amber-400/90 hidden sm:inline">Monte-Carlo</span>
        </div>

        <div class="hidden lg:flex items-center space-x-1.5 bg-slate-900/60 border border-slate-800/80 px-2.5 py-1.5 rounded-lg text-xs text-slate-400">
          <BookOpen class="w-3.5 h-3.5 text-slate-400" />
          <span>SV6 Twilight Masquerade</span>
        </div>
      </div>
    </div>
  </header>
</template>
