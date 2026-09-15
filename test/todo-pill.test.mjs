// test/todo-pill.test.mjs
//
// Offline acceptance test for the TODO pill (Item 5). Covers: first-3-verbatim, all-checked ->
// "nothing pending", and the missing-file case degrading cleanly rather than throwing. Also
// verifies todoReader.js never writes to the file it reads (read-only-by-construction guard).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTodoItems } from '../src/orchestrator/todoReader.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('returns exactly the first 3 items verbatim, in file order, no truncation/summarization', () => {
  const dir = mkdtempSync(join(tmpdir(), 'todo-pill-'));
  const todoPath = join(dir, 'TODO.md');
  const rawItems = [
    'Ship the offline acceptance harness',
    'Write the family-model decision record',
    'Wire the compassion-state badges into seat cards',
    'Add the per-seat family receipts panel',
    'Tune the STUCK-state 300s threshold at playtest',
  ];
  writeFileSync(
    todoPath,
    `<!-- header comment -->\n${rawItems.map((i) => `- [ ] ${i}`).join('\n')}\n`,
  );

  const { items, empty, emptyLabel } = readTodoItems(todoPath);

  assert.equal(empty, false);
  assert.equal(emptyLabel, 'nothing pending');
  assert.equal(items.length, 3);
  assert.deepEqual(items, rawItems.slice(0, 3));
  // Exact string equality per item, not just length/shape equality.
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(items[i], rawItems[i]);
  }

  rmSync(dir, { recursive: true, force: true });
});

test('a file with only checked items returns zero items and "nothing pending"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'todo-pill-'));
  const todoPath = join(dir, 'TODO.md');
  writeFileSync(
    todoPath,
    '<!-- header comment -->\n- [x] Already done item one\n- [x] Already done item two\n',
  );

  const { items, empty, emptyLabel } = readTodoItems(todoPath);

  assert.equal(items.length, 0);
  assert.equal(empty, true);
  assert.equal(emptyLabel, 'nothing pending');

  rmSync(dir, { recursive: true, force: true });
});

test('a missing TODO.md degrades cleanly (no throw), reporting zero items', () => {
  const dir = mkdtempSync(join(tmpdir(), 'todo-pill-'));
  const missingPath = join(dir, 'does-not-exist-TODO.md');

  assert.doesNotThrow(() => readTodoItems(missingPath));
  const { items, empty, emptyLabel } = readTodoItems(missingPath);
  assert.equal(items.length, 0);
  assert.equal(empty, true);
  assert.equal(emptyLabel, 'nothing pending');

  rmSync(dir, { recursive: true, force: true });
});

test('fewer than 3 real items returns exactly what exists, never padded or invented', () => {
  const dir = mkdtempSync(join(tmpdir(), 'todo-pill-'));
  const todoPath = join(dir, 'TODO.md');
  writeFileSync(todoPath, '- [ ] Only one real item\n- [x] A checked item, skipped\n');

  const { items, empty } = readTodoItems(todoPath);
  assert.equal(empty, false);
  assert.deepEqual(items, ['Only one real item']);

  rmSync(dir, { recursive: true, force: true });
});

test('todoReader.js never contains a write-shaped call (read-only-by-construction guard)', () => {
  const src = readFileSync(join(root, 'src', 'orchestrator', 'todoReader.js'), 'utf8');
  assert.doesNotMatch(src, /\bwriteFile(Sync)?\s*\(/);
  assert.doesNotMatch(src, /\bappendFile(Sync)?\s*\(/);
  assert.doesNotMatch(src, /\bmkdir(Sync)?\s*\(/);
});
