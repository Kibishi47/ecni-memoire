<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlertOctagon,
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  Flame,
  GitBranch,
  Hand,
  Layers,
  Lock,
  ShieldAlert,
  Sparkles,
  Swords,
  XCircle,
} from 'lucide-vue-next'
import type { SampledGameRecord } from '@/types/engine'

const props = defineProps<{
  sampledGames: SampledGameRecord[]
  initialFilterTag?: 'PERFECT_T2' | 'BRICK' | 'CANDY_PRIZED' | null
}>()

const selectedIdx = ref(0)
const activeQuickFilter = ref<'ALL' | 'PERFECT_T2' | 'BRICK' | 'CANDY_PRIZED'>('ALL')

const currentGame = computed<SampledGameRecord | null>(() => {
  if (!props.sampledGames.length) return null
  return props.sampledGames[selectedIdx.value] ?? props.sampledGames[0]
})

function selectByFilterTag(tag: 'PERFECT_T2' | 'BRICK' | 'CANDY_PRIZED') {
  activeQuickFilter.value = tag
  const idx = props.sampledGames.findIndex((g) => g.tags.includes(tag))
  if (idx !== -1) {
    selectedIdx.value = idx
  } else if (tag === 'CANDY_PRIZED') {
    const fallbackIdx = props.sampledGames.findIndex(
      (g) => g.rareCandyPrizedCount >= 1 || g.charizardPrizedCount >= 1,
    )
    if (fallbackIdx !== -1) selectedIdx.value = fallbackIdx
  }
}

watch(
  () => props.initialFilterTag,
  (tag) => {
    if (tag) selectByFilterTag(tag)
  },
  { immediate: true },
)

watch(
  () => props.sampledGames,
  (games) => {
    if (selectedIdx.value >= games.length) {
      selectedIdx.value = 0
    }
  },
)

function isCriticalPrizeCard(name: string): boolean {
  return (
    name.includes('Super Bonbon') ||
    name.includes('Dracaufeu ex') ||
    name.includes('Roucarnage ex')
  )
}

function prevGame() {
  activeQuickFilter.value = 'ALL'
  if (selectedIdx.value > 0) selectedIdx.value--
}

function nextGame() {
  activeQuickFilter.value = 'ALL'
  if (selectedIdx.value < props.sampledGames.length - 1) selectedIdx.value++
}
</script>

<template>
  <div v-if="currentGame" class="space-y-6">
    <!-- 1. Barre de Sélection & Filtres Rapides d'Archétypes de Parties -->
    <section class="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
            <GitBranch class="w-4 h-4 text-blue-600" />
            Inspecteur Double Plateau, Prize Checking & Anticipation Expectiminimax (T ➔ T_adv ➔ T+1)
          </h3>
          <p class="text-xs text-slate-500 mt-0.5">
            Inspectez tour par tour la déduction des 6 Récompenses, le Threat Scoring du plateau adverse et l'arbitrage Expectiminimax à horizon T+1.
          </p>
        </div>

        <!-- Sélecteur Partie #1 à #50 -->
        <div class="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
          <button
            type="button"
            class="p-1.5 rounded bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            :disabled="selectedIdx <= 0"
            @click="prevGame"
          >
            <ChevronLeft class="w-3.5 h-3.5" />
          </button>

          <select
            v-model="selectedIdx"
            class="px-2.5 py-1 text-xs font-mono font-semibold bg-white border border-slate-200 rounded text-slate-900 focus:outline-none focus:border-blue-600"
            @change="activeQuickFilter = 'ALL'"
          >
            <option
              v-for="(g, idx) in sampledGames"
              :key="g.gameIndex"
              :value="idx"
            >
              Partie #{{ g.gameIndex }} ({{ g.turnsPlayed }}/{{ g.maxTurnsConfigured }} tours • Seed {{ g.seedUsed }} • {{ g.finalBoardScore }} pts)
            </option>
          </select>

          <button
            type="button"
            class="p-1.5 rounded bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            :disabled="selectedIdx >= sampledGames.length - 1"
            @click="nextGame"
          >
            <ChevronRight class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <!-- 3 Boutons de Filtres Rapides Demandés -->
      <div class="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-200">
        <span class="text-[11px] font-mono uppercase text-slate-500 mr-1">Filtres rapides :</span>

        <button
          type="button"
          class="px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-all"
          :class="
            activeQuickFilter === 'PERFECT_T2'
              ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
              : 'bg-emerald-50/70 text-emerald-800 border-emerald-200 hover:bg-emerald-100/70'
          "
          @click="selectByFilterTag('PERFECT_T2')"
        >
          <Sparkles class="w-3.5 h-3.5" />
          Voir une sortie T2 parfaite (Dracaufeu + Roucarnage)
        </button>

        <button
          type="button"
          class="px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-all"
          :class="
            activeQuickFilter === 'BRICK'
              ? 'bg-red-600 text-white border-red-600 shadow-sm'
              : 'bg-red-50/70 text-red-800 border-red-200 hover:bg-red-100/70'
          "
          @click="selectByFilterTag('BRICK')"
        >
          <AlertOctagon class="w-3.5 h-3.5" />
          Voir un cas de Brick (Main morte)
        </button>

        <button
          type="button"
          class="px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-all"
          :class="
            activeQuickFilter === 'CANDY_PRIZED'
              ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
              : 'bg-amber-50/70 text-amber-800 border-amber-200 hover:bg-amber-100/70'
          "
          @click="selectByFilterTag('CANDY_PRIZED')"
        >
          <Lock class="w-3.5 h-3.5" />
          Voir un cas où les Super Bonbon sont bloqués dans les 6 Récompenses
        </button>
      </div>
    </section>

    <!-- 2. État Initial & Bandeau Prize Checking (Connaissance des 6 Récompenses) -->
    <section class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div
        class="px-5 py-3 border-b border-slate-200 bg-slate-50/80 flex flex-wrap items-center justify-between gap-2"
      >
        <div class="flex items-center gap-2.5">
          <span class="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-xs font-bold">
            PARTIE #{{ currentGame.gameIndex }}
          </span>
          <span class="text-xs font-mono text-slate-500">
            Sub-Seed Mulberry32 : <strong class="text-slate-800">{{ currentGame.seedUsed }}</strong>
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <span
            class="px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold border"
            :class="
              currentGame.endedEarly
                ? currentGame.endReason === 'VICTORY_ALL_PRIZES'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-red-50 text-red-700 border-red-200'
                : 'bg-blue-50 text-blue-700 border-blue-200'
            "
          >
            {{ currentGame.turnsPlayed }} / {{ currentGame.maxTurnsConfigured }} tour(s) • {{ currentGame.endReasonLabel }}
          </span>
          <span
            class="px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold border"
            :class="
              currentGame.mulliganCount > 0
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-slate-100 text-slate-700 border-slate-200'
            "
            title="Règle officielle JCC Pokémon : Redonne obligatoire uniquement lorsque la main initiale de 7 cartes ne contient aucun Pokémon de Base."
          >
            Mulligans (0 Base) : {{ currentGame.mulliganCount }}
          </span>
          <span
            v-if="currentGame.turn2CharizardReady"
            class="px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200"
          >
            ✓ Sortie T2 Dracaufeu ex Prête
          </span>
          <span
            v-if="currentGame.bricked"
            class="px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold border bg-red-50 text-red-700 border-red-200"
          >
            ✗ Brick / Main Morte
          </span>
        </div>
      </div>

      <div class="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
        <!-- Main de départ (7 cartes) -->
        <div class="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2.5">
          <div class="flex items-center justify-between">
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Hand class="w-3.5 h-3.5 text-slate-500" />
              Main de Départ Validée (7 Cartes)
            </h4>
            <span class="text-[11px] font-mono text-slate-500">
              Après {{ currentGame.mulliganCount }} mulligan(s)
            </span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="(cardName, cIdx) in currentGame.initialHandNames"
              :key="cIdx"
              class="px-2.5 py-1 rounded border text-xs font-medium bg-white border-slate-200 text-slate-800 shadow-2xs"
            >
              {{ cardName }}
            </span>
          </div>
        </div>

        <!-- Bandeau Prize Checking (Connaissance des 6 Récompenses) -->
        <div class="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Award class="w-3.5 h-3.5 text-slate-500" />
              Prize Checking (Connaissance des 6 Récompenses)
            </h4>
            <div class="flex items-center gap-1.5">
              <span
                v-if="currentGame.firstSearchTurn !== null"
                class="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200 inline-flex items-center gap-1"
              >
                <Eye class="w-3 h-3" />
                Déduit par inspection du deck au T{{ currentGame.firstSearchTurn }}
              </span>
              <span
                v-else
                class="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 text-slate-600 border border-slate-200 inline-flex items-center gap-1"
              >
                <EyeOff class="w-3 h-3" />
                Inconnues du joueur (?) — Aucune recherche deck
              </span>

              <span
                v-if="currentGame.criticalPrizesCount > 0"
                class="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-red-50 text-red-700 border border-red-200"
              >
                {{ currentGame.criticalPrizesCount }} pièce(s) maîtresse(s) Prized
              </span>
            </div>
          </div>

          <div v-if="currentGame.prizeCardNames.length > 0" class="flex flex-wrap gap-1.5">
            <span
              v-for="(pName, pIdx) in currentGame.prizeCardNames"
              :key="pIdx"
              class="px-2.5 py-1 rounded border text-xs font-medium inline-flex items-center gap-1"
              :class="
                isCriticalPrizeCard(pName)
                  ? 'bg-red-50 text-red-700 border-red-200 font-bold'
                  : 'bg-white text-slate-700 border-slate-200'
              "
            >
              <Lock v-if="isCriticalPrizeCard(pName)" class="w-3 h-3 text-red-600 shrink-0" />
              #{{ pIdx + 1 }} {{ pName }}
            </span>
          </div>
          <div v-else class="text-xs font-mono text-slate-500 italic">
            Règle des 6 Récompenses désactivée pour cette simulation théorique.
          </div>
        </div>
      </div>
    </section>

    <!-- 3. Chronologie Pas-à-Pas : Tour 1 ➔ Tour N -->
    <div class="space-y-5">
      <section
        v-for="turn in currentGame.turns"
        :key="turn.turnNumber"
        class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
      >
        <!-- Turn Header -->
        <div
          class="px-5 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3"
        >
          <div class="flex flex-wrap items-center gap-3">
            <span class="px-2.5 py-1 rounded bg-slate-900 text-white font-mono text-xs font-bold">
              TOUR {{ turn.turnNumber }}
            </span>
            <div class="text-xs text-slate-700 flex items-center gap-1.5">
              <span class="text-slate-500">Pioche du tour :</span>
              <span
                class="px-2 py-0.5 rounded bg-white border border-slate-200 font-mono font-semibold text-slate-900"
              >
                + {{ turn.drawnCardName ?? 'Aucune' }}
              </span>
            </div>
            <span class="text-xs font-mono text-slate-500">
              Deck : {{ turn.deckCountStart }} ➔ {{ turn.deckCountEnd }} cartes
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-[11px] font-mono">
            <!-- Statut Prize Checking sur ce tour -->
            <span
              class="px-2 py-0.5 rounded border inline-flex items-center gap-1 font-semibold"
              :class="
                turn.prizesKnownByPlayer
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
              "
            >
              <Eye v-if="turn.prizesKnownByPlayer" class="w-3 h-3" />
              <EyeOff v-else class="w-3 h-3" />
              {{
                turn.prizesKnownByPlayer
                  ? `Prizes déduites (T${currentGame.firstSearchTurn ?? turn.turnNumber})`
                  : 'Prizes inconnues (?)'
              }}
            </span>

            <span
              class="px-2 py-0.5 rounded border"
              :class="
                turn.supporterPlayedThisTurn
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
              "
            >
              Supporter : {{ turn.supporterPlayedThisTurn ? '1 / 1 joué' : '0 / 1' }}
            </span>
            <span
              class="px-2 py-0.5 rounded border"
              :class="
                turn.energyAttachedThisTurn
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
              "
            >
              Énergie manuelle : {{ turn.energyAttachedThisTurn ? '1 / 1' : '0 / 1' }}
            </span>
            <span
              class="px-2 py-0.5 rounded border"
              :class="
                turn.vstarUsedInGame
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
              "
            >
              Puissance VSTAR : {{ turn.vstarUsedInGame ? 'Utilisée' : 'Disponible' }}
            </span>
          </div>
        </div>

        <!-- Bandeau Déduction Prize Checking lors du 1er SEARCH_DECK -->
        <div
          v-if="turn.prizeCheckDeductionNote"
          class="px-5 py-2 bg-indigo-50/80 border-b border-indigo-200 text-indigo-900 text-xs font-mono flex items-center gap-2"
        >
          <Eye class="w-4 h-4 text-indigo-600 shrink-0" />
          <span>{{ turn.prizeCheckDeductionNote }}</span>
        </div>

        <!-- Alerte Perturbation Adverse T3 si présente -->
        <div
          v-if="turn.disruptionApplied"
          class="px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs font-mono flex items-center gap-2"
        >
          <AlertOctagon class="w-4 h-4 text-amber-600 shrink-0" />
          <strong>{{ turn.disruptionApplied }}</strong>
        </div>

        <!-- Résolution d'Attaque de Fin de Tour si présente -->
        <div
          v-if="turn.attackExecuted"
          class="px-5 py-2 bg-emerald-50/70 border-b border-emerald-200 text-emerald-800 text-xs font-mono flex items-center gap-2"
        >
          <Swords class="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{{ turn.attackExecuted }}</span>
        </div>

        <!-- Événement de Fin de Partie Anticipée / Terminale si présent -->
        <div
          v-if="turn.terminalEvent"
          class="px-5 py-2.5 border-b text-xs font-mono font-bold flex items-center gap-2"
          :class="
            currentGame.endReason === 'VICTORY_ALL_PRIZES'
              ? 'bg-emerald-100/80 border-emerald-300 text-emerald-900'
              : 'bg-red-100/80 border-red-300 text-red-900'
          "
        >
          <CheckCircle2
            v-if="currentGame.endReason === 'VICTORY_ALL_PRIZES'"
            class="w-4 h-4 text-emerald-700 shrink-0"
          />
          <AlertOctagon v-else class="w-4 h-4 text-red-700 shrink-0" />
          <span>🏁 {{ turn.terminalEvent }}</span>
        </div>

        <div class="p-5 grid grid-cols-1 xl:grid-cols-12 gap-5">
          <!-- Colonne Gauche (7 cols) : Comparateur de Branches Expectiminimax (T ➔ T_adv ➔ T+1) -->
          <div class="xl:col-span-7 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <GitBranch class="w-3.5 h-3.5 text-blue-600" />
                Comparateur de Branches Expectiminimax ({{ turn.branches.length }} branche(s) évaluée(s))
              </h4>
              <span class="text-[11px] font-mono text-slate-500">
                U(S_T) = V_immédiat(S_T) + 0.75 × E[V_rebond(S_T+1)]
              </span>
            </div>

            <div class="space-y-3">
              <div
                v-for="branch in turn.branches"
                :key="branch.branchId"
                class="p-3.5 rounded-lg border transition-all"
                :class="
                  branch.selected
                    ? 'bg-emerald-50/40 border-emerald-300 ring-1 ring-emerald-500/20'
                    : 'bg-slate-50/60 border-slate-200 opacity-90'
                "
              >
                <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200/80">
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold border"
                      :class="
                        branch.selected
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      "
                    >
                      <CheckCircle2 v-if="branch.selected" class="w-3 h-3" />
                      <XCircle v-else class="w-3 h-3" />
                      {{ branch.selected ? 'RETENUE' : 'ÉCARTÉE' }}
                    </span>
                    <span class="text-xs font-bold text-slate-900">{{ branch.label }}</span>

                    <span
                      v-if="branch.attackTargetSummary"
                      class="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-50 text-amber-800 border border-amber-200 inline-flex items-center gap-1"
                    >
                      <Crosshair class="w-3 h-3 text-amber-600" />
                      {{ branch.attackTargetSummary }}
                    </span>
                  </div>

                  <div class="flex items-center gap-2">
                    <span
                      v-if="branch.thinningDelta > 0"
                      class="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-50 text-blue-700 border border-blue-200"
                    >
                      Thinning : -{{ branch.thinningDelta }} cartes
                    </span>
                    <span
                      class="px-2.5 py-0.5 rounded font-mono text-xs font-bold border"
                      :class="
                        branch.selected
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-slate-700 border-slate-200'
                      "
                    >
                      U(S_T) : {{ branch.boardScore }} pts
                    </span>
                  </div>
                </div>

                <!-- Séquence d'actions de la branche -->
                <div class="mt-2.5 space-y-1">
                  <div
                    v-for="(act, aIdx) in branch.actions"
                    :key="aIdx"
                    class="text-xs font-mono text-slate-800 flex items-start gap-2"
                  >
                    <span class="text-slate-400 select-none">{{ aIdx + 1 }}.</span>
                    <span>{{ act }}</span>
                  </div>
                </div>

                <!-- Encart Projection Expectiminimax (T -> T_adv -> T+1) -->
                <div
                  v-if="branch.expectiminimax"
                  class="mt-3 p-2.5 rounded-md bg-white border border-slate-200 space-y-2"
                >
                  <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                    <span class="font-bold text-slate-800">
                      {{ branch.expectiminimax.summaryLine }}
                    </span>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span
                        v-if="branch.expectiminimax.energyBankingBonus > 0"
                        class="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-800 border border-amber-200 font-semibold"
                      >
                        Energy Banking : +{{ branch.expectiminimax.energyBankingBonus }} pts
                      </span>
                      <span
                        v-if="branch.expectiminimax.resourceConservationBonus > 0"
                        class="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-800 border border-blue-200 font-semibold"
                      >
                        Conservation T+1 : +{{ branch.expectiminimax.resourceConservationBonus }} pts
                      </span>
                      <span
                        v-if="branch.expectiminimax.threatReductionBonus > 0"
                        class="px-1.5 py-0.5 rounded text-[10px] bg-purple-50 text-purple-800 border border-purple-200 font-semibold"
                      >
                        Menace éliminée : +{{ branch.expectiminimax.threatReductionBonus }} pts
                      </span>
                    </div>
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1.5 border-t border-slate-100 text-[10px] font-mono">
                    <div class="p-1.5 rounded bg-slate-50 border border-slate-200/70">
                      <div class="text-slate-500 uppercase">1. Tour T (Immédiat)</div>
                      <div class="font-bold text-slate-900 mt-0.5">
                        V_immédiat = {{ branch.expectiminimax.immediateScore }} pts
                      </div>
                    </div>

                    <div class="p-1.5 rounded bg-slate-50 border border-slate-200/70">
                      <div class="text-slate-500 uppercase">2. Scénario Adverse T_adv</div>
                      <div class="font-semibold text-slate-800 mt-0.5">
                        KO: {{ branch.expectiminimax.opponentKoProbPct }}% • Mashynn: {{ branch.expectiminimax.opponentIonoProbPct }}% • Boss: {{ branch.expectiminimax.opponentGustProbPct }}%
                      </div>
                    </div>

                    <div class="p-1.5 rounded bg-slate-50 border border-slate-200/70">
                      <div class="text-slate-500 uppercase">3. Rebond T+1 (0.75×E)</div>
                      <div class="font-bold mt-0.5 flex items-center justify-between">
                        <span
                          :class="
                            branch.expectiminimax.reboundExpectedScore >= 0
                              ? 'text-emerald-700'
                              : 'text-red-700'
                          "
                        >
                          E[V_rebond] = {{ branch.expectiminimax.reboundExpectedScore >= 0 ? '+' : '' }}{{ branch.expectiminimax.reboundExpectedScore }} pts
                        </span>
                        <span
                          v-if="branch.expectiminimax.revengeKillReadyAtTPlus1"
                          class="px-1 rounded bg-emerald-100 text-emerald-800 text-[9px]"
                        >
                          Revenge T+1 ✓
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Décomposition du Score de Plateau -->
                <div
                  v-if="branch.scoreBreakdown.length > 0"
                  class="mt-2.5 pt-2 border-t border-slate-200/70 flex flex-wrap gap-1.5"
                >
                  <span
                    v-for="(bd, bIdx) in branch.scoreBreakdown"
                    :key="bIdx"
                    class="px-2 py-0.5 rounded text-[10px] font-mono bg-white border border-slate-200 text-slate-600"
                  >
                    {{ bd }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Colonne Droite (5 cols) : Vue "Double Plateau Face-à-Face" (Adversaire vs Joueur) -->
          <div class="xl:col-span-5 space-y-3">
            <div class="flex items-center justify-between">
              <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Layers class="w-3.5 h-3.5 text-slate-600" />
                Double Plateau Face-à-Face (Fin T{{ turn.turnNumber }})
              </h4>
              <span class="text-[11px] font-mono text-slate-500">
                Prizes : Joueur {{ turn.prizesRemaining }} vs Adv {{ turn.opponentPrizesRemaining }}
              </span>
            </div>

            <!-- PLATEAU ADVERSE (Haut du Face-à-Face) -->
            <div class="p-3.5 rounded-lg border border-red-200 bg-red-50/30 space-y-2.5">
              <div class="flex items-center justify-between border-b border-red-200/70 pb-1.5">
                <span class="text-[11px] font-mono font-bold uppercase text-red-900 flex items-center gap-1.5">
                  <ShieldAlert class="w-3.5 h-3.5 text-red-600" />
                  Plateau Adverse & Threat Scoring
                </span>
                <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-white text-red-700 border border-red-200">
                  Récompenses Adv : {{ turn.opponentPrizesRemaining }} / 6
                </span>
              </div>

              <!-- Poste Actif Adverse -->
              <div
                v-if="turn.opponentActivePokemon"
                class="p-2.5 rounded bg-white border border-red-200 space-y-1.5"
              >
                <div class="flex flex-wrap items-center justify-between gap-1.5">
                  <div class="flex items-center gap-1.5">
                    <span class="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-red-100 text-red-800">
                      Actif Adv
                    </span>
                    <span class="text-xs font-bold text-slate-900">
                      {{ turn.opponentActivePokemon.name }}
                    </span>
                    <span class="text-[10px] font-mono text-slate-500">
                      ({{ turn.opponentActivePokemon.hp }} PV • {{ turn.opponentActivePokemon.prizeValue }}P)
                    </span>
                  </div>

                  <span
                    class="px-2 py-0.5 rounded text-[10px] font-mono font-bold border"
                    :class="
                      turn.opponentActivePokemon.threatScore >= 130
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    "
                  >
                    Menace : {{ turn.opponentActivePokemon.threatScore }} pts
                  </span>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono">
                  <span class="text-slate-600">{{ turn.opponentActivePokemon.roleLabel }}</span>
                  <span class="text-amber-700 font-semibold">
                    ⚡ {{ turn.opponentActivePokemon.attachedEnergies }} Énergie(s)
                  </span>
                </div>

                <div
                  v-if="turn.opponentActivePokemon.threatBreakdown.length > 0"
                  class="flex flex-wrap gap-1 pt-1 border-t border-slate-100"
                >
                  <span
                    v-for="(tb, tIdx) in turn.opponentActivePokemon.threatBreakdown"
                    :key="tIdx"
                    class="px-1.5 py-0.2 rounded text-[9px] font-mono bg-slate-50 text-slate-600 border border-slate-200"
                  >
                    {{ tb }}
                  </span>
                </div>
              </div>

              <!-- Banc Adverse (avec Threat Score sur chaque cible) -->
              <div class="space-y-1.5">
                <div class="text-[10px] font-mono font-bold uppercase text-red-800/80">
                  Banc Adverse ({{ turn.opponentBenchPokemon?.length ?? 0 }} Pokémon — Cibles Boss / Attrape-Riposte)
                </div>

                <div
                  v-if="turn.opponentBenchPokemon && turn.opponentBenchPokemon.length > 0"
                  class="grid grid-cols-1 gap-1.5"
                >
                  <div
                    v-for="(oppBench, obIdx) in turn.opponentBenchPokemon"
                    :key="obIdx"
                    class="p-2 rounded bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="text-xs font-semibold text-slate-900">
                          {{ oppBench.name }}
                        </span>
                        <span class="text-[10px] font-mono text-slate-500">
                          {{ oppBench.hp }} PV • {{ oppBench.prizeValue }}P • {{ oppBench.attachedEnergies }}⚡
                        </span>
                      </div>
                      <div class="text-[10px] font-mono text-slate-500">
                        {{ oppBench.roleLabel }}
                      </div>
                    </div>

                    <span
                      class="px-2 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0"
                      :class="
                        oppBench.threatScore >= 130
                          ? 'bg-red-50 text-red-700 border-red-300'
                          : 'bg-slate-100 text-slate-700 border-slate-200'
                      "
                    >
                      Menace : {{ oppBench.threatScore }} pts
                    </span>
                  </div>
                </div>
                <div v-else class="text-xs font-mono text-slate-400 italic">
                  Banc adverse vide.
                </div>
              </div>
            </div>

            <!-- NOTRE PLATEAU JOUEUR (Bas du Face-à-Face) -->
            <div class="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50/20 space-y-2.5">
              <div class="flex items-center justify-between border-b border-emerald-200/70 pb-1.5">
                <span class="text-[11px] font-mono font-bold uppercase text-emerald-950 flex items-center gap-1.5">
                  <Swords class="w-3.5 h-3.5 text-emerald-600" />
                  Notre Plateau (Dracaufeu ex / Roucarnage ex)
                </span>
                <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-white text-emerald-700 border border-emerald-200">
                  Nos Récompenses : {{ turn.prizesRemaining }} / 6
                </span>
              </div>

              <!-- Notre Poste Actif -->
              <div class="p-2.5 rounded border border-slate-200 bg-white space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-mono font-bold uppercase text-slate-500">
                    Notre Poste Actif
                  </span>
                  <span
                    v-if="turn.activePokemon"
                    class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-600"
                  >
                    Posé au T{{ turn.activePokemon.turnPlayed }} • {{ turn.activePokemon.hp }} PV
                  </span>
                </div>

                <div v-if="turn.activePokemon" class="flex flex-wrap items-center justify-between gap-2">
                  <div class="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <span>{{ turn.activePokemon.name }}</span>
                    <span
                      v-if="turn.activePokemon.attachedToolName"
                      class="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200"
                    >
                      {{ turn.activePokemon.attachedToolName }}
                    </span>
                  </div>
                  <div class="flex items-center gap-1">
                    <span
                      class="px-2 py-0.5 rounded text-xs font-mono font-semibold inline-flex items-center gap-1 border"
                      :class="
                        turn.activePokemon.attachedEnergies >= 2
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-white text-slate-700 border-slate-200'
                      "
                    >
                      <Flame class="w-3 h-3 text-red-500" />
                      {{ turn.activePokemon.attachedEnergies }} Énergie(s) Feu
                    </span>
                  </div>
                </div>
              </div>

              <!-- Notre Banc (Max 5 Pokémon) -->
              <div class="space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-mono font-bold uppercase text-slate-600">
                    Notre Banc ({{ turn.benchPokemon.length }} / 5 emplacements)
                  </span>
                  <span class="text-[10px] font-mono text-emerald-700">Invariant ≤ 5 respecté</span>
                </div>

                <div v-if="turn.benchPokemon.length > 0" class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <div
                    v-for="(bPoke, bIdx) in turn.benchPokemon"
                    :key="bIdx"
                    class="p-2 rounded bg-white border border-slate-200 flex items-center justify-between gap-2"
                  >
                    <div class="min-w-0">
                      <div class="text-xs font-semibold text-slate-900 truncate">
                        {{ bPoke.name }}
                      </div>
                      <div class="text-[10px] font-mono text-slate-500 flex items-center gap-1.5">
                        <span>Posé au T{{ bPoke.turnPlayed }}</span>
                        <span v-if="bPoke.attachedToolName" class="text-blue-600 truncate">
                          • {{ bPoke.attachedToolName }}
                        </span>
                      </div>
                    </div>
                    <span
                      v-if="bPoke.attachedEnergies > 0"
                      class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200 shrink-0"
                    >
                      {{ bPoke.attachedEnergies }}🔥
                    </span>
                  </div>
                </div>
                <div v-else class="text-xs font-mono text-slate-400 italic">
                  Aucun Pokémon sur le Banc.
                </div>
              </div>
            </div>

            <!-- Main Restante en Fin de Tour -->
            <div class="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-mono font-bold uppercase text-slate-500">
                  Main en Fin de Tour ({{ turn.handCardNames.length }} cartes — Conservation T+1)
                </span>
              </div>
              <div v-if="turn.handCardNames.length > 0" class="flex flex-wrap gap-1">
                <span
                  v-for="(hCard, hIdx) in turn.handCardNames"
                  :key="hIdx"
                  class="px-2 py-0.5 rounded bg-white border border-slate-200 text-[11px] text-slate-700"
                >
                  {{ hCard }}
                </span>
              </div>
              <div v-else class="text-xs font-mono text-slate-400 italic">Main vide</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
