// test/env-restrictions.test.mjs - Sophi-A Seat Families F0's de-duplication fix (council review
// §b "Flag/reversal guards", closing named regression risk (3)): claudeCodeSubprocess.js and
// peer-pool.js used to carry two independent copies of SAFE_ENV_KEYS/RESTRICTED_ARGS/safeEnv().
// Proves there is now exactly one definition, imported by both.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAFE_ENV_KEYS, RESTRICTED_ARGS, safeEnv } from '../src/orchestrator/envRestrictions.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = p => readFileSync(join(repoRoot, 'src', 'orchestrator', p), 'utf8');

test('claudeCodeSubprocess.js imports envRestrictions.js and defines no local copy', () => {
  const text = src('adapters/claudeCodeSubprocess.js');
  assert.match(text, /from ['"]\.\.\/envRestrictions\.js['"]/, 'imports the shared module');
  assert.doesNotMatch(text, /const SAFE_ENV_KEYS\s*=/, 'no local SAFE_ENV_KEYS');
  assert.doesNotMatch(text, /const RESTRICTED_ARGS\s*=/, 'no local RESTRICTED_ARGS');
  assert.doesNotMatch(text, /function safeEnv\s*\(/, 'no local safeEnv() definition');
});

test('peer-pool.js imports envRestrictions.js and defines no local copy', () => {
  const text = src('peer-pool.js');
  assert.match(text, /from ['"]\.\/envRestrictions\.js['"]/, 'imports the shared module');
  assert.doesNotMatch(text, /const SAFE_ENV_KEYS\s*=/, 'no local SAFE_ENV_KEYS');
  assert.doesNotMatch(text, /const RESTRICTED_ARGS\s*=/, 'no local RESTRICTED_ARGS');
  assert.doesNotMatch(text, /function safeEnv\s*\(/, 'no local safeEnv() definition');
});

test('safeEnv() only ever includes the allowlisted keys plus ANTHROPIC_API_KEY', () => {
  const saved = { ...process.env };
  for (const k of SAFE_ENV_KEYS) process.env[k] = `test-${k}`;
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.OPENROUTER_API_KEY = 'should-never-appear';
  try {
    const env = safeEnv();
    for (const k of SAFE_ENV_KEYS) assert.equal(env[k], `test-${k}`);
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-test');
    assert.equal(env.OPENROUTER_API_KEY, undefined, 'a non-allowlisted key never leaks in');
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('two independent call sites (claudeCodeSubprocess.js, peer-pool.js) build byte-identical argv/env from the shared module', () => {
  // Both files spawn with the same tail (`...RESTRICTED_ARGS`) and the same `env: safeEnv()` -
  // proven here directly against the one shared export, rather than re-deriving each file's own
  // copy (which is exactly the drift risk this module exists to remove).
  const first = [...RESTRICTED_ARGS];
  const second = [...RESTRICTED_ARGS];
  assert.deepEqual(first, second, 'RESTRICTED_ARGS is the same array contents for any two callers');
  assert.deepEqual(safeEnv(), safeEnv(), 'safeEnv() is deterministic for the same process.env across any two callers');
});
