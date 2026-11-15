<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CardCategory, CardSubCategory, EngineCardModel } from '@olydor/types'
import type { MetaOpponentDeck, ParsedDeck, ParsedDeckEntry } from '@olydor/types'
import type {
  CardUsageMetrics,
  ConditionalComboStatRecord,
  DeckCardContributionItem,
  SimulationMetricsSummary,
} from '@olydor/types'
import type { SmartAlternativeSuggestion } from '@olydor/types'
import { UNIFIED_CARD_REGISTRY } from '@olydor/engine'
import { resolvePlatformUrls } from '@olydor/ui'
import { ApiError, fetchAlternativesFromApi, searchCatalogCards } from '../services/apiClient'
import { encodeDeckForUrl, exportDeckToPtcgl } from '@olydor/engine'
import { getCardImageUrl } from '../utils/cardImage'
import { useI18n } from '../utils/i18n'
import CardFanThumbnail from './CardFanThumbnail.vue'
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
    deckVersions?: DeckVersionEntry[]
    activeVersionId?: string
    metaOpponents?: MetaOpponentDeck[]
    isDebugMode?: boolean
    arenaUrl?: string
  }>(),
  {
    deckVersions: () => [],
    isDebugMode: false,
    arenaUrl: undefined,
    activeVersionId: '',
    metaOpponents: () => [],
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
  (e: 'back-step2'): void
  (e: 'cancel-simulation'): void
}>()

const { t, currentLang, pickLocalizedField, getLocalizedCardName, getLocalizedCardRules, getLocalizedSubCategory } = useI18n()

// Onglets de navigation dans l'Étape 3
type Step3Tab = 'overview' | 'detailed' | 'audit'
const activeTab = ref<Step3Tab>('overview')

const catalogSearchQuery = ref('')
const searchResults = ref<EngineCardModel[]>([])
const searchTotal = ref(0)
const searchLoading = ref(false)
const searchError = ref<string | null>(null)
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
let searchAbortController: AbortController | null = null

const showExportModal = ref(false)
const exportLang = ref<'fr' | 'en'>(currentLang.value)
const copiedFeedback = ref(false)
const replacedCardFeedback = ref<string | null>(null)
const zoomedCard = ref<ParsedDeckEntry | EngineCardModel | null>(null)
const zoomedCards = ref<Array<ParsedDeckEntry | EngineCardModel>>([])
const zoomInitialIndex = ref<number>(0)

async function executeCatalogSearch(query: string) {
  if (searchAbortController) {
    searchAbortController.abort()
  }
  const trimmed = query.trim()
  if (trimmed.length < 2) {
    searchResults.value = []
    searchTotal.value = 0
    searchLoading.value = false
    searchError.value = null
    return
  }

  const controller = new AbortController()
  searchAbortController = controller
  searchLoading.value = true
  searchError.value = null

  try {
    const res = await searchCatalogCards({
      q: trimmed,
      limit: 15,
      offset: 0,
      signal: controller.signal,
    })
    if (searchAbortController !== controller) return
    searchResults.value = res.items
    searchTotal.value = res.total
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    if (searchAbortController !== controller) return
    searchResults.value = []
    searchTotal.value = 0
    searchError.value = err instanceof ApiError ? err.message : t('searchCatalogError')
  } finally {
    if (searchAbortController === controller) {
      searchLoading.value = false
    }
  }
}

watch(catalogSearchQuery, (newVal) => {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
  const trimmed = newVal.trim()
  if (trimmed.length < 2) {
    if (searchAbortController) {
      searchAbortController.abort()
      searchAbortController = null
    }
    searchResults.value = []
    searchTotal.value = 0
    searchLoading.value = false
    searchError.value = null
    return
  }
  searchLoading.value = true
  searchError.value = null
  searchDebounceTimer = setTimeout(() => {
    void executeCatalogSearch(trimmed)
  }, 260)
})

const filteredCatalogModels = computed<EngineCardModel[]>(() => searchResults.value)

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

// Alternatives suggérées via POST /api/cards/alternatives (cache client par cardId)
const alternativesByCardId = ref<Record<string, SmartAlternativeSuggestion[]>>({})
const alternativesLoading = ref(false)
const alternativesError = ref<string | null>(null)
let alternativesAbortController: AbortController | null = null

const deckUniqueCardIds = computed<string[]>(() => {
  const seen = new Set<string>()
  for (const entry of props.editableDeck.cards) {
    if (entry.cardId) seen.add(entry.cardId)
  }
  return Array.from(seen).sort()
})

async function loadAlternativesForDeck(forceReload = false) {
  const allIds = deckUniqueCardIds.value
  const missingIds = forceReload
    ? allIds
    : allIds.filter((id) => !Object.prototype.hasOwnProperty.call(alternativesByCardId.value, id))

  if (missingIds.length === 0) {
    alternativesError.value = null
    return
  }

  if (alternativesAbortController) {
    alternativesAbortController.abort()
  }
  const controller = new AbortController()
  alternativesAbortController = controller
  alternativesLoading.value = true
  alternativesError.value = null

  try {
    const res = await fetchAlternativesFromApi({
      cardIds: missingIds,
      limitPerCard: 10,
      signal: controller.signal,
    })
    if (alternativesAbortController !== controller) return
    const nextCache = { ...alternativesByCardId.value }
    for (const id of missingIds) {
      nextCache[id] = res[id] ?? []
    }
    alternativesByCardId.value = nextCache
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    if (alternativesAbortController !== controller) return
    alternativesError.value = err instanceof ApiError ? err.message : t('alternativesError')
  } finally {
    if (alternativesAbortController === controller) {
      alternativesLoading.value = false
    }
  }
}

watch(
  () => deckUniqueCardIds.value.join(','),
  () => {
    void loadAlternativesForDeck(false)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  if (searchAbortController) searchAbortController.abort()
  if (alternativesAbortController) alternativesAbortController.abort()
})

const selectedCardAlternatives = computed<SmartAlternativeSuggestion[]>(() => {
  if (!selectedCardEntry.value) return []
  return alternativesByCardId.value[selectedCardEntry.value.cardId] ?? []
})

// Dictionnaire du nombre d'alternatives disponibles pour chaque carte du deck
const cardAlternativesCountMap = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {}
  for (const entry of props.editableDeck.cards) {
    if (!map[entry.cardId]) {
      map[entry.cardId] = (alternativesByCardId.value[entry.cardId] ?? []).length
    }
  }
  return map
})

function selectCardForInspection(cardId: string) {
  selectedCardId.value = cardId
}

function handleReplaceWithAlternative(oldCardId: string, alt: SmartAlternativeSuggestion) {
  const oldName = selectedCardEntry.value ? getLocalizedCardName(selectedCardEntry.value) : alt.targetCardNameFr
  const newName = getLocalizedCardName(alt.alternativeModel)
  emit('replace-card-in-deck', oldCardId, alt.alternativeModel)
  selectedCardId.value = alt.alternativeCardId
  replacedCardFeedback.value = t('cardReplacedFeedback', { oldCard: oldName, newCard: newName })
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

const arenaDeckUrl = computed(() => {
  const base = resolvePlatformUrls({ arenaUrl: props.arenaUrl }).arenaUrl
  const rawList = exportDeckToPtcgl(props.editableDeck.cards, {
    lang: 'en',
    format: 'ptcgl',
    includeTotalCards: true,
  })
  return `${base}?deck=${encodeDeckForUrl(rawList)}`
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
  link.download = `${isDeckModified.value ? 'deck-optimise-60' : 'deck-60'}-${exportLang.value}.txt`
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

function openZoomList(
  cards: Array<ParsedDeckEntry | EngineCardModel>,
  initialIndex = 0,
) {
  const clean = cards.filter(Boolean)
  if (clean.length === 0) return
  zoomedCards.value = clean
  zoomInitialIndex.value = Math.max(0, Math.min(initialIndex, clean.length - 1))
  zoomedCard.value = clean[zoomInitialIndex.value] ?? null
}

function openZoom(card: ParsedDeckEntry | EngineCardModel) {
  openZoomList([card], 0)
}

function closeZoom() {
  zoomedCard.value = null
  zoomedCards.value = []
  zoomInitialIndex.value = 0
}

function resolveCardById(cardId: string): ParsedDeckEntry | EngineCardModel | null {
  if (!cardId) return null
  const inEditable = props.editableDeck.cards.find((c) => c.cardId === cardId)
  if (inEditable) return inEditable
  const inBaseline = props.baselineDeck.cards.find((c) => c.cardId === cardId)
  if (inBaseline) return inBaseline
  return UNIFIED_CARD_REGISTRY[cardId] ?? null
}

function getComboCards(combo: ConditionalComboStatRecord): Array<ParsedDeckEntry | EngineCardModel> {
  const list: Array<ParsedDeckEntry | EngineCardModel> = []
  const pushCard = (c: ParsedDeckEntry | EngineCardModel | null) => {
    if (!c) return
    const cid = c.cardId
    if (!list.some((x) => x.cardId === cid)) {
      list.push(c)
    }
  }

  pushCard(resolveCardById(combo.cardId))
  for (const relId of combo.relatedCardIds || []) {
    pushCard(resolveCardById(relId))
  }

  // Repli sur l'audit de synergies ou l'évolution du deck si relatedCardIds n'était pas rempli
  if (list.length < 2) {
    const auditMatch = props.editableDeck.synergyAudit.find((a) => a.cardId === combo.cardId)
    for (const mid of auditMatch?.matchedCardIds || []) {
      pushCard(resolveCardById(mid))
    }
  }

  return list
}

function getTelemetryCardItem(item: CardUsageMetrics): ParsedDeckEntry | EngineCardModel {
  const resolved = resolveCardById(item.cardId)
  if (resolved) return resolved
  const cat = (item.category || 'TRAINER') as CardCategory
  const subCat = (item.subCategory || 'ITEM') as CardSubCategory
  return {
    cardId: item.cardId,
    category: cat,
    subCategory: subCat,
    identity: {
      cardId: item.cardId,
      nameFr: item.nameFr,
      nameEn: item.nameEn || item.nameFr,
      setId: item.cardId.split('-')[0] || '',
      localId: item.cardId.split('-')[1] || '',
      category: cat,
      subCategory: subCat,
      isRuleBox: false,
      prizeCardsGiven: 1,
      isAceSpec: false,
      isAncient: false,
      isFuture: false,
      isTera: false,
      legalStandard: true,
      legalExpanded: true,
    },
    pokemonStats: null,
    playableActions: [],
    strategicEvaluator: {
      aiRole: 'CONSISTENCY_BOOSTER',
      turnPhaseWeights: { turn1: 0.5, turn2: 0.5, turn3: 0.5, turn4Plus: 0.5 },
      decklistSynergyRequirements: [],
    },
  }
}

const sortedTelemetryCards = computed<Array<ParsedDeckEntry | EngineCardModel>>(() =>
  sortedCardTelemetry.value.map((item) => getTelemetryCardItem(item)),
)

function openTelemetryZoom(index: number) {
  openZoomList(sortedTelemetryCards.value, index)
}

function openAlternativeZoom(altIndex: number) {
  const alts = selectedCardAlternatives.value.slice(0, 4).map((a) => a.alternativeModel)
  if (selectedCardEntry.value) {
    openZoomList([selectedCardEntry.value, ...alts], altIndex + 1)
  } else {
    openZoomList(alts, altIndex)
  }
}

function getMatchupThreatCards(opponentId: string): EngineCardModel[] {
  const found = props.metaOpponents.find((opp) => opp.id === opponentId)
  return found?.keyThreatCards || []
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
      class="rounded-xl border border-emerald-500/45 bg-emerald-950/45 p-3.5 text-xs font-bold text-emerald-100 shadow-xs transition"
    >
      {{ replacedCardFeedback }}
    </div>

    <!-- 1. GRAND BANDEAU DE RESULTATS PRINCIPAL -->
    <div class="overflow-hidden rounded-2xl border border-[#263044] bg-[#131823] p-6 shadow-xs sm:p-8">
      <div class="flex flex-wrap items-center justify-between gap-6">
        <div>
          <div class="flex items-center gap-2">
            <span class="rounded-lg bg-[#ff6b00] px-2.5 py-1 text-xs font-bold text-white">
              {{ t('globalPerformance') }}
            </span>
            <span v-if="hasComparisonRun" class="rounded-lg bg-sky-950/60 px-2.5 py-1 text-xs font-bold text-sky-100">
              {{ t('comparedVariant') }}
            </span>
          </div>

          <div class="mt-3 flex flex-wrap items-baseline gap-4">
            <!-- Win rate global correctement normalisé -->
            <span
              class="text-4xl font-black tracking-tight sm:text-5xl"
              :class="(currentSummary?.globalWinRate ?? 0) >= 50 ? 'text-emerald-400' : 'text-red-400'"
            >
              {{ formatRate(currentSummary?.globalWinRate) }} %
            </span>
            <span class="text-sm font-semibold text-[#8a93a2]">
              {{ t('globalWinRate') }}
            </span>

            <!-- Écart avec le deck initial si variante comparée -->
            <div
              v-if="hasComparisonRun && baselineSummary"
              class="flex items-center gap-1 rounded-xl px-3 py-1 text-sm font-bold shadow-2xs"
              :class="[
                currentSummary!.globalWinRate >= baselineSummary.globalWinRate
                  ? 'border border-emerald-500/45 bg-emerald-950/45 text-emerald-300'
                  : 'border border-red-500/45 bg-red-950/45 text-red-300',
              ]"
            >
              <span>{{ formatSignedDelta(currentSummary!.globalWinRate - baselineSummary.globalWinRate, ' %') }}</span>
              <span class="text-xs font-medium">{{ t('vsBaseline') }} ({{ formatRate(baselineSummary.globalWinRate) }} %)</span>
            </div>
          </div>

          <!-- Jauge visuelle du Win Rate global -->
          <div class="mt-3 h-2.5 w-full max-w-md overflow-hidden rounded-full bg-[#263044]">
            <div
              class="h-full rounded-full transition-all duration-300"
              :class="(currentSummary?.globalWinRate ?? 0) >= 50 ? 'bg-emerald-500' : 'bg-red-500'"
              :style="{ width: `${Math.min(100, Math.max(0, currentSummary?.globalWinRate ?? 0))}%` }"
            ></div>
          </div>

          <p class="mt-2 text-xs text-[#8a93a2]">
            {{ t('simulatedGamesCount', { n: currentSummary?.totalGamesSimulated ?? 0 }) }}
            <span v-if="currentSummary" class="ml-1.5 font-mono font-semibold text-slate-300">
              ({{ t('globalWldSummary', { wins: currentSummary.wins, losses: currentSummary.losses, draws: currentSummary.draws }) }})
            </span>
          </p>
          <div
            v-if="!isSimulating && currentSummary"
            class="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-[#8a93a2]"
          >
            <span>
              {{
                t('simPerfStatsLine', {
                  sec: (currentSummary.totalDurationMs / 1000).toFixed(2),
                  rate: currentSummary.gamesPerSecond,
                  workers: currentSummary.configUsed.workerCount,
                })
              }}
            </span>
            <span
              v-if="currentSummary.marginOfErrorPct !== undefined"
              class="rounded bg-[#1b2232] px-1.5 py-0.5 text-[10px] font-semibold text-[#8a93a2]"
            >
              ±{{ currentSummary.marginOfErrorPct }} %
            </span>
            <span
              class="rounded bg-[#1b2232] px-1.5 py-0.5 text-[10px] font-semibold text-[#8a93a2]"
              data-testid="step3-base-seed"
            >
              Seed #{{ currentSummary.baseSeedUsed }}
            </span>
          </div>
        </div>

        <!-- Boutons d'action : Re-simuler, Enregistrer version et Exporter la variante -->
        <div class="flex flex-wrap items-center gap-3">
          <button
            v-if="!isSimulating"
            type="button"
            :disabled="compareButtonState.disabled"
            @click="emit('rerun-and-compare')"
            class="flex items-center gap-2 rounded-xl border border-[#ff6b00] bg-[#ff6b00] px-5 py-3 text-sm font-bold text-white shadow-xs transition hover:bg-[#ff8a00] disabled:cursor-not-allowed disabled:bg-[#263044] disabled:border-[#263044] disabled:text-[#8a93a2]"
          >
            <span>{{ compareButtonState.label }}</span>
          </button>

          <!-- Bouton Sauvegarder comme nouvelle version -->
          <button
            v-if="isDeckModified && editableDeck.totalCards === 60"
            type="button"
            @click="emit('save-as-new-version')"
            class="flex items-center gap-2 rounded-xl border border-[#263044] bg-[#131823] px-4 py-3 text-sm font-bold text-slate-200 shadow-xs transition hover:bg-[#1b2232]"
            :title="t('saveAsNewVersion')"
          >
            <span>{{ t('saveAsNewVersion') }}</span>
          </button>

          <!-- Bouton Exporter le deck actif (référence ou variante) -->
          <button
            type="button"
            :disabled="editableDeck.totalCards !== 60"
            @click="showExportModal = true"
            class="flex items-center gap-2 rounded-xl border border-[#38bdf8] bg-sky-950/40 px-5 py-3 text-sm font-bold text-sky-100 shadow-xs transition hover:bg-sky-950/60 disabled:cursor-not-allowed disabled:border-[#263044] disabled:bg-[#1b2232] disabled:text-[#8a93a2]"
            :title="isDeckModified ? t('exportPtcglVariant') : t('exportPtcglDeck')"
          >
            <span>{{ isDeckModified ? t('exportPtcglVariant') : t('exportPtcglDeck') }}</span>
          </button>

          <!-- Bouton Tester cette liste dans l'Arène (Coming Soon — non cliquable) -->
          <button
            v-if="editableDeck.totalCards === 60"
            type="button"
            disabled
            aria-disabled="true"
            data-testid="step3-arena-disabled"
            :data-arena-preview-url="arenaDeckUrl"
            class="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-[#38bdf8]/40 bg-[#38bdf8]/10 px-4 py-3 text-sm font-bold text-[#38bdf8] opacity-70 select-none"
          >
            <span aria-hidden="true">⚔️</span>
            <span>{{ t('sendToArena') }}</span>
            <span class="rounded-full bg-[#ff6b00]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#ffc21a]">
              {{ t('soonBadge') }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- 2. HISTORIQUE DES VERSIONS DU DECK -->
    <div v-if="deckVersions && deckVersions.length > 0" class="rounded-2xl border border-[#263044] bg-[#131823] p-5 shadow-xs">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#263044] pb-3">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-200">
            {{ t('versionHistoryTitle') }}
          </h3>
          <span class="rounded bg-[#1b2232] px-2 py-0.5 text-[10px] font-bold text-[#8a93a2]">
            {{ t('versionsCount', { n: deckVersions.length }) }}
          </span>
        </div>
        <span class="text-xs text-[#8a93a2]">
          {{ t('versionHistorySub') }}
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
              ? 'border-[#ff6b00] bg-[#1b2232] text-[#f8fafc] ring-2 ring-[#ff6b00]/75 shadow-[0_0_20px_rgba(255,107,0,0.2)]'
              : 'border-[#263044] bg-[#0c0f16]/60 text-[#f8fafc] hover:border-[#ff8a00]/60 hover:bg-[#1b2232]',
          ]"
        >
          <div class="flex items-center gap-1.5 font-bold text-xs">
            <span>{{ v.versionNumber === 1 ? `${t('versionLabel', { v: 1 })} (${t('initialVersion')})` : t('versionLabel', { v: v.versionNumber }) }}</span>
            <span
              v-if="v.isBaseline"
              class="rounded px-1.5 py-0.5 text-[10px]"
              :class="activeVersionId === v.id ? 'border border-[#ff6b00]/40 bg-[#ff6b00]/15 text-[#ff8a00]' : 'bg-[#263044] text-slate-200'"
            >
              {{ t('baselineRef') }}
            </span>
          </div>

          <!-- Taux de victoire de cette version si simulée -->
          <span
            v-if="v.summary"
            class="rounded border px-2 py-0.5 font-mono text-[11px] font-black"
            :class="[
              v.summary.globalWinRate >= 50
                ? 'border-emerald-500/40 bg-emerald-950/60 text-emerald-300'
                : 'border-red-500/40 bg-red-950/60 text-red-300',
            ]"
          >
            {{ formatRate(v.summary.globalWinRate) }} %
          </span>

          <!-- Actions de gestion de la version active -->
          <div v-if="activeVersionId === v.id && !v.isBaseline" class="flex items-center gap-1 ml-1" @click.stop>
            <button
              type="button"
              @click="emit('set-baseline-version', v.id)"
              class="rounded border border-[#263044] bg-[#131823] px-2 py-0.5 text-[10px] font-semibold text-slate-200 hover:border-[#ff6b00] hover:bg-[#263044]"
              :title="t('setAsBaseline')"
            >
              {{ t('setAsBaseline') }}
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
        class="rounded-2xl border border-[#263044] bg-[#131823] p-5 shadow-xs"
      >
        <div class="flex items-center justify-between">
          <span class="rounded-md bg-[#1b2232] px-2.5 py-0.5 text-xs font-bold text-slate-200">
            {{ pickLocalizedField(m.archetypeTag, m.archetypeTagEn) }}
          </span>

          <span
            v-if="hasComparisonRun && getBaselineMatchupWinRate(m.opponentId) !== null"
            class="text-xs font-bold"
            :class="m.winRate >= getBaselineMatchupWinRate(m.opponentId)! ? 'text-[#10b981]' : 'text-[#ef4444]'"
          >
            {{ formatSignedDelta(m.winRate - getBaselineMatchupWinRate(m.opponentId)!, ' %') }}
          </span>
        </div>

        <div class="mt-2 flex items-center justify-between gap-2">
          <h3 class="text-base font-bold text-[#f8fafc] truncate">
            {{ pickLocalizedField(m.opponentName, m.opponentNameEn) }}
          </h3>
          <CardFanThumbnail
            v-if="getMatchupThreatCards(m.opponentId).length > 0"
            :cards="getMatchupThreatCards(m.opponentId)"
            size="sm"
            @select="openZoomList(getMatchupThreatCards(m.opponentId), 0)"
          />
        </div>

        <div class="mt-3 flex items-baseline justify-between">
          <span class="text-2xl font-black" :class="m.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'">
            {{ formatRate(m.winRate) }} %
          </span>
          <span class="text-xs text-[#8a93a2] font-medium">
            {{ t('matchupStats', { wins: m.wins, losses: m.losses, draws: m.draws, total: m.gamesPlayed }) }}
          </span>
        </div>

        <!-- Jauge visuelle de victoire (0..100, Vert >= 50%, Rouge < 50%) -->
        <div class="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-[#263044]">
          <div
            class="h-full rounded-full transition-all duration-300"
            :class="m.winRate >= 50 ? 'bg-emerald-500' : 'bg-red-500'"
            :style="{ width: `${Math.min(100, Math.max(0, m.winRate))}%` }"
          ></div>
        </div>
      </div>
    </div>

    <!-- 4. BARRE D'ONGLETS POUR RESTAURER TOUTES LES INFORMATIONS STATISTIQUES -->
    <div class="flex border-b border-[#263044]">
      <button
        type="button"
        @click="activeTab = 'overview'"
        class="border-b-2 px-5 py-3 text-xs font-bold transition"
        :class="activeTab === 'overview' ? 'border-[#ff6b00] text-[#f8fafc]' : 'border-transparent text-[#8a93a2] hover:text-slate-200'"
      >
        {{ t('tabOverview') }}
      </button>
      <button
        type="button"
        @click="activeTab = 'detailed'"
        class="border-b-2 px-5 py-3 text-xs font-bold transition"
        :class="activeTab === 'detailed' ? 'border-[#ff6b00] text-[#f8fafc]' : 'border-transparent text-[#8a93a2] hover:text-slate-200'"
      >
        {{ t('tabDetailedStats') }}
      </button>
      <button
        type="button"
        @click="activeTab = 'audit'"
        class="border-b-2 px-5 py-3 text-xs font-bold transition"
        :class="activeTab === 'audit' ? 'border-[#ff6b00] text-[#f8fafc]' : 'border-transparent text-[#8a93a2] hover:text-slate-200'"
      >
        {{ t('tabCardAudit') }}
      </button>
    </div>

    <!-- CONTENU ONGLETS -->

    <!-- VUE A : VUE D'ENSEMBLE (INDICATEURS DE BASE + ATELIER) -->
    <div v-show="activeTab === 'overview'" class="space-y-6">
      <!-- Indicateurs Clés de Stabilité & Efficacité -->
      <div class="rounded-2xl border border-[#263044] bg-[#131823] p-6 shadow-xs">
        <div class="mb-4">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-200">
            {{ t('kpiSectionTitle') }}
          </h3>
          <p class="mt-1 text-xs text-[#8a93a2]">
            {{ t('kpiSectionSub') }}
          </p>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <!-- KPI 1 : Vitesse de Setup -->
          <div class="rounded-xl border border-[#263044] bg-[#1b2232]/60 p-4">
            <div class="text-xs font-bold text-[#8a93a2]">{{ t('kpiSetupSpeed') }}</div>
            <div
              class="mt-2 text-2xl font-black"
              :class="(currentSummary?.turn2AttackerReadyRate ?? 0) >= 50 ? 'text-emerald-400' : 'text-red-400'"
            >
              {{ formatRate(currentSummary?.turn2AttackerReadyRate) }} %
            </div>
            <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#263044]">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="(currentSummary?.turn2AttackerReadyRate ?? 0) >= 50 ? 'bg-emerald-500' : 'bg-red-500'"
                :style="{ width: `${Math.min(100, Math.max(0, currentSummary?.turn2AttackerReadyRate ?? 0))}%` }"
              ></div>
            </div>
            <p class="mt-2 text-[11px] text-[#8a93a2]">
              {{ t('kpiSetupSpeedDesc') }}
            </p>
          </div>

          <!-- KPI 2 : Enchaînement des Attaquants -->
          <div class="rounded-xl border border-[#263044] bg-[#1b2232]/60 p-4">
            <div class="text-xs font-bold text-[#8a93a2]">{{ t('kpiAttackStreaming') }}</div>
            <div
              class="mt-2 text-2xl font-black"
              :class="(currentSummary?.attackerStreamingRate ?? 0) >= 50 ? 'text-emerald-400' : 'text-red-400'"
            >
              {{ formatRate(currentSummary?.attackerStreamingRate) }} %
            </div>
            <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#263044]">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="(currentSummary?.attackerStreamingRate ?? 0) >= 50 ? 'bg-emerald-500' : 'bg-red-500'"
                :style="{ width: `${Math.min(100, Math.max(0, currentSummary?.attackerStreamingRate ?? 0))}%` }"
              ></div>
            </div>
            <p class="mt-2 text-[11px] text-[#8a93a2]">
              {{ t('kpiAttackStreamingDesc') }}
            </p>
          </div>

          <!-- KPI 3 : Résilience aux Perturbations -->
          <div class="rounded-xl border border-[#263044] bg-[#1b2232]/60 p-4">
            <div class="text-xs font-bold text-[#8a93a2]">{{ t('kpiDisruptionResilience') }}</div>
            <div
              class="mt-2 text-2xl font-black"
              :class="(currentSummary?.postDisruptionResilience?.postDisruptionAttackRate ?? 0) >= 50 ? 'text-emerald-400' : 'text-red-400'"
            >
              {{ formatRate(currentSummary?.postDisruptionResilience?.postDisruptionAttackRate) }} %
            </div>
            <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#263044]">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="(currentSummary?.postDisruptionResilience?.postDisruptionAttackRate ?? 0) >= 50 ? 'bg-emerald-500' : 'bg-red-500'"
                :style="{ width: `${Math.min(100, Math.max(0, currentSummary?.postDisruptionResilience?.postDisruptionAttackRate ?? 0))}%` }"
              ></div>
            </div>
            <p class="mt-2 text-[11px] text-[#8a93a2]">
              {{ t('kpiDisruptionResilienceDesc') }}
            </p>
          </div>

          <!-- KPI 4 : Flexibilité Supporter -->
          <div class="rounded-xl border border-[#263044] bg-[#1b2232]/60 p-4">
            <div class="text-xs font-bold text-[#8a93a2]">{{ t('kpiBossFlexibility') }}</div>
            <div
              class="mt-2 text-2xl font-black"
              :class="(currentSummary?.bossFlexibilityRate ?? 0) >= 50 ? 'text-emerald-400' : 'text-red-400'"
            >
              {{ formatRate(currentSummary?.bossFlexibilityRate) }} %
            </div>
            <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#263044]">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="(currentSummary?.bossFlexibilityRate ?? 0) >= 50 ? 'bg-emerald-500' : 'bg-red-500'"
                :style="{ width: `${Math.min(100, Math.max(0, currentSummary?.bossFlexibilityRate ?? 0))}%` }"
              ></div>
            </div>
            <p class="mt-2 text-[11px] text-[#8a93a2]">
              {{ t('kpiBossFlexibilityDesc') }}
            </p>
          </div>
        </div>
      </div>

      <!-- ATELIER D'OPTIMISATION A/B (COMPARATEUR DE CARTES) -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <!-- Colonne Gauche : Composition du deck modifiable -->
        <div class="flex flex-col rounded-2xl border border-[#263044] bg-[#131823] p-5 shadow-xs lg:col-span-5">
          <div class="mb-3 flex items-center justify-between border-b border-[#263044] pb-3">
            <div>
              <h3 class="text-sm font-bold text-[#f8fafc]">{{ t('deckComposition') }}</h3>
              <p class="text-xs text-[#8a93a2]">{{ t('clickCardForAlternatives') }}</p>
            </div>
            <span
              class="rounded-lg border px-2.5 py-1 text-xs font-bold"
              :class="
                editableDeck.totalCards === 60
                  ? 'border-emerald-500/45 bg-emerald-950/45 text-emerald-300'
                  : 'border-red-500/45 bg-red-950/45 text-red-300'
              "
            >
              {{ editableDeck.totalCards }} / 60
            </span>
          </div>

          <!-- Liste des cartes avec indicateur visuel d'alternatives disponibles -->
          <div class="max-h-[560px] space-y-2 overflow-y-auto pr-1">
            <div
              v-for="(card, cIdx) in editableDeck.cards"
              :key="card.uid"
              @click="selectCardForInspection(card.cardId)"
              class="flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-2.5 transition"
              :class="[
                selectedCardId === card.cardId
                  ? 'border-[#ff6b00] bg-[#1b2232] text-[#f8fafc] ring-2 ring-[#ff6b00]/75 shadow-[0_0_16px_rgba(255,107,0,0.2)]'
                  : 'border-[#263044] bg-[#0c0f16]/60 text-[#f8fafc] hover:border-[#ff8a00]/60 hover:bg-[#1b2232]',
              ]"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <!-- Miniature de la carte avec zoom au clic -->
                <CardFanThumbnail
                  :cards="[card]"
                  size="sm"
                  @select="openZoomList(editableDeck.cards, cIdx)"
                />

                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="truncate text-xs font-bold">
                      {{ getLocalizedCardName(card) }}
                    </span>

                    <!-- INDICATEUR VISUEL D'ALTERNATIVES SUGGÉRÉES (BADGE) -->
                    <span
                      v-if="cardAlternativesCountMap[card.cardId] && cardAlternativesCountMap[card.cardId] > 0"
                      class="rounded-full border border-[#38bdf8]/40 bg-sky-950/60 px-1.5 py-0.5 text-[9px] font-bold text-sky-200 shrink-0"
                    >
                      {{ t('altCountBadge', { n: cardAlternativesCountMap[card.cardId] }) }}
                    </span>
                  </div>

                  <div class="text-[10px] text-[#8a93a2]">
                    {{ getLocalizedSubCategory(card.subCategory) }}
                  </div>
                </div>
              </div>

              <!-- Contrôles de quantité (+ / -) -->
              <div class="flex items-center gap-1 shrink-0" @click.stop>
                <button
                  type="button"
                  @click="emit('adjust-card-qty', card.cardId, -1)"
                  class="flex h-7 w-7 items-center justify-center rounded-lg border font-bold text-xs transition"
                  :class="selectedCardId === card.cardId ? 'border-[#ff6b00]/60 bg-[#131823] text-[#f8fafc] hover:bg-[#263044]' : 'border-[#263044] bg-[#131823] text-slate-200 hover:bg-[#263044]'"
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
                  :class="selectedCardId === card.cardId ? 'border-[#ff6b00]/60 bg-[#131823] text-[#f8fafc] hover:bg-[#263044]' : 'border-[#263044] bg-[#131823] text-slate-200 hover:bg-[#263044]'"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <!-- Recherche et ajout d'une nouvelle carte (GET /api/cards) -->
          <div class="mt-4 border-t border-[#263044] pt-3">
            <input
              v-model="catalogSearchQuery"
              type="text"
              :placeholder="t('searchAddCard')"
              class="w-full rounded-xl border border-[#263044] bg-[#0c0f16] p-2.5 text-xs text-[#f8fafc] placeholder-slate-400 focus:border-[#ff6b00] focus:bg-[#131823] focus:outline-none"
            />

            <div
              v-if="catalogSearchQuery.trim().length === 1"
              class="mt-2 rounded-xl border border-[#263044] bg-[#0c0f16] px-3 py-2 text-[11px] text-[#8a93a2]"
            >
              {{ t('searchCatalogPrompt') }}
            </div>

            <div
              v-else-if="catalogSearchQuery.trim().length >= 2 && searchLoading"
              class="mt-2 flex items-center gap-2 rounded-xl border border-[#263044] bg-[#0c0f16] px-3 py-2.5 text-xs text-[#8a93a2]"
            >
              <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-700 border-t-transparent"></span>
              <span>{{ t('searchCatalogLoading') }}</span>
            </div>

            <div
              v-else-if="catalogSearchQuery.trim().length >= 2 && searchError"
              class="mt-2 flex items-center justify-between gap-2 rounded-xl border border-red-500/35 bg-red-950/45 px-3 py-2 text-xs text-red-300"
            >
              <span class="truncate">{{ searchError }}</span>
              <button
                type="button"
                @click="executeCatalogSearch(catalogSearchQuery)"
                class="shrink-0 rounded border border-red-500/45 bg-[#131823] px-2 py-0.5 text-[11px] font-bold text-red-200 hover:bg-red-950/60"
              >
                {{ t('retryButton') }}
              </button>
            </div>

            <div
              v-else-if="catalogSearchQuery.trim().length >= 2 && filteredCatalogModels.length > 0"
              class="mt-2 max-h-48 overflow-y-auto divide-y divide-[#263044] rounded-xl border border-[#263044] bg-[#131823]"
            >
              <div class="bg-[#0c0f16] px-2.5 py-1 text-[10px] font-semibold text-[#8a93a2]">
                {{ t('searchCatalogCount', { n: filteredCatalogModels.length, total: searchTotal }) }}
              </div>
              <div
                v-for="(model, mIdx) in filteredCatalogModels"
                :key="model.cardId"
                class="flex items-center justify-between p-2 text-xs hover:bg-[#1b2232]"
              >
                <div class="flex items-center gap-2.5 truncate">
                  <CardFanThumbnail
                    :cards="[model]"
                    size="sm"
                    @select="openZoomList(filteredCatalogModels, mIdx)"
                  />
                  <button
                    type="button"
                    @click.stop="openZoomList(filteredCatalogModels, mIdx)"
                    class="truncate text-left font-semibold text-[#f8fafc] hover:text-[#38bdf8]"
                  >
                    {{ getLocalizedCardName(model) }}
                  </button>
                </div>
                <button
                  type="button"
                  @click="emit('add-catalog-card', model)"
                  class="shrink-0 rounded-lg bg-[#ff6b00] px-2 py-1 text-[11px] font-bold text-white hover:bg-[#ff8a00]"
                >
                  {{ t('addCard') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Colonne Droite : Fiche de la carte sélectionnée & Alternatives -->
        <div class="flex flex-col rounded-2xl border border-[#263044] bg-[#131823] p-5 shadow-xs lg:col-span-7">
          <!-- Fiche de la carte sélectionnée -->
          <div v-if="selectedCardEntry" class="mb-5 flex items-start gap-4 rounded-xl border border-[#263044] bg-[#0c0f16]/80 p-4">
            <!-- Image agrandie avec zoom au clic -->
            <img
              v-if="getCardImageUrl(selectedCardEntry)"
              :src="getCardImageUrl(selectedCardEntry)!"
              :alt="getLocalizedCardName(selectedCardEntry)"
              loading="lazy"
              @error="handleImgError"
              @click="openZoom(selectedCardEntry)"
              class="h-28 w-20 shrink-0 rounded-lg object-cover shadow-sm border border-[#263044] cursor-zoom-in hover:opacity-90 transition"
              :title="t('clickToEnlarge')"
            />
            <div
              v-else
              @click="openZoom(selectedCardEntry)"
              class="flex h-28 w-20 shrink-0 cursor-zoom-in items-center justify-center rounded-lg bg-[#263044] font-bold text-[#8a93a2] text-xs transition hover:bg-[#263044]"
              :title="t('clickToEnlarge')"
            >
              {{ t('cardFallbackLabel') }}
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="rounded bg-[#ff6b00] px-2 py-0.5 text-xs font-bold text-white">
                  {{ selectedCardEntry.quantity }}×
                </span>
                <h4 class="text-base font-bold text-[#f8fafc]">
                  {{ getLocalizedCardName(selectedCardEntry) }}
                </h4>
              </div>

              <div class="mt-1 flex flex-wrap gap-2 text-xs text-[#8a93a2]">
                <span class="font-medium text-slate-200">{{ getLocalizedSubCategory(selectedCardEntry.subCategory) }}</span>
                <span>•</span>
                <span>{{ selectedCardEntry.setCode }} {{ selectedCardEntry.number }}</span>
                <span v-if="selectedCardEntry.model.pokemonStats?.hp">• {{ selectedCardEntry.model.pokemonStats.hp }} {{ t('cardHp') }}</span>
              </div>

              <p class="mt-2 text-xs leading-relaxed text-[#8a93a2]">
                {{ getLocalizedCardRules(selectedCardEntry).join('\n') || t('noRulesText') }}
              </p>
            </div>
          </div>

          <!-- Liste des alternatives recommandées via API -->
          <div
            v-if="alternativesLoading && selectedCardAlternatives.length === 0"
            class="flex items-center gap-2 rounded-xl border border-[#263044] bg-[#0c0f16] px-3 py-2.5 text-xs text-[#8a93a2]"
          >
            <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-700 border-t-transparent"></span>
            <span>{{ t('alternativesLoading') }}</span>
          </div>

          <div
            v-else-if="alternativesError && selectedCardAlternatives.length === 0"
            class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-500/35 bg-red-950/45 px-3 py-2.5 text-xs text-red-200"
          >
            <span>{{ alternativesError }}</span>
            <button
              type="button"
              @click="loadAlternativesForDeck(true)"
              class="rounded border border-red-500/45 bg-[#131823] px-2.5 py-1 text-xs font-bold text-red-200 hover:bg-red-950/60"
            >
              {{ t('retryButton') }}
            </button>
          </div>

          <div v-else-if="selectedCardAlternatives.length > 0">
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-200">
              {{ t('suggestedAlternatives') }}
            </h4>

            <div class="mt-3 space-y-3">
              <div
                v-for="(alt, aIdx) in selectedCardAlternatives.slice(0, 4)"
                :key="alt.alternativeCardId"
                class="flex flex-col gap-3 rounded-xl border border-[#263044] bg-[#131823] p-3.5 shadow-2xs transition hover:border-[#263044] sm:flex-row sm:items-center sm:justify-between"
              >
                <div class="flex min-w-0 flex-1 items-center gap-3">
                  <!-- Miniature alternative avec zoom au clic -->
                  <CardFanThumbnail
                    :cards="[alt.alternativeModel]"
                    size="md"
                    @select="openAlternativeZoom(aIdx)"
                  />

                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-sm font-bold text-[#f8fafc] truncate">
                        {{ getLocalizedCardName(alt.alternativeModel) }}
                      </span>
                      <span class="shrink-0 rounded bg-sky-950/40 px-2 py-0.5 text-[10px] font-bold text-[#38bdf8]">
                        {{ pickLocalizedField(alt.actionEconomyBadge, alt.actionEconomyBadgeEn) }}
                      </span>
                    </div>

                    <p class="mt-1 text-xs text-[#8a93a2] line-clamp-2">
                      {{ pickLocalizedField(alt.strategicReason, alt.strategicReasonEn) }}
                    </p>
                  </div>
                </div>

                <!-- Bouton de remplacement en 1 clic -->
                <button
                  type="button"
                  @click="handleReplaceWithAlternative(selectedCardEntry!.cardId, alt)"
                  class="w-full shrink-0 rounded-xl border border-[#ff6b00] bg-[#ff6b00] px-3.5 py-2 text-center text-xs font-bold text-white transition hover:bg-[#ff8a00] sm:w-auto"
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
      <div v-if="currentSummary?.turnOrderSplitStats" class="rounded-2xl border border-[#263044] bg-[#131823] p-6 shadow-xs">
        <div class="border-b border-[#263044] pb-3">
          <h3 class="text-sm font-bold text-[#f8fafc]">
            {{ t('turnOrderHeader') }}
          </h3>
          <p class="text-xs text-[#8a93a2]">
            {{ t('turnOrderSub') }}
          </p>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-xl border border-[#263044] bg-[#1b2232]/60 p-4">
            <div class="text-xs font-bold text-[#8a93a2]">{{ t('winRateJ1') }}</div>
            <div
              class="mt-2 text-2xl font-black"
              :class="currentSummary.turnOrderSplitStats.winRateGoingFirst >= 50 ? 'text-emerald-400' : 'text-red-400'"
            >
              {{ formatRate(currentSummary.turnOrderSplitStats.winRateGoingFirst) }} %
            </div>
            <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#263044]">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="currentSummary.turnOrderSplitStats.winRateGoingFirst >= 50 ? 'bg-emerald-500' : 'bg-red-500'"
                :style="{ width: `${Math.min(100, Math.max(0, currentSummary.turnOrderSplitStats.winRateGoingFirst))}%` }"
              ></div>
            </div>
            <p class="mt-2 text-xs text-[#8a93a2] font-mono">
              {{ currentSummary.turnOrderSplitStats.winsGoingFirst }}{{ t('winInitial') }} / {{ currentSummary.turnOrderSplitStats.gamesGoingFirst }} {{ t('gamesUnit') }}
            </p>
          </div>

          <div class="rounded-xl border border-[#263044] bg-[#1b2232]/60 p-4">
            <div class="text-xs font-bold text-[#8a93a2]">{{ t('winRateJ2') }}</div>
            <div
              class="mt-2 text-2xl font-black"
              :class="currentSummary.turnOrderSplitStats.winRateGoingSecond >= 50 ? 'text-emerald-400' : 'text-red-400'"
            >
              {{ formatRate(currentSummary.turnOrderSplitStats.winRateGoingSecond) }} %
            </div>
            <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#263044]">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="currentSummary.turnOrderSplitStats.winRateGoingSecond >= 50 ? 'bg-emerald-500' : 'bg-red-500'"
                :style="{ width: `${Math.min(100, Math.max(0, currentSummary.turnOrderSplitStats.winRateGoingSecond))}%` }"
              ></div>
            </div>
            <p class="mt-2 text-xs text-[#8a93a2] font-mono">
              {{ currentSummary.turnOrderSplitStats.winsGoingSecond }}{{ t('winInitial') }} / {{ currentSummary.turnOrderSplitStats.gamesGoingSecond }} {{ t('gamesUnit') }}
            </p>
          </div>

          <div class="rounded-xl border border-[#263044] bg-[#1b2232]/60 p-4">
            <div class="text-xs font-bold text-[#8a93a2]">{{ t('turn1AttackLockJ2') }}</div>
            <div class="mt-2 text-2xl font-black text-[#f8fafc]">
              {{ formatRate(currentSummary.turnOrderSplitStats.turn1AttackOrItemLockRateJ2) }} %
            </div>
            <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#263044]">
              <div
                class="h-full rounded-full bg-emerald-500 transition-all duration-300"
                :style="{ width: `${Math.min(100, Math.max(0, currentSummary.turnOrderSplitStats.turn1AttackOrItemLockRateJ2))}%` }"
              ></div>
            </div>
            <p class="mt-2 text-[11px] text-[#8a93a2]">
              {{ t('turn1ItemLockDesc') }} {{ formatRate(currentSummary.turnOrderSplitStats.turn1ItemLockRateJ2) }} %
            </p>
          </div>

          <div class="rounded-xl border border-[#263044] bg-[#1b2232]/60 p-4">
            <div class="text-xs font-bold text-[#8a93a2]">{{ t('avgDamagePerTurn') }}</div>
            <div class="mt-2 text-2xl font-black text-[#f8fafc]">
              {{ t('comboDamageLabel', { dmg: currentSummary.averageDamagePerTurn }) }}
            </div>
            <p class="mt-1 text-[11px] text-[#8a93a2]">
              {{ t('avgDamageSub') }}
            </p>
          </div>
        </div>
      </div>

      <!-- 2. Économie de Récompenses & Régularité -->
      <div v-if="currentSummary" class="rounded-2xl border border-[#263044] bg-[#131823] p-6 shadow-xs">
        <div class="border-b border-[#263044] pb-3">
          <h3 class="text-sm font-bold text-[#f8fafc]">
            {{ t('prizeMulliganHeader') }}
          </h3>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-xl border border-[#263044] bg-[#1b2232]/60 p-4">
            <div class="text-xs font-bold text-[#8a93a2]">{{ t('avgPlayerPrizes') }}</div>
            <div class="mt-2 text-2xl font-black text-emerald-400">
              {{ formatRate(currentSummary.avgPlayerPrizesWon, 2) }} / 6.00
            </div>
            <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#263044]">
              <div
                class="h-full rounded-full bg-emerald-500 transition-all duration-300"
                :style="{ width: `${Math.min(100, Math.max(0, (currentSummary.avgPlayerPrizesWon / 6) * 100))}%` }"
              ></div>
            </div>
            <p class="mt-2 text-[11px] text-[#8a93a2]">
              {{ t('netPrizeDifferential') }}
              <strong :class="currentSummary.avgPlayerPrizesWon - currentSummary.avgOpponentPrizesWon >= 0 ? 'text-emerald-400' : 'text-red-400'">
                {{ formatSignedDelta(currentSummary.avgPlayerPrizesWon - currentSummary.avgOpponentPrizesWon) }}
              </strong>
            </p>
          </div>

          <div class="rounded-xl border border-[#263044] bg-[#1b2232]/60 p-4">
            <div class="text-xs font-bold text-[#8a93a2]">{{ t('avgOpponentPrizes') }}</div>
            <div class="mt-2 text-2xl font-black text-red-400">
              {{ formatRate(currentSummary.avgOpponentPrizesWon, 2) }} / 6.00
            </div>
            <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#263044]">
              <div
                class="h-full rounded-full bg-red-500 transition-all duration-300"
                :style="{ width: `${Math.min(100, Math.max(0, (currentSummary.avgOpponentPrizesWon / 6) * 100))}%` }"
              ></div>
            </div>
            <p class="mt-2 text-[11px] text-[#8a93a2]">
              {{ t('prizesConcededPerMatch') }}
            </p>
          </div>

          <div class="rounded-xl border border-[#263044] bg-[#1b2232]/60 p-4">
            <div class="text-xs font-bold text-[#8a93a2]">{{ t('mulliganRate') }}</div>
            <div
              class="mt-2 text-2xl font-black"
              :class="currentSummary.gamesWithMulliganRate >= 25 ? 'text-red-400' : 'text-emerald-400'"
            >
              {{ formatRate(currentSummary.gamesWithMulliganRate) }} %
            </div>
            <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#263044]">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="currentSummary.gamesWithMulliganRate >= 25 ? 'bg-red-500' : 'bg-emerald-500'"
                :style="{ width: `${Math.min(100, Math.max(0, currentSummary.gamesWithMulliganRate))}%` }"
              ></div>
            </div>
            <p class="mt-2 text-[11px] text-[#8a93a2]">
              {{ currentSummary.gamesWithMulliganCount }} {{ t('gamesWithMulligan') }}
            </p>
          </div>

          <div class="rounded-xl border border-[#263044] bg-[#1b2232]/60 p-4">
            <div class="text-xs font-bold text-[#8a93a2]">{{ t('avgTurnsPerGame') }}</div>
            <div class="mt-2 text-2xl font-black text-[#f8fafc]">
              {{ t('avgTurnsCount', { turns: currentSummary.avgTurnsPlayed }) }}
            </div>
            <p class="mt-1 text-[11px] text-[#8a93a2] font-mono">
              {{ t('gamesPerSec', { rate: currentSummary.gamesPerSecond }) }}
            </p>
          </div>
        </div>
      </div>

      <!-- 3. Combos Conditionnels & Attaques Clés -->
      <div v-if="currentSummary?.conditionalComboStats && currentSummary.conditionalComboStats.length > 0" class="rounded-2xl border border-[#263044] bg-[#131823] p-6 shadow-xs">
        <div class="border-b border-[#263044] pb-3">
          <h3 class="text-sm font-bold text-[#f8fafc]">
            {{ t('conditionalCombosHeader') }}
          </h3>
        </div>

        <div class="mt-4 overflow-x-auto">
          <table class="w-full border-collapse text-left text-xs">
            <thead>
              <tr class="border-b border-[#263044] bg-[#0c0f16] font-mono text-[11px] uppercase text-[#8a93a2]">
                <th class="px-3.5 py-2.5">{{ t('comboCardAction') }}</th>
                <th class="px-3.5 py-2.5">{{ t('comboCondition') }}</th>
                <th class="px-3.5 py-2.5">{{ t('comboTriggerRate') }}</th>
                <th class="px-3.5 py-2.5">{{ t('comboFirstTurn') }}</th>
                <th class="px-3.5 py-2.5">{{ t('comboAvgDamage') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#263044]">
              <tr
                v-for="combo in currentSummary.conditionalComboStats"
                :key="combo.comboId"
                class="hover:bg-[#0c0f16]/80 transition"
              >
                <td class="px-3.5 py-2.5 font-bold text-[#f8fafc]">
                  <div
                    @click="getComboCards(combo).length > 0 && openZoomList(getComboCards(combo), 0)"
                    class="flex items-center gap-3"
                    :class="getComboCards(combo).length > 0 ? 'cursor-pointer group' : ''"
                  >
                    <CardFanThumbnail
                      v-if="getComboCards(combo).length > 0"
                      :cards="getComboCards(combo)"
                      size="md"
                      @select="openZoomList(getComboCards(combo), 0)"
                    />
                    <span class="group-hover:text-[#38bdf8] transition">{{ pickLocalizedField(combo.label, combo.labelEn) }}</span>
                  </div>
                </td>
                <td class="px-3.5 py-2.5">
                  <span class="rounded border border-[#263044] bg-[#1b2232] px-1.5 py-0.5 font-mono text-[11px] text-slate-200">
                    {{ pickLocalizedField(combo.conditionSummary, combo.conditionSummaryEn) }}
                  </span>
                </td>
                <td class="px-3.5 py-2.5 font-mono font-bold text-[#10b981]">
                  {{ formatRate(combo.triggerRate) }} %
                </td>
                <td class="px-3.5 py-2.5 font-mono text-slate-200">
                  {{ combo.avgTriggerTurn > 0 ? `T${formatRate(combo.avgTriggerTurn)}` : '—' }}
                </td>
                <td class="px-3.5 py-2.5 font-mono font-bold text-[#f8fafc]">
                  {{ combo.avgDamageWhenTriggered > 0 ? t('comboDamageLabel', { dmg: combo.avgDamageWhenTriggered }) : t('comboEffectLabel') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- VUE C : AUDIT D'UTILITÉ CARTE PAR CARTE -->
    <div v-show="activeTab === 'audit'" class="space-y-6">
      <div class="rounded-2xl border border-[#263044] bg-[#131823] p-6 shadow-xs">
        <div class="border-b border-[#263044] pb-3">
          <h3 class="text-sm font-bold text-[#f8fafc]">
            {{ t('cardAuditHeader') }}
          </h3>
          <p class="text-xs text-[#8a93a2]">
            {{ t('cardAuditSub') }}
          </p>
        </div>

        <div class="mt-4 overflow-x-auto">
          <table class="w-full border-collapse text-left text-xs">
            <thead>
              <tr class="border-b border-[#263044] bg-[#0c0f16] font-mono text-[11px] uppercase text-[#8a93a2]">
                <th class="px-3.5 py-2.5">{{ t('colCard') }}</th>
                <th class="px-3.5 py-2.5">{{ t('colPlayRate') }}</th>
                <th class="px-3.5 py-2.5">{{ t('colDeadDiscardRate') }}</th>
                <th class="px-3.5 py-2.5">{{ t('colPrizedImpact') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#263044]">
              <tr
                v-for="(item, tIdx) in sortedCardTelemetry"
                :key="item.cardId"
                class="hover:bg-[#0c0f16]/80 transition"
              >
                <!-- Carte -->
                <td class="px-3.5 py-3">
                  <div
                    @click="openTelemetryZoom(tIdx)"
                    class="group flex cursor-pointer items-center gap-3"
                  >
                    <CardFanThumbnail
                      :cards="[getTelemetryCardItem(item)]"
                      size="sm"
                      @select="openTelemetryZoom(tIdx)"
                    />
                    <span class="rounded bg-[#ff6b00] px-1.5 py-0.5 font-mono text-[10px] font-bold text-white shrink-0">
                      {{ item.quantityInDeck }}×
                    </span>
                    <div>
                      <div class="font-bold text-[#f8fafc] group-hover:text-[#38bdf8] transition">{{ getLocalizedCardName(item) }}</div>
                      <div class="font-mono text-[10px] text-[#8a93a2]">
                        {{ item.cardId }} • {{ getLocalizedSubCategory(item.subCategory) }}
                      </div>
                    </div>
                  </div>
                </td>

                <!-- Taux de Jeu Effectif -->
                <td class="px-3.5 py-3">
                  <div class="flex items-center gap-2">
                    <span class="w-12 font-mono text-xs font-bold text-emerald-400">
                      {{ formatRate(item.effectivePlayRate) }} %
                    </span>
                    <div class="h-2.5 w-24 overflow-hidden rounded-full bg-[#263044]">
                      <div
                        class="h-full rounded-full bg-emerald-500 transition-all duration-300"
                        :style="{ width: `${Math.min(100, Math.max(0, item.effectivePlayRate))}%` }"
                      ></div>
                    </div>
                    <span class="font-mono text-[10px] text-[#8a93a2]">
                      ({{ t('seenRate', { pct: formatRate(item.drawnRate, 0) }) }})
                    </span>
                  </div>
                </td>

                <!-- Carte Morte / Défaussée -->
                <td class="px-3.5 py-3">
                  <div class="flex items-center gap-2">
                    <span
                      class="w-12 font-mono text-xs font-bold"
                      :class="
                        item.discardedUnusedRate + item.deadHandTurnRate >= 15
                          ? 'text-red-400'
                          : item.discardedUnusedRate + item.deadHandTurnRate > 0
                            ? 'text-amber-300'
                            : 'text-[#8a93a2]'
                      "
                    >
                      {{ formatRate(item.discardedUnusedRate) }} %
                    </span>
                    <div class="h-2.5 w-24 overflow-hidden rounded-full bg-[#263044]">
                      <div
                        class="h-full rounded-full transition-all duration-300"
                        :style="{ width: `${Math.min(100, Math.max(0, item.discardedUnusedRate + item.deadHandTurnRate))}%` }"
                        :class="item.discardedUnusedRate + item.deadHandTurnRate >= 15 ? 'bg-red-500' : 'bg-amber-500'"
                      ></div>
                    </div>
                    <span class="font-mono text-[10px] text-[#8a93a2]">
                      ({{ t('stuckTurns', { n: item.turnsStuckDeadInHand }) }})
                    </span>
                  </div>
                </td>

                <!-- Impact Prized -->
                <td class="px-3.5 py-3 font-mono text-xs">
                  <div v-if="item.gamesAllCopiesPrized > 0" class="flex items-center gap-1.5">
                    <span class="text-slate-200">{{ t('gamesPctPrized', { pct: formatRate(item.allCopiesPrizedRate) }) }}</span>
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                      :class="
                        item.winRateImpactWhenAllPrized < 0
                          ? 'bg-red-950/60 text-red-300'
                          : 'bg-[#1b2232] text-slate-200'
                      "
                    >
                      WR: {{ formatSignedDelta(item.winRateImpactWhenAllPrized, ' %') }}
                    </span>
                  </div>
                  <span v-else class="text-[11px] text-[#8a93a2]">
                    {{ t('neverPrized') }}
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
      <div class="w-full max-w-xl rounded-2xl border border-[#263044] bg-[#131823] p-6 shadow-xl">
        <div class="flex items-center justify-between border-b border-[#263044] pb-3">
          <h3 class="text-base font-bold text-[#f8fafc]">
            {{ isDeckModified ? t('exportModalTitle') : t('exportModalTitleDeck') }}
          </h3>
          <button
            type="button"
            @click="showExportModal = false"
            class="text-[#8a93a2] hover:text-slate-200 font-bold text-lg"
          >
            ×
          </button>
        </div>

        <div class="mt-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-[#8a93a2]">{{ t('formatReadyForPtcgl') }}</span>
            <div class="flex gap-2">
              <button
                type="button"
                @click="exportLang = 'fr'"
                class="rounded px-2 py-0.5 text-xs font-bold"
                :class="exportLang === 'fr' ? 'bg-[#ff6b00] text-white' : 'bg-[#1b2232] text-[#8a93a2]'"
              >
                FR
              </button>
              <button
                type="button"
                @click="exportLang = 'en'"
                class="rounded px-2 py-0.5 text-xs font-bold"
                :class="exportLang === 'en' ? 'bg-[#ff6b00] text-white' : 'bg-[#1b2232] text-[#8a93a2]'"
              >
                EN
              </button>
            </div>
          </div>

          <textarea
            :value="exportedPtcglText"
            readonly
            rows="12"
            class="w-full rounded-xl border border-[#263044] bg-[#0c0f16] p-3 font-mono text-xs text-[#f8fafc] focus:outline-none"
          ></textarea>

          <div class="mt-4 flex flex-wrap justify-end gap-3">
            <button
              v-if="editableDeck.totalCards === 60"
              type="button"
              disabled
              aria-disabled="true"
              data-testid="step3-export-arena-disabled"
              :data-arena-preview-url="arenaDeckUrl"
              class="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-[#38bdf8]/40 bg-[#38bdf8]/10 px-4 py-2 text-xs font-bold text-[#38bdf8] opacity-70 select-none"
            >
              <span aria-hidden="true">⚔️</span>
              <span>{{ t('sendToArena') }}</span>
              <span class="rounded-full bg-[#ff6b00]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#ffc21a]">
                {{ t('soonBadge') }}
              </span>
            </button>
            <button
              type="button"
              @click="downloadExportedDeckTxt"
              class="rounded-xl border border-[#263044] bg-[#131823] px-4 py-2 text-xs font-bold text-slate-200 hover:bg-[#1b2232]"
            >
              {{ t('downloadTxt') }}
            </button>
            <button
              type="button"
              @click="copyExportedDeck"
              class="rounded-xl bg-[#ff6b00] px-4 py-2 text-xs font-bold text-white hover:bg-[#ff8a00]"
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
      :cards="zoomedCards"
      :initial-index="zoomInitialIndex"
      :is-open="zoomedCards.length > 0 || zoomedCard !== null"
      @close="closeZoom"
    />

    <!-- Inspecteur granulaire (actif avec ?debug=true) -->
    <DebugInspectorPanel
      v-if="isDebugMode && currentSummary?.tracedGames && currentSummary.tracedGames.length > 0"
      :traced-games="currentSummary.tracedGames"
    />
  </div>
</template>
