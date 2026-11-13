<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DebugPerturbationType } from '../core/engine'
import type { AiTemperament, LookaheadPly, MaxBranchesSetting } from '../core/evaluator'
import type {
  EarlyStoppingMargin,
  SimulationConfig,
  WorkerSchedulingMode,
} from '../types/simulator'
import type { MetaOpponentDeck, ParsedDeck } from '../types/deck'
import {
  computeAiIntelligence,
  computeHardwareAllocation,
  computeStatisticalVolume,
  estimateSimulationDurationSeconds,
  getRecommendedPresetsForProfile,
  type AiIntelligencePreset,
  type HardwareCpuPreset,
  type HardwareProfile,
  type StatisticalVolumePreset,
} from '../services/hardwareBenchmark'
import { useI18n } from '../utils/i18n'

const props = defineProps<{
  config: SimulationConfig
  deck: ParsedDeck
  hardwareProfile: HardwareProfile
  maxHardwareWorkers: number
  metaOpponents: MetaOpponentDeck[]
  metaLoading?: boolean
  metaError?: string | null
  isSimulating?: boolean
  progressPercent?: number
}>()

const emit = defineEmits<{
  (e: 'update-config', updated: SimulationConfig): void
  (e: 'back-step1'): void
  (e: 'launch-simulation'): void
  (e: 'cancel-simulation'): void
  (e: 'retry-meta-decks'): void
}>()

const { t, currentLang } = useI18n()

const activeConfigTab = ref<'quick' | 'advanced'>('quick')

const recommendedPresets = computed(() =>
  getRecommendedPresetsForProfile(props.hardwareProfile),
)

const liveEstimate = computed(() =>
  estimateSimulationDurationSeconds(props.config, props.hardwareProfile),
)

const cpuPresetOptions = computed(() => {
  const presets: HardwareCpuPreset[] = ['ECO', 'BALANCED', 'MAX']
  return presets.map((id) => {
    const alloc = computeHardwareAllocation(id, props.maxHardwareWorkers)
    const labelKey =
      id === 'ECO' ? 'cpuEcoLabel' : id === 'BALANCED' ? 'cpuBalancedLabel' : 'cpuMaxLabel'
    const descKey =
      id === 'ECO' ? 'cpuEcoDesc' : id === 'BALANCED' ? 'cpuBalancedDesc' : 'cpuMaxDesc'
    return {
      id,
      labelKey,
      descKey,
      ...alloc,
    }
  })
})

const volumePresetOptions: Array<{
  id: StatisticalVolumePreset
  labelKey: string
  descKey: string
  iterations: number
  earlyStoppingMargin: EarlyStoppingMargin
}> = (['FLASH', 'STANDARD', 'TOURNAMENT', 'DEEP_STAT'] as StatisticalVolumePreset[]).map((id) => {
  const vals = computeStatisticalVolume(id)
  const labelKey =
    id === 'FLASH'
      ? 'volFlashLabel'
      : id === 'STANDARD'
        ? 'volStandardLabel'
        : id === 'TOURNAMENT'
          ? 'volTournamentLabel'
          : 'volDeepLabel'
  const descKey =
    id === 'FLASH'
      ? 'volFlashDesc'
      : id === 'STANDARD'
        ? 'volStandardDesc'
        : id === 'TOURNAMENT'
          ? 'volTournamentDesc'
          : 'volDeepDesc'
  return { id, labelKey, descKey, ...vals }
})

const aiPresetOptions: Array<{
  id: AiIntelligencePreset
  labelKey: string
  descKey: string
}> = [
  { id: 'FAST_HEURISTIC', labelKey: 'aiFastLabel', descKey: 'aiFastDesc' },
  { id: 'COMPETITIVE', labelKey: 'aiCompLabel', descKey: 'aiCompDesc' },
  { id: 'EXPERT_DEEP', labelKey: 'aiExpertLabel', descKey: 'aiExpertDesc' },
]

const activeCpuPreset = computed<HardwareCpuPreset | null>(() => {
  const match = cpuPresetOptions.value.find(
    (opt) =>
      opt.workerCount === props.config.workerCount &&
      (props.config.workerSchedulingMode ?? 'DYNAMIC_BATCHES') === opt.workerSchedulingMode &&
      (props.config.batchSize ?? opt.batchSize) === opt.batchSize,
  )
  return match?.id ?? null
})

const activeVolumePreset = computed<StatisticalVolumePreset | null>(() => {
  const match = volumePresetOptions.find(
    (opt) =>
      opt.iterations === props.config.iterations &&
      (props.config.earlyStoppingMargin ?? 0) === opt.earlyStoppingMargin,
  )
  return match?.id ?? null
})

const activeAiPreset = computed<AiIntelligencePreset | null>(() => {
  for (const opt of aiPresetOptions) {
    const vals = computeAiIntelligence(opt.id)
    if (
      props.config.maxBranches === vals.maxBranches &&
      (props.config.lookaheadPly ?? 3) === vals.lookaheadPly &&
      (props.config.topKCandidates ?? 3) === vals.topKCandidates &&
      (props.config.beamWidth ?? 8) === vals.beamWidth &&
      (props.config.maxActionDepth ?? 8) === vals.maxActionDepth &&
      (props.config.rolloutMaxActions ?? 8) === vals.rolloutMaxActions &&
      (props.config.opponentLookaheadPly ?? 3) === vals.opponentLookaheadPly &&
      (props.config.opponentMaxBranches ?? 20) === vals.opponentMaxBranches &&
      (props.config.aiTemperament ?? 'BALANCED') === vals.aiTemperament &&
      props.config.maxTurns === vals.maxTurns
    ) {
      return opt.id
    }
  }
  return null
})

const isCustomAdvancedActive = computed(
  () =>
    activeCpuPreset.value === null ||
    activeVolumePreset.value === null ||
    activeAiPreset.value === null ||
    props.config.fixedSeed !== null ||
    props.config.collectDetailedTelemetry === false ||
    Boolean(props.config.stressTestOhkoEachTurn) ||
    (props.config.perturbationType ?? 'NONE') !== 'NONE',
)

function patchConfig(partial: Partial<SimulationConfig>) {
  emit('update-config', {
    ...props.config,
    ...partial,
  })
}

function selectCpuPreset(id: HardwareCpuPreset) {
  patchConfig(computeHardwareAllocation(id, props.maxHardwareWorkers))
}

function selectVolumePreset(id: StatisticalVolumePreset) {
  patchConfig(computeStatisticalVolume(id))
}

function selectAiPreset(id: AiIntelligencePreset) {
  patchConfig(computeAiIntelligence(id))
}

function resetToHardwareRecommended() {
  const reco = recommendedPresets.value
  patchConfig({
    ...computeHardwareAllocation(reco.cpu, props.maxHardwareWorkers),
    ...computeStatisticalVolume(reco.volume),
    ...computeAiIntelligence(reco.ai),
    firstPlayerMode: 'RANDOM',
    fixedSeed: null,
    perturbationType: 'NONE',
    perturbationTurn: 2,
    stressTestOhkoEachTurn: false,
    collectDetailedTelemetry: true,
  })
}

function handleSeedInput(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) {
    patchConfig({ fixedSeed: null })
    return
  }
  const parsed = Number.parseInt(trimmed, 10)
  patchConfig({ fixedSeed: Number.isFinite(parsed) ? parsed : null })
}

function handleMaxBranchesSelect(val: string) {
  const maxBranches: MaxBranchesSetting =
    val === 'INFINITE' ? 'INFINITE' : (Number(val) as 8 | 20 | 50)
  patchConfig({ maxBranches })
}

function handleOpponentBranchesSelect(val: string) {
  const opponentMaxBranches: MaxBranchesSetting =
    val === 'INFINITE' ? 'INFINITE' : (Number(val) as 8 | 20 | 50)
  patchConfig({ opponentMaxBranches })
}

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
  patchConfig({ selectedOpponentIds: props.metaOpponents.map((d) => d.id) })
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

      <div class="flex flex-wrap items-center gap-3">
        <!-- Pill estimation durée & débit live -->
        <div class="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs">
          <div>
            <span class="text-slate-500">{{ t('estDurationLabel') }} : </span>
            <span class="font-mono font-bold text-slate-900">{{ liveEstimate.formattedDuration }}</span>
          </div>
          <span class="text-slate-300">|</span>
          <div>
            <span class="text-slate-500">{{ t('estSpeedLabel') }} : </span>
            <span class="font-mono font-bold text-emerald-700">
              {{ t('estSpeedValue', { gps: liveEstimate.speedGamesPerSec }) }}
            </span>
          </div>
          <span
            v-if="liveEstimate.isPrecisionCalibrated"
            class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800"
          >
            {{ t('estLiveCalibrated') }}
          </span>
        </div>

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

    <!-- CARTE CONFIGURATION PAR ONGLETS (RÉGLAGES RAPIDES / PARAMÈTRES AVANCÉS) -->
    <div class="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
      <!-- Barre d'onglets -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-3">
        <div class="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          <button
            type="button"
            @click="activeConfigTab = 'quick'"
            class="rounded-lg px-4 py-1.5 text-xs font-bold transition"
            :class="
              activeConfigTab === 'quick'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            "
          >
            {{ t('tabQuickSettings') }}
          </button>
          <button
            type="button"
            @click="activeConfigTab = 'advanced'"
            class="inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-bold transition"
            :class="
              activeConfigTab === 'advanced'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            "
          >
            <span>{{ t('tabAdvancedSettings') }}</span>
            <span
              v-if="isCustomAdvancedActive"
              class="rounded px-1.5 py-0.5 text-[10px] font-bold"
              :class="activeConfigTab === 'advanced' ? 'bg-amber-400 text-slate-900' : 'bg-amber-100 text-amber-800'"
            >
              {{ t('advancedCustomBadge') }}
            </span>
          </button>
        </div>

        <button
          type="button"
          @click="resetToHardwareRecommended"
          class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
        >
          {{ t('advancedResetBtn') }}
        </button>
      </div>

      <!-- ONGLET 1 : RÉGLAGES RAPIDES -->
      <div v-if="activeConfigTab === 'quick'" class="p-6 space-y-6">
        <!-- Sélecteur 1 : Puissance PC (CPU) -->
      <div>
        <div class="flex items-baseline justify-between">
          <div>
            <h3 class="text-sm font-bold text-slate-900">{{ t('selectorCpuTitle') }}</h3>
            <p class="mt-0.5 text-xs text-slate-500">{{ t('selectorCpuSub') }}</p>
          </div>
          <span class="font-mono text-xs font-bold text-slate-700">
            {{ config.workerCount }} / {{ maxHardwareWorkers }} Workers
          </span>
        </div>

        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button
            v-for="opt in cpuPresetOptions"
            :key="opt.id"
            type="button"
            @click="selectCpuPreset(opt.id)"
            class="flex flex-col justify-between rounded-xl border p-4 text-left transition"
            :class="[
              activeCpuPreset === opt.id
                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                : 'border-slate-200 bg-slate-50/50 text-slate-800 hover:border-slate-400 hover:bg-white',
            ]"
          >
            <div class="flex w-full items-center justify-between gap-2">
              <span class="text-sm font-bold">{{ t(opt.labelKey) }}</span>
              <span
                v-if="recommendedPresets.cpu === opt.id"
                class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                :class="activeCpuPreset === opt.id ? 'bg-indigo-400 text-slate-900' : 'bg-indigo-100 text-indigo-800'"
              >
                {{ t('recommended') }}
              </span>
            </div>
            <div class="mt-2 flex items-center justify-between text-xs">
              <span :class="activeCpuPreset === opt.id ? 'text-slate-300' : 'text-slate-500'">
                {{ t(opt.descKey) }}
              </span>
              <span class="font-mono font-bold">{{ opt.workerCount }} Workers</span>
            </div>
          </button>
        </div>
      </div>

      <!-- Sélecteur 2 : Volume Statistique & Précision -->
      <div class="border-t border-slate-100 pt-5">
        <div class="flex items-baseline justify-between">
          <div>
            <h3 class="text-sm font-bold text-slate-900">{{ t('selectorVolumeTitle') }}</h3>
            <p class="mt-0.5 text-xs text-slate-500">{{ t('selectorVolumeSub') }}</p>
          </div>
          <span class="font-mono text-xs font-bold text-slate-700">
            {{ config.iterations }} {{ t('gamesUnit') }}
          </span>
        </div>

        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <button
            v-for="opt in volumePresetOptions"
            :key="opt.id"
            type="button"
            @click="selectVolumePreset(opt.id)"
            class="flex flex-col justify-between rounded-xl border p-4 text-left transition"
            :class="[
              activeVolumePreset === opt.id
                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                : 'border-slate-200 bg-slate-50/50 text-slate-800 hover:border-slate-400 hover:bg-white',
            ]"
          >
            <div class="flex w-full items-center justify-between gap-2">
              <span class="text-sm font-bold">{{ t(opt.labelKey) }}</span>
              <span
                v-if="recommendedPresets.volume === opt.id"
                class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                :class="activeVolumePreset === opt.id ? 'bg-indigo-400 text-slate-900' : 'bg-indigo-100 text-indigo-800'"
              >
                {{ t('recommended') }}
              </span>
            </div>
            <p class="mt-1.5 text-xs" :class="activeVolumePreset === opt.id ? 'text-slate-300' : 'text-slate-500'">
              {{ t(opt.descKey) }}
            </p>
          </button>
        </div>
      </div>

      <!-- Sélecteur 3 : Intelligence & Anticipation IA -->
      <div class="border-t border-slate-100 pt-5">
        <div class="flex items-baseline justify-between">
          <div>
            <h3 class="text-sm font-bold text-slate-900">{{ t('selectorAiTitle') }}</h3>
            <p class="mt-0.5 text-xs text-slate-500">{{ t('selectorAiSub') }}</p>
          </div>
          <span class="font-mono text-xs font-bold text-slate-700">
            {{ config.lookaheadPly ?? 3 }}-Ply • Beam {{ config.beamWidth ?? 8 }} • {{ config.maxBranches }} br.
          </span>
        </div>

        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <button
            v-for="opt in aiPresetOptions"
            :key="opt.id"
            type="button"
            @click="selectAiPreset(opt.id)"
            class="flex flex-col justify-between rounded-xl border p-4 text-left transition"
            :class="[
              activeAiPreset === opt.id
                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                : 'border-slate-200 bg-slate-50/50 text-slate-800 hover:border-slate-400 hover:bg-white',
            ]"
          >
            <div class="flex w-full items-center justify-between gap-2">
              <span class="text-sm font-bold">{{ t(opt.labelKey) }}</span>
              <span
                v-if="recommendedPresets.ai === opt.id"
                class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                :class="activeAiPreset === opt.id ? 'bg-indigo-400 text-slate-900' : 'bg-indigo-100 text-indigo-800'"
              >
                {{ t('recommended') }}
              </span>
            </div>
            <p class="mt-1.5 text-xs" :class="activeAiPreset === opt.id ? 'text-slate-300' : 'text-slate-500'">
              {{ t(opt.descKey) }}
            </p>
          </button>
        </div>
      </div>
      </div>

      <!-- ONGLET 2 : PARAMÈTRES AVANCÉS DU MOTEUR (14 CONTRÔLES) -->
      <div v-else class="bg-slate-50/40 p-6 space-y-6">
        <!-- Groupe A : Recherche & Évaluateur IA -->
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-2">
            {{ t('advGroupAiTitle') }}
          </h4>
          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <!-- 1. lookaheadPly -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">{{ t('advLookaheadPly') }}</span>
              <select
                :value="config.lookaheadPly ?? 3"
                @change="patchConfig({ lookaheadPly: Number(($event.target as HTMLSelectElement).value) as LookaheadPly })"
                class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
              >
                <option :value="1">1-Ply (Tour T seul)</option>
                <option :value="2">2-Ply (T -> T_adv)</option>
                <option :value="3">3-Ply (T -> T_adv -> T+1)</option>
              </select>
            </label>

            <!-- 2. maxBranches -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">{{ t('advMaxBranches') }}</span>
              <select
                :value="String(config.maxBranches)"
                @change="handleMaxBranchesSelect(($event.target as HTMLSelectElement).value)"
                class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
              >
                <option value="8">8 branches</option>
                <option value="20">20 branches</option>
                <option value="50">50 branches</option>
                <option value="INFINITE">INFINITE (plafond 60)</option>
              </select>
            </label>

            <!-- 3. beamWidth -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">
                {{ t('advBeamWidth', { n: config.beamWidth ?? 8 }) }}
              </span>
              <input
                type="range"
                min="2"
                max="16"
                step="1"
                :value="config.beamWidth ?? 8"
                @input="patchConfig({ beamWidth: Number(($event.target as HTMLInputElement).value) })"
                class="accent-slate-900"
              />
            </label>

            <!-- 4. topKCandidates -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">
                {{ t('advTopK', { n: config.topKCandidates ?? 3 }) }}
              </span>
              <input
                type="range"
                min="1"
                max="8"
                step="1"
                :value="config.topKCandidates ?? 3"
                @input="patchConfig({ topKCandidates: Number(($event.target as HTMLInputElement).value) })"
                class="accent-slate-900"
              />
            </label>

            <!-- 5. maxActionDepth -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">
                {{ t('advMaxActionDepth', { n: config.maxActionDepth ?? 8 }) }}
              </span>
              <input
                type="range"
                min="4"
                max="14"
                step="1"
                :value="config.maxActionDepth ?? 8"
                @input="patchConfig({ maxActionDepth: Number(($event.target as HTMLInputElement).value) })"
                class="accent-slate-900"
              />
            </label>

            <!-- 6. rolloutMaxActions -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">
                {{ t('advRolloutMaxActions', { n: config.rolloutMaxActions ?? 8 }) }}
              </span>
              <input
                type="range"
                min="3"
                max="12"
                step="1"
                :value="config.rolloutMaxActions ?? 8"
                @input="patchConfig({ rolloutMaxActions: Number(($event.target as HTMLInputElement).value) })"
                class="accent-slate-900"
              />
            </label>

            <!-- 7. aiTemperament -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">{{ t('advAiTemperament') }}</span>
              <select
                :value="config.aiTemperament ?? 'BALANCED'"
                @change="patchConfig({ aiTemperament: ($event.target as HTMLSelectElement).value as AiTemperament })"
                class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
              >
                <option value="BALANCED">{{ t('tempBalanced') }}</option>
                <option value="AGGRESSIVE">{{ t('tempAggressive') }}</option>
                <option value="CONSERVATIVE">{{ t('tempConservative') }}</option>
              </select>
            </label>

            <!-- 8. opponentLookaheadPly & opponentMaxBranches -->
            <div class="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3.5">
              <div class="flex flex-col gap-1">
                <span class="text-xs font-semibold text-slate-700">{{ t('advOpponentLookahead') }}</span>
                <select
                  :value="config.opponentLookaheadPly ?? 3"
                  @change="patchConfig({ opponentLookaheadPly: Number(($event.target as HTMLSelectElement).value) as LookaheadPly })"
                  class="rounded-lg border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900"
                >
                  <option :value="1">1-Ply</option>
                  <option :value="2">2-Ply</option>
                  <option :value="3">3-Ply</option>
                </select>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-[11px] font-semibold text-slate-600">{{ t('advOpponentBranches') }}</span>
                <select
                  :value="String(config.opponentMaxBranches ?? 20)"
                  @change="handleOpponentBranchesSelect(($event.target as HTMLSelectElement).value)"
                  class="rounded-lg border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900"
                >
                  <option value="8">8</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <!-- Groupe B : Règles d'Exécution & Partie -->
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-2">
            {{ t('advGroupExecTitle') }}
          </h4>
          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <!-- 9. iterations -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">{{ t('advIterations') }}</span>
              <input
                type="number"
                min="10"
                max="20000"
                step="10"
                :value="config.iterations"
                @change="patchConfig({ iterations: Math.max(10, Math.min(20000, Number(($event.target as HTMLInputElement).value) || 300)) })"
                class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
              />
            </label>

            <!-- 10. maxTurns -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">
                {{ t('advMaxTurns', { n: config.maxTurns }) }}
              </span>
              <input
                type="range"
                min="6"
                max="30"
                step="1"
                :value="config.maxTurns"
                @input="patchConfig({ maxTurns: Number(($event.target as HTMLInputElement).value) })"
                class="accent-slate-900"
              />
            </label>

            <!-- 11. fixedSeed -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">{{ t('advFixedSeed') }}</span>
              <input
                type="number"
                :placeholder="t('advFixedSeedPlaceholder')"
                :value="config.fixedSeed ?? ''"
                @input="handleSeedInput(($event.target as HTMLInputElement).value)"
                class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
              />
            </label>
          </div>
        </div>

        <!-- Groupe C : Parallélisme & Ordonnancement -->
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-2">
            {{ t('advGroupWorkersTitle') }}
          </h4>
          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <!-- 12. workerCount -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">
                {{ t('advWorkerCount', { n: config.workerCount, max: maxHardwareWorkers }) }}
              </span>
              <input
                type="range"
                min="1"
                :max="maxHardwareWorkers"
                step="1"
                :value="config.workerCount"
                @input="patchConfig({ workerCount: Number(($event.target as HTMLInputElement).value) })"
                class="accent-slate-900"
              />
            </label>

            <!-- 13. workerSchedulingMode -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">{{ t('advSchedulingMode') }}</span>
              <select
                :value="config.workerSchedulingMode ?? 'DYNAMIC_BATCHES'"
                @change="patchConfig({ workerSchedulingMode: ($event.target as HTMLSelectElement).value as WorkerSchedulingMode })"
                class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
              >
                <option value="DYNAMIC_BATCHES">{{ t('schedDynamic') }}</option>
                <option value="STATIC_SHARDS">{{ t('schedStatic') }}</option>
              </select>
            </label>

            <!-- 14. batchSize -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">{{ t('advBatchSize') }}</span>
              <select
                :disabled="(config.workerSchedulingMode ?? 'DYNAMIC_BATCHES') !== 'DYNAMIC_BATCHES'"
                :value="config.batchSize ?? 25"
                @change="patchConfig({ batchSize: Number(($event.target as HTMLSelectElement).value) })"
                class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 disabled:opacity-50"
              >
                <option :value="10">10 {{ t('gamesUnit') }}</option>
                <option :value="25">25 {{ t('gamesUnit') }}</option>
                <option :value="50">50 {{ t('gamesUnit') }}</option>
                <option :value="100">100 {{ t('gamesUnit') }}</option>
              </select>
            </label>
          </div>
        </div>

        <!-- Groupe D : Convergence, Télémétrie & Stress-Tests -->
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-2">
            {{ t('advGroupStatsTitle') }}
          </h4>
          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <!-- earlyStoppingMargin -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">{{ t('advEarlyStopping') }}</span>
              <select
                :value="config.earlyStoppingMargin ?? 0"
                @change="patchConfig({ earlyStoppingMargin: Number(($event.target as HTMLSelectElement).value) as EarlyStoppingMargin })"
                class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
              >
                <option :value="0">{{ t('earlyStopOff') }}</option>
                <option :value="1.5">{{ t('earlyStop15') }}</option>
                <option :value="2.5">{{ t('earlyStop25') }}</option>
                <option :value="4">{{ t('earlyStop40') }}</option>
              </select>
            </label>

            <!-- collectDetailedTelemetry & stressTestOhkoEachTurn -->
            <div class="flex flex-col justify-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
              <label class="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  :checked="config.collectDetailedTelemetry !== false"
                  @change="patchConfig({ collectDetailedTelemetry: ($event.target as HTMLInputElement).checked })"
                  class="h-4 w-4 rounded border-slate-300 accent-slate-900"
                />
                <span>{{ t('advCollectTelemetry') }}</span>
              </label>
              <label class="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  :checked="Boolean(config.stressTestOhkoEachTurn)"
                  @change="patchConfig({ stressTestOhkoEachTurn: ($event.target as HTMLInputElement).checked })"
                  class="h-4 w-4 rounded border-slate-300 accent-slate-900"
                />
                <span>{{ t('advStressOhko') }}</span>
              </label>
            </div>

            <!-- perturbationType -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">{{ t('advPerturbation') }}</span>
              <select
                :value="config.perturbationType ?? 'NONE'"
                @change="patchConfig({ perturbationType: ($event.target as HTMLSelectElement).value as DebugPerturbationType })"
                class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
              >
                <option value="NONE">{{ t('pertNone') }}</option>
                <option value="FORCE_OPPONENT_IONO">{{ t('pertIono') }}</option>
                <option value="FORCE_KO_ACTIVE">{{ t('pertKo') }}</option>
                <option value="FORCE_KEY_CARD_PRIZED">{{ t('pertPrized') }}</option>
              </select>
            </label>

            <!-- perturbationTurn -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3.5">
              <span class="text-xs font-semibold text-slate-700">{{ t('advPerturbationTurn') }}</span>
              <input
                type="number"
                min="1"
                max="10"
                :disabled="(config.perturbationType ?? 'NONE') === 'NONE'"
                :value="config.perturbationTurn ?? 2"
                @change="patchConfig({ perturbationTurn: Math.max(1, Math.min(10, Number(($event.target as HTMLInputElement).value) || 2)) })"
                class="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 disabled:opacity-50"
              />
            </label>
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

      <div
        v-if="metaLoading"
        class="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-5 text-xs font-medium text-slate-600"
      >
        <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-transparent"></span>
        <span>{{ t('loadingMetaDecks') }}</span>
      </div>

      <div
        v-else-if="metaError"
        class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-xs text-red-900"
      >
        <div>
          <div class="font-bold">{{ t('metaDecksErrorTitle') }}</div>
          <div class="mt-0.5 text-red-800">{{ metaError }}</div>
        </div>
        <button
          type="button"
          @click="emit('retry-meta-decks')"
          class="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-900 shadow-2xs hover:bg-red-100"
        >
          {{ t('retryButton') }}
        </button>
      </div>

      <div
        v-else-if="metaOpponents.length === 0"
        class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"
      >
        {{ t('noMetaDecksAvailable') }}
      </div>

      <div v-else class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div
          v-for="opp in metaOpponents"
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
