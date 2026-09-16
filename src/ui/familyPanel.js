// Sophi-A Seat Families F8 (relay/Docs/SophiA-Seat-Families-Plan.md §2.10 "Events and UI
// surface"). Split deliberately into a pure, DOM-free "what should this panel show" layer
// (headlessly testable with plain node:test, no jsdom - this repo has none installed and F8's
// own accepted offline gap already covers the Chrome-only part) and a thin DOM-building layer
// that only real browser code (main.ts, imported at runtime) ever calls.

/**
 * Which of the five states a panel is in, given what's known about one seat's family.
 * @param {{seatEnabled: boolean, loading: boolean, error: string|null, family: object|null}} input
 * @returns {'flag-off'|'loading'|'error'|'empty'|'active'}
 */
export function classifyPanelState({ seatEnabled, loading, error, family }) {
  if (!seatEnabled) return 'flag-off';
  if (loading) return 'loading';
  if (error) return 'error';
  if (!family || !family.sessions || family.sessions.length === 0) return 'empty';
  return 'active';
}

// The forbidden-phrase list this repo's other family surfaces already enforce (no-efficacy-claim
// rule, build.md §2/§3) - a family panel showing session counts must not slip into a percentage
// or a comparative claim, even though this panel doesn't compute one today.
export const FORBIDDEN_PANEL_PHRASES = ['%', 'effective', 'reliable', 'guaranteed', 'best'];

/**
 * Pure "what should render" description for one state - plain data only, no DOM, no innerHTML
 * string anywhere (every session id/status/task ultimately traces to model or operator text, so
 * the DOM layer that consumes this must build nodes with textContent, never concatenate HTML).
 * @param {'flag-off'|'loading'|'error'|'empty'|'active'} state
 * @param {{seatReason?: string|null, error?: string|null, family?: {sessions: object[]}|null}} data
 * @returns {{emptyText: string|null, isError: boolean, showCreateButton: boolean, sessions: object[], showComposer: boolean}}
 */
export function describeFamilyPanel(state, data = {}) {
  if (state === 'flag-off') {
    return { emptyText: data.seatReason || 'Families are off for this seat.', isError: false, showCreateButton: false, sessions: [], showComposer: false };
  }
  if (state === 'loading') {
    return { emptyText: 'Loading…', isError: false, showCreateButton: false, sessions: [], showComposer: false };
  }
  if (state === 'error') {
    // Fable review, LOW #7, 2026-09-16: the DOM layer used to guess "is this an error" from the
    // copy text (`startsWith('Could not')`) even though classifyPanelState() already knows the
    // real state - carrying it explicitly here means every real server refusal renders with the
    // actual error styling, not the neutral empty one.
    return { emptyText: data.error || 'Could not load this family.', isError: true, showCreateButton: false, sessions: [], showComposer: false };
  }
  if (state === 'empty') {
    return { emptyText: 'No family yet for this seat.', isError: false, showCreateButton: true, sessions: [], showComposer: false };
  }
  // active
  const family = data.family || { sessions: [] };
  return {
    emptyText: null,
    isError: false,
    showCreateButton: false,
    sessions: family.sessions.map(s => ({ sessionId: s.sessionId, status: sanitizeStatusForClass(s.status), turnCount: s.turnCount ?? 0 })),
    showComposer: true,
  };
}

// Fable review, LOW #1, 2026-09-16: `status` reaches a CSS class name
// (`family-status-${status}`), the one place this module doesn't use textContent/dataset. It's
// meant to always be one of familyMemory.js's own SESSION_STATES, written by the manager, but a
// hand-edited/corrupted state.json could otherwise inject an arbitrary class token (e.g. a space
// applying an unrelated utility class to the badge). Cosmetic-only on this local single-user app,
// but cheap to close: collapse anything outside a known-safe token shape to "unknown".
const SAFE_STATUS_TOKEN_RE = /^[a-z][a-z-]{0,31}$/;
function sanitizeStatusForClass(status) {
  return typeof status === 'string' && SAFE_STATUS_TOKEN_RE.test(status) ? status : 'unknown';
}

function el(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * Build the panel's real DOM tree from a describeFamilyPanel() result - browser-only (uses
 * `document`), never called from a headless test. Every dynamic value goes through
 * textContent/dataset, never string-concatenated into innerHTML.
 * @param {ReturnType<typeof describeFamilyPanel>} description
 */
export function buildFamilyPanelDom(description) {
  const frag = document.createDocumentFragment();

  if (description.emptyText !== null) {
    const className = description.isError ? 'family-panel-error' : 'family-panel-empty';
    frag.appendChild(el('p', { className, text: description.emptyText }));
    if (description.showCreateButton) {
      const btn = el('button', { className: 'btn family-create-btn', text: 'Create family' });
      btn.setAttribute('type', 'button');
      btn.dataset.role = 'family-create-btn';
      frag.appendChild(btn);
    }
    return frag;
  }

  const table = el('table', { className: 'family-session-table' });
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['Session', 'Status', 'Turns']) headRow.appendChild(el('th', { text: label }));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const session of description.sessions) {
    const row = el('tr');
    row.dataset.sessionId = session.sessionId;
    row.appendChild(el('td', { text: session.sessionId }));
    const statusCell = el('td');
    statusCell.appendChild(el('span', { className: `family-status-badge family-status-${session.status}`, text: session.status }));
    row.appendChild(statusCell);
    row.appendChild(el('td', { text: String(session.turnCount) }));
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  frag.appendChild(table);

  if (description.showComposer) {
    const composer = el('form', { className: 'family-dispatch-form' });
    composer.dataset.role = 'family-dispatch-form';
    const sessionInput = el('input');
    sessionInput.setAttribute('type', 'text');
    sessionInput.setAttribute('placeholder', 'Session id (existing or new)');
    sessionInput.dataset.role = 'family-session-input';
    const taskInput = el('textarea');
    taskInput.setAttribute('rows', '2');
    taskInput.setAttribute('placeholder', 'Task…');
    taskInput.dataset.role = 'family-task-input';
    const sendBtn = el('button', { className: 'btn family-dispatch-btn', text: 'Dispatch' });
    sendBtn.setAttribute('type', 'submit');
    composer.append(sessionInput, taskInput, sendBtn);
    frag.appendChild(composer);
  }

  return frag;
}
