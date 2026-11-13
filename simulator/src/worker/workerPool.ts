import type { EngineCardModel } from '../types/cardModel'
import type { ParsedDeck } from '../types/deck'
import type {
  SimulationConfig,
  SimulationMetricsSummary,
} from '../types/simulator'
import { META_OPPONENT_DECKS } from '../data/metaDecks'
import { hasCompiledCardData } from '../data/cardCatalog'
import { parsePtcglDecklist } from '../utils/ptcglParser'
import {
  mergeSimulationShards,
  runSimulationShard,
  type OpponentDeckDescriptor,
  type SimulationShardInput,
  type SimulationShardResult,
} from '../core/gameLoop'
import type { WorkerRequestMessage, WorkerResponseMessage } from './simulation.worker'

const DEFAULT_BASE_SEED = 20260420

/**
 * Déploie un `ParsedDeck` en un tableau plat de 60 `EngineCardModel`.
 */
export function expandParsedDeckToModels(deck: ParsedDeck): EngineCardModel[] {
  const models: EngineCardModel[] = []
  for (const entry of deck.cards) {
    for (let i = 0; i < entry.quantity; i++) {
      models.push(entry.model)
    }
  }
  return models
}

// Cache des modèles compilés des 4 decks adverses méta
const cachedOpponentDescriptors = new Map<string, OpponentDeckDescriptor>()

export function resolveOpponentDescriptors(selectedOpponentIds: string[]): OpponentDeckDescriptor[] {
  const result: OpponentDeckDescriptor[] = []
  for (const oppMeta of META_OPPONENT_DECKS) {
    if (!selectedOpponentIds.includes(oppMeta.id)) continue
    let desc = cachedOpponentDescriptors.get(oppMeta.id)
    if (!desc) {
      const parsed = parsePtcglDecklist(oppMeta.ptcglText)
      desc = {
        id: oppMeta.id,
        name: oppMeta.name,
        nameEn: oppMeta.nameEn || oppMeta.name,
        archetypeTag: oppMeta.archetypeBadge,
        archetypeTagEn: oppMeta.archetypeBadgeEn || oppMeta.archetypeBadge,
        accentColor: oppMeta.badgeColor,
        models: expandParsedDeckToModels(parsed),
      }
      cachedOpponentDescriptors.set(oppMeta.id, desc)
    }
    result.push(desc)
  }
  return result
}

function buildSimulationBatches(
  totalGames: number,
  desiredWorkers: number,
  baseSeed: number,
  cleanConfig: SimulationConfig,
  cleanPlayerDeckModels: EngineCardModel[],
  cleanOpponentDecks: OpponentDeckDescriptor[],
): SimulationShardInput[] {
  const mode = cleanConfig.workerSchedulingMode ?? 'STATIC_SHARDS'
  const shards: SimulationShardInput[] = []

  if (mode === 'DYNAMIC_BATCHES') {
    const batchSize = Math.max(5, Math.min(200, cleanConfig.batchSize ?? 25))
    let nextStart = 0
    let shardId = 0
    while (nextStart < totalGames) {
      const countForBatch = Math.min(batchSize, totalGames - nextStart)
      shards.push({
        shardId: shardId++,
        startGameIndex: nextStart,
        gameCount: countForBatch,
        baseSeed,
        config: { ...cleanConfig },
        playerDeckModels: cleanPlayerDeckModels,
        opponentDecks: cleanOpponentDecks,
      })
      nextStart += countForBatch
    }
    return shards
  }

  let nextStart = 0
  for (let wIdx = 0; wIdx < desiredWorkers; wIdx++) {
    const remainingGames = totalGames - nextStart
    const remainingWorkers = desiredWorkers - wIdx
    const countForShard = Math.ceil(remainingGames / remainingWorkers)
    if (countForShard <= 0) break

    shards.push({
      shardId: wIdx,
      startGameIndex: nextStart,
      gameCount: countForShard,
      baseSeed,
      config: { ...cleanConfig },
      playerDeckModels: cleanPlayerDeckModels,
      opponentDecks: cleanOpponentDecks,
    })
    nextStart += countForShard
  }
  return shards
}

export class SimulationWorkerPool {
  private activeWorkers: Worker[] = []
  private warmWorkers: Worker[] = []
  private rejectCurrentRun?: ((reason?: unknown) => void) | null
  private isCancelled = false
  public isRunning = false
  public status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'ERROR' = 'IDLE'

  private getOrCreateWarmWorker(slotIndex: number): Worker {
    const existing = this.warmWorkers[slotIndex]
    if (existing) {
      return existing
    }
    const created = new Worker(new URL('./simulation.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.warmWorkers[slotIndex] = created
    return created
  }

  public terminateAll(): void {
    const allToTerminate = new Set<Worker>([...this.activeWorkers, ...this.warmWorkers])
    for (const w of allToTerminate) {
      try {
        w.onmessage = null
        w.onerror = null
        w.terminate()
      } catch {
        // Silently ignore termination errors
      }
    }
    this.activeWorkers = []
    this.warmWorkers = []
  }

  public cancelSimulation(): void {
    if (!this.isRunning) return
    this.isCancelled = true
    this.status = 'CANCELLED'
    this.isRunning = false
    this.terminateAll()
    if (this.rejectCurrentRun) {
      this.rejectCurrentRun(new Error("Simulation annulée par l'utilisateur"))
      this.rejectCurrentRun = null
    }
  }

  public async runSimulation(
    playerDeck: ParsedDeck,
    config: SimulationConfig,
    onProgress?: (completedGames: number, totalGames: number, elapsedMs: number) => void,
    providedOpponents?: OpponentDeckDescriptor[],
  ): Promise<SimulationMetricsSummary> {
    if (this.isRunning) {
      this.terminateAll()
    }
    this.activeWorkers = []
    this.isCancelled = false
    this.status = 'RUNNING'
    this.isRunning = true

    const startTime = performance.now()
    const totalGames = Math.max(1, config.iterations)
    const baseSeed =
      config.fixedSeed !== null && Number.isFinite(config.fixedSeed)
        ? config.fixedSeed
        : DEFAULT_BASE_SEED

    if (!hasCompiledCardData()) {
      this.status = 'ERROR'
      this.isRunning = false
      throw new Error(
        'Simulation impossible : aucune carte compilée n’est chargée en mémoire. Vérifiez la connexion au serveur API et revalidez votre deck.',
      )
    }

    if (!playerDeck.isFullyResolved) {
      this.status = 'ERROR'
      this.isRunning = false
      throw new Error(
        `Simulation bloquée : ${playerDeck.unresolvedCount} carte(s) absente(s) du catalogue API.`,
      )
    }

    const playerDeckModels = expandParsedDeckToModels(playerDeck)
    const opponentDecks =
      providedOpponents && providedOpponents.length > 0
        ? providedOpponents.filter((opp) => config.selectedOpponentIds.includes(opp.id))
        : resolveOpponentDescriptors(config.selectedOpponentIds)
    if (opponentDecks.length === 0) {
      this.status = 'ERROR'
      this.isRunning = false
      throw new Error('Au moins 1 deck adverse doit être sélectionné.')
    }

    // Assurer que tous les objets envoyés au Web Worker sont de purs objets sérialisables (pas de Proxy Vue, Window, etc.)
    const cleanConfig: SimulationConfig = JSON.parse(JSON.stringify(config))
    const cleanPlayerDeckModels: EngineCardModel[] = JSON.parse(JSON.stringify(playerDeckModels))
    const cleanOpponentDecks: OpponentDeckDescriptor[] = JSON.parse(JSON.stringify(opponentDecks))

    const desiredWorkers = Math.max(
      1,
      Math.min(
        totalGames,
        config.workerCount || (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 1),
      ),
    )

    // Découpage en lots statiques (N shards) ou dynamiques (file Work-Stealing)
    const shardsInput = buildSimulationBatches(
      totalGames,
      desiredWorkers,
      baseSeed,
      cleanConfig,
      cleanPlayerDeckModels,
      cleanOpponentDecks,
    )

    // Fallback asynchrone si `Worker` n'est pas disponible (ex: environnement Node/Vitest)
    if (typeof Worker === 'undefined') {
      return new Promise<SimulationMetricsSummary>((resolve, reject) => {
        this.rejectCurrentRun = reject
        setTimeout(() => {
          if (this.isCancelled) {
            reject(new Error('Simulation annulée par l\'utilisateur'))
            return
          }
          try {
            const shardResults: SimulationShardResult[] = []
            let completedSoFar = 0
            for (const shardIn of shardsInput) {
              if (this.isCancelled) {
                reject(new Error('Simulation annulée par l\'utilisateur'))
                return
              }
              const res = runSimulationShard(shardIn, (inShard) => {
                if (onProgress) {
                  onProgress(
                    completedSoFar + inShard,
                    totalGames,
                    Math.round(performance.now() - startTime),
                  )
                }
              })
              completedSoFar += res.outcomes.length
              shardResults.push(res)
            }
            if (this.isCancelled) {
              reject(new Error('Simulation annulée par l\'utilisateur'))
              return
            }
            const totalDurationMs = performance.now() - startTime
            this.status = 'COMPLETED'
            this.isRunning = false
            resolve(
              mergeSimulationShards(
                shardResults,
                opponentDecks,
                config,
                baseSeed,
                totalDurationMs,
              ),
            )
          } catch (err) {
            this.status = 'ERROR'
            this.isRunning = false
            reject(err)
          } finally {
            this.rejectCurrentRun = null
          }
        }, 0)
      })
    }

    // Exécution parallèle via Web Workers natifs avec file dynamique (Work-Stealing)
    const activeWorkerCount = Math.min(desiredWorkers, shardsInput.length)
    const inFlightProgressBySlot = new Map<number, number>()
    const shardResults: SimulationShardResult[] = []
    let completedFinishedGames = 0
    let nextQueueIndex = 0

    const reportAggregatedProgress = () => {
      if (!onProgress) return
      let inFlightSum = 0
      for (const val of inFlightProgressBySlot.values()) {
        inFlightSum += val
      }
      onProgress(
        Math.min(totalGames, completedFinishedGames + inFlightSum),
        totalGames,
        Math.round(performance.now() - startTime),
      )
    }

    const workerSlotPromises = Array.from({ length: activeWorkerCount }, (_, slotIdx) => {
      return new Promise<void>((resolveSlot, rejectSlot) => {
        const worker = this.getOrCreateWarmWorker(slotIdx)
        this.activeWorkers.push(worker)
        let currentBatch: SimulationShardInput | null = null

        const dispatchNextBatch = () => {
          if (this.isCancelled || nextQueueIndex >= shardsInput.length) {
            inFlightProgressBySlot.set(slotIdx, 0)
            worker.onmessage = null
            worker.onerror = null
            resolveSlot()
            return
          }
          currentBatch = shardsInput[nextQueueIndex++]!
          inFlightProgressBySlot.set(slotIdx, 0)
          const req: WorkerRequestMessage = {
            type: 'RUN_SHARD',
            payload: currentBatch,
          }
          worker.postMessage(req)
        }

        worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
          const data = event.data
          if (!data || !currentBatch) return

          if (data.type === 'PROGRESS') {
            inFlightProgressBySlot.set(slotIdx, data.completedChunk)
            reportAggregatedProgress()
          } else if (data.type === 'SHARD_PROGRESS') {
            inFlightProgressBySlot.set(slotIdx, data.completedInShard)
            reportAggregatedProgress()
          } else if (data.type === 'SHARD_COMPLETE') {
            completedFinishedGames += data.result.outcomes.length
            inFlightProgressBySlot.set(slotIdx, 0)
            shardResults.push(data.result)

            reportAggregatedProgress()
            dispatchNextBatch()
          } else if (data.type === 'ERROR') {
            console.error('[WorkerPool ERROR]:', data.message, data.stack)
            this.terminateAll()
            rejectSlot(new Error(data.message))
          } else if (data.type === 'SHARD_ERROR') {
            console.error('[WorkerPool SHARD_ERROR]:', data.error)
            this.terminateAll()
            rejectSlot(new Error(data.error))
          }
        }

        worker.onerror = (err) => {
          this.terminateAll()
          rejectSlot(new Error(err.message || 'Erreur Web Worker inattendue'))
        }

        dispatchNextBatch()
      })
    })

    return new Promise<SimulationMetricsSummary>(async (resolve, reject) => {
      this.rejectCurrentRun = reject
      try {
        await Promise.all(workerSlotPromises)
        if (this.isCancelled) {
          reject(new Error("Simulation annulée par l'utilisateur"))
          return
        }
        const totalDurationMs = performance.now() - startTime
        this.status = 'COMPLETED'
        resolve(
          mergeSimulationShards(
            shardResults,
            opponentDecks,
            config,
            baseSeed,
            totalDurationMs,
          ),
        )
      } catch (err) {
        if (this.status !== 'CANCELLED') {
          this.status = 'ERROR'
        }
        reject(err)
      } finally {
        this.isRunning = false
        this.rejectCurrentRun = null
        this.activeWorkers = []
      }
    })
  }
}
