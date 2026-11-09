<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ParsedDeck, ParsedDeckEntry } from '../types/deck'
import { getCardImageUrl } from '../utils/cardImage'
import { useI18n } from '../utils/i18n'
import CardZoomModal from './CardZoomModal.vue'

const props = defineProps<{
  rawDeckText: string
  validatedDeck: ParsedDeck
  isDebugMode?: boolean
}>()

const emit = defineEmits<{
  (e: 'validate-deck', rawText: string): void
  (e: 'proceed-step2'): void
}>()

const { t, currentLang, getLocalizedCardName, getLocalizedSubCategory } = useI18n()

const localText = ref(props.rawDeckText)
const hasValidatedCurrentInput = ref(false)
const zoomedCard = ref<ParsedDeckEntry | null>(null)

watch(
  () => props.rawDeckText,
  (val) => {
    localText.value = val
    if (val && props.validatedDeck.cards.length > 0) {
      hasValidatedCurrentInput.value = true
    }
  },
  { immediate: true },
)

function onInputTextChange() {
  hasValidatedCurrentInput.value = false
}

function handleValidateClick() {
  if (!localText.value.trim()) return
  emit('validate-deck', localText.value)
  hasValidatedCurrentInput.value = true
}

const isReadyToProceed = computed(() => {
  return (
    hasValidatedCurrentInput.value &&
    props.validatedDeck.isValid60 &&
    props.validatedDeck.isFullyResolved &&
    props.validatedDeck.cards.length > 0
  )
})

const pokemonCards = computed<ParsedDeckEntry[]>(() =>
  props.validatedDeck.cards.filter((c) => c.category === 'pokemon'),
)
const trainerCards = computed<ParsedDeckEntry[]>(() =>
  props.validatedDeck.cards.filter((c) => c.category === 'trainer'),
)
const energyCards = computed<ParsedDeckEntry[]>(() =>
  props.validatedDeck.cards.filter((c) => c.category === 'energy'),
)

function handleImgError(event: Event) {
  const target = event.target as HTMLElement
  if (target) {
    target.style.display = 'none'
  }
}

function openCardZoom(card: ParsedDeckEntry) {
  zoomedCard.value = card
}

function closeCardZoom() {
  zoomedCard.value = null
}
</script>

<template>
  <div class="space-y-6">
    <!-- SECTION HERO INTUITIVE -->
    <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div class="bg-gradient-to-r from-slate-900 via-slate-850 to-indigo-950 px-6 py-8 text-white sm:px-8">
        <div class="max-w-3xl">
          <span class="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-indigo-200 backdrop-blur">
            {{ t('heroBadge') }}
          </span>
          <h1 class="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl">
            {{ t('heroTitle') }}
          </h1>
          <p class="mt-2 text-sm leading-relaxed text-slate-300 sm:text-base">
            {{ t('heroDescription') }}
          </p>

          <div class="mt-5 flex flex-wrap gap-4 text-xs font-medium text-slate-200">
            <div class="flex items-center gap-2">
              <svg class="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{{ t('profileBalancedDesc') }}</span>
            </div>
            <div class="flex items-center gap-2">
              <svg class="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{{ t('metaMatchupsTitle') }}</span>
            </div>
            <div class="flex items-center gap-2">
              <svg class="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{{ t('step3Title') }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ZONE D'IMPORT ET VALIDATION DU DECK -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <!-- Colonne Gauche : Saisie de la liste PTCGL -->
      <div class="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-5">
        <div class="mb-3 flex items-center justify-between">
          <label for="ptcgl-decklist-input" class="text-xs font-bold uppercase tracking-wider text-slate-700">
            Decklist Pokémon TCG Live
          </label>
          <span class="text-xs text-slate-400 font-mono">
            {{ t('formatQtyNameCode') }}
          </span>
        </div>

        <textarea
          id="ptcgl-decklist-input"
          v-model="localText"
          @input="onInputTextChange"
          rows="18"
          spellcheck="false"
          :placeholder="t('pasteDeckPlaceholder')"
          class="w-full flex-1 rounded-xl border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs leading-relaxed text-slate-800 placeholder-slate-400 transition focus:border-slate-900 focus:bg-white focus:outline-none"
        ></textarea>

        <!-- Bouton unique d'action -->
        <div class="mt-4">
          <button
            v-if="!isReadyToProceed"
            type="button"
            :disabled="!localText.trim()"
            @click="handleValidateClick"
            class="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-900 bg-slate-900 py-3 text-sm font-bold text-white shadow-xs transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:border-slate-300"
          >
            <span>{{ t('importButton') }}</span>
            <span v-if="localText.trim()" class="rounded bg-white/20 px-2 py-0.5 text-xs">
              {{ validatedDeck.totalCards }} / 60
            </span>
          </button>

          <button
            v-else
            type="button"
            @click="emit('proceed-step2')"
            class="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-600 bg-emerald-600 py-3 text-sm font-bold text-white shadow-xs transition hover:bg-emerald-700 active:bg-emerald-800"
          >
            <span>{{ t('btnConfigure') }}</span>
            <span>→</span>
          </button>
        </div>
      </div>

      <!-- Colonne Droite : Statut de validation et diagnostic -->
      <div class="space-y-4 lg:col-span-7">
        <!-- Bannière d'état du deck -->
        <div
          class="rounded-2xl border p-5 transition"
          :class="[
            validatedDeck.totalCards === 0
              ? 'border-slate-200 bg-white'
              : validatedDeck.isValid60 && validatedDeck.isFullyResolved
                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
                : 'border-amber-200 bg-amber-50/70 text-amber-950',
          ]"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                :class="[
                  validatedDeck.totalCards === 0
                    ? 'bg-slate-100 text-slate-500'
                    : validatedDeck.isValid60 && validatedDeck.isFullyResolved
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-amber-500 text-white shadow-xs',
                ]"
              >
                <svg v-if="validatedDeck.isValid60 && validatedDeck.isFullyResolved" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span v-else-if="validatedDeck.totalCards === 0">0</span>
                <span v-else>!</span>
              </span>

              <div>
                <h3 class="text-base font-bold">
                  {{
                    validatedDeck.totalCards === 0
                      ? t('awaitingDecklist')
                      : validatedDeck.isValid60 && validatedDeck.isFullyResolved
                        ? `${t('deckValidated')} (${t('cardsRequired')})`
                        : `${t('deckIncomplete')} (${validatedDeck.totalCards} / 60)`
                  }}
                </h3>
                <p class="text-xs text-slate-600">
                  {{
                    validatedDeck.totalCards === 0
                      ? t('pasteDecklistPrompt')
                      : t('distinctCardsDetected', { n: validatedDeck.uniqueCardCount })
                  }}
                </p>
              </div>
            </div>

            <!-- Badges récapitulatifs -->
            <div v-if="validatedDeck.totalCards > 0" class="flex flex-wrap gap-2 text-xs">
              <span class="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 shadow-2xs">
                {{ t('pokemonCount') }} : {{ validatedDeck.pokemonCount }}
              </span>
              <span class="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 shadow-2xs">
                {{ t('trainerCount') }} : {{ validatedDeck.trainerCount }}
              </span>
              <span class="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 shadow-2xs">
                {{ t('energyCount') }} : {{ validatedDeck.energyCount }}
              </span>
            </div>
          </div>

          <!-- Alertes de non-résolution -->
          <div
            v-if="!validatedDeck.isFullyResolved && validatedDeck.unresolvedCount > 0"
            class="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-900"
          >
            <div class="font-bold">
              {{ t('unresolvedCardsTitle', { n: validatedDeck.unresolvedCount }) }}
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="unres in validatedDeck.unresolvedCards"
                :key="unres.uid"
                class="rounded border border-red-200 bg-white px-2 py-0.5 text-xs text-red-800"
              >
                {{ unres.quantity }}× {{ unres.name }} {{ unres.setCode }} {{ unres.number }}
              </span>
            </div>
          </div>

          <!-- Avertissements de format -->
          <ul
            v-if="validatedDeck.warnings.length > 0"
            class="mt-3 space-y-1 border-t border-slate-200/60 pt-2.5 text-xs text-slate-600"
          >
            <li v-for="(warn, wIdx) in validatedDeck.warnings" :key="wIdx">
              • {{ warn.message }}
            </li>
          </ul>
        </div>

        <!-- Diagnostic des synergies du deck -->
        <div v-if="validatedDeck.synergyAudit.length > 0" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700">
                {{ t('synergyAuditTitle') }}
              </h3>
              <p class="text-xs text-slate-500">
                {{ t('deckSynergyVerification') }}
              </p>
            </div>
            <span
              class="rounded-lg border px-2.5 py-1 text-xs font-bold"
              :class="
                validatedDeck.synergyAudit.every((s) => s.satisfied)
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              "
            >
              {{ t('synergiesValidated', { done: validatedDeck.synergyAudit.filter((s) => s.satisfied).length, total: validatedDeck.synergyAudit.length }) }}
            </span>
          </div>

          <div class="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div
              v-for="(item, idx) in validatedDeck.synergyAudit"
              :key="idx"
              class="flex items-center justify-between gap-3 rounded-xl border p-3 text-xs"
              :class="
                item.satisfied
                  ? 'border-slate-200 bg-slate-50/50'
                  : 'border-amber-200 bg-amber-50/60'
              "
            >
              <div>
                <div class="font-bold text-slate-800">
                  {{ currentLang === 'en' && item.cardNameEn ? item.cardNameEn : item.cardNameFr }}
                </div>
                <div class="mt-0.5 text-slate-500">
                  {{ currentLang === 'en' && item.descriptionEn ? item.descriptionEn : item.description }}
                </div>
              </div>
              <span
                class="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold"
                :class="item.satisfied ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'"
              >
                {{ item.satisfied ? t('synergySatisfied') : t('synergyMissing') }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- VISUALISATION DU DECK AVEC IMAGES DE CARTES ET ZOOM -->
    <div v-if="validatedDeck.cards.length > 0" class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <!-- Pokémon -->
      <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div class="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-sm font-bold text-slate-900">{{ t('pokemonCount') }}</h3>
          <span class="rounded-lg bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-bold text-slate-700">
            {{ validatedDeck.pokemonCount }} {{ t('cardsUnit') }}
          </span>
        </div>

        <ul class="space-y-3">
          <li
            v-for="card in pokemonCards"
            :key="card.uid"
            @click="openCardZoom(card)"
            class="group flex cursor-pointer items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-2 text-xs transition hover:border-slate-400 hover:bg-slate-100/70"
            :title="t('clickToEnlarge')"
          >
            <!-- Image de la carte avec zoom au clic -->
            <img
              v-if="getCardImageUrl(card)"
              :src="getCardImageUrl(card)!"
              :alt="getLocalizedCardName(card)"
              loading="lazy"
              @error="handleImgError"
              class="h-14 w-10 shrink-0 rounded object-cover shadow-xs border border-slate-200 transition group-hover:scale-105"
            />
            <div
              v-else
              class="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-slate-200 font-bold text-slate-500 text-[10px]"
            >
              PKM
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="rounded bg-slate-900 px-1.5 py-0.5 font-bold text-white text-[11px]">
                  {{ card.quantity }}×
                </span>
                <span class="truncate font-bold text-slate-900 group-hover:text-indigo-900">{{ getLocalizedCardName(card) }}</span>
              </div>
              <div class="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                <span>{{ getLocalizedSubCategory(card.subCategory) }}</span>
                <span>•</span>
                <span>{{ card.model.pokemonStats?.hp ?? 70 }} {{ t('cardHp') }}</span>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <!-- Dresseurs -->
      <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div class="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-sm font-bold text-slate-900">{{ t('trainerCount') }}</h3>
          <span class="rounded-lg bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-bold text-slate-700">
            {{ validatedDeck.trainerCount }} {{ t('cardsUnit') }}
          </span>
        </div>

        <ul class="space-y-3">
          <li
            v-for="card in trainerCards"
            :key="card.uid"
            @click="openCardZoom(card)"
            class="group flex cursor-pointer items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-2 text-xs transition hover:border-slate-400 hover:bg-slate-100/70"
            :title="t('clickToEnlarge')"
          >
            <!-- Image de la carte avec zoom au clic -->
            <img
              v-if="getCardImageUrl(card)"
              :src="getCardImageUrl(card)!"
              :alt="getLocalizedCardName(card)"
              loading="lazy"
              @error="handleImgError"
              class="h-14 w-10 shrink-0 rounded object-cover shadow-xs border border-slate-200 transition group-hover:scale-105"
            />
            <div
              v-else
              class="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-slate-200 font-bold text-slate-500 text-[10px]"
            >
              DRS
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="rounded bg-slate-800 px-1.5 py-0.5 font-bold text-white text-[11px]">
                  {{ card.quantity }}×
                </span>
                <span class="truncate font-bold text-slate-900 group-hover:text-indigo-900">{{ getLocalizedCardName(card) }}</span>
              </div>
              <div class="mt-1 text-[11px] text-slate-500">
                {{ getLocalizedSubCategory(card.subCategory) }}
              </div>
            </div>
          </li>
        </ul>
      </div>

      <!-- Énergies (Avec images officielles pour les énergies de base et spéciales) -->
      <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div class="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 class="text-sm font-bold text-slate-900">{{ t('energyCount') }}</h3>
          <span class="rounded-lg bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-bold text-slate-700">
            {{ validatedDeck.energyCount }} {{ t('cardsUnit') }}
          </span>
        </div>

        <ul class="space-y-3">
          <li
            v-for="card in energyCards"
            :key="card.uid"
            @click="openCardZoom(card)"
            class="group flex cursor-pointer items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-2 text-xs transition hover:border-slate-400 hover:bg-slate-100/70"
            :title="t('clickToEnlarge')"
          >
            <!-- Image de l'énergie avec zoom au clic -->
            <img
              v-if="getCardImageUrl(card)"
              :src="getCardImageUrl(card)!"
              :alt="getLocalizedCardName(card)"
              loading="lazy"
              @error="handleImgError"
              class="h-14 w-10 shrink-0 rounded object-cover shadow-xs border border-slate-200 transition group-hover:scale-105"
            />
            <div
              v-else
              class="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-slate-200 font-bold text-slate-500 text-[10px]"
            >
              NRG
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="rounded bg-slate-700 px-1.5 py-0.5 font-bold text-white text-[11px]">
                  {{ card.quantity }}×
                </span>
                <span class="truncate font-bold text-slate-900 group-hover:text-indigo-900">{{ getLocalizedCardName(card) }}</span>
              </div>
              <div class="mt-1 text-[11px] text-slate-500">
                {{ getLocalizedSubCategory(card.subCategory) }}
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Modale de Zoom de Carte -->
    <CardZoomModal
      :card="zoomedCard"
      :is-open="zoomedCard !== null"
      :is-debug-mode="isDebugMode"
      @close="closeCardZoom"
    />
  </div>
</template>
