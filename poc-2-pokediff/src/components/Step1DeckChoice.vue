<script setup lang="ts">
import { Check, ShieldCheck, ArrowRight, Flame, Ghost } from 'lucide-vue-next'
import { DECK_PROFILES } from '../data/wizardData'
import type { DeckArchetype } from '../types/wizard'

defineProps<{
  selectedDeckId: DeckArchetype
}>()

const emit = defineEmits<{
  (e: 'select-deck', deckId: DeckArchetype): void
  (e: 'next-step'): void
}>()
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-8 py-2">
    <!-- Screen Header -->
    <div class="text-center space-y-2">
      <h2 class="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
        1. Choisissez votre liste de départ
      </h2>
      <p class="text-sm text-slate-600 max-w-xl mx-auto">
        Sélectionnez l'archétype standard que vous jouez en tournoi pour tester un arbitrage de cartes.
      </p>
    </div>

    <!-- 2 Big Selectable Deck Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Card 1: Dracaufeu ex -->
      <div
        @click="emit('select-deck', 'dracaufeu')"
        class="bg-white rounded-2xl p-6 border-2 cursor-pointer transition-all duration-200 text-left flex flex-col justify-between relative shadow-xs hover:shadow-md"
        :class="[
          selectedDeckId === 'dracaufeu'
            ? 'border-blue-600 ring-2 ring-blue-600/10 bg-blue-50/20'
            : 'border-slate-200 hover:border-slate-300'
        ]"
      >
        <div>
          <!-- Header with Icon & Checkmark -->
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
              <Flame class="w-5 h-5" />
            </div>
            <span
              class="w-6 h-6 rounded-full flex items-center justify-center transition"
              :class="selectedDeckId === 'dracaufeu' ? 'bg-blue-600 text-white' : 'border border-slate-300 text-transparent'"
            >
              <Check class="w-3.5 h-3.5 stroke-[3]" />
            </span>
          </div>

          <!-- Titles -->
          <h3 class="text-lg font-bold text-slate-900">
            {{ DECK_PROFILES.dracaufeu.name }}
          </h3>
          <p class="text-xs text-slate-500 font-medium mt-0.5">
            {{ DECK_PROFILES.dracaufeu.subtitle }}
          </p>

          <p class="text-xs text-slate-600 mt-3 leading-relaxed">
            {{ DECK_PROFILES.dracaufeu.description }}
          </p>
        </div>

        <!-- Key cards pill -->
        <div class="mt-4 pt-3 border-t border-slate-100">
          <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Cartes clés du deck :
          </span>
          <p class="text-xs text-slate-700 font-medium">
            {{ DECK_PROFILES.dracaufeu.keyCardsSummary }}
          </p>
        </div>
      </div>

      <!-- Card 2: Lanssorien ex -->
      <div
        @click="emit('select-deck', 'lanssorien')"
        class="bg-white rounded-2xl p-6 border-2 cursor-pointer transition-all duration-200 text-left flex flex-col justify-between relative shadow-xs hover:shadow-md"
        :class="[
          selectedDeckId === 'lanssorien'
            ? 'border-blue-600 ring-2 ring-blue-600/10 bg-blue-50/20'
            : 'border-slate-200 hover:border-slate-300'
        ]"
      >
        <div>
          <!-- Header with Icon & Checkmark -->
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
              <Ghost class="w-5 h-5" />
            </div>
            <span
              class="w-6 h-6 rounded-full flex items-center justify-center transition"
              :class="selectedDeckId === 'lanssorien' ? 'bg-blue-600 text-white' : 'border border-slate-300 text-transparent'"
            >
              <Check class="w-3.5 h-3.5 stroke-[3]" />
            </span>
          </div>

          <!-- Titles -->
          <h3 class="text-lg font-bold text-slate-900">
            {{ DECK_PROFILES.lanssorien.name }}
          </h3>
          <p class="text-xs text-slate-500 font-medium mt-0.5">
            {{ DECK_PROFILES.lanssorien.subtitle }}
          </p>

          <p class="text-xs text-slate-600 mt-3 leading-relaxed">
            {{ DECK_PROFILES.lanssorien.description }}
          </p>
        </div>

        <!-- Key cards pill -->
        <div class="mt-4 pt-3 border-t border-slate-100">
          <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Cartes clés du deck :
          </span>
          <p class="text-xs text-slate-700 font-medium">
            {{ DECK_PROFILES.lanssorien.keyCardsSummary }}
          </p>
        </div>
      </div>
    </div>

    <!-- 1-line Summary & Validation Pill -->
    <div class="bg-white rounded-xl p-4 border border-slate-200 flex items-center justify-between shadow-xs">
      <div class="flex items-center space-x-2 text-xs sm:text-sm text-slate-700">
        <ShieldCheck class="w-4 h-4 text-emerald-600 shrink-0" />
        <span>
          Deck sélectionné : <strong class="text-slate-900 font-semibold">{{ DECK_PROFILES[selectedDeckId].name }}</strong> (Liste officielle vérifiée • <strong>60 cartes</strong> complètes)
        </span>
      </div>
      <span class="hidden sm:inline-flex text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
        Prêt pour l'arbitrage
      </span>
    </div>

    <!-- Next Action Button -->
    <div class="flex justify-end pt-2">
      <button
        type="button"
        @click="emit('next-step')"
        class="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-8 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-sm transition active:scale-[0.99] cursor-pointer"
      >
        <span>Tester un changement de cartes</span>
        <ArrowRight class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>
