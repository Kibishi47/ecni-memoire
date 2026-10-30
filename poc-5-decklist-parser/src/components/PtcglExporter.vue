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
  <div class="flex flex-col gap-4">
    <!-- Options d'export PTCGL -->
    <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div class="flex flex-wrap items-center gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Globe class="w-3.5 h-3.5 text-blue-600" />
            Langue d'export PTCGL
          </label>
          <div class="inline-flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              type="button"
              @click="exportLang = 'fr'"
              :class="[
                'px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer',
                exportLang === 'fr'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              ]"
            >
              Français (Pokémon / Dresseurs / Énergies)
            </button>
            <button
              type="button"
              @click="exportLang = 'en'"
              :class="[
                'px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer',
                exportLang === 'en'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              ]"
            >
              English (Pokémon / Trainer / Energy)
            </button>
          </div>
        </div>

        <label class="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer mt-4 sm:mt-5">
          <input
            v-model="includeTotal"
            type="checkbox"
            class="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>Inclure <code class="font-mono text-slate-800">Total Cards: {{ totalCards }}</code></span>
        </label>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          @click="handleApplyToInput"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-xs transition cursor-pointer"
        >
          <RefreshCw class="w-3.5 h-3.5" />
          <span>{{ applied ? 'Appliqué !' : 'Remplacer l\'entrée' }}</span>
        </button>

        <button
          type="button"
          @click="handleCopy"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition cursor-pointer"
        >
          <Check v-if="copied" class="w-3.5 h-3.5 text-white" />
          <Copy v-else class="w-3.5 h-3.5" />
          <span>{{ copied ? 'Deckliste PTCGL copiée !' : 'Copier pour PTCGL' }}</span>
        </button>

        <button
          type="button"
          @click="handleDownload"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-xs transition cursor-pointer"
        >
          <Download class="w-3.5 h-3.5" />
          <span>.txt</span>
        </button>
      </div>
    </div>

    <!-- Texte PTCGL généré -->
    <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-3">
      <div class="flex items-center justify-between text-xs text-slate-500">
        <span>Format prêt à être importé dans Pokémon TCG Live ou Limitless :</span>
        <span class="font-mono font-semibold text-slate-900">{{ totalCards }} cartes</span>
      </div>
      <pre class="w-full rounded-lg bg-slate-900 border border-slate-800 p-4 text-xs sm:text-sm font-mono text-slate-100 leading-relaxed overflow-x-auto select-all">{{ exportedText }}</pre>
    </div>
  </div>
</template>
