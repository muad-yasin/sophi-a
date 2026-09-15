// TODO pill (Item 5, deliverable.md §3 / build.md §5.5): reads cnc-harness/TODO.md and returns
// the first 3 unranked, non-checked (`- [ ]`) items in file order, verbatim - never rewrites the
// file, never summarizes or paraphrases. Read-only by construction: no write/appendFile/mkdir
// call anywhere in this module (verified by grep before shipping, see the report for this item).
//
// Missing file or fewer than 3 items: returns what actually exists (0, 1 or 2 items), never
// padded or invented. Zero items renders as the literal string 'nothing pending', never
// synthesized text standing in for real items.
import { existsSync, readFileSync } from 'node:fs';

const TOP_LEVEL_UNCHECKED = /^- \[ \] (.+)$/;

/**
 * @param {string} todoPath absolute path to TODO.md
 * @returns {{ items: string[], empty: boolean, emptyLabel: string }}
 */
export function readTodoItems(todoPath) {
  if (!existsSync(todoPath)) {
    return { items: [], empty: true, emptyLabel: 'nothing pending' };
  }
  const lines = readFileSync(todoPath, 'utf8').split('\n');
  const items = [];
  for (const line of lines) {
    const m = TOP_LEVEL_UNCHECKED.exec(line.trimEnd());
    if (m) {
      items.push(m[1]);
      if (items.length === 3) break;
    }
  }
  return { items, empty: items.length === 0, emptyLabel: 'nothing pending' };
}
