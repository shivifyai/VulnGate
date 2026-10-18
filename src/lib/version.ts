// Loose version comparison. Good enough for semver, PEP 440 release numbers
// and Go module versions, which covers what we need to pick a "fixed in" version.
// It is not a full PEP 440 implementation.

function split(version: string) {
  // build metadata ("+abc") never affects ordering, so drop it first
  const core = version.replace(/^v/, '').split('+')[0]
  const dash = core.indexOf('-')
  const release = dash === -1 ? core : core.slice(0, dash)
  const pre = dash === -1 ? '' : core.slice(dash + 1)
  return { parts: release.split('.').map((n) => parseInt(n, 10) || 0), pre }
}

export function compareVersions(a: string, b: string): number {
  const va = split(a)
  const vb = split(b)
  const len = Math.max(va.parts.length, vb.parts.length)

  for (let i = 0; i < len; i++) {
    const diff = (va.parts[i] ?? 0) - (vb.parts[i] ?? 0)
    if (diff !== 0) return diff
  }

  // 1.0.0-beta comes before 1.0.0
  if (va.pre && !vb.pre) return -1
  if (!va.pre && vb.pre) return 1
  return va.pre.localeCompare(vb.pre, undefined, { numeric: true })
}
