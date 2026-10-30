<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SimulationConfig } from '../types/simulator'
import type { ParsedDeck } from '../types/deck'
import type { MaxBranchesSetting } from '../core/evaluator'
import type { DebugPerturbationType } from '../core/engine'
import { META_OPPONENT_DECKS } from '../data/metaDecks'

const props = defineProps<{
  config: SimulationConfig
  deck: ParsedDeck
  isDebugMode: boolean
  maxHardwareWorkers: number
}>()

const emit = defineEmits<{
  (e: 'update-config', updated: SimulationConfig): void
  (e: 'back-step1'): void
  (e: 'launch-simulation'): void
}>()

const iterationPresets = [100, 1000, 10000, 100000]
const maxTurnPresets = [1, 2, 5, 10, 15, 20]

const branchOptions: Array<{
  value: MaxBranchesSetting
  title: string
  badge: string
  description: string
}> = [
  {
    value: 8,
    title: 'Rapide (8 branches)',
    badge: 'M = 8',
    description: 'Exploration élaguée ultra-véloce pour les grands lots Monte-Carlo (1 000+ parties).',
  },
  {
    value: 20,
    title: 'Standard (20 branches)',
    badge: 'M = 20',
    description: 'Équilibre recommandé entre vitesse et profondeur d’anticipation 3-Ply.',
  },
  {
    value: 50,
    title: 'Profond (50 branches)',
    badge: 'M = 50',
    description: 'Déploiement large des lignes complexes de tuteurs et séquences de talents.',
  },
  {
    value: 'INFINITE',
    title: 'Infini / Exhaustif (Toutes les branches)',
    badge: 'M = ∞',
    description: 'Explore toutes les séquences légales non-redondantes dédoublonnées par Hash Canonique.',
  },
]

const perturbationOptions: Array<{ value: DebugPerturbationType; label: string }> = [
  { value: 'NONE', label: 'Aucune perturbation injectée' },
  {
    value: 'FORCE_OPPONENT_IONO',
    label: 'Forcer Mashynn / Iono adverse (Mélange main sous le deck)',
  },
  {
    value: 'FORCE_KO_ACTIVE',
    label: 'Forcer KO de notre Pokémon Actif',
  },
  {
    value: 'FORCE_KEY_CARD_PRIZED',
    label: 'Forcer Blocage de cartes clés en Récompenses (Super Bonbon / Stage 2)',
  },
]

const useCustomSeed = ref<boolean>(props.config.fixedSeed !== null)
const customSeedInput = ref<number>(props.config.fixedSeed ?? 424242)

function patchConfig(partial: Partial<SimulationConfig>) {
  emit('update-config', {
    ...props.config,
    ...partial,
  })
}

function toggleOpponent(oppId: string) {
  const current = new Set(props.config.selectedOpponentIds)
  if (current.has(oppId)) {
    current.delete(oppId)
  } else {
    current.add(oppId)
  }
  patchConfig({ selectedOpponentIds: Array.from(current) })
}

function selectAllOpponents() {
  patchConfig({ selectedOpponentIds: META_OPPONENT_DECKS.map((d) => d.id) })
}

function toggleFixedSeedMode(enabled: boolean) {
  useCustomSeed.value = enabled
  patchConfig({
    fixedSeed: enabled ? Number(customSeedInput.value) || 424242 : null,
  })
}

function updateSeedValue(val: number) {
  customSeedInput.value = val
  if (useCustomSeed.value) {
    patchConfig({ fixedSeed: Number(val) || 424242 })
  }
}

const isValidConfig = computed(() => {
  return (
    props.deck.isFullyResolved &&
    props.config.selectedOpponentIds.length >= 1 &&
    props.config.iterations >= 1 &&
    props.config.iterations <= 100000000 &&
    props.config.maxTurns >= 1 &&
    props.config.maxTurns <= 20
  )
})
</script>

<template>
  <section class="space-y-6">
    <!-- En-tête de l'Étape 2 -->
    <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span
            class="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-semibold text-slate-700"
          >
            ÉTAPE 2 SUR 3
          </span>
          <h2 class="mt-2 text-xl font-bold text-slate-900">
            Configuration de la Simulation &amp; Sélection des Matchups
          </h2>
          <p class="mt-1 text-sm text-slate-600">
            Paramétrez le volume de parties ($X$), la limite de tours (<code class="font-mono">maxTurns</code>),
            la largeur d'exploration d'arbre (<code class="font-mono">maxBranches</code>) et les archétypes adverses.
          </p>
        </div>

        <div class="flex items-center gap-3">
          <button
            type="button"
            @click="emit('back-step1')"
            class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            ← Retour au Deck
          </button>
          <button
            type="button"
            :disabled="!isValidConfig || !deck.isFullyResolved"
            @click="emit('launch-simulation')"
            class="rounded-lg border px-5 py-2.5 text-sm font-semibold transition"
            :class="
              isValidConfig && deck.isFullyResolved
                ? 'border-slate-900 bg-slate-900 text-white shadow-xs hover:bg-slate-800'
                : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
            "
          >
            Lancer la Simulation ({{ config.iterations.toLocaleString('fr-FR') }} parties) →
          </button>
        </div>
      </div>

      <!-- Bandeau de Blocage Critique si cartes non résolues -->
      <div
        v-if="!deck.isFullyResolved"
        class="mt-4 rounded-xl border-2 border-red-400 bg-red-50 p-4 text-red-950 shadow-xs"
      >
        <div class="flex items-center gap-2 text-sm font-bold text-red-900">
          <span class="text-lg">⚠️</span>
          <span>
            Simulation impossible : {{ deck.unresolvedCount }} carte{{ deck.unresolvedCount > 1 ? 's' : '' }} de votre deck n'ont pas été trouvées dans la base de données.
          </span>
        </div>
        <p class="mt-1 text-xs text-red-700">
          Chaque carte doit être présente dans <code class="font-mono">cards_database.json</code> ou le registre <code class="font-mono">fallbackCardModels</code> pour exécuter le moteur de règles.
        </p>
        <div class="mt-3 flex flex-wrap gap-1.5">
          <span
            v-for="unres in deck.unresolvedCards"
            :key="unres.uid"
            class="inline-flex items-center gap-1 rounded border border-red-300 bg-white px-2 py-0.5 font-mono text-xs font-bold text-red-700 shadow-2xs"
          >
            <span class="rounded bg-red-100 px-1 py-0.5 text-[10px] text-red-800">[Inconnu]</span>
            {{ unres.quantity }}x {{ unres.name }} {{ unres.setCode }} {{ unres.number }}
          </span>
        </div>
      </div>
    </div>

    <!-- Grille des 5 Paramètres Standard -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <!-- Colonne Gauche (7 cols) : Volume X, maxTurns, maxBranches, Ordre de jeu -->
      <div class="space-y-6 lg:col-span-7">
        <!-- 1 & 2 : Nombre de parties (X) et Nombre de tours max (maxTurns) -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <!-- 1. Nombre de parties à simuler (X) -->
          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <label for="iterations-input" class="block text-xs font-bold uppercase tracking-wider text-slate-600">
              1. Nombre de parties à simuler ($X$)
            </label>
            <p class="mt-0.5 text-xs text-slate-500">
              Champ libre (jusqu'à 100 millions) avec presets rapides cliquables
            </p>

            <div class="mt-3">
              <input
                id="iterations-input"
                type="number"
                min="1"
                max="100000000"
                step="100"
                :value="config.iterations"
                @input="
                  patchConfig({
                    iterations: Math.max(
                      1,
                      Math.min(100000000, Number(($event.target as HTMLInputElement).value) || 100),
                    ),
                  })
                "
                class="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm font-bold text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
              />
              <div class="mt-2.5 flex flex-wrap gap-1.5">
                <button
                  v-for="preset in iterationPresets"
                  :key="preset"
                  type="button"
                  @click="patchConfig({ iterations: preset })"
                  class="rounded-md border px-2.5 py-1 font-mono text-xs font-semibold transition"
                  :class="
                    config.iterations === preset
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  "
                >
                  {{ preset.toLocaleString('fr-FR') }}
                </button>
              </div>
            </div>
          </div>

          <!-- 2. Nombre de tours maximum par partie (maxTurns — Requis) -->
          <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div class="flex items-center justify-between">
              <label for="max-turns-input" class="block text-xs font-bold uppercase tracking-wider text-slate-600">
                2. Plafond de tours (<code class="font-mono">maxTurns</code>)
              </label>
              <span class="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-700">
                MAX 20 TOURS
              </span>
            </div>
            <p class="mt-0.5 text-xs text-slate-500">
              Champ libre (1 à 20 tours) avec presets rapides cliquables
            </p>

            <div class="mt-3">
              <input
                id="max-turns-input"
                type="number"
                required
                min="1"
                max="20"
                :value="config.maxTurns"
                @input="
                  patchConfig({
                    maxTurns: Math.max(
                      1,
                      Math.min(20, Number(($event.target as HTMLInputElement).value) || 15),
                    ),
                  })
                "
                class="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm font-bold text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
              />
              <div class="mt-2.5 flex flex-wrap gap-1.5">
                <button
                  v-for="tPreset in maxTurnPresets"
                  :key="tPreset"
                  type="button"
                  @click="patchConfig({ maxTurns: tPreset })"
                  class="rounded-md border px-2.5 py-1 font-mono text-xs font-semibold transition"
                  :class="
                    config.maxTurns === tPreset
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  "
                >
                  {{ tPreset }} tour{{ tPreset > 1 ? 's' : '' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 3. Nombre de branches max à tester par nœud / par tour (maxBranches) -->
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-600">
                3. Largeur d'exploration d'arbre par tour (<code class="font-mono">maxBranches</code>)
              </h3>
              <p class="mt-0.5 text-xs text-slate-500">
                Contrôle le nombre de branches candidates évaluées sur 3 demi-tours ($T \rightarrow T_{\text{adv}} \rightarrow T+1$)
              </p>
            </div>
            <span class="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
              Dédoublonnage Hash Canonique Actif
            </span>
          </div>

          <div class="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              v-for="opt in branchOptions"
              :key="String(opt.value)"
              type="button"
              @click="patchConfig({ maxBranches: opt.value })"
              class="flex flex-col justify-between rounded-xl border p-3 text-left transition"
              :class="
                config.maxBranches === opt.value
                  ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                  : 'border-slate-200 bg-slate-50/70 text-slate-800 hover:border-slate-300 hover:bg-white'
              "
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-bold">{{ opt.title }}</span>
                <span
                  class="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
                  :class="
                    config.maxBranches === opt.value
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-200/80 text-slate-700'
                  "
                >
                  {{ opt.badge }}
                </span>
              </div>
              <p
                class="mt-1.5 text-[11px] leading-snug"
                :class="config.maxBranches === opt.value ? 'text-slate-300' : 'text-slate-500'"
              >
                {{ opt.description }}
              </p>
            </button>
          </div>
        </div>

        <!-- 5. Ordre de jeu (Boutons Radio) -->
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-600">
            5. Ordre de jeu initial (Tour 1)
          </h3>
          <p class="mt-0.5 text-xs text-slate-500">
            Le Joueur 1 ne peut ni jouer de Supporter ni attaquer au Tour 1, mais évolue en premier au Tour 3.
          </p>

          <div class="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <label
              class="flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-xs font-semibold transition"
              :class="
                config.firstPlayerMode === 'PLAYER'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-white'
              "
            >
              <input
                type="radio"
                name="firstPlayerMode"
                value="PLAYER"
                :checked="config.firstPlayerMode === 'PLAYER'"
                @change="patchConfig({ firstPlayerMode: 'PLAYER' })"
                class="sr-only"
              />
              <span
                class="flex h-4 w-4 items-center justify-center rounded-full border"
                :class="
                  config.firstPlayerMode === 'PLAYER' ? 'border-white bg-white text-slate-900' : 'border-slate-400'
                "
              >
                <span v-if="config.firstPlayerMode === 'PLAYER'" class="h-2 w-2 rounded-full bg-slate-900"></span>
              </span>
              <span>Joueur 1 (1er à jouer)</span>
            </label>

            <label
              class="flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-xs font-semibold transition"
              :class="
                config.firstPlayerMode === 'OPPONENT'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-white'
              "
            >
              <input
                type="radio"
                name="firstPlayerMode"
                value="OPPONENT"
                :checked="config.firstPlayerMode === 'OPPONENT'"
                @change="patchConfig({ firstPlayerMode: 'OPPONENT' })"
                class="sr-only"
              />
              <span
                class="flex h-4 w-4 items-center justify-center rounded-full border"
                :class="
                  config.firstPlayerMode === 'OPPONENT' ? 'border-white bg-white text-slate-900' : 'border-slate-400'
                "
              >
                <span v-if="config.firstPlayerMode === 'OPPONENT'" class="h-2 w-2 rounded-full bg-slate-900"></span>
              </span>
              <span>Joueur 2 (2d à jouer)</span>
            </label>

            <label
              class="flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-xs font-semibold transition"
              :class="
                config.firstPlayerMode === 'RANDOM'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-white'
              "
            >
              <input
                type="radio"
                name="firstPlayerMode"
                value="RANDOM"
                :checked="config.firstPlayerMode === 'RANDOM'"
                @change="patchConfig({ firstPlayerMode: 'RANDOM' })"
                class="sr-only"
              />
              <span
                class="flex h-4 w-4 items-center justify-center rounded-full border"
                :class="
                  config.firstPlayerMode === 'RANDOM' ? 'border-white bg-white text-slate-900' : 'border-slate-400'
                "
              >
                <span v-if="config.firstPlayerMode === 'RANDOM'" class="h-2 w-2 rounded-full bg-slate-900"></span>
              </span>
              <span>Aléatoire (Pile ou Face 50/50)</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Colonne Droite (5 cols) : 4. Sélection Multi-Decks Adverses (au moins 1 requis) -->
      <div class="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-xs lg:col-span-5">
        <div>
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-600">
                4. Sélection des Decks Méta à Affronter
              </h3>
              <p class="mt-0.5 text-xs text-slate-500">
                Multi-sélection (au moins 1 requis) — L'adversaire joue aussi avec l'Évaluateur 3-Ply
              </p>
            </div>
            <button
              type="button"
              @click="selectAllOpponents"
              class="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
            >
              Tout cocher (4/4)
            </button>
          </div>

          <div
            v-if="config.selectedOpponentIds.length === 0"
            class="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-xs font-semibold text-red-800"
          >
            ⚠️ Sélectionnez au moins 1 deck adverse pour autoriser le lancement de la simulation.
          </div>

          <div class="mt-3 space-y-2.5">
            <label
              v-for="opp in META_OPPONENT_DECKS"
              :key="opp.id"
              class="flex cursor-pointer items-start justify-between gap-3 rounded-xl border p-3.5 transition"
              :class="
                config.selectedOpponentIds.includes(opp.id)
                  ? 'border-slate-900 bg-slate-50/90 shadow-2xs'
                  : 'border-slate-200 bg-white opacity-75 hover:opacity-100'
              "
            >
              <div class="flex items-start gap-3">
                <input
                  type="checkbox"
                  :checked="config.selectedOpponentIds.includes(opp.id)"
                  @change="toggleOpponent(opp.id)"
                  class="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <div>
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-xs font-bold text-slate-900">{{ opp.name }}</span>
                    <span
                      class="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600"
                    >
                      {{ opp.archetypeBadge }}
                    </span>
                  </div>
                  <p class="mt-1 text-[11px] leading-relaxed text-slate-500">
                    {{ opp.description }}
                  </p>
                  <div class="mt-1.5 flex flex-wrap gap-1">
                    <span
                      v-for="keyCard in opp.keyThreats"
                      :key="keyCard"
                      class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
                    >
                      {{ keyCard }}
                    </span>
                  </div>
                </div>
              </div>
              <span class="shrink-0 font-mono text-[11px] font-bold text-emerald-700">
                60 cartes
              </span>
            </label>
          </div>
        </div>

        <div class="mt-4 border-t border-slate-100 pt-3">
          <div class="flex items-center justify-between text-xs text-slate-600">
            <span>Decks adverses sélectionnés :</span>
            <span class="font-mono font-bold text-slate-900">
              {{ config.selectedOpponentIds.length }} / {{ META_OPPONENT_DECKS.length }} archétypes
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Panneau Exclusif Mode Debug (?debug=true) -->
    <div
      v-if="isDebugMode"
      class="rounded-xl border-2 border-amber-300 bg-amber-50/50 p-5 shadow-xs"
    >
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/80 pb-3">
        <div class="flex items-center gap-2">
          <span class="rounded-md bg-amber-500 px-2 py-0.5 font-mono text-xs font-bold text-white">
            ?debug=true
          </span>
          <h3 class="text-sm font-bold text-amber-950">
            Paramètres d'Ingénierie &amp; Stress-Test Déterministe (Mode Debug Actif)
          </h3>
        </div>
        <span class="font-mono text-xs text-amber-800">
          Débloque aussi l'Inspecteur Granulaire Partie / Tour / Branche à l'Étape 3
        </span>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <!-- Debug 1 : Nombre de Web Workers -->
        <div class="rounded-xl border border-amber-200 bg-white p-3.5">
          <label for="worker-count-select" class="block text-xs font-bold text-slate-800">
            Nombre de Web Workers Parallèles
          </label>
          <p class="mt-0.5 text-[11px] text-slate-500">
            Cœurs détectés (<code class="font-mono">hardwareConcurrency</code>) : {{ maxHardwareWorkers }}
          </p>
          <select
            id="worker-count-select"
            :value="config.workerCount"
            @change="patchConfig({ workerCount: Number(($event.target as HTMLSelectElement).value) })"
            class="mt-2.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-bold text-slate-900"
          >
            <option v-for="w in maxHardwareWorkers" :key="w" :value="w">
              {{ w }} Web Worker{{ w > 1 ? 's' : '' }} {{ w === maxHardwareWorkers ? '(Max CPU)' : '' }}
            </option>
          </select>
        </div>

        <!-- Debug 2 : Seed PRNG Fixe -->
        <div class="rounded-xl border border-amber-200 bg-white p-3.5">
          <div class="flex items-center justify-between">
            <label for="fixed-seed-input" class="text-xs font-bold text-slate-800">
              Seed PRNG Mulberry32 Fixe
            </label>
            <input
              type="checkbox"
              :checked="useCustomSeed"
              @change="toggleFixedSeedMode(($event.target as HTMLInputElement).checked)"
              class="h-4 w-4 rounded border-slate-300 text-slate-900"
            />
          </div>
          <p class="mt-0.5 text-[11px] text-slate-500">
            Garantit exactement les mêmes mains initiales, mulligans et tirages entre 2 runs
          </p>
          <input
            id="fixed-seed-input"
            type="number"
            :disabled="!useCustomSeed"
            :value="customSeedInput"
            @input="updateSeedValue(Number(($event.target as HTMLInputElement).value))"
            placeholder="Ex: 424242"
            class="mt-2.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs font-bold"
            :class="
              useCustomSeed
                ? 'bg-slate-50 text-slate-900'
                : 'cursor-not-allowed bg-slate-100 text-slate-400'
            "
          />
        </div>

        <!-- Debug 3 : Injection de perturbation à un tour donné -->
        <div class="rounded-xl border border-amber-200 bg-white p-3.5">
          <label for="perturbation-select" class="block text-xs font-bold text-slate-800">
            Injection de Perturbation de Stress-Test
          </label>
          <p class="mt-0.5 text-[11px] text-slate-500">
            Force un événement critique au tour $T$ choisi pour tester la résilience du deck
          </p>
          <div class="mt-2.5 flex items-center gap-2">
            <select
              id="perturbation-select"
              :value="config.perturbationType"
              @change="
                patchConfig({
                  perturbationType: ($event.target as HTMLSelectElement).value as DebugPerturbationType,
                })
              "
              class="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-900"
            >
              <option v-for="pOpt in perturbationOptions" :key="pOpt.value" :value="pOpt.value">
                {{ pOpt.label }}
              </option>
            </select>

            <select
              v-if="
                config.perturbationType === 'FORCE_OPPONENT_IONO' ||
                config.perturbationType === 'FORCE_KO_ACTIVE'
              "
              aria-label="Tour d'injection de la perturbation"
              :value="config.perturbationTurn"
              @change="
                patchConfig({
                  perturbationTurn: Number(($event.target as HTMLSelectElement).value),
                })
              "
              class="w-24 shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 font-mono text-xs font-bold text-slate-900"
            >
              <option :value="1">Tour 1</option>
              <option :value="2">Tour 2</option>
              <option :value="3">Tour 3</option>
              <option :value="4">Tour 4</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
