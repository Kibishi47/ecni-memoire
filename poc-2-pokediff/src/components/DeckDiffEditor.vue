<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Layers,
  Search,
  Plus,
  Minus,
  Sparkles,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-vue-next'
import type { Card, CardCategory } from '../types/deck'

const props = defineProps<{
  cards: Card[]
  deckACount: number
  deckBCount: number
}>()

const emit = defineEmits<{
  (e: 'update-card-b', cardId: string, newCount: number): void
  (e: 'add-flex-card', cardId: string): void
}>()

const searchQuery = ref('')
const selectedCategory = ref<CardCategory | 'all' | 'diff'>('all')
const showFlexPool = ref(false)

const categories: { label: string; value: CardCategory | 'all' | 'diff' }[] = [
  { label: 'Toutes les cartes', value: 'all' },
  { label: 'Modifiées (Diff)', value: 'diff' },
  { label: 'Pokémon', value: 'pokemon' },
  { label: 'Supporters', value: 'supporter' },
  { label: 'Objets', value: 'item' },
  { label: 'Outils', value: 'tool' },
  { label: 'Stades', value: 'stadium' },
  { label: 'Énergies', value: 'energy' },
]

// Filter active cards (cards with countA > 0 or countB > 0)
const activeCards = computed(() => {
  return props.cards.filter((card) => {
    // Exclude candidate cards that are at 0 in both decks
    if (card.countA === 0 && card.countB === 0) return false

    // Category filter
    if (selectedCategory.value === 'diff') {
      if (card.countA === card.countB) return false
    } else if (selectedCategory.value !== 'all') {
      if (card.category !== selectedCategory.value) return false
    }

    // Search query
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      const matchName = card.name.toLowerCase().includes(q)
      const matchNameEn = card.nameEn.toLowerCase().includes(q)
      const matchRole = card.roleDescription.toLowerCase().includes(q)
      return matchName || matchNameEn || matchRole
    }

    return true
  })
})

// Flex pool candidates (cards currently 0 in both decks)
const candidateCards = computed(() => {
  return props.cards.filter((c) => c.countA === 0 && c.countB === 0)
})

function getCategoryColor(category: CardCategory) {
  switch (category) {
    case 'pokemon':
      return 'bg-amber-500/10 text-amber-300 border-amber-500/30'
    case 'supporter':
      return 'bg-rose-500/10 text-rose-300 border-rose-500/30'
    case 'item':
      return 'bg-sky-500/10 text-sky-300 border-sky-500/30'
    case 'tool':
      return 'bg-teal-500/10 text-teal-300 border-teal-500/30'
    case 'stadium':
      return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
    case 'energy':
      return 'bg-orange-500/10 text-orange-300 border-orange-500/30'
  }
}

function handleDecrement(card: Card) {
  if (card.countB > card.min) {
    emit('update-card-b', card.id, card.countB - 1)
  }
}

function handleIncrement(card: Card) {
  if (card.countB < card.max) {
    emit('update-card-b', card.id, card.countB + 1)
  }
}
</script>

<template>
  <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur-sm">
    <!-- Header with Search & Filter Tabs -->
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
      <div class="flex items-center space-x-2">
        <Layers class="w-5 h-5 text-indigo-400" />
        <div>
          <h3 class="text-sm font-bold text-slate-100 uppercase tracking-wider">
            Éditeur Différentiel A / B (60 Cartes)
          </h3>
          <p class="text-xs text-slate-400">
            Comparez la <span class="text-sky-400 font-semibold">Variante A (Référence)</span> et ajustez avec [-]/[+] la <span class="text-violet-400 font-semibold">Variante B (Micro-ajustements)</span>.
          </p>
        </div>
      </div>

      <!-- Search & Flex Candidate Toggle -->
      <div class="flex items-center space-x-2">
        <div class="relative w-full sm:w-64">
          <Search class="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Rechercher une carte..."
            class="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <button
          @click="showFlexPool = !showFlexPool"
          type="button"
          class="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition shrink-0"
          :class="
            showFlexPool
              ? 'bg-indigo-900/40 border-indigo-500 text-indigo-300'
              : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:text-white'
          "
        >
          <Sparkles class="w-3.5 h-3.5 text-amber-400" />
          <span>Pool Cartes Tech</span>
          <ChevronUp v-if="showFlexPool" class="w-3.5 h-3.5 ml-1" />
          <ChevronDown v-else class="w-3.5 h-3.5 ml-1" />
        </button>
      </div>
    </div>

    <!-- Category Pills Tabs -->
    <div class="flex items-center space-x-1.5 overflow-x-auto pb-2 scrollbar-none mb-4 text-xs font-medium">
      <button
        v-for="cat in categories"
        :key="cat.value"
        @click="selectedCategory = cat.value"
        type="button"
        class="px-3 py-1.5 rounded-lg border whitespace-nowrap transition"
        :class="
          selectedCategory === cat.value
            ? 'bg-indigo-600 border-indigo-500 text-white font-semibold shadow-md shadow-indigo-600/20'
            : 'bg-slate-800/60 border-slate-700/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
        "
      >
        {{ cat.label }}
      </button>
    </div>

    <!-- Collapsible Flex Pool Drawer -->
    <div
      v-if="showFlexPool && candidateCards.length > 0"
      class="mb-4 p-4 rounded-xl bg-indigo-950/20 border border-indigo-800/40 shadow-inner"
    >
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold text-indigo-300 flex items-center space-x-1.5">
          <Sparkles class="w-4 h-4 text-amber-400" />
          <span>Cartes Candidates Flex Spot (Actuellement à 0)</span>
        </span>
        <span class="text-[11px] text-slate-400">Cliquez sur [+] pour injecter dans la Variante B</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
        <div
          v-for="cand in candidateCards"
          :key="cand.id"
          class="p-2.5 rounded-lg bg-slate-900/80 border border-slate-700 flex items-center justify-between"
        >
          <div class="truncate mr-2">
            <span class="text-xs font-semibold text-slate-200 block truncate">{{ cand.name }}</span>
            <span class="text-[10px] text-slate-400 block truncate">{{ cand.roleDescription }}</span>
          </div>
          <button
            @click="emit('add-flex-card', cand.id)"
            type="button"
            class="px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white font-mono text-xs font-bold transition flex items-center shrink-0 shadow"
            title="Ajouter à la Variante B"
          >
            <Plus class="w-3.5 h-3.5 mr-0.5" />
            +1
          </button>
        </div>
      </div>
    </div>

    <!-- Cards Side-by-Side Table Header -->
    <div class="grid grid-cols-12 gap-2 px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-slate-400 border-b border-slate-800 bg-slate-950/40 rounded-t-xl">
      <div class="col-span-6 sm:col-span-5">Carte & Rôle Compétitif</div>
      <div class="col-span-2 sm:col-span-2 text-center text-sky-400 font-semibold">
        Variante A (Réf.)
      </div>
      <div class="col-span-4 sm:col-span-3 text-center text-violet-400 font-semibold">
        Variante B (Ajustement)
      </div>
      <div class="hidden sm:block sm:col-span-2 text-right">Delta A → B</div>
    </div>

    <!-- Cards List -->
    <div class="divide-y divide-slate-800/60 max-h-[480px] overflow-y-auto pr-1">
      <div
        v-for="card in activeCards"
        :key="card.id"
        class="grid grid-cols-12 gap-2 items-center px-3 py-2.5 transition text-xs"
        :class="
          card.countB !== card.countA
            ? card.countB > card.countA
              ? 'bg-emerald-950/15 hover:bg-emerald-950/25'
              : 'bg-rose-950/15 hover:bg-rose-950/25'
            : 'hover:bg-slate-800/40'
        "
      >
        <!-- Card Name & Description -->
        <div class="col-span-6 sm:col-span-5 flex items-center space-x-2.5 truncate">
          <span class="text-base select-none shrink-0">{{ card.typeIcon }}</span>
          <div class="truncate">
            <div class="flex items-center space-x-1.5 truncate">
              <span class="font-bold text-slate-200 truncate">{{ card.name }}</span>
              <span
                class="text-[9px] font-mono px-1.5 py-0.2 rounded border uppercase shrink-0"
                :class="getCategoryColor(card.category)"
              >
                {{ card.category }}
              </span>
            </div>
            <p class="text-[11px] text-slate-400 truncate font-sans">
              {{ card.roleDescription }}
            </p>
          </div>
        </div>

        <!-- Count A (Reference) -->
        <div class="col-span-2 sm:col-span-2 flex justify-center">
          <span class="px-2.5 py-1 rounded-md bg-sky-950/60 border border-sky-500/40 text-sky-300 font-mono font-bold text-xs">
            {{ card.countA }}
          </span>
        </div>

        <!-- Count B (Interactive Editor) -->
        <div class="col-span-4 sm:col-span-3 flex items-center justify-center space-x-1.5">
          <button
            @click="handleDecrement(card)"
            type="button"
            :disabled="card.countB <= card.min"
            class="w-7 h-7 rounded-md flex items-center justify-center font-bold font-mono transition"
            :class="
              card.countB <= card.min
                ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                : 'bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-200 border border-slate-700 hover:border-rose-600'
            "
            title="Diminuer d'une carte"
          >
            <Minus class="w-3.5 h-3.5" />
          </button>

          <span
            class="w-8 text-center font-mono font-bold text-xs py-1 rounded-md border"
            :class="
              card.countB !== card.countA
                ? card.countB > card.countA
                  ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                  : 'bg-rose-950/80 border-rose-500 text-rose-300'
                : 'bg-violet-950/60 border-violet-500/40 text-violet-300'
            "
          >
            {{ card.countB }}
          </span>

          <button
            @click="handleIncrement(card)"
            type="button"
            :disabled="card.countB >= card.max"
            class="w-7 h-7 rounded-md flex items-center justify-center font-bold font-mono transition"
            :class="
              card.countB >= card.max
                ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                : 'bg-slate-800 hover:bg-emerald-900/60 text-slate-300 hover:text-emerald-200 border border-slate-700 hover:border-emerald-600'
            "
            title="Augmenter d'une carte"
          >
            <Plus class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- Delta Badge -->
        <div class="hidden sm:flex sm:col-span-2 justify-end">
          <span
            v-if="card.countB !== card.countA"
            class="px-2 py-0.5 rounded text-[11px] font-mono font-bold border"
            :class="
              card.countB > card.countA
                ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300'
                : 'bg-rose-950/70 border-rose-500 text-rose-300'
            "
          >
            {{ card.countB > card.countA ? `+${card.countB - card.countA}` : card.countB - card.countA }}
          </span>
          <span v-else class="text-slate-600 font-mono text-[11px]">
            =
          </span>
        </div>
      </div>

      <!-- No match fallback -->
      <div v-if="activeCards.length === 0" class="py-8 text-center text-slate-500 text-xs">
        Aucune carte ne correspond aux critères de filtre.
      </div>
    </div>

    <!-- Quick Footer Bar -->
    <div class="mt-3 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
      <div class="flex items-center space-x-2">
        <Info class="w-4 h-4 text-indigo-400" />
        <span>Règle TCG : 4 exemplaires max par carte (sauf Énergies de base, Radieux et ACE SPEC limités à 1).</span>
      </div>

      <div class="flex items-center space-x-3 font-mono">
        <span class="text-sky-400">Total A : {{ deckACount }}/60</span>
        <span :class="deckBCount === 60 ? 'text-violet-400' : 'text-rose-400 font-bold'">
          Total B : {{ deckBCount }}/60
        </span>
      </div>
    </div>
  </div>
</template>
