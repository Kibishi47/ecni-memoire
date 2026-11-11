import { describe, expect, it, vi } from 'vitest'
import {
  buildIssueBody,
  buildIssueLabels,
  buildIssueTitle,
  GitHubService,
  hasValidGitHubConfig,
} from '../src/services/githubService.js'

describe('githubService', () => {
  it('treats missing or example placeholder credentials as unconfigured', () => {
    expect(hasValidGitHubConfig({})).toBe(false)
    expect(
      hasValidGitHubConfig({
        token: 'ghp_xxxxxxxxxxxx',
        owner: 'ton_compte_ou_orga',
        repo: 'ton_depot',
      }),
    ).toBe(false)
    expect(
      hasValidGitHubConfig({
        token: 'ghp_realTokenValue',
        owner: 'my-org',
        repo: 'my-repo',
      }),
    ).toBe(true)
  })

  it('generates expected titles, labels, and markdown body for CARD_MODEL_ERROR', async () => {
    const input = {
      reportId: 42,
      type: 'CARD_MODEL_ERROR' as const,
      cardId: 'sv06-130',
      cardNameFr: 'Lanssorien-ex',
      cardInCatalog: true,
      matchLogs: { seed: 12345, turn: 3 },
      userComment: 'Plongée Fantôme devrait placer 6 marqueurs de dégâts.',
    }

    expect(buildIssueTitle(input)).toBe('[Card Model] Erreur sur la carte sv06-130')
    expect(buildIssueLabels(input.type)).toEqual([
      'source:user-report',
      'triage-needed',
      'bug:card-model',
    ])

    const body = buildIssueBody(input, { owner: 'my-org', repo: 'my-repo' })
    expect(body).toContain('Plongée Fantôme devrait placer 6 marqueurs de dégâts.')
    expect(body).toContain('sv06-130')
    expect(body).toContain('/api/cards/sv06-130')
    expect(body).toContain('<details>')
    expect(body).toContain('<summary>Logs du match</summary>')
    expect(body).toContain('"seed": 12345')

    const createMock = vi.fn().mockResolvedValue({
      data: {
        html_url: 'https://github.com/my-org/my-repo/issues/99',
        number: 99,
      },
    })

    const service = new GitHubService(
      { token: 'ghp_valid123', owner: 'my-org', repo: 'my-repo' },
      { issues: { create: createMock } },
    )

    const created = await service.createBugReportIssue(input)
    expect(created).toEqual({
      issueUrl: 'https://github.com/my-org/my-repo/issues/99',
      issueNumber: 99,
    })
    expect(createMock).toHaveBeenCalledWith({
      owner: 'my-org',
      repo: 'my-repo',
      title: '[Card Model] Erreur sur la carte sv06-130',
      labels: ['source:user-report', 'triage-needed', 'bug:card-model'],
      body,
    })
  })

  it('generates expected title and labels for ENGINE_RULE_ERROR', () => {
    expect(
      buildIssueTitle({ type: 'ENGINE_RULE_ERROR', cardId: null }),
    ).toBe('[Engine Rule] Incohérence de règles signalée')

    expect(buildIssueLabels('ENGINE_RULE_ERROR')).toEqual([
      'source:user-report',
      'triage-needed',
      'bug:engine',
    ])
  })
})
