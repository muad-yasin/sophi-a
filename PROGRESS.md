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
