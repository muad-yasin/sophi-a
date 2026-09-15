// TODO pill (Item 5, deliverable.md §3 / build.md §5.5). Renders whatever `readTodoItems`
// returns - never re-derives, summarizes or truncates on its own. Read on mount and on a manual
// refresh click only: no file watcher, no cache layer. A user hand-editing TODO.md while the app
// runs sees the change only after clicking refresh.
//
// Naming note: the dispatching plan (build.md §3/§5.5) names this file `src/ui/TodoPill.jsx`.
// This repo has no React/JSX toolchain (`src/main.ts` + `index.html` is plain DOM/TS, confirmed
// via `test/seat-cards.test.mjs`'s own wiring pattern before writing this file) - so this ships
// as a plain TS render module in the same shape as `seatOutputRender.ts`/`seatNotify.ts`,
// matching the project's actual stack rather than the plan's assumed one. Behavior (read on
// mount + manual refresh, verbatim items, "nothing pending" fallback) is unchanged from spec.
//
// This module intentionally does no top-level DOM access, so it can be imported from a plain
// Node test run without a `document` global existing.
import { readTodoItems } from "../orchestrator/todoReader.js";

export interface TodoPillState {
  items: string[];
  empty: boolean;
  emptyLabel: string;
}

/** Pure: reads TODO.md at `todoPath` and returns the render state. No caching, no memoization. */
export function loadTodoPillState(todoPath: string): TodoPillState {
  return readTodoItems(todoPath);
}

/** Pure: builds the pill's inner markup from a render state. No script/HTML injection - every
 *  item is inserted as text content, never as raw HTML, since item text originates from a
 *  human-or-session-edited file this UI does not fully control. */
export function renderTodoPillMarkup(state: TodoPillState): string {
  if (state.empty) {
    return `<span class="todo-pill__empty">${escapeHtml(state.emptyLabel)}</span>`;
  }
  return `<ul class="todo-pill__list">${state.items
    .map((item) => `<li class="todo-pill__item">${escapeHtml(item)}</li>`)
    .join("")}</ul>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Mounts the pill into `container`: an item list (or the empty label) plus a REFRESH button.
 * Reads TODO.md once on mount and again only when the button is clicked - no interval, no
 * `fs.watch`. Returns a `refresh()` handle for tests/callers that want to trigger it
 * programmatically instead of via the button.
 */
export function mountTodoPill(container: HTMLElement, todoPath: string): { refresh: () => void } {
  function refresh() {
    const state = loadTodoPillState(todoPath);
    container.innerHTML =
      `<div class="todo-pill">` +
      renderTodoPillMarkup(state) +
      `<button type="button" class="todo-pill__refresh">Refresh</button>` +
      `</div>`;
    const btn = container.querySelector<HTMLButtonElement>(".todo-pill__refresh");
    btn?.addEventListener("click", refresh);
  }
  refresh();
  return { refresh };
}
