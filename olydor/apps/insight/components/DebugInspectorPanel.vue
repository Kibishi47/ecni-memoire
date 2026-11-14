<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TracedBoardSnapshot, TracedGameRecord, TracedTurnRecord } from '@olydor/types'
import { useI18n } from '../utils/i18n'
import { useBugReport } from '../services/useBugReport'

const props = defineProps<{
  tracedGames: TracedGameRecord[]
}>()

const { t } = useI18n()
const engineReport = useBugReport()

const outcomeFilter = ref<'ALL' | 'PLAYER' | 'OPPONENT' | 'DRAW'>('ALL')
const opponentFilter = ref<string>('ALL')
const selectedGameIndex = ref<number>(1)
const selectedTurnIndex = ref<number>(0)
const boardSnapshotTiming = ref<'AFTER' | 'BEFORE'>('AFTER')

const uniqueOpponents = computed(() => {
  const map = new Map<string, string>()
  for (const g of props.tracedGames) {
    map.set(g.opponentId, g.opponentName)
  }
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
})

const filteredGames = computed<TracedGameRecord[]>(() => {
  return props.tracedGames.filter((g) => {
    if (outcomeFilter.value !== 'ALL' && g.winner !== outcomeFilter.value) return false
    if (opponentFilter.value !== 'ALL' && g.opponentId !== opponentFilter.value) return false
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

const activeGame = computed<TracedGameRecord | null>(() => {
  return (
    filteredGames.value.find((g) => g.gameIndex === selectedGameIndex.value) ??
    filteredGames.value[0] ??
    null
  )
})

watch(activeGame, () => {
  selectedTurnIndex.value = 0
  engineReport.reset()
})

const activeTurn = computed<TracedTurnRecord | null>(() => {
  if (!activeGame.value || activeGame.value.turns.length === 0) return null
  const idx = Math.max(0, Math.min(selectedTurnIndex.value, activeGame.value.turns.length - 1))
  return activeGame.value.turns[idx] ?? null
})

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
      return '6 Récompenses prises'
    case 'NO_POKEMON_IN_PLAY':
      return 'Plus aucun Pokémon en jeu (KO Table)'
    case 'DECK_OUT':
      return 'Deck vide au début du tour (Deck-Out)'
    case 'MAX_TURNS_REACHED':
      return 'Limite maxTurns atteinte (Départage aux Récompenses)'
    default:
      return reason || 'Terminé'
  }
}
</script>

<template>
  <section
    class="rounded-2xl border-2 border-amber-500/45 bg-[#131823] p-5 shadow-xs"
    aria-label="Inspecteur granulaire Mode Debug"
  >
    <!-- En-tête de l'Inspecteur Debug -->
    <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[#263044] pb-4">
      <div>
        <div class="flex items-center gap-2">
          <span class="rounded-md bg-amber-950/450 px-2 py-0.5 font-mono text-xs font-bold text-white">
            INSPECTEUR ?debug=true
          </span>
          <h3 class="text-base font-bold text-[#f8fafc]">
            Inspection Granulaire : Partie → Timeline par Tour → Branches 3-Ply ($T \rightarrow T_{\text{adv}} \rightarrow T+1$)
          </h3>
        </div>
        <p class="mt-1 text-xs text-[#8a93a2]">
          Examinez les mains initiales, les 6 Récompenses, l'état exact du Double Plateau et le calcul mathématique de chaque branche candidate.
        </p>
      </div>

      <!-- Filtres Par Partie (Victoire / Défaite / Deck affronté) -->
      <div class="flex flex-wrap items-center gap-2">
        <select
          v-model="outcomeFilter"
          aria-label="Filtrer par issue de la partie"
          class="rounded-lg border border-[#263044] bg-[#0c0f16] px-2.5 py-1.5 text-xs font-semibold text-[#f8fafc]"
        >
          <option value="ALL">Toutes les issues ({{ tracedGames.length }})</option>
          <option value="PLAYER">Victoires Joueur uniquement</option>
          <option value="OPPONENT">Défaites uniquement</option>
          <option value="DRAW">Égalités uniquement</option>
        </select>

        <select
          v-model="opponentFilter"
          aria-label="Filtrer par deck adverse affronté"
          class="rounded-lg border border-[#263044] bg-[#0c0f16] px-2.5 py-1.5 text-xs font-semibold text-[#f8fafc]"
        >
          <option value="ALL">Tous les decks affrontés</option>
          <option v-for="opp in uniqueOpponents" :key="opp.id" :value="opp.id">
            vs {{ opp.name }}
          </option>
        </select>

        <select
          v-model="selectedGameIndex"
          aria-label="Sélectionner la partie tracée"
          class="rounded-lg border border-slate-900 bg-[#ff6b00] px-3 py-1.5 font-mono text-xs font-bold text-white"
        >
          <option v-for="g in filteredGames" :key="g.gameIndex" :value="g.gameIndex">
            Partie #{{ g.gameIndex }} — {{ g.winner === 'PLAYER' ? 'VICTOIRE' : g.winner === 'OPPONENT' ? 'DÉFAITE' : 'ÉGALITÉ' }} vs {{ g.opponentName }} ({{ g.totalTurns }}t)
          </option>
        </select>
      </div>
    </div>

    <div v-if="!activeGame" class="py-8 text-center text-sm text-[#8a93a2]">
      Aucune partie tracée ne correspond aux filtres sélectionnés.
    </div>

    <div v-else class="mt-5 space-y-6">
      <!-- 1. RÉSUMÉ DE LA PARTIE SÉLECTIONNÉE : Mains Initiales & 6 Cartes Récompenses des 2 joueurs -->
      <div class="rounded-xl border border-[#263044] bg-[#0c0f16] p-4">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#263044] pb-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-sm font-bold text-[#f8fafc]">
              Partie #{{ activeGame.gameIndex }}
            </span>
            <span
              class="rounded-md px-2 py-0.5 font-mono text-xs font-bold"
              :class="
                activeGame.winner === 'PLAYER'
                  ? 'bg-emerald-950/60 text-emerald-300'
                  : activeGame.winner === 'OPPONENT'
                    ? 'bg-red-950/60 text-red-300'
                    : 'bg-[#263044] text-slate-200'
              "
            >
              {{
                activeGame.winner === 'PLAYER'
                  ? 'VICTOIRE JOUEUR'
                  : activeGame.winner === 'OPPONENT'
                    ? 'VICTOIRE ADVERSE'
                    : 'ÉGALITÉ'
              }}
            </span>
            <span class="rounded border border-[#263044] bg-[#131823] px-2 py-0.5 text-xs font-medium text-slate-200">
              Motif : {{ formatWinReason(activeGame.winReason) }}
            </span>
            <span class="rounded border border-[#263044] bg-[#131823] px-2 py-0.5 font-mono text-xs text-[#8a93a2]">
              Seed: {{ activeGame.seed }}
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-3 font-mono text-xs text-[#8a93a2]">
            <span>1er Joueur : <strong>{{ activeGame.firstPlayer === 'PLAYER' ? 'Joueur' : 'Adversaire' }}</strong></span>
            <span>•</span>
            <span>Prizes gagnés : <strong>{{ activeGame.playerPrizesWon }} - {{ activeGame.opponentPrizesWon }}</strong></span>
            <span>•</span>
            <span>Mulligans : <strong>J:{{ activeGame.playerMulligans }} / Adv:{{ activeGame.opponentMulligans }}</strong></span>
            <button
              type="button"
              @click="engineReport.togglePanel()"
              class="ml-auto rounded-lg border border-rose-500/45 bg-rose-950/45 px-2.5 py-1 font-sans text-xs font-bold text-rose-300 transition hover:bg-rose-950/60"
            >
              {{ t('reportEngineIssueBtn') }}
            </button>
          </div>
        </div>

        <!-- Formulaire de signalement de bug moteur / règle -->
        <div
          v-if="engineReport.isPanelOpen.value"
          class="mt-3 space-y-2.5 rounded-lg border border-rose-500/35 bg-[#131823] p-3.5 text-xs text-[#f8fafc]"
        >
          <div class="font-bold text-rose-200">
            {{ t('reportTitleEngine', { seed: activeGame.seed }) }}
          </div>
          <textarea
            v-model="engineReport.comment.value"
            rows="2"
            maxlength="1000"
            :placeholder="t('reportCommentPlaceholder')"
            class="w-full rounded-lg border border-[#263044] bg-[#0c0f16] p-2 text-xs text-[#f8fafc] placeholder-slate-400 focus:border-[#ff6b00] focus:bg-[#131823] focus:outline-none"
          ></textarea>
          <div
            v-if="engineReport.error.value"
            class="rounded-lg border border-rose-500/45 bg-rose-950/45 px-2.5 py-1.5 text-xs text-rose-200"
          >
            {{ engineReport.error.value }}
          </div>
          <div
            v-if="engineReport.successResult.value"
            class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/45 bg-emerald-950/45 px-2.5 py-1.5 text-xs text-emerald-200"
          >
            <span>{{ t('reportSuccessMsg', { id: engineReport.successResult.value.reportId }) }}</span>
            <a
              v-if="engineReport.successResult.value.issueUrl"
              :href="engineReport.successResult.value.issueUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="font-bold underline hover:text-[#10b981]"
            >
              {{ t('reportIssueLink') }}
            </a>
          </div>
          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              @click="engineReport.togglePanel()"
              class="rounded-lg border border-[#263044] bg-[#131823] px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-[#1b2232]"
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

        <!-- Mains initiales (7 cartes) & 6 Récompenses des deux joueurs -->
        <div class="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <!-- Ouverture Joueur -->
          <div class="rounded-lg border border-[#263044] bg-[#131823] p-3">
            <div class="text-xs font-bold uppercase tracking-wider text-emerald-300">
              Ouverture Joueur (Main initiale 7 cartes &amp; 6 Récompenses)
            </div>
            <div class="mt-2">
              <div class="text-[11px] font-semibold text-[#8a93a2]">Main initiale (7 cartes) :</div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(cName, idx) in activeGame.playerInitialHand"
                  :key="idx"
                  class="rounded border border-[#263044] bg-[#0c0f16] px-2 py-0.5 text-[11px] font-medium text-[#f8fafc]"
                >
                  {{ cName }}
                </span>
              </div>
            </div>
            <div class="mt-2.5">
              <div class="text-[11px] font-semibold text-[#8a93a2]">6 Cartes Récompenses initiales :</div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(pName, idx) in activeGame.playerInitialPrizes"
                  :key="idx"
                  class="rounded border border-amber-500/35 bg-amber-950/45/70 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-200"
                >
                  #{{ idx + 1 }} {{ pName }}
                </span>
              </div>
            </div>
          </div>

          <!-- Ouverture Adversaire -->
          <div class="rounded-lg border border-[#263044] bg-[#131823] p-3">
            <div class="text-xs font-bold uppercase tracking-wider text-rose-300">
              Ouverture Adversaire — {{ activeGame.opponentName }}
            </div>
            <div class="mt-2">
              <div class="text-[11px] font-semibold text-[#8a93a2]">Main initiale adverse (7 cartes) :</div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(cName, idx) in activeGame.opponentInitialHand"
                  :key="idx"
                  class="rounded border border-[#263044] bg-[#0c0f16] px-2 py-0.5 text-[11px] font-medium text-[#f8fafc]"
                >
                  {{ cName }}
                </span>
              </div>
            </div>
            <div class="mt-2.5">
              <div class="text-[11px] font-semibold text-[#8a93a2]">6 Cartes Récompenses adverses :</div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(pName, idx) in activeGame.opponentInitialPrizes"
                  :key="idx"
                  class="rounded border border-rose-500/35 bg-rose-950/45/60 px-2 py-0.5 font-mono text-[11px] font-medium text-rose-200"
                >
                  #{{ idx + 1 }} {{ pName }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. TIMELINE INTERACTIVE PAR TOUR -->
      <div>
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div class="text-xs font-bold uppercase tracking-wider text-[#8a93a2]">
            Timeline Interactive des Tours ({{ activeGame.turns.length }} demi-tours joués)
          </div>

          <div class="flex items-center gap-1.5">
            <span class="text-xs text-[#8a93a2]">État du plateau affiché :</span>
            <button
              type="button"
              @click="boardSnapshotTiming = 'BEFORE'"
              class="rounded-md border px-2.5 py-1 text-xs font-semibold transition"
              :class="
                boardSnapshotTiming === 'BEFORE'
                  ? 'border-[#ff6b00] bg-[#ff6b00] text-white'
                  : 'border-[#263044] bg-[#0c0f16] text-[#8a93a2] hover:bg-[#1b2232]'
              "
            >
              Début de Tour (Avant actions)
            </button>
            <button
              type="button"
              @click="boardSnapshotTiming = 'AFTER'"
              class="rounded-md border px-2.5 py-1 text-xs font-semibold transition"
              :class="
                boardSnapshotTiming === 'AFTER'
                  ? 'border-[#ff6b00] bg-[#ff6b00] text-white'
                  : 'border-[#263044] bg-[#0c0f16] text-[#8a93a2] hover:bg-[#1b2232]'
              "
            >
              Fin de Tour (Après actions)
            </button>
          </div>
        </div>

        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="(t, idx) in activeGame.turns"
            :key="idx"
            type="button"
            @click="selectedTurnIndex = idx"
            class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold transition"
            :class="
              selectedTurnIndex === idx
                ? 'border-[#ff6b00] bg-[#ff6b00] text-white shadow-[0_0_20px_rgba(255,107,0,0.28)]'
                : t.actingPlayer === 'PLAYER'
                  ? 'border-emerald-500/35 bg-emerald-950/45/70 text-emerald-200 hover:bg-emerald-950/60/70'
                  : 'border-rose-500/35 bg-rose-950/45/70 text-rose-200 hover:bg-rose-950/60/70'
            "
          >
            <span>T{{ t.turnNumber }}</span>
            <span class="text-[10px] opacity-80">
              ({{ t.actingPlayer === 'PLAYER' ? 'Joueur' : 'Adv' }})
            </span>
          </button>
        </div>
      </div>

      <!-- 3. DOUBLE PLATEAU (JOUEUR VS ADVERSAIRE) AU TOUR SÉLECTIONNÉ -->
      <div v-if="activeTurn && displayedPlayerBoard && displayedOpponentBoard" class="space-y-5">
        <!-- Bandeau résumé du tour actif -->
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#263044] bg-[#ff6b00] px-4 py-3 text-white">
          <div class="flex flex-wrap items-center gap-2.5">
            <span class="rounded bg-[#131823]/15 px-2 py-0.5 font-mono text-xs font-bold">
              TOUR {{ activeTurn.turnNumber }} — {{ activeTurn.actingPlayer === 'PLAYER' ? 'TOUR DU JOUEUR' : 'TOUR DE L’ADVERSAIRE' }}
            </span>
            <span v-if="activeTurn.drawnCardName" class="text-xs text-[#8a93a2]">
              Pioche du tour : <strong class="text-white">{{ activeTurn.drawnCardName }}</strong>
            </span>
            <span
              v-if="activeTurn.perturbationNote"
              class="rounded bg-amber-950/450 px-2 py-0.5 text-xs font-bold text-[#f8fafc]"
            >
              [Perturbation] {{ activeTurn.perturbationNote }}
            </span>
          </div>

          <div class="flex items-center gap-3 font-mono text-xs">
            <span>Branches explorées : <strong>{{ activeTurn.branchesExplored }}</strong></span>
            <span>•</span>
            <span>Score Branche Choisie : <strong class="text-emerald-300">{{ activeTurn.totalScore }}</strong></span>
          </div>
        </div>

        <!-- Grille Double Plateau : Joueur (Gauche) vs Adversaire (Droite) -->
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <!-- Plateau Joueur -->
          <div class="rounded-xl border border-emerald-500/35 bg-emerald-950/45/25 p-4">
            <div class="flex items-center justify-between border-b border-emerald-500/35/70 pb-2.5">
              <div class="flex items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
                <h4 class="text-xs font-bold uppercase tracking-wider text-emerald-100">
                  Plateau du Joueur ({{ boardSnapshotTiming === 'AFTER' ? 'Fin de tour' : 'Début de tour' }})
                </h4>
              </div>
              <div class="flex items-center gap-2 font-mono text-xs text-slate-200">
                <span class="rounded bg-[#131823] px-2 py-0.5 font-bold text-emerald-300 shadow-2xs">
                  Récompenses restantes : {{ displayedPlayerBoard.prizesRemaining }} / 6
                </span>
                <span>Deck: {{ displayedPlayerBoard.deckCount }}</span>
                <span>Défausse: {{ displayedPlayerBoard.discardCount }}</span>
              </div>
            </div>

            <!-- Poste Actif Joueur -->
            <div class="mt-3">
              <div class="text-[11px] font-bold uppercase tracking-wider text-[#8a93a2]">
                Poste Actif
              </div>
              <div
                v-if="displayedPlayerBoard.active"
                class="mt-1 rounded-lg border border-emerald-500/45 bg-[#131823] p-3 shadow-2xs"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-bold text-[#f8fafc]">
                      {{ displayedPlayerBoard.active.nameFr }}
                    </span>
                    <span class="rounded bg-[#1b2232] px-1.5 py-0.5 font-mono text-[10px] text-[#8a93a2]">
                      {{ displayedPlayerBoard.active.subCategory }}
                    </span>
                  </div>
                  <span class="font-mono text-xs font-bold text-[#10b981]">
                    {{ displayedPlayerBoard.active.currentHp }} / {{ displayedPlayerBoard.active.maxHp }} PV
                    <span v-if="displayedPlayerBoard.active.damage > 0" class="text-[#ef4444]">
                      (-{{ displayedPlayerBoard.active.damage }})
                    </span>
                  </span>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                  <span
                    v-for="(en, eIdx) in displayedPlayerBoard.active.attachedEnergies"
                    :key="eIdx"
                    class="rounded bg-amber-950/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-200"
                  >
                    NRJ: {{ en }}
                  </span>
                  <span
                    v-for="(tl, tIdx) in displayedPlayerBoard.active.attachedTools"
                    :key="tIdx"
                    class="rounded bg-sky-950/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-100"
                  >
                    Outil: {{ tl }}
                  </span>
                  <span
                    v-if="
                      displayedPlayerBoard.active.attachedEnergies.length === 0 &&
                      displayedPlayerBoard.active.attachedTools.length === 0
                    "
                    class="text-[11px] text-[#8a93a2]"
                  >
                    Aucune énergie ni outil attaché
                  </span>
                </div>
              </div>
              <div v-else class="mt-1 rounded-lg border border-dashed border-[#263044] p-3 text-xs text-[#8a93a2]">
                Aucun Pokémon Actif
              </div>
            </div>

            <!-- Banc Joueur (max 5) -->
            <div class="mt-3">
              <div class="text-[11px] font-bold uppercase tracking-wider text-[#8a93a2]">
                Banc ({{ displayedPlayerBoard.bench.length }} / 5)
              </div>
              <div
                v-if="displayedPlayerBoard.bench.length > 0"
                class="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <div
                  v-for="(bPoke, bIdx) in displayedPlayerBoard.bench"
                  :key="bPoke.instanceId"
                  class="rounded-lg border border-[#263044] bg-[#131823] p-2.5 text-xs"
                >
                  <div class="flex items-center justify-between font-semibold text-[#f8fafc]">
                    <span>#{{ bIdx + 1 }} {{ bPoke.nameFr }}</span>
                    <span class="font-mono text-[11px] text-[#8a93a2]">
                      {{ bPoke.currentHp }}/{{ bPoke.maxHp }} PV
                    </span>
                  </div>
                  <div class="mt-1 flex flex-wrap gap-1">
                    <span
                      v-for="(en, eIdx) in bPoke.attachedEnergies"
                      :key="eIdx"
                      class="rounded bg-amber-950/45 px-1.5 py-0.5 font-mono text-[10px] text-amber-300"
                    >
                      NRJ: {{ en }}
                    </span>
                  </div>
                </div>
              </div>
              <div v-else class="mt-1 text-xs text-[#8a93a2]">Banc vide</div>
            </div>

            <!-- Main Joueur -->
            <div class="mt-3 border-t border-emerald-500/35/60 pt-2.5">
              <div class="text-[11px] font-bold uppercase tracking-wider text-[#8a93a2]">
                Main ({{ displayedPlayerBoard.hand.length }} cartes)
              </div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(hCard, hIdx) in displayedPlayerBoard.hand"
                  :key="hIdx"
                  class="rounded border border-[#263044] bg-[#131823] px-2 py-0.5 text-[11px] font-medium text-[#f8fafc]"
                >
                  {{ hCard }}
                </span>
                <span v-if="displayedPlayerBoard.hand.length === 0" class="text-xs text-[#8a93a2]">
                  Main vide
                </span>
              </div>
            </div>
          </div>

          <!-- Plateau Adversaire -->
          <div class="rounded-xl border border-rose-500/35 bg-rose-950/45/25 p-4">
            <div class="flex items-center justify-between border-b border-rose-500/35/70 pb-2.5">
              <div class="flex items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full bg-rose-600"></span>
                <h4 class="text-xs font-bold uppercase tracking-wider text-rose-100">
                  Plateau Adverse ({{ boardSnapshotTiming === 'AFTER' ? 'Fin de tour' : 'Début de tour' }})
                </h4>
              </div>
              <div class="flex items-center gap-2 font-mono text-xs text-slate-200">
                <span class="rounded bg-[#131823] px-2 py-0.5 font-bold text-rose-300 shadow-2xs">
                  Récompenses restantes : {{ displayedOpponentBoard.prizesRemaining }} / 6
                </span>
                <span>Deck: {{ displayedOpponentBoard.deckCount }}</span>
                <span>Défausse: {{ displayedOpponentBoard.discardCount }}</span>
              </div>
            </div>

            <!-- Poste Actif Adversaire -->
            <div class="mt-3">
              <div class="text-[11px] font-bold uppercase tracking-wider text-[#8a93a2]">
                Poste Actif Adverse
              </div>
              <div
                v-if="displayedOpponentBoard.active"
                class="mt-1 rounded-lg border border-rose-500/45 bg-[#131823] p-3 shadow-2xs"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-bold text-[#f8fafc]">
                      {{ displayedOpponentBoard.active.nameFr }}
                    </span>
                    <span class="rounded bg-[#1b2232] px-1.5 py-0.5 font-mono text-[10px] text-[#8a93a2]">
                      {{ displayedOpponentBoard.active.subCategory }}
                    </span>
                  </div>
                  <span class="font-mono text-xs font-bold text-[#ef4444]">
                    {{ displayedOpponentBoard.active.currentHp }} / {{ displayedOpponentBoard.active.maxHp }} PV
                    <span v-if="displayedOpponentBoard.active.damage > 0" class="text-[#ef4444]">
                      (-{{ displayedOpponentBoard.active.damage }})
                    </span>
                  </span>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                  <span
                    v-for="(en, eIdx) in displayedOpponentBoard.active.attachedEnergies"
                    :key="eIdx"
                    class="rounded bg-amber-950/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-200"
                  >
                    NRJ: {{ en }}
                  </span>
                  <span
                    v-for="(tl, tIdx) in displayedOpponentBoard.active.attachedTools"
                    :key="tIdx"
                    class="rounded bg-sky-950/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-100"
                  >
                    Outil: {{ tl }}
                  </span>
                  <span
                    v-if="
                      displayedOpponentBoard.active.attachedEnergies.length === 0 &&
                      displayedOpponentBoard.active.attachedTools.length === 0
                    "
                    class="text-[11px] text-[#8a93a2]"
                  >
                    Aucune énergie ni outil attaché
                  </span>
                </div>
              </div>
              <div v-else class="mt-1 rounded-lg border border-dashed border-[#263044] p-3 text-xs text-[#8a93a2]">
                Aucun Pokémon Actif
              </div>
            </div>

            <!-- Banc Adversaire -->
            <div class="mt-3">
              <div class="text-[11px] font-bold uppercase tracking-wider text-[#8a93a2]">
                Banc Adverse ({{ displayedOpponentBoard.bench.length }} / 5)
              </div>
              <div
                v-if="displayedOpponentBoard.bench.length > 0"
                class="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <div
                  v-for="(bPoke, bIdx) in displayedOpponentBoard.bench"
                  :key="bPoke.instanceId"
                  class="rounded-lg border border-[#263044] bg-[#131823] p-2.5 text-xs"
                >
                  <div class="flex items-center justify-between font-semibold text-[#f8fafc]">
                    <span>#{{ bIdx + 1 }} {{ bPoke.nameFr }}</span>
                    <span class="font-mono text-[11px] text-[#8a93a2]">
                      {{ bPoke.currentHp }}/{{ bPoke.maxHp }} PV
                    </span>
                  </div>
                  <div class="mt-1 flex flex-wrap gap-1">
                    <span
                      v-for="(en, eIdx) in bPoke.attachedEnergies"
                      :key="eIdx"
                      class="rounded bg-amber-950/45 px-1.5 py-0.5 font-mono text-[10px] text-amber-300"
                    >
                      NRJ: {{ en }}
                    </span>
                  </div>
                </div>
              </div>
              <div v-else class="mt-1 text-xs text-[#8a93a2]">Banc adverse vide</div>
            </div>

            <!-- Main Adversaire -->
            <div class="mt-3 border-t border-rose-500/35/60 pt-2.5">
              <div class="text-[11px] font-bold uppercase tracking-wider text-[#8a93a2]">
                Main Adverse ({{ displayedOpponentBoard.hand.length }} cartes)
              </div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(hCard, hIdx) in displayedOpponentBoard.hand"
                  :key="hIdx"
                  class="rounded border border-[#263044] bg-[#131823] px-2 py-0.5 text-[11px] font-medium text-[#f8fafc]"
                >
                  {{ hCard }}
                </span>
                <span v-if="displayedOpponentBoard.hand.length === 0" class="text-xs text-[#8a93a2]">
                  Main adverse vide
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. COMPARATEUR DES BRANCHES CANDIDATES 3-PLY DU TOUR (T -> T_adv -> T+1) -->
        <div class="rounded-xl border border-[#263044] bg-[#0c0f16] p-4">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#263044] pb-3">
            <div>
              <h4 class="text-xs font-bold uppercase tracking-wider text-[#f8fafc]">
                Comparateur d'Arbre 3-Ply du Tour {{ activeTurn.turnNumber }} — Branches Candidates Évaluées
              </h4>
              <p class="text-xs text-[#8a93a2]">
                Formule : <code class="font-mono">Score Total = 0.35 × Score(T) - 0.30 × Score(T_adv) + 0.35 × Score(T+1)</code>
              </p>
            </div>
            <span class="rounded border border-[#263044] bg-[#131823] px-2.5 py-1 font-mono text-xs font-bold text-slate-200">
              {{ activeTurn.candidateBranches.length }} branches évaluées en profondeur
            </span>
          </div>

          <div class="mt-3 space-y-3">
            <div
              v-for="branch in activeTurn.candidateBranches"
              :key="branch.branchId"
              class="rounded-xl border p-3.5 transition"
              :class="
                branch.isChosen
                  ? 'border-emerald-500 bg-emerald-950/45/50 shadow-2xs'
                  : 'border-[#263044] bg-[#131823]'
              "
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span
                    class="rounded px-2 py-0.5 font-mono text-xs font-bold"
                    :class="
                      branch.isChosen
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#263044] text-slate-200'
                    "
                  >
                    {{ branch.branchId }} {{ branch.isChosen ? '— BRANCHE RETENUE' : '— Écartée' }}
                  </span>
                  <span class="text-xs font-semibold text-[#8a93a2]">
                    {{ branch.actions.length }} action(s) dans la séquence
                  </span>
                </div>

                <!-- Détail mathématique des scores -->
                <div class="flex flex-wrap items-center gap-2 font-mono text-xs">
                  <span class="rounded border border-[#263044] bg-[#131823] px-2 py-0.5 text-slate-200">
                    Score T: <strong>{{ branch.scoreT }}</strong>
                  </span>
                  <span class="rounded border border-rose-500/35 bg-rose-950/45 px-2 py-0.5 text-rose-300">
                    Score T_adv: <strong>{{ branch.scoreTAdv }}</strong>
                  </span>
                  <span class="rounded border border-sky-500/35 bg-sky-950/40 px-2 py-0.5 text-sky-200">
                    Score T+1: <strong>{{ branch.scoreTPlus1 }}</strong>
                  </span>
                  <span
                    class="rounded px-2.5 py-0.5 font-bold"
                    :class="
                      branch.isChosen
                        ? 'bg-emerald-700 text-white'
                        : 'bg-[#ff6b00] text-white'
                    "
                  >
                    Score Total: {{ branch.totalScore }}
                  </span>
                </div>
              </div>

              <!-- Séquence d'actions atomiques (a1 -> a2 -> a3) -->
              <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
                <template v-for="(actLabel, aIdx) in branch.actions" :key="aIdx">
                  <span
                    class="rounded-md border border-[#263044] bg-[#131823] px-2 py-1 text-xs font-medium text-[#f8fafc] shadow-2xs"
                  >
                    <strong class="font-mono text-[10px] text-[#8a93a2]">{{ aIdx + 1 }}.</strong>
                    {{ actLabel }}
                  </span>
                  <span v-if="aIdx < branch.actions.length - 1" class="font-mono text-xs text-[#8a93a2]">
                    →
                  </span>
                </template>
              </div>

              <!-- Réaction anticipée de l'adversaire (T_adv) & Rebond (T+1) -->
              <div class="mt-2.5 grid grid-cols-1 gap-2 border-t border-[#263044] pt-2 text-[11px] sm:grid-cols-2">
                <div class="text-rose-200">
                  <span class="font-bold">Riposte anticipée (T<sub>adv</sub>) :</span>
                  {{ branch.opponentReactionSummary }}
                </div>
                <div class="text-sky-100">
                  <span class="font-bold">Rebond projeté (T+1) :</span>
                  {{ branch.reboundSummary }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
