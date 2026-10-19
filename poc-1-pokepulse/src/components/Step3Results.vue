<script setup lang="ts">
import { computed } from 'vue'
import type { SimplifiedResult } from '../types/pokemon-tcg'
import { CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-vue-next'

const props = defineProps<{
  result: SimplifiedResult
}>()

const emit = defineEmits<{
  (e: 'modify-test'): void
  (e: 'change-deck'): void
  (e: 'change-opponent'): void
}>()

const scoreBadgeStyle = computed(() => {
  const score = props.result.scorePercent
  if (score >= 75) {
    return {
      container: 'bg-emerald-50 border-emerald-200 text-emerald-900',
      badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      icon: CheckCircle2,
      scoreColor: 'text-emerald-700'
    }
  } else if (score >= 65) {
    return {
      container: 'bg-amber-50 border-amber-200 text-amber-900',
      badge: 'bg-amber-100 text-amber-800 border-amber-200',
      icon: AlertTriangle,
      scoreColor: 'text-amber-700'
    }
  }
  return {
    container: 'bg-red-50 border-red-200 text-red-900',
    badge: 'bg-red-100 text-red-800 border-red-200',
    icon: AlertCircle,
    scoreColor: 'text-red-700'
  }
})
</script>

<template>
  <div class="space-y-6 max-w-2xl mx-auto">
    <!-- Top Discrete Reminder & Edit Button -->
    <div class="flex items-center justify-between text-xs sm:text-sm text-slate-500 pb-2 border-b border-slate-200">
      <div>
        <span class="font-medium text-slate-900">Deck : {{ result.deckName }}</span>
        <span class="mx-1.5">•</span>
        <span>{{ result.opponentName }}</span>
      </div>

      <button
        type="button"
        @click="emit('modify-test')"
        class="text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1"
      >
        <span>← Modifier le test</span>
      </button>
    </div>

    <!-- BLOC 1 : LE VERDICT -->
    <div 
      :class="[
        'p-6 rounded-xl border shadow-sm transition-all space-y-3',
        scoreBadgeStyle.container
      ]"
    >
      <div class="flex items-baseline justify-between gap-3">
        <div class="flex items-center gap-2">
          <component :is="scoreBadgeStyle.icon" class="w-5 h-5 shrink-0" :class="scoreBadgeStyle.scoreColor" />
          <span class="text-xs font-bold uppercase tracking-wider opacity-75">
            Verdict de Stabilité
          </span>
        </div>
        <span class="text-3xl font-extrabold tracking-tight" :class="scoreBadgeStyle.scoreColor">
          {{ result.scorePercent }} %
        </span>
      </div>

      <div class="text-base sm:text-lg font-bold leading-snug">
        {{ result.scorePercent }} % de sorties réussies
      </div>

      <p class="text-sm opacity-90 leading-relaxed font-normal">
        "{{ result.verdictSentence }}"
      </p>
    </div>

    <!-- BLOC 2 : LES 3 CHIFFRES CLÉS CÔTE À CÔTE -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <!-- Chiffre 1 -->
      <div class="p-4 rounded-xl bg-white border border-slate-200 shadow-sm text-center space-y-1">
        <span class="text-xs font-medium text-slate-500">
          Départ réussi (Tour 1)
        </span>
        <div class="text-2xl font-bold text-slate-900">
          {{ result.turn1ReadyPercent }} %
        </div>
      </div>

      <!-- Chiffre 2 -->
      <div class="p-4 rounded-xl bg-white border border-slate-200 shadow-sm text-center space-y-1">
        <span class="text-xs font-medium text-slate-500">
          Attaque prête (Tour 2)
        </span>
        <div class="text-2xl font-bold text-slate-900">
          {{ result.turn2AttackPercent }} %
        </div>
      </div>

      <!-- Chiffre 3 -->
      <div class="p-4 rounded-xl bg-white border border-slate-200 shadow-sm text-center space-y-1">
        <span class="text-xs font-medium text-slate-500">
          Risque de main morte
        </span>
        <div 
          :class="[
            'text-2xl font-bold',
            result.brickRiskPercent > 12 ? 'text-amber-600' : 'text-slate-900'
          ]"
        >
          {{ result.brickRiskPercent }} %
        </div>
      </div>
    </div>

    <!-- BLOC 3 : POURQUOI LE DECK BLOQUE ? -->
    <div class="p-5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-4">
      <h3 class="text-sm font-bold text-slate-900">
        Pourquoi le deck bloque ?
      </h3>

      <div class="space-y-3.5">
        <div 
          v-for="(cause, index) in result.failureCauses" 
          :key="index"
          class="space-y-1.5"
        >
          <div class="flex items-center justify-between text-xs">
            <span class="font-medium text-slate-700">{{ cause.label }}</span>
            <span class="font-semibold text-slate-900">{{ cause.percent }} %</span>
          </div>

          <!-- Clean Horizontal Bar -->
          <div class="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
            <div 
              class="h-full rounded-full transition-all duration-500"
              :class="[
                index === 0 ? 'bg-blue-600' :
                index === 1 ? 'bg-slate-500' : 'bg-slate-400'
              ]"
              :style="{ width: `${cause.percent}%` }"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Action Navigation Footer -->
    <div class="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3">
      <button
        type="button"
        @click="emit('change-opponent')"
        class="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium text-xs sm:text-sm transition-colors shadow-sm"
      >
        Tester un autre adversaire
      </button>

      <button
        type="button"
        @click="emit('change-deck')"
        class="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs sm:text-sm transition-colors shadow-sm"
      >
        Tester un autre deck
      </button>
    </div>
  </div>
</template>
