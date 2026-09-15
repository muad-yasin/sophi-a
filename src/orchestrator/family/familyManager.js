// Sophi-A Seat Families F7 (relay/Docs/SophiA-Seat-Families-Plan.md §5 "F7 - Lifecycle
// integration"; council build order in relay/runs/2026-09-15T19-57-10-287Z/deliverable.md §c).
// The one composition point wiring F0-F6 together: dispatch = caps -> runtime -> receipt ->
// gate -> event. This is Session E's own module.
//
// SCOPE NOTE, not silently glossed over: F3 (familyLedger v2), F5 (chat/council runtimes) and F6
// (securityGate.js) were not built tonight - Sessions C and D did not land (see
// relay/Docs/SophiA-Seat-Families-OVERNIGHT.md for why, they are different reasons). This module
// therefore only wires the `claude-code` runtime (via F0's generalized `fanOut()`), and the
// gate/Apply path is a documented no-op stub, refused rather than faked - `family_dispatch` on a
// `chat`/`council` session, and `family_apply`, both return a clear "not built tonight" error
// rather than pretending to work. Every function this module DOES implement is real and tested.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createFamily, loadFamilies, writeSessionState, writeTurnResult, readSession, defaultFamiliesRoot } from './familyMemory.js';
import { admit } from './familyCaps.js';
import { decide, hashTask } from './compassionPolicy.js';
import { classify } from '../compassionStates.js';
import { fanOut, stopAllPeers } from '../peer-pool.js';

// One manager instance per orchestrator process - the same "one module owns the live map" shape
// peer-pool.js itself uses for activePeers. sessionId -> { ownerSeat, familyId, peerId }
const liveSessions = new Map();

// familiesRoot is accepted end-to-end (test-only override, same convention as F0's
// SOPHIA_FAMILIES_CONFIG_PATH) so tests can isolate a temp directory instead of touching the
// real .families/ tree - undefined in every real call site, which falls through to F1's own
// defaultFamiliesRoot().
function familyRef(ownerSeat, familyId, familiesRoot) {
  const dir = join(familiesRoot ?? defaultFamiliesRoot(), ownerSeat, familyId);
  return { ownerSeat, familyId, dir };
}

// F1's writeSessionState()/readSession() persist a fixed field set (see familyMemory.js's own
// doc comment) that does not include lastTaskHash or failedOwnedCountOnPlanItem -
// compassionPolicy's own inputs, which are this module's responsibility to track (per B's
// DECISIONS.md note on F2's data contract), not F1's. Rather than widen F1's contract mid-build
// (a different session's file, out of scope tonight), this manager keeps its own small sidecar
// file next to state.json, same atomic temp-then-rename write F1 itself uses.
function metaPath(family, sessionId) {
  return join(family.dir, 'sessions', sessionId, 'family-manager-meta.json');
}
function readMeta(family, sessionId) {
  const p = metaPath(family, sessionId);
  if (!existsSync(p)) return { lastTaskHash: null, failedOwnedCountOnPlanItem: 0 };
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { lastTaskHash: null, failedOwnedCountOnPlanItem: 0 };
  }
}
function writeMeta(family, sessionId, meta) {
  const p = metaPath(family, sessionId);
  mkdirSync(join(p, '..'), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, JSON.stringify(meta, null, 2));
  renameSync(tmp, p);
}

/**
 * Create a family. Q1's binding answer: human-only, humanClick:true required end to end, zero
 * `.families/` directories created otherwise.
 */
export function familyCreate({ ownerSeat, familyId, brief, plan, humanClick, familiesRoot }) {
  if (!humanClick) {
    throw new Error('family_create refused: humanClick:true is required (Q1 - a family is created only by a human)');
  }
  return createFamily({ ownerSeat, familyId, brief, plan }, familiesRoot ?? defaultFamiliesRoot());
}

/**
 * List families, optionally scoped to one owner seat. Recomputes every ledger view fresh from
 * disk each call (F1's own memory-drift guarantee) - this function adds no caching of its own.
 */
export function familyList({ ownerSeat = null, familiesRoot } = {}) {
  const { families } = loadFamilies(familiesRoot ?? defaultFamiliesRoot());
  return ownerSeat ? families.filter(f => f.ownerSeat === ownerSeat) : families;
}

/**
 * Dispatch one turn into a family session. Creates the session on first dispatch (status
 * `created` -> `running`), or resumes an existing one. Runtime `claude-code` only tonight (F0's
 * generalized fanOut()); `chat`/`council` refused with a clear not-built error, never faked.
 *
 * @param {{ownerSeat, familyId, sessionId, task, runtime?, planItem?, timeoutMs?}} params
 * @returns {Promise<{ok: boolean, status?: string, reason?: string, peerId?: string}>}
 */
export async function familyDispatch({ ownerSeat, familyId, sessionId, task, runtime = 'claude-code', planItem = null, timeoutMs, caps = null, familiesRoot }, emit = () => {}) {
  if (runtime !== 'claude-code') {
    return { ok: false, reason: `family_dispatch refused: runtime "${runtime}" is not built tonight (F5/Session C did not land) - only "claude-code" is wired` };
  }

  const family = familyRef(ownerSeat, familyId, familiesRoot);
  const existing = readSession(family, sessionId);
  const meta = readMeta(family, sessionId);
  const taskHash = hashTask(task);

  // Refusal gates, checked before any spawn - identical re-dispatch and the second-owned-failure
  // escalation are both compassionPolicy's job, not this function's to reimplement.
  if (existing.ok && (existing.status === 'failed-owned' || existing.status === 'stuck' || existing.status === 'holdout' || existing.status === 'needs-human')) {
    const decision = decide({
      state: existing.status === 'needs-human' ? 'failed-owned' : existing.status,
      failedOwnedCountOnPlanItem: meta.failedOwnedCountOnPlanItem,
      lastTaskHash: meta.lastTaskHash,
      proposedTaskHash: taskHash,
      proposedContextAdded: [],
    });
    if (!decision.allowed.includes('restart-with-context') && existing.status !== 'stuck') {
      return { ok: false, reason: decision.refused[0]?.reason ?? 'dispatch refused', status: existing.status };
    }
  }
  if (existing.ok && existing.status === 'running') {
    return { ok: false, reason: 'a turn is already running on this session', status: 'running' };
  }
  if (existing.ok && existing.status === 'interrupted') {
    return { ok: false, reason: 'session is interrupted; needs an explicit resume:true (Q5) - not built into this WS surface tonight, use family_dispatch after confirming state by hand', status: 'interrupted' };
  }

  // F4's admission check. With no live caps wiring from config tonight (families.config.json's
  // per-seat rows are F0's, not re-derived here), a caller-supplied `caps` object is honored if
  // given; with none given, admission is not gated by this call (F0's fanOut() still enforces
  // its own seat-level cap independently - this is not a bypass of that).
  if (caps) {
    const result = admit(caps);
    if (result.count < 1) {
      return { ok: false, reason: result.notice ?? 'cap reached', status: existing.status ?? 'created' };
    }
  }

  const sessionHandle = existing.ok ? existing.handle ?? null : null;
  const priorTurnCount = existing.ok ? existing.turnCount ?? 0 : 0;
  writeSessionState(family, {
    sessionId, runtime, status: 'running', planItem,
    handle: sessionHandle,
    turnCount: priorTurnCount,
  });
  writeMeta(family, sessionId, { lastTaskHash: taskHash, failedOwnedCountOnPlanItem: meta.failedOwnedCountOnPlanItem });

  return new Promise(resolve => {
    let settled = false;
    // `emit` here is the exact callback fanOut() closes over for the one peer THIS call spawns
    // (peer-pool.js's spawnPeer builds a fresh handleLine/finish closure per invocation) - no
    // peerId filter is needed or even reliable: a manual/Stop-All peer.idle
    // (peer-pool.js's stopThisPeer -> finish(detail => emit('peer.idle', detail))) passes no
    // detail at all, so a `detail?.peerId` filter would hang forever on an operator Stop. Found
    // while building this test, not silently worked around - real gap named for A/F0.
    const wrappedEmit = (type, detail) => {
      emit(type, detail);
      if (type === 'peer.start') {
        // capture the real session_id for --resume on the *next* dispatch, per F0's own doc note
        // that persisting handles across calls is this module's job, not fanOut()'s.
        pendingHandle = detail?.sessionId ?? sessionHandle;
      }
      if (settled) return;
      if (type === 'peer.idle') {
        settled = true;
        finalize('idle', null);
      } else if (type === 'peer.problem' || type === 'peer.timeout') {
        settled = true;
        finalize(type === 'peer.timeout' ? 'stuck' : 'failed-owned', detail?.detail ?? null);
      }
    };

    let pendingHandle = sessionHandle;
    const peerIdRef = { current: null };

    function finalize(outcome, errorDetail) {
      liveSessions.delete(sessionId);
      const turn = priorTurnCount + 1; // writeTurnResult requires a positive integer, 1-based
      const runRecord = outcome === 'failed-owned'
        ? { exitCode: 1, lastOutputAt: null, holdout: null }
        : outcome === 'stuck'
          ? { exitCode: null, lastOutputAt: Date.now() - 301_000, holdout: null }
          : { exitCode: 0, lastOutputAt: null, holdout: null };
      const classified = outcome === 'idle' ? 'success' : classify(runRecord);
      const status = classified === 'success' ? 'idle' : classified;

      writeTurnResult(family, sessionId, turn, {
        outcome: classified,
        error: errorDetail,
        endedAt: Date.now(),
      });

      const currentFailCount = status === 'failed-owned'
        ? meta.failedOwnedCountOnPlanItem + 1
        : meta.failedOwnedCountOnPlanItem;

      writeSessionState(family, {
        sessionId, runtime, status,
        planItem,
        handle: pendingHandle,
        turnCount: turn,
      });
      writeMeta(family, sessionId, { lastTaskHash: taskHash, failedOwnedCountOnPlanItem: currentFailCount });

      emit('family.session.state', { ownerSeat, familyId, sessionId, status });
      resolve({ ok: status !== 'failed-owned', status, peerId: peerIdRef.current });
    }

    try {
      const { dispatched } = fanOut(ownerSeat, {
        count: 1,
        task,
        timeoutMs,
        sessionHandles: sessionHandle ? [sessionHandle] : [],
      }, wrappedEmit);
      peerIdRef.current = dispatched[0] ?? null;
      if (!peerIdRef.current) {
        settled = true;
        liveSessions.delete(sessionId);
        writeSessionState(family, { sessionId, runtime, status: 'stopped', planItem, handle: sessionHandle, turnCount: priorTurnCount });
        resolve({ ok: false, reason: 'fanOut dispatched zero peers (cap reached)', status: 'stopped' });
        return;
      }
      liveSessions.set(sessionId, { ownerSeat, familyId, peerId: peerIdRef.current });
    } catch (err) {
      settled = true;
      resolve({ ok: false, reason: err.message, status: existing.ok ? existing.status : 'created' });
    }
  });
}

/** Operator Stop on one family session - same clean semantics as a seat's Stop. */
export function familyStop({ ownerSeat, familyId, sessionId, familiesRoot }) {
  const entry = liveSessions.get(sessionId);
  if (!entry) return { ok: false, reason: 'no live session with that id' };
  liveSessions.delete(sessionId);
  writeSessionState(familyRef(ownerSeat, familyId, familiesRoot), { sessionId, runtime: 'claude-code', status: 'stopped' });
  return { ok: true };
}

/** Close is human-only, independent of compassionPolicy.decide() (B's documented Q2 reading). */
export function familyClose({ ownerSeat, familyId, sessionId, humanClick, familiesRoot }) {
  if (!humanClick) {
    throw new Error('family_close refused: humanClick:true is required - close is a human-only action, never automated');
  }
  liveSessions.delete(sessionId);
  writeSessionState(familyRef(ownerSeat, familyId, familiesRoot), { sessionId, runtime: 'claude-code', status: 'closed' });
  return { ok: true };
}

/**
 * Restart handling (Q5): every family session this process still has as `running` in memory
 * lost its in-flight turn's real fate when the process restarted. Mark each `interrupted`
 * (never silently resumed - Q5's binding "no auto-resume" answer) with its handle intact.
 */
export function familyManagerRestartRecovery({ familiesRoot } = {}) {
  const { families } = loadFamilies(familiesRoot ?? defaultFamiliesRoot());
  let marked = 0;
  for (const family of families) {
    for (const session of family.sessions ?? []) {
      if (session.status === 'running') {
        writeSessionState(familyRef(family.ownerSeat, family.familyId, familiesRoot), {
          ...session, status: 'interrupted',
        });
        marked += 1;
      }
    }
  }
  return { marked };
}

/** Stop All must mean all (F7's own test requirement) - family sessions stop alongside seats/peers. */
export function familyStopAll() {
  const ids = [...liveSessions.keys()];
  liveSessions.clear();
  stopAllPeers();
  return { stopped: ids };
}

export function familyLiveSessionCount() {
  return liveSessions.size;
}
