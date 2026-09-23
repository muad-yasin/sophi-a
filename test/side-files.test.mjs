// The relay-chain-subprocess seat's side files (its task text and the child's console log) must
// never land inside the engine repo - 2026-09-23, after 31 `cnc-harness-*.log` files had piled
// up in the public THCMCP checkout's root and 32 task files in its tasks/. See sideFiles.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAbsolute, relative, join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { sideFileDir, sideFilePaths } from '../src/orchestrator/sideFiles.js';

const inside = (child, parent) => { const r = relative(parent, child); return r && !r.startsWith('..') && !isAbsolute(r); };

test('side files default to ~/.cache/cnc-harness, outside any engine checkout', () => {
  const saved = process.env.CNC_HARNESS_CACHE_DIR; delete process.env.CNC_HARNESS_CACHE_DIR;
  try {
    assert.equal(sideFileDir(), join(homedir(), '.cache', 'cnc-harness'));
    const p = sideFilePaths('plan-1', 123);
    for (const engine of [join(homedir(), 'Projects', 'THCMCP'), join(homedir(), 'Projects', 'relay')]) {
      assert.equal(inside(p.taskPath, engine), false, `task file must not be inside ${engine}`);
      assert.equal(inside(p.logPath, engine), false, `side log must not be inside ${engine}`);
    }
  } finally { if (saved !== undefined) process.env.CNC_HARNESS_CACHE_DIR = saved; }
});

test('the task path handed to the CLI is absolute, and names keep the old seat/timestamp shape', () => {
  const p = sideFilePaths('plan-2', 456, '/tmp/x');
  assert.ok(isAbsolute(p.taskPath));
  assert.equal(p.taskPath, '/tmp/x/tasks/cnc-harness-plan-2-456.md');
  assert.equal(p.logPath, '/tmp/x/side-logs/cnc-harness-plan-2-456.log');
});

test('CNC_HARNESS_CACHE_DIR overrides the base directory', () => {
  const saved = process.env.CNC_HARNESS_CACHE_DIR; process.env.CNC_HARNESS_CACHE_DIR = '/tmp/override';
  try { assert.equal(sideFilePaths('plan-3', 1).logsDir, '/tmp/override/side-logs'); }
  finally { if (saved === undefined) delete process.env.CNC_HARNESS_CACHE_DIR; else process.env.CNC_HARNESS_CACHE_DIR = saved; }
});

test('the seat adapter no longer writes into <relayPath>/tasks or the engine root', () => {
  const src = readFileSync(new URL('../src/orchestrator/adapters/relayChainSubprocess.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /join\(relayPath, ['"]tasks['"]\)/);
  assert.doesNotMatch(src, /join\(relayPath, `cnc-harness-/);
  assert.match(src, /'--task', side\.taskPath/);
});
