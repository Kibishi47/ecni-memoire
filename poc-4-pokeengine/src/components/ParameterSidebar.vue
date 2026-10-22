<script setup lang="ts">
import {
  Cpu,
  Dices,
  Layers,
  Minus,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Sparkles,
  Swords,
  Zap,
} from 'lucide-vue-next'
import type {
  AIStrategyMode,
  OpponentArchetype,
  SimulationConfig,
  Turn3DisruptionMode,
  WorkerExecutionMode,
} from '@/types/engine'

const props = defineProps<{
  config: SimulationConfig
  isRunning: boolean
}>()

const emit = defineEmits<{
  (e: 'run'): void
  (e: 'randomize-seed'): void
  (e: 'reset'): void
}>()

const iterationOptions: SimulationConfig['iterations'][] = [100, 1000, 10000, 100000]

const aiOptions: { value: AIStrategyMode; label: string; sub: string }[] = [
  {
    value: 'EXPECTIMINIMAX_T1',
    label: 'IA Optimale (Expectiminimax T+1 + Threat Scoring)',
    sub: 'Anticipation T ➔ T_adv ➔ T+1, Ciblage Boss/Attrape-Riposte & Energy Banking',
  },
  {
    value: 'OPTIMAL_BEAM',
    label: 'IA Beam Search 1-Tour (Épuration sans Anticipation T+1)',
    sub: 'Épuration déterministe avant pioche mais évaluation arrêtée à la fin du Tour T',
  },
  {
    value: 'GREEDY',
    label: 'IA Gloutonne (Premier Jouable Gauche-Droite)',
    sub: 'Joue la 1re carte jouable de gauche à droite sans épuration préalable',
  },
  {
    value: 'NAIVE_RANDOM',
    label: 'IA Naïve (Ordre Aléatoire)',
    sub: 'Séquence d’actions aléatoire sans heuristique ni Prize Checking',
  },
]

const workerModeOptions: { value: WorkerExecutionMode; label: string; sub: string }[] = [
  {
    value: 'MULTI_WORKER',
    label: 'Multi-Workers Parallèles (Optimisé Mobile/PC)',
    sub: 'Sharding 4..8 threads + Memory Pooling 0-GC (Gain vitesse ×4)',
  },
  {
    value: 'SINGLE_WORKER',
    label: '1 Worker (Standard)',
    sub: 'Exécution séquentielle sur un seul thread Web Worker',
  },
]

const opponentArchetypeOptions: { value: OpponentArchetype; label: string; sub: string }[] = [
  {
    value: 'RAGING_BOLT_AGGRO',
    label: 'Ire-Foudre ex Aggro (Menace KO T2)',
    sub: 'Ogerpon ex (Moteur) + Ire-Foudre ex (Attaquant Chargé 240 PV)',
  },
  {
    value: 'CHARIZARD_DRAGAPULT_SETUP',
    label: 'Dracaufeu / Lanssorien Setup (Course aux Prizes)',
    sub: 'Dispareptil / Roucarnage ex (Moteur) + Lanssorien ex (320 PV)',
  },
  {
    value: 'GARDEVOIR_DISRUPTION',
    label: 'Gardevoir Disruption (Mashynn + Ciblage Banc)',
    sub: 'Kirlia Raffinement (Moteur) + Gardevoir ex / Baudrive + Mashynn',
  },
]

const beamWidthOptions = [1, 2, 3, 4, 5, 6, 7, 8]

const disruptionOptions: { value: Turn3DisruptionMode; label: string }[] = [
  { value: 'NONE', label: 'Dynamique selon Archétype Adverse (T_adv)' },
  { value: 'IONO_HAND_TO_3', label: 'Forcer Mashynn / Iono au T3 (Main à 3 cartes)' },
  { value: 'KO_ACTIVE_POKEMON', label: 'Forcer KO du Pokémon Actif au Tour 3' },
]

const turnOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

function setIterations(val: SimulationConfig['iterations']) {
  props.config.iterations = val
  emit('run')
}

function setWorkerMode(mode: WorkerExecutionMode) {
  props.config.workerMode = mode
  emit('run')
}

function setOpponentArchetype(arch: OpponentArchetype) {
  props.config.opponentArchetype = arch
  emit('run')
}

function setMaxTurns(turns: number) {
  const clamped = Math.max(1, Math.min(10, turns))
  if (props.config.maxTurns !== clamped) {
    props.config.maxTurns = clamped
    emit('run')
  }
}

function setAiMode(val: AIStrategyMode) {
  props.config.aiMode = val
  emit('run')
}

function setFixedBeamWidth(width: number) {
  const clamped = Math.max(1, Math.min(8, width))
  props.config.fixedBeamWidth = clamped
  props.config.aiMode = 'FIXED_BEAM'
  emit('run')
}

function setGoingFirst(val: boolean) {
  props.config.goingFirst = val
  emit('run')
}

function setPrizesEnabled(val: boolean) {
  props.config.prizesEnabled = val
  emit('run')
}

function setDisruption(val: Turn3DisruptionMode) {
  props.config.turn3Disruption = val
  emit('run')
}

function adjustRatio(
  key: keyof SimulationConfig['deckRatios'],
  delta: number,
  min: number,
  max: number,
) {
  const next = Math.max(min, Math.min(max, props.config.deckRatios[key] + delta))
  if (next !== props.config.deckRatios[key]) {
    props.config.deckRatios[key] = next
    emit('run')
  }
}

function onSeedInputChange(event: Event) {
  const target = event.target as HTMLInputElement
  const parsed = parseInt(target.value, 10)
  if (!Number.isNaN(parsed)) {
    props.config.seed = Math.max(1, Math.min(999999999, parsed))
    emit('run')
  }
}
</script>

<template>
  <aside
    class="w-full lg:w-80 xl:w-96 shrink-0 bg-white border-r border-slate-200 flex flex-col select-none"
  >
    <!-- Sidebar Header -->
    <div class="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
      <div class="flex items-center gap-2">
        <Sliders class="w-4 h-4 text-slate-700" />
        <h2 class="text-xs font-bold uppercase tracking-wider text-slate-800">
          Paramètres du Banc d’Essai (6)
        </h2>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
        title="Réinitialiser les paramètres par défaut"
        @click="emit('reset')"
      >
        <RotateCcw class="w-3 h-3" />
        Reset
      </button>
    </div>

    <div class="p-4 space-y-5">
      <!-- 1. Volume de simulations (N), Mode Multi-Workers & Horizon de Tours (1 à 10) -->
      <section class="space-y-3">
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <span
                class="w-4 h-4 rounded bg-slate-100 border border-slate-300 text-[10px] font-mono font-bold flex items-center justify-center text-slate-700"
                >1</span
              >
              Volume Monte-Carlo (N) & Workers
            </label>
            <span class="text-[11px] font-mono text-emerald-700 font-semibold">0-Allocation GC</span>
          </div>
          <div class="grid grid-cols-4 gap-1.5">
            <button
              v-for="n in iterationOptions"
              :key="n"
              type="button"
              class="py-1.5 px-2 rounded border text-xs font-mono font-semibold transition-all"
              :class="
                config.iterations === n
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300'
              "
              @click="setIterations(n)"
            >
              {{ n.toLocaleString('fr-FR') }}
            </button>
          </div>
        </div>

        <!-- Sélecteur d'Exécution Matérielle (Multi-Workers vs 1 Worker) -->
        <div class="space-y-1.5">
          <button
            v-for="wOpt in workerModeOptions"
            :key="wOpt.value"
            type="button"
            class="w-full text-left p-2 rounded border transition-all flex items-start justify-between gap-2"
            :class="
              config.workerMode === wOpt.value
                ? 'bg-emerald-50/70 border-emerald-600 text-slate-900 ring-1 ring-emerald-600/20'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            "
            @click="setWorkerMode(wOpt.value)"
          >
            <div>
              <div class="text-xs font-semibold flex items-center gap-1.5">
                <Zap
                  v-if="wOpt.value === 'MULTI_WORKER'"
                  class="w-3.5 h-3.5 text-emerald-600 shrink-0"
                />
                <Cpu v-else class="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {{ wOpt.label }}
              </div>
              <p class="text-[10px] text-slate-500 mt-0.5 leading-tight font-mono">{{ wOpt.sub }}</p>
            </div>
            <span
              class="w-2.5 h-2.5 rounded-full mt-1 shrink-0 border"
              :class="
                config.workerMode === wOpt.value
                  ? 'bg-emerald-600 border-emerald-600'
                  : 'bg-white border-slate-300'
              "
            />
          </button>
        </div>

        <!-- Sélecteur du Nombre de Tours (1 à 10 tours max avec arrêt anticipé) -->
        <div class="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-slate-800">
              Nombre de Tours max (1 à 10)
            </span>
            <span
              class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200"
            >
              T1 ➔ T{{ config.maxTurns }}
            </span>
          </div>

          <div class="grid grid-cols-5 gap-1">
            <button
              v-for="t in turnOptions"
              :key="t"
              type="button"
              class="py-1 rounded border text-xs font-mono font-semibold transition-all"
              :class="
                config.maxTurns === t
                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              "
              @click="setMaxTurns(t)"
            >
              T{{ t }}
            </button>
          </div>

          <p class="text-[10px] text-slate-500 leading-snug font-mono">
            Arrêt anticipé automatique si la partie se termine avant T{{ config.maxTurns }} (6 Récompenses prises, Deck-Out ou KO sans Banc).
          </p>
        </div>
      </section>

      <!-- 2. Algorithme d'exploration (IA) & Nombre de Branches par Tour -->
      <section class="space-y-2.5">
        <label class="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <span
            class="w-4 h-4 rounded bg-slate-100 border border-slate-300 text-[10px] font-mono font-bold flex items-center justify-center text-slate-700"
            >2</span
          >
          Niveau d’IA & Anticipation (4 Modes)
        </label>
        <div class="space-y-1.5">
          <button
            v-for="opt in aiOptions"
            :key="opt.value"
            type="button"
            class="w-full text-left p-2.5 rounded border transition-all flex items-start justify-between gap-2"
            :class="
              config.aiMode === opt.value
                ? 'bg-blue-50/70 border-blue-600 text-slate-900 ring-1 ring-blue-600/20'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            "
            @click="setAiMode(opt.value)"
          >
            <div>
              <div class="text-xs font-semibold flex items-center gap-1.5">
                <Sparkles
                  v-if="
                    opt.value === 'EXPECTIMINIMAX_T1' ||
                    opt.value === 'OPTIMAL_BEAM' ||
                    opt.value === 'FIXED_BEAM'
                  "
                  class="w-3.5 h-3.5 text-blue-600 shrink-0"
                />
                <Cpu v-else class="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {{ opt.label }}
              </div>
              <p class="text-[11px] text-slate-500 mt-0.5 leading-tight">{{ opt.sub }}</p>
            </div>
            <span
              class="w-2.5 h-2.5 rounded-full mt-1 shrink-0 border"
              :class="
                config.aiMode === opt.value
                  ? 'bg-blue-600 border-blue-600'
                  : 'bg-white border-slate-300'
              "
            />
          </button>
        </div>

        <!-- Sélecteur direct du nombre de branches à tester tous les tours (1 à 8) -->
        <div
          class="p-2.5 rounded-lg border transition-colors space-y-2"
          :class="
            config.aiMode === 'FIXED_BEAM'
              ? 'border-blue-300 bg-blue-50/40'
              : 'border-slate-200 bg-slate-50/70'
          "
        >
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-slate-800">
              Branches à tester / tour (Fixe)
            </span>
            <span
              class="px-2 py-0.5 rounded text-[10px] font-mono font-bold border"
              :class="
                config.aiMode === 'FIXED_BEAM'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-300'
              "
            >
              {{
                config.aiMode === 'EXPECTIMINIMAX_T1' || config.aiMode === 'OPTIMAL_BEAM'
                  ? 'Auto (1..4 / tour)'
                  : config.aiMode === 'FIXED_BEAM'
                    ? `${config.fixedBeamWidth} / tour`
                    : '1 / tour'
              }}
            </span>
          </div>

          <div class="grid grid-cols-8 gap-1">
            <button
              v-for="k in beamWidthOptions"
              :key="k"
              type="button"
              class="py-1 rounded border text-xs font-mono font-semibold transition-all"
              :class="
                config.aiMode === 'FIXED_BEAM' && config.fixedBeamWidth === k
                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
              "
              :title="`Tester exactement ${k} branche(s) à chaque tour`"
              @click="setFixedBeamWidth(k)"
            >
              {{ k }}
            </button>
          </div>

          <p class="text-[10px] text-slate-500 leading-snug font-mono">
            <template v-if="config.aiMode === 'EXPECTIMINIMAX_T1' || config.aiMode === 'OPTIMAL_BEAM'">
              Mode <strong>Auto (1 à 4 br./tour)</strong> actif selon l’état de la main. Cliquez sur 1..8 pour forcer un nombre fixe de branches.
            </template>
            <template v-else-if="config.aiMode === 'FIXED_BEAM'">
              Mode <strong>Fixe ({{ config.fixedBeamWidth }} br./tour)</strong> actif : teste systématiquement les {{ config.fixedBeamWidth }} premières stratégies (A➔{{ String.fromCharCode(64 + config.fixedBeamWidth) }}) avec Expectiminimax T+1.
            </template>
            <template v-else>
              Cliquez sur un chiffre (1 à 8) pour forcer l’évaluation de K branches à chaque tour.
            </template>
          </p>
        </div>
      </section>

      <!-- 3. Sélecteur d'Archétype Adverse (Double Plateau) -->
      <section class="space-y-2">
        <label class="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <span
            class="w-4 h-4 rounded bg-slate-100 border border-slate-300 text-[10px] font-mono font-bold flex items-center justify-center text-slate-700"
            >3</span
          >
          Archétype Adverse (Double Plateau)
        </label>
        <div class="space-y-1.5">
          <button
            v-for="arch in opponentArchetypeOptions"
            :key="arch.value"
            type="button"
            class="w-full text-left p-2 rounded border transition-all flex items-start justify-between gap-2"
            :class="
              config.opponentArchetype === arch.value
                ? 'bg-amber-50/80 border-amber-500 text-slate-900 ring-1 ring-amber-500/20'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            "
            @click="setOpponentArchetype(arch.value)"
          >
            <div>
              <div class="text-xs font-semibold flex items-center gap-1.5">
                <Swords
                  class="w-3.5 h-3.5 shrink-0"
                  :class="config.opponentArchetype === arch.value ? 'text-amber-600' : 'text-slate-400'"
                />
                {{ arch.label }}
              </div>
              <p class="text-[10px] text-slate-500 mt-0.5 leading-tight font-mono">{{ arch.sub }}</p>
            </div>
            <span
              class="w-2.5 h-2.5 rounded-full mt-1 shrink-0 border"
              :class="
                config.opponentArchetype === arch.value
                  ? 'bg-amber-600 border-amber-600'
                  : 'bg-white border-slate-300'
              "
            />
          </button>
        </div>
      </section>

      <!-- 3. Ordre du tour (1er vs 2d Joueur) -->
      <section class="space-y-2">
        <label class="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <span
            class="w-4 h-4 rounded bg-slate-100 border border-slate-300 text-[10px] font-mono font-bold flex items-center justify-center text-slate-700"
            >3</span
          >
          Ordre du Tour (Invariant Supporter T1)
        </label>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            class="p-2 rounded border text-left transition-all"
            :class="
              config.goingFirst
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            "
            @click="setGoingFirst(true)"
          >
            <div class="text-xs font-semibold">1er Joueur</div>
            <div
              class="text-[10px] font-mono mt-0.5"
              :class="config.goingFirst ? 'text-slate-300' : 'text-slate-500'"
            >
              0 Supporter T1
            </div>
          </button>
          <button
            type="button"
            class="p-2 rounded border text-left transition-all"
            :class="
              !config.goingFirst
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            "
            @click="setGoingFirst(false)"
          >
            <div class="text-xs font-semibold">2d Joueur</div>
            <div
              class="text-[10px] font-mono mt-0.5"
              :class="!config.goingFirst ? 'text-slate-300' : 'text-slate-500'"
            >
              Supporter T1 autorisé
            </div>
          </button>
        </div>
      </section>

      <!-- 4. Règle des 6 Récompenses (Prized) -->
      <section class="space-y-2">
        <label class="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <span
            class="w-4 h-4 rounded bg-slate-100 border border-slate-300 text-[10px] font-mono font-bold flex items-center justify-center text-slate-700"
            >4</span
          >
          Règle des 6 Cartes Récompenses
        </label>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            class="p-2 rounded border text-left transition-all"
            :class="
              config.prizesEnabled
                ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            "
            @click="setPrizesEnabled(true)"
          >
            <div class="text-xs font-semibold">Activée (Officiel)</div>
            <div class="text-[10px] text-slate-500 font-mono mt-0.5">6 cartes isolées</div>
          </button>
          <button
            type="button"
            class="p-2 rounded border text-left transition-all"
            :class="
              !config.prizesEnabled
                ? 'bg-amber-50 text-amber-900 border-amber-300 font-semibold'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            "
            @click="setPrizesEnabled(false)"
          >
            <div class="text-xs font-semibold">Désactivée</div>
            <div class="text-[10px] text-slate-500 font-mono mt-0.5">Deck complet (Théorique)</div>
          </button>
        </div>
      </section>

      <!-- 5. Perturbation Adverse au Tour 3 -->
      <section class="space-y-2">
        <label class="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <span
            class="w-4 h-4 rounded bg-slate-100 border border-slate-300 text-[10px] font-mono font-bold flex items-center justify-center text-slate-700"
            >5</span
          >
          Perturbation Adverse au Tour 3
        </label>
        <div class="space-y-1">
          <button
            v-for="d in disruptionOptions"
            :key="d.value"
            type="button"
            class="w-full px-2.5 py-1.5 rounded border text-left text-xs flex items-center justify-between transition-all"
            :class="
              config.turn3Disruption === d.value
                ? 'bg-slate-900 text-white border-slate-900 font-medium'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            "
            @click="setDisruption(d.value)"
          >
            <span class="flex items-center gap-1.5 truncate">
              <ShieldAlert
                v-if="d.value !== 'NONE'"
                class="w-3.5 h-3.5 shrink-0"
                :class="config.turn3Disruption === d.value ? 'text-amber-300' : 'text-amber-600'"
              />
              {{ d.label }}
            </span>
          </button>
        </div>
      </section>

      <!-- 6. Seed PRNG & Micro-Ratios du Deck -->
      <section class="space-y-3 pt-2 border-t border-slate-200">
        <div class="flex items-center justify-between">
          <label class="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <span
              class="w-4 h-4 rounded bg-slate-100 border border-slate-300 text-[10px] font-mono font-bold flex items-center justify-center text-slate-700"
              >6</span
            >
            Seed PRNG & Micro-Ratios (60 cartes)
          </label>
          <span class="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
            Mulberry32
          </span>
        </div>

        <!-- Seed input + Random button -->
        <div class="flex items-center gap-1.5">
          <div class="relative flex-1">
            <span
              class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono uppercase text-slate-400"
              >SEED</span
            >
            <input
              type="number"
              :value="config.seed"
              class="w-full pl-12 pr-2.5 py-1.5 text-xs font-mono font-semibold bg-slate-50 border border-slate-200 rounded text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
              @change="onSeedInputChange"
            />
          </div>
          <button
            type="button"
            class="px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1 shrink-0 transition-colors"
            @click="emit('randomize-seed')"
          >
            <Dices class="w-3.5 h-3.5 text-blue-600" />
            🎲 Aléatoire
          </button>
        </div>

        <!-- 4 Micro-Ratios Counters -->
        <div class="bg-slate-50 rounded-lg border border-slate-200 p-2.5 space-y-2">
          <div class="flex items-center justify-between text-[11px] text-slate-500 pb-1 border-b border-slate-200/80">
            <span class="font-medium flex items-center gap-1">
              <Layers class="w-3 h-3 text-slate-400" />
              Ajustement dynamique des ratios
            </span>
            <span class="font-mono font-semibold text-slate-700">Total = 60 cartes</span>
          </div>

          <!-- Ratio 1: Pokémon de Base -->
          <div class="flex items-center justify-between">
            <div>
              <div class="text-xs font-medium text-slate-800">Pokémon de Base</div>
              <div class="text-[10px] text-slate-500 font-mono">Impact direct Mulligan T1</div>
            </div>
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="w-6 h-6 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-700 disabled:opacity-40"
                :disabled="config.deckRatios.basicPokemonCount <= 4"
                @click="adjustRatio('basicPokemonCount', -1, 4, 15)"
              >
                <Minus class="w-3 h-3" />
              </button>
              <span class="w-6 text-center font-mono text-xs font-bold text-slate-900">
                {{ config.deckRatios.basicPokemonCount }}
              </span>
              <button
                type="button"
                class="w-6 h-6 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-700 disabled:opacity-40"
                :disabled="config.deckRatios.basicPokemonCount >= 15"
                @click="adjustRatio('basicPokemonCount', 1, 4, 15)"
              >
                <Plus class="w-3 h-3" />
              </button>
            </div>
          </div>

          <!-- Ratio 2: Poffin Pote-Pote -->
          <div class="flex items-center justify-between">
            <div>
              <div class="text-xs font-medium text-slate-800">Poffin Pote-Pote</div>
              <div class="text-[10px] text-slate-500 font-mono">Tuteur Banc (PV ≤ 70)</div>
            </div>
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="w-6 h-6 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-700 disabled:opacity-40"
                :disabled="config.deckRatios.poffinCount <= 0"
                @click="adjustRatio('poffinCount', -1, 0, 4)"
              >
                <Minus class="w-3 h-3" />
              </button>
              <span class="w-6 text-center font-mono text-xs font-bold text-slate-900">
                {{ config.deckRatios.poffinCount }}
              </span>
              <button
                type="button"
                class="w-6 h-6 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-700 disabled:opacity-40"
                :disabled="config.deckRatios.poffinCount >= 4"
                @click="adjustRatio('poffinCount', 1, 0, 4)"
              >
                <Plus class="w-3 h-3" />
              </button>
            </div>
          </div>

          <!-- Ratio 3: Super Bonbon -->
          <div class="flex items-center justify-between">
            <div>
              <div class="text-xs font-medium text-slate-800">Super Bonbon</div>
              <div class="text-[10px] text-slate-500 font-mono">Accélération Base ➔ Niv.2</div>
            </div>
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="w-6 h-6 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-700 disabled:opacity-40"
                :disabled="config.deckRatios.rareCandyCount <= 0"
                @click="adjustRatio('rareCandyCount', -1, 0, 4)"
              >
                <Minus class="w-3 h-3" />
              </button>
              <span class="w-6 text-center font-mono text-xs font-bold text-slate-900">
                {{ config.deckRatios.rareCandyCount }}
              </span>
              <button
                type="button"
                class="w-6 h-6 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-700 disabled:opacity-40"
                :disabled="config.deckRatios.rareCandyCount >= 4"
                @click="adjustRatio('rareCandyCount', 1, 0, 4)"
              >
                <Plus class="w-3 h-3" />
              </button>
            </div>
          </div>

          <!-- Ratio 4: Énergies Feu -->
          <div class="flex items-center justify-between">
            <div>
              <div class="text-xs font-medium text-slate-800">Énergies Feu de Base</div>
              <div class="text-[10px] text-slate-500 font-mono">Cibles Règne Infernal</div>
            </div>
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="w-6 h-6 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-700 disabled:opacity-40"
                :disabled="config.deckRatios.fireEnergyCount <= 3"
                @click="adjustRatio('fireEnergyCount', -1, 3, 14)"
              >
                <Minus class="w-3 h-3" />
              </button>
              <span class="w-6 text-center font-mono text-xs font-bold text-slate-900">
                {{ config.deckRatios.fireEnergyCount }}
              </span>
              <button
                type="button"
                class="w-6 h-6 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-700 disabled:opacity-40"
                :disabled="config.deckRatios.fireEnergyCount >= 14"
                @click="adjustRatio('fireEnergyCount', 1, 3, 14)"
              >
                <Plus class="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Action Footer (placed directly below parameters, not pushed to bottom of body) -->
    <div class="p-4 border-y border-slate-200 bg-slate-50">
      <button
        type="button"
        class="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-60"
        :disabled="isRunning"
        @click="emit('run')"
      >
        <Zap v-if="isRunning" class="w-4 h-4 animate-pulse" />
        <Play v-else class="w-4 h-4 fill-current" />
        <span>
          {{
            isRunning
              ? `Exécution Worker (${config.iterations.toLocaleString('fr-FR')} parties)...`
              : `Relancer Simulation (${config.iterations.toLocaleString('fr-FR')} parties)`
          }}
        </span>
      </button>
    </div>
  </aside>
</template>
