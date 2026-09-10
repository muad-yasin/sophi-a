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
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { root } from '../index.js';

const HEARTBEAT_MS = 30_000; // re-emit seat.working during long tool calls so it never looks stale
const TIMEOUT_MS = 300_000; // 300s, per PLAN.md's status/event model table

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
  runningChildren.set(seatId, child);

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

  timeoutTimer = setTimeout(() => {
    finish(detail => emit('seat.problem', detail), `seat ${seatId}: no result after ${TIMEOUT_MS / 1000}s, killing`);
    child.kill();
  }, TIMEOUT_MS);

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
      if (msg.is_error) {
        finish(detail => emit('seat.problem', detail), msg.result || 'claude-code turn ended in error');
      } else {
        finish(detail => emit('seat.idle', detail));
      }
    }
    // other line types (e.g. rate_limit_event) are ignored
  }

  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // last element may be a partial line - keep buffering it
    for (const line of lines) handleLine(line);
  });

  let stderrOutput = '';
  child.stderr.on('data', chunk => { stderrOutput += chunk.toString(); });

  child.on('exit', code => {
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

export function stopClaudeCodeSeat(seatId) {
  const child = runningChildren.get(seatId);
  if (child) {
    child.kill();
    runningChildren.delete(seatId);
  }
}
