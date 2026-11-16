<script setup lang="ts">
import { computed, ref } from 'vue'
import { Layers, Shield, Swords } from 'lucide-vue-next'
import type { TracedBoardSnapshot, TracedPokemonSnapshot } from '@olydor/types'
import { useI18n } from '../utils/i18n'

const props = withDefaults(
  defineProps<{
    side: 'PLAYER' | 'OPPONENT'
    board: TracedBoardSnapshot
    timingLabel: string
    defaultHandOpen?: boolean
  }>(),
  {
    defaultHandOpen: false,
  },
)

const { t, getLocalizedCardName } = useI18n()
const showHand = ref<boolean>(props.defaultHandOpen)

const isPlayer = computed(() => props.side === 'PLAYER')
const accentColor = computed(() => (isPlayer.value ? 'var(--status-positive)' : 'var(--status-negative)'))
const panelBorderColor = computed(() =>
  isPlayer.value ? 'rgba(16, 185, 129, 0.38)' : 'rgba(239, 68, 68, 0.35)',
)
const activeCardBorderColor = computed(() =>
  isPlayer.value ? 'rgba(16, 185, 129, 0.42)' : 'rgba(239, 68, 68, 0.38)',
)
const prizeBadgeBg = computed(() =>
  isPlayer.value ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.14)',
)

function groupLabeledItems(items: string[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const raw of items) {
    const label = raw.trim()
    if (!label) continue
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([label, count]) => ({ label, count }))
}

function hpPercent(poke: TracedPokemonSnapshot): number {
  if (!poke.maxHp || poke.maxHp <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((poke.currentHp / poke.maxHp) * 100)))
}

function hpBarColor(poke: TracedPokemonSnapshot): string {
  const pct = hpPercent(poke)
  if (pct > 50) return '#10b981'
  if (pct > 25) return '#f59e0b'
  return '#ef4444'
}
</script>

<template>
  <div
    class="rounded-xl border p-4 space-y-3"
    :style="{
      backgroundColor: 'var(--bg-elevated)',
      borderColor: panelBorderColor,
    }"
  >
    <!-- En-tête de côté -->
    <div
      class="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5"
      style="border-color: var(--border-subtle)"
    >
      <div class="flex items-center gap-2">
        <Shield v-if="isPlayer" class="h-4 w-4" :style="{ color: accentColor }" />
        <Swords v-else class="h-4 w-4" :style="{ color: accentColor }" />
        <h4 class="text-xs font-bold uppercase tracking-wider" style="color: var(--text-primary)">
          {{ isPlayer ? t('dbgPlayerBoardTitle') : t('dbgOpponentBoardTitle') }}
        </h4>
        <span
          class="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style="background-color: var(--bg-surface); color: var(--text-muted)"
        >
          {{ timingLabel }}
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-2 font-mono text-[11px]" style="color: var(--text-secondary)">
        <span
          class="rounded-md px-2 py-0.5 font-bold"
          :style="{ backgroundColor: prizeBadgeBg, color: accentColor }"
        >
          {{ t('dbgPrizesRemaining', { n: board.prizesRemaining }) }}
        </span>
        <span>{{ t('dbgDeckCount', { n: board.deckCount }) }}</span>
        <span>{{ t('dbgDiscardCount', { n: board.discardCount }) }}</span>
      </div>
    </div>

    <!-- Pokémon Actif -->
    <div>
      <div class="mb-1 text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted)">
        {{ isPlayer ? t('dbgActiveSpotPlayer') : t('dbgActiveSpotOpponent') }}
      </div>
      <div
        v-if="board.active"
        class="rounded-lg border p-3"
        :style="{
          backgroundColor: 'var(--bg-surface)',
          borderColor: activeCardBorderColor,
        }"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-bold" style="color: var(--text-primary)">
            {{ getLocalizedCardName(board.active) }}
          </span>
          <span class="font-mono text-xs font-bold" style="color: var(--text-primary)">
            {{ board.active.currentHp }} / {{ board.active.maxHp }} {{ t('dbgHpUnit') }}
            <span v-if="board.active.damage > 0" style="color: var(--status-negative)">
              (-{{ board.active.damage }})
            </span>
          </span>
        </div>
        <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style="background-color: var(--bg-elevated)">
          <div
            class="h-full rounded-full transition-all"
            :style="{
              width: `${hpPercent(board.active)}%`,
              backgroundColor: hpBarColor(board.active),
            }"
          ></div>
        </div>
        <div
          v-if="board.active.attachedEnergies.length > 0 || board.active.attachedTools.length > 0"
          class="mt-2 flex flex-wrap gap-1.5"
        >
          <span
            v-for="item in groupLabeledItems(board.active.attachedEnergies)"
            :key="item.label"
            class="rounded-md border px-2 py-0.5 text-[11px] font-medium"
            style="border-color: rgba(245, 158, 11, 0.35); background-color: rgba(245, 158, 11, 0.12); color: var(--text-primary)"
          >
            {{ item.label }}<span v-if="item.count > 1" class="ml-1 font-mono font-bold">×{{ item.count }}</span>
          </span>
          <span
            v-for="(tl, tIdx) in board.active.attachedTools"
            :key="tIdx"
            class="rounded-md border px-2 py-0.5 text-[11px] font-medium"
            style="border-color: rgba(56, 189, 248, 0.35); background-color: rgba(56, 189, 248, 0.12); color: var(--text-primary)"
          >
            {{ t('dbgToolPrefix', { name: tl }) }}
          </span>
        </div>
      </div>
      <div
        v-else
        class="rounded-lg border border-dashed p-3 text-xs"
        style="border-color: var(--border-subtle); color: var(--text-muted)"
      >
        {{ t('dbgNoActivePokemon') }}
      </div>
    </div>

    <!-- Banc -->
    <div>
      <div class="mb-1 text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted)">
        {{ isPlayer ? t('dbgBenchPlayer', { n: board.bench.length }) : t('dbgBenchOpponent', { n: board.bench.length }) }}
      </div>
      <div v-if="board.bench.length > 0" class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div
          v-for="bPoke in board.bench"
          :key="bPoke.instanceId"
          class="rounded-lg border p-2.5 text-xs"
          style="background-color: var(--bg-surface); border-color: var(--border-subtle)"
        >
          <div class="flex items-center justify-between gap-2 font-semibold" style="color: var(--text-primary)">
            <span class="truncate">{{ getLocalizedCardName(bPoke) }}</span>
            <span class="shrink-0 font-mono text-[11px]" style="color: var(--text-secondary)">
              {{ bPoke.currentHp }}/{{ bPoke.maxHp }}
            </span>
          </div>
          <div class="mt-1 h-1 w-full overflow-hidden rounded-full" style="background-color: var(--bg-elevated)">
            <div
              class="h-full rounded-full"
              :style="{ width: `${hpPercent(bPoke)}%`, backgroundColor: hpBarColor(bPoke) }"
            ></div>
          </div>
          <div v-if="bPoke.attachedEnergies.length > 0" class="mt-1.5 flex flex-wrap gap-1">
            <span
              v-for="item in groupLabeledItems(bPoke.attachedEnergies)"
              :key="item.label"
              class="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style="background-color: rgba(245, 158, 11, 0.12); color: var(--text-secondary)"
            >
              {{ item.label }}<span v-if="item.count > 1" class="ml-1 font-mono font-bold">×{{ item.count }}</span>
            </span>
          </div>
        </div>
      </div>
      <div v-else class="text-xs" style="color: var(--text-muted)">
        {{ isPlayer ? t('dbgBenchEmptyPlayer') : t('dbgBenchEmptyOpponent') }}
      </div>
    </div>

    <!-- Main (repliable) -->
    <div class="border-t pt-2.5" style="border-color: var(--border-subtle)">
      <button
        type="button"
        @click="showHand = !showHand"
        class="inline-flex items-center gap-1.5 text-xs font-semibold transition hover:opacity-80"
        style="color: var(--text-secondary)"
      >
        <Layers class="h-3.5 w-3.5" />
        <span>
          {{
            showHand
              ? t('dbgHandHideBtn', { n: board.hand.length })
              : t('dbgHandShowBtn', { n: board.hand.length })
          }}
        </span>
      </button>
      <div v-if="showHand" class="mt-2 flex flex-wrap gap-1">
        <span
          v-for="(hCard, hIdx) in board.hand"
          :key="hIdx"
          class="rounded border px-2 py-0.5 text-[11px] font-medium"
          style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary)"
        >
          {{ hCard }}
        </span>
        <span v-if="board.hand.length === 0" class="text-xs" style="color: var(--text-muted)">
          {{ isPlayer ? t('dbgHandEmptyPlayer') : t('dbgHandEmptyOpponent') }}
        </span>
      </div>
    </div>
  </div>
</template>
