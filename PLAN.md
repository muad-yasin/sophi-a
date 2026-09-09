# PLAN.md - cnc-harness slice 1 - the command-and-control shell, real seats, no installer

## Addendum (2026-09-09) - planning modules now run real relay chains

After this run finished (5/6 signed off, GLM dissenting on criterion 1), the author reviewed
GLM's objection, agreed with it, and made an explicit follow-up decision: the three planning
modules (`plan-1..3`) now each spawn a real relay chain run - not a raw single Messages API
call - genuinely reusing relay's CLI, not just `src/providers.js`. This is a deliberate, scoped
reversal of Assumption 3's "Anthropic-only" framing for `plan-1..3` specifically; `cnc`, `advisor`,
and `build-1..3` are unchanged and remain Claude Code/Sonnet 5/Fable 5.1 only. Every other
architectural decision in this plan stands unchanged. The two sections below (Assumptions,
Architecture) are revised in place; everything else in this document is identical to the version
five of six labs signed off.

## Status

Originally authorized 2026-09-08 by Muad as a one-night exception to FOCUS.md's then-stated order.

**Superseded 2026-09-09** - do not treat this as a bare claim; check it against
`/home/user/Projects/FOCUS.md` directly, which now reads (verbatim, "Why" section):

> "We build cool shit first. Revenue comes when we have built a few cool things on our website. We
> need 'scope creep' for a while... We need to utilize AI automation with cheap mass-thinking done
> by the harness, and heavily utilize Claude Code to code on 2-3 repos at the same time, and we
> want to run one repo as the C&C for having many videogames with the same intellectual property."

and its "Rules for any session or agent" section:

> "Before proposing work, check it is in the order above. If it is not, say so."

(no longer "say so and stop" - that wording was removed 2026-09-09, along with the prior "No new
projects. No new repos." line). FOCUS.md's own "Exception - 2026-09-08, one night only (closed)"
section states plainly that this broader direction "is now the standing direction, not a one-night
exception." cnc-harness is not named as a line item in FOCUS.md's numbered order, and a session
should still say so - but FOCUS.md itself, not this document, is the authority for that; read it
fresh rather than trusting this paragraph's summary of it.

## Assumptions (the eight defaulted answers this run took, one revised 2026-09-09)

1. Slice 1 lives in a new repository, `cnc-harness`, cloned adjacent to `relay/` on disk and
   depending on it via a `RELAY_PATH` environment variable rather than a published npm package or
   a submodule - relay is not packaged for npm yet, and this is the smallest thing that works today.
2. Every seat drives a real subprocess or a real API call; nothing in slice 1 is mocked.
3. **(Revised 2026-09-09.)** `cnc`, `advisor`, and `build-1..3` are Claude Code/Sonnet 5 or
   Fable 5.1 only. `plan-1..3` are a deliberate, scoped exception: each spawns a real relay
   planning-chain run, which internally uses relay's own existing multi-lab critic panel
   (DeepSeek, Qwen, GLM, Mistral, Gemini, Kimi K3 - the same six labs that graded this very run).
   This is the product's actual differentiator ("many models, not just Anthropic's") made real for
   its planning modules from slice 1, rather than deferred. It brings real consequences, named
   plainly rather than assumed away: relay's non-Anthropic provider keys (Together/DeepSeek,
   OpenRouter/Qwen-GLM-Mistral-Kimi, Google/Gemini) must be configured for `plan-1..3` to function;
   each planning-module invocation costs real cents (a `plan-cheap` run is ~$1.40 worst case, a
   clean early pass costs a fraction); and a planning-module "turn" takes minutes (a background
   multi-round chain run), not the seconds a single streamed API call would take.
4. The three-way parallel-build-and-compare feature is deferred past slice 1; each building module
   runs one single build path.
5. Tauri (v2) is slice 1's desktop shell, chosen because it keeps a mobile path open later without
   a frontend rewrite.
6. Each seat's glow state is reported by the orchestrator core's own event bus, never inferred by
   the UI parsing a raw session transcript.
7. Slice 1's deliverable is a locally-run, source-built demo; no packaged, signed, or
   store-distributed installer.
8. `cnc-harness` is a new repository, separate from relay, importing it as a dependency - not code
   bundled into the relay repo.

## Architecture

### Repository shape

New repo `cnc-harness/`, cloned adjacent to `relay/`. A `RELAY_PATH` environment variable
(default `../relay`) tells the orchestrator where relay lives. No published npm package or git
submodule for slice 1 - that packaging work is named, not designed, as a later hardening step.

### What "reuses relay's backend" means, precisely (revised 2026-09-09)

Slice 1 reuses two pieces of relay, split by seat role:

- **`advisor` (`messages-api`):** the Anthropic provider-call function in `src/providers.js`,
  imported directly, for a single stateless request/response call per intervention. Fable 5.1's
  job is fast oversight commentary, not producing a plan - relay's chain machinery would be the
  wrong tool here.
- **`plan-1..3` (`relay-chain-subprocess`, revised 2026-09-09):** relay's actual CLI
  (`src/cli.js`), spawned exactly the way relay's own MCP server's `start_run` tool does
  internally - a detached `node <RELAY_PATH>/src/cli.js --chain <chain> --task <path>` process,
  discovered by diffing `runs/` before and after, then polled. No MCP client library is embedded
  in cnc-harness for this; that would be an extra protocol layer for what is, underneath, a plain
  spawn-and-poll. This is genuine reuse of relay's CLI, not a description of it - the same code
  path this planning run's own MCP tools drove all night.

`cnc` and `build-1..3` still spawn the Claude Code CLI directly (see "Seat invocation mechanism"),
not through relay at all - relay has no code for that job. `chains/*.json` is now read by slice 1,
specifically by `plan-1..3`'s relay CLI invocations; relay's MCP server itself
(`src/mcp/server.js`) is still not invoked - the orchestrator replicates its `start_run`/`run_status`
spawn-and-poll logic directly rather than speaking MCP, since cnc-harness is not an MCP client.

### Orchestrator core

A Node.js process, `src/orchestrator/index.js`, that:
- Imports relay's `src/providers.js` provider-call function for the `advisor` seat, and spawns
  relay's CLI directly for `plan-1..3` (see above) - no parallel provider-calling code or a second
  chain-running engine is written.
- Owns the declarative seat registry `src/orchestrator/seats.json` (below) and exposes
  `startSeat(seatId)` / `stopSeat(seatId)` plus an EventEmitter interface.
- Tracks each seat's state in an in-memory `Map<seatId, status>` as an implementation detail behind
  the event bus - not a second source of truth.
- Runs as a Tauri sidecar, spawned by the Tauri Rust shell on app start with `--port 0`; it binds an
  ephemeral local WebSocket port on `127.0.0.1`, writes the chosen port to stdout, and the shell
  reads it before the frontend connects. This is the one port-discovery mechanism for the whole
  app, so a second concurrent launch never collides.

### Seat registry (the eight seats, revised 2026-09-09)

A single file, `src/orchestrator/seats.json`, read once by the orchestrator at startup; the UI
never touches it directly.

| seat id | role | model / chain | invocation mode | notes |
|---|---|---|---|---|
| `cnc` | Command & Control | `claude-sonnet-5` (placeholder identifier) | Claude Code subprocess, continued via `--resume` | center chat pane |
| `advisor` | Advisor | `claude-fable-5-1` (placeholder identifier) | direct Messages API call, stateless per intervention | fixed to Fable 5.1, no Sonnet fallback |
| `plan-1`, `plan-2`, `plan-3` | Planning modules | `default_chain: "plan-cheap"` (C&C may name a different chain per task) | **relay-chain-subprocess** (revised 2026-09-09) | left column; real multi-lab relay run per task |
| `build-1`, `build-2`, `build-3` | Building modules | `claude-sonnet-5` | Claude Code subprocess, continued via `--resume`, one working directory per builder | right column; single build path only |

Model strings are placeholders pending Anthropic's actual API identifiers at build time - the
registry makes correcting them a one-line edit per seat.

### Seat invocation mechanism

**`claude-code-subprocess` seats (`cnc`, `build-1..3`).** Each turn spawns:

```
claude -p "<the seat's task/message>" --output-format stream-json --verbose \
  [--resume <session_id>] [--add-dir <seat working directory>]
```

- First turn for a seat omits `--resume`. The orchestrator reads the initial `system`/`init` event
  from stdout (newline-delimited JSON, one object per line) and stores its `session_id`; every
  later turn for that seat passes `--resume <session_id>` to continue the same conversation.
- `build-1..3` additionally pass `--add-dir <path>`, one fixed working directory per builder
  (created once at `cnc-harness/.workdirs/build-1/` etc.) so file edits never collide.
- Event mapping: the initial `system`/`init` line -> `seat.start`; an `assistant` line with a
  `tool_use` block, or simply the first line after start -> `seat.working` (refreshed by a 30s
  stdout-activity heartbeat during long tool calls); an `assistant` line with a `text` block ->
  `seat.output` (detail = that text); a terminating `result` line with `is_error: false` ->
  `seat.idle`; a nonzero exit, a `result` line with `is_error: true`, or a 300s timeout ->
  `seat.problem`.

**`messages-api` seat (`advisor`).** A direct streaming call through relay's imported provider
function: firing the call -> `seat.start`; each streamed token/delta -> `seat.working` then
`seat.output`; stream completion -> `seat.idle`; a thrown error, an API error, or a 300s timeout ->
`seat.problem`.

**`relay-chain-subprocess` seats (`plan-1..3`, revised 2026-09-09).** When C&C assigns `plan-N` a
task: the orchestrator writes the task text to
`<RELAY_PATH>/tasks/cnc-harness-<seatId>-<unix-ms>.md` (relay's own task-file convention), then
spawns `node <RELAY_PATH>/src/cli.js --chain <chain> --task tasks/cnc-harness-<seatId>-<unix-ms>.md`
detached (`chain` defaults to `plan-cheap`; C&C may name a different one per task), and discovers
the new `<RELAY_PATH>/runs/<timestamp>/` folder by diffing that directory's listing before and
after spawn - the same discovery relay's own MCP server's `start_run` tool uses. It then polls that
run folder every few seconds. Event mapping: process spawned -> `seat.start`; every poll until
`report.json` appears -> `seat.working` (each new line appended to that run's `run.log` since the
last poll is also surfaced as a `seat.output`, so the tile shows live progress - stage names,
panel verdicts - not just a static "working"); `report.json` appearing with `passed: true` ->
`seat.idle`, `detail` = that run's `deliverable.md` content; `report.json` appearing with
`passed: false` (open objections, same shape this very run ended in), a nonzero exit, or a 600s
timeout (longer than the Claude-Code-subprocess default - a real multi-lab chain run takes minutes,
not seconds) -> `seat.problem`, `detail` = the unresolved objections, for the human operator to
read via the advisor pane or the C&C chat.

### Status/event model

The orchestrator emits exactly five typed events per seat over the sidecar's WebSocket, and the UI
consumes only this stream:

| event | fires when | payload |
|---|---|---|
| `seat.start` | the subprocess is spawned or the API call is fired | `{ seatId, timestamp }` |
| `seat.working` | per the invocation mechanism above; a 30s heartbeat (subprocess seats) or each new `run.log` line (relay-chain seats) keeps this truthful during long operations | `{ seatId, timestamp }` |
| `seat.output` | the seat produces text (the C&C and advisor panes render this; `plan-N` tiles show live chain progress) | `{ seatId, timestamp, detail: string }` |
| `seat.idle` | the response completes, the subprocess returns to its prompt, or the relay run reports `passed: true` | `{ seatId, timestamp }` |
| `seat.problem` | non-zero exit, API error, a timeout, or (for `plan-N`) `report.json` with `passed: false` | `{ seatId, timestamp, detail? }` |

The UI maps `seat.working` to orange/yellow, `seat.idle` to green, `seat.problem` to red; it never
reads a raw transcript.

### Bridge/IPC

The Tauri Rust shell spawns the orchestrator sidecar with `--port 0`, reads the ephemeral port it
writes to stdout, and the frontend connects to `ws://127.0.0.1:<that port>`. The shell kills the
sidecar on exit.

### Desktop shell and UI

A Tauri 2.x application, vanilla TypeScript frontend - no framework dependency beyond what Tauri
itself scaffolds, keeping the bundle small and the HANDOFF simple:
- CSS grid, 3 rows x 3 columns: the advisor pane spans top-center (collapsible, shows Fable's
  latest intervention with an accept/dismiss affordance for the human operator), the C&C chat pane
  sits center (largest), three planning-module tiles sit left, three building-module tiles sit
  right.
- Each tile shows the seat name, a glow ring (`#22c55e` idle green / `#eab308` working orange /
  `#ef4444` problem red) driven purely by the event bus, and the last `seat.output` line.
- Runs from source only: `npm install && npm run tauri dev`. No installer, code signing,
  auto-update, or store submission in slice 1.

### Commercial terms risk (settle before any paid release, not assumed)

A standalone section, not folded into the architecture so it cannot be silently dropped. At least
the following, each blocking commercial commitment until checked and given a "checked by / date":

1. Whether Anthropic's Commercial Terms of Service permit a paid product whose value-add is
   orchestrating Claude Code/API access the end user pays for separately - check the current
   Commercial Terms and the Claude Code subscription terms' resale/wrapping sections.
2. Whether the Claude Code subscription agreement permits driving Claude Code programmatically
   (subprocess/SDK) inside a third-party commercial application, or licenses interactive use only -
   check Claude Code's specific terms and any SDK license.
3. Whether there are branding/trademark constraints on naming Claude, Sonnet, or Fable in product UI
   and marketing - check Anthropic's brand guidelines.
4. Whether API usage through a wrapper requires disclosing Anthropic as a subprocessor to end
   users - check the Services Agreement.
5. **(Added 2026-09-09.)** Now that `plan-1..3` call DeepSeek, Qwen (via OpenRouter), GLM (via
   OpenRouter), Mistral (via OpenRouter), Gemini, and Kimi K3 (via OpenRouter), whether each of
   those providers' own terms permit this wrapper usage, and whether their involvement must be
   disclosed to end users alongside Anthropic's - check each provider's terms and OpenRouter's own
   terms for the three routed through it.

No commercial release until every item above is checked and resolved.

## Out of scope for slice 1 (named, not designed)

- Android and iOS builds - Tauri's mobile target is the intended later path; nothing mobile-specific
  is decided here.
- The three-way parallel-build-and-compare feature - deferred to a slice 2.
- Any packaged, signed, or store-distributed installer for Linux or Windows.
- Pricing, licensing terms, or a monetization mechanism for the product itself.

## Scope additions

| addition | author | reason |
|---|---|---|
| Commercial-terms risk register | this planning run (kimi's proposal, folded from three labs' parallel versions) | The request asked the risk be named with specifics, not left as "unverified"; a checkable register was the only way to satisfy that without inventing a legal answer. |
| Ephemeral-port sidecar handshake (`--port 0`, port written to stdout) | glm's C-5, seconded by deepseek/mistral/gemini/kimi | Not requested; added because every fixed-port design a lab first proposed would break a second concurrent app launch. |
| `RELAY_PATH` adjacent-clone dependency mechanism | deepseek's A-1 / qwen's B-1 | Not requested; added because relay has no published npm package today, so some concrete resolution mechanism was needed for slice 1 to actually import it. |
| Vanilla-TypeScript, no-framework frontend choice | kimi's F-3, over qwen's and gemini's React proposals | Not requested; added because two labs' React proposals were objected to on dependency-surface grounds and a concrete stack had to be picked for the shell to be buildable. |
| Full HANDOFF.md and BOARD.md text produced in round 1, rather than described for a later stage | added by reviser round 1 | Three critics correctly failed round 1 for describing these artifacts instead of producing them; criteria 11 and 13 require the artifacts to exist, not be planned. |
| Concrete Claude Code CLI invocation protocol (`-p`, `--output-format stream-json`, `--resume` for continuation, stream-json-to-event mapping) | added by reviser round 2 | Two critics correctly failed round 2 because "Claude Code subprocess" was a label, not a buildable mechanism; a fresh session cannot invent this and still meet the unsupervised-build bar. |
| `plan-1..3` reimplemented as real relay-chain subprocess runs, reversing Anthropic-only for those three seats | the author, 2026-09-09, resolving GLM's persistent round-1/2/3 objection on criterion 1 | GLM was right across all three rounds: reusing relay's backend "as its orchestration engine" should mean the CLI, not only `src/providers.js`. The honest way to do that for a planning seat is to run a real relay planning chain - relay's CLI has no other job. |

## Disputed

- Criterion 9 (kimi's round-1 failure): the three implementation-mechanism items listed above
  (ephemeral port, RELAY_PATH, vanilla-TypeScript) are proposal-derived content already recorded in
  the Scope ledger below, not builder-original additions - the build stage's own rules say accepted
  lab proposals are not "additions." Listed here anyway since the panel found their absence
  unclear, not because the objection's premise is accepted.
- **Criterion 3, as originally worded** ("Names every seat's model as Claude Code/Sonnet 5 or
  Fable 5.1 only, introducing no other provider dependency for slice 1") **is now intentionally
  violated for `plan-1..3` by design**, per the author's explicit 2026-09-09 decision recorded in
  the Addendum and Assumption 3 above - not an oversight. It continues to hold, unchanged, for
  `cnc`, `advisor`, and `build-1..3`.

## Build order (for HANDOFF.md)

1. Repo scaffold + `RELAY_PATH` wiring.
2. Orchestrator core + `seats.json`.
3. Event bus (five-event vocabulary) + ephemeral-port sidecar handshake.
4. Seat adapters: the Claude Code stream-json subprocess protocol for `cnc`/`build-1..3`; the
   direct Messages API call for `advisor`; the relay-CLI spawn-and-poll protocol for `plan-1..3`.
5. Tauri shell (vanilla TypeScript, CSS grid, glow tiles).
6. Bridge wiring (frontend connects to the sidecar's ephemeral port).
7. Integration test: stub seats, verify event sequences and glow rendering, including a stubbed
   `plan-N` run folder (a fake `report.json` dropped in after a delay) to test the poll-based path
   without spending real API cost.

## Format note

This document is the PLAN.md-shaped deliverable. `BOARD.md` and `HANDOFF.md` are produced in full
alongside it.

## Scope ledger

- A-1 - accepted - merged with B-1 into "Repository shape" (adjacent-clone + RELAY_PATH mechanism).
- A-2 - accepted - merged into "Orchestrator core"/"Status/event model" (five-event vocabulary, in-memory Map).
- A-3 - accepted - merged into "Seat registry".
- A-4 - accepted - merged into "Desktop shell and UI" (vanilla-TypeScript Tauri shell).
- A-5 - accepted - merged into "Bridge/IPC" (ephemeral-port sidecar handshake).
- A-6 - accepted - merged into "HANDOFF artifact".
- B-1 - accepted - merged with A-1 into "Repository shape".
- B-2 - withdrawn - by qwen in favour of F-2.
- B-3 - withdrawn - by qwen in favour of F-1.
- B-4 - withdrawn - by qwen in favour of F-3.
- B-5 - withdrawn - by qwen in favour of F-5.
- B-6 - withdrawn - by qwen in favour of F-4.
- C-1 - accepted - "Orchestrator core" section (startSeat/stopSeat surface, in-memory status Map).
- C-2 - accepted - merged into "Seat registry" (advisor fixed to Fable 5.1, no Sonnet fallback).
- C-3 - accepted - merged into "Status/event model" (30s stdout-activity heartbeat for `seat.working`).
- C-4 - accepted - merged into "Desktop shell and UI" (glow color values, vanilla-TypeScript amendment).
- C-5 - accepted - the ephemeral-port sidecar handshake adopted into "Bridge/IPC" and "Orchestrator core".
- C-6 - withdrawn - by glm, split into F-5 (risk checks) and F-4 (HANDOFF.md) rather than one combined artifact.
- D-1 - cut - fully absorbed into F-2/C-3's event model once its corrupted How field was fixed; no distinct content remained.
- D-2 - cut - fully absorbed into F-2/C-5's WebSocket bridge; its message shape duplicates the already-adopted protocol.
- D-3 - withdrawn - by mistral in favour of F-1 (covered only two of eight seats).
- D-4 - accepted - merged into "Orchestrator core" (relay-as-library adapter framing).
- D-5 - withdrawn - by mistral in favour of F-3 (React unjustified for this scope).
- D-6 - withdrawn - by mistral in favour of F-5.
- E-1 - cut - conflicts with F-3/C-4's vanilla-TypeScript shell, which has broader support and a smaller dependency surface; one screen cannot be built in both React and vanilla TypeScript.
- E-2 - withdrawn - by gemini in favour of F-1.
- E-3 - withdrawn - by gemini in favour of D-1, whose content was itself folded into F-2/C-3.
- E-4 - withdrawn - by gemini in favour of F-3.
- E-5 - withdrawn - by gemini in favour of F-5 (a blocking startup script would break the unsupervised build; F-5 is documentation-only).
- E-6 - withdrawn - by gemini in favour of F-4.
- F-1 - accepted - "Seat registry" section in full.
- F-2 - accepted - "Status/event model" and the sidecar mechanism in "Orchestrator core"/"Bridge/IPC".
- F-3 - accepted - "Desktop shell and UI" section in full.
- F-4 - accepted - becomes `HANDOFF.md`, produced below.
- F-5 - accepted - "Commercial terms risk" section in full.
- F-6 - accepted - the Status/Assumptions/Out-of-scope/Scope-additions structure of this plan, and `BOARD.md`'s format, produced below.
