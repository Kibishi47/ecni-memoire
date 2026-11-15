<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EngineCardModel } from '@olydor/types'
import type { ParsedDeckEntry } from '@olydor/types'
import { getCardImageUrl } from '../utils/cardImage'
import { buildHumanReadableAiBreakdown } from '@olydor/engine'
import { useI18n } from '../utils/i18n'
import { useBugReport } from '../services/useBugReport'

type ModalTab = 'info' | 'ai'

const props = withDefaults(
  defineProps<{
    card?: ParsedDeckEntry | EngineCardModel | null
    cards?: Array<ParsedDeckEntry | EngineCardModel>
    initialIndex?: number
    isOpen: boolean
  }>(),
  {
    card: null,
    cards: () => [],
    initialIndex: 0,
  },
)

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t, currentLang, getLocalizedCardName, getLocalizedSubCategory, getLocalizedCardRules } = useI18n()

const bugReport = useBugReport()
const activeTab = ref<ModalTab>('info')
const activeIndex = ref<number>(0)
const highImgFailed = ref<boolean>(false)

const resolvedCards = computed<Array<ParsedDeckEntry | EngineCardModel>>(() => {
  if (props.cards && props.cards.length > 0) {
    return props.cards.filter(Boolean)
  }
  if (props.card) {
    return [props.card]
  }
  return []
})

const hasMultipleCards = computed(() => resolvedCards.value.length > 1)

const activeCard = computed<ParsedDeckEntry | EngineCardModel | null>(() => {
  if (resolvedCards.value.length === 0) return null
  const clamped = Math.max(0, Math.min(activeIndex.value, resolvedCards.value.length - 1))
  return resolvedCards.value[clamped] ?? null
})

function syncInitialIndex() {
  const list = resolvedCards.value
  if (list.length === 0) {
    activeIndex.value = 0
    return
  }
  let idx = props.initialIndex ?? 0
  if (idx < 0 || idx >= list.length) {
    idx = 0
  }
  activeIndex.value = idx
}

watch(
  () => [props.isOpen, props.card, props.cards, props.initialIndex],
  () => {
    syncInitialIndex()
    highImgFailed.value = false
    bugReport.reset()
  },
  { immediate: true },
)

watch(
  () => activeIndex.value,
  () => {
    highImgFailed.value = false
    bugReport.reset()
  },
)

function prevCard() {
  const len = resolvedCards.value.length
  if (len <= 1) return
  activeIndex.value = (activeIndex.value - 1 + len) % len
}

function nextCard() {
  const len = resolvedCards.value.length
  if (len <= 1) return
  activeIndex.value = (activeIndex.value + 1) % len
}

function selectCardAt(idx: number) {
  if (idx < 0 || idx >= resolvedCards.value.length) return
  activeIndex.value = idx
}

function submitCardIssue() {
  const current = activeCard.value
  const resolvedId =
    cardModel.value?.cardId ||
    (current && 'cardId' in current ? current.cardId : '')
  if (!resolvedId) return
  void bugReport.submit({
    type: 'CARD_MODEL_ERROR',
    cardId: resolvedId,
    matchLogs: null,
  })
}

function handleKeyDown(e: KeyboardEvent) {
  if (!props.isOpen) return
  if (e.key === 'Escape') {
    emit('close')
  } else if (e.key === 'ArrowLeft' && hasMultipleCards.value) {
    e.preventDefault()
    prevCard()
  } else if (e.key === 'ArrowRight' && hasMultipleCards.value) {
    e.preventDefault()
    nextCard()
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
  const current = activeCard.value
  if (!current) return null
  if ('model' in current && current.model) return current.model
  if ('playableActions' in current) return current as EngineCardModel
  return null
})

const aiBreakdown = computed(() =>
  buildHumanReadableAiBreakdown(activeCard.value, currentLang.value),
)

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
    v-if="isOpen && activeCard"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-2 sm:p-4 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <div class="relative flex w-full max-w-5xl items-center justify-center gap-2 sm:gap-4" @click.self="emit('close')">
      <!-- Flèche Gauche (Côté gauche de la modal) -->
      <button
        v-if="hasMultipleCards"
        type="button"
        @click.stop="prevCard"
        :aria-label="t('prevCard')"
        :title="t('prevCard')"
        class="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#263044] bg-[#1b2232]/95 text-[#f8fafc] shadow-lg transition hover:border-[#ff6b00] hover:bg-[#ff6b00] hover:text-white focus:outline-none"
      >
        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <!-- Boîte Modal Principale -->
      <div
        class="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#263044] bg-[#131823] text-[#f8fafc] shadow-2xl sm:flex-row"
      >
        <!-- Flèches mobiles compactes superposées -->
        <button
          v-if="hasMultipleCards"
          type="button"
          @click.stop="prevCard"
          :aria-label="t('prevCard')"
          class="sm:hidden absolute left-2 top-36 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-[#263044] bg-[#1b2232]/90 text-[#f8fafc] shadow-md hover:bg-[#ff6b00] hover:text-white"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          v-if="hasMultipleCards"
          type="button"
          @click.stop="nextCard"
          :aria-label="t('nextCard')"
          class="sm:hidden absolute right-2 top-36 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-[#263044] bg-[#1b2232]/90 text-[#f8fafc] shadow-md hover:bg-[#ff6b00] hover:text-white"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- Bouton Fermer -->
        <button
          type="button"
          @click="emit('close')"
          :aria-label="t('closeModal')"
          class="absolute right-3.5 top-3.5 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-[#263044] bg-[#1b2232] text-[#8a93a2] transition hover:bg-[#263044] hover:text-[#f8fafc]"
        >
          ✕
        </button>

        <!-- Colonne Gauche : Visuel Haute Résolution + Sélecteur rapide multi-cartes -->
        <div class="flex flex-col items-center justify-center gap-3 border-b border-[#263044] bg-[#0c0f16] p-5 sm:w-5/12 sm:border-b-0 sm:border-r sm:p-6">
          <img
            v-if="getCardImageUrl(activeCard, 'high') && !highImgFailed"
            :src="getCardImageUrl(activeCard, 'high')!"
            :alt="getLocalizedCardName(activeCard)"
            @error="highImgFailed = true"
            class="max-h-[68vh] w-auto rounded-xl object-contain shadow-2xl transition hover:scale-[1.02]"
          />
          <div
            v-else
            class="flex h-72 w-52 items-center justify-center rounded-xl border border-[#263044] bg-[#131823] p-4 text-center font-mono text-sm text-[#8a93a2]"
          >
            {{ getLocalizedCardName(activeCard) }}
          </div>

          <!-- Navigation compacte multi-cartes sous l'image -->
          <div v-if="hasMultipleCards" class="flex flex-wrap items-center justify-center gap-1.5">
            <span class="rounded-full border border-[#263044] bg-[#1b2232] px-2.5 py-0.5 font-mono text-[11px] font-bold text-indigo-300">
              {{ t('cardCounter', { current: activeIndex + 1, total: resolvedCards.length }) }}
            </span>
            <div class="flex flex-wrap justify-center gap-1">
              <button
                v-for="(cItem, cIdx) in resolvedCards"
                :key="cIdx"
                type="button"
                @click="selectCardAt(cIdx)"
                class="max-w-[130px] truncate rounded-md border px-2 py-0.5 text-[10px] font-semibold transition"
                :class="
                  cIdx === activeIndex
                    ? 'border-[#ff6b00] bg-[#ff6b00] text-white'
                    : 'border-[#263044] bg-[#131823] text-[#8a93a2] hover:bg-[#1b2232] hover:text-[#f8fafc]'
                "
              >
                {{ getLocalizedCardName(cItem) }}
              </button>
            </div>
          </div>
        </div>

        <!-- Colonne Droite : Entête + 2 Onglets + Footer Signalement Toujours Accessible -->
        <div class="flex flex-1 flex-col overflow-hidden p-5 sm:w-7/12 sm:p-6">
          <!-- ENTÊTE DE LA CARTE -->
          <div class="pr-8">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded bg-sky-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-300">
                {{ getCardSubCat(activeCard) }}
              </span>
              <span
                v-if="getCardHp(activeCard)"
                class="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300"
              >
                {{ getCardHp(activeCard) }} {{ t('cardHp') }}
              </span>
              <span v-if="hasMultipleCards" class="rounded border border-[#263044] bg-[#1b2232] px-2 py-0.5 font-mono text-[10px] text-[#8a93a2]">
                {{ t('cardCounter', { current: activeIndex + 1, total: resolvedCards.length }) }}
              </span>
            </div>

            <h3 class="mt-2 text-2xl font-black text-[#f8fafc]">
              {{ getLocalizedCardName(activeCard) }}
            </h3>

            <div class="mt-0.5 font-mono text-xs text-[#8a93a2]">
              {{ getCardSetNumber(activeCard) }}
            </div>
          </div>

          <!-- BARRE DES 2 ONGLETS -->
          <div class="mt-4 flex gap-1.5 border-b border-[#263044] pb-2.5">
            <button
              type="button"
              @click="activeTab = 'info'"
              class="rounded-lg border px-3.5 py-1.5 text-xs font-bold transition"
              :class="
                activeTab === 'info'
                  ? 'border-[#ff6b00] bg-[#ff6b00] text-white shadow-xs'
                  : 'border-[#263044] bg-[#1b2232] text-[#8a93a2] hover:bg-[#263044] hover:text-[#f8fafc]'
              "
            >
              {{ t('tabCardInfo') }}
            </button>
            <button
              type="button"
              @click="activeTab = 'ai'"
              class="rounded-lg border px-3.5 py-1.5 text-xs font-bold transition"
              :class="
                activeTab === 'ai'
                  ? 'border-[#ff6b00] bg-[#ff6b00] text-white shadow-xs'
                  : 'border-[#263044] bg-[#1b2232] text-[#8a93a2] hover:bg-[#263044] hover:text-[#f8fafc]'
              "
            >
              {{ t('tabCardAiLogic') }}
            </button>
          </div>

          <!-- CONTENU SCROLLABLE DE L'ONGLET ACTIF -->
          <div class="mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
            <!-- ONGLET 1 : INFORMATIONS DE BASE -->
            <div v-if="activeTab === 'info'" class="space-y-3">
              <h4 class="text-xs font-bold uppercase tracking-wider text-[#8a93a2]">
                {{ t('rulesAndEffects') }}
              </h4>
              <div class="space-y-2 text-xs leading-relaxed text-[#f8fafc]">
                <p
                  v-for="(rule, idx) in getLocalizedCardRules(activeCard)"
                  :key="idx"
                  class="rounded-lg border border-[#263044] bg-[#0c0f16] p-3 shadow-2xs"
                >
                  {{ rule }}
                </p>
                <p v-if="getLocalizedCardRules(activeCard).length === 0" class="italic text-[#8a93a2]">
                  {{ t('noRulesText') }}
                </p>
              </div>
            </div>

            <!-- ONGLET 2 : MODÈLE IA EXPLIQUÉ EN LANGAGE CLAIR (SANS JARGON / SANS JSON BRUT) -->
            <div v-else class="space-y-4">
              <template v-if="aiBreakdown">
                <!-- Rôle stratégique & caractéristiques -->
                <div class="rounded-xl border border-slate-700/70 bg-slate-800/70 p-3.5">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="text-[11px] font-bold uppercase tracking-wider text-[#8a93a2]">
                      {{ t('aiRoleLabel') }}
                    </span>
                    <span class="rounded-md bg-sky-500/15 px-2.5 py-0.5 text-xs font-bold text-indigo-200">
                      {{ aiBreakdown.roleLabel }}
                    </span>
                  </div>
                  <p class="mt-2 text-xs leading-relaxed text-slate-200">
                    {{ aiBreakdown.roleDescription }}
                  </p>

                  <div
                    v-if="aiBreakdown.traitBadges.length > 0 || aiBreakdown.evolutionChainText || aiBreakdown.retreatText"
                    class="mt-2.5 flex flex-wrap gap-1.5 border-t border-slate-700/60 pt-2.5 text-[11px]"
                  >
                    <span
                      v-for="(badge, bIdx) in aiBreakdown.traitBadges"
                      :key="bIdx"
                      class="rounded bg-slate-700/80 px-2 py-0.5 font-semibold text-slate-200"
                    >
                      {{ badge }}
                    </span>
                    <span
                      v-if="aiBreakdown.evolutionChainText"
                      class="rounded bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-200"
                    >
                      {{ t('aiEvolutionLine') }} : {{ aiBreakdown.evolutionChainText }}
                    </span>
                    <span
                      v-if="aiBreakdown.retreatText"
                      class="rounded bg-slate-700/80 px-2 py-0.5 text-[#8a93a2]"
                    >
                      {{ aiBreakdown.retreatText }}
                    </span>
                  </div>
                </div>

                <!-- Importance selon la phase de partie -->
                <div class="rounded-xl border border-slate-700/70 bg-slate-800/50 p-3.5">
                  <h4 class="text-[11px] font-bold uppercase tracking-wider text-[#8a93a2]">
                    {{ t('aiPhasePriorityTitle') }}
                  </h4>
                  <div class="mt-2.5 space-y-2">
                    <div
                      v-for="phase in aiBreakdown.phasePriorities"
                      :key="phase.key"
                      class="space-y-1"
                    >
                      <div class="flex items-center justify-between text-[11px]">
                        <span class="font-semibold text-slate-200">{{ phase.label }}</span>
                        <span
                          class="font-semibold"
                          :class="
                            phase.tier === 'high'
                              ? 'text-emerald-300'
                              : phase.tier === 'medium'
                                ? 'text-indigo-300'
                                : 'text-[#8a93a2]'
                          "
                        >
                          {{ phase.badge }} ({{ phase.pct }} %)
                        </span>
                      </div>
                      <div class="h-2 w-full overflow-hidden rounded-full bg-[#263044]">
                        <div
                          class="h-full rounded-full transition-all"
                          :class="
                            phase.tier === 'high'
                              ? 'bg-emerald-500'
                              : phase.tier === 'medium'
                                ? 'bg-sky-500'
                                : 'bg-slate-500'
                          "
                          :style="{ width: `${phase.pct}%` }"
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Réflexes de l'IA & Synergies -->
                <div class="rounded-xl border border-slate-700/70 bg-slate-800/50 p-3.5 space-y-3">
                  <div>
                    <h4 class="text-[11px] font-bold uppercase tracking-wider text-[#8a93a2]">
                      {{ t('aiDecisionHabitsTitle') }}
                    </h4>
                    <ul class="mt-1.5 space-y-1 text-xs text-[#8a93a2]">
                      <li v-for="(habit, hIdx) in aiBreakdown.behaviorInsights" :key="hIdx">
                        • {{ habit }}
                      </li>
                    </ul>
                  </div>

                  <div v-if="aiBreakdown.synergies.length > 0" class="border-t border-slate-700/60 pt-2.5">
                    <h5 class="text-[11px] font-bold uppercase tracking-wider text-[#8a93a2]">
                      {{ t('aiDeckSynergiesTitle') }}
                    </h5>
                    <ul class="mt-1.5 space-y-1 text-xs">
                      <li
                        v-for="(syn, sIdx) in aiBreakdown.synergies"
                        :key="sIdx"
                        :class="syn.critical ? 'text-[#f8fafc] font-semibold' : 'text-[#8a93a2]'"
                      >
                        • {{ syn.text }}
                      </li>
                    </ul>
                  </div>

                  <div v-if="aiBreakdown.deadConditions.length > 0" class="border-t border-slate-700/60 pt-2.5">
                    <h5 class="text-[11px] font-bold uppercase tracking-wider text-[#8a93a2]">
                      {{ t('aiDeadConditionsTitle') }}
                    </h5>
                    <ul class="mt-1.5 space-y-1 text-xs text-[#8a93a2]">
                      <li v-for="(dead, dIdx) in aiBreakdown.deadConditions" :key="dIdx">
                        • {{ dead }}
                      </li>
                    </ul>
                  </div>
                </div>

                <!-- Actions et effets simulés -->
                <div class="space-y-2.5">
                  <h4 class="text-[11px] font-bold uppercase tracking-wider text-[#8a93a2]">
                    {{ t('aiHowItWorksTitle') }}
                  </h4>

                  <div
                    v-if="aiBreakdown.actions.length === 0"
                    class="rounded-xl border border-slate-800 bg-slate-800/40 p-3 text-xs italic text-[#8a93a2]"
                  >
                    {{ t('aiNoActionsDefined') }}
                  </div>

                  <div
                    v-for="act in aiBreakdown.actions"
                    :key="act.actionId"
                    class="rounded-xl border border-slate-700/70 bg-slate-800/70 p-3.5 text-xs space-y-2"
                  >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div class="font-bold text-[#f8fafc]">{{ act.title }}</div>
                      <span class="rounded bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-indigo-300">
                        {{ act.actionTypeLabel }}
                      </span>
                    </div>

                    <div class="flex flex-wrap gap-1.5 text-[11px]">
                      <span class="rounded border border-[#263044] bg-[#0c0f16] px-2 py-0.5 text-[#8a93a2]">
                        {{ act.timingLabel }}
                      </span>
                      <span
                        v-for="(hint, tIdx) in act.turn1Hints"
                        :key="tIdx"
                        class="rounded border border-[#263044] bg-[#0c0f16] px-2 py-0.5 text-[#8a93a2]"
                      >
                        {{ hint }}
                      </span>
                      <span
                        v-for="(costBadge, cIdx) in act.costs"
                        :key="`c_${cIdx}`"
                        class="rounded border border-[#263044] bg-[#1b2232] px-2 py-0.5 font-semibold text-[#f8fafc]"
                      >
                        {{ costBadge }}
                      </span>
                    </div>

                    <div v-if="act.preconditions.length > 0" class="space-y-0.5 text-[11px] text-[#f8fafc]">
                      <div class="font-semibold text-[#8a93a2]">{{ t('aiPreconditionsLabel') }} :</div>
                      <div v-for="(pre, pIdx) in act.preconditions" :key="pIdx">
                        • {{ pre }}
                      </div>
                    </div>

                    <div v-if="act.effectSentences.length > 0" class="space-y-1 rounded-lg border border-[#263044] bg-[#0c0f16]/90 p-2.5 text-[#f8fafc]">
                      <div v-for="(sentence, eIdx) in act.effectSentences" :key="eIdx">
                        {{ sentence }}
                      </div>
                    </div>

                    <div v-if="act.deadConditionNote" class="text-[11px] italic text-[#8a93a2]">
                      {{ t('aiDeadCardCondition') }} : {{ act.deadConditionNote }}
                    </div>
                  </div>
                </div>
              </template>

              <p v-else class="italic text-xs text-[#8a93a2]">
                {{ t('aiNoAiModelAvailable') }}
              </p>
            </div>
          </div>

          <!-- BOUTON SIGNALEMENT & BOUTON FERMER TOUJOURS ACCESSIBLES HORS DES ONGLETS -->
          <div class="mt-4 space-y-3 border-t border-slate-800 pt-3.5 shrink-0">
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
              class="space-y-2.5 rounded-xl border border-[#263044] bg-[#0c0f16] p-3.5 text-xs"
            >
              <div class="font-bold text-slate-200">
                {{ t('reportTitleCard', { cardId: cardModel?.cardId || (activeCard && 'cardId' in activeCard ? activeCard.cardId : '') }) }}
              </div>

              <textarea
                v-model="bugReport.comment.value"
                rows="3"
                maxlength="1000"
                :placeholder="t('reportCommentPlaceholder')"
                class="w-full rounded-lg border border-[#263044] bg-[#131823] p-2.5 text-xs text-[#f8fafc] placeholder-[#8a93a2] focus:border-[#ff6b00] focus:outline-none"
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
                  class="rounded-lg border border-[#263044] px-3 py-1.5 text-xs font-semibold text-[#8a93a2] hover:bg-[#1b2232] hover:text-[#f8fafc]"
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
              class="w-full rounded-xl border border-[#263044] bg-[#1b2232] py-2.5 text-xs font-bold text-[#f8fafc] transition hover:bg-[#263044]"
            >
              {{ t('closeModal') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Flèche Droite (Côté droit de la modal) -->
      <button
        v-if="hasMultipleCards"
        type="button"
        @click.stop="nextCard"
        :aria-label="t('nextCard')"
        :title="t('nextCard')"
        class="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#263044] bg-[#1b2232]/95 text-[#f8fafc] shadow-lg transition hover:border-[#ff6b00] hover:bg-[#ff6b00] hover:text-white focus:outline-none"
      >
        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  </div>
</template>
