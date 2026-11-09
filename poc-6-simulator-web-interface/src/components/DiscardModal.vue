<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EngineCardModel } from '../types/cardModel'
import CardItem from './CardItem.vue'
import { Layers, Search, Trash2, X } from 'lucide-vue-next'

const props = defineProps<{
  title: string
  cards: EngineCardModel[]
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'inspect-card', card: EngineCardModel): void
}>()

const searchQuery = ref('')

const groupedCards = computed(() => {
  const map = new Map<string, { card: EngineCardModel; count: number }>()
  for (const c of props.cards) {
    const existing = map.get(c.cardId)
    if (existing) {
      existing.count++
    } else {
      map.set(c.cardId, { card: c, count: 1 })
    }
  }

  let list = Array.from(map.values())
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter((item) => item.card.identity.nameFr.toLowerCase().includes(q))
  }

  return list
})
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs select-none"
    @click.self="emit('close')"
  >
    <div class="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <!-- En-tête -->
      <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div class="flex items-center gap-2">
          <Trash2 class="h-4 w-4 text-slate-700" />
          <h3 class="text-sm font-bold text-slate-900">
            {{ title }} ({{ cards.length }} carte(s))
          </h3>
        </div>
        <button
          type="button"
          @click="emit('close')"
          class="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X class="h-5 w-5" />
        </button>
      </div>

      <!-- Recherche -->
      <div class="border-b border-slate-100 p-3">
        <div class="relative">
          <Search class="absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Filtrer les cartes..."
            class="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pr-2.5 pl-8 text-xs text-slate-800 focus:border-slate-900 focus:bg-white focus:outline-hidden"
          />
        </div>
      </div>

      <!-- Grille des Cartes -->
      <div class="flex-1 overflow-y-auto p-4">
        <div
          v-if="groupedCards.length === 0"
          class="flex flex-col items-center justify-center py-12 text-slate-400"
        >
          <Layers class="h-8 w-8 text-slate-300" />
          <span class="mt-2 text-xs">Aucune carte dans cette zone</span>
        </div>

        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5">
          <div
            v-for="item in groupedCards"
            :key="item.card.cardId"
            class="relative flex flex-col items-center"
          >
            <!-- Badge Quantité -->
            <span
              v-if="item.count > 1"
              class="absolute -top-1.5 -right-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 font-mono text-[10px] font-bold text-white shadow-xs"
            >
              ×{{ item.count }}
            </span>
            <CardItem
              :card="item.card"
              size="sm"
              @inspect="emit('inspect-card', item.card)"
              @click="emit('inspect-card', item.card)"
            />
          </div>
        </div>
      </div>

      <!-- Pied -->
      <div class="border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-right">
        <button
          type="button"
          @click="emit('close')"
          class="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-slate-800"
        >
          Fermer
        </button>
      </div>
    </div>
  </div>
</template>
