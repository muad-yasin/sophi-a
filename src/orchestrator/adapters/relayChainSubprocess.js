// The relay-chain-subprocess seat adapter (PLAN.md "Seat invocation mechanism" >
// "relay-chain-subprocess seats"), used by seats plan-1..3. Spawns relay's own CLI
// (src/cli.js) as a real background chain run and reports progress by polling the run
// folder it writes to disk - the same discovery/poll pattern relay's own MCP server's
// `start_run` tool uses (relay/src/mcp/server.js), just without an MCP client in between.
//
// This module does not modify relay in any way: it only writes one throwaway task file
// under <relayPath>/tasks/ and spawns `node <relayPath>/src/cli.js` as a detached child.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { root } from '../index.js';

const RUN_DISCOVERY_POLL_MS = 250;
const RUN_DISCOVERY_MAX_ATTEMPTS = 20; // ~5s, matching relay's own start_run tool
const RUN_POLL_MS = 3000;
const RUN_TIMEOUT_MS = 600_000; // 600s - a real multi-lab chain run takes minutes, not seconds

// Resolved lazily (inside the exported function, not at module top-level) because this
// module and src/orchestrator/index.js import each other; `root` is a live ES-module
// binding that is only actually assigned by the time a seat is started, not at import time.
function resolveRelayPath() {
  return resolve(process.env.RELAY_PATH || join(root, '..', 'relay'));
}

/**
 * Start one relay-chain-subprocess seat (plan-1..3).
 * @param {string} seatId
 * @param {object} seatConfig - this seat's entry from seats.json (has `default_chain`)
 * @param {string} task - the planning request text for this relay run
 * @param {(type: string, detail?: any) => void} emit
 */
export function startRelayChainSeat(seatId, seatConfig, task, emit) {
  const relayPath = resolveRelayPath();
  const runsDir = join(relayPath, 'runs');
  const tasksDir = join(relayPath, 'tasks');
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  const timestamp = Date.now();
  const taskFileName = `cnc-harness-${seatId}-${timestamp}.md`;
  const taskRelPath = join('tasks', taskFileName);
  writeFileSync(join(tasksDir, taskFileName), task);

  const chain = seatConfig.default_chain;
  const cli = join(relayPath, 'src', 'cli.js');
  const args = [cli, '--chain', chain, '--task', taskRelPath];

  // Snapshot runs/ before spawning so the new run folder can be found by diffing -
  // exactly what relay/src/mcp/server.js's start_run tool does.
  const before = new Set(readdirSync(runsDir));

  // The child's stdout/stderr (relay's own CLI console output, a duplicate of run.log)
  // goes to a side log file next to relay's runs/, not to this process's stdout/stderr.
  const sideLogPath = join(relayPath, `cnc-harness-${seatId}-${timestamp}.log`);
  const fd = openSync(sideLogPath, 'a');
  const child = spawn('node', args, { cwd: relayPath, detached: true, stdio: ['ignore', fd, fd] });

  emit('seat.start');

  let exited = false;
  let exitCode = null;
  child.on('exit', code => { exited = true; exitCode = code; });
  child.unref();

  const startedAt = Date.now();
  let runId = null;
  let runDir = null;
  let lastLineCount = 0;
  let discoveryAttempts = 0;
  let discoveryTimer = null;
  let pollTimer = null;
  let finished = false;

  function stopTimers() {
    if (discoveryTimer) clearInterval(discoveryTimer);
    if (pollTimer) clearInterval(pollTimer);
  }

  function fail(detail) {
    if (finished) return;
    finished = true;
    stopTimers();
    emit('seat.problem', detail);
  }

  function succeed(detail) {
    if (finished) return;
    finished = true;
    stopTimers();
    emit('seat.idle', detail);
  }

  function readNewLogLines() {
    const logFile = join(runDir, 'run.log');
    if (!existsSync(logFile)) return [];
    const content = readFileSync(logFile, 'utf8');
    const lines = content.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (lines.length <= lastLineCount) return [];
    const fresh = lines.slice(lastLineCount);
    lastLineCount = lines.length;
    return fresh;
  }

  // A short, human-readable summary of report.json's open objections, for the operator
  // to read via the advisor pane or the C&C chat (PLAN.md's seat.problem detail).
  function summarizeFailures(report) {
    const failures = report.lastCritique?.failures;
    if (Array.isArray(failures) && failures.length) {
      return `relay run ${runId} finished without sign-off: ` +
        failures.map(f => `${f.lab ? `${f.lab}: ` : ''}${f.problem || f.criterion}`).join('; ');
    }
    return `relay run ${runId} finished without sign-off (report.json passed: false), no specific objections recorded`;
  }

  function poll() {
    if (finished) return;
    if (Date.now() - startedAt > RUN_TIMEOUT_MS) {
      fail(`relay-chain-subprocess seat ${seatId}: no report.json after ${RUN_TIMEOUT_MS / 1000}s (run ${runId})`);
      return;
    }
    for (const line of readNewLogLines()) {
      emit('seat.working');
      emit('seat.output', line);
    }
    const reportPath = join(runDir, 'report.json');
    if (existsSync(reportPath)) {
      let report;
      try {
        report = JSON.parse(readFileSync(reportPath, 'utf8'));
      } catch {
        fail(`relay-chain-subprocess seat ${seatId}: report.json in run ${runId} could not be parsed`);
        return;
      }
      // "Surface the debate, don't hide it" (docs/market-positioning.md's headline feature
      // idea): report.json already has exactly the structured data a real "who objected, what
      // got overruled" UI needs (relay/src/cli.js's own report-writing code) - signoff per lab,
      // the proposal scoreboard, and the specific objections behind a non-pass. Previously this
      // only ever reached the UI as a flattened string (summarizeFailures, below) buried in a
      // seat.problem's detail; emitted here as its own structured event so a real panel can be
      // built from it instead of parsed back out of prose.
      emit('debate.report', {
        runId,
        passed: report.passed,
        signoff: report.signoff || null,
        scoreboard: report.scoreboard || null,
        failures: report.lastCritique?.failures || null,
      });
      if (report.passed === true) {
        const deliverablePath = join(runDir, 'deliverable.md');
        const deliverable = existsSync(deliverablePath)
          ? readFileSync(deliverablePath, 'utf8')
          : '(report.json passed but no deliverable.md was written)';
        succeed(deliverable);
      } else {
        fail(summarizeFailures(report));
      }
      return;
    }
    if (exited && exitCode !== 0) {
      fail(`relay-chain-subprocess seat ${seatId}: relay process exited with code ${exitCode} before report.json appeared (run ${runId})`);
    }
  }

  function discover() {
    discoveryAttempts += 1;
    const found = readdirSync(runsDir).find(d => !before.has(d));
    if (found) {
      clearInterval(discoveryTimer);
      discoveryTimer = null;
      runId = found;
      runDir = join(runsDir, found);
      pollTimer = setInterval(poll, RUN_POLL_MS);
      poll();
      return;
    }
    if (discoveryAttempts >= RUN_DISCOVERY_MAX_ATTEMPTS) {
      clearInterval(discoveryTimer);
      discoveryTimer = null;
      if (exited && exitCode !== 0) {
        fail(`relay-chain-subprocess seat ${seatId}: relay process exited with code ${exitCode} before its run folder appeared under ${runsDir}`);
      } else {
        fail(`relay-chain-subprocess seat ${seatId}: no run folder appeared under ${runsDir} within ${(RUN_DISCOVERY_MAX_ATTEMPTS * RUN_DISCOVERY_POLL_MS) / 1000}s`);
      }
    }
  }

  discoveryTimer = setInterval(discover, RUN_DISCOVERY_POLL_MS);
}
