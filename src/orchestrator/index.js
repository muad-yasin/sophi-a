#!/usr/bin/env node
// The orchestrator core (PLAN.md "Orchestrator core"). Runs as a child process the Tauri Rust
// shell spawns on app start with --port 0; binds an ephemeral local WebSocket, prints the chosen
// port to stdout as `PORT:<port>` so the shell can read it and hand it to the frontend, then
// dispatches seat start/stop commands to the invocation-mode-specific adapter and rebroadcasts
// every seat event (PLAN.md "Status/event model": seat.start/working/output/idle/problem).
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { startClaudeCodeSeat, stopClaudeCodeSeat } from './adapters/claudeCodeSubprocess.js';
import { startMessagesApiSeat } from './adapters/messagesApi.js';
import { startRelayChainSeat } from './adapters/relayChainSubprocess.js';

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

export function startSeat(wss, seatId, task) {
  const seat = seats[seatId];
  if (!seat) throw new Error(`Unknown seat: ${seatId}`);
  const adapter = adapters[seat.invocation_mode];
  if (!adapter) throw new Error(`No adapter for invocation_mode: ${seat.invocation_mode}`);
  return adapter.start(seatId, seat, task, makeEmit(wss, seatId));
}

export function stopSeat(seatId) {
  const seat = seats[seatId];
  const adapter = seat && adapters[seat.invocation_mode];
  if (adapter?.stop) adapter.stop(seatId);
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
    });
  });

  wss.on('listening', () => {
    const { port } = wss.address();
    // The Tauri shell reads this exact line from stdout to discover the ephemeral port.
    console.log(`PORT:${port}`);
  });
}

// Only run the server when this file is the actual entry point (not when adapters import
// sibling helpers or a test imports startSeat/stopSeat directly).
if (import.meta.url === `file://${process.argv[1]}`) main();
