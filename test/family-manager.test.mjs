// test/family-manager.test.mjs - Sophi-A Seat Families F7 acceptance tests
// (relay/Docs/SophiA-Seat-Families-Plan.md §5 F7). Real fake-claude subprocess spawns via
// peer-pool.js's own fanOut(), same technique as test/peer-pool.test.mjs - a fake `claude`
// binary on a temp PATH entry, no mocking of node:child_process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  familyCreate, familyDispatch, familyStop, familyClose, familyList,
  familyManagerRestartRecovery, familyStopAll, familyLiveSessionCount,
} from '../src/orchestrator/family/familyManager.js';
import { readSession } from '../src/orchestrator/family/familyMemory.js';

const tmp = mkdtempSync(join(tmpdir(), 'family-manager-test-'));
const binDir = join(tmp, 'bin');
mkdirSync(binDir, { recursive: true });
const claudePath = join(binDir, 'claude');
const familiesRoot = join(tmp, 'families');

function writeFakeClaude({ fail = false } = {}) {
  writeFileSync(claudePath, `#!/usr/bin/env node
const args = process.argv.slice(2);
const task = args[1];
const resumeIdx = args.indexOf('--resume');
const resumeId = resumeIdx !== -1 ? args[resumeIdx + 1] : null;
if (resumeId) require('node:fs').writeFileSync('${join(tmp, 'last-resume.txt').replace(/\\/g, '\\\\')}', resumeId);
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: '11111111-2222-4333-8444-555555555555' }));
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi ' + task }] } }));
console.log(JSON.stringify({ type: 'result', subtype: '${fail ? 'error' : 'success'}', is_error: ${fail}, result: '${fail ? 'boom' : 'ok'}', total_cost_usd: 0.01, usage: { input_tokens: 5, output_tokens: 5 } }));
`);
  chmodSync(claudePath, 0o755);
}

process.env.PATH = `${binDir}:${process.env.PATH}`;

// F0's flag/cap table ships with only `cnc` enabled - to exercise `plan-1`/`build-1` as owner
// seats (per the plan's §2.2 "any seat with a families.config.json row", not cnc-only), point
// SOPHIA_FAMILIES_CONFIG_PATH at a temp, flag-on config for this test file only.
const configPath = join(tmp, 'families.config.json');
writeFileSync(configPath, JSON.stringify({
  schemaVersion: 1,
  enabled: true,
  global: { maxConcurrentSessions: 8, spendCeilingUsd: 5.0 },
  seats: {
    'plan-1': { enabled: true, maxConcurrentSessions: 4, spendCeilingUsd: 5.0, runtimes: ['claude-code', 'chat', 'council'] },
    'build-1': { enabled: true, maxConcurrentSessions: 4, spendCeilingUsd: 5.0, runtimes: ['claude-code', 'chat'] },
  },
}));
process.env.SOPHIA_FAMILIES_CONFIG_PATH = configPath;

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('create requires humanClick, zero directories created otherwise', () => {
  assert.throws(() => familyCreate({ ownerSeat: 'plan-1', familyId: 'f1', humanClick: false, familiesRoot }));
  assert.equal(existsSync(join(familiesRoot, 'plan-1')), false);
  const family = familyCreate({ ownerSeat: 'plan-1', familyId: 'f1', brief: 'b', plan: 'p', humanClick: true, familiesRoot });
  assert.ok(existsSync(family.dir));
});

test('dispatch two turns to one session; the second carries --resume with the first turn\'s real session id', async () => {
  writeFakeClaude();
  familyCreate({ ownerSeat: 'plan-1', familyId: 'resume-test', humanClick: true, familiesRoot });

  const first = await familyDispatch({ ownerSeat: 'plan-1', familyId: 'resume-test', sessionId: 's1', task: 'do-1', familiesRoot });
  assert.equal(first.ok, true);
  assert.equal(first.status, 'idle');

  const second = await familyDispatch({ ownerSeat: 'plan-1', familyId: 'resume-test', sessionId: 's1', task: 'do-2', familiesRoot });
  assert.equal(second.ok, true);
  const resumeUsed = readFileSync(join(tmp, 'last-resume.txt'), 'utf8').trim();
  assert.equal(resumeUsed, '11111111-2222-4333-8444-555555555555', 'the second dispatch passed --resume with the captured real session id');

  const state = readSession({ ownerSeat: 'plan-1', familyId: 'resume-test', dir: join(familiesRoot, 'plan-1', 'resume-test') }, 's1');
  assert.equal(state.turnCount, 2);
});

test('a failed turn (is_error) is classified failed-owned; identical re-dispatch is refused; a changed task runs', async () => {
  writeFakeClaude({ fail: true });
  familyCreate({ ownerSeat: 'plan-1', familyId: 'fail-test', humanClick: true, familiesRoot });

  const first = await familyDispatch({ ownerSeat: 'plan-1', familyId: 'fail-test', sessionId: 's1', task: 'boom-task', familiesRoot });
  assert.equal(first.ok, false);
  assert.equal(first.status, 'failed-owned');

  const identicalRetry = await familyDispatch({ ownerSeat: 'plan-1', familyId: 'fail-test', sessionId: 's1', task: 'boom-task', familiesRoot });
  assert.equal(identicalRetry.ok, false);
  assert.equal(identicalRetry.reason, 'identical-redispatch-refused');

  writeFakeClaude({ fail: false });
  const changedTask = await familyDispatch({ ownerSeat: 'plan-1', familyId: 'fail-test', sessionId: 's1', task: 'a genuinely different task', familiesRoot });
  assert.equal(changedTask.ok, true, 'a changed task is allowed to run after one owned failure');
});

test('a second owned failure on the same session escalates to human, never offers an automated restart', async () => {
  writeFakeClaude({ fail: true });
  familyCreate({ ownerSeat: 'plan-1', familyId: 'escalate-test', humanClick: true, familiesRoot });

  await familyDispatch({ ownerSeat: 'plan-1', familyId: 'escalate-test', sessionId: 's1', task: 'task-a', familiesRoot });
  const second = await familyDispatch({ ownerSeat: 'plan-1', familyId: 'escalate-test', sessionId: 's1', task: 'task-b (different, would normally be allowed)', familiesRoot });
  assert.equal(second.ok, false);
  assert.equal(second.status, 'failed-owned');

  const third = await familyDispatch({ ownerSeat: 'plan-1', familyId: 'escalate-test', sessionId: 's1', task: 'task-c (yet another distinct task)', familiesRoot });
  assert.equal(third.ok, false);
  assert.equal(third.reason, 'second-owned-failure-escalates');
});

test('killing and re-creating the manager: a running session loads as interrupted with its handle intact', async () => {
  familyCreate({ ownerSeat: 'plan-1', familyId: 'restart-test', humanClick: true, familiesRoot });
  const family = { ownerSeat: 'plan-1', familyId: 'restart-test', dir: join(familiesRoot, 'plan-1', 'restart-test') };
  const { writeSessionState } = await import('../src/orchestrator/family/familyMemory.js');
  writeSessionState(family, { sessionId: 's-crashed', runtime: 'claude-code', status: 'running', handle: 'prior-handle-123' });

  const { marked } = familyManagerRestartRecovery({ familiesRoot });
  assert.ok(marked >= 1);
  const after = readSession(family, 's-crashed');
  assert.equal(after.status, 'interrupted');
  assert.equal(after.handle, 'prior-handle-123', 'the session handle survives the interrupted transition');
});

test('resuming an interrupted session without resume:true is refused (Q5 - no auto-resume)', async () => {
  writeFakeClaude();
  familyCreate({ ownerSeat: 'plan-1', familyId: 'no-auto-resume', humanClick: true, familiesRoot });
  const family = { ownerSeat: 'plan-1', familyId: 'no-auto-resume', dir: join(familiesRoot, 'plan-1', 'no-auto-resume') };
  const { writeSessionState } = await import('../src/orchestrator/family/familyMemory.js');
  writeSessionState(family, { sessionId: 's1', runtime: 'claude-code', status: 'interrupted', handle: 'h1' });

  const result = await familyDispatch({ ownerSeat: 'plan-1', familyId: 'no-auto-resume', sessionId: 's1', task: 'anything', familiesRoot });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'interrupted');
});

test('familyStopAll stops family sessions too - Stop All must mean all', async () => {
  writeFakeClaude();
  // a stayAlive fake-claude to keep a session "live" long enough to stop
  writeFileSync(claudePath, `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'stayalive-1' }));
setInterval(() => {}, 1000);
`);
  chmodSync(claudePath, 0o755);

  familyCreate({ ownerSeat: 'plan-1', familyId: 'stopall-test', humanClick: true, familiesRoot });
  const dispatchPromise = familyDispatch({ ownerSeat: 'plan-1', familyId: 'stopall-test', sessionId: 's1', task: 'long-task', familiesRoot });

  const start = Date.now();
  while (familyLiveSessionCount() < 1 && Date.now() - start < 3000) {
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(familyLiveSessionCount(), 1, 'one family session is live before Stop All');

  const { stopped } = familyStopAll();
  assert.ok(stopped.includes('s1'));
  assert.equal(familyLiveSessionCount(), 0);

  await dispatchPromise.catch(() => {}); // let the killed child's promise settle; not asserted further
});

test('familyClose requires humanClick', () => {
  familyCreate({ ownerSeat: 'plan-1', familyId: 'close-test', humanClick: true, familiesRoot });
  assert.throws(() => familyClose({ ownerSeat: 'plan-1', familyId: 'close-test', sessionId: 's1', humanClick: false, familiesRoot }));
});

test('familyList scopes by ownerSeat and reflects real families on disk', () => {
  familyCreate({ ownerSeat: 'build-1', familyId: 'listed', humanClick: true, familiesRoot });
  const all = familyList({ familiesRoot });
  const scoped = familyList({ ownerSeat: 'build-1', familiesRoot });
  assert.ok(all.length >= 1);
  assert.ok(scoped.every(f => f.ownerSeat === 'build-1'));
  assert.ok(scoped.some(f => f.familyId === 'listed'));
});

test('the family_create/list/dispatch/stop/close WS commands are actually wired in index.js, and stopAll() means all', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'orchestrator', 'index.js'), 'utf8');
  assert.match(src, /msg\.cmd === 'family_create'/, 'family_create command is wired');
  assert.match(src, /msg\.cmd === 'family_list'/, 'family_list command is wired');
  assert.match(src, /msg\.cmd === 'family_dispatch'/, 'family_dispatch command is wired');
  assert.match(src, /msg\.cmd === 'family_stop'/, 'family_stop command is wired');
  assert.match(src, /msg\.cmd === 'family_close'/, 'family_close command is wired');
  assert.match(src, /from '\.\/family\/familyManager\.js'/, 'index.js imports familyManager.js');
  assert.match(src, /export function stopAll\(\) \{[\s\S]{0,600}familyStopAll\(\)/, 'stopAll() also stops family sessions - Stop All must mean all');
});
