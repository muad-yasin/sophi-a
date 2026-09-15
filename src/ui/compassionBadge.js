// Sophi-A "family" MVP polish, item 4 (relay/runs/2026-09-15T18-55-34-601Z/build.md §4): renders
// one compassion-state badge. Same real-codebase correction as src/ui/familyReceipts.js (item
// 3) - the plan asks for `src/ui/CompassionBadge.jsx`, but this app has no React/JSX toolchain
// (verified: no "react" in package.json, no .tsx/.jsx anywhere in src/). This follows the app's
// own real rendering convention (plain DOM-building functions, e.g. src/seatOutputRender.ts)
// instead, named `.js`. Named plainly in DECISIONS.md.
//
// Never mistakable for silent success: every state renders a distinct, colored, labeled badge -
// there is no "everything fine, nothing to show" branch in this module for any of the three
// named states. A revealed failure/dissent is shown with textContent, never innerHTML - the same
// rule seatOutputRender.ts's own header comment states for any model-adjacent text.
import { COMPASSION_COPY } from './compassionCopy.js';

/**
 * @param {'failed-owned'|'stuck'|'holdout'} state
 * @param {{onReveal?: () => string}} [opts] - onReveal, if given, returns the verbatim text to
 *   show when the reveal button is activated (the exact failure, or the critic's full objection)
 * @returns {HTMLElement}
 */
export function renderCompassionBadge(state, opts = {}) {
  const copy = COMPASSION_COPY[state];
  if (!copy) throw new Error(`renderCompassionBadge: unknown state "${state}"`);

  const badge = document.createElement('div');
  badge.className = `compassion-badge compassion-badge-${copy.color}`;
  badge.setAttribute('data-compassion-state', state);

  const label = document.createElement('span');
  label.className = 'compassion-badge-label';
  label.textContent = copy.label;
  badge.appendChild(label);

  const summary = document.createElement('span');
  summary.className = 'compassion-badge-summary';
  summary.textContent = copy.summary;
  badge.appendChild(summary);

  if (copy.revealActionLabel && opts.onReveal) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'compassion-badge-reveal';
    button.textContent = copy.revealActionLabel;

    const revealed = document.createElement('pre');
    revealed.className = 'compassion-badge-revealed';
    revealed.hidden = true;

    button.addEventListener('click', () => {
      if (revealed.hidden) {
        revealed.textContent = opts.onReveal();
        revealed.hidden = false;
      } else {
        revealed.hidden = true;
      }
    });

    badge.appendChild(button);
    badge.appendChild(revealed);
  }

  return badge;
}

/** Plain-text render of one badge, for tests/headless checks with no DOM. */
export function renderCompassionBadgeText(state) {
  const copy = COMPASSION_COPY[state];
  if (!copy) throw new Error(`renderCompassionBadgeText: unknown state "${state}"`);
  return `[${copy.label}] ${copy.summary}`;
}
