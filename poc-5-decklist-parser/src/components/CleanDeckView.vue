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
  <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 class="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Sparkles class="w-4 h-4 text-amber-500" />
          <span>Deckliste Épurée (Sans Codes de Set ni Numéros)</span>
        </h3>
        <p class="text-xs text-slate-500">
          Idéal pour partager une liste lisible sur Discord, dans un article ou un rapport sans les identifiants techniques.
        </p>
      </div>

      <div class="flex items-center gap-2">
        <div class="inline-flex bg-slate-100 p-1 rounded-lg border border-slate-200">
          <button
            type="button"
            @click="lang = 'fr'"
            :class="[
              'px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer',
              lang === 'fr'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            ]"
          >
            Noms FR
          </button>
          <button
            type="button"
            @click="lang = 'en'"
            :class="[
              'px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer',
              lang === 'en'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
            ]"
          >
            Noms EN
          </button>
        </div>

        <button
          type="button"
          @click="copyClean"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition cursor-pointer"
        >
          <Check v-if="copied" class="w-3.5 h-3.5 text-white" />
          <Copy v-else class="w-3.5 h-3.5" />
          <span>{{ copied ? 'Copié !' : 'Copier le texte épuré' }}</span>
        </button>
      </div>
    </div>

    <pre class="w-full rounded-lg bg-slate-900 border border-slate-800 p-4 text-xs sm:text-sm font-mono text-slate-100 leading-relaxed select-all">{{ cleanText }}</pre>
  </div>
</template>
