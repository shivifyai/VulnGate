import type { Dependency, Ecosystem } from '../types'

type Parser = (content: string, path: string) => Dependency[]

// Vendored code and test fixtures aren't what ships, and big monorepos have hundreds of fixture lockfiles
const IGNORED_DIRS = [
  'node_modules', 'vendor', '.git', 'dist', 'build', 'third_party',
  '__fixtures__', 'fixtures', '__tests__', 'testdata', 'test-fixtures', 'examples',
]

const isIgnored = (path: string) => path.split('/').slice(0, -1).some((dir) => IGNORED_DIRS.includes(dir))

// Past this many manifests the scan gets slow and eats API quota, so we stop there
export const MAX_MANIFESTS = 150

const PARSERS: Record<string, { ecosystem: Ecosystem; parse: Parser }> = {
  'package-lock.json': { ecosystem: 'npm', parse: parsePackageLock },
  'yarn.lock': { ecosystem: 'npm', parse: parseYarnLock },
  'pnpm-lock.yaml': { ecosystem: 'npm', parse: parsePnpmLock },
  'package.json': { ecosystem: 'npm', parse: parsePackageJson },
  'requirements.txt': { ecosystem: 'PyPI', parse: parseRequirements },
  'poetry.lock': { ecosystem: 'PyPI', parse: (c, p) => parseTomlPackages(c, p, 'PyPI') },
  'Pipfile.lock': { ecosystem: 'PyPI', parse: parsePipfileLock },
  'go.mod': { ecosystem: 'Go', parse: parseGoMod },
  'Cargo.lock': { ecosystem: 'crates.io', parse: (c, p) => parseTomlPackages(c, p, 'crates.io') },
  'Gemfile.lock': { ecosystem: 'RubyGems', parse: parseGemfileLock },
  'composer.lock': { ecosystem: 'Packagist', parse: parseComposerLock },
}

const NPM_LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']

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
 * If a folder has an npm lockfile we skip its package.json, since the
 * lockfile has the exact versions that actually get installed.
 */
export function pickManifests(paths: string[]): string[] {
  const candidates = paths.filter((p) => basename(p) in PARSERS && !isIgnored(p))

  const lockedDirs = new Set(
    candidates.filter((p) => NPM_LOCKFILES.includes(basename(p))).map(dirname),
  )

  return candidates
    .filter((p) => !(basename(p) === 'package.json' && lockedDirs.has(dirname(p))))
    .sort()
}

export function parseManifest(path: string, content: string): Dependency[] {
  const entry = PARSERS[basename(path)]
  return entry ? entry.parse(content, path) : []
}

const lines = (content: string) => content.split(/\r?\n/)
const unquote = (text: string) => text.trim().replace(/^["']|["']$/g, '')

// ---------- npm ----------

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

/** Handles both the classic v1 format and Yarn Berry (v2+), which is YAML-ish. */
function parseYarnLock(content: string, manifest: string): Dependency[] {
  const deps: Dependency[] = []
  let currentName: string | null = null

  for (const line of lines(content)) {
    if (!line.trim() || line.startsWith('#')) continue

    if (!line.startsWith(' ')) {
      // e.g. `"@babel/core@^7.0.0", "@babel/core@^7.1.0":` or `"lodash@npm:^4.17.0":`
      const firstSpec = unquote(line.replace(/:$/, '').split(',')[0])
      if (firstSpec === '__metadata' || firstSpec.includes('@workspace:')) {
        currentName = null
        continue
      }
      const at = firstSpec.indexOf('@', 1)
      currentName = at > 0 ? firstSpec.slice(0, at) : null
      continue
    }

    const version = line.match(/^\s+version:?\s+"?([^"\s]+)"?/)?.[1]
    if (currentName && version) {
      deps.push({ name: currentName, version, ecosystem: 'npm', manifest })
      currentName = null
    }
  }
  return deps
}

/** Works with pnpm lockfile v5, v6 and v9 without pulling in a YAML parser. */
function parsePnpmLock(content: string, manifest: string): Dependency[] {
  const deps: Dependency[] = []
  let inPackages = false
  let last: Dependency | null = null

  for (const line of lines(content)) {
    if (/^\S/.test(line)) {
      inPackages = line.startsWith('packages:')
      last = null
      continue
    }
    if (!inPackages) continue

    // A package entry sits at exactly two spaces of indentation
    const key = line.match(/^ {2}(\S.*):$/)?.[1]
    if (key) {
      // "/lodash@4.17.21", "lodash@4.17.21", "/lodash/4.17.21" or with a "(peer@1)" suffix
      const spec = unquote(key).replace(/^\//, '').replace(/\(.*$/, '')
      const at = spec.lastIndexOf('@')
      let name: string
      let version: string
      if (at > 0) {
        name = spec.slice(0, at)
        version = spec.slice(at + 1)
      } else {
        const slash = spec.lastIndexOf('/')
        name = spec.slice(0, slash)
        version = spec.slice(slash + 1)
      }
      version = version.split('_')[0]
      last = name && /^\d/.test(version) ? { name, version, ecosystem: 'npm', manifest } : null
      if (last) deps.push(last)
      continue
    }

    if (last && /^\s+dev: true/.test(line)) last.dev = true
  }
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

// ---------- Python ----------

function parseRequirements(content: string, manifest: string): Dependency[] {
  const deps: Dependency[] = []

  for (const raw of lines(content)) {
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

function parsePipfileLock(content: string, manifest: string): Dependency[] {
  const lock = JSON.parse(content)
  const deps: Dependency[] = []

  for (const [section, dev] of [['default', false], ['develop', true]] as const) {
    for (const [name, info] of Object.entries<any>(lock[section] ?? {})) {
      const version = typeof info?.version === 'string' ? info.version.replace(/^==/, '') : null
      if (version) deps.push({ name: name.toLowerCase(), version, ecosystem: 'PyPI', manifest, dev })
    }
  }
  return deps
}

/**
 * Cargo.lock and poetry.lock share the same shape: a list of [[package]]
 * tables with name and version keys. That's all we need, so no TOML library.
 */
function parseTomlPackages(content: string, manifest: string, ecosystem: Ecosystem): Dependency[] {
  const deps: Dependency[] = []
  let current: (Partial<Dependency> & { fromRegistry?: boolean }) | null = null

  const flush = () => {
    // Crates without a registry source are workspace members or git/path deps, not on crates.io
    const skip = ecosystem === 'crates.io' && !current?.fromRegistry
    if (current?.name && current.version && !skip) {
      deps.push({ name: current.name, version: current.version, ecosystem, manifest, dev: current.dev })
    }
    current = null
  }

  for (const line of lines(content)) {
    if (line.startsWith('[')) {
      if (line.trim() === '[[package]]') {
        flush()
        current = {}
      } else if (!line.startsWith('[package.')) {
        // poetry.lock has [package.dependencies] etc. inside a package, anything else ends it
        flush()
      }
      continue
    }
    if (!current) continue

    const [, key, value] = line.match(/^(\w+)\s*=\s*(.+)$/) ?? []
    if (key === 'name') current.name = ecosystem === 'PyPI' ? unquote(value).toLowerCase() : unquote(value)
    else if (key === 'version') current.version = unquote(value)
    else if (key === 'category') current.dev = unquote(value) === 'dev'
    else if (key === 'source') current.fromRegistry = value.includes('registry+')
  }
  flush()
  return deps
}

// ---------- Go ----------

function parseGoMod(content: string, manifest: string): Dependency[] {
  const deps: Dependency[] = []
  let inRequireBlock = false

  for (const raw of lines(content)) {
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

// ---------- Ruby ----------

function parseGemfileLock(content: string, manifest: string): Dependency[] {
  const deps: Dependency[] = []
  let section = ''

  for (const line of lines(content)) {
    if (/^\S/.test(line)) {
      section = line.trim()
      continue
    }
    if (section !== 'GEM') continue

    // Top-level gems are indented four spaces, their own dependencies six
    const match = line.match(/^ {4}([^\s(]+) \(([^)]+)\)$/)
    if (match) {
      // drop platform suffixes like "-x86_64-linux"
      const version = match[2].replace(/-(?:x86|arm|aarch|java|universal|x64|mingw|darwin).*$/, '')
      deps.push({ name: match[1], version, ecosystem: 'RubyGems', manifest })
    }
  }
  return deps
}

// ---------- PHP ----------

function parseComposerLock(content: string, manifest: string): Dependency[] {
  const lock = JSON.parse(content)
  const deps: Dependency[] = []

  for (const [section, dev] of [['packages', false], ['packages-dev', true]] as const) {
    for (const pkg of lock[section] ?? []) {
      if (!pkg?.name || typeof pkg.version !== 'string' || pkg.version.startsWith('dev-')) continue
      deps.push({ name: pkg.name, version: pkg.version.replace(/^v/, ''), ecosystem: 'Packagist', manifest, dev })
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
