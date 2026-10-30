import type { EngineCardModel } from '../types/cardModel'
import type { ParsedDeck } from '../types/deck'
import type { SimulationConfig, SimulationMetricsSummary } from '../types/simulator'
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
        archetypeTag: oppMeta.archetypeBadge,
        accentColor: oppMeta.badgeColor,
        models: expandParsedDeckToModels(parsed),
      }
      cachedOpponentDescriptors.set(oppMeta.id, desc)
    }
    result.push(desc)
  }
  return result
}

export class SimulationWorkerPool {
  private activeWorkers: Worker[] = []
  private rejectCurrentRun?: ((reason?: unknown) => void) | null
  private isCancelled = false
  public isRunning = false
  public status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'CANCELLED' | 'ERROR' = 'IDLE'

  public terminateAll(): void {
    for (const w of this.activeWorkers) {
      try {
        w.terminate()
      } catch {
        // Silently ignore termination errors
      }
    }
    this.activeWorkers = []
  }

  public cancelSimulation(): void {
    if (!this.isRunning) return
    this.isCancelled = true
    this.status = 'CANCELLED'
    this.isRunning = false
    this.terminateAll()
    if (this.rejectCurrentRun) {
      this.rejectCurrentRun(new Error('Simulation annulée par l\'utilisateur'))
      this.rejectCurrentRun = null
    }
  }

  public async runSimulation(
    playerDeck: ParsedDeck,
    config: SimulationConfig,
    onProgress?: (completedGames: number, totalGames: number, elapsedMs: number) => void,
  ): Promise<SimulationMetricsSummary> {
    this.terminateAll()
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
        'Simulation impossible : la base de données cards_database.json est vide. Synchronisez les modèles de cartes avec npm run sync-cards.',
      )
    }

    if (!playerDeck.isFullyResolved) {
      this.status = 'ERROR'
      this.isRunning = false
      throw new Error(
        `Simulation bloquée : ${playerDeck.unresolvedCount} carte(s) absente(s) de cards_database.json`,
      )
    }

    const playerDeckModels = expandParsedDeckToModels(playerDeck)
    const opponentDecks = resolveOpponentDescriptors(config.selectedOpponentIds)
    if (opponentDecks.length === 0) {
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

    // Découpage en Shards équilibrés
    const shardsInput: SimulationShardInput[] = []
    let nextStart = 0
    for (let wIdx = 0; wIdx < desiredWorkers; wIdx++) {
      const remainingGames = totalGames - nextStart
      const remainingWorkers = desiredWorkers - wIdx
      const countForShard = Math.ceil(remainingGames / remainingWorkers)
      if (countForShard <= 0) break

      shardsInput.push({
        shardId: wIdx,
        startGameIndex: nextStart,
        gameCount: countForShard,
        baseSeed,
        config: JSON.parse(JSON.stringify(cleanConfig)),
        playerDeckModels: cleanPlayerDeckModels,
        opponentDecks: cleanOpponentDecks,
      })
      nextStart += countForShard
    }

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
              completedSoFar += shardIn.gameCount
              shardResults.push(res)
            }
            if (this.isCancelled) {
              reject(new Error('Simulation annulée par l\'utilisateur'))
              return
            }
            const totalDurationMs = performance.now() - startTime
            this.status = 'COMPLETED'
            this.isRunning = false
            resolve(mergeSimulationShards(shardResults, opponentDecks, config, baseSeed, totalDurationMs))
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

    // Exécution parallèle via Web Workers natifs
    const progressByShard = new Map<number, number>()
    const reportAggregatedProgress = () => {
      if (!onProgress) return
      let sum = 0
      for (const val of progressByShard.values()) {
        sum += val
      }
      onProgress(Math.min(totalGames, sum), totalGames, Math.round(performance.now() - startTime))
    }

    const shardPromises = shardsInput.map(
      (shardIn) =>
        new Promise<SimulationShardResult>((resolve, reject) => {
          const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), {
            type: 'module',
          })
          this.activeWorkers.push(worker)

          worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
            const data = event.data
            if (!data) return

            if (data.type === 'PROGRESS') {
              progressByShard.set(data.workerId, data.completedChunk)
              reportAggregatedProgress()
            } else if (data.type === 'SHARD_PROGRESS') {
              progressByShard.set(data.shardId, data.completedInShard)
              reportAggregatedProgress()
            } else if (data.type === 'SHARD_COMPLETE') {
              progressByShard.set(data.shardId, shardIn.gameCount)
              reportAggregatedProgress()
              worker.terminate()
              resolve(data.result)
            } else if (data.type === 'ERROR') {
              console.error('[WorkerPool ERROR]:', data.message, data.stack)
              worker.terminate()
              reject(new Error(data.message))
            } else if (data.type === 'SHARD_ERROR') {
              console.error('[WorkerPool SHARD_ERROR]:', data.error)
              worker.terminate()
              reject(new Error(data.error))
            }
          }

          worker.onerror = (err) => {
            worker.terminate()
            reject(new Error(err.message || 'Erreur Web Worker inattendue'))
          }

          const req: WorkerRequestMessage = {
            type: 'RUN_SHARD',
            payload: shardIn,
          }
          worker.postMessage(req)
        }),
    )

    return new Promise<SimulationMetricsSummary>(async (resolve, reject) => {
      this.rejectCurrentRun = reject
      try {
        const shardResults = await Promise.all(shardPromises)
        if (this.isCancelled) {
          reject(new Error('Simulation annulée par l\'utilisateur'))
          return
        }
        const totalDurationMs = performance.now() - startTime
        this.status = 'COMPLETED'
        resolve(mergeSimulationShards(shardResults, opponentDecks, config, baseSeed, totalDurationMs))
      } catch (err) {
        if (this.status !== 'CANCELLED') {
          this.status = 'ERROR'
        }
        reject(err)
      } finally {
        this.isRunning = false
        this.rejectCurrentRun = null
        this.terminateAll()
      }
    })
  }
}
