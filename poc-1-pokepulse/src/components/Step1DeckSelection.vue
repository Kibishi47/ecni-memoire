<script setup lang="ts">
import { ref, computed } from 'vue'
import type { DeckPreset, CardItem } from '../types/pokemon-tcg'
import { DECK_PRESETS } from '../data/presets'
import { parsePtcglText } from '../utils/deck-parser'
import { Check, ChevronDown, ChevronUp, FileText } from 'lucide-vue-next'

const props = defineProps<{
  selectedPresetId: string
  isCustomDeck: boolean
  customCards: CardItem[]
  customPtcglText: string
}>()

const emit = defineEmits<{
  (e: 'select-preset', preset: DeckPreset): void
  (e: 'update-custom-deck', text: string, cards: CardItem[]): void
  (e: 'next-step'): void
}>()

const isPastingOpen = ref(props.isCustomDeck)
const pastedText = ref(props.customPtcglText || '')
const isCardListOpen = ref(false)

const activeCards = computed<CardItem[]>(() => {
  if (props.isCustomDeck) {
    return props.customCards
  }
  const found = DECK_PRESETS.find(p => p.id === props.selectedPresetId)
  return found ? found.cards : DECK_PRESETS[0].cards
})

const countsSummary = computed(() => {
  const cards = activeCards.value
  const total = cards.reduce((sum, c) => sum + c.count, 0)
  const basics = cards.filter(c => c.role === 'basic_pokemon').reduce((sum, c) => sum + c.count, 0)
  const search = cards.filter(c => c.role === 'search_engine').reduce((sum, c) => sum + c.count, 0)
  const energies = cards.filter(c => c.role === 'energy').reduce((sum, c) => sum + c.count, 0)
  return { total, basics, search, energies }
})

const onSelectPresetCard = (preset: DeckPreset) => {
  isPastingOpen.value = false
  emit('select-preset', preset)
}

const onPastedTextChange = () => {
  const parsed = parsePtcglText(pastedText.value)
  if (parsed.length > 0) {
    emit('update-custom-deck', pastedText.value, parsed)
  }
}
</script>

<template>
  <div class="space-y-8 max-w-3xl mx-auto">
    <!-- Screen Header -->
    <div class="text-center space-y-1">
      <h2 class="text-2xl font-bold tracking-tight text-slate-900">
        Quel deck voulez-vous tester ?
      </h2>
      <p class="text-sm text-slate-500">
        Sélectionnez un deck du méta actuel ou collez votre propre liste.
      </p>
    </div>

    <!-- 3 Large Preset Cards Side-by-Side -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <button
        v-for="preset in DECK_PRESETS"
        :key="preset.id"
        type="button"
        @click="onSelectPresetCard(preset)"
        :class="[
          'relative p-5 text-left rounded-xl border transition-all bg-white shadow-sm flex flex-col justify-between h-36',
          !isCustomDeck && selectedPresetId === preset.id
            ? 'border-blue-600 ring-2 ring-blue-600/20 bg-blue-50/20'
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
        ]"
      >
        <div>
          <div class="flex items-start justify-between gap-2">
            <h3 class="font-bold text-base text-slate-900">
              {{ preset.name }}
            </h3>
            <span 
              v-if="!isCustomDeck && selectedPresetId === preset.id"
              class="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0"
            >
              <Check class="w-3 h-3 stroke-[3]" />
            </span>
          </div>
          <p class="text-xs text-slate-500 mt-1">
            {{ preset.subtitle }}
          </p>
        </div>

        <div class="text-[11px] font-medium text-slate-400">
          60 cartes standard
        </div>
      </button>
    </div>

    <!-- Discrete Toggle "Ou coller ma propre liste" -->
    <div class="text-center pt-1">
      <button
        type="button"
        @click="isPastingOpen = !isPastingOpen"
        class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors py-1 px-2 rounded-lg hover:bg-slate-100"
      >
        <FileText class="w-3.5 h-3.5" />
        <span>{{ isPastingOpen ? 'Masquer la zone de saisie' : 'Ou coller ma propre liste' }}</span>
        <component :is="isPastingOpen ? ChevronUp : ChevronDown" class="w-3.5 h-3.5 text-slate-400" />
      </button>

      <!-- Expandable Plain Textarea for Custom Paste -->
      <div v-if="isPastingOpen" class="mt-4 text-left p-4 rounded-xl border border-slate-200 bg-white shadow-sm space-y-3">
        <label class="block text-xs font-semibold text-slate-700">
          Format exporté depuis Pokémon TCG Live ou Limitless :
        </label>
        <textarea
          v-model="pastedText"
          @input="onPastedTextChange"
          rows="6"
          placeholder="Exemple :&#10;4 Salamèche MEW 4&#10;2 Dracaufeu ex OBF 125&#10;4 Poffin Pote-Pote TEF 144&#10;7 Énergie Feu de base SVE 2"
          class="w-full text-xs font-mono p-3 rounded-lg border border-slate-200 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 text-slate-800 placeholder-slate-400 resize-y"
        ></textarea>
        <div class="flex items-center justify-between text-xs text-slate-500">
          <span>{{ countsSummary.total }} cartes détectées</span>
          <span v-if="isCustomDeck" class="font-medium text-blue-600">Liste personnalisée active</span>
        </div>
      </div>
    </div>

    <!-- 1-Line Summary Pill -->
    <div class="p-4 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:text-sm">
      <div class="text-slate-700 font-medium text-center sm:text-left">
        <span class="font-semibold text-slate-900">{{ countsSummary.total }} cartes prêtes :</span>
        <span class="text-slate-600"> {{ countsSummary.basics }} Pokémon de base • {{ countsSummary.search }} Cartes de recherche • {{ countsSummary.energies }} Énergies</span>
      </div>

      <button
        type="button"
        @click="isCardListOpen = !isCardListOpen"
        class="text-xs text-blue-600 hover:text-blue-700 font-medium shrink-0 flex items-center gap-1"
      >
        <span>{{ isCardListOpen ? 'Fermer la liste' : 'Voir les 60 cartes' }}</span>
        <component :is="isCardListOpen ? ChevronUp : ChevronDown" class="w-3 h-3" />
      </button>
    </div>

    <!-- Optional Drawer for the 60 cards (closed by default) -->
    <div 
      v-if="isCardListOpen"
      class="p-4 rounded-xl bg-white border border-slate-200 shadow-sm text-xs space-y-3"
    >
      <h4 class="font-semibold text-slate-800 border-b border-slate-100 pb-2">
        Composition complète ({{ countsSummary.total }} cartes)
      </h4>
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1">
        <div 
          v-for="card in activeCards" 
          :key="card.id"
          class="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100 text-slate-700"
        >
          <span class="truncate font-medium">{{ card.frenchName || card.name }}</span>
          <span class="text-slate-400 font-mono ml-2 shrink-0">{{ card.count }}×</span>
        </div>
      </div>
    </div>

    <!-- Bottom Action Button -->
    <div class="flex justify-end pt-2">
      <button
        type="button"
        @click="emit('next-step')"
        class="w-full sm:w-auto px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors shadow-sm flex items-center justify-center gap-2"
      >
        <span>Choisir l'adversaire</span>
        <span>→</span>
      </button>
    </div>
  </div>
</template>
