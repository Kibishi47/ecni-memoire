<script setup lang="ts">
import { computed } from 'vue'
import { TournamentMeta, OptimizationTargetId } from '../types/deck'
import { META_PRESETS, OPTIMIZATION_TARGETS, MetaPreset } from '../data/metaPresets'
import { Check, ArrowRight, ArrowLeft, Zap, Scale, Shield, Loader2 } from 'lucide-vue-next'

const props = defineProps<{
  meta: TournamentMeta
  selectedTargetId: OptimizationTargetId
  archetypeName: string
  isCalculating: boolean
}>()

const emit = defineEmits<{
  (e: 'updateMeta', meta: TournamentMeta): void
  (e: 'updateTarget', targetId: OptimizationTargetId): void
  (e: 'previousStep'): void
  (e: 'startCalculation'): void
}>()

// Active preset detection
const activePresetId = computed(() => {
  const match = META_PRESETS.find(
    p =>
      p.meta.aggroRate === props.meta.aggroRate &&
      p.meta.evolutionRate === props.meta.evolutionRate &&
      p.meta.controlRate === props.meta.controlRate
  )
  return match ? match.id : null
})

function applyPreset(preset: MetaPreset) {
  emit('updateMeta', { ...preset.meta })
}

// Sliders auto-balancing to always sum to 100%
function handleSliderChange(type: 'aggro' | 'evolution' | 'control', rawValue: number) {
  const value = Math.max(5, Math.min(85, Math.round(rawValue)))
  const current = { ...props.meta }

  if (type === 'aggro') {
    const diff = value - current.aggroRate
    const remainingOld = current.evolutionRate + current.controlRate
    if (remainingOld > 0) {
      const evoRatio = current.evolutionRate / remainingOld
      const newEvo = Math.max(5, Math.round(current.evolutionRate - diff * evoRatio))
      const newCtrl = Math.max(5, 100 - value - newEvo)
      emit('updateMeta', { aggroRate: value, evolutionRate: newEvo, controlRate: newCtrl })
    }
  } else if (type === 'evolution') {
    const diff = value - current.evolutionRate
    const remainingOld = current.aggroRate + current.controlRate
    if (remainingOld > 0) {
      const aggroRatio = current.aggroRate / remainingOld
      const newAggro = Math.max(5, Math.round(current.aggroRate - diff * aggroRatio))
      const newCtrl = Math.max(5, 100 - value - newAggro)
      emit('updateMeta', { aggroRate: newAggro, evolutionRate: value, controlRate: newCtrl })
    }
  } else {
    const diff = value - current.controlRate
    const remainingOld = current.aggroRate + current.evolutionRate
    if (remainingOld > 0) {
      const aggroRatio = current.aggroRate / remainingOld
      const newAggro = Math.max(5, Math.round(current.aggroRate - diff * aggroRatio))
      const newEvo = Math.max(5, 100 - value - newAggro)
      emit('updateMeta', { aggroRate: newAggro, evolutionRate: newEvo, controlRate: value })
    }
  }
}

function getPresetIcon(icon: string) {
  if (icon === 'Zap') return Zap
  if (icon === 'Scale') return Scale
  return Shield
}
</script>

<template>
  <div class="space-y-6">
    <div class="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-8">
      
      <!-- Screen Header -->
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          2. Quel est le profil de votre tournoi ?
        </h2>
        <p class="text-slate-600 text-sm sm:text-base mt-2 leading-relaxed">
          Choisissez un profil prédéfini ou ajustez les curseurs selon ce que vous prévoyez d'affronter.
        </p>
      </div>

      <!-- 3 Big Quick Selection Buttons -->
      <div>
        <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
          Profils types en 1 clic
        </label>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            v-for="preset in META_PRESETS"
            :key="preset.id"
            type="button"
            @click="applyPreset(preset)"
            :class="[
              'p-4 rounded-xl border-2 text-left transition-all flex flex-col justify-between group',
              activePresetId === preset.id
                ? 'border-blue-600 bg-blue-50/50 shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50'
            ]"
          >
            <div>
              <div class="flex items-center justify-between mb-2">
                <div
                  :class="[
                    'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                    activePresetId === preset.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                  ]"
                >
                  <component :is="getPresetIcon(preset.icon)" class="w-4 h-4" />
                </div>

                <div
                  :class="[
                    'w-5 h-5 rounded-full border flex items-center justify-center',
                    activePresetId === preset.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300'
                  ]"
                >
                  <Check v-if="activePresetId === preset.id" class="w-3.5 h-3.5 stroke-[3]" />
                </div>
              </div>

              <div class="font-bold text-sm text-slate-900 group-hover:text-blue-600 transition-colors">
                {{ preset.name }}
              </div>
              <div class="text-xs text-slate-500 mt-1 leading-snug">
                {{ preset.subtitle }}
              </div>
            </div>

            <!-- Percentage breakdown -->
            <div class="mt-4 pt-2 border-t border-slate-100 text-[11px] font-medium text-slate-500 flex justify-between">
              <span>Rapides : {{ preset.meta.aggroRate }}%</span>
              <span>Évo : {{ preset.meta.evolutionRate }}%</span>
              <span>Ctrl : {{ preset.meta.controlRate }}%</span>
            </div>
          </button>
        </div>
      </div>

      <!-- 3 Simple Sliders -->
      <div class="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
        <div class="flex items-center justify-between">
          <label class="text-xs font-bold uppercase tracking-wider text-slate-700">
            Ajustement des adversaires attendus
          </label>
          <span class="text-xs font-semibold text-slate-500">
            Total : 100%
          </span>
        </div>

        <div class="space-y-4">
          <!-- Slider 1: Decks Rapides -->
          <div>
            <div class="flex items-center justify-between text-xs font-semibold text-slate-800 mb-1.5">
              <span>Decks Rapides <span class="text-slate-400 font-normal">(Ire-Foudre, Rugit-Lune)</span></span>
              <span class="text-blue-600 font-bold text-sm">{{ meta.aggroRate }} %</span>
            </div>
            <input
              type="range"
              min="5"
              max="80"
              step="1"
              :value="meta.aggroRate"
              @input="handleSliderChange('aggro', Number(($event.target as HTMLInputElement).value))"
              class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>

          <!-- Slider 2: Decks Évolution -->
          <div>
            <div class="flex items-center justify-between text-xs font-semibold text-slate-800 mb-1.5">
              <span>Decks Évolution <span class="text-slate-400 font-normal">(Dracaufeu, Lanssorien)</span></span>
              <span class="text-blue-600 font-bold text-sm">{{ meta.evolutionRate }} %</span>
            </div>
            <input
              type="range"
              min="5"
              max="80"
              step="1"
              :value="meta.evolutionRate"
              @input="handleSliderChange('evolution', Number(($event.target as HTMLInputElement).value))"
              class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>

          <!-- Slider 3: Decks Contrôle -->
          <div>
            <div class="flex items-center justify-between text-xs font-semibold text-slate-800 mb-1.5">
              <span>Decks Contrôle <span class="text-slate-400 font-normal">(Ronflex Stall, Gardevoir)</span></span>
              <span class="text-blue-600 font-bold text-sm">{{ meta.controlRate }} %</span>
            </div>
            <input
              type="range"
              min="5"
              max="80"
              step="1"
              :value="meta.controlRate"
              @input="handleSliderChange('control', Number(($event.target as HTMLInputElement).value))"
              class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>
        </div>
      </div>

      <!-- Simple Choice for Priority Objective (2 Buttons) -->
      <div>
        <label class="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
          Votre objectif de jeu prioritaire
        </label>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            v-for="target in OPTIMIZATION_TARGETS"
            :key="target.id"
            type="button"
            @click="emit('updateTarget', target.id)"
            :class="[
              'p-4 rounded-xl border-2 text-left transition-all flex items-start justify-between group',
              selectedTargetId === target.id
                ? 'border-blue-600 bg-blue-50/50 shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300'
            ]"
          >
            <div>
              <div class="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                {{ target.label }}
              </div>
              <div class="text-xs text-slate-500 mt-1">
                {{ target.description }}
              </div>
            </div>

            <div
              :class="[
                'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ml-3 mt-0.5',
                selectedTargetId === target.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300'
              ]"
            >
              <Check v-if="selectedTargetId === target.id" class="w-3.5 h-3.5 stroke-[3]" />
            </div>
          </button>
        </div>
      </div>

      <!-- Action Navigation Buttons -->
      <div class="pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
        <button
          type="button"
          @click="emit('previousStep')"
          class="w-full sm:w-auto inline-flex items-center justify-center space-x-1.5 px-5 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm transition-colors"
        >
          <ArrowLeft class="w-4 h-4" />
          <span>Changer de deck</span>
        </button>

        <button
          type="button"
          @click="emit('startCalculation')"
          :disabled="isCalculating"
          class="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-8 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-sm transition-all shadow-sm hover:shadow disabled:opacity-50"
        >
          <Loader2 v-if="isCalculating" class="w-4 h-4 animate-spin" />
          <span>{{ isCalculating ? 'Calcul en cours...' : 'Calculer mes ratios idéaux' }}</span>
          <ArrowRight v-if="!isCalculating" class="w-4 h-4" />
        </button>
      </div>

    </div>
  </div>
</template>
