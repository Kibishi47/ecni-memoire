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
  extractAttackerComparisonRow,
  findAlternativesForCard,
  type SmartAlternativeSuggestion,
} from '../core/alternativesFinder'
import { getAllCatalogModels, normalizeCardNameForMatch } from '../data/cardCatalog'
import { exportDeckToPtcgl } from '../utils/ptcglExporter'
import DebugInspectorPanel from './DebugInspectorPanel.vue'

const props = defineProps<{
  baselineDeck: ParsedDeck
  editableDeck: ParsedDeck
  baselineSummary: SimulationMetricsSummary | null
  currentSummary: SimulationMetricsSummary | null
  isSimulating: boolean
  progressCompleted: number
  progressTotal: number
  progressElapsedMs: number
  isDebugMode: boolean
  stressTestOhko?: boolean
}>()

const emit = defineEmits<{
  (e: 'adjust-card-qty', cardId: string, delta: number): void
  (e: 'remove-card', cardId: string): void
  (e: 'add-catalog-card', model: EngineCardModel): void
  (e: 'replace-card-in-deck', oldCardId: string, newModel: EngineCardModel): void
  (e: 'toggle-stress-ohko', enabled: boolean): void
  (e: 'rerun-and-compare'): void
  (e: 'promote-current-as-baseline'): void
  (e: 'reset-to-baseline'): void
  (e: 'back-step2'): void
  (e: 'cancel-simulation'): void
}>()

const compareButtonState = computed(() => {
  if (props.isSimulating) {
    const pct =
      props.progressTotal > 0
        ? Math.min(100, Math.round((props.progressCompleted / props.progressTotal) * 100))
        : 0
    return {
      disabled: true,
      label: `Simulation en cours d'exécution... (${pct} %)`,
      showSpinner: true,
    }
  }
  if (!props.editableDeck.isDatabaseLoaded) {
    return {
      disabled: true,
      label: 'Simulation bloquée : la base cards_database.json est vide',
      showSpinner: false,
    }
  }
  if (!props.editableDeck.isFullyResolved || props.editableDeck.unresolvedCount > 0) {
    return {
      disabled: true,
      label: `Simulation bloquée : ${props.editableDeck.unresolvedCount} carte(s) absente(s) de cards_database.json`,
      showSpinner: false,
    }
  }
  if (props.editableDeck.totalCards !== 60) {
    return {
      disabled: true,
      label: `Simulation bloquée : Le deck contient ${props.editableDeck.totalCards}/60 cartes (60 requises)`,
      showSpinner: false,
    }
  }
  if (!props.editableDeck.hasAtLeastOneBasic) {
    return {
      disabled: true,
      label: 'Simulation bloquée : Aucun Pokémon de base (au moins 1 requis)',
      showSpinner: false,
    }
  }
  return {
    disabled: false,
    label: 'Simuler la Variante & Comparer',
    showSpinner: false,
  }
})

const catalogSearchQuery = ref('')
const showExportPanel = ref(false)
const exportLang = ref<'fr' | 'en'>('fr')
const copiedFeedback = ref(false)

const allCatalogModels = getAllCatalogModels()

const filteredCatalogModels = computed<EngineCardModel[]>(() => {
  const q = normalizeCardNameForMatch(catalogSearchQuery.value)
  if (!q) return allCatalogModels.slice(0, 12)
  return allCatalogModels
    .filter((m) => {
      const hay = normalizeCardNameForMatch(
        `${m.identity.nameFr} ${m.identity.nameEn || ''} ${m.cardId} ${m.subCategory} ${m.strategicEvaluator.primaryRole}`,
      )
      return hay.includes(q)
    })
    .slice(0, 15)
})

const progressPercent = computed(() => {
  if (props.progressTotal <= 0) return 0
  return Math.min(100, Math.round((props.progressCompleted / props.progressTotal) * 100))
})

// Calcul des différences de cartes entre Deck Original (baselineDeck) et Deck Courant (editableDeck)
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

const hasComparisonRun = computed(() => {
  return (
    props.baselineSummary !== null &&
    props.currentSummary !== null &&
    props.baselineSummary !== props.currentSummary
  )
})

function getCardDeltaAgainstBaseline(cardId: string): number {
  const found = cardDiffItems.value.find((d) => d.cardId === cardId)
  return found ? found.deltaQty : 0
}

const editablePokemons = computed<ParsedDeckEntry[]>(() =>
  props.editableDeck.cards.filter((c) => c.category === 'pokemon'),
)
const editableTrainers = computed<ParsedDeckEntry[]>(() =>
  props.editableDeck.cards.filter((c) => c.category === 'trainer'),
)
const editableEnergies = computed<ParsedDeckEntry[]>(() =>
  props.editableDeck.cards.filter((c) => c.category === 'energy'),
)

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
  link.download = `pokesim-deck-60-${exportLang.value}.txt`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function formatSignedDelta(delta: number, suffix = ''): string {
  const rounded = Math.round(delta * 100) / 100
  if (rounded > 0) return `+${rounded}${suffix}`
  return `${rounded}${suffix}`
}

function getBaselineMatchupWinRate(opponentId: string): number | null {
  if (!props.baselineSummary) return null
  const m = props.baselineSummary.matchupBreakdown.find((x) => x.opponentId === opponentId)
  return m ? m.winRate : null
}

const expandedAlternativeCardId = ref<string | null>(null)
const replacedCardFeedback = ref<string | null>(null)

function toggleCardAlternatives(cardId: string) {
  expandedAlternativeCardId.value =
    expandedAlternativeCardId.value === cardId ? null : cardId
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

const alternativesByCardId = computed<Record<string, SmartAlternativeSuggestion[]>>(() => {
  const result: Record<string, SmartAlternativeSuggestion[]> = {}
  const modelByCardId = new Map<string, EngineCardModel>()
  for (const entry of props.editableDeck.cards) {
    modelByCardId.set(entry.cardId, entry.model)
  }
  for (const entry of props.baselineDeck.cards) {
    if (!modelByCardId.has(entry.cardId)) {
      modelByCardId.set(entry.cardId, entry.model)
    }
  }
  for (const [cardId, model] of modelByCardId.entries()) {
    result[cardId] = findAlternativesForCard(model, allCatalogModels)
  }
  return result
})

function getTargetAttackerRow(cardId: string) {
  const entry =
    props.editableDeck.cards.find((c) => c.cardId === cardId) ??
    props.baselineDeck.cards.find((c) => c.cardId === cardId)
  if (!entry) return null
  return extractAttackerComparisonRow(entry.model)
}

function handleReplaceWithAlternative(oldCardId: string, alt: SmartAlternativeSuggestion) {
  emit('replace-card-in-deck', oldCardId, alt.alternativeModel)
  replacedCardFeedback.value = `${alt.targetCardNameFr} remplacé par ${alt.alternativeNameFr} dans l'Atelier A/B.`
  setTimeout(() => {
    replacedCardFeedback.value = null
  }, 4000)
}
</script>

<template>
  <section class="space-y-6">
    <!-- En-tête de l'Étape 3 & Actions rapides -->
    <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span
            class="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-semibold text-slate-700"
          >
            ÉTAPE 3 &amp; 4 — TABLEAU DE BORD &amp; COMPARATEUR A/B
          </span>
          <h2 class="mt-2 text-xl font-bold text-slate-900">
            Résultats de Simulation, Atelier d'Édition A/B &amp; Export PTCGL
          </h2>
          <p class="mt-1 text-sm text-slate-600">
            Analysez les 8 indicateurs de performance, ajustez vos ratios de cartes (verrou strict 60 cartes) et comparez l'écart statistique ($\Delta$) face au deck original.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            @click="emit('back-step2')"
            class="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            ← Paramètres de Simulation
          </button>

          <button
            type="button"
            @click="showExportPanel = !showExportPanel"
            class="rounded-lg border border-slate-300 bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-200"
          >
            {{ showExportPanel ? 'Masquer Export PTCGL' : 'Exporter la Variante (PTCGL)' }}
          </button>
        </div>
      </div>

      <!-- Barre de progression en temps réel pendant l'exécution Web Workers -->
      <div
        v-if="isSimulating"
        class="mt-4 rounded-xl border border-slate-900 bg-slate-900 p-4 text-white"
      >
        <div class="flex items-center justify-between text-xs font-semibold">
          <span class="flex items-center gap-2">
            <span class="h-2.5 w-2.5 animate-ping rounded-full bg-emerald-400"></span>
            Simulation Multi-Workers 3-Ply en cours...
          </span>
          <span class="font-mono">
            {{ progressCompleted }} / {{ progressTotal }} parties ({{ progressPercent }}%) —
            {{ formatDuration(progressElapsedMs) }}
          </span>
        </div>
        <div class="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-700">
          <div
            class="h-full rounded-full bg-emerald-400 transition-all duration-150"
            :style="{ width: `${progressPercent}%` }"
          ></div>
        </div>
      </div>
    </div>

    <!-- Tiroir d'Export au Format PTCGL (Copie 1-clic & Téléchargement .txt) -->
    <div
      v-if="showExportPanel"
      class="rounded-xl border border-slate-300 bg-white p-5 shadow-xs"
    >
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h3 class="text-sm font-bold text-slate-900">
            Exporter la Variante Active au Format Pokémon TCG Live (PTCGL)
          </h3>
          <p class="text-xs text-slate-500">
            Liste de {{ editableDeck.totalCards }} cartes groupée par <code class="font-mono">Pokémon</code>,
            <code class="font-mono">Trainer</code> et <code class="font-mono">Energy</code>.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              type="button"
              @click="exportLang = 'fr'"
              class="rounded-md px-2.5 py-1 font-semibold"
              :class="exportLang === 'fr' ? 'bg-slate-900 text-white' : 'text-slate-600'"
            >
              Noms FR
            </button>
            <button
              type="button"
              @click="exportLang = 'en'"
              class="rounded-md px-2.5 py-1 font-semibold"
              :class="exportLang === 'en' ? 'bg-slate-900 text-white' : 'text-slate-600'"
            >
              Noms EN (PTCGL Standard)
            </button>
          </div>

          <button
            type="button"
            @click="copyExportedDeck"
            class="rounded-lg border border-slate-900 bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
          >
            {{ copiedFeedback ? 'Copié dans le presse-papiers !' : 'Copier 1-clic (Presse-papiers)' }}
          </button>

          <button
            type="button"
            @click="downloadExportedDeckTxt"
            class="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-50"
          >
            Télécharger .txt
          </button>
        </div>
      </div>

      <pre
        class="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs leading-relaxed text-slate-800"
      >{{ exportedPtcglText }}</pre>
    </div>

    <!-- ======================================================================= -->
    <!-- SECTION A : TABLEAU DE BORD STATISTIQUE (LES 8 INDICATEURS CLÉS)        -->
    <!-- ======================================================================= -->
    <div v-if="currentSummary" class="space-y-4">
      <!-- 1. Bandeau de performance système -->
      <div class="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 shadow-xs">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs"
            >
              <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <div class="text-[11px] font-bold uppercase tracking-wider text-indigo-800">
                Bandeau de Performance Système &amp; Vitesse Moteur
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold text-slate-900">
                <span>
                  Temps d'exécution exact :
                  <strong class="font-mono text-indigo-900">{{ formatDuration(currentSummary.totalDurationMs) }}</strong>
                </span>
                <span class="text-indigo-300">•</span>
                <span>
                  Parties réelles terminées :
                  <strong class="font-mono text-slate-900">{{ currentSummary.totalGamesSimulated.toLocaleString('fr-FR') }}</strong>
                </span>
                <span class="text-indigo-300">•</span>
                <span>
                  Débit moyen :
                  <strong class="font-mono text-indigo-900">{{ currentSummary.gamesPerSecond.toLocaleString('fr-FR') }} parties / seconde</strong>
                </span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <span class="rounded-lg border border-indigo-200 bg-white px-3 py-1 font-mono text-xs text-indigo-900 shadow-2xs">
              Moy. tours / match : <strong>{{ currentSummary.avgTurnsPlayed }}t</strong>
            </span>
          </div>
        </div>
      </div>

      <!-- 2. Indicateurs de Victoire & Régularité (Grandes cartes KPI) -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <!-- KPI 1 : Win Rate Global (%) -->
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider text-slate-500">
              Win Rate Global
            </span>
            <span
              v-if="hasComparisonRun && baselineSummary"
              class="rounded px-2 py-0.5 font-mono text-xs font-bold"
              :class="
                currentSummary.globalWinRate - baselineSummary.globalWinRate > 0
                  ? 'bg-emerald-100 text-emerald-800'
                  : currentSummary.globalWinRate - baselineSummary.globalWinRate < 0
                    ? 'bg-red-100 text-red-800'
                    : 'bg-slate-100 text-slate-700'
              "
            >
              Δ {{ formatSignedDelta(currentSummary.globalWinRate - baselineSummary.globalWinRate, '%') }}
            </span>
          </div>
          <div class="mt-2 flex items-baseline gap-2">
            <span
              class="font-mono text-3xl font-bold"
              :class="
                currentSummary.globalWinRate >= 50
                  ? 'text-emerald-600'
                  : currentSummary.globalWinRate >= 45
                    ? 'text-amber-600'
                    : 'text-red-600'
              "
            >
              {{ currentSummary.globalWinRate.toFixed(1) }}%
            </span>
            <span v-if="hasComparisonRun && baselineSummary" class="font-mono text-xs text-slate-400">
              (Réf: {{ baselineSummary.globalWinRate.toFixed(1) }}%)
            </span>
          </div>
          <p class="mt-1 font-mono text-xs text-slate-500">
            {{ currentSummary.wins }}V – {{ currentSummary.losses }}D – {{ currentSummary.draws }}E
          </p>
        </div>

        <!-- KPI 2 : Taux de Mulligan (Main sans Pokémon de Base) -->
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div class="flex items-center justify-between">
            <div>
              <span class="text-xs font-bold uppercase tracking-wider text-slate-500">
                Taux de Mulligan
              </span>
              <span class="block text-[10px] text-slate-400">Main sans Pokémon de Base</span>
            </div>
            <span
              v-if="hasComparisonRun && baselineSummary"
              class="rounded px-2 py-0.5 font-mono text-xs font-bold"
              :class="
                currentSummary.gamesWithMulliganRate - baselineSummary.gamesWithMulliganRate < 0
                  ? 'bg-emerald-100 text-emerald-800'
                  : currentSummary.gamesWithMulliganRate - baselineSummary.gamesWithMulliganRate > 0
                    ? 'bg-red-100 text-red-800'
                    : 'bg-slate-100 text-slate-700'
              "
            >
              Δ {{ formatSignedDelta(currentSummary.gamesWithMulliganRate - baselineSummary.gamesWithMulliganRate, '%') }}
            </span>
          </div>
          <div class="mt-2 flex items-baseline gap-2">
            <span class="font-mono text-3xl font-bold text-slate-900">
              {{ currentSummary.gamesWithMulliganRate.toFixed(1) }}%
            </span>
            <span class="font-mono text-xs text-slate-500">
              ({{ currentSummary.totalPlayerMulligans }} totaux)
            </span>
          </div>
          <p class="mt-1 text-xs text-slate-500">
            {{ currentSummary.gamesWithMulliganCount }} partie(s) avec au moins un mulligan
          </p>
        </div>

        <!-- KPI 3 : Prizes Moyen Joueur -->
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div class="flex items-center justify-between">
            <div>
              <span class="text-xs font-bold uppercase tracking-wider text-slate-500">
                Prizes Moyen Joueur
              </span>
              <span class="block text-[10px] text-emerald-600 font-semibold">Récompenses prises / match</span>
            </div>
            <span
              v-if="hasComparisonRun && baselineSummary"
              class="rounded px-2 py-0.5 font-mono text-xs font-bold"
              :class="
                currentSummary.avgPlayerPrizesWon - baselineSummary.avgPlayerPrizesWon > 0
                  ? 'bg-emerald-100 text-emerald-800'
                  : currentSummary.avgPlayerPrizesWon - baselineSummary.avgPlayerPrizesWon < 0
                    ? 'bg-red-100 text-red-800'
                    : 'bg-slate-100 text-slate-700'
              "
            >
              Δ {{ formatSignedDelta(currentSummary.avgPlayerPrizesWon - baselineSummary.avgPlayerPrizesWon) }}
            </span>
          </div>
          <div class="mt-2 flex items-baseline gap-1.5">
            <span class="font-mono text-3xl font-bold text-emerald-600">
              {{ currentSummary.avgPlayerPrizesWon.toFixed(2) }}
            </span>
            <span class="text-sm font-semibold text-slate-400">/ 6.00</span>
          </div>
          <p class="mt-1 text-xs text-slate-500">
            Différentiel net :
            <strong :class="currentSummary.avgPlayerPrizesWon - currentSummary.avgOpponentPrizesWon >= 0 ? 'text-emerald-700' : 'text-rose-700'">
              {{ formatSignedDelta(currentSummary.avgPlayerPrizesWon - currentSummary.avgOpponentPrizesWon) }}
            </strong>
          </p>
        </div>

        <!-- KPI 4 : Prizes Moyen Adversaire -->
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div class="flex items-center justify-between">
            <div>
              <span class="text-xs font-bold uppercase tracking-wider text-slate-500">
                Prizes Moyen Adversaire
              </span>
              <span class="block text-[10px] text-rose-600 font-semibold">Récompenses concédées</span>
            </div>
            <span
              v-if="hasComparisonRun && baselineSummary"
              class="rounded px-2 py-0.5 font-mono text-xs font-bold"
              :class="
                currentSummary.avgOpponentPrizesWon - baselineSummary.avgOpponentPrizesWon < 0
                  ? 'bg-emerald-100 text-emerald-800'
                  : currentSummary.avgOpponentPrizesWon - baselineSummary.avgOpponentPrizesWon > 0
                    ? 'bg-red-100 text-red-800'
                    : 'bg-slate-100 text-slate-700'
              "
            >
              Δ {{ formatSignedDelta(currentSummary.avgOpponentPrizesWon - baselineSummary.avgOpponentPrizesWon) }}
            </span>
          </div>
          <div class="mt-2 flex items-baseline gap-1.5">
            <span class="font-mono text-3xl font-bold text-rose-600">
              {{ currentSummary.avgOpponentPrizesWon.toFixed(2) }}
            </span>
            <span class="text-sm font-semibold text-slate-400">/ 6.00</span>
          </div>
          <p class="mt-1 text-xs text-slate-500">
            Objectif : concéder &lt; 3.00 par partie
          </p>
        </div>
      </div>

      <!-- 3. Tableau des Matchups Affrontés (Détail par Deck) -->
      <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 class="text-sm font-bold text-slate-900">
              Tableau des Matchups Affrontés (Détail par Deck)
            </h3>
            <p class="text-xs text-slate-500">
              Détail de la performance face à chaque deck adverse sélectionné (IA 3-Ply des deux côtés)
            </p>
          </div>
          <div class="flex items-center gap-3 font-mono text-xs text-slate-500">
            <span>Setup Banc T1 (≥2) : <strong>{{ currentSummary.turn1BenchSetupRate }}%</strong></span>
            <span>•</span>
            <span>Attaquant Prêt T2 : <strong>{{ currentSummary.turn2AttackerReadyRate }}%</strong></span>
          </div>
        </div>

        <div class="mt-4 overflow-x-auto">
          <table class="w-full border-collapse text-left text-xs">
            <thead>
              <tr class="border-b border-slate-200 bg-slate-50 font-mono text-[11px] uppercase text-slate-500">
                <th class="px-3.5 py-2.5">Nom du Deck Adverse</th>
                <th class="px-3.5 py-2.5">Parties Jouées</th>
                <th class="px-3.5 py-2.5">Victoires / Défaites</th>
                <th class="px-3.5 py-2.5">Win Rate (%)</th>
                <th class="px-3.5 py-2.5">Prizes Moyens (J vs Adv)</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr
                v-for="m in currentSummary.matchupBreakdown"
                :key="m.opponentId"
                class="hover:bg-slate-50/80 transition"
              >
                <!-- Nom du Deck Adverse -->
                <td class="px-3.5 py-3">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-slate-900">{{ m.opponentName }}</span>
                    <span class="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                      {{ m.archetypeTag }}
                    </span>
                  </div>
                </td>

                <!-- Parties Jouées -->
                <td class="px-3.5 py-3 font-mono text-slate-700">
                  {{ m.gamesPlayed }}
                </td>

                <!-- Victoires / Défaites -->
                <td class="px-3.5 py-3 font-mono text-slate-700">
                  <span class="font-bold text-emerald-700">{{ m.wins }}V</span> –
                  <span class="font-bold text-rose-700">{{ m.losses }}D</span>
                  <span v-if="m.draws > 0"> – <span class="text-slate-500">{{ m.draws }}E</span></span>
                </td>

                <!-- Win Rate (%) + Jauge Visuelle Horizontale -->
                <td class="px-3.5 py-3">
                  <div class="flex items-center gap-3">
                    <span
                      class="font-mono text-sm font-bold"
                      :class="m.winRate >= 50 ? 'text-emerald-600' : 'text-rose-600'"
                    >
                      {{ m.winRate.toFixed(1) }}%
                    </span>

                    <span
                      v-if="hasComparisonRun && getBaselineMatchupWinRate(m.opponentId) !== null"
                      class="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
                      :class="
                        m.winRate - (getBaselineMatchupWinRate(m.opponentId) ?? 0) > 0
                          ? 'bg-emerald-100 text-emerald-800'
                          : m.winRate - (getBaselineMatchupWinRate(m.opponentId) ?? 0) < 0
                            ? 'bg-red-100 text-red-800'
                            : 'bg-slate-200 text-slate-700'
                      "
                    >
                      {{ formatSignedDelta(m.winRate - (getBaselineMatchupWinRate(m.opponentId) ?? 0), '%') }}
                    </span>

                    <!-- Jauge visuelle horizontale : vert si >= 50%, rouge si < 50% -->
                    <div class="h-2 w-28 overflow-hidden rounded-full bg-slate-200">
                      <div
                        class="h-full rounded-full transition-all duration-300"
                        :class="m.winRate >= 50 ? 'bg-emerald-500' : 'bg-rose-500'"
                        :style="{ width: `${Math.min(100, Math.max(0, m.winRate))}%` }"
                      ></div>
                    </div>
                  </div>
                </td>

                <!-- Prizes Moyens -->
                <td class="px-3.5 py-3 font-mono text-xs">
                  <span class="font-bold text-emerald-700">{{ m.avgPlayerPrizesWon.toFixed(2) }}</span>
                  <span class="text-slate-400"> vs </span>
                  <span class="font-bold text-rose-700">{{ m.avgOpponentPrizesWon.toFixed(2) }}</span>
                  <span class="text-[10px] text-slate-400"> / 6.00</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- =================================================================== -->
      <!-- BLOC 1 : CONTINUITÉ, RÉSILIENCE & FLEXIBILITÉ TACTIQUE (4 CARTES)   -->
      <!-- =================================================================== -->
      <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <span class="rounded bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-white">
              ANALYSE TACTIQUE AVANCÉE
            </span>
            <h3 class="mt-1.5 text-sm font-bold text-slate-900">
              Continuité, Résilience &amp; Flexibilité Tactique
            </h3>
            <p class="text-xs text-slate-500">
              Vitesse d'installation, continuité d'attaque sous One-Shot (Streaming), reprise post-Mashynn/Tampon et indépendance du Supporter
            </p>
          </div>

          <label class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
            <input
              type="checkbox"
              :checked="Boolean(stressTestOhko)"
              @change="emit('toggle-stress-ohko', ($event.target as HTMLInputElement).checked)"
              class="h-3.5 w-3.5 rounded border-slate-300 text-slate-900"
            />
            <span>Stress-Test « One-Shot par tour »</span>
          </label>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <!-- Carte 1 : Vitesse de Setup -->
          <div class="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold uppercase tracking-wider text-slate-600">
                Vitesse de Setup
              </span>
              <span class="rounded bg-indigo-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-indigo-800">
                TEMPO
              </span>
            </div>
            <div class="mt-2 flex items-baseline gap-2">
              <span class="font-mono text-2xl font-bold text-slate-900">
                Tour moyen : T{{ currentSummary.averageSetupTurn.toFixed(1) }}
              </span>
            </div>
            <div class="mt-2 font-mono text-[11px] text-slate-600">
              T1: <strong>{{ currentSummary.setupTurnHistogram.T1 }}%</strong> |
              T2: <strong>{{ currentSummary.setupTurnHistogram.T2 }}%</strong> |
              T3+: <strong>{{ (currentSummary.setupTurnHistogram.T3 + currentSummary.setupTurnHistogram.T4Plus).toFixed(1) }}%</strong>
            </div>
            <div class="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                class="bg-emerald-500"
                :style="{ width: `${currentSummary.setupTurnHistogram.T1}%` }"
                title="Setup T1"
              ></div>
              <div
                class="bg-indigo-500"
                :style="{ width: `${currentSummary.setupTurnHistogram.T2}%` }"
                title="Setup T2"
              ></div>
              <div
                class="bg-amber-500"
                :style="{ width: `${currentSummary.setupTurnHistogram.T3 + currentSummary.setupTurnHistogram.T4Plus}%` }"
                title="Setup T3+"
              ></div>
            </div>
          </div>

          <!-- Carte 2 : Continuité d'Attaque sous One-Shot (Streaming) -->
          <div class="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold uppercase tracking-wider text-slate-600">
                Continuité sous One-Shot
              </span>
              <span
                v-if="hasComparisonRun && baselineSummary"
                class="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
                :class="
                  currentSummary.attackerStreamingRate - baselineSummary.attackerStreamingRate >= 0
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-red-100 text-red-800'
                "
              >
                Δ {{ formatSignedDelta(currentSummary.attackerStreamingRate - baselineSummary.attackerStreamingRate, '%') }}
              </span>
            </div>
            <div class="mt-2 flex items-baseline gap-2">
              <span class="font-mono text-2xl font-bold text-emerald-700">
                {{ currentSummary.attackerStreamingRate.toFixed(1) }}%
              </span>
              <span class="font-mono text-[11px] text-slate-500">
                ({{ currentSummary.revengeAttackSuccessCount }}/{{ currentSummary.totalActiveKOsSuffered }} KOs)
              </span>
            </div>
            <p class="mt-1.5 text-xs text-slate-600">
              {{ currentSummary.attackerStreamingRate.toFixed(1) }} % de contre-attaques immédiates après un KO subi
            </p>
          </div>

          <!-- Carte 3 : Résilience Post-Tampon / Juge / Mashynn -->
          <div class="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold uppercase tracking-wider text-slate-600">
                Résilience Post-Mashynn
              </span>
              <span
                v-if="hasComparisonRun && baselineSummary"
                class="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
                :class="
                  currentSummary.postDisruptionResilience.postDisruptionAttackRate -
                    baselineSummary.postDisruptionResilience.postDisruptionAttackRate >=
                  0
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-red-100 text-red-800'
                "
              >
                Δ {{
                  formatSignedDelta(
                    currentSummary.postDisruptionResilience.postDisruptionAttackRate -
                      baselineSummary.postDisruptionResilience.postDisruptionAttackRate,
                    '%',
                  )
                }}
              </span>
            </div>
            <div class="mt-2 flex items-baseline gap-2">
              <span class="font-mono text-2xl font-bold text-indigo-700">
                {{ currentSummary.postDisruptionResilience.postDisruptionAttackRate.toFixed(1) }}%
              </span>
              <span class="font-mono text-[11px] text-slate-500">
                ({{ currentSummary.postDisruptionResilience.disruptionsSufferedCount }} cas)
              </span>
            </div>
            <p class="mt-1.5 text-xs text-slate-600">
              {{ currentSummary.postDisruptionResilience.postDisruptionAttackRate.toFixed(1) }} % de tours sauvés après reset de main (Brique : {{ currentSummary.postDisruptionResilience.postDisruptionBrickRate.toFixed(1) }} %)
            </p>
          </div>

          <!-- Carte 4 : Flexibilité "Ordres du Boss" -->
          <div class="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold uppercase tracking-wider text-slate-600">
                Flexibilité « Ordres du Boss »
              </span>
              <span
                v-if="hasComparisonRun && baselineSummary"
                class="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
                :class="
                  currentSummary.bossFlexibilityRate - baselineSummary.bossFlexibilityRate >= 0
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-red-100 text-red-800'
                "
              >
                Δ {{ formatSignedDelta(currentSummary.bossFlexibilityRate - baselineSummary.bossFlexibilityRate, '%') }}
              </span>
            </div>
            <div class="mt-2 flex items-baseline gap-2">
              <span class="font-mono text-2xl font-bold text-slate-900">
                {{ currentSummary.bossFlexibility.supporterFreeAttackRate.toFixed(1) }}%
              </span>
              <span class="font-mono text-[11px] text-emerald-700 font-semibold">
                Combo Gust+Atk: {{ currentSummary.bossFlexibility.bossPlusAttackComboRate.toFixed(1) }}%
              </span>
            </div>
            <p class="mt-1.5 text-xs text-slate-600">
              {{ currentSummary.bossFlexibility.supporterFreeAttackRate.toFixed(1) }} % d'attaques réalisées sans consommer le Supporter de pioche
            </p>
          </div>
        </div>
      </div>

      <!-- =================================================================== -->
      <!-- BLOC 2 : SPLIT J1 vs J2, IMPACT T1 (ITEM-LOCK) & COMBOS STRICTES    -->
      <!-- =================================================================== -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <!-- Comparatif Joueur 1 (1er) vs Joueur 2 (2d) & Impact Tour 1 (5 cols) -->
        <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-5 flex flex-col justify-between">
          <div>
            <span class="rounded bg-slate-100 border border-slate-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-slate-700">
              ORDRE DU TOUR &amp; PRESSION T1
            </span>
            <h3 class="mt-1.5 text-sm font-bold text-slate-900">
              Comparatif Joueur 1 (1er) vs Joueur 2 (2d) &amp; Impact Tour 1
            </h3>
            <p class="mt-0.5 text-xs text-slate-500">
              Performance selon l'initiative et capacité d'Item-Lock (type Rozbouton) ou d'attaque dès le T1 en J2
            </p>

            <div class="mt-4 grid grid-cols-2 gap-3">
              <div class="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div class="text-[11px] font-bold uppercase text-slate-500">
                  Win Rate en J1 (1er)
                </div>
                <div class="mt-1 font-mono text-2xl font-bold text-slate-900">
                  {{ currentSummary.turnOrderSplitStats.winRateGoingFirst.toFixed(1) }}%
                </div>
                <div class="mt-0.5 font-mono text-[11px] text-slate-500">
                  {{ currentSummary.turnOrderSplitStats.winsGoingFirst }}V / {{ currentSummary.turnOrderSplitStats.gamesGoingFirst }} parties
                </div>
              </div>

              <div class="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div class="text-[11px] font-bold uppercase text-slate-500">
                  Win Rate en J2 (2d)
                </div>
                <div class="mt-1 font-mono text-2xl font-bold text-indigo-700">
                  {{ currentSummary.turnOrderSplitStats.winRateGoingSecond.toFixed(1) }}%
                </div>
                <div class="mt-0.5 font-mono text-[11px] text-slate-500">
                  {{ currentSummary.turnOrderSplitStats.winsGoingSecond }}V / {{ currentSummary.turnOrderSplitStats.gamesGoingSecond }} parties
                </div>
              </div>
            </div>
          </div>

          <div class="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3.5">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-indigo-950">
                Taux d'Attaque / Item-Lock dès le Tour 1 en J2
              </span>
              <span class="font-mono text-sm font-bold text-indigo-800">
                {{ currentSummary.turnOrderSplitStats.turn1AttackOrItemLockRateJ2.toFixed(1) }}%
              </span>
            </div>
            <div class="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-indigo-200">
              <div
                class="h-full rounded-full bg-indigo-600"
                :style="{ width: `${Math.min(100, currentSummary.turnOrderSplitStats.turn1AttackOrItemLockRateJ2)}%` }"
              ></div>
            </div>
            <div class="mt-1.5 flex items-center justify-between font-mono text-[11px] text-indigo-900">
              <span>Verrouillage d'Objets T1 J2 (Pollen Démangeant) : <strong>{{ currentSummary.turnOrderSplitStats.turn1ItemLockRateJ2.toFixed(1) }}%</strong></span>
              <span>Dégâts Moy./Tour : <strong>{{ currentSummary.averageDamagePerTurn }}</strong></span>
            </div>
          </div>
        </div>

        <!-- Combos à Conditions Strictes & Dégâts Moyens par Tour (7 cols) -->
        <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-7">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <span class="rounded bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-emerald-800">
                COMBOS CONDITIONNELS &amp; PUISSANCE OFFENSIVE
              </span>
              <h3 class="mt-1.5 text-sm font-bold text-slate-900">
                Statistiques des Attaques &amp; Combos à Conditions Strictes
              </h3>
            </div>
            <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-800">
              Dégâts Moyens / Tour : <strong>{{ currentSummary.averageDamagePerTurn }} dégâts</strong>
            </div>
          </div>

          <div class="mt-3 overflow-x-auto">
            <table class="w-full border-collapse text-left text-xs">
              <thead>
                <tr class="border-b border-slate-200 bg-slate-50 font-mono text-[10px] uppercase text-slate-500">
                  <th class="px-3 py-2">Carte &amp; Action</th>
                  <th class="px-3 py-2">Condition Requise</th>
                  <th class="px-3 py-2">Taux Déclenchement</th>
                  <th class="px-3 py-2">1er Tour Moyen</th>
                  <th class="px-3 py-2">Dégâts Moyens</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr
                  v-for="combo in currentSummary.conditionalComboStats"
                  :key="combo.comboId"
                  class="hover:bg-slate-50/80"
                >
                  <td class="px-3 py-2.5 font-semibold text-slate-900">
                    {{ combo.label }}
                  </td>
                  <td class="px-3 py-2.5">
                    <span class="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                      {{ combo.conditionSummary }}
                    </span>
                  </td>
                  <td class="px-3 py-2.5 font-mono font-bold text-emerald-700">
                    {{ combo.triggerRate.toFixed(1) }}%
                  </td>
                  <td class="px-3 py-2.5 font-mono text-slate-700">
                    {{ combo.avgTriggerTurn > 0 ? `T${combo.avgTriggerTurn.toFixed(1)}` : '—' }}
                  </td>
                  <td class="px-3 py-2.5 font-mono font-bold text-slate-900">
                    {{ combo.avgDamageWhenTriggered > 0 ? `${combo.avgDamageWhenTriggered} dég.` : 'Effet' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- =================================================================== -->
      <!-- BLOC 3 : AUDIT D'UTILITÉ CARTE PAR CARTE & ALTERNATIVES             -->
      <!-- =================================================================== -->
      <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <span class="rounded bg-indigo-50 border border-indigo-200 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-indigo-800">
              AUDIT INDIVIDUEL &amp; RECOMMANDATIONS
            </span>
            <h3 class="mt-1.5 text-sm font-bold text-slate-900">
              Audit d'Utilité Carte par Carte &amp; Suggestions d'Alternatives (Supporter → Objet / Attaquant)
            </h3>
            <p class="text-xs text-slate-500">
              Repérez les cartes mortes ou défaussées sans effet, mesurez le risque de Prize Lock et remplacez un Supporter par un Objet/Talent équivalent en 1 clic.
            </p>
          </div>
        </div>

        <div
          v-if="replacedCardFeedback"
          class="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-900"
        >
          <span>{{ replacedCardFeedback }}</span>
          <button
            type="button"
            @click="replacedCardFeedback = null"
            class="text-emerald-700 hover:underline"
          >
            Fermer
          </button>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-left text-xs">
            <thead>
              <tr class="border-b border-slate-200 bg-slate-50 font-mono text-[11px] uppercase text-slate-500">
                <th class="px-3.5 py-2.5">Carte du Deck</th>
                <th class="px-3.5 py-2.5">Taux de Jeu Effectif (%)</th>
                <th class="px-3.5 py-2.5">Carte Morte / Défaussée sans effet (%)</th>
                <th class="px-3.5 py-2.5">Impact si Prized (Tous exemplaires)</th>
                <th class="px-3.5 py-2.5 text-right">Alternatives Intelligentes</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <template v-for="item in sortedCardTelemetry" :key="item.cardId">
                <tr class="hover:bg-slate-50/80 transition">
                  <!-- Carte du Deck -->
                  <td class="px-3.5 py-3">
                    <div class="flex items-center gap-2">
                      <span class="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                        {{ item.quantityInDeck }}x
                      </span>
                      <div>
                        <div class="font-semibold text-slate-900">{{ item.nameFr }}</div>
                        <div class="font-mono text-[10px] text-slate-400">
                          {{ item.cardId }} • {{ item.subCategory }}
                        </div>
                      </div>
                    </div>
                  </td>

                  <!-- Taux de Jeu Effectif (%) -->
                  <td class="px-3.5 py-3">
                    <div class="flex items-center gap-2.5">
                      <span class="w-12 font-mono text-xs font-bold text-emerald-700">
                        {{ item.effectivePlayRate.toFixed(1) }}%
                      </span>
                      <div class="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                        <div
                          class="h-full rounded-full bg-emerald-500"
                          :style="{ width: `${Math.min(100, item.effectivePlayRate)}%` }"
                        ></div>
                      </div>
                      <span class="font-mono text-[10px] text-slate-400">
                        (Vue: {{ item.drawnRate.toFixed(0) }}%)
                      </span>
                    </div>
                  </td>

                  <!-- Taux de Carte Morte / Défaussée sans effet (%) -->
                  <td class="px-3.5 py-3">
                    <div class="flex items-center gap-2.5">
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
                        {{ item.discardedUnusedRate.toFixed(1) }}%
                      </span>
                      <div class="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                        <div
                          class="h-full rounded-full"
                          :class="
                            item.discardedUnusedRate >= 25 ? 'bg-rose-500' : 'bg-amber-500'
                          "
                          :style="{ width: `${Math.min(100, item.discardedUnusedRate + item.deadHandTurnRate)}%` }"
                        ></div>
                      </div>
                      <span class="font-mono text-[10px] text-slate-500">
                        ({{ item.turnsStuckDeadInHand }}t bloquée)
                      </span>
                    </div>
                  </td>

                  <!-- Impact si Prized -->
                  <td class="px-3.5 py-3 font-mono text-xs">
                    <div v-if="item.gamesAllCopiesPrized > 0" class="flex items-center gap-1.5">
                      <span class="text-slate-700">{{ item.allCopiesPrizedRate.toFixed(1) }}% des parties</span>
                      <span
                        class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                        :class="
                          item.winRateImpactWhenAllPrized < 0
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-700'
                        "
                      >
                        WR: {{ formatSignedDelta(item.winRateImpactWhenAllPrized, '%') }}
                      </span>
                    </div>
                    <span v-else class="text-[11px] text-slate-400">
                      0% (Jamais 100% Prized)
                    </span>
                  </td>

                  <!-- Bouton Alternatives -->
                  <td class="px-3.5 py-3 text-right">
                    <button
                      v-if="(alternativesByCardId[item.cardId]?.length ?? 0) > 0"
                      type="button"
                      @click="toggleCardAlternatives(item.cardId)"
                      class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold transition"
                      :class="
                        expandedAlternativeCardId === item.cardId
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                      "
                    >
                      <span>
                        {{ alternativesByCardId[item.cardId]!.length }} Alternative{{ alternativesByCardId[item.cardId]!.length > 1 ? 's' : '' }} Objet/Attaquant
                      </span>
                    </button>
                    <span v-else class="font-mono text-[10px] text-slate-400">
                      Ressource de base
                    </span>
                  </td>
                </tr>

                <!-- Tiroir dépliable des Alternatives pour cette carte -->
                <tr v-if="expandedAlternativeCardId === item.cardId">
                  <td colspan="5" class="bg-indigo-50/40 px-4 py-4">
                    <div class="space-y-3">
                      <div class="flex items-center justify-between">
                        <h4 class="text-xs font-bold text-indigo-950">
                          Suggestions d'Alternatives dans cards_database.json pour {{ item.nameFr }}
                        </h4>
                        <button
                          type="button"
                          @click="expandedAlternativeCardId = null"
                          class="text-xs font-semibold text-slate-500 hover:text-slate-800"
                        >
                          Fermer le tiroir
                        </button>
                      </div>

                      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div
                          v-for="alt in alternativesByCardId[item.cardId]"
                          :key="alt.alternativeCardId"
                          class="flex flex-col justify-between rounded-xl border border-indigo-200 bg-white p-3.5 shadow-2xs"
                        >
                          <div>
                            <div class="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <span class="text-xs font-bold text-slate-900">{{ alt.alternativeNameFr }}</span>
                                <span class="ml-1.5 font-mono text-[10px] text-slate-400">
                                  ({{ alt.alternativeCardId }} • {{ alt.alternativeSubCategory }})
                                </span>
                              </div>
                              <span
                                class="rounded px-2 py-0.5 font-mono text-[10px] font-bold"
                                :class="
                                  alt.suggestionType === 'SUPPORTER_TO_ITEM_OR_ABILITY'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-slate-100 text-slate-700'
                                "
                              >
                                {{ alt.actionEconomyBadge }}
                              </span>
                            </div>

                            <p class="mt-2 text-xs leading-relaxed text-slate-600">
                              {{ alt.strategicReason }}
                            </p>

                            <!-- Comparaison côte à côte si c'est un Attaquant / Pokémon -->
                            <div
                              v-if="alt.attackerComparison && getTargetAttackerRow(item.cardId)"
                              class="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px]"
                            >
                              <div class="grid grid-cols-3 gap-2 border-b border-slate-200 pb-1 text-[10px] font-bold uppercase text-slate-500">
                                <span>Critère</span>
                                <span>{{ getTargetAttackerRow(item.cardId)!.nameFr }}</span>
                                <span class="text-indigo-700">{{ alt.attackerComparison.nameFr }}</span>
                              </div>
                              <div class="mt-1.5 grid grid-cols-3 gap-2">
                                <span class="text-slate-500">PV (HP)</span>
                                <span>{{ getTargetAttackerRow(item.cardId)!.hp }} PV</span>
                                <span class="font-bold text-slate-900">{{ alt.attackerComparison.hp }} PV</span>
                              </div>
                              <div class="mt-1 grid grid-cols-3 gap-2">
                                <span class="text-slate-500">Coût Énergie</span>
                                <span>{{ getTargetAttackerRow(item.cardId)!.energyCostCount }} NRJ</span>
                                <span class="font-bold text-slate-900">{{ alt.attackerComparison.energyCostCount }} NRJ</span>
                              </div>
                              <div class="mt-1 grid grid-cols-3 gap-2">
                                <span class="text-slate-500">Dégâts Base/Max</span>
                                <span>{{ getTargetAttackerRow(item.cardId)!.damageSummary }}</span>
                                <span class="font-bold text-emerald-700">{{ alt.attackerComparison.damageSummary }}</span>
                              </div>
                              <div class="mt-1 grid grid-cols-3 gap-2">
                                <span class="text-slate-500">Coût Retraite</span>
                                <span>{{ getTargetAttackerRow(item.cardId)!.retreatCost }}</span>
                                <span class="font-bold text-slate-900">{{ alt.attackerComparison.retreatCost }}</span>
                              </div>
                            </div>
                          </div>

                          <div class="mt-3 flex justify-end border-t border-slate-100 pt-2.5">
                            <button
                              type="button"
                              @click="handleReplaceWithAlternative(item.cardId, alt)"
                              class="rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-slate-700"
                            >
                              Remplacer dans l'Atelier A/B
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ======================================================================= -->
    <!-- SECTION B : ATELIER D'OPTIMISATION A/B (MODIFICATION & COMPARAISON)    -->
    <!-- ======================================================================= -->
    <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
      <!-- 1. En-tête de la section -->
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div class="flex items-center gap-2">
            <span class="rounded-md bg-indigo-50 border border-indigo-200 px-2 py-0.5 font-mono text-xs font-bold text-indigo-700">
              OPTIMISATION DU DECK
            </span>
          </div>
          <h2 class="mt-2 text-xl font-bold text-slate-900">
            Atelier d'Optimisation A/B
          </h2>
          <p class="mt-1 text-sm text-slate-600">
            Ajustez les ratios de vos cartes pour mesurer l'impact immédiat sur votre Win Rate par rapport au deck original.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2.5">
          <!-- 4. Export de la Variante -->
          <button
            type="button"
            @click="showExportPanel = !showExportPanel"
            class="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-2xs transition hover:bg-slate-50"
          >
            {{ showExportPanel ? 'Masquer Export PTCGL' : 'Exporter la Variante (PTCGL)' }}
          </button>

          <button
            v-if="hasComparisonRun"
            type="button"
            @click="emit('promote-current-as-baseline')"
            class="rounded-lg border border-emerald-600 bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-emerald-700"
          >
            Définir la variante comme nouvelle référence
          </button>

          <button
            v-if="cardDiffItems.length > 0"
            type="button"
            @click="emit('reset-to-baseline')"
            class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Réinitialiser au deck référence
          </button>
        </div>
      </div>

      <!-- 3. Affichage comparatif côte à côte (Delta Δ) si au moins une comparaison a été lancée -->
      <div
        v-if="hasComparisonRun && baselineSummary && currentSummary"
        class="rounded-xl border border-indigo-200 bg-indigo-50/40 p-5 space-y-4"
      >
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-3">
          <div>
            <span class="rounded bg-indigo-600 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
              RÉSULTATS DE COMPARAISON A/B
            </span>
            <h3 class="mt-1 text-base font-bold text-slate-900">
              Deck Référence (Baseline) vs Variante Active
            </h3>
          </div>
          <div class="text-xs font-mono text-indigo-900">
            Écart statistique mesuré sur {{ currentSummary.totalGamesSimulated }} parties
          </div>
        </div>

        <!-- Résumé des modifications de composition (Diff A/B) -->
        <div>
          <div class="text-xs font-bold uppercase tracking-wider text-slate-500">
            Résumé des modifications de composition :
          </div>
          <div v-if="cardDiffItems.length > 0" class="mt-2 flex flex-wrap gap-2">
            <span
              v-for="diff in cardDiffItems"
              :key="diff.cardId"
              class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-xs font-bold shadow-2xs"
              :class="
                diff.deltaQty > 0
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-red-300 bg-red-50 text-red-800'
              "
            >
              <span>{{ diff.deltaQty > 0 ? `+${diff.deltaQty}` : diff.deltaQty }}</span>
              <span class="font-sans font-semibold">{{ diff.nameFr }}</span>
              <span class="text-[10px] opacity-75">({{ diff.oldQty }} → {{ diff.newQty }})</span>
            </span>
          </div>
          <p v-else class="mt-1 text-xs text-slate-500">
            Aucune modification de cartes par rapport au Deck Référence.
          </p>
        </div>

        <!-- Tableau comparatif clair présentant : Indicateur | Deck Référence | Variante Active | Écart (Delta Δ) -->
        <div class="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table class="w-full border-collapse text-left text-xs">
            <thead>
              <tr class="border-b border-slate-200 bg-slate-50 font-mono text-[11px] uppercase text-slate-500">
                <th class="px-4 py-3">Indicateur</th>
                <th class="px-4 py-3">Deck Référence</th>
                <th class="px-4 py-3">Variante Active</th>
                <th class="px-4 py-3">Écart (Delta Δ)</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-mono">
              <tr>
                <td class="px-4 py-3 font-sans font-semibold text-slate-900">Win Rate Global</td>
                <td class="px-4 py-3 text-slate-600">{{ baselineSummary.globalWinRate.toFixed(1) }}%</td>
                <td class="px-4 py-3 font-bold text-slate-900">{{ currentSummary.globalWinRate.toFixed(1) }}%</td>
                <td class="px-4 py-3">
                  <span
                    class="rounded-md px-2.5 py-1 font-bold inline-flex items-center gap-1"
                    :class="
                      currentSummary.globalWinRate - baselineSummary.globalWinRate > 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : currentSummary.globalWinRate - baselineSummary.globalWinRate < 0
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-100 text-slate-600'
                    "
                  >
                    Δ {{ formatSignedDelta(currentSummary.globalWinRate - baselineSummary.globalWinRate, '%') }}
                    <span class="font-normal text-[11px] opacity-80">({{ baselineSummary.globalWinRate.toFixed(1) }}% → {{ currentSummary.globalWinRate.toFixed(1) }}%)</span>
                  </span>
                </td>
              </tr>
              <tr>
                <td class="px-4 py-3 font-sans font-semibold text-slate-900">Taux de Mulligan</td>
                <td class="px-4 py-3 text-slate-600">{{ baselineSummary.gamesWithMulliganRate.toFixed(1) }}%</td>
                <td class="px-4 py-3 font-bold text-slate-900">{{ currentSummary.gamesWithMulliganRate.toFixed(1) }}%</td>
                <td class="px-4 py-3">
                  <span
                    class="rounded-md px-2.5 py-1 font-bold inline-flex items-center gap-1"
                    :class="
                      currentSummary.gamesWithMulliganRate - baselineSummary.gamesWithMulliganRate < 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : currentSummary.gamesWithMulliganRate - baselineSummary.gamesWithMulliganRate > 0
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-100 text-slate-600'
                    "
                  >
                    Δ {{ formatSignedDelta(currentSummary.gamesWithMulliganRate - baselineSummary.gamesWithMulliganRate, '%') }}
                    <span class="font-normal text-[11px] opacity-80">({{ baselineSummary.gamesWithMulliganRate.toFixed(1) }}% → {{ currentSummary.gamesWithMulliganRate.toFixed(1) }}%)</span>
                  </span>
                </td>
              </tr>
              <tr>
                <td class="px-4 py-3 font-sans font-semibold text-slate-900">Prizes Moyens Gagnés (Joueur)</td>
                <td class="px-4 py-3 text-slate-600">{{ baselineSummary.avgPlayerPrizesWon.toFixed(2) }} / 6.00</td>
                <td class="px-4 py-3 font-bold text-slate-900">{{ currentSummary.avgPlayerPrizesWon.toFixed(2) }} / 6.00</td>
                <td class="px-4 py-3">
                  <span
                    class="rounded-md px-2.5 py-1 font-bold inline-flex items-center gap-1"
                    :class="
                      currentSummary.avgPlayerPrizesWon - baselineSummary.avgPlayerPrizesWon > 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : currentSummary.avgPlayerPrizesWon - baselineSummary.avgPlayerPrizesWon < 0
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-100 text-slate-600'
                    "
                  >
                    Δ {{ formatSignedDelta(currentSummary.avgPlayerPrizesWon - baselineSummary.avgPlayerPrizesWon) }}
                    <span class="font-normal text-[11px] opacity-80">({{ baselineSummary.avgPlayerPrizesWon.toFixed(2) }} → {{ currentSummary.avgPlayerPrizesWon.toFixed(2) }})</span>
                  </span>
                </td>
              </tr>
              <tr>
                <td class="px-4 py-3 font-sans font-semibold text-slate-900">Prizes Moyens Concédés (Adv.)</td>
                <td class="px-4 py-3 text-slate-600">{{ baselineSummary.avgOpponentPrizesWon.toFixed(2) }} / 6.00</td>
                <td class="px-4 py-3 font-bold text-slate-900">{{ currentSummary.avgOpponentPrizesWon.toFixed(2) }} / 6.00</td>
                <td class="px-4 py-3">
                  <span
                    class="rounded-md px-2.5 py-1 font-bold inline-flex items-center gap-1"
                    :class="
                      currentSummary.avgOpponentPrizesWon - baselineSummary.avgOpponentPrizesWon < 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : currentSummary.avgOpponentPrizesWon - baselineSummary.avgOpponentPrizesWon > 0
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-100 text-slate-600'
                    "
                  >
                    Δ {{ formatSignedDelta(currentSummary.avgOpponentPrizesWon - baselineSummary.avgOpponentPrizesWon) }}
                    <span class="font-normal text-[11px] opacity-80">({{ baselineSummary.avgOpponentPrizesWon.toFixed(2) }} → {{ currentSummary.avgOpponentPrizesWon.toFixed(2) }})</span>
                  </span>
                </td>
              </tr>
              <tr>
                <td class="px-4 py-3 font-sans font-semibold text-slate-900">Continuité d'Attaque sous One-Shot</td>
                <td class="px-4 py-3 text-slate-600">{{ baselineSummary.attackerStreamingRate.toFixed(1) }}%</td>
                <td class="px-4 py-3 font-bold text-slate-900">{{ currentSummary.attackerStreamingRate.toFixed(1) }}%</td>
                <td class="px-4 py-3">
                  <span
                    class="rounded-md px-2.5 py-1 font-bold inline-flex items-center gap-1"
                    :class="
                      currentSummary.attackerStreamingRate - baselineSummary.attackerStreamingRate > 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : currentSummary.attackerStreamingRate - baselineSummary.attackerStreamingRate < 0
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-100 text-slate-600'
                    "
                  >
                    Δ {{ formatSignedDelta(currentSummary.attackerStreamingRate - baselineSummary.attackerStreamingRate, '%') }}
                    <span class="font-normal text-[11px] opacity-80">({{ baselineSummary.attackerStreamingRate.toFixed(1) }}% → {{ currentSummary.attackerStreamingRate.toFixed(1) }}%)</span>
                  </span>
                </td>
              </tr>
              <tr>
                <td class="px-4 py-3 font-sans font-semibold text-slate-900">Résilience Post-Tampon / Mashynn</td>
                <td class="px-4 py-3 text-slate-600">{{ baselineSummary.postDisruptionResilience.postDisruptionAttackRate.toFixed(1) }}%</td>
                <td class="px-4 py-3 font-bold text-slate-900">{{ currentSummary.postDisruptionResilience.postDisruptionAttackRate.toFixed(1) }}%</td>
                <td class="px-4 py-3">
                  <span
                    class="rounded-md px-2.5 py-1 font-bold inline-flex items-center gap-1"
                    :class="
                      currentSummary.postDisruptionResilience.postDisruptionAttackRate -
                        baselineSummary.postDisruptionResilience.postDisruptionAttackRate >
                      0
                        ? 'bg-emerald-100 text-emerald-800'
                        : currentSummary.postDisruptionResilience.postDisruptionAttackRate -
                              baselineSummary.postDisruptionResilience.postDisruptionAttackRate <
                            0
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-100 text-slate-600'
                    "
                  >
                    Δ {{
                      formatSignedDelta(
                        currentSummary.postDisruptionResilience.postDisruptionAttackRate -
                          baselineSummary.postDisruptionResilience.postDisruptionAttackRate,
                        '%',
                      )
                    }}
                  </span>
                </td>
              </tr>
              <tr>
                <td class="px-4 py-3 font-sans font-semibold text-slate-900">Flexibilité Ordres du Boss</td>
                <td class="px-4 py-3 text-slate-600">{{ baselineSummary.bossFlexibilityRate.toFixed(1) }}%</td>
                <td class="px-4 py-3 font-bold text-slate-900">{{ currentSummary.bossFlexibilityRate.toFixed(1) }}%</td>
                <td class="px-4 py-3">
                  <span
                    class="rounded-md px-2.5 py-1 font-bold inline-flex items-center gap-1"
                    :class="
                      currentSummary.bossFlexibilityRate - baselineSummary.bossFlexibilityRate > 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : currentSummary.bossFlexibilityRate - baselineSummary.bossFlexibilityRate < 0
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-100 text-slate-600'
                    "
                  >
                    Δ {{ formatSignedDelta(currentSummary.bossFlexibilityRate - baselineSummary.bossFlexibilityRate, '%') }}
                    <span class="font-normal text-[11px] opacity-80">({{ baselineSummary.bossFlexibilityRate.toFixed(1) }}% → {{ currentSummary.bossFlexibilityRate.toFixed(1) }}%)</span>
                  </span>
                </td>
              </tr>
              <tr>
                <td class="px-4 py-3 font-sans font-semibold text-slate-900">Dégâts Moyens par Tour</td>
                <td class="px-4 py-3 text-slate-600">{{ baselineSummary.averageDamagePerTurn }}</td>
                <td class="px-4 py-3 font-bold text-slate-900">{{ currentSummary.averageDamagePerTurn }}</td>
                <td class="px-4 py-3">
                  <span
                    class="rounded-md px-2.5 py-1 font-bold inline-flex items-center gap-1"
                    :class="
                      currentSummary.averageDamagePerTurn - baselineSummary.averageDamagePerTurn > 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : currentSummary.averageDamagePerTurn - baselineSummary.averageDamagePerTurn < 0
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-100 text-slate-600'
                    "
                  >
                    Δ {{ formatSignedDelta(currentSummary.averageDamagePerTurn - baselineSummary.averageDamagePerTurn) }}
                    <span class="font-normal text-[11px] opacity-80">({{ baselineSummary.averageDamagePerTurn }} → {{ currentSummary.averageDamagePerTurn }})</span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 2. Mécanique de comparaison : Barre de statut & Verrou strict 60 cartes -->
      <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="rounded bg-slate-200 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                Deck Référence (Baseline) : 60 cartes
              </span>
              <span class="text-slate-300">→</span>
              <span class="rounded bg-indigo-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-800">
                Variante Active : {{ editableDeck.totalCards }} / 60 cartes
              </span>
            </div>
            <p class="mt-1 text-xs text-slate-600">
              Modifiez la composition ci-dessous puis lancez la simulation comparative pour mesurer le différentiel.
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <!-- Compteur dynamique strict : XX / 60 cartes -->
            <div
              class="flex items-center gap-2 rounded-xl border px-3.5 py-2 font-mono text-sm font-bold shadow-2xs"
              :class="
                editableDeck.totalCards === 60 && editableDeck.hasAtLeastOneBasic && editableDeck.isFullyResolved
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-red-300 bg-red-50 text-red-800'
              "
            >
              <span>Total : {{ editableDeck.totalCards }} / 60 cartes</span>
              <span
                v-if="editableDeck.totalCards !== 60"
                class="rounded bg-red-600 px-1.5 py-0.5 text-[10px] text-white"
              >
                {{
                  editableDeck.totalCards < 60
                    ? `Manque ${60 - editableDeck.totalCards}`
                    : `Excédent +${editableDeck.totalCards - 60}`
                }}
              </span>
            </div>

            <!-- Bouton [Annuler la simulation] -->
            <button
              v-if="isSimulating"
              type="button"
              @click="emit('cancel-simulation')"
              class="inline-flex items-center gap-1.5 rounded-xl border border-rose-600 bg-rose-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-rose-700 active:bg-rose-800"
            >
              <svg class="h-4 w-4 shrink-0 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span>Annuler la simulation</span>
            </button>

            <!-- Bouton [Simuler la Variante & Comparer] -->
            <button
              type="button"
              :disabled="compareButtonState.disabled"
              @click="emit('rerun-and-compare')"
              class="inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-xs font-bold transition shadow-xs sm:text-sm"
              :class="
                compareButtonState.disabled
                  ? 'opacity-60 cursor-not-allowed bg-slate-300 text-slate-600 border-slate-300'
                  : 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700'
              "
            >
              <svg
                v-if="compareButtonState.showSpinner"
                class="h-4 w-4 animate-spin text-slate-600"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
              </svg>
              <span>{{ compareButtonState.label }}</span>
            </button>
          </div>
        </div>

        <!-- Alerte obligatoire si base de données non chargée -->
        <div
          v-if="!editableDeck.isDatabaseLoaded"
          class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800 flex items-center gap-2"
        >
          <svg class="h-4 w-4 shrink-0 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Simulation impossible : la base de données cards_database.json est vide.</span>
        </div>

        <!-- Alerte obligatoire si total != 60 -->
        <div
          v-else-if="editableDeck.totalCards !== 60"
          class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800 flex items-center gap-2"
        >
          <svg class="h-4 w-4 shrink-0 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Le deck doit contenir exactement 60 cartes pour lancer une comparaison (actuellement : {{ editableDeck.totalCards }} cartes).</span>
        </div>

        <!-- Alerte si aucun Pokémon de Base -->
        <div
          v-else-if="!editableDeck.hasAtLeastOneBasic"
          class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800 flex items-center gap-2"
        >
          <svg class="h-4 w-4 shrink-0 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Le deck doit contenir au moins 1 Pokémon de Base pour lancer une comparaison.</span>
        </div>

        <!-- Alerte si une carte ajoutée n'est pas résolue -->
        <div
          v-else-if="!editableDeck.isFullyResolved"
          class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800 flex items-center gap-2"
        >
          <svg class="h-4 w-4 shrink-0 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Simulation impossible : {{ editableDeck.unresolvedCount }} carte(s) ajoutée(s) ne sont pas résolues dans la base de données.</span>
        </div>

        <!-- Résumé rapide des modifications en attente (avant relance) si pas encore de comparaison -->
        <div
          v-if="cardDiffItems.length > 0 && !hasComparisonRun"
          class="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs"
        >
          <span class="font-semibold text-slate-600">Modifications par rapport au Deck Référence :</span>
          <span
            v-for="d in cardDiffItems"
            :key="d.cardId"
            class="rounded px-2 py-0.5 font-mono text-[11px] font-bold"
            :class="
              d.deltaQty > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
            "
          >
            {{ d.deltaQty > 0 ? `+${d.deltaQty}` : d.deltaQty }} {{ d.nameFr }}
          </span>
        </div>
      </div>

      <!-- Grille des 3 colonnes d'édition (Pokémon / Dresseurs / Énergies) -->
      <div class="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <!-- Colonne Pokémon -->
        <div class="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
          <div class="mb-2.5 flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700">
              Pokémon ({{ editableDeck.pokemonCount }})
            </h4>
            <span class="font-mono text-[11px] text-slate-500">
              Bases: {{ editableDeck.basicPokemonCount }}
            </span>
          </div>

          <ul class="space-y-1.5">
            <li
              v-for="card in editablePokemons"
              :key="card.cardId"
              class="flex items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-1.5 text-xs"
              :class="
                getCardDeltaAgainstBaseline(card.cardId) !== 0
                  ? 'border-slate-900 shadow-2xs'
                  : 'border-slate-200'
              "
            >
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="truncate font-semibold text-slate-900">{{ card.nameFr }}</span>
                  <span
                    v-if="getCardDeltaAgainstBaseline(card.cardId) !== 0"
                    class="rounded px-1 font-mono text-[10px] font-bold"
                    :class="
                      getCardDeltaAgainstBaseline(card.cardId) > 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-800'
                    "
                  >
                    {{
                      getCardDeltaAgainstBaseline(card.cardId) > 0
                        ? `+${getCardDeltaAgainstBaseline(card.cardId)}`
                        : getCardDeltaAgainstBaseline(card.cardId)
                    }}
                  </span>
                </div>
                <div class="font-mono text-[10px] text-slate-400">
                  {{ card.cardId }} • {{ card.subCategory }}
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label="Diminuer la quantité"
                  @click="emit('adjust-card-qty', card.cardId, -1)"
                  class="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-slate-50 font-mono text-xs font-bold text-slate-700 hover:bg-slate-200"
                >
                  -
                </button>
                <span class="w-6 text-center font-mono text-xs font-bold text-slate-900">
                  {{ card.quantity }}
                </span>
                <button
                  type="button"
                  aria-label="Augmenter la quantité"
                  :disabled="card.quantity >= 4"
                  @click="emit('adjust-card-qty', card.cardId, 1)"
                  class="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-slate-50 font-mono text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                >
                  +
                </button>
                <button
                  type="button"
                  aria-label="Supprimer la carte"
                  @click="emit('remove-card', card.cardId)"
                  class="ml-0.5 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                  title="Retirer du deck"
                >
                  ×
                </button>
              </div>
            </li>
          </ul>
        </div>

        <!-- Colonne Dresseurs -->
        <div class="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
          <div class="mb-2.5 flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700">
              Dresseurs ({{ editableDeck.trainerCount }})
            </h4>
            <span class="font-mono text-[11px] text-slate-500">Max 4 / nom</span>
          </div>

          <ul class="space-y-1.5">
            <li
              v-for="card in editableTrainers"
              :key="card.cardId"
              class="flex items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-1.5 text-xs"
              :class="
                getCardDeltaAgainstBaseline(card.cardId) !== 0
                  ? 'border-slate-900 shadow-2xs'
                  : 'border-slate-200'
              "
            >
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="truncate font-semibold text-slate-900">{{ card.nameFr }}</span>
                  <span
                    v-if="getCardDeltaAgainstBaseline(card.cardId) !== 0"
                    class="rounded px-1 font-mono text-[10px] font-bold"
                    :class="
                      getCardDeltaAgainstBaseline(card.cardId) > 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-800'
                    "
                  >
                    {{
                      getCardDeltaAgainstBaseline(card.cardId) > 0
                        ? `+${getCardDeltaAgainstBaseline(card.cardId)}`
                        : getCardDeltaAgainstBaseline(card.cardId)
                    }}
                  </span>
                </div>
                <div class="font-mono text-[10px] text-slate-400">
                  {{ card.cardId }} • {{ card.subCategory }}
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label="Diminuer la quantité"
                  @click="emit('adjust-card-qty', card.cardId, -1)"
                  class="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-slate-50 font-mono text-xs font-bold text-slate-700 hover:bg-slate-200"
                >
                  -
                </button>
                <span class="w-6 text-center font-mono text-xs font-bold text-slate-900">
                  {{ card.quantity }}
                </span>
                <button
                  type="button"
                  aria-label="Augmenter la quantité"
                  :disabled="card.quantity >= 4"
                  @click="emit('adjust-card-qty', card.cardId, 1)"
                  class="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-slate-50 font-mono text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                >
                  +
                </button>
                <button
                  type="button"
                  aria-label="Supprimer la carte"
                  @click="emit('remove-card', card.cardId)"
                  class="ml-0.5 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                  title="Retirer du deck"
                >
                  ×
                </button>
              </div>
            </li>
          </ul>
        </div>

        <!-- Colonne Énergies & Ajout depuis le Catalogue -->
        <div class="space-y-4">
          <div class="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
            <div class="mb-2.5 flex items-center justify-between border-b border-slate-200 pb-2">
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700">
                Énergies ({{ editableDeck.energyCount }})
              </h4>
              <span class="font-mono text-[11px] text-slate-500">Base: illimité</span>
            </div>

            <ul class="space-y-1.5">
              <li
                v-for="card in editableEnergies"
                :key="card.cardId"
                class="flex items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-1.5 text-xs"
                :class="
                  getCardDeltaAgainstBaseline(card.cardId) !== 0
                    ? 'border-slate-900 shadow-2xs'
                    : 'border-slate-200'
                "
              >
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="truncate font-semibold text-slate-900">{{ card.nameFr }}</span>
                    <span
                      v-if="getCardDeltaAgainstBaseline(card.cardId) !== 0"
                      class="rounded px-1 font-mono text-[10px] font-bold"
                      :class="
                        getCardDeltaAgainstBaseline(card.cardId) > 0
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-red-100 text-red-800'
                      "
                    >
                      {{
                        getCardDeltaAgainstBaseline(card.cardId) > 0
                          ? `+${getCardDeltaAgainstBaseline(card.cardId)}`
                          : getCardDeltaAgainstBaseline(card.cardId)
                      }}
                    </span>
                  </div>
                  <div class="font-mono text-[10px] text-slate-400">
                    {{ card.cardId }}
                  </div>
                </div>

                <div class="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label="Diminuer la quantité"
                    @click="emit('adjust-card-qty', card.cardId, -1)"
                    class="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-slate-50 font-mono text-xs font-bold text-slate-700 hover:bg-slate-200"
                  >
                    -
                  </button>
                  <span class="w-6 text-center font-mono text-xs font-bold text-slate-900">
                    {{ card.quantity }}
                  </span>
                  <button
                    type="button"
                    aria-label="Augmenter la quantité"
                    :disabled="card.subCategory === 'SPECIAL_ENERGY' && card.quantity >= 4"
                    @click="emit('adjust-card-qty', card.cardId, 1)"
                    class="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-slate-50 font-mono text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    aria-label="Supprimer la carte"
                    @click="emit('remove-card', card.cardId)"
                    class="ml-0.5 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                    title="Retirer du deck"
                  >
                    ×
                  </button>
                </div>
              </li>
            </ul>
          </div>

          <!-- Barre de recherche pour ajouter une nouvelle carte depuis le catalogue compilé -->
          <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
            <label for="catalog-search" class="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Ajouter une carte depuis le Catalogue Compilé
            </label>
            <input
              id="catalog-search"
              v-model="catalogSearchQuery"
              type="text"
              placeholder="Rechercher : Mashynn, Poffin, Favianos, sv04-125..."
              class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
            />

            <ul class="mt-2.5 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              <li
                v-for="model in filteredCatalogModels"
                :key="model.cardId"
                class="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs hover:bg-slate-50"
              >
                <div class="min-w-0">
                  <div class="truncate font-semibold text-slate-800">
                    {{ model.identity.nameFr }}
                  </div>
                  <div class="font-mono text-[10px] text-slate-400">
                    {{ model.cardId }} • {{ model.subCategory }}
                  </div>
                </div>
                <button
                  type="button"
                  @click="emit('add-catalog-card', model)"
                  class="shrink-0 rounded border border-slate-900 bg-slate-900 px-2 py-1 font-mono text-[10px] font-bold text-white hover:bg-slate-700"
                >
                  + Ajouter
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- ======================================================================= -->
    <!-- SECTION D : INSPECTEUR GRANULAIRE DÉBLOQUÉ EN MODE DEBUG (?debug=true)  -->
    <!-- ======================================================================= -->
    <DebugInspectorPanel
      v-if="isDebugMode && currentSummary"
      :traced-games="currentSummary.tracedGames"
    />
  </section>
</template>
