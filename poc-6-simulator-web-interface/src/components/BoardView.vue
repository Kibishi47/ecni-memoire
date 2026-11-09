<script setup lang="ts">
import { computed } from 'vue'
import type { MatchState, InPlayPokemon } from '../core/engine'
import { isPokemonAttackBlocked, getPokemonRetreatCost } from '../core/engine'
import type { EngineCardModel } from '../types/cardModel'
import CardItem from './CardItem.vue'
import {
  Eye,
  EyeOff,
  Layers,
  Lock,
  Plus,
  RotateCcw,
  Trophy,
  Undo2,
} from 'lucide-vue-next'

const props = defineProps<{
  state: MatchState
  playerDeckName: string
  opponentDeckName: string
  selectedCardId?: string | null
  showOpponentHand: boolean
  canUndo: boolean
  isAiThinking?: boolean
  legalCardIds: Set<string>
  cardActionCounts: Record<string, number>
}>()

const emit = defineEmits<{
  (e: 'select-card', cardId: string | null): void
  (e: 'inspect-card', card: EngineCardModel, inPlay?: InPlayPokemon): void
  (e: 'open-discard', playerKey: 'PLAYER' | 'OPPONENT'): void
  (e: 'open-deck', playerKey: 'PLAYER' | 'OPPONENT'): void
  (e: 'toggle-opponent-hand'): void
  (e: 'restart-match'): void
  (e: 'open-new-match'): void
  (e: 'undo-action'): void
  (e: 'execute-ai-move'): void
}>()

const isPlayerTurn = computed(() => props.state.activePlayerIndex === 0)
const isOpponentTurn = computed(() => props.state.activePlayerIndex === 1)

function handleCardClick(card: EngineCardModel, inPlay?: InPlayPokemon) {
  if (props.selectedCardId === card.cardId) {
    emit('select-card', null)
  } else {
    emit('select-card', card.cardId)
  }
}
</script>

<template>
  <div class="flex h-full w-full flex-col overflow-y-auto bg-slate-50 p-3 sm:p-4">
    <!-- Barre Supérieure : Score, Statut & Outils de Test -->
    <header class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
      <!-- Informations du Match -->
      <div class="flex items-center gap-3">
        <div
          class="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 font-mono text-xs font-bold text-white shadow-xs"
        >
          T{{ state.turnNumber }}
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-900">
              {{ playerDeckName }} <span class="font-normal text-slate-400">vs</span> {{ opponentDeckName }}
            </span>
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-bold"
              :class="isPlayerTurn ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'"
            >
              {{ isPlayerTurn ? '🎯 Votre tour' : '⏳ Tour adverse' }}
            </span>
          </div>
          <!-- Cartes Récompenses Prises -->
          <div class="mt-0.5 flex items-center gap-3 text-[11px] font-mono text-slate-600">
            <span>Moi : <strong>{{ 6 - state.player.prizes.length }}/6</strong> prix</span>
            <span>·</span>
            <span>Adv : <strong>{{ 6 - state.opponent.prizes.length }}/6</strong> prix</span>
          </div>
        </div>
      </div>

      <!-- Commandes de Test : Undo, Reset, Visibilité Main, Nouveau Match -->
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          @click="emit('undo-action')"
          :disabled="!canUndo"
          class="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-40"
          title="Annuler le dernier coup joué"
        >
          <Undo2 class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">Annuler</span>
        </button>

        <button
          type="button"
          @click="emit('restart-match')"
          class="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
          title="Recommencer avec la même graine (seed)"
        >
          <RotateCcw class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">Recommencer</span>
        </button>

        <button
          type="button"
          @click="emit('toggle-opponent-hand')"
          class="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold shadow-2xs transition-all"
          :class="showOpponentHand ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'"
          title="Afficher ou masquer les cartes dans la main de l'adversaire"
        >
          <Eye v-if="showOpponentHand" class="h-3.5 w-3.5 text-amber-600" />
          <EyeOff v-else class="h-3.5 w-3.5 text-slate-400" />
          <span>{{ showOpponentHand ? 'Main adv. visible' : 'Masquer main adv.' }}</span>
        </button>

        <button
          type="button"
          @click="emit('open-new-match')"
          class="flex items-center gap-1 rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-slate-800"
        >
          <Plus class="h-3.5 w-3.5" />
          <span>Nouveau Duel</span>
        </button>
      </div>
    </header>

    <!-- Bannière de Fin de Partie si le match est conclu -->
    <div
      v-if="state.winner !== null"
      class="mb-3 flex items-center justify-between rounded-2xl border-2 p-4 shadow-sm"
      :class="state.winner === 'PLAYER' ? 'border-emerald-400 bg-emerald-50 text-emerald-950' : state.winner === 'OPPONENT' ? 'border-red-400 bg-red-50 text-red-950' : 'border-amber-400 bg-amber-50 text-amber-950'"
    >
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-xs">
          <Trophy class="h-5 w-5" :class="state.winner === 'PLAYER' ? 'text-emerald-600' : 'text-red-600'" />
        </div>
        <div>
          <div class="text-sm font-bold uppercase tracking-wide">
            {{ state.winner === 'PLAYER' ? 'Victoire de Joueur 1 !' : state.winner === 'OPPONENT' ? 'Victoire de l\'Adversaire' : 'Match Nul' }}
          </div>
          <div class="text-xs opacity-80">
            Motif : {{ state.winReason === 'ALL_PRIZES_TAKEN' ? 'Toutes les 6 cartes Récompenses ont été prises !' : state.winReason === 'NO_POKEMON_IN_PLAY' ? 'Aucun Pokémon restant sur le terrain.' : state.winReason === 'DECK_OUT' ? 'Deck épuisé au début du tour.' : 'Plafond de tours atteint.' }}
          </div>
        </div>
      </div>
      <button
        type="button"
        @click="emit('open-new-match')"
        class="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800"
      >
        Rejouer un duel
      </button>
    </div>

    <!-- ================================================================= -->
    <!-- ZONE 1 : TERRAIN ADVERSE (TOP)                                    -->
    <!-- ================================================================= -->
    <section
      class="mb-3 rounded-2xl border bg-white p-3 shadow-xs transition-all"
      :class="isOpponentTurn ? 'border-purple-300 ring-2 ring-purple-100' : 'border-slate-200'"
    >
      <!-- Barre d'état de l'adversaire : Deck, Défausse, Prix -->
      <div class="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div class="flex items-center gap-2">
          <div class="flex h-6 w-6 items-center justify-center rounded-full bg-purple-100 font-bold text-purple-800 text-[11px]">
            ADV
          </div>
          <span class="text-xs font-bold text-slate-800">{{ opponentDeckName }}</span>
          <span v-if="state.opponent.itemLockActive" class="flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.2 text-[10px] font-bold text-red-800">
            <Lock class="h-2.5 w-2.5" /> Item Lock
          </span>
        </div>

        <!-- Zones annexes adverses : Prix, Deck, Défausse -->
        <div class="flex items-center gap-3 text-xs">
          <!-- Cartes Récompenses restantes -->
          <div class="flex items-center gap-1 font-mono text-[11px]">
            <span class="text-slate-500">Prix :</span>
            <div class="flex items-center gap-0.5">
              <span
                v-for="pIdx in 6"
                :key="pIdx"
                class="h-3 w-2 rounded-xs border transition-all"
                :class="pIdx <= state.opponent.prizes.length ? 'border-amber-400 bg-amber-400 shadow-2xs' : 'border-slate-200 bg-slate-100'"
                :title="`Prix #${pIdx} (${pIdx <= state.opponent.prizes.length ? 'Restant' : 'Pris'})`"
              ></span>
            </div>
            <span class="font-bold text-slate-700">({{ state.opponent.prizes.length }})</span>
          </div>

          <!-- Deck adverse -->
          <button
            type="button"
            @click="emit('open-deck', 'OPPONENT')"
            class="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
            title="Inspecter le deck adverse"
          >
            <Layers class="h-3 w-3 text-slate-500" />
            <span>Deck : {{ state.opponent.deck.length }}</span>
          </button>

          <!-- Défausse adverse -->
          <button
            type="button"
            @click="emit('open-discard', 'OPPONENT')"
            class="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
            title="Voir les cartes dans la défausse adverse"
          >
            <span>Défausse : {{ state.opponent.discard.length }}</span>
          </button>
        </div>
      </div>

      <!-- Main Adverse (Face cachée ou révélée selon toggle) -->
      <div class="mb-3">
        <div class="mb-1 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
          Main adverse ({{ state.opponent.hand.length }} cartes)
        </div>
        <div class="flex items-center gap-2 overflow-x-auto pb-1">
          <CardItem
            v-for="(card, hIdx) in state.opponent.hand"
            :key="`${card.cardId}_${hIdx}`"
            :card="card"
            :is-face-down="!showOpponentHand"
            :is-selected="selectedCardId === card.cardId"
            :is-playable="isOpponentTurn && legalCardIds.has(card.cardId)"
            :playable-action-count="cardActionCounts[card.cardId] || 0"
            size="sm"
            :is-opponent="true"
            @click="handleCardClick(card)"
            @inspect="emit('inspect-card', card)"
          />
          <div
            v-if="state.opponent.hand.length === 0"
            class="text-xs font-medium text-slate-400 italic"
          >
            Main vide
          </div>
        </div>
      </div>

      <!-- Terrain Adverse : Pokémon Actif & Banc -->
      <div>
        <div class="mb-1 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
          Plateau adverse (Actif &amp; Banc)
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-6">
          <!-- Pokémon Actif Adverse -->
          <div class="sm:col-span-2">
            <div class="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-red-700">
              <span>⚔️ Poste Actif</span>
              <span
                v-if="state.opponent.activePokemon && isPokemonAttackBlocked(state.opponent.activePokemon, state)"
                class="rounded bg-rose-100 px-1.5 py-0.2 text-[9px] font-bold text-rose-800"
                title="Ce Pokémon ne peut pas attaquer ce tour"
              >
                🚫 Attaque Bloquée
              </span>
            </div>
            <CardItem
              v-if="state.opponent.activePokemon"
              :in-play-pokemon="state.opponent.activePokemon"
              :is-selected="selectedCardId === state.opponent.activePokemon.card.cardId"
              :is-playable="isOpponentTurn && legalCardIds.has(state.opponent.activePokemon.card.cardId)"
              :playable-action-count="cardActionCounts[state.opponent.activePokemon.card.cardId] || 0"
              size="md"
              show-slot-label="ACTIF"
              :is-opponent="true"
              @click="handleCardClick(state.opponent.activePokemon.card, state.opponent.activePokemon)"
              @inspect="emit('inspect-card', state.opponent.activePokemon.card, state.opponent.activePokemon)"
            />
            <div
              v-else
              class="flex h-36 items-center justify-center rounded-xl border border-dashed border-red-300 bg-red-50/50 text-xs text-red-600 italic"
            >
              Poste actif vacant
            </div>
          </div>

          <!-- Banc Adverse -->
          <div class="sm:col-span-4">
            <div class="mb-1 text-[10px] font-semibold text-slate-600">
              Banc adverse ({{ state.opponent.bench.length }}/5)
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <CardItem
                v-for="(bPoke, bIdx) in state.opponent.bench"
                :key="bPoke.instanceId"
                :in-play-pokemon="bPoke"
                :is-selected="selectedCardId === bPoke.card.cardId"
                :is-playable="isOpponentTurn && legalCardIds.has(bPoke.card.cardId)"
                :playable-action-count="cardActionCounts[bPoke.card.cardId] || 0"
                size="sm"
                :show-slot-label="`BANC #${bIdx + 1}`"
                :is-opponent="true"
                @click="handleCardClick(bPoke.card, bPoke)"
                @inspect="emit('inspect-card', bPoke.card, bPoke)"
              />
              <!-- Slots vides -->
              <div
                v-for="emptyIdx in Math.max(0, 5 - state.opponent.bench.length)"
                :key="`opp_empty_${emptyIdx}`"
                class="hidden sm:block"
              >
                <CardItem size="sm" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ================================================================= -->
    <!-- ZONE CENTRALE : STADE ET SÉPARATEUR DE COMBAT                     -->
    <!-- ================================================================= -->
    <div class="my-1 flex items-center justify-between rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-2 text-xs backdrop-blur-xs">
      <!-- Stade en jeu -->
      <div class="flex items-center gap-2">
        <span class="font-bold text-slate-700">🏟️ Stade :</span>
        <div v-if="state.activeStadium" class="flex items-center gap-2">
          <span class="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-900">
            {{ state.activeStadium.card.identity.nameFr }}
          </span>
          <span class="text-[11px] text-slate-500">
            (Posé par {{ state.activeStadium.ownerIndex === 0 ? 'Joueur 1' : 'Adversaire' }})
          </span>
          <button
            type="button"
            @click="emit('inspect-card', state.activeStadium.card)"
            class="text-[11px] font-medium text-emerald-700 hover:underline"
          >
            Détails
          </button>
        </div>
        <span v-else class="text-slate-400 italic">Aucun stade en jeu</span>
      </div>

      <!-- Indicateur de tour rapide -->
      <div class="flex items-center gap-2 font-mono text-[11px]">
        <span
          class="inline-block h-2 w-2 rounded-full"
          :class="isPlayerTurn ? 'bg-blue-600 animate-pulse' : 'bg-purple-600 animate-pulse'"
        ></span>
        <span class="font-bold" :class="isPlayerTurn ? 'text-blue-700' : 'text-purple-700'">
          {{ isPlayerTurn ? 'Tour Joueur 1' : 'Tour Adversaire' }}
        </span>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- ZONE 2 : TERRAIN DU JOUEUR (BOTTOM / MOI)                         -->
    <!-- ================================================================= -->
    <section
      class="mt-2 rounded-2xl border bg-white p-3 shadow-xs transition-all"
      :class="isPlayerTurn ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'"
    >
      <!-- Terrain Joueur : Pokémon Actif & Banc -->
      <div class="mb-3">
        <div class="mb-1 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
          Votre Plateau (Actif &amp; Banc)
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-6">
          <!-- Pokémon Actif Joueur -->
          <div class="sm:col-span-2">
            <div class="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-blue-700">
              <span>⚔️ Votre Poste Actif</span>
              <span
                v-if="state.player.activePokemon && isPokemonAttackBlocked(state.player.activePokemon, state)"
                class="rounded bg-rose-100 px-1.5 py-0.2 text-[9px] font-bold text-rose-800"
                title="Votre Pokémon Actif ne peut pas attaquer ce tour"
              >
                🚫 Attaque Bloquée
              </span>
              <span
                v-if="state.player.activePokemon && getPokemonRetreatCost(state.player.activePokemon, state.player) === 0"
                class="rounded bg-sky-100 px-1.5 py-0.2 text-[9px] font-bold text-sky-800"
                title="Retraite gratuite (Talent Taxi Aérien)"
              >
                ✈️ Retraite 0 NRJ
              </span>
            </div>
            <CardItem
              v-if="state.player.activePokemon"
              :in-play-pokemon="state.player.activePokemon"
              :is-selected="selectedCardId === state.player.activePokemon.card.cardId"
              :is-playable="isPlayerTurn && legalCardIds.has(state.player.activePokemon.card.cardId)"
              :playable-action-count="cardActionCounts[state.player.activePokemon.card.cardId] || 0"
              size="md"
              show-slot-label="ACTIF"
              @click="handleCardClick(state.player.activePokemon.card, state.player.activePokemon)"
              @inspect="emit('inspect-card', state.player.activePokemon.card, state.player.activePokemon)"
            />
            <div
              v-else
              class="flex h-36 items-center justify-center rounded-xl border border-dashed border-blue-300 bg-blue-50/50 text-xs text-blue-600 italic"
            >
              Poste actif vacant
            </div>
          </div>

          <!-- Banc Joueur -->
          <div class="sm:col-span-4">
            <div class="mb-1 text-[10px] font-semibold text-slate-600">
              Votre Banc ({{ state.player.bench.length }}/5)
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <CardItem
                v-for="(bPoke, bIdx) in state.player.bench"
                :key="bPoke.instanceId"
                :in-play-pokemon="bPoke"
                :is-selected="selectedCardId === bPoke.card.cardId"
                :is-playable="isPlayerTurn && legalCardIds.has(bPoke.card.cardId)"
                :playable-action-count="cardActionCounts[bPoke.card.cardId] || 0"
                size="sm"
                :show-slot-label="`BANC #${bIdx + 1}`"
                @click="handleCardClick(bPoke.card, bPoke)"
                @inspect="emit('inspect-card', bPoke.card, bPoke)"
              />
              <!-- Slots vides -->
              <div
                v-for="emptyIdx in Math.max(0, 5 - state.player.bench.length)"
                :key="`player_empty_${emptyIdx}`"
                class="hidden sm:block"
              >
                <CardItem size="sm" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Main du Joueur (Cartes en Main) -->
      <div class="mb-2.5">
        <div class="mb-1 flex items-center justify-between">
          <span class="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
            Vos Cartes en Main ({{ state.player.hand.length }})
          </span>
          <span v-if="selectedCardId" class="text-[10px] font-semibold text-blue-600">
            Carte sélectionnée pour filtrer les actions
          </span>
        </div>
        <div class="flex items-center gap-2 overflow-x-auto pb-1">
          <CardItem
            v-for="(card, hIdx) in state.player.hand"
            :key="`${card.cardId}_${hIdx}`"
            :card="card"
            :is-selected="selectedCardId === card.cardId"
            :is-playable="isPlayerTurn && legalCardIds.has(card.cardId)"
            :playable-action-count="cardActionCounts[card.cardId] || 0"
            size="md"
            @click="handleCardClick(card)"
            @inspect="emit('inspect-card', card)"
          />
          <div
            v-if="state.player.hand.length === 0"
            class="text-xs font-medium text-slate-400 italic"
          >
            Votre main est vide
          </div>
        </div>
      </div>

      <!-- Barre d'état du joueur : Prix, Deck, Défausse -->
      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
        <div class="flex items-center gap-2">
          <div class="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-800 text-[11px]">
            MOI
          </div>
          <span class="text-xs font-bold text-slate-800">{{ playerDeckName }}</span>
          <span v-if="state.player.supporterPlayedThisTurn" class="rounded bg-amber-100 px-1.5 py-0.2 text-[10px] font-semibold text-amber-900">
            Supporter joué
          </span>
          <span v-if="state.player.energyAttachedThisTurn" class="rounded bg-emerald-100 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-900">
            NRJ attachée
          </span>
        </div>

        <!-- Zones annexes joueur : Prix, Deck, Défausse -->
        <div class="flex items-center gap-3 text-xs">
          <!-- Cartes Récompenses restantes -->
          <div class="flex items-center gap-1 font-mono text-[11px]">
            <span class="text-slate-500">Prix :</span>
            <div class="flex items-center gap-0.5">
              <span
                v-for="pIdx in 6"
                :key="pIdx"
                class="h-3 w-2 rounded-xs border transition-all"
                :class="pIdx <= state.player.prizes.length ? 'border-amber-400 bg-amber-400 shadow-2xs' : 'border-slate-200 bg-slate-100'"
                :title="`Prix #${pIdx} (${pIdx <= state.player.prizes.length ? 'Restant' : 'Pris'})`"
              ></span>
            </div>
            <span class="font-bold text-slate-700">({{ state.player.prizes.length }})</span>
          </div>

          <!-- Deck joueur -->
          <button
            type="button"
            @click="emit('open-deck', 'PLAYER')"
            class="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
            title="Inspecter les cartes restantes dans votre deck"
          >
            <Layers class="h-3 w-3 text-slate-500" />
            <span>Deck : {{ state.player.deck.length }}</span>
          </button>

          <!-- Défausse joueur -->
          <button
            type="button"
            @click="emit('open-discard', 'PLAYER')"
            class="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
            title="Inspecter votre pile de défausse"
          >
            <span>Défausse : {{ state.player.discard.length }}</span>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
