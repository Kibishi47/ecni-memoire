<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import type { EngineCardModel } from '../types/cardModel'
import type { ParsedDeckEntry } from '../types/deck'
import { getCardImageUrl } from '../utils/cardImage'
import { useI18n } from '../utils/i18n'
import { useBugReport } from '../services/useBugReport'

const props = defineProps<{
  card: ParsedDeckEntry | EngineCardModel | null
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t, getLocalizedCardName, getLocalizedSubCategory, getLocalizedCardRules } = useI18n()

const bugReport = useBugReport()

watch(
  () => props.card,
  () => {
    bugReport.reset()
  },
)

function submitCardIssue() {
  const resolvedId =
    cardModel.value?.cardId ||
    (props.card && 'cardId' in props.card ? props.card.cardId : '')
  if (!resolvedId) return
  void bugReport.submit({
    type: 'CARD_MODEL_ERROR',
    cardId: resolvedId,
    matchLogs: null,
  })
}

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

const cardModel = computed<EngineCardModel | null>(() => {
  if (!props.card) return null
  if ('model' in props.card && props.card.model) return props.card.model
  if ('playableActions' in props.card) return props.card as EngineCardModel
  return null
})

function getCardSubCat(card: ParsedDeckEntry | EngineCardModel): string {
  const raw =
    'subCategory' in card && card.subCategory
      ? card.subCategory
      : 'identity' in card
        ? card.identity?.subCategory
        : ''
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
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <div
      class="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl sm:flex-row"
    >
      <!-- Bouton Fermer -->
      <button
        type="button"
        @click="emit('close')"
        :aria-label="t('closeModal')"
        class="absolute right-3.5 top-3.5 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-300 transition hover:bg-slate-700 hover:text-white"
      >
        ✕
      </button>

      <!-- Colonne Gauche : Visuel Haute Résolution -->
      <div class="flex items-center justify-center bg-slate-950 p-6 sm:w-5/12">
        <img
          v-if="getCardImageUrl(card, 'high')"
          :src="getCardImageUrl(card, 'high')!"
          :alt="getLocalizedCardName(card)"
          class="max-h-[75vh] w-auto rounded-xl object-contain shadow-2xl transition hover:scale-102"
        />
        <div
          v-else
          class="flex h-72 w-52 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 font-mono text-sm text-slate-400"
        >
          {{ getLocalizedCardName(card) }}
        </div>
      </div>

      <!-- Colonne Droite : Fiche Descriptive -->
      <div class="flex flex-1 flex-col justify-between overflow-y-auto p-6 sm:w-7/12">
        <div>
          <!-- ENTÊTE DE LA CARTE -->
          <div class="flex items-center gap-2">
            <span class="rounded bg-indigo-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-300">
              {{ getCardSubCat(card) }}
            </span>
            <span
              v-if="getCardHp(card)"
              class="rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300"
            >
              {{ getCardHp(card) }} {{ t('cardHp') }}
            </span>
          </div>

          <h3 class="mt-2 text-2xl font-black text-white">
            {{ getLocalizedCardName(card) }}
          </h3>

          <div class="mt-1 font-mono text-xs text-slate-400">
            {{ getCardSetNumber(card) }}
          </div>

          <!-- RÈGLES ET EFFETS STANDARDS -->
          <div class="mt-5">
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400">
              {{ t('rulesAndEffects') }}
            </h4>
            <div class="mt-2 space-y-2 text-xs leading-relaxed text-slate-300">
              <p
                v-for="(rule, idx) in getLocalizedCardRules(card)"
                :key="idx"
                class="rounded-lg border border-slate-700/60 bg-slate-800/80 p-3 shadow-2xs"
              >
                {{ rule }}
              </p>
              <p v-if="getLocalizedCardRules(card).length === 0" class="italic text-slate-500">
                {{ t('noRulesText') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Bouton Signalement & Bouton Fermer inférieur -->
        <div class="mt-6 space-y-3 border-t border-slate-800 pt-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              @click="bugReport.togglePanel()"
              class="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-900/50"
            >
              {{ t('reportCardIssueBtn') }}
            </button>
          </div>

          <div
            v-if="bugReport.isPanelOpen.value"
            class="space-y-2.5 rounded-xl border border-slate-700 bg-slate-950/90 p-3.5 text-xs"
          >
            <div class="font-bold text-slate-200">
              {{ t('reportTitleCard', { cardId: cardModel?.cardId || (card && 'cardId' in card ? card.cardId : '') }) }}
            </div>

            <textarea
              v-model="bugReport.comment.value"
              rows="3"
              maxlength="1000"
              :placeholder="t('reportCommentPlaceholder')"
              class="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-400 focus:outline-none"
            ></textarea>

            <div
              v-if="bugReport.error.value"
              class="rounded-lg border border-rose-500/50 bg-rose-950/60 px-2.5 py-1.5 text-xs text-rose-200"
            >
              {{ bugReport.error.value }}
            </div>

            <div
              v-if="bugReport.successResult.value"
              class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/50 bg-emerald-950/60 px-2.5 py-1.5 text-xs text-emerald-200"
            >
              <span>{{ t('reportSuccessMsg', { id: bugReport.successResult.value.reportId }) }}</span>
              <a
                v-if="bugReport.successResult.value.issueUrl"
                :href="bugReport.successResult.value.issueUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="font-bold underline hover:text-emerald-100"
              >
                {{ t('reportIssueLink') }}
              </a>
            </div>

            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                @click="bugReport.togglePanel()"
                class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                {{ t('reportCancelBtn') }}
              </button>
              <button
                type="button"
                :disabled="bugReport.isSubmitting.value"
                @click="submitCardIssue"
                class="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-rose-500 disabled:opacity-50"
              >
                {{ bugReport.isSubmitting.value ? t('reportSubmitting') : t('reportSubmitBtn') }}
              </button>
            </div>
          </div>

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
