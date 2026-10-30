<script setup lang="ts">
import { ref, computed } from 'vue'
import { Copy, Check, Sparkles } from 'lucide-vue-next'
import type { ParsedCard } from '../types/deck'
import { exportCleanDecklistWithoutIds } from '../utils/export'

const props = defineProps<{
  cards: ParsedCard[]
}>()

const lang = ref<'fr' | 'en'>('fr')
const copied = ref(false)

const cleanText = computed(() => exportCleanDecklistWithoutIds(props.cards, lang.value))

async function copyClean() {
  try {
    await navigator.clipboard.writeText(cleanText.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // Fallback
  }
}
</script>

<template>
  <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="text-base font-bold text-white flex items-center gap-2">
          <Sparkles class="w-4 h-4 text-amber-400" />
          <span>Deckliste Épurée (Sans Codes de Set ni Numéros)</span>
        </h3>
        <p class="text-xs text-slate-400">
          Idéal pour partager une liste lisible sur Discord, dans un article ou un rapport sans les identifiants techniques.
        </p>
      </div>

      <div class="flex items-center gap-2">
        <div class="inline-flex bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            @click="lang = 'fr'"
            :class="[
              'px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer',
              lang === 'fr' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
            ]"
          >
            Noms FR
          </button>
          <button
            type="button"
            @click="lang = 'en'"
            :class="[
              'px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer',
              lang === 'en' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
            ]"
          >
            Noms EN
          </button>
        </div>

        <button
          type="button"
          @click="copyClean"
          class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer"
        >
          <Check v-if="copied" class="w-4 h-4 text-emerald-300" />
          <Copy v-else class="w-4 h-4" />
          <span>{{ copied ? 'Copié !' : 'Copier le texte épuré' }}</span>
        </button>
      </div>
    </div>

    <pre class="w-full rounded-xl bg-slate-950 border border-slate-800 p-4 text-xs sm:text-sm font-mono text-slate-200 leading-relaxed select-all">{{ cleanText }}</pre>
  </div>
</template>
