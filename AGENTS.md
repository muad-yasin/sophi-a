# Sophi-A (repo: cnc-harness)

Sophi-A is a Tauri desktop shell that runs eight real agent seats at once - a Command & Control
chat, an Advisor, three planning seats, three building seats (real `claude` CLI subprocesses) -
so a vibecoder gets more out of the models they already pay for. The part that isn't a
Conductor/Nimbalyst clone: each planning seat runs a real relay chain where one model drafts a
plan and critic seats from five *other* labs (never the same lab twice, never Grok) grade it
blind, round after round, until they sign off or the run records exactly who refused and why -
"The High Council," `brand/HIGH_COUNCIL.md`. That is the whole pitch. Adversarial cross-lab review
of a plan before any build seat touches code, not N copies of one agent racing to the same answer.

**Before changing architecture, read `PLAN.md` in full.** It was settled by a real six-lab
adversarial review panel (`BOARD.md` has the debate), not one session's guess - don't relitigate a
decision there without reading why it was made.

**The one habit that matters most: run it, don't just typecheck.** `npm run tauri dev`, then
actually look at the window. `DECISIONS.md` records a real bug - a CSS `[hidden]` rule silently
defeated by an `author display` rule - that read exactly like a WebSocket connectivity problem for
a long stretch, because nobody had opened the window to look.

**Where things actually stand right now:** `PROGRESS.md` / `BUILT.md` (dated, one line each) and
`DECISIONS.md` (judgment calls, real bugs, what's verified vs. not) are the live source of truth.
This file is oriented for the first five minutes of a session, not day-to-day status - don't trust
anything here about *current state* over those three files.

## Running it

```
npm install
npm run tauri dev
```

A packaged build exists too: `v0.1.0` (Windows NSIS installer, Linux AppImage), built by GitHub
Actions - see `PLAN_PACKAGING.md` / `DECISIONS.md` for what's actually verified.

## Read in this order before touching anything unfamiliar

1. `PLAN.md` - the architecture.
2. `HANDOFF.md` - the original build-order instructions slice 1 was built from.
3. `BOARD.md` - the panel debate that produced `PLAN.md`, including GLM's persistent objection
   (resolved: `plan-1..3` run real relay chains, not a raw API call).
4. `PROGRESS.md` / `BUILT.md` - what's actually done.
5. `DECISIONS.md` - judgment calls and real bugs found while building.
6. `PLAN_PACKAGING.md` / `HANDOFF_PACKAGING.md` / `BOARD_PACKAGING.md` - the same six-lab-panel
   treatment for packaging (Windows/Linux v1, Android/iOS explicitly out of scope with
   independent reasoning per platform - not a hand-wave).
7. `PLAN_PARALLEL_BUILD.md` / `HANDOFF_PARALLEL_BUILD.md` / `BOARD_PARALLEL_BUILD.md` - same
   treatment for parallel-build-and-compare (dispatch the same task to several builders, inspect,
   diff, pick a winner with a human click).
8. `brand/HIGH_COUNCIL.md` - the visual/marketing identity for the plan-seat mechanism above;
   read before touching brand assets, the landing page (`marketing/index.html`), or the in-app
   Debate panel's Council seal.

## Naming, license, monetization

Product name: **Sophi-A** (Muad's call, 2026-09-09) - named and visually themed after
`~/Projects/SMO`'s own "Project Sophi-A" in-game AGI narrative, a deliberate cross-property
choice. The repo folder and internal paths stay `cnc-harness` (`PLAN.md` has the naming note).
Open source (Apache-2.0); monetized via a packaged build sold on Stripe - `SHOP.md` has the
current price/link/launch-country state, which moves faster than this file.

## Dependency: relay

`relay` (`~/Projects/relay`, `RELAY_PATH` env var, defaults to `../relay`) is a dependency, not a
parent project. `plan-1..3` spawn real relay chains via its CLI (`src/cli.js`) and poll the run
folder - genuine reuse of working code, not a description of it. If a plan seat's chain crashes or
misbehaves, check whether the bug is actually relay's before assuming it's this repo's (a real
critic-seat token-cap crash was found and fixed there, not here - see `DECISIONS.md`).

## MCP introspection

`src/mcp/server.js` exposes the running orchestrator (seat status/output/control) over MCP -
useful for debugging without a native window's non-existent console:

```
claude mcp add sophia -- node /path/to/cnc-harness/src/mcp/server.js
```

Then an MCP-capable session gets `list_seats` / `get_seat` / `start_seat` / `stop_seat` /
`configure_seat` / `wait_for_idle` against whatever Sophi-A instance is actually running. It finds
the orchestrator via a port/token file pair in `os.tmpdir()` rather than a hardcoded port -
`docs/security-prompt-injection.md` has the reasoning for the auth token specifically.

## Working here as an agent (any model, any seat)

This file is also served verbatim as `AGENTS.md` and injected into the `cnc`/`advisor` seats'
system prompt when they run on a non-Anthropic provider (`messagesApi.js`) - so it addresses any
agent working in this repo, not only Claude Code. If you are a `cnc`-seat or `advisor`-seat model
reading this inside a system prompt: you are in chat-only mode here, with no tool use and no file
access - say so plainly if asked to edit or run something, don't imply you can.

Whatever runs you: don't over-govern this project. The whole spirit, carried over from
`~/Projects/FOCUS.md`'s 2026-09-09 rewrite, is scope-creep-tolerant, build-first, ship-the-next-
slice - the old "no new repos, say so and stop" rules are gone on purpose. Build, test for real
(see "run it, don't just typecheck" above), and record what you did in `PROGRESS.md`/`BUILT.md`/
`DECISIONS.md` the way every entry already there does - dated, specific, honest about what's
verified vs. assumed.
