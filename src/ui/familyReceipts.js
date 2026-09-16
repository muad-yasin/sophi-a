// Sophi-A "family" MVP polish, item 3 (relay/runs/2026-09-15T18-55-34-601Z/build.md §2), rewired
// for F3's receipts v2 (relay/Docs/SophiA-Seat-Families-Plan.md §2.5): renders a seat-owned
// family's receipt rows into a safe DOM fragment. Rows now come from familyLedger.js's
// familyReceiptRows(), keyed by sessionId/turn rather than the old peer-pool `task` id - the row
// shape changed with F3's rewrite of familyLedger.js, so this render layer changed with it.
//
// Real-codebase correction, checked before writing this file rather than assumed from the plan
// text: the plan asks for `src/ui/FamilyReceipts.jsx`, but this app has no React/JSX toolchain
// anywhere - grepped package.json (no "react" dependency), grepped the whole src/ tree for
// .tsx/.jsx (none exist), and read src/seatOutputRender.ts, this app's own real rendering
// pattern: plain functions building sanitized DOM/HTML strings, never JSX. Introducing a React
// build step for one panel would be new, unrequested tooling this MVP-polish pass has no mandate
// for (and the dispatch itself says no Phase 4 code / minimal footprint). This file follows the
// app's own real convention instead - a plain function returning a DOM fragment - and is named
// `.js` accordingly. Named plainly in DECISIONS.md rather than silently building a `.jsx` file
// nothing in this app could ever load.
//
// No aggregate/comparative claim ever appears in this file's copy - test/family-receipts.test.mjs
// greps both this module's own source and its rendered output against the full, current
// forbidden-phrase list (that list lives in the test file only, so this comment can't drift out
// of sync with it).

// gp-77's real Fable-5.1 security review of the MVP-polish branch (2026-09-15) flagged the
// absolute local filesystem path being shown directly in the UI as a low-severity finding. The
// row's own artifactPath stays absolute (familyLedger.js needs the real path to check
// existsSync against), but the rendered label is shortened to the part starting at
// `.families/...` - the full path is still reachable via a title tooltip (DOM render) or left in
// the row data (text render), never hidden, just not the loudest thing on screen.
function shortArtifactLabel(artifactPath) {
  if (typeof artifactPath !== 'string') return artifactPath;
  const marker = '.families/';
  const idx = artifactPath.indexOf(marker);
  return idx === -1 ? artifactPath : artifactPath.slice(idx);
}

function rowLabel(row) {
  return `${row.sessionId} turn ${row.turn}${row.planItem ? ` (${row.planItem})` : ''}`;
}

/**
 * Build a `<section>` DOM fragment for one family's receipts panel, ready to append into that
 * seat's card. Never throws on an empty row list - renders an explicit "no family activity yet
 * this session" line instead of a blank panel (an empty state says why, never nothing).
 * @param {{sessionId: string, turn: number, planItem: string|null, outcome: string, usage: string, timestamp: number|null, artifactPath: string|null}[]} rows
 * @returns {HTMLElement}
 */
export function renderFamilyReceipts(rows) {
  const section = document.createElement('section');
  section.className = 'family-receipts';
  section.setAttribute('aria-label', 'Family receipts');

  const heading = document.createElement('h4');
  heading.textContent = 'Family receipts';
  section.appendChild(heading);

  if (!rows || rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'family-receipts-empty';
    empty.textContent = 'No family activity yet this session.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'family-receipts-list';
  for (const row of rows) {
    const item = document.createElement('li');
    item.className = 'family-receipts-row';

    const label = document.createElement('span');
    label.className = 'family-receipts-session';
    label.textContent = rowLabel(row);

    const outcome = document.createElement('span');
    outcome.className = 'family-receipts-outcome';
    outcome.textContent = row.outcome; // textContent, never innerHTML - same rule seatOutputRender.ts follows for any model-adjacent text

    const usage = document.createElement('span');
    usage.className = 'family-receipts-usage';
    usage.textContent = row.usage;

    const time = document.createElement('span');
    time.className = 'family-receipts-time';
    time.textContent = row.timestamp ? new Date(row.timestamp).toLocaleTimeString() : 'unknown time';

    item.appendChild(label);
    item.appendChild(outcome);
    item.appendChild(usage);
    item.appendChild(time);

    if (row.artifactPath) {
      const link = document.createElement('span');
      link.className = 'family-receipts-artifact';
      link.textContent = shortArtifactLabel(row.artifactPath);
      link.title = row.artifactPath; // full absolute path on hover, never hidden - just not the loudest thing on screen
      item.appendChild(link);
    }

    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

/** Plain-text render of one family's receipt rows, for tests/headless checks with no DOM. */
export function renderFamilyReceiptsText(rows) {
  if (!rows || rows.length === 0) return 'No family activity yet this session.';
  return rows.map(r => `${rowLabel(r)} - ${r.outcome} (${r.usage}, ${r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : 'unknown time'})${r.artifactPath ? ' @ ' + shortArtifactLabel(r.artifactPath) : ''}`).join('\n');
}

/** Plain-text render of the family's counts line (familyLedger.familyReceiptCounts()'s `.text`). */
export function renderFamilyReceiptCountsText(counts) {
  return counts.text;
}
