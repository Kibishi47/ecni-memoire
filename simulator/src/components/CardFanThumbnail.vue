<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EngineCardModel } from '../types/cardModel'
import type { ParsedDeckEntry } from '../types/deck'
import { getCardImageUrl } from '../utils/cardImage'
import { useI18n } from '../utils/i18n'

type ThumbnailCardItem =
  | ParsedDeckEntry
  | EngineCardModel
  | {
      cardId?: string
      nameFr?: string
      nameEn?: string
      subCategory?: string
      category?: string
      setCode?: string
      number?: string
      imageUrl?: string | null
    }

const props = withDefaults(
  defineProps<{
    cards: ThumbnailCardItem[]
    size?: 'sm' | 'md'
    title?: string
  }>(),
  {
    size: 'sm',
    title: '',
  },
)

const emit = defineEmits<{
  (e: 'select'): void
}>()

const { t, getLocalizedCardName } = useI18n()

const failedImages = ref<Record<string, boolean>>({})

const validCards = computed(() => props.cards.filter(Boolean))

const fanCards = computed(() => validCards.value.slice(0, 2))

const extraCount = computed(() => Math.max(0, validCards.value.length - 2))

watch(
  () => props.cards,
  () => {
    failedImages.value = {}
  },
)

function getCardKey(card: ThumbnailCardItem, idx: number): string {
  const id = 'cardId' in card && card.cardId ? card.cardId : 'card'
  return `${id}_${idx}`
}

function resolveImgUrl(card: ThumbnailCardItem, idx: number): string | null {
  const key = getCardKey(card, idx)
  if (failedImages.value[key]) return null
  return getCardImageUrl(card, 'low')
}

function markFailed(card: ThumbnailCardItem, idx: number) {
  failedImages.value = {
    ...failedImages.value,
    [getCardKey(card, idx)]: true,
  }
}

function getFallbackLabel(card: ThumbnailCardItem): string {
  const name = getLocalizedCardName(card as any)
  if (name) return name.slice(0, 3).toUpperCase()
  return 'TCG'
}

const tooltipText = computed(() => {
  if (props.title) return props.title
  if (validCards.value.length > 1) {
    return t('clickToInspectCards', { n: validCards.value.length })
  }
  return t('clickToEnlarge')
})
</script>

<template>
  <button
    v-if="validCards.length > 0"
    type="button"
    @click.stop="emit('select')"
    :title="tooltipText"
    :aria-label="tooltipText"
    class="group relative inline-flex shrink-0 cursor-pointer items-center justify-center focus:outline-none"
    :class="
      validCards.length >= 2
        ? size === 'md'
          ? 'h-14 w-16'
          : 'h-12 w-14'
        : size === 'md'
          ? 'h-14 w-10'
          : 'h-11 w-8'
    "
  >
    <!-- Mode Multi-cartes (>= 2 cartes) : Visuel en V incliné -->
    <template v-if="fanCards.length >= 2">
      <!-- Carte gauche du V -->
      <div
        class="absolute bottom-0.5 left-1.5 z-0 origin-bottom-right -rotate-12 overflow-hidden rounded border border-slate-300 bg-slate-200 shadow-sm transition-transform duration-200 group-hover:-translate-x-1 group-hover:-rotate-[16deg]"
        :class="size === 'md' ? 'h-12 w-9' : 'h-11 w-8'"
      >
        <img
          v-if="resolveImgUrl(fanCards[0]!, 0)"
          :src="resolveImgUrl(fanCards[0]!, 0)!"
          :alt="getLocalizedCardName(fanCards[0] as any)"
          loading="lazy"
          @error="markFailed(fanCards[0]!, 0)"
          class="h-full w-full object-cover"
        />
        <div
          v-else
          class="flex h-full w-full items-center justify-center bg-slate-200 font-bold text-slate-600 text-[9px]"
        >
          {{ getFallbackLabel(fanCards[0]!) }}
        </div>
      </div>

      <!-- Carte droite du V -->
      <div
        class="absolute bottom-0.5 right-1.5 z-10 origin-bottom-left rotate-12 overflow-hidden rounded border border-slate-300 bg-slate-200 shadow-md transition-transform duration-200 group-hover:translate-x-1 group-hover:rotate-[16deg]"
        :class="size === 'md' ? 'h-12 w-9' : 'h-11 w-8'"
      >
        <img
          v-if="resolveImgUrl(fanCards[1]!, 1)"
          :src="resolveImgUrl(fanCards[1]!, 1)!"
          :alt="getLocalizedCardName(fanCards[1] as any)"
          loading="lazy"
          @error="markFailed(fanCards[1]!, 1)"
          class="h-full w-full object-cover"
        />
        <div
          v-else
          class="flex h-full w-full items-center justify-center bg-slate-200 font-bold text-slate-600 text-[9px]"
        >
          {{ getFallbackLabel(fanCards[1]!) }}
        </div>
      </div>

      <!-- Pastille si 3+ cartes liées -->
      <span
        v-if="extraCount > 0"
        class="absolute -bottom-1 -right-0.5 z-20 rounded-full bg-slate-900 px-1 py-0 text-[9px] font-bold text-white ring-1 ring-white shadow-xs"
      >
        +{{ extraCount }}
      </span>
    </template>

    <!-- Mode Carte Unique -->
    <div
      v-else
      class="h-full w-full overflow-hidden rounded border border-slate-200 bg-slate-100 shadow-xs transition-transform duration-200 group-hover:scale-105 group-hover:border-slate-400"
    >
      <img
        v-if="resolveImgUrl(fanCards[0]!, 0)"
        :src="resolveImgUrl(fanCards[0]!, 0)!"
        :alt="getLocalizedCardName(fanCards[0] as any)"
        loading="lazy"
        @error="markFailed(fanCards[0]!, 0)"
        class="h-full w-full object-cover"
      />
      <div
        v-else
        class="flex h-full w-full items-center justify-center bg-slate-200 font-bold text-slate-600 text-[9px]"
      >
        {{ getFallbackLabel(fanCards[0]!) }}
      </div>
    </div>
  </button>
</template>
