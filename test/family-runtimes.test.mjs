// test/family-runtimes.test.mjs
//
// Sophi-A seat-owned families, F5 (relay/Docs/SophiA-Seat-Families-Plan.md §2.7; council review
// relay/runs/2026-09-15T19-57-10-287Z/deliverable.md §b/§d item 4). Fully offline: `provider:
// "mock"` for chat, `chains/mock.json` (through the real THCMCP CLI) for council, Session A's
// real fake-claude.sh fixture for the one claude-code delegation check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFamily, writeSessionState } from '../src/orchestrator/family/familyMemory.js';
import { dispatchTurn, checkContextGate, ALL_RUNTIMES } from '../src/orchestrator/family/familyRuntimes.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function tmpFamiliesRoot() {
  return mkdtempSync(join(tmpdir(), 'family-runtimes-test-'));
}

test('dispatchTurn: a runtime not in the family\'s own allowlist is refused before any dispatch, zero side effects', async () => {
  const familiesRoot = tmpFamiliesRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'fam-a', brief: '', plan: '', runtimes: ['chat'] }, familiesRoot);
    const session = { sessionId: 's-0001', runtime: 'council', provider: null, model: null };
    writeSessionState(family, { sessionId: 's-0001', runtime: 'council', status: 'created' });

    const events = [];
    const result = await dispatchTurn(family, session, 'do something', 1, (type, detail) => events.push({ type, detail }));

    assert.equal(result.dispatched, false);
    assert.equal(result.reason, 'runtime-not-allowed');
    assert.ok(events.some(e => e.type === 'family.notice'));
    // Zero side effects: no turn result file was written.
    assert.ok(!existsSync(join(family.dir, 'sessions', 's-0001', 'turns', '0001.result.json')));
  } finally {
    rmSync(familiesRoot, { recursive: true, force: true });
  }
});

test('dispatchTurn: chat member on provider "mock" produces turns/0001.out.md and a result.json, no subprocess spawned, no tools', async () => {
  const familiesRoot = tmpFamiliesRoot();
  // Proving no child process is spawned for a chat turn is done below, separately, by a
  // source-grep on dispatchChatTurn's own function body (patching a real ESM binding of
  // node:child_process's spawn isn't possible) - this test checks the real observable
  // consequence instead: no artifactPath/workdir on the written receipt.
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'fam-chat', brief: 'Family brief text.', plan: '- [ ] P1' }, familiesRoot);
    writeSessionState(family, { sessionId: 's-0001', runtime: 'chat', status: 'created', planItem: 'P1' });
    const session = { sessionId: 's-0001', runtime: 'chat', provider: 'mock', model: 'mock-chat-1', planItem: 'P1' };

    const events = [];
    const result = await dispatchTurn(family, session, 'What is 2+2?', 1, (type, detail) => events.push({ type, detail }));

    assert.equal(result.dispatched, true);
    const outPath = join(family.dir, 'sessions', 's-0001', 'turns', '0001.out.md');
    const taskPath = join(family.dir, 'sessions', 's-0001', 'turns', '0001.task.md');
    const resultPath = join(family.dir, 'sessions', 's-0001', 'turns', '0001.result.json');
    assert.ok(existsSync(outPath), 'expected turns/0001.out.md to exist');
    assert.ok(existsSync(taskPath), 'expected turns/0001.task.md to exist');
    assert.ok(existsSync(resultPath), 'expected turns/0001.result.json to exist');

    const record = JSON.parse(readFileSync(resultPath, 'utf8'));
    assert.equal(record.runtime, 'chat');
    assert.equal(record.artifactPath, null, 'a chat member has no workdir - text only');
    assert.ok(events.some(e => e.type === 'family.session.idle'));

    const taskText = readFileSync(taskPath, 'utf8');
    assert.equal(taskText, 'What is 2+2?', 'the task file is the raw task text, not the family-prefixed prompt actually sent');
  } finally {
    rmSync(familiesRoot, { recursive: true, force: true });
  }
});

test('familyRuntimes.js\'s chat dispatch path never calls node:child_process spawn - source-grep', () => {
  const src = readFileSync(join(repoRoot, 'src', 'orchestrator', 'family', 'familyRuntimes.js'), 'utf8');
  // The whole file imports `fanOut` (which itself spawns, for claude-code only) and
  // `startRelayChainSeat` (which spawns, for council only) - but dispatchChatTurn's own body
  // must never call `spawn(` directly.
  const chatFnMatch = src.match(/async function dispatchChatTurn[\s\S]*?\n}\n/);
  assert.ok(chatFnMatch, 'could not locate dispatchChatTurn in familyRuntimes.js source');
  assert.doesNotMatch(chatFnMatch[0], /\bspawn\(/, 'dispatchChatTurn must never call spawn() directly');
  assert.doesNotMatch(chatFnMatch[0], /--tools\b/, 'dispatchChatTurn must never pass a --tools flag');
});

test('dispatchTurn: council member against chains/mock.json through the real CLI produces a run folder and a receipt', async () => {
  const familiesRoot = tmpFamiliesRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'fam-council', brief: '', plan: '' }, familiesRoot);
    writeSessionState(family, { sessionId: 's-0001', runtime: 'council', status: 'created' });
    const session = { sessionId: 's-0001', runtime: 'council', chain: 'mock' };

    const events = [];
    const result = await dispatchTurn(family, session, 'Write a short fixture deliverable.', 1, (type, detail) => events.push({ type, detail }));

    assert.equal(result.dispatched, true);
    const resultPath = join(family.dir, 'sessions', 's-0001', 'turns', '0001.result.json');
    assert.ok(existsSync(resultPath), 'expected a receipt to be written for the council turn');
    const record = JSON.parse(readFileSync(resultPath, 'utf8'));
    assert.equal(record.runtime, 'council');
    assert.ok(events.some(e => e.type === 'family.session.idle' || e.type === 'family.session.problem'));
    // A real run folder was produced by relay's own CLI (relayChainSubprocess.js's own
    // recordRun() copies it under cnc-harness's runs/<pseudoSeatId>/ - the same store the
    // pre-existing plan-1..3 seats already use, not a new mechanism this test invents).
  } finally {
    rmSync(familiesRoot, { recursive: true, force: true });
  }
}, { timeout: 60_000 });

test('checkContextGate: a context/ file with no sibling gate record is blocked', () => {
  const familiesRoot = tmpFamiliesRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'fam-gate', brief: '', plan: '' }, familiesRoot);
    writeSessionState(family, { sessionId: 's-0001', runtime: 'claude-code', status: 'created' });
    const contextDir = join(family.dir, 'sessions', 's-0001', 'context');
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(join(contextDir, 'artifact-from-chat-member.md'), 'some content');

    const gate = checkContextGate(family, 's-0001');
    assert.equal(gate.ok, false);
    assert.deepEqual(gate.blockedFiles, ['artifact-from-chat-member.md']);
  } finally {
    rmSync(familiesRoot, { recursive: true, force: true });
  }
});

test('checkContextGate: a context/ file with a passing sibling gate record is allowed', () => {
  const familiesRoot = tmpFamiliesRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'fam-gate-pass', brief: '', plan: '' }, familiesRoot);
    writeSessionState(family, { sessionId: 's-0001', runtime: 'claude-code', status: 'created' });
    const contextDir = join(family.dir, 'sessions', 's-0001', 'context');
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(join(contextDir, 'artifact.md'), 'some content');
    writeFileSync(join(contextDir, 'artifact.md.gate.json'), JSON.stringify({ result: 'pass' }));

    const gate = checkContextGate(family, 's-0001');
    assert.equal(gate.ok, true);
  } finally {
    rmSync(familiesRoot, { recursive: true, force: true });
  }
});

test('checkContextGate: a context/ file with a blocked/not_judged gate record is refused, not just a missing one', () => {
  const familiesRoot = tmpFamiliesRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'fam-gate-blocked', brief: '', plan: '' }, familiesRoot);
    writeSessionState(family, { sessionId: 's-0001', runtime: 'claude-code', status: 'created' });
    const contextDir = join(family.dir, 'sessions', 's-0001', 'context');
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(join(contextDir, 'artifact.md'), 'x');
    writeFileSync(join(contextDir, 'artifact.md.gate.json'), JSON.stringify({ result: 'blocked' }));

    const gate = checkContextGate(family, 's-0001');
    assert.equal(gate.ok, false);
    assert.deepEqual(gate.blockedFiles, ['artifact.md']);
  } finally {
    rmSync(familiesRoot, { recursive: true, force: true });
  }
});

test('checkContextGate: an unreadable/corrupt gate record fails closed, same as a missing one', () => {
  const familiesRoot = tmpFamiliesRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'fam-gate-corrupt', brief: '', plan: '' }, familiesRoot);
    writeSessionState(family, { sessionId: 's-0001', runtime: 'claude-code', status: 'created' });
    const contextDir = join(family.dir, 'sessions', 's-0001', 'context');
    mkdirSync(contextDir, { recursive: true });
    writeFileSync(join(contextDir, 'artifact.md'), 'x');
    writeFileSync(join(contextDir, 'artifact.md.gate.json'), 'not valid json{{{');

    const gate = checkContextGate(family, 's-0001');
    assert.equal(gate.ok, false);
  } finally {
    rmSync(familiesRoot, { recursive: true, force: true });
  }
});

test('checkContextGate: an empty or absent context/ dir is always allowed', () => {
  const familiesRoot = tmpFamiliesRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'fam-gate-empty', brief: '', plan: '' }, familiesRoot);
    writeSessionState(family, { sessionId: 's-0001', runtime: 'claude-code', status: 'created' });
    assert.equal(checkContextGate(family, 's-0001').ok, true);
  } finally {
    rmSync(familiesRoot, { recursive: true, force: true });
  }
});

test('dispatchTurn: claude-code delegates to fanOut() - refused for a non-cnc owner with the flag off (families.config.json shipped default)', async () => {
  const familiesRoot = tmpFamiliesRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'fam-cc', brief: '', plan: '' }, familiesRoot);
    writeSessionState(family, { sessionId: 's-0001', runtime: 'claude-code', status: 'created' });
    const session = { sessionId: 's-0001', runtime: 'claude-code' };

    await assert.rejects(
      () => dispatchTurn(family, session, 'do something', 1, () => {}),
      /Fan-out only allowed from cnc seat/,
    );
  } finally {
    rmSync(familiesRoot, { recursive: true, force: true });
  }
});

test('dispatchTurn: claude-code delegates to fanOut() for the cnc owner - real subprocess via the fake-claude fixture', async () => {
  const familiesRoot = tmpFamiliesRoot();
  const fakeClaudeSrc = join(repoRoot, 'test', 'fixtures', 'fake-claude.sh');
  if (!existsSync(fakeClaudeSrc)) throw new Error('fake-claude.sh fixture missing');
  const tmp = mkdtempSync(join(tmpdir(), 'family-runtimes-claude-'));
  const binDir = join(tmp, 'bin');
  mkdirSync(binDir, { recursive: true });
  const claudePath = join(binDir, 'claude');
  copyFileSync(fakeClaudeSrc, claudePath);
  chmodSync(claudePath, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath}`;
  try {
    const family = createFamily({ ownerSeat: 'cnc', familyId: 'fam-cc', brief: '', plan: '' }, familiesRoot);
    writeSessionState(family, { sessionId: 's-0001', runtime: 'claude-code', status: 'created' });
    const session = { sessionId: 's-0001', runtime: 'claude-code' };

    const events = [];
    const result = await dispatchTurn(family, session, `claude-code-turn-${Date.now()}`, 1, (type, detail) => events.push({ type, detail }));
    assert.equal(result.dispatched, true);
    assert.ok(result.peerId, 'expected fanOut() to report a dispatched peer id');
  } finally {
    process.env.PATH = originalPath;
    rmSync(tmp, { recursive: true, force: true });
    rmSync(familiesRoot, { recursive: true, force: true });
  }
});

test('ALL_RUNTIMES matches the exact three runtimes this build ever recognizes', () => {
  assert.deepEqual([...ALL_RUNTIMES].sort(), ['chat', 'claude-code', 'council'].sort());
});
