# HANDOFF_PACKAGING.md — Sophi-A Packaging Build Session

*Produced by the same 2026-09-09 relay run as `PLAN_PACKAGING.md` (run id
`2026-09-09T02-29-54-628Z`). Read `PLAN_PACKAGING.md` in full before starting - this handoff does
not restate its content, only its section numbers are referenced below.*

## What this is

`PLAN_PACKAGING.md` (packaging/installer plan for Sophi-A across Windows, Linux, Android, iOS) has
been approved (unanimous panel sign-off, round 1). This session builds it.

## Order of work

Build in this order, one item at a time, running the acceptance test for that item before moving
to the next:

1. §2.1 - runtime path-resolution chain (env var -> persisted store -> `resource_dir()` ->
   first-run picker), applied to orchestrator, bundled Node, and `RELAY_PATH`.
2. §2.2 - Windows: NSIS bundling, per-user install, unsigned posture docs, no-auto-update posture.
3. §2.3 - Linux: AppImage bundling, bundled Node, unsigned posture docs.
4. §2.4 - CI: `.github/workflows/release.yml`, tag-triggered, builds both platforms, attaches
   artifacts to a GitHub Release.
5. §3 / §3.1 - write the Android and iOS scope-cut documentation (no code). These are
   documentation deliverables only, not build items.

Do not reorder this list. Do not start §2.3 before §2.1's acceptance test passes on Windows -
Linux depends on the same resolver.

## Acceptance test per item

After finishing each numbered item above, run the corresponding acceptance test(s) from
`PLAN_PACKAGING.md` §7 before moving on:

- Item 1 -> AT-1, AT-6
- Item 2 -> AT-2, AT-3
- Item 3 -> AT-4, AT-5
- Item 4 -> provenance checks referenced in AT-1/AT-4 (build must come from CI, not a local
  machine, for the acceptance run)
- Item 5 -> AT-8

Additionally, AT-7 (no `claude` binary modification) must pass continuously - check it after every
item, not just once.

Do not mark an item done in the progress file until its acceptance test(s) pass. If a test fails,
fix and re-run; do not proceed to the next item with a known-failing test.

## Files to keep current

- **`PROGRESS.md`** - update after every item: what's done, what's in flight, what's blocked and
  why.
- **`DECISIONS.md`** - append any decision not already settled in `PLAN_PACKAGING.md` (e.g. a
  concrete NSIS script detail, a CI YAML choice). If a decision contradicts or extends
  `PLAN_PACKAGING.md`, stop and flag it instead of silently deciding - this file is for
  implementation-level choices the plan didn't need to specify, not for re-litigating scope.
- **`BUILT.md`** - one entry per commit, each naming the `PLAN_PACKAGING.md` section(s) it serves
  and the scope-ledger proposal id(s) it implements (e.g. "implements DEEPSEEK-1/GLM-1, §2.1").
- **`BOARD_PACKAGING.md`** - the board file `PLAN_PACKAGING.md` defines; keep item status current
  as work moves through the order above.

## Out of bounds

- Nothing outside `PLAN_PACKAGING.md`'s scope. If a need arises that isn't covered by §1-§7, stop
  and raise it - do not improvise a fix and keep going.
- Do not touch the `claude` CLI binary in any way (copy, patch, wrap, re-sign) - see §6 and AT-7.
  This is an absolute, not a judgment call.
- Do not add code signing, auto-update, `.deb`/`.rpm`, MSI, store submission, or any Android/iOS
  build artifact - all explicitly out of scope per §6.
- Do not embed, generate, or persist any API key or credential in any installer artifact or the
  path-resolution store - the store holds filesystem paths only.

## Start command

> Build PLAN_PACKAGING.md starting at item 1.
