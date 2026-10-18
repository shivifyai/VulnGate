import type { Verdict } from '../types'

export const VERDICT_LABELS: Record<Verdict, { label: string; hint: string }> = {
  confirmed: { label: 'Confirmed', hint: 'OSV and Dependabot both report this' },
  unreported: { label: 'Missed by GitHub', hint: 'OSV reports it, but there is no open Dependabot alert' },
  stale: { label: 'Likely stale', hint: 'Dependabot alert is open, but the installed version is not affected' },
  detected: { label: 'Detected', hint: 'Found in OSV. Add a token to cross-check against Dependabot' },
}
