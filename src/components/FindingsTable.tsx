import { useMemo, useState } from 'react'
import { SEVERITY_ORDER } from '../lib/severity'
import type { Finding, Severity, Verdict } from '../types'
import { VERDICT_LABELS } from '../lib/verdicts'
import { SeverityBadge, VerdictPill } from './Badges'
import { SearchIcon } from './Icons'

interface Props {
  findings: Finding[]
  dependabotChecked: boolean
  onSelect: (finding: Finding) => void
}

export function FindingsTable({ findings, dependabotChecked, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [severities, setSeverities] = useState<Set<Severity>>(new Set())
  const [verdict, setVerdict] = useState<Verdict | 'all'>('all')

  const verdictsPresent = useMemo(
    () => (Object.keys(VERDICT_LABELS) as Verdict[]).filter((v) => findings.some((f) => f.verdict === v)),
    [findings],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return findings.filter((f) => {
      if (severities.size && !severities.has(f.severity)) return false
      if (verdict !== 'all' && f.verdict !== verdict) return false
      if (!q) return true
      return [f.id, ...f.aliases, f.summary, f.dependency.name, f.dependency.manifest].some((text) =>
        text.toLowerCase().includes(q),
      )
    })
  }, [findings, query, severities, verdict])

  const toggleSeverity = (sev: Severity) => {
    setSeverities((prev) => {
      const next = new Set(prev)
      if (next.has(sev)) next.delete(sev)
      else next.add(sev)
      return next
    })
  }

  if (findings.length === 0) {
    return (
      <section className="card empty">
        <div className="empty-art">🎉</div>
        <h3>No known vulnerabilities</h3>
        <p className="muted">Nothing in OSV matches the versions this repository pins. Nice.</p>
      </section>
    )
  }

  return (
    <section className="card findings">
      <header className="findings-toolbar">
        <h3>
          Findings <span className="count">{visible.length}</span>
        </h3>

        <div className="filters">
          <div className="chips">
            {SEVERITY_ORDER.map((sev) => (
              <button
                key={sev}
                type="button"
                className={`chip chip-${sev.toLowerCase()} ${severities.has(sev) ? 'on' : ''}`}
                onClick={() => toggleSeverity(sev)}
              >
                {sev === 'UNKNOWN' ? 'Unrated' : sev.charAt(0) + sev.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          {dependabotChecked && (
            <select value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict | 'all')}>
              <option value="all">All verdicts</option>
              {verdictsPresent.map((v) => (
                <option key={v} value={v}>
                  {VERDICT_LABELS[v].label}
                </option>
              ))}
            </select>
          )}

          <div className="input-with-icon search">
            <SearchIcon size={16} />
            <input placeholder="Search id, package, file…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      </header>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Advisory</th>
              <th>Package</th>
              <th>Installed</th>
              <th>Fixed in</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((f) => (
              <tr key={f.key} onClick={() => onSelect(f)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(f)}>
                <td>
                  <SeverityBadge severity={f.severity} score={f.score} />
                </td>
                <td className="advisory">
                  <code>{f.id}</code>
                  <span className="summary-line">{f.summary}</span>
                </td>
                <td>
                  <div className="pkg">
                    <span className={`eco eco-${f.dependency.ecosystem.toLowerCase()}`}>{f.dependency.ecosystem}</span>
                    {f.dependency.name}
                  </div>
                  <span className="manifest">{f.dependency.manifest}</span>
                </td>
                <td>
                  <code>{f.dependency.version}</code>
                </td>
                <td>{f.fixedIn ? <code className="fix">{f.fixedIn}</code> : <span className="muted">—</span>}</td>
                <td>
                  <VerdictPill verdict={f.verdict} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <p className="no-match muted">Nothing matches these filters.</p>}
      </div>
    </section>
  )
}
