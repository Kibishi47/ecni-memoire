<script setup lang="ts">
import { ref } from 'vue'
import { META_OPPONENT_DECKS } from '../data/metaDecks'
import { parsePtcglDecklist } from '../utils/ptcglParser'
import { Plus, Swords, X } from 'lucide-vue-next'

const props = defineProps<{
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (
    e: 'start-match',
    config: {
      playerDeckId: string
      customPlayerDeckText?: string
      opponentDeckId: string
      firstPlayer: 'PLAYER' | 'OPPONENT' | 'RANDOM'
      seed: number
      maxTurns: number
    },
  ): void
}>()

const selectedPlayerDeckId = ref(META_OPPONENT_DECKS[0]!.id)
const selectedOpponentDeckId = ref(META_OPPONENT_DECKS[1]!.id)
const firstPlayerMode = ref<'PLAYER' | 'OPPONENT' | 'RANDOM'>('RANDOM')
const maxTurns = ref(20)
const useRandomSeed = ref(true)
const customSeed = ref(12345)

const isCustomDeck = ref(false)
const customDeckText = ref('')
const customDeckError = ref<string | null>(null)

function handleStartMatch() {
  customDeckError.value = null
  let finalPlayerText: string | undefined

  if (isCustomDeck.value) {
    const parsed = parsePtcglDecklist(customDeckText.value)
    if (!parsed.isValid60 || !parsed.isFullyResolved) {
      customDeckError.value = 'Le deck personnalisé doit comporter 60 cartes valides et résolues.'
      return
    }
    finalPlayerText = customDeckText.value
  }

  const finalSeed = useRandomSeed.value ? Math.floor(Math.random() * 1000000) + 1 : customSeed.value

  emit('start-match', {
    playerDeckId: selectedPlayerDeckId.value,
    customPlayerDeckText: finalPlayerText,
    opponentDeckId: selectedOpponentDeckId.value,
    firstPlayer: firstPlayerMode.value,
    seed: finalSeed,
    maxTurns: maxTurns.value,
  })
}
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs select-none"
    @click.self="emit('close')"
  >
    <div class="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <!-- En-tête -->
      <div class="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
        <div class="flex items-center gap-2">
          <div class="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs">
            <Swords class="h-4 w-4" />
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-900">
              Configurer un Nouveau Duel
            </h3>
            <p class="text-[11px] text-slate-500">
              Sélectionnez les deux decks et les conditions de match
            </p>
          </div>
        </div>
        <button
          type="button"
          @click="emit('close')"
          class="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X class="h-5 w-5" />
        </button>
      </div>

      <!-- Formulaire -->
      <div class="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
        <!-- Deck Joueur (Moi) -->
        <div>
          <label class="block font-bold text-slate-800">
            1. Deck du Joueur 1 (Moi)
          </label>
          <div class="mt-1.5 space-y-2">
            <div
              v-for="deck in META_OPPONENT_DECKS"
              :key="deck.id"
              @click="selectedPlayerDeckId = deck.id; isCustomDeck = false"
              class="flex cursor-pointer items-center justify-between rounded-xl border p-2.5 transition-all"
              :class="!isCustomDeck && selectedPlayerDeckId === deck.id ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-600/20' : 'border-slate-200 bg-white hover:bg-slate-50'"
            >
              <div>
                <div class="font-bold text-slate-900">{{ deck.name }}</div>
                <div class="text-[10px] text-slate-500">{{ deck.strategySubtitle }}</div>
              </div>
              <span class="rounded px-1.5 py-0.5 text-[9px] font-bold" :class="deck.badgeColor">
                {{ deck.archetypeBadge }}
              </span>
            </div>
          </div>
        </div>

        <!-- Deck Adversaire -->
        <div>
          <label class="block font-bold text-slate-800">
            2. Deck de l'Adversaire
          </label>
          <div class="mt-1.5 space-y-2">
            <div
              v-for="deck in META_OPPONENT_DECKS"
              :key="deck.id"
              @click="selectedOpponentDeckId = deck.id"
              class="flex cursor-pointer items-center justify-between rounded-xl border p-2.5 transition-all"
              :class="selectedOpponentDeckId === deck.id ? 'border-purple-600 bg-purple-50/50 ring-2 ring-purple-600/20' : 'border-slate-200 bg-white hover:bg-slate-50'"
            >
              <div>
                <div class="font-bold text-slate-900">{{ deck.name }}</div>
                <div class="text-[10px] text-slate-500">{{ deck.strategySubtitle }}</div>
              </div>
              <span class="rounded px-1.5 py-0.5 text-[9px] font-bold" :class="deck.badgeColor">
                {{ deck.archetypeBadge }}
              </span>
            </div>
          </div>
        </div>

        <!-- Premier Joueur (Pile ou Face) -->
        <div>
          <label class="block font-bold text-slate-800">
            3. Premier Joueur (Tour 1)
          </label>
          <div class="mt-1.5 grid grid-cols-3 gap-2">
            <button
              type="button"
              @click="firstPlayerMode = 'RANDOM'"
              class="rounded-xl border p-2 text-center font-semibold transition-all"
              :class="firstPlayerMode === 'RANDOM' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'"
            >
              🪙 Pile ou Face
            </button>
            <button
              type="button"
              @click="firstPlayerMode = 'PLAYER'"
              class="rounded-xl border p-2 text-center font-semibold transition-all"
              :class="firstPlayerMode === 'PLAYER' ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'"
            >
              Moi d'abord
            </button>
            <button
              type="button"
              @click="firstPlayerMode = 'OPPONENT'"
              class="rounded-xl border p-2 text-center font-semibold transition-all"
              :class="firstPlayerMode === 'OPPONENT' ? 'border-purple-600 bg-purple-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'"
            >
              Adversaire
            </button>
          </div>
        </div>

        <!-- Plafond de Tours & Graine (Seed) -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-bold text-slate-800">
              Plafond de Tours
            </label>
            <select
              v-model.number="maxTurns"
              class="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-xs text-slate-800 focus:border-slate-900 focus:bg-white focus:outline-hidden"
            >
              <option :value="15">15 tours</option>
              <option :value="20">20 tours (recommandé)</option>
              <option :value="25">25 tours</option>
              <option :value="30">30 tours</option>
            </select>
          </div>

          <div>
            <label class="block font-bold text-slate-800">
              Graine Déterministe
            </label>
            <div class="mt-1 flex items-center gap-2">
              <label class="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  v-model="useRandomSeed"
                  type="checkbox"
                  class="rounded border-slate-300 text-slate-900"
                />
                <span>Aléatoire</span>
              </label>
              <input
                v-if="!useRandomSeed"
                v-model.number="customSeed"
                type="number"
                class="w-24 rounded-lg border border-slate-200 bg-slate-50 p-1.5 font-mono text-xs text-slate-800"
              />
            </div>
          </div>
        </div>

        <!-- Erreur éventuelle -->
        <div v-if="customDeckError" class="rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-700">
          {{ customDeckError }}
        </div>
      </div>

      <!-- Pied de modal -->
      <div class="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
        <button
          type="button"
          @click="emit('close')"
          class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
        >
          Annuler
        </button>
        <button
          type="button"
          @click="handleStartMatch"
          class="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-slate-800"
        >
          <Plus class="h-3.5 w-3.5" />
          <span>Lancer le Duel</span>
        </button>
      </div>
    </div>
  </div>
</template>
