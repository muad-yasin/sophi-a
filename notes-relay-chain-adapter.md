# Notes - relayChainSubprocess.js (relay-chain-subprocess seat adapter)

## What this is

`src/orchestrator/adapters/relayChainSubprocess.js` implements `startRelayChainSeat(seatId,
seatConfig, task, emit)` for the `relay-chain-subprocess` invocation mode used by seats `plan-1`,
`plan-2`, `plan-3` (PLAN.md "Seat invocation mechanism" > "relay-chain-subprocess seats"). It:

1. Writes `task` to `<relayPath>/tasks/cnc-harness-<seatId>-<Date.now()>.md`.
2. Snapshots `<relayPath>/runs/` before spawning, then spawns
   `node <relayPath>/src/cli.js --chain <seatConfig.default_chain> --task tasks/cnc-harness-<seatId>-<ts>.md`
   detached, `cwd: relayPath`, stdout/stderr to a side log file
   (`<relayPath>/cnc-harness-<seatId>-<ts>.log`) - same shape as relay's own
   `src/mcp/server.js` `start_run` tool.
3. Polls `runs/` every 250ms (up to ~5s) to discover the new run folder by diffing against the
   snapshot, exactly as `start_run` does.
4. Polls that run folder every 3s: any new lines appended to `run.log` since the last poll are
   each surfaced as `seat.working` then `seat.output(line)`.
5. When `report.json` appears: `passed: true` -> `seat.idle(deliverable.md contents)`;
   `passed: false` -> `seat.problem(<lab: problem> list built from report.json.lastCritique.failures)`.
6. `seat.problem` also fires if the relay process exits nonzero before `report.json` appears, or
   if 600s pass with no `report.json`.

`RELAY_PATH` resolves the same way as intended for the other adapters: `process.env.RELAY_PATH`,
else `<cnc-harness root>/../relay`. `root` is imported from `../index.js` but resolved lazily
(inside the exported function, not at module top-level) because `index.js` and this adapter
import each other; using it only at call time avoids relying on an ES-module live binding before
`index.js` has finished assigning it.

## Testing performed (real relay runs, real API cost)

`src/orchestrator/index.js` also imports `claudeCodeSubprocess.js` and `messagesApi.js`, which do
not exist yet (someone else's slice of the build). To load `index.js`'s `root` export in
isolation I temporarily created no-op stub files for those two adapters, wrote a standalone test
script (`/tmp/test-relay-adapter.mjs`, outside both repos) that imported `startRelayChainSeat`
directly and called it with a trivial task, then deleted both stubs and the test script once
testing was done. `src/orchestrator/adapters/` now contains only `relayChainSubprocess.js`.

Three real invocations, chain `seven-cheap` (relay's own cheap all-labs-but-OpenAI chain -
`chains/verify.json`/`chains/cheap.json` need an OpenAI key, which this `.env` doesn't have; the
production default `plan-cheap` costs ~$1.75 worst-case and shares the same critic roster as
`seven-cheap`, so `seven-cheap` (~$0.22 worst-case) was the cheaper stand-in):

1. First attempt used chain `cheap` (needs OpenAI key, missing) - failed instantly with relay's own
   "Missing API keys for: openai" message, exit code 1, before any run folder existed. Cost: $0.
   This is what surfaced the missing-key issue and confirmed the "process exits nonzero before the
   run folder appears" path.
2. Second attempt, chain `seven-cheap`, task "propose a coffee mug coaster name": `seat.start`
   fired immediately; `seat.working`/`seat.output` streamed live as `run.log` grew (criteria,
   build, two critique/revise rounds all visible in real time); the run then crashed at round 3's
   critique with an HTTP 400 from Cohere (`command-r7b-12-2024` caps output at 4096 tokens, but
   `chains/seven-cheap.json` - and the *production* `chains/plan-cheap.json` - request
   `maxTokens: 20000` for that critic seat). The adapter correctly emitted `seat.problem` with
   `"relay-chain-subprocess seat plan-1: relay process exited with code 1 before report.json
   appeared (run ...)"`. This is a real bug in relay's own chain configs, not in this adapter -
   **plan-1/2/3's actual default chain (`plan-cheap`) will hit the same crash if a run reaches
   round 3's Cohere critic**, worth fixing in relay separately (out of scope here; relay was not
   modified). Cost: ~$0.003 (5 stages before the crash).
3. Third attempt, chain `seven-cheap` again, task reworded to be unambiguous and easy to satisfy
   in round 1: full happy path confirmed end to end - `seat.start`, live `seat.working`/
   `seat.output` through the criteria and build stages, then `critique-1` returned "MEETS - All
   acceptance criteria are met", the run stopped early (never reaching the buggy Cohere critic),
   `report.json` had `passed: true`, and the adapter emitted `seat.idle` with the real
   `deliverable.md` content ("Ring Guard" - a coaster name proposal). Cost: $0.0020.

Total real API cost incurred across all three runs: **~$0.0051** (about half a cent).

## Judgment calls

- Emitted `seat.working` immediately before each `seat.output` for a new log line, per the task
  spec's literal wording ("for every new line ... emit('seat.working') then
  emit('seat.output', thatLine)"), rather than one `seat.working` per poll cycle.
- `seat.problem`'s detail for `passed: false` is built from `report.json.lastCritique.failures`
  (`lab: problem` joined by `; `), falling back to a generic message if that array is empty/absent.
- Did not `unref()` before attaching the child's `exit` listener - `unref()` only affects whether
  the child keeps the Node event loop alive on its own, not whether listeners still fire while the
  parent (the orchestrator, a long-running WebSocket server) is running.
- Left the real `runs/<timestamp>/` folders, `tasks/cnc-harness-plan-1-*.md` files, and
  `cnc-harness-plan-1-*.log` side-log files this testing created under `relay/` in place rather
  than deleting them - they are legitimate relay run history/output (the same shape relay's own
  tooling leaves behind), not adapter artifacts, and deleting another repo's real run records
  didn't seem right given the "do not modify relay" instruction.
