<script setup lang="ts">
import { computed } from 'vue'
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Minus,
  Sparkles,
  AlertCircle,
  RotateCcw,
} from 'lucide-vue-next'
import { getPresetChanges } from '../data/wizardData'
import type { KeyCardItem, DeckArchetype, PresetChange } from '../types/wizard'

const props = defineProps<{
  deckId: DeckArchetype
  cards: KeyCardItem[]
  activePresetId: string | null
}>()

const emit = defineEmits<{
  (e: 'prev-step'): void
  (e: 'next-step'): void
  (e: 'apply-preset', preset: PresetChange): void
  (e: 'update-card-count', cardId: string, delta: number): void
  (e: 'reset-changes'): void
}>()

const presets = computed(() => getPresetChanges(props.deckId))

// Calculate total card count difference
const totalDelta = computed(() => {
  return props.cards.reduce((sum, c) => sum + (c.currentCount - c.defaultCount), 0)
})

const totalCards = computed(() => 60 + totalDelta.value)
const isLegal60 = computed(() => totalCards.value === 60)

// Cards added and removed
const removedCards = computed(() => {
  return props.cards.filter((c) => c.currentCount < c.defaultCount)
})

const addedCards = computed(() => {
  return props.cards.filter((c) => c.currentCount > c.defaultCount)
})

const hasChanges = computed(() => {
  return removedCards.value.length > 0 || addedCards.value.length > 0
})
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-8 py-2">
    <!-- Header with Back Button -->
    <div class="flex items-center justify-between">
      <button
        type="button"
        @click="emit('prev-step')"
        class="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition cursor-pointer"
      >
        <ArrowLeft class="w-4 h-4" />
        <span>Retour au choix du deck</span>
      </button>

      <button
        v-if="hasChanges"
        type="button"
        @click="emit('reset-changes')"
        class="inline-flex items-center space-x-1 text-xs text-slate-500 hover:text-slate-800 underline underline-offset-4 transition cursor-pointer"
      >
        <RotateCcw class="w-3.5 h-3.5" />
        <span>Réinitialiser</span>
      </button>
    </div>

    <!-- Screen Title -->
    <div class="text-center space-y-2">
      <h2 class="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
        2. Quel changement hésitez-vous à faire ?
      </h2>
      <p class="text-sm text-slate-600 max-w-xl mx-auto">
        Choisissez un dilemme fréquent prêt à tester en 1 clic, ou personnalisez les 6 cartes clés ci-dessous.
      </p>
    </div>

    <!-- 3 Big 1-Click Preset Buttons -->
    <div class="space-y-3">
      <span class="text-xs font-bold text-slate-400 uppercase tracking-wider block">
        Changements prêts à tester en 1 clic :
      </span>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          v-for="p in presets"
          :key="p.id"
          type="button"
          @click="emit('apply-preset', p)"
          class="p-4 rounded-xl border-2 text-left transition-all duration-150 flex flex-col justify-between cursor-pointer bg-white shadow-xs hover:shadow-md"
          :class="[
            activePresetId === p.id
              ? 'border-blue-600 ring-2 ring-blue-600/10 bg-blue-50/20'
              : 'border-slate-200 hover:border-slate-300'
          ]"
        >
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {{ p.tag }}
              </span>
              <Sparkles v-if="activePresetId === p.id" class="w-3.5 h-3.5 text-blue-600" />
            </div>

            <h3 class="text-sm font-bold text-slate-900">
              {{ p.title }}
            </h3>
          </div>

          <div class="mt-3 pt-2.5 border-t border-slate-100 text-xs font-semibold text-slate-700">
            {{ p.description }}
          </div>
        </button>
      </div>
    </div>

    <!-- Visual Side-by-Side Box: Retiré vs Ajouté -->
    <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Récapitulatif de votre changement
        </h3>
        <span
          class="text-xs px-2.5 py-0.5 rounded-full font-semibold border"
          :class="
            isLegal60
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-red-50 text-red-700 border-red-200 animate-pulse'
          "
        >
          Total : {{ totalCards }}/60 cartes
        </span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <!-- Left: Carte retirée (-1) in soft red -->
        <div class="p-4 rounded-xl bg-red-50/70 border border-red-200/80">
          <div class="flex items-center space-x-2 text-xs font-bold text-red-700 uppercase tracking-wider mb-2">
            <span class="w-4 h-4 rounded-full bg-red-200 text-red-800 flex items-center justify-center font-black text-xs">−</span>
            <span>Carte(s) retirée(s)</span>
          </div>

          <div v-if="removedCards.length > 0" class="space-y-1.5">
            <div
              v-for="c in removedCards"
              :key="c.id"
              class="flex items-center justify-between text-xs font-medium text-slate-900 bg-white/80 px-2.5 py-1.5 rounded-lg border border-red-200/60"
            >
              <div class="flex items-center space-x-2">
                <span class="text-sm">{{ c.icon }}</span>
                <span>{{ c.name }}</span>
              </div>
              <span class="font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded text-[11px]">
                -{{ c.defaultCount - c.currentCount }}
              </span>
            </div>
          </div>
          <p v-else class="text-xs text-slate-400 italic py-1">
            Aucune carte retirée pour l'instant.
          </p>
        </div>

        <!-- Right: Carte ajoutée (+1) in soft green -->
        <div class="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200/80">
          <div class="flex items-center space-x-2 text-xs font-bold text-emerald-700 uppercase tracking-wider mb-2">
            <span class="w-4 h-4 rounded-full bg-emerald-200 text-emerald-800 flex items-center justify-center font-black text-xs">+</span>
            <span>Carte(s) ajoutée(s)</span>
          </div>

          <div v-if="addedCards.length > 0" class="space-y-1.5">
            <div
              v-for="c in addedCards"
              :key="c.id"
              class="flex items-center justify-between text-xs font-medium text-slate-900 bg-white/80 px-2.5 py-1.5 rounded-lg border border-emerald-200/60"
            >
              <div class="flex items-center space-x-2">
                <span class="text-sm">{{ c.icon }}</span>
                <span>{{ c.name }}</span>
              </div>
              <span class="font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded text-[11px]">
                +{{ c.currentCount - c.defaultCount }}
              </span>
            </div>
          </div>
          <p v-else class="text-xs text-slate-400 italic py-1">
            Aucune carte ajoutée pour l'instant.
          </p>
        </div>
      </div>
    </div>

    <!-- Clean 6 Key Cards Quick Adjuster -->
    <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
      <div>
        <h3 class="text-sm font-bold text-slate-900">
          Ou ajustez manuellement parmi les 6 cartes clés
        </h3>
        <p class="text-xs text-slate-500">
          Utilisez les boutons [-] et [+] pour tester votre propre combinaison de cartes.
        </p>
      </div>

      <div class="divide-y divide-slate-100">
        <div
          v-for="card in cards"
          :key="card.id"
          class="py-3 flex items-center justify-between gap-3 text-xs"
        >
          <!-- Card Info -->
          <div class="flex items-center space-x-3 min-w-0">
            <span class="text-xl shrink-0 select-none">{{ card.icon }}</span>
            <div class="min-w-0">
              <div class="flex items-center space-x-2">
                <h4 class="font-bold text-slate-900 truncate">{{ card.name }}</h4>
                <span
                  v-if="card.currentCount !== card.defaultCount"
                  class="text-[10px] font-bold px-1.5 py-0.2 rounded"
                  :class="card.currentCount > card.defaultCount ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'"
                >
                  {{ card.currentCount > card.defaultCount ? `+${card.currentCount - card.defaultCount}` : card.currentCount - card.defaultCount }}
                </span>
              </div>
              <p class="text-[11px] text-slate-500 truncate">{{ card.role }}</p>
            </div>
          </div>

          <!-- Counter Controls -->
          <div class="flex items-center space-x-2 shrink-0">
            <span class="text-[11px] text-slate-400 hidden sm:inline mr-1">
              Base : {{ card.defaultCount }}
            </span>

            <button
              type="button"
              @click="emit('update-card-count', card.id, -1)"
              :disabled="card.currentCount <= card.min"
              class="w-8 h-8 rounded-lg flex items-center justify-center font-bold transition cursor-pointer"
              :class="[
                card.currentCount <= card.min
                  ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 active:scale-95'
              ]"
              title="Diminuer d'un exemplaire"
            >
              <Minus class="w-3.5 h-3.5" />
            </button>

            <span
              class="w-7 text-center font-bold text-sm"
              :class="[
                card.currentCount !== card.defaultCount
                  ? card.currentCount > card.defaultCount
                    ? 'text-emerald-700'
                    : 'text-red-700'
                  : 'text-slate-800'
              ]"
            >
              {{ card.currentCount }}
            </span>

            <button
              type="button"
              @click="emit('update-card-count', card.id, 1)"
              :disabled="card.currentCount >= card.max"
              class="w-8 h-8 rounded-lg flex items-center justify-center font-bold transition cursor-pointer"
              :class="[
                card.currentCount >= card.max
                  ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 active:scale-95'
              ]"
              title="Augmenter d'un exemplaire"
            >
              <Plus class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Actions & Validation -->
    <div class="space-y-3 pt-2">
      <div v-if="!isLegal60" class="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-center space-x-2 text-xs text-red-700">
        <AlertCircle class="w-4 h-4 shrink-0 text-red-600" />
        <span>
          Le deck doit compter exactement 60 cartes pour lancer la comparaison (actuellement {{ totalCards }}/60).
          {{ totalDelta > 0 ? `Retirez ${totalDelta} carte(s).` : `Ajoutez ${Math.abs(totalDelta)} carte(s).` }}
        </span>
      </div>

      <div class="flex items-center justify-between">
        <button
          type="button"
          @click="emit('prev-step')"
          class="px-5 py-3 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-medium text-xs sm:text-sm transition cursor-pointer"
        >
          ← Changer de deck
        </button>

        <button
          type="button"
          @click="emit('next-step')"
          :disabled="!isLegal60 || !hasChanges"
          class="inline-flex items-center space-x-2 px-8 py-3.5 rounded-xl font-semibold text-sm shadow-sm transition active:scale-[0.99] cursor-pointer"
          :class="[
            !isLegal60 || !hasChanges
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          ]"
        >
          <span>Comparer les 2 versions</span>
          <ArrowRight class="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
</template>
