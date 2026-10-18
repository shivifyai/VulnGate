import type { RunOptions, Severity } from '../types'
import { parseRepoInput } from './github'

const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

// The token is deliberately never put in the URL.
export function optionsToQuery(options: RunOptions): string {
  const params = new URLSearchParams({ repo: options.repo })
  if (options.ref) params.set('ref', options.ref)
  if (options.failOn !== 'HIGH') params.set('failOn', options.failOn.toLowerCase())
  if (options.includeDev) params.set('dev', '1')
  if (!options.failOnExploited) params.set('kev', '0')
  return `?${params}`
}

export function optionsFromQuery(search: string): Partial<RunOptions> | null {
  const params = new URLSearchParams(search)
  const repo = parseRepoInput(params.get('repo') ?? '')
  if (!repo) return null

  const failOn = params.get('failOn')?.toUpperCase() as Severity | undefined
  return {
    repo,
    ref: params.get('ref') ?? '',
    failOn: failOn && SEVERITIES.includes(failOn) ? failOn : 'HIGH',
    includeDev: params.get('dev') === '1',
    failOnExploited: params.get('kev') !== '0',
  }
}
