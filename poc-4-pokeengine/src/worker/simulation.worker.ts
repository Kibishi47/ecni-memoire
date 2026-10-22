import { runMonteCarloShard, runMonteCarloSimulation } from '@/engine/fsmEngine'
import type {
  AIStrategyMode,
  SimulationConfig,
  SimulationResultPayload,
  WorkerShardRawResult,
} from '@/types/engine'

export type WorkerRequestMessage =
  | {
      type?: 'RUN_FULL'
      requestId: number
      config: SimulationConfig
    }
  | {
      type: 'RUN_SHARD'
      requestId: number
      shardId: number
      config: SimulationConfig
      aiMode: AIStrategyMode
      startGameIndex: number
      gameCount: number
      collectSamples: boolean
    }

export type WorkerResponseMessage =
  | {
      type: 'PROGRESS'
      requestId: number
      shardId?: number
      completedGames: number
      totalGames: number
    }
  | {
      type: 'RESULT'
      requestId: number
      result: SimulationResultPayload
    }
  | {
      type: 'SHARD_RESULT'
      requestId: number
      shardId: number
      shardResult: WorkerShardRawResult
    }

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const data = event.data

  if (data.type === 'RUN_SHARD') {
    const { requestId, shardId, config, aiMode, startGameIndex, gameCount, collectSamples } = data
    const shardResult = runMonteCarloShard(
      config,
      aiMode,
      startGameIndex,
      gameCount,
      collectSamples,
      (completedGames, totalGames) => {
        const progressMsg: WorkerResponseMessage = {
          type: 'PROGRESS',
          requestId,
          shardId,
          completedGames,
          totalGames,
        }
        self.postMessage(progressMsg)
      },
    )
    const response: WorkerResponseMessage = {
      type: 'SHARD_RESULT',
      requestId,
      shardId,
      shardResult,
    }
    self.postMessage(response)
    return
  }

  const { requestId, config } = data
  const result = runMonteCarloSimulation(config, (completedGames, totalGames) => {
    const progressMsg: WorkerResponseMessage = {
      type: 'PROGRESS',
      requestId,
      completedGames,
      totalGames,
    }
    self.postMessage(progressMsg)
  })
  const response: WorkerResponseMessage = {
    type: 'RESULT',
    requestId,
    result,
  }
  self.postMessage(response)
}
