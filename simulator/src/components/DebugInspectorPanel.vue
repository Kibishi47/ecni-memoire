<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TracedBoardSnapshot, TracedGameRecord, TracedTurnRecord } from '../types/simulator'

const props = defineProps<{
  tracedGames: TracedGameRecord[]
}>()

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
    class="rounded-2xl border-2 border-amber-300 bg-white p-5 shadow-xs"
    aria-label="Inspecteur granulaire Mode Debug"
  >
    <!-- En-tête de l'Inspecteur Debug -->
    <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
      <div>
        <div class="flex items-center gap-2">
          <span class="rounded-md bg-amber-500 px-2 py-0.5 font-mono text-xs font-bold text-white">
            INSPECTEUR ?debug=true
          </span>
          <h3 class="text-base font-bold text-slate-900">
            Inspection Granulaire : Partie → Timeline par Tour → Branches 3-Ply ($T \rightarrow T_{\text{adv}} \rightarrow T+1$)
          </h3>
        </div>
        <p class="mt-1 text-xs text-slate-500">
          Examinez les mains initiales, les 6 Récompenses, l'état exact du Double Plateau et le calcul mathématique de chaque branche candidate.
        </p>
      </div>

      <!-- Filtres Par Partie (Victoire / Défaite / Deck affronté) -->
      <div class="flex flex-wrap items-center gap-2">
        <select
          v-model="outcomeFilter"
          aria-label="Filtrer par issue de la partie"
          class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800"
        >
          <option value="ALL">Toutes les issues ({{ tracedGames.length }})</option>
          <option value="PLAYER">Victoires Joueur uniquement</option>
          <option value="OPPONENT">Défaites uniquement</option>
          <option value="DRAW">Égalités uniquement</option>
        </select>

        <select
          v-model="opponentFilter"
          aria-label="Filtrer par deck adverse affronté"
          class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800"
        >
          <option value="ALL">Tous les decks affrontés</option>
          <option v-for="opp in uniqueOpponents" :key="opp.id" :value="opp.id">
            vs {{ opp.name }}
          </option>
        </select>

        <select
          v-model="selectedGameIndex"
          aria-label="Sélectionner la partie tracée"
          class="rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 font-mono text-xs font-bold text-white"
        >
          <option v-for="g in filteredGames" :key="g.gameIndex" :value="g.gameIndex">
            Partie #{{ g.gameIndex }} — {{ g.winner === 'PLAYER' ? 'VICTOIRE' : g.winner === 'OPPONENT' ? 'DÉFAITE' : 'ÉGALITÉ' }} vs {{ g.opponentName }} ({{ g.totalTurns }}t)
          </option>
        </select>
      </div>
    </div>

    <div v-if="!activeGame" class="py-8 text-center text-sm text-slate-500">
      Aucune partie tracée ne correspond aux filtres sélectionnés.
    </div>

    <div v-else class="mt-5 space-y-6">
      <!-- 1. RÉSUMÉ DE LA PARTIE SÉLECTIONNÉE : Mains Initiales & 6 Cartes Récompenses des 2 joueurs -->
      <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-sm font-bold text-slate-900">
              Partie #{{ activeGame.gameIndex }}
            </span>
            <span
              class="rounded-md px-2 py-0.5 font-mono text-xs font-bold"
              :class="
                activeGame.winner === 'PLAYER'
                  ? 'bg-emerald-100 text-emerald-800'
                  : activeGame.winner === 'OPPONENT'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-slate-200 text-slate-700'
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
            <span class="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700">
              Motif : {{ formatWinReason(activeGame.winReason) }}
            </span>
            <span class="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs text-slate-600">
              Seed: {{ activeGame.seed }}
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-3 font-mono text-xs text-slate-600">
            <span>1er Joueur : <strong>{{ activeGame.firstPlayer === 'PLAYER' ? 'Joueur' : 'Adversaire' }}</strong></span>
            <span>•</span>
            <span>Prizes gagnés : <strong>{{ activeGame.playerPrizesWon }} - {{ activeGame.opponentPrizesWon }}</strong></span>
            <span>•</span>
            <span>Mulligans : <strong>J:{{ activeGame.playerMulligans }} / Adv:{{ activeGame.opponentMulligans }}</strong></span>
          </div>
        </div>

        <!-- Mains initiales (7 cartes) & 6 Récompenses des deux joueurs -->
        <div class="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <!-- Ouverture Joueur -->
          <div class="rounded-lg border border-slate-200 bg-white p-3">
            <div class="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Ouverture Joueur (Main initiale 7 cartes &amp; 6 Récompenses)
            </div>
            <div class="mt-2">
              <div class="text-[11px] font-semibold text-slate-500">Main initiale (7 cartes) :</div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(cName, idx) in activeGame.playerInitialHand"
                  :key="idx"
                  class="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-800"
                >
                  {{ cName }}
                </span>
              </div>
            </div>
            <div class="mt-2.5">
              <div class="text-[11px] font-semibold text-slate-500">6 Cartes Récompenses initiales :</div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(pName, idx) in activeGame.playerInitialPrizes"
                  :key="idx"
                  class="rounded border border-amber-200 bg-amber-50/70 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-900"
                >
                  #{{ idx + 1 }} {{ pName }}
                </span>
              </div>
            </div>
          </div>

          <!-- Ouverture Adversaire -->
          <div class="rounded-lg border border-slate-200 bg-white p-3">
            <div class="text-xs font-bold uppercase tracking-wider text-rose-800">
              Ouverture Adversaire — {{ activeGame.opponentName }}
            </div>
            <div class="mt-2">
              <div class="text-[11px] font-semibold text-slate-500">Main initiale adverse (7 cartes) :</div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(cName, idx) in activeGame.opponentInitialHand"
                  :key="idx"
                  class="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-800"
                >
                  {{ cName }}
                </span>
              </div>
            </div>
            <div class="mt-2.5">
              <div class="text-[11px] font-semibold text-slate-500">6 Cartes Récompenses adverses :</div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(pName, idx) in activeGame.opponentInitialPrizes"
                  :key="idx"
                  class="rounded border border-rose-200 bg-rose-50/60 px-2 py-0.5 font-mono text-[11px] font-medium text-rose-900"
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
          <div class="text-xs font-bold uppercase tracking-wider text-slate-600">
            Timeline Interactive des Tours ({{ activeGame.turns.length }} demi-tours joués)
          </div>

          <div class="flex items-center gap-1.5">
            <span class="text-xs text-slate-500">État du plateau affiché :</span>
            <button
              type="button"
              @click="boardSnapshotTiming = 'BEFORE'"
              class="rounded-md border px-2.5 py-1 text-xs font-semibold transition"
              :class="
                boardSnapshotTiming === 'BEFORE'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
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
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
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
                ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                : t.actingPlayer === 'PLAYER'
                  ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 hover:bg-emerald-100/70'
                  : 'border-rose-200 bg-rose-50/70 text-rose-900 hover:bg-rose-100/70'
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
        <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-900 px-4 py-3 text-white">
          <div class="flex flex-wrap items-center gap-2.5">
            <span class="rounded bg-white/15 px-2 py-0.5 font-mono text-xs font-bold">
              TOUR {{ activeTurn.turnNumber }} — {{ activeTurn.actingPlayer === 'PLAYER' ? 'TOUR DU JOUEUR' : 'TOUR DE L’ADVERSAIRE' }}
            </span>
            <span v-if="activeTurn.drawnCardName" class="text-xs text-slate-300">
              Pioche du tour : <strong class="text-white">{{ activeTurn.drawnCardName }}</strong>
            </span>
            <span
              v-if="activeTurn.perturbationNote"
              class="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-slate-950"
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
          <div class="rounded-xl border border-emerald-200 bg-emerald-50/25 p-4">
            <div class="flex items-center justify-between border-b border-emerald-200/70 pb-2.5">
              <div class="flex items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
                <h4 class="text-xs font-bold uppercase tracking-wider text-emerald-950">
                  Plateau du Joueur ({{ boardSnapshotTiming === 'AFTER' ? 'Fin de tour' : 'Début de tour' }})
                </h4>
              </div>
              <div class="flex items-center gap-2 font-mono text-xs text-slate-700">
                <span class="rounded bg-white px-2 py-0.5 font-bold text-emerald-800 shadow-2xs">
                  Récompenses restantes : {{ displayedPlayerBoard.prizesRemaining }} / 6
                </span>
                <span>Deck: {{ displayedPlayerBoard.deckCount }}</span>
                <span>Défausse: {{ displayedPlayerBoard.discardCount }}</span>
              </div>
            </div>

            <!-- Poste Actif Joueur -->
            <div class="mt-3">
              <div class="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Poste Actif
              </div>
              <div
                v-if="displayedPlayerBoard.active"
                class="mt-1 rounded-lg border border-emerald-300 bg-white p-3 shadow-2xs"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-bold text-slate-900">
                      {{ displayedPlayerBoard.active.nameFr }}
                    </span>
                    <span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                      {{ displayedPlayerBoard.active.subCategory }}
                    </span>
                  </div>
                  <span class="font-mono text-xs font-bold text-emerald-700">
                    {{ displayedPlayerBoard.active.currentHp }} / {{ displayedPlayerBoard.active.maxHp }} PV
                    <span v-if="displayedPlayerBoard.active.damage > 0" class="text-red-600">
                      (-{{ displayedPlayerBoard.active.damage }})
                    </span>
                  </span>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                  <span
                    v-for="(en, eIdx) in displayedPlayerBoard.active.attachedEnergies"
                    :key="eIdx"
                    class="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-900"
                  >
                    NRJ: {{ en }}
                  </span>
                  <span
                    v-for="(tl, tIdx) in displayedPlayerBoard.active.attachedTools"
                    :key="tIdx"
                    class="rounded bg-indigo-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-900"
                  >
                    Outil: {{ tl }}
                  </span>
                  <span
                    v-if="
                      displayedPlayerBoard.active.attachedEnergies.length === 0 &&
                      displayedPlayerBoard.active.attachedTools.length === 0
                    "
                    class="text-[11px] text-slate-400"
                  >
                    Aucune énergie ni outil attaché
                  </span>
                </div>
              </div>
              <div v-else class="mt-1 rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-400">
                Aucun Pokémon Actif
              </div>
            </div>

            <!-- Banc Joueur (max 5) -->
            <div class="mt-3">
              <div class="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Banc ({{ displayedPlayerBoard.bench.length }} / 5)
              </div>
              <div
                v-if="displayedPlayerBoard.bench.length > 0"
                class="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <div
                  v-for="(bPoke, bIdx) in displayedPlayerBoard.bench"
                  :key="bPoke.instanceId"
                  class="rounded-lg border border-slate-200 bg-white p-2.5 text-xs"
                >
                  <div class="flex items-center justify-between font-semibold text-slate-800">
                    <span>#{{ bIdx + 1 }} {{ bPoke.nameFr }}</span>
                    <span class="font-mono text-[11px] text-slate-600">
                      {{ bPoke.currentHp }}/{{ bPoke.maxHp }} PV
                    </span>
                  </div>
                  <div class="mt-1 flex flex-wrap gap-1">
                    <span
                      v-for="(en, eIdx) in bPoke.attachedEnergies"
                      :key="eIdx"
                      class="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-800"
                    >
                      NRJ: {{ en }}
                    </span>
                  </div>
                </div>
              </div>
              <div v-else class="mt-1 text-xs text-slate-400">Banc vide</div>
            </div>

            <!-- Main Joueur -->
            <div class="mt-3 border-t border-emerald-200/60 pt-2.5">
              <div class="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Main ({{ displayedPlayerBoard.hand.length }} cartes)
              </div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(hCard, hIdx) in displayedPlayerBoard.hand"
                  :key="hIdx"
                  class="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-800"
                >
                  {{ hCard }}
                </span>
                <span v-if="displayedPlayerBoard.hand.length === 0" class="text-xs text-slate-400">
                  Main vide
                </span>
              </div>
            </div>
          </div>

          <!-- Plateau Adversaire -->
          <div class="rounded-xl border border-rose-200 bg-rose-50/25 p-4">
            <div class="flex items-center justify-between border-b border-rose-200/70 pb-2.5">
              <div class="flex items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full bg-rose-600"></span>
                <h4 class="text-xs font-bold uppercase tracking-wider text-rose-950">
                  Plateau Adverse ({{ boardSnapshotTiming === 'AFTER' ? 'Fin de tour' : 'Début de tour' }})
                </h4>
              </div>
              <div class="flex items-center gap-2 font-mono text-xs text-slate-700">
                <span class="rounded bg-white px-2 py-0.5 font-bold text-rose-800 shadow-2xs">
                  Récompenses restantes : {{ displayedOpponentBoard.prizesRemaining }} / 6
                </span>
                <span>Deck: {{ displayedOpponentBoard.deckCount }}</span>
                <span>Défausse: {{ displayedOpponentBoard.discardCount }}</span>
              </div>
            </div>

            <!-- Poste Actif Adversaire -->
            <div class="mt-3">
              <div class="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Poste Actif Adverse
              </div>
              <div
                v-if="displayedOpponentBoard.active"
                class="mt-1 rounded-lg border border-rose-300 bg-white p-3 shadow-2xs"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-bold text-slate-900">
                      {{ displayedOpponentBoard.active.nameFr }}
                    </span>
                    <span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                      {{ displayedOpponentBoard.active.subCategory }}
                    </span>
                  </div>
                  <span class="font-mono text-xs font-bold text-rose-700">
                    {{ displayedOpponentBoard.active.currentHp }} / {{ displayedOpponentBoard.active.maxHp }} PV
                    <span v-if="displayedOpponentBoard.active.damage > 0" class="text-red-600">
                      (-{{ displayedOpponentBoard.active.damage }})
                    </span>
                  </span>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                  <span
                    v-for="(en, eIdx) in displayedOpponentBoard.active.attachedEnergies"
                    :key="eIdx"
                    class="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-900"
                  >
                    NRJ: {{ en }}
                  </span>
                  <span
                    v-for="(tl, tIdx) in displayedOpponentBoard.active.attachedTools"
                    :key="tIdx"
                    class="rounded bg-indigo-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-900"
                  >
                    Outil: {{ tl }}
                  </span>
                  <span
                    v-if="
                      displayedOpponentBoard.active.attachedEnergies.length === 0 &&
                      displayedOpponentBoard.active.attachedTools.length === 0
                    "
                    class="text-[11px] text-slate-400"
                  >
                    Aucune énergie ni outil attaché
                  </span>
                </div>
              </div>
              <div v-else class="mt-1 rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-400">
                Aucun Pokémon Actif
              </div>
            </div>

            <!-- Banc Adversaire -->
            <div class="mt-3">
              <div class="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Banc Adverse ({{ displayedOpponentBoard.bench.length }} / 5)
              </div>
              <div
                v-if="displayedOpponentBoard.bench.length > 0"
                class="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <div
                  v-for="(bPoke, bIdx) in displayedOpponentBoard.bench"
                  :key="bPoke.instanceId"
                  class="rounded-lg border border-slate-200 bg-white p-2.5 text-xs"
                >
                  <div class="flex items-center justify-between font-semibold text-slate-800">
                    <span>#{{ bIdx + 1 }} {{ bPoke.nameFr }}</span>
                    <span class="font-mono text-[11px] text-slate-600">
                      {{ bPoke.currentHp }}/{{ bPoke.maxHp }} PV
                    </span>
                  </div>
                  <div class="mt-1 flex flex-wrap gap-1">
                    <span
                      v-for="(en, eIdx) in bPoke.attachedEnergies"
                      :key="eIdx"
                      class="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-800"
                    >
                      NRJ: {{ en }}
                    </span>
                  </div>
                </div>
              </div>
              <div v-else class="mt-1 text-xs text-slate-400">Banc adverse vide</div>
            </div>

            <!-- Main Adversaire -->
            <div class="mt-3 border-t border-rose-200/60 pt-2.5">
              <div class="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Main Adverse ({{ displayedOpponentBoard.hand.length }} cartes)
              </div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="(hCard, hIdx) in displayedOpponentBoard.hand"
                  :key="hIdx"
                  class="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-800"
                >
                  {{ hCard }}
                </span>
                <span v-if="displayedOpponentBoard.hand.length === 0" class="text-xs text-slate-400">
                  Main adverse vide
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. COMPARATEUR DES BRANCHES CANDIDATES 3-PLY DU TOUR (T -> T_adv -> T+1) -->
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div>
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-800">
                Comparateur d'Arbre 3-Ply du Tour {{ activeTurn.turnNumber }} — Branches Candidates Évaluées
              </h4>
              <p class="text-xs text-slate-500">
                Formule : <code class="font-mono">Score Total = 0.35 × Score(T) - 0.30 × Score(T_adv) + 0.35 × Score(T+1)</code>
              </p>
            </div>
            <span class="rounded border border-slate-200 bg-white px-2.5 py-1 font-mono text-xs font-bold text-slate-700">
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
                  ? 'border-emerald-500 bg-emerald-50/50 shadow-2xs'
                  : 'border-slate-200 bg-white'
              "
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span
                    class="rounded px-2 py-0.5 font-mono text-xs font-bold"
                    :class="
                      branch.isChosen
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 text-slate-700'
                    "
                  >
                    {{ branch.branchId }} {{ branch.isChosen ? '— BRANCHE RETENUE' : '— Écartée' }}
                  </span>
                  <span class="text-xs font-semibold text-slate-600">
                    {{ branch.actions.length }} action(s) dans la séquence
                  </span>
                </div>

                <!-- Détail mathématique des scores -->
                <div class="flex flex-wrap items-center gap-2 font-mono text-xs">
                  <span class="rounded border border-slate-200 bg-white px-2 py-0.5 text-slate-700">
                    Score T: <strong>{{ branch.scoreT }}</strong>
                  </span>
                  <span class="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-800">
                    Score T_adv: <strong>{{ branch.scoreTAdv }}</strong>
                  </span>
                  <span class="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-800">
                    Score T+1: <strong>{{ branch.scoreTPlus1 }}</strong>
                  </span>
                  <span
                    class="rounded px-2.5 py-0.5 font-bold"
                    :class="
                      branch.isChosen
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-900 text-white'
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
                    class="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800 shadow-2xs"
                  >
                    <strong class="font-mono text-[10px] text-slate-400">{{ aIdx + 1 }}.</strong>
                    {{ actLabel }}
                  </span>
                  <span v-if="aIdx < branch.actions.length - 1" class="font-mono text-xs text-slate-400">
                    →
                  </span>
                </template>
              </div>

              <!-- Réaction anticipée de l'adversaire (T_adv) & Rebond (T+1) -->
              <div class="mt-2.5 grid grid-cols-1 gap-2 border-t border-slate-200/70 pt-2 text-[11px] sm:grid-cols-2">
                <div class="text-rose-900">
                  <span class="font-bold">Riposte anticipée ($T_{\text{adv}}$) :</span>
                  {{ branch.opponentReactionSummary }}
                </div>
                <div class="text-indigo-900">
                  <span class="font-bold">Rebond projeté ($T+1$) :</span>
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
