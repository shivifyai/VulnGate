import { useState, type FormEvent } from 'react'
import { parseRepoInput } from '../lib/github'
import type { RunOptions, Severity } from '../types'
import { GitHubIcon, KeyIcon, PlayIcon, StopIcon } from './Icons'

interface Props {
  running: boolean
  initial?: Partial<RunOptions>
  onRun: (options: RunOptions) => void
  onCancel: () => void
}

const EXAMPLES = ['expressjs/express', 'psf/requests', 'gin-gonic/gin']
const THRESHOLDS: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

export function RunForm({ running, initial, onRun, onCancel }: Props) {
  const [repo, setRepo] = useState(initial?.repo ?? '')
  const [ref, setRef] = useState(initial?.ref ?? '')
  const [token, setToken] = useState('')
  const [failOn, setFailOn] = useState<Severity>(initial?.failOn ?? 'HIGH')
  const [includeDev, setIncludeDev] = useState(initial?.includeDev ?? false)
  const [failOnExploited, setFailOnExploited] = useState(initial?.failOnExploited ?? true)
  const [problem, setProblem] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const fullName = parseRepoInput(repo)
    if (!fullName) {
      setProblem('That doesn’t look like a repository. Try owner/name or a github.com link.')
      return
    }
    setProblem(null)
    onRun({ repo: fullName, ref, token, failOn, includeDev, failOnExploited })
  }

  return (
    <form className="card run-form" onSubmit={submit}>
      <div className="field grow">
        <label htmlFor="repo">Repository</label>
        <div className="input-with-icon">
          <GitHubIcon />
          <input
            id="repo"
            placeholder="owner/repo or https://github.com/owner/repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </div>
        <div className="examples">
          Try:
          {EXAMPLES.map((example) => (
            <button key={example} type="button" className="link" onClick={() => setRepo(example)}>
              {example}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="ref">Branch / tag</label>
        <input id="ref" placeholder="default branch" value={ref} onChange={(e) => setRef(e.target.value)} />
      </div>

      <div className="field grow">
        <label htmlFor="token">
          GitHub token <span className="muted">(optional)</span>
        </label>
        <div className="input-with-icon">
          <KeyIcon />
          <input
            id="token"
            type="password"
            placeholder="ghp_… for private repos and Dependabot cross-check"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
        </div>
        <p className="hint">Stays in this browser tab. It&apos;s only sent to api.github.com.</p>
      </div>

      <div className="field">
        <label htmlFor="failOn">Fail on</label>
        <select id="failOn" value={failOn} onChange={(e) => setFailOn(e.target.value as Severity)}>
          {THRESHOLDS.map((level) => (
            <option key={level} value={level}>
              {level.charAt(0) + level.slice(1).toLowerCase()} and above
            </option>
          ))}
        </select>
        <label className="checkbox">
          <input type="checkbox" checked={includeDev} onChange={(e) => setIncludeDev(e.target.checked)} />
          Include dev dependencies
        </label>
        <label className="checkbox" title="Anything on CISA's Known Exploited Vulnerabilities list fails the gate, whatever its severity">
          <input type="checkbox" checked={failOnExploited} onChange={(e) => setFailOnExploited(e.target.checked)} />
          Always fail on exploited CVEs
        </label>
      </div>

      <div className="actions">
        {running ? (
          <button type="button" className="btn btn-danger" onClick={onCancel}>
            <StopIcon size={16} /> Cancel
          </button>
        ) : (
          <button type="submit" className="btn btn-primary">
            <PlayIcon size={16} /> Run pipeline
          </button>
        )}
      </div>

      {problem && <p className="form-error">{problem}</p>}
    </form>
  )
}
