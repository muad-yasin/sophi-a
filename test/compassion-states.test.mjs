// test/compassion-states.test.mjs
//
// Item 4 of Sophi-A's "family" MVP polish (relay/runs/2026-09-15T18-55-34-601Z/build.md §4,
// handoff.md). Pure classifier + fixed copy - fully offline, no subprocess, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classify, STUCK_THRESHOLD_SECS } from '../src/orchestrator/compassionStates.js';
import { COMPASSION_COPY, COMPASSION_STATES } from '../src/ui/compassionCopy.js';
import { renderCompassionBadgeText } from '../src/ui/compassionBadge.js';
import { mockRelayChain } from './fixtures/mock-relay-chain.mjs';
// Extended per Sophi-A seat-owned families §2.6 rule 7 (relay/Docs/SophiA-Seat-Families-Plan.md):
// "No blame, lazy, stupid, punish, retry until, or model-identity attack anywhere in family
// copy." Exported from compassionPolicy.js so this one list is never duplicated - test/
// compassion-policy.test.mjs imports the same constant for its own reason-string check.
import { BANNED_COMPASSION_WORDS } from '../src/orchestrator/family/compassionPolicy.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const BANNED_WORDS = BANNED_COMPASSION_WORDS;

test('classify: a nonzero exit code classifies FAILED-OWNED', () => {
  const runRecord = { exitCode: 1, lastOutputAt: Date.now(), holdout: null };
  assert.equal(classify(runRecord), 'failed-owned');
});

test('classify: no exit code + last output 301s old classifies STUCK', () => {
  const now = 1_000_000_000_000;
  const runRecord = { exitCode: null, lastOutputAt: now - 301_000, holdout: null };
  assert.equal(classify(runRecord, now), 'stuck');
});

test('classify: last output exactly at the threshold (300s) also classifies STUCK - the boundary is inclusive', () => {
  const now = 1_000_000_000_000;
  const runRecord = { exitCode: null, lastOutputAt: now - STUCK_THRESHOLD_SECS * 1000, holdout: null };
  assert.equal(classify(runRecord, now), 'stuck');
});

test('classify: last output 299s old (just under the threshold) is still success, not STUCK', () => {
  const now = 1_000_000_000_000;
  const runRecord = { exitCode: null, lastOutputAt: now - 299_000, holdout: null };
  assert.equal(classify(runRecord, now), 'success');
});

test('classify: a relay holdout flag (from the real mockRelayChain one-holdout scenario) classifies HOLDOUT', () => {
  const { holdout } = mockRelayChain('one-holdout');
  assert.ok(holdout, 'the one-holdout scenario must actually carry a holdout');
  const runRecord = { exitCode: 0, lastOutputAt: Date.now(), holdout };
  assert.equal(classify(runRecord), 'holdout');
});

test('classify: the all-approve scenario (no holdout, clean exit) classifies success, not one of the three compassion states', () => {
  const { holdout } = mockRelayChain('all-approve');
  assert.equal(holdout, null);
  const runRecord = { exitCode: 0, lastOutputAt: Date.now(), holdout };
  assert.equal(classify(runRecord), 'success');
});

test('classify: a nonzero exit wins precedence over a simultaneous holdout - the more urgent signal', () => {
  const { holdout } = mockRelayChain('one-holdout');
  const runRecord = { exitCode: 1, lastOutputAt: Date.now(), holdout };
  assert.equal(classify(runRecord), 'failed-owned');
});

test('compassionCopy.js defines exactly the three named states, each with fixed copy', () => {
  assert.deepEqual(COMPASSION_STATES.sort(), ['failed-owned', 'holdout', 'stuck']);
  for (const state of COMPASSION_STATES) {
    const copy = COMPASSION_COPY[state];
    assert.equal(typeof copy.color, 'string');
    assert.equal(typeof copy.label, 'string');
    assert.equal(typeof copy.summary, 'string');
  }
});

test('compassionCopy.js contains none of the banned non-blaming-language violations', () => {
  const src = readFileSync(join(repoRoot, 'src', 'ui', 'compassionCopy.js'), 'utf8');
  const lower = src.toLowerCase();
  for (const word of BANNED_WORDS) {
    assert.ok(!lower.includes(word), `compassionCopy.js contains banned word: "${word}"`);
  }
});

// §2.6 rule 7's "model-identity attack" clause, checked as: family copy never names a specific
// provider/model as being at fault - approximated here by asserting no provider/vendor name
// appears in the copy at all, since this fixed copy has no legitimate reason to name one.
test('compassionCopy.js names no specific provider/model (the "model-identity attack" clause)', () => {
  const src = readFileSync(join(repoRoot, 'src', 'ui', 'compassionCopy.js'), 'utf8');
  const lower = src.toLowerCase();
  for (const vendor of ['deepseek', 'glm', 'mistral', 'qwen', 'kimi', 'gpt', 'claude', 'gemini', 'ollama']) {
    assert.ok(!lower.includes(vendor), `compassionCopy.js names a provider/model: "${vendor}"`);
  }
});

test('renderCompassionBadgeText renders a distinct, non-empty label for each of the three states - never a silent/blank badge', () => {
  const seen = new Set();
  for (const state of COMPASSION_STATES) {
    const text = renderCompassionBadgeText(state);
    assert.ok(text.length > 0);
    assert.ok(!seen.has(text), `duplicate badge text for state "${state}"`);
    seen.add(text);
  }
});

test('renderCompassionBadgeText throws on an unknown state rather than rendering a blank/default badge', () => {
  assert.throws(() => renderCompassionBadgeText('nonexistent-state'));
});
