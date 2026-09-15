// Sophi-A "family" MVP polish, item 4 (relay/runs/2026-09-15T18-55-34-601Z/build.md §4): a pure
// classifier over one run record, deciding which of three compassion states (or plain success)
// applies. No I/O, no model call, no side effect - the same "clock is injectable" rule
// backend-developer's rule 10 states: `now` is a parameter, never `Date.now()` read internally,
// so the STUCK threshold is verifiable with a fixed clock rather than a real 300-second wait.
//
// Contract for `runRecord` (the shape this module reads, not the shape any other module owns):
//   exitCode      number | null  - the run's process exit code; null means still running/unknown
//   lastOutputAt  number | null  - epoch ms of the run's last observed output; null means none yet
//   holdout       { provider: string, objections: string[] } | null
//                 - mirrors test/fixtures/mock-relay-chain.mjs's own `holdout` field shape
//                 exactly (that fixture's own header comment: "mirrors the real engine's
//                 report.json fields... not a new shape invented for this fixture") - this
//                 module reuses that same field name and shape rather than inventing a second one.
//
// Precedence, stated explicitly rather than left to read out of the code: a nonzero exit is the
// most urgent signal (the run definitely stopped, on its own, with an error) and wins over a
// holdout even if both are present on the same record. A holdout wins over STUCK, since a
// recorded dissent is a completed, known fact - "no output for a while" is only meaningful while
// still running. STUCK only ever applies to a run with no exit code yet.

export const STUCK_THRESHOLD_SECS = 300; // placeholder, explicitly tunable at playtest - build.md §4

/**
 * @param {{exitCode: number|null, lastOutputAt: number|null, holdout: {provider: string, objections: string[]}|null}} runRecord
 * @param {number} [now] - injectable clock, defaults to Date.now() only at the call boundary
 * @returns {'failed-owned'|'stuck'|'holdout'|'success'}
 */
export function classify(runRecord, now = Date.now()) {
  const { exitCode = null, lastOutputAt = null, holdout = null } = runRecord || {};

  if (typeof exitCode === 'number' && exitCode !== 0) return 'failed-owned';
  if (holdout) return 'holdout';
  if (exitCode === null && typeof lastOutputAt === 'number') {
    const idleSecs = (now - lastOutputAt) / 1000;
    if (idleSecs >= STUCK_THRESHOLD_SECS) return 'stuck';
  }
  return 'success';
}
