<script setup lang="ts">
import { ref } from 'vue'
import { Minus, Plus, Copy, Check } from 'lucide-vue-next'
import type { ParsedCard } from '../types/deck'

defineProps<{
  cards: ParsedCard[]
}>()

const emit = defineEmits<{
  (e: 'update-quantity', uid: string, newQuantity: number): void
}>()

const copiedCardId = ref<string | null>(null)
const brokenImages = ref<Record<string, boolean>>({})

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id)
    copiedCardId.value = id
    setTimeout(() => {
      copiedCardId.value = null
    }, 1500)
  } catch {
    // Fallback
  }
}

function handleImgError(uid: string) {
  brokenImages.value[uid] = true
}
</script>

<template>
  <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 class="text-base font-bold text-white">
          Galerie Visuelle TCGdex
        </h3>
        <p class="text-xs text-slate-400">
          Vérifiez visuellement vos cartes via le CDN <code class="text-indigo-300 font-mono">assets.tcgdex.net</code> et ajustez les quantités à la volée.
        </p>
      </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3.5">
      <div
        v-for="card in cards.filter(c => c.quantity > 0)"
        :key="card.uid"
        class="group bg-slate-950 border border-slate-800 hover:border-indigo-500/60 rounded-xl p-2.5 flex flex-col gap-2 transition shadow-md"
      >
        <!-- Visuel de la carte -->
        <div class="relative aspect-[2.5/3.5] w-full rounded-lg overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center">
          <img
            v-if="!brokenImages[card.uid]"
            :src="`${card.imageUrl}/low.webp`"
            :alt="card.nameFr"
            class="w-full h-full object-contain group-hover:scale-105 transition duration-300"
            loading="lazy"
            @error="handleImgError(card.uid)"
          />
          <div
            v-else
            class="p-3 text-center flex flex-col items-center justify-center gap-1 text-slate-400"
          >
            <span class="text-xs font-bold text-white">{{ card.nameFr }}</span>
            <span class="text-[11px] font-mono text-indigo-400">{{ card.cardId }}</span>
          </div>

          <!-- Badge de quantité en haut à droite -->
          <div class="absolute top-2 right-2 px-2.5 py-0.5 rounded-full bg-slate-950/90 border border-indigo-500/50 text-white font-mono font-bold text-xs shadow-lg">
            ×{{ card.quantity }}
          </div>
        </div>

        <!-- Infos et Contrôles rapides -->
        <div class="flex flex-col gap-1.5">
          <div class="font-semibold text-xs text-white truncate" :title="card.nameFr">
            {{ card.nameFr }}
          </div>

          <div class="flex items-center justify-between gap-1">
            <button
              type="button"
              @click="copyId(card.cardId)"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-indigo-950 border border-slate-800 text-[11px] font-mono text-indigo-300 transition cursor-pointer"
              title="Copier le cardId"
            >
              <span>{{ card.cardId }}</span>
              <Check v-if="copiedCardId === card.cardId" class="w-3 h-3 text-emerald-400" />
              <Copy v-else class="w-2.5 h-2.5 opacity-60" />
            </button>

            <div class="inline-flex items-center gap-1">
              <button
                type="button"
                @click="emit('update-quantity', card.uid, Math.max(0, card.quantity - 1))"
                class="w-6 h-6 rounded bg-slate-900 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-800 flex items-center justify-center transition cursor-pointer"
              >
                <Minus class="w-3 h-3" />
              </button>
              <button
                type="button"
                @click="emit('update-quantity', card.uid, card.quantity + 1)"
                class="w-6 h-6 rounded bg-slate-900 hover:bg-emerald-500/20 text-slate-300 hover:text-emerald-300 border border-slate-800 flex items-center justify-center transition cursor-pointer"
              >
                <Plus class="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
