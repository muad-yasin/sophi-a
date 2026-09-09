# PLAN_PARALLEL_BUILD.md — Parallel-build-and-compare design

*Produced 2026-09-09 via a real relay `plan-debate` chain run (task
`sophi-a-parallel-build-compare.md`, run id `2026-09-09T10-20-19-041Z`, $0.32, unanimous panel
sign-off in round 1). Full debate: `BOARD_PARALLEL_BUILD.md`. Build-order handoff:
`HANDOFF_PARALLEL_BUILD.md`. Same process that produced `PLAN.md` and `PLAN_PACKAGING.md`.*

**Status:** proposed, v1 slice, ready for build
**Scope:** Sophi-A builder seats `build-1..3`; adds fan-out dispatch, cost gate, comparison view,
winner pick. Does not touch relay `plan-1..3` internals.

---

## 1. Architecture reasoning

Today each builder seat is dispatched independently: a human types into that seat's own
task-input box, one subprocess spawns, one `--resume` thread continues. Nothing links seats to
each other. "Parallel-build-and-compare" adds exactly three new mechanisms on top of that, and
nothing else:

1. **A fan-out dispatch path** - one task string, sent once, spawned identically into 2 or 3
   already-existing builder subprocesses.
2. **A pre-spend cost gate** - a blocking confirmation naming the real multiplier, sitting
   between "human hits send" and "any subprocess exists."
3. **A comparison-and-pick surface** - a way to actually look at what each workdir now contains,
   and a discrete action that records a human's choice.

The isolated-workdir fact means there is no merge-conflict problem to design for -
`build-1` and `build-2` editing the same file never collides on disk, they're in different
directories. The entire remaining problem is *visibility* (what did each one actually do) and
*disposition* (what happens to the one(s) not picked). Everything below is scoped to those two
problems plus the trigger and the cost gate that must exist before either.

We reuse existing UI real estate (the task-input box) rather than invent a new C&C-level mode,
because a per-task control that resets after every dispatch is structurally safer against silent
repeat cost-burn than a sticky mode toggle a human could forget was on (this is exactly why
DEEPSEEK-1 and QWEN-1's mode-toggle proposals were withdrawn during debate). The trigger, the
cost gate, and the dispatch call are one fused action, not three: type task -> tick extra
builders -> hit send -> see multiplier -> confirm -> subprocesses spawn. There is no separate
"arm multi-builder mode" step that could be left armed.

For comparison, we reject inventing a new "judge" seat. We evaluate the two existing candidates
explicitly (this is load-bearing, not decorative - see §4) and land on: human does the picking,
advisor optionally narrates a non-binding recommendation, `plan-1..3` is not touched at all.

Disposition of the non-picked builder(s) is **retain-in-place, do nothing automatic, ever**.
Multiple labs proposed timer-based or move-to-archive disposal; both were withdrawn/amended
after objection because (a) moving `.workdirs/build-N` breaks the `--resume` continuation that
seat depends on, and (b) any automatic deletion, timed or not, destroys exactly the material a
human might want to hand-merge from later. Retain-in-place with an explicit, human-only delete
action is the only disposition that doesn't quietly lose data.

---

## 2. Named assumptions

- **A1.** Builder workdirs (`.workdirs/build-1..3`) are plain directories, not git repositories
  with a committed baseline - no `git diff` can be assumed to work against them. (Established
  during debate: a `git diff`-based design was withdrawn on exactly this ground.)
- **A2.** "Same task" means byte-identical task-string input to each selected builder's CLI turn;
  it does not imply synchronized completion - builders finish independently and the UI must
  tolerate one seat finishing before another.
- **A3.** A human triggers a multi-builder run at most a few times per session, not continuously;
  the trigger therefore does not need to be a persistent mode, and non-sticky per-task state is
  acceptable UX friction in exchange for cost safety.
- **A4.** The advisor seat (Fable) can be given an additional prompt mode without redesigning its
  subprocess lifecycle - it already runs fast oversight commentary against arbitrary context;
  feeding it multiple diff summaries instead of one is a prompt change, not an architecture
  change.
- **A5.** v1 caps fan-out at the existing 3 seats; no new seats are created for this feature.

---

## 3. Trigger and cost gate

**Where it lives:** the existing task-input box for `build-1`, not a new C&C-level mode, not a
per-seat independent action.

**What's added:** a checkbox row next to the `build-1` task-input box - `[ ] also run on build-2`
`[ ] also run on build-3`. Unchecked by default, always. Non-sticky: reset to unchecked after
every dispatch (success or cancel), so there is no persisted "mode" a human could forget was on.

**Dispatch semantics:** "Send" with one or more boxes ticked is a *single* fan-out dispatch call
- one Tauri command takes the task string once and spawns build-1..N with that identical string
in a loop over the existing per-seat spawn logic. This is not three independent sends; it's one
send fanned to N targets.

**Cost gate (fused into the same action, not a separate step):** before any subprocess exists, a
modal blocks:

> "This will run the same task on 3 builders: **3x cost and 3x subscription-usage** consumption
> for this one task. Continue?" - `[Cancel]` `[Confirm and run]`

Text is generated from N, so 2 builders -> "2x cost and 2x subscription-usage." `Cancel` spawns
nothing. `Confirm and run` spawns exactly N subprocesses with the identical task string.

**Backend guard:** the dispatch command signature accepts `seat_ids: Vec<String>` and a
`confirmed: bool` flag; the backend rejects any dispatch where `seat_ids.len() > 1 &&
!confirmed`. This means a direct backend call bypassing the modal cannot spawn a multi-builder
run - the gate is enforced server-side, not just as a UI courtesy.

Single-builder behavior is completely unchanged: no boxes ticked -> send behaves exactly as
today, no modal, one subprocess. The `build-2`/`build-3` task-input boxes remain independently
usable for their own unrelated tasks, as today.

---

## 4. Comparison rendering

**What's rendered, concretely:** each builder tile gets an **"Inspect changes"** toggle.
Expanding it opens a two-pane view:

- **Left pane - file tree**, scoped to files changed since task dispatch (not the whole workdir).
  Files present-and-byte-identical across builders that ran the same task get a **"same" badge**;
  files that diverge get a **"differs" badge**.
- **Right pane - unified diff**, syntax-highlighted, for whichever file is selected. Two diff
  modes are available on a selected divergent file: before/after (this builder's change against
  its own dispatch-time snapshot) and builder-vs-builder (build-1's resulting version against
  build-2's resulting version, selectable when both touched the same relative path).

**Diff baseline, concretely defined (this was the central objection raised against every
git-based or "previous state" design in debate):** at dispatch time, the backend writes a
manifest (`.workdirs/build-N/.compare-snapshot.json`) listing every tracked file's relative
path, mtime, and sha256 hash. "Changed since dispatch" and all diffs are computed by walking the
current workdir and comparing against this manifest - never against a git commit, which A1
establishes doesn't reliably exist.

This is the only comparison rendering path carried forward; a git-diff-based drawer and a plain
file-tree-without-diffs were both withdrawn precisely because they failed to define a working
baseline or omitted diffs entirely.

---

## 5. Pick mechanism and disposition

**Pick action:** a **"Pick this one"** button on each expanded builder tile. Clicking it:
- Sets that tile's badge to **"Winner"**.
- Sets all other participating tiles' badges to **"Retained"**.
- Writes a run record (`.workdirs/.compare/<task-id>.json`) naming the winning seat, the task
  string, and the participating seat IDs.

**Backend guard:** the `select_winner` write path rejects any call that did not originate from a
frontend human click event (no click-origin flag -> error, no record written). This closes off
any path - accidental or automated - for a "pick" to be smuggled in without a literal human
click.

**Disposition of non-picked output:** **retained in place, unconditionally, forever, until a
human explicitly deletes it.** No workdir is moved, renamed, or auto-deleted by the pick action
or by any timer. This is the one point where the debate board unanimously reversed an initial
design: an "archive/ subdirectory," a "5-minute grace period" auto-delete, and an archive-move
were each raised, objected to, and withdrawn/amended - moving a workdir breaks that seat's
`--resume` continuation, and any automatic deletion destroys material a human might still want
to hand-merge from. The only new UI state needed is: the "Retained" badge itself, plus one
explicit **"Delete workdir"** button on retained tiles for a human to invoke manually if and when
they're done with it.

A small **"Run history"** strip lists past multi-builder runs and their recorded winners (from
the `.compare/<task-id>.json` records) - enough to answer "which one did I pick last time,"
without building a full archive browser.

---

## 6. Judging foundation evaluation — required, not optional

Two existing mechanisms were explicitly weighed as candidates for "compare and recommend" before
deciding a human-click pick plus optional advisor commentary was correct:

**Advisor (Fable) - adopted, in a narrowed role.** Advisor already does fast, cheap oversight
commentary against arbitrary context; that capability transfers directly to "read N builders'
diff summaries, say something short." We add one new advisor prompt mode that receives each
builder's changed-file list and diff summary (not full diffs - token cost) and returns a single
non-binding line: *"recommended: build-2, because [reason]."* This is commentary only. It never
writes a run record, never sets a winner badge, never gates the pick button. The human can
ignore it entirely. This is cheap to build (a prompt template addition) and reuses a subprocess
lifecycle that already exists - no new seat.

**Relay `plan-1..3` panel-judging - rejected.** The relay pattern's blind-panel review, scope
ledgers, and verdict machinery is built for judging *plans* - sequential, text-heavy artifacts
reviewed by multiple labs against a shared rubric, as part of its own chain.
Parallel-build-and-compare's comparison target is *concurrent, same-task, file-level code output*
across builders that never talk to each other - there's no plan document to hand the panel, no
scope ledger to reconcile, and no sequential review step where its blind-review protocol would
attach. Wiring the relay pattern in for this would mean either inventing a code-diff-shaped input
format the panel doesn't consume today, or running a second full multi-lab review pass on every
single builder comparison - real weeks of engineering for a judgment a human is going to make by
looking at a diff anyway. Rejected on cost/fit, not on quality.

**No new dedicated judge seat is built.** The human, looking at the comparison view in §4, is the
judging mechanism. Advisor is decoration on top of it.

---

## 7. Recommended v1 slice

The full design above **is** sized to be the v1 slice - nothing here requires a rewrite or
multi-week new engineering. Concretely, v1 ships:

- Checkbox row + fused fan-out dispatch (§3)
- Pre-spawn cost-multiplier modal + backend confirmation guard (§3)
- Dispatch-time snapshot manifest (§4)
- Inspect-changes two-pane file tree + diff view, same/differs badges, before/after diff only
  *(builder-vs-builder cross-diff can ship in the same slice if trivial; if not, it is the one
  item explicitly allowed to slip to v1.1 without re-scoping the rest)*
- Pick button, winner/retained badges, run record, retain-in-place disposition, manual delete
  button
- Advisor prompt-mode addition for optional non-binding recommendation
- Run history strip (winners only, from run records)

This is buildable as an incremental extension of the existing tile UI and existing per-seat spawn
logic - no new subprocess types, no new seat, no new persistent global state.

---

## 8. Out of scope / named non-goals (deferred, not dropped)

- **Automated pick/judging.** No mechanism ever selects a winner without a literal human click.
  Advisor's recommendation is commentary, never authority.
- **Git-merge or hand-merge tooling.** Manually combining good parts of two builders' output into
  a single result is explicitly not designed here - a human can open both workdirs in their own
  editor and do it by hand; no in-app merge UI is built.
- **Cross-session run history / archive browser.** The "Run history" strip covers current-session
  winners only; a searchable, filterable, long-lived history of all past comparisons is deferred.
- **>3 concurrent builders.** Fan-out is capped at the existing 3 seats; no design decision is
  made for a hypothetical 4th+ seat.
- **Sticky/persistent multi-builder mode.** Deliberately rejected, not just deferred - see §1 and
  §3. There is no setting that survives across dispatches.
- **Automatic workdir deletion of any kind, timed or otherwise.** Retain-in-place is permanent
  unless a human clicks delete.
- **Wiring the relay `plan-1..3` panel into builder comparison.** Rejected on fit (§6), not
  deferred as a "maybe later" - if a future need for panel-style judging of builder output
  emerges, it should be redesigned fresh against that need, not backfilled here.
- **Full diff-viewer feature parity with a real IDE** (inline comments, multi-file staged review,
  etc.) - the diff view is read-only inspection, not an editor.

---

## 9. Build order

1. **Dispatch & cost gate.** Checkbox row on the `build-1` task-input box; fused fan-out Tauri
   command accepting `seat_ids: Vec<String>` + `confirmed: bool`; pre-spawn modal with generated
   Nx-cost text; backend rejection of unconfirmed multi-seat dispatch. *(Ships alone, testable
   independently of everything below - single-builder path must remain provably unchanged.)*
2. **Snapshot manifest.** At dispatch time, write `.compare-snapshot.json` (path, mtime, sha256)
   per participating workdir.
3. **Comparison UI.** "Inspect changes" toggle -> file tree (changed files only, same/differs
   badges) + unified diff pane against the manifest baseline.
4. **Pick + disposition.** "Pick this one" button, click-origin-guarded `select_winner` backend
   call, run record write, Winner/Retained badges, manual "Delete workdir" button, Run history
   strip.
5. **Advisor recommendation mode.** New advisor prompt template accepting N builders' diff
   summaries, returning one non-binding recommendation line surfaced in the comparison UI.

---

## 10. Acceptance tests

- **Trigger / single-builder unaffected:** with no checkboxes ticked, submitting a task spawns
  exactly one subprocess and shows no modal.
- **Trigger / fan-out identical string:** ticking build-2 and build-3, confirming, spawns exactly
  3 subprocesses; inspecting each spawned session's task input shows byte-identical strings to
  what was typed.
- **Cost gate / blocks before spend:** ticking 2+ builders and hitting send shows a modal stating
  the correct "Nx cost and subscription-usage" text *before* any subprocess exists (verified via
  process list at modal-open time); clicking Cancel results in zero spawned subprocesses.
- **Cost gate / backend enforced:** a direct backend dispatch call with `seat_ids.len() > 1` and
  `confirmed: false` returns an error and spawns nothing.
- **Cost gate / non-sticky:** after any dispatch (confirmed or cancelled), the checkboxes are
  unchecked again.
- **Comparison / badges correct:** after a 2-builder run where build-1 and build-2 edit the same
  file differently, that file shows a "differs" badge in both trees; a file left untouched by
  both appears in neither tree; a file edited identically in both shows "same" and an empty
  cross-builder diff.
- **Comparison / baseline correct:** the diff view for a modified file matches the actual textual
  delta between the dispatch-time snapshot manifest and current file contents.
- **Pick / registers correctly:** clicking "Pick this one" on build-1 sets build-1's badge to
  Winner and build-2's to Retained, and writes a run record naming build-1 as winner.
- **Pick / guarded:** a `select_winner` backend call lacking the frontend click-origin flag
  returns an error and writes no record.
- **Disposition / retain-in-place:** after a pick, the non-picked workdir's path is unchanged on
  disk and its files are byte-identical to their pre-pick state; no automatic deletion occurs at
  any elapsed time.
- **Disposition / manual delete works:** clicking "Delete workdir" on a Retained tile removes
  that workdir; it is never removed by any other action.
- **Advisor / non-binding:** the advisor recommendation line appears in the comparison UI but its
  presence or content has no effect on which pick button is clickable or on any run record.

---

## Scope ledger

- DEEPSEEK-1 - withdrawn - by its author in favour of GLM-1's per-task checkbox trigger.
- DEEPSEEK-2 - accepted - folded into §3, backend confirmation-flag guard on the dispatch gate.
- DEEPSEEK-3 - accepted (amended) - folded into §4/§5, dispatch-time hash manifest as diff
  baseline; retain-in-place disposition superseded its archive-move version.
- QWEN-1 - withdrawn - by its author in favour of GLM-1.
- QWEN-2 - accepted (amended) - folded into §4, snapshot-manifest diff view, `seat_ids` backend
  clarity.
- QWEN-3 - accepted (amended) - folded into §5, retain-by-default disposition after withdrawing
  its 5-minute auto-delete.
- GLM-1 - accepted - §3, the fan-out checkbox trigger and fused cost-confirm gate.
- GLM-2 - accepted - §4, per-tile file-tree + diff panel with same/differs badges and manifest
  baseline.
- GLM-3 - accepted - §5 and §6, pick button, retain-in-place disposition, advisor-as-recommender
  evaluation.
- MISTRAL-1 - cut - superseded by GLM-1's per-builder checkbox row, which names specific seats
  rather than a builder-count dropdown.
- MISTRAL-2 - cut - duplicate of the cost-confirm modal already specified in GLM-1/§3.
- MISTRAL-3 - withdrawn - by its author in favour of GLM-2.
- GEMINI-1 - withdrawn - by its author in favour of QWEN-1 (itself withdrawn to GLM-1);
  `seat_ids: Vec<String>` signature folded into §3.
- GEMINI-2 - withdrawn - by its author in favour of QWEN-2/GLM-2, after its git-diff baseline was
  shown to not hold (workdirs aren't git repos).
- GEMINI-3 - accepted - overall PLAN.md shape (this document): named assumptions, out-of-scope
  list, build order, acceptance tests, and explicit advisor/plan-1..3 evaluation.
