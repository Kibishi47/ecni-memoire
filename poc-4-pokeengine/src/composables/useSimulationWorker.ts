import { onBeforeUnmount, onMounted, reactive, ref, toRaw } from 'vue'
import { DEFAULT_CARD_REGISTRY } from '@/engine/cardRegistry'
import { runMonteCarloSimulation } from '@/engine/fsmEngine'
import type {
  DeclarativeCardDefinition,
  SimulationConfig,
  SimulationResultPayload,
} from '@/types/engine'
import type { WorkerRequestMessage, WorkerResponseMessage } from '@/worker/simulation.worker'

export function useSimulationWorker() {
  const config = reactive<SimulationConfig>({
    iterations: 10000,
    aiMode: 'OPTIMAL_BEAM',
    goingFirst: false, // 2nd player allows T1 Arven/Supporter by default, toggleable in 1 click
    prizesEnabled: true,
    turn3Disruption: 'NONE',
    seed: 2026,
    deckRatios: {
      basicPokemonCount: 9,
      poffinCount: 4,
      rareCandyCount: 4,
      fireEnergyCount: 8,
    },
    customRegistry: structuredClone(DEFAULT_CARD_REGISTRY),
  })

  const isRunning = ref(false)
  const result = ref<SimulationResultPayload | null>(null)
  const totalRunsTriggered = ref(0)

  // Real-time Main Thread UI FPS Telemetry via requestAnimationFrame
  const currentFps = ref(60)
  const minFpsDuringRun = ref(60)
  let rafId = 0
  let frameCount = 0
  let lastFpsTimestamp = 0

  let worker: Worker | null = null
  let latestRequestId = 0

  function startFpsMonitor() {
    lastFpsTimestamp = performance.now()
    frameCount = 0
    const loop = (now: number) => {
      frameCount++
      const elapsed = now - lastFpsTimestamp
      if (elapsed >= 500) {
        const measured = Math.min(120, Math.round((frameCount * 1000) / elapsed))
        currentFps.value = measured > 0 ? measured : 60
        if (isRunning.value) {
          minFpsDuringRun.value = Math.min(minFpsDuringRun.value, currentFps.value)
        }
        frameCount = 0
        lastFpsTimestamp = now
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
  }

  function initWorker() {
    try {
      worker = new Worker(new URL('../worker/simulation.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
        const { requestId, result: payload } = event.data
        if (requestId === latestRequestId) {
          result.value = payload
          isRunning.value = false
        }
      }
      worker.onerror = () => {
        // Fallback to synchronous execution if worker fails
        const rawConfig = structuredClone(toRaw(config))
        result.value = runMonteCarloSimulation(rawConfig)
        isRunning.value = false
      }
    } catch {
      worker = null
    }
  }

  function triggerSimulation() {
    latestRequestId++
    const reqId = latestRequestId
    isRunning.value = true
    minFpsDuringRun.value = currentFps.value
    totalRunsTriggered.value++

    const plainConfig: SimulationConfig = JSON.parse(JSON.stringify(toRaw(config)))

    if (worker) {
      const msg: WorkerRequestMessage = {
        requestId: reqId,
        config: plainConfig,
      }
      worker.postMessage(msg)
    } else {
      setTimeout(() => {
        result.value = runMonteCarloSimulation(plainConfig)
        isRunning.value = false
      }, 10)
    }
  }

  function randomizeSeed() {
    config.seed = Math.floor(1000 + Math.random() * 99000)
    triggerSimulation()
  }

  function resetToDefaults() {
    config.iterations = 10000
    config.aiMode = 'OPTIMAL_BEAM'
    config.goingFirst = false
    config.prizesEnabled = true
    config.turn3Disruption = 'NONE'
    config.seed = 2026
    config.deckRatios.basicPokemonCount = 9
    config.deckRatios.poffinCount = 4
    config.deckRatios.rareCandyCount = 4
    config.deckRatios.fireEnergyCount = 8
    config.customRegistry = structuredClone(DEFAULT_CARD_REGISTRY)
    triggerSimulation()
  }

  function updateCustomRegistry(updatedCards: DeclarativeCardDefinition[]) {
    config.customRegistry = JSON.parse(JSON.stringify(updatedCards))
    triggerSimulation()
  }

  onMounted(() => {
    startFpsMonitor()
    initWorker()
    triggerSimulation()
  })

  onBeforeUnmount(() => {
    if (rafId) cancelAnimationFrame(rafId)
    if (worker) worker.terminate()
  })

  return {
    config,
    isRunning,
    result,
    currentFps,
    minFpsDuringRun,
    totalRunsTriggered,
    triggerSimulation,
    randomizeSeed,
    resetToDefaults,
    updateCustomRegistry,
  }
}
