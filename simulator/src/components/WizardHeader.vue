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
  (e: 'toggle-debug'): void
}>()

const steps = [
  {
    num: 1 as const,
    title: 'Import & Validation',
    subtitle: 'Decklist PTCGL (60 cartes)',
  },
  {
    num: 2 as const,
    title: 'Paramètres & Matchups',
    subtitle: 'Branches, Tours & Adversaires',
  },
  {
    num: 3 as const,
    title: 'Résultats & Atelier A/B',
    subtitle: 'KPIs, Comparateur & Export',
  },
]
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
    <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
      <!-- Identité du Simulateur -->
      <div class="flex items-center gap-3">
        <div
          class="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-900 font-mono text-sm font-bold text-white shadow-sm"
        >
          TCG
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              PokéSim Studio
            </h1>
            <span
              class="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600"
            >
              3-Ply Engine v1.0
            </span>
            <span
              v-if="isDebugMode"
              class="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-800"
              title="Paramètres et inspecteur granulaire débloqués via ?debug=true"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
              ?debug=true ACTIF
            </span>
          </div>
          <p class="text-xs text-slate-500">
            Simulateur Monte-Carlo Multi-Workers &amp; Évaluateur d'Arbre 3-Ply (T → T_adv → T+1)
          </p>
        </div>
      </div>

      <!-- Stepper Wizard -->
      <nav aria-label="Étapes du simulateur" class="flex items-center gap-1.5 sm:gap-2">
        <template v-for="(step, idx) in steps" :key="step.num">
          <button
            type="button"
            :disabled="
              (step.num === 2 && !canGoStep2) || (step.num === 3 && !canGoStep3)
            "
            @click="emit('select-step', step.num)"
            class="group flex items-center gap-2.5 rounded-lg border px-3 py-1.5 text-left transition-all"
            :class="[
              currentStep === step.num
                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                : (step.num === 2 && !canGoStep2) || (step.num === 3 && !canGoStep3)
                  ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 opacity-60'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
            ]"
          >
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full font-mono text-xs font-bold"
              :class="[
                currentStep === step.num
                  ? 'bg-white text-slate-900'
                  : 'bg-slate-100 text-slate-700',
              ]"
            >
              {{ step.num }}
            </span>
            <div class="hidden md:block">
              <div class="text-xs font-semibold leading-tight">{{ step.title }}</div>
              <div
                class="text-[10px] leading-tight"
                :class="currentStep === step.num ? 'text-slate-300' : 'text-slate-400'"
              >
                {{ step.subtitle }}
              </div>
            </div>
          </button>
          <span v-if="idx < steps.length - 1" class="text-xs text-slate-300">›</span>
        </template>
      </nav>

      <!-- Indicateur 60 cartes & Raccourci Mode Debug -->
      <div class="flex items-center gap-2">
        <div
          class="rounded-lg border px-2.5 py-1 font-mono text-xs font-semibold"
          :class="
            deckTotalCards === 60
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-amber-200 bg-amber-50 text-amber-700'
          "
        >
          Deck : {{ deckTotalCards }} / 60
        </div>

        <button
          type="button"
          @click="emit('toggle-debug')"
          class="rounded-lg border px-2.5 py-1 font-mono text-xs font-medium transition-colors"
          :class="
            isDebugMode
              ? 'border-amber-300 bg-amber-100/80 text-amber-900 hover:bg-amber-200/70'
              : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300 hover:text-slate-700'
          "
          title="Basculer le paramètre URL ?debug=true"
        >
          {{ isDebugMode ? 'Debug: ON' : '?debug=true' }}
        </button>
      </div>
    </div>
  </header>
</template>
