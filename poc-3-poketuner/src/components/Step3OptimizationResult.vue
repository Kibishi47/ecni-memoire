<script setup lang="ts">
import { ref } from 'vue'
import {
  Archetype,
  OptimizationResult
} from '../types/deck'
import { generatePTCGLDecklist } from '../utils/optimizer'
import {
  ArrowLeft,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Lightbulb
} from 'lucide-vue-next'

const props = defineProps<{
  archetype: Archetype
  result: OptimizationResult
}>()

const emit = defineEmits<{
  (e: 'previousStep'): void
}>()

const copied = ref<boolean>(false)
const showFullList = ref<boolean>(false)

async function copyDecklist() {
  const text = generatePTCGLDecklist(props.archetype, props.result.prescribedAllocation)
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 3000)
  } catch (err) {
    console.error('Erreur copie presse-papier:', err)
  }
}
</script>

<template>
  <div class="space-y-6">
    
    <!-- Top Reminder & Back Link -->
    <div class="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
      <div class="flex items-center space-x-2">
        <span class="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span>
        <div class="text-sm text-slate-700">
          Recommandation pour <strong class="text-slate-900">{{ archetype.name }}</strong>
          <span class="text-slate-400 mx-1">•</span>
          <span>Profil : <strong class="text-slate-900">{{ result.metaPresetName }}</strong></span>
        </div>
      </div>

      <button
        type="button"
        @click="emit('previousStep')"
        class="inline-flex items-center space-x-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
      >
        <ArrowLeft class="w-3.5 h-3.5" />
        <span>Modifier les réglages</span>
      </button>
    </div>

    <!-- Main Container -->
    <div class="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
      
      <!-- Section Title -->
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          Les {{ archetype.flexSlotsCount }} cartes à intégrer dans votre deck
        </h2>
        <p class="text-slate-600 text-sm mt-1">
          Complète vos {{ archetype.coreCount }} cartes fixes pour atteindre exactement 60 cartes prêtes à jouer.
        </p>
      </div>

      <!-- Recommended Cards List -->
      <div class="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
        <div
          v-for="item in result.recommendedCards"
          :key="item.cardId"
          class="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 transition-colors"
        >
          <!-- Left: Count & Card name -->
          <div class="flex items-start sm:items-center space-x-3.5">
            <!-- Count Pill -->
            <span class="w-10 h-10 rounded-xl bg-slate-100 text-slate-900 font-bold text-base flex items-center justify-center shrink-0 border border-slate-200">
              {{ item.recommendedCount }}×
            </span>

            <div>
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-bold text-base text-slate-900">
                  {{ item.cardName }}
                </span>

                <!-- Badge when differs from classic or optimal -->
                <span
                  v-if="item.badgeText"
                  :class="[
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
                    item.badgeType === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : item.badgeType === 'info'
                      ? 'bg-blue-50 text-blue-800 border-blue-200'
                      : 'bg-slate-100 text-slate-700 border-slate-200'
                  ]"
                >
                  {{ item.badgeText }}
                </span>
              </div>

              <p class="text-xs text-slate-500 mt-1 leading-normal">
                {{ item.simpleExplanation }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Pourquoi ce choix ? (En 2 phrases simples) -->
      <div class="bg-blue-50/70 border border-blue-200 rounded-2xl p-5 sm:p-6 text-blue-950">
        <div class="flex items-center space-x-2 font-bold text-sm text-blue-900 mb-1.5">
          <Lightbulb class="w-4 h-4 text-blue-600" />
          <span>Pourquoi ce choix ?</span>
        </div>
        <p class="text-sm leading-relaxed text-blue-900">
          {{ result.whyText }}
        </p>
      </div>

      <!-- Action Button: Copier la liste complète des 60 cartes -->
      <div class="pt-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <!-- Optional toggle full list -->
        <button
          type="button"
          @click="showFullList = !showFullList"
          class="text-xs text-slate-500 hover:text-slate-800 font-medium flex items-center space-x-1.5 transition-colors"
        >
          <span>{{ showFullList ? 'Masquer la liste complète' : 'Vérifier la liste complète des 60 cartes' }}</span>
          <component :is="showFullList ? ChevronUp : ChevronDown" class="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          @click="copyDecklist"
          :class="[
            'w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-8 py-4 rounded-xl font-bold text-sm transition-all shadow-sm',
            copied
              ? 'bg-emerald-600 text-white'
              : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white hover:shadow'
          ]"
        >
          <component :is="copied ? Check : Copy" class="w-4 h-4 stroke-[2.5]" />
          <span>{{ copied ? 'Liste des 60 cartes copiée !' : 'Copier la liste complète des 60 cartes' }}</span>
        </button>
      </div>

      <!-- Full 60 cards preview (Clean & Simple) -->
      <div v-if="showFullList" class="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
        <div class="font-bold text-slate-900 flex items-center justify-between">
          <span>Liste de 60 cartes prête pour Pokémon TCG Live</span>
          <span class="text-blue-600 font-normal">Format officiel PTCGL</span>
        </div>
        <p class="text-slate-500">
          Vous pouvez la coller directement dans le client Pokémon TCG Live via le bouton « Importer ».
        </p>
      </div>

    </div>
  </div>
</template>
