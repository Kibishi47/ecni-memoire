<script setup lang="ts">
import {
  ArrowLeft,
  AlertTriangle,
  Zap,
  RefreshCw,
  Shield,
  ThumbsUp,
  RotateCcw,
} from 'lucide-vue-next'
import type { WizardResult, DeckProfile } from '../types/wizard'

defineProps<{
  deck: DeckProfile
  result: WizardResult
}>()

const emit = defineEmits<{
  (e: 'back-to-step2'): void
  (e: 'back-to-step1'): void
}>()

function getOpponentIcon(category: string) {
  if (category.toLowerCase().includes('rapide')) return Zap
  if (category.toLowerCase().includes('évolution')) return RefreshCw
  return Shield
}

function getBadgeStyle(badgeType: 'positive' | 'negative' | 'neutral') {
  switch (badgeType) {
    case 'positive':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    case 'negative':
      return 'bg-red-50 text-red-700 border-red-200'
    case 'neutral':
      return 'bg-slate-100 text-slate-700 border-slate-200'
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6 py-2">
    <!-- Top Banner: Modification Testée & Back Button -->
    <div class="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
      <div>
        <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
          Modification testée sur {{ deck.name }} :
        </span>
        <p class="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
          {{ result.changeSummary }}
        </p>
      </div>

      <button
        type="button"
        @click="emit('back-to-step2')"
        class="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer shrink-0"
      >
        <ArrowLeft class="w-3.5 h-3.5" />
        <span>Tester un autre changement</span>
      </button>
    </div>

    <!-- Le Verdict en 1 phrase -->
    <div
      class="rounded-2xl p-5 sm:p-6 border flex items-start space-x-3.5 shadow-xs"
      :class="
        result.isRecommended
          ? 'bg-blue-50/80 border-blue-200 text-blue-950'
          : 'bg-amber-50/80 border-amber-200 text-amber-950'
      "
    >
      <div
        class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        :class="result.isRecommended ? 'bg-blue-600 text-white' : 'bg-amber-600 text-white'"
      >
        <ThumbsUp v-if="result.isRecommended" class="w-5 h-5" />
        <AlertTriangle v-else class="w-5 h-5" />
      </div>

      <div>
        <span
          class="text-xs font-bold uppercase tracking-wider block mb-1"
          :class="result.isRecommended ? 'text-blue-700' : 'text-amber-700'"
        >
          Verdict du comparateur :
        </span>
        <p class="text-base sm:text-lg font-bold leading-snug">
          {{ result.verdictOneLiner }}
        </p>
      </div>
    </div>

    <!-- 3 Cartes de Résultats Simples (Avant vs Après) -->
    <div class="space-y-3">
      <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider">
        Statistiques clés (Avant vs Après)
      </h3>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <!-- Metric 1: Stabilité T1 -->
        <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <span class="text-xs font-bold text-slate-900 block">
              {{ result.stabilityT1.label }}
            </span>
            <span class="text-[11px] text-slate-500 block mt-0.5">
              {{ result.stabilityT1.sublabel }}
            </span>
          </div>

          <div class="my-4">
            <div class="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
              <span>Avant : <strong class="text-slate-800">{{ result.stabilityT1.before }} %</strong></span>
              <span class="text-slate-300">➔</span>
              <span>Après : <strong class="text-slate-900">{{ result.stabilityT1.after }} %</strong></span>
            </div>

            <div class="flex justify-center mt-2">
              <span
                class="px-3 py-1 rounded-xl font-bold text-sm border"
                :class="getBadgeStyle(result.stabilityT1.badgeType)"
              >
                {{ result.stabilityT1.badgeText }}
              </span>
            </div>
          </div>

          <p class="text-[11px] text-slate-500 border-t border-slate-100 pt-2">
            {{ result.stabilityT1.description }}
          </p>
        </div>

        <!-- Metric 2: Vitesse T2 -->
        <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <span class="text-xs font-bold text-slate-900 block">
              {{ result.speedT2.label }}
            </span>
            <span class="text-[11px] text-slate-500 block mt-0.5">
              {{ result.speedT2.sublabel }}
            </span>
          </div>

          <div class="my-4">
            <div class="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
              <span>Avant : <strong class="text-slate-800">{{ result.speedT2.before }} %</strong></span>
              <span class="text-slate-300">➔</span>
              <span>Après : <strong class="text-slate-900">{{ result.speedT2.after }} %</strong></span>
            </div>

            <div class="flex justify-center mt-2">
              <span
                class="px-3 py-1 rounded-xl font-bold text-sm border"
                :class="getBadgeStyle(result.speedT2.badgeType)"
              >
                {{ result.speedT2.badgeText }}
              </span>
            </div>
          </div>

          <p class="text-[11px] text-slate-500 border-t border-slate-100 pt-2">
            {{ result.speedT2.description }}
          </p>
        </div>

        <!-- Metric 3: Risque Énergie -->
        <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <span class="text-xs font-bold text-slate-900 block">
              {{ result.energyRisk.label }}
            </span>
            <span class="text-[11px] text-slate-500 block mt-0.5">
              {{ result.energyRisk.sublabel }}
            </span>
          </div>

          <div class="my-4">
            <div class="flex items-center justify-between text-xs text-slate-500 font-medium mb-1">
              <span>Avant : <strong class="text-slate-800">{{ result.energyRisk.before }} %</strong></span>
              <span class="text-slate-300">➔</span>
              <span>Après : <strong class="text-slate-900">{{ result.energyRisk.after }} %</strong></span>
            </div>

            <div class="flex justify-center mt-2">
              <span
                class="px-3 py-1 rounded-xl font-bold text-sm border"
                :class="getBadgeStyle(result.energyRisk.badgeType)"
              >
                {{ result.energyRisk.badgeText }}
              </span>
            </div>
          </div>

          <p class="text-[11px] text-slate-500 border-t border-slate-100 pt-2">
            {{ result.energyRisk.description }}
          </p>
        </div>
      </div>
    </div>

    <!-- Impact Selon l'Adversaire (3 Lignes Simples) -->
    <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
      <div>
        <h3 class="text-sm font-bold text-slate-900">
          Impact selon le deck adverse
        </h3>
        <p class="text-xs text-slate-500">
          Comportement du changement face aux 3 grandes familles de decks actuels.
        </p>
      </div>

      <div class="divide-y divide-slate-100">
        <div
          v-for="opp in result.opponentImpacts"
          :key="opp.category"
          class="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
        >
          <div class="flex items-center space-x-3">
            <div class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
              <component :is="getOpponentIcon(opp.category)" class="w-4 h-4" />
            </div>
            <div>
              <div class="flex items-center space-x-2">
                <span class="font-bold text-slate-900">{{ opp.category }}</span>
                <span class="text-[11px] text-slate-400">({{ opp.archetypeExample }})</span>
              </div>
              <p class="text-slate-500 mt-0.5">{{ opp.description }}</p>
            </div>
          </div>

          <div class="self-start sm:self-center shrink-0">
            <span
              class="px-2.5 py-1 rounded-lg font-semibold text-xs border"
              :class="getBadgeStyle(opp.impactType)"
            >
              {{ opp.impactBadge }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Actions -->
    <div class="flex items-center justify-between pt-2">
      <button
        type="button"
        @click="emit('back-to-step1')"
        class="inline-flex items-center space-x-1 text-xs text-slate-500 hover:text-slate-800 transition cursor-pointer"
      >
        <RotateCcw class="w-3.5 h-3.5" />
        <span>Changer de deck de départ</span>
      </button>

      <button
        type="button"
        @click="emit('back-to-step2')"
        class="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm shadow-sm transition active:scale-[0.99] cursor-pointer"
      >
        Tester un autre changement →
      </button>
    </div>
  </div>
</template>
