<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EngineCardModel } from '../types/cardModel'
import type { ParsedDeckEntry } from '../types/deck'
import { getCardImageUrl } from '../utils/cardImage'
import {
  extractCleanAiTranscriptions,
  getHumanReadableActionType,
  getHumanReadableAiRole,
  getHumanReadableEffectDetails,
  getHumanReadablePrecondition,
  getHumanReadablePrimitive,
  getHumanReadableTimingPhase,
} from '../utils/debugModelHelper'
import { useI18n } from '../utils/i18n'

const props = withDefaults(
  defineProps<{
    card: ParsedDeckEntry | EngineCardModel | null
    isOpen: boolean
    isDebugMode?: boolean
  }>(),
  {
    isDebugMode: false,
  },
)

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t, currentLang, getLocalizedCardName, getLocalizedSubCategory, getLocalizedCardRules } = useI18n()

type ModalTab = 'rules' | 'model'
const activeTab = ref<ModalTab>('rules')
const showRawJson = ref(false)

watch(
  () => props.card,
  () => {
    activeTab.value = 'rules'
    showRawJson.value = false
  },
)

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

const cleanedAiData = computed(() => {
  return extractCleanAiTranscriptions(cardModel.value)
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

function getActionBadgeClass(type: string): string {
  switch (type.toUpperCase()) {
    case 'ATTACK':
      return 'bg-rose-500/20 text-rose-300 border-rose-500/40'
    case 'USE_ABILITY':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    case 'PLAY_FROM_HAND':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    case 'EVOLVE':
      return 'bg-purple-500/20 text-purple-300 border-purple-500/40'
    case 'RETREAT':
      return 'bg-slate-500/20 text-slate-300 border-slate-500/40'
    default:
      return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
  }
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

      <!-- Colonne Droite : Fiche Descriptive / Modèle Moteur IA -->
      <div class="flex flex-1 flex-col justify-between overflow-y-auto p-6 sm:w-7/12">
        <div>
          <!-- BARRE D'ONGLETS DU MODE DEBUG (UNIQUEMENT SI ?debug=true) -->
          <div v-if="isDebugMode" class="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
            <div class="flex items-center gap-1.5 rounded-xl bg-slate-950 p-1 border border-slate-800">
              <button
                type="button"
                @click="activeTab = 'rules'"
                class="rounded-lg px-3 py-1.5 text-xs font-bold transition"
                :class="
                  activeTab === 'rules'
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                "
              >
                {{ t('tabRulesAndCard') }}
              </button>
              <button
                type="button"
                @click="activeTab = 'model'"
                class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition"
                :class="
                  activeTab === 'model'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                "
              >
                <span>{{ t('tabAiEngineModel') }}</span>
                <span class="rounded bg-amber-400/20 px-1 py-0.2 font-mono text-[9px] font-black text-amber-300">
                  DEBUG
                </span>
              </button>
            </div>
          </div>

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

          <!-- CONTENU ONGLET 1 : RÈGLES ET EFFETS STANDARDS -->
          <div v-show="activeTab === 'rules'" class="mt-5">
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

          <!-- CONTENU ONGLET 2 : MODÈLE MOTEUR IA (DEBUG MODE) -->
          <div v-show="activeTab === 'model'" class="mt-5 space-y-4">
            <!-- Rôle Stratégique IA & Synergies -->
            <div
              v-if="cardModel?.strategicEvaluator"
              class="rounded-xl border border-slate-700/80 bg-slate-950/70 p-3.5"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-xs font-bold text-slate-400">
                  {{ t('aiRoleLabel') }}
                </span>
                <span class="rounded-lg bg-indigo-500/20 border border-indigo-500/30 px-2.5 py-0.5 text-xs font-bold text-indigo-300">
                  {{ getHumanReadableAiRole(cardModel.strategicEvaluator.aiRole, currentLang) }}
                </span>
              </div>

              <!-- Synergies attendues dans le decklist -->
              <div
                v-if="cardModel.strategicEvaluator.decklistSynergyRequirements?.length"
                class="mt-2.5 border-t border-slate-800 pt-2 text-[11px] text-slate-400"
              >
                <span class="font-bold text-slate-300">Synergies : </span>
                <span>{{ cardModel.strategicEvaluator.decklistSynergyRequirements.join(', ') }}</span>
              </div>
            </div>

            <!-- Liste des Actions & Attaques Transcrites -->
            <div>
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400">
                {{ t('aiActionsTitle') }}
              </h4>

              <div
                v-if="cardModel?.playableActions && cardModel.playableActions.length > 0"
                class="mt-2.5 space-y-3"
              >
                <div
                  v-for="action in cardModel.playableActions"
                  :key="action.actionId"
                  class="rounded-xl border border-slate-700/70 bg-slate-800/70 p-3.5 space-y-2.5 shadow-xs"
                >
                  <!-- Ligne supérieure : Nom de l'action + Badges Type / Phase -->
                  <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/50 pb-2">
                    <div class="flex items-center gap-2">
                      <span
                        class="rounded border px-2 py-0.5 font-mono text-[10px] font-bold"
                        :class="getActionBadgeClass(action.actionType)"
                      >
                        {{ getHumanReadableActionType(action.actionType, currentLang) }}
                      </span>
                      <span class="font-bold text-sm text-white">
                        {{ action.label }}
                      </span>
                    </div>

                    <div class="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                      <span class="rounded bg-slate-900 px-2 py-0.5 border border-slate-700">
                        {{ getHumanReadableTimingPhase(action.timingPhase, currentLang) }}
                      </span>
                      <span
                        v-if="!action.canUseTurn1GoingFirst"
                        class="rounded bg-rose-500/20 px-1.5 py-0.5 text-rose-300 border border-rose-500/30"
                      >
                        {{ t('aiTurn1ForbiddenJ1') }}
                      </span>
                      <span
                        v-if="action.canUseTurn1GoingSecond"
                        class="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300 border border-emerald-500/30"
                      >
                        {{ t('aiTurn1AllowedJ2') }}
                      </span>
                    </div>
                  </div>

                  <!-- Coût de l'action / attaque -->
                  <div class="text-xs">
                    <span class="font-bold text-slate-400">{{ t('aiCostLabel') }} : </span>
                    <span
                      v-if="action.cost && Object.keys(action.cost).length > 0"
                      class="inline-flex flex-wrap gap-1.5 ml-1"
                    >
                      <span
                        v-for="(qty, energyType) in action.cost"
                        :key="energyType"
                        class="rounded bg-slate-900 border border-slate-700 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-200"
                      >
                        {{ qty }}× {{ energyType }}
                      </span>
                    </span>
                    <span v-else class="text-slate-500 italic ml-1">
                      {{ t('aiCostNone') }}
                    </span>
                  </div>

                  <!-- Conditions d'activation (Préconditions) -->
                  <div class="text-xs">
                    <span class="font-bold text-slate-400">{{ t('aiPreconditionsLabel') }} :</span>
                    <div
                      v-if="action.preconditions && action.preconditions.length > 0"
                      class="mt-1 space-y-1 pl-2 text-slate-300 text-[11px]"
                    >
                      <div
                        v-for="(cond, cIdx) in action.preconditions"
                        :key="cIdx"
                        class="flex items-center gap-1.5"
                      >
                        <span class="text-indigo-400">•</span>
                        <span>{{ getHumanReadablePrecondition(cond, currentLang) }}</span>
                      </div>
                    </div>
                    <div v-else class="text-slate-500 italic text-[11px] mt-0.5 pl-2">
                      {{ t('aiPreconditionsNone') }}
                    </div>
                  </div>

                  <!-- Effets du moteur -->
                  <div class="text-xs border-t border-slate-700/50 pt-2">
                    <span class="font-bold text-slate-400">{{ t('aiEffectsLabel') }} :</span>
                    <div
                      v-if="action.effects && action.effects.length > 0"
                      class="mt-1.5 space-y-2 pl-2"
                    >
                      <div
                        v-for="(eff, eIdx) in action.effects"
                        :key="eIdx"
                        class="rounded-lg bg-slate-900/80 p-2.5 border border-slate-800 text-[11px]"
                      >
                        <div class="font-bold text-emerald-400">
                          {{ getHumanReadablePrimitive(eff.primitive, currentLang) }}
                        </div>
                        <div
                          v-if="getHumanReadableEffectDetails(eff, currentLang).length > 0"
                          class="mt-1.5 flex flex-wrap gap-2 text-slate-300"
                        >
                          <span
                            v-for="(d, dIdx) in getHumanReadableEffectDetails(eff, currentLang)"
                            :key="dIdx"
                            class="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 border border-slate-700/60"
                          >
                            <strong class="text-slate-400">{{ d.label }} :</strong> {{ d.value }}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div v-else class="text-slate-500 italic text-[11px] mt-0.5 pl-2">
                      {{ t('aiEffectsNone') }}
                    </div>
                  </div>

                  <!-- Condition de carte morte si applicable -->
                  <div
                    v-if="action.deadCardCondition"
                    class="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2 text-[11px] text-amber-300"
                  >
                    <strong>{{ t('aiDeadCardCondition') }} :</strong> {{ action.deadCardCondition }}
                  </div>
                </div>
              </div>

              <div v-else class="mt-2 text-xs italic text-slate-500">
                {{ t('aiNoAiModelAvailable') }}
              </div>
            </div>

            <!-- BOUTON BASCULE DU JSON ÉPURÉ (SANS CLÉS NULL) -->
            <div v-if="cleanedAiData" class="border-t border-slate-800 pt-3">
              <button
                type="button"
                @click="showRawJson = !showRawJson"
                class="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition"
              >
                <span>{{ showRawJson ? t('aiHideCleanJson') : t('aiViewCleanJson') }}</span>
                <span>{{ showRawJson ? '▲' : '▼' }}</span>
              </button>

              <div v-if="showRawJson" class="mt-2.5">
                <pre
                  class="max-h-60 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-emerald-400 shadow-inner"
                >{{ JSON.stringify(cleanedAiData, null, 2) }}</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- Bouton Fermer inférieur -->
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
