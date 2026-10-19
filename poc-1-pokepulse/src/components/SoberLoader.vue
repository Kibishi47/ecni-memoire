<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
</script>

<template>
  <div class="py-24 text-center space-y-3">
    <div class="flex justify-center">
      <Loader2 class="w-6 h-6 text-blue-600 animate-spin" />
    </div>
    <p class="text-sm font-medium text-slate-600">
      Analyse de 10 000 parties...
    </p>
  </div>
</template>
