import { useCallback, useEffect, useRef, useState } from 'react'
import { FindingDrawer } from './components/FindingDrawer'
import { FindingsTable } from './components/FindingsTable'
import { ShieldIcon } from './components/Icons'
import { PipelineStages } from './components/PipelineStages'
import { RunForm } from './components/RunForm'
import { Summary } from './components/Summary'
import { usePipeline } from './hooks/usePipeline'
import { optionsFromQuery, optionsToQuery } from './lib/shareLink'
import type { Finding, RunOptions } from './types'

export default function App() {
  const { stages, logs, result, error, running, start, cancel } = usePipeline()
  const [selected, setSelected] = useState<Finding | null>(null)
  const [initial] = useState(() => optionsFromQuery(window.location.search))
  const autoStarted = useRef(false)
  const hasStarted = logs.length > 0

  // Keep the address bar in sync so a run can be shared as a link
  const run = useCallback(
    (options: RunOptions) => {
      window.history.replaceState(null, '', optionsToQuery(options))
      start(options)
    },
    [start],
  )

  // Opening a shared link (?repo=owner/name) kicks off the scan straight away
  useEffect(() => {
    if (!initial?.repo || autoStarted.current) return
    autoStarted.current = true
    run({ repo: initial.repo, ref: '', failOn: 'HIGH', includeDev: false, failOnExploited: true, ...initial })
  }, [initial, run])

  return (
    <div className="app">
      <header className="hero">
        <div className="brand">
          <span className="brand-mark">
            <ShieldIcon size={22} />
          </span>
          <span>VulnGate</span>
        </div>
        <h1>Validate the vulnerabilities in any GitHub repo</h1>
        <p>
          Pulls the manifests straight from GitHub, checks every pinned package against the{' '}
          <a href="https://osv.dev" target="_blank" rel="noreferrer">OSV</a> database,
          <br />
          then cross-checks the results with Dependabot which alerts are real, missing or stale.
        </p>
      </header>

      <main>
        <RunForm running={running} initial={initial ?? undefined} onRun={run} onCancel={cancel} />

        {hasStarted && <PipelineStages stages={stages} logs={logs} />}

        {error && !running && (
          <div className="card alert-error">
            <strong>The pipeline stopped.</strong> {error}
          </div>
        )}

        {result && (
          <>
            <Summary result={result} />
            <FindingsTable findings={result.findings} dependabotChecked={result.dependabotChecked} onSelect={setSelected} />
          </>
        )}
      </main>

      <footer>
        Data from <a href="https://osv.dev" target="_blank" rel="noreferrer">osv.dev</a>,{' '}
        <a href="https://www.first.org/epss/" target="_blank" rel="noreferrer">FIRST EPSS</a>,{' '}
        <a href="https://www.cisa.gov/known-exploited-vulnerabilities-catalog" target="_blank" rel="noreferrer">CISA KEV</a>{' '}
        and the GitHub REST API.
      </footer>

      <FindingDrawer finding={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
