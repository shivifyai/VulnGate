import { useEffect, useRef } from 'react'
import type { LogLine } from '../hooks/usePipeline'
import type { Stage } from '../types'
import { CheckIcon, SkipIcon, XIcon } from './Icons'

function duration(stage: Stage) {
  if (!stage.startedAt || !stage.finishedAt) return null
  const ms = stage.finishedAt - stage.startedAt
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

function StageMarker({ stage, index }: { stage: Stage; index: number }) {
  switch (stage.status) {
    case 'done':
      return <CheckIcon size={16} />
    case 'failed':
      return <XIcon size={16} />
    case 'skipped':
      return <SkipIcon size={16} />
    case 'running':
      return <span className="spinner" />
    default:
      return <span>{index + 1}</span>
  }
}

export function PipelineStages({ stages, logs }: { stages: Stage[]; logs: LogLine[] }) {
  const consoleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = consoleRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs])

  return (
    <section className="card pipeline">
      <ol className="stages">
        {stages.map((stage, i) => (
          <li key={stage.id} className={`stage stage-${stage.status}`}>
            <div className="stage-marker">
              <StageMarker stage={stage} index={i} />
            </div>
            <div className="stage-text">
              <strong>{stage.title}</strong>
              <span>{stage.note ?? (stage.status === 'idle' ? 'waiting' : stage.status)}</span>
              {duration(stage) && <small>{duration(stage)}</small>}
            </div>
          </li>
        ))}
      </ol>

      {logs.length > 0 && (
        <div className="console" ref={consoleRef}>
          {logs.map((line, i) => (
            <div key={i} className={`console-line ${line.level}`}>
              <time>{new Date(line.at).toLocaleTimeString()}</time>
              <span>{line.message}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
