import { downloadCsv, downloadJson } from '../lib/report'
import { atLeast, SEVERITY_ORDER } from '../lib/severity'
import type { RunResult } from '../types'
import { CheckIcon, DownloadIcon, ExternalIcon, XIcon } from './Icons'

export function Summary({ result }: { result: RunResult }) {
  const { failOn } = result
  const active = result.findings.filter((f) => f.verdict !== 'stale')
  const counts = Object.fromEntries(
    SEVERITY_ORDER.map((sev) => [sev, active.filter((f) => f.severity === sev).length]),
  )
  const packages = new Set(active.map((f) => `${f.dependency.name}@${f.dependency.version}`)).size
  const fixable = active.filter((f) => f.fixedIn).length
  const blocking = active.filter((f) => atLeast(f.severity, failOn)).length

  return (
    <section className="summary">
      <div className={`gate card ${result.passed ? 'gate-pass' : 'gate-fail'}`}>
        <div className="gate-icon">{result.passed ? <CheckIcon size={28} /> : <XIcon size={28} />}</div>
        <div className="gate-text">
          <h2>{result.passed ? 'Pipeline passed' : 'Pipeline failed'}</h2>
          <p>
            {result.passed
              ? `No open findings at ${failOn.toLowerCase()} severity or above.`
              : `${blocking} finding${blocking === 1 ? '' : 's'} at ${failOn.toLowerCase()} severity or above need attention.`}
          </p>
          <a href={result.repo.htmlUrl} target="_blank" rel="noreferrer" className="repo-link">
            {result.repo.fullName} <span className="muted">@ {result.ref}</span> <ExternalIcon size={14} />
          </a>
        </div>
        <div className="gate-actions">
          <button className="btn btn-ghost" onClick={() => downloadJson(result)}>
            <DownloadIcon size={16} /> JSON
          </button>
          <button className="btn btn-ghost" onClick={() => downloadCsv(result)}>
            <DownloadIcon size={16} /> CSV
          </button>
        </div>
      </div>

      <div className="stats">
        {SEVERITY_ORDER.map((sev) => (
          <div key={sev} className={`stat card stat-${sev.toLowerCase()}`}>
            <span className="stat-value">{counts[sev]}</span>
            <span className="stat-label">{sev === 'UNKNOWN' ? 'Unrated' : sev.toLowerCase()}</span>
          </div>
        ))}
        <div className="stat card stat-neutral">
          <span className="stat-value">{result.dependencies.length}</span>
          <span className="stat-label">packages scanned</span>
        </div>
        <div className="stat card stat-neutral">
          <span className="stat-value">
            {fixable}
            <small>/{active.length}</small>
          </span>
          <span className="stat-label">have a fix ({packages} pkgs)</span>
        </div>
      </div>
    </section>
  )
}
