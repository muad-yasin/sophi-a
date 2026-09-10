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

// docs/security-prompt-injection.md S1/P0: a claude-code-subprocess seat (cnc, build-1..3) must
// never inherit process.env wholesale. The orchestrator's own env accumulates every saved
// provider API key (src-tauri/src/lib.rs's spawn_orchestrator) plus whatever relay's .env holds
// (messagesApi.js's loadRelayEnv merges it into process.env on first use) - a builder that runs
// `env` in Bash would otherwise see all of it in one shot. Build the child's env from an
// allowlist instead of filtering process.env, so nothing new leaks in by accident later.
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'USERNAME', 'SHELL'];

function safeEnv() {
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // The one exception: the claude CLI's own Anthropic auth. An OAuth session lives under HOME
  // (already kept above); API-key auth needs ANTHROPIC_API_KEY specifically. Every OTHER
  // provider key (OPENAI_API_KEY, OPENROUTER_API_KEY, ...) stays out - a claude-code-subprocess
  // seat never calls those providers, so it never needs their keys.
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  return env;
}

// Same doc, S1: no --permission-mode/--allowedTools meant the only thing standing between an
// injected instruction and real damage was whatever the user's own global ~/.claude/settings.json
// happened to allow. --restricted ignores user/project/local settings files entirely (closing
// the "a builder writes .workdirs/build-N/.claude/settings.json to grant itself Bash(*)" vector),
// confines file tools to the working directory (--add-dir included), and refuses
// --dangerously-skip-permissions outright. --tools re-admits exactly what a builder needs to do
// its job (code-running tools are stripped by --restricted "unless --tools names them") - Bash,
// the file tools, and TodoWrite - deliberately not WebFetch/WebSearch, which nothing in this
// product's design says a builder needs. --strict-mcp-config means no MCP server is loaded at
// all, so a seat can no longer start a real, paid relay run via mcp__relay__* outside Sophi-A's
// own plan-N path and its start_many cost gate.
//
// --permission-mode: tried "dontAsk" + "--permission-prompts none" first, per the doc's own
// suggestion ("something that denies rather than prompts") - verified live (raw `claude -p`,
// not just read the flag descriptions) that this denies Write AND Bash outright, not just the
// things outside --tools's allowlist. That would have silently broken every builder's actual
// job. "acceptEdits" is what --restricted's own examples pair with real non-interactive work:
// verified live that it lets Write/Edit/Bash actually execute (a real file got created, a real
// echo ran, permission_denials: []) while --restricted's other protections (no local settings,
// confined to the working dir, no bypassPermissions) still hold. --permission-prompts none stays
// on top of it as a hang-safety net, not the thing doing the work: if some other tool category
// ever *would* prompt under acceptEdits, this makes that resolve to a fast deny instead of a
// silent hang until TIMEOUT_MS - verified this combination still lets Write/Bash through too.
const RESTRICTED_ARGS = [
  '--restricted',
  '--tools', 'Bash,Edit,Write,Read,Glob,Grep,MultiEdit,TodoWrite',
  '--strict-mcp-config',
  '--permission-mode', 'acceptEdits',
  '--permission-prompts', 'none',
];

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
  const args = ['-p', task, '--output-format', 'stream-json', '--verbose', ...RESTRICTED_ARGS];
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
      const textBlocks = (msg.message?.content || []).filter(b => b.type === 'text');
      for (const b of textBlocks) emit('seat.output', b.text);
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
