<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { SimulationConfig } from '../types/simulator'
import type { ParsedDeck } from '../types/deck'
import type { MaxBranchesSetting } from '../core/evaluator'
import { META_OPPONENT_DECKS } from '../data/metaDecks'
import { useI18n } from '../utils/i18n'

const props = defineProps<{
  config: SimulationConfig
  deck: ParsedDeck
  isDebugMode: boolean
  maxHardwareWorkers: number
  isSimulating?: boolean
  progressPercent?: number
}>()

const emit = defineEmits<{
  (e: 'update-config', updated: SimulationConfig): void
  (e: 'back-step1'): void
  (e: 'launch-simulation'): void
  (e: 'cancel-simulation'): void
}>()

const { t, currentLang } = useI18n()

export interface PerformanceProfile {
  id: string
  labelKey: string
  descKey: string
  estimatedTime: string
  iterations: number
  maxTurns: number
  maxBranches: MaxBranchesSetting
  recommendedBadge?: boolean
}

const PERFORMANCE_PROFILES: PerformanceProfile[] = [
  {
    id: 'ultra_fast',
    labelKey: 'profileLightning',
    descKey: 'profileLightningDesc',
    estimatedTime: '~2 sec',
    iterations: 60,
    maxTurns: 12,
    maxBranches: 8,
  },
  {
    id: 'fast',
    labelKey: 'profileFast',
    descKey: 'profileFastDesc',
    estimatedTime: '~5 sec',
    iterations: 150,
    maxTurns: 15,
    maxBranches: 8,
    recommendedBadge: true,
  },
  {
    id: 'balanced',
    labelKey: 'profileBalanced',
    descKey: 'profileBalancedDesc',
    estimatedTime: '~10 sec',
    iterations: 300,
    maxTurns: 15,
    maxBranches: 20,
  },
  {
    id: 'precise',
    labelKey: 'profilePrecise',
    descKey: 'profilePreciseDesc',
    estimatedTime: '~25 sec',
    iterations: 600,
    maxTurns: 18,
    maxBranches: 20,
  },
  {
    id: 'tournament',
    labelKey: 'profileTournament',
    descKey: 'profileTournamentDesc',
    estimatedTime: '~60 sec',
    iterations: 1200,
    maxTurns: 20,
    maxBranches: 50,
  },
]

const activeProfileId = ref<string>('fast')

function patchConfig(partial: Partial<SimulationConfig>) {
  emit('update-config', {
    ...props.config,
    ...partial,
  })
}

function applyProfile(profile: PerformanceProfile) {
  activeProfileId.value = profile.id
  patchConfig({
    iterations: profile.iterations,
    maxTurns: profile.maxTurns,
    maxBranches: profile.maxBranches,
    workerCount: Math.min(props.maxHardwareWorkers, 4),
  })
}

onMounted(() => {
  const cores = props.maxHardwareWorkers || 4
  if (cores >= 8) {
    applyProfile(PERFORMANCE_PROFILES[2]!) // Équilibré
  } else {
    applyProfile(PERFORMANCE_PROFILES[1]!) // Rapide
  }
})

function toggleOpponent(oppId: string) {
  const current = new Set(props.config.selectedOpponentIds)
  if (current.has(oppId)) {
    if (current.size > 1) {
      current.delete(oppId)
    }
  } else {
    current.add(oppId)
  }
  patchConfig({ selectedOpponentIds: Array.from(current) })
}

function selectAllOpponents() {
  patchConfig({ selectedOpponentIds: META_OPPONENT_DECKS.map((d) => d.id) })
}

const launchButtonState = computed(() => {
  if (props.isSimulating) {
    return {
      disabled: true,
      label: `${t('simulatingProgress', { done: Math.round(((props.progressPercent ?? 0) / 100) * props.config.iterations), total: props.config.iterations })} (${props.progressPercent ?? 0} %)`,
      showSpinner: true,
    }
  }
  if (!props.deck.isValid60 || !props.deck.isFullyResolved) {
    return {
      disabled: true,
      label: t('invalidDeckStep1'),
      showSpinner: false,
    }
  }
  if (props.config.selectedOpponentIds.length === 0) {
    return {
      disabled: true,
      label: t('selectAtLeastOneOpp'),
      showSpinner: false,
    }
  }
  return {
    disabled: false,
    label: `${t('btnLaunchSimulation')} (${props.config.iterations} ${t('gamesUnit')})`,
    showSpinner: false,
  }
})
</script>

<template>
  <div class="space-y-6">
    <!-- Barre supérieure de contrôle -->
    <div class="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div>
        <h2 class="text-xl font-bold text-slate-900">
          {{ t('step2Heading') }}
        </h2>
        <p class="mt-1 text-sm text-slate-600">
          {{ t('step2Subheading') }}
        </p>
      </div>

      <div class="flex items-center gap-3">
        <button
          type="button"
          @click="emit('back-step1')"
          class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          ← {{ t('step1Short') }}
        </button>

        <button
          v-if="isSimulating"
          type="button"
          @click="emit('cancel-simulation')"
          class="inline-flex items-center gap-2 rounded-xl border border-rose-600 bg-rose-600 px-5 py-2.5 text-sm font-bold text-white shadow-xs transition hover:bg-rose-700 active:bg-rose-800"
        >
          <span>{{ t('cancelSimulation') }}</span>
        </button>

        <button
          v-else
          type="button"
          :disabled="launchButtonState.disabled"
          @click="emit('launch-simulation')"
          class="inline-flex items-center gap-2 rounded-xl border px-6 py-2.5 text-sm font-bold transition"
          :class="[
            launchButtonState.disabled
              ? 'cursor-not-allowed border-slate-200 bg-slate-200 text-slate-500'
              : 'border-slate-900 bg-slate-900 text-white shadow-xs hover:bg-slate-800 active:bg-slate-950',
          ]"
        >
          <span>{{ launchButtonState.label }}</span>
          <span>→</span>
        </button>
      </div>
    </div>

    <!-- 1. SELECTEUR DE PROFIL DE PERFORMANCE AUTOMATIQUE -->
    <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 class="text-sm font-bold text-slate-900">
            {{ t('perfProfileTitle') }}
          </h3>
          <p class="mt-0.5 text-xs text-slate-500">
            {{ t('perfProfileSub') }}
          </p>
        </div>
        <span class="rounded-lg bg-slate-100 px-3 py-1 font-mono text-xs font-bold text-slate-700">
          {{ t('hardwareDetected', { n: maxHardwareWorkers }) }}
        </span>
      </div>

      <div class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div
          v-for="profile in PERFORMANCE_PROFILES"
          :key="profile.id"
          @click="applyProfile(profile)"
          class="group relative flex cursor-pointer flex-col justify-between rounded-xl border p-4 transition"
          :class="[
            activeProfileId === profile.id
              ? 'border-slate-900 bg-slate-900 text-white shadow-md'
              : 'border-slate-200 bg-slate-50/50 text-slate-800 hover:border-slate-400 hover:bg-white',
          ]"
        >
          <div>
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold">
                {{ t(profile.labelKey) }}
              </span>
              <span
                v-if="profile.recommendedBadge"
                class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                :class="activeProfileId === profile.id ? 'bg-indigo-400 text-slate-900' : 'bg-indigo-100 text-indigo-800'"
              >
                {{ t('recommended') }}
              </span>
            </div>

            <p
              class="mt-1 text-xs"
              :class="activeProfileId === profile.id ? 'text-slate-300' : 'text-slate-500'"
            >
              {{ t(profile.descKey) }}
            </p>
          </div>

          <div class="mt-4 flex items-center justify-between border-t pt-3" :class="activeProfileId === profile.id ? 'border-white/20' : 'border-slate-200'">
            <span class="font-mono text-xs font-bold">
              {{ profile.iterations }} {{ t('gamesUnit') }}
            </span>
            <span
              class="text-[11px] font-semibold"
              :class="activeProfileId === profile.id ? 'text-emerald-300' : 'text-emerald-700'"
            >
              {{ profile.estimatedTime }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 2. INITIATIVE DU PREMIER TOUR -->
    <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
      <div class="border-b border-slate-100 pb-3">
        <h3 class="text-sm font-bold text-slate-900">
          {{ t('turnOrderTitle') }}
        </h3>
        <p class="mt-0.5 text-xs text-slate-500">
          {{ t('turnOrderSub') }}
        </p>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button
          type="button"
          @click="patchConfig({ firstPlayerMode: 'RANDOM' })"
          class="flex flex-col items-start rounded-xl border p-4 text-left transition"
          :class="[
            config.firstPlayerMode === 'RANDOM'
              ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
              : 'border-slate-200 bg-slate-50/50 text-slate-800 hover:border-slate-400 hover:bg-white',
          ]"
        >
          <span class="text-sm font-bold">{{ t('turnOrderRandom') }}</span>
          <span class="mt-1 text-xs opacity-75">{{ t('turnOrderRandomDesc') }}</span>
        </button>

        <button
          type="button"
          @click="patchConfig({ firstPlayerMode: 'PLAYER' })"
          class="flex flex-col items-start rounded-xl border p-4 text-left transition"
          :class="[
            config.firstPlayerMode === 'PLAYER'
              ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
              : 'border-slate-200 bg-slate-50/50 text-slate-800 hover:border-slate-400 hover:bg-white',
          ]"
        >
          <span class="text-sm font-bold">{{ t('turnOrderFirst') }}</span>
          <span class="mt-1 text-xs opacity-75">{{ t('turnOrderFirstDesc') }}</span>
        </button>

        <button
          type="button"
          @click="patchConfig({ firstPlayerMode: 'OPPONENT' })"
          class="flex flex-col items-start rounded-xl border p-4 text-left transition"
          :class="[
            config.firstPlayerMode === 'OPPONENT'
              ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
              : 'border-slate-200 bg-slate-50/50 text-slate-800 hover:border-slate-400 hover:bg-white',
          ]"
        >
          <span class="text-sm font-bold">{{ t('turnOrderSecond') }}</span>
          <span class="mt-1 text-xs opacity-75">{{ t('turnOrderSecondDesc') }}</span>
        </button>
      </div>
    </div>

    <!-- 3. DECKS ADVERSES TOP META DU MOMENT -->
    <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h3 class="text-sm font-bold text-slate-900">
            {{ t('metaMatchupsTitle') }}
          </h3>
          <p class="mt-0.5 text-xs text-slate-500">
            {{ t('metaMatchupsSub') }}
          </p>
        </div>
        <button
          type="button"
          @click="selectAllOpponents"
          class="text-xs font-semibold text-indigo-700 hover:underline"
        >
          {{ t('selectAll') }}
        </button>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div
          v-for="opp in META_OPPONENT_DECKS"
          :key="opp.id"
          @click="toggleOpponent(opp.id)"
          class="group relative flex cursor-pointer flex-col justify-between rounded-xl border p-5 transition"
          :class="[
            config.selectedOpponentIds.includes(opp.id)
              ? 'border-slate-900 bg-white ring-2 ring-slate-900 shadow-xs'
              : 'border-slate-200 bg-slate-50/40 text-slate-400 opacity-60 hover:opacity-100 hover:bg-white',
          ]"
        >
          <div>
            <div class="flex items-center justify-between">
              <span class="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                {{ currentLang === 'en' && opp.archetypeBadgeEn ? opp.archetypeBadgeEn : opp.archetypeBadge }}
              </span>
              <input
                type="checkbox"
                :checked="config.selectedOpponentIds.includes(opp.id)"
                class="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 pointer-events-none"
              />
            </div>

            <h4 class="mt-3 text-base font-bold text-slate-900">
              {{ currentLang === 'en' && opp.nameEn ? opp.nameEn : opp.name }}
            </h4>
            <p class="mt-1 text-xs text-slate-600">
              {{ currentLang === 'en' && opp.strategySubtitleEn ? opp.strategySubtitleEn : opp.strategySubtitle }}
            </p>
          </div>

          <div class="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span class="truncate">{{ t('threatsLabel') }} : {{ (currentLang === 'en' && opp.keyThreatsEn ? opp.keyThreatsEn : opp.keyThreats).slice(0, 2).join(', ') }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
