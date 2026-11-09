<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EngineCardModel } from '../types/cardModel'
import type { ParsedDeck, ParsedDeckEntry } from '../types/deck'
import type {
  CardUsageMetrics,
  DeckCardContributionItem,
  SimulationMetricsSummary,
} from '../types/simulator'
import {
  findAlternativesForCard,
  type SmartAlternativeSuggestion,
} from '../core/alternativesFinder'
import { getAllCatalogModels, normalizeCardNameForMatch } from '../data/cardCatalog'
import { exportDeckToPtcgl } from '../utils/ptcglExporter'
import { getCardImageUrl } from '../utils/cardImage'
import { useI18n } from '../utils/i18n'
import CardZoomModal from './CardZoomModal.vue'
import DebugInspectorPanel from './DebugInspectorPanel.vue'

export interface DeckVersionEntry {
  id: string
  versionNumber: number
  label: string
  deck: ParsedDeck
  summary: SimulationMetricsSummary | null
  timestamp: number
  isBaseline: boolean
}

const props = withDefaults(
  defineProps<{
    baselineDeck: ParsedDeck
    editableDeck: ParsedDeck
    baselineSummary: SimulationMetricsSummary | null
    currentSummary: SimulationMetricsSummary | null
    isSimulating: boolean
    progressCompleted: number
    progressTotal: number
    progressElapsedMs: number
    isDebugMode: boolean
    deckVersions?: DeckVersionEntry[]
    activeVersionId?: string
  }>(),
  {
    deckVersions: () => [],
    activeVersionId: '',
  },
)

const emit = defineEmits<{
  (e: 'adjust-card-qty', cardId: string, delta: number): void
  (e: 'remove-card', cardId: string): void
  (e: 'add-catalog-card', model: EngineCardModel): void
  (e: 'replace-card-in-deck', oldCardId: string, newModel: EngineCardModel): void
  (e: 'rerun-and-compare'): void
  (e: 'select-version', versionId: string): void
  (e: 'save-as-new-version'): void
  (e: 'set-baseline-version', versionId: string): void
  (e: 'restore-version', versionId: string): void
  (e: 'back-step2'): void
  (e: 'cancel-simulation'): void
}>()

const { t, currentLang } = useI18n()

// Onglets de navigation dans l'Étape 3
type Step3Tab = 'overview' | 'detailed' | 'audit'
const activeTab = ref<Step3Tab>('overview')

const catalogSearchQuery = ref('')
const showExportModal = ref(false)
const exportLang = ref<'fr' | 'en'>(currentLang.value)
const copiedFeedback = ref(false)
const replacedCardFeedback = ref<string | null>(null)
const zoomedCard = ref<ParsedDeckEntry | EngineCardModel | null>(null)

const allCatalogModels = getAllCatalogModels()

const filteredCatalogModels = computed<EngineCardModel[]>(() => {
  const q = normalizeCardNameForMatch(catalogSearchQuery.value)
  if (!q) return allCatalogModels.slice(0, 8)
  return allCatalogModels
    .filter((m) => {
      const hay = normalizeCardNameForMatch(
        `${m.identity.nameFr} ${m.identity.nameEn || ''} ${m.cardId} ${m.subCategory}`,
      )
      return hay.includes(q)
    })
    .slice(0, 10)
})

const progressPercent = computed(() => {
  if (props.progressTotal <= 0) return 0
  return Math.min(100, Math.round((props.progressCompleted / props.progressTotal) * 100))
})

// Différences de cartes entre baselineDeck et editableDeck
const cardDiffItems = computed<DeckCardContributionItem[]>(() => {
  const map = new Map<
    string,
    {
      cardId: string
      nameFr: string
      category: 'pokemon' | 'trainer' | 'energy'
      oldQty: number
      newQty: number
    }
  >()

  for (const c of props.baselineDeck.cards) {
    const existing = map.get(c.cardId)
    if (existing) {
      existing.oldQty += c.quantity
    } else {
      map.set(c.cardId, {
        cardId: c.cardId,
        nameFr: c.nameFr,
        category: c.category,
        oldQty: c.quantity,
        newQty: 0,
      })
    }
  }

  for (const c of props.editableDeck.cards) {
    const existing = map.get(c.cardId)
    if (existing) {
      existing.newQty += c.quantity
    } else {
      map.set(c.cardId, {
        cardId: c.cardId,
        nameFr: c.nameFr,
        category: c.category,
        oldQty: 0,
        newQty: c.quantity,
      })
    }
  }

  const diffs: DeckCardContributionItem[] = []
  for (const item of map.values()) {
    const delta = item.newQty - item.oldQty
    if (delta !== 0) {
      diffs.push({
        ...item,
        deltaQty: delta,
      })
    }
  }
  return diffs.sort((a, b) => a.deltaQty - b.deltaQty)
})

const isDeckModified = computed(() => cardDiffItems.value.length > 0)

const hasCalculatedVariant = computed(() => {
  return (
    cardDiffItems.value.length > 0 &&
    props.currentSummary !== null &&
    props.editableDeck.totalCards === 60
  )
})

const hasComparisonRun = computed(() => {
  return (
    props.baselineSummary !== null &&
    props.currentSummary !== null &&
    props.baselineSummary !== props.currentSummary
  )
})

// Carte sélectionnée pour l'inspection
const selectedCardId = ref<string>(props.editableDeck.cards[0]?.cardId || '')

const selectedCardEntry = computed<ParsedDeckEntry | null>(() => {
  return (
    props.editableDeck.cards.find((c) => c.cardId === selectedCardId.value) ||
    props.editableDeck.cards[0] ||
    null
  )
})

// Alternatives suggérées pour la carte sélectionnée
const selectedCardAlternatives = computed<SmartAlternativeSuggestion[]>(() => {
  if (!selectedCardEntry.value) return []
  return findAlternativesForCard(selectedCardEntry.value.model, allCatalogModels)
})

// Dictionnaire du nombre d'alternatives disponibles pour chaque carte du deck
const cardAlternativesCountMap = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {}
  for (const entry of props.editableDeck.cards) {
    if (!map[entry.cardId]) {
      const alts = findAlternativesForCard(entry.model, allCatalogModels)
      map[entry.cardId] = alts.length
    }
  }
  return map
})

function selectCardForInspection(cardId: string) {
  selectedCardId.value = cardId
}

function handleReplaceWithAlternative(oldCardId: string, alt: SmartAlternativeSuggestion) {
  emit('replace-card-in-deck', oldCardId, alt.alternativeModel)
  selectedCardId.value = alt.alternativeCardId
  replacedCardFeedback.value = `${alt.targetCardNameFr} remplacé par ${alt.alternativeNameFr}.`
  setTimeout(() => {
    replacedCardFeedback.value = null
  }, 4000)
}

const compareButtonState = computed(() => {
  if (props.isSimulating) {
    return {
      disabled: true,
      label: `${t('simulatingProgress', { done: props.progressCompleted, total: props.progressTotal })} (${progressPercent.value} %)`,
      showSpinner: true,
    }
  }
  if (props.editableDeck.totalCards !== 60) {
    return {
      disabled: true,
      label: t('adjustDeckTo60', { n: props.editableDeck.totalCards }),
      showSpinner: false,
    }
  }
  return {
    disabled: false,
    label: isDeckModified.value ? t('testVariantAndCompare') : t('rerunSimulation'),
    showSpinner: false,
  }
})

const exportedPtcglText = computed(() => {
  return exportDeckToPtcgl(props.editableDeck.cards, {
    lang: exportLang.value,
    format: 'ptcgl',
    includeTotalCards: true,
  })
})

async function copyExportedDeck() {
  try {
    await navigator.clipboard.writeText(exportedPtcglText.value)
    copiedFeedback.value = true
    setTimeout(() => {
      copiedFeedback.value = false
    }, 2000)
  } catch {
    copiedFeedback.value = false
  }
}

function downloadExportedDeckTxt() {
  const blob = new Blob([exportedPtcglText.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `deck-optimise-60-${exportLang.value}.txt`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function getBaselineMatchupWinRate(opponentId: string): number | null {
  if (!props.baselineSummary) return null
  const m = props.baselineSummary.matchupBreakdown.find((x) => x.opponentId === opponentId)
  return m ? m.winRate : null
}

// Helpers de formatage statistiques (garantissent l'absence de multiplication intempestive par 100)
function formatRate(val: number | undefined | null, decimals = 1): string {
  if (val === undefined || val === null || isNaN(val)) return '0.0'
  return Number(val).toFixed(decimals)
}

function formatSignedDelta(delta: number | undefined | null, suffix = ''): string {
  if (delta === undefined || delta === null || isNaN(delta)) return `0.0${suffix}`
  const rounded = Math.round(Number(delta) * 10) / 10
  if (rounded > 0) return `+${rounded.toFixed(1)}${suffix}`
  return `${rounded.toFixed(1)}${suffix}`
}

function handleImgError(event: Event) {
  const target = event.target as HTMLElement
  if (target) {
    target.style.display = 'none'
  }
}

function openZoom(card: ParsedDeckEntry | EngineCardModel) {
  zoomedCard.value = card
}

function closeZoom() {
  zoomedCard.value = null
}

const sortedCardTelemetry = computed<CardUsageMetrics[]>(() => {
  if (!props.currentSummary || !props.currentSummary.cardTelemetry) return []
  const orderMap: Record<string, number> = {
    POKEMON: 1,
    TRAINER: 2,
    ENERGY: 3,
  }
  return Object.values(props.currentSummary.cardTelemetry).sort((a, b) => {
    const catDiff = (orderMap[a.category] ?? 9) - (orderMap[b.category] ?? 9)
    if (catDiff !== 0) return catDiff
    return b.effectivePlayRate - a.effectivePlayRate
  })
})
</script>

<template>
  <div class="space-y-6">
    <!-- FEEDBACK DE REMPLACEMENT TEMPORAIRE -->
    <div
      v-if="replacedCardFeedback"
      class="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs font-bold text-emerald-950 shadow-xs transition"
    >
      {{ replacedCardFeedback }}
    </div>

    <!-- 1. GRAND BANDEAU DE RESULTATS PRINCIPAL -->
    <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
      <div class="flex flex-wrap items-center justify-between gap-6">
        <div>
          <div class="flex items-center gap-2">
            <span class="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">
              {{ t('globalPerformance') }}
            </span>
            <span v-if="hasComparisonRun" class="rounded-lg bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-900">
              {{ t('comparedVariant') }}
            </span>
          </div>

          <div class="mt-3 flex items-baseline gap-4">
            <!-- Win rate global correctement normalisé (sans multiplication en double) -->
            <span class="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
              {{ formatRate(currentSummary?.globalWinRate) }} %
            </span>
            <span class="text-sm font-semibold text-slate-500">
              {{ t('globalWinRate') }}
            </span>

            <!-- Écart avec le deck initial si variante comparée -->
            <div
              v-if="hasComparisonRun && baselineSummary"
              class="flex items-center gap-1 rounded-xl px-3 py-1 text-sm font-bold shadow-2xs"
              :class="[
                currentSummary!.globalWinRate >= baselineSummary.globalWinRate
                  ? 'border border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border border-rose-300 bg-rose-50 text-rose-800',
              ]"
            >
              <span>{{ formatSignedDelta(currentSummary!.globalWinRate - baselineSummary.globalWinRate, ' %') }}</span>
              <span class="text-xs font-medium">{{ t('vsBaseline') }} ({{ formatRate(baselineSummary.globalWinRate) }} %)</span>
            </div>
          </div>

          <p class="mt-2 text-xs text-slate-500">
            {{ t('simulatedGamesCount', { n: currentSummary?.totalGamesSimulated ?? 0 }) }}
          </p>
        </div>

        <!-- Boutons d'action : Re-simuler, Enregistrer version et Exporter la variante -->
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            :disabled="compareButtonState.disabled"
            @click="emit('rerun-and-compare')"
            class="flex items-center gap-2 rounded-xl border border-slate-900 bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-xs transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:border-slate-300"
          >
            <span>{{ compareButtonState.label }}</span>
          </button>

          <!-- Bouton Sauvegarder comme nouvelle version -->
          <button
            v-if="isDeckModified && editableDeck.totalCards === 60"
            type="button"
            @click="emit('save-as-new-version')"
            class="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-xs transition hover:bg-slate-50"
            :title="t('saveAsNewVersion')"
          >
            <span>{{ t('saveAsNewVersion') }}</span>
          </button>

          <!-- Bouton Exporter la variante : visible UNIQUEMENT si au moins une variante a été calculée -->
          <button
            v-if="hasCalculatedVariant"
            type="button"
            @click="showExportModal = true"
            class="flex items-center gap-2 rounded-xl border border-indigo-600 bg-indigo-50 px-5 py-3 text-sm font-bold text-indigo-900 shadow-xs transition hover:bg-indigo-100"
          >
            <span>{{ t('exportPtcglVariant') }}</span>
          </button>
        </div>
      </div>

      <!-- Barre de progression de la simulation -->
      <div v-if="isSimulating" class="mt-6 border-t border-slate-100 pt-4">
        <div class="flex items-center justify-between text-xs font-semibold text-slate-700">
          <span>{{ t('simulatingProgress', { done: progressCompleted, total: progressTotal }) }}</span>
          <span>{{ progressPercent }} %</span>
        </div>
        <div class="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div class="h-full bg-indigo-600 transition-all duration-150" :style="{ width: `${progressPercent}%` }"></div>
        </div>
      </div>
    </div>

    <!-- 2. HISTORIQUE DES VERSIONS DU DECK -->
    <div v-if="deckVersions && deckVersions.length > 0" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700">
            {{ t('versionHistoryTitle') }}
          </h3>
          <span class="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
            {{ deckVersions.length }} version(s)
          </span>
        </div>
        <span class="text-xs text-slate-400">
          Cliquez sur une version pour charger ses cartes et ses statistiques
        </span>
      </div>

      <div class="mt-3 flex flex-wrap gap-2.5">
        <div
          v-for="v in deckVersions"
          :key="v.id"
          @click="emit('select-version', v.id)"
          class="flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 transition"
          :class="[
            activeVersionId === v.id
              ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
              : 'border-slate-200 bg-slate-50/60 text-slate-800 hover:border-slate-400 hover:bg-white',
          ]"
        >
          <div class="flex items-center gap-1.5 font-bold text-xs">
            <span>{{ v.label }}</span>
            <span
              v-if="v.isBaseline"
              class="rounded px-1.5 py-0.2 text-[10px]"
              :class="activeVersionId === v.id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'"
            >
              Réf
            </span>
          </div>

          <!-- Taux de victoire de cette version si simulée -->
          <span
            v-if="v.summary"
            class="rounded px-2 py-0.5 font-mono text-[11px] font-black"
            :class="[
              activeVersionId === v.id
                ? 'bg-emerald-400 text-slate-950'
                : 'bg-emerald-100 text-emerald-900',
            ]"
          >
            {{ formatRate(v.summary.globalWinRate) }} %
          </span>

          <!-- Actions de gestion de la version active -->
          <div v-if="activeVersionId === v.id" class="flex items-center gap-1 ml-1" @click.stop>
            <button
              v-if="!v.isBaseline"
              type="button"
              @click="emit('set-baseline-version', v.id)"
              class="rounded bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-white/30"
              :title="t('setAsBaseline')"
            >
              {{ t('setAsBaseline') }}
            </button>
            <button
              type="button"
              @click="emit('restore-version', v.id)"
              class="rounded bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-white/30"
              :title="t('restoreVersion')"
            >
              {{ t('restoreVersion') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. DETAIL PAR MATCHUP (TOP 3 META) -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div
        v-for="m in currentSummary?.matchupBreakdown || []"
        :key="m.opponentId"
        class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
      >
        <div class="flex items-center justify-between">
          <span class="rounded-md bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
            {{ m.archetypeTag }}
          </span>

          <span
            v-if="hasComparisonRun && getBaselineMatchupWinRate(m.opponentId) !== null"
            class="text-xs font-bold"
            :class="m.winRate >= getBaselineMatchupWinRate(m.opponentId)! ? 'text-emerald-700' : 'text-rose-700'"
          >
            {{ formatSignedDelta(m.winRate - getBaselineMatchupWinRate(m.opponentId)!, ' %') }}
          </span>
        </div>

        <h3 class="mt-2 text-base font-bold text-slate-900 truncate">
          {{ m.opponentName }}
        </h3>

        <div class="mt-3 flex items-baseline justify-between">
          <span class="text-2xl font-black" :class="m.winRate >= 50 ? 'text-emerald-700' : 'text-amber-800'">
            {{ formatRate(m.winRate) }} %
          </span>
          <span class="text-xs text-slate-500 font-medium">
            {{ m.wins }}V - {{ m.losses }}D ({{ m.gamesPlayed }} parties)
          </span>
        </div>

        <!-- Jauge visuelle de victoire (correctement ramenée à 0..100) -->
        <div class="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            class="h-full rounded-full transition-all"
            :class="m.winRate >= 50 ? 'bg-emerald-600' : m.winRate >= 40 ? 'bg-amber-500' : 'bg-rose-500'"
            :style="{ width: `${Math.min(100, Math.max(0, m.winRate))}%` }"
          ></div>
        </div>
      </div>
    </div>

    <!-- 4. BARRE D'ONGLETS POUR RESTAURER TOUTES LES INFORMATIONS STATISTIQUES -->
    <div class="flex border-b border-slate-200">
      <button
        type="button"
        @click="activeTab = 'overview'"
        class="border-b-2 px-5 py-3 text-xs font-bold transition"
        :class="activeTab === 'overview' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'"
      >
        {{ t('tabOverview') }}
      </button>
      <button
        type="button"
        @click="activeTab = 'detailed'"
        class="border-b-2 px-5 py-3 text-xs font-bold transition"
        :class="activeTab === 'detailed' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'"
      >
        {{ t('tabDetailedStats') }}
      </button>
      <button
        type="button"
        @click="activeTab = 'audit'"
        class="border-b-2 px-5 py-3 text-xs font-bold transition"
        :class="activeTab === 'audit' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'"
      >
        {{ t('tabCardAudit') }}
      </button>
    </div>

    <!-- CONTENU ONGLETS -->

    <!-- VUE A : VUE D'ENSEMBLE (INDICATEURS DE BASE + ATELIER) -->
    <div v-show="activeTab === 'overview'" class="space-y-6">
      <!-- Indicateurs Clés de Stabilité & Efficacité -->
      <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div class="mb-4">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700">
            {{ t('kpiSectionTitle') }}
          </h3>
          <p class="mt-1 text-xs text-slate-500">
            {{ t('kpiSectionSub') }}
          </p>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <!-- KPI 1 : Vitesse de Setup -->
          <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div class="text-xs font-bold text-slate-600">{{ t('kpiSetupSpeed') }}</div>
            <div class="mt-2 text-2xl font-black text-slate-900">
              {{ formatRate(currentSummary?.turn2AttackerReadyRate) }} %
            </div>
            <p class="mt-1 text-[11px] text-slate-500">
              {{ t('kpiSetupSpeedDesc') }}
            </p>
          </div>

          <!-- KPI 2 : Enchaînement des Attaquants -->
          <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div class="text-xs font-bold text-slate-600">{{ t('kpiAttackStreaming') }}</div>
            <div class="mt-2 text-2xl font-black text-slate-900">
              {{ formatRate(currentSummary?.attackerStreamingRate) }} %
            </div>
            <p class="mt-1 text-[11px] text-slate-500">
              {{ t('kpiAttackStreamingDesc') }}
            </p>
          </div>

          <!-- KPI 3 : Résilience aux Perturbations -->
          <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div class="text-xs font-bold text-slate-600">{{ t('kpiDisruptionResilience') }}</div>
            <div class="mt-2 text-2xl font-black text-slate-900">
              {{ formatRate(currentSummary?.postDisruptionResilience?.postDisruptionAttackRate) }} %
            </div>
            <p class="mt-1 text-[11px] text-slate-500">
              {{ t('kpiDisruptionResilienceDesc') }}
            </p>
          </div>

          <!-- KPI 4 : Flexibilité Ordres du Boss -->
          <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div class="text-xs font-bold text-slate-600">{{ t('kpiBossFlexibility') }}</div>
            <div class="mt-2 text-2xl font-black text-slate-900">
              {{ formatRate(currentSummary?.bossFlexibilityRate) }} %
            </div>
            <p class="mt-1 text-[11px] text-slate-500">
              {{ t('kpiBossFlexibilityDesc') }}
            </p>
          </div>
        </div>
      </div>

      <!-- ATELIER D'OPTIMISATION A/B (COMPARATEUR DE CARTES) -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <!-- Colonne Gauche : Composition du deck modifiable -->
        <div class="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-5">
          <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 class="text-sm font-bold text-slate-900">{{ t('deckComposition') }}</h3>
              <p class="text-xs text-slate-500">{{ t('clickCardForAlternatives') }}</p>
            </div>
            <span
              class="rounded-lg border px-2.5 py-1 text-xs font-bold"
              :class="
                editableDeck.totalCards === 60
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              "
            >
              {{ editableDeck.totalCards }} / 60
            </span>
          </div>

          <!-- Liste des cartes avec indicateur visuel d'alternatives disponibles -->
          <div class="max-h-[560px] space-y-2 overflow-y-auto pr-1">
            <div
              v-for="card in editableDeck.cards"
              :key="card.uid"
              @click="selectCardForInspection(card.cardId)"
              class="flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-2.5 transition"
              :class="[
                selectedCardId === card.cardId
                  ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                  : 'border-slate-100 bg-slate-50/60 text-slate-800 hover:border-slate-300 hover:bg-slate-100/70',
              ]"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <!-- Miniature de la carte avec zoom au clic -->
                <img
                  v-if="getCardImageUrl(card)"
                  :src="getCardImageUrl(card)!"
                  :alt="card.nameFr"
                  loading="lazy"
                  @error="handleImgError"
                  @click.stop="openZoom(card)"
                  class="h-12 w-8 shrink-0 rounded object-cover shadow-2xs border cursor-zoom-in hover:opacity-90 transition"
                  :class="selectedCardId === card.cardId ? 'border-white/30' : 'border-slate-200'"
                  :title="t('clickToEnlarge')"
                />
                <div
                  v-else
                  class="flex h-12 w-8 shrink-0 items-center justify-center rounded bg-slate-200 text-[10px] font-bold text-slate-600"
                >
                  {{ card.category.slice(0, 3).toUpperCase() }}
                </div>

                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="truncate text-xs font-bold">
                      {{ card.nameFr }}
                    </span>

                    <!-- INDICATEUR VISUEL D'ALTERNATIVES SUGGÉRÉES (BADGE) -->
                    <span
                      v-if="cardAlternativesCountMap[card.cardId] && cardAlternativesCountMap[card.cardId] > 0"
                      class="rounded-full px-1.5 py-0.2 text-[9px] font-bold shrink-0"
                      :class="[
                        selectedCardId === card.cardId
                          ? 'bg-indigo-400 text-slate-950'
                          : 'bg-indigo-100 text-indigo-800',
                      ]"
                    >
                      {{ t('altCountBadge', { n: cardAlternativesCountMap[card.cardId] }) }}
                    </span>
                  </div>

                  <div
                    class="text-[10px]"
                    :class="selectedCardId === card.cardId ? 'text-slate-300' : 'text-slate-500'"
                  >
                    {{ card.subCategory }}
                  </div>
                </div>
              </div>

              <!-- Contrôles de quantité (+ / -) -->
              <div class="flex items-center gap-1 shrink-0" @click.stop>
                <button
                  type="button"
                  @click="emit('adjust-card-qty', card.cardId, -1)"
                  class="flex h-7 w-7 items-center justify-center rounded-lg border font-bold text-xs transition"
                  :class="selectedCardId === card.cardId ? 'border-white/30 bg-white/10 text-white hover:bg-white/20' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-200'"
                >
                  -
                </button>
                <span class="w-6 text-center font-bold text-xs">
                  {{ card.quantity }}
                </span>
                <button
                  type="button"
                  @click="emit('adjust-card-qty', card.cardId, 1)"
                  class="flex h-7 w-7 items-center justify-center rounded-lg border font-bold text-xs transition"
                  :class="selectedCardId === card.cardId ? 'border-white/30 bg-white/10 text-white hover:bg-white/20' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-200'"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <!-- Recherche et ajout d'une nouvelle carte -->
          <div class="mt-4 border-t border-slate-100 pt-3">
            <input
              v-model="catalogSearchQuery"
              type="text"
              :placeholder="t('searchAddCard')"
              class="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
            />

            <div v-if="catalogSearchQuery.trim()" class="mt-2 max-h-40 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              <div
                v-for="model in filteredCatalogModels"
                :key="model.cardId"
                class="flex items-center justify-between p-2 text-xs hover:bg-slate-50"
              >
                <div class="flex items-center gap-2 truncate">
                  <img
                    v-if="getCardImageUrl(model)"
                    :src="getCardImageUrl(model)!"
                    :alt="model.identity.nameFr"
                    loading="lazy"
                    @error="handleImgError"
                    @click.stop="openZoom(model)"
                    class="h-8 w-6 shrink-0 rounded object-cover cursor-zoom-in"
                  />
                  <span class="truncate font-semibold text-slate-800">{{ model.identity.nameFr }}</span>
                </div>
                <button
                  type="button"
                  @click="emit('add-catalog-card', model)"
                  class="rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-bold text-white hover:bg-slate-800"
                >
                  {{ t('addCard') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Colonne Droite : Fiche de la carte sélectionnée & Alternatives -->
        <div class="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-7">
          <!-- Fiche de la carte sélectionnée -->
          <div v-if="selectedCardEntry" class="mb-5 flex items-start gap-4 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
            <!-- Image agrandie avec zoom au clic -->
            <img
              v-if="getCardImageUrl(selectedCardEntry)"
              :src="getCardImageUrl(selectedCardEntry)!"
              :alt="selectedCardEntry.nameFr"
              loading="lazy"
              @error="handleImgError"
              @click="openZoom(selectedCardEntry)"
              class="h-28 w-20 shrink-0 rounded-lg object-cover shadow-sm border border-slate-200 cursor-zoom-in hover:opacity-90 transition"
              :title="t('clickToEnlarge')"
            />
            <div
              v-else
              class="flex h-28 w-20 shrink-0 items-center justify-center rounded-lg bg-slate-200 font-bold text-slate-500 text-xs"
            >
              CARTE
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="rounded bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">
                  {{ selectedCardEntry.quantity }}×
                </span>
                <h4 class="text-base font-bold text-slate-900">
                  {{ selectedCardEntry.nameFr }}
                </h4>
              </div>

              <div class="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                <span class="font-medium text-slate-700">{{ selectedCardEntry.subCategory }}</span>
                <span>•</span>
                <span>{{ selectedCardEntry.setCode }} {{ selectedCardEntry.number }}</span>
                <span v-if="selectedCardEntry.model.pokemonStats?.hp">• {{ selectedCardEntry.model.pokemonStats.hp }} {{ t('cardHp') }}</span>
              </div>

              <p class="mt-2 text-xs leading-relaxed text-slate-600">
                {{ selectedCardEntry.model.identity.rawRulesText?.join(' ') || 'Carte sans effet de règles particulier.' }}
              </p>
            </div>
          </div>

          <!-- Liste des alternatives recommandées (AFFICHE RIEN si aucune alternative selon la demande utilisateur) -->
          <div v-if="selectedCardAlternatives.length > 0">
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700">
              {{ t('suggestedAlternatives') }}
            </h4>

            <div class="mt-3 space-y-3">
              <div
                v-for="alt in selectedCardAlternatives.slice(0, 4)"
                :key="alt.alternativeCardId"
                class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs transition hover:border-slate-300"
              >
                <div class="flex items-center gap-3 min-w-0">
                  <!-- Miniature alternative avec zoom au clic -->
                  <img
                    v-if="getCardImageUrl(alt.alternativeModel)"
                    :src="getCardImageUrl(alt.alternativeModel)!"
                    :alt="alt.alternativeNameFr"
                    loading="lazy"
                    @error="handleImgError"
                    @click="openZoom(alt.alternativeModel)"
                    class="h-16 w-11 shrink-0 rounded object-cover shadow-2xs border border-slate-200 cursor-zoom-in hover:opacity-90 transition"
                    :title="t('clickToEnlarge')"
                  />
                  <div
                    v-else
                    class="flex h-16 w-11 shrink-0 items-center justify-center rounded bg-slate-200 font-bold text-slate-500 text-[10px]"
                  >
                    ALT
                  </div>

                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-bold text-slate-900 truncate">
                        {{ alt.alternativeNameFr }}
                      </span>
                      <span class="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                        {{ alt.actionEconomyBadge }}
                      </span>
                    </div>

                    <p class="mt-1 text-xs text-slate-600 line-clamp-2">
                      {{ alt.strategicReason }}
                    </p>
                  </div>
                </div>

                <!-- Bouton de remplacement en 1 clic -->
                <button
                  type="button"
                  @click="handleReplaceWithAlternative(selectedCardEntry!.cardId, alt)"
                  class="shrink-0 rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
                >
                  {{ t('replaceInDeck') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- VUE B : STATISTIQUES DÉTAILLÉES (RESTITUTION INTÉGRALE) -->
    <div v-show="activeTab === 'detailed'" class="space-y-6">
      <!-- 1. Ordre du Tour & Pression T1 -->
      <div v-if="currentSummary?.turnOrderSplitStats" class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div class="border-b border-slate-100 pb-3">
          <h3 class="text-sm font-bold text-slate-900">
            {{ t('turnOrderHeader') }}
          </h3>
          <p class="text-xs text-slate-500">
            {{ t('turnOrderSub') }}
          </p>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div class="text-xs font-bold text-slate-600">{{ t('winRateJ1') }}</div>
            <div class="mt-2 text-2xl font-black text-slate-900">
              {{ formatRate(currentSummary.turnOrderSplitStats.winRateGoingFirst) }} %
            </div>
            <p class="mt-1 text-xs text-slate-500 font-mono">
              {{ currentSummary.turnOrderSplitStats.winsGoingFirst }}V / {{ currentSummary.turnOrderSplitStats.gamesGoingFirst }} parties
            </p>
          </div>

          <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div class="text-xs font-bold text-slate-600">{{ t('winRateJ2') }}</div>
            <div class="mt-2 text-2xl font-black text-indigo-700">
              {{ formatRate(currentSummary.turnOrderSplitStats.winRateGoingSecond) }} %
            </div>
            <p class="mt-1 text-xs text-slate-500 font-mono">
              {{ currentSummary.turnOrderSplitStats.winsGoingSecond }}V / {{ currentSummary.turnOrderSplitStats.gamesGoingSecond }} parties
            </p>
          </div>

          <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div class="text-xs font-bold text-slate-600">{{ t('turn1AttackLockJ2') }}</div>
            <div class="mt-2 text-2xl font-black text-slate-900">
              {{ formatRate(currentSummary.turnOrderSplitStats.turn1AttackOrItemLockRateJ2) }} %
            </div>
            <p class="mt-1 text-[11px] text-slate-500">
              {{ t('turn1ItemLockDesc') }} {{ formatRate(currentSummary.turnOrderSplitStats.turn1ItemLockRateJ2) }} %
            </p>
          </div>

          <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div class="text-xs font-bold text-slate-600">{{ t('avgDamagePerTurn') }}</div>
            <div class="mt-2 text-2xl font-black text-slate-900">
              {{ currentSummary.averageDamagePerTurn }} dégâts
            </div>
            <p class="mt-1 text-[11px] text-slate-500">
              Moyenne infligée par tour actif
            </p>
          </div>
        </div>
      </div>

      <!-- 2. Économie de Récompenses & Régularité -->
      <div v-if="currentSummary" class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div class="border-b border-slate-100 pb-3">
          <h3 class="text-sm font-bold text-slate-900">
            {{ t('prizeMulliganHeader') }}
          </h3>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div class="text-xs font-bold text-slate-600">{{ t('avgPlayerPrizes') }}</div>
            <div class="mt-2 text-2xl font-black text-emerald-700">
              {{ formatRate(currentSummary.avgPlayerPrizesWon, 2) }} / 6.00
            </div>
            <p class="mt-1 text-[11px] text-slate-500">
              {{ t('netPrizeDifferential') }}
              <strong :class="currentSummary.avgPlayerPrizesWon - currentSummary.avgOpponentPrizesWon >= 0 ? 'text-emerald-700' : 'text-rose-700'">
                {{ formatSignedDelta(currentSummary.avgPlayerPrizesWon - currentSummary.avgOpponentPrizesWon) }}
              </strong>
            </p>
          </div>

          <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div class="text-xs font-bold text-slate-600">{{ t('avgOpponentPrizes') }}</div>
            <div class="mt-2 text-2xl font-black text-rose-700">
              {{ formatRate(currentSummary.avgOpponentPrizesWon, 2) }} / 6.00
            </div>
            <p class="mt-1 text-[11px] text-slate-500">
              {{ t('prizesConcededPerMatch') }}
            </p>
          </div>

          <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div class="text-xs font-bold text-slate-600">{{ t('mulliganRate') }}</div>
            <div class="mt-2 text-2xl font-black text-slate-900">
              {{ formatRate(currentSummary.gamesWithMulliganRate) }} %
            </div>
            <p class="mt-1 text-[11px] text-slate-500">
              {{ currentSummary.gamesWithMulliganCount }} {{ t('gamesWithMulligan') }}
            </p>
          </div>

          <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <div class="text-xs font-bold text-slate-600">{{ t('avgTurnsPerGame') }}</div>
            <div class="mt-2 text-2xl font-black text-slate-900">
              {{ currentSummary.avgTurnsPlayed }} tours
            </div>
            <p class="mt-1 text-[11px] text-slate-500 font-mono">
              {{ currentSummary.gamesPerSecond }} parties / sec
            </p>
          </div>
        </div>
      </div>

      <!-- 3. Combos Conditionnels & Attaques Clés -->
      <div v-if="currentSummary?.conditionalComboStats && currentSummary.conditionalComboStats.length > 0" class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div class="border-b border-slate-100 pb-3">
          <h3 class="text-sm font-bold text-slate-900">
            {{ t('conditionalCombosHeader') }}
          </h3>
        </div>

        <div class="mt-4 overflow-x-auto">
          <table class="w-full border-collapse text-left text-xs">
            <thead>
              <tr class="border-b border-slate-200 bg-slate-50 font-mono text-[11px] uppercase text-slate-500">
                <th class="px-3.5 py-2.5">{{ t('comboCardAction') }}</th>
                <th class="px-3.5 py-2.5">{{ t('comboCondition') }}</th>
                <th class="px-3.5 py-2.5">{{ t('comboTriggerRate') }}</th>
                <th class="px-3.5 py-2.5">{{ t('comboFirstTurn') }}</th>
                <th class="px-3.5 py-2.5">{{ t('comboAvgDamage') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr
                v-for="combo in currentSummary.conditionalComboStats"
                :key="combo.comboId"
                class="hover:bg-slate-50/80"
              >
                <td class="px-3.5 py-2.5 font-bold text-slate-900">{{ combo.label }}</td>
                <td class="px-3.5 py-2.5">
                  <span class="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                    {{ combo.conditionSummary }}
                  </span>
                </td>
                <td class="px-3.5 py-2.5 font-mono font-bold text-emerald-700">
                  {{ formatRate(combo.triggerRate) }} %
                </td>
                <td class="px-3.5 py-2.5 font-mono text-slate-700">
                  {{ combo.avgTriggerTurn > 0 ? `T${formatRate(combo.avgTriggerTurn)}` : '—' }}
                </td>
                <td class="px-3.5 py-2.5 font-mono font-bold text-slate-900">
                  {{ combo.avgDamageWhenTriggered > 0 ? `${combo.avgDamageWhenTriggered} dég.` : 'Effet' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- VUE C : AUDIT D'UTILITÉ CARTE PAR CARTE -->
    <div v-show="activeTab === 'audit'" class="space-y-6">
      <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div class="border-b border-slate-100 pb-3">
          <h3 class="text-sm font-bold text-slate-900">
            {{ t('cardAuditHeader') }}
          </h3>
          <p class="text-xs text-slate-500">
            {{ t('cardAuditSub') }}
          </p>
        </div>

        <div class="mt-4 overflow-x-auto">
          <table class="w-full border-collapse text-left text-xs">
            <thead>
              <tr class="border-b border-slate-200 bg-slate-50 font-mono text-[11px] uppercase text-slate-500">
                <th class="px-3.5 py-2.5">{{ t('colCard') }}</th>
                <th class="px-3.5 py-2.5">{{ t('colPlayRate') }}</th>
                <th class="px-3.5 py-2.5">{{ t('colDeadDiscardRate') }}</th>
                <th class="px-3.5 py-2.5">{{ t('colPrizedImpact') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr
                v-for="item in sortedCardTelemetry"
                :key="item.cardId"
                class="hover:bg-slate-50/80 transition"
              >
                <!-- Carte -->
                <td class="px-3.5 py-3">
                  <div class="flex items-center gap-2">
                    <span class="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                      {{ item.quantityInDeck }}×
                    </span>
                    <div>
                      <div class="font-bold text-slate-900">{{ item.nameFr }}</div>
                      <div class="font-mono text-[10px] text-slate-400">
                        {{ item.cardId }} • {{ item.subCategory }}
                      </div>
                    </div>
                  </div>
                </td>

                <!-- Taux de Jeu Effectif -->
                <td class="px-3.5 py-3">
                  <div class="flex items-center gap-2">
                    <span class="w-12 font-mono text-xs font-bold text-emerald-700">
                      {{ formatRate(item.effectivePlayRate) }} %
                    </span>
                    <div class="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                      <div
                        class="h-full rounded-full bg-emerald-500"
                        :style="{ width: `${Math.min(100, Math.max(0, item.effectivePlayRate))}%` }"
                      ></div>
                    </div>
                    <span class="font-mono text-[10px] text-slate-400">
                      (Vue: {{ formatRate(item.drawnRate, 0) }} %)
                    </span>
                  </div>
                </td>

                <!-- Carte Morte / Défaussée -->
                <td class="px-3.5 py-3">
                  <div class="flex items-center gap-2">
                    <span
                      class="w-12 font-mono text-xs font-bold"
                      :class="
                        item.discardedUnusedRate + item.deadHandTurnRate >= 25
                          ? 'text-rose-700'
                          : item.discardedUnusedRate + item.deadHandTurnRate >= 10
                            ? 'text-amber-700'
                            : 'text-slate-600'
                      "
                    >
                      {{ formatRate(item.discardedUnusedRate) }} %
                    </span>
                    <div class="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                      <div
                        class="h-full rounded-full"
                        :class="item.discardedUnusedRate >= 25 ? 'bg-rose-500' : 'bg-amber-500'"
                        :style="{ width: `${Math.min(100, Math.max(0, item.discardedUnusedRate + item.deadHandTurnRate))}%` }"
                      ></div>
                    </div>
                    <span class="font-mono text-[10px] text-slate-500">
                      ({{ item.turnsStuckDeadInHand }}t bloquée)
                    </span>
                  </div>
                </td>

                <!-- Impact Prized -->
                <td class="px-3.5 py-3 font-mono text-xs">
                  <div v-if="item.gamesAllCopiesPrized > 0" class="flex items-center gap-1.5">
                    <span class="text-slate-700">{{ formatRate(item.allCopiesPrizedRate) }} % des parties</span>
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                      :class="
                        item.winRateImpactWhenAllPrized < 0
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-slate-100 text-slate-700'
                      "
                    >
                      WR: {{ formatSignedDelta(item.winRateImpactWhenAllPrized, ' %') }}
                    </span>
                  </div>
                  <span v-else class="text-[11px] text-slate-400">
                    0 % (Jamais 100% Prized)
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- MODAL D'EXPORT PTCGL (VISIBLE UNIQUEMENT SI DEMANDÉ) -->
    <div
      v-if="showExportModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
    >
      <div class="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div class="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-base font-bold text-slate-900">
            {{ t('exportModalTitle') }}
          </h3>
          <button
            type="button"
            @click="showExportModal = false"
            class="text-slate-400 hover:text-slate-600 font-bold text-lg"
          >
            ×
          </button>
        </div>

        <div class="mt-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-slate-500">{{ t('formatReadyForPtcgl') }}</span>
            <div class="flex gap-2">
              <button
                type="button"
                @click="exportLang = 'fr'"
                class="rounded px-2 py-0.5 text-xs font-bold"
                :class="exportLang === 'fr' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'"
              >
                FR
              </button>
              <button
                type="button"
                @click="exportLang = 'en'"
                class="rounded px-2 py-0.5 text-xs font-bold"
                :class="exportLang === 'en' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'"
              >
                EN
              </button>
            </div>
          </div>

          <textarea
            :value="exportedPtcglText"
            readonly
            rows="12"
            class="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 focus:outline-none"
          ></textarea>

          <div class="mt-4 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              @click="downloadExportedDeckTxt"
              class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              {{ t('downloadTxt') }}
            </button>
            <button
              type="button"
              @click="copyExportedDeck"
              class="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
            >
              {{ copiedFeedback ? t('copiedSuccess') : t('copyClipboard') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- MODAL DE ZOOM SUR CARTE (LIGHTBOX HAUTE RÉSOLUTION) -->
    <CardZoomModal
      :card="zoomedCard"
      :is-open="zoomedCard !== null"
      @close="closeZoom"
    />

    <!-- PANNEAU TECHNIQUE DE DEBUG (UNIQUEMENT SI ?debug=true) -->
    <DebugInspectorPanel
      v-if="isDebugMode && currentSummary"
      :traced-games="currentSummary.tracedGames"
    />
  </div>
</template>
