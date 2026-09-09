# Progress

- 2026-09-09 - Build phase started (session-direct, not delegated to a fresh top-level agent; see
  DECISIONS.md for why).
- 2026-09-09 - Step 1 (repo scaffold + RELAY_PATH wiring) complete: Tauri v2 vanilla-TypeScript app
  scaffolded in place via `npm create tauri-app@latest`, product name/window title set, `npm install`
  clean, `.env.example` documents `RELAY_PATH` (defaults to `../relay`).
- 2026-09-09 - Step 2 (orchestrator core + seats.json) complete: `src/orchestrator/index.js` owns
  the WebSocket sidecar (ephemeral port printed as `PORT:<n>`), the seat registry, and dispatches
  to per-invocation-mode adapters.
- 2026-09-09 - Step 3 (event bus) complete, folded into index.js/adapters: the five-event
  vocabulary (`seat.start/working/output/idle/problem`) is implemented and tested for real in all
  three adapters below.
- 2026-09-09 - Step 4 (seat adapters, all three kinds) complete and tested end-to-end with real
  calls:
  - `claudeCodeSubprocess.js` (cnc, build-1..3) - real `claude -p ... --output-format stream-json`
    calls, `--resume` continuity verified across two turns (recalled a number given in turn 1).
  - `messagesApi.js` (advisor) - real Anthropic call via relay's `src/providers.js`, confirmed
    `claude-fable-5-1` is accepted as a real model id (not just a placeholder).
  - `relayChainSubprocess.js` (plan-1..3) - real relay chain runs (`seven-cheap`, ~$0.005 total)
    exercising both the `seat.problem` and `seat.idle` paths; found and documented a real bug in
    relay's own `chains/plan-cheap.json`/`seven-cheap.json` (Cohere's `command-r7b-12-2024` caps
    output at 4096 tokens, chain requests 20000 - crashes round 3) - not fixed here, relay was not
    modified, see `notes-relay-chain-adapter.md`.
- 2026-09-09 - Step 5 (Tauri shell) complete: `index.html`/`src/styles.css`/`src/main.ts` rewritten
  per PLAN.md's "Desktop shell and UI" - CSS grid 3x3, collapsible advisor strip, glow-ring tiles
  with a text status badge (color is never the sole carrier of status), connecting/connection-lost
  states, WebSocket client with retry/backoff. Design passes via `sower-frontend:ux-design` and
  `sower-frontend:visual-craft` skills (full states list, dark neutral surface ladder, restrained
  finite-pulse on the problem state only). `npx tsc --noEmit` clean.
- 2026-09-09 - Step 6 (bridge wiring) complete: `src-tauri/src/lib.rs` spawns the orchestrator as a
  plain child process (not Tauri's externalBin/sidecar mechanism - see DECISIONS.md), captures its
  `PORT:<n>` stdout line, exposes it via the `get_orchestrator_port` command, kills the child on
  app exit. `cargo check` clean.
- 2026-09-09 - Step 7 (integration test) complete: `npm run tauri dev` compiled clean (491 crates,
  5m20s first build) and is running for real. Verified: the Rust bridge spawned the orchestrator
  child process, which bound its ephemeral WebSocket port and was captured via `get_orchestrator_
  port`; connecting a client directly confirms the on-connect replay sends `seat.idle` for all
  eight seats in order (cnc, advisor, plan-1..3, build-1..3) - matching the frontend's green-tile
  rendering path exactly. This is the acceptance bar HANDOFF.md names for slice 1. Left running.
- 2026-09-09 - Monetization initiative started: three research agents audited cnc-harness's real
  gap to sellable, sower-industries' reusable payment/legal infra, and indie dev-tool pricing;
  findings and decisions recorded in DECISIONS.md. Biggest finding: no UI path anywhere calls
  `startSeat` today - the whole app is read-only tiles. Author decisions since: Stripe (not
  Gumroad/LemonSqueezy) despite the VAT/OSS trade-off, `cnc`/`advisor` made provider-selectable
  (any of relay's supported providers except xai/Grok, by policy), and the project is to be open
  source. `cnc`/`advisor` provider-selection backend shipped and tested for real (see BUILT.md).
  Next: the task-input UI (still missing entirely), a provider picker, product naming/visual
  identity, and an OSS license choice - all in progress.
- 2026-09-09 - Task-input UI + cnc/advisor provider picker shipped (PLAN.md "Desktop shell and
  UI" / "Addendum (2026-09-09, second)"): every one of the 8 tiles (index.html/src/main.ts/
  src/styles.css) now has a task textarea + Send + Stop, wired to the existing WebSocket protocol
  (`{cmd:'start'|'stop', seatId, task}`); Send/task-input disable while a seat is "working", Stop
  only enables then; submitting echoes "> task text" into the tile's output slot. `cnc`/`advisor`
  additionally get a provider `<select>` (mirrors `src/orchestrator/providers.js`'s
  `ALLOWED_PROVIDERS`, xai excluded) plus a free-text model-id input, sending
  `{cmd:'configure', seatId, provider?, model?}`; `cnc` shows a "Chat only - no file access" badge
  whenever its provider isn't anthropic. `src/orchestrator/index.js` gained `cmd:'configure'`
  handling + `configureSeat()`, validating provider via `isAllowedProvider`, restricted to
  `cnc`/`advisor`, runtime-only (not persisted to `seats.json`). Tested for real: `npx tsc
  --noEmit` clean; a standalone protocol smoke test against a freshly spawned orchestrator
  confirmed `configure` rejects an unknown-for-this-purpose seat (`build-1`) and a disallowed
  provider (`xai`) with a server-side `console.error` and no crash, and accepts
  `advisor` -> `openai`/`gpt-4o-mini`, after which a `start` command correctly reached relay's real
  dispatch layer (failed only on the missing `OPENAI_API_KEY` in this environment, not on
  rejection). Then re-ran the identical configure+start sequence directly against the orchestrator
  sidecar spawned by a real, already-running `npm run tauri dev` process (its bound port confirmed
  via `ss -tlnp` against that specific PID) - same result, so the actual app's own running instance
  was exercised, not just a standalone copy. Could not capture a screenshot of the native window
  itself: ImageMagick's `import` failed to parse its own arguments in this sandbox and no other
  capture tool (Xvfb/wmctrl/xdotool/grim/gnome-screenshot) was present, so the visual render was
  not directly observed - only the protocol and process behavior driving it were.
- 2026-09-09 - Product named "Sophi-A"; visual identity ported from an existing Sower Industries
  property, SMO (both Muad's direct call in chat, confirmed rather than assumed after finding
  `~/Projects/SMO/SMO/Docs/Sophi-A.md` describes a real, shipped in-game AGI narrative arc of the
  same name - a deliberate cross-property choice, not the naming mix-up from earlier this session).
  Product-facing surfaces renamed (tauri.conf.json, package.json, index.html, README.md); repo
  folder/internal paths deliberately left as `cnc-harness`. `src/styles.css` rebuilt against SMO's
  actual design system (`ScreenBuilderUtils.cs`): real surface ladder, text colors, and a Gain/
  Warning/Breaking status mapping replacing the old placeholder green/amber/red; Space Grotesk +
  IBM Plex Sans fonts copied in with their OFL licenses. Full reasoning in DECISIONS.md.
  Also ran: a real relay `plan-debate` chain (task `sophi-a-packaging-plan.md`, run id
  `2026-09-09T02-29-54-628Z`, $0.34, unanimous sign-off round 1) producing a reviewed Windows/
  Linux/Android/iOS packaging plan - `PLAN_PACKAGING.md`/`HANDOFF_PACKAGING.md`/
  `BOARD_PACKAGING.md` now in the repo. Headline: Windows (NSIS, unsigned v1) then Linux
  (AppImage) for desktop; Android and iOS both explicitly out of scope for v1, each with its own
  independent reasoning (mobile sandboxes forbid the subprocess spawning this app's whole
  architecture depends on). Not yet built - `HANDOFF_PACKAGING.md` is the next session's starting
  point, item 1 being the `CARGO_MANIFEST_DIR` compile-time-path fix everything else depends on.
- 2026-09-09 - Asked "why not now" rather than waiting for a fresh session - correct call, no real
  blocker existed. Built `HANDOFF_PACKAGING.md` item 1 (PLAN_PACKAGING.md §2.1) same session: the
  runtime path-resolution chain replacing `CARGO_MANIFEST_DIR`, for the orchestrator entry, the
  Node binary, and `RELAY_PATH`. `cargo check` clean; `npm run tauri dev` re-verified working with
  no regressions (seat replay confirmed live over a real WebSocket connection, same as every prior
  check this session). Three of the resolver's four steps tested live (env var, persisted-path,
  dev fallback); the fourth (RELAY_PATH's first-run folder picker) is code-complete and compiles
  but wasn't interactively exercised - no display in this sandbox. Full detail, including a real
  packaging requirement the persisted-path test surfaced (bundled orchestrator resources need
  `node_modules`, not just source files), in DECISIONS.md. Next: item 2 (Windows NSIS) and item 3
  (Linux AppImage) per `HANDOFF_PACKAGING.md`'s order.
- 2026-09-09 - Noticed real concurrent activity in this same repo mid-session (another session's
  brand-identity work landed - `brand/BRAND.md`, regenerated icons - plus a live relay chain run
  and a live dev instance neither started by this session). Not disruptive, not reverted; logged
  in DECISIONS.md, and this session stopped killing `cnc-harness` processes freely once it noticed.
- 2026-09-09 - Built `HANDOFF_PACKAGING.md` items 2-4 (Windows NSIS config, Linux AppImage config,
  CI pipeline) plus item 5 (Android/iOS scope-cut doc, added to README.md). Orchestrator now
  bundles into one self-contained file via esbuild (verified standalone with zero `node_modules`);
  a pinned, SHA-256-verified Node 22.23.2 fetch script exists and was run for real for linux-x64.
  `tauri.conf.json` narrowed to exactly the two in-scope targets (nsis, appimage) with per-platform
  resource mappings. `docs/signing-decision.md`, `docs/linux-packaging-decision.md`, and
  `.github/workflows/release.yml` all written. A full local AppImage build got through a real
  release compile and into real bundling before hitting a sandbox-only blocker (missing
  `libfuse.so.2`, needs interactive `sudo` to fix, not available here) - the CI workflow installs
  it explicitly so this won't recur there. Windows NSIS was never attempted locally (no Windows
  machine/cross-toolchain in this sandbox) - CI is where it first actually runs, and no tag has
  been pushed yet. Full detail and what's verified vs. not in DECISIONS.md. Remaining before
  PLAN_PACKAGING.md's acceptance tests can actually be run: push a tag, watch the CI build succeed
  on real GitHub-hosted runners, then work through AT-1 through AT-8 on real clean VMs.
- 2026-09-09 - Fixed a real, live bug in relay (not just found this time - actually fixed, commit
  90f5e3a there): six chains' Cohere `command-r7b-12-2024` critic seats requested 20000 max
  tokens against a real 4096 cap, crashing mid-chain. A recent relay-side blanket "raise all
  critic maxTokens" commit had swept this seat up too without checking its real ceiling.
- 2026-09-09 - Pushed for real: `github.com/muad-yasin/sophi-a` (private), tagged `v0.1.0`. CI
  built both installers for real on GitHub's runners - first time either has ever existed as an
  actual file. Fixed a release-permissions bug (403, missing `contents: write`) and published the
  release by hand from the already-built artifacts. `v0.1.0`'s release page now has a real
  `Sophi-A_0.1.0_x64-setup.exe` and a real `Sophi-A_0.1.0_amd64.AppImage`.
- 2026-09-09 - Built the onboarding/first-run setup panel: a "Setup" button opens a panel with a
  `claude` CLI check and per-provider API key entry (10 providers, including `anthropic` - needed
  for `advisor`'s calls even in the fully-default config, not just the 9 alternates). Keys persist
  to their own local file and get passed to the orchestrator as env vars on (re)start; a Restart
  button applies a changed key without quitting the app. `tsc`/`cargo check` both clean; the full
  panel wasn't exercised live in the real running app (Vite's dev port was already held by a
  concurrent session using this same repo, and forcing past that risked disrupting it) - named as
  a real, undischarged gap in DECISIONS.md, not glossed over.
- 2026-09-09 - Tested the real `v0.1.0` release artifacts. **Linux AppImage: genuinely verified**
  end to end on a simulated clean machine (isolated config dir) - extracted the real artifact,
  ran it, confirmed both the orchestrator and Node runtime resolve from paths *inside the
  AppImage* (not dev fallbacks, not stale local state), watched the bundled orchestrator actually
  spawn and bind a real WebSocket port, and confirmed the real seat-replay protocol over it with
  a direct client. This is the closest approximation of AT-4 achievable without an actual clean
  VM, and it passed. **Windows NSIS under Wine: inconclusive** - Wine's own prefix bootstrap never
  finished in this sandbox after 8+ minutes, so the installer itself was never reached; killed and
  cleaned up. AT-1/AT-2/AT-3 still need a real Windows machine. Full trace in DECISIONS.md.
- 2026-09-09 - Fulfillment mails + runbook (`docs/fulfillment-mails.md`,
  `docs/manual-fulfillment-runbook.md`) and trademark-safe Stripe copy
  (`docs/stripe-product-copy.md`) written, closing three of `SHOP.md`'s open items. Named one real
  unresolved gap: the GitHub repo is private, so a buyer can't reach the release assets directly -
  author's call, not decided here. Sophi-A's Stripe success page also built
  (`sower-industries`'s `/en/sophi-a/next/`, `npm run build` confirmed it renders) - pointing the
  actual payment link at it is a dashboard action, not done here.
- 2026-09-09 - Built `src/mcp/server.js` - the MCP introspection named in CLAUDE.md's "what's
  next" since the very first build session, now real. Tested with an actual MCP client (not a
  hand-rolled approximation) against a real standalone orchestrator; found and fixed a genuine
  race in `wait_for_idle` along the way (it could report a just-started task as already finished
  if polled before the seat's own "working" event arrived) - re-verified fixed with three
  consecutive real runs. Full detail in DECISIONS.md.
- 2026-09-09 - Ran the last remaining item from the day's punch list through the real relay
  harness: parallel-build-and-compare, the feature PLAN.md had only ever named, never designed.
  `plan-debate` chain, run id `2026-09-09T10-20-19-041Z`, $0.32, unanimous round-1 sign-off.
  Result: `PLAN_PARALLEL_BUILD.md`/`HANDOFF_PARALLEL_BUILD.md`/`BOARD_PARALLEL_BUILD.md`. Headline
  decisions: a per-task (non-sticky) checkbox trigger fused with a pre-spend Nx-cost confirmation
  modal, a hash-manifest diff baseline (not git - workdirs aren't git repos), retain-in-place
  disposition for non-picked builders forever (unanimous board reversal of every auto-delete/
  archive-move proposal raised), and an explicit evaluation that rejected wiring in relay's
  `plan-1..3` panel-judging machinery (wrong shape for concurrent code-diff comparison) in favor
  of a human click plus an optional non-binding advisor recommendation. Not built yet.
- 2026-09-09 - Started building parallel-build-and-compare per `HANDOFF_PARALLEL_BUILD.md`. Item
  1 (fan-out dispatch + cost gate) done: build-1 gets a checkbox row + a custom confirmation
  modal naming the real Nx cost; a new `start_many` WebSocket command (not a Tauri command as the
  plan's literal text said - a deliberate, logged deviation, see DECISIONS.md) enforces the
  confirmed-guard server-side. Tested for real against a standalone orchestrator: rejection
  paths (unconfirmed multi-seat, non-builder seat) and the real dispatch path (two genuine
  `claude` CLI subprocesses spawned) all confirmed. Single-builder behavior confirmed unchanged.
  Next: item 2 (dispatch-time snapshot manifest).
- 2026-09-09 - Item 2 (snapshot manifest) done: `src/orchestrator/compareSnapshot.js` writes
  `.compare-snapshot.json` (path/mtime/sha256) into each participating workdir before a real
  multi-builder run starts, handling a builder that's never run before (no workdir on disk yet).
  Tested for real, including that empty-workdir case. Incidental find: `.workdirs/` was
  untracked-and-unignored in git - fixed (`.gitignore`), confirmed nothing from it was ever
  actually committed historically. Next: item 3 (comparison UI - file tree + diff viewer).
- 2026-09-09 - Item 3 (comparison UI) done: every builder tile gets an "Inspect changes" toggle
  showing changed files (added/modified/deleted) with same/differs/unique cross-builder badges,
  and click-to-diff rendering real unified-diff hunks. Extended item 2's snapshot to also
  preserve real file content (not just hashes) so actual diffs are possible - logged as a real,
  deliberate extension in DECISIONS.md. Cut the one thing the plan explicitly allows cutting
  (direct builder-vs-builder diff render) - same/differs badges still work without it. Tested for
  real: same-then-differs badge flip, a unique file, real diffs for both a modified and a new
  file, and a rejected path-traversal attempt. Next: item 4 (pick + disposition).
- 2026-09-09 - Item 4 (pick + disposition) done: "Pick this one" writes a run record naming the
  winner/task/participants; every other participating seat gets "Retained" and keeps a manual
  "Delete workdir" button; retain-in-place is otherwise permanent - nothing anywhere auto-deletes.
  Both mutating actions require a server-enforced `humanClick:true` flag, not just a UI courtesy.
  A compact "Run history" panel lists past picks. Tested for real end to end: dispatch, differing
  output, inspect, pick, history record, then delete the retained (non-winning) seat's workdir
  with the winner's left untouched. All 5 build-order items for parallel-build-and-compare are
  now done. Next: "surface the debate" (the market-positioning analysis's headline feature) and
  cost transparency.
- 2026-09-09 - Item 5 (advisor recommendation) done - **all 5 build-order items for parallel-
  build-and-compare are now complete.** An "Ask advisor" button gets a one-line, non-binding
  recommendation between builders in a comparison run. Two real bugs found and fixed by actually
  testing against the live API rather than trusting the design: (1) the words "opinion"/"view" in
  advisor's system prompt caused a genuine model refusal on this exact task shape - reworded to
  "recommendation," confirmed fixed against the real API; (2) the original per-file summary
  (status+path only) was too sparse to actually judge by - advisor itself flagged this
  ("identical summaries... coin flip") before the fix, which added a short content preview per
  file and the original task text to the prompt. Verified with a task that has a genuinely
  correct answer: advisor correctly picked the matching builder, twice in a row.
- 2026-09-09 - Built "surface the debate" - the market-positioning analysis's headline feature,
  built first (ahead of cost transparency). `plan-N` tiles get a "Debate" toggle showing relay's
  real per-lab signoff (✓/✗/?) and any recorded objections, sourced from `report.json`'s own
  structured data (previously flattened into a plain string, now a real `debate.report` event).
  Tested for real against relay's free `mock`/`mock-unanimous` chains - no API cost, confirmed
  the exact signoff shape a real paid chain produces. Next: cost transparency on the seat tile.
