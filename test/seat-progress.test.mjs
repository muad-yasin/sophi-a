// test/seat-progress.test.mjs
//
// Pins the exact subtitle/card strings the rich status cards render, and - more importantly -
// that a field the orchestrator has not reported is left out rather than printed as 0 or
// estimated. Imports the TypeScript module directly (node 22's type stripping; the module
// deliberately uses only erasable syntax).
import test from 'node:test';
import assert from 'node:assert/strict';
import { progressSubtitle, dispatchCapLine, dispatchNote, needsPillLine, homeStatusLine } from '../src/seatProgress.ts';

function relay(overrides = {}) {
  return {
    kind: 'relay', chain: null, maxRounds: null, capUsd: null, stage: null, round: null,
    proposalsExpected: null, proposalsIn: null, openObjections: null, capReached: false, done: false,
    ...overrides,
  };
}

test('no progress reported -> no subtitle (null), never a placeholder number', () => {
  assert.equal(progressSubtitle('working', null), null);
  assert.equal(progressSubtitle('idle', null), null);
  assert.equal(progressSubtitle('working', relay()), null, 'a relay run with no parsed line yet says nothing');
});

test('round line with objections reads like the mockup, from real fields only', () => {
  assert.equal(progressSubtitle('working', relay({ round: 2, maxRounds: 3, openObjections: 1 })), 'Round 2 of 3 · 1 objection open');
  assert.equal(progressSubtitle('working', relay({ round: 1, maxRounds: 5, openObjections: 0 })), 'Round 1 of 5 · no objections open');
  assert.equal(progressSubtitle('working', relay({ round: 2, maxRounds: 3, openObjections: null })), 'Round 2 of 3', 'no verdict yet -> no objection count');
  assert.equal(progressSubtitle('working', relay({ round: 2, openObjections: 2 })), 'Round 2 · 2 objections open', 'no cap known -> no "of N"');
});

test('proposals stage: posted count only once the hand-off line has been seen', () => {
  assert.equal(progressSubtitle('working', relay({ stage: 'proposals', proposalsExpected: 5, proposalsIn: 5 })), 'Proposals in · 5 of 5 posted');
  assert.equal(progressSubtitle('working', relay({ stage: 'proposals', proposalsExpected: 5 })), 'Proposals out · 5 labs drafting');
  assert.equal(progressSubtitle('working', relay({ stage: 'proposals' })), 'Proposals out');
});

test('other stages name the stage; a finished, signed-off run says so', () => {
  assert.equal(progressSubtitle('working', relay({ stage: 'acceptance criteria' })), 'Stage · acceptance criteria');
  assert.equal(progressSubtitle('idle', relay({ done: true, round: 2, maxRounds: 5 })), 'Signed off · 2 rounds');
  assert.equal(progressSubtitle('idle', relay({ done: true })), 'Signed off');
});

test('Needs you: the two real causes are worded apart', () => {
  assert.equal(progressSubtitle('attention', relay({ waitingOn: { external: 'builder' } })), 'Blocking question · builder seat');
  assert.equal(progressSubtitle('attention', relay({ waitingOn: { signoff: 3 }, round: 5, maxRounds: 5 })), 'No sign-off · 3 objections open');
});

test('Degraded / Timed out never get a progress subtitle (the output slot carries the error)', () => {
  assert.equal(progressSubtitle('problem', relay({ round: 2, maxRounds: 3 })), null);
  assert.equal(progressSubtitle('timeout', { kind: 'claude-code', filesTouched: 3, toolCalls: 9 }), null);
});

test('build seat: files touched and tool calls, no invented agent count', () => {
  const s = progressSubtitle('working', { kind: 'claude-code', filesTouched: 14, toolCalls: 31 });
  assert.equal(s, '14 files touched · 31 tool calls');
  assert.doesNotMatch(s, /agent/);
  assert.equal(progressSubtitle('working', { kind: 'claude-code', filesTouched: 1, toolCalls: 1 }), '1 file touched · 1 tool call');
  assert.equal(progressSubtitle('idle', { kind: 'claude-code', filesTouched: 1, toolCalls: 1 }), null);
});

test('DISPATCHED cap line: only when every active relay run agrees, only the fields reported', () => {
  assert.equal(dispatchCapLine([]), null);
  assert.equal(dispatchCapLine([{ kind: 'claude-code', filesTouched: 0, toolCalls: 0 }]), null);
  assert.equal(dispatchCapLine([relay({ maxRounds: 3, capUsd: 5 })]), 'cap 3 rounds · $5 ceiling');
  assert.equal(dispatchCapLine([relay({ maxRounds: 3, capUsd: 5 }), relay({ maxRounds: 3, capUsd: 5 })]), 'cap 3 rounds · $5 ceiling');
  assert.equal(dispatchCapLine([relay({ maxRounds: 3, capUsd: 5 }), relay({ maxRounds: 5, capUsd: 5 })]), '$5 ceiling', 'mixed round caps drop that part');
  assert.equal(dispatchCapLine([relay({ maxRounds: 3 })]), 'cap 3 rounds');
  assert.equal(dispatchCapLine([relay({ capUsd: 0.5 })]), '$0.50 ceiling');
  assert.equal(dispatchCapLine([relay()]), null);
});

test('DISPATCHED note names real seats and never claims a dependency', () => {
  assert.equal(dispatchNote([], 1), 'One seat is working. Nothing is waiting on you.');
  assert.equal(dispatchNote([], 3), 'Nothing is waiting on you right now.');
  assert.equal(dispatchNote(['Plan III'], 2), 'Plan III has paused for you. The other seats keep going.');
  assert.equal(dispatchNote(['Plan III'], 0), 'Plan III has paused for you.');
  assert.equal(dispatchNote(['Plan I', 'Plan III'], 1), 'Plan I and Plan III have paused for you. The other seat keeps going.');
  assert.doesNotMatch(dispatchNote(['Plan III'], 2), /depends/);
});

test('needs pill line from real counts', () => {
  assert.equal(needsPillLine(0, 0), '◆ All quiet');
  assert.equal(needsPillLine(1, 1), '◆ 1 seat needs you · 1 degraded');
  assert.equal(needsPillLine(2, 0), '◆ 2 seats need you');
  assert.equal(needsPillLine(0, 3), '◆ 3 degraded');
});

test('home status line counts real delegations', () => {
  assert.equal(homeStatusLine('idle', 0), 'ready · nothing delegated');
  assert.equal(homeStatusLine('working', 0), 'thinking');
  assert.equal(homeStatusLine('idle', 1), 'orchestrating 1 seat');
  assert.equal(homeStatusLine('working', 4), 'orchestrating 4 seats');
  assert.equal(homeStatusLine('problem', 2), 'degraded');
});
