// test/fetch-node-runtime-target-validation.test.mjs
//
// Security-review fix: scripts/fetch-node-runtime.sh used to `rm -rf "dist-node/$target"` before
// validating $target against its own known-targets case statement, so an unrecognized (or
// malicious) target got deleted before the script noticed it was invalid. The fix moves
// validation before deletion. This test runs the real script with an invalid target and proves
// (a) it exits non-zero without deleting a pre-existing directory at that path, and (b) it never
// reaches the network call (no curl invocation needed for an invalid target - proven by running
// entirely offline and still getting the expected rejection instead of a network-related error).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(repoRoot, 'scripts', 'fetch-node-runtime.sh');

function runScript(cwd, target) {
  try {
    execFileSync('bash', [scriptPath, target], { cwd, stdio: 'pipe' });
    return { exitCode: 0 };
  } catch (err) {
    return { exitCode: err.status, stderr: String(err.stderr || '') };
  }
}

test('an unrecognized target is rejected WITHOUT deleting a pre-existing dist-node dir at that path', () => {
  const work = mkdtempSync(join(tmpdir(), 'fetch-node-runtime-test-'));
  try {
    // A malicious/unrecognized target whose dist-node/<target> already holds a real file - the
    // exact shape the bug would destroy: an unvalidated rm -rf running before the case statement
    // ever rejects the value.
    const badTarget = '../../etc-shaped-target';
    const outDir = join(work, 'dist-node', badTarget);
    mkdirSync(outDir, { recursive: true });
    const sentinel = join(outDir, 'do-not-delete.txt');
    writeFileSync(sentinel, 'pre-existing content that must survive an invalid target');

    const result = runScript(work, badTarget);

    assert.notEqual(result.exitCode, 0, 'an unrecognized target must exit non-zero');
    assert.match(result.stderr, /unknown target/);
    assert.ok(existsSync(sentinel), 'the pre-existing file must NOT have been deleted before validation ran');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('a plain unrecognized target with no pre-existing dir also exits non-zero, still offline', () => {
  const work = mkdtempSync(join(tmpdir(), 'fetch-node-runtime-test-'));
  try {
    const result = runScript(work, 'macos-arm64');
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /unknown target: macos-arm64/);
    // No dist-node dir should have been created for a target that was never accepted.
    assert.ok(!existsSync(join(work, 'dist-node', 'macos-arm64')));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('a recognized target passes validation and reaches deletion/mkdir before any network call', () => {
  // Proves validation-then-delete ordering for the HAPPY path too, without requiring network:
  // stub `curl` on PATH with a script that always fails, so the real script's own curl call
  // errors out immediately (set -e makes the whole script exit) - but by that point out_dir must
  // already have been freshly created by the (now-reordered) rm -rf/mkdir -p, proving validation
  // ran and passed before the network step, exactly the ordering the fix establishes.
  const work = mkdtempSync(join(tmpdir(), 'fetch-node-runtime-test-'));
  try {
    const fakeBin = join(work, 'fakebin');
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'curl'), '#!/usr/bin/env bash\nexit 7\n', { mode: 0o755 });

    const outDir = join(work, 'dist-node', 'linux-x64');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'stale-from-a-previous-run.txt'), 'old build output');

    let exitCode = 0;
    try {
      execFileSync('bash', [scriptPath, 'linux-x64'], {
        cwd: work,
        stdio: 'pipe',
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
      });
    } catch (err) {
      exitCode = err.status;
    }

    assert.notEqual(exitCode, 0, 'the stubbed curl failure should still fail the script overall');
    // The real proof: validation passed (target was recognized), so rm -rf + mkdir -p already
    // ran and replaced the stale directory with a fresh empty one, before curl (stubbed to fail)
    // was ever invoked.
    assert.ok(existsSync(outDir), 'out_dir should exist (freshly created) even though curl failed after');
    assert.ok(!existsSync(join(outDir, 'stale-from-a-previous-run.txt')), 'the stale file should be gone - rm -rf ran');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
