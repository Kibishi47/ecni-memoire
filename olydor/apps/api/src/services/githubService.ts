import { Octokit } from '@octokit/rest'
import { env } from '../config/env.js'

export type BugReportType = 'CARD_MODEL_ERROR' | 'ENGINE_RULE_ERROR'

export interface BugReportIssueInput {
  reportId: number
  type: BugReportType
  cardId: string | null
  cardNameFr?: string | null
  cardInCatalog?: boolean
  matchLogs: Record<string, unknown> | null
  userComment: string | null
}

export interface CreatedGitHubIssue {
  issueUrl: string
  issueNumber: number
}

export interface GitHubConfig {
  token?: string
  owner?: string
  repo?: string
}

export interface GitHubIssueCreator {
  isConfigured(): boolean
  createBugReportIssue(input: BugReportIssueInput): Promise<CreatedGitHubIssue | null>
}

const PLACEHOLDER_VALUES = new Set([
  'ghp_xxxxxxxxxxxx',
  'ton_compte_ou_orga',
  'ton_depot',
])

const MAX_LOGS_CHARS = 45_000

/**
 * Checks whether GitHub credentials are configured and non-placeholder.
 */
export function hasValidGitHubConfig(config: GitHubConfig): config is Required<GitHubConfig> {
  if (!config.token || !config.owner || !config.repo) return false
  if (
    PLACEHOLDER_VALUES.has(config.token) ||
    PLACEHOLDER_VALUES.has(config.owner) ||
    PLACEHOLDER_VALUES.has(config.repo)
  ) {
    return false
  }
  return true
}

/**
 * Builds the GitHub Issue title according to the report type.
 */
export function buildIssueTitle(input: Pick<BugReportIssueInput, 'type' | 'cardId'>): string {
  if (input.type === 'CARD_MODEL_ERROR') {
    return `[Card Model] Erreur sur la carte ${input.cardId}`
  }
  return '[Engine Rule] Incohérence de règles signalée'
}

/**
 * Builds automatic GitHub Issue labels according to the report type.
 */
export function buildIssueLabels(type: BugReportType): string[] {
  const baseLabels = ['source:user-report', 'triage-needed']
  if (type === 'CARD_MODEL_ERROR') {
    return [...baseLabels, 'bug:card-model']
  }
  return [...baseLabels, 'bug:engine']
}

function formatBlockquote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')
}

function formatMatchLogsSection(matchLogs: Record<string, unknown> | null): string {
  if (!matchLogs) {
    return [
      '<details>',
      '<summary>Logs du match</summary>',
      '',
      '_Aucun log de match fourni._',
      '',
      '</details>',
    ].join('\n')
  }

  let serialized = JSON.stringify(matchLogs, null, 2)
  if (serialized.length > MAX_LOGS_CHARS) {
    serialized = `${serialized.slice(0, MAX_LOGS_CHARS)}\n... [tronqué à ${MAX_LOGS_CHARS} caractères]`
  }

  return [
    '<details>',
    '<summary>Logs du match</summary>',
    '',
    '```json',
    serialized,
    '```',
    '',
    '</details>',
  ].join('\n')
}

/**
 * Builds a structured Markdown GitHub Issue body for a bug report.
 */
export function buildIssueBody(
  input: BugReportIssueInput,
  repoMeta?: { owner?: string; repo?: string },
): string {
  const sections: string[] = [
    `## Signalement #${input.reportId} (\`${input.type}\`)`,
    '',
    '### Commentaire du joueur',
    input.userComment
      ? formatBlockquote(input.userComment)
      : '_Aucun commentaire fourni par le joueur._',
  ]

  if (input.cardId) {
    const apiEndpoint = `/api/cards/${encodeURIComponent(input.cardId)}`
    const tcgdexUrl = `https://api.tcgdex.net/v2/fr/cards/${encodeURIComponent(input.cardId)}`
    const repoCompiledUrl =
      repoMeta?.owner && repoMeta?.repo
        ? `https://github.com/${repoMeta.owner}/${repoMeta.repo}/blob/main/card-compiler/data/compiled_cards/${encodeURIComponent(input.cardId)}.json`
        : null

    const cardLines = [
      '',
      '### Carte concernée',
      `- **cardId :** \`${input.cardId}\`${input.cardNameFr ? ` (${input.cardNameFr})` : ''}`,
      `- **Endpoint API :** \`GET ${apiEndpoint}\``,
      `- **Données TCGdex :** ${tcgdexUrl}`,
    ]
    if (repoCompiledUrl) {
      cardLines.push(`- **Modèle compilé (dépôt) :** ${repoCompiledUrl}`)
    }
    if (input.cardInCatalog === false) {
      cardLines.push('- **Statut catalogue :** Carte absente de la table `cards` lors du signalement')
    }

    sections.push(...cardLines)
  }

  sections.push('', '### Replay / Logs', formatMatchLogsSection(input.matchLogs))

  return sections.join('\n')
}

export interface OctokitLike {
  issues: {
    create(params: {
      owner: string
      repo: string
      title: string
      body: string
      labels: string[]
    }): Promise<{ data: { html_url: string; number: number } }>
  }
}

/**
 * Service encapsulating GitHub issue creation for user bug reports.
 */
export class GitHubService implements GitHubIssueCreator {
  private readonly config: GitHubConfig
  private readonly octokit: OctokitLike | null

  constructor(
    config: GitHubConfig = {
      token: env.GITHUB_TOKEN,
      owner: env.GITHUB_REPO_OWNER,
      repo: env.GITHUB_REPO_NAME,
    },
    octokitOverride?: OctokitLike,
  ) {
    this.config = config
    if (octokitOverride) {
      this.octokit = octokitOverride
    } else if (hasValidGitHubConfig(config)) {
      this.octokit = new Octokit({ auth: config.token })
    } else {
      this.octokit = null
    }
  }

  isConfigured(): boolean {
    return this.octokit !== null && hasValidGitHubConfig(this.config)
  }

  async createBugReportIssue(input: BugReportIssueInput): Promise<CreatedGitHubIssue | null> {
    if (!this.octokit || !hasValidGitHubConfig(this.config)) {
      return null
    }

    const title = buildIssueTitle(input)
    const labels = buildIssueLabels(input.type)
    const body = buildIssueBody(input, {
      owner: this.config.owner,
      repo: this.config.repo,
    })

    const response = await this.octokit.issues.create({
      owner: this.config.owner,
      repo: this.config.repo,
      title,
      body,
      labels,
    })

    return {
      issueUrl: response.data.html_url,
      issueNumber: response.data.number,
    }
  }
}
