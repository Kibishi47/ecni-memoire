import {
  buildModeComparisonFromShard,
  getComparisonModesList,
  mergeMonteCarloShards,
  runMonteCarloSimulation,
} from '@/engine/fsmEngine'
import type {
  AIModeComparisonMetric,
  AIStrategyMode,
  SimulationConfig,
  SimulationResultPayload,
  WorkerShardRawResult,
} from '@/types/engine'
import type { WorkerRequestMessage, WorkerResponseMessage } from '@/worker/simulation.worker'

interface PendingShardResolver {
  requestId: number
  shardId: number
  resolve: (res: WorkerShardRawResult) => void
  onProgress?: (completedInShard: number) => void
}

interface PendingFullResolver {
  requestId: number
  resolve: (res: SimulationResultPayload) => void
  onProgress?: (completed: number, total: number) => void
}

/**
 * Parallel Web Worker Pool (`workerPool.ts`)
 * Splits N Monte-Carlo simulations across K dedicated Web Workers in parallel via `Promise.all`,
 * decoupling Silent Runs (99.5% of games with 0 string/array allocations) from Traced Runs (50 games),
 * and merges all shard counters in < 1 ms.
 */
export class SimulationWorkerPool {
  private workers: Worker[] = []
  private readonly hardwareThreads: number
  private pendingShards = new Map<string, PendingShardResolver>()
  private pendingFull = new Map<number, PendingFullResolver>()

  constructor() {
    const detectedCores =
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4
    this.hardwareThreads = Math.min(8, Math.max(4, detectedCores))
    this.initPool()
  }

  public getPoolSize(): number {
    return this.workers.length > 0 ? this.workers.length : this.hardwareThreads
  }

  private initPool(): void {
    try {
      for (let i = 0; i < this.hardwareThreads; i++) {
        const w = new Worker(new URL('./simulation.worker.ts', import.meta.url), {
          type: 'module',
        })
        w.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
          this.handleWorkerMessage(event.data)
        }
        this.workers.push(w)
      }
    } catch {
      this.workers = []
    }
  }

  private handleWorkerMessage(data: WorkerResponseMessage): void {
    if (data.type === 'PROGRESS') {
      if (data.shardId !== undefined) {
        const key = `${data.requestId}:${data.shardId}`
        const entry = this.pendingShards.get(key)
        if (entry?.onProgress) {
          entry.onProgress(data.completedGames)
        }
      } else {
        const fullEntry = this.pendingFull.get(data.requestId)
        if (fullEntry?.onProgress) {
          fullEntry.onProgress(data.completedGames, data.totalGames)
        }
      }
    } else if (data.type === 'SHARD_RESULT') {
      const key = `${data.requestId}:${data.shardId}`
      const entry = this.pendingShards.get(key)
      if (entry) {
        this.pendingShards.delete(key)
        entry.resolve(data.shardResult)
      }
    } else if (data.type === 'RESULT') {
      const fullEntry = this.pendingFull.get(data.requestId)
      if (fullEntry) {
        this.pendingFull.delete(data.requestId)
        fullEntry.resolve(data.result)
      }
    }
  }

  private dispatchShardOnWorker(
    workerIndex: number,
    requestId: number,
    shardId: number,
    config: SimulationConfig,
    aiMode: AIStrategyMode,
    startGameIndex: number,
    gameCount: number,
    collectSamples: boolean,
    onProgress?: (completedInShard: number) => void,
  ): Promise<WorkerShardRawResult> {
    const worker = this.workers[workerIndex % this.workers.length]
    const key = `${requestId}:${shardId}`

    return new Promise<WorkerShardRawResult>((resolve) => {
      this.pendingShards.set(key, {
        requestId,
        shardId,
        resolve,
        onProgress,
      })

      const msg: WorkerRequestMessage = {
        type: 'RUN_SHARD',
        requestId,
        shardId,
        config,
        aiMode,
        startGameIndex,
        gameCount,
        collectSamples,
      }
      worker.postMessage(msg)
    })
  }

  public async executeSimulation(
    requestId: number,
    config: SimulationConfig,
    onProgress?: (completedGames: number, totalGames: number) => void,
  ): Promise<SimulationResultPayload> {
    // Fallback if Workers are unavailable in environment
    if (this.workers.length === 0) {
      return runMonteCarloSimulation(config, onProgress)
    }

    // Mode 1: Single Worker (Mono-thread baseline)
    if (config.workerMode === 'SINGLE_WORKER') {
      return new Promise<SimulationResultPayload>((resolve) => {
        this.pendingFull.set(requestId, {
          requestId,
          resolve,
          onProgress,
        })
        const msg: WorkerRequestMessage = {
          type: 'RUN_FULL',
          requestId,
          config,
        }
        this.workers[0].postMessage(msg)
      })
    }

    // Mode 2: Multi-Worker Parallel Sharding (K = 4..8 Workers via Promise.all)
    const t0 = performance.now()
    const N = config.iterations
    const K = this.workers.length
    const baseChunk = Math.floor(N / K)
    const remainder = N % K

    const shardProgress = new Int32Array(K)
    const mainShardPromises: Promise<WorkerShardRawResult>[] = []

    let currentStart = 0
    for (let wIdx = 0; wIdx < K; wIdx++) {
      const count = baseChunk + (wIdx < remainder ? 1 : 0)
      if (count <= 0) continue

      const shardId = wIdx
      // Only Shard 0 collects the 50 traced inspector games; Shards 1..K-1 run 100% silent zero-allocation!
      const collectSamples = wIdx === 0

      mainShardPromises.push(
        this.dispatchShardOnWorker(
          wIdx,
          requestId,
          shardId,
          config,
          config.aiMode,
          currentStart,
          count,
          collectSamples,
          (completedInShard) => {
            shardProgress[wIdx] = completedInShard
            if (onProgress) {
              let sumCompleted = 0
              for (let j = 0; j < K; j++) sumCompleted += shardProgress[j]
              onProgress(sumCompleted, N)
            }
          },
        ),
      )
      currentStart += count
    }

    // Dispatch comparison modes in parallel across workers as well
    const compareN = Math.min(N, 600)
    const modesList = getComparisonModesList(config)
    const otherModes = modesList.filter((m) => m.mode !== config.aiMode)

    const comparePromises = otherModes.map((m, idx) =>
      this.dispatchShardOnWorker(
        (idx + 1) % K,
        requestId,
        100 + idx,
        config,
        m.mode,
        0,
        compareN,
        false,
      ).then((shard) => buildModeComparisonFromShard(m.mode, m.label, shard)),
    )

    const [mainShards, otherComparisons] = await Promise.all([
      Promise.all(mainShardPromises),
      Promise.all(comparePromises),
    ])

    const t1 = performance.now()
    const elapsedMs = Math.max(0.1, Number((t1 - t0).toFixed(2)))

    // Merge main shards to build the active mode comparison entry
    const mergedPreview = mergeMonteCarloShards(config, mainShards, [], elapsedMs, K)
    const activeModeEntry = modesList.find((m) => m.mode === config.aiMode)
    const aiComparison: AIModeComparisonMetric[] = modesList.map(({ mode, label }) => {
      if (mode === config.aiMode) {
        return {
          aiMode: mode,
          label: activeModeEntry?.label ?? label,
          turn1SetupRatePct: mergedPreview.strategicMetrics.turn1SetupSuccessPct,
          turn2CharizardAttachRatePct: mergedPreview.strategicMetrics.turn2CharizardReadyPct,
          pidgeotEstablishedRatePct: mergedPreview.strategicMetrics.pidgeotInPlayPct,
          revengeKillT3RatePct: mergedPreview.strategicMetrics.revengeKillT3RatePct,
          threatNeutralizationRatePct: mergedPreview.strategicMetrics.threatNeutralizationRatePct,
          postIonoSurvivalRatePct: mergedPreview.strategicMetrics.postIonoSurvivalRatePct,
          brickRatePct: mergedPreview.strategicMetrics.brickRatePct,
          avgBoardScore: mergedPreview.strategicMetrics.avgBoardScoreT4,
          avgDeckThinningCards: Number(
            (
              mainShards.reduce((acc, s) => acc + s.sumThinning, 0) / Math.max(1, config.iterations)
            ).toFixed(1),
          ),
        }
      }
      return (
        otherComparisons.find((c) => c.aiMode === mode) ?? {
          aiMode: mode,
          label,
          turn1SetupRatePct: 0,
          turn2CharizardAttachRatePct: 0,
          pidgeotEstablishedRatePct: 0,
          brickRatePct: 0,
          avgBoardScore: 0,
          avgDeckThinningCards: 0,
        }
      )
    })

    mergedPreview.aiComparison = aiComparison
    return mergedPreview
  }

  public terminateAll(): void {
    for (const w of this.workers) {
      w.terminate()
    }
    this.workers = []
    this.pendingShards.clear()
    this.pendingFull.clear()
  }
}
