// Phase 3 Step 1 (relay run 2026-09-10T20-03-03-692Z's revise-1.md): the run recorder.
// `recordRun(seatId, runDir)` persists a plan-N seat's finished relay run under this repo's own
// `runs/<seatId>/<timestamp>/`, so past runs survive relay's own run folder being reused/cleaned
// and can be replayed later (Phase 3 Step 2) without a second live source of truth.
//
// Real-codebase correction, verified before writing this file (not assumed from the plan text):
// the plan's own wording says this copies "events.jsonl and report.json". Grepped relay's actual
// source (`~/Projects/relay/src/*.js`) and inspected several real run directories under
// `~/Projects/relay/runs/` - relay never writes a file named `events.jsonl` anywhere; the only
// per-run files are `report.json` and `run.log` (the same file relayChainSubprocess.js itself
// already tails for live progress). Recorded here, not silently substituted: this module copies
// `report.json` + `run.log` (kept under its real name, not renamed to a misleading `.jsonl`
// extension it doesn't have) and a `meta.json` manifest is added for the schema-version tag the
// plan's own unwind-cost list item 7 requires. Full reasoning in DECISIONS.md.
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { root } from './index.js';

export const MAX_RUNS_PER_SEAT = 50;

// Computed lazily inside a function, not at module top level - same reasoning as
// relayChainSubprocess.js's own resolveRelayPath(): this module and index.js import each other
// (relayChainSubprocess.js -> run-recorder.js -> index.js, and index.js itself imports
// run-recorder.js directly too), and `root` is a live ES-module binding index.js only actually
// assigns partway through its own top-level evaluation. A top-level `join(root, 'runs')` here
// would run before that assignment on the real app's import order (index.js -> adapters ->
// run-recorder.js), throwing "Cannot access 'root' before initialization" - caught by direct
// integration testing (a fake relay CLI + startRelayChainSeat), not by reading the code alone.
export function runsDir() {
  return join(root, 'runs');
}

// Unwind-cost list item 7: a version tag on the *replay parser's own assumptions* about
// report.json's shape (passed/signoff/scoreboard/lastCritique.failures - the fields
// relayChainSubprocess.js and main.ts's renderDebatePanel already depend on), so a future relay
// report.json schema change is detected rather than silently misreading an old saved run.
export const REPLAY_SCHEMA_VERSION = 1;

function seatRunsDir(seatId) {
  return join(runsDir(), seatId);
}

/**
 * Copy one finished relay run's report.json (+ run.log, if present) out of relay's own
 * `<relayPath>/runs/<runId>/` into this repo's `runs/<seatId>/<runId>/`, then evict the oldest
 * runs past MAX_RUNS_PER_SEAT for that seat. Reuses relay's own run id (already a sortable
 * ISO-ish timestamp string, e.g. "2026-09-10T20-03-03-692Z") as the destination directory name,
 * rather than a fresh `Date.now()` computed at record time - traceable back to the source run,
 * naturally sorts chronologically, and can't collide with a same-millisecond sibling call.
 *
 * Called once report.json exists on disk, before it's necessarily known to be valid JSON - a
 * corrupted report.json is still a real run worth keeping a record of (Phase 3 Step 2's own
 * acceptance test replays a corrupted report and expects an explicit error, not a missing run).
 *
 * @param {string} seatId
 * @param {string} runDir - relay's own run directory, e.g. `<relayPath>/runs/<runId>`
 * @returns {string|null} the destination directory, or null if there was no report.json to copy
 */
export function recordRun(seatId, runDir) {
  const reportSrc = join(runDir, 'report.json');
  if (!existsSync(reportSrc)) return null;

  const runId = basename(runDir);
  const destDir = join(seatRunsDir(seatId), runId);
  mkdirSync(destDir, { recursive: true });

  copyFileSync(reportSrc, join(destDir, 'report.json'));
  const logSrc = join(runDir, 'run.log');
  if (existsSync(logSrc)) copyFileSync(logSrc, join(destDir, 'run.log'));

  writeFileSync(join(destDir, 'meta.json'), JSON.stringify({
    schemaVersion: REPLAY_SCHEMA_VERSION,
    recordedAt: Date.now(),
    seatId,
    sourceRunId: runId,
    sourceRunDir: runDir,
  }, null, 2));

  evictOldest(seatId);
  return destDir;
}

function evictOldest(seatId) {
  const dir = seatRunsDir(seatId);
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir).filter(name => statSync(join(dir, name)).isDirectory()).sort(); // ISO run ids sort chronologically as plain strings
  const excess = entries.length - MAX_RUNS_PER_SEAT;
  for (let i = 0; i < excess; i++) {
    rmSync(join(dir, entries[i]), { recursive: true, force: true });
  }
}

/**
 * List a seat's recorded runs, newest first. Each entry is just enough for a history dropdown -
 * the full report is only read on demand by `readRecordedRun`, not eagerly for every entry.
 * @param {string} seatId
 * @returns {{runId: string, recordedAt: number|null}[]}
 */
export function listRecordedRuns(seatId) {
  const dir = seatRunsDir(seatId);
  if (!existsSync(dir)) return [];
  const runIds = readdirSync(dir).filter(name => statSync(join(dir, name)).isDirectory());
  return runIds
    .map(runId => {
      let recordedAt = null;
      try {
        recordedAt = JSON.parse(readFileSync(join(dir, runId, 'meta.json'), 'utf8')).recordedAt ?? null;
      } catch {
        // meta.json missing or unreadable - still list the run by its id, just without a
        // recordedAt timestamp; the run id itself (relay's own ISO-ish timestamp) is real.
      }
      return { runId, recordedAt };
    })
    .sort((a, b) => b.runId.localeCompare(a.runId));
}

// The minimal shape Phase 3 Step 2's replay (and the live debate.report path it mirrors,
// main.ts's DebateReportDetail) actually reads. Anything missing/wrong-typed here means this
// saved report.json can't be trusted to render - "unreadable report", never an empty/partial pane
// (Step 2's own acceptance test).
function isReadableReport(report) {
  return (
    report && typeof report === 'object' &&
    typeof report.passed === 'boolean' &&
    (report.signoff === null || report.signoff === undefined || Array.isArray(report.signoff)) &&
    (report.scoreboard === null || report.scoreboard === undefined || typeof report.scoreboard === 'object')
  );
}

/**
 * Read one recorded run back for replay. Never throws - a corrupted/missing/malformed
 * report.json comes back as `{ ok: false, error: 'unreadable report' }`, exactly the shape Step
 * 2's acceptance test asks for, so the caller can render that state instead of an empty pane.
 * @param {string} seatId
 * @param {string} runId
 */
export function readRecordedRun(seatId, runId) {
  const dir = join(seatRunsDir(seatId), runId);
  const reportPath = join(dir, 'report.json');
  if (!existsSync(reportPath)) return { ok: false, error: 'unreadable report' };
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    return { ok: false, error: 'unreadable report' };
  }
  if (!isReadableReport(report)) return { ok: false, error: 'unreadable report' };

  let meta = { schemaVersion: 0 }; // 0 = recorded before meta.json existed, or unreadable - unknown, not fatal
  try {
    meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  } catch {
    // fine - meta.json is a bookkeeping aid, not the source of truth for the report itself
  }
  return { ok: true, report, meta };
}

/**
 * Raw run.log lines for a recorded run, for the MCP `get_seat_logs` tool. Same "never throw, come
 * back as an explicit error" contract as readRecordedRun.
 */
export function readRecordedLog(seatId, runId) {
  const logPath = join(seatRunsDir(seatId), runId, 'run.log');
  if (!existsSync(logPath)) return { ok: false, error: 'no run.log recorded for this run' };
  try {
    return { ok: true, log: readFileSync(logPath, 'utf8') };
  } catch {
    return { ok: false, error: 'run.log could not be read' };
  }
}
