import { describe, expect, it } from 'vitest'
import {
  calibrateHardwareProfile,
  computeAiIntelligence,
  computeConfigComplexityFactor,
  computeHardwareAllocation,
  computeStatisticalVolume,
  estimateSimulationDurationSeconds,
  formatEstimatedDuration,
  getRecommendedPresetsForProfile,
} from './hardwareBenchmark'

describe('hardwareBenchmark — Hardware Calibration & Performance Presets', () => {
  it('calibrates a coherent hardware profile with valid scores and tier', () => {
    const profile = calibrateHardwareProfile(true)
    expect(profile.logicalCores).toBeGreaterThanOrEqual(1)
    expect(profile.workerThreadsMax).toBe(profile.logicalCores)
    expect(profile.singleCoreScore).toBeGreaterThanOrEqual(15)
    expect(profile.singleThreadGamesPerSec).toBeGreaterThanOrEqual(8)
    expect(profile.estimatedClusterGamesPerSec).toBeGreaterThanOrEqual(profile.singleThreadGamesPerSec)
    expect(['ECO', 'BALANCED', 'PERFORMANCE', 'EXTREME']).toContain(profile.tier)
  })

  it('scales CPU allocation presets strictly proportionally to maxHardwareWorkers', () => {
    const eco = computeHardwareAllocation('ECO', 12)
    const balanced = computeHardwareAllocation('BALANCED', 12)
    const max = computeHardwareAllocation('MAX', 12)

    expect(eco.workerCount).toBe(2)
    expect(balanced.workerCount).toBe(9)
    expect(max.workerCount).toBe(12)
    expect(max.workerSchedulingMode).toBe('DYNAMIC_BATCHES')

    expect(computeHardwareAllocation('ECO', 2).workerCount).toBe(1)
    expect(computeHardwareAllocation('MAX', 2).workerCount).toBe(2)
  })

  it('orders statistical volume and AI intelligence complexity accurately', () => {
    expect(computeStatisticalVolume('FLASH').iterations).toBe(150)
    expect(computeStatisticalVolume('TOURNAMENT').earlyStoppingMargin).toBe(2.5)
    expect(computeStatisticalVolume('DEEP_STAT').iterations).toBe(5000)

    const fastAi = computeAiIntelligence('FAST_HEURISTIC')
    const compAi = computeAiIntelligence('COMPETITIVE')
    const expertAi = computeAiIntelligence('EXPERT_DEEP')

    expect(fastAi.lookaheadPly).toBe(1)
    expect(compAi.lookaheadPly).toBe(3)
    expect(expertAi.maxBranches).toBe(50)
    expect(expertAi.topKCandidates).toBe(6)

    const costFast = computeConfigComplexityFactor(fastAi)
    const costComp = computeConfigComplexityFactor(compAi)
    const costExpert = computeConfigComplexityFactor(expertAi)

    expect(costFast).toBeLessThan(costComp)
    expect(costComp).toBeLessThan(costExpert)
  })

  it('estimates shorter durations for higher worker counts and fast AI presets', () => {
    const profile = calibrateHardwareProfile(true)
    const slowConfig = {
      iterations: 1000,
      workerCount: 1,
      ...computeAiIntelligence('EXPERT_DEEP'),
    }
    const fastConfig = {
      iterations: 1000,
      workerCount: profile.logicalCores,
      ...computeAiIntelligence('FAST_HEURISTIC'),
    }

    const slowEst = estimateSimulationDurationSeconds(slowConfig, profile)
    const fastEst = estimateSimulationDurationSeconds(fastConfig, profile)
    expect(fastEst.estimatedSeconds).toBeLessThan(slowEst.estimatedSeconds)
    expect(formatEstimatedDuration(0.4)).toBe('< 1 s')
    expect(formatEstimatedDuration(125)).toBe('~2 min 5 s')

    const reco = getRecommendedPresetsForProfile({
      ...profile,
      tier: 'ECO',
    })
    expect(reco.cpu).toBe('BALANCED')
    expect(reco.ai).toBe('FAST_HEURISTIC')
    expect(reco.volume).toBe('FLASH')
    expect(getRecommendedPresetsForProfile({ ...profile, tier: 'PERFORMANCE' }).cpu).toBe('BALANCED')
    expect(getRecommendedPresetsForProfile({ ...profile, tier: 'EXTREME' }).cpu).toBe('BALANCED')
  })
})
