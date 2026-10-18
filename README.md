# VulnGate

A small React + TypeScript app that runs a vulnerability validation pipeline against any GitHub repository, right in the browser.

Paste a repo, hit **Run pipeline**, and it will:

1. **Resolve the repository** and its default branch (or the branch/tag you give it).
2. **Find manifests**: `package-lock.json`, `package.json`, `requirements.txt` and `go.mod`. Lockfiles win over `package.json` in the same folder, and `node_modules/`, `vendor/` and friends are skipped.
3. **Parse dependencies** into exact `name@version` pairs. Dev dependencies are left out unless you ask for them.
4. **Query [OSV](https://osv.dev)** in batches, then load each advisory to work out severity (GHSA rating, or a CVSS 3 score computed from the vector) and the nearest fixed version.
5. **Cross-check Dependabot** (needs a token) and label every finding:
   - **Confirmed**: OSV and Dependabot agree.
   - **Missed by GitHub**: OSV knows about it but there's no open Dependabot alert.
   - **Likely stale**: Dependabot has an alert open, but the version actually pinned isn't affected.
6. **Policy gate**: fails if anything at or above your chosen severity is still open.

Results can be filtered, searched, opened for detail (with an upgrade command), and exported as JSON or CSV.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests for the parsers, version compare and CVSS scoring
npm run build
```

## About the token

The token is optional. Without one you can scan public repos (GitHub allows 60 unauthenticated requests an hour). With one you also get private repos and the Dependabot comparison.

- Classic token: `repo` for private repos, `security_events` for Dependabot alerts.
- Fine-grained token: *Contents: read* and *Dependabot alerts: read* on the repo.

It's kept in React state only and sent nowhere except `api.github.com`.

## Known limits

- `package.json` without a lockfile uses the lowest version the range allows, so it's an approximation.
- `requirements.txt` only counts exact pins (`==`). Ranges like `>=2` can't be checked without resolving them.
- Very large monorepos may hit GitHub's tree truncation limit; the log will say so.

## Layout

```
src/
  lib/          pipeline logic, no React in here
    pipeline.ts   stages + Dependabot reconciliation
    github.ts     GitHub REST client
    osv.ts        OSV batch queries, severity, fix versions
    manifests.ts  parsers for each manifest type
    severity.ts   CVSS 3.x scoring and thresholds
  hooks/        usePipeline, wires the runner into React state
  components/   form, stage tracker, summary, table, detail drawer
```
