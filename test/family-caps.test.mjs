// test/family-caps.test.mjs
//
// Sophi-A seat-owned families, F4 (relay/Docs/SophiA-Seat-Families-Plan.md §2.8, tightened by
// relay/runs/2026-09-15T19-57-10-287Z/deliverable.md §d item 5). Pure admit() - fully offline,
// no subprocess, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { admit } from '../src/orchestrator/family/familyCaps.js';

const generous = { maxConcurrentSessions: 100, spendCeilingUsd: 1000, activeCount: 0 };
const zeroSpends = { family: 0, seat: 0, global: 0 };
const noEstimate = { perTurnUsd: 0, hasUnpricedSpend: false };

test('admit: everything generous, full requested count admitted, no binding level', () => {
  const result = admit({
    requested: 3,
    family: generous, seat: generous, global: generous,
    spends: zeroSpends, estimates: noEstimate,
  });
  assert.deepEqual(result, { count: 3, level: null, notice: null });
});

test('admit: the peer-pool plan\'s own worked example - spent $4.99, cap $5.00, two candidates at $0.02 each admits exactly 1', () => {
  const result = admit({
    requested: 2,
    family: { maxConcurrentSessions: 10, spendCeilingUsd: 5.00, activeCount: 0 },
    seat: generous, global: generous,
    spends: { family: 4.99, seat: 0, global: 0 },
    estimates: { perTurnUsd: 0.02, hasUnpricedSpend: false },
  });
  assert.equal(result.count, 1);
  assert.equal(result.level, 'family');
  assert.match(result.notice, /Family cap reached, dispatching 1 of 2/);
});

test('admit: spent exactly at the ceiling ($5.00 of $5.00) admits 0', () => {
  const result = admit({
    requested: 2,
    family: { maxConcurrentSessions: 10, spendCeilingUsd: 5.00, activeCount: 0 },
    seat: generous, global: generous,
    spends: { family: 5.00, seat: 0, global: 0 },
    estimates: { perTurnUsd: 0.02, hasUnpricedSpend: false },
  });
  assert.equal(result.count, 0);
  assert.equal(result.level, 'family');
});

test('admit: concurrency cap binds - family allows only 1 concurrent slot, requesting 3', () => {
  const result = admit({
    requested: 3,
    family: { maxConcurrentSessions: 1, spendCeilingUsd: 1000, activeCount: 0 },
    seat: generous, global: generous,
    spends: zeroSpends, estimates: noEstimate,
  });
  assert.equal(result.count, 1);
  assert.equal(result.level, 'family');
});

test('admit: concurrency cap accounts for sessions already active at that level', () => {
  const result = admit({
    requested: 3,
    family: { maxConcurrentSessions: 4, spendCeilingUsd: 1000, activeCount: 2 },
    seat: generous, global: generous,
    spends: zeroSpends, estimates: noEstimate,
  });
  // 4 - 2 already active = 2 slots free, requested 3 -> admits 2
  assert.equal(result.count, 2);
  assert.equal(result.level, 'family');
});

test('admit: the tightest level among family/seat/global wins, even if it is seat or global, not family', () => {
  const seatTight = { maxConcurrentSessions: 100, spendCeilingUsd: 0.10, activeCount: 0 };
  const result = admit({
    requested: 5,
    family: generous, seat: seatTight, global: generous,
    spends: { family: 0, seat: 0, global: 0 },
    estimates: { perTurnUsd: 0.05, hasUnpricedSpend: false },
  });
  assert.equal(result.count, 2); // 0.10 / 0.05 = 2 fit before reaching the ceiling
  assert.equal(result.level, 'seat');
  assert.match(result.notice, /Seat cap reached/);
});

test('admit: global is the tightest level', () => {
  const globalTight = { maxConcurrentSessions: 100, spendCeilingUsd: 0.03, activeCount: 0 };
  const result = admit({
    requested: 5,
    family: generous, seat: generous, global: globalTight,
    spends: { family: 0, seat: 0, global: 0 },
    estimates: { perTurnUsd: 0.03, hasUnpricedSpend: false },
  });
  assert.equal(result.count, 1);
  assert.equal(result.level, 'global');
  assert.match(result.notice, /Global cap reached/);
});

test('admit: unpriced spend present disables $ headroom entirely, falls through to concurrency-only, once', () => {
  const result = admit({
    requested: 5,
    family: { maxConcurrentSessions: 3, spendCeilingUsd: 0.01, activeCount: 0 }, // would refuse almost everything on $ alone
    seat: generous, global: generous,
    spends: { family: 999, seat: 0, global: 0 }, // wildly over the $ ceiling - must be ignored
    estimates: { perTurnUsd: 0.02, hasUnpricedSpend: true },
  });
  // $ ceiling is blown (999 > 0.01) but must be irrelevant here - only concurrency (3) applies.
  assert.equal(result.count, 3);
  assert.equal(result.level, 'family');
  assert.equal(result.notice, 'unpriced spend present; $ headroom unavailable');
});

test('admit: unpriced spend + fully generous concurrency admits the full requested count, still with the unpriced notice, but level null', () => {
  const result = admit({
    requested: 3,
    family: generous, seat: generous, global: generous,
    spends: zeroSpends,
    estimates: { perTurnUsd: 0, hasUnpricedSpend: true },
  });
  assert.equal(result.count, 3);
  assert.equal(result.level, null);
  assert.equal(result.notice, 'unpriced spend present; $ headroom unavailable');
});

test('admit: unpriced spend degradation is permanent for the call - a caller passing hasUnpricedSpend:true after later priced turns still gets no $ headroom (this function never clears the flag itself, by design - it has no memory to clear)', () => {
  // admit() is stateless; this test documents the contract rather than exercising persistence
  // (persistence of the flag across a family's lifetime is a different module's job - see
  // DECISIONS.md). Calling it twice with the same hasUnpricedSpend:true input produces the same
  // degraded result both times, proving there is no internal state that could accidentally clear.
  const params = {
    requested: 2,
    family: generous, seat: generous, global: generous,
    spends: zeroSpends,
    estimates: { perTurnUsd: 0, hasUnpricedSpend: true },
  };
  const first = admit(params);
  const second = admit(params);
  assert.deepEqual(first, second);
  assert.equal(first.notice, 'unpriced spend present; $ headroom unavailable');
});

test('admit: a needs-human session\'s past spend is honored simply because the caller included it in `spends` - admit() does not special-case session state', () => {
  // §2.8: "a stopped or needs-human session still counts its past spend." admit() has no
  // concept of session state at all - it only ever sees aggregate numbers - so this rule is
  // satisfied entirely by what the caller sums into `spends`, not by any logic in this file.
  // This test proves admit() treats a `spends.family` total the same regardless of *why* it
  // accrued (still-running sessions vs needs-human vs closed) - the number is the number.
  const withNeedsHumanSpend = admit({
    requested: 1,
    family: { maxConcurrentSessions: 10, spendCeilingUsd: 1.00, activeCount: 0 },
    seat: generous, global: generous,
    spends: { family: 1.00, seat: 0, global: 0 }, // includes a needs-human session's $1.00 spend, already at the ceiling
    estimates: { perTurnUsd: 0.02, hasUnpricedSpend: false },
  });
  assert.equal(withNeedsHumanSpend.count, 0, 'the needs-human session\'s prior spend correctly reduces headroom for new admissions');
});

test('admit: requesting 0 always admits 0 with no binding level', () => {
  const result = admit({
    requested: 0,
    family: generous, seat: generous, global: generous,
    spends: zeroSpends, estimates: noEstimate,
  });
  assert.deepEqual(result, { count: 0, level: null, notice: null });
});

// gp-77's real Fable-5.1 security review (2026-09-15) flagged that unvalidated requested/
// perTurnUsd/cap/spend numbers reach peersWithinSpendCeiling()'s own while-loop, which is
// bounded only by requestedCount - a huge, negative, or NaN input degrades to a long spin or a
// silently wrong count rather than a clear error. Fixed by validating every numeric input up
// front and failing loud; these tests prove the guard fires before any admission arithmetic runs.
test('admit: throws on a negative requested count', () => {
  assert.throws(() => admit({ requested: -1, family: generous, seat: generous, global: generous, spends: zeroSpends, estimates: noEstimate }), /requested must be a finite number/);
});

test('admit: throws on a non-finite requested count (NaN, Infinity)', () => {
  assert.throws(() => admit({ requested: NaN, family: generous, seat: generous, global: generous, spends: zeroSpends, estimates: noEstimate }));
  assert.throws(() => admit({ requested: Infinity, family: generous, seat: generous, global: generous, spends: zeroSpends, estimates: noEstimate }));
});

test('admit: throws on a negative perTurnUsd estimate', () => {
  assert.throws(() => admit({
    requested: 1, family: generous, seat: generous, global: generous,
    spends: zeroSpends, estimates: { perTurnUsd: -0.01, hasUnpricedSpend: false },
  }), /perTurnUsd must be a finite number/);
});

test('admit: throws on a negative or non-finite cap-level field (maxConcurrentSessions, spendCeilingUsd, activeCount)', () => {
  assert.throws(() => admit({
    requested: 1, family: { maxConcurrentSessions: -1, spendCeilingUsd: 1, activeCount: 0 }, seat: generous, global: generous,
    spends: zeroSpends, estimates: noEstimate,
  }), /family\.maxConcurrentSessions must be a finite number/);
  assert.throws(() => admit({
    requested: 1, family: generous, seat: { maxConcurrentSessions: 1, spendCeilingUsd: NaN, activeCount: 0 }, global: generous,
    spends: zeroSpends, estimates: noEstimate,
  }), /seat\.spendCeilingUsd must be a finite number/);
  assert.throws(() => admit({
    requested: 1, family: generous, seat: generous, global: { maxConcurrentSessions: 1, spendCeilingUsd: 1, activeCount: -5 },
    spends: zeroSpends, estimates: noEstimate,
  }), /global\.activeCount must be a finite number/);
});

test('admit: throws on a negative or non-finite spends field', () => {
  assert.throws(() => admit({
    requested: 1, family: generous, seat: generous, global: generous,
    spends: { family: -0.01, seat: 0, global: 0 }, estimates: noEstimate,
  }), /spends\.family must be a finite number/);
});
