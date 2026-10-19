<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { CardItem } from '../types/pokemon-tcg'
import { CARD_ROLES } from '../data/roles'
import { 
  Dices, 
  RotateCcw, 
  AlertCircle, 
  CheckCircle2, 
  Sparkles
} from 'lucide-vue-next'

const props = defineProps<{
  cards: CardItem[]
  deckName: string
}>()

// Flatten 60 individual cards
const flattenedDeck = computed<CardItem[]>(() => {
  const result: CardItem[] = []
  for (const card of props.cards) {
    for (let i = 0; i < card.count; i++) {
      result.push({ ...card, count: 1 })
    }
  }
  return result
})

const drawnHand = ref<CardItem[]>([])
const isMulligan = ref(false)
const mulliganStreak = ref(0)
const totalDraws = ref(0)

const drawSevenCards = () => {
  const deck = [...flattenedDeck.value]
  if (deck.length < 7) {
    drawnHand.value = deck
    return
  }

  // Shuffle Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]
  }

  const hand = deck.slice(0, 7)
  drawnHand.value = hand
  totalDraws.value++

  const basics = hand.filter(c => c.role === 'basic_pokemon')
  if (basics.length === 0) {
    isMulligan.value = true
    mulliganStreak.value++
  } else {
    isMulligan.value = false
  }
}

watch(() => props.cards, () => {
  mulliganStreak.value = 0
  totalDraws.value = 0
  drawSevenCards()
})

onMounted(() => {
  drawSevenCards()
})

const playableActionsT1 = computed(() => {
  const actions: string[] = []
  const hand = drawnHand.value

  const basics = hand.filter(c => c.role === 'basic_pokemon')
  const searchCards = hand.filter(c => c.role === 'search_engine')
  const energies = hand.filter(c => c.role === 'energy')
  const supporters = hand.filter(c => c.role === 'supporter')

  if (basics.length > 0) {
    actions.push(`Placer ${basics[0].frenchName} en Actif (+${basics.length - 1} sur le banc)`)
  }

  for (const s of searchCards) {
    actions.push(`Jouer ${s.frenchName} (Tutorat de banc)`)
  }

  if (energies.length > 0) {
    actions.push(`Attacher ${energies[0].frenchName} sur un Pokémon`)
  }

  for (const sup of supporters) {
    if (sup.frenchName.includes('Arven') || sup.frenchName.includes('Olim') || sup.frenchName.includes('Mashynn')) {
      actions.push(`Jouer ${sup.frenchName} (si vous jouez en 2nd)`)
    }
  }

  return actions
})
</script>

<template>
  <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-xl space-y-4">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <span class="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Dices class="w-4 h-4" />
          </span>
          <h3 class="text-base font-bold text-slate-100">
            Banc d'Essai T1 : Tirer une main de 7 cartes en direct — <span class="text-indigo-400 font-extrabold">{{ deckName }}</span>
          </h3>
        </div>
        <p class="text-xs text-slate-400 mt-0.5">
          Testez concrètement les probabilités simulées en générant une vraie main initiale de 7 cartes (Tirage n°{{ totalDraws }}).
        </p>
      </div>

      <!-- Redraw button -->
      <button
        type="button"
        @click="drawSevenCards"
        class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition-all hover:border-slate-600 shadow-sm cursor-pointer"
      >
        <RotateCcw class="w-3.5 h-3.5 text-indigo-400" />
        <span>Tirer 7 nouvelles cartes</span>
      </button>
    </div>

    <!-- Mulligan status banner if applicable -->
    <div 
      v-if="isMulligan"
      class="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center gap-3 text-xs text-rose-300 animate-in fade-in"
    >
      <AlertCircle class="w-5 h-5 text-rose-400 shrink-0" />
      <div>
        <strong class="font-bold">Mulligan Forcé détecté !</strong> 
        Aucun Pokémon de base dans cette main de 7 cartes. Vous devez remélanger votre deck et donner 1 carte supplémentaire à votre adversaire.
      </div>
    </div>

    <!-- Hand Cards Grid -->
    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5 pt-1">
      <div
        v-for="(card, index) in drawnHand"
        :key="index"
        :class="[
          'rounded-xl p-3 border flex flex-col justify-between h-32 transition-all duration-200 group bg-slate-950/80 hover:bg-slate-950',
          CARD_ROLES[card.role]?.borderColor || 'border-slate-800'
        ]"
      >
        <div class="space-y-1">
          <!-- Role Pill -->
          <div class="flex items-center justify-between">
            <span 
              :class="[
                'text-[9px] font-bold px-1.5 py-0.2 rounded border',
                CARD_ROLES[card.role]?.badgeBg,
                CARD_ROLES[card.role]?.badgeText,
                CARD_ROLES[card.role]?.borderColor
              ]"
            >
              {{ CARD_ROLES[card.role]?.shortLabel }}
            </span>
            <span class="text-[9px] font-mono text-slate-500">#{{ index + 1 }}</span>
          </div>

          <!-- Card Name -->
          <h4 class="text-xs font-bold text-slate-100 group-hover:text-indigo-400 transition-colors line-clamp-2 leading-snug">
            {{ card.frenchName || card.name }}
          </h4>
        </div>

        <div class="pt-2 border-t border-slate-900 flex items-center justify-between text-[10px] text-slate-500 font-mono">
          <span>{{ card.set }}</span>
          <span v-if="card.hp" class="text-slate-400">{{ card.hp }} PV</span>
        </div>
      </div>
    </div>

    <!-- Playable T1 actions detected -->
    <div v-if="!isMulligan && playableActionsT1.length > 0" class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs space-y-1.5">
      <span class="text-slate-400 font-semibold text-[11px] flex items-center gap-1.5">
        <Sparkles class="w-3.5 h-3.5 text-emerald-400" />
        Actions jouables détectées au Tour 1 avec cette main :
      </span>
      <div class="flex flex-wrap gap-2">
        <span 
          v-for="(action, idx) in playableActionsT1" 
          :key="idx"
          class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 font-medium text-[11px]"
        >
          <CheckCircle2 class="w-3 h-3 text-emerald-400 shrink-0" />
          {{ action }}
        </span>
      </div>
    </div>
  </div>
</template>
