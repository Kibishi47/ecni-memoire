<script setup lang="ts">
import { computed } from 'vue'
import { Bug, Database } from 'lucide-vue-next'
import { isUsingOfflineCatalog } from '../services/apiClient'
import { useI18n } from '../utils/i18n'

defineProps<{
  currentStep: 1 | 2 | 3
  canGoStep2: boolean
  canGoStep3: boolean
  deckTotalCards: number
  isDebugMode?: boolean
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
  <div
    class="border-b backdrop-blur"
    style="background-color: var(--bg-surface); border-color: var(--border-subtle)"
  >
    <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
      <!-- Identité du Laboratoire de Simulation -->
      <div class="flex items-center gap-3">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-black tracking-tight sm:text-base mo-gradient-text">
              {{ t('appTitle') }}
            </span>
            <span
              v-if="isDebugMode"
              class="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold"
              style="
                border-color: rgba(245, 158, 11, 0.45);
                background-color: rgba(245, 158, 11, 0.14);
                color: var(--brand-gold);
              "
              title="Mode debug actif via ?debug=true"
            >
              <Bug class="h-3 w-3" />
              {{ t('debugModeBadge') }}
            </span>
            <span
              v-if="isUsingOfflineCatalog"
              class="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold"
              style="
                border-color: rgba(56, 189, 248, 0.35);
                background-color: rgba(56, 189, 248, 0.1);
                color: var(--ai-accent);
              "
              :title="t('offlineCatalogBanner')"
            >
              <Database class="h-3 w-3" />
              Offline JSON
            </span>
          </div>
          <p class="text-xs" style="color: var(--text-secondary)">
            {{ t('appSubtitle') }}
          </p>
        </div>
      </div>

      <!-- Navigation par étapes -->
      <nav aria-label="Navigation des étapes" class="flex items-center gap-1.5 sm:gap-2">
        <button
          v-for="step in navSteps"
          :key="step.num"
          type="button"
          :disabled="(step.num === 2 && !canGoStep2) || (step.num === 3 && !canGoStep3)"
          @click="emit('select-step', step.num)"
          class="rounded-lg px-3.5 py-1.5 text-xs font-bold transition border"
          :style="
            currentStep === step.num
              ? 'background: var(--brand-gradient); color: #ffffff; border-color: transparent; box-shadow: var(--brand-glow)'
              : (step.num === 2 && !canGoStep2) || (step.num === 3 && !canGoStep3)
                ? 'background-color: transparent; border-color: var(--border-subtle); color: var(--text-muted); cursor: not-allowed; opacity: 0.6'
                : 'background-color: var(--bg-elevated); border-color: var(--border-subtle); color: var(--text-secondary)'
          "
        >
          {{ step.label }}
        </button>
      </nav>

      <!-- Contrôles droits : Langue & Compteur Deck -->
      <div class="flex items-center gap-3">
        <div
          class="inline-flex rounded-lg border p-0.5 text-xs font-bold"
          style="background-color: var(--bg-canvas); border-color: var(--border-subtle)"
        >
          <button
            type="button"
            @click="setLanguage('fr')"
            class="rounded-md px-2 py-1 transition"
            :style="
              currentLang === 'fr'
                ? 'background-color: var(--brand-primary); color: #ffffff'
                : 'color: var(--text-secondary)'
            "
          >
            FR
          </button>
          <button
            type="button"
            @click="setLanguage('en')"
            class="rounded-md px-2 py-1 transition"
            :style="
              currentLang === 'en'
                ? 'background-color: var(--brand-primary); color: #ffffff'
                : 'color: var(--text-secondary)'
            "
          >
            EN
          </button>
        </div>

        <div
          class="rounded-lg border px-3 py-1 font-mono text-xs font-bold"
          :style="
            deckTotalCards === 60
              ? 'border-color: rgba(16, 185, 129, 0.45); background-color: rgba(16, 185, 129, 0.14); color: var(--status-positive)'
              : 'border-color: rgba(245, 158, 11, 0.45); background-color: rgba(245, 158, 11, 0.14); color: var(--brand-gold)'
          "
        >
          {{ deckTotalCards }} / 60
        </div>
      </div>
    </div>
  </div>
</template>
