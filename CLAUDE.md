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
`seven-cheap.json`) will crash at round 3 if a run reaches Cohere's `command-r7b-12-2024` critic
seat (chain requests 20000 max tokens, that model caps at 4096) - a real bug in relay, not fixed
here, worth a session over there fixing it.

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

MCP-style introspection on the orchestrator (seat status/output/control) - relay already does
this for itself (`src/mcp/server.js`); cnc-harness doesn't yet, and debugging tonight would have
been much faster with it (a native window has no console either side can casually read - see
`DECISIONS.md`'s `debug_log` entry, which is the stopgap). Past that: the parallel-build-and-compare
feature and mobile are both explicitly deferred in PLAN.md, not designed yet.
