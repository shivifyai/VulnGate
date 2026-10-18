import { useEffect } from 'react'
import type { Finding } from '../types'
import { VERDICT_LABELS } from '../lib/verdicts'
import { formatEpss } from '../lib/format'
import { SeverityBadge, VerdictPill } from './Badges'
import { ExternalIcon, XIcon } from './Icons'

function upgradeCommand(f: Finding) {
  if (!f.fixedIn) return null
  const { name, ecosystem } = f.dependency
  switch (ecosystem) {
    case 'npm':
      return `npm install ${name}@${f.fixedIn}`
    case 'PyPI':
      return `pip install "${name}>=${f.fixedIn}"`
    case 'Go':
      return `go get ${name}@v${f.fixedIn}`
    case 'crates.io':
      return `cargo update -p ${name} --precise ${f.fixedIn}`
    case 'RubyGems':
      return `bundle update ${name}  # needs >= ${f.fixedIn}`
    case 'Packagist':
      return `composer require "${name}:^${f.fixedIn}"`
  }
}

export function FindingDrawer({ finding, onClose }: { finding: Finding | null; onClose: () => void }) {
  useEffect(() => {
    if (!finding) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finding, onClose])

  if (!finding) return null
  const command = upgradeCommand(finding)

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={finding.id}>
        <header>
          <div>
            <SeverityBadge severity={finding.severity} score={finding.score} />
            <h2>{finding.id}</h2>
            {finding.aliases.length > 0 && <p className="aliases">{finding.aliases.join(' · ')}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </header>

        <p className="drawer-summary">{finding.summary}</p>

        {finding.kev && (
          <div className="kev-box">
            <strong>Actively exploited.</strong> CISA added this to its Known Exploited Vulnerabilities catalog on{' '}
            {new Date(finding.kev.dateAdded).toLocaleDateString()}
            {finding.kev.ransomware && ', and it is known to be used in ransomware campaigns'}. Patch this first.
          </div>
        )}

        <dl className="facts">
          <dt>Package</dt>
          <dd>
            {finding.dependency.name} <span className="muted">({finding.dependency.ecosystem})</span>
          </dd>
          <dt>Installed</dt>
          <dd>
            <code>{finding.dependency.version}</code>
            {finding.dependency.dev && <span className="tag">dev</span>}
          </dd>
          <dt>Fixed in</dt>
          <dd>{finding.fixedIn ? <code className="fix">{finding.fixedIn}</code> : 'No fix released yet'}</dd>
          <dt>Found in</dt>
          <dd>
            <code>{finding.dependency.manifest}</code>
          </dd>
          <dt>Verdict</dt>
          <dd>
            <VerdictPill verdict={finding.verdict} />
            <span className="muted verdict-hint">{VERDICT_LABELS[finding.verdict].hint}</span>
          </dd>
          {finding.epss && (
            <>
              <dt>EPSS</dt>
              <dd>
                {formatEpss(finding.epss.score)} chance of exploitation in the next 30 days
                <span className="muted verdict-hint">
                  Riskier than {(finding.epss.percentile * 100).toFixed(0)}% of all published CVEs
                </span>
              </dd>
            </>
          )}
          {finding.published && (
            <>
              <dt>Published</dt>
              <dd>{new Date(finding.published).toLocaleDateString()}</dd>
            </>
          )}
        </dl>

        {command && (
          <div className="fix-box">
            <span>Suggested fix</span>
            <code>{command}</code>
          </div>
        )}

        {finding.details && (
          <section>
            <h4>Details</h4>
            <div className="details">{finding.details}</div>
          </section>
        )}

        <section>
          <h4>Links</h4>
          <ul className="refs">
            {finding.alertUrl && (
              <li>
                <a href={finding.alertUrl} target="_blank" rel="noreferrer">
                  Dependabot alert <ExternalIcon size={13} />
                </a>
              </li>
            )}
            {!finding.key.startsWith('alert-') && (
              <li>
                <a href={`https://osv.dev/vulnerability/${finding.id}`} target="_blank" rel="noreferrer">
                  osv.dev/{finding.id} <ExternalIcon size={13} />
                </a>
              </li>
            )}
            {finding.references.slice(0, 12).map((ref) => (
              <li key={ref.url}>
                <a href={ref.url} target="_blank" rel="noreferrer">
                  <span className="ref-type">{ref.type.toLowerCase()}</span> {ref.url.replace(/^https?:\/\//, '')}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  )
}
