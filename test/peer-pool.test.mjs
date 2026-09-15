// test/peer-pool.test.mjs - acceptance tests for Decisions 1, 2, 3, 4 of the multi-session C&C
// delegation plan (relay/runs/2026-09-15T15-14-29-893Z/deliverable.md, unanimous 4-lab). Each
// test below is one of the plan's own literal acceptance-test bullets, not a paraphrase of it.
//
// Real subprocess spawns, real timers, no mocking of node:child_process - same technique as
// scripts/test-stopall-watchdog.mjs: a fake `claude` binary on a temp PATH entry, so this
// exercises the exact spawn/--add-dir/stream-json code path a real fan-out does, at zero cost and
// with no live API access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

async function waitUntil(fn, timeoutMs, intervalMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = fn();
    if (result) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

const tmp = mkdtempSync(join(tmpdir(), 'peer-pool-test-'));
const binDir = join(tmp, 'bin');
mkdirSync(binDir, { recursive: true });
const claudePath = join(binDir, 'claude');

// A fake `claude`: writes the --add-dir path it was actually invoked with to a file named after
// its own task text (so the test can look up which worktree a given peer got without any shared
// state hack), emits one real init+result stream-json pair (a scripted total_cost_usd), then
// either exits immediately (the default) or stays alive indefinitely (`stayAlive: true`, used for
// the peer-count-cap test, which needs peers still "active" when the next fanOut() call happens).
function writeFakeClaude({ stayAlive = false } = {}) {
  writeFileSync(claudePath, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const task = args[1]; // args[0] is '-p'
const addDirIdx = args.indexOf('--add-dir');
const addDir = addDirIdx !== -1 ? args[addDirIdx + 1] : null;
if (task && addDir) fs.writeFileSync(path.join('${tmp.replace(/\\/g, '\\\\')}', 'invoked-' + task + '.json'), JSON.stringify({ addDir, args }));
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'peer-test-session' }));
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello from ' + task }] } }));
${stayAlive ? '' : "console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.02, usage: { input_tokens: 5, output_tokens: 5 } }));"}
${stayAlive ? 'setInterval(() => {}, 1000);' : ''}
`);
  chmodSync(claudePath, 0o755);
}

process.env.PATH = `${binDir}:${process.env.PATH}`;

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test('Decision 1 - fanOut(cnc, {count:2}) spawns exactly 2 subprocesses, each with a distinct --add-dir, pool collects both outputs', async () => {
  writeFakeClaude();
  const { fanOut } = await import('../src/orchestrator/peer-pool.js');

  const events = [];
  const task = `decision1-${Date.now()}`;
  const { dispatched, notice } = fanOut('cnc', { count: 2, task }, (type, detail) => events.push({ type, detail }));

  assert.equal(dispatched.length, 2, 'exactly 2 peers dispatched');
  assert.equal(notice, null, 'no cap notice when both requested peers fit');
  assert.equal(new Set(dispatched).size, 2, 'the 2 peer ids are distinct');

  const bothOutputs = await waitUntil(
    () => events.filter(e => e.type === 'peer.output').length >= 2 ? events.filter(e => e.type === 'peer.output') : null,
    4000,
  );
  assert.ok(bothOutputs, `pool collected output from both peers (saw: ${events.map(e => e.type).join(',')})`);

  const invokedFiles = dispatched.map(() => null); // just prove 2 distinct worktrees were actually used
  const dirs = new Set();
  for (const peerId of dispatched) {
    const startEvent = events.find(e => e.type === 'peer.start' && e.detail?.peerId === peerId);
    assert.ok(startEvent, `peer.start seen for ${peerId}`);
    assert.ok(startEvent.detail.worktree, `${peerId} has a worktree path`);
    dirs.add(startEvent.detail.worktree);
  }
  assert.equal(dirs.size, 2, 'the 2 peers actually ran in 2 distinct worktree directories');
});

test('Decision 1 / Decision 3 - fanOut() never reads or modifies seats.json', async () => {
  const seatsJsonPath = join(repoRoot, 'src', 'orchestrator', 'seats.json');
  const before = readFileSync(seatsJsonPath, 'utf8');

  writeFakeClaude();
  const { fanOut } = await import('../src/orchestrator/peer-pool.js');
  await new Promise(resolve => {
    fanOut('cnc', { count: 1, task: `decision3-${Date.now()}` }, () => {});
    setTimeout(resolve, 500);
  });

  const after = readFileSync(seatsJsonPath, 'utf8');
  assert.equal(after, before, "seats.json is byte-identical before and after a real fanOut() call");

  // Comments are allowed to *mention* seats.json (documenting that peers are a distinct
  // population from it); what must never exist is code that actually reads/imports it.
  const src = readFileSync(join(repoRoot, 'src', 'orchestrator', 'peer-pool.js'), 'utf8');
  assert.ok(!/readFileSync\([^)]*seats\.json/.test(src), 'peer-pool.js never reads seats.json from disk');
  assert.ok(!/import[^;]*seats\.json/.test(src), 'peer-pool.js never imports seats.json');
});

test('Decision 2 - a fan-out request from a seat other than cnc spawns zero subprocesses and returns the exact error', async () => {
  writeFakeClaude();
  const { fanOut, activePeerCount } = await import('../src/orchestrator/peer-pool.js');
  // activePeers is module-level state shared with sibling tests in this file; a prior test's
  // short-lived (non-stayAlive) peer may not have finished exiting yet, so settle to a clean
  // baseline instead of trusting a snapshot taken mid-cleanup.
  await waitUntil(() => activePeerCount() === 0, 3000);
  const before = activePeerCount();

  assert.throws(
    () => fanOut('plan-1', { count: 2, task: `decision2-${Date.now()}` }, () => {}),
    (err) => err.message === 'Fan-out only allowed from cnc seat',
    'throws the exact plan-specified error text',
  );

  await new Promise(r => setTimeout(r, 300));
  assert.equal(activePeerCount(), before, 'no peer was added to the pool');
});

test('Decision 4a - peer-count cap: 2 peers already running, requesting 3 more dispatches 0 and says so', async () => {
  writeFakeClaude({ stayAlive: true });
  const { fanOut, activePeerCount, stopAllPeers } = await import('../src/orchestrator/peer-pool.js');

  const first = fanOut('cnc', { count: 2, task: `decision4a-seed-${Date.now()}`, maxConcurrentPeers: 2 }, () => {});
  assert.equal(first.dispatched.length, 2, 'both seed peers dispatched (cap not yet reached)');
  await waitUntil(() => activePeerCount() >= 2, 2000);
  assert.equal(activePeerCount(), 2, 'both seed peers are actually still running (stayAlive)');

  const notices = [];
  const second = fanOut(
    'cnc',
    { count: 3, task: `decision4a-extra-${Date.now()}`, maxConcurrentPeers: 2 },
    (type, detail) => { if (type === 'fanout.notice') notices.push(detail); },
  );

  assert.equal(second.dispatched.length, 0, 'zero new peers dispatched once the cap is already full');
  assert.equal(second.notice, 'Peer cap reached, dispatching 0 of 3 peers', 'exact plan-specified notice text');
  assert.ok(notices.includes('Peer cap reached, dispatching 0 of 3 peers'), 'the same notice was also emitted as a fanout.notice event');

  stopAllPeers();
  await waitUntil(() => activePeerCount() === 0, 3000);
});

test('Decision 4b/4c - peersWithinSpendCeiling is a pure, offline-testable aggregator over synthetic cost figures', async () => {
  const { peersWithinSpendCeiling } = await import('../src/orchestrator/peer-pool.js');

  // The plan's own worked example: spent $4.99, cap $5.00, 2 candidates at $0.02 each -> 1 admitted.
  assert.equal(peersWithinSpendCeiling(4.99, 2, 5.00, 0.02), 1, '1 of 2 candidates admitted at $4.99 spent / $5.00 cap');

  // Spent exactly at the ceiling already -> 0 admitted, never rounds in the requester's favor.
  assert.equal(peersWithinSpendCeiling(5.00, 1, 5.00, 0.02), 0, '0 candidates admitted once spend already equals the ceiling');

  // Comfortably under the ceiling -> every candidate admitted.
  assert.equal(peersWithinSpendCeiling(0, 4, 5.00, 0.02), 4, 'all candidates admitted when far under the ceiling');

  // A zero-estimate (this module's honest default when the caller has no real per-peer estimate)
  // never artificially blocks anyone - only real, already-known spend can trigger the cap.
  assert.equal(peersWithinSpendCeiling(0, 10, 5.00, 0), 10, 'a zero per-peer estimate never triggers the cap on its own');
  assert.equal(peersWithinSpendCeiling(5.00, 10, 5.00, 0), 0, 'already-known spend at the ceiling still blocks everyone even with a zero estimate');
});

test('the fan_out/stop_peer/stop_all_peers WS commands are actually wired in index.js', () => {
  const src = readFileSync(join(repoRoot, 'src', 'orchestrator', 'index.js'), 'utf8');
  assert.match(src, /msg\.cmd === 'fan_out'/, 'fan_out command is wired');
  assert.match(src, /msg\.cmd === 'stop_peer'/, 'stop_peer command is wired');
  assert.match(src, /msg\.cmd === 'stop_all_peers'/, 'stop_all_peers command is wired');
  assert.match(src, /from '\.\/peer-pool\.js'/, 'index.js imports the peer-pool module');
});

// --- Sophi-A Seat Families F0 (relay/runs/2026-09-15T19-57-10-287Z/deliverable.md §d.8) ---
// A fresh, isolated families.config.json per test via SOPHIA_FAMILIES_CONFIG_PATH - never the
// real shipped one, never shared state between these tests.
function withFamiliesConfig(configObj, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'families-config-'));
  const path = join(dir, 'families.config.json');
  writeFileSync(path, JSON.stringify(configObj, null, 2));
  const previous = process.env.SOPHIA_FAMILIES_CONFIG_PATH;
  process.env.SOPHIA_FAMILIES_CONFIG_PATH = path;
  return Promise.resolve(fn()).finally(() => {
    if (previous === undefined) delete process.env.SOPHIA_FAMILIES_CONFIG_PATH;
    else process.env.SOPHIA_FAMILIES_CONFIG_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  });
}

test('F0(a) - the existing 6 peer-pool tests behavior holds with the flag off AND with the config file absent (no SOPHIA_FAMILIES_CONFIG_PATH set)', async () => {
  delete process.env.SOPHIA_FAMILIES_CONFIG_PATH;
  writeFakeClaude();
  const { fanOut, activePeerCount } = await import('../src/orchestrator/peer-pool.js');
  await waitUntil(() => activePeerCount() === 0, 3000);

  assert.throws(
    () => fanOut('plan-1', { count: 1, task: `f0a-nonabsent-${Date.now()}` }, () => {}),
    (err) => err.message === 'Fan-out only allowed from cnc seat',
  );

  const { dispatched, notice } = fanOut('cnc', { count: 1, task: `f0a-cnc-${Date.now()}` }, () => {});
  assert.equal(dispatched.length, 1);
  assert.equal(notice, null);
});

test('F0(a-corrupt) - non-cnc still gets the exact legacy throw when the config file is present but syntactically invalid', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'families-config-corrupt-'));
  const path = join(dir, 'families.config.json');
  writeFileSync(path, '{ this is not valid json');
  const previous = process.env.SOPHIA_FAMILIES_CONFIG_PATH;
  process.env.SOPHIA_FAMILIES_CONFIG_PATH = path;
  try {
    writeFakeClaude();
    const { fanOut } = await import('../src/orchestrator/peer-pool.js');
    assert.throws(
      () => fanOut('plan-1', { count: 1, task: `f0a-corrupt-${Date.now()}` }, () => {}),
      (err) => err.message === 'Fan-out only allowed from cnc seat',
      'a corrupt config folds into flag-off, never a crash and never a bypass',
    );
  } finally {
    if (previous === undefined) delete process.env.SOPHIA_FAMILIES_CONFIG_PATH;
    else process.env.SOPHIA_FAMILIES_CONFIG_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F0(b) - flag on, plan-1 enabled: 2 spawns, and a second dispatch with the captured session ids carries --resume', async () => {
  await withFamiliesConfig({
    schemaVersion: 1, enabled: true,
    global: { maxConcurrentSessions: 4, spendCeilingUsd: 5 },
    seats: { 'plan-1': { enabled: true, maxConcurrentSessions: 4, spendCeilingUsd: 5, runtimes: ['claude-code'] } },
  }, async () => {
    writeFakeClaude();
    const { fanOut, activePeerCount } = await import('../src/orchestrator/peer-pool.js');
    await waitUntil(() => activePeerCount() === 0, 3000);

    const events1 = [];
    const task1 = `f0b-first-${Date.now()}`;
    const first = fanOut('plan-1', { count: 2, task: task1 }, (type, detail) => events1.push({ type, detail }));
    assert.equal(first.dispatched.length, 2, 'flag on + seat enabled: 2 peers dispatched');

    await waitUntil(() => events1.filter(e => e.type === 'peer.start').length >= 2, 4000);
    const sessionIds = events1.filter(e => e.type === 'peer.start').map(e => e.detail.sessionId);
    assert.ok(sessionIds.every(id => typeof id === 'string' && id.length > 0), 'session_id was captured on peer.start');

    await waitUntil(() => activePeerCount() === 0, 3000);

    const task2 = `f0b-second-${Date.now()}`;
    const second = fanOut('plan-1', { count: 2, task: task2, sessionHandles: sessionIds }, () => {});
    assert.equal(second.dispatched.length, 2);
    await waitUntil(() => existsSync(join(tmp, `invoked-${task2}.json`)) || true, 500); // let the fake binary flush its files
    await waitUntil(() => activePeerCount() === 0, 3000);

    const invoked = JSON.parse(readFileSync(join(tmp, `invoked-${task2}.json`), 'utf8'));
    assert.ok(invoked.args.includes('--resume'), 'the second dispatch\'s argv includes --resume');
    const resumeIdx = invoked.args.indexOf('--resume');
    assert.ok(sessionIds.includes(invoked.args[resumeIdx + 1]), 'the --resume value is one of the captured session ids');
  });
});

test('F0(c) - flag on, plan-2 not enabled: the new error string, zero spawns', async () => {
  await withFamiliesConfig({
    schemaVersion: 1, enabled: true,
    global: { maxConcurrentSessions: 4, spendCeilingUsd: 5 },
    seats: { 'plan-2': { enabled: false, maxConcurrentSessions: 4, spendCeilingUsd: 5, runtimes: ['chat'] } },
  }, async () => {
    writeFakeClaude();
    const { fanOut, activePeerCount } = await import('../src/orchestrator/peer-pool.js');
    await waitUntil(() => activePeerCount() === 0, 3000);
    const before = activePeerCount();

    assert.throws(
      () => fanOut('plan-2', { count: 2, task: `f0c-${Date.now()}` }, () => {}),
      (err) => err.message === 'Fan-out not enabled for seat plan-2 (families.seats.plan-2.enabled is false)',
    );
    await new Promise(r => setTimeout(r, 200));
    assert.equal(activePeerCount(), before, 'zero spawns');
  });
});

test('F0(d) - a per-seat cap above the global one is clamped, and fanOut() honors the clamped value', async () => {
  await withFamiliesConfig({
    schemaVersion: 1, enabled: true,
    global: { maxConcurrentSessions: 1, spendCeilingUsd: 5 },
    seats: { 'plan-1': { enabled: true, maxConcurrentSessions: 99, spendCeilingUsd: 5, runtimes: ['claude-code'] } },
  }, async () => {
    writeFakeClaude({ stayAlive: true });
    const { fanOut, activePeerCount, stopAllPeers } = await import('../src/orchestrator/peer-pool.js');
    await waitUntil(() => activePeerCount() === 0, 3000);

    const { dispatched, notice } = fanOut('plan-1', { count: 3, task: `f0d-${Date.now()}` }, () => {});
    assert.equal(dispatched.length, 1, 'clamped to the global maxConcurrentSessions of 1, not the seat row\'s 99');
    assert.match(notice, /Peer cap reached, dispatching 1 of 3/);

    stopAllPeers();
    await waitUntil(() => activePeerCount() === 0, 3000);
  });
});
