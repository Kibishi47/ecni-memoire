<script setup lang="ts">
import { ref } from 'vue'
import {
  ClipboardPaste,
  RotateCcw,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Flame,
  Shield,
  Zap,
} from 'lucide-vue-next'
import { SAMPLE_DECKS } from '../data/sample-decks'
import type { ParseWarning, SampleDeckPreset } from '../types/deck'

const props = defineProps<{
  modelValue: string
  totalCards: number
  pokemonCount: number
  trainerCount: number
  energyCount: number
  warnings: ParseWarning[]
  activePresetId: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'select-preset', preset: SampleDeckPreset): void
  (e: 'reset'): void
}>()

const pasteFeedback = ref(false)

async function handlePasteClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (text) {
      emit('update:modelValue', text)
      pasteFeedback.value = true
      setTimeout(() => {
        pasteFeedback.value = false
      }, 2000)
    }
  } catch {
    // Fallback si la permission clipboard est refusée
  }
}
</script>

<template>
  <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-4">
    <!-- En-tête de la zone de saisie -->
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-sm font-bold text-slate-900 flex items-center gap-2">
          <span>Deckliste PTCGL / Limitless</span>
          <span class="text-xs font-normal text-slate-500">(FR ou EN)</span>
        </h2>
        <p class="text-xs text-slate-500">
          Collez un export Pokémon TCG Live ou chargez un preset ci-dessous.
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          @click="handlePasteClipboard"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition cursor-pointer"
        >
          <ClipboardPaste class="w-3.5 h-3.5" />
          <span>{{ pasteFeedback ? 'Collé !' : 'Coller' }}</span>
        </button>
        <button
          type="button"
          @click="emit('reset')"
          class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 transition cursor-pointer"
          title="Réinitialiser avec le deck par défaut"
        >
          <RotateCcw class="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>
      </div>
    </div>

    <!-- Boutons de Presets -->
    <div class="flex flex-col gap-1.5">
      <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1">
        <Sparkles class="w-3 h-3 text-amber-500" />
        Decks d'exemple (1 clic) :
      </span>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          v-for="preset in SAMPLE_DECKS"
          :key="preset.id"
          type="button"
          @click="emit('select-preset', preset)"
          :class="[
            'text-left px-3 py-2 rounded-lg border text-xs transition flex items-center justify-between gap-2 cursor-pointer',
            activePresetId === preset.id
              ? 'bg-blue-50/60 border-blue-600 text-slate-900 ring-1 ring-blue-600/30'
              : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50/70'
          ]"
        >
          <div class="truncate">
            <div class="font-semibold text-slate-900 truncate">{{ preset.name }}</div>
            <div class="text-[11px] text-slate-500 truncate">{{ preset.subtitle }}</div>
          </div>
          <span
            :class="[
              'px-2 py-0.5 rounded text-[10px] font-bold border shrink-0',
              preset.badgeColor
            ]"
          >
            {{ preset.lang }}
          </span>
        </button>
      </div>
    </div>

    <!-- Zone de texte -->
    <div class="relative">
      <textarea
        :value="props.modelValue"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
        rows="15"
        placeholder="Collez votre liste ici...&#10;Ex:&#10;Pokémon: 4&#10;4 Salamèche MEW 4&#10;&#10;Dresseurs: 4&#10;4 Pepper SVI 166"
        class="w-full rounded-lg bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs sm:text-sm font-mono text-slate-800 p-3.5 leading-relaxed resize-y placeholder:text-slate-400 outline-none transition"
        spellcheck="false"
      />
    </div>

    <!-- Jauge des 60 cartes & Répartition -->
    <div class="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-col gap-3">
      <div class="flex items-center justify-between text-xs">
        <div class="flex items-center gap-2">
          <CheckCircle2
            v-if="totalCards === 60"
            class="w-4 h-4 text-emerald-600 shrink-0"
          />
          <AlertTriangle
            v-else
            class="w-4 h-4 text-amber-500 shrink-0"
          />
          <span class="font-semibold text-slate-700">
            Validation du Deck :
          </span>
        </div>
        <span
          :class="[
            'px-2.5 py-0.5 rounded-full font-mono font-bold text-xs border',
            totalCards === 60
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : totalCards > 60
                ? 'bg-rose-50 text-rose-700 border-rose-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
          ]"
        >
          {{ totalCards }} / 60 cartes
          <template v-if="totalCards === 60"> (Valide)</template>
          <template v-else-if="totalCards < 60"> (Manque {{ 60 - totalCards }})</template>
          <template v-else> (+{{ totalCards - 60 }} en trop)</template>
        </span>
      </div>

      <!-- Barre de progression segmentée -->
      <div class="h-2 w-full bg-slate-200 rounded-full overflow-hidden flex">
        <div
          class="bg-rose-500 transition-all duration-300"
          :style="{ width: `${Math.min(100, (pokemonCount / 60) * 100)}%` }"
          title="Pokémon"
        />
        <div
          class="bg-blue-600 transition-all duration-300"
          :style="{ width: `${Math.min(100, (trainerCount / 60) * 100)}%` }"
          title="Dresseurs"
        />
        <div
          class="bg-amber-500 transition-all duration-300"
          :style="{ width: `${Math.min(100, (energyCount / 60) * 100)}%` }"
          title="Énergies"
        />
      </div>

      <!-- Compteurs détaillés -->
      <div class="grid grid-cols-3 gap-2 text-xs">
        <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white border border-slate-200">
          <span class="flex items-center gap-1.5 text-slate-600">
            <Flame class="w-3.5 h-3.5 text-rose-500" />
            Pokémon
          </span>
          <strong class="font-mono text-slate-900">{{ pokemonCount }}</strong>
        </div>
        <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white border border-slate-200">
          <span class="flex items-center gap-1.5 text-slate-600">
            <Shield class="w-3.5 h-3.5 text-blue-600" />
            Dresseurs
          </span>
          <strong class="font-mono text-slate-900">{{ trainerCount }}</strong>
        </div>
        <div class="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white border border-slate-200">
          <span class="flex items-center gap-1.5 text-slate-600">
            <Zap class="w-3.5 h-3.5 text-amber-500" />
            Énergies
          </span>
          <strong class="font-mono text-slate-900">{{ energyCount }}</strong>
        </div>
      </div>

      <!-- Avertissements éventuels -->
      <div
        v-if="warnings.length > 0"
        class="mt-1 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs space-y-1"
      >
        <div
          v-for="(w, idx) in warnings"
          :key="idx"
          class="flex items-start gap-1.5"
        >
          <AlertTriangle class="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
          <span>
            <strong v-if="w.line">Ligne {{ w.line }} : </strong>{{ w.message }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
