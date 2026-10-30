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
    ctx.postMessage({
      type: 'SHARD_ERROR',
      shardId: msg.payload.shardId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
