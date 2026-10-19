<script setup lang="ts">
import { ref } from 'vue'

const title = ref('PokéTuner Engine')
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 p-8">
    <h1 class="text-3xl font-bold text-amber-500">{{ title }}</h1>
    <p class="text-slate-400 mt-2">Optimiseur combinatoire des ratios de deck sous contrainte du métagame de salle</p>
  </div>
</template>
