<script setup lang="ts">
import { ref, computed } from 'vue'
import type { CardItem, CardRole } from '../types/pokemon-tcg'
import { CARD_ROLES } from '../data/roles'
import { 
  Shield, 
  Zap, 
  Search, 
  Sparkles, 
  UserCheck, 
  Flame, 
  Layers
} from 'lucide-vue-next'

const props = defineProps<{
  cards: CardItem[]
  deckName: string
}>()

const selectedFilter = ref<CardRole | 'all'>('all')
const searchQuery = ref('')

const roleOrder: CardRole[] = [
  'basic_pokemon',
  'evolution_pokemon',
  'search_engine',
  'accelerator_item',
  'supporter',
  'energy'
]

const getRoleIcon = (role: CardRole) => {
  switch (role) {
    case 'basic_pokemon': return Shield
    case 'evolution_pokemon': return Zap
    case 'search_engine': return Search
    case 'accelerator_item': return Sparkles
    case 'supporter': return UserCheck
    case 'energy': return Flame
  }
}

const totalCardCount = computed(() => {
  return props.cards.reduce((sum, c) => sum + c.count, 0)
})

const cardsByRole = computed(() => {
  const map: Record<CardRole, CardItem[]> = {
    basic_pokemon: [],
    evolution_pokemon: [],
    search_engine: [],
    accelerator_item: [],
    supporter: [],
    energy: []
  }

  for (const card of props.cards) {
    if (map[card.role]) {
      // Filter by search query
      if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase()
        const matchesName = card.frenchName.toLowerCase().includes(query) || card.name.toLowerCase().includes(query)
        const matchesSet = (card.set + ' ' + card.setNumber).toLowerCase().includes(query)
        if (!matchesName && !matchesSet) continue
      }
      map[card.role].push(card)
    }
  }

  return map
})

const roleTotals = computed(() => {
  const counts: Record<CardRole, number> = {
    basic_pokemon: 0,
    evolution_pokemon: 0,
    search_engine: 0,
    accelerator_item: 0,
    supporter: 0,
    energy: 0
  }

  for (const card of props.cards) {
    if (counts[card.role] !== undefined) {
      counts[card.role] += card.count
    }
  }
  return counts
})

const getRolePercentage = (role: CardRole) => {
  if (totalCardCount.value === 0) return 0
  return ((roleTotals.value[role] / totalCardCount.value) * 100).toFixed(0)
}
</script>

<template>
  <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-5">
    <!-- Header with deck title, total count & search -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-2">
          <span class="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Layers class="w-4 h-4" />
          </span>
          <h2 class="text-lg font-bold text-slate-100 tracking-tight">
            Taxonomie Automatique — <span class="text-indigo-400 font-extrabold">{{ deckName }}</span>
          </h2>
          <span 
            :class="[
              'ml-2 font-mono text-xs font-bold px-2.5 py-0.5 rounded-full border',
              totalCardCount === 60
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
            ]"
          >
            {{ totalCardCount }} / 60 cartes
          </span>
        </div>
        <p class="text-xs text-slate-400 mt-1">
          Classification temps réel par rôle tactique pour évaluer l'équilibre du deck sous pression.
        </p>
      </div>

      <!-- Search input -->
      <div class="relative w-full md:w-64">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Rechercher une carte..."
          class="w-full text-xs pl-8 pr-3 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
        />
        <Search class="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
      </div>
    </div>

    <!-- Visual Role Distribution Bar -->
    <div class="space-y-1.5">
      <div class="h-2.5 w-full bg-slate-950 rounded-full overflow-hidden flex p-0.5 border border-slate-800/80">
        <div 
          v-for="role in roleOrder" 
          :key="role"
          :style="{ width: `${(roleTotals[role] / (totalCardCount || 1)) * 100}%` }"
          :class="[
            'h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full',
            role === 'basic_pokemon' ? 'bg-emerald-500' :
            role === 'evolution_pokemon' ? 'bg-purple-500' :
            role === 'search_engine' ? 'bg-cyan-500' :
            role === 'accelerator_item' ? 'bg-amber-500' :
            role === 'supporter' ? 'bg-pink-500' : 'bg-yellow-500'
          ]"
          :title="`${CARD_ROLES[role].label} : ${roleTotals[role]} cartes (${getRolePercentage(role)}%)`"
        />
      </div>

      <!-- Legend & Filter chips -->
      <div class="flex flex-wrap items-center gap-1.5 pt-1">
        <button
          type="button"
          @click="selectedFilter = 'all'"
          :class="[
            'text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-all',
            selectedFilter === 'all'
              ? 'bg-slate-700 text-white border-slate-600 shadow-sm'
              : 'bg-slate-950/50 text-slate-400 hover:text-slate-200 border-slate-800'
          ]"
        >
          Toutes ({{ totalCardCount }})
        </button>

        <button
          v-for="role in roleOrder"
          :key="role"
          type="button"
          @click="selectedFilter = role"
          :class="[
            'text-[11px] font-medium px-2 py-1 rounded-lg border transition-all flex items-center gap-1.5',
            selectedFilter === role
              ? 'bg-slate-800 text-white ' + CARD_ROLES[role].borderColor + ' ' + CARD_ROLES[role].badgeBg
              : 'bg-slate-950/50 text-slate-400 hover:text-slate-200 border-slate-800'
          ]"
        >
          <span 
            class="w-2 h-2 rounded-full"
            :style="{ backgroundColor: CARD_ROLES[role].color }"
          />
          <span>{{ CARD_ROLES[role].shortLabel }}</span>
          <span class="font-mono text-[10px] text-slate-400 font-semibold">({{ roleTotals[role] }})</span>
        </button>
      </div>
    </div>

    <!-- Taxonomy Categories Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <template v-for="role in roleOrder" :key="role">
        <div 
          v-if="selectedFilter === 'all' || selectedFilter === role"
          :class="[
            'rounded-xl border p-3.5 space-y-3 bg-slate-950/40 transition-all flex flex-col justify-between',
            CARD_ROLES[role].borderColor
          ]"
        >
          <!-- Category Header -->
          <div class="flex items-center justify-between pb-2 border-b border-slate-800/80">
            <div class="flex items-center gap-2">
              <span 
                :class="[
                  'p-1.5 rounded-lg border',
                  CARD_ROLES[role].badgeBg,
                  CARD_ROLES[role].badgeText,
                  CARD_ROLES[role].borderColor
                ]"
              >
                <component :is="getRoleIcon(role)" class="w-3.5 h-3.5" />
              </span>
              <div>
                <h3 class="text-xs font-bold text-slate-200">
                  {{ CARD_ROLES[role].label }}
                </h3>
                <p class="text-[10px] text-slate-500 line-clamp-1">
                  {{ CARD_ROLES[role].description }}
                </p>
              </div>
            </div>

            <!-- Role Count Badge -->
            <span 
              :class="[
                'font-mono font-bold text-xs px-2 py-0.5 rounded-md border',
                CARD_ROLES[role].badgeBg,
                CARD_ROLES[role].badgeText,
                CARD_ROLES[role].borderColor
              ]"
            >
              {{ roleTotals[role] }}
            </span>
          </div>

          <!-- Cards List -->
          <div class="space-y-1.5 flex-1 max-h-72 overflow-y-auto pr-1">
            <div
              v-for="card in cardsByRole[role]"
              :key="card.id"
              class="group flex items-center justify-between p-2 rounded-lg bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800/80 hover:border-slate-700 transition-all"
            >
              <!-- Card info & count -->
              <div class="flex items-center gap-2.5 min-w-0">
                <span class="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-slate-950 text-indigo-400 border border-slate-800 shrink-0">
                  {{ card.count }}×
                </span>

                <div class="min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-xs font-semibold text-slate-200 group-hover:text-white truncate">
                      {{ card.frenchName || card.name }}
                    </span>

                    <!-- Special rarity/type badges -->
                    <span 
                      v-if="card.isAceSpec"
                      class="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-pink-500/20 text-pink-400 border border-pink-500/40"
                    >
                      ACE SPEC
                    </span>
                    <span 
                      v-else-if="card.isRadiant"
                      class="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40"
                    >
                      Radieux
                    </span>
                    <span 
                      v-else-if="card.isEx"
                      class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/40"
                    >
                      ex
                    </span>
                    <span 
                      v-else-if="card.isV"
                      class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-400 border border-purple-500/40"
                    >
                      V
                    </span>
                  </div>

                  <!-- Subtitle / Set info -->
                  <div class="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                    <span class="font-mono">{{ card.set }} {{ card.setNumber }}</span>
                    <span v-if="card.hp" class="text-slate-400 font-mono">{{ card.hp }} PV</span>
                    <span v-if="card.tag" class="text-indigo-400/80 font-medium">• {{ card.tag }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Empty state for this category -->
            <div 
              v-if="cardsByRole[role].length === 0"
              class="py-4 text-center text-slate-600 text-xs italic"
            >
              Aucune carte trouvée
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
