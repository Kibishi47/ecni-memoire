<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Minus,
  Plus,
  Trash2,
  PlusCircle,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-vue-next'
import type { CardCategory, ParsedCard } from '../types/deck'
import { resolveParsedCard } from '../utils/id-resolver'

const props = defineProps<{
  cards: ParsedCard[]
  totalCards: number
}>()

const emit = defineEmits<{
  (e: 'update-quantity', uid: string, newQuantity: number): void
  (e: 'remove-card', uid: string): void
  (e: 'add-card', card: ParsedCard): void
  (e: 'sync-to-input'): void
}>()

const categoryFilter = ref<'all' | CardCategory>('all')
const searchQuery = ref('')
const syncedFeedback = ref(false)

// Formulaire d'ajout rapide d'une carte
const newQty = ref(1)
const newName = ref('')
const newSetCode = ref('SVI')
const newNumber = ref('166')
const newCategory = ref<CardCategory>('trainer')

const filteredCards = computed(() => {
  return props.cards.filter((c) => {
    if (c.quantity <= 0) return false
    if (categoryFilter.value !== 'all' && c.category !== categoryFilter.value) {
      return false
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      return (
        c.nameFr.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.cardId.toLowerCase().includes(q) ||
        c.setCode.toLowerCase().includes(q)
      )
    }
    return true
  })
})

function maxAllowedForCard(card: ParsedCard): number {
  if (card.isAceSpec || card.isRadiant) return 1
  if (card.category === 'energy' && card.subCategory === 'BASIC_ENERGY') return 59
  return 4
}

function handleIncrement(card: ParsedCard) {
  const max = maxAllowedForCard(card)
  if (card.quantity < max) {
    emit('update-quantity', card.uid, card.quantity + 1)
  }
}

function handleDecrement(card: ParsedCard) {
  if (card.quantity > 1) {
    emit('update-quantity', card.uid, card.quantity - 1)
  } else {
    emit('remove-card', card.uid)
  }
}

function handleDirectInput(card: ParsedCard, rawVal: string) {
  const parsed = parseInt(rawVal, 10)
  if (isNaN(parsed) || parsed <= 0) {
    emit('remove-card', card.uid)
    return
  }
  const max = maxAllowedForCard(card)
  emit('update-quantity', card.uid, Math.min(max, parsed))
}

function handleAddCard() {
  if (!newName.value.trim()) return
  const card = resolveParsedCard({
    quantity: Math.max(1, newQty.value),
    rawName: newName.value.trim(),
    setCode: newSetCode.value.trim().toUpperCase() || 'SVI',
    number: newNumber.value.trim() || '1',
    categoryHint: newCategory.value,
    line: Date.now(),
    rawLine: `${newQty.value} ${newName.value.trim()} ${newSetCode.value.trim().toUpperCase()} ${newNumber.value.trim()}`,
  })
  emit('add-card', card)
  newName.value = ''
}

function triggerSyncToInput() {
  emit('sync-to-input')
  syncedFeedback.value = true
  setTimeout(() => {
    syncedFeedback.value = false
  }, 2000)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- En-tête de l'éditeur de ratios -->
    <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-bold text-slate-900">
            Éditeur de Ratios & Quantités
          </h3>
          <p class="text-xs text-slate-500">
            Ajustez le nombre d'exemplaires de chaque carte (règle des 4 copies max, 1 pour ACE SPEC / Radieux).
          </p>
        </div>

        <div class="flex items-center gap-2.5">
          <div
            :class="[
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border',
              totalCards === 60
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : totalCards > 60
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
            ]"
          >
            <CheckCircle2 v-if="totalCards === 60" class="w-3.5 h-3.5" />
            <AlertTriangle v-else class="w-3.5 h-3.5" />
            <span class="font-mono">{{ totalCards }} / 60 cartes</span>
          </div>

          <button
            type="button"
            @click="triggerSyncToInput"
            class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition cursor-pointer"
            title="Mettre à jour la zone de texte PTCGL à gauche avec ces nouveaux ratios"
          >
            <RefreshCw class="w-3.5 h-3.5" />
            <span>{{ syncedFeedback ? 'Texte mis à jour !' : 'Appliquer au texte source' }}</span>
          </button>
        </div>
      </div>

      <!-- Filtres et Recherche -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-200">
        <div class="inline-flex flex-wrap gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
          <button
            v-for="cat in [
              { id: 'all', label: 'Toutes' },
              { id: 'pokemon', label: 'Pokémon' },
              { id: 'trainer', label: 'Dresseurs' },
              { id: 'energy', label: 'Énergies' },
            ]"
            :key="cat.id"
            type="button"
            @click="categoryFilter = cat.id as any"
            :class="[
              'px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer',
              categoryFilter === cat.id
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            ]"
          >
            {{ cat.label }}
          </button>
        </div>

        <div class="relative flex-1 max-w-xs">
          <Search class="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Filtrer par nom ou ID (ex: sv01-166)..."
            class="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 outline-none transition"
          />
        </div>
      </div>
    </div>

    <!-- Liste interactive des cartes -->
    <div class="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th class="py-2.5 px-4">Ratio / Quantité</th>
              <th class="py-2.5 px-4">Carte (FR / EN)</th>
              <th class="py-2.5 px-4">Catégorie</th>
              <th class="py-2.5 px-4">Code PTCGL</th>
              <th class="py-2.5 px-4">TCGdex cardId</th>
              <th class="py-2.5 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 text-xs">
            <tr
              v-for="card in filteredCards"
              :key="card.uid"
              class="hover:bg-slate-50/70 transition"
            >
              <!-- Contrôles de Ratio (- / input / +) -->
              <td class="py-2.5 px-4 whitespace-nowrap">
                <div class="inline-flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-lg p-0.5">
                  <button
                    type="button"
                    @click="handleDecrement(card)"
                    class="w-6 h-6 rounded bg-white hover:bg-rose-50 hover:text-rose-600 text-slate-700 flex items-center justify-center transition cursor-pointer border border-slate-200/80 shadow-2xs"
                    title="Diminuer la quantité"
                  >
                    <Minus class="w-3 h-3" />
                  </button>
                  <input
                    type="number"
                    min="1"
                    :max="maxAllowedForCard(card)"
                    :value="card.quantity"
                    @change="handleDirectInput(card, ($event.target as HTMLInputElement).value)"
                    class="w-8 text-center font-mono font-bold text-xs text-slate-900 bg-transparent outline-none"
                  />
                  <button
                    type="button"
                    @click="handleIncrement(card)"
                    :disabled="card.quantity >= maxAllowedForCard(card)"
                    class="w-6 h-6 rounded bg-white hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-40 disabled:pointer-events-none text-slate-700 flex items-center justify-center transition cursor-pointer border border-slate-200/80 shadow-2xs"
                    title="Augmenter la quantité"
                  >
                    <Plus class="w-3 h-3" />
                  </button>
                </div>
              </td>

              <!-- Nom FR & EN -->
              <td class="py-2.5 px-4">
                <div class="flex items-center gap-2.5">
                  <img
                    :src="`${card.imageUrl}/low.webp`"
                    :alt="card.nameFr"
                    class="w-8 h-11 rounded object-cover bg-slate-100 border border-slate-200 shrink-0"
                    loading="lazy"
                    @error="($event.target as HTMLImageElement).style.display = 'none'"
                  />
                  <div>
                    <div class="font-semibold text-slate-900 flex items-center gap-1.5">
                      <span>{{ card.nameFr }}</span>
                      <span
                        v-if="card.isAceSpec"
                        class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200"
                      >
                        ACE SPEC
                      </span>
                      <span
                        v-if="card.foil"
                        class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-50 text-amber-700 border border-amber-200"
                      >
                        {{ card.foil }}
                      </span>
                    </div>
                    <div
                      v-if="card.nameEn !== card.nameFr"
                      class="text-[11px] text-slate-500"
                    >
                      {{ card.nameEn }}
                    </div>
                  </div>
                </div>
              </td>

              <!-- Catégorie -->
              <td class="py-2.5 px-4 whitespace-nowrap">
                <span
                  :class="[
                    'px-2 py-0.5 rounded-md text-[11px] font-medium border',
                    card.category === 'pokemon'
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : card.category === 'trainer'
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                  ]"
                >
                  {{ card.subCategory }}
                </span>
              </td>

              <!-- Code PTCGL -->
              <td class="py-2.5 px-4 whitespace-nowrap font-mono text-slate-600">
                {{ card.setCode }} {{ card.number }}
              </td>

              <!-- TCGdex ID -->
              <td class="py-2.5 px-4 whitespace-nowrap">
                <code class="px-2 py-0.5 rounded bg-slate-50 border border-slate-200 text-blue-700 font-mono font-semibold">
                  {{ card.cardId }}
                </code>
              </td>

              <!-- Supprimer -->
              <td class="py-2.5 px-4 text-right whitespace-nowrap">
                <button
                  type="button"
                  @click="emit('remove-card', card.uid)"
                  class="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                  title="Retirer cette carte du deck"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Formulaire d'ajout rapide d'une carte au deck -->
    <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-3">
      <h4 class="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
        <PlusCircle class="w-4 h-4 text-blue-600" />
        Ajouter une carte supplémentaire au deck
      </h4>
      <form
        @submit.prevent="handleAddCard"
        class="grid grid-cols-2 sm:grid-cols-6 gap-2.5 items-end"
      >
        <div>
          <label class="block text-[11px] text-slate-500 mb-1">Quantité</label>
          <input
            v-model.number="newQty"
            type="number"
            min="1"
            max="59"
            class="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-slate-900 focus:bg-white focus:border-blue-500 outline-none"
          />
        </div>
        <div class="col-span-2">
          <label class="block text-[11px] text-slate-500 mb-1">Nom de la carte</label>
          <input
            v-model="newName"
            type="text"
            placeholder="Ex: Mashynn, Super Bonbon..."
            class="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:bg-white focus:border-blue-500 outline-none"
          />
        </div>
        <div>
          <label class="block text-[11px] text-slate-500 mb-1">Code Set PTCGL</label>
          <input
            v-model="newSetCode"
            type="text"
            placeholder="SVI, OBF, MEW..."
            class="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono uppercase text-slate-900 focus:bg-white focus:border-blue-500 outline-none"
          />
        </div>
        <div>
          <label class="block text-[11px] text-slate-500 mb-1">Numéro</label>
          <input
            v-model="newNumber"
            type="text"
            placeholder="166"
            class="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-slate-900 focus:bg-white focus:border-blue-500 outline-none"
          />
        </div>
        <div>
          <button
            type="submit"
            class="w-full py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium shadow-xs transition cursor-pointer"
          >
            + Ajouter
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
