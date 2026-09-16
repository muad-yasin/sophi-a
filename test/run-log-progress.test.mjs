// test/run-log-progress.test.mjs
//
// The plan-seat progress subtitle ("Round 2 of 3 · 1 objection open") is read out of relay's own
// run.log lines. These lines are copied from a real run.log (THCMCP runs/2026-09-16T08-43-50-872Z,
// the offline `mock` chain) and from chain.js's own log() calls - if relay ever changes a line
// shape, the field must go silent (null), never read a wrong number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProgress, foldProgress, foldProgressLines } from '../src/orchestrator/run-log-progress.js';

const REAL_MOCK_RUN = `council run 2026-09-16T08-43-50-872Z
chain: mock (2 round cap)
cap:   $5.00 per run (--max-usd)
task:  tasks/cnc-harness-family-plan-1-fam-council-s-0001-1789548230036.md

Stage: acceptance criteria
  criteria: mock/mock-criteria - 12 in, 44 out, $0.0000, 0.0s

Acceptance criteria (3):
  1. The deliverable is the artifact itself, not a plan for one.

Round 1: build
  build: mock/mock-builder - 65 in, 13 out, $0.0000, 0.0s

Round 1: critique
  critique-1: mock/mock-critic-a - 79 in, 50 out, $0.0000, 0.0s
  verdict: 1 failure(s) - One criterion failed.
    FAILED: It states the assumptions it was written under. - No assumptions section.

Round 1: revise
  revise-1: mock/mock-builder - 144 in, 20 out, $0.0000, 0.0s

Round 2: critique
  critique-2: mock/mock-critic-b - 86 in, 20 out, $0.0000, 0.0s
  verdict: MEETS - All criteria met.
  a critic from a different lab passed it; stopping early rather than inventing work.

Stage: final edit
  final: mock/mock-finalist - 94 in, 13 out, $0.0000, 0.0s
---
verdict:  a critic from another lab passed it
tokens:   480 in, 160 out, 640 total
cost:     $0.0000 of $5.00 ceiling`.split('\n');

function foldAll(lines) {
  return foldProgressLines(emptyProgress(), lines).state;
}

test('empty progress knows nothing - every field null, nothing fabricated', () => {
  const p = emptyProgress();
  for (const key of ['chain', 'maxRounds', 'capUsd', 'stage', 'round', 'proposalsExpected', 'proposalsIn', 'openObjections']) {
    assert.equal(p[key], null, key);
  }
  assert.equal(p.capReached, false);
  assert.equal(p.done, false);
});

test('header lines yield chain, round cap and $ ceiling', () => {
  const p = foldAll(REAL_MOCK_RUN.slice(0, 3));
  assert.equal(p.chain, 'mock');
  assert.equal(p.maxRounds, 2);
  assert.equal(p.capUsd, 5);
});

test('mid-run: after round 1 critique, one objection open in round 1', () => {
  const idx = REAL_MOCK_RUN.findIndex(l => l.startsWith('    FAILED:'));
  const p = foldAll(REAL_MOCK_RUN.slice(0, idx + 1));
  assert.equal(p.round, 1);
  assert.equal(p.stage, 'critique');
  assert.equal(p.openObjections, 1);
});

test('a new round resets the objection count to unknown until a verdict lands', () => {
  const idx = REAL_MOCK_RUN.findIndex(l => l === 'Round 2: critique');
  const p = foldAll(REAL_MOCK_RUN.slice(0, idx + 1));
  assert.equal(p.round, 2);
  assert.equal(p.openObjections, null);
});

test('MEETS verdict reads as zero open objections', () => {
  const idx = REAL_MOCK_RUN.findIndex(l => l.includes('verdict: MEETS'));
  const p = foldAll(REAL_MOCK_RUN.slice(0, idx + 1));
  assert.equal(p.openObjections, 0);
});

test('the summary block after --- is never read as a critic verdict', () => {
  const p = foldAll(REAL_MOCK_RUN);
  assert.equal(p.done, true);
  assert.equal(p.openObjections, 0);
  assert.equal(p.stage, 'final edit');
  assert.equal(p.round, 2);
});

test('proposals stage: expected count from the stage line, posted count from the builder hand-off line', () => {
  const lines = [
    'Stage: proposals (5 labs, 1 attempt(s) of up to 2 parts each, blind)',
    '  proposal-1: together/x - 1 in, 1 out, $0.0000, 0.0s',
  ];
  let p = foldAll(lines);
  assert.equal(p.stage, 'proposals');
  assert.equal(p.proposalsExpected, 5);
  assert.equal(p.proposalsIn, null, 'not posted yet - unknown, not 0');
  p = foldAll([...lines, '  5 proposal(s) go to the builder.']);
  assert.equal(p.proposalsIn, 5);
});

test('unanimous panel review sums every critic verdict within one round', () => {
  const p = foldAll([
    'chain: plan-cheap (5 round cap)',
    'Round 1: panel review (3 labs, independent)',
    '  verdict: 2 failure(s) - x',
    '  verdict: MEETS - y',
    '  verdict: 1 failure(s) - z',
  ]);
  assert.equal(p.stage, 'panel review');
  assert.equal(p.openObjections, 3);
  assert.equal(p.maxRounds, 5);
});

test('round cap reached is flagged, and unrelated lines leave the state untouched (same reference)', () => {
  const before = foldAll(['chain: mock (2 round cap)']);
  const same = foldProgress(before, '  critique-1: mock/mock-critic-a - 79 in, 50 out');
  assert.equal(same, before, 'no allocation on a line that carries no field');
  const capped = foldProgress(before, '  round cap (2) reached without unanimous signoff; open objections go into the report.');
  assert.equal(capped.capReached, true);
});

test('foldProgressLines reports changed=false for a batch carrying nothing', () => {
  const start = emptyProgress();
  const r = foldProgressLines(start, ['', '  some usage line', 'task:  tasks/x.md']);
  assert.equal(r.changed, false);
  assert.equal(r.state, start);
});
