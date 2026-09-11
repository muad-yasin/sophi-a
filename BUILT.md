# Built

- 2026-09-09 - Repo scaffold (PLAN.md "Repository shape"; scope ledger A-1/B-1). Tauri v2
  vanilla-TypeScript project scaffolded, package/product naming set, `.env.example` documents
  `RELAY_PATH`.
- 2026-09-09 - Orchestrator core (PLAN.md "Orchestrator core"; scope ledger C-1/D-4).
  `src/orchestrator/index.js`: ephemeral-port WebSocket sidecar, seat registry loader,
  startSeat/stopSeat dispatch.
- 2026-09-09 - Seat registry (PLAN.md "Seat registry"; scope ledger A-3/C-2/F-1). All eight seats
  declared in `src/orchestrator/seats.json`.
- 2026-09-09 - Status/event model (PLAN.md "Status/event model"; scope ledger A-2/C-3/F-2). The
  five-event vocabulary, implemented across all three adapters below.
- 2026-09-09 - Seat invocation mechanism, all three modes (PLAN.md "Seat invocation mechanism"):
  `claudeCodeSubprocess.js` (cnc, build-1..3), `messagesApi.js` (advisor),
  `relayChainSubprocess.js` (plan-1..3). All tested end-to-end with real calls (see PROGRESS.md,
  notes-relay-chain-adapter.md).
- 2026-09-09 - Desktop shell and UI (PLAN.md "Desktop shell and UI"; scope ledger A-4/C-4/F-3).
  `index.html`, `src/styles.css`, `src/main.ts`.
- 2026-09-09 - Bridge/IPC (PLAN.md "Bridge/IPC"; scope ledger A-5/C-5/F-2). `src-tauri/src/lib.rs`
  spawns the orchestrator, exposes `get_orchestrator_port`.
- 2026-09-09 - Integration test (PLAN.md "the bar the whole must meet"). `npm run tauri dev`
  verified end-to-end: real compile, real process spawn chain, real WebSocket replay of all eight
  seats as idle on connect.
- 2026-09-09 - Provider-selectable `cnc`/`advisor` (PLAN.md "Addendum (2026-09-09, second)").
  `src/orchestrator/providers.js` (new): the allowed-provider list, xai/Grok deliberately absent.
  `seats.json`: `provider`/`chat_history` fields added to `cnc`/`advisor`. `index.js`:
  `effectiveInvocationMode` falls a claude-code-subprocess seat back to messages-api when its
  provider isn't anthropic. `messagesApi.js`: generalized off the hardcoded `call('anthropic', ...)`
  to `call(seatConfig.provider, ...)`, added a `cnc`-specific chat system prompt (honestly discloses
  no tool-use in this mode) and per-seat in-memory chat history. Tested for real: advisor's existing
  Anthropic path still works unchanged (regression check), an `xai` provider is rejected before any
  API call, and an `openai` provider correctly reaches relay's dispatch (fails only on the missing
  test key in this environment, not a code defect).
- 2026-09-09 - Task-input UI + cnc/advisor provider picker (PLAN.md "Desktop shell and UI" /
  Addendum "cnc and advisor become provider-selectable"; fills the gap DECISIONS.md's monetization
  entry named: no UI path anywhere called `startSeat`). `index.html`: a task textarea + Send + Stop
  added to all 8 tiles; a provider `<select>` + model-id text input + chat-only badge added to
  `cnc`'s and `advisor`'s tiles only. `src/main.ts`: a module-level `currentWs` + `sendCommand()`
  helper (no-ops safely if disconnected); `setControlsEnabled()` disables the task input/Send/
  provider-config while a seat is `"working"` and only then enables Stop; `echoTask()` writes
  "> task text" into the output slot on submit so the operator sees what they asked for;
  `ALLOWED_PROVIDERS` mirrors `src/orchestrator/providers.js` (kept in sync manually, commented as
  such - no shared-module setup between the frontend and the orchestrator sidecar yet).
  `src/styles.css`: `.task-form`/`.task-input`/`.seat-config`/`.chat-only-badge` and `:disabled`
  styling, reusing the existing surface/status palette. `src/orchestrator/index.js`: new
  `configureSeat(seatId, {provider, model})` + a `cmd:'configure'` WebSocket handler - validates
  `provider` via `isAllowedProvider` (`providers.js`), restricted to `cnc`/`advisor` via a
  `CONFIGURABLE_SEAT_IDS` set, rejects an unknown or disallowed request with a server-side
  `console.error` rather than crashing, and mutates only the in-memory seat entry (never persisted
  to `seats.json`). Tested for real (see PROGRESS.md): a direct WebSocket protocol test against
  both a standalone orchestrator process and the live one already spawned by a real `npm run tauri
  dev` process, confirmed by finding and connecting to that process's actual bound port.
- 2026-09-09 - Product named "Sophi-A" + visual identity ported from SMO (DECISIONS.md has the
  full reasoning). `tauri.conf.json` (productName, window title, identifier ->
  `com.sower.sophia`), `package.json` name, `index.html` title, `README.md` (real content,
  replacing the stock Tauri template) all updated. `src/styles.css` rewritten against SMO's real
  `ScreenBuilderUtils.cs` palette (Bg/Surface ladder, Text colors, Gain/Warning/Breaking status
  mapping, Gold primary-action accent, AiAccent brand accent) and fonts (Space Grotesk + IBM Plex
  Sans, copied into `src/fonts/` with their OFL licenses). `npx tsc --noEmit` clean after. Repo
  folder name and internal paths (`RELAY_PATH`, etc.) deliberately left as `cnc-harness` - see
  PLAN.md's new naming note.
- 2026-09-09 - Packaging plan built through item 1 (PLAN_PACKAGING.md §2.1; scope ledger
  DEEPSEEK-1/GLM-1). `src-tauri/src/lib.rs` rewritten: the four-step runtime path-resolution chain
  (env var -> persisted JSON -> `resource_dir()` -> RELAY_PATH-only picker via
  `tauri-plugin-dialog`) replaces the old `CARGO_MANIFEST_DIR` compile-time path, gated behind a
  `cfg!(debug_assertions)` dev fallback that's compiled out of release builds entirely. Resolved
  `RELAY_PATH` now passed to the orchestrator via `Command::env`. Tested for real: env-var,
  persisted-path, and dev-fallback resolution all confirmed live; the picker step compiles but
  wasn't interactively exercised (headless sandbox).
- 2026-09-09 - Packaging plan built through items 2-5 (PLAN_PACKAGING.md §2.2-§2.4, §3/§3.1; scope
  ledger DEEPSEEK-2/GLM-2 Windows, GLM-3 Linux, GEMINI-2 CI, GEMINI-3 mobile-scope-cut docs).
  `package.json`: `package:orchestrator` (esbuild-bundles the orchestrator + `ws` into one
  self-contained file, copies `seats.json` alongside) - verified standalone with zero
  `node_modules`. `scripts/fetch-node-runtime.sh`: pinned, SHA-256-verified Node 22.23.2 fetch for
  linux-x64/win-x64 - run for real for linux-x64. `tauri.conf.json`/`tauri.linux.conf.json`/
  `tauri.windows.conf.json`: `bundle.targets` narrowed to `["nsis","appimage"]`, per-platform
  resource mappings, `beforeBuildCommand` extended. `docs/signing-decision.md`,
  `docs/linux-packaging-decision.md`, `.github/workflows/release.yml` (tag-triggered, both
  platforms, installs `libfuse2` explicitly for Linux CI), `README.md`'s new "Platform support"
  section. A real release build + AppImage bundling attempt reached the actual `linuxdeploy` step
  before hitting a sandbox-only missing-`libfuse.so.2` blocker (not reproducible on GitHub's
  runners, which the CI workflow now guards against anyway); Windows NSIS untested locally (no
  Windows machine here). Full verified-vs-not detail in DECISIONS.md.
- 2026-09-09 - Onboarding/setup panel. `src-tauri/src/lib.rs`: `PROVIDER_ENV_VARS` const (mirrors
  `providers.js`'s envVar field), `list_api_key_providers`/`set_api_key`/`check_claude_cli`/
  `restart_orchestrator` Tauri commands, keys persisted to `<app_config_dir>/api-keys.json` and
  passed to the orchestrator child as env vars on spawn. `index.html`/`src/main.ts`/
  `src/styles.css`: an always-visible "Setup" button + panel (CLI check row, a provider-keyed list
  with masked inputs and set/not-set badges, a restart-orchestrator control). `cargo check`
  (isolated target dir) and `npx tsc --noEmit` both clean; live panel interaction not exercised
  (port contention with a concurrent session's dev server) - see DECISIONS.md.
- 2026-09-09 - Fulfillment mails/runbook (`docs/fulfillment-mails.md`,
  `docs/manual-fulfillment-runbook.md`), trademark-safe Stripe product copy
  (`docs/stripe-product-copy.md`), and Sophi-A's Stripe success page (`sower-industries`'s
  `src/pages/[lang]/sophi-a/next.astro`, `npm run build` confirmed it renders correctly).
- 2026-09-09 - `src/mcp/server.js`: MCP introspection over the orchestrator's existing WebSocket
  (`list_seats`, `get_seat`, `start_seat`, `stop_seat`, `configure_seat`, `wait_for_idle`),
  discovering the running orchestrator via a new well-known port file
  (`src/orchestrator/index.js` now writes `os.tmpdir()/sophia-orchestrator-port` alongside its
  `PORT:<n>` stdout line). Tested for real with an actual MCP client against a standalone
  orchestrator - found and fixed a real race in `wait_for_idle` (see DECISIONS.md), re-verified
  fixed with three consecutive passing runs including a real Anthropic API round trip.
- 2026-09-09 - Parallel-build-and-compare item 1 (PLAN_PARALLEL_BUILD.md §3; scope ledger
  GLM-1/DEEPSEEK-2). `src/orchestrator/index.js`: `BUILDER_SEAT_IDS`, `startMany()` (backend-
  enforced confirmed-guard), new `start_many` WS command. `index.html`/`src/main.ts`/
  `src/styles.css`: build-1's compare-trigger checkbox row, `#cost-confirm-modal`, non-sticky
  reset on confirm/cancel, single-builder path untouched. Tested for real against a standalone
  orchestrator (rejection paths + a real 2-builder `claude` CLI dispatch) - see DECISIONS.md for
  the full trace, including a logged deviation from the plan's literal "Tauri command" wording
  (implemented as a WS command instead, matching how every other seat command already works) and
  an incidental finding about `.workdirs/build-N` being shared across orchestrator instances.
- 2026-09-09 - Parallel-build-and-compare item 2 (PLAN_PARALLEL_BUILD.md §4; scope ledger
  DEEPSEEK-3/QWEN-2). New `src/orchestrator/compareSnapshot.js`
  (`writeCompareSnapshot`/`readCompareSnapshot`), wired into `startMany()` for real multi-seat
  runs only. Tested for real (pre-existing file, never-run-before workdir, single-seat-writes-
  nothing) - see DECISIONS.md. Also fixed a real gap found along the way: `.workdirs/` was
  untracked-and-unignored in git; added to `.gitignore`.
- 2026-09-09 - Parallel-build-and-compare item 3 (PLAN_PARALLEL_BUILD.md §4; scope ledger
  GLM-2). `compareSnapshot.js` extended to preserve real file content, not just hashes
  (`.compare-snapshot/`); new `changedSinceSnapshot`/`diffAgainstSnapshot`/`currentFileHash`.
  `index.js`: `compareGroups` tracking, `inspect_changes`/`get_diff` WS commands (request/
  response, not broadcast). `index.html`/`src/main.ts`/`src/styles.css`: an "Inspect changes"
  toggle on every builder tile, a file list with status + cross-builder badges, a click-to-diff
  pane. Added the `diff` npm package. Tested for real - see DECISIONS.md. Builder-vs-builder
  direct diff render cut per the plan's own explicit allowance; same/differs badges unaffected.
- 2026-09-09 - Parallel-build-and-compare item 4 (PLAN_PARALLEL_BUILD.md §5; scope ledger
  GLM-3/DEEPSEEK-3/QWEN-3). `index.js`: `select_winner`/`delete_workdir` (both require
  server-enforced `humanClick:true`), `list_compare_runs`, run records at
  `.workdirs/.compare/<taskId>.json`. `index.html`/`src/main.ts`/`src/styles.css`: Winner/
  Retained badges, a Pick/Delete row per builder tile, a global Run History panel. Tested for
  real end to end (dispatch -> differing output -> pick -> history record -> delete the
  non-winner, winner untouched). All 5 build-order items for parallel-build-and-compare done.
- 2026-09-09 - Parallel-build-and-compare item 5 (PLAN_PARALLEL_BUILD.md §6; scope ledger
  GLM-3). `messagesApi.js`: `ADVISOR_COMPARE_SYSTEM`, optional `mode` param on
  `startMessagesApiSeat`. `index.js`: `handleAdvisorRecommend` (bypasses the normal seat dispatch
  table on purpose - a one-off aside, not a generic command), new `advisor_recommend` WS command.
  `index.html`/`src/main.ts`: an "Ask advisor" button per builder tile. Found and fixed two real
  bugs by testing against the live API: a genuine `claude-fable-5-1` refusal triggered by the
  words "opinion"/"view" in the system prompt (reworded, confirmed fixed), and a too-sparse
  per-file summary that made advisor correctly decline to guess (fixed with a content preview +
  the original task text). Verified with a task that has a real correct answer - advisor picked
  correctly, twice. All 5 build-order items for parallel-build-and-compare are now complete.
- 2026-09-09 - "Surface the debate" (docs/market-positioning.md's headline feature idea).
  `relayChainSubprocess.js` emits a new `debate.report` event (signoff/scoreboard/failures,
  straight from relay's own `report.json`) the moment a plan-N run finishes, win or lose.
  `index.html`/`src/main.ts`/`src/styles.css`: a "Debate" toggle per `plan-N` tile, a per-seat
  cache so the panel renders correctly even if it was closed when the event arrived. Tested for
  real against relay's free mock chains (no API cost) - confirmed the real report.json signoff
  shape renders correctly.
- 2026-09-09 - Cost transparency (docs/market-positioning.md's feature idea #3, the last item
  of "build all of it, in that order"). `src/orchestrator/costEstimate.js` (new file) runs
  relay's own real `node src/cli.js --chain <chain> --dry-run` and parses its stdout - no
  reimplementation of relay's pricing math. `src/orchestrator/index.js`: new `estimate_cost` WS
  request/response command, restricted to seats with a `default_chain` (plan-1..3).
  `index.html`/`src/main.ts`/`src/styles.css`: a "Cost" toggle next to Debate on each `plan-N`
  tile, fetched once per seat per session and cached. Verified the parser byte-for-byte against
  relay's real `plan-cheap` CLI output ($1.75/run, 11 rows) and the full WS round-trip against a
  standalone orchestrator instance. See DECISIONS.md for full detail.
- 2026-09-09 - Security hardening (`docs/security-prompt-injection.md`). `index.js`: `AUTH_TOKEN`
  (random per-launch, `randomBytes(32)`) + `ALLOWED_ORIGINS` gate every WS connection before any
  `cmd` is dispatched; `broadcast` only sends to authenticated clients; port/token files in
  `tmpdir()` now mode `0o600`; `sensitivePathsSweep` hashes `CLAUDE.md`/`.claude`/`.mcp.json`
  per builder workdir across turns and emits a `seat.output` warning on change;
  `handleAdvisorRecommend` wraps builder/operator text in `<builder trust="...">`/
  `<operator-task trust="...">` tags with quote/whitespace escaping; `configureSeat` calls the
  new `clearHistory` (messagesApi.js) on a provider swap. `lib.rs`: `get_orchestrator_token`
  command, token read from the child's `TOKEN:` stdout line alongside the existing `PORT:` line.
  `main.ts`: sends `{cmd:'auth', token}` as the first frame on every connect, before anything
  else. `src/mcp/server.js`: reads the token file and auths the same way. Also rendered
  `debate.report`'s scoreboard data (per-lab accepted/proposed bar), which reached the event
  type earlier but was never actually drawn, and truncated/hover-expandable failure text in the
  same panel (critic text is third-party speech, not product copy). Verified: `npx tsc --noEmit`
  and `cargo check` both clean; no live-window run this pass (same port-1420 constraint noted
  elsewhere in this file for concurrent-session UI work) - token/handshake path hand-verified
  end to end across all four files instead.
- 2026-09-10 - Council seal wired into the live Debate panel. index.html: a shared <defs> block
  (one `council-orb` gradient, referenced by url(#...) from three per-tile instances instead of
  tripling the markup) plus a trimmed `.council-seal` inline SVG per plan-N tile - five ring
  wedges, each with `data-provider` set to relay's own signoff provider string. src/main.ts:
  renderDebatePanel resets all wedges on every render, then for each report.signoff entry adds
  debate-signed-off/debate-objected/debate-abstained to the matching wedge via
  `.seat[data-provider="${CSS.escape(s.provider)}"]` (CSS.escape since the value reaches a
  template-built selector, even though it's controlled config data, not user/model text).
  src/styles.css: the three state classes (signed-off bright, objected dimmed near-invisible,
  abstained dashed) per brand/HIGH_COUNCIL.md's documented "lit = signed off, dimmed = objected"
  rule. Verified for real: loaded a running dev build in Chrome, injected each of the three
  states via the console, screenshotted and confirmed the wedges actually change - not a
  code-reading check.
- 2026-09-10 - Council sigil legibility fix. brand/council-seal.svg and the three in-app
  `.council-seal` copies in index.html: sigil stroke-width raised from ~2.5-3 to 10-12 units,
  shape radii scaled ~1.5x, so they render at ~1.9px (not <0.5px) at the 80x80 size the Debate
  panel actually uses. Found via a real protanopia/deuteranopia/tritanopia simulation over the
  five seat hues (pairwise sRGB distance) plus an 80px render-and-upscale check - both documented
  with real numbers in brand/HIGH_COUNCIL.md. Second near-identical hue pair found (Cohere/Llama)
  beyond the already-known Qwen/Gemini one. Verified in a running dev build in Chrome.
- 2026-09-10 - Safe markdown + syntax highlighting for seat output. New
  `src/seatOutputRender.ts` (`renderSeatOutput`): marked -> DOMPurify (ALLOWED_TAGS/ALLOWED_ATTR
  allowlist, an `afterSanitizeAttributes` hook restricting `<a href>` to http(s)/mailto and
  forcing target/rel/title) -> innerHTML, then `highlight.js/lib/core` with ~10 explicitly
  registered languages (js/ts/python/rust/bash/json/yaml/css/html/markdown, not the full
  1MB-plus default language set). `src/main.ts`'s `setOutput` now calls this instead of
  `output.textContent = text` - the single call site every `seat.output`/`seat.idle`/
  `seat.problem` event already funneled through, per PLAN.md's status/event model.
  `src/styles.css`: markdown element styles (headings/lists/code/tables/blockquote) plus a small
  hand-mapped set of `.hljs-*` token colors keyed to the existing palette, not an imported theme
  file. `echoTask` (the operator's own text, not model output) deliberately left on
  `textContent` - no reason to markdown-render your own typed task. Verified live in a running
  dev build: real `<script>`/`onerror`/`javascript:` payloads all neutralized (window-global
  side-channel check), safe content (headings/bold/lists/fenced code in two languages/links)
  all rendered correctly, `npx tsc --noEmit` and `vite build` both clean.
- 2026-09-10 - Three features: forward-deliverable (plan-N -> build-N with the S2 forward rule's
  full three-part treatment - see PROGRESS.md for detail), src/seatNotify.ts (native OS
  notifications on working->idle/problem, tauri-plugin-notification), and a Cmd/Ctrl+K command
  palette (src/main.ts's setupCommandPalette, token-AND seat search, single-seat dispatch). New
  files: src/seatNotify.ts. New orchestrator exports: forwardDeliverable, PLANNER_SEAT_IDS,
  lastDeliverable cache. New Rust plugin: tauri-plugin-notification +
  notification:default capability. All three verified live (real WS validation-path tests against
  the running orchestrator; real browser interaction tests for the palette and forward UI), not
  just typechecked.
- adc6c0d — Phase 1 Step 1 — preflight.js + seats.json requires field (long-horizon build plan)
- 68816f7 — Phase 1 Step 2 — wizard panel + preflight WS command + Send-button readiness gating
- 2f297e2 — Phase 3 Step 1 — run-recorder.js: copy report.json/run.log to runs/<seatId>/<runId>/, evict past 50
- 2f297e2 — Phase 3 Step 2 — list_runs/replay_run/get_seat_logs (index.js + mcp/server.js) and main.ts's read-only history-dropdown replay of the Debate panel with a REPLAY banner
- e30b25e — Phase 3 Step 3 — chain presets (plan-fast/plan-thorough dropdown on plan-1..3, backed by relay commit abc101d)
- e30b25e — Phase 3 Step 4 — seat keyboard shortcuts (Ctrl+1..8 focus, Enter sends, Esc stops)
- 2026-09-10 - Phase 2 Step 3, export a run as markdown. New `src/exportMarkdown.ts`: pure,
  DOM-free `buildSeatMarkdown`/`buildDebateMarkdown`/`applyExportTruncation`/`exportFilename` -
  a plain seat's export reuses the exact source text already fed to `renderSeatOutput`
  (`seatOutputRender.ts`), never a re-serialization of the sanitized DOM; a planner seat's Debate
  panel export maps the plan's "grade + objections, revision rounds, final verdict" wording onto
  the real fields this app has (`signoff`/`failures`/`scoreboard` - see DECISIONS.md's entry for
  why, and for what was deliberately not invented to match the plan's literal wording). `src/
  main.ts`: a "Copy as Markdown"/"Export" row injected next to every seat's output pane and
  inside each planner seat's Debate panel (`setupSeatExportControls`), plus a header "Recent
  exports" toggle/panel (`setupExportsPanel`) that lists and reopens files via two new Rust
  commands. `src-tauri/src/lib.rs`: `export_run_markdown` (writes to `<app_data_dir>/exports/`,
  filename sanitized to its bare file-name component, a native `dialog().message()` confirmation
  after a successful write), `list_recent_exports` (newest-30, by mtime), `read_export_file`
  (canonicalized-path containment check - refuses anything outside the exports dir). `index.html`/
  `src/styles.css`: the export-row controls and the exports panel's reopen preview. New
  `scripts/verify-phase2-step3.mjs` - the acceptance test, exercising the real shipped module via
  an esbuild-compiled temp import (same pattern `package.json`'s `package:orchestrator` script
  uses), 5/5 checks passing: every `DebateReportDetail` field present verbatim in the export, an
  honest empty state when no run has finished, byte-exact disk round-trip, a visible `TRUNCATED`
  marker on an oversized export, no truncation on a normal one. Also verified: real `npx tsc
  --noEmit`, `vite build`, and `cargo check` in `src-tauri`, all clean.
- 8f6f550 — Phase 2 Step 3 — export a run as markdown (long-horizon build plan)
- c8bd59f — Phase 1 Step 3 — smoke run button on cnc/advisor, readiness-gated, never auto-clicked
- 064b0cb — Backlog item 2 (relay run 2026-09-10T23-20-49-005Z) — first-run Council discoverability explainer, shown once, persisted via wizard-state.json
- 2020e10 — Phase 2 Step 2 — cost-tracker.js + pricing.json + usage hooks in all three adapters + header ticker (long-horizon build plan)
- 58f4de4 — Phase 2 Step 1 — Stop-All + per-seat watchdog (long-horizon build plan)
