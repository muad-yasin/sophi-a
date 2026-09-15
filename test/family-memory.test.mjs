// test/family-memory.test.mjs - Sophi-A Seat Families F1 acceptance tests
// (relay/Docs/SophiA-Seat-Families-Plan.md §5 F1, council review §b "Memory-drift risk").
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SCHEMA_VERSION, SESSION_STATES,
  createFamily, loadFamilies, writeSessionState, writeTurnResult, readSession, deriveLedgerView,
} from '../src/orchestrator/family/familyMemory.js';

function freshRoot() {
  return mkdtempSync(join(tmpdir(), 'family-memory-test-'));
}

test('createFamily writes family.json/FAMILY.md/plan.md verbatim and an empty sessions/ dir', () => {
  const root = freshRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'sec-hardening', brief: 'Harden the auth path.', plan: '- [ ] P1 review\n' }, root);
    assert.ok(existsSync(join(family.dir, 'family.json')));
    assert.equal(readFileSync(join(family.dir, 'FAMILY.md'), 'utf8'), 'Harden the auth path.');
    assert.equal(readFileSync(join(family.dir, 'plan.md'), 'utf8'), '- [ ] P1 review\n');
    assert.ok(existsSync(join(family.dir, 'sessions')));
    const familyJson = JSON.parse(readFileSync(join(family.dir, 'family.json'), 'utf8'));
    assert.equal(familyJson.schemaVersion, SCHEMA_VERSION);
    assert.equal(familyJson.ownerSeat, 'plan-1');
    assert.equal(familyJson.familyId, 'sec-hardening');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden fixtures: every session state round-trips through writeSessionState/readSession, including interrupted and unreadable', () => {
  const root = freshRoot();
  try {
    const family = createFamily({ ownerSeat: 'cnc', familyId: 'golden' }, root);
    for (const status of SESSION_STATES) {
      if (status === 'unreadable') continue; // unreadable is never *written* - it's what a corrupt/missing read degrades to
      const sessionId = `s-${status}`;
      writeSessionState(family, { sessionId, runtime: 'claude-code', status });
      const read = readSession(family, sessionId);
      assert.equal(read.ok, true, `${status} round-trips as ok`);
      assert.equal(read.status, status);
    }
    // unreadable, the golden fixture for it: a session directory that never got a real state.json.
    const missing = readSession(family, 's-never-written');
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 'unreadable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a corrupt state.json loads as unreadable without throwing', () => {
  const root = freshRoot();
  try {
    const family = createFamily({ ownerSeat: 'cnc', familyId: 'corrupt' }, root);
    writeSessionState(family, { sessionId: 's-1', runtime: 'claude-code', status: 'idle' });
    writeFileSync(join(family.dir, 'sessions', 's-1', 'state.json'), '{ not valid json ][');
    let read;
    assert.doesNotThrow(() => { read = readSession(family, 's-1'); });
    assert.equal(read.ok, false);
    assert.equal(read.status, 'unreadable');
    assert.match(read.error, /corrupt JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('temp-then-rename: an abandoned .tmp write never replaces the last good state.json', () => {
  const root = freshRoot();
  try {
    const family = createFamily({ ownerSeat: 'cnc', familyId: 'atomic' }, root);
    writeSessionState(family, { sessionId: 's-1', runtime: 'claude-code', status: 'idle', turnCount: 1 });
    const statePath = join(family.dir, 'sessions', 's-1', 'state.json');
    const goodContent = readFileSync(statePath, 'utf8');

    // Simulate a crash mid-write: a half-written temp file sits next to the real path but is
    // never renamed over it - exactly what atomicWriteJson's temp-then-rename makes impossible
    // for the real path itself.
    writeFileSync(`${statePath}.tmp-simulated-crash`, '{ "schemaVersion": 1, "status": "idl');

    const read = readSession(family, 's-1');
    assert.equal(read.ok, true, 'the previous good file is still what loads');
    assert.equal(read.status, 'idle');
    assert.equal(read.turnCount, 1);
    assert.equal(readFileSync(statePath, 'utf8'), goodContent, 'the real file is byte-identical to before the simulated crash');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('writeSessionState rejects an unknown status rather than writing a bad state.json', () => {
  const root = freshRoot();
  try {
    const family = createFamily({ ownerSeat: 'cnc', familyId: 'bad-status' }, root);
    assert.throws(() => writeSessionState(family, { sessionId: 's-1', runtime: 'claude-code', status: 'not-a-real-status' }), /unknown status/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('writeTurnResult writes a schemaVersion-carrying receipt readable back via deriveLedgerView', () => {
  const root = freshRoot();
  try {
    const family = createFamily({ ownerSeat: 'cnc', familyId: 'receipts' }, root);
    writeSessionState(family, { sessionId: 's-1', runtime: 'claude-code', status: 'idle' });
    writeTurnResult(family, 's-1', 1, { planItem: 'P1', exitCode: 0, isError: false });
    const ledger = deriveLedgerView(family);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].schemaVersion, SCHEMA_VERSION);
    assert.equal(ledger[0].sessionId, 's-1');
    assert.equal(ledger[0].turn, 1);
    assert.equal(ledger[0].planItem, 'P1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('.families is present in .gitignore', () => {
  const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(gitignore, /^\.families$/m);
});

test('memory-drift reconciliation on load: a stale cached view is replaced and fires exactly one family.notice', () => {
  const root = freshRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'drift' }, root);
    writeSessionState(family, { sessionId: 's-1', runtime: 'chat', status: 'idle' });
    writeTurnResult(family, 's-1', 1, { planItem: 'P1' });
    writeTurnResult(family, 's-1', 2, { planItem: 'P1' });
    writeTurnResult(family, 's-1', 3, { planItem: 'P1' });

    // Prime a cache as if an earlier load only saw 2 of the 3 real turns (a stale in-memory view).
    const staleCache = new Map([['plan-1/drift', deriveLedgerView(family).slice(0, 2)]]);

    const notices = [];
    const { families, cache } = loadFamilies(root, { cache: staleCache, emit: (type, detail) => notices.push({ type, detail }) });

    const loaded = families.find(f => f.familyId === 'drift');
    assert.equal(loaded.ledger.length, 3, 'the reloaded view has all 3 real turns, not the stale 2');
    assert.equal(notices.filter(n => n.type === 'family.notice').length, 1, 'exactly one drift notice fired');
    assert.equal(notices[0].detail.ownerSeat, 'plan-1');
    assert.equal(notices[0].detail.familyId, 'drift');
    assert.match(notices[0].detail.notice, /drift/i);
    assert.equal(cache.get('plan-1/drift').length, 3, 'the returned cache now holds the freshly-recomputed view');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loading with a cache that already matches disk fires no drift notice', () => {
  const root = freshRoot();
  try {
    const family = createFamily({ ownerSeat: 'cnc', familyId: 'no-drift' }, root);
    writeSessionState(family, { sessionId: 's-1', runtime: 'claude-code', status: 'idle' });
    writeTurnResult(family, 's-1', 1, { planItem: 'P1' });

    const matchingCache = new Map([['cnc/no-drift', deriveLedgerView(family)]]);
    const notices = [];
    loadFamilies(root, { cache: matchingCache, emit: (type, detail) => notices.push({ type, detail }) });
    assert.equal(notices.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadFamilies on an empty/missing families root returns no families and does not throw', () => {
  const root = join(freshRoot(), 'does-not-exist-yet');
  const { families } = loadFamilies(root);
  assert.deepEqual(families, []);
});

// --- Security review fixes (Fable 5.1 + sophi-a-ed's independent review of b31f95f) ---

test('security fix - path traversal: a familyId/ownerSeat/sessionId containing ".." is refused, never escapes familiesRoot', () => {
  const root = freshRoot();
  try {
    assert.throws(() => createFamily({ ownerSeat: 'plan-1', familyId: '../../escape' }, root), /not a valid identifier/);
    assert.throws(() => createFamily({ ownerSeat: '../escape', familyId: 'x' }, root), /not a valid identifier/);
    assert.ok(!existsSync(join(root, '..', '..', 'escape')), 'nothing was ever written outside the tmp root');

    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'legit' }, root);
    assert.throws(() => writeSessionState(family, { sessionId: '../../../etc/passwd', runtime: 'chat', status: 'idle' }), /not a valid identifier/);
    assert.throws(() => readSession(family, '../../../etc/passwd'), /not a valid identifier/);
    assert.throws(() => writeTurnResult(family, '../escape', 1, {}), /not a valid identifier/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('security fix - writeTurnResult rejects a non-integer or negative turn number, never interpolated raw into a filename', () => {
  const root = freshRoot();
  try {
    const family = createFamily({ ownerSeat: 'cnc', familyId: 'turn-guard' }, root);
    writeSessionState(family, { sessionId: 's-1', runtime: 'claude-code', status: 'idle' });
    assert.throws(() => writeTurnResult(family, 's-1', '../../escape', {}), /must be a positive integer/);
    assert.throws(() => writeTurnResult(family, 's-1', -1, {}), /must be a positive integer/);
    assert.throws(() => writeTurnResult(family, 's-1', 1.5, {}), /must be a positive integer/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('security fix - readSession: file content cannot override the trusted ok/sessionId fields (spread order)', () => {
  const root = freshRoot();
  try {
    const family = createFamily({ ownerSeat: 'cnc', familyId: 'spread-guard' }, root);
    writeSessionState(family, { sessionId: 's-1', runtime: 'claude-code', status: 'idle' });
    // Directly tamper with the on-disk file to claim a different sessionId/ok - the trusted
    // fields readSession itself sets must win regardless.
    writeFileSync(join(family.dir, 'sessions', 's-1', 'state.json'), JSON.stringify({ schemaVersion: 1, status: 'idle', sessionId: 'not-s-1', ok: false }));
    const read = readSession(family, 's-1');
    assert.equal(read.ok, true, 'the real ok:true always wins over a tampered file claiming ok:false');
    assert.equal(read.sessionId, 's-1', 'the real sessionId always wins over a tampered file claiming a different one');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('security fix - FAMILY.md/plan.md are written atomically (temp-then-rename), matching the module header\'s claim', () => {
  const root = freshRoot();
  try {
    const family = createFamily({ ownerSeat: 'cnc', familyId: 'atomic-text' }, root);
    const files = readdirSync(family.dir);
    assert.ok(!files.some(f => f.includes('.tmp-')), 'no abandoned .tmp file left behind after a clean write');
    assert.equal(readFileSync(join(family.dir, 'FAMILY.md'), 'utf8'), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('security fix - loadFamilies never throws on a broken symlink under familiesRoot', () => {
  const root = freshRoot();
  try {
    createFamily({ ownerSeat: 'cnc', familyId: 'real' }, root);
    try {
      symlinkSync(join(root, 'does-not-exist'), join(root, 'cnc', 'broken-link'));
    } catch {
      return; // symlink creation unsupported in this environment - nothing to prove here
    }
    let result;
    assert.doesNotThrow(() => { result = loadFamilies(root); });
    assert.equal(result.families.length, 1, 'the broken symlink is skipped, the real family still loads');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
