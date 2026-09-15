// Multi-session C&C delegation, v1 (relay/runs/2026-09-15T15-14-29-893Z/deliverable.md, unanimous
// 4-lab). A hub-and-spoke fan-out: the `cnc` seat (the only allowed coordinator - Decision 2)
// spawns N ad-hoc `claude -p` subprocesses, the same real invocation the existing
// claude-code-subprocess seats use, each in its own worktree. Peers are NOT seats: they are a
// second, distinct population (Decision 3) - ephemeral, fan-out-scoped, owned entirely by this
// module's own in-memory state, never read from or written to seats.json, and torn down when the
// fan-out ends. This module deliberately does not import or reuse claudeCodeSubprocess.js's
// internal state (sessionIds/runningChildren are per-seat and don't generalize to an ad-hoc
// pool) - it duplicates the same safe-env/restricted-args *convention* instead, since a real
// import would couple two populations the plan explicitly keeps apart.
//
// Full peer-to-peer messaging (peers talking to each other, not just to the coordinator) is
// explicitly out of scope for v1 - see the plan's Decision 1 and cut list.
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { root } from './index.js';
import { recordUsage } from './cost-tracker.js';

// Same allowlist as claudeCodeSubprocess.js's safeEnv() - docs/security-prompt-injection.md S1/P0
// applies identically to a peer subprocess as it does to a seat one.
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'USERNAME', 'SHELL'];

function safeEnv() {
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  return env;
}

// Same restricted posture as claudeCodeSubprocess.js's RESTRICTED_ARGS - a peer is exactly as
// untrusted as a build seat, arguably more so (it exists only for the duration of one fan-out).
const RESTRICTED_ARGS = [
  '--restricted',
  '--tools', 'Bash,Edit,Write,Read,Glob,Grep,MultiEdit,TodoWrite',
  '--strict-mcp-config',
  '--permission-mode', 'acceptEdits',
  '--permission-prompts', 'none',
];

const KILL_ESCALATION_MS = 5_000; // same escalation window as claudeCodeSubprocess.js
const DEFAULT_TIMEOUT_MS = 300_000; // build-seat-equivalent default; a peer has no seats.json entry to read its own timeout_ms from

// Decision 4: a default of 4, not tonight's dogfooding 9. Overridable per fan-out call, never
// per-seat config (peers have no seats.json entry to carry one).
export const DEFAULT_MAX_CONCURRENT_PEERS = 4;

// Decision 4: peer-count and spend are two distinct, non-conflated stop mechanisms with their
// own error types, so a solo operator can tell "too many peers" from "too expensive" apart from
// the message alone. Neither refuses the whole fan-out except when zero peers fit - both dispatch
// fewer and say so in one sentence.
export class PeerCapExceeded extends Error {
  constructor({ requested, dispatched, limit }) {
    super(`Peer cap reached, dispatching ${dispatched} of ${requested} peers`);
    this.name = 'PeerCapExceeded';
    this.requested = requested;
    this.dispatched = dispatched;
    this.limit = limit;
  }
}

export class PeerSpendCapExceeded extends Error {
  constructor({ requested, dispatched, ceilingUsd, aggregateUsd }) {
    super(`Spend cap reached, dispatching ${dispatched} of ${requested} peers`);
    this.name = 'PeerSpendCapExceeded';
    this.requested = requested;
    this.dispatched = dispatched;
    this.ceilingUsd = ceilingUsd;
    this.aggregateUsd = aggregateUsd;
  }
}

// peerId -> { child, worktree, usd, killEscalating, stopPeer }
const activePeers = new Map();
let nextPeerSeq = 1;

/** How many peers are currently running - the peer-count cap checks against this. */
export function activePeerCount() {
  return activePeers.size;
}

/** Sum of every currently-running peer's own self-reported real spend (never estimated). */
export function aggregateSpendUsd() {
  let total = 0;
  for (const peer of activePeers.values()) total += peer.usd || 0;
  return total;
}

/**
 * Pure arithmetic seam for the spend cap, decision 4's own acceptance test (c) ("an offline unit
 * test of the concurrent-sum aggregator over synthetic per-peer cost events"): given real spend
 * already known (`startingAggregateUsd`), how many of `requestedCount` candidate peers fit before
 * the running total would reach `ceilingUsd`. Strictly-less-than at each step, checked BEFORE
 * that peer's own estimate is added - a candidate whose dispatch would land the running total
 * exactly on the ceiling is refused, not admitted (verified against the plan's own worked
 * example: spent $4.99, cap $5.00, two candidates at $0.02 each admits exactly 1, and spent
 * exactly $5.00 admits 0). No I/O, no process state - callable with synthetic numbers alone.
 */
export function peersWithinSpendCeiling(startingAggregateUsd, requestedCount, ceilingUsd, estimatedUsdPerPeer) {
  let running = startingAggregateUsd;
  let n = 0;
  while (n < requestedCount && running < ceilingUsd) {
    running += estimatedUsdPerPeer;
    n += 1;
  }
  return n;
}

function workdirFor(peerId) {
  const dir = path.join(root, '.workdirs', 'peers', peerId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Spawn one peer's real `claude` subprocess turn. Mirrors claudeCodeSubprocess.js's own
 * stream-json handling exactly (same event shapes, same watchdog/kill-escalation behavior) but
 * emits `peer.*` events, never `seat.*` - a peer is never mistakable for a seat by anything
 * downstream reading the event stream.
 * @param {string} peerId
 * @param {string} task
 * @param {(type: string, detail?: any) => void} emit
 * @param {number} [timeoutMs]
 */
function spawnPeer(peerId, task, emit, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const dir = workdirFor(peerId);
  const args = ['-p', task, '--output-format', 'stream-json', '--verbose', '--add-dir', dir, ...RESTRICTED_ARGS];
  const child = spawn('claude', args, { cwd: dir, env: safeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });

  let exited = false;
  let finished = false;
  let buffer = '';
  let heartbeat = null;
  let timeoutTimer = null;
  let stderrOutput = '';

  function clearTimers() {
    if (heartbeat) clearInterval(heartbeat);
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }

  function killEscalating() {
    if (exited) return;
    if (process.platform === 'win32') {
      child.kill();
      setTimeout(() => { if (!exited) spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']); }, KILL_ESCALATION_MS);
    } else {
      child.kill('SIGTERM');
      setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, KILL_ESCALATION_MS);
    }
  }

  function finish(fn, detail) {
    if (finished) return;
    finished = true;
    clearTimers();
    activePeers.delete(peerId);
    fn(detail);
  }

  function armWatchdog() {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(() => {
      finish(detail => emit('peer.timeout', detail),
        `peer ${peerId}: no output for ${timeoutMs / 1000}s, stopped automatically`);
      killEscalating();
    }, timeoutMs);
  }

  function stopThisPeer() {
    finish(detail => emit('peer.idle', detail));
    killEscalating();
  }

  const peerEntry = { child, worktree: dir, usd: 0, killEscalating, stopPeer: stopThisPeer };
  activePeers.set(peerId, peerEntry);

  armWatchdog();

  function handleLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type === 'system' && msg.subtype === 'init') {
      emit('peer.start', { peerId, worktree: dir });
      heartbeat = setInterval(() => { if (!finished) emit('peer.working', { peerId }); }, 30_000);
    } else if (msg.type === 'assistant') {
      emit('peer.working', { peerId });
      const textBlocks = (msg.message?.content || []).filter(b => b.type === 'text');
      for (const b of textBlocks) emit('peer.output', { peerId, text: b.text });
    } else if (msg.type === 'result') {
      const usage = recordUsage({
        provider: 'anthropic',
        model: undefined,
        inputTokens: msg.usage?.input_tokens,
        outputTokens: msg.usage?.output_tokens,
        usd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined,
      });
      peerEntry.usd = usage.priced ? usage.usd : peerEntry.usd;
      emit('peer.usage', { peerId, ...usage });
      if (msg.is_error) {
        finish(detail => emit('peer.problem', { peerId, detail }), msg.result || 'peer turn ended in error');
      } else {
        finish(detail => emit('peer.idle', { peerId, detail }));
      }
    }
  }

  child.stdout.on('data', chunk => {
    armWatchdog();
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) handleLine(line);
  });
  child.stderr.on('data', chunk => { armWatchdog(); stderrOutput += chunk.toString(); });

  child.on('exit', code => {
    exited = true;
    if (finished) return;
    if (buffer.trim()) handleLine(buffer);
    if (!finished) {
      finish(detail => emit('peer.problem', { peerId, detail }),
        `peer ${peerId}: claude process exited with code ${code} before a result line arrived` +
        (stderrOutput ? `: ${stderrOutput.slice(0, 300)}` : ''));
    }
  });
  child.on('error', err => {
    finish(detail => emit('peer.problem', { peerId, detail }), `peer ${peerId}: failed to spawn claude - ${err.message}`);
  });

  return peerId;
}

/**
 * Fan out `count` peers to run `task` in parallel, hub-and-spoke, reporting only to the
 * coordinator via `emit`. Both caps are enforced before any subprocess is spawned - a request
 * that exceeds either dispatches as many peers as fit and returns a notice naming the reduction,
 * never a silent partial fan-out and never a whole-request refusal unless zero peers fit.
 *
 * @param {string} coordinatorSeatId - must be 'cnc' (Decision 2); anything else throws with zero
 *   spawns and no state change.
 * @param {object} opts
 * @param {number} opts.count - how many peers were requested.
 * @param {string} opts.task - the prompt every dispatched peer receives.
 * @param {number} [opts.maxConcurrentPeers] - defaults to DEFAULT_MAX_CONCURRENT_PEERS (4).
 * @param {number|null} [opts.spendCeilingUsd] - the fan-out's own aggregate spend ceiling; null
 *   (the default) means no spend cap is enforced by this call.
 * @param {number} [opts.estimatedUsdPerPeer] - a real, caller-supplied worst-case estimate per
 *   peer, used only to decide how many peers fit under `spendCeilingUsd` before any of them have
 *   actually spent anything. Defaults to 0 (no estimate available yet - see the plan's own
 *   honesty note: this module has no per-peer cost estimator built in, unlike relay's
 *   worstCaseOf() for a single chain stage. With no estimate, the spend cap only ever compares
 *   already-known real spend against the ceiling, never a projection).
 * @param {(type: string, detail?: any) => void} emit
 * @returns {{ dispatched: string[], notice: string|null }}
 */
export function fanOut(coordinatorSeatId, opts, emit) {
  const { count, task, maxConcurrentPeers = DEFAULT_MAX_CONCURRENT_PEERS, spendCeilingUsd = null, estimatedUsdPerPeer = 0, timeoutMs } = opts;

  if (coordinatorSeatId !== 'cnc') {
    throw new Error('Fan-out only allowed from cnc seat');
  }

  const availableSlots = Math.max(0, maxConcurrentPeers - activePeers.size);
  let toDispatch = Math.min(count, availableSlots);

  if (toDispatch < count) {
    const err = new PeerCapExceeded({ requested: count, dispatched: toDispatch, limit: maxConcurrentPeers });
    emit('fanout.notice', err.message);
    // still continue with whatever fits (dispatch-fewer-and-say-so), not a full refusal - the
    // notice above already told the caller why the count was reduced.
  }

  let notice = toDispatch < count
    ? `Peer cap reached, dispatching ${toDispatch} of ${count} peers`
    : null;

  if (spendCeilingUsd !== null && toDispatch > 0) {
    const n = peersWithinSpendCeiling(aggregateSpendUsd(), toDispatch, spendCeilingUsd, estimatedUsdPerPeer);
    if (n < toDispatch) {
      const err = new PeerSpendCapExceeded({
        requested: count, dispatched: n, ceilingUsd: spendCeilingUsd, aggregateUsd: aggregateSpendUsd(),
      });
      emit('fanout.notice', err.message);
      notice = err.message;
      toDispatch = n;
    }
  }

  const dispatched = [];
  for (let i = 0; i < toDispatch; i += 1) {
    const peerId = `peer-${nextPeerSeq}`;
    nextPeerSeq += 1;
    dispatched.push(spawnPeer(peerId, task, emit, timeoutMs));
  }

  return { dispatched, notice };
}

/** An operator's Stop on one peer - same clean SIGTERM/SIGKILL escalation as a seat's Stop. */
export function stopPeer(peerId) {
  const entry = activePeers.get(peerId);
  if (entry) entry.stopPeer();
}

/** Stop every currently-running peer - the fan-out-level equivalent of Stop All. */
export function stopAllPeers() {
  for (const entry of activePeers.values()) entry.stopPeer();
}
