// test/seat-cards.test.mjs
//
// The rail's seat cards are wired by id across three files that nothing else checks against each
// other: index.html (the card markup), src/main.ts (FOCUSABLE_SEAT_IDS / SEAT_IDS) and
// src/orchestrator/seats.json (which seats have a backend). A card that looks clickable but is not
// in the focus list does nothing when clicked; a card in the focus list with no markup silently
// never opens. These derive the sets from disk and compare them.
//
// Emissary gets its own tests because it is the one card with an overlay and no backend: nothing
// here may quietly give it seat plumbing (task form, WS command, orchestrator seat), since what it
// does is an open product decision and PLAN.md item 2 forbids mocking a seat in slice 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const mainTs = readFileSync(join(root, 'src', 'main.ts'), 'utf8');
const seatsJson = JSON.parse(readFileSync(join(root, 'src', 'orchestrator', 'seats.json'), 'utf8'));

function stringArray(name) {
  const m = mainTs.match(new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  assert.ok(m, `could not find ${name} in src/main.ts`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
}

// The markup of one <section id="tile-..."> card, up to its closing tag.
function tileSection(seatId) {
  const start = html.indexOf(`id="tile-${seatId}"`);
  if (start === -1) return null;
  const open = html.lastIndexOf('<section', start);
  return html.slice(open, html.indexOf('</section>', start) + '</section>'.length);
}

const focusable = stringArray('FOCUSABLE_SEAT_IDS');
const seatIds = stringArray('SEAT_IDS');

test('every focusable seat has a card with a summary button and a back-home button', () => {
  assert.ok(focusable.length > 0);
  for (const id of focusable) {
    const section = tileSection(id);
    assert.ok(section, `FOCUSABLE_SEAT_IDS has "${id}" but index.html has no #tile-${id}`);
    assert.match(section, /<button[^>]*data-role="seat-card-summary"/, `#tile-${id} has no clickable summary button`);
    assert.match(section, /data-role="back-home"/, `#tile-${id} has no way back once focused`);
  }
});

test('every clickable seat-card summary in index.html belongs to a focusable seat - no dead cards', () => {
  const clickable = [...html.matchAll(/<section[^>]*id="tile-([a-z0-9-]+)"[^>]*>\s*<button[^>]*data-role="seat-card-summary"/g)].map(m => m[1]);
  assert.deepEqual([...clickable].sort(), [...focusable].sort());
});

test('Emissary opens the overlay but has no backend seat anywhere', () => {
  assert.ok(focusable.includes('emissary'), 'Emissary is focusable');
  assert.equal(seatIds.includes('emissary'), false, 'Emissary is not a backend seat in SEAT_IDS');
  assert.equal('emissary' in seatsJson, false, 'the orchestrator has no emissary seat');
  assert.doesNotMatch(mainTs, /sendCommand\([^)]*emissary/i, 'no WS command targets Emissary');
});

test("Emissary's panel carries no seat controls and says plainly it is not wired", () => {
  const section = tileSection('emissary');
  for (const role of ['task-form', 'task-input', 'send-btn', 'stop-btn', 'provider-select', 'model-input', 'seat-config']) {
    assert.doesNotMatch(section, new RegExp(`data-role="${role}"`), `Emissary must not get a ${role} before its behavior is decided`);
  }
  assert.match(section, /not connected to anything yet/);
  assert.doesNotMatch(section, /aria-disabled/, 'the old non-interactive marker is gone now that the card opens');
});

test("Emissary carries the design's permission-boundary line verbatim", () => {
  assert.ok(
    tileSection('emissary').includes("Reaches Emissary's own agents only. It cannot message another seat or another session — only your home seat dispatches."),
    'design handoff: keep this line verbatim wherever a side seat exposes any control',
  );
});
