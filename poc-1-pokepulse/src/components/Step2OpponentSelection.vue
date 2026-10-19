<script setup lang="ts">
import type { OpponentId } from '../types/pokemon-tcg'
import { OPPONENT_OPTIONS } from '../data/opponents'
import { Check } from 'lucide-vue-next'

defineProps<{
  selectedOpponentId: OpponentId
}>()

const emit = defineEmits<{
  (e: 'select-opponent', id: OpponentId): void
  (e: 'previous-step'): void
  (e: 'submit-simulation'): void
}>()
</script>

<template>
  <div class="space-y-8 max-w-2xl mx-auto">
    <!-- Screen Header -->
    <div class="text-center space-y-1">
      <h2 class="text-2xl font-bold tracking-tight text-slate-900">
        Contre quel style de deck jouez-vous ?
      </h2>
      <p class="text-sm text-slate-500">
        Choisissez l'horloge ou la menace adverse que vous souhaitez tester.
      </p>
    </div>

    <!-- 4 Clickable White Cards -->
    <div class="space-y-3">
      <button
        v-for="opp in OPPONENT_OPTIONS"
        :key="opp.id"
        type="button"
        @click="emit('select-opponent', opp.id)"
        :class="[
          'w-full p-4 text-left rounded-xl border transition-all bg-white shadow-sm flex items-center justify-between',
          selectedOpponentId === opp.id
            ? 'border-blue-600 ring-2 ring-blue-600/20 bg-blue-50/20'
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
        ]"
      >
        <div class="space-y-1">
          <h3 class="font-bold text-sm sm:text-base text-slate-900">
            {{ opp.name }}
          </h3>
          <p class="text-xs sm:text-sm text-slate-500">
            {{ opp.shortDesc }}
          </p>
        </div>

        <span 
          v-if="selectedOpponentId === opp.id"
          class="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 ml-4"
        >
          <Check class="w-3 h-3 stroke-[3]" />
        </span>
        <span 
          v-else
          class="w-5 h-5 rounded-full border border-slate-200 shrink-0 ml-4"
        />
      </button>
    </div>

    <!-- Navigation Buttons -->
    <div class="flex items-center justify-between pt-2">
      <button
        type="button"
        @click="emit('previous-step')"
        class="px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 font-medium text-sm transition-colors shadow-sm"
      >
        ← Retour
      </button>

      <button
        type="button"
        @click="emit('submit-simulation')"
        class="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors shadow-sm flex items-center gap-2"
      >
        <span>Voir les résultats</span>
        <span>→</span>
      </button>
    </div>
  </div>
</template>
