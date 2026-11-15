<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DebugPerturbationType } from '@olydor/engine'
import type { AiTemperament, LookaheadPly, MaxBranchesSetting } from '@olydor/engine'
import type {
  SimulationConfig,
  WorkerSchedulingMode,
} from '@olydor/types'
import type { EngineCardModel } from '@olydor/types'
import type { MetaOpponentDeck, ParsedDeck } from '@olydor/types'
import CardFanThumbnail from './CardFanThumbnail.vue'
import CardZoomModal from './CardZoomModal.vue'
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

const { t, pickLocalizedField, formatNumber } = useI18n()

const activeConfigTab = ref<'quick' | 'advanced'>('quick')
const zoomedOpponentCards = ref<EngineCardModel[]>([])

function openOpponentCardsZoom(cards: EngineCardModel[] | undefined) {
  if (!cards || cards.length === 0) return
  zoomedOpponentCards.value = cards
}

function closeOpponentCardsZoom() {
  zoomedOpponentCards.value = []
}

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
    (opt) => opt.iterations === props.config.iterations,
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

function rangePct(value: number, min: number, max: number): string {
  if (max <= min) return '100%'
  const pct = ((value - min) / (max - min)) * 100
  return `${Math.min(100, Math.max(0, pct))}%`
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
    <div class="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#263044] bg-[#131823] p-5 shadow-xs">
      <div>
        <h2 class="text-xl font-bold text-[#f8fafc]">
          {{ t('step2Heading') }}
        </h2>
        <p class="mt-1 text-sm text-[#8a93a2]">
          {{ t('step2Subheading') }}
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <!-- Pill estimation durée & débit live -->
        <div class="flex items-center gap-3 rounded-xl border border-[#263044] bg-[#0c0f16] px-3.5 py-2 text-xs">
          <div>
            <span class="text-[#8a93a2]">{{ t('estDurationLabel') }} : </span>
            <span class="font-mono font-bold text-[#f8fafc]">{{ liveEstimate.formattedDuration }}</span>
          </div>
          <span class="text-[#8a93a2]">|</span>
          <div>
            <span class="text-[#8a93a2]">{{ t('estSpeedLabel') }} : </span>
            <span class="font-mono font-bold text-[#10b981]">
              {{ t('estSpeedValue', { gps: liveEstimate.speedGamesPerSec }) }}
            </span>
          </div>
          <span
            v-if="liveEstimate.isPrecisionCalibrated"
            class="rounded bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300"
          >
            {{ t('estLiveCalibrated') }}
          </span>
        </div>

        <button
          type="button"
          @click="emit('back-step1')"
          class="rounded-xl border border-[#263044] bg-[#131823] px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-[#1b2232]"
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
              ? 'cursor-not-allowed border-[#263044] bg-[#263044] text-[#8a93a2]'
              : 'border-[#ff6b00] bg-[#ff6b00] text-white shadow-[0_0_20px_rgba(255,107,0,0.28)] hover:bg-[#ff8a00] active:bg-[#e11d48]',
          ]"
        >
          <span>{{ launchButtonState.label }}</span>
          <span>→</span>
        </button>
      </div>
    </div>

    <!-- CARTE CONFIGURATION PAR ONGLETS (RÉGLAGES RAPIDES / PARAMÈTRES AVANCÉS) -->
    <div class="rounded-2xl border border-[#263044] bg-[#131823] shadow-xs overflow-hidden">
      <!-- Barre d'onglets -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#263044] bg-[#1b2232]/70 px-5 py-3">
        <div class="inline-flex rounded-xl border border-[#263044] bg-[#131823] p-1">
          <button
            type="button"
            @click="activeConfigTab = 'quick'"
            class="rounded-lg px-4 py-1.5 text-xs font-bold transition"
            :class="
              activeConfigTab === 'quick'
                ? 'bg-[#ff6b00] text-white shadow-xs'
                : 'text-[#8a93a2] hover:text-[#f8fafc]'
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
                ? 'bg-[#ff6b00] text-white shadow-xs'
                : 'text-[#8a93a2] hover:text-[#f8fafc]'
            "
          >
            <span>{{ t('tabAdvancedSettings') }}</span>
            <span
              v-if="isCustomAdvancedActive"
              class="rounded px-1.5 py-0.5 text-[10px] font-bold"
              :class="activeConfigTab === 'advanced' ? 'bg-black/25 text-white' : 'bg-amber-950/60 text-amber-300'"
            >
              {{ t('advancedCustomBadge') }}
            </span>
          </button>
        </div>

        <button
          type="button"
          @click="resetToHardwareRecommended"
          class="rounded-lg border border-[#263044] bg-[#131823] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-[#1b2232] transition"
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
            <h3 class="text-sm font-bold text-[#f8fafc]">{{ t('selectorCpuTitle') }}</h3>
            <p class="mt-0.5 text-xs text-[#8a93a2]">{{ t('selectorCpuSub') }}</p>
          </div>
          <span class="font-mono text-xs font-bold text-slate-200">
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
                ? 'border-[#ff6b00] bg-[#1b2232] text-[#f8fafc] ring-2 ring-[#ff6b00]/75 shadow-[0_0_20px_rgba(255,107,0,0.2)]'
                : 'border-[#263044] bg-[#0c0f16]/60 text-[#f8fafc] hover:border-[#ff8a00]/60 hover:bg-[#1b2232]',
            ]"
          >
            <div class="flex w-full items-center justify-between gap-2">
              <span class="text-sm font-bold">{{ t(opt.labelKey) }}</span>
              <span
                v-if="recommendedPresets.cpu === opt.id"
                class="rounded border border-[#38bdf8]/40 bg-sky-950/60 px-1.5 py-0.5 text-[10px] font-bold text-sky-200"
              >
                {{ t('recommended') }}
              </span>
            </div>
            <div class="mt-2 flex items-center justify-between text-xs">
              <span class="text-[#8a93a2]">
                {{ t(opt.descKey) }}
              </span>
              <span
                class="font-mono font-bold"
                :class="activeCpuPreset === opt.id ? 'text-[#ff8a00]' : 'text-[#f8fafc]'"
              >
                {{ opt.workerCount }} Workers
              </span>
            </div>
          </button>
        </div>
      </div>

      <!-- Sélecteur 2 : Volume Statistique & Précision -->
      <div class="border-t border-[#263044] pt-5">
        <div class="flex items-baseline justify-between">
          <div>
            <h3 class="text-sm font-bold text-[#f8fafc]">{{ t('selectorVolumeTitle') }}</h3>
            <p class="mt-0.5 text-xs text-[#8a93a2]">{{ t('selectorVolumeSub') }}</p>
          </div>
          <span class="font-mono text-xs font-bold text-slate-200">
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
                ? 'border-[#ff6b00] bg-[#1b2232] text-[#f8fafc] ring-2 ring-[#ff6b00]/75 shadow-[0_0_20px_rgba(255,107,0,0.2)]'
                : 'border-[#263044] bg-[#0c0f16]/60 text-[#f8fafc] hover:border-[#ff8a00]/60 hover:bg-[#1b2232]',
            ]"
          >
            <div class="flex w-full items-center justify-between gap-2">
              <span class="text-sm font-bold">{{ t(opt.labelKey) }}</span>
              <span
                v-if="recommendedPresets.volume === opt.id"
                class="rounded border border-[#38bdf8]/40 bg-sky-950/60 px-1.5 py-0.5 text-[10px] font-bold text-sky-200"
              >
                {{ t('recommended') }}
              </span>
            </div>
            <p class="mt-1.5 text-xs text-[#8a93a2]">
              {{ t(opt.descKey) }}
            </p>
          </button>
        </div>
      </div>

      <!-- Sélecteur 3 : Intelligence & Anticipation IA -->
      <div class="border-t border-[#263044] pt-5">
        <div class="flex items-baseline justify-between">
          <div>
            <h3 class="text-sm font-bold text-[#f8fafc]">{{ t('selectorAiTitle') }}</h3>
            <p class="mt-0.5 text-xs text-[#8a93a2]">{{ t('selectorAiSub') }}</p>
          </div>
          <span class="font-mono text-xs font-bold text-slate-200">
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
                ? 'border-[#ff6b00] bg-[#1b2232] text-[#f8fafc] ring-2 ring-[#ff6b00]/75 shadow-[0_0_20px_rgba(255,107,0,0.2)]'
                : 'border-[#263044] bg-[#0c0f16]/60 text-[#f8fafc] hover:border-[#ff8a00]/60 hover:bg-[#1b2232]',
            ]"
          >
            <div class="flex w-full items-center justify-between gap-2">
              <span class="text-sm font-bold">{{ t(opt.labelKey) }}</span>
              <span
                v-if="recommendedPresets.ai === opt.id"
                class="rounded border border-[#38bdf8]/40 bg-sky-950/60 px-1.5 py-0.5 text-[10px] font-bold text-sky-200"
              >
                {{ t('recommended') }}
              </span>
            </div>
            <p class="mt-1.5 text-xs text-[#8a93a2]">
              {{ t(opt.descKey) }}
            </p>
          </button>
        </div>
      </div>
      </div>

      <!-- ONGLET 2 : PARAMÈTRES AVANCÉS DU MOTEUR (14 CONTRÔLES) -->
      <div v-else class="bg-[#0c0f16]/50 p-6 space-y-6">
        <!-- Groupe A : Recherche & Évaluateur IA -->
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-200 border-b border-[#263044] pb-2">
            {{ t('advGroupAiTitle') }}
          </h4>
          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <!-- 1. lookaheadPly -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">{{ t('advLookaheadPly') }}</span>
              <select
                :value="config.lookaheadPly ?? 3"
                @change="patchConfig({ lookaheadPly: Number(($event.target as HTMLSelectElement).value) as LookaheadPly })"
                class="rounded-lg border border-[#263044] bg-[#131823] px-2.5 py-1.5 font-mono text-xs text-[#f8fafc]"
              >
                <option :value="1">{{ t('ply1Label') }}</option>
                <option :value="2">2-Ply (T -> T_adv)</option>
                <option :value="3">3-Ply (T -> T_adv -> T+1)</option>
              </select>
            </label>

            <!-- 2. maxBranches -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">{{ t('advMaxBranches') }}</span>
              <select
                :value="String(config.maxBranches)"
                @change="handleMaxBranchesSelect(($event.target as HTMLSelectElement).value)"
                class="rounded-lg border border-[#263044] bg-[#131823] px-2.5 py-1.5 font-mono text-xs text-[#f8fafc]"
              >
                <option value="8">8 branches</option>
                <option value="20">20 branches</option>
                <option value="50">50 branches</option>
                <option value="INFINITE">{{ t('maxBranchesInfinite') }}</option>
              </select>
            </label>

            <!-- 3. beamWidth -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">
                {{ t('advBeamWidth', { n: config.beamWidth ?? 8 }) }}
              </span>
              <input
                type="range"
                min="2"
                max="16"
                step="1"
                :value="config.beamWidth ?? 8"
                :style="{ '--range-pct': rangePct(config.beamWidth ?? 8, 2, 16) }"
                @input="patchConfig({ beamWidth: Number(($event.target as HTMLInputElement).value) })"
                class="w-full cursor-pointer accent-[#ff6b00]"
              />
            </label>

            <!-- 4. topKCandidates -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">
                {{ t('advTopK', { n: config.topKCandidates ?? 3 }) }}
              </span>
              <input
                type="range"
                min="1"
                max="8"
                step="1"
                :value="config.topKCandidates ?? 3"
                :style="{ '--range-pct': rangePct(config.topKCandidates ?? 3, 1, 8) }"
                @input="patchConfig({ topKCandidates: Number(($event.target as HTMLInputElement).value) })"
                class="w-full cursor-pointer accent-[#ff6b00]"
              />
            </label>

            <!-- 5. maxActionDepth -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">
                {{ t('advMaxActionDepth', { n: config.maxActionDepth ?? 8 }) }}
              </span>
              <input
                type="range"
                min="4"
                max="14"
                step="1"
                :value="config.maxActionDepth ?? 8"
                :style="{ '--range-pct': rangePct(config.maxActionDepth ?? 8, 4, 14) }"
                @input="patchConfig({ maxActionDepth: Number(($event.target as HTMLInputElement).value) })"
                class="w-full cursor-pointer accent-[#ff6b00]"
              />
            </label>

            <!-- 6. rolloutMaxActions -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">
                {{ t('advRolloutMaxActions', { n: config.rolloutMaxActions ?? 8 }) }}
              </span>
              <input
                type="range"
                min="3"
                max="12"
                step="1"
                :value="config.rolloutMaxActions ?? 8"
                :style="{ '--range-pct': rangePct(config.rolloutMaxActions ?? 8, 3, 12) }"
                @input="patchConfig({ rolloutMaxActions: Number(($event.target as HTMLInputElement).value) })"
                class="w-full cursor-pointer accent-[#ff6b00]"
              />
            </label>

            <!-- 7. aiTemperament -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">{{ t('advAiTemperament') }}</span>
              <select
                :value="config.aiTemperament ?? 'BALANCED'"
                @change="patchConfig({ aiTemperament: ($event.target as HTMLSelectElement).value as AiTemperament })"
                class="rounded-lg border border-[#263044] bg-[#131823] px-2.5 py-1.5 text-xs text-[#f8fafc]"
              >
                <option value="BALANCED">{{ t('tempBalanced') }}</option>
                <option value="AGGRESSIVE">{{ t('tempAggressive') }}</option>
                <option value="CONSERVATIVE">{{ t('tempConservative') }}</option>
              </select>
            </label>

            <!-- 8. opponentLookaheadPly & opponentMaxBranches -->
            <div class="flex flex-col gap-2 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <div class="flex flex-col gap-1">
                <span class="text-xs font-semibold text-slate-200">{{ t('advOpponentLookahead') }}</span>
                <select
                  :value="config.opponentLookaheadPly ?? 3"
                  @change="patchConfig({ opponentLookaheadPly: Number(($event.target as HTMLSelectElement).value) as LookaheadPly })"
                  class="rounded-lg border border-[#263044] bg-[#131823] px-2 py-1 font-mono text-xs text-[#f8fafc]"
                >
                  <option :value="1">1-Ply</option>
                  <option :value="2">2-Ply</option>
                  <option :value="3">3-Ply</option>
                </select>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-[11px] font-semibold text-[#8a93a2]">{{ t('advOpponentBranches') }}</span>
                <select
                  :value="String(config.opponentMaxBranches ?? 20)"
                  @change="handleOpponentBranchesSelect(($event.target as HTMLSelectElement).value)"
                  class="rounded-lg border border-[#263044] bg-[#131823] px-2 py-1 font-mono text-xs text-[#f8fafc]"
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
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-200 border-b border-[#263044] pb-2">
            {{ t('advGroupExecTitle') }}
          </h4>
          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <!-- 9. iterations -->
            <div class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">{{ t('advIterations') }}</span>
              <input
                type="number"
                min="10"
                max="100000000"
                step="10"
                :value="config.iterations"
                @change="patchConfig({ iterations: Math.max(10, Math.min(100000000, Number(($event.target as HTMLInputElement).value) || 300)) })"
                class="rounded-lg border border-[#263044] bg-[#131823] px-2.5 py-1.5 font-mono text-xs text-[#f8fafc]"
              />
              <div class="mt-1 flex flex-wrap gap-1">
                <button
                  v-for="presetIter in [100, 1000, 10000, 100000]"
                  :key="presetIter"
                  type="button"
                  @click="patchConfig({ iterations: presetIter })"
                  class="rounded border border-[#263044] px-1.5 py-0.5 font-mono text-[10px] font-semibold transition"
                  :class="config.iterations === presetIter ? 'bg-[#ff6b00] text-white border-[#ff6b00]' : 'bg-[#0c0f16] text-[#8a93a2] hover:text-[#f8fafc]'"
                >
                  {{ formatNumber(presetIter) }}
                </button>
              </div>
            </div>

            <!-- 10. maxTurns -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">
                {{ t('advMaxTurns', { n: config.maxTurns }) }}
              </span>
              <input
                type="range"
                min="1"
                max="20"
                step="1"
                :value="config.maxTurns"
                :style="{ '--range-pct': rangePct(config.maxTurns, 1, 20) }"
                @input="patchConfig({ maxTurns: Number(($event.target as HTMLInputElement).value) })"
                class="w-full cursor-pointer accent-[#ff6b00]"
              />
            </label>

            <!-- 11. fixedSeed -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">{{ t('advFixedSeed') }}</span>
              <input
                type="number"
                :placeholder="t('advFixedSeedPlaceholder')"
                :value="config.fixedSeed ?? ''"
                @input="handleSeedInput(($event.target as HTMLInputElement).value)"
                class="rounded-lg border border-[#263044] bg-[#131823] px-2.5 py-1.5 font-mono text-xs text-[#f8fafc]"
              />
            </label>
          </div>
        </div>

        <!-- Groupe C : Parallélisme & Ordonnancement -->
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-200 border-b border-[#263044] pb-2">
            {{ t('advGroupWorkersTitle') }}
          </h4>
          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <!-- 12. workerCount -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">
                {{ t('advWorkerCount', { n: config.workerCount, max: maxHardwareWorkers }) }}
              </span>
              <input
                type="range"
                min="1"
                :max="maxHardwareWorkers"
                step="1"
                :value="config.workerCount"
                :style="{ '--range-pct': rangePct(config.workerCount, 1, maxHardwareWorkers) }"
                @input="patchConfig({ workerCount: Number(($event.target as HTMLInputElement).value) })"
                class="w-full cursor-pointer accent-[#ff6b00]"
              />
            </label>

            <!-- 13. workerSchedulingMode -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">{{ t('advSchedulingMode') }}</span>
              <select
                :value="config.workerSchedulingMode ?? 'DYNAMIC_BATCHES'"
                @change="patchConfig({ workerSchedulingMode: ($event.target as HTMLSelectElement).value as WorkerSchedulingMode })"
                class="rounded-lg border border-[#263044] bg-[#131823] px-2.5 py-1.5 text-xs text-[#f8fafc]"
              >
                <option value="DYNAMIC_BATCHES">{{ t('schedDynamic') }}</option>
                <option value="STATIC_SHARDS">{{ t('schedStatic') }}</option>
              </select>
            </label>

            <!-- 14. batchSize -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">{{ t('advBatchSize') }}</span>
              <select
                :disabled="(config.workerSchedulingMode ?? 'DYNAMIC_BATCHES') !== 'DYNAMIC_BATCHES'"
                :value="config.batchSize ?? 25"
                @change="patchConfig({ batchSize: Number(($event.target as HTMLSelectElement).value) })"
                class="rounded-lg border border-[#263044] bg-[#131823] px-2.5 py-1.5 font-mono text-xs text-[#f8fafc] disabled:opacity-50"
              >
                <option :value="10">10 {{ t('gamesUnit') }}</option>
                <option :value="25">25 {{ t('gamesUnit') }}</option>
                <option :value="50">50 {{ t('gamesUnit') }}</option>
                <option :value="100">100 {{ t('gamesUnit') }}</option>
              </select>
            </label>
          </div>
        </div>

        <!-- Groupe D : Télémétrie & Stress-Tests -->
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-200 border-b border-[#263044] pb-2">
            {{ t('advGroupStatsTitle') }}
          </h4>
          <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <!-- collectDetailedTelemetry & stressTestOhkoEachTurn -->
            <div class="flex flex-col justify-center gap-3 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <label class="flex items-center gap-2 text-xs font-semibold text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  :checked="config.collectDetailedTelemetry !== false"
                  @change="patchConfig({ collectDetailedTelemetry: ($event.target as HTMLInputElement).checked })"
                  class="h-4 w-4 rounded border-[#263044] accent-[#ff6b00]"
                />
                <span>{{ t('advCollectTelemetry') }}</span>
              </label>
              <label class="flex items-center gap-2 text-xs font-semibold text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  :checked="Boolean(config.stressTestOhkoEachTurn)"
                  @change="patchConfig({ stressTestOhkoEachTurn: ($event.target as HTMLInputElement).checked })"
                  class="h-4 w-4 rounded border-[#263044] accent-[#ff6b00]"
                />
                <span>{{ t('advStressOhko') }}</span>
              </label>
            </div>

            <!-- perturbationType -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">{{ t('advPerturbation') }}</span>
              <select
                :value="config.perturbationType ?? 'NONE'"
                @change="patchConfig({ perturbationType: ($event.target as HTMLSelectElement).value as DebugPerturbationType })"
                class="rounded-lg border border-[#263044] bg-[#131823] px-2.5 py-1.5 text-xs text-[#f8fafc]"
              >
                <option value="NONE">{{ t('pertNone') }}</option>
                <option value="FORCE_OPPONENT_IONO">{{ t('pertIono') }}</option>
                <option value="FORCE_KO_ACTIVE">{{ t('pertKo') }}</option>
                <option value="FORCE_KEY_CARD_PRIZED">{{ t('pertPrized') }}</option>
              </select>
            </label>

            <!-- perturbationTurn -->
            <label class="flex flex-col gap-1.5 rounded-xl border border-[#263044] bg-[#131823] p-3.5">
              <span class="text-xs font-semibold text-slate-200">{{ t('advPerturbationTurn') }}</span>
              <input
                type="number"
                min="1"
                max="10"
                :disabled="(config.perturbationType ?? 'NONE') === 'NONE'"
                :value="config.perturbationTurn ?? 2"
                @change="patchConfig({ perturbationTurn: Math.max(1, Math.min(10, Number(($event.target as HTMLInputElement).value) || 2)) })"
                class="rounded-lg border border-[#263044] bg-[#131823] px-2.5 py-1.5 font-mono text-xs text-[#f8fafc] disabled:opacity-50"
              />
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- 2. INITIATIVE DU PREMIER TOUR -->
    <div class="rounded-2xl border border-[#263044] bg-[#131823] p-6 shadow-xs">
      <div class="border-b border-[#263044] pb-3">
        <h3 class="text-sm font-bold text-[#f8fafc]">
          {{ t('turnOrderTitle') }}
        </h3>
        <p class="mt-0.5 text-xs text-[#8a93a2]">
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
              ? 'border-[#ff6b00] bg-[#1b2232] text-[#f8fafc] ring-2 ring-[#ff6b00]/75 shadow-[0_0_20px_rgba(255,107,0,0.2)]'
              : 'border-[#263044] bg-[#0c0f16]/60 text-[#f8fafc] hover:border-[#ff8a00]/60 hover:bg-[#1b2232]',
          ]"
        >
          <span class="text-sm font-bold">{{ t('turnOrderRandom') }}</span>
          <span class="mt-1 text-xs text-[#8a93a2]">{{ t('turnOrderRandomDesc') }}</span>
        </button>

        <button
          type="button"
          @click="patchConfig({ firstPlayerMode: 'PLAYER' })"
          class="flex flex-col items-start rounded-xl border p-4 text-left transition"
          :class="[
            config.firstPlayerMode === 'PLAYER'
              ? 'border-[#ff6b00] bg-[#1b2232] text-[#f8fafc] ring-2 ring-[#ff6b00]/75 shadow-[0_0_20px_rgba(255,107,0,0.2)]'
              : 'border-[#263044] bg-[#0c0f16]/60 text-[#f8fafc] hover:border-[#ff8a00]/60 hover:bg-[#1b2232]',
          ]"
        >
          <span class="text-sm font-bold">{{ t('turnOrderFirst') }}</span>
          <span class="mt-1 text-xs text-[#8a93a2]">{{ t('turnOrderFirstDesc') }}</span>
        </button>

        <button
          type="button"
          @click="patchConfig({ firstPlayerMode: 'OPPONENT' })"
          class="flex flex-col items-start rounded-xl border p-4 text-left transition"
          :class="[
            config.firstPlayerMode === 'OPPONENT'
              ? 'border-[#ff6b00] bg-[#1b2232] text-[#f8fafc] ring-2 ring-[#ff6b00]/75 shadow-[0_0_20px_rgba(255,107,0,0.2)]'
              : 'border-[#263044] bg-[#0c0f16]/60 text-[#f8fafc] hover:border-[#ff8a00]/60 hover:bg-[#1b2232]',
          ]"
        >
          <span class="text-sm font-bold">{{ t('turnOrderSecond') }}</span>
          <span class="mt-1 text-xs text-[#8a93a2]">{{ t('turnOrderSecondDesc') }}</span>
        </button>
      </div>
    </div>

    <!-- 3. DECKS ADVERSES TOP META DU MOMENT -->
    <div class="rounded-2xl border border-[#263044] bg-[#131823] p-6 shadow-xs">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#263044] pb-3">
        <div>
          <h3 class="text-sm font-bold text-[#f8fafc]">
            {{ t('metaMatchupsTitle') }}
          </h3>
          <p class="mt-0.5 text-xs text-[#8a93a2]">
            {{ t('metaMatchupsSub') }}
          </p>
        </div>
        <button
          type="button"
          @click="selectAllOpponents"
          class="text-xs font-semibold text-[#38bdf8] hover:underline"
        >
          {{ t('selectAll') }}
        </button>
      </div>

      <div
        v-if="metaLoading"
        class="mt-4 flex items-center gap-3 rounded-xl border border-[#263044] bg-[#0c0f16] p-5 text-xs font-medium text-[#8a93a2]"
      >
        <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-transparent"></span>
        <span>{{ t('loadingMetaDecks') }}</span>
      </div>

      <div
        v-else-if="metaError"
        class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/45 bg-red-950/45 p-4 text-xs text-red-200"
      >
        <div>
          <div class="font-bold">{{ t('metaDecksErrorTitle') }}</div>
          <div class="mt-0.5 text-red-300">{{ metaError }}</div>
        </div>
        <button
          type="button"
          @click="emit('retry-meta-decks')"
          class="rounded-lg border border-red-500/45 bg-[#131823] px-3 py-1.5 text-xs font-bold text-red-200 shadow-2xs hover:bg-red-950/60"
        >
          {{ t('retryButton') }}
        </button>
      </div>

      <div
        v-else-if="metaOpponents.length === 0"
        class="mt-4 rounded-xl border border-amber-500/35 bg-amber-950/45 p-4 text-xs text-amber-200"
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
              ? 'border-[#ff6b00] bg-[#1b2232] ring-2 ring-[#ff6b00]/70 shadow-xs'
              : 'border-[#263044] bg-[#0c0f16]/60 text-[#8a93a2] opacity-80 hover:opacity-100 hover:bg-[#1b2232]',
          ]"
        >
          <div>
            <div class="flex items-center justify-between">
              <span class="rounded-md bg-[#1b2232] px-2 py-0.5 text-xs font-bold text-slate-200">
                {{ pickLocalizedField(opp.archetypeBadge, opp.archetypeBadgeEn) }}
              </span>
              <input
                type="checkbox"
                :checked="config.selectedOpponentIds.includes(opp.id)"
                class="h-4 w-4 rounded border-[#263044] text-[#f8fafc] focus:ring-[#ff6b00] pointer-events-none"
              />
            </div>

            <h4 class="mt-3 text-base font-bold text-[#f8fafc]">
              {{ pickLocalizedField(opp.name, opp.nameEn) }}
            </h4>
            <p class="mt-1 text-xs text-[#8a93a2]">
              {{ pickLocalizedField(opp.strategySubtitle, opp.strategySubtitleEn) }}
            </p>
          </div>

          <div class="mt-4 flex items-center justify-between gap-2.5 border-t border-[#263044] pt-3 text-xs text-[#8a93a2]">
            <CardFanThumbnail
              v-if="opp.keyThreatCards && opp.keyThreatCards.length > 0"
              :cards="opp.keyThreatCards"
              size="sm"
              @select="openOpponentCardsZoom(opp.keyThreatCards)"
            />
            <span class="truncate">{{ t('threatsLabel') }} : {{ pickLocalizedField(opp.keyThreats, opp.keyThreatsEn).slice(0, 2).join(', ') }}</span>
          </div>
        </div>
      </div>
    </div>

    <CardZoomModal
      :cards="zoomedOpponentCards"
      :is-open="zoomedOpponentCards.length > 0"
      @close="closeOpponentCardsZoom"
    />
  </div>
</template>
