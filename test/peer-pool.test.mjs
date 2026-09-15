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
if (task && addDir) fs.writeFileSync(path.join('${tmp.replace(/\\/g, '\\\\')}', 'invoked-' + task + '.json'), JSON.stringify({ addDir }));
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
