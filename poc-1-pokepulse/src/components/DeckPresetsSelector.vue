<script setup lang="ts">
import type { DeckPreset } from '../types/pokemon-tcg'
import { DECK_PRESETS } from '../data/presets'
import { 
  Sparkles, 
  FileText, 
  CheckCircle2, 
  Flame, 
  Zap, 
  Eye
} from 'lucide-vue-next'

defineProps<{
  activePresetId: string
  isCustomDeck: boolean
  totalCardCount: number
}>()

const emit = defineEmits<{
  (e: 'select-preset', preset: DeckPreset): void
  (e: 'toggle-import-modal'): void
}>()

const getArchetypeIcon = (id: string) => {
  if (id === 'charizard_pidgeot') return Flame
  if (id === 'raging_bolt_ogerpon') return Zap
  return Eye
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header with title & import toggle -->
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center justify-center p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Sparkles class="w-4 h-4" />
          </span>
          <h2 class="text-lg font-bold text-slate-100 tracking-tight">
            1. Sélection du Deck Joueur
          </h2>
        </div>
        <p class="text-xs text-slate-400 mt-1">
          Chargez un archétype méta en 1-clic ou collez votre propre export PTCGL / Limitless.
        </p>
      </div>

      <div class="flex items-center gap-2 self-stretch sm:self-auto">
        <button
          @click="emit('toggle-import-modal')"
          type="button"
          :class="[
            'flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all duration-200 shadow-sm',
            isCustomDeck
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-glow-indigo'
              : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700 hover:border-slate-600'
          ]"
        >
          <FileText class="w-3.5 h-3.5" />
          <span>{{ isCustomDeck ? 'Liste Custom Active (' + totalCardCount + ')' : 'Coller une liste PTCGL' }}</span>
          <span v-if="isCustomDeck" class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        </button>
      </div>
    </div>

    <!-- 3 Quick Presets Grid -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div
        v-for="preset in DECK_PRESETS"
        :key="preset.id"
        @click="emit('select-preset', preset)"
        :class="[
          'relative group cursor-pointer rounded-2xl p-4 border transition-all duration-300 flex flex-col justify-between overflow-hidden',
          !isCustomDeck && activePresetId === preset.id
            ? 'bg-slate-900/90 border-indigo-500 shadow-glow-indigo ring-1 ring-indigo-500/50'
            : 'bg-slate-900/50 hover:bg-slate-800/70 border-slate-800 hover:border-slate-700 text-slate-300'
        ]"
      >
        <!-- Top accent gradient line when active -->
        <div 
          v-if="!isCustomDeck && activePresetId === preset.id"
          class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-emerald-400 to-indigo-500"
        />

        <div>
          <!-- Header pills -->
          <div class="flex items-center justify-between gap-2 mb-2.5">
            <div class="flex items-center gap-1.5">
              <component 
                :is="getArchetypeIcon(preset.id)" 
                class="w-4 h-4 text-indigo-400"
              />
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-slate-700 bg-slate-800/80 text-slate-300">
                {{ preset.tempo }}
              </span>
            </div>

            <div class="flex items-center gap-1">
              <span 
                v-if="!isCustomDeck && activePresetId === preset.id"
                class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full"
              >
                <CheckCircle2 class="w-3 h-3" />
                Actif
              </span>
              <span 
                v-else
                class="text-[10px] text-slate-500 group-hover:text-slate-400 transition-colors"
              >
                1-Clic
              </span>
            </div>
          </div>

          <!-- Title & Archetype -->
          <h3 class="text-sm font-bold text-slate-100 group-hover:text-white transition-colors">
            {{ preset.name }}
          </h3>
          <p class="text-xs font-medium text-indigo-400/90 mt-0.5">
            {{ preset.archetype }}
          </p>

          <!-- Description -->
          <p class="text-[11px] text-slate-400 mt-2 line-clamp-2 leading-relaxed">
            {{ preset.description }}
          </p>
        </div>

        <!-- Footer specs -->
        <div class="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
          <div class="flex items-center gap-1">
            <span class="text-slate-500">Pilier :</span>
            <span class="font-semibold text-slate-200">{{ preset.coverCard }}</span>
          </div>
          <div class="flex items-center gap-1.5 font-mono text-[10px] text-emerald-400 bg-slate-950/60 px-2 py-0.5 rounded border border-slate-800">
            <span>60 cartes</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
