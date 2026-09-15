// test/family-config.test.mjs - Sophi-A Seat Families F0's config loader
// (relay/Docs/SophiA-Seat-Families-Plan.md §2.2, council review §d.8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFamilyConfig, seatFanOutAllowed, FLAG_OFF_CONFIG, DEFAULT_CONFIG_PATH } from '../src/orchestrator/family/familyConfig.js';

function tmpConfig(obj) {
  const dir = mkdtempSync(join(tmpdir(), 'family-config-test-'));
  const path = join(dir, 'families.config.json');
  writeFileSync(path, JSON.stringify(obj, null, 2));
  return { dir, path };
}

test('the shipped families.config.json exists and its top-level flag is false', () => {
  assert.ok(existsSync(DEFAULT_CONFIG_PATH), 'families.config.json ships next to familyConfig.js');
  const raw = JSON.parse(readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
  assert.equal(raw.enabled, false, 'G1: the shipped file stays false');
});

test('a missing config file loads as FLAG_OFF_CONFIG (missing == flag-off)', () => {
  const { config, ok, source } = loadFamilyConfig('/does/not/exist/families.config.json');
  assert.equal(ok, true);
  assert.deepEqual(config, FLAG_OFF_CONFIG);
  assert.match(source, /default/);
});

test('a syntactically invalid config file returns ok:false, never throws', () => {
  const { path, dir } = tmpConfig({});
  writeFileSync(path, '{ this is not json');
  try {
    let result;
    assert.doesNotThrow(() => { result = loadFamilyConfig(path); });
    assert.equal(result.ok, false);
    assert.match(result.error, /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('per-seat caps above the global ones are clamped to global', () => {
  const { path, dir } = tmpConfig({
    schemaVersion: 1, enabled: true,
    global: { maxConcurrentSessions: 2, spendCeilingUsd: 1.00 },
    seats: { 'plan-1': { enabled: true, maxConcurrentSessions: 99, spendCeilingUsd: 500, runtimes: ['chat'] } },
  });
  try {
    const { config, ok } = loadFamilyConfig(path);
    assert.equal(ok, true);
    assert.equal(config.seats['plan-1'].maxConcurrentSessions, 2, 'clamped to global maxConcurrentSessions');
    assert.equal(config.seats['plan-1'].spendCeilingUsd, 1.00, 'clamped to global spendCeilingUsd');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unsupported runtime value is rejected at load, config-load-time not just dispatch-time', () => {
  const { path, dir } = tmpConfig({
    schemaVersion: 1, enabled: true,
    global: { maxConcurrentSessions: 4, spendCeilingUsd: 5 },
    seats: { 'plan-1': { enabled: true, runtimes: ['claude-code', 'autonomous-shell'] } },
  });
  try {
    const { ok, error } = loadFamilyConfig(path);
    assert.equal(ok, false);
    assert.match(error, /unsupported runtime autonomous-shell/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('xai in a seat providers list is rejected at load (same standing exclusion as providers.js)', () => {
  const { path, dir } = tmpConfig({
    schemaVersion: 1, enabled: true,
    global: { maxConcurrentSessions: 4, spendCeilingUsd: 5 },
    seats: { 'plan-1': { enabled: true, runtimes: ['chat'], providers: ['anthropic', 'xai'] } },
  });
  try {
    const { ok, error } = loadFamilyConfig(path);
    assert.equal(ok, false);
    assert.match(error, /unsupported provider xai/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seatFanOutAllowed: flag off allows only cnc, with the exact legacy string for anyone else', () => {
  const off = { ...FLAG_OFF_CONFIG };
  assert.deepEqual(seatFanOutAllowed(off, 'cnc'), { allowed: true, reason: null });
  assert.deepEqual(seatFanOutAllowed(off, 'plan-1'), { allowed: false, reason: 'Fan-out only allowed from cnc seat' });
});

test('seatFanOutAllowed: flag on requires the seat\'s own row to say enabled:true', () => {
  const config = {
    enabled: true,
    seats: {
      'plan-1': { enabled: true },
      'plan-2': { enabled: false },
    },
  };
  assert.deepEqual(seatFanOutAllowed(config, 'plan-1'), { allowed: true, reason: null });
  const denied = seatFanOutAllowed(config, 'plan-2');
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'Fan-out not enabled for seat plan-2 (families.seats.plan-2.enabled is false)');
  const unlisted = seatFanOutAllowed(config, 'build-2');
  assert.equal(unlisted.allowed, false);
  assert.match(unlisted.reason, /Fan-out not enabled for seat build-2/);
});
