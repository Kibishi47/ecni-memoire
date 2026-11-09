/**
 * Générateur Pseudo-Aléatoire Déterministe Mulberry32 (`src/core/prng.ts`).
 * Repris de `poc-4-pokeengine` : garantit une reproductibilité bit-à-bit à 100 % pour une `seed` donnée.
 */
export class Mulberry32 {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
    if (this.state === 0) {
      this.state = 0x9e3779b9
    }
  }

  public nextUint32(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }

  public nextFloat(): number {
    return this.nextUint32() / 4294967296
  }

  public nextInt(maxExclusive: number): number {
    if (maxExclusive <= 1) return 0
    return Math.floor(this.nextFloat() * maxExclusive)
  }

  public reseed(seed: number): void {
    this.state = seed >>> 0
    if (this.state === 0) {
      this.state = 0x9e3779b9
    }
  }

  public getState(): number {
    return this.state
  }

  public setState(rawState: number): void {
    this.state = rawState >>> 0
    if (this.state === 0) {
      this.state = 0x9e3779b9
    }
  }

  public clone(): Mulberry32 {
    const copy = new Mulberry32(1)
    copy.state = this.state
    return copy
  }
}

/**
 * Dérive une sous-graine déterministe par partie à partir de la graine maîtresse et de l'index de partie (0..N-1).
 */
export function deriveGameSeed(masterSeed: number, gameIndex: number): number {
  let z = ((masterSeed >>> 0) + Math.imul(gameIndex + 1, 0x9e3779b9)) >>> 0
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
  return (z ^ (z >>> 16)) >>> 0
}

/**
 * Mélange de Fisher-Yates déterministe en place sur n'importe quel tableau.
 */
export function fisherYatesShuffle<T>(items: T[], rng: Mulberry32): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1)
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
}
