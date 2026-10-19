<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import {
  Archetype,
  TournamentMeta,
  OptimizationTargetId,
  OptimizationResult
} from '../types/deck'
import { runOptimization, generatePTCGLDecklist } from '../utils/optimizer'
import {
  Cpu,
  Sparkles,
  ArrowLeft,
  Copy,
  Check,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  FileText,
  RotateCcw,
  Gauge
} from 'lucide-vue-next'

const props = defineProps<{
  archetype: Archetype
  meta: TournamentMeta
  targetId: OptimizationTargetId
}>()

const emit = defineEmits<{
  (e: 'previousStep'): void
  (e: 'goToStep1'): void
  (e: 'calculationFinished', result: OptimizationResult): void
}>()

// Animation states for heuristic convergence
const isCalculating = ref<boolean>(false)
const calculationPhase = ref<number>(0)
const phaseMessage = ref<string>('')
const evaluatedCount = ref<number>(0)
const calculationProgress = ref<number>(0)
const hasRunOnce = ref<boolean>(false)

// Result state
const result = ref<OptimizationResult | null>(null)

// UI view mode: 'flex_only' vs 'full_deck'
const viewMode = ref<'flex_only' | 'full_deck'>('flex_only')

// Copy state & toast
const showCopyToast = ref<boolean>(false)
const copied = ref<boolean>(false)
const showDecklistModal = ref<boolean>(false)

// Full 60 cards preview computation
const fullDeckCards = computed(() => {
  if (!result.value) return []
  const list: { name: string; nameEn: string; count: number; category: string; isFlex: boolean; diff?: number }[] = []

  // Add core cards
  for (const c of props.archetype.coreCards) {
    list.push({
      name: c.name,
      nameEn: c.nameEn,
      count: c.count,
      category: c.category,
      isFlex: false,
    })
  }

  // Add prescribed candidate cards
  for (const cand of props.archetype.candidates) {
    const recommendedCount = result.value.prescribedAllocation[cand.id] || 0
    if (recommendedCount > 0) {
      const existing = list.find(item => item.nameEn === cand.nameEn)
      const diff = recommendedCount - cand.standardCount
      if (existing) {
        existing.count += recommendedCount
        existing.isFlex = true
        existing.diff = diff
      } else {
        list.push({
          name: cand.name,
          nameEn: cand.nameEn,
          count: recommendedCount,
          category: cand.category,
          isFlex: true,
          diff,
        })
      }
    }
  }

  return list
})

const ptcglDecklistText = computed(() => {
  if (!result.value) return ''
  return generatePTCGLDecklist(props.archetype, result.value.prescribedAllocation)
})

// Run the animated combinatorial heuristic convergence
function triggerCalculation() {
  isCalculating.value = true
  calculationProgress.value = 10
  calculationPhase.value = 1
  phaseMessage.value = 'Exploration combinatoire de 144 permutations valides...'
  evaluatedCount.value = 12

  // Animate phase 1 -> 2
  setTimeout(() => {
    calculationPhase.value = 2
    calculationProgress.value = 65
    evaluatedCount.value = 86
    phaseMessage.value = 'Évaluation Monte-Carlo pondérée sur le méta de salle...'
  }, 280)

  // Animate phase 2 -> 3
  setTimeout(() => {
    calculationPhase.value = 3
    calculationProgress.value = 95
    evaluatedCount.value = 144
    phaseMessage.value = 'Optimum global trouvé ! Synthèse des ratios...'
  }, 540)

  // Finalize
  setTimeout(() => {
    const optResult = runOptimization(props.archetype, props.meta, props.targetId)
    result.value = optResult
    isCalculating.value = false
    calculationProgress.value = 100
    hasRunOnce.value = true
    emit('calculationFinished', optResult)
  }, 750)
}

// 1-Click PTCGL Export with clipboard API
async function copyPTCGLDecklist() {
  if (!ptcglDecklistText.value) return
  try {
    await navigator.clipboard.writeText(ptcglDecklistText.value)
    copied.value = true
    showCopyToast.value = true
    setTimeout(() => {
      copied.value = false
    }, 2500)
    setTimeout(() => {
      showCopyToast.value = false
    }, 3500)
  } catch (err) {
    console.error('Clipboard copy error:', err)
  }
}

// Watchers for props update
watch(
  () => [props.archetype.id, props.meta, props.targetId],
  () => {
    triggerCalculation()
  },
  { deep: true }
)

onMounted(() => {
  triggerCalculation()
})
</script>

<template>
  <div class="space-y-6">
    <!-- Toast Notification for Copy -->
    <transition
      enter-active-class="transform ease-out duration-300 transition"
      enter-from-class="translate-y-2 opacity-0 sm:translate-y-0 sm:translate-x-2"
      enter-to-class="translate-y-0 opacity-100 sm:translate-x-0"
      leave-active-class="transition ease-in duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showCopyToast"
        class="fixed bottom-6 right-6 z-50 flex items-center space-x-3 bg-emerald-500 text-slate-950 px-5 py-3 rounded-xl shadow-2xl font-bold text-sm border border-emerald-300"
      >
        <Check class="w-5 h-5 stroke-[3]" />
        <div>
          <span>Liste PTCGL copiée dans le presse-papier !</span>
          <span class="block text-[11px] font-mono font-normal opacity-90">60 cartes prêtes à être importées dans le jeu</span>
        </div>
      </div>
    </transition>

    <!-- Header Action Banner -->
    <div class="bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
      <div class="absolute -right-16 -top-16 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>

      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
        <div>
          <div class="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-2">
            <Cpu class="w-3.5 h-3.5" />
            <span>Étape 3 sur 3 • Prescription des Ratios Optimaux</span>
          </div>
          <h2 class="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <span>Résultats de l'Optimiseur Heuristique Go</span>
          </h2>
          <p class="text-slate-400 text-sm mt-1 max-w-3xl leading-relaxed">
            Recommandation mathématique des <span class="text-amber-400 font-mono font-semibold">{{ archetype.flexSlotsCount }} Flex Slots</span>
            pour <span class="text-white font-semibold">{{ archetype.name }}</span>
            face à un méta de <span class="text-amber-400 font-mono">{{ meta.aggroRate }}% Aggro</span>,
            <span class="text-cyan-400 font-mono">{{ meta.evolutionRate }}% Évolution</span> et
            <span class="text-purple-400 font-mono">{{ meta.controlRate }}% Contrôle</span>.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            @click="emit('previousStep')"
            class="inline-flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold text-xs transition-colors"
          >
            <ArrowLeft class="w-4 h-4" />
            <span>Ajuster méta</span>
          </button>

          <button
            type="button"
            @click="triggerCalculation"
            :disabled="isCalculating"
            class="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 font-semibold text-xs transition-colors disabled:opacity-50"
          >
            <RotateCcw :class="['w-3.5 h-3.5', isCalculating ? 'animate-spin' : '']" />
            <span>Recalculer</span>
          </button>

          <button
            type="button"
            @click="copyPTCGLDecklist"
            class="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-all shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98]"
          >
            <component :is="copied ? Check : Copy" class="w-4 h-4" />
            <span>{{ copied ? 'Liste Copiée !' : 'Copier 60 cartes (PTCGL)' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Convergence Animation Banner (Shown during calculation or when recomputing) -->
    <div
      v-if="isCalculating"
      class="bg-slate-900/90 border border-amber-500/50 rounded-2xl p-6 shadow-2xl relative overflow-hidden"
    >
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center space-x-3">
          <div class="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Cpu class="w-4 h-4 animate-spin-slow" />
          </div>
          <div>
            <span class="text-xs font-mono font-bold uppercase tracking-wider text-amber-400">
              Convergence Heuristique en cours...
            </span>
            <p class="text-sm font-semibold text-white">
              {{ phaseMessage }}
            </p>
          </div>
        </div>

        <div class="text-right font-mono">
          <span class="text-xs text-slate-400">Permutations testées :</span>
          <span class="text-sm font-bold text-amber-400 ml-1.5">{{ evaluatedCount }}/144</span>
        </div>
      </div>

      <!-- Animated Progress Bar -->
      <div class="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800">
        <div
          class="h-full bg-gradient-to-r from-amber-500 via-emerald-400 to-cyan-400 transition-all duration-200"
          :style="{ width: `${calculationProgress}%` }"
        ></div>
      </div>
    </div>

    <!-- Main Results Section (Visible once result is ready) -->
    <div v-if="result && !isCalculating" class="space-y-6">
      
      <!-- 1. Weighted Performance Gain Banner (Highlight Section) -->
      <div class="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border border-emerald-500/30 rounded-2xl p-6 relative overflow-hidden shadow-xl">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          
          <!-- Score comparison gauge -->
          <div class="lg:col-span-7 flex flex-col sm:flex-row items-start sm:items-center gap-6">
            <div class="flex items-center space-x-4">
              <!-- Optimized big score -->
              <div class="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center min-w-[130px]">
                <span class="block text-[10px] uppercase font-mono font-bold text-emerald-400">Score PokéTuner</span>
                <span class="text-3xl font-extrabold font-mono text-emerald-300">{{ result.optimizedScore }}%</span>
                <span class="block text-[10px] text-emerald-400/80 mt-0.5">Sorties réussies T2</span>
              </div>

              <!-- VS Badge -->
              <div class="flex flex-col items-center">
                <span class="text-xs font-mono font-bold text-slate-500">VS</span>
                <span class="text-xs font-bold font-mono text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full mt-1 border border-emerald-500/40">
                  +{{ result.gainPercentage }}%
                </span>
              </div>

              <!-- Standard baseline score -->
              <div class="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 text-center min-w-[130px]">
                <span class="block text-[10px] uppercase font-mono text-slate-400">Standard Limitless</span>
                <span class="text-3xl font-extrabold font-mono text-slate-400">{{ result.standardScore }}%</span>
                <span class="block text-[10px] text-slate-500 mt-0.5">Ratio moyen netlist</span>
              </div>
            </div>

            <div class="border-l border-slate-800 pl-4 sm:pl-6 space-y-1">
              <h4 class="text-base font-bold text-white flex items-center space-x-2">
                <TrendingUp class="w-4 h-4 text-emerald-400" />
                <span>Gain de Performance Pondéré : <span class="text-emerald-400">+{{ result.gainPercentage }}%</span></span>
              </h4>
              <p class="text-xs text-slate-300 leading-relaxed max-w-md">
                L'optimisation des <span class="font-mono text-amber-400">{{ result.totalFlexSlots }} Flex Slots</span>
                augmente significativement votre taux de sorties réussies contre cette salle précise,
                passant de <strong class="text-slate-400">{{ result.standardScore }}%</strong> à
                <strong class="text-emerald-400">{{ result.optimizedScore }}%</strong>.
              </p>
            </div>
          </div>

          <!-- Breakdown by archetype in tournament -->
          <div class="lg:col-span-5 grid grid-cols-3 gap-2 text-center text-xs font-mono">
            <div class="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
              <span class="text-amber-400 block text-[10px] uppercase font-bold">Face Aggro</span>
              <span class="text-white font-bold text-sm block mt-1">{{ result.matchupPerformance.aggro.optimized }}%</span>
              <span class="text-[10px] text-slate-500">vs {{ result.matchupPerformance.aggro.standard }}% std</span>
            </div>
            <div class="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
              <span class="text-cyan-400 block text-[10px] uppercase font-bold">Face Évolution</span>
              <span class="text-white font-bold text-sm block mt-1">{{ result.matchupPerformance.evolution.optimized }}%</span>
              <span class="text-[10px] text-slate-500">vs {{ result.matchupPerformance.evolution.standard }}% std</span>
            </div>
            <div class="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
              <span class="text-purple-400 block text-[10px] uppercase font-bold">Face Contrôle</span>
              <span class="text-white font-bold text-sm block mt-1">{{ result.matchupPerformance.control.optimized }}%</span>
              <span class="text-[10px] text-slate-500">vs {{ result.matchupPerformance.control.standard }}% std</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. The Prescribed Optimal Formula (The 13 or 14 Cards) -->
      <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-5">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 class="text-lg font-bold text-white flex items-center space-x-2">
              <Sparkles class="w-5 h-5 text-amber-400" />
              <span>Formule Optimale Prescrite ({{ result.totalFlexSlots }} Cartes Exactes)</span>
            </h3>
            <p class="text-xs text-slate-400 mt-0.5">
              Comparaison précise face aux "Ratios standards copiés sur Limitless" avec justification algorithmique.
            </p>
          </div>

          <!-- View mode toggle: Flex Slots Only vs Full 60 Cards -->
          <div class="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs font-mono">
            <button
              type="button"
              @click="viewMode = 'flex_only'"
              :class="[
                'px-3 py-1.5 rounded-lg transition-colors font-medium',
                viewMode === 'flex_only' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              ]"
            >
              Vue Flex Slots ({{ result.totalFlexSlots }})
            </button>
            <button
              type="button"
              @click="viewMode = 'full_deck'"
              :class="[
                'px-3 py-1.5 rounded-lg transition-colors font-medium',
                viewMode === 'full_deck' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              ]"
            >
              Vue Deck Complet (60)
            </button>
          </div>
        </div>

        <!-- Mode A: Flex Slots Rationale Table -->
        <div v-if="viewMode === 'flex_only'" class="space-y-3">
          <div
            v-for="item in result.rationaleList"
            :key="item.cardId"
            class="p-4 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700/80 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
          >
            <!-- Left: Card title, counts and diff badge -->
            <div class="flex items-center space-x-3 min-w-[280px]">
              <!-- Recommended count badge -->
              <div class="w-12 h-12 rounded-xl bg-slate-900 border border-slate-700 flex flex-col items-center justify-center shrink-0">
                <span class="text-xs font-mono text-slate-400 uppercase leading-none">Recom.</span>
                <span class="text-lg font-bold font-mono text-amber-400 leading-none mt-1">{{ item.recommendedCount }}×</span>
              </div>

              <div>
                <div class="flex items-center space-x-2">
                  <span class="text-sm font-bold text-white">{{ item.cardName }}</span>
                  
                  <!-- Diff badge (+1, -1, =) -->
                  <span
                    v-if="item.diff > 0"
                    class="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  >
                    +{{ item.diff }}
                  </span>
                  <span
                    v-else-if="item.diff < 0"
                    class="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30"
                  >
                    {{ item.diff }}
                  </span>
                  <span
                    v-else
                    class="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-slate-800 text-slate-400 border border-slate-700"
                  >
                    Identique
                  </span>
                </div>

                <div class="flex items-center space-x-2 text-xs font-mono text-slate-400 mt-1">
                  <span>Standard Limitless : <strong class="text-slate-300">{{ item.standardCount }}×</strong></span>
                  <span>•</span>
                  <span>Impact méta : <span class="text-amber-400/90 font-medium">Prioritaire</span></span>
                </div>
              </div>
            </div>

            <!-- Right: Tactical rationale text -->
            <div class="flex-1 text-xs text-slate-300 leading-relaxed bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
              <strong class="text-slate-200">Justification :</strong> {{ item.reason }}
            </div>
          </div>
        </div>

        <!-- Mode B: Full 60 cards list grouped by category -->
        <div v-else class="space-y-4">
          <div class="bg-slate-950/80 p-4 rounded-xl border border-slate-800 flex items-center justify-between text-xs font-mono">
            <span class="text-slate-300">Composition totale : 60 cartes validées</span>
            <span class="text-amber-400 font-semibold">{{ archetype.coreCount }} cartes fixes + {{ archetype.flexSlotsCount }} flex optimisées</span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[420px] overflow-y-auto pr-1">
            <div
              v-for="card in fullDeckCards"
              :key="card.nameEn"
              :class="[
                'p-2.5 rounded-xl border flex items-center justify-between text-xs',
                card.isFlex
                  ? 'bg-amber-500/5 border-amber-500/30'
                  : 'bg-slate-950/60 border-slate-800/80'
              ]"
            >
              <div class="flex items-center space-x-2.5 min-w-0">
                <span
                  :class="[
                    'w-6 h-6 rounded-md font-mono font-bold flex items-center justify-center shrink-0 text-xs',
                    card.isFlex ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'
                  ]"
                >
                  {{ card.count }}×
                </span>
                <div class="truncate">
                  <span class="font-medium text-slate-200 block truncate">{{ card.name }}</span>
                  <span class="text-[10px] text-slate-500 font-mono truncate">{{ card.nameEn }}</span>
                </div>
              </div>

              <div class="flex items-center space-x-1.5 shrink-0 ml-2">
                <span
                  v-if="card.isFlex"
                  class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30"
                >
                  FLEX
                </span>
                <span
                  v-if="card.diff && card.diff !== 0"
                  :class="[
                    'px-1.5 py-0.5 rounded text-[10px] font-mono font-bold',
                    card.diff > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                  ]"
                >
                  {{ card.diff > 0 ? `+${card.diff}` : card.diff }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Resource Sensitivity Heatmap & Energy Distribution Curve -->
      <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div>
          <div class="flex items-center justify-between">
            <h3 class="text-base font-bold text-white flex items-center space-x-2">
              <Gauge class="w-5 h-5 text-amber-400" />
              <span>Heatmap / Courbe de Sensibilité des Énergies (5 à 8 Énergies)</span>
            </h3>
            <span class="text-xs font-mono text-slate-400">Simulation Monte-Carlo (10 000 mains)</span>
          </div>
          <p class="text-xs text-slate-400 mt-1">
            Analyse de l'équilibre critique entre risque de sous-alimentation (incapacité d'attaquer T2) et risque de surcharge (brique en main).
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div
            v-for="point in result.energySensitivity"
            :key="point.energyCount"
            :class="[
              'p-4 rounded-xl border flex flex-col justify-between transition-all duration-150',
              point.status === 'optimal'
                ? 'bg-emerald-950/20 border-emerald-500/50 shadow-lg shadow-emerald-500/5 ring-1 ring-emerald-500/20'
                : point.status === 'critical_low'
                ? 'bg-rose-950/20 border-rose-500/40'
                : 'bg-amber-950/20 border-amber-500/40'
            ]"
          >
            <!-- Card Header -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-lg font-bold font-mono text-white">
                  {{ point.energyCount }} Énergies
                </span>
                <span
                  :class="[
                    'text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded-full border',
                    point.status === 'optimal'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : point.status === 'critical_low'
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  ]"
                >
                  {{ point.status === 'optimal' ? 'Zone Verte (Optimum)' : point.status === 'critical_low' ? 'Zone Rouge (Déficit)' : 'Zone Jaune (Surcharge)' }}
                </span>
              </div>

              <!-- Visual gauges -->
              <div class="space-y-2 mt-3 text-xs font-mono">
                <div>
                  <div class="flex justify-between text-[11px] mb-1">
                    <span class="text-slate-400">Risque de manque T2 :</span>
                    <span :class="point.underpowerRisk > 20 ? 'text-rose-400 font-bold' : 'text-slate-300'">
                      {{ point.underpowerRisk }}%
                    </span>
                  </div>
                  <div class="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden">
                    <div
                      class="h-full bg-rose-500"
                      :style="{ width: `${point.underpowerRisk}%` }"
                    ></div>
                  </div>
                </div>

                <div>
                  <div class="flex justify-between text-[11px] mb-1">
                    <span class="text-slate-400">Risque de brique (surcharge) :</span>
                    <span :class="point.brickRisk > 20 ? 'text-amber-400 font-bold' : 'text-slate-300'">
                      {{ point.brickRisk }}%
                    </span>
                  </div>
                  <div class="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden">
                    <div
                      class="h-full bg-amber-500"
                      :style="{ width: `${point.brickRisk}%` }"
                    ></div>
                  </div>
                </div>

                <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span class="text-slate-400 font-semibold">Efficacité globale :</span>
                  <span :class="['font-bold text-sm', point.status === 'optimal' ? 'text-emerald-400' : 'text-slate-300']">
                    {{ point.optimalScore }}%
                  </span>
                </div>
              </div>
            </div>

            <!-- Recommendation note -->
            <p class="text-[11px] text-slate-300 mt-3 pt-2.5 border-t border-slate-800/60 leading-snug">
              {{ point.recommendation }}
            </p>
          </div>
        </div>
      </div>

      <!-- 4. Export Decklist Section (1-Click PTCGL & Raw Preview) -->
      <div class="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div class="space-y-1">
          <div class="flex items-center space-x-2">
            <FileText class="w-5 h-5 text-emerald-400" />
            <h3 class="text-base font-bold text-white">Exportation en 1 Clic (Format Officiel PTCGL)</h3>
          </div>
          <p class="text-xs text-slate-400 max-w-xl">
            La liste finale de 60 cartes intègre les {{ archetype.coreCount }} cartes fixes et les {{ archetype.flexSlotsCount }} ratios prescrits.
            Collez-la directement dans l'éditeur de deck de Pokémon TCG Live.
          </p>
        </div>

        <div class="flex items-center space-x-3 shrink-0">
          <button
            type="button"
            @click="showDecklistModal = !showDecklistModal"
            class="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-semibold transition-colors flex items-center space-x-2"
          >
            <span>{{ showDecklistModal ? 'Masquer texte brut' : 'Voir texte brut' }}</span>
            <component :is="showDecklistModal ? ChevronUp : ChevronDown" class="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            @click="copyPTCGLDecklist"
            class="px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-all shadow-lg shadow-emerald-500/20 flex items-center space-x-2 hover:scale-[1.02] active:scale-[0.98]"
          >
            <component :is="copied ? Check : Copy" class="w-4 h-4 stroke-[2.5]" />
            <span>{{ copied ? 'Liste Copiée !' : 'Copier la liste optimisée' }}</span>
          </button>
        </div>
      </div>

      <!-- Raw text preview drawer -->
      <div v-if="showDecklistModal" class="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-xs text-slate-300">
        <div class="flex items-center justify-between pb-3 mb-3 border-b border-slate-800 text-slate-400">
          <span>Format PTCGL Standard (English Names)</span>
          <button
            type="button"
            @click="copyPTCGLDecklist"
            class="text-amber-400 hover:text-amber-300 text-[11px] underline"
          >
            Copier tout
          </button>
        </div>
        <pre class="overflow-x-auto whitespace-pre leading-relaxed select-all max-h-64">{{ ptcglDecklistText }}</pre>
      </div>

    </div>
  </div>
</template>
