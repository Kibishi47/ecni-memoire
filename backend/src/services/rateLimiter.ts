export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export interface RateLimiterOptions {
  maxRequests: number
  windowMs?: number
  now?: () => number
}

/**
 * In-memory sliding-window rate limiter keyed by client IP.
 */
export class InMemoryRateLimiter {
  private readonly maxRequests: number
  private readonly windowMs: number
  private readonly now: () => number
  private readonly hits = new Map<string, number[]>()

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests
    this.windowMs = options.windowMs ?? 60 * 60 * 1000
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Attempts to consume one request slot for the given client key (e.g. IP address).
   */
  consume(key: string): RateLimitResult {
    const currentTime = this.now()
    const cutoff = currentTime - this.windowMs

    const existing = this.hits.get(key) ?? []
    const active = existing.filter((ts) => ts > cutoff)

    if (active.length >= this.maxRequests) {
      const oldest = active[0]!
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - currentTime) / 1000))
      this.hits.set(key, active)
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      }
    }

    active.push(currentTime)
    this.hits.set(key, active)

    if (this.hits.size > 1000) {
      this.pruneExpired(cutoff)
    }

    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - active.length),
      retryAfterSeconds: 0,
    }
  }

  /**
   * Clears all tracked entries (useful in tests).
   */
  reset(): void {
    this.hits.clear()
  }

  private pruneExpired(cutoff: number): void {
    for (const [key, timestamps] of this.hits.entries()) {
      const active = timestamps.filter((ts) => ts > cutoff)
      if (active.length === 0) {
        this.hits.delete(key)
      } else {
        this.hits.set(key, active)
      }
    }
  }
}
