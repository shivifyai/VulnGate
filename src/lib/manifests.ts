import type { Dependency, Ecosystem } from '../types'

type Parser = (content: string, path: string) => Dependency[]

const IGNORED_DIRS = ['node_modules/', 'vendor/', '.git/', 'dist/', 'build/', 'third_party/']

const PARSERS: Record<string, { ecosystem: Ecosystem; parse: Parser }> = {
  'package-lock.json': { ecosystem: 'npm', parse: parsePackageLock },
  'package.json': { ecosystem: 'npm', parse: parsePackageJson },
  'requirements.txt': { ecosystem: 'PyPI', parse: parseRequirements },
  'go.mod': { ecosystem: 'Go', parse: parseGoMod },
}

export const SUPPORTED_FILES = Object.keys(PARSERS)

function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

function dirname(path: string) {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/**
 * Picks the manifests worth reading out of a full file listing.
 * If a folder has a package-lock.json we skip its package.json, since the
 * lockfile has the exact versions that actually get installed.
 */
export function pickManifests(paths: string[]): string[] {
  const candidates = paths.filter(
    (p) => basename(p) in PARSERS && !IGNORED_DIRS.some((dir) => p.includes(dir)),
  )

  const lockedDirs = new Set(
    candidates.filter((p) => basename(p) === 'package-lock.json').map(dirname),
  )

  return candidates
    .filter((p) => !(basename(p) === 'package.json' && lockedDirs.has(dirname(p))))
    .sort()
}

export function parseManifest(path: string, content: string): Dependency[] {
  const entry = PARSERS[basename(path)]
  return entry ? entry.parse(content, path) : []
}

function parsePackageLock(content: string, manifest: string): Dependency[] {
  const lock = JSON.parse(content)
  const deps: Dependency[] = []

  // lockfileVersion 2 and 3
  if (lock.packages) {
    for (const [key, info] of Object.entries<any>(lock.packages)) {
      if (!key || !info?.version || info.link) continue
      const name = info.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
      deps.push({ name, version: info.version, ecosystem: 'npm', manifest, dev: Boolean(info.dev) })
    }
    return deps
  }

  // lockfileVersion 1 nests dependencies inside each other
  const walk = (tree: Record<string, any> | undefined) => {
    if (!tree) return
    for (const [name, info] of Object.entries(tree)) {
      if (info?.version) {
        deps.push({ name, version: info.version, ecosystem: 'npm', manifest, dev: Boolean(info.dev) })
      }
      walk(info?.dependencies)
    }
  }
  walk(lock.dependencies)
  return deps
}

function parsePackageJson(content: string, manifest: string): Dependency[] {
  const pkg = JSON.parse(content)
  const deps: Dependency[] = []

  const collect = (block: Record<string, string> | undefined, dev: boolean) => {
    for (const [name, range] of Object.entries(block ?? {})) {
      // Without a lockfile the best we can do is take the lowest version the range allows.
      const version = range.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/)?.[0]
      if (version) deps.push({ name, version, ecosystem: 'npm', manifest, dev })
    }
  }

  collect(pkg.dependencies, false)
  collect(pkg.devDependencies, true)
  return deps
}

function parseRequirements(content: string, manifest: string): Dependency[] {
  const deps: Dependency[] = []

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line || line.startsWith('-')) continue

    // Only exact pins are meaningful here, "requests>=2" could resolve to anything.
    const match = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*===?\s*([^\s;,]+)/)
    if (match) {
      deps.push({ name: match[1].toLowerCase(), version: match[2], ecosystem: 'PyPI', manifest })
    }
  }
  return deps
}

function parseGoMod(content: string, manifest: string): Dependency[] {
  const deps: Dependency[] = []
  let inRequireBlock = false

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*/, '').trim()
    if (!line) continue

    if (line.startsWith('require (')) {
      inRequireBlock = true
      continue
    }
    if (inRequireBlock && line === ')') {
      inRequireBlock = false
      continue
    }

    const spec = inRequireBlock ? line : line.startsWith('require ') ? line.slice(8).trim() : null
    if (!spec) continue

    const [name, version] = spec.split(/\s+/)
    if (name && version?.startsWith('v')) {
      // OSV wants Go versions without the leading "v"
      deps.push({ name, version: version.slice(1).replace(/\+incompatible$/, ''), ecosystem: 'Go', manifest })
    }
  }
  return deps
}

export function dedupe(deps: Dependency[]): Dependency[] {
  const seen = new Map<string, Dependency>()
  for (const dep of deps) {
    const key = `${dep.ecosystem}:${dep.name}@${dep.version}`
    const existing = seen.get(key)
    // A package that's a prod dependency anywhere counts as prod
    if (!existing) seen.set(key, dep)
    else if (existing.dev && !dep.dev) seen.set(key, dep)
  }
  return [...seen.values()]
}
