import { runMonteCarloSimulation } from '@/engine/fsmEngine'
import type { SimulationConfig, SimulationResultPayload } from '@/types/engine'

export interface WorkerRequestMessage {
  requestId: number
  config: SimulationConfig
}

export interface WorkerResponseMessage {
  requestId: number
  result: SimulationResultPayload
}

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const { requestId, config } = event.data
  const result = runMonteCarloSimulation(config)
  const response: WorkerResponseMessage = {
    requestId,
    result,
  }
  self.postMessage(response)
}
