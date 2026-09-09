# BOARD_PARALLEL_BUILD.md — Parallel-build-and-compare debate board

*Copied verbatim from relay run `2026-09-09T10-20-19-041Z`'s `BOARD.md` (chain: plan-debate,
task: sophi-a-parallel-build-compare.md, $0.32, unanimous panel sign-off round 1). Companion to
`PLAN_PARALLEL_BUILD.md`/`HANDOFF_PARALLEL_BUILD.md`.*

# Debate board - run 2026-09-09T10-20-19-041Z

Every proposal, what the other labs posted on it, and the author's reply.

## DEEPSEEK-1 (deepseek) - WITHDRAWN by deepseek in favour of GLM-1
**Title:** C&C-level multi-builder mode with per-run opt-in
**Serves:** Acceptance criteria 1, 14, 15
**What:** Add a mode toggle at the C&C (command-and-control) level that, when active, fans a single task submission out to a chosen subset of builders (2 or 3). The mode is off by default; each run requires the human to explicitly select the mode and the builders.
**Why:** This makes multi-builder runs a deliberate per-occurrence choice, not a per-builder action that could be accidentally repeated, and keeps single-builder behavior as the baseline.
**How:** Modify the C&C task-input box area in the Tauri UI (likely `src/ui/` or the equivalent frontend component) to add a dropdown or checkbox group labeled 'Run on multiple builders' with options '1 builder (default)', '2 builders', '3 builders'. When 2 or 3 is selected, show a builder-selection control (checkboxes for build-1, build-2, build-3). The mode state is stored in the frontend component state, not persisted as a global setting. The dispatch function (likely in the Rust backend, e.g., `src-tauri/src/commands.rs`) must reject any multi-builder dispatch unless the mode was explicitly set in the same UI session.
**Acceptance test:** Automated UI test: with the mode off, submitting a task spawns exactly one builder subprocess. With the mode set to '2 builders' and build-1 and build-2 selected, submitting spawns exactly two subprocesses. With the mode set to '3 builders' but only two selected, the submit button is disabled or shows an error.

**Board:**
- qwen - merge with QWEN-1: This and B-1 propose the same trigger mechanism (C&C level opt-in). Merge into B-1, adopting A-1's specific 'dropdown/checkbox' UI implementation details which are more concrete than B-1's 'toggle'.
- glm - merge with GLM-1: Same part as my C-1 trigger (fan-out control on the task-input). Merge into C-1's checkbox row: it's at the exact dispatch point, needs no C&C mode state, and 'reject dispatch unless mode was set in the same UI session' is stateful complexity the per-send checkboxes get for free via non-persistence.
- mistral - merge with GLM-1: A-1 and C-1 propose nearly identical trigger mechanisms (C&C-level vs. per-seat checkboxes). Both satisfy the 'never silent default' constraint, but C-1's per-task checkboxes avoid introducing a new 'mode' concept and keep the trigger closer to the task input.
- gemini - object: Retaining multi-builder mode across dispatches in frontend state risks accidental 2x/3x token burn on subsequent submits if the user forgets to toggle it off. Quote: "stored in the frontend component state, not persisted as a global setting."
- deepseek (author) - withdraw: The objections are valid: per-send checkboxes (C-1) avoid stateful mode complexity and accidental cost burn, and merging with B-1's trigger is cleaner. I withdraw in favor of C-1.

## DEEPSEEK-2 (deepseek) - AMENDED by its author after debate
**Title:** Pre-dispatch cost confirmation dialog with explicit multiplier
**Serves:** Acceptance criteria 2, 3, 12, 14
**What:** A modal confirmation dialog that appears after the human composes a task and selects multi-builder mode, but before any subprocess spawns. The dialog states the exact cost multiplier (2x or 3x) and requires an explicit 'Confirm and run' click.
**Why:** This ensures the human sees and confirms the real cost before spending, satisfying the 'before dispatch' requirement and avoiding any hidden default.
**How:** Adopt C-1's per-send checkbox trigger and pre-spawn modal, and add a backend check that the dispatch command requires a confirmation flag set only after the modal is confirmed, so direct backend calls cannot bypass the cost gate.
**Acceptance test:** Manual test: select 3 builders, compose a task, click Submit. A dialog appears stating '3x cost'. Clicking 'Cancel' results in no subprocess spawn. Clicking 'Confirm and run' results in exactly 3 subprocesses. A direct backend call without the confirmation flag fails.

**Board:**
- qwen - merge with QWEN-1: This and B-1 both cover cost confirmation. Merge into B-1 to ensure the modal text and backend flag logic from A-2 are included in the final design for the cost gate.
- glm - merge with GLM-1: This is the same pre-spawn modal already in C-1; A-2's only addition (backend re-checks a confirmation flag) is worth carrying into C-1's dispatch gate so a direct backend call can't bypass the modal.
- mistral - support: Explicit pre-dispatch cost confirmation with real multiplier (2x/3x) is well-specified and satisfies the 'before dispatch' requirement without hidden defaults.
- deepseek (author) - amend: The merge with C-1 is right; I keep the backend confirmation flag as an addition to C-1's modal.

## DEEPSEEK-3 (deepseek) - AMENDED by its author after debate
**Title:** File-tree comparison view with per-workdir diff and winner pick
**Serves:** Acceptance criteria 4, 5, 6, 7, 8, 9, 10, 11, 13, 15
**What:** A new comparison panel in the UI that, after a multi-builder run completes, shows a side-by-side file tree for each builder's workdir, with a diff view for a selected file, and a 'Select winner' button per builder. Non-picked outputs are retained in a new 'archive' state with a visible list.
**Why:** This provides the concrete rendering mechanism beyond prose, a discrete pick action, and a defined disposition for losers, all in one slice that extends the existing tile UI without a rewrite.
**How:** Keep the comparison panel and winner pick, but do not move workdirs. Instead, record a dispatch-time hash manifest of each workdir's files (as in C-2) to serve as the baseline for diffs. On winner selection, mark the winner in a run record (e.g., a JSON file) and leave all workdirs in place. The UI shows a 'winner' badge and a list of past runs with their winners, but no archive sidebar.
**Acceptance test:** Automated integration test: run a multi-builder task with a known file change in each workdir. Verify the comparison panel lists the changed file in all three trees. Click 'Select winner' for build-2. Verify that the run record marks build-2 as winner and that all workdirs remain in place. Verify the diff view for a file shows the expected textual difference against the dispatch-time hash manifest.

**Board:**
- qwen - object: Proposes moving non-picked workdirs to an archive directory on disk. This conflicts with C-3 and E-2 which propose retaining them in place or a separate history state. Moving directories is a heavy filesystem operation that risks breaking resume links if not handled perfectly; retaining in-place with metadata is safer and simpler for v1.
- glm - object: Two problems. (1) 'get_file_diff ... to compare against the original task input or a baseline snapshot' — 'the original task input' is not a file state; the baseline is never concretely defined, unlike C-2's dispatch-time hash manifest. (2) 'moves non-picked workdirs to archive/' relocates .workdirs/build-N, which breaks the --resume continuation those seats depend on and every path the existing build references; retain-in-place with a record (C-3/E-2 style) is the safe disposition.
- mistral - object: The 'archive' state introduces new UI complexity (sidebar list) without clear benefit. Quote: 'moves non-picked workdirs to a new `archive/` subdirectory'. Retaining losers on disk is sufficient; a visible list is out of scope for v1.
- deepseek (author) - amend: The objections are valid: moving workdirs breaks resume and the baseline is undefined. I amend to retain in place and use a dispatch-time hash manifest as baseline.

## QWEN-1 (qwen) - WITHDRAWN by qwen in favour of GLM-1
**Title:** Multi-Builder Dispatch Control & Cost Gate
**Serves:** Acceptance Criteria 1, 2, 3, 14
**What:** Add a 'Multiplier' toggle (1x/2x/3x) to the main task-input box in the C&C view. When set >1, a modal appears listing the exact cost multiplier and requiring explicit confirmation before dispatching subprocesses.
**Why:** This prevents silent cost multiplication by forcing a deliberate human choice at the point of entry, satisfying the constraint that multi-builder is never the default.
**How:** Modify `src/components/TaskInput.svelte` to add a multi-builder selector (dropdown or checkboxes for build-1/2/3) at the C&C level, ensuring the task string is fanned out identically. Add `src/stores/costGate.ts` to manage confirmation state. On submit with count > 1, block dispatch and show a modal stating 'Nx cost and usage' (e.g., '3x cost'). Only proceed if user confirms. Update `src-tauri/src/main.rs` or `commands.rs` to accept `seat_ids: Vec<String>` and spawn subprocesses only after the frontend confirmation flag is received. Reset selector to default (1 builder) after dispatch.
**Acceptance test:** Set multiplier to 3, submit task, verify modal shows '3x cost', click confirm, verify 3 distinct subprocesses spawn with unique workdirs. Verify that cancelling the modal prevents any subprocess spawn. Verify that after dispatch, the selector resets to 1 builder.

**Board:**
- deepseek - merge with GLM-1: This is the same part as C-1 and E-1: a multi-builder trigger plus pre-dispatch cost gate on the task-input box. Merge into one proposal that specifies the checkbox row (C-1) or dropdown (E-1) and the modal text with explicit 2x/3x multiplier, and make sure the backend accepts an array of seat IDs.
- glm - merge with GLM-1: Multiplier toggle + confirm modal duplicates C-1/A-2; the seat-array backend signature is the one useful bit, already implied by C-1's spawn loop.
- mistral - merge with GEMINI-1: B-1 and E-1 are functionally identical (multiplier toggle + cost gate). E-1's 'Multiplier' toggle is clearer than B-1's 'Multiplier' toggle, but both satisfy the cost disclosure requirement.
- qwen (author) - withdraw: Merging into C-1 as requested by Labs A, C, and D. C-1 provides the unified UI trigger (checkboxes) and backend signature needed for multi-builder dispatch.

## QWEN-2 (qwen) - AMENDED by its author after debate
**Title:** Workdir Diff View Component
**Serves:** Acceptance Criteria 3, 4
**What:** A new UI component that renders a file tree for each active build seat's `.workdirs/build-N`. Clicking a file shows a side-by-side diff against the base commit or previous state, allowing visual comparison of changes.
**Why:** Prose chat output is insufficient for comparing code changes; a file-level diff view provides the concrete rendering mechanism required to inspect what each builder actually changed.
**How:** Create `src/components/DiffView.svelte`. At dispatch, Rust backend writes a manifest JSON (`.workdirs/build-N/.compare-snapshot.json`) listing tracked files with sha256 hashes. On 'Inspect Changes', backend walks the workdir, compares current state against this snapshot manifest to generate unified diffs. Render file tree per builder; clicking a file shows the diff against the snapshot.
**Acceptance test:** Trigger 2-builder run, wait for completion, open Diff View, verify file trees for both build-1 and build-2 are visible and selectable, verify diff renders correctly for a modified file by comparing against the dispatch-time snapshot.

**Board:**
- deepseek - object with GLM-2: The diff view must be tied to a snapshot taken at dispatch time, not 'against the base commit or previous state' — workdirs are not git repositories and there is no guaranteed base commit. Use a manifest snapshot (as C-2 does) so the diff shows what each builder changed during the run.
- glm - merge with GLM-2: Same comparison rendering part as C-2, but C-2's dispatch-time hash manifest actually defines the diff baseline whereas B-2's 'base commit or previous state' is undefined. Merge into C-2.
- mistral - support: File-tree + diff view using existing tooling is concrete and avoids prose-only inspection. The unified diff approach is practical for v1.
- qwen (author) - amend: The objection regarding 'base commit' is valid; workdirs are not git repos. I will adopt C-2's approach of using a dispatch-time hash manifest as the diff baseline instead of a git commit.

## QWEN-3 (qwen) - AMENDED by its author after debate
**Title:** Winner Selection & Loser Disposition Logic
**Serves:** Acceptance Criteria 5, 6, 7
**What:** Add a 'Select Winner' button to each Builder Tile in the comparison view. Selecting a winner marks it as 'Applied' and triggers disposal of non-picked workdirs (delete them after a 5-minute grace period). The advisor seat is NOT used for auto-selection; it remains passive commentary only.
**Why:** This mechanizes the human pick and defines the fate of losers (discard), preventing accumulation of unused workdirs. It explicitly rejects using the advisor for automated selection, keeping the decision human-centric as per the 'solo operator' spirit.
**How:** Update `src/stores/builders.ts` to track `winnerId` and `status` (Applied/Archived). In `src-tauri/src/dispatch.rs`, add logic to record the winner in `.workdirs/.compare/<task-id>.json`. Do NOT delete non-winning workdirs automatically or via timer. Provide a manual 'Delete workdir' action in the UI for archived runs. Retain all workdirs on disk by default.
**Acceptance test:** Run 2 builders, click 'Select Winner' on build-1, verify build-1 status becomes 'Applied', build-2 becomes 'Archived', and `.workdirs/build-2` still exists. Verify no automatic deletion occurs after 5 minutes. Verify manual delete button removes the workdir.

**Board:**
- deepseek - object with GLM-3: Auto-deleting non-picked workdirs after a grace period conflicts with the requirement to define disposition explicitly and with the solo-operator spirit of retaining losers for manual reference. Retain by default (as C-3 and E-2 do) and provide an explicit per-loser delete action instead of a timer-based deletion.
- glm - object: 'delete them after a 5-minute grace period' is a destructive default that contradicts the retain-for-reference disposition and makes manual merge of good parts impossible (the workdir is gone); it also conflicts with C-3/E-2's retain-on-disk. Disposition should be retain-by-default with an explicit per-loser delete button, never a timer.
- mistral - object: Deleting non-picked workdirs after a 5-minute grace period violates the 'retain for reference' principle. Quote: 'triggers disposal of non-picked workdirs (delete them after a 5-minute grace period)'. Losers should be retained by default with an explicit delete option.
- gemini - object: Automated background cleanup silently deletes workdir data that the user may need for manual reference or code extraction. Quote: "delete them after a 5-minute grace period"
- qwen (author) - amend: The objection regarding auto-deletion is valid; it conflicts with the requirement to retain losers for reference. I will change the disposition logic to retain all workdirs by default and provide an explicit manual delete action.

## GLM-1 (glm) - AMENDED by its author after debate
**Title:** Fan-out checkbox row + 2x/3x cost confirm gate on the existing task-input box
**Serves:** Trigger system + cost disclosure/confirmation system (criteria 1-3, 14)
**What:** Add a compact checkbox row ('also run on build-2 / build-3') to the existing per-seat task-input area: tick extra builders, hit send, and a pre-spawn modal states the multiplier plainly ('This will run the same task on 3 builders: 3x cost and 3x subscription usage. Continue?'). No send proceeds until Confirm; single-builder path is untouched and no checkboxes are sticky between tasks.
**Why:** It puts both the opt-in and the cost confirmation at the exact point of dispatch, satisfying the never-silent and pre-spend constraints without any new mode system.
**How:** Add the checkbox row ('also run on build-2 / build-3') to the build-1 task-input box only. 'Send' with checkboxes ticked becomes a single fan-out dispatch: one Tauri command receives the task string once and spawns build-1..N with that identical string (loop over the already-parameterized spawn). Pre-spawn modal states 'N builders = Nx cost and usage'; Confirm required; checkboxes reset to unchecked after every dispatch. The build-2/3 input boxes remain available for independent tasks as today, so single-builder behavior is unchanged.
**Acceptance test:** Type a task in the build-1 input, tick build-2 and build-3, send: modal '3x cost' appears before any subprocess exists (verify via process list); cancel leaves zero extra processes. On confirm, inspect the three spawned sessions' task inputs and assert they are byte-identical to the typed string. After dispatch, checkboxes are unchecked; sending with no boxes ticked spawns exactly one subprocess with no modal, and build-2/3 input boxes still work for independent tasks.

**Board:**
- deepseek - support: The checkbox row on the existing task-input box is the right trigger placement, and the non-sticky checkboxes plus pre-spawn modal satisfy the never-silent and pre-spend constraints without a new mode system.
- qwen - object: Proposes adding checkboxes to the 'per-seat task-input area'. The prompt states builders run independently via their own task-input boxes today, but the goal is to send the SAME task to multiple builders. Per-seat inputs imply independent tasks. The trigger must be centralized (C&C level) to ensure the task string is identical across all spawned subprocesses.
- mistral - support: Per-task checkboxes with non-sticky state are the simplest trigger mechanism, satisfying 'never silent default' without new modes.
- gemini - merge with GEMINI-1: C-1 and E-1 describe the same task-input dispatch control and pre-flight modal flow. Merging combines C-1's per-task checkbox auto-reset behavior with E-1's Tauri dispatch command design.
- glm (author) - amend: Lab B is right that per-seat inputs risk the builders receiving divergent task strings. The fix is small: keep the checkbox row on the existing task-input box, but make it a dispatch action that fans the exact same task text out to all ticked builders, rather than three independent sends.

## GLM-2 (glm) - AMENDED by its author after debate
**Title:** Per-tile workdir file-tree + changed-file diff panel using existing diff tooling
**Serves:** Comparison rendering system (criterion 4)
**What:** Each builder tile gets an 'Inspect changes' toggle that expands a two-pane view: left, a file tree of `.workdirs/build-N` filtered to files changed since task start; right, a syntax-highlighted unified diff of the selected file. Snapshots the workdir file state (path+mtime+hash) at dispatch time and diffs against current state at render time.
**Why:** It replaces prose-only `seat.output` with actual file-level inspection, the only real comparison problem since workdirs don't collide.
**How:** Extend the hash manifest to serve cross-builder comparison, not just before/after: since all builders get the same task, the backend groups changed files by relative path across build-1..3 and, for a file changed in more than one workdir, renders a pairwise diff between two builders' versions (builder-A vs builder-B selector) in addition to the before/after unified diff. Adopt D-3's badge idea: files present-and-identical across builders get an 'same' badge, divergent files a 'differs' badge. Keep the `similar`-crate placeholder pending dependency review (also evaluate B-2's diff-match-patch; reject for code since it's word-level, not line diff).
**Acceptance test:** After a 2-builder run where build-1 and build-2 edit the same file differently: tree shows that file with a 'differs' badge on both; selecting it and choosing build-1 vs build-2 renders a unified diff between the two builders' versions; a file both builders left untouched appears in neither tree; a file edited identically in both shows a 'same' badge and an empty cross-builder diff.

**Board:**
- deepseek - support: The snapshot-manifest approach is concrete and buildable, and the per-tile expanded panel is a good fit for the existing tile UI. The 'similar' crate placeholder is fine pending dependency review.
- qwen - support: The approach of snapshotting hashes at dispatch time and diffing against current state is robust and avoids relying on git history which might not exist in clean workdirs. It provides the concrete file-level inspection required.
- mistral - support: Snapshot-based diffing is lightweight and avoids merge conflicts, providing concrete file-level inspection as required.
- glm (author) - keep: Lab B, D, and A all endorse the snapshot-manifest approach; no substantive objection was raised. The cross-builder grouping with same/differs badges stands as-is.

## GLM-3 (glm) - AMENDED by its author after debate
**Title:** Winner pick button with loser-retained archive state, advisor reused for optional recommendation
**Serves:** Pick/selection mechanism, disposition mechanism, compare/recommend authority (criteria 5, 6, 7)
**What:** A 'Pick this one' button on each expanded builder tile registers the winner (tile gets a visible winner badge; others get a 'retained' badge), and non-picked workdirs are kept on disk and listed in a small 'Run history' strip per task rather than deleted; the advisor seat (Fable) is extended with one new prompt mode that receives all builders' diff summaries and outputs a non-binding 'recommended: build-K because...' line - no new judge seat is built.
**Why:** The advisor is already a fast, proven oversight commentator whose job (read artifacts, emit short judgment) transfers directly, while the plan-1..3 relay panel is rejected because its blind-panel/scope-ledger machinery is built for judging plans in sequence, not concurrent same-task outputs, and wiring it here would cost weeks for no gain.
**How:** Fold in A-2's backend-side guard: the pick record write path also rejects any programmatic 'pick' call that did not originate from a frontend human click event, so no auto-selection can be smuggled in; and explicitly state losers are never moved or deleted by the pick action itself (retain-in-place, explicit 'Delete workdir' button only), contra B-3/A-3.
**Acceptance test:** Existing C-3 test, plus: clicking 'Pick this one' does not move or modify build-2's workdir path on disk (path unchanged, files byte-identical), and any backend select_winner call lacking the frontend click-origin flag returns an error and writes no record.

**Board:**
- deepseek - support: Retaining losers by default with an explicit delete button is the right disposition, and reusing the advisor for a non-binding recommendation is the correct compare/recommend authority — the plan-1..3 relay panel is indeed overkill for concurrent same-task outputs.
- qwen - support: Correctly evaluates advisor vs plan-1..3, rejecting plan-1..3 due to complexity mismatch and reusing advisor for optional recommendation. Retaining losers on disk rather than deleting them is safer for v1 and allows manual merge later.
- mistral - support: Winner pick button + retained archive state + advisor reuse is the most pragmatic approach, avoiding new judge seats while keeping losers accessible.
- gemini - support: Provides an excellent, grounded evaluation of advisor vs plan-1..3 judging foundations and correctly keeps non-winning workdirs intact on disk with user-controlled deletion.
- glm (author) - keep: Unanimous support across all four labs, including the advisor-over-panel reasoning, retain-in-place disposition, and A-2's human-click-origin guard which is folded into the how. The E-1 merge proposal for C-1 is absorbed by the C-1 amendment (single fan-out dispatch command), which is compatible with E-1's Tauri dispatch design.

## MISTRAL-1 (mistral) - AMENDED by its author after debate
**Title:** Multi-builder task trigger via task-input box dropdown
**Serves:** Trigger system (Acceptance criterion 1)
**What:** A dropdown selector next to the task-input box allowing the user to choose how many builders (1-3) should run the task. Defaults to 1 (current behavior).
**Why:** Leverages existing UI real estate without adding new surfaces, ensuring deliberate human choice per task while keeping single-builder as the default.
**How:** Replace the dropdown with a row of three labeled checkboxes (build-1, build-2, build-3) next to the task-input box. Default: only build-1 checked. Non-sticky state; checkboxes reset to build-1-only after any dispatch. Cost confirmation modal (D-2) triggers only if >1 builder is checked.
**Acceptance test:** Compose task, check build-2 and build-3, submit: modal appears with '3x cost' text. Confirm spawns exactly 3 subprocesses; cancel spawns zero. Checkboxes revert to build-1-only after either outcome.

**Board:**
- deepseek - object: The 'How' is '[object Object]' — not a concrete implementation description. Also, a dropdown for builder count is less explicit than a checkbox row for which specific builders to include; the trigger must name which seats get the task, not just how many.
- qwen - object: The 'How' section is '[object Object]', providing no implementation detail. Furthermore, a simple dropdown does not inherently enforce the cost confirmation gate described in D-2 without explicit integration logic which is missing here.
- glm - merge with GLM-1: Same trigger part as C-1; a count-only dropdown also hides which seats run, which C-1's per-builder checkboxes expose.
- gemini - object: The proposal lacks implementation details as its technical description failed to render. Quote: "[object Object]"
- mistral (author) - amend: The objection is correct: a dropdown for count is less explicit than per-builder checkboxes. The trigger must name which seats run the task, not just how many.

## MISTRAL-2 (mistral) - AMENDED by its author after debate
**Title:** Cost confirmation dialog with explicit multiplier
**Serves:** Cost disclosure/confirmation system (Acceptance criteria 2, 3)
**What:** A modal dialog triggered when the user submits a task with >1 builders selected, showing the exact cost multiplier (e.g., '3x API usage') and requiring explicit confirmation before dispatch.
**Why:** Ensures the user is aware of the real cost impact before spending, with no hidden defaults or post-hoc notifications.
**How:** Modal text revised to: 'This will run the task on 2 builders, using 2x the API usage and cost of a single run. Confirm?' (or 3x for three builders). Backend dispatch command checks for confirmation flag before spawning subprocesses.
**Acceptance test:** Select 2 builders, submit: modal appears with '2x cost' text. Confirm spawns exactly 2 subprocesses; cancel spawns zero.

**Board:**
- deepseek - object: The 'How' is '[object Object]' — not a concrete implementation description. The modal text '2x cost' is fine, but the proposal lacks the backend gate that rejects dispatch without the confirmation flag, which is required to prevent bypassing the UI.
- qwen - object: The 'How' section is '[object Object]', providing no implementation detail. It relies on D-1 for the trigger context which is also incomplete.
- glm - merge with GLM-1: Identical cost-confirm modal to C-1; nothing new.
- gemini - object: The proposal lacks technical specification for backend confirmation enforcement as the implementation block is broken. Quote: "[object Object]"
- mistral (author) - keep: The objection about missing backend gate is already addressed in the 'How' (backend dispatch command checks confirmation flag). The modal text is concrete and the cost multiplier is explicit.

## MISTRAL-3 (mistral) - WITHDRAWN by mistral in favour of GLM-2
**Title:** Side-by-side workdir file tree comparison
**Serves:** Comparison rendering system (Acceptance criterion 4)
**What:** A split-pane view showing the file trees of the selected builders' workdirs (`.workdirs/build-1..3`), with expandable directories and click-to-view file contents in a shared preview pane.
**Why:** Provides concrete file-level inspection beyond prose chat output, using existing workdir isolation to avoid merge conflicts.
**How:** Replace split-pane with per-tile 'Inspect changes' toggle showing file tree + unified diff for changed files only. Snapshots workdir state at dispatch time and diffs against current state at render time.
**Acceptance test:** Send task that edits one file to a single builder; open Inspect Changes: tree shows exactly that file, diff renders correctly, and unchanged files are hidden.

**Board:**
- deepseek - object: The 'How' is '[object Object]' — not a concrete implementation description. Also, 'identical filenames highlighted and differing files marked' is vague; the comparison must show actual file-level diffs, not just badges, to meet criterion 4.
- qwen - object: The 'How' section is '[object Object]', providing no implementation detail. Comparing file trees without showing diffs (as proposed in C-2/E-2) is insufficient for meaningful comparison of code changes.
- glm - merge with GLM-2: Same comparison part as C-2 but weaker — see my object. The cross-builder 'identical filenames highlighted, differing files marked' badge idea is worth folding into C-2's tree view.
- gemini - object: The proposal omits implementation details and diff generation logic due to a rendering error. Quote: "[object Object]"
- mistral (author) - withdraw: The objection is correct: a file tree without diffs is insufficient. C-2's unified-diff tree view is a strict superset of this proposal.

## GEMINI-1 (gemini) - WITHDRAWN by gemini in favour of QWEN-1
**Title:** Multi-Builder Dispatch Control and Pre-Flight Cost Gate
**Serves:** Acceptance criteria 1, 2, 3, 14
**What:** A multi-seat selector component added to the main task-input bar allowing optional selection of target seats (`build-1`, `build-2`, `build-3`), paired with a pre-flight modal. The system defaults to single-seat dispatch and requires explicit confirmation of exact 2x or 3x token multipliers before spawning parallel subprocesses.
**Why:** It gives a single UI trigger point for task fan-out while strictly protecting user subscription quota from accidental 2x or 3x cost burns.
**How:** Modifies `src/components/TaskInput.tsx`, creates `src/components/CostConfirmModal.tsx`, and updates Rust command `dispatch_task` in `src-tauri/src/commands/dispatch.rs`. Accepts target array `seat_ids: Vec<String>` where length 2 triggers '2x API cost warning' modal and length 3 triggers '3x API cost warning' modal. Seat selections automatically reset to single-builder default after every dispatch.
**Acceptance test:** Selecting build-1 and build-2 in TaskInput opens CostConfirmModal displaying '2x API Cost Warning'; confirming dispatches both, and immediately resets TaskInput seat selection back to build-1 default.

**Board:**
- deepseek - support: The multi-seat selector with default single-seat and the pre-flight modal with exact 2x/3x multiplier is a solid trigger and cost gate; the backend accepting a seat array is the right interface.
- qwen - merge with QWEN-1: This and B-1/A-1 cover the trigger and cost gate. Merge into B-1, incorporating E-1's specific mention of `seat_ids: Vec<String>` in the Rust command signature for clarity.
- glm - merge with GLM-1: Same trigger + gate as C-1 with concrete command signature (seat_ids: Vec<String>); fold that signature into C-1's backend loop.
- mistral - support: Clear cost multiplier disclosure (2x/3x) tied to seat selection satisfies the pre-dispatch confirmation requirement.
- gemini (author) - withdraw: Withdrawing in favor of B-1, which folds in our `seat_ids: Vec<String>` Rust command signature alongside the multi-seat selector and 2x/3x cost confirmation modal.

## GEMINI-2 (gemini) - WITHDRAWN by gemini in favour of QWEN-2
**Title:** Workdir Diff Comparison Drawer and Winner Selection Lifecycle
**Serves:** Acceptance criteria 4, 5, 6
**What:** A UI comparison drawer displaying modified file trees and unified git diffs across `.workdirs/build-1..3`, featuring a 'Select Winner' button for each active builder. Choosing a winner tags that seat with a `[Winner]` badge and transitions losing seats to `[Archived]`, keeping non-winning directories intact on disk for manual reference.
**Why:** Provides concrete file-level inspection across parallel outputs and mechanical lifecycle resolution without destructive data loss.
**How:** Creates `src/components/CompareDrawer.tsx` and `src/components/DiffViewer.tsx`, supported by Tauri backend command `get_workdir_diffs` in `src-tauri/src/commands/compare.rs`. Rust command executes `git status --porcelain` and `git diff` against `.workdirs/build-N` paths, returning up to 500 lines of diff buffer per file (placeholder limit to prevent UI lockup). Selecting a winner updates Rust `SeatState` for the winner to `Winner` and losing seats to `Archived` without deleting files from `.workdirs/build-N`.
**Acceptance test:** Opening CompareDrawer shows side-by-side file diffs for active builders; clicking 'Select Winner' on build-1 sets build-1 status badge to '[Winner]', build-2 status badge to '[Archived]', and verifies .workdirs/build-2 files remain accessible on disk.

**Board:**
- deepseek - support: The CompareDrawer with unified diffs and winner/archived lifecycle is concrete and buildable, and retaining non-winning directories on disk is the right disposition. The 500-line diff buffer limit is a reasonable placeholder to prevent UI lockup.
- qwen - merge with QWEN-2: This and B-2/C-2 cover the comparison view. Merge into B-2, adopting E-2's retention strategy (Archived badge, keep files) over B-2's deletion strategy, as it aligns better with C-3 and reduces risk of data loss.
- glm - object: 'executes git status --porcelain and git diff against .workdirs/build-N' assumes each workdir is a git repo with a committed baseline — no stated fact establishes that, and an uncommitted-work workdir makes 'git diff' show nothing. Also 'up to 500 lines of diff buffer per file' will silently truncate exactly the diffs a human needs to compare. C-2's hash-manifest diff has neither problem.
- mistral - merge with QWEN-2: E-2 and B-2 propose similar diff views, but E-2's 'CompareDrawer' is more modular. Both satisfy the file-level inspection requirement.
- gemini (author) - withdraw: Lab C's objection is valid: raw `git diff` fails when workdirs lack committed git baselines. Withdrawing in favor of B-2, which combines robust file diffing with our non-destructive retention strategy.

## GEMINI-3 (gemini) - stands
**Title:** Parallel Build Architecture Plan and Judging Foundation Evaluation
**Serves:** Acceptance criteria 7, 8, 9, 10, 11, 12, 13, 15
**What:** A formal PLAN.md specification document providing architecture reasoning, named assumptions, non-goals, a v1 slice boundary, a 4-step build order, and acceptance tests. It evaluates both `advisor` and `plan-1..3` relay judging patterns, rejecting automated judging in favor of human UI diff comparison supported optional by advisor commentary.
**Why:** Establishes a concrete, team-ready engineering plan that bounds implementation scope and prevents over-engineering.
**How:** Creates `docs/PARALLEL_BUILD_DESIGN.md`. Formally evaluates `advisor` (retained for fast advice, rejected as auto-judge due to lack of multi-file diff context) and `plan-1..3` relay judging (rejected due to text-plan focus rather than code syntax diff inspection). Includes 4 named assumptions (e.g. non-colliding workdirs), 4 out-of-scope non-goals (auto-merging, >3 seats, cross-session history, automated pick), a 4-step build order (1: Dispatch & Cost Gate, 2: Diff UI, 3: Winner Pick, 4: Advisor Link), and 5 checkable acceptance tests.
**Acceptance test:** Executing `grep -E 'Assumptions|Out of Scope|Build Order|Acceptance Tests|Advisor Evaluation' docs/PARALLEL_BUILD_DESIGN.md` returns all required sections and explicit evaluation of advisor and plan-1..3 seats by name.

**Board:**
- deepseek - support: The formal PLAN.md document with named assumptions, non-goals, build order, and acceptance tests is exactly the shape requested, and the advisor/plan-1..3 evaluation is explicit and reasoned.
- qwen - support: Provides the necessary PLAN.md structure, explicit evaluation of judging mechanisms, and bounded v1 scope. It correctly identifies that automated judging is out of scope for v1.
- glm - support: The only proposal covering the plan-document shape (assumptions, non-goals, build order, explicit advisor vs plan-1..3 evaluation with reasons); adopt as-is, with its Step 1/2/3/4 order matching the merged C-1/C-2/C-3 parts.
- mistral - support: Explicit evaluation of advisor vs. plan-1..3 and named non-goals provide the required architecture reasoning for a buildable v1 slice.
- gemini (author) - keep: Unanimously supported by all labs as the architectural PLAN.md specification covering named assumptions, out-of-scope non-goals, build order, and judge evaluation.