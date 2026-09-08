# HANDOFF.md - read PLAN.md in full, then this, then begin

## What the plan is

PLAN.md is cnc-harness slice 1: a Tauri desktop shell that visualizes and drives eight real
Claude/Fable/relay seats. `cnc`/`build-1..3` are Claude Code subprocesses (PLAN.md "Seat
invocation mechanism"); `advisor` is a direct Messages API call to Fable 5.1; **`plan-1..3` each
spawn a real relay planning chain** (PLAN.md "What 'reuses relay's backend' means, precisely" -
revised 2026-09-09 - genuinely uses relay's CLI, not only `src/providers.js`). A five-event status
bus drives the glow (PLAN.md "Status/event model"). No installer, no mobile, no
parallel-build-compare (PLAN.md "Out of scope for slice 1").

**You may use at most 12 concurrent subagents via Task/Workflow tooling.**

## Prerequisites (already satisfied in this environment)

- Node 20+, Rust/cargo, gcc, and webkit2gtk-4.1 are all installed.
- The Claude Code CLI (`claude`) installed and authenticated.
- This repo is already cloned adjacent to `relay/` at `/home/user/Projects/cnc-harness`,
  `/home/user/Projects/relay`. `RELAY_PATH` defaults to `../relay`, which resolves correctly here.
- relay's own `.env` already has all provider keys `plan-1..3`'s default `plan-cheap` chain needs
  (Anthropic, Together/DeepSeek, OpenRouter/Qwen-GLM-Mistral-Kimi, Google/Gemini).

## Order of work

Follow PLAN.md's "Build order" exactly, one item at a time:

1. Repo scaffold + `RELAY_PATH` wiring (PLAN.md "Repository shape").
2. Orchestrator core + `seats.json` (PLAN.md "Orchestrator core", "Seat registry").
3. Event bus + ephemeral-port sidecar handshake (PLAN.md "Status/event model", "Bridge/IPC").
4. Seat adapters (PLAN.md "Seat invocation mechanism") - three distinct kinds now: Claude Code
   stream-json subprocess, direct Messages API, and relay-CLI spawn-and-poll.
5. Tauri shell (PLAN.md "Desktop shell and UI").
6. Bridge wiring.
7. Integration test, including a stubbed `plan-N` relay run (a fake `report.json` dropped into a
   fake run folder after a delay) so the poll-based path is tested without spending real API cost.

## Acceptance test after each item

Run the check in PLAN.md's "Verification"-equivalent that matches the item just finished. For
item 4's `relay-chain-subprocess` adapter specifically: start a real `plan-1` task against a cheap
throwaway request, confirm `seat.working` events arrive as `run.log` grows, and confirm `seat.idle`
fires with the real `deliverable.md` content once `report.json` appears.

## Files to keep current while working

- `PROGRESS.md` - one timestamped line per completed build-order item.
- `DECISIONS.md` - every judgment call PLAN.md left open, one line each with reasoning.
- `BUILT.md` - one entry per commit: which PLAN.md section it built and which scope-ledger
  proposal id(s) it serves (PLAN.md "Scope ledger").
- `BOARD.md` - already produced in full; keep it, do not overwrite it.

## Never do

Build anything PLAN.md's "Out of scope for slice 1" names: Android/iOS, the parallel-build-compare
feature, a packaged/signed/store installer, or pricing/licensing. (Multiple model providers are no
longer out of scope for `plan-1..3` specifically, per the 2026-09-09 addendum - do not revert that.)
If a build decision seems to require something PLAN.md excludes, stop and write it to
`DECISIONS.md` instead of building it.

## Start

`cd cnc-harness && npm install && npm run tauri dev`, once build-order item 1's scaffold exists.
