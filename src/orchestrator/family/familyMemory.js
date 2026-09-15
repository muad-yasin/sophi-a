// Sophi-A Seat Families F1 (relay/Docs/SophiA-Seat-Families-Plan.md §2.3, §2.4; council revisions
// in relay/runs/2026-09-15T19-57-10-287Z/deliverable.md §b "Memory-drift risk" and §d.6-7): the
// durable, file-based memory store for a seat-owned family. "Files are truth; memory is a loaded
// copy" (§2.3) - every function here either writes one atomic JSON/text file or reads one back;
// nothing is cached across calls except what `loadFamilies()`'s caller explicitly passes back in
// as `cache`.
//
// Contract:
//   createFamily({ownerSeat, familyId, brief, plan, caps?, runtimes?}, familiesRoot?) -> descriptor
//   loadFamilies(familiesRoot?, {cache?, emit?}) -> { families, cache }
//   writeSessionState(family, session) -> the written state object
//   writeTurnResult(family, sessionId, turn, result) -> the written record
//   readSession(family, sessionId) -> { ok, sessionId, status, ... } | { ok:false, sessionId, status:'unreadable', error }
//
// Persisted layout (§2.3), under `.families/<ownerSeat>/<familyId>/`:
//   family.json, FAMILY.md, plan.md, sessions/<id>/{state.json, turns/NNNN.result.json, context/}
//
// Atomic writes: temp-then-rename in the same directory (backend-developer's persistence
// checklist) - a reader can never observe a half-written file, because the target path is only
// ever replaced by a rename, never opened for partial writes.
//
// Every JSON write carries `schemaVersion`; a corrupt or unparseable file degrades to
// `{ok:false, error}` (readSession) or is skipped with its error recorded (loadFamilies) - never
// thrown, per §2.3's own rule and backend-developer's persistence checklist.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { root as orchestratorRoot } from '../index.js';

export const SCHEMA_VERSION = 1;

// §d.6: state.json's enum, corrected by the council's state-machine walk (added `stopped` and
// `interrupted`, both missing from the plan's original diagram).
export const SESSION_STATES = [
  'created', 'running', 'idle', 'stopped', 'failed-owned', 'stuck', 'holdout',
  'needs-human', 'unreadable', 'interrupted', 'closed',
];

export function defaultFamiliesRoot() {
  return join(orchestratorRoot, '.families');
}

// Security review fix (Fable 5.1 + sophi-a-ed's independent review of b31f95f, MEDIUM: path
// traversal): every id this module accepts (ownerSeat, familyId, sessionId) ends up in a
// join() call. Neither caller-side validation existed before this fix - a familyId like
// "../../../home/user/.claude" would have escaped .families/ entirely. Applied at every public
// entry point that accepts a raw id, not just createFamily.
const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertSafeSegment(name, value) {
  if (typeof value !== 'string' || !SAFE_SEGMENT_RE.test(value) || value.includes('..')) {
    throw new Error(`${name}: "${value}" is not a valid identifier (alphanumeric/._- only, no path separators, no "..")`);
  }
  return value;
}

function familyDirOf(family, familiesRoot) {
  if (family?.dir) return family.dir;
  assertSafeSegment('ownerSeat', family.ownerSeat);
  assertSafeSegment('familyId', family.familyId);
  return join(familiesRoot ?? defaultFamiliesRoot(), family.ownerSeat, family.familyId);
}

function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, filePath); // rename is the only thing that ever creates/replaces filePath
}

// Same rename-only publish step as atomicWriteJson, for the two plain-text files createFamily
// writes - fixes the file header's "every write here is atomic" claim, which previously covered
// only the JSON writer (sophi-a-ed's review, LOW item 7).
function atomicWriteText(filePath, text) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(tmpPath, text, 'utf8');
  renameSync(tmpPath, filePath);
}

function readJsonOrError(filePath) {
  if (!existsSync(filePath)) return { ok: false, error: 'missing' };
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (e) {
    return { ok: false, error: e.message };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: `corrupt JSON: ${e.message}` };
  }
}

/**
 * Create a new family directory: family.json, FAMILY.md (verbatim brief), plan.md (verbatim
 * initial plan text), and an empty sessions/ dir. Q1's binding answer (§a): the caller - not
 * this function - is responsible for confirming `humanClick:true` before ever calling this; the
 * WS handler layer (F7, a later session) enforces that gate, not the memory store.
 * @param {{ownerSeat: string, familyId: string, brief?: string, plan?: string, caps?: object|null, runtimes?: string[]}} opts
 * @param {string} [familiesRoot]
 */
export function createFamily({ ownerSeat, familyId, brief = '', plan = '', caps = null, runtimes = null }, familiesRoot = defaultFamiliesRoot()) {
  assertSafeSegment('ownerSeat', ownerSeat);
  assertSafeSegment('familyId', familyId);
  const dir = join(familiesRoot, ownerSeat, familyId);
  mkdirSync(join(dir, 'sessions'), { recursive: true });

  const familyJson = {
    schemaVersion: SCHEMA_VERSION,
    ownerSeat,
    familyId,
    createdAt: Date.now(),
    caps: caps ?? null,
    runtimes: runtimes ?? ['claude-code', 'chat', 'council'],
  };
  atomicWriteJson(join(dir, 'family.json'), familyJson);
  // Verbatim only - same rule as the TODO pill (§2.3): nothing here summarises the brief or plan.
  atomicWriteText(join(dir, 'FAMILY.md'), brief);
  atomicWriteText(join(dir, 'plan.md'), plan);

  return { dir, ownerSeat, familyId };
}

/**
 * Write (or overwrite) one session's state.json. Checkpoint-on-transition, not autosave (§2.3):
 * called at every lifecycle transition, never on a timer.
 * @param {{dir?: string, ownerSeat?: string, familyId?: string}} family
 * @param {{sessionId: string, runtime: string, status: string, provider?: string|null, model?: string|null, handle?: string|null, planItem?: string|null, turnCount?: number, lastTurnAt?: number|null}} session
 */
export function writeSessionState(family, session) {
  if (!SESSION_STATES.includes(session.status)) {
    throw new Error(`writeSessionState: unknown status "${session.status}" - expected one of ${SESSION_STATES.join(', ')}`);
  }
  assertSafeSegment('sessionId', session.sessionId);
  const dir = familyDirOf(family);
  const sessionDir = join(dir, 'sessions', session.sessionId);
  mkdirSync(join(sessionDir, 'turns'), { recursive: true });
  mkdirSync(join(sessionDir, 'context'), { recursive: true });

  const state = {
    schemaVersion: SCHEMA_VERSION,
    runtime: session.runtime,
    provider: session.provider ?? null,
    model: session.model ?? null,
    handle: session.handle ?? null,
    status: session.status,
    planItem: session.planItem ?? null,
    turnCount: session.turnCount ?? 0,
    lastTurnAt: session.lastTurnAt ?? null,
  };
  atomicWriteJson(join(sessionDir, 'state.json'), state);
  return state;
}

/**
 * Read one session's state.json. Never throws: a missing or corrupt file reads back as
 * `{ok:false, status:'unreadable', error}` (§2.3's own rule), not an exception.
 * @param {{dir?: string, ownerSeat?: string, familyId?: string}} family
 * @param {string} sessionId
 */
export function readSession(family, sessionId) {
  assertSafeSegment('sessionId', sessionId);
  const dir = familyDirOf(family);
  const statePath = join(dir, 'sessions', sessionId, 'state.json');
  const result = readJsonOrError(statePath);
  if (!result.ok) {
    return { ok: false, sessionId, status: 'unreadable', error: result.error };
  }
  // Security review fix (LOW - spread order): file content spread FIRST, so a tampered or
  // malformed state.json can never override the trusted ok/sessionId fields this function itself
  // sets - the file may only fill in the rest.
  return { ...result.value, ok: true, sessionId };
}

/**
 * Write one turn's result record (a receipt - §2.5's own shape, this module only persists it,
 * never interprets it). Written when the result line arrives, before the corresponding event is
 * emitted (backend-developer rule 8: emit only after committing).
 * @param {{dir?: string, ownerSeat?: string, familyId?: string}} family
 * @param {string} sessionId
 * @param {number} turn
 * @param {object} result - the §2.5 receipt fields (exitCode, isError, usage, verify, ...)
 */
export function writeTurnResult(family, sessionId, turn, result) {
  assertSafeSegment('sessionId', sessionId);
  if (!Number.isInteger(turn) || turn < 1) {
    throw new Error(`writeTurnResult: turn must be a positive integer, got ${JSON.stringify(turn)}`);
  }
  const dir = familyDirOf(family);
  const turnsDir = join(dir, 'sessions', sessionId, 'turns');
  mkdirSync(turnsDir, { recursive: true });
  const n = String(turn).padStart(4, '0');
  // Security review fix (LOW - spread order): result spread first, so a caller-supplied result
  // object can never override the authoritative schemaVersion/sessionId/turn fields.
  const record = { ...result, schemaVersion: SCHEMA_VERSION, sessionId, turn };
  atomicWriteJson(join(turnsDir, `${n}.result.json`), record);
  return record;
}

/**
 * Pure read: every turn receipt under one family's sessions/*\/turns/*.result.json, sorted by
 * session id then turn file name. This is the "derived ledger view" the council's memory-drift
 * fix (§b) names - familyLedger.js (F3, a later session) is expected to build its own richer
 * rendering on top of this, not duplicate the file-walking logic.
 * @param {{dir?: string, ownerSeat?: string, familyId?: string}} family
 * @returns {object[]}
 */
export function deriveLedgerView(family) {
  const dir = familyDirOf(family);
  const sessionsDir = join(dir, 'sessions');
  if (!existsSync(sessionsDir)) return [];
  const rows = [];
  for (const sessionId of readdirSync(sessionsDir).sort()) {
    const turnsDir = join(sessionsDir, sessionId, 'turns');
    if (!existsSync(turnsDir)) continue;
    for (const file of readdirSync(turnsDir).filter(f => f.endsWith('.result.json')).sort()) {
      const result = readJsonOrError(join(turnsDir, file));
      if (result.ok) rows.push(result.value);
      // An unreadable turn file is skipped here (not thrown) - loadFamilies' own per-session
      // readSession() call is what surfaces an unreadable *session*; a corrupt individual turn
      // file inside an otherwise-fine session is a narrower, quieter gap, named as a real
      // deviation in DECISIONS.md rather than silently swallowed.
    }
  }
  return rows;
}

function ledgerViewsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Load every family under `familiesRoot`. Implements §2.3's memory-drift fix (council review
 * §b): for each family, the ledger view is recomputed fresh from disk and compared against
 * `cache`'s previously-loaded view (if any); on a mismatch, the freshly-recomputed view wins
 * unconditionally and exactly one `family.notice` fires naming the drift, per family - never one
 * per row, never zero for a real drift.
 * @param {string} [familiesRoot]
 * @param {{cache?: Map<string, object[]>, emit?: (type: string, detail?: any) => void}} [opts]
 * @returns {{ families: object[], cache: Map<string, object[]> }}
 */
export function loadFamilies(familiesRoot = defaultFamiliesRoot(), { cache = new Map(), emit = () => {} } = {}) {
  const families = [];
  const nextCache = new Map();
  if (!existsSync(familiesRoot)) return { families, cache: nextCache };

  for (const ownerSeat of readdirSync(familiesRoot)) {
    const ownerDir = join(familiesRoot, ownerSeat);
    // Security/robustness fix (LOW, both reviews): a bare statSync here threw on a broken
    // symlink or a directory removed between readdirSync and statSync, contradicting this
    // function's own "never throws" contract - guarded the same way the sessions/ loop below
    // already was. lstatSync (not statSync) so a symlink itself, not its target, decides
    // directory-ness - .families/ is orchestrator-owned, but a planted symlink should read as
    // "not a real family dir" rather than be silently followed.
    let ownerStat;
    try { ownerStat = lstatSync(ownerDir); } catch { continue; }
    if (!ownerStat.isDirectory()) continue;

    for (const familyId of readdirSync(ownerDir)) {
      const dir = join(ownerDir, familyId);
      let familyStat;
      try { familyStat = lstatSync(dir); } catch { continue; }
      if (!familyStat.isDirectory()) continue;

      const family = { dir, ownerSeat, familyId };
      const key = `${ownerSeat}/${familyId}`;
      const familyJsonResult = readJsonOrError(join(dir, 'family.json'));
      const freshLedger = deriveLedgerView(family);

      const previousLedger = cache.get(key);
      if (previousLedger !== undefined && !ledgerViewsEqual(previousLedger, freshLedger)) {
        emit('family.notice', {
          ownerSeat,
          familyId,
          notice: `memory drift detected on load: recomputed ledger view (${freshLedger.length} turn(s)) ` +
            `differs from the previously cached view (${previousLedger.length} turn(s)); the recomputed view wins`,
        });
      }
      nextCache.set(key, freshLedger);

      const sessionsDir = join(dir, 'sessions');
      const sessions = existsSync(sessionsDir)
        ? readdirSync(sessionsDir).filter(id => {
          try { return lstatSync(join(sessionsDir, id)).isDirectory(); } catch { return false; }
        }).map(id => readSession(family, id))
        : [];

      families.push({
        ownerSeat,
        familyId,
        dir,
        ok: familyJsonResult.ok,
        familyJson: familyJsonResult.ok ? familyJsonResult.value : null,
        error: familyJsonResult.ok ? null : familyJsonResult.error,
        sessions,
        ledger: freshLedger,
      });
    }
  }

  return { families, cache: nextCache };
}
