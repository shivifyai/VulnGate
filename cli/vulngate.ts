import { appendFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { parseRepoInput } from '../src/lib/github'
import { runPipeline } from '../src/lib/pipeline'
import { toCsv, toMarkdown } from '../src/lib/report'
import { formatEpss } from '../src/lib/format'
import type { RunResult, Severity } from '../src/types'

const HELP = `Usage: vulngate <owner/repo> [options]

Options:
  --ref <branch|tag|sha>   What to scan (default: the repo's default branch)
  --fail-on <level>        critical, high, medium or low (default: high)
  --dev                    Include dev dependencies
  --no-kev                 Don't fail just because a CVE is on CISA's exploited list
  --format <fmt>           text, markdown, json or csv (default: text)
  --output <file>          Write the report to a file instead of stdout
  --token <token>          GitHub token (or set GITHUB_TOKEN / GH_TOKEN)
  -q, --quiet              Only print the report
  -h, --help               Show this help

Exit codes: 0 gate passed, 1 gate failed, 2 the scan itself broke.
`

const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: number) => (text: string) => (color ? `\x1b[${code}m${text}\x1b[0m` : text)
const red = paint(31)
const yellow = paint(33)
const green = paint(32)
const dim = paint(2)
const bold = paint(1)

const SEVERITY_COLOR: Record<Severity, (s: string) => string> = {
  CRITICAL: paint(91),
  HIGH: red,
  MEDIUM: yellow,
  LOW: paint(36),
  UNKNOWN: dim,
}

class CliError extends Error {}

function fail(message: string): never {
  throw new CliError(message)
}

function textReport(result: RunResult): string {
  const lines: string[] = []
  const active = result.findings.filter((f) => f.verdict !== 'stale')

  lines.push('')
  lines.push(bold(`${result.repo.fullName}@${result.ref}`) + dim(`  ${result.dependencies.length} packages, ${active.length} findings`))
  lines.push('')

  for (const f of active) {
    const sev = SEVERITY_COLOR[f.severity](f.severity.padEnd(8))
    const pkg = `${f.dependency.name}@${f.dependency.version}`
    const fix = f.fixedIn ? green(`-> ${f.fixedIn}`) : dim('no fix')
    const risk = [f.kev ? red('EXPLOITED') : '', f.epss ? dim(`epss ${formatEpss(f.epss.score)}`) : ''].filter(Boolean).join(' ')
    lines.push(`  ${sev} ${f.id.padEnd(22)} ${pkg} ${fix} ${risk}`)
    lines.push(dim(`           ${f.summary.slice(0, 110)}`))
  }

  lines.push('')
  lines.push(result.passed ? green(bold('PASSED')) : red(bold('FAILED')))
  return lines.join('\n') + '\n'
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      ref: { type: 'string' },
      'fail-on': { type: 'string', default: 'high' },
      dev: { type: 'boolean', default: false },
      'no-kev': { type: 'boolean', default: false },
      format: { type: 'string', default: 'text' },
      output: { type: 'string' },
      token: { type: 'string' },
      quiet: { type: 'boolean', short: 'q', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP)
    return values.help ? 0 : 2
  }

  const repo = parseRepoInput(positionals[0]) ?? fail(`"${positionals[0]}" isn't a repository, use owner/name`)
  const failOn = values['fail-on']!.toUpperCase() as Severity
  if (!['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(failOn)) fail(`--fail-on must be critical, high, medium or low`)
  if (!['text', 'markdown', 'json', 'csv'].includes(values.format!)) fail(`unknown --format "${values.format}"`)

  const log = (message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    if (values.quiet && level === 'info') return
    const tag = level === 'error' ? red('✗') : level === 'warn' ? yellow('!') : dim('·')
    process.stderr.write(`${tag} ${message}\n`)
  }

  let result: RunResult
  try {
    result = await runPipeline(
      {
        repo,
        ref: values.ref,
        token: values.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
        failOn,
        includeDev: values.dev!,
        failOnExploited: !values['no-kev'],
      },
      {
        onLog: log,
        onStage: (id, patch) => {
          if (patch.status === 'failed') log(`stage "${id}" failed: ${patch.note}`, 'error')
        },
      },
    )
  } catch (err) {
    fail((err as Error).message)
  }

  const report =
    values.format === 'json' ? JSON.stringify(result, null, 2) + '\n'
    : values.format === 'markdown' ? toMarkdown(result) + '\n'
    : values.format === 'csv' ? toCsv(result) + '\n'
    : textReport(result)

  if (values.output) writeFileSync(values.output, report)
  else process.stdout.write(report)

  // Inside GitHub Actions, leave a readable summary on the run page and expose outputs
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, toMarkdown(result) + '\n')
  if (process.env.GITHUB_OUTPUT) {
    const active = result.findings.filter((f) => f.verdict !== 'stale')
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `passed=${result.passed}\nfindings=${active.length}\nexploited=${active.filter((f) => f.kev).length}\n`,
    )
  }

  return result.passed ? 0 : 1
}

// Setting exitCode instead of calling process.exit() lets open sockets close
// cleanly; exiting mid-close crashes Node on Windows.
main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    process.stderr.write(`${red('error')} ${(err as Error).message}\n`)
    process.exitCode = 2
  },
)
