<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Play,
  RotateCcw,
  Swords,
  Trophy,
} from 'lucide-vue-next'
import type {
  TracedBoardSnapshot,
  TracedGameRecord,
  TracedTurnRecord,
} from '@olydor/types'
import { useI18n } from '../utils/i18n'
import { useBugReport } from '../services/useBugReport'
import InspectorBoardSide from './InspectorBoardSide.vue'

const props = defineProps<{
  tracedGames: TracedGameRecord[]
}>()

const { t } = useI18n()
const engineReport = useBugReport()

type OutcomeFilter = 'ALL' | 'PLAYER' | 'OPPONENT' | 'DRAW'

const outcomeFilter = ref<OutcomeFilter>('ALL')
const opponentFilter = ref<string>('ALL')
const selectedGameIndex = ref<number>(1)
const selectedTurnIndex = ref<number>(0)
const boardSnapshotTiming = ref<'AFTER' | 'BEFORE'>('AFTER')
const showInitialSetup = ref<boolean>(false)
const showAdvancedAiTree = ref<boolean>(false)

const uniqueOpponents = computed(() => {
  const map = new Map<string, string>()
  for (const g of props.tracedGames) {
    map.set(g.opponentId, g.opponentName)
  }
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
})

const gamesMatchingOpponent = computed<TracedGameRecord[]>(() => {
  if (opponentFilter.value === 'ALL') return props.tracedGames
  return props.tracedGames.filter((g) => g.opponentId === opponentFilter.value)
})

const outcomeCounts = computed(() => {
  const base = gamesMatchingOpponent.value
  let player = 0
  let opponent = 0
  let draw = 0
  for (const g of base) {
    if (g.winner === 'PLAYER') player += 1
    else if (g.winner === 'OPPONENT') opponent += 1
    else draw += 1
  }
  return {
    ALL: base.length,
    PLAYER: player,
    OPPONENT: opponent,
    DRAW: draw,
  }
})

const outcomeFilterOptions = computed(() => [
  { key: 'ALL' as const, label: t('dbgOutcomeFilterAll'), count: outcomeCounts.value.ALL },
  { key: 'PLAYER' as const, label: t('dbgOutcomeFilterWon'), count: outcomeCounts.value.PLAYER },
  { key: 'OPPONENT' as const, label: t('dbgOutcomeFilterLost'), count: outcomeCounts.value.OPPONENT },
  { key: 'DRAW' as const, label: t('dbgOutcomeFilterDraw'), count: outcomeCounts.value.DRAW },
])

const filteredGames = computed<TracedGameRecord[]>(() => {
  return gamesMatchingOpponent.value.filter((g) => {
    if (outcomeFilter.value !== 'ALL' && g.winner !== outcomeFilter.value) return false
    return true
  })
})

watch(
  filteredGames,
  (list) => {
    if (list.length > 0 && !list.some((g) => g.gameIndex === selectedGameIndex.value)) {
      selectedGameIndex.value = list[0]!.gameIndex
      selectedTurnIndex.value = 0
    }
  },
  { immediate: true },
)

const activeFilteredPosition = computed<number>(() => {
  if (filteredGames.value.length === 0) return -1
  const idx = filteredGames.value.findIndex((g) => g.gameIndex === selectedGameIndex.value)
  return idx >= 0 ? idx : 0
})

const activeGame = computed<TracedGameRecord | null>(() => {
  if (activeFilteredPosition.value < 0) return null
  return filteredGames.value[activeFilteredPosition.value] ?? null
})

const canGoPrevGame = computed(() => activeFilteredPosition.value > 0)
const canGoNextGame = computed(
  () => activeFilteredPosition.value >= 0 && activeFilteredPosition.value < filteredGames.value.length - 1,
)

function goToPrevGame() {
  if (!canGoPrevGame.value) return
  const target = filteredGames.value[activeFilteredPosition.value - 1]
  if (target) selectedGameIndex.value = target.gameIndex
}

function goToNextGame() {
  if (!canGoNextGame.value) return
  const target = filteredGames.value[activeFilteredPosition.value + 1]
  if (target) selectedGameIndex.value = target.gameIndex
}

function resetFilters() {
  outcomeFilter.value = 'ALL'
  opponentFilter.value = 'ALL'
}

watch(activeGame, () => {
  selectedTurnIndex.value = 0
  showInitialSetup.value = false
  showAdvancedAiTree.value = false
  engineReport.reset()
})

const activeTurn = computed<TracedTurnRecord | null>(() => {
  if (!activeGame.value || activeGame.value.turns.length === 0) return null
  const idx = Math.max(0, Math.min(selectedTurnIndex.value, activeGame.value.turns.length - 1))
  return activeGame.value.turns[idx] ?? null
})

const canGoPrevTurn = computed(() => selectedTurnIndex.value > 0)
const canGoNextTurn = computed(
  () => Boolean(activeGame.value && selectedTurnIndex.value < activeGame.value.turns.length - 1),
)

function goToPrevTurn() {
  if (canGoPrevTurn.value) selectedTurnIndex.value -= 1
}

function goToNextTurn() {
  if (canGoNextTurn.value) selectedTurnIndex.value += 1
}

const displayedPlayerBoard = computed<TracedBoardSnapshot | null>(() => {
  if (!activeTurn.value) return null
  return boardSnapshotTiming.value === 'AFTER'
    ? activeTurn.value.playerBoardAfter
    : activeTurn.value.playerBoardBefore
})

const displayedOpponentBoard = computed<TracedBoardSnapshot | null>(() => {
  if (!activeTurn.value) return null
  return boardSnapshotTiming.value === 'AFTER'
    ? activeTurn.value.opponentBoardAfter
    : activeTurn.value.opponentBoardBefore
})

function formatWinReason(reason: string | null): string {
  switch (reason) {
    case 'ALL_PRIZES_TAKEN':
      return t('dbgWinReasonAllPrizes')
    case 'NO_POKEMON_IN_PLAY':
      return t('dbgWinReasonNoPokemon')
    case 'DECK_OUT':
      return t('dbgWinReasonDeckOut')
    case 'MAX_TURNS_REACHED':
      return t('dbgWinReasonMaxTurns')
    default:
      return reason || t('dbgWinReasonFinished')
  }
}

function isAttackTurn(turnItem: TracedTurnRecord): boolean {
  return turnItem.chosenActionSequence.some((label) => {
    const lower = label.toLowerCase()
    return lower.startsWith('attaque') || lower.startsWith('attack') || lower.includes('ko')
  })
}

function outcomeStyle(winner: TracedGameRecord['winner'], isActive = true): Record<string, string> {
  if (!isActive) {
    return {
      backgroundColor: 'var(--bg-elevated)',
      borderColor: 'var(--border-subtle)',
      color: 'var(--text-secondary)',
    }
  }
  if (winner === 'PLAYER') {
    return {
      backgroundColor: 'rgba(16, 185, 129, 0.14)',
      borderColor: 'rgba(16, 185, 129, 0.45)',
      color: 'var(--status-positive)',
    }
  }
  if (winner === 'OPPONENT') {
    return {
      backgroundColor: 'rgba(239, 68, 68, 0.14)',
      borderColor: 'rgba(239, 68, 68, 0.45)',
      color: 'var(--status-negative)',
    }
  }
  return {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderColor: 'rgba(245, 158, 11, 0.45)',
    color: 'var(--brand-primary)',
  }
}
</script>

<template>
  <section
    data-testid="ai-match-inspector"
    class="space-y-5"
    :aria-label="t('dbgAriaLabel')"
  >
    <!-- Barre de contrôle : Filtres par issue + Adversaire + Flèches & Sélecteur -->
    <div
      class="rounded-xl border p-4 space-y-3.5"
      style="background-color: var(--bg-elevated); border-color: var(--border-subtle)"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-bold" style="color: var(--text-primary)">
            {{ t('dbgTitle') }}
          </h3>
          <p class="mt-0.5 text-xs" style="color: var(--text-secondary)">
            {{ t('dbgSubtitle') }}
          </p>
        </div>

        <select
          v-if="uniqueOpponents.length > 1"
          v-model="opponentFilter"
          data-testid="inspector-opponent-filter"
          :aria-label="t('dbgFilterOpponentAria')"
          class="rounded-lg border px-3 py-1.5 text-xs font-semibold outline-none transition"
          style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary)"
        >
          <option value="ALL">{{ t('dbgOpponentAll') }}</option>
          <option v-for="opp in uniqueOpponents" :key="opp.id" :value="opp.id">
            vs {{ opp.name }}
          </option>
        </select>
      </div>

      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <!-- Filtres segmentés : Toutes / Gagnées / Perdues / Égalités -->
        <div
          role="group"
          :aria-label="t('dbgFilterOutcomeAria')"
          class="inline-flex flex-wrap items-center gap-1.5"
        >
          <button
            v-for="opt in outcomeFilterOptions"
            :key="opt.key"
            type="button"
            :data-testid="`inspector-filter-${opt.key.toLowerCase()}`"
            @click="outcomeFilter = opt.key"
            class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition"
            :style="
              outcomeFilter === opt.key
                ? opt.key === 'ALL'
                  ? 'background: var(--brand-gradient); border-color: transparent; color: #ffffff'
                  : outcomeStyle(opt.key, true)
                : 'background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-secondary)'
            "
          >
            <span>{{ opt.label }}</span>
            <span
              class="rounded-full px-1.5 py-0.2 font-mono text-[10px]"
              :style="
                outcomeFilter === opt.key
                  ? 'background-color: rgba(255, 255, 255, 0.2)'
                  : 'background-color: var(--bg-elevated); color: var(--text-muted)'
              "
            >
              {{ opt.count }}
            </span>
          </button>
        </div>

        <!-- Stepper flèche gauche / Sélecteur jusqu'à 50 parties / flèche droite -->
        <div class="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            data-testid="inspector-prev-game"
            :disabled="!canGoPrevGame"
            :aria-label="t('dbgPrevGameAria')"
            @click="goToPrevGame"
            class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-85"
            style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary)"
          >
            <ChevronLeft class="h-4 w-4" />
          </button>

          <select
            v-model="selectedGameIndex"
            data-testid="inspector-game-select"
            :disabled="filteredGames.length === 0"
            :aria-label="t('dbgSelectGameAria')"
            class="min-w-0 flex-1 rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold outline-none transition disabled:opacity-50 sm:min-w-[260px]"
            style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary)"
          >
            <option v-for="g in filteredGames" :key="g.gameIndex" :value="g.gameIndex">
              {{
                t('dbgGameOption', {
                  index: g.gameIndex,
                  outcome:
                    g.winner === 'PLAYER'
                      ? t('dbgShortWin')
                      : g.winner === 'OPPONENT'
                        ? t('dbgShortLoss')
                        : t('dbgShortDraw'),
                  opponent: g.opponentName,
                  turns: g.totalTurns,
                })
              }}
            </option>
          </select>

          <span
            v-if="filteredGames.length > 0"
            data-testid="inspector-game-position"
            class="shrink-0 rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold"
            style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-secondary)"
          >
            {{ t('dbgGameCounter', { current: activeFilteredPosition + 1, total: filteredGames.length }) }}
          </span>

          <button
            type="button"
            data-testid="inspector-next-game"
            :disabled="!canGoNextGame"
            :aria-label="t('dbgNextGameAria')"
            @click="goToNextGame"
            class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-85"
            style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary)"
          >
            <ChevronRight class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- État vide quand un filtre ne retourne aucune partie -->
    <div
      v-if="!activeGame"
      data-testid="inspector-empty-state"
      class="flex flex-col items-center justify-center gap-3 rounded-xl border py-8 text-center"
      style="background-color: var(--bg-elevated); border-color: var(--border-subtle)"
    >
      <p class="text-sm" style="color: var(--text-secondary)">
        {{ t('dbgNoMatchingGames') }}
      </p>
      <button
        type="button"
        @click="resetFilters"
        class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition hover:opacity-85"
        style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary)"
      >
        <RotateCcw class="h-3.5 w-3.5" />
        <span>{{ t('dbgResetFiltersBtn') }}</span>
      </button>
    </div>

    <!-- Détail de la partie sélectionnée -->
    <div v-else class="space-y-4">
      <!-- Carte Résumé de Partie -->
      <div
        class="rounded-xl border p-4"
        style="background-color: var(--bg-elevated); border-color: var(--border-subtle)"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2.5">
            <span
              data-testid="inspector-active-outcome"
              class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold"
              :style="outcomeStyle(activeGame.winner, true)"
            >
              <Trophy class="h-3.5 w-3.5" />
              <span>
                {{
                  activeGame.winner === 'PLAYER'
                    ? t('dbgBadgePlayerWin')
                    : activeGame.winner === 'OPPONENT'
                      ? t('dbgBadgeOpponentWin')
                      : t('dbgBadgeDraw')
                }}
              </span>
            </span>

            <span class="text-sm font-bold" style="color: var(--text-primary)">
              {{ t('dbgGameNumber', { index: activeGame.gameIndex }) }}
              <span class="font-medium" style="color: var(--text-secondary)">
                {{ t('dbgVersusLabel', { opponent: activeGame.opponentName }) }}
              </span>
            </span>
          </div>

          <button
            type="button"
            @click="engineReport.togglePanel()"
            class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition hover:opacity-85"
            style="border-color: rgba(239, 68, 68, 0.35); background-color: rgba(239, 68, 68, 0.08); color: var(--status-negative)"
          >
            <AlertTriangle class="h-3.5 w-3.5" />
            <span>{{ t('reportEngineIssueBtn') }}</span>
          </button>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span
            class="rounded-lg border px-2.5 py-1 font-semibold"
            style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary)"
          >
            {{ t('dbgPrizesWonLabel') }}
            <strong class="font-mono">{{ activeGame.playerPrizesWon }} – {{ activeGame.opponentPrizesWon }}</strong>
          </span>
          <span
            class="rounded-lg border px-2.5 py-1 font-semibold"
            style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-secondary)"
          >
            {{ t('dbgTurnsPlayed', { n: activeGame.totalTurns }) }}
          </span>
          <span
            class="rounded-lg border px-2.5 py-1 font-semibold"
            style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-secondary)"
          >
            {{ activeGame.firstPlayer === 'PLAYER' ? t('dbgFirstYou') : t('dbgFirstBot') }}
          </span>
          <span
            class="rounded-lg border px-2.5 py-1 font-medium"
            style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-secondary)"
          >
            {{ t('dbgReasonPrefix', { reason: formatWinReason(activeGame.winReason) }) }}
          </span>
        </div>

        <!-- Formulaire signalement de bug moteur -->
        <div
          v-if="engineReport.isPanelOpen.value"
          class="mt-3 space-y-2.5 rounded-lg border p-3.5 text-xs"
          style="background-color: var(--bg-surface); border-color: rgba(239, 68, 68, 0.35); color: var(--text-primary)"
        >
          <div class="font-bold" style="color: var(--status-negative)">
            {{ t('reportTitleEngine', { seed: activeGame.seed }) }}
          </div>
          <textarea
            v-model="engineReport.comment.value"
            rows="2"
            maxlength="1000"
            :placeholder="t('reportCommentPlaceholder')"
            class="w-full rounded-lg border p-2 text-xs outline-none transition"
            style="background-color: var(--bg-elevated); border-color: var(--border-subtle); color: var(--text-primary)"
          ></textarea>
          <div
            v-if="engineReport.error.value"
            class="rounded-lg border px-2.5 py-1.5 text-xs"
            style="border-color: rgba(239, 68, 68, 0.4); background-color: rgba(239, 68, 68, 0.12); color: var(--status-negative)"
          >
            {{ engineReport.error.value }}
          </div>
          <div
            v-if="engineReport.successResult.value"
            class="rounded-lg border px-2.5 py-1.5 text-xs"
            style="border-color: rgba(16, 185, 129, 0.4); background-color: rgba(16, 185, 129, 0.12); color: var(--status-positive)"
          >
            {{ t('reportSuccessMsg', { id: engineReport.successResult.value.reportId }) }}
          </div>
          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              @click="engineReport.togglePanel()"
              class="rounded-lg border px-3 py-1 text-xs font-semibold"
              style="background-color: var(--bg-elevated); border-color: var(--border-subtle); color: var(--text-secondary)"
            >
              {{ t('reportCancelBtn') }}
            </button>
            <button
              type="button"
              :disabled="engineReport.isSubmitting.value"
              @click="
                engineReport.submit({
                  type: 'ENGINE_RULE_ERROR',
                  cardId: null,
                  matchLogs: JSON.parse(JSON.stringify(activeGame)),
                })
              "
              class="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
            >
              {{ engineReport.isSubmitting.value ? t('reportSubmitting') : t('reportSubmitBtn') }}
            </button>
          </div>
        </div>

        <!-- Ouverture initiale (repliée par défaut) -->
        <div class="mt-3 border-t pt-2.5" style="border-color: var(--border-subtle)">
          <button
            type="button"
            data-testid="inspector-toggle-setup"
            @click="showInitialSetup = !showInitialSetup"
            class="inline-flex items-center gap-1.5 text-xs font-semibold transition hover:opacity-80"
            style="color: var(--text-secondary)"
          >
            <ChevronDown
              class="h-3.5 w-3.5 transition-transform"
              :class="showInitialSetup ? 'rotate-180' : ''"
            />
            <span>{{ showInitialSetup ? t('dbgSetupSummaryHide') : t('dbgSetupSummaryShow') }}</span>
            <span class="font-mono text-[11px]" style="color: var(--text-muted)">
              ({{ t('dbgMulligansLabel', { player: activeGame.playerMulligans, opp: activeGame.opponentMulligans }) }})
            </span>
          </button>

          <div v-if="showInitialSetup" class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div
              class="rounded-lg border p-3"
              style="background-color: var(--bg-surface); border-color: var(--border-subtle)"
            >
              <div class="text-xs font-bold" style="color: var(--status-positive)">
                {{ t('dbgPlayerOpeningTitle') }}
              </div>
              <div class="mt-2 text-[11px] font-semibold" style="color: var(--text-secondary)">
                {{ t('dbgPlayerInitialHand') }}
              </div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(cName, idx) in activeGame.playerInitialHand"
                  :key="idx"
                  class="rounded border px-2 py-0.5 text-[11px] font-medium"
                  style="background-color: var(--bg-elevated); border-color: var(--border-subtle); color: var(--text-primary)"
                >
                  {{ cName }}
                </span>
              </div>
              <div class="mt-2.5 text-[11px] font-semibold" style="color: var(--text-secondary)">
                {{ t('dbgPlayerInitialPrizes') }}
              </div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(pName, idx) in activeGame.playerInitialPrizes"
                  :key="idx"
                  class="rounded border px-2 py-0.5 text-[11px] font-medium"
                  style="border-color: rgba(245, 158, 11, 0.35); background-color: rgba(245, 158, 11, 0.1); color: var(--text-primary)"
                >
                  {{ pName }}
                </span>
              </div>
            </div>

            <div
              class="rounded-lg border p-3"
              style="background-color: var(--bg-surface); border-color: var(--border-subtle)"
            >
              <div class="text-xs font-bold" style="color: var(--status-negative)">
                {{ t('dbgOpponentOpeningTitle', { opponent: activeGame.opponentName }) }}
              </div>
              <div class="mt-2 text-[11px] font-semibold" style="color: var(--text-secondary)">
                {{ t('dbgOpponentInitialHand') }}
              </div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(cName, idx) in activeGame.opponentInitialHand"
                  :key="idx"
                  class="rounded border px-2 py-0.5 text-[11px] font-medium"
                  style="background-color: var(--bg-elevated); border-color: var(--border-subtle); color: var(--text-primary)"
                >
                  {{ cName }}
                </span>
              </div>
              <div class="mt-2.5 text-[11px] font-semibold" style="color: var(--text-secondary)">
                {{ t('dbgOpponentInitialPrizes') }}
              </div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(pName, idx) in activeGame.opponentInitialPrizes"
                  :key="idx"
                  class="rounded border px-2 py-0.5 text-[11px] font-medium"
                  style="border-color: rgba(239, 68, 68, 0.3); background-color: rgba(239, 68, 68, 0.08); color: var(--text-primary)"
                >
                  {{ pName }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Sélecteur de tour + flèches -->
      <div
        class="rounded-xl border p-4 space-y-3"
        style="background-color: var(--bg-elevated); border-color: var(--border-subtle)"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold uppercase tracking-wider" style="color: var(--text-secondary)">
              {{ t('dbgTimelineTitle') }}
            </span>
            <div class="inline-flex items-center gap-1">
              <button
                type="button"
                data-testid="inspector-prev-turn"
                :disabled="!canGoPrevTurn"
                :aria-label="t('dbgPrevTurnAria')"
                @click="goToPrevTurn"
                class="inline-flex h-7 w-7 items-center justify-center rounded-md border transition disabled:opacity-40"
                style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary)"
              >
                <ChevronLeft class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                data-testid="inspector-next-turn"
                :disabled="!canGoNextTurn"
                :aria-label="t('dbgNextTurnAria')"
                @click="goToNextTurn"
                class="inline-flex h-7 w-7 items-center justify-center rounded-md border transition disabled:opacity-40"
                style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary)"
              >
                <ChevronRight class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div class="inline-flex items-center gap-1.5">
            <span class="text-xs" style="color: var(--text-secondary)">{{ t('dbgBoardTimingLabel') }}</span>
            <div
              class="inline-flex rounded-lg border p-0.5"
              style="background-color: var(--bg-surface); border-color: var(--border-subtle)"
            >
              <button
                type="button"
                @click="boardSnapshotTiming = 'BEFORE'"
                class="rounded-md px-2.5 py-1 text-xs font-semibold transition"
                :style="
                  boardSnapshotTiming === 'BEFORE'
                    ? 'background: var(--brand-gradient); color: #ffffff'
                    : 'color: var(--text-secondary)'
                "
              >
                {{ t('dbgTimingBefore') }}
              </button>
              <button
                type="button"
                @click="boardSnapshotTiming = 'AFTER'"
                class="rounded-md px-2.5 py-1 text-xs font-semibold transition"
                :style="
                  boardSnapshotTiming === 'AFTER'
                    ? 'background: var(--brand-gradient); color: #ffffff'
                    : 'color: var(--text-secondary)'
                "
              >
                {{ t('dbgTimingAfter') }}
              </button>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="(turnItem, idx) in activeGame.turns"
            :key="idx"
            type="button"
            :data-testid="`inspector-turn-${idx}`"
            @click="selectedTurnIndex = idx"
            class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-xs font-semibold transition"
            :style="
              selectedTurnIndex === idx
                ? 'background: var(--brand-gradient); border-color: transparent; color: #ffffff; box-shadow: var(--brand-glow)'
                : turnItem.actingPlayer === 'PLAYER'
                  ? 'background-color: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.35); color: var(--text-primary)'
                  : 'background-color: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.3); color: var(--text-primary)'
            "
          >
            <span
              class="h-1.5 w-1.5 rounded-full"
              :style="{
                backgroundColor:
                  selectedTurnIndex === idx
                    ? '#ffffff'
                    : turnItem.actingPlayer === 'PLAYER'
                      ? 'var(--status-positive)'
                      : 'var(--status-negative)',
              }"
            ></span>
            <span>T{{ turnItem.turnNumber }}</span>
            <span class="text-[10px] opacity-85">
              {{ turnItem.actingPlayer === 'PLAYER' ? t('dbgTurnShortPlayer') : t('dbgTurnShortOpponent') }}
            </span>
            <Swords v-if="isAttackTurn(turnItem)" class="h-3 w-3 opacity-85" />
          </button>
        </div>
      </div>

      <!-- Contenu du tour actif -->
      <div v-if="activeTurn && displayedPlayerBoard && displayedOpponentBoard" class="space-y-4">
        <!-- 1. Actions jouées ce tour -->
        <div
          class="rounded-xl border p-4"
          style="background-color: var(--bg-elevated); border-color: var(--border-subtle)"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b" style="border-color: var(--border-subtle)">
            <div class="flex flex-wrap items-center gap-2.5">
              <span
                class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold"
                :style="outcomeStyle(activeTurn.actingPlayer, true)"
              >
                <Play class="h-3 w-3" />
                <span>
                  {{
                    activeTurn.actingPlayer === 'PLAYER'
                      ? t('dbgTurnBannerPlayer', { n: activeTurn.turnNumber })
                      : t('dbgTurnBannerOpponent', { n: activeTurn.turnNumber })
                  }}
                </span>
              </span>
              <span
                v-if="activeTurn.drawnCardName"
                class="rounded-lg border px-2.5 py-1 text-xs"
                style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-secondary)"
              >
                {{ t('dbgDrawnCardLabel') }}
                <strong style="color: var(--text-primary)">{{ activeTurn.drawnCardName }}</strong>
              </span>
              <span
                v-if="activeTurn.perturbationNote"
                class="rounded-lg border px-2.5 py-1 text-xs font-semibold"
                style="border-color: rgba(245, 158, 11, 0.4); background-color: rgba(245, 158, 11, 0.12); color: var(--brand-primary)"
              >
                {{ t('dbgPerturbationBadge', { note: activeTurn.perturbationNote }) }}
              </span>
            </div>
          </div>

          <div class="mt-3">
            <div class="mb-2 text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted)">
              {{ t('dbgTurnPlayedActions') }}
            </div>

            <ol v-if="activeTurn.chosenActionSequence.length > 0" class="flex flex-wrap items-center gap-2">
              <li
                v-for="(actLabel, aIdx) in activeTurn.chosenActionSequence"
                :key="aIdx"
                class="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium"
                style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary)"
              >
                <span
                  class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold"
                  style="background-color: rgba(255, 107, 0, 0.16); color: var(--brand-primary)"
                >
                  {{ aIdx + 1 }}
                </span>
                <span>{{ actLabel }}</span>
              </li>
            </ol>

            <p v-else class="text-xs italic" style="color: var(--text-muted)">
              {{ t('dbgNoActionsThisTurn') }}
            </p>
          </div>
        </div>

        <!-- 2. Double Plateau -->
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <InspectorBoardSide
            side="PLAYER"
            :board="displayedPlayerBoard"
            :timing-label="boardSnapshotTiming === 'AFTER' ? t('dbgTimingTagAfter') : t('dbgTimingTagBefore')"
            :default-hand-open="true"
          />
          <InspectorBoardSide
            side="OPPONENT"
            :board="displayedOpponentBoard"
            :timing-label="boardSnapshotTiming === 'AFTER' ? t('dbgTimingTagAfter') : t('dbgTimingTagBefore')"
            :default-hand-open="false"
          />
        </div>

        <!-- 3. Analyse avancée de l'IA (repliée par défaut) -->
        <div
          class="rounded-xl border"
          style="background-color: var(--bg-elevated); border-color: var(--border-subtle)"
        >
          <button
            type="button"
            data-testid="inspector-toggle-ai-analysis"
            @click="showAdvancedAiTree = !showAdvancedAiTree"
            class="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-xs font-semibold transition hover:opacity-85"
            style="color: var(--text-secondary)"
          >
            <span class="inline-flex items-center gap-2">
              <Cpu class="h-4 w-4" style="color: var(--brand-primary)" />
              <span style="color: var(--text-primary)">
                {{
                  showAdvancedAiTree
                    ? t('dbgTechDetailsHide')
                    : t('dbgTechDetailsShow', { n: activeTurn.candidateBranches.length })
                }}
              </span>
            </span>
            <span class="inline-flex items-center gap-2 font-mono text-[11px]" style="color: var(--text-muted)">
              <span>{{ t('dbgTechSeedLabel', { seed: activeGame.seed }) }}</span>
              <ChevronDown
                class="h-4 w-4 transition-transform"
                :class="showAdvancedAiTree ? 'rotate-180' : ''"
              />
            </span>
          </button>

          <div
            v-if="showAdvancedAiTree"
            class="border-t p-4 space-y-3"
            style="border-color: var(--border-subtle)"
          >
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div style="color: var(--text-secondary)">
                <strong style="color: var(--text-primary)">{{ t('dbgTreeTitle', { n: activeTurn.turnNumber }) }}</strong>
                <span class="ml-2">{{ t('dbgFormulaLabel') }}</span>
                <code class="ml-1 font-mono">0.35×T - 0.30×T_adv + 0.35×T+1</code>
              </div>
              <span
                class="rounded-md border px-2 py-0.5 font-mono text-[11px]"
                style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-secondary)"
              >
                {{ t('dbgBranchesExplored') }} {{ activeTurn.branchesExplored }}
              </span>
            </div>

            <div class="space-y-2.5">
              <div
                v-for="branch in activeTurn.candidateBranches"
                :key="branch.branchId"
                class="rounded-lg border p-3"
                :style="
                  branch.isChosen
                    ? 'border-color: rgba(16, 185, 129, 0.55); background-color: rgba(16, 185, 129, 0.08)'
                    : 'border-color: var(--border-subtle); background-color: var(--bg-surface)'
                "
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span
                    class="rounded px-2 py-0.5 font-mono text-xs font-bold"
                    :style="
                      branch.isChosen
                        ? 'background-color: rgba(16, 185, 129, 0.2); color: var(--status-positive)'
                        : 'background-color: var(--bg-elevated); color: var(--text-secondary)'
                    "
                  >
                    {{ branch.branchId }} · {{ branch.isChosen ? t('dbgBranchChosen') : t('dbgBranchDiscarded') }}
                  </span>

                  <div class="flex flex-wrap items-center gap-1.5 font-mono text-[11px]" style="color: var(--text-secondary)">
                    <span>T: {{ branch.scoreT }}</span>
                    <span>·</span>
                    <span>T_adv: {{ branch.scoreTAdv }}</span>
                    <span>·</span>
                    <span>T+1: {{ branch.scoreTPlus1 }}</span>
                    <span
                      class="rounded px-2 py-0.5 font-bold"
                      style="background-color: var(--bg-elevated); color: var(--text-primary)"
                    >
                      {{ t('dbgTotalScore', { score: branch.totalScore }) }}
                    </span>
                  </div>
                </div>

                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                  <template v-for="(actLabel, aIdx) in branch.actions" :key="aIdx">
                    <span
                      class="rounded border px-2 py-0.5 text-xs"
                      style="background-color: var(--bg-elevated); border-color: var(--border-subtle); color: var(--text-primary)"
                    >
                      {{ aIdx + 1 }}. {{ actLabel }}
                    </span>
                  </template>
                </div>

                <div class="mt-2 grid grid-cols-1 gap-2 border-t pt-2 text-[11px] sm:grid-cols-2" style="border-color: var(--border-subtle); color: var(--text-secondary)">
                  <div>
                    <strong style="color: var(--text-primary)">{{ t('dbgAnticipatedReply') }}</strong>
                    {{ branch.opponentReactionSummary }}
                  </div>
                  <div>
                    <strong style="color: var(--text-primary)">{{ t('dbgAnticipatedRebound') }}</strong>
                    {{ branch.reboundSummary }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
