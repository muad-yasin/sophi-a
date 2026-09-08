# BOARD.md - the debate behind PLAN.md

Six labs (DeepSeek, Qwen, GLM, Mistral, Gemini, Kimi K3) each proposed up to six buildable parts
blind against the skeleton, then read each other's proposals anonymised and posted
support/object/merge; each author then kept, amended or withdrew. 121 posts total, 36 replies, 14
proposals withdrawn, 19 amended.

## What the debate actually settled

- The advisor seat is fixed to Fable 5.1 with no Sonnet-5 fallback (glm's own C-2 draft proposed a
  conditional fallback; deepseek, gemini and kimi all objected and glm amended) - a real
  correction: a silent fallback would have meant "advisor" quietly became a second Sonnet seat.
- A fixed WebSocket port (several labs' first drafts used 8765 or 7700) was rejected in favour of
  an ephemeral-port handshake (glm's C-5, seconded by deepseek/mistral/gemini/kimi) - the concrete
  failure mode named was a second concurrent launch colliding on a fixed port.
- React was proposed twice (qwen's B-4, gemini's E-1) and both times objected to and
  withdrawn/cut in favour of a vanilla-TypeScript frontend (kimi's F-3), on dependency-surface
  grounds.
- A commercial-terms-risk *script* that exits nonzero until legal terms are acknowledged (gemini's
  E-5) was objected to by glm and kimi: it would block the unsupervised HANDOFF build on an
  unresolvable legal flag. The surviving version (kimi's F-5) is documentation-only and gates only
  commercial release, not development.
- Several proposals (mistral's D-1, D-2, D-4, D-5, D-6) shipped with a literal corrupted
  `"[object Object]"` in their How field; every other lab caught this independently and the
  affected proposals were withdrawn or absorbed rather than built as written.

## Panel history across three rounds, and the post-hoc addendum

- Round 1: 3/6 signed off; qwen, gemini and kimi failed the draft for *describing* HANDOFF.md and
  BOARD.md instead of producing them, and kimi additionally flagged an incomplete Scope-additions
  table. Fixed in round 1's revision.
- Round 2: 4/6 signed off; qwen failed the draft for naming "Claude Code subprocess" as a label
  without a buildable mechanism; glm and kimi failed it for claiming reuse of relay's "chain/
  provider backend" while only using `src/providers.js`. Fixed in round 2's revision (concrete
  stream-json protocol; plain statement that only `src/providers.js` was reused).
- Round 3 (round cap): 5/6 signed off; **glm alone dissented, on the same point across all three
  rounds** - that "reuse relay's backend as its orchestration engine" should include relay's CLI,
  not only `src/providers.js`. The run ended at the round cap with this open.
- **2026-09-09, out of band:** the author reviewed glm's objection, agreed with it, and decided
  `plan-1..3` should genuinely run relay's CLI (real relay chains), reversing Anthropic-only for
  those three seats specifically. Recorded as an Addendum to PLAN.md, not a fourth chain round (the
  round cap was already spent).
- **2026-09-09, panel-only regrade** (`relay/runs/2026-09-08T23-33-33-206Z/`): the addendum was
  regraded against the same 13 criteria. GLM's criterion-1 objection did not recur - confirmed
  resolved. All six labs instead flagged criterion 3 ("Anthropic-only") as now violated - expected
  and disclosed in PLAN.md's own Disputed section, not a new defect. No other criterion regressed.
- **2026-09-09, second board override:** the author explicitly re-authorized moving from planning
  to the build phase (a separate decision from the planning override) - see PLAN.md's Status
  section.

## Full scope ledger

- A-1 - accepted - merged with B-1 into "Repository shape".
- A-2 - accepted - merged into "Orchestrator core"/"Status/event model".
- A-3 - accepted - merged into "Seat registry".
- A-4 - accepted - merged into "Desktop shell and UI".
- A-5 - accepted - merged into "Bridge/IPC".
- A-6 - accepted - merged into "HANDOFF artifact".
- B-1 - accepted - merged with A-1 into "Repository shape".
- B-2, B-3, B-4, B-5, B-6 - withdrawn - by qwen, each in favour of the matching kimi (F-series) proposal.
- C-1 - accepted - "Orchestrator core".
- C-2 - accepted - merged into "Seat registry".
- C-3 - accepted - merged into "Status/event model".
- C-4 - accepted - merged into "Desktop shell and UI".
- C-5 - accepted - "Bridge/IPC" ephemeral-port mechanism.
- C-6 - withdrawn - by glm, split into F-5 and F-4.
- D-1, D-2 - cut - fully absorbed into F-2/C-3 and F-2/C-5 respectively.
- D-3 - withdrawn - by mistral in favour of F-1.
- D-4 - accepted - merged into "Orchestrator core".
- D-5, D-6 - withdrawn - by mistral in favour of F-3 and F-5 respectively.
- E-1 - cut - conflicted with the accepted vanilla-TypeScript shell.
- E-2, E-4, E-6 - withdrawn - by gemini in favour of F-1, F-3, F-4 respectively.
- E-3 - withdrawn - by gemini in favour of D-1 (itself absorbed into F-2/C-3).
- E-5 - withdrawn - by gemini in favour of F-5.
- F-1 - accepted - "Seat registry" in full.
- F-2 - accepted - "Status/event model" and sidecar mechanism.
- F-3 - accepted - "Desktop shell and UI" in full.
- F-4 - accepted - becomes HANDOFF.md.
- F-5 - accepted - "Commercial terms risk" in full.
- F-6 - accepted - PLAN.md/BOARD.md structure.
