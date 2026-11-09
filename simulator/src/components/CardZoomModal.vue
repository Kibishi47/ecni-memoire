<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import type { EngineCardModel } from '../types/cardModel'
import type { ParsedDeckEntry } from '../types/deck'
import { getCardImageUrl } from '../utils/cardImage'
import { useI18n } from '../utils/i18n'

const props = defineProps<{
  card: ParsedDeckEntry | EngineCardModel | null
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t, getLocalizedCardName, getLocalizedSubCategory, getLocalizedCardRules } = useI18n()

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.isOpen) {
    emit('close')
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown)
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleKeyDown)
  }
})

function getCardSubCat(card: ParsedDeckEntry | EngineCardModel): string {
  const raw = 'subCategory' in card && card.subCategory ? card.subCategory : ('identity' in card ? card.identity?.subCategory : '')
  return getLocalizedSubCategory(raw)
}

function getCardHp(card: ParsedDeckEntry | EngineCardModel): number | null {
  if ('model' in card && card.model?.pokemonStats?.hp) return card.model.pokemonStats.hp
  if ('pokemonStats' in card && card.pokemonStats?.hp) return card.pokemonStats.hp
  return null
}

function getCardSetNumber(card: ParsedDeckEntry | EngineCardModel): string {
  if ('setCode' in card && card.setCode && 'number' in card && card.number) {
    return `${card.setCode} ${card.number}`
  }
  if ('identity' in card && card.identity?.setId && card.identity?.localId) {
    return `${card.identity.setId.toUpperCase()} ${card.identity.localId}`
  }
  if ('cardId' in card && card.cardId) {
    return card.cardId
  }
  return ''
}
</script>

<template>
  <div
    v-if="isOpen && card"
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <div
      class="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl sm:flex-row"
    >
      <!-- Bouton Fermer -->
      <button
        type="button"
        @click="emit('close')"
        :aria-label="t('closeModal')"
        class="absolute right-3.5 top-3.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition"
      >
        ✕
      </button>

      <!-- Colonne Visuel de la Carte en Haute Résolution -->
      <div class="flex items-center justify-center bg-slate-950 p-6 sm:w-1/2">
        <img
          v-if="getCardImageUrl(card, 'high')"
          :src="getCardImageUrl(card, 'high')!"
          :alt="getLocalizedCardName(card)"
          class="max-h-[70vh] w-auto rounded-xl object-contain shadow-2xl transition hover:scale-102"
        />
        <div
          v-else
          class="flex h-72 w-52 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 font-mono text-sm text-slate-400"
        >
          {{ getLocalizedCardName(card) }}
        </div>
      </div>

      <!-- Colonne Fiche Descriptive & Effets -->
      <div class="flex flex-1 flex-col justify-between overflow-y-auto p-6 sm:w-1/2">
        <div>
          <div class="flex items-center gap-2">
            <span class="rounded bg-indigo-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-300">
              {{ getCardSubCat(card) }}
            </span>
            <span v-if="getCardHp(card)" class="rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300">
              {{ getCardHp(card) }} {{ t('cardHp') }}
            </span>
          </div>

          <h3 class="mt-2 text-2xl font-black text-white">
            {{ getLocalizedCardName(card) }}
          </h3>

          <div class="mt-1 font-mono text-xs text-slate-400">
            {{ getCardSetNumber(card) }}
          </div>

          <div class="mt-5">
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400">
              {{ t('rulesAndEffects') }}
            </h4>
            <div class="mt-2 space-y-2 text-xs leading-relaxed text-slate-300">
              <p
                v-for="(rule, idx) in getLocalizedCardRules(card)"
                :key="idx"
                class="rounded-lg bg-slate-800/80 p-2.5 border border-slate-700/60"
              >
                {{ rule }}
              </p>
              <p v-if="getLocalizedCardRules(card).length === 0" class="italic text-slate-500">
                {{ t('noRulesText') }}
              </p>
            </div>
          </div>
        </div>

        <div class="mt-6 border-t border-slate-800 pt-4">
          <button
            type="button"
            @click="emit('close')"
            class="w-full rounded-xl bg-slate-800 py-2.5 text-xs font-bold text-white transition hover:bg-slate-700"
          >
            {{ t('closeModal') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
