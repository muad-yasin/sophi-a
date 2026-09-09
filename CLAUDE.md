# Sophi-A (repo/codename: cnc-harness)

We build cool shit first, cheaply. This is the harness-as-product: a Tauri desktop shell that
visualizes and drives eight real Claude/Fable/relay seats - one C&C chat, one advisor, three
planning modules (each a real relay chain: cheap mass-thinking, many labs), three building
modules (real Claude Code subprocesses) - so a vibecoder gets more out of the models they already
pay for. That's the whole pitch. Don't over-govern it; build, test for real, ship the next slice.

Product name (2026-09-09, Muad's call): **Sophi-A** - named and visually themed after
`~/Projects/SMO`'s own "Project Sophi-A" in-game AGI narrative, a deliberate cross-property choice.
The repo folder and internal paths stay `cnc-harness`; see PLAN.md's naming note and DECISIONS.md.
Open source (Apache-2.0), monetized via a packaged build sold on Stripe (`SHOP.md`) - see there and
`DECISIONS.md` for the current price/launch-country state, which moves faster than this file.

## Start here, in order

1. `PLAN.md` - the architecture, settled by a six-lab review panel. Read it in full before
   touching anything.
2. `HANDOFF.md` - the original build-order instructions slice 1 was built from.
3. `BOARD.md` - the debate that produced PLAN.md, including GLM's persistent objection (resolved:
   `plan-1..3` now run real relay chains, not a raw API call) and the panel history across rounds.
4. `PROGRESS.md` / `BUILT.md` - what's actually done, dated, one line each.
5. `DECISIONS.md` - judgment calls and real bugs found while building, including one worth
   internalizing: **run the thing before trusting it compiles.** A CSS specificity bug (`[hidden]`
   silently defeated by author `display` rules) looked exactly like a WebSocket connectivity bug
   for a long stretch. `npm run tauri dev`, actually look at the window, don't just `tsc --noEmit`.
6. `PLAN_PACKAGING.md`/`HANDOFF_PACKAGING.md`/`BOARD_PACKAGING.md` - the same real-multi-lab-panel
   treatment (5 labs this time, `plan-debate` chain, unanimous round-1 sign-off), run a second time
   (2026-09-09) for the Windows/Linux/Android/iOS packaging question. Not built yet; read before
   starting any packaging work, same as item 1.

## The relationship to relay

`relay` (`~/Projects/relay`, `RELAY_PATH` env var, defaults to `../relay`) is a dependency, not a
parent project. `plan-1..3` spawn real relay chains via its CLI (`src/cli.js`) and poll the run
folder - this is genuine reuse of working code, not a description of it. Two things worth knowing
about relay itself, found while building this: its own `chains/plan-cheap.json` (and
`seven-cheap.json`) would crash at round 3 if a run reached Cohere's `command-r7b-12-2024` critic
seat (chain requested 20000 max tokens, that model caps at 4096). **Fixed 2026-09-09** in relay
directly (commit 90f5e3a there) - a later relay-side blanket "raise all critic maxTokens to
20000" commit (4ca3ae8, fixing unrelated Gemini/DeepSeek issues) had swept this seat's cap up
too without re-checking it; six chains needed the same fix, not just the two named here
originally.

## The spirit, carried over from `~/Projects/FOCUS.md`

Muad rewrote FOCUS.md on 2026-09-09 specifically to make this kind of work possible: scope creep
is fine for a while, cheap-model mass-thinking plus heavy Claude Code use across several repos is
the standing direction, and the old "no new projects, no new repos" / "say so and stop" rules are
gone on purpose. cnc-harness is real, ongoing, authorized work - a fresh session reading this file
does not need to re-litigate that the way a few overnight subagents did on stale, cached FOCUS.md
content before they'd actually re-read it. If FOCUS.md's current text ever genuinely contradicts
this, trust the live file and say so - but the default here is: build, don't gate.

## Running it

```
npm install
npm run tauri dev
```

Slice 1's bar (met, 2026-09-09): the window opens showing all eight seat tiles, green/idle, driven
by a real WebSocket from a real orchestrator process Rust spawned.

## What's next (proposed, not started)

The parallel-build-and-compare feature and mobile are both explicitly deferred in PLAN.md/
PLAN_PACKAGING.md, not designed yet.

## MCP introspection (built 2026-09-09)

`src/mcp/server.js` - the introspection this section used to just propose. Register it with
`claude mcp add sophia -- node /path/to/cnc-harness/src/mcp/server.js`, then a Claude Code
session gets `list_seats`/`get_seat`/`start_seat`/`stop_seat`/`configure_seat`/`wait_for_idle`
against whatever Sophi-A instance is actually running - no more guessing from a native window
with no attached console (the `debug_log` entry in DECISIONS.md was the stopgap; this is the
real thing). Finds the running orchestrator via a well-known port file
(`os.tmpdir()/sophia-orchestrator-port`, written by `src/orchestrator/index.js` itself on
startup) rather than a hardcoded port, and maintains one persistent WebSocket connection for its
whole lifetime so tool calls answer from a live cache instead of racing a fresh connection's
replay. `wait_for_idle` specifically guards against a real race found while testing it: calling
it immediately after `start_seat`, before the seat's own "working" event has even arrived, would
otherwise report a task that hadn't started yet as already finished.
