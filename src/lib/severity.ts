import type { Severity } from '../types'

export const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']

export function severityRank(severity: Severity) {
  return SEVERITY_ORDER.length - SEVERITY_ORDER.indexOf(severity)
}

export function atLeast(severity: Severity, threshold: Severity) {
  if (severity === 'UNKNOWN') return false
  return severityRank(severity) >= severityRank(threshold)
}

export function normalizeSeverity(label: string | undefined | null): Severity | null {
  if (!label) return null
  const upper = label.toUpperCase()
  if (upper === 'MODERATE') return 'MEDIUM'
  if (upper === 'CRITICAL' || upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW') return upper
  return null
}

export function fromScore(score: number): Severity {
  if (score >= 9) return 'CRITICAL'
  if (score >= 7) return 'HIGH'
  if (score >= 4) return 'MEDIUM'
  if (score > 0) return 'LOW'
  return 'UNKNOWN'
}

const WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
} as const

function roundUp(value: number) {
  // CVSS 3.1 spec rounding, avoids float noise like 4.000000001 -> 4.1
  const int = Math.round(value * 100000)
  return int % 10000 === 0 ? int / 100000 : (Math.floor(int / 10000) + 1) / 10
}

/** Base score for a CVSS 3.x vector string. Returns null for anything else (v2, v4, garbage). */
export function cvss3Score(vector: string): number | null {
  if (!vector.startsWith('CVSS:3')) return null

  const m = Object.fromEntries(
    vector.split('/').slice(1).map((part) => part.split(':') as [string, string]),
  )

  const av = WEIGHTS.AV[m.AV as keyof typeof WEIGHTS.AV]
  const ac = WEIGHTS.AC[m.AC as keyof typeof WEIGHTS.AC]
  const ui = WEIGHTS.UI[m.UI as keyof typeof WEIGHTS.UI]
  const c = WEIGHTS.CIA[m.C as keyof typeof WEIGHTS.CIA]
  const i = WEIGHTS.CIA[m.I as keyof typeof WEIGHTS.CIA]
  const a = WEIGHTS.CIA[m.A as keyof typeof WEIGHTS.CIA]
  const changed = m.S === 'C'

  const pr = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR as 'N' | 'L' | 'H']

  if ([av, ac, ui, c, i, a, pr].some((v) => v === undefined)) return null

  const iss = 1 - (1 - c) * (1 - i) * (1 - a)
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss
  const exploitability = 8.22 * av * ac * pr * ui

  if (impact <= 0) return 0
  const raw = changed ? 1.08 * (impact + exploitability) : impact + exploitability
  return roundUp(Math.min(raw, 10))
}
