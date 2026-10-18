import type { Dependency, Ecosystem, Finding, RunOptions, RunResult, Stage, StageId } from '../types'
import { GitHubClient, GitHubError, type DependabotAlert } from './github'
import { dedupe, parseManifest, pickManifests } from './manifests'
import { findVulnerableDeps, fixedVersionFor, getVuln, severityOf } from './osv'
import { mapLimit } from './pool'
import { atLeast, normalizeSeverity, severityRank } from './severity'

export const STAGES: Pick<Stage, 'id' | 'title'>[] = [
  { id: 'repo', title: 'Resolve repository' },
  { id: 'manifests', title: 'Find manifests' },
  { id: 'parse', title: 'Parse dependencies' },
  { id: 'osv', title: 'Query OSV database' },
  { id: 'alerts', title: 'Cross-check Dependabot' },
  { id: 'gate', title: 'Policy gate' },
]

export interface PipelineHooks {
  onStage: (id: StageId, patch: Partial<Stage>) => void
  onLog: (message: string, level?: 'info' | 'warn' | 'error') => void
  signal?: AbortSignal
}

const DEPENDABOT_ECOSYSTEMS: Record<string, Ecosystem> = { npm: 'npm', pip: 'PyPI', go: 'Go' }

export class Cancelled extends Error {}

export async function runPipeline(options: RunOptions, hooks: PipelineHooks): Promise<RunResult> {
  const { onStage, onLog, signal } = hooks
  const gh = new GitHubClient(options.token)

  // Runs one stage, keeps the timing and status in sync with the UI
  async function stage<T>(id: StageId, work: (skip: (note: string) => void) => Promise<T>): Promise<T> {
    if (signal?.aborted) throw new Cancelled('Run cancelled')
    onStage(id, { status: 'running', startedAt: Date.now(), note: undefined })

    let skipped = false
    const skip = (note: string) => {
      skipped = true
      onStage(id, { status: 'skipped', note })
    }

    try {
      const result = await work(skip)
      if (skipped) onStage(id, { finishedAt: Date.now() })
      else onStage(id, { status: 'done', finishedAt: Date.now() })
      return result
    } catch (err) {
      onStage(id, { status: 'failed', finishedAt: Date.now(), note: (err as Error).message })
      throw err
    }
  }

  const repo = await stage('repo', async () => {
    const info = await gh.getRepo(options.repo)
    onLog(`Found ${info.fullName}${info.isPrivate ? ' (private)' : ''}, default branch "${info.defaultBranch}"`)
    return info
  })
  const ref = options.ref?.trim() || repo.defaultBranch

  const manifests = await stage('manifests', async () => {
    const { paths, truncated } = await gh.listFiles(repo.fullName, ref)
    if (truncated) onLog('The repository tree is huge and GitHub truncated it, some manifests may be missed.', 'warn')

    const picked = pickManifests(paths)
    onStage('manifests', { note: `${picked.length} of ${paths.length} files` })
    if (picked.length === 0) onLog('No supported manifests found (package.json, package-lock.json, requirements.txt, go.mod).', 'warn')
    picked.forEach((p) => onLog(`  ${p}`))
    return picked
  })

  const dependencies = await stage('parse', async () => {
    const parsed = await mapLimit(manifests, 4, async (path) => {
      try {
        const content = await gh.readFile(repo.fullName, path, ref)
        const deps = parseManifest(path, content)
        onLog(`${path}: ${deps.length} packages`)
        return deps
      } catch (err) {
        onLog(`Skipped ${path}: ${(err as Error).message}`, 'warn')
        return [] as Dependency[]
      }
    })

    let deps = dedupe(parsed.flat())
    if (!options.includeDev) {
      const before = deps.length
      deps = deps.filter((d) => !d.dev)
      if (before !== deps.length) onLog(`Left out ${before - deps.length} dev-only packages`)
    }
    onStage('parse', { note: `${deps.length} unique packages` })
    return deps
  })

  let findings = await stage('osv', async () => {
    if (dependencies.length === 0) return []

    const hits = await findVulnerableDeps(dependencies, (done, total) =>
      onStage('osv', { note: `${done}/${total} checked` }),
    )

    const pairs = [...hits].flatMap(([index, ids]) => ids.map((id) => ({ id, dep: dependencies[index] })))
    onLog(`${hits.size} packages have known advisories, loading ${pairs.length} records`)

    const results = await mapLimit(pairs, 8, async ({ id, dep }): Promise<Finding> => {
      const vuln = await getVuln(id)
      const { severity, score } = severityOf(vuln)
      return {
        key: `${id}:${dep.ecosystem}:${dep.name}@${dep.version}`,
        id,
        aliases: vuln.aliases ?? [],
        summary: vuln.summary || vuln.details?.split('\n')[0] || 'No summary provided',
        details: vuln.details ?? '',
        severity,
        score,
        dependency: dep,
        fixedIn: fixedVersionFor(vuln, dep),
        references: vuln.references ?? [],
        published: vuln.published,
        verdict: 'detected',
      }
    })

    onStage('osv', { note: `${results.length} findings` })
    return results
  })

  let dependabotChecked = false

  await stage('alerts', async (skip) => {
    if (!gh.hasToken) {
      skip('needs a token')
      onLog('No token given, skipping the Dependabot comparison.')
      return
    }

    let alerts: DependabotAlert[]
    try {
      alerts = await gh.listDependabotAlerts(repo.fullName)
    } catch (err) {
      const reason = err instanceof GitHubError && [403, 404].includes(err.status)
        ? 'token has no access to Dependabot alerts (or they are disabled)'
        : (err as Error).message
      onLog(`Couldn't read Dependabot alerts: ${reason}`, 'warn')
      skip('no access')
      return
    }

    dependabotChecked = true
    const reconciled = reconcile(findings, alerts, dependencies, manifests)
    findings = reconciled.findings

    const confirmed = findings.filter((f) => f.verdict === 'confirmed').length
    const unreported = findings.filter((f) => f.verdict === 'unreported').length
    onLog(`${alerts.length} open Dependabot alerts: ${confirmed} confirmed, ${unreported} not reported by GitHub, ${reconciled.stale} look stale`)
    onStage('alerts', { note: `${alerts.length} alerts` })
  })

  const passed = await stage('gate', async () => {
    const blocking = findings.filter((f) => f.verdict !== 'stale' && atLeast(f.severity, options.failOn))
    if (blocking.length) {
      onLog(`${blocking.length} findings at ${options.failOn} or above, failing the gate`, 'error')
      onStage('gate', { note: `${blocking.length} blocking` })
    } else {
      onLog(`Nothing at ${options.failOn} or above, gate passed`)
      onStage('gate', { note: 'passed' })
    }
    return blocking.length === 0
  })

  findings.sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity) || (b.score ?? 0) - (a.score ?? 0),
  )

  return {
    repo,
    ref,
    manifests,
    dependencies,
    findings,
    dependabotChecked,
    failOn: options.failOn,
    passed,
    finishedAt: new Date().toISOString(),
  }
}

/**
 * Lines our OSV findings up against GitHub's open Dependabot alerts.
 * Matching is by advisory id (GHSA / CVE / aliases) plus package name.
 */
function reconcile(findings: Finding[], alerts: DependabotAlert[], deps: Dependency[], manifests: string[]) {
  const usedAlerts = new Set<number>()

  const idsOf = (alert: DependabotAlert) =>
    new Set(
      [alert.security_advisory.ghsa_id, alert.security_advisory.cve_id, ...alert.security_advisory.identifiers.map((i) => i.value)]
        .filter((id): id is string => Boolean(id))
        .map((id) => id.toUpperCase()),
    )

  const indexed = alerts.map((alert) => ({ alert, ids: idsOf(alert) }))

  const updated = findings.map((finding): Finding => {
    const ours = [finding.id, ...finding.aliases].map((id) => id.toUpperCase())
    const match = indexed.find(
      ({ alert, ids }) =>
        alert.dependency.package.name.toLowerCase() === finding.dependency.name.toLowerCase() &&
        ours.some((id) => ids.has(id)),
    )
    if (!match) return { ...finding, verdict: 'unreported' }
    usedAlerts.add(match.alert.number)
    return { ...finding, verdict: 'confirmed', alertUrl: match.alert.html_url }
  })

  // Alerts nobody matched. If we parsed that manifest and the package is there,
  // the version we resolved isn't affected, so the alert is probably out of date.
  const stale: Finding[] = []
  for (const { alert } of indexed) {
    if (usedAlerts.has(alert.number)) continue
    const ecosystem = DEPENDABOT_ECOSYSTEMS[alert.dependency.package.ecosystem]
    if (!ecosystem || !manifests.includes(alert.dependency.manifest_path)) continue

    const name = alert.dependency.package.name
    const installed = deps.find((d) => d.ecosystem === ecosystem && d.name.toLowerCase() === name.toLowerCase())
    if (!installed) continue

    const advisory = alert.security_advisory
    stale.push({
      key: `alert-${alert.number}`,
      id: advisory.ghsa_id,
      aliases: advisory.cve_id ? [advisory.cve_id] : [],
      summary: advisory.summary,
      details: '',
      severity: normalizeSeverity(advisory.severity) ?? 'UNKNOWN',
      dependency: installed,
      references: [],
      verdict: 'stale',
      alertUrl: alert.html_url,
    })
  }

  return { findings: [...updated, ...stale], stale: stale.length }
}
