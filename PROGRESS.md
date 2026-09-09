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
