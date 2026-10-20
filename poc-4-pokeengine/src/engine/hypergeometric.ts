import type { HypergeometricComparison } from '@/types/engine'

/**
 * Exact Binomial Coefficient C(n, k) = n! / (k! * (n - k)!)
 * Computed iteratively using multiplicative formula to prevent factorial overflow.
 */
export function binomialCoefficient(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  if (k === 0 || k === n) return 1
  const symK = Math.min(k, n - k)
  let result = 1
  for (let i = 1; i <= symK; i++) {
    result = (result * (n - symK + i)) / i
  }
  return result
}

/**
 * Exact Hypergeometric Probability Mass Function P(X = k):
 * Probability of drawing exactly `k` successes in `n` draws without replacement
 * from a finite population of size `N` containing `K` successes.
 *
 * P(X = k) = [ C(K, k) * C(N - K, n - k) ] / C(N, n)
 */
export function hypergeometricPMF(N: number, K: number, n: number, k: number): number {
  const waysSuccess = binomialCoefficient(K, k)
  const waysFailure = binomialCoefficient(N - K, n - k)
  const totalWays = binomialCoefficient(N, n)
  if (totalWays === 0) return 0
  return (waysSuccess * waysFailure) / totalWays
}

/**
 * Exact Probability of drawing 0 target cards in `n` cards: P(X = 0)
 * Used for exact theoretical Mulligan probability in an opening hand of 7 cards.
 */
export function exactProbabilityZeroSuccesses(N: number, K: number, n = 7): number {
  return hypergeometricPMF(N, K, n, 0)
}

/**
 * Exact Probability of drawing at least 1 target card in `n` cards: P(X >= 1) = 1 - P(X = 0)
 * Used for exact theoretical probability of opening at least 1 Poffin Pote-Pote in 7 cards.
 */
export function exactProbabilityAtLeastOne(N: number, K: number, n = 7): number {
  return 1 - hypergeometricPMF(N, K, n, 0)
}

/**
 * Builds the audit comparison object comparing Exact Hypergeometric Theory vs Observed Monte-Carlo
 */
export function buildHypergeometricAudit(params: {
  metricName: string
  formulaLabel: string
  populationN: number
  successesK: number
  sampleSizeN: number
  exactProbability: number
  observedProbability: number
  iterations: number
}): HypergeometricComparison {
  const exactTheoreticalPct = Number((params.exactProbability * 100).toFixed(2))
  const observedMonteCarloPct = Number((params.observedProbability * 100).toFixed(2))
  const deltaAbsolutePct = Number(Math.abs(exactTheoreticalPct - observedMonteCarloPct).toFixed(2))

  // Convergence threshold scales naturally with sample size (strict < 0.8% for N >= 10,000, < 2.5% for N = 1,000, < 8% for N = 100)
  const threshold = params.iterations >= 10000 ? 0.8 : params.iterations >= 1000 ? 2.5 : 8.0

  return {
    metricName: params.metricName,
    formulaLabel: params.formulaLabel,
    populationN: params.populationN,
    successesK: params.successesK,
    sampleSizeN: params.sampleSizeN,
    exactTheoreticalPct,
    observedMonteCarloPct,
    deltaAbsolutePct,
    converged: deltaAbsolutePct <= threshold,
  }
}
