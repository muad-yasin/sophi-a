// Verification for the 2026-09-14 GUI restructure (src/seatLayout.ts).
//
// Why this exists: the restructure's main risk is not "does it look nice" but "did moving every
// seat's body into a collapsible wrapper silently detach a control the rest of main.ts queries".
// That is checkable without a window, and this checks it - the real frontend bundle, the real
// index.html, driven in a DOM. What it deliberately does NOT check is appearance: pixels,
// spacing and whether the stage reads as centred are a human's own look at `npm run tauri dev`.
//
// Run: node scripts/verify-gui-restructure.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as esbuild from "esbuild";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Tauri's own APIs only exist inside the Tauri webview; stub them so the real UI code can run in
// a plain DOM. Everything under test (seatLayout.ts and main.ts's DOM wiring) is untouched.
const tauriStub = {
  name: "tauri-stub",
  setup(build) {
    build.onResolve({ filter: /^@tauri-apps\// }, (args) => ({ path: args.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: `
        export const invoke = async () => { throw new Error("no tauri in this harness"); };
        export const isPermissionGranted = async () => false;
        export const requestPermission = async () => "denied";
        export const sendNotification = () => {};
        export const getCurrentWindow = () => ({ isFocused: async () => true });
        export const open = async () => {};
      `,
      loader: "js",
    }));
  },
};

process.stderr.write("bundling…\n");
const bundle = await esbuild.build({
  entryPoints: [path.join(root, "src/main.ts")],
  bundle: true,
  format: "iife",
  write: false,
  platform: "browser",
  plugins: [tauriStub],
  loader: { ".ttf": "empty", ".css": "empty" },
});

process.stderr.write("bundled\n");
const html = readFileSync(path.join(root, "index.html"), "utf8").replace(
  /<script[\s\S]*?<\/script>/g,
  "",
);
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
window.WebSocket = class {
  constructor() {
    this.readyState = 0;
  }
  addEventListener() {}
  send() {}
  close() {}
};
process.stderr.write("dom ready\n");
window.eval(bundle.outputFiles[0].text);
window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

const doc = window.document;
const failures = [];
const ok = [];
function check(name, cond) {
  (cond ? ok : failures).push(name);
}

const SEATS = ["advisor", "plan-1", "plan-2", "plan-3", "build-1", "build-2", "build-3"];

// 1. Every seat feature's control still exists, still inside its own tile.
const REQUIRED = {
  advisor: ["task-form", "task-input", "send-btn", "stop-btn", "output", "badge", "cost-ticker",
    "provider-select", "model-input", "smoke-run-btn", "advisor-forward-btn"],
  "plan-1": ["task-form", "task-input", "send-btn", "stop-btn", "output", "badge", "cost-ticker",
    "chain-select", "cost-toggle", "cost-panel", "debate-toggle", "debate-panel", "debate-seal",
    "debate-history-select", "council-demo-btn", "forward-select", "forward-btn"],
  "build-1": ["task-form", "task-input", "send-btn", "stop-btn", "output", "badge", "cost-ticker",
    "pick-badge", "inspect-toggle", "inspect-panel", "inspect-file-list", "artifact-forward-row",
    "artifact-forward-select", "artifact-truncate-checkbox", "pick-btn", "ask-advisor-btn",
    "delete-workdir-btn", "also-build-2", "also-build-3"],
};
for (const [seat, roles] of Object.entries(REQUIRED)) {
  const tile = doc.querySelector(`[data-seat="${seat}"]`);
  for (const role of roles) {
    check(`${seat}: [data-role="${role}"] still present`, !!tile?.querySelector(`[data-role="${role}"]`));
  }
}
check("cnc keeps its own full tile (never collapsed)", !doc.querySelector('[data-seat="cnc"] .tile-toggle'));
check("cnc notice rail exists", !!doc.getElementById("cnc-notices"));

// 2. Collapse: every non-cnc seat has a chip + a hidden body at rest.
for (const seat of SEATS) {
  const tile = doc.querySelector(`[data-seat="${seat}"]`);
  const toggle = tile?.querySelector(".tile-toggle");
  const body = tile?.querySelector(".tile-body");
  check(`${seat}: has a chip toggle`, !!toggle);
  check(`${seat}: body collapsed at rest`, !!body && body.hasAttribute("hidden"));
  check(`${seat}: status badge moved into the chip`, !!toggle?.querySelector('[data-role="badge"]'));
  check(`${seat}: cost ticker moved into the chip`, !!toggle?.querySelector('[data-role="cost-ticker"]'));
  check(`${seat}: shows a placeholder mark`, !!toggle?.querySelector(".seat-mark"));
}
for (const seat of ["plan-1", "plan-2", "plan-3"]) {
  const txt = doc.querySelector(`[data-seat="${seat}"] .chip-council`)?.textContent || "";
  check(`${seat}: council differentiator visible at rest`, /labs/.test(txt));
}

// 3. Focus: clicking a chip pulls that seat forward; clicking it again puts it back.
const planChip = doc.querySelector('[data-seat="plan-2"] .tile-toggle');
planChip.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const grid = doc.getElementById("grid");
check("click focuses the seat", doc.querySelector('[data-seat="plan-2"]').classList.contains("focused"));
check("grid enters focus mode", grid.classList.contains("has-focus"));
check("focused seat's body is open", !doc.querySelector('[data-seat="plan-2"] .tile-body').hasAttribute("hidden"));
planChip.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("clicking again unfocuses", !doc.querySelector('[data-seat="plan-2"]').classList.contains("focused"));
check("body closes again", doc.querySelector('[data-seat="plan-2"] .tile-body').hasAttribute("hidden"));

// 4. Only one seat is ever in the foreground.
doc.querySelector('[data-seat="plan-1"] .tile-toggle').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
doc.querySelector('[data-seat="build-3"] .tile-toggle').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("only one focused seat at a time", doc.querySelectorAll(".tile.focused").length === 1);
doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
check("Escape clears the foreground", doc.querySelectorAll(".tile.focused").length === 0);

// 5. A seat that starts working opens itself and closes again when the turn ends - but a seat
//    the operator focused by hand stays open regardless.
const layout = window.__sophiaSeatLayout;
layout.onSeatStatus("build-1", "working");
check("working auto-expands the seat", !doc.querySelector('[data-seat="build-1"] .tile-body').hasAttribute("hidden"));
layout.onSeatStatus("build-1", "idle");
check("turn ending auto-collapses it again", doc.querySelector('[data-seat="build-1"] .tile-body').hasAttribute("hidden"));
layout.focusSeat("build-1");
layout.onSeatStatus("build-1", "working");
layout.onSeatStatus("build-1", "idle");
check("a hand-focused seat stays open across a turn", !doc.querySelector('[data-seat="build-1"] .tile-body').hasAttribute("hidden"));
layout.focusSeat(null);

// 6. A background seat surfaces a message into the C&C stage, and that message is clickable.
layout.surfaceToCnc("plan-3", "Council signed off, 5/5", "output");
const notice = doc.querySelector("#cnc-notices .cnc-notice-btn");
check("seat message surfaces into C&C", !!notice && /Planner 3/.test(notice.textContent));
notice.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("clicking a C&C message focuses that seat", doc.querySelector('[data-seat="plan-3"]').classList.contains("focused"));
layout.focusSeat(null);

console.log(`${ok.length} checks passed`);
// jsdom keeps reconnect timers alive; nothing here waits on them.
process.exitCode = failures.length ? 1 : 0;
if (failures.length) {
  console.error("FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
}
window.close();
process.exit(failures.length ? 1 : 0);
