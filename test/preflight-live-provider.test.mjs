// test/preflight-live-provider.test.mjs
//
// Security-review fix: checkSeatReadiness read seats.json's STATIC `requires` field, while the
// real dispatch path (effectiveInvocationMode + messagesApi.js) reads the LIVE `seat.provider`
// field, which index.js's `configure` command mutates in place on cnc/advisor. After a provider
// reconfiguration, readiness could wrongly block a seat that's actually fine, or wrongly pass one
// that's actually missing its new provider's key. The fix (liveRequirement in preflight.js)
// derives the checked requirement from the same live fields the dispatch path uses, for any seat
// that carries a `provider` field at all; seats with no `provider` field (plan-1..3, build-1..3)
// are untouched and still read their static `requires` list.
//
// These tests are pure/offline: liveRequirement() does no I/O, and the checkSeatReadiness cases
// below use a MISSING env var, which checkEnv() rejects before ever calling loadProviders()'s
// real network `call()` - never a live API call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveRequirement, checkSeatReadiness } from '../src/orchestrator/preflight.js';
import { engineEnvFiles } from '../src/orchestrator/enginePath.js';
import { root } from '../src/orchestrator/index.js';

// checkEnv() (preflight.js) reloads relay's real .env file(s) on disk via loadProviders(), and
// only fills a var IF IT'S CURRENTLY UNSET (first-definition-wins) - so `delete
// process.env.OPENAI_API_KEY` in a test does not reliably keep it unset if a real key for that
// exact name is configured in relay's own .env on this machine; it gets silently refilled from
// disk and the test would go on to attempt a genuine network call with a real key. Checked once,
// used to skip (never silently pass) the one test below that would otherwise be at risk.
function envFileHasRealValueFor(varName) {
  for (const envPath of engineEnvFiles(root)) {
    let text;
    try { text = readFileSync(envPath, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === varName && m[2]) return true;
    }
  }
  return false;
}

test('liveRequirement: a seat with no provider field (plan-1..3, build-1..3) has nothing live to derive', () => {
  assert.equal(liveRequirement({ invocation_mode: 'relay-chain-subprocess' }), null);
  assert.equal(liveRequirement({ invocation_mode: 'claude-code-subprocess' }), null);
});

test('liveRequirement: provider anthropic on a claude-code-subprocess seat -> binary claude', () => {
  const req = liveRequirement({ invocation_mode: 'claude-code-subprocess', provider: 'anthropic' });
  assert.deepEqual(req, { type: 'binary', name: 'claude' });
});

test('liveRequirement: reconfigured to a NON-anthropic provider -> env for THAT provider, not the original binary', () => {
  // This is the exact bug: seats.json's static requires for `cnc` says {type:'binary',
  // name:'claude'} - but after a live reconfigure to openai, the real dispatch path falls back
  // to messages-api and needs OPENAI_API_KEY, not the claude binary.
  const req = liveRequirement({ invocation_mode: 'claude-code-subprocess', provider: 'openai' });
  assert.deepEqual(req, { type: 'env', name: 'OPENAI_API_KEY' });
});

test('liveRequirement: advisor reconfigured across several providers each derive their own real env var', () => {
  assert.deepEqual(
    liveRequirement({ invocation_mode: 'messages-api', provider: 'mistral' }),
    { type: 'env', name: 'MISTRAL_API_KEY' },
  );
  assert.deepEqual(
    liveRequirement({ invocation_mode: 'messages-api', provider: 'deepseek' }),
    { type: 'env', name: 'DEEPSEEK_API_KEY' },
  );
  assert.deepEqual(
    liveRequirement({ invocation_mode: 'messages-api', provider: 'anthropic' }),
    { type: 'env', name: 'ANTHROPIC_API_KEY' },
  );
});

test('checkSeatReadiness: a seat with no provider field still uses its static requires unchanged', async () => {
  // Deliberately NOT a real provider's env var name (ANTHROPIC_API_KEY, etc.) - loadProviders()
  // inside checkEnv() reloads relay's own .env on disk, and a machine with a real key configured
  // there would make this test attempt a genuine network call to a paid API the moment the env
  // var read early-return didn't fire. A synthetic name no real config file will ever set proves
  // the same "static requires used unchanged" behavior with zero chance of that.
  const seat = { invocation_mode: 'relay-chain-subprocess', requires: [{ type: 'env', name: 'TOTALLY_SYNTHETIC_UNUSED_KEY_NAME' }] };
  assert.equal(process.env.TOTALLY_SYNTHETIC_UNUSED_KEY_NAME, undefined, 'test precondition: this name must not be a real env var on this machine');
  const result = await checkSeatReadiness('plan-1', seat);
  assert.equal(result.status, 'error');
  assert.equal(result.error.type, 'auth');
  assert.match(result.error.detail, /TOTALLY_SYNTHETIC_UNUSED_KEY_NAME is not set/);
});

test('checkSeatReadiness: cnc reconfigured to openai is checked against OPENAI_API_KEY, not the stale static claude-binary requirement', async (t) => {
  if (envFileHasRealValueFor('OPENAI_API_KEY')) {
    // A real key for this exact name is configured on disk - deleting process.env.OPENAI_API_KEY
    // would just get silently refilled from it by loadProviders(), and this test would go on to
    // attempt a genuine network call. Skip rather than risk that; the pure liveRequirement test
    // above already proves the derivation ('openai' -> {type:'env', name:'OPENAI_API_KEY'})
    // without any I/O, so the mapping itself is still covered on every machine either way.
    t.skip('a real OPENAI_API_KEY is configured in this environment - skipping to avoid a live network call; see the liveRequirement unit test above for offline coverage of the same mapping');
    return;
  }
  // seats.json's real `requires` for cnc is [{type:'binary', name:'claude'}] - simulate exactly
  // that stale static field alongside a live provider that has since been reconfigured, the
  // real shape index.js's `configure` command produces on the same in-memory seat object.
  const seat = {
    invocation_mode: 'claude-code-subprocess',
    provider: 'openai',
    requires: [{ type: 'binary', name: 'claude' }],
  };
  const before = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await checkSeatReadiness('cnc', seat);
    assert.equal(result.status, 'error');
    // Proves the check ran against the LIVE provider's env var, not the stale static binary
    // requirement (which would either report 'missing_cli' or 'ready' depending on whether
    // `claude` happens to be on this machine's PATH - an assertion on that would be
    // environment-dependent and prove nothing about which requirement was actually checked).
    assert.equal(result.error.type, 'auth');
    assert.match(result.error.detail, /OPENAI_API_KEY is not set/);
  } finally {
    if (before !== undefined) process.env.OPENAI_API_KEY = before;
  }
});
