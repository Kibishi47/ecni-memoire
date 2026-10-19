<script setup lang="ts">
import { computed } from 'vue'
import { TournamentMeta, OptimizationTargetId } from '../types/deck'
import { META_PRESETS, OPTIMIZATION_TARGETS, MetaPreset } from '../data/metaPresets'
import {
  Sliders,
  Zap,
  Flame,
  ShieldAlert,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Sparkles,
  BarChart3,
  Scale
} from 'lucide-vue-next'

const props = defineProps<{
  meta: TournamentMeta
  selectedTargetId: OptimizationTargetId
  archetypeName: string
}>()

const emit = defineEmits<{
  (e: 'updateMeta', meta: TournamentMeta): void
  (e: 'updateTarget', targetId: OptimizationTargetId): void
  (e: 'previousStep'): void
  (e: 'nextStep'): void
}>()

// Check which preset matches currently (if any)
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

// Smart slider adjustment to keep total = 100%
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

// Icon helper
function getTargetIcon(iconName: string) {
  switch (iconName) {
    case 'Flame': return Flame
    case 'ShieldCheck': return Sparkles
    case 'RefreshCw': return Scale
    default: return Sparkles
  }
}

function getPresetIcon(iconName: string) {
  switch (iconName) {
    case 'Zap': return Zap
    case 'Scale': return Scale
    case 'ShieldAlert': return ShieldAlert
    default: return Sliders
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header banner -->
    <div class="bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
      <div class="absolute -right-16 -top-16 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>

      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
        <div>
          <div class="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold mb-2">
            <Sliders class="w-3.5 h-3.5" />
            <span>Étape 2 sur 3 • Modélisation de la Salle de Tournoi</span>
          </div>
          <h2 class="text-2xl font-bold text-white tracking-tight">
            Paramétrage de la Salle de Tournoi (Curseurs de Métagame)
          </h2>
          <p class="text-slate-400 text-sm mt-1 max-w-3xl leading-relaxed">
            Indiquez la répartition estimée des decks que vous pensez affronter demain en tournoi pour votre deck
            <span class="text-white font-semibold">{{ archetypeName }}</span>.
            Les ratios recommandés vont automatiquement converger pour exploiter les failles de ce métagame.
          </p>
        </div>

        <div class="flex items-center space-x-3 shrink-0">
          <button
            type="button"
            @click="emit('previousStep')"
            class="inline-flex items-center space-x-1.5 px-4 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold text-xs transition-colors"
          >
            <ArrowLeft class="w-4 h-4" />
            <span>Retour Squelette</span>
          </button>

          <button
            type="button"
            @click="emit('nextStep')"
            class="inline-flex items-center space-x-2 px-5 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold transition-all shadow-lg shadow-amber-500/20 hover:scale-[1.02] active:scale-[0.98]"
          >
            <span>Lancer l'optimiseur</span>
            <ArrowRight class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Presets bar -->
    <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h3 class="text-sm font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center space-x-2">
            <span>Presets de Métagame Rapides</span>
          </h3>
          <p class="text-xs text-slate-400">
            Sélectionnez une configuration type en 1 clic ou affinez les curseurs manuellement.
          </p>
        </div>
        <span class="text-xs font-mono text-slate-500">Total métagame : 100%</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          v-for="preset in META_PRESETS"
          :key="preset.id"
          type="button"
          @click="applyPreset(preset)"
          :class="[
            'p-4 rounded-xl border text-left transition-all duration-200 flex flex-col justify-between group relative overflow-hidden',
            activePresetId === preset.id
              ? 'bg-slate-900 border-amber-500/80 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/30'
              : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-900/60 hover:border-slate-700'
          ]"
        >
          <div
            v-if="activePresetId === preset.id"
            class="absolute top-0 right-0 w-12 h-12 bg-amber-500/10 rounded-bl-full pointer-events-none"
          ></div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center space-x-2">
                <div
                  :class="[
                    'p-2 rounded-lg',
                    activePresetId === preset.id ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-400 group-hover:text-slate-200'
                  ]"
                >
                  <component :is="getPresetIcon(preset.icon)" class="w-4 h-4" />
                </div>
                <span class="font-bold text-sm text-white group-hover:text-amber-400 transition-colors">
                  {{ preset.name }}
                </span>
              </div>

              <CheckCircle2
                v-if="activePresetId === preset.id"
                class="w-4 h-4 text-amber-400"
              />
            </div>

            <p class="text-xs text-slate-400 leading-snug">
              {{ preset.tagline }}
            </p>
            <p class="text-[11px] font-mono text-slate-500 mt-2 truncate">
              {{ preset.typicalDecks }}
            </p>
          </div>

          <!-- Distribution breakdown mini badge -->
          <div class="mt-4 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono">
            <span class="text-amber-400 font-semibold">{{ preset.meta.aggroRate }}% Aggro</span>
            <span class="text-cyan-400 font-semibold">{{ preset.meta.evolutionRate }}% Évo</span>
            <span class="text-purple-400 font-semibold">{{ preset.meta.controlRate }}% Ctrl</span>
          </div>
        </button>
      </div>
    </div>

    <!-- Sliders and Room Composition Bar -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      <!-- Left Column (7 cols): The 3 Interactive Sliders -->
      <div class="lg:col-span-7 bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-6">
        <div>
          <div class="flex items-center justify-between">
            <h3 class="text-base font-bold text-white flex items-center space-x-2">
              <BarChart3 class="w-5 h-5 text-amber-400" />
              <span>Curseurs de Métagame (Normalisés à 100%)</span>
            </h3>
            <span class="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              Somme : {{ meta.aggroRate + meta.evolutionRate + meta.controlRate }}%
            </span>
          </div>
          <p class="text-xs text-slate-400 mt-1">
            Déplacez un curseur : les deux autres s'ajustent automatiquement pour préserver l'intégrité statistique.
          </p>
        </div>

        <!-- Meta 100% Visual Stacked Progress Bar -->
        <div class="space-y-1.5">
          <div class="h-3.5 w-full bg-slate-950 rounded-full overflow-hidden flex border border-slate-800 shadow-inner">
            <div
              :style="{ width: `${meta.aggroRate}%` }"
              class="h-full bg-gradient-to-r from-amber-600 to-amber-500 transition-all duration-150 relative group"
              title="Aggro Rapides"
            ></div>
            <div
              :style="{ width: `${meta.evolutionRate}%` }"
              class="h-full bg-gradient-to-r from-cyan-600 to-cyan-500 transition-all duration-150 relative group"
              title="Évolution / Setup"
            ></div>
            <div
              :style="{ width: `${meta.controlRate}%` }"
              class="h-full bg-gradient-to-r from-purple-600 to-purple-500 transition-all duration-150 relative group"
              title="Disruption / Contrôle"
            ></div>
          </div>
          <div class="flex items-center justify-between text-[11px] font-mono text-slate-400 px-1">
            <span class="flex items-center space-x-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
              <span>Aggro : <strong class="text-amber-400">{{ meta.aggroRate }}%</strong></span>
            </span>
            <span class="flex items-center space-x-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block"></span>
              <span>Évolution : <strong class="text-cyan-400">{{ meta.evolutionRate }}%</strong></span>
            </span>
            <span class="flex items-center space-x-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-purple-400 inline-block"></span>
              <span>Contrôle : <strong class="text-purple-400">{{ meta.controlRate }}%</strong></span>
            </span>
          </div>
        </div>

        <!-- Slider 1: Aggro Rapides -->
        <div class="p-4 rounded-xl bg-slate-950/70 border border-amber-500/20 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <div class="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Zap class="w-4 h-4" />
              </div>
              <div>
                <span class="text-sm font-bold text-white">1. Decks Aggro Rapides</span>
                <p class="text-[11px] text-slate-400">Ire-Foudre ex / Ogerpon, Rugit-Lune ex, Miraidon ex</p>
              </div>
            </div>
            <span class="text-lg font-bold font-mono text-amber-400 px-2.5 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
              {{ meta.aggroRate }} %
            </span>
          </div>

          <input
            type="range"
            min="5"
            max="80"
            step="1"
            :value="meta.aggroRate"
            @input="handleSliderChange('aggro', Number(($event.target as HTMLInputElement).value))"
            class="w-full accent-amber-500 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
          />

          <p class="text-[11px] text-slate-400 leading-relaxed">
            ⚡ <strong>Impact sur PokéTuner :</strong> Une forte présence d'aggro impose de maximiser les <span class="text-amber-300">Poffin Pote-Pote (4)</span> et les <span class="text-amber-300">Super Bonbons</span> pour attaquer dès le Tour 2 sans se faire déborder.
          </p>
        </div>

        <!-- Slider 2: Évolution / Setup -->
        <div class="p-4 rounded-xl bg-slate-950/70 border border-cyan-500/20 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <div class="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Scale class="w-4 h-4" />
              </div>
              <div>
                <span class="text-sm font-bold text-white">2. Decks Évolution / Setup</span>
                <p class="text-[11px] text-slate-400">Dracaufeu ex, Lanssorien ex, Gardevoir ex</p>
              </div>
            </div>
            <span class="text-lg font-bold font-mono text-cyan-400 px-2.5 py-0.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
              {{ meta.evolutionRate }} %
            </span>
          </div>

          <input
            type="range"
            min="5"
            max="80"
            step="1"
            :value="meta.evolutionRate"
            @input="handleSliderChange('evolution', Number(($event.target as HTMLInputElement).value))"
            class="w-full accent-cyan-400 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
          />

          <p class="text-[11px] text-slate-400 leading-relaxed">
            🌀 <strong>Impact sur PokéTuner :</strong> Dans les matchs miroirs ou de setup, la redondance des tuteurs universels (<span class="text-cyan-300">Hyper Ball</span>) et la stabilité sur plusieurs tours deviennent prioritaires.
          </p>
        </div>

        <!-- Slider 3: Disruption / Contrôle -->
        <div class="p-4 rounded-xl bg-slate-950/70 border border-purple-500/20 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <div class="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                <ShieldAlert class="w-4 h-4" />
              </div>
              <div>
                <span class="text-sm font-bold text-white">3. Decks Disruption / Contrôle</span>
                <p class="text-[11px] text-slate-400">Ronflex Stall, Gardevoir ex disruption, Thorn Lock</p>
              </div>
            </div>
            <span class="text-lg font-bold font-mono text-purple-400 px-2.5 py-0.5 rounded-lg bg-purple-500/10 border border-purple-500/30">
              {{ meta.controlRate }} %
            </span>
          </div>

          <input
            type="range"
            min="5"
            max="80"
            step="1"
            :value="meta.controlRate"
            @input="handleSliderChange('control', Number(($event.target as HTMLInputElement).value))"
            class="w-full accent-purple-400 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none"
          />

          <p class="text-[11px] text-slate-400 leading-relaxed">
            🛡️ <strong>Impact sur PokéTuner :</strong> Le contrôle exige un réservoir d'énergies solide (anti-défausse d'énergies) et de la pioche lourde sans risque de deck-out.
          </p>
        </div>
      </div>

      <!-- Right Column (5 cols): Optimization Priority Target -->
      <div class="lg:col-span-5 space-y-4 flex flex-col justify-between">
        <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div>
            <div class="flex items-center space-x-2">
              <div class="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Sparkles class="w-4 h-4" />
              </div>
              <div>
                <h3 class="text-base font-bold text-white">Objectif Prioritaire de Réglage</h3>
                <p class="text-xs text-slate-400">Oriente la fonction de coût de l'heuristique</p>
              </div>
            </div>
          </div>

          <!-- Target choices -->
          <div class="space-y-3">
            <div
              v-for="target in OPTIMIZATION_TARGETS"
              :key="target.id"
              @click="emit('updateTarget', target.id)"
              :class="[
                'cursor-pointer p-4 rounded-xl border transition-all duration-200 group relative',
                selectedTargetId === target.id
                  ? 'bg-slate-900 border-amber-500 shadow-md shadow-amber-500/10 ring-1 ring-amber-500/30'
                  : 'bg-slate-950/60 border-slate-800 hover:bg-slate-900/50 hover:border-slate-700'
              ]"
            >
              <div class="flex items-start justify-between">
                <div class="flex items-center space-x-2.5">
                  <div
                    :class="[
                      'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs',
                      selectedTargetId === target.id
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-slate-800 text-slate-400'
                    ]"
                  >
                    <component :is="getTargetIcon(target.icon)" class="w-4 h-4" />
                  </div>
                  <span
                    :class="[
                      'text-sm font-bold',
                      selectedTargetId === target.id ? 'text-white' : 'text-slate-300 group-hover:text-white'
                    ]"
                  >
                    {{ target.label }}
                  </span>
                </div>

                <span
                  :class="[
                    'w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5',
                    selectedTargetId === target.id
                      ? 'border-amber-500 bg-amber-500 text-slate-950'
                      : 'border-slate-700 bg-slate-800'
                  ]"
                >
                  <CheckCircle2 v-if="selectedTargetId === target.id" class="w-3 h-3 stroke-[3]" />
                </span>
              </div>

              <p class="text-xs text-slate-400 mt-2 pl-9 leading-relaxed">
                {{ target.description }}
              </p>

              <div class="mt-2.5 pl-9">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900 text-slate-300 border border-slate-800">
                  {{ target.impactSummary }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Go / Launch Banner Card -->
        <div class="bg-gradient-to-br from-amber-500/10 via-slate-900 to-slate-950 border border-amber-500/30 rounded-2xl p-5">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-mono font-semibold uppercase tracking-wider text-amber-400">
              Prêt pour la convergence
            </span>
            <span class="text-xs font-mono text-slate-400">144 permutations</span>
          </div>

          <p class="text-xs text-slate-300 mb-4 leading-relaxed">
            En cliquant ci-dessous, le simulateur heuristique va pondérer chaque configuration de Flex Slots face à la matrice de match-ups de cette salle.
          </p>

          <button
            type="button"
            @click="emit('nextStep')"
            class="w-full flex items-center justify-center space-x-2 py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold transition-all shadow-xl shadow-amber-500/20 hover:scale-[1.01]"
          >
            <span>Calculer la répartition optimale (Algorithme Heuristique Go)</span>
            <ArrowRight class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
