<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EngineCardModel } from '../types/cardModel'
import type { ParsedDeck, ParsedDeckEntry } from '../types/deck'
import type { DeckCardContributionItem, SimulationMetricsSummary } from '../types/simulator'
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
}>()

const emit = defineEmits<{
  (e: 'adjust-card-qty', cardId: string, delta: number): void
  (e: 'remove-card', cardId: string): void
  (e: 'add-catalog-card', model: EngineCardModel): void
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
