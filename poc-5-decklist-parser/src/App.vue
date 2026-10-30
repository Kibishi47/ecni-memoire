<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  FileCode2,
  SlidersHorizontal,
  Share2,
  LayoutGrid,
  FileText,
} from 'lucide-vue-next'
import Header from './components/Header.vue'
import DeckInput from './components/DeckInput.vue'
import IdExtractor from './components/IdExtractor.vue'
import RatioTuner from './components/RatioTuner.vue'
import PtcglExporter from './components/PtcglExporter.vue'
import CardPreviewGallery from './components/CardPreviewGallery.vue'
import CleanDeckView from './components/CleanDeckView.vue'

import { SAMPLE_DECKS } from './data/sample-decks'
import { parsePtcglDecklist, computeDeckSummary } from './utils/ptcgl-parser'
import { exportDeckToPtcgl } from './utils/export'
import { getAllMappedSets } from './utils/id-resolver'
import type { ParsedCard, SampleDeckPreset } from './types/deck'

type ActiveTab = 'ids' | 'ratios' | 'export-ptcgl' | 'gallery' | 'clean'

const defaultPreset = SAMPLE_DECKS[0]!
const rawDeckText = ref(defaultPreset.ptcglText)
const activePresetId = ref<string | null>(defaultPreset.id)
const activeTab = ref<ActiveTab>('ids')

const mappedSetsCount = getAllMappedSets().length

// État réactif des cartes (permet de modifier les ratios sans écraser brutalement la saisie tant que non demandé)
const cardsState = ref<ParsedCard[]>([])
const parseWarnings = ref<{ line?: number; message: string }[]>([])

function reparseFromText(text: string) {
  const parsed = parsePtcglDecklist(text)
  cardsState.value = parsed.cards
  parseWarnings.value = parsed.warnings
}

// Initialisation
reparseFromText(rawDeckText.value)

watch(rawDeckText, (newText) => {
  reparseFromText(newText)
})

const deckSummary = computed(() =>
  computeDeckSummary(cardsState.value, 'ptcgl', parseWarnings.value),
)

function handleSelectPreset(preset: SampleDeckPreset) {
  activePresetId.value = preset.id
  rawDeckText.value = preset.ptcglText
}

function handleReset() {
  activePresetId.value = defaultPreset.id
  rawDeckText.value = defaultPreset.ptcglText
  reparseFromText(defaultPreset.ptcglText)
}

function handleUpdateQuantity(uid: string, newQuantity: number) {
  activePresetId.value = null
  const idx = cardsState.value.findIndex((c) => c.uid === uid)
  if (idx !== -1) {
    if (newQuantity <= 0) {
      cardsState.value.splice(idx, 1)
    } else {
      cardsState.value[idx] = {
        ...cardsState.value[idx]!,
        quantity: newQuantity,
      }
    }
  }
}

function handleRemoveCard(uid: string) {
  activePresetId.value = null
  cardsState.value = cardsState.value.filter((c) => c.uid !== uid)
}

function handleAddCard(newCard: ParsedCard) {
  activePresetId.value = null
  const existing = cardsState.value.find((c) => c.cardId === newCard.cardId)
  if (existing) {
    existing.quantity += newCard.quantity
  } else {
    cardsState.value.push(newCard)
  }
}

function handleSyncRatiosToInput() {
  const updatedText = exportDeckToPtcgl(cardsState.value, { lang: 'fr' })
  rawDeckText.value = updatedText
}

function handleApplyExportToInput(ptcglText: string) {
  rawDeckText.value = ptcglText
}

const tabs: { id: ActiveTab; label: string; badge?: string; icon: any }[] = [
  { id: 'ids', label: 'Extraire les IDs & JSON', badge: 'TCGdex', icon: FileCode2 },
  { id: 'ratios', label: 'Modifier les Ratios', badge: '+ / -', icon: SlidersHorizontal },
  { id: 'export-ptcgl', label: 'Exporter en PTCGL', icon: Share2 },
  { id: 'gallery', label: 'Galerie Visuelle', icon: LayoutGrid },
  { id: 'clean', label: 'Liste sans IDs', icon: FileText },
]
</script>

<template>
  <div class="min-h-screen flex flex-col bg-slate-950 text-slate-100">
    <Header
      :total-sets="mappedSetsCount"
      :total-cards="deckSummary.totalCards"
      :unique-cards="deckSummary.uniqueCardCount"
    />

    <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <!-- Colonne Gauche (5/12) : Saisie de la deckliste & Validation 60 cartes -->
        <div class="lg:col-span-5 lg:sticky lg:top-24">
          <DeckInput
            v-model="rawDeckText"
            :total-cards="deckSummary.totalCards"
            :pokemon-count="deckSummary.pokemonCount"
            :trainer-count="deckSummary.trainerCount"
            :energy-count="deckSummary.energyCount"
            :warnings="deckSummary.warnings"
            :active-preset-id="activePresetId"
            @select-preset="handleSelectPreset"
            @reset="handleReset"
          />
        </div>

        <!-- Colonne Droite (7/12) : Onglets d'extraction, Modification des Ratios & Export -->
        <div class="lg:col-span-7 flex flex-col gap-5">
          <!-- Barre d'onglets -->
          <nav class="bg-slate-900/90 border border-slate-800 rounded-2xl p-1.5 flex flex-wrap gap-1.5 shadow-lg">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              @click="activeTab = tab.id"
              :class="[
                'flex-1 min-w-fit inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer',
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              ]"
            >
              <component :is="tab.icon" class="w-4 h-4 shrink-0" />
              <span>{{ tab.label }}</span>
              <span
                v-if="tab.badge"
                :class="[
                  'px-1.5 py-0.5 rounded text-[10px] font-mono',
                  activeTab === tab.id
                    ? 'bg-indigo-800/80 text-indigo-100'
                    : 'bg-slate-800 text-slate-400'
                ]"
              >
                {{ tab.badge }}
              </span>
            </button>
          </nav>

          <!-- Contenu de l'onglet actif -->
          <IdExtractor
            v-if="activeTab === 'ids'"
            :cards="deckSummary.cards"
          />

          <RatioTuner
            v-else-if="activeTab === 'ratios'"
            :cards="deckSummary.cards"
            :total-cards="deckSummary.totalCards"
            @update-quantity="handleUpdateQuantity"
            @remove-card="handleRemoveCard"
            @add-card="handleAddCard"
            @sync-to-input="handleSyncRatiosToInput"
          />

          <PtcglExporter
            v-else-if="activeTab === 'export-ptcgl'"
            :cards="deckSummary.cards"
            :total-cards="deckSummary.totalCards"
            @apply-to-input="handleApplyExportToInput"
          />

          <CardPreviewGallery
            v-else-if="activeTab === 'gallery'"
            :cards="deckSummary.cards"
            @update-quantity="handleUpdateQuantity"
          />

          <CleanDeckView
            v-else-if="activeTab === 'clean'"
            :cards="deckSummary.cards"
          />
        </div>
      </div>
    </main>
  </div>
</template>
