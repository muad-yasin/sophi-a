import { invoke } from "@tauri-apps/api/core";
import { renderSeatOutput } from "./seatOutputRender";
import { initNotifications, notifySeatTransition } from "./seatNotify";
import { buildSeatMarkdown, buildDebateMarkdown, exportFilename } from "./exportMarkdown";

type SeatEventType =
  | "seat.start"
  | "seat.working"
  | "seat.output"
  | "seat.idle"
  | "seat.problem"
  | "seat.timeout";

interface SeatEvent {
  type: SeatEventType;
  seatId: string;
  timestamp: number;
  detail?: string;
}

// Parallel-build-and-compare's read-only query replies (PLAN_PARALLEL_BUILD.md §4) - request/
// response on the requesting client only, never broadcast, so these are never in SeatEventType.
interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}
interface DiffPatch {
  oldFileName: string;
  newFileName: string;
  hunks: DiffHunk[];
}
interface CompareChangesEvent {
  type: "compare.changes";
  seatId: string;
  takenAt?: number;
  changes?: { path: string; status: "added" | "modified" | "deleted"; crossBuilder: "same" | "differs" | "unique" }[];
  error?: string;
}
interface CompareDiffEvent {
  type: "compare.diff";
  seatId: string;
  path: string;
  patch?: DiffPatch;
  error?: string;
}
interface ComparePickEvent {
  type: "compare.pick";
  winner: string;
  participants: string[];
  taskId: string;
}
interface CompareRunRecord {
  taskId: string;
  task: string;
  winner: string;
  participants: string[];
  pickedAt: number;
}
interface CompareHistoryEvent {
  type: "compare.history";
  runs: CompareRunRecord[];
}

// "Surface the debate" (docs/market-positioning.md) - relay's own report.json, structured,
// broadcast whenever a plan-N seat's relay run finishes (relayChainSubprocess.js), win or lose.
interface DebateReportDetail {
  runId: string;
  passed: boolean;
  signoff: { provider: string; model: string; signedOff: boolean | null }[] | null;
  scoreboard: { labs: { lab: string; accepted: number; proposed: number }[] } | null;
  failures: { lab?: string; problem?: string; criterion?: string }[] | null;
}
interface DebateReportEvent {
  type: "debate.report";
  seatId: string;
  timestamp: number;
  detail: DebateReportDetail;
}

// Cost transparency (market-positioning.md feature idea #3) - relay's own real `--dry-run`
// pricing of a plan-N seat's chain, requested on demand (WS "estimate_cost"), never pushed.
interface CostEstimateRow {
  label: string;
  seat: string;
  input: number;
  output: number;
  usd: number | null;
  priced: boolean;
}
interface CostEstimateEvent {
  type: "cost.estimate";
  seatId: string;
  chain?: string;
  rows?: CostEstimateRow[];
  total?: { input: number; output: number; usd: number };
  unpriced?: string[];
  error?: string;
}

interface PreflightSeatResult {
  seat: string;
  status: "ready" | "error";
  error?: { type: "missing_cli" | "network" | "auth"; detail: string };
}
interface PreflightResultEvent {
  type: "preflight.result";
  results: PreflightSeatResult[];
  isFirstRun: boolean;
}

// Phase 3 Step 2 (replay from history, honest by construction) - a plan-N seat's recorded past
// relay runs (run-recorder.js), and the read-only replay of one of them. `report` on a
// ReplayResultEvent is the exact same shape as DebateReportDetail above (index.js's
// handleReplayRun builds it identically to relayChainSubprocess.js's live `debate.report`) so
// renderDebatePanel can render either one without caring which it got.
interface RunHistoryEntry {
  runId: string;
  recordedAt: number | null;
}
interface RunHistoryEvent {
  type: "run.history";
  seatId: string;
  runs?: RunHistoryEntry[];
  error?: string;
}
interface ReplayResultEvent {
  type: "replay.result";
  seatId: string;
  runId: string;
  report?: DebateReportDetail;
  recordedAt?: number | null;
  error?: string;
}

// Seat cost meter, real numbers only (Phase 2 Step 2 of the long-horizon plan). Pushed after
// every real seat turn (src/orchestrator/cost-tracker.js's `recordUsage`/`usageFromReport`,
// folded into a running per-seat total by index.js's makeEmit) - `total` is what the header
// ticker renders; `detail` is that one turn's own record, kept for a future per-turn/per-critic
// line but not rendered by this step's header ticker itself.
interface UsageTotal {
  inputTokens: number;
  outputTokens: number;
  usd: number;
  reported: boolean;
  priced: boolean;
}
interface SeatUsageEvent {
  type: "seat.usage";
  seatId: string;
  timestamp: number;
  detail?: { reported: boolean; inputTokens?: number; outputTokens?: number; priced?: boolean; usd?: number | null };
  total: UsageTotal;
}

type Status = "idle" | "working" | "problem" | "timeout";

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

// "timeout" reads as "timed out" on the badge - everywhere else (dataset.status, the CSS
// selectors, Status itself) keeps the plain "timeout" token; this is display text only.
const STATUS_LABELS: Record<Status, string> = {
  idle: "idle",
  working: "working",
  problem: "problem",
  timeout: "timed out",
};

function setStatus(seatId: string, status: Status) {
  const tile = tileEl(seatId);
  if (!tile) return;
  tile.dataset.status = status;
  const badge = tile.querySelector('[data-role="badge"]');
  if (badge) badge.textContent = STATUS_LABELS[status];
  setControlsEnabled(tile, status);
}

// Phase 1 Step 1/2 (long-horizon build plan): seatId -> ready, from the orchestrator's real
// {cmd:'preflight'} check. Absent means "not checked yet" - treated as ready so a Send button
// doesn't flash disabled-with-no-explanation before the first reply lands (the wizard panel, not
// a blocked button, is where an actual failure gets explained).
const seatReadiness = new Map<string, boolean>();

function isSeatReady(seatId: string | undefined): boolean {
  if (!seatId) return true;
  return seatReadiness.get(seatId) ?? true;
}

// Task input/Send/provider-config are disabled while the seat is working (an in-flight turn
// shouldn't be interrupted by a second `start`, and a provider/model swap mid-turn is confusing);
// Stop is only meaningful while something is actually running. Send is additionally disabled for
// any seat the last preflight check marked not-ready - a red seat can't be sent to no matter its
// working/idle/problem status.
function setControlsEnabled(tile: HTMLElement, status: Status) {
  const working = status === "working";
  const notReady = !isSeatReady(tile.dataset.seat);
  const taskInput = tile.querySelector<HTMLTextAreaElement>('[data-role="task-input"]');
  const sendBtn = tile.querySelector<HTMLButtonElement>('[data-role="send-btn"]');
  const stopBtn = tile.querySelector<HTMLButtonElement>('[data-role="stop-btn"]');
  const providerSelect = tile.querySelector<HTMLSelectElement>('[data-role="provider-select"]');
  const modelInput = tile.querySelector<HTMLInputElement>('[data-role="model-input"]');
  const compareCheckboxes = tile.querySelectorAll<HTMLInputElement>(
    '[data-role="also-build-2"], [data-role="also-build-3"]',
  );
  const smokeRunBtn = tile.querySelector<HTMLButtonElement>('[data-role="smoke-run-btn"]');
  const chainSelect = tile.querySelector<HTMLSelectElement>('[data-role="chain-select"]');
  if (taskInput) taskInput.disabled = working;
  if (sendBtn) sendBtn.disabled = working || notReady;
  if (stopBtn) stopBtn.disabled = !working;
  if (providerSelect) providerSelect.disabled = working;
  if (modelInput) modelInput.disabled = working;
  if (chainSelect) chainSelect.disabled = working;
  compareCheckboxes.forEach((cb) => (cb.disabled = working));
  // Phase 1 Step 3's own acceptance test: disabled while the seat is red, enabled the instant it
  // turns green - the same readiness gate as Send, plus the same working-state guard every other
  // dispatch control already has (one turn at a time, no exception for this one).
  if (smokeRunBtn) smokeRunBtn.disabled = working || notReady;
}

function reapplySeatControls(seatId: string) {
  const tile = tileEl(seatId);
  if (!tile) return;
  setControlsEnabled(tile, (tile.dataset.status as Status) || "idle");
}

function formatPreflightDetail(error: PreflightSeatResult["error"]): string {
  if (!error) return "";
  if (error.type === "missing_cli") {
    const bin = error.detail.match(/spawn (\S+)/)?.[1] ?? "required CLI";
    return `${bin}: not found on PATH`;
  }
  if (error.type === "network") return "No reply within 2s - check your connection";
  // 'auth': either "<ENV_VAR> is not set" (already reads clean) or a real HTTP rejection.
  const code = error.detail.match(/HTTP (\d+)/)?.[1];
  return code ? `Key rejected (HTTP ${code})` : error.detail;
}

function renderWizardPanel(results: PreflightSeatResult[]) {
  const list = document.querySelector<HTMLUListElement>('[data-role="wizard-seat-list"]');
  if (!list) return;
  list.innerHTML = "";
  for (const r of results) {
    const li = document.createElement("li");
    li.className = "wizard-seat-row";
    li.dataset.ready = String(r.status === "ready");
    const dot = document.createElement("span");
    dot.className = "wizard-seat-dot";
    const textWrap = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "wizard-seat-name";
    nameEl.textContent = paletteSeatLabel(r.seat);
    textWrap.appendChild(nameEl);
    if (r.status === "error") {
      const detailEl = document.createElement("div");
      detailEl.className = "wizard-seat-detail";
      detailEl.textContent = formatPreflightDetail(r.error);
      textWrap.appendChild(detailEl);
    }
    li.append(dot, textWrap);
    list.appendChild(li);
  }
}

function showWizardPanel() {
  const panel = document.getElementById("wizard-panel");
  if (panel) panel.hidden = false;
}

function hideWizardPanel() {
  const panel = document.getElementById("wizard-panel");
  if (panel) panel.hidden = true;
}

function handlePreflightResult(evt: PreflightResultEvent) {
  seatReadiness.clear();
  for (const r of evt.results) seatReadiness.set(r.seat, r.status === "ready");
  for (const r of evt.results) reapplySeatControls(r.seat);
  renderWizardPanel(evt.results);
  const hasFailure = evt.results.some((r) => r.status === "error");
  // Shown on first launch regardless of outcome (onboarding), or on any later launch where a
  // seat is actually failing - never auto-shown on a clean repeat launch, matching "re-show only
  // on failure" once past the first run.
  if (evt.isFirstRun || hasFailure) showWizardPanel();
}

function setupWizardPanel() {
  document.querySelector('[data-role="wizard-close"]')?.addEventListener("click", () => hideWizardPanel());
  document.querySelector('[data-role="wizard-recheck"]')?.addEventListener("click", () => {
    sendCommand({ cmd: "preflight" });
  });
}

// Phase 2 Step 3 ("Export a run as markdown"): the raw source text last fed to a seat's output
// pane and the operator's own last prompt to it - kept here, separately from the DOM, so
// "Copy as Markdown"/"Export" can reuse the exact already-sanitized text (never re-serialize
// the rendered HTML back into markdown) and so an export can include the prompt it answered.
const seatOutputCache = new Map<string, string>();
const seatPromptCache = new Map<string, string>();

function setOutput(seatId: string, text: string) {
  seatOutputCache.set(seatId, text);
  const tile = tileEl(seatId);
  if (!tile) return;
  const output = tile.querySelector<HTMLElement>('[data-role="output"]');
  if (!output) return;
  renderSeatOutput(output, text);
  output.classList.remove("placeholder");
}

// A visual record of what the operator asked for, since seat.output/seat.idle only ever carry
// the seat's own response text, never the operator's message. This is deliberately transient -
// it renders in the same single-line output slot the seat's own next event will overwrite, not a
// persistent transcript (that would need restructuring the output model into an append log,
// which is more than this pass needs - see DECISIONS.md).
function echoTask(seatId: string, task: string) {
  seatPromptCache.set(seatId, task);
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
    case "seat.idle": {
      const wasWorking = tileEl(evt.seatId)?.dataset.status === "working";
      setStatus(evt.seatId, "idle");
      if (evt.detail) setOutput(evt.seatId, evt.detail);
      // Only a real working -> idle transition, never the initial per-seat status replay every
      // fresh connection gets (see seatNotify.ts's own note on why that distinction matters).
      if (wasWorking) void notifySeatTransition(evt.seatId, "idle");
      break;
    }
    case "seat.problem": {
      const wasWorking = tileEl(evt.seatId)?.dataset.status === "working";
      setStatus(evt.seatId, "problem");
      if (evt.detail) setOutput(evt.seatId, evt.detail);
      if (wasWorking) void notifySeatTransition(evt.seatId, "problem");
      break;
    }
    // Phase 2 Step 1: the per-seat watchdog auto-stopped this seat for going silent past its
    // timeout_ms - a distinct red state from "problem" (a real error the seat's own process
    // reported) so the badge reads "timed out" rather than a generic failure it didn't have.
    case "seat.timeout": {
      const wasWorking = tileEl(evt.seatId)?.dataset.status === "working";
      setStatus(evt.seatId, "timeout");
      if (evt.detail) setOutput(evt.seatId, evt.detail);
      if (wasWorking) void notifySeatTransition(evt.seatId, "problem");
      break;
    }
  }
}

// Seat cost meter, real numbers only (Phase 2 Step 2). Mirrors cost-tracker.js's own
// formatUsage exactly - the binding invariant (GLM-2): a seat this app has no real token counts
// for shows "usage not reported", never a bare 0; a model with no price on file shows
// `~N tokens`, never a fabricated $ figure. Duplicated here (not imported) because this is a
// browser bundle and cost-tracker.js is a Node-only module (reads pricing.json off disk) - see
// DECISIONS.md.
function formatUsageTotal(total: UsageTotal): string {
  if (!total || !total.reported) return "usage not reported";
  const tokens = total.inputTokens + total.outputTokens;
  if (!total.priced) return `~${tokens} tokens`;
  return `${tokens} tokens — $${total.usd.toFixed(total.usd < 0.01 && total.usd > 0 ? 4 : 2)}`;
}

function handleSeatUsage(evt: SeatUsageEvent) {
  const tile = tileEl(evt.seatId);
  const ticker = tile?.querySelector<HTMLElement>('[data-role="cost-ticker"]');
  if (!ticker) return;
  ticker.textContent = formatUsageTotal(evt.total);
  ticker.hidden = false;
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
  let token: string;
  try {
    port = await invoke<number>("get_orchestrator_port");
    token = await invoke<string>("get_orchestrator_token");
  } catch (err) {
    debugLog(`invoke(get_orchestrator_port/token) failed: ${String(err)}`);
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
    // docs/security-prompt-injection.md S0/P0: the orchestrator drops every frame until this
    // exact handshake succeeds - always send it first, before anything else on this socket.
    ws.send(JSON.stringify({ cmd: "auth", token }));
    attempt = 0;
    everConnected = true;
    currentWs = ws;
    showConnected();
    // Phase 1 Step 1/2: re-check every seat's real readiness on every connect, not only once -
    // a fixed key or a fresh install both need this to run again without a restart.
    sendCommand({ cmd: "preflight" });
  });

  ws.addEventListener("message", (event) => {
    try {
      const evt = JSON.parse(event.data) as
        | SeatEvent
        | CompareChangesEvent
        | CompareDiffEvent
        | ComparePickEvent
        | CompareHistoryEvent
        | DebateReportEvent
        | CostEstimateEvent
        | PreflightResultEvent
        | RunHistoryEvent
        | ReplayResultEvent
        | SeatUsageEvent;
      if (evt.type === "compare.changes") handleCompareChanges(evt);
      else if (evt.type === "compare.diff") handleCompareDiff(evt);
      else if (evt.type === "compare.pick") handleComparePick(evt);
      else if (evt.type === "compare.history") handleCompareHistory(evt);
      else if (evt.type === "debate.report") handleDebateReport(evt);
      else if (evt.type === "cost.estimate") handleCostEstimate(evt);
      else if (evt.type === "preflight.result") handlePreflightResult(evt);
      else if (evt.type === "run.history") handleRunHistory(evt);
      else if (evt.type === "replay.result") handleReplayResult(evt);
      else if (evt.type === "seat.usage") handleSeatUsage(evt);
      else handleSeatEvent(evt as SeatEvent);
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
// sendCommand if the socket isn't open. build-1 is special-cased below for parallel-build-and-
// compare's fan-out dispatch (PLAN_PARALLEL_BUILD.md §3) - every other seat's form is untouched.
function setupTaskForms() {
  for (const seatId of SEAT_IDS) {
    const tile = tileEl(seatId);
    if (!tile) continue;

    const form = tile.querySelector<HTMLFormElement>('[data-role="task-form"]');
    if (form && seatId !== "build-1") {
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

    // Phase 1 Step 3 (long-horizon build plan) - only cnc/advisor have this button in the
    // markup; querySelector returns null elsewhere and this block is a no-op for every other
    // seat. Fixed ~10-token task, same dispatch path Send uses - a real live call, sent only on
    // an actual human click (this code never calls .click() on it itself).
    const smokeRunBtn = tile.querySelector<HTMLButtonElement>('[data-role="smoke-run-btn"]');
    if (smokeRunBtn) {
      smokeRunBtn.addEventListener("click", () => {
        const task = "Say hello";
        sendCommand({ cmd: "start", seatId, task });
        echoTask(seatId, task);
      });
    }
  }
}

// Phase 2 Step 1: one toolbar button that SIGTERMs (escalating to SIGKILL after 5s if still
// alive) every currently-running seat's process at once, via {cmd:'stop_all'} - the same
// per-seat stop path each tile's own Stop button already uses
// (src/orchestrator/index.js's stopAll()), just applied to all eight in one click.
function setupStopAllButton() {
  const btn = document.getElementById("stop-all-btn");
  btn?.addEventListener("click", () => {
    sendCommand({ cmd: "stop_all" });
  });
}

// Phase 3 Step 4: Ctrl+1..8 focuses a seat's task input, Enter (without Shift, so a multi-line
// task is still typeable) sends it, Esc stops it if running. Ctrl only, deliberately never
// Cmd - Cmd+<digit> is a live OS/browser tab-switch binding on macOS this must not fight, and
// nothing here needs the mixed Cmd-or-Ctrl handling the command palette's Cmd/Ctrl+K uses.
// Order places `cnc` first, not the tile grid's own DOM order (which starts with `advisor`) -
// it's the seat reached for fastest, matching this step's own acceptance test (Ctrl+1 -> cnc).
const SHORTCUT_SEAT_ORDER: readonly string[] = [
  "cnc",
  "advisor",
  "plan-1",
  "plan-2",
  "plan-3",
  "build-1",
  "build-2",
  "build-3",
];

function focusedShortcutSeatId(): string | null {
  const active = document.activeElement;
  const tile = active instanceof HTMLElement ? active.closest<HTMLElement>(".tile[data-seat]") : null;
  return tile?.dataset.seat ?? null;
}

function setupSeatKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && !e.metaKey && !e.altKey && /^[1-8]$/.test(e.key)) {
      const seatId = SHORTCUT_SEAT_ORDER[Number(e.key) - 1];
      const tile = tileEl(seatId);
      if (!tile) return;
      e.preventDefault();
      const input = tile.querySelector<HTMLTextAreaElement>('[data-role="task-input"]');
      if (input && !input.disabled) input.focus();
      return;
    }
    if (e.key === "Escape") {
      // The command palette owns Escape while it's open (setupCommandPalette's own handler
      // closes it) - this shortcut only applies once the palette isn't in the way.
      const palette = document.getElementById("command-palette");
      if (palette && !palette.hidden) return;
      const seatId = focusedShortcutSeatId();
      if (!seatId) return;
      if (tileEl(seatId)?.dataset.status === "working") {
        e.preventDefault();
        sendCommand({ cmd: "stop", seatId });
      }
    }
  });

  for (const seatId of SEAT_IDS) {
    const tile = tileEl(seatId);
    const input = tile?.querySelector<HTMLTextAreaElement>('[data-role="task-input"]');
    const form = tile?.querySelector<HTMLFormElement>('[data-role="task-form"]');
    if (!input || !form) continue;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!input.disabled) form.requestSubmit();
      }
    });
  }
}

// --- Command palette (Cmd/Ctrl+K): dispatch a task to any seat without hunting for its tile ---
// Two-step: type to filter seats by name, pick one (click or Enter), type the task, Send. Single-
// seat dispatch only - the same {cmd:'start'} every per-tile form already sends, just reachable
// without scrolling to find the right tile. Useful specifically for juggling several seats/
// sessions at once, where "find the right tile" is real friction.

let paletteSelectedSeatId: string | null = null;

function paletteSeatLabel(seatId: string): string {
  const name = tileEl(seatId)?.querySelector(".tile-name")?.textContent?.trim();
  return name || seatId;
}

function closeCommandPalette() {
  const palette = document.getElementById("command-palette");
  if (palette) palette.hidden = true;
  paletteSelectedSeatId = null;
}

function openCommandPalette() {
  const palette = document.getElementById("command-palette");
  const search = document.querySelector<HTMLInputElement>('[data-role="palette-search"]');
  const list = document.querySelector<HTMLUListElement>('[data-role="palette-list"]');
  const taskForm = document.querySelector<HTMLFormElement>('[data-role="palette-task-form"]');
  if (!palette || !search || !list || !taskForm) return;
  paletteSelectedSeatId = null;
  taskForm.hidden = true;
  list.hidden = false;
  search.value = "";
  palette.hidden = false;
  renderPaletteList("");
  search.focus();
}

function renderPaletteList(filter: string) {
  const list = document.querySelector<HTMLUListElement>('[data-role="palette-list"]');
  if (!list) return;
  list.innerHTML = "";
  // Token-AND match, not one literal substring - "build 2" has to match "Builder 2" the way a
  // person actually types it, and a single-substring match against "builder 2" (no space before
  // the digit) or "build-2" (a hyphen, not a space) would silently reject that query.
  const tokens = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = SEAT_IDS.filter((seatId) => {
    const haystack = `${seatId} ${paletteSeatLabel(seatId)}`.toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
  for (const seatId of matches) {
    const li = document.createElement("li");
    li.className = "command-palette-item";
    li.dataset.seatId = seatId;
    const status = (tileEl(seatId)?.dataset.status as Status) || "idle";
    li.dataset.status = status; // matches the existing [data-status] .status-badge color rules
    const nameEl = document.createElement("span");
    nameEl.textContent = paletteSeatLabel(seatId);
    const statusEl = document.createElement("span");
    statusEl.className = "status-badge status-badge-sm";
    statusEl.textContent = status;
    li.append(nameEl, statusEl);
    li.addEventListener("click", () => selectPaletteSeat(seatId));
    list.appendChild(li);
  }
  if (matches.length === 0) {
    const li = document.createElement("li");
    li.className = "command-palette-empty";
    li.textContent = "No seat matches.";
    list.appendChild(li);
  }
}

function selectPaletteSeat(seatId: string) {
  paletteSelectedSeatId = seatId;
  const list = document.querySelector<HTMLUListElement>('[data-role="palette-list"]');
  const taskForm = document.querySelector<HTMLFormElement>('[data-role="palette-task-form"]');
  const target = document.querySelector<HTMLElement>('[data-role="palette-target"]');
  const input = document.querySelector<HTMLTextAreaElement>('[data-role="palette-task-input"]');
  const sendBtn = document.querySelector<HTMLButtonElement>('[data-role="palette-send"]');
  if (!list || !taskForm || !target || !input || !sendBtn) return;
  list.hidden = true;
  taskForm.hidden = false;
  const status = (tileEl(seatId)?.dataset.status as Status) || "idle";
  const working = status === "working";
  target.textContent = working
    ? `${paletteSeatLabel(seatId)} is currently working - wait for it to finish.`
    : `Send to ${paletteSeatLabel(seatId)}`;
  input.disabled = working;
  sendBtn.disabled = working;
  input.value = "";
  if (!working) input.focus();
}

function setupCommandPalette() {
  const palette = document.getElementById("command-palette");
  const search = document.querySelector<HTMLInputElement>('[data-role="palette-search"]');
  const taskForm = document.querySelector<HTMLFormElement>('[data-role="palette-task-form"]');
  const backBtn = document.querySelector<HTMLButtonElement>('[data-role="palette-back"]');
  if (!palette || !search || !taskForm || !backBtn) return;

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (palette.hidden) openCommandPalette();
      else closeCommandPalette();
    } else if (e.key === "Escape" && !palette.hidden) {
      closeCommandPalette();
    }
  });

  // Clicking the dimmed backdrop closes it, same as Escape - only when the click actually
  // lands on the backdrop itself, not anything inside the box.
  palette.addEventListener("click", (e) => {
    if (e.target === palette) closeCommandPalette();
  });

  search.addEventListener("input", () => renderPaletteList(search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = document.querySelector<HTMLLIElement>(".command-palette-item");
      if (first?.dataset.seatId) selectPaletteSeat(first.dataset.seatId);
    }
  });

  backBtn.addEventListener("click", () => {
    paletteSelectedSeatId = null;
    taskForm.hidden = true;
    document.querySelector<HTMLUListElement>('[data-role="palette-list"]')!.hidden = false;
    search.focus();
  });

  taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!paletteSelectedSeatId) return;
    const input = document.querySelector<HTMLTextAreaElement>('[data-role="palette-task-input"]');
    if (!input) return;
    const task = input.value.trim();
    if (!task) return;
    sendCommand({ cmd: "start", seatId: paletteSelectedSeatId, task });
    echoTask(paletteSelectedSeatId, task);
    closeCommandPalette();
  });
}

// --- Parallel-build-and-compare: build-1's fan-out dispatch (PLAN_PARALLEL_BUILD.md §3) ---
// A checkbox row next to build-1's task input ("also run on build-2/3"), unchecked and
// non-sticky by default. With no boxes ticked, Send behaves exactly like every other tile's form
// (single {cmd:'start'}, no modal) - that path is untouched above. With one or more boxes
// ticked, Send is intercepted: a pre-spend confirmation modal names the real cost multiplier
// before anything spawns, and only on explicit confirm does a single {cmd:'start_many',
// seatIds, task, confirmed:true} go out - one fan-out call, not N independent sends.

let pendingCompareDispatch: { seatIds: string[]; task: string } | null = null;

function resetCompareCheckboxes() {
  const tile = tileEl("build-1");
  tile?.querySelectorAll<HTMLInputElement>(
    '[data-role="also-build-2"], [data-role="also-build-3"]',
  ).forEach((cb) => (cb.checked = false));
}

function hideCostConfirmModal() {
  const modal = document.getElementById("cost-confirm-modal");
  if (modal) modal.hidden = true;
  pendingCompareDispatch = null;
  // Non-sticky per PLAN_PARALLEL_BUILD.md §3: reset after every dispatch, confirmed OR
  // cancelled, so there is no persisted "mode" a human could forget was on.
  resetCompareCheckboxes();
}

function showCostConfirmModal(seatIds: string[], task: string) {
  const modal = document.getElementById("cost-confirm-modal");
  const title = document.getElementById("cost-confirm-title");
  if (!modal || !title) return;
  pendingCompareDispatch = { seatIds, task };
  const n = seatIds.length;
  title.textContent =
    `This will run the same task on ${n} builders: ${n}x cost and ${n}x subscription-usage ` +
    `consumption for this one task. Continue?`;
  modal.hidden = false;
}

function setupCostConfirmModal() {
  document
    .querySelector('[data-role="cost-confirm-cancel"]')
    ?.addEventListener("click", () => hideCostConfirmModal());

  document.querySelector('[data-role="cost-confirm-confirm"]')?.addEventListener("click", () => {
    if (!pendingCompareDispatch) return;
    const { seatIds, task } = pendingCompareDispatch;
    sendCommand({ cmd: "start_many", seatIds, task, confirmed: true });
    for (const seatId of seatIds) echoTask(seatId, task);
    hideCostConfirmModal();
  });
}

function setupBuild1CompareDispatch() {
  const tile = tileEl("build-1");
  if (!tile) return;
  const form = tile.querySelector<HTMLFormElement>('[data-role="task-form"]');
  const input = tile.querySelector<HTMLTextAreaElement>('[data-role="task-input"]');
  if (!form || !input) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const task = input.value.trim();
    if (!task) return;

    const also2 = tile.querySelector<HTMLInputElement>('[data-role="also-build-2"]')?.checked;
    const also3 = tile.querySelector<HTMLInputElement>('[data-role="also-build-3"]')?.checked;
    const seatIds = ["build-1", ...(also2 ? ["build-2"] : []), ...(also3 ? ["build-3"] : [])];

    if (seatIds.length === 1) {
      // Unchanged single-builder path - no modal, exactly today's behavior.
      sendCommand({ cmd: "start", seatId: "build-1", task });
      echoTask("build-1", task);
      input.value = "";
      return;
    }

    input.value = "";
    showCostConfirmModal(seatIds, task);
  });
}

// --- Parallel-build-and-compare: comparison UI (PLAN_PARALLEL_BUILD.md §4) ---
// Every builder tile gets an "Inspect changes" toggle - a seat that was never part of a
// comparison run just shows the empty-state message (the backend's `error` reply), no crash, no
// special-casing needed here. Expanding sends {cmd:'inspect_changes', seatId}; clicking a file
// in the resulting list sends {cmd:'get_diff', seatId, path} for that one file. Both are
// request/response on the WS the app already holds - handleCompareChanges/handleCompareDiff
// below render whatever comes back onto the seat's own tile, keyed by seatId in the reply.

const BUILDER_SEAT_IDS = ["build-1", "build-2", "build-3"] as const;

function setupInspectPanels() {
  for (const seatId of BUILDER_SEAT_IDS) {
    const tile = tileEl(seatId);
    const toggle = tile?.querySelector<HTMLButtonElement>('[data-role="inspect-toggle"]');
    const panel = tile?.querySelector<HTMLElement>('[data-role="inspect-panel"]');
    if (!tile || !toggle || !panel) continue;

    toggle.addEventListener("click", () => {
      const opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
      if (opening) sendCommand({ cmd: "inspect_changes", seatId });
    });

    // §5's guard checks for this flag server-side too - humanClick:true is not decorative, the
    // backend genuinely rejects a pick/delete without it (see DECISIONS.md).
    tile.querySelector('[data-role="pick-btn"]')?.addEventListener("click", () => {
      sendCommand({ cmd: "select_winner", seatId, humanClick: true });
    });
    // Non-binding (PLAN_PARALLEL_BUILD.md §6) - the reply is just another seat.output on
    // advisor's own tile, handled by the existing handleSeatEvent path; nothing here gates or
    // pre-selects the pick button above.
    tile.querySelector('[data-role="ask-advisor-btn"]')?.addEventListener("click", () => {
      sendCommand({ cmd: "advisor_recommend", seatId });
    });
    tile.querySelector('[data-role="delete-workdir-btn"]')?.addEventListener("click", () => {
      if (!window.confirm(`Delete ${seatId}'s working directory? This cannot be undone.`)) return;
      sendCommand({ cmd: "delete_workdir", seatId, humanClick: true });
    });
  }
}

const STATUS_LABEL: Record<string, string> = { added: "+", modified: "~", deleted: "-" };
const CROSS_BUILDER_LABEL: Record<string, string> = { same: "same", differs: "differs", unique: "unique" };

function handleCompareChanges(evt: CompareChangesEvent) {
  const tile = tileEl(evt.seatId);
  const empty = tile?.querySelector<HTMLElement>('[data-role="inspect-empty"]');
  const list = tile?.querySelector<HTMLUListElement>('[data-role="inspect-file-list"]');
  const diffEl = tile?.querySelector<HTMLElement>('[data-role="inspect-diff"]');
  const pickActions = tile?.querySelector<HTMLElement>('[data-role="inspect-pick-actions"]');
  if (!tile || !empty || !list) return;

  diffEl && (diffEl.hidden = true);
  list.innerHTML = "";

  // A seat with no snapshot was never part of a comparison run - no pick/delete makes sense
  // there either (§5's actions are scoped to seats that actually ran a comparison task).
  if (evt.error || !evt.changes || evt.changes.length === 0) {
    empty.hidden = false;
    empty.textContent = evt.error ?? "No changes since dispatch.";
    if (pickActions) pickActions.hidden = true;
    return;
  }
  empty.hidden = true;
  if (pickActions) pickActions.hidden = false;

  for (const change of evt.changes) {
    const li = document.createElement("li");
    li.className = "inspect-file-row";

    const status = document.createElement("span");
    status.className = `inspect-file-status inspect-file-status-${change.status}`;
    status.textContent = STATUS_LABEL[change.status] ?? "?";
    status.setAttribute("aria-label", change.status);

    const path = document.createElement("button");
    path.type = "button";
    path.className = "inspect-file-path";
    path.textContent = change.path;
    path.addEventListener("click", () => {
      sendCommand({ cmd: "get_diff", seatId: evt.seatId, path: change.path });
    });

    const cross = document.createElement("span");
    cross.className = `inspect-file-cross inspect-file-cross-${change.crossBuilder}`;
    cross.textContent = CROSS_BUILDER_LABEL[change.crossBuilder] ?? change.crossBuilder;

    li.append(status, path, cross);
    list.appendChild(li);
  }
}

function handleCompareDiff(evt: CompareDiffEvent) {
  const tile = tileEl(evt.seatId);
  const diffEl = tile?.querySelector<HTMLElement>('[data-role="inspect-diff"]');
  if (!tile || !diffEl) return;

  if (evt.error || !evt.patch) {
    diffEl.hidden = false;
    diffEl.textContent = evt.error ?? "No diff available.";
    return;
  }

  diffEl.hidden = false;
  diffEl.innerHTML = "";
  for (const hunk of evt.patch.hunks) {
    for (const line of hunk.lines) {
      const div = document.createElement("div");
      const marker = line.charAt(0);
      div.className =
        marker === "+" ? "diff-line diff-line-add" : marker === "-" ? "diff-line diff-line-del" : "diff-line";
      div.textContent = line;
      diffEl.appendChild(div);
    }
  }
}

// Disposition (PLAN_PARALLEL_BUILD.md §5): winner gets a "Winner" badge and loses its own
// pick/delete row (already decided, nothing left to do there); every other participant gets
// "Retained" and keeps its Delete button - retain-in-place is the only automatic behavior, the
// delete stays a deliberate, separate human action.
function handleComparePick(evt: ComparePickEvent) {
  for (const seatId of evt.participants) {
    const tile = tileEl(seatId);
    const badge = tile?.querySelector<HTMLElement>('[data-role="pick-badge"]');
    const pickActions = tile?.querySelector<HTMLElement>('[data-role="inspect-pick-actions"]');
    const pickBtn = tile?.querySelector<HTMLButtonElement>('[data-role="pick-btn"]');
    if (!badge) continue;

    const isWinner = seatId === evt.winner;
    badge.hidden = false;
    badge.textContent = isWinner ? "Winner" : "Retained";
    badge.dataset.picked = isWinner ? "winner" : "retained";
    if (pickBtn) pickBtn.hidden = true; // already decided for this comparison run
    if (pickActions) pickActions.hidden = false;
  }
}

function handleCompareHistory(evt: CompareHistoryEvent) {
  const list = document.getElementById("history-list");
  if (!list) return;
  list.innerHTML = "";
  if (evt.runs.length === 0) {
    const li = document.createElement("li");
    li.className = "history-empty";
    li.textContent = "No comparison runs yet.";
    list.appendChild(li);
    return;
  }
  for (const run of evt.runs) {
    const li = document.createElement("li");
    li.className = "history-row";
    const when = new Date(run.pickedAt).toLocaleString();
    li.textContent = `${when} - winner: ${run.winner} (of ${run.participants.join(", ")}) - "${run.task}"`;
    list.appendChild(li);
  }
}

function setupHistoryPanel() {
  const toggle = document.getElementById("history-toggle");
  const panel = document.getElementById("history-panel");
  const close = document.getElementById("history-close");
  if (!toggle || !panel) return;

  const open = () => {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    sendCommand({ cmd: "list_compare_runs" });
  };
  const closePanel = () => {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };
  toggle.addEventListener("click", () => (panel.hidden ? open() : closePanel()));
  close?.addEventListener("click", closePanel);
}

// --- "Surface the debate" (docs/market-positioning.md's headline feature idea) ---
// A `debate.report` event arrives whenever a plan-N seat's relay run finishes, whether or not
// the panel signed off - cached per seat here so the toggle can render immediately even if it
// was closed when the event actually arrived (a real chain run takes minutes; the operator is
// very likely not staring at a closed panel the whole time).

const PLANNER_SEAT_IDS = ["plan-1", "plan-2", "plan-3"] as const;
const debateCache = new Map<string, DebateReportDetail>();

// Phase 3 Step 2: which saved run (if any) a plan-N tile's debate panel is currently showing
// instead of its live debateCache entry. Absent = live. Set by picking a run in the history
// <select>; cleared back to live by picking "Live" - never automatically, so a live run finishing
// in the background never silently swaps out a replay the operator deliberately opened (the
// "honest by construction" rule cuts both ways: replay must never look live, and a live update
// must never quietly interrupt a replay either).
type ReplayView = { runId: string; report: DebateReportDetail } | { runId: string; error: string };
const replayView = new Map<string, ReplayView>();

function renderDebatePanel(seatId: string) {
  const tile = tileEl(seatId);
  const empty = tile?.querySelector<HTMLElement>('[data-role="debate-empty"]');
  const signoffList = tile?.querySelector<HTMLUListElement>('[data-role="debate-signoff-list"]');
  const scoreboardList = tile?.querySelector<HTMLUListElement>('[data-role="debate-scoreboard-list"]');
  const failureList = tile?.querySelector<HTMLUListElement>('[data-role="debate-failure-list"]');
  const seal = tile?.querySelector<SVGSVGElement>('[data-role="debate-seal"]');
  const banner = tile?.querySelector<HTMLElement>('[data-role="debate-replay-banner"]');
  const replayError = tile?.querySelector<HTMLElement>('[data-role="debate-replay-error"]');
  if (!tile || !empty || !signoffList || !scoreboardList || !failureList) return;

  const view = replayView.get(seatId);
  const report = view ? ("report" in view ? view.report : undefined) : debateCache.get(seatId);
  const errorText = view && "error" in view ? view.error : undefined;

  if (banner) banner.hidden = !view; // "REPLAY — not live" (the honesty rule) - only ever visible while a saved run is selected
  signoffList.innerHTML = "";
  scoreboardList.innerHTML = "";
  failureList.innerHTML = "";

  // "The High Council" (brand/HIGH_COUNCIL.md): the seal's five ring wedges each carry a
  // data-provider matching relay's own signoff[].provider string verbatim (labOf(seat) in
  // relay/src/chain.js falls back to seat.provider - "together"/"zai"/"cohere"/"google"/
  // "openrouter" for plan-cheap.json's critics, not a friendly lab name) - so this is a direct
  // selector match, not a lookup table that can drift out of sync with a chain-config change.
  seal?.querySelectorAll<SVGPathElement>(".seat").forEach(el => {
    el.classList.remove("debate-signed-off", "debate-objected", "debate-abstained");
  });

  // A truncated/corrupt report.json shows "unreadable report", never an empty pane or a partial
  // seal (Step 2's own acceptance test) - checked before the "no report yet" empty state below,
  // since an explicit replay error is a different, more specific case than "nothing has run yet".
  if (replayError) {
    replayError.hidden = !errorText;
    replayError.textContent = errorText ?? "";
  }
  if (errorText) {
    empty.hidden = true;
    return;
  }

  if (!report) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const s of report.signoff ?? []) {
    const li = document.createElement("li");
    li.className = "debate-signoff-row";
    const mark = s.signedOff === true ? "✓" : s.signedOff === false ? "✗" : "?";
    const state = s.signedOff === true ? "signed-off" : s.signedOff === false ? "objected" : "abstained";
    const markEl = document.createElement("span");
    markEl.className = `debate-signoff-mark debate-signoff-${state}`;
    markEl.textContent = mark;
    const labelEl = document.createElement("span");
    labelEl.textContent = `${s.provider} (${s.model})`;
    li.append(markEl, labelEl);
    signoffList.appendChild(li);

    const seatEl = seal?.querySelector<SVGPathElement>(`.seat[data-provider="${CSS.escape(s.provider)}"]`);
    seatEl?.classList.add(`debate-${state}`);
  }

  // relayChainSubprocess.js's own comment: report.json already has the scoreboard data a real
  // "who objected, what got overruled" UI needs - it reached this event's type definition but
  // was never actually rendered until now. A bar (accepted/proposed), not just a fraction, since
  // "3/5" alone doesn't show at a glance whether that's a strong or weak lab performance.
  for (const l of report.scoreboard?.labs ?? []) {
    const li = document.createElement("li");
    li.className = "debate-scoreboard-row";
    const labelEl = document.createElement("span");
    labelEl.className = "debate-scoreboard-label";
    labelEl.textContent = l.lab;
    const barEl = document.createElement("span");
    barEl.className = "debate-scoreboard-bar";
    const fillEl = document.createElement("span");
    fillEl.className = "debate-scoreboard-fill";
    const pct = l.proposed > 0 ? Math.round((l.accepted / l.proposed) * 100) : 0;
    fillEl.style.width = `${pct}%`;
    barEl.appendChild(fillEl);
    const countEl = document.createElement("span");
    countEl.className = "debate-scoreboard-count";
    countEl.textContent = `${l.accepted}/${l.proposed}`;
    li.append(labelEl, barEl, countEl);
    scoreboardList.appendChild(li);
  }

  // docs/security-prompt-injection.md S3/P2: problem/criterion is a critic's own, unfiltered
  // text - quoted and truncated so it reads as third-party speech, not this product's own UI
  // copy; the full text is still one hover away via `title` rather than silently dropped.
  const FAILURE_PREVIEW_CHARS = 240;
  for (const f of report.failures ?? []) {
    const li = document.createElement("li");
    li.className = "debate-failure-row";
    const text = f.problem ?? f.criterion ?? "(no reason recorded)";
    const truncated = text.length > FAILURE_PREVIEW_CHARS ? `${text.slice(0, FAILURE_PREVIEW_CHARS)}…` : text;
    li.textContent = f.lab ? `${f.lab} said: "${truncated}"` : `"${truncated}"`;
    if (text.length > FAILURE_PREVIEW_CHARS) li.title = text;
    failureList.appendChild(li);
  }
}

function handleDebateReport(evt: DebateReportEvent) {
  debateCache.set(evt.seatId, evt.detail);
  const tile = tileEl(evt.seatId);
  const panel = tile?.querySelector<HTMLElement>('[data-role="debate-panel"]');
  // Deliberately does not re-render while a replay is showing (see replayView's own comment) - a
  // background live run finishing must never silently swap out a saved run the operator opened on
  // purpose. debateCache is still updated above, so switching the history select back to "Live"
  // shows this new result immediately.
  if (panel && !panel.hidden && !replayView.has(evt.seatId)) renderDebatePanel(evt.seatId);
  updateForwardButton(evt.seatId);
}

// Phase 3 Step 2: a history dropdown per plan-N seat, populated on demand (when the debate panel
// opens, same lazy-load pattern as setupCostPanels below) rather than eagerly for every seat on
// startup.
function handleRunHistory(evt: RunHistoryEvent) {
  const tile = tileEl(evt.seatId);
  const select = tile?.querySelector<HTMLSelectElement>('[data-role="debate-history-select"]');
  if (!select) return;
  const current = select.value;
  select.innerHTML = "";
  const liveOpt = document.createElement("option");
  liveOpt.value = "";
  liveOpt.textContent = "Live";
  select.appendChild(liveOpt);
  for (const run of evt.runs ?? []) {
    const opt = document.createElement("option");
    opt.value = run.runId;
    opt.textContent = run.recordedAt ? `${run.runId} (${new Date(run.recordedAt).toLocaleString()})` : run.runId;
    select.appendChild(opt);
  }
  // Preserve the current selection across a refresh, best-effort - falls back to "Live" if the
  // previously-selected run no longer exists in the fresh list (e.g. it just got evicted).
  select.value = [...select.options].some(o => o.value === current) ? current : "";
}

function handleReplayResult(evt: ReplayResultEvent) {
  if (evt.error) replayView.set(evt.seatId, { runId: evt.runId, error: evt.error });
  else if (evt.report) replayView.set(evt.seatId, { runId: evt.runId, report: evt.report });
  else return; // malformed reply - neither report nor error; leave whatever was showing alone
  const tile = tileEl(evt.seatId);
  const panel = tile?.querySelector<HTMLElement>('[data-role="debate-panel"]');
  if (panel && !panel.hidden) renderDebatePanel(evt.seatId);
}

function setupDebateHistory() {
  for (const seatId of PLANNER_SEAT_IDS) {
    const tile = tileEl(seatId);
    const select = tile?.querySelector<HTMLSelectElement>('[data-role="debate-history-select"]');
    if (!tile || !select) continue;

    select.addEventListener("change", () => {
      const runId = select.value;
      if (!runId) {
        replayView.delete(seatId);
        renderDebatePanel(seatId);
        return;
      }
      sendCommand({ cmd: "replay_run", seatId, runId });
    });
  }
}

// "Plan approved" -> "code exists" (docs/security-prompt-injection.md's S2 forward rule, first
// candidate). The Forward control only ever enables once this seat's most recent run actually
// signed off (report.passed) - forwarding a plan the Council rejected would undercut the whole
// product pitch ("nothing builds until the Council signs off"), so this isn't just a UX nicety,
// it's the same guarantee the backend's own lastDeliverable cache enforces (relayChainSubprocess
// only ever populates it on a passed run).
let pendingForward: { fromSeatId: string; toSeatId: string } | null = null;

function updateForwardButton(seatId: string) {
  const tile = tileEl(seatId);
  const select = tile?.querySelector<HTMLSelectElement>('[data-role="forward-select"]');
  const btn = tile?.querySelector<HTMLButtonElement>('[data-role="forward-btn"]');
  if (!select || !btn) return;
  const passed = debateCache.get(seatId)?.passed === true;
  select.disabled = !passed;
  btn.disabled = !passed;
  btn.title = passed ? "" : "Needs a Council-approved plan first";
}

function hideForwardConfirmModal() {
  const modal = document.getElementById("forward-confirm-modal");
  if (modal) modal.hidden = true;
  pendingForward = null;
}

function setupForwardConfirmModal() {
  document
    .querySelector('[data-role="forward-confirm-cancel"]')
    ?.addEventListener("click", () => hideForwardConfirmModal());

  document.querySelector('[data-role="forward-confirm-confirm"]')?.addEventListener("click", () => {
    if (!pendingForward) return;
    const { fromSeatId, toSeatId } = pendingForward;
    sendCommand({ cmd: "forward_deliverable", fromSeatId, toSeatId, confirmed: true });
    echoTask(toSeatId, `> forwarded ${fromSeatId}'s Council-approved plan`);
    hideForwardConfirmModal();
  });
}

function setupForwardControls() {
  for (const seatId of PLANNER_SEAT_IDS) {
    const tile = tileEl(seatId);
    const select = tile?.querySelector<HTMLSelectElement>('[data-role="forward-select"]');
    const btn = tile?.querySelector<HTMLButtonElement>('[data-role="forward-btn"]');
    if (!tile || !select || !btn) continue;

    btn.addEventListener("click", () => {
      const toSeatId = select.value;
      const modal = document.getElementById("forward-confirm-modal");
      const title = document.getElementById("forward-confirm-title");
      if (!modal || !title) return;
      pendingForward = { fromSeatId: seatId, toSeatId };
      title.textContent =
        `This sends ${seatId}'s Council-approved plan to ${toSeatId} as its task - ${toSeatId} ` +
        `will start writing and editing real files. Continue?`;
      modal.hidden = false;
    });
  }
}

function setupDebatePanels() {
  for (const seatId of PLANNER_SEAT_IDS) {
    const tile = tileEl(seatId);
    const toggle = tile?.querySelector<HTMLButtonElement>('[data-role="debate-toggle"]');
    const panel = tile?.querySelector<HTMLElement>('[data-role="debate-panel"]');
    if (!tile || !toggle || !panel) continue;

    toggle.addEventListener("click", () => {
      const opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
      if (opening) {
        renderDebatePanel(seatId);
        sendCommand({ cmd: "list_runs", seatId }); // Phase 3 Step 2: refresh the history dropdown each time the panel opens
      }
    });
  }
}

// --- Phase 2 Step 3 of the long-horizon build plan ("Export a run as markdown") ---
// "Copy as Markdown" and "Export" on every seat and on each planner seat's Debate panel.
// Building the markdown string is pure (exportMarkdown.ts); this section is only the DOM
// wiring - one small row of controls injected next to each seat's output, and a second one
// inside each Debate panel, since a planner seat's plain output and its Debate panel are two
// different things worth exporting separately.

function seatDisplayLabel(seatId: string): string {
  return tileEl(seatId)?.querySelector(".tile-name")?.textContent?.trim() || seatId;
}

async function copyMarkdownToClipboard(markdown: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(markdown);
    return true;
  } catch (err) {
    debugLog(`copy-as-markdown failed: ${String(err)}`);
    return false;
  }
}

async function exportMarkdownToDisk(seatId: string, kind: "seat" | "debate", markdown: string): Promise<string> {
  return invoke<string>("export_run_markdown", { filename: exportFilename(seatId, kind), content: markdown });
}

function buildExportRow(seatId: string, kind: "seat" | "debate", getMarkdown: () => string): HTMLElement {
  const row = document.createElement("div");
  row.className = "export-row";
  row.dataset.role = kind === "seat" ? "seat-export-row" : "debate-export-row";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn";
  copyBtn.textContent = "Copy as Markdown";

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn";
  exportBtn.textContent = "Export";

  const status = document.createElement("span");
  status.className = "export-status";
  status.setAttribute("aria-live", "polite");

  copyBtn.addEventListener("click", async () => {
    const ok = await copyMarkdownToClipboard(getMarkdown());
    status.textContent = ok ? "Copied!" : "Copy failed";
    setTimeout(() => {
      if (status.textContent === "Copied!" || status.textContent === "Copy failed") status.textContent = "";
    }, 2000);
  });

  exportBtn.addEventListener("click", async () => {
    status.textContent = "Exporting…";
    try {
      const path = await exportMarkdownToDisk(seatId, kind, getMarkdown());
      status.textContent = `Exported to ${path}`;
      await refreshRecentExports();
    } catch (err) {
      status.textContent = `Export failed: ${String(err)}`;
      debugLog(`export failed for ${seatId} (${kind}): ${String(err)}`);
    }
  });

  row.append(copyBtn, exportBtn, status);
  return row;
}

function setupSeatExportControls() {
  for (const seatId of SEAT_IDS) {
    const tile = tileEl(seatId);
    const output = tile?.querySelector<HTMLElement>('[data-role="output"]');
    if (!tile || !output) continue;
    const row = buildExportRow(seatId, "seat", () =>
      buildSeatMarkdown(
        seatDisplayLabel(seatId),
        seatPromptCache.get(seatId) ?? null,
        seatOutputCache.get(seatId) ?? output.textContent ?? "",
      ),
    );
    output.insertAdjacentElement("afterend", row);
  }

  for (const seatId of PLANNER_SEAT_IDS) {
    const panel = tileEl(seatId)?.querySelector<HTMLElement>('[data-role="debate-panel"]');
    if (!panel) continue;
    const row = buildExportRow(seatId, "debate", () =>
      buildDebateMarkdown(seatDisplayLabel(seatId), seatPromptCache.get(seatId) ?? null, debateCache.get(seatId) ?? null),
    );
    panel.appendChild(row);
  }
}

// --- "Recent exports" (reopens a file Export just wrote to <appdata>/exports/) ---

interface RecentExportEntry {
  name: string;
  path: string;
  modified_ms: number;
}

async function refreshRecentExports() {
  const list = document.getElementById("exports-list");
  if (!list) return; // panel never opened yet in this session - nothing to refresh
  let entries: RecentExportEntry[];
  try {
    entries = await invoke<RecentExportEntry[]>("list_recent_exports");
  } catch (err) {
    debugLog(`list_recent_exports failed: ${String(err)}`);
    return;
  }
  list.innerHTML = "";
  if (entries.length === 0) {
    const li = document.createElement("li");
    li.className = "history-empty";
    li.textContent = "No exports yet.";
    list.appendChild(li);
    return;
  }
  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "history-row";
    const when = new Date(entry.modified_ms).toLocaleString();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = `${when} — ${entry.name}`;
    btn.addEventListener("click", () => void openRecentExport(entry));
    li.appendChild(btn);
    list.appendChild(li);
  }
}

async function openRecentExport(entry: RecentExportEntry) {
  const preview = document.getElementById("exports-preview");
  const nameEl = document.getElementById("exports-preview-name");
  const bodyEl = document.getElementById("exports-preview-body");
  if (!preview || !nameEl || !bodyEl) return;
  try {
    const content = await invoke<string>("read_export_file", { path: entry.path });
    nameEl.textContent = entry.name;
    renderSeatOutput(bodyEl, content);
    preview.hidden = false;
  } catch (err) {
    nameEl.textContent = entry.name;
    bodyEl.textContent = `Could not reopen this export: ${String(err)}`;
    preview.hidden = false;
  }
}

function setupExportsPanel() {
  const toggle = document.getElementById("exports-toggle");
  const panel = document.getElementById("exports-panel");
  const close = document.getElementById("exports-close");
  if (!toggle || !panel) return;

  const open = () => {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    void refreshRecentExports();
  };
  const closePanel = () => {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };
  toggle.addEventListener("click", () => (panel.hidden ? open() : closePanel()));
  close?.addEventListener("click", closePanel);
}

// Priced once per session per seat (a chain's own token assumptions don't change task-to-task,
// and there is no runtime chain-swap UI for plan-N seats), so the toggle only ever sends
// estimate_cost the first time it opens - reopening renders the cached reply instantly.
const costCache = new Map<string, CostEstimateEvent>();

function formatUsd(n: number): string {
  return `$${n.toFixed(n < 0.01 && n > 0 ? 4 : 2)}`;
}

function renderCostPanel(seatId: string) {
  const tile = tileEl(seatId);
  const empty = tile?.querySelector<HTMLElement>('[data-role="cost-empty"]');
  const rowList = tile?.querySelector<HTMLUListElement>('[data-role="cost-row-list"]');
  const totalEl = tile?.querySelector<HTMLElement>('[data-role="cost-total"]');
  if (!tile || !empty || !rowList || !totalEl) return;

  const est = costCache.get(seatId);
  rowList.innerHTML = "";
  totalEl.textContent = "";

  if (!est) {
    empty.hidden = false;
    empty.textContent = "Pricing this seat's chain…";
    return;
  }
  if (est.error) {
    empty.hidden = false;
    empty.textContent = est.error;
    return;
  }
  empty.hidden = true;

  for (const row of est.rows ?? []) {
    const li = document.createElement("li");
    li.className = "cost-row";
    li.textContent = `${row.label} (${row.seat}) — ${row.priced ? formatUsd(row.usd!) : "unpriced"}`;
    rowList.appendChild(li);
  }
  if (est.total) {
    totalEl.textContent = `Total: ${formatUsd(est.total.usd)} per run (${est.chain}, worst case — a clean first critique stops early and costs less)`;
  }
  if (est.unpriced?.length) {
    const li = document.createElement("li");
    li.className = "cost-row cost-row-unpriced";
    li.textContent = `No price on file for: ${est.unpriced.join(", ")}`;
    rowList.appendChild(li);
  }
}

function handleCostEstimate(evt: CostEstimateEvent) {
  costCache.set(evt.seatId, evt);
  const tile = tileEl(evt.seatId);
  const panel = tile?.querySelector<HTMLElement>('[data-role="cost-panel"]');
  if (panel && !panel.hidden) renderCostPanel(evt.seatId); // live-update if already open
}

function setupCostPanels() {
  for (const seatId of PLANNER_SEAT_IDS) {
    const tile = tileEl(seatId);
    const toggle = tile?.querySelector<HTMLButtonElement>('[data-role="cost-toggle"]');
    const panel = tile?.querySelector<HTMLElement>('[data-role="cost-panel"]');
    if (!tile || !toggle || !panel) continue;

    toggle.addEventListener("click", () => {
      const opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
      if (opening) {
        renderCostPanel(seatId);
        if (!costCache.has(seatId)) sendCommand({ cmd: "estimate_cost", seatId });
      }
    });
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

// Phase 3 Step 3: plan-1..3's chain-preset dropdown. Standard (plan-cheap, the seats.json
// default) needs no override; Fast/Thorough send {cmd:'configure', seatId, chainConfig} with the
// bare relay chain name - relayChainSubprocess.js's resolveChain() passes a name straight through
// to relay's own --chain resolution (a real "No such chain" exit is relay's own fail-fast for a
// typo, not something duplicated here); a ".json"-suffixed value there instead reads a real
// custom chain-config file and fails fast on malformed JSON. Selecting "Standard" again sends an
// empty chainConfig, which configureSeat treats as a reset to seats.json's own default_chain.
function setupChainPresets() {
  for (const seatId of PLANNER_SEAT_IDS) {
    const tile = tileEl(seatId);
    const select = tile?.querySelector<HTMLSelectElement>('[data-role="chain-select"]');
    if (!select) continue;
    select.addEventListener("change", () => {
      sendCommand({ cmd: "configure", seatId, chainConfig: select.value });
    });
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
  const cliInstallHint = document.getElementById("setup-cli-install-hint");
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
      if (cliInstallHint) cliInstallHint.hidden = true;
    } catch (err) {
      cliStatus.textContent = String(err);
      cliStatus.dataset.state = "problem";
      // A newcomer seeing a raw "could not run \"claude\" - is it installed and on PATH?" error
      // has no next step from that sentence alone - this is the one place in Setup that's their
      // literal first contact with Claude Code, so it gets an actual link, not just a diagnosis.
      if (cliInstallHint) cliInstallHint.hidden = false;
    }
  });

  restartBtn?.addEventListener("click", async () => {
    if (!restartStatus) return;
    restartStatus.textContent = "Restarting…";
    try {
      await invoke("restart_orchestrator");
      restartStatus.textContent = "Restarted - reconnecting…";
      // Real bug (found live, never fixed until now): restart_orchestrator's own Rust-side
      // comment assumed the old WebSocket's `close` event would fire promptly once the old
      // process died, triggering scheduleReconnect's existing backoff - but a killed process
      // doesn't always tear down its socket in a way the browser notices quickly, so `close`
      // (and therefore any reconnect at all) could simply never fire. Force it deterministically
      // instead of waiting on the OS: closing the stale connection ourselves fires the exact same
      // `close` handler that already calls scheduleReconnect(), so this only needs to reset
      // `attempt` first so that reconnect is fast rather than wherever the backoff had drifted to.
      // (A tried-and-reverted first version of this fix also called connect() directly here - a
      // real, live-tested regression: that raced the close handler's own scheduleReconnect() and
      // opened two simultaneous WebSocket connections to the new orchestrator.)
      attempt = 0;
      if (currentWs) {
        currentWs.close(); // triggers the existing close handler, which calls scheduleReconnect()
      } else {
        scheduleReconnect(); // already disconnected - nothing to close, so kick a fresh attempt
      }
    } catch (err) {
      restartStatus.textContent = `Failed: ${String(err)}`;
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  void initNotifications();
  showConnecting();
  setupAdvisorToggle();
  setupAdvisorActions();
  setupTaskForms();
  setupStopAllButton();
  setupSeatKeyboardShortcuts();
  setupSeatConfig();
  setupChainPresets();
  setupSetupPanel();
  setupBuild1CompareDispatch();
  setupCostConfirmModal();
  setupInspectPanels();
  setupHistoryPanel();
  setupDebatePanels();
  setupDebateHistory();
  setupSeatExportControls();
  setupExportsPanel();
  setupCostPanels();
  setupForwardConfirmModal();
  setupForwardControls();
  setupCommandPalette();
  setupWizardPanel();
  // Seed every tile's placeholder state explicitly (in case the orchestrator's own status
  // replay races the DOM), even though the HTML already ships with this markup.
  for (const seatId of SEAT_IDS) {
    const tile = tileEl(seatId);
    if (tile && !tile.dataset.status) tile.dataset.status = "idle";
    if (tile) setControlsEnabled(tile, (tile.dataset.status as Status) || "idle");
  }
  connect();
});
