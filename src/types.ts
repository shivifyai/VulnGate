export type Ecosystem = 'npm' | 'PyPI' | 'Go' | 'crates.io' | 'RubyGems' | 'Packagist'

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'

export interface Dependency {
  name: string
  version: string
  ecosystem: Ecosystem
  manifest: string
  dev?: boolean
}

// How the finding compares against what GitHub itself reports.
//   confirmed  – OSV and a Dependabot alert agree
//   unreported – OSV flags it but Dependabot has no open alert
//   stale      – Dependabot has an open alert, but the version we resolved isn't affected
//   detected   – OSV flags it and we couldn't check Dependabot (no token / no access)
export type Verdict = 'confirmed' | 'unreported' | 'stale' | 'detected'

export interface Finding {
  key: string
  id: string
  aliases: string[]
  summary: string
  details: string
  severity: Severity
  score?: number
  dependency: Dependency
  fixedIn?: string
  references: { type: string; url: string }[]
  published?: string
  verdict: Verdict
  alertUrl?: string
  // Chance of exploitation in the next 30 days, from FIRST's EPSS model (0..1)
  epss?: { score: number; percentile: number }
  // Present when CISA lists the CVE as actively exploited in the wild
  kev?: { dateAdded: string; ransomware: boolean }
}

export type StageId = 'repo' | 'manifests' | 'parse' | 'osv' | 'exploits' | 'alerts' | 'gate'

export type StageStatus = 'idle' | 'running' | 'done' | 'failed' | 'skipped'

export interface Stage {
  id: StageId
  title: string
  status: StageStatus
  note?: string
  startedAt?: number
  finishedAt?: number
}

export interface RepoInfo {
  fullName: string
  description: string | null
  defaultBranch: string
  stars: number
  htmlUrl: string
  isPrivate: boolean
}

export interface RunOptions {
  repo: string
  ref?: string
  token?: string
  failOn: Severity
  includeDev: boolean
  failOnExploited: boolean
}

export interface RunResult {
  repo: RepoInfo
  ref: string
  manifests: string[]
  dependencies: Dependency[]
  findings: Finding[]
  dependabotChecked: boolean
  failOn: Severity
  failOnExploited: boolean
  passed: boolean
  finishedAt: string
}
