import { VERDICT_LABELS } from '../lib/verdicts'
import type { Severity, Verdict } from '../types'

export function SeverityBadge({ severity, score }: { severity: Severity; score?: number }) {
  return (
    <span className={`severity sev-${severity.toLowerCase()}`}>
      {severity === 'UNKNOWN' ? 'Unknown' : severity.charAt(0) + severity.slice(1).toLowerCase()}
      {score !== undefined && <b>{score.toFixed(1)}</b>}
    </span>
  )
}

export function VerdictPill({ verdict }: { verdict: Verdict }) {
  const { label, hint } = VERDICT_LABELS[verdict]
  return (
    <span className={`verdict verdict-${verdict}`} title={hint}>
      {label}
    </span>
  )
}
