<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GameAction } from '../core/engine'
import {
  ArrowUpRight,
  Bot,
  CheckCircle,
  Clock,
  Filter,
  Flame,
  PlusCircle,
  Search,
  Shield,
  Sparkles,
  Swords,
  X,
  Zap,
} from 'lucide-vue-next'

const props = defineProps<{
  actions: GameAction[]
  activePlayerIndex: 0 | 1
  selectedCardId?: string | null
  selectedCardName?: string | null
  recommendedActionIndex?: number | null
  isAiThinking?: boolean
}>()

const emit = defineEmits<{
  (e: 'execute-action', action: GameAction): void
  (e: 'clear-card-filter'): void
  (e: 'execute-ai-move'): void
  (e: 'execute-ai-turn'): void
}>()

const activeCategory = ref<'ALL' | 'ATTACK' | 'TRAINER' | 'ABILITY' | 'BENCH_EVO' | 'ENERGY_RETREAT'>('ALL')
const searchActionQuery = ref('')

// Filtrage par carte sélectionnée + catégorie + recherche texte
const filteredActions = computed(() => {
  let list = props.actions

  // Filtre par carte sélectionnée sur le board ou dans la main
  if (props.selectedCardId) {
    list = list.filter((act) => {
      if (act.cardId === props.selectedCardId) return true
      if (act.targetCardIds?.includes(props.selectedCardId!)) return true
      return false
    })
  }

  // Filtre par onglet
  if (activeCategory.value === 'ATTACK') {
    list = list.filter((a) => a.type === 'DECLARE_ATTACK' || a.type === 'PASS_TURN')
  } else if (activeCategory.value === 'TRAINER') {
    list = list.filter((a) => a.type === 'PLAY_TRAINER')
  } else if (activeCategory.value === 'ABILITY') {
    list = list.filter((a) => a.type === 'USE_ABILITY')
  } else if (activeCategory.value === 'BENCH_EVO') {
    list = list.filter((a) => a.type === 'PUT_BASIC_ON_BENCH' || a.type === 'NORMAL_EVOLVE')
  } else if (activeCategory.value === 'ENERGY_RETREAT') {
    list = list.filter((a) => a.type === 'ATTACH_MANUAL_ENERGY' || a.type === 'RETREAT_ACTIVE')
  }

  // Recherche textuelle
  if (searchActionQuery.value.trim()) {
    const q = searchActionQuery.value.toLowerCase()
    list = list.filter((a) => a.label.toLowerCase().includes(q))
  }

  return list
})

// Compteurs par catégorie
const counts = computed(() => {
  const acts = props.actions
  return {
    all: acts.length,
    attack: acts.filter((a) => a.type === 'DECLARE_ATTACK' || a.type === 'PASS_TURN').length,
    trainer: acts.filter((a) => a.type === 'PLAY_TRAINER').length,
    ability: acts.filter((a) => a.type === 'USE_ABILITY').length,
    benchEvo: acts.filter((a) => a.type === 'PUT_BASIC_ON_BENCH' || a.type === 'NORMAL_EVOLVE').length,
    energyRetreat: acts.filter((a) => a.type === 'ATTACH_MANUAL_ENERGY' || a.type === 'RETREAT_ACTIVE').length,
  }
})

function getActionBadgeStyle(type: GameAction['type']) {
  switch (type) {
    case 'DECLARE_ATTACK':
      return {
        border: 'border-red-300 hover:border-red-500 bg-red-50/50 hover:bg-red-50',
        badgeBg: 'bg-red-600',
        badgeText: 'text-white',
        label: 'Attaque',
        icon: Swords,
      }
    case 'USE_ABILITY':
      return {
        border: 'border-purple-300 hover:border-purple-500 bg-purple-50/50 hover:bg-purple-50',
        badgeBg: 'bg-purple-700',
        badgeText: 'text-white',
        label: 'Talent',
        icon: Sparkles,
      }
    case 'PLAY_TRAINER':
      return {
        border: 'border-blue-300 hover:border-blue-500 bg-blue-50/50 hover:bg-blue-50',
        badgeBg: 'bg-blue-600',
        badgeText: 'text-white',
        label: 'Dresseur',
        icon: Flame,
      }
    case 'ATTACH_MANUAL_ENERGY':
      return {
        border: 'border-amber-300 hover:border-amber-500 bg-amber-50/50 hover:bg-amber-50',
        badgeBg: 'bg-amber-600',
        badgeText: 'text-white',
        label: 'Énergie',
        icon: Zap,
      }
    case 'NORMAL_EVOLVE':
      return {
        border: 'border-indigo-300 hover:border-indigo-500 bg-indigo-50/50 hover:bg-indigo-50',
        badgeBg: 'bg-indigo-700',
        badgeText: 'text-white',
        label: 'Évolution',
        icon: ArrowUpRight,
      }
    case 'PUT_BASIC_ON_BENCH':
      return {
        border: 'border-emerald-300 hover:border-emerald-500 bg-emerald-50/50 hover:bg-emerald-50',
        badgeBg: 'bg-emerald-600',
        badgeText: 'text-white',
        label: 'Banc',
        icon: PlusCircle,
      }
    case 'RETREAT_ACTIVE':
      return {
        border: 'border-sky-300 hover:border-sky-500 bg-sky-50/50 hover:bg-sky-50',
        badgeBg: 'bg-sky-700',
        badgeText: 'text-white',
        label: 'Retraite',
        icon: Shield,
      }
    case 'PASS_TURN':
      return {
        border: 'border-slate-300 hover:border-slate-500 bg-slate-50 hover:bg-slate-100',
        badgeBg: 'bg-slate-700',
        badgeText: 'text-white',
        label: 'Fin de tour',
        icon: Clock,
      }
    default:
      return {
        border: 'border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50',
        badgeBg: 'bg-slate-800',
        badgeText: 'text-white',
        label: 'Action',
        icon: CheckCircle,
      }
  }
}
</script>

<template>
  <aside class="flex h-full w-full flex-col border-l border-slate-200 bg-white">
    <!-- En-tête : Actions Possibles & Contrôles IA -->
    <div class="border-b border-slate-200 p-3">
      <div class="flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xs font-bold uppercase tracking-wider text-slate-900">
              Actions Légales
            </h2>
            <span
              class="rounded-full bg-slate-900 px-2 py-0.5 font-mono text-[11px] font-bold text-white shadow-2xs"
            >
              {{ actions.length }}
            </span>
          </div>
          <div class="mt-0.5 text-[11px] font-medium" :class="activePlayerIndex === 0 ? 'text-blue-600' : 'text-purple-600'">
            {{ activePlayerIndex === 0 ? '🎯 Votre tour (Joueur 1)' : '⏳ Tour de l\'Adversaire' }}
          </div>
        </div>

        <!-- Bouton Coup IA -->
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            @click="emit('execute-ai-move')"
            :disabled="actions.length === 0 || isAiThinking"
            class="flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-1 text-[11px] font-semibold text-purple-800 shadow-2xs hover:bg-purple-100 disabled:opacity-50"
            title="Laisse l'évaluateur IA choisir et exécuter la meilleure action"
          >
            <Bot class="h-3.5 w-3.5 text-purple-700" />
            <span>Coup IA</span>
          </button>
        </div>
      </div>

      <!-- Filtre actif par carte sélectionnée -->
      <div
        v-if="selectedCardId"
        class="mt-2.5 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50/80 px-2.5 py-1 text-xs text-blue-900"
      >
        <div class="flex items-center gap-1.5 truncate">
          <Filter class="h-3 w-3 shrink-0 text-blue-600" />
          <span class="truncate font-semibold">{{ selectedCardName || selectedCardId }}</span>
        </div>
        <button
          type="button"
          @click="emit('clear-card-filter')"
          class="flex items-center gap-0.5 text-[11px] font-medium text-blue-700 hover:text-blue-900"
          title="Afficher toutes les cartes"
        >
          <X class="h-3 w-3" />
          <span>Effacer</span>
        </button>
      </div>

      <!-- Barre de recherche rapide d'action -->
      <div class="relative mt-2">
        <Search class="absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
        <input
          v-model="searchActionQuery"
          type="text"
          placeholder="Rechercher une action..."
          class="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-2.5 pl-8 text-xs text-slate-800 placeholder-slate-400 focus:border-slate-900 focus:bg-white focus:outline-hidden"
        />
      </div>

      <!-- Onglets Catégories d'Actions -->
      <div class="mt-2.5 flex flex-wrap items-center gap-1">
        <button
          type="button"
          @click="activeCategory = 'ALL'"
          class="rounded px-2 py-0.5 text-[10px] font-semibold transition-all"
          :class="activeCategory === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
        >
          Toutes ({{ counts.all }})
        </button>
        <button
          type="button"
          @click="activeCategory = 'ATTACK'"
          class="rounded px-2 py-0.5 text-[10px] font-semibold transition-all"
          :class="activeCategory === 'ATTACK' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'"
        >
          Attaques ({{ counts.attack }})
        </button>
        <button
          type="button"
          @click="activeCategory = 'TRAINER'"
          class="rounded px-2 py-0.5 text-[10px] font-semibold transition-all"
          :class="activeCategory === 'TRAINER' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'"
        >
          Dresseurs ({{ counts.trainer }})
        </button>
        <button
          type="button"
          @click="activeCategory = 'ABILITY'"
          class="rounded px-2 py-0.5 text-[10px] font-semibold transition-all"
          :class="activeCategory === 'ABILITY' ? 'bg-purple-700 text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'"
        >
          Talents ({{ counts.ability }})
        </button>
        <button
          type="button"
          @click="activeCategory = 'BENCH_EVO'"
          class="rounded px-2 py-0.5 text-[10px] font-semibold transition-all"
          :class="activeCategory === 'BENCH_EVO' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'"
        >
          Banc / Évo ({{ counts.benchEvo }})
        </button>
        <button
          type="button"
          @click="activeCategory = 'ENERGY_RETREAT'"
          class="rounded px-2 py-0.5 text-[10px] font-semibold transition-all"
          :class="activeCategory === 'ENERGY_RETREAT' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'"
        >
          Énergies ({{ counts.energyRetreat }})
        </button>
      </div>
    </div>

    <!-- Liste Scrollable des Actions Légales -->
    <div class="flex-1 space-y-2 overflow-y-auto p-3">
      <div
        v-if="filteredActions.length === 0"
        class="flex flex-col items-center justify-center py-12 text-center text-slate-400"
      >
        <CheckCircle class="h-8 w-8 text-slate-300" />
        <span class="mt-2 text-xs font-medium">Aucune action légale dans cette vue</span>
        <button
          v-if="selectedCardId"
          type="button"
          @click="emit('clear-card-filter')"
          class="mt-2 text-xs font-semibold text-blue-600 hover:underline"
        >
          Afficher toutes les actions
        </button>
      </div>

      <!-- Bouton d'Action Individuel -->
      <button
        v-for="(action, idx) in filteredActions"
        :key="idx"
        type="button"
        @click="emit('execute-action', action)"
        class="group relative flex w-full flex-col rounded-xl border p-2.5 text-left transition-all hover:scale-[1.01] hover:shadow-xs active:scale-[0.99]"
        :class="getActionBadgeStyle(action.type).border"
      >
        <!-- En-tête de l'Action : Badge Type + Estimation Dégâts -->
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5">
            <span
              class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase shadow-2xs"
              :class="[
                getActionBadgeStyle(action.type).badgeBg,
                getActionBadgeStyle(action.type).badgeText,
              ]"
            >
              <component
                :is="getActionBadgeStyle(action.type).icon"
                class="h-3 w-3"
              />
              <span>{{ getActionBadgeStyle(action.type).label }}</span>
            </span>

            <span
              v-if="action.endsTurnImmediately"
              class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-slate-600"
            >
              Fin de tour
            </span>
          </div>

          <!-- Dégâts de l'Attaque -->
          <span
            v-if="action.estimatedDamage !== undefined && action.estimatedDamage > 0"
            class="flex items-center gap-0.5 font-mono text-xs font-bold text-red-600"
          >
            💥 {{ action.estimatedDamage }}
          </span>
        </div>

        <!-- Intitulé / Label de l'Action -->
        <div class="mt-1.5 text-xs font-semibold text-slate-900 group-hover:text-blue-600">
          {{ action.label }}
        </div>

        <!-- Cibles / Détails complémentaires -->
        <div
          v-if="action.targetCardIds && action.targetCardIds.length > 0"
          class="mt-1 font-mono text-[10px] text-slate-500"
        >
          Cible(s) : {{ action.targetCardIds.join(', ') }}
        </div>
      </button>
    </div>

    <!-- Pied de Panneau : Bouton Tour IA Complet -->
    <div class="border-t border-slate-200 bg-slate-50 p-2.5">
      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          @click="emit('execute-ai-turn')"
          :disabled="actions.length === 0 || isAiThinking"
          class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-purple-300 bg-purple-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-purple-700 disabled:opacity-50"
          title="Fait jouer l'intégralité du tour par l'intelligence artificielle"
        >
          <Bot class="h-3.5 w-3.5" />
          <span>Tour IA Complet</span>
        </button>
      </div>
    </div>
  </aside>
</template>
