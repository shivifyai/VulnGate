import { formatEpss } from '../lib/format'
import { VERDICT_LABELS } from '../lib/verdicts'
import type { Ecosystem, Finding, Severity, Verdict } from '../types'

export function SeverityBadge({ severity, score }: { severity: Severity; score?: number }) {
  return (
    <span className={`severity sev-${severity.toLowerCase()}`}>
      {severity === 'UNKNOWN' ? 'Unknown' : severity.charAt(0) + severity.slice(1).toLowerCase()}
      {score !== undefined && <b>{score.toFixed(1)}</b>}
    </span>
  )
}

export function EcosystemTag({ ecosystem }: { ecosystem: Ecosystem }) {
  return <span className={`eco eco-${ecosystem.toLowerCase().replace(/\W/g, '')}`}>{ecosystem}</span>
}

/** KEV flag and EPSS bar, or a dash when we know nothing about exploitation. */
export function ExploitRisk({ finding }: { finding: Finding }) {
  const { kev, epss } = finding
  if (!kev && !epss) return <span className="muted">—</span>

  return (
    <div className="exploit">
      {kev && (
        <span className="kev" title={`Added to CISA KEV on ${kev.dateAdded}`}>
          Exploited{kev.ransomware && ' · ransomware'}
        </span>
      )}
      {epss && (
        <span className="epss" title={`EPSS ${(epss.score * 100).toFixed(2)}%, higher than ${(epss.percentile * 100).toFixed(0)}% of all CVEs`}>
          <span className="epss-bar">
            <span style={{ width: `${Math.max(epss.score * 100, 2)}%` }} />
          </span>
          {formatEpss(epss.score)}
        </span>
      )}
    </div>
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
