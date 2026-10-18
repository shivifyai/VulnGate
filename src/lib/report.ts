import type { RunResult } from '../types'

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const fileStem = (result: RunResult) => `vuln-report-${result.repo.fullName.replace('/', '-')}-${result.ref}`

export function downloadJson(result: RunResult) {
  download(`${fileStem(result)}.json`, JSON.stringify(result, null, 2), 'application/json')
}

export function downloadCsv(result: RunResult) {
  const escape = (value: unknown) => {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  const header = ['id', 'aliases', 'severity', 'score', 'package', 'ecosystem', 'version', 'fixed_in', 'manifest', 'verdict', 'summary']
  const rows = result.findings.map((f) => [
    f.id,
    f.aliases.join(' '),
    f.severity,
    f.score ?? '',
    f.dependency.name,
    f.dependency.ecosystem,
    f.dependency.version,
    f.fixedIn ?? '',
    f.dependency.manifest,
    f.verdict,
    f.summary,
  ])

  const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\n')
  download(`${fileStem(result)}.csv`, csv, 'text/csv')
}
