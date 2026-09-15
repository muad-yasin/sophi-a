// Sophi-A "family" MVP polish, item 3 (relay/runs/2026-09-15T18-55-34-601Z/build.md §2):
// per-seat "family receipts" - a read-only, derived view of the worker agents (peer-pool peers)
// a seat supervised this session. Never a second source of truth: every row is built from facts
// peer-pool.js's own fanOut() already reports (its `emit(type, detail)` callback) plus the real
// on-disk workdir peer-pool.js itself already creates for every peer - this module makes neither
// of those facts up and stores nothing new to disk. No writeFile/appendFile/mkdir call anywhere
// in this file - enforced by test/family-receipts.test.mjs's own source-grep, not just this
// comment.
//
// Deliberate deviation from the plan's own prose, named here rather than silently reinterpreted:
// the plan describes rows as "sourced only from the existing run-recorder store." Checked before
// writing this file: run-recorder.js is only ever fed by relayChainSubprocess.js
// (grep for `recordRun(` confirms the one call site) - peer-pool.js's fanOut() has never written
// anything to that store, and extending peer-pool.js to do so is out of this item's scope (a
// different module, not touched here). This module instead derives rows directly from
// peer-pool's own real completion events and its own real, already-created workdir per peer -
// still "derived, never self-reported," still nothing new persisted to disk, just not literally
// the run-recorder store, since that store does not carry peer-pool facts today. Recorded in
// DECISIONS.md.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './index.js';

export const MAX_ROWS_PER_SEAT = 10;

// seatId -> row[], newest first. In-memory only - cleared on process restart, same "this
// session" scope the plan's own §2 text describes ("worker agents a seat supervised this
// session"). Never written to disk.
const rowsBySeat = new Map();

function peerWorkdir(peerId) {
  // Mirrors peer-pool.js's own workdirFor(peerId) formula exactly (that function is not
  // exported, so the path is reconstructed here rather than imported - read-only either way,
  // this module never calls mkdirSync itself; peer-pool.js already created the directory by
  // the time any of these events fire).
  return join(root, '.workdirs', 'peers', peerId);
}

function outcomeFor(type, detail) {
  if (type === 'peer.idle') return 'completed - result recorded';
  // 'failure owned' language deliberately matches compassionCopy.js's FAILED-OWNED state
  // (item 4) - the same real near-miss this whole MVP generalizes: a failure is shown
  // verbatim, never silently retried or summarized away.
  const message = typeof detail?.detail === 'string' ? detail.detail : JSON.stringify(detail?.detail ?? null);
  if (type === 'peer.problem') return `failure owned: ${message}`;
  if (type === 'peer.timeout') return `failure owned: ${message}`;
  return null;
}

/**
 * Feed one peer-pool `emit(type, detail)` event into the ledger. Called by whatever already
 * holds peer-pool's own emit callback (a caller's own wiring, e.g. `(type, detail) => {
 * familyLedgerObserve(seatId, type, detail); realEmit(type, detail); }`) - this module never
 * calls fanOut() or spawns anything itself. Only terminal peer events (idle/problem/timeout)
 * produce a row; peer.start/peer.working/peer.output/peer.usage are progress noise for this
 * ledger's purpose (one row per finished worker agent).
 * @param {string} seatId
 * @param {string} type
 * @param {any} detail
 */
export function observePeerEvent(seatId, type, detail) {
  const outcome = outcomeFor(type, detail);
  if (outcome === null) return;
  const peerId = detail?.peerId;
  if (!peerId) return;

  const artifactPath = peerWorkdir(peerId);
  const row = {
    task: peerId,
    outcome,
    timestamp: Date.now(),
    artifactPath: existsSync(artifactPath) ? artifactPath : null,
  };

  const rows = rowsBySeat.get(seatId) || [];
  rows.unshift(row);
  if (rows.length > MAX_ROWS_PER_SEAT) rows.length = MAX_ROWS_PER_SEAT; // oldest evicted
  rowsBySeat.set(seatId, rows);
}

/**
 * The rows one seat's family panel renders, newest first, capped at MAX_ROWS_PER_SEAT.
 * @param {string} seatId
 * @returns {{task: string, outcome: string, timestamp: number, artifactPath: string|null}[]}
 */
export function familyRows(seatId) {
  return [...(rowsBySeat.get(seatId) || [])];
}

/** Test-only reset - clears all in-memory rows for every seat. */
export function _resetFamilyLedgerForTests() {
  rowsBySeat.clear();
}
