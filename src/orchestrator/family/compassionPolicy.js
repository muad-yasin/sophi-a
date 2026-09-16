// Sophi-A seat-owned families, F2 (relay/Docs/SophiA-Seat-Families-Plan.md §2.6, revised by the
// build-ready council review relay/runs/2026-09-15T19-57-10-287Z/deliverable.md §a Q2 and §d
// item 1). Pure `decide()`: given a session's compassion state and its recent history, which
// responses are permitted. No I/O, no clock read internally (a `taskHash` is supplied by the
// caller, not computed from a live clock), no model call - the seed principle turned into a line
// of code, not a sentiment.
//
// `compassionStates.js`'s `classify()` is deliberately untouched by this file - not imported,
// not edited, `git diff` on compassionStates.js for this branch is empty, per F2's own
// acceptance test. `decide()`'s `state` parameter is one of classify()'s three compassion-state
// names, but the two functions are otherwise independent: classify() decides WHICH state a run
// record is in; decide() decides WHAT is permitted once it's in one of the three.
import { createHash } from 'node:crypto';

/** Deterministic hash of a task's text, for comparing "is this the same task as last time." */
export function hashTask(text) {
  return createHash('sha256').update(text ?? '').digest('hex');
}

const KNOWN_STATES = ['failed-owned', 'stuck', 'holdout'];

// §2.6 rule 7: "No blame, lazy, stupid, punish, retry until, or model-identity attack anywhere
// in family copy." The literal, checkable subset of that rule (everything except the
// "model-identity attack" clause, which test/compassion-states.test.mjs checks separately by
// asserting no provider/vendor name appears in the copy file at all). Exported so
// compassion-states.test.mjs (compassionCopy.js's own string test) and this file's own reason
// strings are checked against the exact same list - one list, not two that could drift.
export const BANNED_COMPASSION_WORDS = ['blame', 'lazy', 'stupid', 'punish', 'retry until'];

/**
 * @typedef {Object} DecideParams
 * @property {'failed-owned'|'stuck'|'holdout'} state - classify()'s output; `decide()` is only
 *   meaningful for the three compassion states, never 'success' (a successful/idle session has
 *   nothing to decide - the caller simply dispatches the next turn).
 * @property {number} failedOwnedCountOnPlanItem - total `failed-owned` events recorded for this
 *   session's `planItem` so far, INCLUDING the failure being decided right now (1 = first
 *   failure, 2+ = second or later). Only read when `state === 'failed-owned'`.
 * @property {string|null} lastTaskHash - `hashTask()` of the task text that produced the failure
 *   being decided (or the task the session is currently stuck/holding out on).
 * @property {string|null} proposedTaskHash - `hashTask()` of the task text about to be proposed
 *   for the next dispatch.
 * @property {string[]} proposedContextAdded - filenames added to `context/` since the failure
 *   (or since the last dispatch, for stuck/holdout) - a non-empty list also satisfies "the
 *   family changed what it gave," independent of the task text changing.
 * @property {boolean} humanPresent - accepted per the plan's own §2.6 signature; not read by
 *   this version's logic. `close` is always a UI-only action, independent of `decide()`
 *   entirely (council Q2: "a human may still close a needs-human session by hand at any time via
 *   the UI, independent of decide()") - so nothing in this function branches on it. Kept in the
 *   contract, not dropped, because F7 (lifecycle integration, a different session's build) calls
 *   `decide()` against this exact named signature; removing an unused parameter here would
 *   silently break that contract rather than leave a documented no-op.
 */

/**
 * @param {DecideParams} params
 * @returns {{allowed: string[], refused: {action: string, reason: string}[]}}
 */
export function decide(params) {
  const {
    state,
    failedOwnedCountOnPlanItem = 0,
    lastTaskHash = null,
    proposedTaskHash = null,
    proposedContextAdded = [],
  } = params || {};

  if (!KNOWN_STATES.includes(state)) {
    throw new Error(`compassionPolicy.decide: unknown state "${state}" - expected one of ${KNOWN_STATES.join(', ')}`);
  }

  // Rule 4 (revised, council Q2 / deliverable §d item 1): the second (or any later) owned
  // failure on the same plan item is decided BEFORE the restart-with-context check below -
  // once a second failure has happened, no amount of "the family changed what it gave" earns
  // another automated restart. `close` is never offered here (Q2's own reasoning: it is a
  // UI-only action, never something an LLM owner seat can select on its own) - a human closes
  // independently of this function, not through an option it returned.
  if (state === 'failed-owned' && failedOwnedCountOnPlanItem >= 2) {
    return {
      allowed: ['escalate-to-human'],
      refused: [{ action: 'restart-with-context', reason: 'second-owned-failure-escalates' }],
    };
  }

  // Rule 2: restart-with-context is allowed only if the family changed what it gave - a
  // different task, or at least one new context file. An identical re-dispatch (same task text,
  // nothing added to context/) is refused by name, never silently permitted.
  const familyChangedSomething = proposedTaskHash !== lastTaskHash || (proposedContextAdded && proposedContextAdded.length > 0);

  if (state === 'failed-owned') {
    // failedOwnedCountOnPlanItem is 0 or 1 here (>= 2 already returned above) - the first owned
    // failure on this plan item.
    if (familyChangedSomething) {
      return { allowed: ['restart-with-context'], refused: [] };
    }
    return {
      allowed: [],
      refused: [{ action: 'restart-with-context', reason: 'identical-redispatch-refused' }],
    };
  }

  if (state === 'stuck') {
    // Rule 5: unchanged from the MVP - a human's plain choice, no context-change gate (a stuck
    // session has no known error to avoid blindly repeating; it simply hasn't produced output).
    return { allowed: ['wait', 'stop', 'restart'], refused: [] };
  }

  // state === 'holdout'. Rule 6: "the objection is the added context" - restart-with-context is
  // the intended response, gated by the same familyChangedSomething check as failed-owned (a
  // holdout's own recorded objection, handed to the member as new context/ content, is exactly
  // what satisfies "the family changed what it gave"). `close` is not offered here either, for
  // the same reason as above - the plan's own §2.6 rule 6 text names `close` as a human-available
  // response to a holdout, but Q2's later, binding reasoning ("close is a UI-only human action
  // and must never appear as something an LLM owner seat can select on its own... independent of
  // decide()") generalizes past the one state it was stated for. Read as the resolving authority
  // here, documented rather than silently applied - a human can still close a holdout session by
  // hand via the UI at any time, exactly as for needs-human, just never through this function's
  // own `allowed` list.
  if (familyChangedSomething) {
    return { allowed: ['restart-with-context'], refused: [] };
  }
  return {
    allowed: [],
    refused: [{ action: 'restart-with-context', reason: 'identical-redispatch-refused' }],
  };
}
