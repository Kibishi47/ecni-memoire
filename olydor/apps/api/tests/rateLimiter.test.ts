import { describe, expect, it } from 'vitest'
import { InMemoryRateLimiter } from '../src/services/rateLimiter.js'

describe('InMemoryRateLimiter', () => {
  it('allows up to maxRequests within 1 hour and blocks subsequent requests', () => {
    let fakeNow = 1_000_000
    const limiter = new InMemoryRateLimiter({
      maxRequests: 5,
      windowMs: 60 * 60 * 1000,
      now: () => fakeNow,
    })

    for (let i = 0; i < 5; i++) {
      const res = limiter.consume('192.168.1.10')
      expect(res.allowed).toBe(true)
      expect(res.remaining).toBe(4 - i)
    }

    const blocked = limiter.consume('192.168.1.10')
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfterSeconds).toBe(3600)

    // Different IP stays unaffected
    expect(limiter.consume('10.0.0.2').allowed).toBe(true)

    // After 1 hour + 1 ms, window resets
    fakeNow += 60 * 60 * 1000 + 1
    expect(limiter.consume('192.168.1.10').allowed).toBe(true)
  })
})
