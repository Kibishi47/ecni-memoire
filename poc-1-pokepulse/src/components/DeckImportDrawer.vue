<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { parsePtcglText } from '../utils/deck-parser'
import { DECK_PRESETS } from '../data/presets'
import { 
  X, 
  UploadCloud, 
  CheckCircle2, 
  AlertTriangle, 
  RotateCcw,
  ClipboardCheck
} from 'lucide-vue-next'

const props = defineProps<{
  isOpen: boolean
  initialText: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'import-deck', ptcglText: string): void
}>()

const textContent = ref(props.initialText)

watch(() => props.initialText, (newVal) => {
  textContent.value = newVal
})

const parsedCards = computed(() => {
  return parsePtcglText(textContent.value)
})

const totalCardCount = computed(() => {
  return parsedCards.value.reduce((acc, card) => acc + card.count, 0)
})

const isDeckValid = computed(() => {
  return totalCardCount.value === 60
})

const loadExample = (presetId: string) => {
  const found = DECK_PRESETS.find(p => p.id === presetId)
  if (found) {
    textContent.value = found.ptcglText
  }
}

const clearText = () => {
  textContent.value = ''
}

const handleImport = () => {
  if (parsedCards.value.length === 0) return
  emit('import-deck', textContent.value)
  emit('close')
}
</script>

<template>
  <div 
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm transition-all"
  >
    <div 
      class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
    >
      <!-- Modal Header -->
      <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
        <div class="flex items-center gap-2.5">
          <div class="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <UploadCloud class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-bold text-slate-100">
              Importer une liste de Deck
            </h3>
            <p class="text-xs text-slate-400">
              Format standard exporté depuis Pokémon TCG Live ou Limitless TCG
            </p>
          </div>
        </div>

        <button 
          @click="emit('close')"
          class="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Quick sample load bar -->
      <div class="px-6 py-3 bg-slate-950/40 border-b border-slate-800/80 flex flex-wrap items-center gap-2 text-xs">
        <span class="text-slate-500 font-medium">Charger un exemple :</span>
        <button 
          type="button"
          @click="loadExample('charizard_pidgeot')"
          class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
        >
          Dracaufeu ex
        </button>
        <button 
          type="button"
          @click="loadExample('raging_bolt_ogerpon')"
          class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
        >
          Ire-Foudre ex
        </button>
        <button 
          type="button"
          @click="loadExample('gardevoir_munkidori')"
          class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
        >
          Gardevoir ex
        </button>
        <button 
          type="button"
          @click="clearText"
          class="ml-auto inline-flex items-center gap-1 px-2 py-1 text-slate-400 hover:text-rose-400 text-xs transition-colors"
        >
          <RotateCcw class="w-3 h-3" />
          Effacer
        </button>
      </div>

      <!-- Textarea body -->
      <div class="p-6 overflow-y-auto space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-300 mb-2">
            Collez votre texte ci-dessous (ex: "4 Salamèche MEW 4" ou "4 Buddy-Buddy Poffin TEF 144")
          </label>
          <textarea
            v-model="textContent"
            rows="10"
            placeholder="Pokémon: 16&#10;4 Salamèche MEW 4&#10;2 Dracaufeu ex OBF 125&#10;&#10;Dresseurs: 36&#10;4 Poffin Pote-Pote TEF 144&#10;4 Super Bonbon SVI 191&#10;&#10;Énergies: 8&#10;8 Énergie Feu de base SVE 2"
            class="w-full font-mono text-xs p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all resize-y"
          ></textarea>
        </div>

        <!-- Live Card Counter Status -->
        <div class="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
          <div class="flex items-center gap-2">
            <span class="text-slate-400">Total cartes détectées :</span>
            <span 
              :class="[
                'font-mono font-bold px-2 py-0.5 rounded text-xs',
                isDeckValid 
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              ]"
            >
              {{ totalCardCount }} / 60 cartes
            </span>
          </div>

          <div class="flex items-center gap-1.5">
            <span v-if="isDeckValid" class="inline-flex items-center gap-1 text-emerald-400 text-xs">
              <CheckCircle2 class="w-4 h-4" />
              Format standard valide
            </span>
            <span v-else-if="totalCardCount > 0" class="inline-flex items-center gap-1 text-amber-400 text-xs">
              <AlertTriangle class="w-4 h-4" />
              Format non réglementaire (simulable quand même)
            </span>
            <span v-else class="text-slate-500 text-xs">
              En attente de texte...
            </span>
          </div>
        </div>
      </div>

      <!-- Footer Buttons -->
      <div class="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-end gap-3">
        <button
          type="button"
          @click="emit('close')"
          class="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          Annuler
        </button>

        <button
          type="button"
          @click="handleImport"
          :disabled="parsedCards.length === 0"
          :class="[
            'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md',
            parsedCards.length > 0
              ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shadow-glow-indigo cursor-pointer'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
          ]"
        >
          <ClipboardCheck class="w-4 h-4" />
          <span>Analyser cette liste ({{ totalCardCount }} cartes)</span>
        </button>
      </div>
    </div>
  </div>
</template>
