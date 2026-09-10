# Phase 0 stack-truth report

Generated: 2026-09-10T20:33:15.402Z

- VERIFIED - core files exist - src/main.ts, src/orchestrator/index.js, src/orchestrator/seats.json, src-tauri/src/lib.rs, src/mcp/server.js
- VERIFIED - adapters directory exists
- VERIFIED - seats.json has 8 seats with command/args/cwd or provider-based config - seats: cnc, advisor, plan-1, plan-2, plan-3, build-1, build-2, build-3
- VERIFIED - each adapter file exports a start*Seat function (corrected from "spawn") - claudeCodeSubprocess.js:startClaudeCodeSeat, messagesApi.js:startMessagesApiSeat, relayChainSubprocess.js:startRelayChainSeat
- VERIFIED - relay/chains/plan-cheap.json exists with seats.critics (corrected from "stages array") - 5 critics
- VERIFIED - report.json has signoff (top-level) and usage under totals/stages (corrected) - sampled 2026-09-10T20-09-44-541Z/report.json
- VERIFIED - src/mcp/server.js exports the six required tools - list_seats, get_seat, start_seat, stop_seat, configure_seat, wait_for_idle

## Corrections made during this script's own authoring (not left to fail on day one)

- Adapters export `start<Name>Seat`, not a generic `spawn` (the plan's original wording).
- `relay/chains/plan-cheap.json` has no top-level `stages` array; critics live at `seats.critics`.
- `report.json` has no top-level `usage` field; usage is per-stage (`stages[].usage`) and
  aggregated in `totals`. **Phase 2 Step 2 (cost meter) must read `report.totals` /
  `report.stages[].usage`, not `report.usage`** - flagging this now so that step doesn't
  rediscover it the hard way.

## HUMAN STOP — DO NOT PROCEED

Phase 1 may not begin until a human reviews the corrections above and appends the literal
line `APPROVED-BY-HUMAN` below this section.

APPROVED-BY-HUMAN
