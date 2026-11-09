<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../utils/i18n'

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

const { currentLang, setLanguage, t } = useI18n()

const navSteps = computed(() => [
  { num: 1 as const, label: t('step1Short') },
  { num: 2 as const, label: t('step2Short') },
  { num: 3 as const, label: t('step3Short') },
])
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
    <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
      <!-- Identité de l'application -->
      <div class="flex items-center gap-3">
        <div
          class="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 font-bold text-white shadow-xs"
        >
          TCG
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              {{ t('appTitle') }}
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
            {{ t('appSubtitle') }}
          </p>
        </div>
      </div>

      <!-- Navigation par étapes -->
      <nav aria-label="Navigation des étapes" class="flex items-center gap-1 sm:gap-2">
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

      <!-- Contrôles droits : Sélecteur de langue & Compteur de cartes -->
      <div class="flex items-center gap-3">
        <!-- Bouton Sélecteur de Langue FR / EN -->
        <div class="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-bold">
          <button
            type="button"
            @click="setLanguage('fr')"
            class="rounded-md px-2 py-1 transition"
            :class="currentLang === 'fr' ? 'bg-slate-900 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'"
          >
            FR
          </button>
          <button
            type="button"
            @click="setLanguage('en')"
            class="rounded-md px-2 py-1 transition"
            :class="currentLang === 'en' ? 'bg-slate-900 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'"
          >
            EN
          </button>
        </div>

        <!-- Compteur de cartes du Deck -->
        <div
          class="rounded-lg border px-3 py-1 text-xs font-semibold"
          :class="
            deckTotalCards === 60
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-amber-200 bg-amber-50 text-amber-700'
          "
        >
          {{ deckTotalCards }} / 60
        </div>
      </div>
    </div>
  </header>
</template>
