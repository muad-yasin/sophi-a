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
