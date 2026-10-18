import type { Dependency, Severity } from '../types'
import { cvss3Score, fromScore, normalizeSeverity } from './severity'
import { compareVersions } from './version'

const OSV = 'https://api.osv.dev/v1'
const BATCH_SIZE = 500

export interface OsvVuln {
  id: string
  aliases?: string[]
  summary?: string
  details?: string
  published?: string
  severity?: { type: string; score: string }[]
  database_specific?: { severity?: string }
  references?: { type: string; url: string }[]
  affected?: {
    package?: { name: string; ecosystem: string }
    ranges?: {
      type: string
      events: { introduced?: string; fixed?: string; last_affected?: string; limit?: string }[]
    }[]
    ecosystem_specific?: { severity?: string }
  }[]
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`OSV responded with ${res.status}`)
  return res.json()
}

/**
 * Asks OSV which of the dependencies have known vulnerabilities.
 * The batch endpoint only hands back ids, so the result is a map of
 * dependency index -> vulnerability ids.
 */
export async function findVulnerableDeps(
  deps: Dependency[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<number, string[]>> {
  const hits = new Map<number, string[]>()

  for (let start = 0; start < deps.length; start += BATCH_SIZE) {
    const chunk = deps.slice(start, start + BATCH_SIZE)
    const queries = chunk.map((dep) => ({
      package: { name: dep.name, ecosystem: dep.ecosystem },
      version: dep.version,
    }))

    const { results } = await postJson<{ results: { vulns?: { id: string }[] }[] }>(
      `${OSV}/querybatch`,
      { queries },
    )

    results.forEach((result, i) => {
      if (result.vulns?.length) hits.set(start + i, result.vulns.map((v) => v.id))
    })
    onProgress?.(Math.min(start + BATCH_SIZE, deps.length), deps.length)
  }

  return hits
}

const cache = new Map<string, Promise<OsvVuln>>()

export function getVuln(id: string): Promise<OsvVuln> {
  let pending = cache.get(id)
  if (!pending) {
    pending = fetch(`${OSV}/vulns/${encodeURIComponent(id)}`).then((res) => {
      if (!res.ok) throw new Error(`Couldn't load ${id} (${res.status})`)
      return res.json()
    })
    pending.catch(() => cache.delete(id))
    cache.set(id, pending)
  }
  return pending
}

export function severityOf(vuln: OsvVuln): { severity: Severity; score?: number } {
  const vector = vuln.severity?.find((s) => s.type === 'CVSS_V3')?.score
  const score = vector ? cvss3Score(vector) ?? undefined : undefined

  const label =
    normalizeSeverity(vuln.database_specific?.severity) ??
    vuln.affected?.map((a) => normalizeSeverity(a.ecosystem_specific?.severity)).find(Boolean)

  if (label) return { severity: label, score }
  if (score !== undefined) return { severity: fromScore(score), score }
  return { severity: 'UNKNOWN' }
}

/** Smallest "fixed" version that is newer than what we have installed. */
export function fixedVersionFor(vuln: OsvVuln, dep: Dependency): string | undefined {
  const fixes: string[] = []

  for (const affected of vuln.affected ?? []) {
    if (affected.package?.name.toLowerCase() !== dep.name.toLowerCase()) continue
    for (const range of affected.ranges ?? []) {
      if (range.type === 'GIT') continue
      for (const event of range.events) {
        if (event.fixed) fixes.push(event.fixed.replace(/^v/, ''))
      }
    }
  }

  return fixes
    .filter((v) => compareVersions(v, dep.version) > 0)
    .sort(compareVersions)[0]
}
