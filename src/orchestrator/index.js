#!/usr/bin/env node
// The orchestrator core (PLAN.md "Orchestrator core"). Runs as a child process the Tauri Rust
// shell spawns on app start with --port 0; binds an ephemeral local WebSocket, prints the chosen
// port to stdout as `PORT:<port>` so the shell can read it and hand it to the frontend, then
// dispatches seat start/stop commands to the invocation-mode-specific adapter and rebroadcasts
// every seat event (PLAN.md "Status/event model": seat.start/working/output/idle/problem).
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { startClaudeCodeSeat, stopClaudeCodeSeat } from './adapters/claudeCodeSubprocess.js';
import { startMessagesApiSeat } from './adapters/messagesApi.js';
import { startRelayChainSeat } from './adapters/relayChainSubprocess.js';
import { isAllowedProvider } from './providers.js';
import { writeCompareSnapshot } from './compareSnapshot.js';

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
    for (const seatId of unique) {
      const workdir = seats[seatId]?.workdir;
      if (workdir) writeCompareSnapshot(join(root, workdir));
    }
  }
  for (const seatId of unique) startSeat(wss, seatId, task);
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
