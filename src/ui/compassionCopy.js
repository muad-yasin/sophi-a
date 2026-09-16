// Sophi-A "family" MVP polish, item 4 (relay/runs/2026-09-15T18-55-34-601Z/build.md §4): fixed,
// test-pinned copy for the three compassion states. Every string here is checked by
// test/compassion-states.test.mjs to contain none of the named non-blaming-language violations -
// this file is the one place that check reads from, so a future edit can't drift the copy away
// from what the test actually enforces.
//
// Generalizes a real near-miss already on record in this repo's own DECISIONS.md (caught and
// disclosed immediately, not hidden) into a visible, permanent product mechanism: a failure is
// always shown verbatim, with a name and a reveal action, never retried silently and never
// summarized into something vaguer than what actually happened.

export const COMPASSION_COPY = {
  'failed-owned': {
    color: 'amber',
    label: 'Stopped on its own',
    summary: 'Stopped on its own; error preserved verbatim, nothing retried silently.',
    revealActionLabel: 'Show Receipt',
  },
  stuck: {
    color: 'blue',
    label: 'Stuck',
    // Bug fix, 2026-09-16 (caught by an independent overnight bug-audit pass, verified directly
    // against this file): this literally said "No output for X minutes" - an unfilled
    // placeholder, not real copy. 5 minutes mirrors compassionStates.js's own
    // STUCK_THRESHOLD_SECS (300s, itself a named placeholder pending playtest tuning) - keep the
    // two in sync by hand until they're unified into one shared constant.
    summary: 'No output for 5 minutes; the human chooses: wait, stop, or restart.',
    revealActionLabel: null, // no reveal action - STUCK has no verbatim artifact yet, only a choice
  },
  holdout: {
    color: 'purple',
    label: 'Holdout',
    summary: 'This critic did not sign off; its dissent is recorded in full.',
    revealActionLabel: 'Show Reason',
  },
};

export const COMPASSION_STATES = Object.keys(COMPASSION_COPY);
