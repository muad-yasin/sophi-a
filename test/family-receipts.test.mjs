// test/family-receipts.test.mjs
//
// Item 3 of Sophi-A's "family" MVP polish (relay/runs/2026-09-15T18-55-34-601Z/build.md §2,
// handoff.md). Real subprocess spawns via Session A's (cnc-harness-ad) fake `claude` binary
// fixture (test/fixtures/fake-claude.sh, pulled in from sophi-a-family-mvp-a once item 1
// landed) on a temp PATH - same technique test/peer-pool.test.mjs already uses, since
// familyLedger.js is a real consumer of peer-pool's own real fanOut()/emit() path, not a mocked
// one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, chmodSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fakeClaudeSrc = join(repoRoot, 'test', 'fixtures', 'fake-claude.sh');

const tmp = mkdtempSync(join(tmpdir(), 'family-receipts-test-'));
const binDir = join(tmp, 'bin');
mkdirSync(binDir, { recursive: true });
const claudePath = join(binDir, 'claude');
copyFileSync(fakeClaudeSrc, claudePath);
chmodSync(claudePath, 0o755);
process.env.PATH = `${binDir}:${process.env.PATH}`;

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

// FORBIDDEN_PHRASES mirrors build.md §2's own list verbatim ("no aggregate/comparative claim of
// any kind... no 'better than', no 'outperforms', no '% success rate'").
const FORBIDDEN_PHRASES = ['better than', 'outperforms', '% success rate'];

function dirHash(dirPath) {
  const hash = createHash('sha256');
  if (!existsSync(dirPath)) return hash.digest('hex');
  const walk = p => {
    const entries = readdirSync(p).sort();
    for (const entry of entries) {
      const full = join(p, entry);
      const st = statSync(full);
      hash.update(full.replace(dirPath, ''));
      if (st.isDirectory()) {
        walk(full);
      } else {
        hash.update(readFileSync(full));
      }
    }
  };
  walk(dirPath);
  return hash.digest('hex');
}

test('familyLedger.js never calls a write-shaped fs function - source-grep write-guard', () => {
  const src = readFileSync(join(repoRoot, 'src', 'orchestrator', 'familyLedger.js'), 'utf8');
  assert.doesNotMatch(src, /\bwriteFileSync?\(/, 'familyLedger.js must never write files');
  assert.doesNotMatch(src, /\bappendFileSync?\(/, 'familyLedger.js must never append to files');
  assert.doesNotMatch(src, /\bmkdirSync?\(/, 'familyLedger.js must never create directories');
});

test('familyReceipts.js renders no forbidden aggregate/comparative phrase in its own source', () => {
  const src = readFileSync(join(repoRoot, 'src', 'ui', 'familyReceipts.js'), 'utf8');
  for (const phrase of FORBIDDEN_PHRASES) {
    assert.ok(!src.toLowerCase().includes(phrase.toLowerCase()), `familyReceipts.js source contains forbidden phrase: "${phrase}"`);
  }
});

test('a real 2-peer fan-out through peer-pool produces 2 family-receipt rows, each with a real on-disk artifactPath, no forbidden phrases, and leaves run folders/recorder store byte-identical', async () => {
  const { fanOut } = await import('../src/orchestrator/peer-pool.js');
  const { observePeerEvent, familyRows, _resetFamilyLedgerForTests } = await import('../src/orchestrator/familyLedger.js');
  const { renderFamilyReceiptsText } = await import('../src/ui/familyReceipts.js');
  const { runsDir } = await import('../src/orchestrator/run-recorder.js');

  _resetFamilyLedgerForTests();

  const beforeHash = dirHash(runsDir());

  const seatId = 'cnc';
  const task = `family-receipts-${Date.now()}`;

  // Real finding, worth recording rather than worked around: peer-pool.js's own safeEnv()
  // forwards only a fixed allowlist (PATH/HOME/LANG/.../ANTHROPIC_API_KEY) to the spawned
  // child - a deliberate security boundary (docs/security-prompt-injection.md). FAKE_CLAUDE_*
  // env vars are NOT in that allowlist, so a real fanOut() call can never actually drive
  // fake-claude.sh's success/failure output via those knobs - only its own default behavior
  // (a fixed placeholder line, not valid stream-json) is reachable this way. Widening
  // SAFE_ENV_KEYS to make an offline test more convenient would weaken a real security
  // boundary for zero product reason - not done here, flagged in DECISIONS.md instead.
  // Consequence, verified real rather than assumed: fake-claude.sh's default stdout produces
  // no parseable stream-json `result` line, so peer-pool.js correctly reports this as
  // `peer.problem` ("exited before a result line arrived") - which is itself a legitimate,
  // real terminal outcome this ledger must handle honestly, not a test-setup bug to paper over.

  const events = [];
  const { dispatched } = fanOut(seatId, { count: 2, task }, (type, detail) => {
    events.push({ type, detail });
    observePeerEvent(seatId, type, detail);
  });
  assert.equal(dispatched.length, 2, 'exactly 2 peers dispatched');

  // Wait for both peers to reach a terminal event.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const terminal = events.filter(e => e.type === 'peer.idle' || e.type === 'peer.problem' || e.type === 'peer.timeout');
    if (terminal.length >= 2) break;
    await new Promise(r => setTimeout(r, 50));
  }

  const rows = familyRows(seatId);
  assert.equal(rows.length, 2, `expected 2 family-receipt rows, got ${rows.length}`);
  for (const row of rows) {
    // artifactPath is the peer's own workdir - real, on-disk, created by peer-pool.js's own
    // workdirFor(peerId) before the fake-claude process even spawns, so this proves the row
    // traces to a real, checkable per-peer directory, not a synthesized path.
    assert.ok(row.artifactPath, 'row must carry a non-empty artifactPath');
    assert.ok(existsSync(row.artifactPath), `artifactPath must exist on disk: ${row.artifactPath}`);
    assert.ok(row.outcome.startsWith('failure owned:') || row.outcome === 'completed - result recorded', `unexpected outcome shape: ${row.outcome}`);
  }

  const rendered = renderFamilyReceiptsText(rows);
  for (const phrase of FORBIDDEN_PHRASES) {
    assert.ok(!rendered.toLowerCase().includes(phrase.toLowerCase()), `rendered output contains forbidden phrase: "${phrase}"`);
  }

  const afterHash = dirHash(runsDir());
  assert.equal(afterHash, beforeHash, 'run-recorder store directory must be byte-identical before and after a family-receipts render/observe cycle');
});

test('observePeerEvent: a clean peer.idle produces a "completed" outcome row', async () => {
  const { observePeerEvent, familyRows, _resetFamilyLedgerForTests } = await import('../src/orchestrator/familyLedger.js');
  _resetFamilyLedgerForTests();
  observePeerEvent('cnc', 'peer.idle', { peerId: 'peer-success-1', detail: { ok: true } });
  const rows = familyRows('cnc');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'completed - result recorded');
  assert.equal(rows[0].task, 'peer-success-1');
});

test('observePeerEvent: peer.problem and peer.timeout both produce a "failure owned" row carrying the verbatim detail', async () => {
  const { observePeerEvent, familyRows, _resetFamilyLedgerForTests } = await import('../src/orchestrator/familyLedger.js');
  _resetFamilyLedgerForTests();
  observePeerEvent('cnc', 'peer.problem', { peerId: 'peer-fail-1', detail: 'claude exited with code 1' });
  observePeerEvent('cnc', 'peer.timeout', { peerId: 'peer-fail-2', detail: 'no output for 300s' });
  const rows = familyRows('cnc');
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.outcome.startsWith('failure owned:')));
  assert.ok(rows.some(r => r.outcome.includes('claude exited with code 1')));
  assert.ok(rows.some(r => r.outcome.includes('no output for 300s')));
});

test('observePeerEvent: progress events (start/working/output/usage) produce no row', async () => {
  const { observePeerEvent, familyRows, _resetFamilyLedgerForTests } = await import('../src/orchestrator/familyLedger.js');
  _resetFamilyLedgerForTests();
  for (const type of ['peer.start', 'peer.working', 'peer.output', 'peer.usage', 'fanout.notice']) {
    observePeerEvent('cnc', type, { peerId: 'peer-noise' });
  }
  assert.equal(familyRows('cnc').length, 0);
});

test('familyRows caps at MAX_ROWS_PER_SEAT, oldest evicted', async () => {
  const { observePeerEvent, familyRows, MAX_ROWS_PER_SEAT, _resetFamilyLedgerForTests } = await import('../src/orchestrator/familyLedger.js');
  _resetFamilyLedgerForTests();
  const seatId = 'cnc';
  for (let i = 0; i < MAX_ROWS_PER_SEAT + 3; i += 1) {
    observePeerEvent(seatId, 'peer.idle', { peerId: `peer-cap-${i}`, detail: 'ok' });
  }
  const rows = familyRows(seatId);
  assert.equal(rows.length, MAX_ROWS_PER_SEAT);
  // Newest first: the most recently observed peer (peer-cap-<last>) must be present; the very
  // first one observed (peer-cap-0) must have been evicted.
  assert.ok(rows.some(r => r.task === `peer-cap-${MAX_ROWS_PER_SEAT + 2}`));
  assert.ok(!rows.some(r => r.task === 'peer-cap-0'));
});

test('renderFamilyReceiptsText renders an explicit empty state, never a blank panel', async () => {
  const { renderFamilyReceiptsText } = await import('../src/ui/familyReceipts.js');
  assert.equal(renderFamilyReceiptsText([]), 'No family activity yet this session.');
  assert.equal(renderFamilyReceiptsText(undefined), 'No family activity yet this session.');
});
