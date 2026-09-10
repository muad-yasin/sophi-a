#!/usr/bin/env node
// Phase 2 Step 1 (Stop-All + watchdog) acceptance test - real process spawns, real timers, no
// mocking of node:child_process. Substitutes a fake `claude` binary (via a temp PATH entry) for
// the real CLI so this never needs live API access or costs a cent, while still exercising the
// exact same spawn/SIGTERM/SIGKILL/watchdog code paths a real run does.
//
// Per the plan's own accepted design (KIMI-5): "a watchdog test that doesn't require actually
// waiting 120 seconds" - this proves the 5s case, which proves the mechanism (the constant is
// the only thing that changes for the real 120s/300s/600s seats).
//
// Run: node scripts/test-stopall-watchdog.mjs
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ok - ${msg}`);
  else { failures += 1; console.error(`  FAIL - ${msg}`); }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitUntil(fn, timeoutMs, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = fn();
    if (result) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

const tmp = mkdtempSync(join(tmpdir(), 'sophia-stopall-test-'));
const binDir = join(tmp, 'bin');
mkdirSync(binDir, { recursive: true });
const claudePath = join(binDir, 'claude');

// A fake `claude` - a single executable file (shebang + CommonJS body; extensionless so node's
// default-CJS interpretation applies regardless of this project's own "type":"module") that:
//  - writes its own pid to the path given as its task argument (argv[3], right after `-p`) so the
//    test can poll real OS process liveness without any internal access to the adapter's state,
//  - optionally emits one real init+tool_use stream-json pair so the seat reaches "working"
//    status exactly like a real turn would, then goes silent,
//  - optionally ignores SIGTERM, forcing the SIGKILL/taskkill escalation path.
function writeFakeClaude({ ignoreSigterm, emitWorkingLines }) {
  writeFileSync(claudePath, `#!/usr/bin/env node
const fs = require('node:fs');
const pidFile = process.argv[3];
if (pidFile) fs.writeFileSync(pidFile, String(process.pid));
${emitWorkingLines ? `console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'test-session' }));
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }));` : ''}
${ignoreSigterm ? "process.on('SIGTERM', () => {});" : ''}
setInterval(() => {}, 1000);
`);
  chmodSync(claudePath, 0o755);
}

process.env.PATH = `${binDir}:${process.env.PATH}`;

async function testWatchdogAndEscalation() {
  console.log('Test A: watchdog fires at timeout_ms (5s), not 120s/300s, then escalates SIGTERM -> SIGKILL after 5s');
  const pidFile = join(tmp, 'watchdog-pid.txt');
  writeFakeClaude({ ignoreSigterm: true, emitWorkingLines: false });

  const { startClaudeCodeSeat } = await import('../src/orchestrator/adapters/claudeCodeSubprocess.js');

  const events = [];
  const startedAt = Date.now();
  startClaudeCodeSeat('test-watchdog', { timeout_ms: 5000 }, pidFile, (type, detail) => {
    events.push({ type, detail, t: Date.now() - startedAt });
  });

  const pid = await waitUntil(() => (existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : null), 3000);
  assert(pid && isAlive(pid), 'fake claude process actually spawned and is alive');

  const timeoutEvent = await waitUntil(() => events.find(e => e.type === 'seat.timeout'), 9000);
  assert(!!timeoutEvent, 'seat.timeout was emitted');
  if (timeoutEvent) {
    assert(timeoutEvent.t >= 4500 && timeoutEvent.t <= 8000,
      `watchdog fired at ~${timeoutEvent.t}ms (expected ~5000ms, not 120000ms or 300000ms)`);
  }
  assert(!events.some(e => e.type === 'seat.problem'), 'no seat.problem emitted (timeout is its own honest event, not a generic error)');

  await new Promise(r => setTimeout(r, 1500));
  assert(pid && isAlive(pid), 'process still alive ~1.5s after SIGTERM (proves it was really ignored, not already dead)');

  const diedAt = await waitUntil(() => (!isAlive(pid) ? Date.now() - startedAt : null), 9000, 200);
  assert(!!diedAt, 'process was actually killed (SIGKILL escalation)');
  if (diedAt && timeoutEvent) {
    const gap = diedAt - timeoutEvent.t;
    assert(gap >= 3500 && gap <= 8000, `SIGKILL escalation landed ~${gap}ms after SIGTERM (expected ~5000ms)`);
  }
}

async function testManualStopResolvesIdle() {
  console.log('Test B: an operator Stop resolves the seat to idle, not problem, and the process actually exits');
  const pidFile = join(tmp, 'stop-pid.txt');
  writeFakeClaude({ ignoreSigterm: false, emitWorkingLines: false }); // responds to plain SIGTERM

  const { startClaudeCodeSeat, stopClaudeCodeSeat } = await import('../src/orchestrator/adapters/claudeCodeSubprocess.js');

  const events = [];
  startClaudeCodeSeat('test-stop', { timeout_ms: 300000 }, pidFile, (type, detail) => {
    events.push({ type, detail, t: Date.now() });
  });

  const pid = await waitUntil(() => (existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : null), 3000);
  assert(pid && isAlive(pid), 'fake claude process spawned and alive before Stop');

  stopClaudeCodeSeat('test-stop');

  const settleEvent = await waitUntil(() => events.find(e => e.type === 'seat.idle' || e.type === 'seat.problem'), 2000, 50);
  assert(settleEvent?.type === 'seat.idle', `Stop resolves to seat.idle, not seat.problem (got: ${settleEvent?.type})`);

  const diedQuickly = await waitUntil(() => !isAlive(pid), 2000, 50);
  assert(!!diedQuickly, 'process actually exited from the plain SIGTERM (no escalation needed)');
}

async function testStopAllAcrossMultipleSeats() {
  console.log('Test C: real orchestrator, real WebSocket - Stop All SIGTERMs every working seat, escalates the ones still alive after 5s, all resolve to idle');
  const pidFileA = join(tmp, 'multi-a-pid.txt');
  const pidFileB = join(tmp, 'multi-b-pid.txt');
  // Both fake processes ignore SIGTERM (the harder case) - proves stopAll() both reaches more
  // than one seat at once, and correctly escalates each one that doesn't respond.
  writeFakeClaude({ ignoreSigterm: true, emitWorkingLines: true });

  const orch = spawn('node', [join(process.cwd(), 'src/orchestrator/index.js')], {
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  });

  let port = null, token = null, stdoutBuf = '', stderrBuf = '';
  orch.stdout.on('data', chunk => {
    stdoutBuf += chunk.toString();
    const portMatch = stdoutBuf.match(/PORT:(\d+)/);
    const tokenMatch = stdoutBuf.match(/TOKEN:([0-9a-f]+)/);
    if (portMatch) port = Number(portMatch[1]);
    if (tokenMatch) token = tokenMatch[1];
  });
  orch.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });

  await waitUntil(() => port && token, 5000);
  assert(!!(port && token), `orchestrator started and printed PORT/TOKEN (stderr: ${stderrBuf.slice(0, 300)})`);
  if (!port || !token) { orch.kill('SIGKILL'); return; }

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const wsEvents = [];
  await new Promise((resolve, reject) => {
    ws.on('open', () => { ws.send(JSON.stringify({ cmd: 'auth', token })); resolve(); });
    ws.on('error', reject);
  });
  ws.on('message', raw => { try { wsEvents.push(JSON.parse(raw.toString())); } catch {} });

  // The task text is the pidfile path - our fake claude reads argv[3] (right after `-p`) as
  // exactly that, so each seat's real OS pid is discoverable without any shared state hack.
  ws.send(JSON.stringify({ cmd: 'start', seatId: 'build-1', task: pidFileA }));
  ws.send(JSON.stringify({ cmd: 'start', seatId: 'build-2', task: pidFileB }));

  const bothPids = await waitUntil(() => {
    if (!existsSync(pidFileA) || !existsSync(pidFileB)) return null;
    return [Number(readFileSync(pidFileA, 'utf8')), Number(readFileSync(pidFileB, 'utf8'))];
  }, 3000);
  assert(!!bothPids, 'both fake claude processes actually spawned');

  const workingSeen = await waitUntil(
    () => wsEvents.filter(e => e.type === 'seat.working' && (e.seatId === 'build-1' || e.seatId === 'build-2')).length >= 2,
    3000,
  );
  assert(!!workingSeen, 'both build-1 and build-2 reached working status before Stop All');

  const stopAllAt = Date.now();
  ws.send(JSON.stringify({ cmd: 'stop_all' }));

  const idleEvents = await waitUntil(() => {
    const idles = wsEvents.filter(e => e.type === 'seat.idle' && (e.seatId === 'build-1' || e.seatId === 'build-2'));
    return idles.length >= 2 ? idles : null;
  }, 2000);
  const seenTypes = wsEvents.filter(e => e.seatId === 'build-1' || e.seatId === 'build-2').map(e => e.type).join(',');
  assert(!!idleEvents, `both seats resolved to seat.idle promptly after Stop All, not seat.problem (saw: ${seenTypes})`);
  if (idleEvents) {
    const maxDelay = Math.max(...idleEvents.map(e => e.timestamp - stopAllAt));
    assert(maxDelay < 1000, `both seat.idle events arrived immediately on the Stop All click, not after waiting for the kill (${maxDelay}ms)`);
  }

  const bothDead = bothPids
    ? await waitUntil(() => bothPids.every(p => !isAlive(p)), 9000, 200)
    : null;
  assert(!!bothDead, 'both real processes were actually killed (SIGTERM ignored by both -> SIGKILL escalation) within a bounded window');

  ws.close();
  orch.kill('SIGKILL');
}

async function main() {
  try {
    await testWatchdogAndEscalation();
    await testManualStopResolvesIdle();
    await testStopAllAcrossMultipleSeats();
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
  console.log(failures === 0 ? '\nPASS - all Phase 2 Step 1 assertions held.' : `\nFAIL - ${failures} assertion(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
