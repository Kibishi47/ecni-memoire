import type { AiTemperament, LookaheadPly, MaxBranchesSetting } from '../core/evaluator'
import type {
  EarlyStoppingMargin,
  SimulationConfig,
  WorkerSchedulingMode,
} from '../types/simulator'

export type HardwareTier = 'ECO' | 'BALANCED' | 'PERFORMANCE' | 'EXTREME'
export type HardwareCpuPreset = 'ECO' | 'BALANCED' | 'MAX'
export type StatisticalVolumePreset = 'FLASH' | 'STANDARD' | 'TOURNAMENT' | 'DEEP_STAT'
export type AiIntelligencePreset = 'FAST_HEURISTIC' | 'COMPETITIVE' | 'EXPERT_DEEP'

export interface HardwareProfile {
  logicalCores: number
  workerThreadsMax: number
  deviceMemoryGb: number | null
  singleCoreScore: number
  singleThreadGamesPerSec: number
  estimatedClusterGamesPerSec: number
  tier: HardwareTier
  calibratedAt: number
  fromCache: boolean
  measuredLiveSpeed: boolean
}

export interface EstimatedDurationResult {
  estimatedSeconds: number
  formattedDuration: string
  speedGamesPerSec: number
  isPrecisionCalibrated: boolean
}

const STORAGE_PROFILE_KEY = 'pokesim_hw_profile_v1'
const STORAGE_PERF_HISTORY_KEY = 'pokesim_measured_perf_v1'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Détecte les capacités matérielles brutes du navigateur / environnement JS.
 */
export function detectRawHardwareSpecs(): {
  logicalCores: number
  workerThreadsMax: number
  deviceMemoryGb: number | null
} {
  const rawCores =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 4

  const logicalCores = Math.max(1, Math.min(32, Math.round(rawCores)))
  const rawMemory =
    typeof navigator !== 'undefined' &&
    typeof (navigator as { deviceMemory?: unknown }).deviceMemory === 'number'
      ? Number((navigator as { deviceMemory?: number }).deviceMemory)
      : null

  return {
    logicalCores,
    workerThreadsMax: logicalCores,
    deviceMemoryGb: rawMemory && Number.isFinite(rawMemory) ? rawMemory : null,
  }
}

/**
 * Exécute un micro-benchmark CPU déterministe (~20 ms max) simulant du hachage Zobrist,
 * des mutations de tableau Int32Array et du tri de branches pour calibrer la vitesse mono-cœur réelle.
 */
export function measureSingleCoreOpsPerSec(sampleIterations = 45000): number {
  const stateBuffer = new Int32Array(64)
  for (let i = 0; i < stateBuffer.length; i++) {
    stateBuffer[i] = (i * 2654435761) | 0
  }

  let acc = 0x811c9dc5 | 0
  const start = performance.now()

  for (let i = 0; i < sampleIterations; i++) {
    const idx = i & 63
    const nextVal = (stateBuffer[idx]! ^ ((i * 16777619) | 0)) >>> 0
    stateBuffer[idx] = nextVal
    acc = (acc ^ Math.imul(nextVal, 0x9e3779b1)) | 0
    if ((i & 15) === 0) {
      acc = ((acc << 5) | (acc >>> 27)) ^ stateBuffer[(idx + 7) & 63]!
    }
  }

  const elapsedMs = Math.max(0.25, performance.now() - start)
  // Empêcher toute élimination par le JIT
  if (acc === 42) {
    stateBuffer[0] = acc
  }

  return (sampleIterations / elapsedMs) * 1000
}

/**
 * Calcule un facteur de coût relatif par partie par rapport au profil compétitif de référence (3-Ply / Beam 8 / Top-3 / T15).
 */
export function computeConfigComplexityFactor(config: Partial<SimulationConfig>): number {
  const ply: LookaheadPly = config.lookaheadPly ?? 3
  const oppPly: LookaheadPly = config.opponentLookaheadPly ?? ply
  const beamWidth = Math.max(1, config.beamWidth ?? (config.maxBranches === 8 ? 8 : 8))
  const topK = Math.max(1, config.topKCandidates ?? 3)
  const depth = Math.max(1, config.maxActionDepth ?? 8)
  const rolloutDepth = Math.max(1, config.rolloutMaxActions ?? 8)
  const maxTurns = Math.max(4, config.maxTurns ?? 15)

  const avgPly = (ply + oppPly) / 2
  const branchSearchCost = (beamWidth / 8) * (depth / 8)
  const rolloutCostPerBranch =
    avgPly <= 1
      ? 0.08
      : avgPly <= 1.5
        ? 0.35
        : avgPly <= 2
          ? 0.55 * (rolloutDepth / 8)
          : (0.45 + 0.55 * (avgPly - 2)) * (rolloutDepth / 8)

  const candidateEvalCost = (topK / 3) * rolloutCostPerBranch
  const turnFactor = maxTurns / 15

  return Math.max(0.12, (0.38 * branchSearchCost + 0.62 * candidateEvalCost) * turnFactor)
}

/**
 * Calcule les 4 paliers matériels à partir de la configuration CPU et du score mono-cœur.
 */
function classifyHardwareTier(logicalCores: number, singleCoreScore: number): HardwareTier {
  if (logicalCores <= 2 || singleCoreScore < 45) return 'ECO'
  if (logicalCores <= 6 && singleCoreScore < 95) return 'BALANCED'
  if (logicalCores >= 10 && singleCoreScore >= 85) return 'EXTREME'
  return 'PERFORMANCE'
}

/**
 * Facteur de passage à l'échelle parallèle (loi d'Amdahl + contention JS Worker).
 */
export function computeEffectiveParallelFactor(workers: number, logicalCores: number): number {
  const active = Math.max(1, Math.min(workers, logicalCores))
  if (active === 1) return 1
  const parallelEfficiency = 0.84
  return 1 + (active - 1) * parallelEfficiency
}

function safeReadLocalStorage<T>(key: string): T | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function safeWriteLocalStorage(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

/**
 * Retourne le profil matériel calibré (depuis le cache récent ou via un micro-benchmark immédiat).
 */
export function calibrateHardwareProfile(forceRecalibrate = false): HardwareProfile {
  const specs = detectRawHardwareSpecs()

  if (!forceRecalibrate) {
    const cached = safeReadLocalStorage<HardwareProfile>(STORAGE_PROFILE_KEY)
    const measuredPerf = safeReadLocalStorage<{ singleThreadBaselineGps: number; updatedAt: number }>(
      STORAGE_PERF_HISTORY_KEY,
    )
    if (
      cached &&
      cached.logicalCores === specs.logicalCores &&
      Date.now() - cached.calibratedAt < CACHE_TTL_MS
    ) {
      const liveSingleGps =
        measuredPerf && Number.isFinite(measuredPerf.singleThreadBaselineGps)
          ? measuredPerf.singleThreadBaselineGps
          : cached.singleThreadGamesPerSec

      return {
        ...cached,
        singleThreadGamesPerSec: Math.round(liveSingleGps * 10) / 10,
        estimatedClusterGamesPerSec: Math.round(
          liveSingleGps * computeEffectiveParallelFactor(specs.workerThreadsMax, specs.logicalCores),
        ),
        fromCache: true,
        measuredLiveSpeed: Boolean(measuredPerf),
      }
    }
  }

  // Exécute 2 passes courtes pour lisser les effets de démarrage JIT
  measureSingleCoreOpsPerSec(15000)
  const opsPerSec = measureSingleCoreOpsPerSec(50000)

  // Référence calibrée : ~9 000 000 ops/sec ≈ score 100 ≈ 45 parties 3-Ply/sec mono-cœur
  const normalizedScore = Math.max(15, Math.min(200, Math.round((opsPerSec / 9000000) * 100)))
  const baseSingleGps = Math.max(12, Math.min(90, Math.round((normalizedScore * 0.45) * 10) / 10))

  const measuredPerf = safeReadLocalStorage<{ singleThreadBaselineGps: number }>(
    STORAGE_PERF_HISTORY_KEY,
  )
  const singleThreadGamesPerSec =
    measuredPerf && Number.isFinite(measuredPerf.singleThreadBaselineGps)
      ? Math.round(measuredPerf.singleThreadBaselineGps * 10) / 10
      : baseSingleGps

  const profile: HardwareProfile = {
    logicalCores: specs.logicalCores,
    workerThreadsMax: specs.workerThreadsMax,
    deviceMemoryGb: specs.deviceMemoryGb,
    singleCoreScore: normalizedScore,
    singleThreadGamesPerSec,
    estimatedClusterGamesPerSec: Math.round(
      singleThreadGamesPerSec *
        computeEffectiveParallelFactor(specs.workerThreadsMax, specs.logicalCores),
    ),
    tier: classifyHardwareTier(specs.logicalCores, normalizedScore),
    calibratedAt: Date.now(),
    fromCache: false,
    measuredLiveSpeed: Boolean(measuredPerf),
  }

  safeWriteLocalStorage(STORAGE_PROFILE_KEY, profile)
  return profile
}

/**
 * Enregistre la vitesse réelle mesurée à la fin d'une simulation pour auto-calibrer les estimations futures.
 */
export function recordActualSimulationThroughput(
  actualGamesPerSec: number,
  config: SimulationConfig,
): void {
  if (!Number.isFinite(actualGamesPerSec) || actualGamesPerSec <= 0 || config.iterations < 20) {
    return
  }
  const specs = detectRawHardwareSpecs()
  const parallelFactor = computeEffectiveParallelFactor(
    config.workerCount || specs.logicalCores,
    specs.logicalCores,
  )
  const complexity = computeConfigComplexityFactor(config)

  // Ramène la vitesse observée à une équivalence mono-cœur sur configuration compétitive 1.0x
  const inferredSingleBaseline = Math.max(
    5,
    Math.min(120, (actualGamesPerSec / parallelFactor) * complexity),
  )

  const prev = safeReadLocalStorage<{ singleThreadBaselineGps: number }>(STORAGE_PERF_HISTORY_KEY)
  const blended =
    prev && Number.isFinite(prev.singleThreadBaselineGps)
      ? prev.singleThreadBaselineGps * 0.45 + inferredSingleBaseline * 0.55
      : inferredSingleBaseline

  safeWriteLocalStorage(STORAGE_PERF_HISTORY_KEY, {
    singleThreadBaselineGps: Math.round(blended * 10) / 10,
    updatedAt: Date.now(),
  })
}

export function computeHardwareAllocation(
  preset: HardwareCpuPreset,
  maxHardwareWorkers: number,
): {
  workerCount: number
  workerSchedulingMode: WorkerSchedulingMode
  batchSize: number
} {
  const maxW = Math.max(1, maxHardwareWorkers)
  switch (preset) {
    case 'ECO':
      return {
        workerCount: Math.max(1, Math.min(2, Math.floor(maxW * 0.4))),
        workerSchedulingMode: 'DYNAMIC_BATCHES',
        batchSize: 20,
      }
    case 'BALANCED':
      return {
        workerCount: Math.max(1, Math.min(maxW, Math.max(2, Math.floor(maxW * 0.75)))),
        workerSchedulingMode: 'DYNAMIC_BATCHES',
        batchSize: 25,
      }
    case 'MAX':
    default:
      return {
        workerCount: maxW,
        workerSchedulingMode: 'DYNAMIC_BATCHES',
        batchSize: 25,
      }
  }
}

export function computeStatisticalVolume(preset: StatisticalVolumePreset): {
  iterations: number
  earlyStoppingMargin: EarlyStoppingMargin
} {
  switch (preset) {
    case 'FLASH':
      return { iterations: 150, earlyStoppingMargin: 0 }
    case 'STANDARD':
      return { iterations: 500, earlyStoppingMargin: 0 }
    case 'TOURNAMENT':
      return { iterations: 2000, earlyStoppingMargin: 2.5 }
    case 'DEEP_STAT':
      return { iterations: 5000, earlyStoppingMargin: 0 }
  }
}

export function computeAiIntelligence(preset: AiIntelligencePreset): {
  maxBranches: MaxBranchesSetting
  lookaheadPly: LookaheadPly
  topKCandidates: number
  beamWidth: number
  maxActionDepth: number
  rolloutMaxActions: number
  opponentLookaheadPly: LookaheadPly
  opponentMaxBranches: MaxBranchesSetting
  aiTemperament: AiTemperament
  maxTurns: number
} {
  switch (preset) {
    case 'FAST_HEURISTIC':
      return {
        maxBranches: 8,
        lookaheadPly: 1,
        topKCandidates: 1,
        beamWidth: 4,
        maxActionDepth: 6,
        rolloutMaxActions: 4,
        opponentLookaheadPly: 1,
        opponentMaxBranches: 8,
        aiTemperament: 'BALANCED',
        maxTurns: 12,
      }
    case 'EXPERT_DEEP':
      return {
        maxBranches: 50,
        lookaheadPly: 3,
        topKCandidates: 6,
        beamWidth: 12,
        maxActionDepth: 12,
        rolloutMaxActions: 10,
        opponentLookaheadPly: 3,
        opponentMaxBranches: 20,
        aiTemperament: 'BALANCED',
        maxTurns: 18,
      }
    case 'COMPETITIVE':
    default:
      return {
        maxBranches: 20,
        lookaheadPly: 3,
        topKCandidates: 3,
        beamWidth: 8,
        maxActionDepth: 8,
        rolloutMaxActions: 8,
        opponentLookaheadPly: 3,
        opponentMaxBranches: 20,
        aiTemperament: 'BALANCED',
        maxTurns: 15,
      }
  }
}

export function getRecommendedPresetsForProfile(profile: HardwareProfile): {
  cpu: HardwareCpuPreset
  volume: StatisticalVolumePreset
  ai: AiIntelligencePreset
} {
  switch (profile.tier) {
    case 'ECO':
      return { cpu: 'BALANCED', volume: 'FLASH', ai: 'FAST_HEURISTIC' }
    case 'BALANCED':
      return { cpu: 'BALANCED', volume: 'STANDARD', ai: 'COMPETITIVE' }
    case 'EXTREME':
      return { cpu: 'MAX', volume: 'TOURNAMENT', ai: 'COMPETITIVE' }
    case 'PERFORMANCE':
    default:
      return { cpu: 'MAX', volume: 'STANDARD', ai: 'COMPETITIVE' }
  }
}

export function formatEstimatedDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return '< 1 s'
  const rounded = Math.round(seconds)
  if (rounded < 60) return `~${rounded} s`
  const mins = Math.floor(rounded / 60)
  const secs = rounded % 60
  return secs > 0 ? `~${mins} min ${secs} s` : `~${mins} min`
}

/**
 * Estime la durée murale de la simulation en fonction de tous les paramètres actifs et du profil CPU.
 */
export function estimateSimulationDurationSeconds(
  config: Partial<SimulationConfig>,
  profile: HardwareProfile,
): EstimatedDurationResult {
  const iterations = Math.max(1, config.iterations ?? 300)
  const workers = Math.max(1, Math.min(profile.logicalCores, config.workerCount ?? 4))
  const parallelFactor = computeEffectiveParallelFactor(workers, profile.logicalCores)
  const complexity = computeConfigComplexityFactor(config)

  // Nombre moyen attendu d'itérations si l'arrêt statistique précoce est activé
  let expectedIterations = iterations
  if (config.earlyStoppingMargin && config.earlyStoppingMargin > 0 && iterations > 250) {
    const worstCaseConvergeN = Math.ceil(
      (1.96 * 1.96 * 0.25 * 10000) / (config.earlyStoppingMargin * config.earlyStoppingMargin),
    )
    expectedIterations = Math.max(200, Math.min(iterations, Math.round(worstCaseConvergeN * 0.85)))
  }

  const speedGamesPerSec = Math.max(
    1,
    Math.round((profile.singleThreadGamesPerSec * parallelFactor) / complexity),
  )
  const estimatedSeconds = expectedIterations / speedGamesPerSec

  return {
    estimatedSeconds,
    formattedDuration: formatEstimatedDuration(estimatedSeconds),
    speedGamesPerSec,
    isPrecisionCalibrated: profile.measuredLiveSpeed,
  }
}
