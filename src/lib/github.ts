import type { RepoInfo } from '../types'

const API = 'https://api.github.com'

export class GitHubError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class GitHubClient {
  private token?: string

  constructor(token?: string) {
    this.token = token?.trim() || undefined
  }

  get hasToken() {
    return Boolean(this.token)
  }

  private async request(path: string, accept = 'application/vnd.github+json') {
    const headers: Record<string, string> = {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`

    const res = await fetch(`${API}${path}`, { headers })

    if (!res.ok) {
      let message = res.statusText
      try {
        const body = await res.json()
        if (body?.message) message = body.message
      } catch {
        // body wasn't JSON, the status text will have to do
      }
      if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        message = 'GitHub rate limit reached. Add a token to get a higher limit.'
      }
      throw new GitHubError(res.status, message)
    }
    return res
  }

  async getRepo(fullName: string): Promise<RepoInfo> {
    const data = await (await this.request(`/repos/${fullName}`)).json()
    return {
      fullName: data.full_name,
      description: data.description,
      defaultBranch: data.default_branch,
      stars: data.stargazers_count,
      htmlUrl: data.html_url,
      isPrivate: data.private,
    }
  }

  async listFiles(fullName: string, ref: string): Promise<{ paths: string[]; truncated: boolean }> {
    const res = await this.request(`/repos/${fullName}/git/trees/${encodeURIComponent(ref)}?recursive=1`)
    const data = await res.json()
    const paths = (data.tree as { path: string; type: string }[])
      .filter((entry) => entry.type === 'blob')
      .map((entry) => entry.path)
    return { paths, truncated: Boolean(data.truncated) }
  }

  async readFile(fullName: string, path: string, ref: string): Promise<string> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    const res = await this.request(
      `/repos/${fullName}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
      'application/vnd.github.raw+json',
    )
    return res.text()
  }

  // Needs a token with "security_events" (classic) or Dependabot alerts read access (fine-grained).
  async listDependabotAlerts(fullName: string) {
    const alerts: DependabotAlert[] = []
    let page = 1

    while (page <= 10) {
      const res = await this.request(`/repos/${fullName}/dependabot/alerts?state=open&per_page=100&page=${page}`)
      const batch = (await res.json()) as DependabotAlert[]
      alerts.push(...batch)
      if (batch.length < 100) break
      page++
    }
    return alerts
  }
}

export interface DependabotAlert {
  number: number
  html_url: string
  dependency: {
    package: { ecosystem: string; name: string }
    manifest_path: string
  }
  security_advisory: {
    ghsa_id: string
    cve_id: string | null
    summary: string
    severity: string
    identifiers: { type: string; value: string }[]
  }
}

// Accepts "owner/repo", a github.com URL, or a URL ending in .git
export function parseRepoInput(input: string): string | null {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\/+$/, '')

  const [owner, rawRepo] = cleaned.split('/')
  const repo = rawRepo?.replace(/\.git$/, '')
  if (!owner || !repo) return null
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null
  return `${owner}/${repo}`
}
