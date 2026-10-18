import { describe, expect, it } from 'vitest'
import { parseRepoInput } from './github'
import { dedupe, parseManifest, pickManifests } from './manifests'
import { fixedVersionFor, severityOf } from './osv'
import { atLeast, cvss3Score } from './severity'
import { compareVersions } from './version'

describe('parseRepoInput', () => {
  it('understands the usual ways people paste a repo', () => {
    expect(parseRepoInput('facebook/react')).toBe('facebook/react')
    expect(parseRepoInput('https://github.com/facebook/react')).toBe('facebook/react')
    expect(parseRepoInput('https://github.com/facebook/react.git/')).toBe('facebook/react')
    expect(parseRepoInput('https://github.com/facebook/react/tree/main/packages')).toBe('facebook/react')
  })

  it('rejects junk', () => {
    expect(parseRepoInput('react')).toBeNull()
    expect(parseRepoInput('')).toBeNull()
    expect(parseRepoInput('foo/bar baz')).toBeNull()
  })
})

describe('pickManifests', () => {
  it('prefers lockfiles and ignores vendored code', () => {
    const picked = pickManifests([
      'package.json',
      'package-lock.json',
      'web/package.json',
      'node_modules/lodash/package.json',
      'api/requirements.txt',
      'vendor/x/go.mod',
      'README.md',
    ])
    expect(picked).toEqual(['api/requirements.txt', 'package-lock.json', 'web/package.json'])
  })
})

describe('manifest parsers', () => {
  it('reads package-lock v3', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'app', version: '1.0.0' },
        'node_modules/lodash': { version: '4.17.20' },
        'node_modules/@babel/core': { version: '7.0.0', dev: true },
        'node_modules/a/node_modules/minimist': { version: '0.0.8' },
      },
    })
    const deps = parseManifest('package-lock.json', lock)
    expect(deps.map((d) => `${d.name}@${d.version}`)).toEqual([
      'lodash@4.17.20',
      '@babel/core@7.0.0',
      'minimist@0.0.8',
    ])
    expect(deps[1].dev).toBe(true)
  })

  it('reads package-lock v1', () => {
    const lock = JSON.stringify({
      lockfileVersion: 1,
      dependencies: { a: { version: '1.0.0', dependencies: { b: { version: '2.0.0' } } } },
    })
    expect(parseManifest('package-lock.json', lock).map((d) => d.name)).toEqual(['a', 'b'])
  })

  it('reads pinned requirements only', () => {
    const txt = `
# web stuff
Django==3.2.0
requests[security] == 2.19.1  # old on purpose
flask>=2
-r other.txt
urllib3===1.24.1 ; python_version < "3.8"
`
    expect(parseManifest('requirements.txt', txt).map((d) => `${d.name}@${d.version}`)).toEqual([
      'django@3.2.0',
      'requests@2.19.1',
      'urllib3@1.24.1',
    ])
  })

  it('reads go.mod require lines and blocks', () => {
    const mod = `module example.com/app

go 1.21

require github.com/gin-gonic/gin v1.6.0

require (
\tgolang.org/x/net v0.7.0 // indirect
\tgithub.com/docker/docker v20.10.0+incompatible
)
`
    expect(parseManifest('go.mod', mod).map((d) => `${d.name}@${d.version}`)).toEqual([
      'github.com/gin-gonic/gin@1.6.0',
      'golang.org/x/net@0.7.0',
      'github.com/docker/docker@20.10.0',
    ])
  })

  it('dedupe keeps the prod copy of a package', () => {
    const deps = dedupe([
      { name: 'a', version: '1.0.0', ecosystem: 'npm', manifest: 'x', dev: true },
      { name: 'a', version: '1.0.0', ecosystem: 'npm', manifest: 'y', dev: false },
    ])
    expect(deps).toHaveLength(1)
    expect(deps[0].dev).toBe(false)
  })
})

describe('versions and severity', () => {
  it('orders versions sensibly', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('2.0', '2.0.0')).toBe(0)
    expect(compareVersions('1.0.0+build.5', '1.0.0')).toBe(0)
  })

  it('scores CVSS 3 vectors like the NVD calculator', () => {
    expect(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8)
    expect(cvss3Score('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N')).toBe(6.1)
    expect(cvss3Score('CVSS:3.0/AV:L/AC:H/PR:H/UI:R/S:U/C:N/I:N/A:N')).toBe(0)
    expect(cvss3Score('CVSS:4.0/AV:N')).toBeNull()
  })

  it('compares against the gate threshold', () => {
    expect(atLeast('CRITICAL', 'HIGH')).toBe(true)
    expect(atLeast('MEDIUM', 'HIGH')).toBe(false)
    expect(atLeast('UNKNOWN', 'LOW')).toBe(false)
  })

  it('pulls severity and fix version out of an OSV record', () => {
    const vuln = {
      id: 'GHSA-xxxx',
      database_specific: { severity: 'MODERATE' },
      severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N' }],
      affected: [
        {
          package: { name: 'lodash', ecosystem: 'npm' },
          ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }, { introduced: '5.0.0' }, { fixed: '5.0.3' }] }],
        },
      ],
    }
    const dep = { name: 'lodash', version: '4.17.20', ecosystem: 'npm' as const, manifest: 'package-lock.json' }

    expect(severityOf(vuln)).toEqual({ severity: 'MEDIUM', score: 6.1 })
    expect(fixedVersionFor(vuln, dep)).toBe('4.17.21')
  })
})
