// test/family-receipts.test.mjs
//
// Sophi-A seat-owned families, F3 (relay/Docs/SophiA-Seat-Families-Plan.md §2.5; council review
// relay/runs/2026-09-15T19-57-10-287Z/deliverable.md §c). Rewritten for familyLedger.js's F3
// rewrite: rows now derive from familyMemory.js's on-disk turn receipts (F1's own contract),
// never from peer-pool's in-memory events - the MVP-polish version of this file tested the old
// peer-pool-derived familyLedger.js, which no longer exists after F3's rewrite. Real fixtures
// via familyMemory.js's own createFamily/writeSessionState/writeTurnResult - never hand-built
// JSON files that could drift from what F1 actually writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createFamily, writeSessionState, writeTurnResult } from '../src/orchestrator/family/familyMemory.js';
import { familyReceiptRows, familyReceiptCounts } from '../src/orchestrator/familyLedger.js';
import { renderFamilyReceiptsText, renderFamilyReceiptCountsText } from '../src/ui/familyReceipts.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// F3's own extension of build.md §2's original list: "% , effective, reliable, and the
// comparative words" - checked against both source and every rendered/counted string.
const FORBIDDEN_PHRASES = ['better than', 'outperform', 'success rate', '%', 'effective', 'reliable'];

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

function tmpFamiliesRoot() {
  return mkdtempSync(join(tmpdir(), 'family-receipts-test-'));
}

test('familyLedger.js never calls a write-shaped fs function - source-grep write-guard', () => {
  const src = readFileSync(join(repoRoot, 'src', 'orchestrator', 'familyLedger.js'), 'utf8');
  assert.doesNotMatch(src, /\bwriteFileSync?\(/, 'familyLedger.js must never write files');
  assert.doesNotMatch(src, /\bappendFileSync?\(/, 'familyLedger.js must never append to files');
  assert.doesNotMatch(src, /\bmkdirSync?\(/, 'familyLedger.js must never create directories');
});

test('familyReceipts.js source contains none of the forbidden aggregate/comparative phrases', () => {
  const src = readFileSync(join(repoRoot, 'src', 'ui', 'familyReceipts.js'), 'utf8');
  const lower = src.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    assert.ok(!lower.includes(phrase.toLowerCase()), `familyReceipts.js source contains forbidden phrase: "${phrase}"`);
  }
});

test('familyLedger.js source contains none of the forbidden aggregate/comparative phrases either', () => {
  const src = readFileSync(join(repoRoot, 'src', 'orchestrator', 'familyLedger.js'), 'utf8');
  const lower = src.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    assert.ok(!lower.includes(phrase.toLowerCase()), `familyLedger.js source contains forbidden phrase: "${phrase}"`);
  }
});

test('a family dir with 3 real turn fixtures (one verified, one failure owned, one unpriced) renders 3 rows and a reproducible counts line, read-only', () => {
  const familiesRoot = tmpFamiliesRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'fam-a', brief: 'test family', plan: '- [ ] P1' }, familiesRoot);
    writeSessionState(family, { sessionId: 's-0001', runtime: 'chat', status: 'idle', planItem: 'P1' });

    writeTurnResult(family, 's-0001', 1, {
      planItem: 'P1', runtime: 'chat', provider: 'mock', model: 'mock-1',
      startedAt: 1000, endedAt: 2000, exitCode: 0, isError: false,
      usage: { reported: true, inputTokens: 10, outputTokens: 5, priced: true, usd: 0.01 },
      artifactPath: join(family.dir, 'sessions', 's-0001', 'workdir'),
      verify: { command: 'npm test', exitCode: 0, outputPath: 'turns/0001.verify.txt' },
      state: 'idle',
    });
    writeTurnResult(family, 's-0001', 2, {
      planItem: 'P1', runtime: 'chat', provider: 'mock', model: 'mock-1',
      startedAt: 3000, endedAt: 4000, exitCode: 1, isError: true,
      errorText: 'TypeError: cannot read property of undefined',
      usage: { reported: true, inputTokens: 8, outputTokens: 2, priced: true, usd: 0.005 },
      artifactPath: join(family.dir, 'sessions', 's-0001', 'workdir'),
      verify: null,
      state: 'failed-owned',
    });
    writeTurnResult(family, 's-0001', 3, {
      planItem: 'P1', runtime: 'chat', provider: 'ollama', model: 'qwen2.5-coder',
      startedAt: 5000, endedAt: 6000, exitCode: 0, isError: false,
      usage: { reported: true, inputTokens: 12, outputTokens: 20, priced: false },
      artifactPath: null,
      verify: null,
      state: 'idle',
    });

    const beforeHash = dirHash(familiesRoot);

    const rows = familyReceiptRows(family);
    assert.equal(rows.length, 3);
    assert.ok(rows.some(r => r.outcome === 'verified by npm test'));
    assert.ok(rows.some(r => r.outcome === 'failure owned: "TypeError: cannot read property of undefined"'));
    assert.ok(rows.some(r => r.outcome === 'not verified' && r.usage === '~32 tokens'));

    const counts = familyReceiptCounts(family);
    assert.equal(counts.turns, 3);
    assert.equal(counts.verifiedCount, 1);
    assert.equal(counts.failedCount, 1);
    assert.equal(counts.hasUnpricedSpend, true);
    assert.equal(counts.totalUsd, null, 'unpriced spend present - no dollar total may be claimed');
    assert.match(counts.text, /3 turns, 1 verified, 1 failure owned, usage not reported for at least one turn/);
    assert.ok(counts.reproCommand.includes(family.dir), 'reproCommand must name the real directory it counts over');

    const rendered = renderFamilyReceiptsText(rows);
    const renderedCounts = renderFamilyReceiptCountsText(counts);
    for (const phrase of FORBIDDEN_PHRASES) {
      assert.ok(!rendered.toLowerCase().includes(phrase.toLowerCase()), `rendered rows contain forbidden phrase: "${phrase}"`);
      assert.ok(!renderedCounts.toLowerCase().includes(phrase.toLowerCase()), `rendered counts line contains forbidden phrase: "${phrase}"`);
    }

    const afterHash = dirHash(familiesRoot);
    assert.equal(afterHash, beforeHash, 'the families directory must be byte-identical before and after rendering/counting - a render must never write');
  } finally {
    rmSync(familiesRoot, { recursive: true, force: true });
  }
});

test('a fully-priced family with no failures reports a real dollar total, not "unpriced"', () => {
  const familiesRoot = tmpFamiliesRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'fam-priced', brief: '', plan: '' }, familiesRoot);
    writeSessionState(family, { sessionId: 's-0001', runtime: 'council', status: 'idle', planItem: 'P2' });
    writeTurnResult(family, 's-0001', 1, {
      planItem: 'P2', runtime: 'council', provider: 'anthropic', model: 'claude-sonnet-5',
      startedAt: 0, endedAt: 1, exitCode: 0, isError: false,
      usage: { reported: true, inputTokens: 100, outputTokens: 50, priced: true, usd: 0.12 },
      verify: { command: 'npm test', exitCode: 0 },
      state: 'idle',
    });
    const counts = familyReceiptCounts(family);
    assert.equal(counts.hasUnpricedSpend, false);
    assert.equal(counts.totalUsd, 0.12);
    assert.match(counts.text, /~\$0\.12/);
  } finally {
    rmSync(familiesRoot, { recursive: true, force: true });
  }
});

test('a family with no turns yet renders an explicit empty state, never a blank panel', () => {
  const familiesRoot = tmpFamiliesRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'fam-empty', brief: '', plan: '' }, familiesRoot);
    assert.deepEqual(familyReceiptRows(family), []);
    assert.equal(renderFamilyReceiptsText(familyReceiptRows(family)), 'No family activity yet this session.');
    assert.equal(renderFamilyReceiptsText([]), 'No family activity yet this session.');
    assert.equal(renderFamilyReceiptsText(undefined), 'No family activity yet this session.');
  } finally {
    rmSync(familiesRoot, { recursive: true, force: true });
  }
});

test('a verify command that itself failed (nonzero exitCode) renders as failure owned, not "verified"', () => {
  const familiesRoot = tmpFamiliesRoot();
  try {
    const family = createFamily({ ownerSeat: 'plan-1', familyId: 'fam-verify-fail', brief: '', plan: '' }, familiesRoot);
    writeSessionState(family, { sessionId: 's-0001', runtime: 'chat', status: 'idle' });
    writeTurnResult(family, 's-0001', 1, {
      runtime: 'chat', exitCode: 0, isError: false,
      usage: { reported: true, inputTokens: 1, outputTokens: 1, priced: true, usd: 0.001 },
      verify: { command: 'npm test', exitCode: 1 },
    });
    const rows = familyReceiptRows(family);
    assert.equal(rows[0].outcome, 'failure owned: verify failed (npm test)');
  } finally {
    rmSync(familiesRoot, { recursive: true, force: true });
  }
});
