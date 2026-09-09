#!/usr/bin/env node
// The orchestrator core (PLAN.md "Orchestrator core"). Runs as a child process the Tauri Rust
// shell spawns on app start with --port 0; binds an ephemeral local WebSocket, prints the chosen
// port to stdout as `PORT:<port>` so the shell can read it and hand it to the frontend, then
// dispatches seat start/stop commands to the invocation-mode-specific adapter and rebroadcasts
// every seat event (PLAN.md "Status/event model": seat.start/working/output/idle/problem).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { startClaudeCodeSeat, stopClaudeCodeSeat } from './adapters/claudeCodeSubprocess.js';
import { startMessagesApiSeat } from './adapters/messagesApi.js';
import { startRelayChainSeat, resolveRelayPath } from './adapters/relayChainSubprocess.js';
import { isAllowedProvider } from './providers.js';
import { writeCompareSnapshot, changedSinceSnapshot, diffAgainstSnapshot, currentFileHash } from './compareSnapshot.js';
import { estimateChainCost } from './costEstimate.js';

const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, '../..'); // cnc-harness repo root
const seats = JSON.parse(readFileSync(join(here, 'seats.json'), 'utf8'));

// In-memory Map<seatId, 'idle'|'working'|'problem'> - an implementation detail behind the event
// bus below, not a second source of truth (PLAN.md "Orchestrator core").
const status = new Map(Object.keys(seats).map(id => [id, 'idle']));

const adapters = {
  'claude-code-subprocess': { start: startClaudeCodeSeat, stop: stopClaudeCodeSeat },
  'messages-api': { start: startMessagesApiSeat, stop: null },
  'relay-chain-subprocess': { start: startRelayChainSeat, stop: null },
};

function broadcast(wss, event) {
  const msg = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(msg);
  }
}

function makeEmit(wss, seatId) {
  return (type, detail) => {
    if (type === 'seat.working') status.set(seatId, 'working');
    else if (type === 'seat.idle') status.set(seatId, 'idle');
    else if (type === 'seat.problem') status.set(seatId, 'problem');
    const event = { type, seatId, timestamp: Date.now(), ...(detail !== undefined ? { detail } : {}) };
    broadcast(wss, event);
  };
}

// `cnc`'s native invocation_mode is claude-code-subprocess (Anthropic only - real tool use, file
// edits, --resume continuity). PLAN.md's second 2026-09-09 addendum makes `cnc` (and `advisor`,
// already messages-api) provider-selectable: when a seat declares `provider` and it isn't
// `anthropic`, a claude-code-subprocess seat falls back to messages-api - a real chat seat on
// that provider, honestly without tool-use/file-editing, never a faked equivalent coding agent.
function effectiveInvocationMode(seat) {
  if (seat.invocation_mode === 'claude-code-subprocess' && seat.provider && seat.provider !== 'anthropic') {
    return 'messages-api';
  }
  return seat.invocation_mode;
}

export function startSeat(wss, seatId, task) {
  const seat = seats[seatId];
  if (!seat) throw new Error(`Unknown seat: ${seatId}`);
  const mode = effectiveInvocationMode(seat);
  const adapter = adapters[mode];
  if (!adapter) throw new Error(`No adapter for invocation_mode: ${mode}`);
  return adapter.start(seatId, seat, task, makeEmit(wss, seatId));
}

export function stopSeat(seatId) {
  const seat = seats[seatId];
  const adapter = seat && adapters[effectiveInvocationMode(seat)];
  if (adapter?.stop) adapter.stop(seatId);
}

// Parallel-build-and-compare (PLAN_PARALLEL_BUILD.md §3, build order item 1): a fan-out dispatch
// of one identical task string to more than one builder at once. Fan-out is capped at the three
// existing builder seats (PLAN_PARALLEL_BUILD.md A5 - no new seats for this feature).
const BUILDER_SEAT_IDS = ['build-1', 'build-2', 'build-3'];

// seatId -> { siblings, taskId, task } for the most recent comparison dispatch it was part of -
// siblings feed the "same"/"differs" cross-builder badge (§4); taskId/task are what item 4's
// pick action names in its run record. In-memory, replaced on every new comparison dispatch -
// item 4's run *records* are the persistent history, this is only "the last group this seat was
// part of" for computing badges and knowing who else participated when a pick happens.
const compareGroups = new Map();

// Enforced here, not just in the UI's confirmation modal - PLAN_PARALLEL_BUILD.md §3 is explicit
// that the cost gate must be "backend-enforced, not just a UI courtesy": a direct WS call with
// two or more seatIds and confirmed !== true is rejected before any subprocess exists, the same
// way configureSeat below rejects a disallowed provider before any API call is attempted.
export function startMany(wss, seatIds, task, confirmed) {
  if (!Array.isArray(seatIds) || seatIds.length === 0) {
    console.error('start_many rejected: seatIds must be a non-empty array');
    return;
  }
  const unique = [...new Set(seatIds)];
  if (!unique.every(id => BUILDER_SEAT_IDS.includes(id))) {
    console.error(`start_many rejected: seatIds must all be builder seats (${BUILDER_SEAT_IDS.join(', ')})`);
    return;
  }
  if (unique.length > 1 && confirmed !== true) {
    console.error('start_many rejected: dispatching to more than one seat requires confirmed:true');
    return;
  }
  // Build order item 2 (PLAN_PARALLEL_BUILD.md §4): a dispatch-time snapshot manifest per
  // participating workdir, taken before any seat spawns - only meaningful (and only taken) for a
  // real multi-seat comparison run; an ordinary single-builder dispatch (unique.length === 1)
  // never goes through startMany at all (the frontend sends a plain {cmd:'start'} for that case),
  // but this guard also covers a single-seat startMany call directly, which needs no snapshot.
  if (unique.length > 1) {
    const taskId = String(Date.now());
    for (const seatId of unique) {
      const workdir = seats[seatId]?.workdir;
      if (workdir) writeCompareSnapshot(join(root, workdir));
      compareGroups.set(seatId, { siblings: unique.filter(id => id !== seatId), taskId, task });
    }
  }
  for (const seatId of unique) startSeat(wss, seatId, task);
}

// Build order item 3 (PLAN_PARALLEL_BUILD.md §4): read-only queries for the comparison UI. These
// are request/response, not broadcast - the existing seat.* event vocabulary is for state every
// connected client needs pushed to it; a file tree or a diff is only relevant to whichever client
// asked, so both reply directly on the requesting `ws`, never via `broadcast()`.
function handleInspectChanges(ws, seatId) {
  const workdir = seats[seatId]?.workdir;
  if (!workdir) {
    ws.send(JSON.stringify({ type: 'compare.changes', seatId, error: 'no workdir for this seat' }));
    return;
  }
  const result = changedSinceSnapshot(join(root, workdir));
  if (!result) {
    ws.send(JSON.stringify({ type: 'compare.changes', seatId, error: 'no snapshot - this seat was never part of a comparison run' }));
    return;
  }
  // "same"/"differs"/"unique" (PLAN_PARALLEL_BUILD.md §4) - computed against whichever other
  // seats this one was last dispatched together with, comparing current file hashes, never the
  // snapshot (the badge is about the *result*, not about what changed).
  const siblingWorkdirs = (compareGroups.get(seatId)?.siblings || [])
    .map(sid => seats[sid]?.workdir)
    .filter(Boolean)
    .map(w => join(root, w));
  const myWorkdir = join(root, workdir);
  for (const change of result.changes) {
    const myHash = currentFileHash(myWorkdir, change.path);
    const siblingHashes = siblingWorkdirs.map(w => currentFileHash(w, change.path)).filter(h => h !== null);
    if (siblingHashes.length === 0) change.crossBuilder = 'unique';
    else change.crossBuilder = siblingHashes.every(h => h === myHash) ? 'same' : 'differs';
  }
  ws.send(JSON.stringify({ type: 'compare.changes', seatId, takenAt: result.takenAt, changes: result.changes }));
}

function handleGetDiff(ws, seatId, path) {
  const workdir = seats[seatId]?.workdir;
  if (!workdir || typeof path !== 'string' || path.includes('..')) {
    ws.send(JSON.stringify({ type: 'compare.diff', seatId, path, error: 'invalid seat or path' }));
    return;
  }
  const patch = diffAgainstSnapshot(join(root, workdir), path);
  if (!patch) {
    ws.send(JSON.stringify({ type: 'compare.diff', seatId, path, error: 'no snapshot and no current file - nothing to diff' }));
    return;
  }
  ws.send(JSON.stringify({ type: 'compare.diff', seatId, path, patch }));
}

// Build order item 4 (PLAN_PARALLEL_BUILD.md §5): pick + disposition. Run records live under
// the repo's own .workdirs/.compare/ (not inside any one builder's workdir, so picking never
// touches the thing being judged) - one JSON file per comparison task, named by its dispatch
// timestamp. This is the persistent history item 3's in-memory `compareGroups` deliberately
// isn't.
const COMPARE_RECORDS_DIR = join(root, '.workdirs', '.compare');

// §5 is explicit: "the select_winner write path rejects any call that did not originate from a
// frontend human click event" - humanClick is that flag. Every WS command in this file is
// already only ever sent from a real UI action today, so this is defense-in-depth against a
// future caller (another tool, a script, a later automation) picking a winner without a human -
// not a defense against anything that can reach this code path right now.
function handleSelectWinner(wss, seatId, humanClick) {
  if (humanClick !== true) {
    console.error('select_winner rejected: missing human-click origin flag');
    return;
  }
  const group = compareGroups.get(seatId);
  if (!group) {
    console.error(`select_winner rejected: "${seatId}" is not part of a known comparison run`);
    return;
  }
  const participants = [seatId, ...group.siblings];
  mkdirSync(COMPARE_RECORDS_DIR, { recursive: true });
  const record = {
    taskId: group.taskId,
    task: group.task,
    winner: seatId,
    participants,
    pickedAt: Date.now(),
  };
  writeFileSync(join(COMPARE_RECORDS_DIR, `${group.taskId}.json`), JSON.stringify(record, null, 2));
  // Broadcast, unlike inspect_changes/get_diff above - a pick changes shared state (every
  // participating tile's Winner/Retained badge), not a per-client query result. No single
  // `seatId` here - this event is about the whole group, not one seat.
  broadcast(wss, { type: 'compare.pick', winner: seatId, participants, taskId: group.taskId });
}

// Disposition (§5): retained in place, unconditionally, until a human explicitly deletes it -
// never moved, renamed, or auto-deleted by anything else in this file. Same human-click guard as
// select_winner, for the same reason.
function handleDeleteWorkdir(seatId, humanClick) {
  if (humanClick !== true) {
    console.error('delete_workdir rejected: missing human-click origin flag');
    return;
  }
  const workdir = seats[seatId]?.workdir;
  if (!workdir) {
    console.error(`delete_workdir rejected: "${seatId}" has no workdir`);
    return;
  }
  const full = join(root, workdir);
  if (existsSync(full)) rmSync(full, { recursive: true, force: true });
  compareGroups.delete(seatId);
}

function handleListCompareRuns(ws) {
  if (!existsSync(COMPARE_RECORDS_DIR)) {
    ws.send(JSON.stringify({ type: 'compare.history', runs: [] }));
    return;
  }
  const runs = readdirSync(COMPARE_RECORDS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(readFileSync(join(COMPARE_RECORDS_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.pickedAt - a.pickedAt);
  ws.send(JSON.stringify({ type: 'compare.history', runs }));
}

// Build order item 5 (PLAN_PARALLEL_BUILD.md §6): a non-binding advisor recommendation over a
// comparison group. Deliberately bypasses the normal startSeat/adapter dispatch table used
// everywhere else in this file - this is a one-off aside to advisor, not a generic seat command,
// and it needs the 'compare' mode flag messagesApi.js's startMessagesApiSeat takes only for this
// call. Summaries only (changed-file lists), never full diffs, per §6's own token-cost note.
// Takes one seat id - the group is whichever seats it was last dispatched with (`compareGroups`,
// the same lookup §4's cross-builder badge uses), so the frontend only needs to know which tile
// it was clicked from, not the whole group's membership.
function handleAdvisorRecommend(wss, seatId) {
  const group = compareGroups.get(seatId);
  if (!group) {
    console.error(`advisor_recommend rejected: "${seatId}" is not part of a known comparison run`);
    return;
  }
  const unique = [seatId, ...group.siblings];
  // A short current-content preview per changed file - not the full diff (§6's own token-cost
  // concern), but enough real signal to actually judge by. Without this, two builders that both
  // *added* a same-named file read as identical from the status/path alone ("added impl.py" vs
  // "added impl.py") even when their content is completely different - found by actually running
  // this and watching advisor correctly decline to guess, rather than assumed up front.
  const PREVIEW_CHARS = 200;
  const summaries = unique.map(seatId => {
    const workdir = seats[seatId]?.workdir;
    const result = workdir ? changedSinceSnapshot(join(root, workdir)) : null;
    const files = (result?.changes || []).map(c => {
      if (c.status === 'deleted') return `${c.status} ${c.path}`;
      let preview = '';
      try {
        const full = join(root, workdir, c.path);
        const text = readFileSync(full, 'utf8').slice(0, PREVIEW_CHARS);
        preview = ` -> "${text.replace(/\s+/g, ' ').trim()}${text.length === PREVIEW_CHARS ? '...' : ''}"`;
      } catch {
        // binary or unreadable - status/path alone is still better than nothing
      }
      return `${c.status} ${c.path}${preview}`;
    }).join('; ') || '(no changes recorded)';
    return `${seatId} changed: ${files}`;
  });
  // Found by actually running this and reading the reply: without the original task text,
  // advisor correctly refused to guess which result was "right" rather than fabricate a
  // preference - honest, but not useful. Including it is the fix, not a design change.
  const task = `The task given to each builder was: "${group.task}"\n\nCompare what each one ` +
    `actually did and give your one-line recommendation.\n\n${summaries.join('\n')}`;
  startMessagesApiSeat('advisor', seats.advisor, task, makeEmit(wss, 'advisor'), 'compare');
}

// Cost transparency (market-positioning.md feature idea #3, last item of "build all of it, in
// that order"): a plan-N tile's own real relay chain, priced by relay's own `--dry-run` before
// anyone spends real money starting it. Request/response, not broadcast - like inspect_changes/
// get_diff above, a price estimate is only relevant to whichever client asked for it.
function handleEstimateCost(ws, seatId) {
  const seat = seats[seatId];
  const chain = seat?.default_chain;
  if (!chain) {
    ws.send(JSON.stringify({ type: 'cost.estimate', seatId, error: `"${seatId}" has no relay chain to price` }));
    return;
  }
  const result = estimateChainCost(resolveRelayPath(), chain);
  ws.send(JSON.stringify({ type: 'cost.estimate', seatId, chain, ...result }));
}

// Only cnc/advisor declare a `provider` field in seats.json at all (PLAN.md's second 2026-09-09
// addendum) - the other six seats have no configurable provider/model and this is rejected for
// them. Runtime-only mutation of the in-memory seat entry, never written back to seats.json; that
// matches the ephemeral nature of an in-memory session (seats.json stays the on-disk default).
const CONFIGURABLE_SEAT_IDS = new Set(['cnc', 'advisor']);

export function configureSeat(seatId, { provider, model } = {}) {
  if (!CONFIGURABLE_SEAT_IDS.has(seatId)) {
    console.error(`configure rejected: seat "${seatId}" is not configurable`);
    return;
  }
  const seat = seats[seatId];
  if (!seat) {
    console.error(`configure rejected: unknown seat "${seatId}"`);
    return;
  }
  if (provider !== undefined) {
    if (!isAllowedProvider(provider)) {
      console.error(`configure rejected: provider "${provider}" is not in cnc-harness's allowed-provider list`);
      return;
    }
    seat.provider = provider;
  }
  if (model !== undefined && model !== '') {
    seat.model = model;
  }
}

export function getStatus(seatId) {
  return status.get(seatId);
}

function main() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });

  wss.on('connection', ws => {
    // Replay current status of every seat so a client connecting mid-session renders correctly.
    for (const [seatId, st] of status) {
      ws.send(JSON.stringify({ type: `seat.${st}`, seatId, timestamp: Date.now() }));
    }
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.cmd === 'start') startSeat(wss, msg.seatId, msg.task);
      else if (msg.cmd === 'stop') stopSeat(msg.seatId);
      else if (msg.cmd === 'configure') configureSeat(msg.seatId, { provider: msg.provider, model: msg.model });
      else if (msg.cmd === 'start_many') startMany(wss, msg.seatIds, msg.task, msg.confirmed);
      else if (msg.cmd === 'inspect_changes') handleInspectChanges(ws, msg.seatId);
      else if (msg.cmd === 'get_diff') handleGetDiff(ws, msg.seatId, msg.path);
      else if (msg.cmd === 'select_winner') handleSelectWinner(wss, msg.seatId, msg.humanClick);
      else if (msg.cmd === 'delete_workdir') handleDeleteWorkdir(msg.seatId, msg.humanClick);
      else if (msg.cmd === 'list_compare_runs') handleListCompareRuns(ws);
      else if (msg.cmd === 'advisor_recommend') handleAdvisorRecommend(wss, msg.seatId);
      else if (msg.cmd === 'estimate_cost') handleEstimateCost(ws, msg.seatId);
    });
  });

  wss.on('listening', () => {
    const { port } = wss.address();
    // The Tauri shell reads this exact line from stdout to discover the ephemeral port.
    console.log(`PORT:${port}`);
    // Also drop it in a well-known file so src/mcp/server.js (a separate process, not spawned by
    // Tauri) can find the same running orchestrator without the user copying a port number by
    // hand. Last-writer-wins if more than one instance is running - fine for a debugging aid, not
    // meant to arbitrate between concurrent instances.
    try {
      writeFileSync(join(tmpdir(), 'sophia-orchestrator-port'), String(port));
    } catch {
      // non-fatal - the MCP server just won't find a port to connect to
    }
  });
}

// Only run the server when this file is the actual entry point (not when adapters import
// sibling helpers or a test imports startSeat/stopSeat directly).
if (import.meta.url === `file://${process.argv[1]}`) main();
