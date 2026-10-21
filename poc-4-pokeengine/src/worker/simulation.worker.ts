import { runMonteCarloSimulation } from '@/engine/fsmEngine'
import type { SimulationConfig, SimulationResultPayload } from '@/types/engine'

export interface WorkerRequestMessage {
  requestId: number
  config: SimulationConfig
}

export type WorkerResponseMessage =
  | {
      type: 'PROGRESS'
      requestId: number
      completedGames: number
      totalGames: number
    }
  | {
      type: 'RESULT'
      requestId: number
      result: SimulationResultPayload
    }

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const { requestId, config } = event.data
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
