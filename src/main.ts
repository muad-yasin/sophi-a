import { invoke } from "@tauri-apps/api/core";

type SeatEventType =
  | "seat.start"
  | "seat.working"
  | "seat.output"
  | "seat.idle"
  | "seat.problem";

interface SeatEvent {
  type: SeatEventType;
  seatId: string;
  timestamp: number;
  detail?: string;
}

type Status = "idle" | "working" | "problem";

const SEAT_IDS = [
  "advisor",
  "plan-1",
  "plan-2",
  "plan-3",
  "cnc",
  "build-1",
  "build-2",
  "build-3",
] as const;

const connectingEl = document.getElementById("connecting")!;
const connErrorEl = document.getElementById("conn-error")!;
const gridEl = document.getElementById("grid")!;

function tileEl(seatId: string): HTMLElement | null {
  return document.getElementById(`tile-${seatId}`);
}

function setStatus(seatId: string, status: Status) {
  const tile = tileEl(seatId);
  if (!tile) return;
  tile.dataset.status = status;
  const badge = tile.querySelector('[data-role="badge"]');
  if (badge) badge.textContent = status;
}

function setOutput(seatId: string, text: string) {
  const tile = tileEl(seatId);
  if (!tile) return;
  const output = tile.querySelector('[data-role="output"]');
  if (!output) return;
  output.textContent = text;
  output.classList.remove("placeholder");
}

function handleSeatEvent(evt: SeatEvent) {
  switch (evt.type) {
    case "seat.start":
      // start is transient - no resting status change; the tile stays on whatever it was.
      break;
    case "seat.working":
      setStatus(evt.seatId, "working");
      break;
    case "seat.output":
      if (evt.detail) setOutput(evt.seatId, evt.detail);
      break;
    case "seat.idle":
      setStatus(evt.seatId, "idle");
      if (evt.detail) setOutput(evt.seatId, evt.detail);
      break;
    case "seat.problem":
      setStatus(evt.seatId, "problem");
      if (evt.detail) setOutput(evt.seatId, evt.detail);
      break;
  }
}

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 8000, 8000];

function showConnected() {
  connectingEl.hidden = true;
  connErrorEl.hidden = true;
  gridEl.hidden = false;
}

function showConnecting() {
  connectingEl.hidden = false;
  connErrorEl.hidden = true;
  gridEl.hidden = true;
}

function showConnectionError() {
  connectingEl.hidden = true;
  connErrorEl.hidden = false;
  // keep the grid visible if it was already showing real data - a lost connection after a
  // successful session should not blank out everything the operator was already looking at.
}

let attempt = 0;
let everConnected = false;

async function connect() {
  let port: number;
  try {
    port = await invoke<number>("get_orchestrator_port");
  } catch {
    scheduleReconnect();
    return;
  }

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);

  ws.addEventListener("open", () => {
    attempt = 0;
    everConnected = true;
    showConnected();
  });

  ws.addEventListener("message", (event) => {
    try {
      const evt = JSON.parse(event.data) as SeatEvent;
      handleSeatEvent(evt);
    } catch {
      // malformed frame - ignore rather than crash the whole UI over one bad message
    }
  });

  ws.addEventListener("close", () => {
    if (everConnected) showConnectionError();
    else showConnecting();
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

function scheduleReconnect() {
  const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
  attempt += 1;
  setTimeout(connect, delay);
}

function setupAdvisorToggle() {
  const toggle = document.getElementById("advisor-toggle");
  const body = document.getElementById("advisor-body");
  if (!toggle || !body) return;
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    body.hidden = expanded;
  });
}

function setupAdvisorActions() {
  // Inert for slice 1, per PLAN.md: the affordance exists, the behavior is a later slice.
  document.querySelectorAll(".advisor-actions .btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const body = document.getElementById("advisor-body");
      const toggle = document.getElementById("advisor-toggle");
      if (body) body.hidden = true;
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  showConnecting();
  setupAdvisorToggle();
  setupAdvisorActions();
  // Seed every tile's placeholder state explicitly (in case the orchestrator's own status
  // replay races the DOM), even though the HTML already ships with this markup.
  for (const seatId of SEAT_IDS) {
    const tile = tileEl(seatId);
    if (tile && !tile.dataset.status) tile.dataset.status = "idle";
  }
  connect();
});
