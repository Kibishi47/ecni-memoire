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
  <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 class="text-sm font-bold text-slate-900">
          Galerie Visuelle TCGdex
        </h3>
        <p class="text-xs text-slate-500">
          Vérifiez visuellement vos cartes via le CDN <code class="text-slate-700 font-mono">assets.tcgdex.net</code> et ajustez les quantités à la volée.
        </p>
      </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3.5">
      <div
        v-for="card in cards.filter(c => c.quantity > 0)"
        :key="card.uid"
        class="group bg-slate-50 hover:bg-white border border-slate-200 hover:border-blue-200 rounded-xl p-2.5 flex flex-col gap-2 transition shadow-xs"
      >
        <!-- Visuel de la carte -->
        <div class="relative aspect-[2.5/3.5] w-full rounded-lg overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
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
            class="p-3 text-center flex flex-col items-center justify-center gap-1 text-slate-500"
          >
            <span class="text-xs font-bold text-slate-900">{{ card.nameFr }}</span>
            <span class="text-[11px] font-mono text-blue-700">{{ card.cardId }}</span>
          </div>

          <!-- Badge de quantité en haut à droite -->
          <div class="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-white/95 border border-slate-200 text-slate-900 font-mono font-bold text-xs shadow-xs">
            ×{{ card.quantity }}
          </div>
        </div>

        <!-- Infos et Contrôles rapides -->
        <div class="flex flex-col gap-1.5">
          <div class="font-semibold text-xs text-slate-900 truncate" :title="card.nameFr">
            {{ card.nameFr }}
          </div>

          <div class="flex items-center justify-between gap-1">
            <button
              type="button"
              @click="copyId(card.cardId)"
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white hover:bg-blue-50 border border-slate-200 text-[11px] font-mono text-blue-700 transition cursor-pointer"
              title="Copier le cardId"
            >
              <span>{{ card.cardId }}</span>
              <Check v-if="copiedCardId === card.cardId" class="w-3 h-3 text-emerald-600" />
              <Copy v-else class="w-2.5 h-2.5 opacity-60" />
            </button>

            <div class="inline-flex items-center gap-1">
              <button
                type="button"
                @click="emit('update-quantity', card.uid, Math.max(0, card.quantity - 1))"
                class="w-6 h-6 rounded bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-600 border border-slate-200 flex items-center justify-center transition cursor-pointer shadow-2xs"
              >
                <Minus class="w-3 h-3" />
              </button>
              <button
                type="button"
                @click="emit('update-quantity', card.uid, card.quantity + 1)"
                class="w-6 h-6 rounded bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-600 border border-slate-200 flex items-center justify-center transition cursor-pointer shadow-2xs"
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
