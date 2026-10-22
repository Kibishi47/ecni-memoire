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
    maxTurns: 4,
    aiMode: 'OPTIMAL_BEAM',
    fixedBeamWidth: 3,
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

  // Live notification banner & progress state
  const showStatusBanner = ref(false)
  const statusBannerPhase = ref<'RUNNING' | 'COMPLETED'>('RUNNING')
  const progressCompletedGames = ref(0)
  const progressTotalGames = ref(10000)
  const progressPct = ref(0)
  let runStartTimestamp = 0
  let hideBannerTimeout: ReturnType<typeof setTimeout> | null = null
  let minDisplayTimeout: ReturnType<typeof setTimeout> | null = null

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

  function finalizeSimulationResult(payload: SimulationResultPayload) {
    const elapsedSinceTrigger = performance.now() - runStartTimestamp
    // Ensure the "Simulation en cours..." banner is perceptible for at least 260ms even on ultra-fast 3ms runs
    const remainingMinDisplayMs = Math.max(0, 260 - elapsedSinceTrigger)

    if (minDisplayTimeout) clearTimeout(minDisplayTimeout)
    minDisplayTimeout = setTimeout(() => {
      result.value = payload
      isRunning.value = false
      progressCompletedGames.value = payload.config.iterations
      progressTotalGames.value = payload.config.iterations
      progressPct.value = 100
      statusBannerPhase.value = 'COMPLETED'
      showStatusBanner.value = true

      if (hideBannerTimeout) clearTimeout(hideBannerTimeout)
      hideBannerTimeout = setTimeout(() => {
        if (!isRunning.value) {
          showStatusBanner.value = false
        }
      }, 3600)
    }, remainingMinDisplayMs)
  }

  function initWorker() {
    try {
      worker = new Worker(new URL('../worker/simulation.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
        const data = event.data
        if (data.requestId !== latestRequestId) return

        if (data.type === 'PROGRESS') {
          progressCompletedGames.value = data.completedGames
          progressTotalGames.value = data.totalGames
          progressPct.value = Math.min(99, Math.round((data.completedGames / data.totalGames) * 100))
        } else if (data.type === 'RESULT') {
          finalizeSimulationResult(data.result)
        }
      }
      worker.onerror = () => {
        const rawConfig = structuredClone(toRaw(config))
        const syncResult = runMonteCarloSimulation(rawConfig)
        finalizeSimulationResult(syncResult)
      }
    } catch {
      worker = null
    }
  }

  function triggerSimulation() {
    latestRequestId++
    const reqId = latestRequestId
    if (hideBannerTimeout) clearTimeout(hideBannerTimeout)
    if (minDisplayTimeout) clearTimeout(minDisplayTimeout)

    runStartTimestamp = performance.now()
    isRunning.value = true
    statusBannerPhase.value = 'RUNNING'
    showStatusBanner.value = true
    progressCompletedGames.value = 0
    progressTotalGames.value = config.iterations
    progressPct.value = 12
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
        const syncRes = runMonteCarloSimulation(plainConfig)
        finalizeSimulationResult(syncRes)
      }, 10)
    }
  }

  function randomizeSeed() {
    config.seed = Math.floor(1000 + Math.random() * 99000)
    triggerSimulation()
  }

  function resetToDefaults() {
    config.iterations = 10000
    config.maxTurns = 4
    config.aiMode = 'OPTIMAL_BEAM'
    config.fixedBeamWidth = 3
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

  function dismissStatusBanner() {
    showStatusBanner.value = false
  }

  onMounted(() => {
    startFpsMonitor()
    initWorker()
    triggerSimulation()
  })

  onBeforeUnmount(() => {
    if (rafId) cancelAnimationFrame(rafId)
    if (hideBannerTimeout) clearTimeout(hideBannerTimeout)
    if (minDisplayTimeout) clearTimeout(minDisplayTimeout)
    if (worker) worker.terminate()
  })

  return {
    config,
    isRunning,
    result,
    currentFps,
    minFpsDuringRun,
    totalRunsTriggered,
    showStatusBanner,
    statusBannerPhase,
    progressCompletedGames,
    progressTotalGames,
    progressPct,
    dismissStatusBanner,
    triggerSimulation,
    randomizeSeed,
    resetToDefaults,
    updateCustomRegistry,
  }
}
