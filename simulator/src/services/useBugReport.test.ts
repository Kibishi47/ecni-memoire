import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBugReport } from './useBugReport'
import { setLanguage } from '../utils/i18n'

describe('useBugReport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    setLanguage('fr')
  })

  it('submits report successfully, stores result and clears comment', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          reportId: 19,
          issueUrl: 'https://github.com/org/repo/issues/19',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const report = useBugReport()
    report.togglePanel()
    expect(report.isPanelOpen.value).toBe(true)

    report.comment.value = 'Super Bonbon devrait évoluer en Stage 2'
    const res = await report.submit({
      type: 'CARD_MODEL_ERROR',
      cardId: 'sv04-125',
      matchLogs: null,
    })

    expect(res?.reportId).toBe(19)
    expect(report.successResult.value?.issueUrl).toBe('https://github.com/org/repo/issues/19')
    expect(report.error.value).toBeNull()
    expect(report.comment.value).toBe('')
  })

  it('formats 429 rate limit error cleanly and resets state on reset()', async () => {
    setLanguage('en')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'Too Many Requests',
          message: 'Too many requests',
          retryAfterSeconds: 45,
        }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '45' } },
      ),
    )

    const report = useBugReport()
    report.togglePanel()
    report.comment.value = 'Rule bug'

    const res = await report.submit({
      type: 'ENGINE_RULE_ERROR',
      cardId: null,
      matchLogs: { seed: 777 },
    })

    expect(res).toBeNull()
    expect(report.error.value).toContain('45s')

    report.reset()
    expect(report.isPanelOpen.value).toBe(false)
    expect(report.error.value).toBeNull()
    expect(report.comment.value).toBe('')
  })
})
