// GUI restructure (2026-09-14, Muad's own design direction, quoted in DECISIONS.md):
//
//   "Only the C&C seat should have a text window - a large one, centered, seamless into the
//    screen. The other seats (Advisor, planning, building) get a placeholder image and sit in
//    the background; they can display messages to C&C. The user can select one to send messages
//    directly to that session, and pull its chat log into the foreground too."
//
// Two independent layers, built in that order on purpose:
//
//  1. COLLAPSE. Every non-cnc tile becomes a compact chip - placeholder mark, name, status badge,
//     cost ticker, one-line last output - and its existing full body (task form, cost panel,
//     debate panel, inspect panel, forward controls, smoke run…) moves, untouched, into a
//     collapsible `.tile-body`. Nothing is removed or rebuilt: every `[data-role="…"]` node the
//     rest of main.ts queries is the same node, just nested one level deeper and sometimes
//     `hidden`. `hidden` does not break querySelector, listeners, or value reads, so no existing
//     seat feature changes behavior. This step is worth having on its own and survives a revert
//     of step 2.
//
//  2. FOCUS. Collapsed chips sit in the background; C&C holds the centre. Clicking a chip (or
//     a message it surfaced into C&C) pulls that one seat's body into a foreground panel on its
//     own side of the stage. One seat focused at a time; Escape closes.
//
// The advisor tile already had this collapse pattern hand-written in index.html (`advisor-toggle`
// / `advisor-body`); rather than a second parallel implementation, that existing pair is adopted
// here and given the same chip chrome as the other six.

const NON_CNC_SEATS = ["advisor", "plan-1", "plan-2", "plan-3", "build-1", "build-2", "build-3"];

const SEAT_ROLE_LABEL: Record<string, string> = {
  advisor: "Oversight",
  "plan-1": "Council plan",
  "plan-2": "Council plan",
  "plan-3": "Council plan",
  "build-1": "Build",
  "build-2": "Build",
  "build-3": "Build",
};

const SEAT_LABEL: Record<string, string> = {
  cnc: "Command & Control",
  advisor: "Advisor",
  "plan-1": "Planner 1",
  "plan-2": "Planner 2",
  "plan-3": "Planner 3",
  "build-1": "Builder 1",
  "build-2": "Builder 2",
  "build-3": "Builder 3",
};

// The "placeholder image" of Muad's direction, one per seat family. Planners get a miniature of
// the real Council seal (brand/HIGH_COUNCIL.md) - five seats around one orb, the same five-lab
// mechanism the Debate panel shows in full - so the differentiator is visible on the tile at
// rest instead of only inside the one-shot explainer modal. Builders get a wrench-and-file mark,
// advisor an eye. Decorative only; the status badge and ring remain the status carriers.
function placeholderMark(seatId: string): string {
  if (seatId.startsWith("plan-")) {
    return `<svg class="seat-mark seat-mark-council" viewBox="0 0 512 512" aria-hidden="true">
      <g class="council-ring">
        <path fill="#7a8fa6" d="M 256 256 L 184.2 58.7 A 210 210 0 0 1 327.8 58.7 Z"/>
        <path fill="#8a9a7a" d="M 256 256 L 184.2 58.7 A 210 210 0 0 1 327.8 58.7 Z" transform="rotate(72 256 256)"/>
        <path fill="#a68a6b" d="M 256 256 L 184.2 58.7 A 210 210 0 0 1 327.8 58.7 Z" transform="rotate(144 256 256)"/>
        <path fill="#7a90a6" d="M 256 256 L 184.2 58.7 A 210 210 0 0 1 327.8 58.7 Z" transform="rotate(216 256 256)"/>
        <path fill="#9a8a6b" d="M 256 256 L 184.2 58.7 A 210 210 0 0 1 327.8 58.7 Z" transform="rotate(288 256 256)"/>
      </g>
      <circle cx="256" cy="256" r="92" fill="url(#council-orb)"/>
    </svg>`;
  }
  if (seatId.startsWith("build-")) {
    return `<svg class="seat-mark seat-mark-build" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 7h7M4 12h5M4 17h7"/>
      <path d="M15 5l5 5-5 5"/>
    </svg>`;
  }
  return `<svg class="seat-mark seat-mark-advisor" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/>
    <circle cx="12" cy="12" r="2.6"/>
  </svg>`;
}

function tile(seatId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-seat="${seatId}"]`);
}

function gridEl(): HTMLElement | null {
  return document.getElementById("grid");
}

let focusedSeat: string | null = null;

/** Seats this module expanded by itself (because they started working), not by a human click -
 *  only these are auto-collapsed again when the turn ends. A seat the operator opened stays open. */
const autoExpanded = new Set<string>();

export function isSeatExpanded(seatId: string): boolean {
  const body = tile(seatId)?.querySelector<HTMLElement>(".tile-body, .advisor-body");
  return !!body && !body.hidden;
}

export function setSeatExpanded(seatId: string, expanded: boolean): void {
  const t = tile(seatId);
  if (!t) return;
  const body = t.querySelector<HTMLElement>(".tile-body, .advisor-body");
  const toggle = t.querySelector<HTMLElement>(".tile-toggle");
  if (!body || !toggle) return;
  body.hidden = !expanded;
  toggle.setAttribute("aria-expanded", String(expanded));
  t.classList.toggle("expanded", expanded);
}

/** Pull one seat into the foreground (Muad's "pull its chat log into the foreground too").
 *  Passing null, or the already-focused seat, returns the stage to C&C alone. */
export function focusSeat(seatId: string | null): void {
  const grid = gridEl();
  if (!grid) return;
  if (seatId && focusedSeat === seatId) seatId = null;
  if (focusedSeat) {
    tile(focusedSeat)?.classList.remove("focused");
    if (!autoExpanded.has(focusedSeat)) setSeatExpanded(focusedSeat, false);
  }
  focusedSeat = seatId;
  grid.classList.toggle("has-focus", !!seatId);
  if (seatId) {
    const t = tile(seatId);
    t?.classList.add("focused");
    setSeatExpanded(seatId, true);
    t?.querySelector<HTMLTextAreaElement>('[data-role="task-input"]')?.focus();
  }
}

export function focusedSeatId(): string | null {
  return focusedSeat;
}

/** The one-line summary a collapsed chip shows: the seat's own latest output (or the operator's
 *  last prompt to it), flattened to a single line. Called from main.ts's setOutput/echoTask so
 *  there is still exactly one place output text enters the UI. */
export function setSeatSummary(seatId: string, text: string): void {
  const el = tile(seatId)?.querySelector<HTMLElement>('[data-role="chip-summary"]');
  if (!el) return;
  const line = text.replace(/\s+/g, " ").trim();
  el.textContent = line.length > 140 ? `${line.slice(0, 139)}…` : line;
  el.classList.toggle("placeholder", line.length === 0);
}

/** A background seat "displaying a message to C&C": one line in the C&C stage's notice rail,
 *  newest first, capped. Clicking it focuses the seat that sent it. */
export function surfaceToCnc(seatId: string, text: string, kind: "output" | "problem"): void {
  const list = document.getElementById("cnc-notices");
  if (!list || seatId === "cnc") return;
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return;
  const li = document.createElement("li");
  li.className = `cnc-notice cnc-notice-${kind}`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cnc-notice-btn";
  const who = document.createElement("span");
  who.className = "cnc-notice-seat";
  who.textContent = SEAT_LABEL[seatId] ?? seatId;
  const body = document.createElement("span");
  body.className = "cnc-notice-text";
  body.textContent = line.length > 160 ? `${line.slice(0, 159)}…` : line;
  btn.append(who, body);
  btn.addEventListener("click", () => focusSeat(seatId));
  li.append(btn);
  list.prepend(li);
  while (list.children.length > 6) list.lastElementChild?.remove();
}

/** Status-driven behavior: a seat that starts working opens itself (Muad's chips should not hide
 *  live work), and closes again when the turn ends unless the operator had focused it. */
export function onSeatStatus(seatId: string, status: string): void {
  if (seatId === "cnc") return;
  if (status === "working") {
    if (!isSeatExpanded(seatId)) {
      autoExpanded.add(seatId);
      setSeatExpanded(seatId, true);
    }
  } else if (autoExpanded.has(seatId)) {
    autoExpanded.delete(seatId);
    if (focusedSeat !== seatId) setSeatExpanded(seatId, false);
  }
}

function buildChip(seatId: string, t: HTMLElement): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tile-toggle";
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = `
    <span class="seat-mark-wrap" aria-hidden="true">${placeholderMark(seatId)}</span>
    <span class="chip-text">
      <span class="chip-top">
        <span class="chip-name"></span>
        <span class="chip-role"></span>
      </span>
      <span class="chip-summary placeholder" data-role="chip-summary">Idle</span>
      <span class="chip-council"></span>
    </span>
    <span class="chip-meta"></span>
    <span class="chevron" aria-hidden="true">&#9662;</span>`;
  const name = SEAT_LABEL[seatId] ?? seatId;
  btn.querySelector(".chip-name")!.textContent = name;
  btn.querySelector(".chip-role")!.textContent = SEAT_ROLE_LABEL[seatId] ?? "";
  btn.setAttribute("aria-label", `${name} - expand`);
  // Step 3 of the restructure: the cross-lab differentiator lives on the Planner tiles at rest,
  // not only inside the one-shot "Meet the High Council" modal a user dismisses once and never
  // sees again.
  if (seatId.startsWith("plan-")) {
    btn.querySelector(".chip-council")!.textContent = "5 rival labs grade the plan blind";
  }
  // The existing cost ticker and status badge are MOVED out of the old header into the chip, not
  // copied: main.ts's refreshCostTicker/setStatus keep writing to the same elements.
  const meta = btn.querySelector(".chip-meta")!;
  const ticker = t.querySelector('[data-role="cost-ticker"]');
  const pick = t.querySelector('[data-role="pick-badge"]');
  const badge = t.querySelector('[data-role="badge"]');
  if (ticker) meta.append(ticker);
  if (pick) meta.append(pick);
  if (badge) meta.append(badge);
  return btn;
}

export function setupSeatLayout(): void {
  for (const seatId of NON_CNC_SEATS) {
    const t = tile(seatId);
    if (!t) continue;

    // advisor already ships a hand-written toggle/body pair in index.html; reuse it rather than
    // building a second one, then give it the same chip chrome as the rest.
    const existingToggle = t.querySelector<HTMLElement>(".advisor-toggle");
    const existingBody = t.querySelector<HTMLElement>(".advisor-body");

    let body: HTMLElement;
    if (existingBody) {
      body = existingBody;
    } else {
      body = document.createElement("div");
      body.className = "tile-body";
      body.hidden = true;
      // everything except the header (whose badge/ticker the chip adopts below) moves inside
      const moving = Array.from(t.children).filter((c) => !c.classList.contains("tile-header"));
      for (const child of moving) body.append(child);
    }

    const chip = buildChip(seatId, t);
    if (existingToggle) {
      existingToggle.replaceWith(chip);
    } else {
      t.querySelector(".tile-header")?.remove();
      t.prepend(chip);
    }
    if (!body.parentElement) t.append(body);
    body.classList.add("tile-body");
    body.hidden = true;
    t.classList.remove("expanded");

    chip.addEventListener("click", () => focusSeat(seatId));
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && focusedSeat) {
      // Never steal Escape from an open modal/palette - those own it first.
      const modalOpen = Array.from(
        document.querySelectorAll<HTMLElement>(".wizard-panel, .command-palette, .setup-panel"),
      ).some((el) => !el.hidden);
      if (modalOpen) return;
      focusSeat(null);
    }
  });
}

// A debug/verification handle on the one live instance of this module's state. Same spirit as
// src/mcp/server.js exposing the running orchestrator: a native window has no console, so the
// only way to drive this layer from outside is a handle it publishes itself. Read/drive only -
// nothing in the app reads it back, and scripts/verify-gui-restructure.mjs is its one consumer.
(globalThis as unknown as Record<string, unknown>).__sophiaSeatLayout = {
  setSeatExpanded,
  isSeatExpanded,
  focusSeat,
  focusedSeatId,
  setSeatSummary,
  surfaceToCnc,
  onSeatStatus,
};
