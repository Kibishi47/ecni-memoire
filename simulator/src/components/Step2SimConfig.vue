<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { SimulationConfig } from '../types/simulator'
import type { ParsedDeck } from '../types/deck'
import type { MaxBranchesSetting } from '../core/evaluator'
import { META_OPPONENT_DECKS } from '../data/metaDecks'

const props = defineProps<{
  config: SimulationConfig
  deck: ParsedDeck
  isDebugMode: boolean
  maxHardwareWorkers: number
  isSimulating?: boolean
  progressPercent?: number
}>()

const emit = defineEmits<{
  (e: 'update-config', updated: SimulationConfig): void
  (e: 'back-step1'): void
  (e: 'launch-simulation'): void
  (e: 'cancel-simulation'): void
}>()

export interface PerformanceProfile {
  id: string
  label: string
  subtitle: string
  estimatedTime: string
  iterations: number
  maxTurns: number
  maxBranches: MaxBranchesSetting
  recommendedBadge?: string
}

const PERFORMANCE_PROFILES: PerformanceProfile[] = [
  {
    id: 'ultra_fast',
    label: 'Éclair',
    subtitle: 'Aperçu instantané',
    estimatedTime: '~2 sec',
    iterations: 60,
    maxTurns: 12,
    maxBranches: 8,
  },
  {
    id: 'fast',
    label: 'Rapide',
    subtitle: 'Idéal pour itérer',
    estimatedTime: '~5 sec',
    iterations: 150,
    maxTurns: 15,
    maxBranches: 8,
    recommendedBadge: 'Recommandé',
  },
  {
    id: 'balanced',
    label: 'Équilibré',
    subtitle: 'Précision solide',
    estimatedTime: '~10 sec',
    iterations: 300,
    maxTurns: 15,
    maxBranches: 20,
  },
  {
    id: 'precise',
    label: 'Précis',
    subtitle: 'Analyse compétitive',
    estimatedTime: '~25 sec',
    iterations: 600,
    maxTurns: 18,
    maxBranches: 20,
  },
  {
    id: 'tournament',
    label: 'Tournoi',
    subtitle: 'Robustesse maximale',
    estimatedTime: '~60 sec',
    iterations: 1500,
    maxTurns: 20,
    maxBranches: 50,
  },
]

const activeProfileId = ref<string>('fast')

function patchConfig(partial: Partial<SimulationConfig>) {
  emit('update-config', {
    ...props.config,
    ...partial,
  })
}

function applyProfile(profile: PerformanceProfile) {
  activeProfileId.value = profile.id
  patchConfig({
    iterations: profile.iterations,
    maxTurns: profile.maxTurns,
    maxBranches: profile.maxBranches,
    workerCount: Math.min(props.maxHardwareWorkers, 4),
  })
}

onMounted(() => {
  // Detection automatique basee sur les capacites materielles du client
  const cores = props.maxHardwareWorkers || 4
  if (cores >= 8) {
    applyProfile(PERFORMANCE_PROFILES[2]!) // Équilibré
  } else {
    applyProfile(PERFORMANCE_PROFILES[1]!) // Rapide
  }
})

function toggleOpponent(oppId: string) {
  const current = new Set(props.config.selectedOpponentIds)
  if (current.has(oppId)) {
    if (current.size > 1) {
      current.delete(oppId)
    }
  } else {
    current.add(oppId)
  }
  patchConfig({ selectedOpponentIds: Array.from(current) })
}

function selectAllOpponents() {
  patchConfig({ selectedOpponentIds: META_OPPONENT_DECKS.map((d) => d.id) })
}

const launchButtonState = computed(() => {
  if (props.isSimulating) {
    return {
      disabled: true,
      label: `Simulation en cours... (${props.progressPercent ?? 0} %)`,
      showSpinner: true,
    }
  }
  if (!props.deck.isValid60 || !props.deck.isFullyResolved) {
    return {
      disabled: true,
      label: 'Deck invalide : veuillez revenir à l\'étape 1',
      showSpinner: false,
    }
  }
  if (props.config.selectedOpponentIds.length === 0) {
    return {
      disabled: true,
      label: 'Sélectionnez au moins un adversaire',
      showSpinner: false,
    }
  }
  return {
    disabled: false,
    label: `Lancer la simulation (${props.config.iterations.toLocaleString('fr-FR')} parties)`,
    showSpinner: false,
  }
})
</script>

<template>
  <div class="space-y-6">
    <!-- Barre supérieure de contrôle -->
    <div class="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div>
        <h2 class="text-xl font-bold text-slate-900">
          Configuration des Matchups &amp; Vitesse
        </h2>
        <p class="mt-1 text-sm text-slate-600">
          Choisissez vos adversaires et le profil de précision souhaité pour lancer le simulateur.
        </p>
      </div>

      <div class="flex items-center gap-3">
        <button
          type="button"
          @click="emit('back-step1')"
          class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          ← Modifier mon deck
        </button>

        <button
          v-if="isSimulating"
          type="button"
          @click="emit('cancel-simulation')"
          class="inline-flex items-center gap-2 rounded-xl border border-rose-600 bg-rose-600 px-5 py-2.5 text-sm font-bold text-white shadow-xs transition hover:bg-rose-700 active:bg-rose-800"
        >
          <span>Annuler la simulation</span>
        </button>

        <button
          v-else
          type="button"
          :disabled="launchButtonState.disabled"
          @click="emit('launch-simulation')"
          class="inline-flex items-center gap-2 rounded-xl border px-6 py-2.5 text-sm font-bold transition"
          :class="[
            launchButtonState.disabled
              ? 'cursor-not-allowed border-slate-200 bg-slate-200 text-slate-500'
              : 'border-slate-900 bg-slate-900 text-white shadow-xs hover:bg-slate-800 active:bg-slate-950',
          ]"
        >
          <svg
            v-if="launchButtonState.showSpinner"
            class="h-4 w-4 animate-spin text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
          </svg>
          <span>{{ launchButtonState.label }}</span>
        </button>
      </div>
    </div>

    <!-- 1. SELECTEUR DE PROFIL DE PERFORMANCE AUTOMATISE -->
    <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div class="mb-4">
        <div class="flex items-center justify-between">
          <label class="text-xs font-bold uppercase tracking-wider text-slate-700">
            1. Vitesse &amp; Précision de la Simulation
          </label>
          <span class="text-xs text-slate-500">
            Configuration automatique adaptée à votre processeur ({{ maxHardwareWorkers }} cœurs détectés)
          </span>
        </div>
        <p class="mt-1 text-xs text-slate-500">
          Sélectionnez un niveau de précision : le volume de parties et la profondeur de calcul s'ajustent automatiquement.
        </p>
      </div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <button
          v-for="profile in PERFORMANCE_PROFILES"
          :key="profile.id"
          type="button"
          @click="applyProfile(profile)"
          class="flex flex-col justify-between rounded-xl border p-3.5 text-left transition"
          :class="[
            activeProfileId === profile.id
              ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
              : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300 hover:bg-slate-100',
          ]"
        >
          <div>
            <div class="flex items-center justify-between">
              <span class="text-sm font-bold">{{ profile.label }}</span>
              <span
                v-if="profile.recommendedBadge"
                class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                :class="activeProfileId === profile.id ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-800'"
              >
                {{ profile.recommendedBadge }}
              </span>
            </div>
            <div
              class="mt-1 text-xs"
              :class="activeProfileId === profile.id ? 'text-slate-300' : 'text-slate-500'"
            >
              {{ profile.subtitle }}
            </div>
          </div>

          <div class="mt-4 border-t pt-2" :class="activeProfileId === profile.id ? 'border-slate-800' : 'border-slate-200'">
            <div class="font-mono text-xs font-bold" :class="activeProfileId === profile.id ? 'text-emerald-400' : 'text-emerald-700'">
              {{ profile.estimatedTime }}
            </div>
            <div class="text-[10px]" :class="activeProfileId === profile.id ? 'text-slate-400' : 'text-slate-400'">
              {{ profile.iterations }} parties
            </div>
          </div>
        </button>
      </div>
    </div>

    <!-- 2. ORDRE DU TOUR : PREMIER / DEUXIEME / ALEATOIRE -->
    <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div class="mb-3">
        <label class="text-xs font-bold uppercase tracking-wider text-slate-700">
          2. Ordre de jeu initial (Tirage au sort)
        </label>
        <p class="mt-1 text-xs text-slate-500">
          Choisissez si vous commencez ou jouez en second, ou conservez la règle officielle de tournoi (50/50).
        </p>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button
          type="button"
          @click="patchConfig({ firstPlayerMode: 'RANDOM' })"
          class="flex items-center gap-3 rounded-xl border p-4 text-left transition"
          :class="[
            config.firstPlayerMode === 'RANDOM'
              ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
              : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300 hover:bg-slate-100',
          ]"
        >
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-bold"
            :class="config.firstPlayerMode === 'RANDOM' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'"
          >
            50%
          </div>
          <div>
            <div class="text-sm font-bold">Aléatoire (Officiel)</div>
            <div class="text-xs" :class="config.firstPlayerMode === 'RANDOM' ? 'text-slate-300' : 'text-slate-500'">
              50% Premier / 50% Deuxième
            </div>
          </div>
        </button>

        <button
          type="button"
          @click="patchConfig({ firstPlayerMode: 'PLAYER' })"
          class="flex items-center gap-3 rounded-xl border p-4 text-left transition"
          :class="[
            config.firstPlayerMode === 'PLAYER'
              ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
              : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300 hover:bg-slate-100',
          ]"
        >
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-bold"
            :class="config.firstPlayerMode === 'PLAYER' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'"
          >
            T1
          </div>
          <div>
            <div class="text-sm font-bold">Toujours Premier</div>
            <div class="text-xs" :class="config.firstPlayerMode === 'PLAYER' ? 'text-slate-300' : 'text-slate-500'">
              Posez en premier (pas d'attaque T1)
            </div>
          </div>
        </button>

        <button
          type="button"
          @click="patchConfig({ firstPlayerMode: 'OPPONENT' })"
          class="flex items-center gap-3 rounded-xl border p-4 text-left transition"
          :class="[
            config.firstPlayerMode === 'OPPONENT'
              ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
              : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300 hover:bg-slate-100',
          ]"
        >
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-bold"
            :class="config.firstPlayerMode === 'OPPONENT' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'"
          >
            T2
          </div>
          <div>
            <div class="text-sm font-bold">Toujours Deuxième</div>
            <div class="text-xs" :class="config.firstPlayerMode === 'OPPONENT' ? 'text-slate-300' : 'text-slate-500'">
              Supporter et attaque dès votre T1
            </div>
          </div>
        </button>
      </div>
    </div>

    <!-- 3. DECKS ADVERSES DU TOP META -->
    <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <label class="text-xs font-bold uppercase tracking-wider text-slate-700">
            3. Adversaires Méta à affronter
          </label>
          <p class="mt-1 text-xs text-slate-500">
            Sélectionnez les archétypes compétitifs dominants contre lesquels votre deck sera mesuré.
          </p>
        </div>
        <button
          type="button"
          @click="selectAllOpponents"
          class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
        >
          Sélectionner tous les decks méta
        </button>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div
          v-for="deckItem in META_OPPONENT_DECKS"
          :key="deckItem.id"
          @click="toggleOpponent(deckItem.id)"
          class="cursor-pointer rounded-xl border p-4 transition"
          :class="[
            config.selectedOpponentIds.includes(deckItem.id)
              ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
              : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300 hover:bg-slate-100',
          ]"
        >
          <div class="flex items-center justify-between">
            <span
              class="rounded-md px-2 py-0.5 text-xs font-bold"
              :class="config.selectedOpponentIds.includes(deckItem.id) ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-800'"
            >
              {{ deckItem.archetypeBadge }}
            </span>

            <input
              type="checkbox"
              :checked="config.selectedOpponentIds.includes(deckItem.id)"
              class="h-4 w-4 rounded accent-slate-900"
              @click.stop="toggleOpponent(deckItem.id)"
            />
          </div>

          <h3 class="mt-3 text-base font-bold">
            {{ deckItem.name }}
          </h3>
          <p class="mt-1 text-xs" :class="config.selectedOpponentIds.includes(deckItem.id) ? 'text-slate-300' : 'text-slate-500'">
            {{ deckItem.description }}
          </p>
        </div>
      </div>
    </div>

    <!-- PANNEAU TECHNIQUE DE DEBUG (UNIQUEMENT VISIBLE SI ?debug=true) -->
    <div
      v-if="isDebugMode"
      class="rounded-2xl border border-amber-300 bg-amber-50/50 p-5 shadow-xs"
    >
      <div class="flex items-center justify-between border-b border-amber-200 pb-3">
        <div class="flex items-center gap-2">
          <span class="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">i</span>
          <h3 class="text-xs font-bold uppercase tracking-wider text-amber-950">
            Paramètres Granulaires Avancés (Mode Développeur)
          </h3>
        </div>
        <span class="font-mono text-xs text-amber-800">?debug=true</span>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label class="block text-xs font-bold text-slate-700">Nombre de parties manuel</label>
          <input
            type="number"
            :value="config.iterations"
            @input="(e) => patchConfig({ iterations: Number((e.target as HTMLInputElement).value) || 100 })"
            class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs text-slate-800"
          />
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700">Tours maximum (maxTurns)</label>
          <input
            type="number"
            :value="config.maxTurns"
            @input="(e) => patchConfig({ maxTurns: Number((e.target as HTMLInputElement).value) || 15 })"
            class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs text-slate-800"
          />
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700">Workers Web (threads)</label>
          <input
            type="number"
            :value="config.workerCount"
            min="1"
            :max="maxHardwareWorkers"
            @input="(e) => patchConfig({ workerCount: Number((e.target as HTMLInputElement).value) || 1 })"
            class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs text-slate-800"
          />
        </div>
      </div>
    </div>
  </div>
</template>
