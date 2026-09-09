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
  const args = ['-p', task, '--output-format', 'stream-json', '--verbose'];
  const existingSessionId = sessionIds.get(seatId);
  if (existingSessionId) args.push('--resume', existingSessionId);

  const dir = workdirFor(seatConfig);
  if (dir) args.push('--add-dir', dir);

  const child = spawn('claude', args, { cwd: dir || root, stdio: ['ignore', 'pipe', 'pipe'] });
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
