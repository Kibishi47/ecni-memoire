import {
  runSimulationShard,
  type SimulationShardInput,
  type SimulationShardResult,
} from '../core/gameLoop'

export type WorkerRequestMessage = {
  type: 'RUN_SHARD'
  payload: SimulationShardInput
}

export type WorkerResponseMessage =
  | {
      type: 'PROGRESS'
      workerId: number
      completedChunk: number
      totalInWorker: number
    }
  | {
      type: 'SHARD_PROGRESS'
      shardId: number
      completedInShard: number
    }
  | {
      type: 'SHARD_COMPLETE'
      shardId: number
      result: SimulationShardResult
    }
  | {
      type: 'ERROR'
      message: string
      stack?: string
    }
  | {
      type: 'SHARD_ERROR'
      shardId: number
      error: string
    }

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequestMessage>) => void) | null
  postMessage: (message: WorkerResponseMessage) => void
}

ctx.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const msg = event.data
  if (!msg || msg.type !== 'RUN_SHARD') return

  try {
    const result = runSimulationShard(msg.payload, (completedInShard) => {
      ctx.postMessage({
        type: 'PROGRESS',
        workerId: msg.payload.shardId,
        completedChunk: completedInShard,
        totalInWorker: msg.payload.gameCount,
      })
      ctx.postMessage({
        type: 'SHARD_PROGRESS',
        shardId: msg.payload.shardId,
        completedInShard,
      })
    })

    ctx.postMessage({
      type: 'SHARD_COMPLETE',
      shardId: msg.payload.shardId,
      result,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error(`[simulation.worker ${msg.payload.shardId}] Exception:`, err)
    ctx.postMessage({
      type: 'ERROR',
      message,
      stack,
    })
    ctx.postMessage({
      type: 'SHARD_ERROR',
      shardId: msg.payload.shardId,
      error: message,
    })
  }
}
