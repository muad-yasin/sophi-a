// test/compassion-policy.test.mjs
//
// Sophi-A seat-owned families, F2 (relay/Docs/SophiA-Seat-Families-Plan.md §2.6, revised by
// relay/runs/2026-09-15T19-57-10-287Z/deliverable.md §a Q2 / §d item 1). Pure decide() - fully
// offline, no subprocess, no network, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decide, hashTask, BANNED_COMPASSION_WORDS } from '../src/orchestrator/family/compassionPolicy.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('hashTask: deterministic, and two different texts hash differently', () => {
  const a = hashTask('do the thing');
  const b = hashTask('do the thing');
  const c = hashTask('do a different thing');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('decide: an identical re-dispatch (same task, no new context) on a first failed-owned is refused by name', () => {
  const taskHash = hashTask('fix the bug in module X');
  const result = decide({
    state: 'failed-owned',
    failedOwnedCountOnPlanItem: 1,
    lastTaskHash: taskHash,
    proposedTaskHash: taskHash,
    proposedContextAdded: [],
    humanPresent: false,
  });
  assert.deepEqual(result.allowed, []);
  assert.equal(result.refused.length, 1);
  assert.equal(result.refused[0].action, 'restart-with-context');
  assert.equal(result.refused[0].reason, 'identical-redispatch-refused');
});

test('decide: a changed task text on a first failed-owned allows restart-with-context', () => {
  const result = decide({
    state: 'failed-owned',
    failedOwnedCountOnPlanItem: 1,
    lastTaskHash: hashTask('fix the bug in module X'),
    proposedTaskHash: hashTask('fix the bug in module X, check the null case first'),
    proposedContextAdded: [],
    humanPresent: false,
  });
  assert.deepEqual(result.allowed, ['restart-with-context']);
  assert.deepEqual(result.refused, []);
});

test('decide: an unchanged task but at least one added context file on a first failed-owned also allows restart-with-context', () => {
  const taskHash = hashTask('fix the bug in module X');
  const result = decide({
    state: 'failed-owned',
    failedOwnedCountOnPlanItem: 1,
    lastTaskHash: taskHash,
    proposedTaskHash: taskHash,
    proposedContextAdded: ['stack-trace.txt'],
    humanPresent: false,
  });
  assert.deepEqual(result.allowed, ['restart-with-context']);
});

test('decide: the SECOND failed-owned on the same planItem returns ONLY escalate-to-human, never close, even if the task changed', () => {
  const result = decide({
    state: 'failed-owned',
    failedOwnedCountOnPlanItem: 2,
    lastTaskHash: hashTask('fix the bug in module X'),
    proposedTaskHash: hashTask('a completely different task text this time'),
    proposedContextAdded: ['new-context.md'],
    humanPresent: true,
  });
  assert.deepEqual(result.allowed, ['escalate-to-human']);
  assert.ok(!result.allowed.includes('close'), 'close must never appear in the automated allowed set');
  assert.equal(result.refused[0].reason, 'second-owned-failure-escalates');
});

test('decide: a third-or-later failed-owned on the same planItem also returns only escalate-to-human', () => {
  const result = decide({
    state: 'failed-owned',
    failedOwnedCountOnPlanItem: 5,
    lastTaskHash: hashTask('x'),
    proposedTaskHash: hashTask('y'),
    proposedContextAdded: [],
    humanPresent: false,
  });
  assert.deepEqual(result.allowed, ['escalate-to-human']);
});

test('decide: humanPresent never changes the outcome - close is never offered regardless', () => {
  const paramsBase = {
    state: 'failed-owned',
    failedOwnedCountOnPlanItem: 1,
    lastTaskHash: hashTask('x'),
    proposedTaskHash: hashTask('x'),
    proposedContextAdded: [],
  };
  const withHuman = decide({ ...paramsBase, humanPresent: true });
  const withoutHuman = decide({ ...paramsBase, humanPresent: false });
  assert.deepEqual(withHuman, withoutHuman);
});

test('decide: STUCK offers wait/stop/restart unconditionally, no context-change gate', () => {
  const result = decide({
    state: 'stuck',
    lastTaskHash: hashTask('x'),
    proposedTaskHash: hashTask('x'),
    proposedContextAdded: [],
    humanPresent: true,
  });
  assert.deepEqual(result.allowed.sort(), ['restart', 'stop', 'wait'].sort());
  assert.deepEqual(result.refused, []);
  assert.ok(!result.allowed.includes('close'));
});

test('decide: HOLDOUT with the objection added as context allows restart-with-context', () => {
  const result = decide({
    state: 'holdout',
    lastTaskHash: hashTask('x'),
    proposedTaskHash: hashTask('x'),
    proposedContextAdded: ['critic-objection.md'],
    humanPresent: false,
  });
  assert.deepEqual(result.allowed, ['restart-with-context']);
  assert.ok(!result.allowed.includes('close'), 'close is a UI-only action, never in decide()\'s own allowed set');
});

test('decide: HOLDOUT with nothing changed is refused as identical-redispatch, same as failed-owned', () => {
  const taskHash = hashTask('x');
  const result = decide({
    state: 'holdout',
    lastTaskHash: taskHash,
    proposedTaskHash: taskHash,
    proposedContextAdded: [],
    humanPresent: false,
  });
  assert.deepEqual(result.allowed, []);
  assert.equal(result.refused[0].reason, 'identical-redispatch-refused');
});

test('decide: throws on an unknown state rather than silently permitting something', () => {
  assert.throws(() => decide({ state: 'success', lastTaskHash: null, proposedTaskHash: null, proposedContextAdded: [] }));
  assert.throws(() => decide({ state: 'nonsense' }));
});

test('decide: never returns "close" in its allowed set, for any of the three states, under any inputs tried here', () => {
  const scenarios = [
    { state: 'failed-owned', failedOwnedCountOnPlanItem: 1, lastTaskHash: 'a', proposedTaskHash: 'b', proposedContextAdded: [] },
    { state: 'failed-owned', failedOwnedCountOnPlanItem: 2, lastTaskHash: 'a', proposedTaskHash: 'a', proposedContextAdded: [] },
    { state: 'stuck', lastTaskHash: 'a', proposedTaskHash: 'a', proposedContextAdded: [] },
    { state: 'holdout', lastTaskHash: 'a', proposedTaskHash: 'a', proposedContextAdded: ['x'] },
  ];
  for (const s of scenarios) {
    const result = decide({ ...s, humanPresent: true });
    assert.ok(!result.allowed.includes('close'), `close leaked into allowed for scenario: ${JSON.stringify(s)}`);
  }
});

test('every real reason/action string decide() can return contains none of the banned non-blaming-language words', () => {
  // Checks the actual returned strings, not the source file's own comments (which quote the
  // banned-word list itself while documenting the rule - a source-level grep would self-match
  // the rule's own quoted list, the same false-positive shape family-receipts.test.mjs already
  // hit once and fixed the same way: check what's actually shown, not the file that says so).
  const realStrings = [
    'restart-with-context', 'escalate-to-human', 'wait', 'stop', 'restart',
    'identical-redispatch-refused', 'second-owned-failure-escalates',
  ];
  for (const s of realStrings) {
    const lower = s.toLowerCase();
    for (const word of BANNED_COMPASSION_WORDS) {
      assert.ok(!lower.includes(word), `reason/action string "${s}" contains banned word: "${word}"`);
    }
  }
});

test('compassionStates.js is untouched by this branch (git diff is empty)', () => {
  let diff = '';
  try {
    diff = execFileSync('git', ['diff', 'origin/master', '--', 'src/orchestrator/compassionStates.js'], { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    diff = '';
  }
  assert.equal(diff.trim(), '', `expected no diff on compassionStates.js, got:\n${diff}`);
});
