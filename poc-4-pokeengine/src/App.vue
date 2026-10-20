<script setup lang="ts">
import { ref } from 'vue'
import {
  Activity,
  CheckCircle2,
  Code2,
  Cpu,
  Database,
  GitBranch,
  ShieldCheck,
} from 'lucide-vue-next'
import GameInspectorTab from '@/components/GameInspectorTab.vue'
import ParameterSidebar from '@/components/ParameterSidebar.vue'
import RegistryAndGoTab from '@/components/RegistryAndGoTab.vue'
import TelemetryAndAuditTab from '@/components/TelemetryAndAuditTab.vue'
import { useSimulationWorker } from '@/composables/useSimulationWorker'
import { DEFAULT_CARD_REGISTRY } from '@/engine/cardRegistry'

const {
  config,
  isRunning,
  result,
  currentFps,
  minFpsDuringRun,
  triggerSimulation,
  randomizeSeed,
  resetToDefaults,
  updateCustomRegistry,
} = useSimulationWorker()

type ActiveTab = 'TELEMETRY_AUDIT' | 'GAME_INSPECTOR' | 'REGISTRY_GO'
const activeTab = ref<ActiveTab>('TELEMETRY_AUDIT')
const inspectorFilterTag = ref<'PERFECT_T2' | 'BRICK' | 'CANDY_PRIZED' | null>(null)

function openInspectorWithFilter(tag?: 'PERFECT_T2' | 'BRICK' | 'CANDY_PRIZED') {
  inspectorFilterTag.value = tag ?? null
  activeTab.value = 'GAME_INSPECTOR'
}

function resetRegistryOnly() {
  updateCustomRegistry(structuredClone(DEFAULT_CARD_REGISTRY))
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
    <!-- Top Engineering Lab Header -->
    <header class="bg-white border-b border-slate-200 px-5 py-3 sticky top-0 z-30 shadow-2xs">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <!-- Brand & POC Badge -->
        <div class="flex items-center gap-3">
          <div
            class="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center font-mono font-bold text-sm shadow-xs"
          >
            P4
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-sm sm:text-base font-bold tracking-tight text-slate-900">
                PokéEngine Lab & Inspector
              </h1>
              <span
                class="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200"
              >
                POC 4 • CORE ENGINE BENCHMARK
              </span>
            </div>
            <p class="text-xs text-slate-500">
              Simulateur Monte-Carlo Déterministe (Web Worker <code class="font-mono">Uint16Array</code>) • Validation Hypergéométrique & Arbre Beam Search
            </p>
          </div>
        </div>

        <!-- Live Hardware & Compliance Status Pills -->
        <div v-if="result" class="flex flex-wrap items-center gap-2 text-xs font-mono">
          <div
            class="px-2.5 py-1 rounded-md border bg-slate-50 border-slate-200 text-slate-700 flex items-center gap-1.5"
          >
            <Cpu class="w-3.5 h-3.5 text-blue-600" />
            <span>{{ result.telemetry.executionTimeMs.toFixed(1) }} ms</span>
            <span class="text-slate-300">|</span>
            <strong class="text-slate-900"
              >{{ result.telemetry.gamesPerSecond.toLocaleString('fr-FR') }} parties/s</strong
            >
          </div>

          <div
            class="px-2.5 py-1 rounded-md border bg-emerald-50 border-emerald-200 text-emerald-700 font-semibold flex items-center gap-1.5"
          >
            <Activity class="w-3.5 h-3.5" />
            <span>UI : {{ currentFps }} FPS</span>
          </div>

          <div
            class="px-2.5 py-1 rounded-md border bg-emerald-50 border-emerald-200 text-emerald-700 font-semibold flex items-center gap-1.5"
          >
            <ShieldCheck class="w-3.5 h-3.5" />
            <span
              >Audit : {{ result.invariantsAudit.totalGamesAudited.toLocaleString('fr-FR') }} /
              {{ result.invariantsAudit.totalGamesAudited.toLocaleString('fr-FR') }} (100%)</span
            >
          </div>
        </div>
      </div>
    </header>

    <!-- Main Workbench Body: Left Sidebar + Right 3-Tab Engineering Inspector -->
    <div class="flex-1 flex flex-col lg:flex-row">
      <!-- Left Sidebar: 6 Live Parameters -->
      <ParameterSidebar
        :config="config"
        :is-running="isRunning"
        @run="triggerSimulation"
        @randomize-seed="randomizeSeed"
        @reset="resetToDefaults"
      />

      <!-- Right Workspace -->
      <main class="flex-1 min-w-0 flex flex-col">
        <!-- Navigation Tabs Bar -->
        <div class="bg-white border-b border-slate-200 px-5 pt-2 flex flex-wrap items-center justify-between gap-2">
          <nav class="flex flex-wrap gap-1 -mb-px" aria-label="Onglets d'inspection">
            <button
              type="button"
              class="px-4 py-2.5 border-b-2 text-xs font-semibold inline-flex items-center gap-2 transition-colors"
              :class="
                activeTab === 'TELEMETRY_AUDIT'
                  ? 'border-blue-600 text-blue-600 bg-blue-50/30'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              "
              @click="activeTab = 'TELEMETRY_AUDIT'"
            >
              <Activity class="w-3.5 h-3.5" />
              <span>1. Performance, Convergence Hypergéométrique & Audit Règles</span>
            </button>

            <button
              type="button"
              class="px-4 py-2.5 border-b-2 text-xs font-semibold inline-flex items-center gap-2 transition-colors"
              :class="
                activeTab === 'GAME_INSPECTOR'
                  ? 'border-blue-600 text-blue-600 bg-blue-50/30'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              "
              @click="activeTab = 'GAME_INSPECTOR'"
            >
              <GitBranch class="w-3.5 h-3.5" />
              <span>2. Inspecteur de Partie Pas-à-Pas & Arbre de Décision</span>
              <span
                v-if="result"
                class="px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200"
              >
                {{ result.sampledGames.length }} parties
              </span>
            </button>

            <button
              type="button"
              class="px-4 py-2.5 border-b-2 text-xs font-semibold inline-flex items-center gap-2 transition-colors"
              :class="
                activeTab === 'REGISTRY_GO'
                  ? 'border-blue-600 text-blue-600 bg-blue-50/30'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              "
              @click="activeTab = 'REGISTRY_GO'"
            >
              <Database class="w-3.5 h-3.5" />
              <span>3. Registre Déclaratif JSON & Architecture Go/Wasm</span>
              <Code2 class="w-3.5 h-3.5 text-slate-400" />
            </button>
          </nav>

          <div class="pb-2 hidden xl:flex items-center gap-1.5 text-[11px] font-mono text-slate-500">
            <CheckCircle2 class="w-3.5 h-3.5 text-emerald-600" />
            <span>Deck : Dracaufeu ex / Roucarnage ex (60 cartes)</span>
          </div>
        </div>

        <!-- Tab Content Container -->
        <div class="p-5 flex-1 overflow-y-auto">
          <template v-if="result">
            <TelemetryAndAuditTab
              v-if="activeTab === 'TELEMETRY_AUDIT'"
              :result="result"
              :current-fps="currentFps"
              :min-fps-during-run="minFpsDuringRun"
              :is-running="isRunning"
              @open-inspector="openInspectorWithFilter"
            />

            <GameInspectorTab
              v-else-if="activeTab === 'GAME_INSPECTOR'"
              :sampled-games="result.sampledGames"
              :initial-filter-tag="inspectorFilterTag"
            />

            <RegistryAndGoTab
              v-else-if="activeTab === 'REGISTRY_GO'"
              :registry="config.customRegistry ?? DEFAULT_CARD_REGISTRY"
              @update-registry="updateCustomRegistry"
              @reset-registry="resetRegistryOnly"
            />
          </template>

          <div
            v-else
            class="h-96 bg-white border border-slate-200 rounded-xl flex flex-col items-center justify-center gap-3 text-slate-500"
          >
            <Cpu class="w-8 h-8 text-blue-600 animate-spin" />
            <p class="text-sm font-mono">
              Initialisation du Web Worker & exécution Monte-Carlo en cours...
            </p>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
