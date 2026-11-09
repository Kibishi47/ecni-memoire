<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { EngineCardModel } from './types/cardModel'
import type { GameAction, InPlayPokemon, MatchState, MatchWinner, WinReason } from './core/engine'
import {
  applyAction,
  cloneMatchState,
  createInitialMatchState,
  getLegalActions,
  startTurn,
} from './core/engine'
import { selectBestTurnBranch } from './core/evaluator'
import { META_OPPONENT_DECKS } from './data/metaDecks'
import { parsePtcglDecklist } from './utils/ptcglParser'
import GameLogPanel, { type GameLogEntry } from './components/GameLogPanel.vue'
import LegalActionsPanel from './components/LegalActionsPanel.vue'
import BoardView from './components/BoardView.vue'
import CardDetailModal from './components/CardDetailModal.vue'
import DiscardModal from './components/DiscardModal.vue'
import NewMatchModal from './components/NewMatchModal.vue'
import { Bot, RefreshCw, Swords } from 'lucide-vue-next'

// Configuration active du match
const playerDeckDesc = ref(META_OPPONENT_DECKS[0]!)
const opponentDeckDesc = ref(META_OPPONENT_DECKS[1]!)
const matchSeed = ref<number>(42)
const maxTurnsLimit = ref<number>(20)
const firstPlayerChoice = ref<'PLAYER' | 'OPPONENT' | 'RANDOM'>('RANDOM')

// État courant du duel
const matchState = ref<MatchState | null>(null)
const legalActions = ref<GameAction[]>([])
const logs = ref<GameLogEntry[]>([])
const stepCounter = ref(1)

// Pile d'annulation (Undo)
interface HistoryFrame {
  state: MatchState
  logs: GameLogEntry[]
  stepCounter: number
}
const historyStack = ref<HistoryFrame[]>([])

// Filtres et Modals
const selectedCardId = ref<string | null>(null)
const showOpponentHand = ref<boolean>(true) // Par défaut visible pour tester l'engine
const isAiThinking = ref<boolean>(false)

// Modals
const inspectedCard = ref<EngineCardModel | null>(null)
const inspectedInPlay = ref<InPlayPokemon | null>(null)
const isCardModalOpen = ref(false)

const isDiscardModalOpen = ref(false)
const discardModalTitle = ref('')
const discardModalCards = ref<EngineCardModel[]>([])

const isNewMatchModalOpen = ref(false)

// Déploie une decklist PTCGL en 60 EngineCardModel
function expandDecklist(text: string): EngineCardModel[] {
  const parsed = parsePtcglDecklist(text)
  const list: EngineCardModel[] = []
  for (const entry of parsed.cards) {
    if (entry.model) {
      for (let i = 0; i < entry.quantity; i++) {
        list.push(entry.model)
      }
    }
  }
  return list
}

// Nom de la carte sélectionnée pour le badge de filtre
const selectedCardName = computed(() => {
  if (!selectedCardId.value || !matchState.value) return null
  const allCards = [
    ...(matchState.value.player.activePokemon ? [matchState.value.player.activePokemon.card] : []),
    ...matchState.value.player.bench.map((b) => b.card),
    ...matchState.value.player.hand,
    ...(matchState.value.opponent.activePokemon ? [matchState.value.opponent.activePokemon.card] : []),
    ...matchState.value.opponent.bench.map((b) => b.card),
    ...matchState.value.opponent.hand,
  ]
  const found = allCards.find((c) => c.cardId === selectedCardId.value)
  return found ? found.identity.nameFr : selectedCardId.value
})

// Ensemble des cartes ayant au moins 1 action légale
const legalCardIds = computed(() => {
  const ids = new Set<string>()
  for (const act of legalActions.value) {
    if (act.cardId) ids.add(act.cardId)
    if (act.targetCardIds) {
      for (const tid of act.targetCardIds) ids.add(tid)
    }
  }
  return ids
})

// Nombre d'actions par carte
const cardActionCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const act of legalActions.value) {
    if (act.cardId) {
      counts[act.cardId] = (counts[act.cardId] || 0) + 1
    }
    if (act.targetCardIds) {
      for (const tid of act.targetCardIds) {
        counts[tid] = (counts[tid] || 0) + 1
      }
    }
  }
  return counts
})

// Ajoute une entrée de log
function addLog(
  type: GameLogEntry['type'],
  message: string,
  damage?: number,
  actingPlayer: 'PLAYER' | 'OPPONENT' = matchState.value?.activePlayerIndex === 0 ? 'PLAYER' : 'OPPONENT',
) {
  const now = new Date()
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`

  logs.value.push({
    id: `log_${Date.now()}_${stepCounter.value}`,
    stepNumber: stepCounter.value++,
    turnNumber: matchState.value?.turnNumber ?? 1,
    actingPlayer,
    type,
    message,
    damage,
    timestamp: timeStr,
  })
}

// Initialise un nouveau duel
function startDuel(
  playerDeckText = playerDeckDesc.value.ptcglText,
  opponentDeckText = opponentDeckDesc.value.ptcglText,
  firstPlayer: 'PLAYER' | 'OPPONENT' | 'RANDOM' = firstPlayerChoice.value,
  seed = matchSeed.value,
  maxTurns = maxTurnsLimit.value,
) {
  matchSeed.value = seed
  maxTurnsLimit.value = maxTurns
  firstPlayerChoice.value = firstPlayer

  const playerModels = expandDecklist(playerDeckText)
  const opponentModels = expandDecklist(opponentDeckText)

  const firstPlayerIdx: 0 | 1 =
    firstPlayer === 'PLAYER'
      ? 0
      : firstPlayer === 'OPPONENT'
        ? 1
        : Math.random() < 0.5
          ? 0
          : 1

  logs.value = []
  historyStack.value = []
  stepCounter.value = 1
  selectedCardId.value = null

  // Création officielle par le moteur de règles
  const initial = createInitialMatchState(playerModels, opponentModels, {
    seed,
    firstPlayerIndex: firstPlayerIdx,
    maxTurns,
  })
  matchState.value = initial

  // Logs d'initialisation du match
  addLog(
    'SYSTEM',
    `Initialisation du match : ${playerDeckDesc.value.name} contre ${opponentDeckDesc.value.name} (Seed: ${seed})`,
    undefined,
    'PLAYER',
  )
  addLog(
    'SYSTEM',
    `Tirage au sort du premier joueur : ${firstPlayerIdx === 0 ? 'Joueur 1 commence (Tour 1)' : 'Adversaire commence (Tour 1)'}`,
    undefined,
    firstPlayerIdx === 0 ? 'PLAYER' : 'OPPONENT',
  )

  if (initial.player.mulliganCount > 0 || initial.opponent.mulliganCount > 0) {
    addLog(
      'SYSTEM',
      `Mulligans : Joueur 1 : ${initial.player.mulliganCount} mulligan(s) | Adversaire : ${initial.opponent.mulliganCount} mulligan(s)`,
    )
  }

  // Présentation du Setup Actif & Banc
  if (initial.player.activePokemon) {
    addLog(
      'BENCH',
      `Joueur 1 place ${initial.player.activePokemon.card.identity.nameFr} sur le Poste Actif.`,
      undefined,
      'PLAYER',
    )
  }
  if (initial.opponent.activePokemon) {
    addLog(
      'BENCH',
      `Adversaire place ${initial.opponent.activePokemon.card.identity.nameFr} sur le Poste Actif.`,
      undefined,
      'OPPONENT',
    )
  }
  if (initial.player.bench.length > 0) {
    addLog(
      'BENCH',
      `Joueur 1 installe son Banc : ${initial.player.bench.map((b) => b.card.identity.nameFr).join(', ')}`,
      undefined,
      'PLAYER',
    )
  }
  if (initial.opponent.bench.length > 0) {
    addLog(
      'BENCH',
      `Adversaire installe son Banc : ${initial.opponent.bench.map((b) => b.card.identity.nameFr).join(', ')}`,
      undefined,
      'OPPONENT',
    )
  }
  addLog('PRIZE', '6 cartes Récompenses mises de côté pour chaque duelliste.')

  // Lancement du Tour 1 (Pioche de début de tour)
  const { drawnCard } = startTurn(initial)
  const activeLabel = initial.activePlayerIndex === 0 ? 'Joueur 1' : 'Adversaire'
  const actingKey = initial.activePlayerIndex === 0 ? 'PLAYER' : 'OPPONENT'

  if (drawnCard) {
    addLog('DRAW', `${activeLabel} pioche sa carte de début de tour : ${drawnCard.identity.nameFr}`, undefined, actingKey)
  }

  // Calcul des premières actions légales
  legalActions.value = getLegalActions(initial)
}

// Exécute une action sélectionnée par l'utilisateur
function handleExecuteAction(action: GameAction) {
  if (!matchState.value || matchState.value.winner !== null) return

  // Sauvegarde pour Undo
  historyStack.value.push({
    state: cloneMatchState(matchState.value),
    logs: [...logs.value],
    stepCounter: stepCounter.value,
  })

  const currentState = matchState.value
  const actingIndex = currentState.activePlayerIndex
  const actingKey: 'PLAYER' | 'OPPONENT' = actingIndex === 0 ? 'PLAYER' : 'OPPONENT'
  const actingName = actingIndex === 0 ? 'Joueur 1' : 'Adversaire'

  const opponentBoard = actingIndex === 0 ? currentState.opponent : currentState.player
  const prevOppPrizes = opponentBoard.prizes.length
  const prevOppActiveId = opponentBoard.activePokemon?.instanceId

  // Application atomique de l'action via le moteur officiel
  applyAction(currentState, action, true, true)

  // Création du log approprié selon le type d'action
  switch (action.type) {
    case 'DECLARE_ATTACK':
      addLog(
        'ATTACK',
        `💥 ${actingName} déclare l'Attaque : ${action.label}`,
        action.estimatedDamage,
        actingKey,
      )
      break
    case 'PUT_BASIC_ON_BENCH':
      addLog('BENCH', `🛡️ ${actingName} : ${action.label}`, undefined, actingKey)
      break
    case 'NORMAL_EVOLVE':
      addLog('EVOLVE', `✨ ${actingName} : ${action.label}`, undefined, actingKey)
      break
    case 'ATTACH_MANUAL_ENERGY':
      addLog('ENERGY', `⚡ ${actingName} : ${action.label}`, undefined, actingKey)
      break
    case 'PLAY_TRAINER':
      addLog('TRAINER', `📜 ${actingName} : ${action.label}`, undefined, actingKey)
      break
    case 'USE_ABILITY':
      addLog('ABILITY', `🔮 ${actingName} : ${action.label}`, undefined, actingKey)
      break
    case 'RETREAT_ACTIVE':
      addLog('RETREAT', `🔄 ${actingName} : ${action.label}`, undefined, actingKey)
      break
    case 'PASS_TURN':
      addLog('PASS', `⏳ ${actingName} passe son tour sans attaquer.`, undefined, actingKey)
      break
  }

  // Messages additionnels enregistrés par le moteur (ex: Confusion, effets critiques)
  if (currentState.lastActionLog && currentState.lastActionLog.length > 0) {
    for (const extraMsg of currentState.lastActionLog) {
      if (extraMsg && !extraMsg.startsWith('Attaque') && extraMsg !== action.label) {
        addLog('SYSTEM', extraMsg, undefined, actingKey)
      }
    }
  }

  // Vérification de K.O. et prise de Récompenses
  const currentOppPrizes = opponentBoard.prizes.length
  if (currentOppPrizes < prevOppPrizes) {
    const prizesTaken = prevOppPrizes - currentOppPrizes
    addLog(
      'PRIZE',
      `🏆 K.O. adverse infligé ! ${actingName} récupère ${prizesTaken} carte(s) Récompenses. (${currentOppPrizes} restante(s) pour l'adversaire)`,
      undefined,
      actingKey,
    )
  }

  // Si l'action a clôturé le tour (Attaque ou PASS_TURN)
  if (action.endsTurnImmediately || currentState.winner !== null) {
    // Si la partie est finie
    if (currentState.winner !== null) {
      const winnerName = currentState.winner === 'PLAYER' ? 'Joueur 1' : 'Adversaire'
      addLog(
        'WIN',
        `🏁 FIN DU DUEL ! ${winnerName} remporte la victoire (${currentState.winReason}) !`,
        undefined,
        currentState.winner === 'PLAYER' ? 'PLAYER' : 'OPPONENT',
      )
      legalActions.value = []
      selectedCardId.value = null
      return
    }

    // Le tour suivant commence officiellement
    addLog('CHECKUP', '--- Clôture de tour & Checkup entre deux tours validé ---')

    const { drawnCard } = startTurn(currentState)
    const nextActingName = currentState.activePlayerIndex === 0 ? 'Joueur 1' : 'Adversaire'
    const nextActingKey = currentState.activePlayerIndex === 0 ? 'PLAYER' : 'OPPONENT'

    addLog(
      'DRAW',
      `▶️ Début du Tour ${currentState.turnNumber} : ${nextActingName} pioche ${drawnCard ? drawnCard.identity.nameFr : 'Deck vide'}.`,
      undefined,
      nextActingKey,
    )

    if (currentState.winner !== null) {
      addLog('WIN', `🏁 Défaite par Deck-Out de ${nextActingName} !`, undefined, nextActingKey === 'PLAYER' ? 'OPPONENT' : 'PLAYER')
      legalActions.value = []
      selectedCardId.value = null
      return
    }
  }

  // Mise à jour de la liste des actions légales pour le nouvel état
  legalActions.value = getLegalActions(currentState)
  selectedCardId.value = null
}

// Coup IA Unique
function handleExecuteAiMove() {
  if (!matchState.value || matchState.value.winner !== null || legalActions.value.length === 0) return

  isAiThinking.value = true
  try {
    const decision = selectBestTurnBranch(matchState.value, 8, false)
    if (decision.chosenActions.length > 0) {
      const firstAction = decision.chosenActions[0]!
      handleExecuteAction(firstAction)
    } else {
      // Fallback si aucune action trouvée : passe le tour
      const passAction = legalActions.value.find((a) => a.type === 'PASS_TURN') || legalActions.value[0]!
      handleExecuteAction(passAction)
    }
  } catch (err) {
    console.error('Erreur lors de l\'évaluation IA :', err)
    if (legalActions.value.length > 0) {
      handleExecuteAction(legalActions.value[0]!)
    }
  } finally {
    isAiThinking.value = false
  }
}

// Tour IA Complet
async function handleExecuteAiTurn() {
  if (!matchState.value || matchState.value.winner !== null) return

  isAiThinking.value = true
  try {
    const currentTurnNum = matchState.value.turnNumber
    const actingIndex = matchState.value.activePlayerIndex
    const decision = selectBestTurnBranch(matchState.value, 8, false)

    for (const act of decision.chosenActions) {
      if (!matchState.value || matchState.value.winner !== null) break
      // Si le tour a déjà changé, on s'arrête
      if (matchState.value.turnNumber !== currentTurnNum || matchState.value.activePlayerIndex !== actingIndex) {
        break
      }
      handleExecuteAction(act)
    }
  } catch (err) {
    console.error('Erreur lors de l\'exécution du tour IA :', err)
  } finally {
    isAiThinking.value = false
  }
}

// Annuler le dernier coup
function handleUndo() {
  if (historyStack.value.length === 0) return
  const prevFrame = historyStack.value.pop()!
  matchState.value = prevFrame.state
  logs.value = prevFrame.logs
  stepCounter.value = prevFrame.stepCounter
  legalActions.value = getLegalActions(matchState.value)
  selectedCardId.value = null
}

// Ouvrir l'inspection de carte
function handleInspectCard(card: EngineCardModel, inPlay?: InPlayPokemon) {
  inspectedCard.value = card
  inspectedInPlay.value = inPlay || null
  isCardModalOpen.value = true
}

// Ouvrir la défausse
function handleOpenDiscard(playerKey: 'PLAYER' | 'OPPONENT') {
  if (!matchState.value) return
  const board = playerKey === 'PLAYER' ? matchState.value.player : matchState.value.opponent
  discardModalTitle.value = playerKey === 'PLAYER' ? 'Défausse de Joueur 1' : 'Défausse de l\'Adversaire'
  discardModalCards.value = board.discard
  isDiscardModalOpen.value = true
}

// Ouvrir le deck
function handleOpenDeck(playerKey: 'PLAYER' | 'OPPONENT') {
  if (!matchState.value) return
  const board = playerKey === 'PLAYER' ? matchState.value.player : matchState.value.opponent
  discardModalTitle.value = playerKey === 'PLAYER' ? 'Deck de Joueur 1' : 'Deck de l\'Adversaire'
  discardModalCards.value = board.deck
  isDiscardModalOpen.value = true
}

// Configuration d'un nouveau match
function handleStartConfiguredMatch(config: {
  playerDeckId: string
  customPlayerDeckText?: string
  opponentDeckId: string
  firstPlayer: 'PLAYER' | 'OPPONENT' | 'RANDOM'
  seed: number
  maxTurns: number
}) {
  isNewMatchModalOpen.value = false

  const pDeck = META_OPPONENT_DECKS.find((d) => d.id === config.playerDeckId) || META_OPPONENT_DECKS[0]!
  const oDeck = META_OPPONENT_DECKS.find((d) => d.id === config.opponentDeckId) || META_OPPONENT_DECKS[1]!

  playerDeckDesc.value = pDeck
  opponentDeckDesc.value = oDeck

  const pText = config.customPlayerDeckText || pDeck.ptcglText
  const oText = oDeck.ptcglText

  startDuel(pText, oText, config.firstPlayer, config.seed, config.maxTurns)
}

onMounted(() => {
  startDuel()
})
</script>

<template>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-slate-100 text-slate-900 select-none">
    <!-- Barre de Navigation Principale -->
    <header class="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-2xs">
      <div class="flex items-center gap-3">
        <!-- Logo Pokéball -->
        <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-white font-mono text-xs font-bold shadow-xs">
          POC6
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-xs font-bold uppercase tracking-wider text-slate-900">
              PokéEngine Studio
            </h1>
            <span class="rounded bg-slate-100 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-slate-600">
              Interface Web de Test &amp; Duel
            </span>
          </div>
        </div>
      </div>

      <!-- Action Rapide Header -->
      <div class="flex items-center gap-2">
        <button
          type="button"
          @click="handleExecuteAiMove"
          :disabled="!matchState || matchState.winner !== null || isAiThinking"
          class="flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-800 shadow-2xs hover:bg-purple-100 disabled:opacity-50"
          title="Fait jouer l'action recommandée par l'arbre 3-ply"
        >
          <Bot class="h-3.5 w-3.5" />
          <span>Jouer Coup IA</span>
        </button>

        <button
          type="button"
          @click="isNewMatchModalOpen = true"
          class="flex items-center gap-1 rounded-lg border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-bold text-white shadow-xs hover:bg-slate-800"
        >
          <Swords class="h-3.5 w-3.5" />
          <span>Nouveau Match</span>
        </button>
      </div>
    </header>

    <!-- Disposition 3 Colonnes : Logs (Gauche) | Board (Centre) | Actions (Droite) -->
    <div v-if="matchState" class="flex flex-1 min-h-0 overflow-hidden">
      <!-- 1. Colonne Gauche : Journal & Logs de Combat -->
      <div class="w-80 shrink-0 h-full overflow-hidden border-r border-slate-200">
        <GameLogPanel
          :logs="logs"
          :current-turn="matchState.turnNumber"
          :active-player-index="matchState.activePlayerIndex"
          :winner="matchState.winner"
          :win-reason="matchState.winReason"
          @clear="logs = []"
        />
      </div>

      <!-- 2. Colonne Centrale : Plateau Visuel de Jeu -->
      <main class="flex-1 min-w-0 h-full overflow-hidden">
        <BoardView
          :state="matchState"
          :player-deck-name="playerDeckDesc.name"
          :opponent-deck-name="opponentDeckDesc.name"
          :selected-card-id="selectedCardId"
          :show-opponent-hand="showOpponentHand"
          :can-undo="historyStack.length > 0"
          :is-ai-thinking="isAiThinking"
          :legal-card-ids="legalCardIds"
          :card-action-counts="cardActionCounts"
          @select-card="selectedCardId = $event"
          @inspect-card="handleInspectCard"
          @open-discard="handleOpenDiscard"
          @open-deck="handleOpenDeck"
          @toggle-opponent-hand="showOpponentHand = !showOpponentHand"
          @restart-match="startDuel()"
          @open-new-match="isNewMatchModalOpen = true"
          @undo-action="handleUndo"
          @execute-ai-move="handleExecuteAiMove"
        />
      </main>

      <!-- 3. Colonne Droite : Liste de Toutes les Actions Légales -->
      <div class="w-84 shrink-0 h-full overflow-hidden border-l border-slate-200">
        <LegalActionsPanel
          :actions="legalActions"
          :active-player-index="matchState.activePlayerIndex"
          :selected-card-id="selectedCardId"
          :selected-card-name="selectedCardName"
          :is-ai-thinking="isAiThinking"
          @execute-action="handleExecuteAction"
          @clear-card-filter="selectedCardId = null"
          @execute-ai-move="handleExecuteAiMove"
          @execute-ai-turn="handleExecuteAiTurn"
        />
      </div>
    </div>

    <!-- Modals -->
    <CardDetailModal
      v-if="isCardModalOpen"
      :card="inspectedCard"
      :in-play-pokemon="inspectedInPlay"
      @close="isCardModalOpen = false"
    />

    <DiscardModal
      :is-open="isDiscardModalOpen"
      :title="discardModalTitle"
      :cards="discardModalCards"
      @close="isDiscardModalOpen = false"
      @inspect-card="handleInspectCard"
    />

    <NewMatchModal
      :is-open="isNewMatchModalOpen"
      @close="isNewMatchModalOpen = false"
      @start-match="handleStartConfiguredMatch"
    />
  </div>
</template>
