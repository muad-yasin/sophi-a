// test/messages-api-timeout.test.mjs
//
// Security-review fixes #7+#8 (src/orchestrator/adapters/messagesApi.js):
// #7 - the old per-call timeout only flipped a boolean, checked AFTER the awaited provider call
//      had already resolved. A genuinely hung call never resolves, so the flag was never read
//      and the seat blocked forever - the "timed out" emit only ever fired on the narrow race
//      where the call happened to resolve a moment after the timer already fired.
// #8 - the timeout duration was a hardcoded 300_000ms constant, ignoring seatConfig.timeout_ms
//      entirely (advisor declares 120000 in seats.json; the old code always used 300000).
//
// These tests exercise the two pure helpers the fix extracted (resolveSeatTimeoutMs,
// raceWithTimeout) directly - no provider, no network, no relay import. This is a deliberate
// scope boundary, not a shortcut: startMessagesApiSeat's own isAllowedProvider check rejects
// relay's 'mock' provider (it's not in ALLOWED_PROVIDERS), so a full end-to-end test through
// startMessagesApiSeat itself would require either a real provider call or extending the
// allowlist - neither of which this offline, zero-real-API-call fix should do. The two helpers
// are exactly the mechanism that was broken and fixed, so testing them directly proves the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSeatTimeoutMs, raceWithTimeout } from '../src/orchestrator/adapters/messagesApi.js';

test('resolveSeatTimeoutMs: uses the seat\'s own live timeout_ms when present (fixes #8)', () => {
  assert.equal(resolveSeatTimeoutMs({ timeout_ms: 120000 }), 120000);
  assert.equal(resolveSeatTimeoutMs({ timeout_ms: 5000 }), 5000);
});

test('resolveSeatTimeoutMs: falls back to the 300s default only when timeout_ms is genuinely absent', () => {
  assert.equal(resolveSeatTimeoutMs({}), 300000);
  assert.equal(resolveSeatTimeoutMs({ model: 'x' }), 300000);
});

test('resolveSeatTimeoutMs: a non-numeric timeout_ms is not silently accepted as valid', () => {
  assert.equal(resolveSeatTimeoutMs({ timeout_ms: 'not-a-number' }), 300000);
  assert.equal(resolveSeatTimeoutMs({ timeout_ms: null }), 300000);
  assert.equal(resolveSeatTimeoutMs({ timeout_ms: NaN }), 300000);
});

test('raceWithTimeout: a promise that resolves before the timeout wins normally', async () => {
  const fast = Promise.resolve({ text: 'hi' });
  const result = await raceWithTimeout(fast, 5000, 'should not fire');
  assert.deepEqual(result, { text: 'hi' });
});

test('raceWithTimeout: a promise that NEVER resolves is genuinely unblocked by the timeout (fixes #7)', async () => {
  // The exact defect: the old code awaited a hung call directly, so this exact shape (a promise
  // that never settles) would have hung the whole test/process forever. This must resolve
  // (reject, specifically) well within the test runner's own timeout.
  const hung = new Promise(() => {}); // never resolves, never rejects - simulates a hung provider call
  const start = Date.now();
  await assert.rejects(
    raceWithTimeout(hung, 30, 'simulated hang timed out after 0.03s'),
    /simulated hang timed out after 0.03s/,
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `expected the race to unblock within ~30ms, took ${elapsed}ms`);
});

test('raceWithTimeout: the timeout rejection carries isTimeout:true, matching the caller\'s existing branch', async () => {
  const hung = new Promise(() => {});
  try {
    await raceWithTimeout(hung, 20, 'x');
    assert.fail('expected a rejection');
  } catch (err) {
    assert.equal(err.isTimeout, true);
  }
});

test('raceWithTimeout: a hung promise that later rejects on its own never surfaces as an unhandled rejection', async () => {
  // Proves the orphaned-promise safety note in the fix: once the timeout wins the race, the
  // original promise is detached but still running - if it later rejects on its own (e.g. the
  // provider connection eventually errors out), that must not escape as an unhandled rejection
  // that could crash the orchestrator process.
  let sawUnhandledRejection = false;
  const onUnhandled = () => { sawUnhandledRejection = true; };
  process.on('unhandledRejection', onUnhandled);
  try {
    let rejectLate;
    const eventuallyRejects = new Promise((_, reject) => { rejectLate = reject; });
    await assert.rejects(raceWithTimeout(eventuallyRejects, 10, 'timed out'));
    rejectLate(new Error('the provider connection finally errored out, long after we stopped waiting'));
    // Give the event loop a tick to surface any unhandled rejection, if the fix's .catch(() => {})
    // were ever removed.
    await new Promise(r => setTimeout(r, 20));
    assert.equal(sawUnhandledRejection, false);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});
