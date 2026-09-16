// The claude-code-subprocess seat adapter (PLAN.md "Seat invocation mechanism" >
// "claude-code-subprocess seats"), used by seats cnc, build-1..3. Each turn spawns the real
// `claude` CLI with --output-format stream-json, continuing the same conversation across turns
// via --resume once a session_id is known.
//
// Real stream-json shape observed (verified with `claude -p "..." --output-format stream-json
// --verbose`), newline-delimited JSON, one object per line:
//   {"type":"system","subtype":"init","session_id":"...",...}                -> seat.start
//   {"type":"rate_limit_event",...}                                          -> ignored
//   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}} -> seat.working + seat.output
//   {"type":"assistant","message":{"content":[{"type":"tool_use",...}]}}     -> seat.working (no output)
//   {"type":"result","subtype":"success","is_error":false,"result":"..."}    -> seat.idle
//   {"type":"result","is_error":true,...}                                    -> seat.problem
//
// The "result" line also carries real cost/usage fields not shown above when this comment was
// first written - re-verified live for Phase 2 Step 2 (cost meter), `claude -p "..."
// --output-format stream-json --verbose`, 2026-09-10:
//   {"type":"result",...,"total_cost_usd":0.0722352,"usage":{"input_tokens":2,"output_tokens":4,...}}
// `total_cost_usd` is a real dollar figure computed by the CLI itself - used as-is, never
// re-derived from pricing.json (that table is for the messages-api path only, which gets no $
// figure from relay's call()).
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { root } from '../index.js';
import { recordUsage } from '../cost-tracker.js';
import { safeEnv, RESTRICTED_ARGS } from '../envRestrictions.js';

const HEARTBEAT_MS = 30_000; // re-emit seat.working during long tool calls so it never looks stale
const DEFAULT_TIMEOUT_MS = 300_000; // fallback only - every real seat in seats.json sets its own
// timeout_ms now (Phase 2 Step 1's per-seat-type defaults: 120000 chat, 600000 plan, 300000
// build - see DECISIONS.md); this constant exists so a hand-built seatConfig missing the field
// (e.g. an older on-disk seats.json, or a test fixture) still gets a sane watchdog instead of none.

// Phase 2 Step 1 (Stop-All + watchdog): once a process is asked to stop - by the watchdog below
// or by an operator's Stop/Stop-All click - it gets 5s to exit cleanly from SIGTERM before this
// escalates. Windows has no real SIGTERM/SIGKILL distinction (node's child.kill() always
// terminates immediately there), so the escalation path there is `taskkill /F` instead of a
// second signal - named explicitly in the plan for this reason.
const KILL_ESCALATION_MS = 5_000;

// safeEnv()/RESTRICTED_ARGS moved to ../envRestrictions.js (Sophi-A Seat Families F0, closing
// the plan's own regression risk (3): this file and peer-pool.js used to carry two independent
// copies of this security-relevant allowlist). Import only, no local definition here anymore -
// enforced by test/env-restrictions.test.mjs's source-grep.

// Muad's explicit call (2026-09-15): a public/released Sophi-A build must never let cnc/build-N
// ride the operator's own claude.ai subscription login - the same way every other provider needs
// a real key, this must too. src-tauri/src/lib.rs sets SOPHIA_REQUIRE_API_KEY only on a release
// build (cfg!(debug_assertions)), never a dev one, so a contributor running `npm run tauri dev`
// keeps today's convenience unchanged. `--bare` is Claude Code's own documented flag for this
// exact case ("Anthropic auth is strictly ANTHROPIC_API_KEY ... OAuth and keychain are never
// read" - verified via `claude --help`, not assumed).
const REQUIRE_API_KEY = process.env.SOPHIA_REQUIRE_API_KEY === '1';

// One session id per seat, so later turns continue the same claude-code conversation via
// --resume rather than starting a fresh one each time (PLAN.md: "held open interactively" means
// a fresh short-lived process per turn, continuity carried by --resume).
const sessionIds = new Map();
const runningChildren = new Map();

function workdirFor(seatConfig) {
  if (!seatConfig.workdir) return null;
  const dir = path.join(root, seatConfig.workdir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Start one claude-code-subprocess seat turn (cnc, build-1..3).
 * @param {string} seatId
 * @param {object} seatConfig - this seat's entry from seats.json (has `.workdir` for build-N)
 * @param {string} task - the message/prompt for this turn
 * @param {(type: string, detail?: any) => void} emit
 */
export function startClaudeCodeSeat(seatId, seatConfig, task, emit) {
  if (REQUIRE_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    emit('seat.start');
    emit('seat.problem',
      `seat ${seatId}: this build requires a real Anthropic API key (Setup → provider keys) - ` +
      `it will not fall back to a claude.ai subscription login`);
    return;
  }
  const args = [
    '-p', task, '--output-format', 'stream-json', '--verbose',
    ...(REQUIRE_API_KEY ? ['--bare'] : []),
    ...RESTRICTED_ARGS,
  ];
  const existingSessionId = sessionIds.get(seatId);
  if (existingSessionId) args.push('--resume', existingSessionId);

  // docs/security-prompt-injection.md S1/P2: `--add-dir <dir>` alongside `cwd: dir` used to be
  // dead weight - the same directory twice, granting nothing extra. Now that RESTRICTED_ARGS
  // confines file tools to "the working directories (--add-dir included)", `cwd` alone already
  // puts this seat's own workdir in that set; there is no second directory any seat needs, so
  // dropping the redundant flag rather than keeping it "just in case" - live-verified (raw
  // `claude -p`, `--restricted` + `--tools` + `cwd` alone, no `--add-dir`) that Write/Bash still
  // work with `cwd` doing this on its own.
  const dir = workdirFor(seatConfig);

  const child = spawn('claude', args, { cwd: dir || root, env: safeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });

  // Per-seat watchdog timeout (seats.json's `timeout_ms` - the unwind-cost item decided in
  // DECISIONS.md ahead of this step): how long this seat may go completely silent (no stdout/
  // stderr at all) before it's treated as stuck and auto-stopped. Read once per turn - a live
  // `configure` change to a running seat's timeout isn't a thing this product does.
  const timeoutMs = seatConfig.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  let exited = false; // set true the instant the OS process actually exits - independent of
  // `finished` below, which tracks the *seat's* lifecycle (a stop can be requested, and finish()
  // called, slightly before the OS actually reaps the process).

  // SIGTERM first, escalate to SIGKILL (or `taskkill /F` on Windows, which has no real SIGTERM/
  // SIGKILL distinction - node's child.kill() there always terminates immediately) after
  // KILL_ESCALATION_MS if the process is still alive. Used by both the watchdog firing below and
  // stopClaudeCodeSeat (an operator's Stop/Stop-All click).
  function killEscalating() {
    if (exited) return;
    if (process.platform === 'win32') {
      child.kill();
      setTimeout(() => {
        if (!exited) spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']);
      }, KILL_ESCALATION_MS);
    } else {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
      }, KILL_ESCALATION_MS);
    }
  }

  runningChildren.set(seatId, { child, killEscalating, stopSeat: stopThisSeat });

  let buffer = '';
  let finished = false;
  let heartbeat = null;
  let timeoutTimer = null;

  function clearTimers() {
    if (heartbeat) clearInterval(heartbeat);
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }

  function finish(fn, detail) {
    if (finished) return;
    finished = true;
    clearTimers();
    runningChildren.delete(seatId);
    fn(detail);
  }

  // Resets on every stdout/stderr event (armed below, and again inside both data handlers) -
  // silence past timeoutMs, not merely a fixed deadline from spawn, is what "stuck" means here.
  // Verified live without waiting a real 120s: seatConfig.timeout_ms set to 5000 against a fake
  // `claude` that never writes stdout fires this at ~5s (scripts/test-stopall-watchdog.mjs).
  function armWatchdog() {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(() => {
      finish(detail => emit('seat.timeout', detail),
        `seat ${seatId}: no output for ${timeoutMs / 1000}s, stopped automatically`);
      killEscalating();
    }, timeoutMs);
  }

  // An operator's Stop (or Stop-All) click: this is a deliberate, requested stop, not a crash -
  // the seat resets to idle, honestly, rather than reading as a "problem" it didn't have.
  function stopThisSeat() {
    finish(detail => emit('seat.idle', detail));
    killEscalating();
  }

  armWatchdog();

  // Progress subtitle (rich status cards, 2026-09-16): "N files touched" counted from the CLI's
  // own stream - every Write/Edit/MultiEdit tool_use block names its target in `input.file_path`
  // (the same `assistant` lines this handler already reads for text blocks; tool_use blocks were
  // discarded before). Distinct paths per turn, never a guess; a turn with no file tool calls
  // simply reports 0. There is no "N agents" figure for a build seat: --tools above never grants
  // the Agent tool, so a seat has no sub-agents to count - the UI omits it rather than invent one.
  const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
  const touched = new Set();
  let toolCalls = 0;

  function handleLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; } // partial/malformed line, ignore
    if (msg.type === 'system' && msg.subtype === 'init') {
      if (msg.session_id) sessionIds.set(seatId, msg.session_id);
      emit('seat.start');
      heartbeat = setInterval(() => { if (!finished) emit('seat.working'); }, HEARTBEAT_MS);
    } else if (msg.type === 'assistant') {
      emit('seat.working');
      const blocks = msg.message?.content || [];
      for (const b of blocks.filter(b => b.type === 'text')) emit('seat.output', b.text);
      const toolUses = blocks.filter(b => b.type === 'tool_use');
      if (toolUses.length) {
        toolCalls += toolUses.length;
        for (const t of toolUses) {
          if (FILE_TOOLS.has(t.name) && typeof t.input?.file_path === 'string') touched.add(t.input.file_path);
        }
        emit('seat.progress', { kind: 'claude-code', filesTouched: touched.size, toolCalls });
      }
    } else if (msg.type === 'result') {
      if (msg.session_id) sessionIds.set(seatId, msg.session_id);
      // Usage hook (Phase 2 Step 2, cost meter): emitted regardless of success/error - a
      // failed turn still spent real tokens, and the honesty invariant ("usage not reported",
      // never a silent 0) applies just as much to a problem tile as an idle one.
      emit('seat.usage', recordUsage({
        provider: 'anthropic',
        model: seatConfig.model,
        inputTokens: msg.usage?.input_tokens,
        outputTokens: msg.usage?.output_tokens,
        usd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined,
      }));
      if (msg.is_error) {
        finish(detail => emit('seat.problem', detail), msg.result || 'claude-code turn ended in error');
      } else {
        finish(detail => emit('seat.idle', detail));
      }
    }
    // other line types (e.g. rate_limit_event) are ignored
  }

  child.stdout.on('data', chunk => {
    armWatchdog();
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // last element may be a partial line - keep buffering it
    for (const line of lines) handleLine(line);
  });

  let stderrOutput = '';
  child.stderr.on('data', chunk => { armWatchdog(); stderrOutput += chunk.toString(); });

  child.on('exit', code => {
    exited = true;
    if (finished) return;
    if (buffer.trim()) handleLine(buffer);
    if (!finished) {
      finish(detail => emit('seat.problem', detail),
        `seat ${seatId}: claude process exited with code ${code} before a result line arrived` +
        (stderrOutput ? `: ${stderrOutput.slice(0, 300)}` : ''));
    }
  });

  child.on('error', err => {
    finish(detail => emit('seat.problem', detail), `seat ${seatId}: failed to spawn claude - ${err.message}`);
  });
}

// An operator's Stop click (or Stop-All, index.js's stopAll iterating every running seat) - the
// process gets a clean SIGTERM/SIGKILL(or taskkill /F) escalation, same as the watchdog's own
// auto-stop path, but resolves the seat to idle rather than "timed out" or "problem": this was
// asked for, not a failure.
export function stopClaudeCodeSeat(seatId) {
  const entry = runningChildren.get(seatId);
  if (entry) entry.stopSeat();
}
