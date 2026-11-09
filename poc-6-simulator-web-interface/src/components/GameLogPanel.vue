<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { MatchWinner, WinReason } from '../core/engine'
import {
  Check,
  Clock,
  Copy,
  Flame,
  Search,
  Shield,
  Sparkles,
  Swords,
  Trash2,
  Trophy,
  Zap,
} from 'lucide-vue-next'

export interface GameLogEntry {
  id: string
  stepNumber: number
  turnNumber: number
  actingPlayer: 'PLAYER' | 'OPPONENT'
  type:
    | 'SYSTEM'
    | 'DRAW'
    | 'BENCH'
    | 'EVOLVE'
    | 'ENERGY'
    | 'TRAINER'
    | 'ABILITY'
    | 'ATTACK'
    | 'RETREAT'
    | 'PASS'
    | 'KO'
    | 'PRIZE'
    | 'CHECKUP'
    | 'WIN'
  message: string
  damage?: number
  timestamp: string
}

const props = defineProps<{
  logs: GameLogEntry[]
  currentTurn: number
  activePlayerIndex: 0 | 1
  winner: MatchWinner
  winReason: WinReason
}>()

const emit = defineEmits<{
  (e: 'clear'): void
}>()

const searchQuery = ref('')
const selectedFilter = ref<'ALL' | 'ATTACK' | 'TRAINER' | 'KO_PRIZE' | 'DRAW'>('ALL')
const autoScroll = ref(true)
const scrollContainer = ref<HTMLElement | null>(null)
const copied = ref(false)

const filteredLogs = computed(() => {
  let list = props.logs

  if (selectedFilter.value === 'ATTACK') {
    list = list.filter((l) => l.type === 'ATTACK')
  } else if (selectedFilter.value === 'TRAINER') {
    list = list.filter((l) => l.type === 'TRAINER' || l.type === 'ABILITY')
  } else if (selectedFilter.value === 'KO_PRIZE') {
    list = list.filter((l) => l.type === 'KO' || l.type === 'PRIZE' || l.type === 'WIN')
  } else if (selectedFilter.value === 'DRAW') {
    list = list.filter((l) => l.type === 'DRAW')
  }

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter((l) => l.message.toLowerCase().includes(q))
  }

  return list
})

function scrollToBottom() {
  if (!scrollContainer.value) return
  scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
}

watch(
  () => props.logs.length,
  async () => {
    if (autoScroll.value) {
      await nextTick()
      scrollToBottom()
    }
  },
)

async function copyAllLogs() {
  const text = props.logs
    .map(
      (l) =>
        `[#${l.stepNumber} - Tour ${l.turnNumber} - ${l.actingPlayer === 'PLAYER' ? 'Joueur 1' : 'Adversaire'}] ${l.message}`,
    )
    .join('\n')
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch (e) {
    console.error('Erreur lors de la copie des logs :', e)
  }
}

function getLogIcon(type: GameLogEntry['type']) {
  switch (type) {
    case 'ATTACK':
      return Swords
    case 'ABILITY':
      return Sparkles
    case 'ENERGY':
      return Zap
    case 'TRAINER':
      return Flame
    case 'KO':
    case 'PRIZE':
    case 'WIN':
      return Trophy
    case 'BENCH':
    case 'EVOLVE':
    case 'RETREAT':
      return Shield
    default:
      return Clock
  }
}

function getLogStyle(type: GameLogEntry['type']) {
  switch (type) {
    case 'ATTACK':
      return 'border-red-200 bg-red-50/80 text-red-900'
    case 'ABILITY':
      return 'border-purple-200 bg-purple-50/80 text-purple-900'
    case 'ENERGY':
      return 'border-amber-200 bg-amber-50/80 text-amber-900'
    case 'TRAINER':
      return 'border-blue-200 bg-blue-50/80 text-blue-900'
    case 'KO':
    case 'PRIZE':
      return 'border-rose-300 bg-rose-100 text-rose-950 font-semibold'
    case 'WIN':
      return 'border-emerald-300 bg-emerald-100 text-emerald-950 font-bold'
    case 'DRAW':
      return 'border-slate-200 bg-slate-50 text-slate-700'
    default:
      return 'border-slate-200 bg-white text-slate-800'
  }
}
</script>

<template>
  <aside class="flex h-full w-full flex-col border-r border-slate-200 bg-white">
    <!-- En-tête du Panneau de Logs -->
    <div class="border-b border-slate-200 p-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-white shadow-2xs">
            <Clock class="h-3.5 w-3.5" />
          </div>
          <div>
            <h2 class="text-xs font-bold uppercase tracking-wider text-slate-900">
              Journal de Combat
            </h2>
            <div class="font-mono text-[11px] text-slate-500">
              Tour {{ currentTurn }} · {{ logs.length }} action(s)
            </div>
          </div>
        </div>

        <!-- Actions : Copier & Vider -->
        <div class="flex items-center gap-1">
          <button
            type="button"
            @click="copyAllLogs"
            class="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-2xs hover:bg-slate-50"
            :title="copied ? 'Copié dans le presse-papier !' : 'Copier tous les logs'"
          >
            <Check v-if="copied" class="h-3 w-3 text-emerald-600" />
            <Copy v-else class="h-3 w-3 text-slate-500" />
            <span class="hidden sm:inline">{{ copied ? 'Copié' : 'Copier' }}</span>
          </button>

          <button
            type="button"
            @click="emit('clear')"
            class="flex items-center rounded-md border border-slate-200 bg-white p-1 text-slate-500 shadow-2xs hover:bg-red-50 hover:text-red-700"
            title="Vider le journal de logs"
          >
            <Trash2 class="h-3 w-3" />
          </button>
        </div>
      </div>

      <!-- Barre de recherche rapide -->
      <div class="relative mt-2.5">
        <Search class="absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Filtrer les actions, cartes..."
          class="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-2.5 pl-8 text-xs text-slate-800 placeholder-slate-400 focus:border-slate-900 focus:bg-white focus:outline-hidden"
        />
      </div>

      <!-- Filtres par catégorie -->
      <div class="mt-2 flex flex-wrap items-center gap-1">
        <button
          type="button"
          @click="selectedFilter = 'ALL'"
          class="rounded px-2 py-0.5 text-[10px] font-semibold transition-all"
          :class="selectedFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
        >
          Tous ({{ logs.length }})
        </button>
        <button
          type="button"
          @click="selectedFilter = 'ATTACK'"
          class="rounded px-2 py-0.5 text-[10px] font-semibold transition-all"
          :class="selectedFilter === 'ATTACK' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'"
        >
          Attaques
        </button>
        <button
          type="button"
          @click="selectedFilter = 'TRAINER'"
          class="rounded px-2 py-0.5 text-[10px] font-semibold transition-all"
          :class="selectedFilter === 'TRAINER' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'"
        >
          Dresseurs
        </button>
        <button
          type="button"
          @click="selectedFilter = 'KO_PRIZE'"
          class="rounded px-2 py-0.5 text-[10px] font-semibold transition-all"
          :class="selectedFilter === 'KO_PRIZE' ? 'bg-rose-700 text-white' : 'bg-rose-50 text-rose-800 hover:bg-rose-100'"
        >
          K.O. &amp; Prix
        </button>
      </div>
    </div>

    <!-- Flux Scrollable des Logs -->
    <div
      ref="scrollContainer"
      class="flex-1 space-y-2 overflow-y-auto p-3 text-xs"
    >
      <div
        v-if="filteredLogs.length === 0"
        class="flex flex-col items-center justify-center py-12 text-center text-slate-400"
      >
        <Clock class="h-8 w-8 text-slate-300" />
        <span class="mt-2 font-medium">Aucun log à afficher</span>
      </div>

      <template v-for="(log, idx) in filteredLogs" :key="log.id">
        <!-- Séparateur de début de tour -->
        <div
          v-if="idx === 0 || log.turnNumber !== filteredLogs[idx - 1]?.turnNumber"
          class="my-2 flex items-center gap-2 border-y border-slate-200 bg-slate-100/90 px-2 py-1 font-mono text-[10px] font-bold text-slate-700 uppercase"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-slate-900"></span>
          <span>Tour {{ log.turnNumber }}</span>
          <span class="font-normal text-slate-500">
            ({{ log.actingPlayer === 'PLAYER' ? 'Joueur 1' : 'Adversaire' }})
          </span>
        </div>

        <!-- Carte de Log Unitaire -->
        <div
          class="flex items-start gap-2 rounded-lg border p-2 text-[11px] leading-relaxed shadow-2xs transition-all"
          :class="getLogStyle(log.type)"
        >
          <component
            :is="getLogIcon(log.type)"
            class="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80"
          />

          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-1 text-[10px] opacity-75">
              <span class="font-mono font-bold">
                #{{ log.stepNumber }} · {{ log.actingPlayer === 'PLAYER' ? 'Moi' : 'Adversaire' }}
              </span>
              <span class="font-mono text-[9px]">{{ log.timestamp }}</span>
            </div>
            <div class="mt-0.5 break-words">
              {{ log.message }}
            </div>
            <div
              v-if="log.damage"
              class="mt-1 inline-flex items-center gap-1 rounded bg-red-600/10 px-1.5 py-0.2 font-mono text-[10px] font-bold text-red-700"
            >
              <span>💥 {{ log.damage }} dégâts infligés</span>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Pied de Panneau : Défilement automatique -->
    <div class="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
      <label class="flex items-center gap-1.5 cursor-pointer select-none">
        <input
          v-model="autoScroll"
          type="checkbox"
          class="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
        />
        <span>Défilement auto</span>
      </label>
      <button
        type="button"
        @click="scrollToBottom"
        class="font-medium text-slate-700 hover:text-slate-900"
      >
        Aller en bas ↓
      </button>
    </div>
  </aside>
</template>
