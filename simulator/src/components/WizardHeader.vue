<script setup lang="ts">
defineProps<{
  currentStep: 1 | 2 | 3
  canGoStep2: boolean
  canGoStep3: boolean
  isDebugMode: boolean
  deckTotalCards: number
}>()

const emit = defineEmits<{
  (e: 'select-step', step: 1 | 2 | 3): void
}>()

const navSteps = [
  { num: 1 as const, label: '1. Mon Deck' },
  { num: 2 as const, label: '2. Matchups' },
  { num: 3 as const, label: '3. Résultats & Optimisation' },
]
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
    <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
      <!-- Identite de l'application -->
      <div class="flex items-center gap-3">
        <div
          class="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 font-bold text-white shadow-xs"
        >
          TCG
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              PokéSim
            </span>
            <span
              v-if="isDebugMode"
              class="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-800"
              title="Mode debug actif via ?debug=true"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
              Mode Debug
            </span>
          </div>
          <p class="text-xs text-slate-500">
            Simulateur stratégique &amp; comparateur de decks
          </p>
        </div>
      </div>

      <!-- Navigation par onglets simples et intuitifs -->
      <nav aria-label="Navigation des etapes" class="flex items-center gap-1 sm:gap-2">
        <button
          v-for="step in navSteps"
          :key="step.num"
          type="button"
          :disabled="(step.num === 2 && !canGoStep2) || (step.num === 3 && !canGoStep3)"
          @click="emit('select-step', step.num)"
          class="rounded-lg px-3 py-1.5 text-xs font-semibold transition"
          :class="[
            currentStep === step.num
              ? 'bg-slate-900 text-white shadow-xs'
              : (step.num === 2 && !canGoStep2) || (step.num === 3 && !canGoStep3)
                ? 'cursor-not-allowed text-slate-300'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
          ]"
        >
          {{ step.label }}
        </button>
      </nav>

      <!-- Compteur de cartes du Deck -->
      <div class="flex items-center gap-2">
        <div
          class="rounded-lg border px-3 py-1 text-xs font-semibold"
          :class="
            deckTotalCards === 60
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-amber-200 bg-amber-50 text-amber-700'
          "
        >
          Deck : {{ deckTotalCards }} / 60 cartes
        </div>
      </div>
    </div>
  </header>
</template>
