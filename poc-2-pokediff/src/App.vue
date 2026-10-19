<script setup lang="ts">
import { ref } from 'vue'

const title = ref('PokéDiff Matchup Comparator')
</script>

<template>
  <div class="min-h-screen p-6 bg-slate-950 text-slate-100">
    <h1 class="text-2xl font-bold text-sky-400">{{ title }}</h1>
  </div>
</template>
