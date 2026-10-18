import { useCallback, useRef, useState } from 'react'
import { Cancelled, runPipeline, STAGES } from '../lib/pipeline'
import type { RunOptions, RunResult, Stage, StageId } from '../types'

export interface LogLine {
  at: number
  message: string
  level: 'info' | 'warn' | 'error'
}

const freshStages = (): Stage[] => STAGES.map((s) => ({ ...s, status: 'idle' }))

export function usePipeline() {
  const [stages, setStages] = useState<Stage[]>(freshStages)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const controller = useRef<AbortController | null>(null)

  const updateStage = useCallback((id: StageId, patch: Partial<Stage>) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const log = useCallback((message: string, level: LogLine['level'] = 'info') => {
    setLogs((prev) => [...prev, { at: Date.now(), message, level }])
  }, [])

  const start = useCallback(
    async (options: RunOptions) => {
      controller.current?.abort()
      const abort = new AbortController()
      controller.current = abort

      setStages(freshStages())
      setLogs([])
      setResult(null)
      setError(null)
      setRunning(true)
      log(`Starting scan of ${options.repo}`)

      try {
        const outcome = await runPipeline(options, { onStage: updateStage, onLog: log, signal: abort.signal })
        if (!abort.signal.aborted) setResult(outcome)
      } catch (err) {
        if (err instanceof Cancelled) {
          log('Run cancelled', 'warn')
        } else {
          const message = (err as Error).message || 'Something went wrong'
          setError(message)
          log(message, 'error')
        }
      } finally {
        if (controller.current === abort) setRunning(false)
      }
    },
    [log, updateStage],
  )

  const cancel = useCallback(() => controller.current?.abort(), [])

  return { stages, logs, result, error, running, start, cancel }
}
