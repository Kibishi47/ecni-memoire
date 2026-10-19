<script setup lang="ts">
import { ref } from 'vue'

const title = ref('PokéPulse Arena')
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
    <div class="text-center">
      <h1 class="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-emerald-400">
        {{ title }}
      </h1>
      <p class="text-slate-400 mt-2">Banc d'essai décisionnel Pokémon TCG</p>
    </div>
  </div>
</template>
