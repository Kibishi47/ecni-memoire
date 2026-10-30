<script setup lang="ts">
import { ref, computed } from 'vue'
import { Copy, Check, Download, RefreshCw, Globe } from 'lucide-vue-next'
import type { DeckFormat, ParsedCard } from '../types/deck'
import { exportDeckToPtcgl } from '../utils/export'

const props = defineProps<{
  cards: ParsedCard[]
  totalCards: number
}>()

const emit = defineEmits<{
  (e: 'apply-to-input', ptcglText: string): void
}>()

const exportLang = ref<'fr' | 'en'>('fr')
const exportFormat = ref<DeckFormat>('ptcgl')
const includeTotal = ref(true)
const copied = ref(false)
const applied = ref(false)

const exportedText = computed(() =>
  exportDeckToPtcgl(props.cards, {
    lang: exportLang.value,
    format: exportFormat.value,
    includeTotalCards: includeTotal.value,
  }),
)

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(exportedText.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // Fallback
  }
}

function handleDownload() {
  const blob = new Blob([exportedText.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `deck-ptcgl-${exportLang.value}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

function handleApplyToInput() {
  emit('apply-to-input', exportedText.value)
  applied.value = true
  setTimeout(() => {
    applied.value = false
  }, 2000)
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- Options d'export PTCGL -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div class="flex flex-wrap items-center gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Globe class="w-3.5 h-3.5 text-indigo-400" />
            Langue d'export PTCGL
          </label>
          <div class="inline-flex bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              @click="exportLang = 'fr'"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer',
                exportLang === 'fr' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              ]"
            >
              Français (Pokémon / Dresseurs / Énergies)
            </button>
            <button
              type="button"
              @click="exportLang = 'en'"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer',
                exportLang === 'en' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              ]"
            >
              English (Pokémon / Trainer / Energy)
            </button>
          </div>
        </div>

        <label class="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer mt-4 sm:mt-5">
          <input
            v-model="includeTotal"
            type="checkbox"
            class="rounded border-slate-700 bg-slate-900 text-indigo-600"
          />
          <span>Inclure <code class="font-mono text-indigo-300">Total Cards: {{ totalCards }}</code></span>
        </label>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          @click="handleApplyToInput"
          class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
        >
          <RefreshCw class="w-3.5 h-3.5" />
          <span>{{ applied ? 'Appliqué !' : 'Remplacer l\'entrée' }}</span>
        </button>

        <button
          type="button"
          @click="handleCopy"
          class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition cursor-pointer"
        >
          <Check v-if="copied" class="w-4 h-4 text-emerald-300" />
          <Copy v-else class="w-4 h-4" />
          <span>{{ copied ? 'Deckliste PTCGL copiée !' : 'Copier pour PTCGL' }}</span>
        </button>

        <button
          type="button"
          @click="handleDownload"
          class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
        >
          <Download class="w-4 h-4" />
          <span>.txt</span>
        </button>
      </div>
    </div>

    <!-- Texte PTCGL généré -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col gap-3">
      <div class="flex items-center justify-between text-xs text-slate-400">
        <span>Format prêt à être importé dans Pokémon TCG Live ou Limitless :</span>
        <span class="font-mono text-slate-300">{{ totalCards }} cartes</span>
      </div>
      <pre class="w-full rounded-xl bg-slate-950 border border-slate-800 p-4 text-xs sm:text-sm font-mono text-slate-100 leading-relaxed overflow-x-auto select-all">{{ exportedText }}</pre>
    </div>
  </div>
</template>
