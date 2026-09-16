// F6 (relay/Docs/SophiA-Seat-Families-Plan.md §2.9, §5) - src/orchestrator/securityGate.js.
// Paired with THCMCP's F9 (chains/security-review-only.json, built separately in that repo).
// Fully offline: no real model call anywhere - a fully synthetic fake-engine fixture that needs
// no THCMCP checkout at all (the deterministic not_judged cases thcmcp-66 asked for, not a
// real-chain race), plus an integration test against the real THCMCP checkout when it's present
// next to this repo (skipped, not failed, when it isn't - same convention THCMCP's own
// test/status-ledger.test.js and this repo's test/withdrawal-ledger.test.js-equivalent already
// use for a sibling-repo dependency).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSecurityGate, canApplyArtifact, NOT_JUDGED_REASONS, GATE_RESULTS } from '../src/orchestrator/securityGate.js';

const here = dirname(fileURLToPath(import.meta.url));
const fakeCliSource = join(here, 'fixtures', 'fake-thcmcp-cli.mjs');

function makeFakeEngine() {
  const engineDir = mkdtempSync(join(tmpdir(), 'fake-thcmcp-engine-'));
  mkdirSync(join(engineDir, 'src'), { recursive: true });
  copyFileSync(fakeCliSource, join(engineDir, 'src', 'cli.js'));
  return engineDir;
}

const realThcmcpEngine = resolve(here, '../../THCMCP');
const realEnginePresent = existsSync(join(realThcmcpEngine, 'src', 'cli.js')) && existsSync(join(realThcmcpEngine, 'chains', 'security-review-only.json'));

test('1. GATE_RESULTS and NOT_JUDGED_REASONS are the closed sets this module\'s own contract promises', () => {
  assert.deepEqual(GATE_RESULTS, ['pass', 'blocked', 'not_judged']);
  assert.ok(NOT_JUDGED_REASONS.includes('no_report_json'));
});

test('2. runSecurityGate requires a non-empty artifactText', () => {
  assert.throws(() => runSecurityGate({ artifactText: '' }), TypeError);
  assert.throws(() => runSecurityGate({}), TypeError);
});

test('3. the fake engine\'s normal path (pause, write, resume, report with security_review) is read correctly - pass', () => {
  const engineDir = makeFakeEngine();
  try {
    const result = runSecurityGate({ artifactText: 'A clean artifact.', engineDir, env: { FAKE_THC_RESUME_EXIT: '0' } });
    assert.equal(result.gate, 'pass');
    assert.equal(result.exitCode, 0);
    assert.equal(result.reasonCode, null);
    assert.ok(result.runDir);
  } finally {
    rmSync(engineDir, { recursive: true, force: true });
  }
});

test('4. exit 3 with no NEEDS-*.md file is not_judged with reasonCode no_needs_file - the label truly cannot be discovered', () => {
  const engineDir = makeFakeEngine();
  try {
    const result = runSecurityGate({ artifactText: 'anything', engineDir, env: { FAKE_THC_WRITE_NEEDS: '0' } });
    assert.equal(result.gate, 'not_judged');
    assert.equal(result.reasonCode, 'no_needs_file');
  } finally {
    rmSync(engineDir, { recursive: true, force: true });
  }
});

test('5. a first call that never pauses (exit 0 immediately) is not_judged with reasonCode no_initial_pause', () => {
  const engineDir = makeFakeEngine();
  try {
    const result = runSecurityGate({ artifactText: 'anything', engineDir, env: { FAKE_THC_FIRST_EXIT: '0' } });
    assert.equal(result.gate, 'not_judged');
    assert.equal(result.reasonCode, 'no_initial_pause');
    assert.equal(result.exitCode, 0);
  } finally {
    rmSync(engineDir, { recursive: true, force: true });
  }
});

// The deterministic fault-injection fixture for not_judged, as thcmcp-66 asked for explicitly:
// "not a real-chain race." A resume that exits looking terminal (0, 7, or 8) but never produces
// report.json must never be reported as anything but not_judged - the exit code alone is not
// evidence a review actually happened.
test('6. deterministic fault injection: resume exits 0 but writes no report.json -> not_judged, never pass', () => {
  const engineDir = makeFakeEngine();
  try {
    const result = runSecurityGate({ artifactText: 'anything', engineDir, env: { FAKE_THC_WRITE_REPORT: '0' } });
    assert.equal(result.gate, 'not_judged');
    assert.equal(result.reasonCode, 'no_report_json');
    assert.equal(result.exitCode, 0, 'the exit code looked like success - the point of this test');
  } finally {
    rmSync(engineDir, { recursive: true, force: true });
  }
});

test('7. deterministic fault injection: resume exits 7 (looks blocked) but writes no report.json -> still not_judged, never a verdict without evidence', () => {
  const engineDir = makeFakeEngine();
  try {
    const result = runSecurityGate({ artifactText: 'anything', engineDir, env: { FAKE_THC_RESUME_EXIT: '7', FAKE_THC_WRITE_REPORT: '0' } });
    assert.equal(result.gate, 'not_judged');
    assert.equal(result.reasonCode, 'no_report_json');
  } finally {
    rmSync(engineDir, { recursive: true, force: true });
  }
});

test('8. an unexpected resume exit code (not 0/7/8) is not_judged with reasonCode unexpected_exit_code', () => {
  const engineDir = makeFakeEngine();
  try {
    const result = runSecurityGate({ artifactText: 'anything', engineDir, env: { FAKE_THC_RESUME_EXIT: '1' } });
    assert.equal(result.gate, 'not_judged');
    assert.equal(result.reasonCode, 'unexpected_exit_code');
    assert.equal(result.exitCode, 1);
  } finally {
    rmSync(engineDir, { recursive: true, force: true });
  }
});

test('9. report.json with no security_review block at all is not_judged with reasonCode no_security_review', () => {
  const engineDir = makeFakeEngine();
  try {
    const result = runSecurityGate({ artifactText: 'anything', engineDir, env: { FAKE_THC_REPORT_JSON: JSON.stringify({ passed: true }) } });
    assert.equal(result.gate, 'not_judged');
    assert.equal(result.reasonCode, 'no_security_review');
  } finally {
    rmSync(engineDir, { recursive: true, force: true });
  }
});

test('10. exit 8 with a genuine not_judged security_review block maps to not_judged, never pass', () => {
  const engineDir = makeFakeEngine();
  try {
    const result = runSecurityGate({
      artifactText: 'anything',
      engineDir,
      env: {
        FAKE_THC_RESUME_EXIT: '8',
        FAKE_THC_REPORT_JSON: JSON.stringify({ passed: false, security_review: { gate: 'not_judged', reason_code: 'SEAT_COULD_NOT_JUDGE', findings: [], blocking_count: 0 } }),
      },
    });
    assert.equal(result.gate, 'not_judged');
    assert.equal(result.security_review.reason_code, 'SEAT_COULD_NOT_JUDGE');
  } finally {
    rmSync(engineDir, { recursive: true, force: true });
  }
});

test('11. exit 7 with a genuine blocked security_review block maps to blocked', () => {
  const engineDir = makeFakeEngine();
  try {
    const result = runSecurityGate({
      artifactText: 'a vulnerable artifact',
      engineDir,
      env: {
        FAKE_THC_RESUME_EXIT: '7',
        FAKE_THC_REPORT_JSON: JSON.stringify({ passed: false, security_review: { gate: 'blocked', findings: [{ severity: 'high' }], blocking_count: 1 } }),
      },
    });
    assert.equal(result.gate, 'blocked');
    assert.equal(result.security_review.blocking_count, 1);
  } finally {
    rmSync(engineDir, { recursive: true, force: true });
  }
});

test('12. canApplyArtifact requires both humanClick and a passing gate result, independently', () => {
  assert.equal(canApplyArtifact({ humanClick: true, gateResult: { gate: 'pass' } }), true);
  assert.equal(canApplyArtifact({ humanClick: false, gateResult: { gate: 'pass' } }), false);
  assert.equal(canApplyArtifact({ humanClick: true, gateResult: { gate: 'blocked' } }), false);
  assert.equal(canApplyArtifact({ humanClick: true, gateResult: { gate: 'not_judged' } }), false);
  assert.equal(canApplyArtifact({ humanClick: true, gateResult: null }), false);
  assert.equal(canApplyArtifact({ humanClick: true, gateResult: undefined }), false);
});

test('13. canApplyArtifact never treats a client-only humanClick as sufficient - a UI bug rendering the button enabled must not bypass the gate', () => {
  for (const gate of ['blocked', 'not_judged']) {
    assert.equal(canApplyArtifact({ humanClick: true, gateResult: { gate } }), false, `gate=${gate} must never be applicable`);
  }
});

test('14. real THCMCP integration: mock-security-block artifact is blocked end to end', { skip: !realEnginePresent && 'THCMCP sibling checkout not found next to this repo, or missing chains/security-review-only.json' }, () => {
  const cfgPath = join(realThcmcpEngine, 'chains', 'security-review-only.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  assert.equal(cfg.seats.security_reviewer.model, 'mock-security-block');
  const result = runSecurityGate({ artifactText: 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);', engineDir: realThcmcpEngine });
  assert.equal(result.gate, 'blocked');
  assert.equal(result.exitCode, 7);
  assert.ok(result.security_review.blocking_count >= 1);
});
