# VulnGate

Validate the vulnerabilities in any GitHub repository: in the browser, from the command line, or as a GitHub Action.

VulnGate reads a repo's lockfiles, checks every pinned package against [OSV](https://osv.dev), ranks what it finds by real-world exploit risk ([EPSS](https://www.first.org/epss/) and the [CISA KEV catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)), cross-checks the results with Dependabot, and gives you a pass/fail verdict.

For the full picture (the problem it solves, how validation and risk ranking work, design decisions and roadmap), see the **[project summary](docs/PROJECT_SUMMARY.md)**.

## What the pipeline does

1. **Resolve the repository** and the branch, tag or commit to scan.
2. **Find manifests**, skipping `node_modules/`, `vendor/`, test fixtures and the like.
3. **Parse dependencies** into exact `name@version` pairs.
4. **Query OSV** in batches, then load each advisory for its severity (GHSA rating, or a CVSS 3 score computed from the vector) and the nearest fixed version.
5. **Add exploit intelligence**: the EPSS chance of exploitation in the next 30 days, and whether CISA has seen it exploited in the wild.
6. **Cross-check Dependabot** (needs a token). Every finding gets a verdict:
   - **Confirmed**: OSV and Dependabot agree.
   - **Missed by GitHub**: OSV knows about it, but there's no open Dependabot alert.
   - **Likely stale**: Dependabot has an alert open, but the version actually pinned isn't affected.
7. **Policy gate**: fails on anything at or above your chosen severity, and optionally on anything that's known to be exploited, however it's rated.

Findings are sorted by risk: known-exploited first, then severity, then EPSS.

### Supported manifests

| Ecosystem | Files |
| --- | --- |
| npm | `package-lock.json`, `yarn.lock` (v1 and Berry), `pnpm-lock.yaml` (v5–v9), `package.json` |
| PyPI | `poetry.lock`, `Pipfile.lock`, `requirements.txt` |
| Go | `go.mod` |
| crates.io | `Cargo.lock` |
| RubyGems | `Gemfile.lock` |
| Packagist | `composer.lock` |

## Web app

```bash
npm install
npm run dev      # http://localhost:5173
```

Paste a repo and hit **Run pipeline**. You can filter and search the results, open any finding for details and an upgrade command, and export a Markdown, JSON or CSV report.

The address bar always reflects the current scan, so you can share it: opening `/?repo=owner/name&failOn=critical` fills in the form and starts the scan. The token is never put in the link.

## Command line

```bash
npm run build:cli
node dist-cli/vulngate.mjs expressjs/express --fail-on critical
node dist-cli/vulngate.mjs owner/repo --format markdown --output report.md
```

| Option | |
| --- | --- |
| `--ref <ref>` | Branch, tag or SHA (default: the default branch) |
| `--fail-on <level>` | `critical`, `high` (default), `medium`, `low` |
| `--no-kev` | Don't fail just because something is on CISA KEV |
| `--dev` | Include dev dependencies |
| `--format` | `text` (default), `markdown`, `json`, `csv` |
| `--output <file>` | Write the report to a file |
| `--token` | GitHub token, or set `GITHUB_TOKEN` / `GH_TOKEN` |

Exit codes: `0` passed, `1` the gate failed, `2` the scan itself broke.

## GitHub Action

```yaml
- uses: shivifyai/VulnGate@main
  with:
    fail-on: high              # critical | high | medium | low
    fail-on-exploited: true    # fail on CISA KEV entries regardless of severity
    # token: ${{ secrets.VULNGATE_TOKEN }}   # needed for the Dependabot cross-check
```

The job fails when the gate fails, a Markdown report is added to the run's summary page, and the `passed`, `findings` and `exploited` outputs are available to later steps. This repo scans itself with it, see [.github/workflows/vulngate.yml](.github/workflows/vulngate.yml).

## About the token

The token is optional. Without one you can scan public repos. Files are read from `raw.githubusercontent.com`, so a scan only uses two of the 60 GitHub API requests you're allowed per hour without a token. With a token you also get private repos and the Dependabot comparison.

- Classic token: `repo` for private repos, `security_events` for Dependabot alerts.
- Fine-grained token: *Contents: read* and *Dependabot alerts: read* on the repo.

In the browser, the token only lives in React state and is only sent to `api.github.com`.

## Known limits

- `package.json` without a lockfile uses the lowest version each range allows, so it's an approximation.
- `requirements.txt` only counts exact pins (`==`).
- `Gemfile.lock` versions are matched without their platform suffix.
- Maven, Gradle and NuGet aren't supported yet.
- Scans stop after 150 manifests; the log says so when that happens.

## Development

```bash
npm test          # parsers, versions, CVSS scoring, reports, share links
npm run lint
npm run build     # web app -> dist/
npm run build:cli # CLI -> dist-cli/vulngate.mjs
```

```
src/
  lib/            pipeline logic, shared by the web app and the CLI
    pipeline.ts     stages, gate and Dependabot reconciliation
    github.ts       GitHub REST client
    osv.ts          OSV batch queries, severity, fix versions
    exploits.ts     EPSS + CISA KEV enrichment and risk ranking
    manifests.ts    parsers for every lockfile format
    report.ts       Markdown / CSV / JSON reports
  hooks/          usePipeline, wires the runner into React state
  components/     form, stage tracker, summary, table, detail drawer
cli/              command-line entry point
action.yml        the GitHub Action
```
