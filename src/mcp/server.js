#!/usr/bin/env node
// Sophi-A as an MCP server - the introspection CLAUDE.md's "what's next" named: a native window
// has no console either side can casually read (see DECISIONS.md's debug_log entry, the
// stopgap this complements, not replaces). Mirrors relay's own src/mcp/server.js pattern
// (McpServer + stdio transport, tools mirroring the underlying protocol) but this one drives a
// *running* orchestrator over its existing WebSocket rather than shelling out to a CLI - the
// orchestrator has no CLI of its own, just the WS protocol src/main.ts already speaks.
//
//   claude mcp add sophia -- node /path/to/cnc-harness/src/mcp/server.js
//
// Finds the orchestrator's ephemeral port via the well-known file
// src/orchestrator/index.js writes on startup (tmpdir()/sophia-orchestrator-port) - there is no
// other discovery mechanism, since the port is chosen fresh every launch and Tauri only ever
// hands it to its own frontend, not to an external process.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, watchFile } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const PORT_FILE = join(tmpdir(), 'sophia-orchestrator-port');
// docs/security-prompt-injection.md S0/P0: the orchestrator now requires an auth handshake
// before it dispatches anything - this file is mode 0o600 (index.js writes both with that mode),
// unlike the port number, since this one actually is the secret.
const TOKEN_FILE = join(tmpdir(), 'sophia-orchestrator-token');
const SEAT_IDS = ['cnc', 'advisor', 'plan-1', 'plan-2', 'plan-3', 'build-1', 'build-2', 'build-3'];

// Mirrors main.ts's own in-memory tile state, kept here instead - one persistent WS connection
// for this MCP server's whole lifetime, updated as events arrive, so tool calls answer from
// cache instead of each opening a fresh connection and racing the replay.
const seatState = new Map(SEAT_IDS.map(id => [id, { status: 'idle', lastOutput: null, lastUpdated: null }]));

let ws = null;
let connecting = false;

function readPort() {
  try {
    const raw = readFileSync(PORT_FILE, 'utf8').trim();
    const port = Number(raw);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function readToken() {
  try {
    const raw = readFileSync(TOKEN_FILE, 'utf8').trim();
    return raw || null;
  } catch {
    return null;
  }
}

function connect() {
  if (connecting || (ws && ws.readyState === WebSocket.OPEN)) return;
  const port = readPort();
  const token = readToken();
  if (!port || !token) return; // no orchestrator running (or not yet written its port/token files)
  connecting = true;
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.on('open', () => {
    connecting = false;
    ws = socket;
    ws.send(JSON.stringify({ cmd: 'auth', token }));
  });
  socket.on('message', raw => {
    let evt;
    try { evt = JSON.parse(raw.toString()); } catch { return; }
    const state = seatState.get(evt.seatId);
    if (!state) return;
    if (evt.type === 'seat.working') state.status = 'working';
    else if (evt.type === 'seat.idle') state.status = 'idle';
    else if (evt.type === 'seat.problem') state.status = 'problem';
    if (evt.type === 'seat.output' || (evt.detail !== undefined)) state.lastOutput = evt.detail;
    state.lastUpdated = evt.timestamp;
  });
  socket.on('close', () => { connecting = false; if (ws === socket) ws = null; });
  socket.on('error', () => { connecting = false; if (ws === socket) ws = null; });
}

// The port file changes every launch (a fresh ephemeral port each time) - watch it so this MCP
// server picks up a newly-started orchestrator without needing its own process restarted.
watchFile(PORT_FILE, { interval: 2000 }, () => { ws?.close(); connect(); });
connect();
setInterval(connect, 3000); // also retry on a plain timer, e.g. for the file appearing late

function send(cmd) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('not connected to a running Sophi-A orchestrator - is the app open?');
  }
  ws.send(JSON.stringify(cmd));
}

function seatSnapshot(seatId) {
  const state = seatState.get(seatId);
  return state ? { seatId, ...state } : null;
}

const text = s => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] });
const seatIdSchema = z.enum(SEAT_IDS);

const server = new McpServer({ name: 'sophia', version: '0.1.0' });

server.tool('list_seats', 'Every seat\'s current status (idle/working/problem) and last known output line, from this MCP server\'s live connection to the running orchestrator.', {}, async () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return text({ error: 'not connected - is Sophi-A running?', seats: SEAT_IDS.map(seatSnapshot) });
  }
  return text(SEAT_IDS.map(seatSnapshot));
});

server.tool('get_seat', 'Detailed status for one seat.', { seatId: seatIdSchema }, async ({ seatId }) => {
  return text(seatSnapshot(seatId) ?? { error: `unknown seat: ${seatId}` });
});

server.tool('start_seat', 'Send a task to a seat - the same {cmd:"start"} the app\'s own task-input UI sends. Returns immediately; poll get_seat or use wait_for_idle to see the result.', {
  seatId: seatIdSchema,
  task: z.string(),
}, async ({ seatId, task }) => {
  send({ cmd: 'start', seatId, task });
  return text({ sent: true, seatId });
});

server.tool('stop_seat', 'Stop a running seat (claude-code-subprocess seats only - matches the app\'s own Stop button; a no-op for seat kinds with no stop handler).', { seatId: seatIdSchema }, async ({ seatId }) => {
  send({ cmd: 'stop', seatId });
  return text({ sent: true, seatId });
});

server.tool('configure_seat', 'Set cnc/advisor\'s provider and/or model - the same {cmd:"configure"} the app\'s own provider picker sends. Rejected server-side for any other seat or a disallowed provider (no xai/Grok).', {
  seatId: z.enum(['cnc', 'advisor']),
  provider: z.string().optional(),
  model: z.string().optional(),
}, async ({ seatId, provider, model }) => {
  send({ cmd: 'configure', seatId, provider, model });
  return text({ sent: true, seatId, provider, model });
});

server.tool('wait_for_idle', 'Poll a seat until it leaves "working" (idle or problem) or the timeout elapses - spares a debugging session from hand-rolling a poll loop around get_seat. Call this right after start_seat; it correctly waits for the seat to actually start first, so it never mistakes "hasn\'t picked up the task yet" for "already finished".', {
  seatId: seatIdSchema,
  timeoutMs: z.number().int().positive().max(600_000).default(60_000),
}, async ({ seatId, timeoutMs }) => {
  const calledAt = Date.now();
  let sawWorking = false;
  while (Date.now() - calledAt < timeoutMs) {
    const state = seatState.get(seatId);
    if (state?.status === 'working') sawWorking = true;
    // Only trust a "not working" reading once we've actually seen it go working first, or once
    // an event has arrived since this call started (e.g. it flipped to working and back between
    // polls) - otherwise a seat that was already idle before start_seat was even sent would make
    // this return instantly, reporting a task that hasn't started yet as already done.
    if (state && state.status !== 'working' && (sawWorking || (state.lastUpdated && state.lastUpdated >= calledAt))) {
      return text(seatSnapshot(seatId));
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return text({ ...seatSnapshot(seatId), timedOut: true });
});

const transport = new StdioServerTransport();
await server.connect(transport);
