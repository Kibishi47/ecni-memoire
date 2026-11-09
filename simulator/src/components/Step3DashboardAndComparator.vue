<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EngineCardModel } from '../types/cardModel'
import type { ParsedDeck, ParsedDeckEntry } from '../types/deck'
import type {
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

const catalogSearchQuery = ref('')
const showExportModal = ref(false)
const exportLang = ref<'fr' | 'en'>('fr')
const copiedFeedback = ref(false)
const replacedCardFeedback = ref<string | null>(null)

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

// Exporter la variante est permis UNIQUEMENT si au moins une variante a ete calculee ou modifiee
const hasCalculatedVariant = computed(() => {
  return (
    cardDiffItems.value.length > 0 &&
    props.currentSummary !== null &&
    props.editableDeck.totalCards === 60
  )
})

const isDeckModified = computed(() => cardDiffItems.value.length > 0)

const hasComparisonRun = computed(() => {
  return (
    props.baselineSummary !== null &&
    props.currentSummary !== null &&
    props.baselineSummary !== props.currentSummary
  )
})

// Carte actuellement sélectionnée dans l'Atelier pour afficher ses alternatives et son image
const selectedCardId = ref<string>(
  props.editableDeck.cards[0]?.cardId || '',
)

const selectedCardEntry = computed<ParsedDeckEntry | null>(() => {
  return (
    props.editableDeck.cards.find((c) => c.cardId === selectedCardId.value) ||
    props.editableDeck.cards[0] ||
    null
  )
})

const selectedCardAlternatives = computed<SmartAlternativeSuggestion[]>(() => {
  if (!selectedCardEntry.value) return []
  return findAlternativesForCard(selectedCardEntry.value.model, allCatalogModels)
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
      label: `Simulation en cours... (${progressPercent.value} %)`,
      showSpinner: true,
    }
  }
  if (props.editableDeck.totalCards !== 60) {
    return {
      disabled: true,
      label: `Ajustez le deck (${props.editableDeck.totalCards} / 60 cartes requises)`,
      showSpinner: false,
    }
  }
  return {
    disabled: false,
    label: isDeckModified.value
      ? 'Tester cette variante et comparer'
      : 'Relancer la simulation',
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

function formatSignedDelta(delta: number, suffix = ''): string {
  const rounded = Math.round(delta * 10) / 10
  if (rounded > 0) return `+${rounded}${suffix}`
  return `${rounded}${suffix}`
}

function handleImgError(event: Event) {
  const target = event.target as HTMLElement
  if (target) {
    target.style.display = 'none'
  }
}
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
              Performances Globales
            </span>
            <span v-if="hasComparisonRun" class="rounded-lg bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-900">
              Variante A/B Comparée
            </span>
          </div>

          <div class="mt-3 flex items-baseline gap-4">
            <span class="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
              {{ currentSummary ? (currentSummary.globalWinRate * 100).toFixed(1) : '0.0' }} %
            </span>
            <span class="text-sm font-semibold text-slate-500">
              Taux de Victoire Global
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
              <span>{{ formatSignedDelta((currentSummary!.globalWinRate - baselineSummary.globalWinRate) * 100, ' %') }}</span>
              <span class="text-xs font-medium">vs deck initial</span>
            </div>
          </div>

          <p class="mt-2 text-xs text-slate-500">
            Basé sur {{ currentSummary?.totalGamesSimulated ?? 0 }} parties simulées face aux decks méta sélectionnés.
          </p>
        </div>

        <!-- Boutons d'action : Re-simuler et Exporter la variante -->
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            :disabled="compareButtonState.disabled"
            @click="emit('rerun-and-compare')"
            class="flex items-center gap-2 rounded-xl border border-slate-900 bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-xs transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:border-slate-300"
          >
            <span>{{ compareButtonState.label }}</span>
          </button>

          <!-- Bouton Exporter la variante : visible UNIQUEMENT si au moins une variante a été calculée -->
          <button
            v-if="hasCalculatedVariant"
            type="button"
            @click="showExportModal = true"
            class="flex items-center gap-2 rounded-xl border border-indigo-600 bg-indigo-50 px-5 py-3 text-sm font-bold text-indigo-900 shadow-xs transition hover:bg-indigo-100"
          >
            <span>Exporter la variante PTCGL</span>
          </button>
        </div>
      </div>

      <!-- Barre de progression de la simulation -->
      <div v-if="isSimulating" class="mt-6 border-t border-slate-100 pt-4">
        <div class="flex items-center justify-between text-xs font-semibold text-slate-700">
          <span>Simulation en cours... {{ progressCompleted }} / {{ progressTotal }} parties</span>
          <span>{{ progressPercent }} %</span>
        </div>
        <div class="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div class="h-full bg-indigo-600 transition-all duration-150" :style="{ width: `${progressPercent}%` }"></div>
        </div>
      </div>
    </div>

    <!-- 2. DETAIL PAR MATCHUP (TOP 3 META) -->
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
            {{ formatSignedDelta((m.winRate - getBaselineMatchupWinRate(m.opponentId)!) * 100, ' %') }}
          </span>
        </div>

        <h3 class="mt-2 text-base font-bold text-slate-900 truncate">
          {{ m.opponentName }}
        </h3>

        <div class="mt-3 flex items-baseline justify-between">
          <span class="text-2xl font-black" :class="m.winRate >= 0.5 ? 'text-emerald-700' : 'text-amber-800'">
            {{ (m.winRate * 100).toFixed(1) }} %
          </span>
          <span class="text-xs text-slate-500 font-medium">
            {{ m.wins }}V - {{ m.losses }}D ({{ m.gamesPlayed }} parties)
          </span>
        </div>

        <!-- Jauge visuelle de victoire -->
        <div class="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            class="h-full rounded-full transition-all"
            :class="m.winRate >= 0.5 ? 'bg-emerald-600' : m.winRate >= 0.4 ? 'bg-amber-500' : 'bg-rose-500'"
            :style="{ width: `${Math.min(100, Math.round(m.winRate * 100))}%` }"
          ></div>
        </div>
      </div>
    </div>

    <!-- 3. INDICATEURS CLES DE PERFORMANCE (KPIS STRATEGIQUES) -->
    <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
      <div class="mb-4">
        <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700">
          Indicateurs Clés de Stabilité &amp; Efficacité
        </h3>
        <p class="mt-1 text-xs text-slate-500">
          Mesures de consistance au cours des parties simulées
        </p>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <!-- KPI 1 : Vitesse de Setup -->
        <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div class="text-xs font-bold text-slate-600">Vitesse de Setup (T1/T2)</div>
          <div class="mt-2 text-2xl font-black text-slate-900">
            {{ currentSummary ? (currentSummary.turn2AttackerReadyRate * 100).toFixed(1) : '0' }} %
          </div>
          <p class="mt-1 text-[11px] text-slate-500">
            Attaquant prêt et alimenté en énergie dès le Tour 2.
          </p>
        </div>

        <!-- KPI 2 : Enchaînement des Attaquants -->
        <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div class="text-xs font-bold text-slate-600">Enchaînement d'Attaque</div>
          <div class="mt-2 text-2xl font-black text-slate-900">
            {{ currentSummary ? (currentSummary.attackerStreamingRate * 100).toFixed(1) : '0' }} %
          </div>
          <p class="mt-1 text-[11px] text-slate-500">
            Capacité à riposter immédiatement après avoir subi un KO.
          </p>
        </div>

        <!-- KPI 3 : Résilience aux Perturbations -->
        <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div class="text-xs font-bold text-slate-600">Résilience aux Perturbations</div>
          <div class="mt-2 text-2xl font-black text-slate-900">
            {{ currentSummary && currentSummary.postDisruptionResilience ? (currentSummary.postDisruptionResilience.postDisruptionAttackRate * 100).toFixed(1) : '0' }} %
          </div>
          <p class="mt-1 text-[11px] text-slate-500">
            Taux de reprise après une carte comme Mashynn ou Tampon Injuste.
          </p>
        </div>

        <!-- KPI 4 : Flexibilité Ordres du Boss -->
        <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div class="text-xs font-bold text-slate-600">Flexibilité Ordres du Boss</div>
          <div class="mt-2 text-2xl font-black text-slate-900">
            {{ currentSummary ? (currentSummary.bossFlexibilityRate * 100).toFixed(1) : '0' }} %
          </div>
          <p class="mt-1 text-[11px] text-slate-500">
            Attaquer et cibler le banc sans bloquer sa propre pioche.
          </p>
        </div>
      </div>
    </div>

    <!-- 4. ATELIER D'OPTIMISATION A/B (COMPARATEUR DE CARTES) -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <!-- Colonne Gauche : Composition du deck modifiable -->
      <div class="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-5">
        <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 class="text-sm font-bold text-slate-900">Composition du Deck</h3>
            <p class="text-xs text-slate-500">Cliquez sur une carte pour voir ses alternatives</p>
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

        <!-- Liste des cartes -->
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
              <!-- Miniature de la carte -->
              <img
                v-if="getCardImageUrl(card)"
                :src="getCardImageUrl(card)!"
                :alt="card.nameFr"
                loading="lazy"
                @error="handleImgError"
                class="h-12 w-8 shrink-0 rounded object-cover shadow-2xs border"
                :class="selectedCardId === card.cardId ? 'border-white/30' : 'border-slate-200'"
              />
              <div
                v-else
                class="flex h-12 w-8 shrink-0 items-center justify-center rounded bg-slate-200 text-[10px] font-bold text-slate-600"
              >
                {{ card.category.slice(0, 3).toUpperCase() }}
              </div>

              <div class="min-w-0">
                <div class="truncate text-xs font-bold">
                  {{ card.nameFr }}
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
            placeholder="Rechercher une carte à ajouter (ex: Mashynn, Poffin)..."
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
                  class="h-8 w-6 shrink-0 rounded object-cover"
                />
                <span class="truncate font-semibold text-slate-800">{{ model.identity.nameFr }}</span>
              </div>
              <button
                type="button"
                @click="emit('add-catalog-card', model)"
                class="rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-bold text-white hover:bg-slate-800"
              >
                + Ajouter
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Colonne Droite : Fiche de la carte sélectionnée & Alternatives -->
      <div class="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-7">
        <!-- Fiche de la carte sélectionnée -->
        <div v-if="selectedCardEntry" class="mb-5 flex items-start gap-4 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
          <!-- Image agrandie -->
          <img
            v-if="getCardImageUrl(selectedCardEntry)"
            :src="getCardImageUrl(selectedCardEntry)!"
            :alt="selectedCardEntry.nameFr"
            loading="lazy"
            @error="handleImgError"
            class="h-28 w-20 shrink-0 rounded-lg object-cover shadow-sm border border-slate-200"
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
              <span v-if="selectedCardEntry.model.pokemonStats?.hp">• {{ selectedCardEntry.model.pokemonStats.hp }} PV</span>
            </div>

            <p class="mt-2 text-xs leading-relaxed text-slate-600">
              {{ selectedCardEntry.model.identity.rawRulesText?.join(' ') || 'Carte sans effet de règles particulier.' }}
            </p>
          </div>
        </div>

        <!-- Liste des alternatives recommandées -->
        <div>
          <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700">
            Alternatives Suggérées
          </h4>

          <!-- Cas A : Carte sans alternatives (ex: Attaquant principal, Super Bonbon) -->
          <div
            v-if="selectedCardAlternatives.length === 0"
            class="mt-3 rounded-xl border border-slate-100 bg-slate-50/50 p-5 text-center text-xs text-slate-500"
          >
            <div class="font-bold text-slate-700">
              Aucun remplacement suggéré pour {{ selectedCardEntry?.nameFr || 'cette carte' }}
            </div>
            <p class="mt-1 text-slate-500">
              Cette carte constitue la base ou le moteur central de votre stratégie. La remplacer affaiblirait la cohérence du deck.
            </p>
          </div>

          <!-- Cas B : Liste d'alternatives pertinentes -->
          <div v-else class="mt-3 space-y-3">
            <div
              v-for="alt in selectedCardAlternatives.slice(0, 4)"
              :key="alt.alternativeCardId"
              class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs transition hover:border-slate-300"
            >
              <div class="flex items-center gap-3 min-w-0">
                <!-- Miniature alternative -->
                <img
                  v-if="getCardImageUrl(alt.alternativeModel)"
                  :src="getCardImageUrl(alt.alternativeModel)!"
                  :alt="alt.alternativeNameFr"
                  loading="lazy"
                  @error="handleImgError"
                  class="h-16 w-11 shrink-0 rounded object-cover shadow-2xs border border-slate-200"
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
                Remplacer dans le deck
              </button>
            </div>
          </div>
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
            Exporter la variante optimisée (60 cartes)
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
            <span class="text-xs text-slate-500">Format prêt à coller dans Pokémon TCG Live :</span>
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
              Télécharger .txt
            </button>
            <button
              type="button"
              @click="copyExportedDeck"
              class="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
            >
              {{ copiedFeedback ? 'Liste copiée !' : 'Copier dans le presse-papier' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- PANNEAU TECHNIQUE DE DEBUG (UNIQUEMENT SI ?debug=true) -->
    <DebugInspectorPanel
      v-if="isDebugMode && currentSummary"
      :traced-games="currentSummary.tracedGames"
    />
  </div>
</template>
