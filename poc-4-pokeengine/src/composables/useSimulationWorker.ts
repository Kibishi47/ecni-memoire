import { onBeforeUnmount, onMounted, reactive, ref, toRaw } from 'vue'
import { DEFAULT_CARD_REGISTRY } from '@/engine/cardRegistry'
import { runMonteCarloSimulation } from '@/engine/fsmEngine'
import type {
  DeclarativeCardDefinition,
  SimulationConfig,
  SimulationResultPayload,
} from '@/types/engine'
import { SimulationWorkerPool } from '@/worker/workerPool'

export function useSimulationWorker() {
  const config = reactive<SimulationConfig>({
    iterations: 10000,
    maxTurns: 4,
    aiMode: 'EXPECTIMINIMAX_T1',
    fixedBeamWidth: 3,
    workerMode: 'MULTI_WORKER',
    opponentArchetype: 'RAGING_BOLT_AGGRO',
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
  const detectedWorkerThreads = ref(4)

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

  let workerPool: SimulationWorkerPool | null = null
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
    // Ensure the "Simulation en cours..." banner is perceptible for at least 220ms even on <80ms parallel runs
    const remainingMinDisplayMs = Math.max(0, 220 - elapsedSinceTrigger)

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

  function initPool() {
    workerPool = new SimulationWorkerPool()
    detectedWorkerThreads.value = workerPool.getPoolSize()
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

    if (workerPool) {
      workerPool
        .executeSimulation(reqId, plainConfig, (completedGames, totalGames) => {
          if (reqId !== latestRequestId) return
          progressCompletedGames.value = completedGames
          progressTotalGames.value = totalGames
          progressPct.value = Math.min(99, Math.round((completedGames / totalGames) * 100))
        })
        .then((payload) => {
          if (reqId !== latestRequestId) return
          finalizeSimulationResult(payload)
        })
        .catch(() => {
          if (reqId !== latestRequestId) return
          const syncRes = runMonteCarloSimulation(plainConfig)
          finalizeSimulationResult(syncRes)
        })
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
    config.aiMode = 'EXPECTIMINIMAX_T1'
    config.fixedBeamWidth = 3
    config.workerMode = 'MULTI_WORKER'
    config.opponentArchetype = 'RAGING_BOLT_AGGRO'
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
    initPool()
    triggerSimulation()
  })

  onBeforeUnmount(() => {
    if (rafId) cancelAnimationFrame(rafId)
    if (hideBannerTimeout) clearTimeout(hideBannerTimeout)
    if (minDisplayTimeout) clearTimeout(minDisplayTimeout)
    if (workerPool) workerPool.terminateAll()
  })

  return {
    config,
    isRunning,
    result,
    currentFps,
    minFpsDuringRun,
    totalRunsTriggered,
    detectedWorkerThreads,
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
