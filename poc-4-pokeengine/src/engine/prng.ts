/**
 * Mulberry32 Deterministic Pseudo-Random Number Generator
 * Guarantees 100% bit-exact reproducibility for a given 32-bit integer seed.
 */
export class Mulberry32 {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
    if (this.state === 0) {
      this.state = 0x9e3779b9
    }
  }

  /**
   * Returns an unsigned 32-bit pseudo-random integer in [0, 2^32 - 1]
   */
  public nextUint32(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }

  /**
   * Returns a float in [0, 1)
   */
  public nextFloat(): number {
    return this.nextUint32() / 4294967296
  }

  /**
   * Returns an unbiased integer in [0, maxExclusive - 1]
   */
  public nextInt(maxExclusive: number): number {
    if (maxExclusive <= 1) return 0
    return Math.floor(this.nextFloat() * maxExclusive)
  }

  /**
   * Clones the PRNG at its exact current internal state
   */
  public clone(): Mulberry32 {
    const copy = new Mulberry32(1)
    copy.state = this.state
    return copy
  }
}

/**
 * Derives a deterministic per-game seed from the user's master seed and game index (0..N-1).
 * Uses SplitMix32-style mixing so adjacent game indices have uncorrelated state trajectories.
 */
export function deriveGameSeed(masterSeed: number, gameIndex: number): number {
  let z = ((masterSeed >>> 0) + Math.imul(gameIndex + 1, 0x9e3779b9)) >>> 0
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
  return (z ^ (z >>> 16)) >>> 0
}

/**
 * Performs an in-place Fisher-Yates shuffle on `buffer[0 .. length - 1]`.
 * Zero heap allocation, O(length) time complexity.
 */
export function fisherYatesShuffleUint16(
  buffer: Uint16Array,
  length: number,
  rng: Mulberry32,
): void {
  for (let i = length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1)
    const tmp = buffer[i]
    buffer[i] = buffer[j]
    buffer[j] = tmp
  }
}
