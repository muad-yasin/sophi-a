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

// The two seats whose underlying provider/model are user-selectable (PLAN.md "Addendum
// (2026-09-09, second)"). The other six have no `provider` field in seats.json at all.
const CONFIGURABLE_SEAT_IDS = ["cnc", "advisor"] as const;

// Mirrors src/orchestrator/providers.js's ALLOWED_PROVIDERS - that file is the source of truth
// for this list; keep the two in sync manually, there is no shared-module setup between this
// Tauri frontend and the Node orchestrator sidecar yet. xai/Grok is deliberately excluded by
// standing product policy - do not add it back without asking first.
const ALLOWED_PROVIDERS: { id: string; label: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude / Fable)" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google (Gemini)" },
  { id: "mistral", label: "Mistral" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "groq", label: "Groq" },
  { id: "cohere", label: "Cohere" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "together", label: "Together" },
  { id: "zai", label: "Z.ai" },
];

const connectingEl = document.getElementById("connecting")!;
const connErrorEl = document.getElementById("conn-error")!;
const gridEl = document.getElementById("grid")!;

// Every seat.* event, plus WebSocket/invoke lifecycle transitions, are also written to
// /tmp/cnc-harness-frontend-debug.log via the debug_log command - a native window has no
// attached console the operator can casually check, so this is the durable diagnostic trail.
function debugLog(text: string) {
  console.log("[cnc-harness]", text);
  invoke("debug_log", { text: `${new Date().toISOString()} ${text}` }).catch(() => {});
}

window.addEventListener("error", (e) => {
  debugLog(`uncaught error: ${e.message}`);
});
window.addEventListener("unhandledrejection", (e) => {
  debugLog(`unhandled rejection: ${String(e.reason)}`);
});

function tileEl(seatId: string): HTMLElement | null {
  return document.getElementById(`tile-${seatId}`);
}

// The live WebSocket connection, reachable outside connect() so the task-form/config-picker
// submit handlers below can send commands on it. `sendCommand` no-ops safely (and logs) when
// there is no open connection, rather than throwing from inside a click/submit handler.
let currentWs: WebSocket | null = null;

function sendCommand(cmd: Record<string, unknown>) {
  if (currentWs && currentWs.readyState === WebSocket.OPEN) {
    currentWs.send(JSON.stringify(cmd));
  } else {
    debugLog(`sendCommand no-op, not connected: ${JSON.stringify(cmd)}`);
  }
}

function setStatus(seatId: string, status: Status) {
  const tile = tileEl(seatId);
  if (!tile) return;
  tile.dataset.status = status;
  const badge = tile.querySelector('[data-role="badge"]');
  if (badge) badge.textContent = status;
  setControlsEnabled(tile, status);
}

// Task input/Send/provider-config are disabled while the seat is working (an in-flight turn
// shouldn't be interrupted by a second `start`, and a provider/model swap mid-turn is confusing);
// Stop is only meaningful while something is actually running.
function setControlsEnabled(tile: HTMLElement, status: Status) {
  const working = status === "working";
  const taskInput = tile.querySelector<HTMLTextAreaElement>('[data-role="task-input"]');
  const sendBtn = tile.querySelector<HTMLButtonElement>('[data-role="send-btn"]');
  const stopBtn = tile.querySelector<HTMLButtonElement>('[data-role="stop-btn"]');
  const providerSelect = tile.querySelector<HTMLSelectElement>('[data-role="provider-select"]');
  const modelInput = tile.querySelector<HTMLInputElement>('[data-role="model-input"]');
  if (taskInput) taskInput.disabled = working;
  if (sendBtn) sendBtn.disabled = working;
  if (stopBtn) stopBtn.disabled = !working;
  if (providerSelect) providerSelect.disabled = working;
  if (modelInput) modelInput.disabled = working;
}

function setOutput(seatId: string, text: string) {
  const tile = tileEl(seatId);
  if (!tile) return;
  const output = tile.querySelector('[data-role="output"]');
  if (!output) return;
  output.textContent = text;
  output.classList.remove("placeholder");
}

// A visual record of what the operator asked for, since seat.output/seat.idle only ever carry
// the seat's own response text, never the operator's message. This is deliberately transient -
// it renders in the same single-line output slot the seat's own next event will overwrite, not a
// persistent transcript (that would need restructuring the output model into an append log,
// which is more than this pass needs - see DECISIONS.md).
function echoTask(seatId: string, task: string) {
  const tile = tileEl(seatId);
  if (!tile) return;
  const output = tile.querySelector('[data-role="output"]');
  if (!output) return;
  output.textContent = `> ${task}`;
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
  } catch (err) {
    debugLog(`invoke(get_orchestrator_port) failed: ${String(err)}`);
    scheduleReconnect();
    return;
  }

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);

  // A watchdog: if none of open/close/error ever fire within a reasonable window, log the raw
  // readyState so a silent hang is still diagnosable after the fact.
  const watchdog = setTimeout(() => {
    debugLog(`watchdog: 5s after construction, readyState still ${ws.readyState} - no open/close/error fired`);
  }, 5000);

  ws.addEventListener("open", () => {
    clearTimeout(watchdog);
    attempt = 0;
    everConnected = true;
    currentWs = ws;
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

  ws.addEventListener("close", (e) => {
    clearTimeout(watchdog);
    debugLog(`WebSocket closed: code=${e.code} reason=${e.reason}`);
    if (currentWs === ws) currentWs = null;
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

// Every one of the eight tiles gets a task input + Send + Stop (PLAN.md's gap: no UI path
// anywhere called startSeat/stopSeat before this). Submitting sends {cmd:'start', seatId, task}
// over the existing WebSocket; Stop sends {cmd:'stop', seatId}. Both are simple no-ops via
// sendCommand if the socket isn't open.
function setupTaskForms() {
  for (const seatId of SEAT_IDS) {
    const tile = tileEl(seatId);
    if (!tile) continue;

    const form = tile.querySelector<HTMLFormElement>('[data-role="task-form"]');
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = tile.querySelector<HTMLTextAreaElement>('[data-role="task-input"]');
        if (!input) return;
        const task = input.value.trim();
        if (!task) return;
        sendCommand({ cmd: "start", seatId, task });
        echoTask(seatId, task);
        input.value = "";
      });
    }

    const stopBtn = tile.querySelector<HTMLButtonElement>('[data-role="stop-btn"]');
    if (stopBtn) {
      stopBtn.addEventListener("click", () => {
        sendCommand({ cmd: "stop", seatId });
      });
    }
  }
}

// `cnc`/`advisor` only: a provider <select> (mirroring ALLOWED_PROVIDERS) plus a free-text model
// id field. Provider changes send {cmd:'configure', seatId, provider} immediately; the model
// field sends {cmd:'configure', seatId, model} on blur/Enter rather than per keystroke. `cnc`
// additionally gets a "chat only" badge disclosed whenever its provider isn't anthropic (PLAN.md
// "Addendum (2026-09-09, second)": a non-Anthropic cnc loses tool-use/file-editing and must not
// imply parity with the Claude Code coding-agent mode).
function setupSeatConfig() {
  for (const seatId of CONFIGURABLE_SEAT_IDS) {
    const tile = tileEl(seatId);
    if (!tile) continue;

    const select = tile.querySelector<HTMLSelectElement>('[data-role="provider-select"]');
    const modelInput = tile.querySelector<HTMLInputElement>('[data-role="model-input"]');
    const badge = tile.querySelector<HTMLElement>('[data-role="chat-only-badge"]');

    if (select) {
      for (const p of ALLOWED_PROVIDERS) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.label;
        select.appendChild(opt);
      }
      select.value = "anthropic";
      select.addEventListener("change", () => {
        sendCommand({ cmd: "configure", seatId, provider: select.value });
        if (badge) badge.hidden = select.value === "anthropic";
      });
    }

    if (modelInput) {
      const sendModel = () => {
        const model = modelInput.value.trim();
        if (model) sendCommand({ cmd: "configure", seatId, model });
      };
      modelInput.addEventListener("blur", sendModel);
      modelInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          sendModel();
        }
      });
    }
  }
}

// --- Setup panel: onboarding (Rust commands list_api_key_providers/set_api_key/
// check_claude_cli/restart_orchestrator) - not gating the rest of the UI, since a returning user
// with everything already configured has no reason to see it first. Opened on demand via the
// always-visible "Setup" button, independent of WebSocket connection state (key entry is a plain
// Tauri invoke, not a seat command).

async function refreshSetProviders(): Promise<Set<string>> {
  try {
    const set = await invoke<string[]>("list_api_key_providers");
    return new Set(set);
  } catch (err) {
    debugLog(`list_api_key_providers failed: ${String(err)}`);
    return new Set();
  }
}

async function buildSetupProviderList() {
  const list = document.getElementById("setup-provider-list");
  if (!list) return;
  const alreadySet = await refreshSetProviders();
  list.innerHTML = "";

  for (const p of ALLOWED_PROVIDERS) {
    const item = document.createElement("li");
    item.className = "setup-provider-row";

    const label = document.createElement("span");
    label.className = "setup-provider-label";
    label.textContent = p.id === "anthropic" ? `${p.label} (powers Advisor)` : p.label;

    const badge = document.createElement("span");
    badge.className = "setup-provider-badge";
    badge.textContent = alreadySet.has(p.id) ? "set" : "not set";
    badge.dataset.set = String(alreadySet.has(p.id));

    const input = document.createElement("input");
    input.type = "password";
    input.placeholder = alreadySet.has(p.id) ? "•••••••• (change)" : "paste key";
    input.setAttribute("aria-label", `${p.label} API key`);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", async () => {
      try {
        await invoke("set_api_key", { provider: p.id, key: input.value });
        input.value = "";
        const stillSet = await refreshSetProviders();
        badge.textContent = stillSet.has(p.id) ? "set" : "not set";
        badge.dataset.set = String(stillSet.has(p.id));
        input.placeholder = stillSet.has(p.id) ? "•••••••• (change)" : "paste key";
      } catch (err) {
        debugLog(`set_api_key(${p.id}) failed: ${String(err)}`);
      }
    });

    item.append(label, input, saveBtn, badge);
    list.appendChild(item);
  }
}

function setupSetupPanel() {
  const toggle = document.getElementById("setup-toggle");
  const panel = document.getElementById("setup-panel");
  const closeBtn = document.getElementById("setup-close");
  const checkCliBtn = document.getElementById("setup-check-cli");
  const cliStatus = document.getElementById("setup-cli-status");
  const restartBtn = document.getElementById("setup-restart");
  const restartStatus = document.getElementById("setup-restart-status");
  if (!toggle || !panel) return;

  const open = () => {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    void buildSetupProviderList();
  };
  const close = () => {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => (panel.hidden ? open() : close()));
  closeBtn?.addEventListener("click", close);

  checkCliBtn?.addEventListener("click", async () => {
    if (!cliStatus) return;
    cliStatus.textContent = "Checking…";
    cliStatus.dataset.state = "unknown";
    try {
      const version = await invoke<string>("check_claude_cli");
      cliStatus.textContent = `Found: ${version}`;
      cliStatus.dataset.state = "ok";
    } catch (err) {
      cliStatus.textContent = String(err);
      cliStatus.dataset.state = "problem";
    }
  });

  restartBtn?.addEventListener("click", async () => {
    if (!restartStatus) return;
    restartStatus.textContent = "Restarting…";
    try {
      await invoke("restart_orchestrator");
      restartStatus.textContent = "Restarted - reconnecting…";
    } catch (err) {
      restartStatus.textContent = `Failed: ${String(err)}`;
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  showConnecting();
  setupAdvisorToggle();
  setupAdvisorActions();
  setupTaskForms();
  setupSeatConfig();
  setupSetupPanel();
  // Seed every tile's placeholder state explicitly (in case the orchestrator's own status
  // replay races the DOM), even though the HTML already ships with this markup.
  for (const seatId of SEAT_IDS) {
    const tile = tileEl(seatId);
    if (tile && !tile.dataset.status) tile.dataset.status = "idle";
    if (tile) setControlsEnabled(tile, (tile.dataset.status as Status) || "idle");
  }
  connect();
});
