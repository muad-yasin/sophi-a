# HANDOFF_PARALLEL_BUILD.md — Parallel-build-and-compare build session

*Produced by the same 2026-09-09 relay run as `PLAN_PARALLEL_BUILD.md` (run id
`2026-09-09T10-20-19-041Z`). Read `PLAN_PARALLEL_BUILD.md` in full before starting - this handoff
does not restate its content, only its section numbers are referenced below.*

## What you're building

The v1 slice described in `PLAN_PARALLEL_BUILD.md` §7, built in the order fixed by §9.
Assumptions you build against are §2. The scope ledger at the bottom names which proposal IDs
each piece of the design came from - cite these in commit messages.

## Order of work

Follow §9 exactly, in order, one item at a time:

1. Dispatch & cost gate
2. Snapshot manifest
3. Comparison UI
4. Pick + disposition
5. Advisor recommendation mode

Do not start item N+1 until item N passes its acceptance tests below and is committed. Item 1
must ship and be verified alone - the single-builder path must be provably unchanged - before
anything else touches the codebase.

## Acceptance test per item

After each item, run the matching subset of `PLAN_PARALLEL_BUILD.md` §10:

1. -> "Trigger / single-builder unaffected", "Trigger / fan-out identical string", "Cost gate /
   blocks before spend", "Cost gate / backend enforced", "Cost gate / non-sticky"
2. -> "Comparison / baseline correct" (manifest half only - no UI yet, verify by inspecting the
   written `.compare-snapshot.json` directly)
3. -> "Comparison / badges correct", "Comparison / baseline correct" (full)
4. -> "Pick / registers correctly", "Pick / guarded", "Disposition / retain-in-place",
   "Disposition / manual delete works"
5. -> "Advisor / non-binding"

If a test fails, fix before moving to the next item. Do not defer test failures to "clean up
later."

## Files to keep current throughout

- **PROGRESS.md** - update after every item: which of the 5 build-order items are done,
  in-progress, not-started.
- **DECISIONS.md** - any implementation choice not already fixed by `PLAN_PARALLEL_BUILD.md`
  (e.g. exact modal copy beyond what §3 specifies, exact file-tree component used) gets one line
  here with a short reason. If the plan already answers it, don't log it - just do it.
- **BUILT.md** - one entry per commit, naming the plan section(s) it serves and the scope-ledger
  proposal ID(s) it carries forward (e.g. "implements §3, carries GLM-1, DEEPSEEK-2").
- **BOARD_PARALLEL_BUILD.md** - the debate; keep it, do not overwrite it.

## Never do

- Never build anything in `PLAN_PARALLEL_BUILD.md` §8 (out of scope / non-goals). If a task seems
  to require one of those, stop and flag it rather than quietly building a minimal version of it.
- Never add a sticky/persistent multi-builder mode, in any form - §1 and §3 reject this
  specifically, not casually.
- Never let any code path set a winner or delete a workdir without a literal human click origin
  (§5).
- Never let any code path spawn >1 subprocess without the backend `confirmed: bool` guard passing
  (§3).
- Never move, rename, or auto-delete a builder workdir under any circumstance, timed or otherwise
  (§5).
- Never wire the relay `plan-1..3` panel into this feature - rejected on fit in §6, not a
  build-time judgment call to revisit.
- Never expand scope beyond what §7 lists as the v1 slice, even if it looks small or obviously
  nice to add.

## Start command

> Build parallel-build-and-compare per PLAN_PARALLEL_BUILD.md and HANDOFF_PARALLEL_BUILD.md,
> starting at item 1.
