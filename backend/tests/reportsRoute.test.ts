import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { buildServer } from '../src/server.js'
import type { GitHubIssueCreator } from '../src/services/githubService.js'
import { InMemoryRateLimiter } from '../src/services/rateLimiter.js'

function createMockPool() {
  const queries: Array<{ sql: string; params?: unknown[] }> = []

  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params })
      if (sql.includes('SELECT 1')) {
        return { rows: [{ '?column?': 1 }] }
      }
      if (sql.includes('SELECT card_id, name_fr FROM cards')) {
        const cardId = params?.[0]
        if (cardId === 'sv06-130') {
          return { rows: [{ card_id: 'sv06-130', name_fr: 'Lanssorien-ex' }] }
        }
        return { rows: [] }
      }
      if (sql.includes('INSERT INTO bug_reports')) {
        return { rows: [{ id: 101 }] }
      }
      if (sql.includes('UPDATE bug_reports')) {
        return { rows: [] }
      }
      return { rows: [] }
    }),
  } as unknown as Pool

  return { pool, queries }
}

describe('POST /api/reports', () => {
  it('rejects CARD_MODEL_ERROR without cardId', async () => {
    const { pool } = createMockPool()
    const app = await buildServer({ pool, logger: false })

    const res = await app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        type: 'CARD_MODEL_ERROR',
        userComment: 'Manque cardId',
      },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejects ENGINE_RULE_ERROR without valid matchLogs JSON object', async () => {
    const { pool } = createMockPool()
    const app = await buildServer({ pool, logger: false })

    const resMissing = await app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        type: 'ENGINE_RULE_ERROR',
        userComment: 'Bug règle',
      },
    })
    expect(resMissing.statusCode).toBe(400)

    const resArray = await app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        type: 'ENGINE_RULE_ERROR',
        matchLogs: ['invalid'],
      },
    })
    expect(resArray.statusCode).toBe(400)

    await app.close()
  })

  it('rejects userComment longer than 1000 characters', async () => {
    const { pool } = createMockPool()
    const app = await buildServer({ pool, logger: false })

    const res = await app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        type: 'CARD_MODEL_ERROR',
        cardId: 'sv06-130',
        userComment: 'a'.repeat(1001),
      },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('inserts bug report in DB, creates GitHub issue when configured, and updates DB', async () => {
    const { pool, queries } = createMockPool()
    const githubMock: GitHubIssueCreator = {
      isConfigured: () => true,
      createBugReportIssue: vi.fn().mockResolvedValue({
        issueUrl: 'https://github.com/org/repo/issues/7',
        issueNumber: 7,
      }),
    }

    const app = await buildServer({
      pool,
      logger: false,
      githubService: githubMock,
      reportRateLimiter: new InMemoryRateLimiter({ maxRequests: 5 }),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        type: 'CARD_MODEL_ERROR',
        cardId: 'sv06-130',
        userComment: 'Dégâts banc incorrects',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({
      success: true,
      reportId: 101,
      issueUrl: 'https://github.com/org/repo/issues/7',
    })

    expect(githubMock.createBugReportIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: 101,
        type: 'CARD_MODEL_ERROR',
        cardId: 'sv06-130',
        cardNameFr: 'Lanssorien-ex',
      }),
    )

    const updateQuery = queries.find((q) => q.sql.includes('UPDATE bug_reports'))
    expect(updateQuery?.params).toEqual(['https://github.com/org/repo/issues/7', 7, 101])

    await app.close()
  })

  it('enforces 5 reports per hour rate limit per IP', async () => {
    const { pool } = createMockPool()
    const app = await buildServer({
      pool,
      logger: false,
      githubService: { isConfigured: () => false, createBugReportIssue: vi.fn() },
      reportRateLimiter: new InMemoryRateLimiter({ maxRequests: 5 }),
    })

    for (let i = 0; i < 5; i++) {
      const okRes = await app.inject({
        method: 'POST',
        url: '/api/reports',
        remoteAddress: '203.0.113.42',
        payload: {
          type: 'ENGINE_RULE_ERROR',
          matchLogs: { seed: i },
        },
      })
      expect(okRes.statusCode).toBe(201)
    }

    const blockedRes = await app.inject({
      method: 'POST',
      url: '/api/reports',
      remoteAddress: '203.0.113.42',
      payload: {
        type: 'ENGINE_RULE_ERROR',
        matchLogs: { seed: 99 },
      },
    })

    expect(blockedRes.statusCode).toBe(429)
    expect(blockedRes.headers['retry-after']).toBeDefined()

    await app.close()
  })

  it('keeps DB report even if GitHub issue creation fails', async () => {
    const { pool } = createMockPool()
    const githubMock: GitHubIssueCreator = {
      isConfigured: () => true,
      createBugReportIssue: vi.fn().mockRejectedValue(new Error('GitHub 502')),
    }

    const app = await buildServer({
      pool,
      logger: false,
      githubService: githubMock,
      reportRateLimiter: new InMemoryRateLimiter({ maxRequests: 5 }),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/reports',
      payload: {
        type: 'ENGINE_RULE_ERROR',
        matchLogs: { seed: 42, turn: 2 },
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({
      success: true,
      reportId: 101,
      issueUrl: null,
    })

    await app.close()
  })
})
