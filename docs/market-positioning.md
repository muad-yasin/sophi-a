# Market positioning — 2026-09-09

*Written from a sower-industries session, at the author's request, after a quick market pass
prompted by wanting to make Sower Industries "prettier" using SMO's visual identity - that
conversation surfaced a bigger question (how does Sophi-A actually compare to what's already
out there), which is what this file answers. Standing direction going forward, the author's own
words: sower-industries.de keeps developing as the website/showcase for the whole project
portfolio; Sophi-A keeps developing, in its own session, as one of the core products.*

## The market, as of this pass (real competitors, not guesses)

Two real, current products landed on the same category: **parallel-session managers** for
existing coding agents (Claude Code/Codex), each session isolated in its own git worktree.

- **conductor.build** — Mac-only (Windows waitlisted). Free individual tier; Pro is $50/mo
  (cloud workspaces, multiplayer up to 5, API, mobile app); Teams $60/user/mo. Works with Claude
  Code, Codex, and Cursor as backends. Own guidance: 3-5 parallel workspaces is the sweet spot.
- **Nimbalyst** (formerly Crystal, Stravu; renamed Feb 2026) — free, open source, genuinely
  cross-platform (Mac/Windows/**Linux**), kanban task tracking, inline diff review, an **iOS
  companion app for remote session monitoring**. This is the one to actually worry about: it
  makes the same three claims Sophi-A makes (free, open source, cross-platform).

Neither is a small/toy project - both are real, maintained, currently-marketed products with
that free/open-source claim already staked out. If Sophi-A gets pitched as "another
parallel-session manager," it's late to a category with a mature free incumbent (Nimbalyst)
already covering Mac/Windows/Linux plus mobile monitoring.

## The actual differentiator, and it's real

Neither competitor does what Sophi-A's `plan-1..3` seats do: a real relay chain in which models
from several labs critique a plan *before a single line of code exists*. Conductor and Nimbalyst
run N copies of the *same* agent in parallel and let a human pick the best result after the fact
- that is redundancy, not adversarial review. Sophi-A's real pitch is not "run more agents at
once," it is **other labs' models arguing about what to build, before anything gets built.** The
author's own framing, and the reason this has looked like a real product from the start: this is
a genuinely new mechanism, not a UI variation on what conductor.build/Nimbalyst already do.

> **Precision note, 2026-09-09 (same day, second session, checked against the code):** the
> paragraph above originally read "multiple labs independently proposing and critiquing" and
> "seven labs arguing." Both overstate what a plan seat actually runs. `seats.json` gives
> `plan-1..3` the `plan-cheap` chain (there is no per-task chain override in the orchestrator's
> `start` command - changing it means editing `seats.json`), and `relay/chains/plan-cheap.json`
> is: one Anthropic Sonnet 5 builder drafts, five cheap critic seats from *other* labs (Qwen via
> Together, GLM via Z.ai, Cohere, Gemini, Llama via OpenRouter) grade it blind, Sonnet revises,
> up to 5 rounds. That is real cross-lab *adversarial critique* - the differentiator stands - but
> it is one proposer, not many. The "labs propose blind, then debate each other" mechanism is
> relay's `plan-debate` chain, which is real (it produced this repo's own `PLAN_PACKAGING.md` and
> `PLAN_PARALLEL_BUILD.md`, see `BOARD_*.md`) but is not what a plan seat runs by default. Lab
> count: six labs total in either chain (Anthropic plus five), matching `BOARD.md`'s own "six
> labs" - not seven. Neither correction weakens the claim; the mechanism is genuinely real and
> `report.json`'s per-lab `failures` list is the receipt. The claim just has to be stated as what
> the code does.

Right now this is underused in how Sophi-A presents itself - "eight seats, one dashboard" reads
like a Conductor clone from a screenshot. The debate itself (who objected, what got overruled -
the same shape `BOARD.md` already records) is the thing a screen recording of Conductor cannot
show, and isn't yet surfaced as the headline feature.

## Feature ideas that follow from the real gap (not guesswork)

1. **Remote monitoring, mobile or web.** Nimbalyst's iOS app is a real, current competitive gap.
   ~~`src/mcp/server.js` already exposes seat status/output over a WebSocket~~ - **corrected
   2026-09-09 (same day, second session, against the actual code):** `src/mcp/server.js` is an
   MCP server on a *stdio* transport that acts as a WebSocket *client* to the orchestrator
   (`ws://127.0.0.1:<port>`, port read from `os.tmpdir()/sophia-orchestrator-port`). It exposes
   nothing a browser or phone could connect to, and MCP-over-stdio is not a transport a remote
   client would speak. The reusable seam is the **orchestrator's own WebSocket protocol**
   (`seat.*` events, `start`/`stop`/`configure`/`start_many` commands in
   `src/orchestrator/index.js`) - which `PLAN_PACKAGING.md` §3 already names as loopback-only
   today and needing to become "a properly authenticated, non-loopback listener" before any
   remote client exists. The MCP server is, at most, a reference implementation of the
   status-cache and replay-race handling a remote view would also need to reimplement - not a
   drop-in. A thin read-only web view (or the "thin mobile client talking to a desktop
   orchestrator" direction `PLAN_PACKAGING.md` named, since native mobile can't spawn the real
   subprocesses) still avoids a rewrite of the *orchestrator*, but it is a real new auth and
   network-exposure surface, not a reuse of existing code.
2. **Surface the debate, don't hide it.** Showing *disagreement* - which lab objected, what got
   overruled - as a first-class UI element (not just a file in the run folder) is the actual
   product demo, and the one thing competitors structurally cannot show.
3. **Cost transparency as a UI element, not a CLI flag.** relay's `dry-run`/`budget.js` pricing
   already exists - surfacing "this plan seat costs ~$0.40 before you run it" directly on the
   seat tile is a real, buildable trust feature; single-provider competitors have no cross-model
   cost story to tell at all.
4. **Inline diff review for the build seats** (`build-1..3`, real Claude Code subprocesses) -
   Nimbalyst already has this for its own sessions. *Checked 2026-09-09 (same day, second
   session): it is missing.* `src/main.ts` has no diff view of any kind; a build tile shows only
   the last event's text. The closest existing piece is `src/orchestrator/compareSnapshot.js`
   (dispatch-time file manifest for the parallel-build feature), which is a per-file
   mtime/sha256 snapshot, not a diff renderer - `PLAN_PARALLEL_BUILD.md`'s item 3 UI is where a
   diff would first appear.

## Marketing, following from the product, not from ad spend

The author's own framing: the best marketing is a good product. Concretely: lead with #2 above
(the debate itself) as the actual demo/screenshot, not "8 tiles glow" - that's what makes this
look like something new rather than a Conductor/Nimbalyst clone. Distribution follows the same
logic: an open-source, BYOK, Apache-2.0 tool gets found via GitHub/HN/r/LocalLLaMA/r/ClaudeAI on
the strength of one honest "here's what it caught that a single model missed" post, not paid
ads - but that post needs #2 to actually be visible in the product first; right now the receipts
exist in the run folder, not on screen.

## Standing direction (the author's own words, this session)

- Cross-platform coverage (the macOS gap specifically - see the harness-prompt draft for a
  macOS packaging/notarization plan, discussed the same session) should be solid *before*
  marketing this project - a product pitched as cross-platform that isn't yet undermines the
  positioning above rather than supporting it.
  > **Unreconciled, 2026-09-09 (same day, second session):** no "harness-prompt draft" and no
  > macOS packaging/notarization plan for Sophi-A exists anywhere that could be found -
  > searched this repo, `~/Projects/sower-industries`, `~/Projects/relay` (including `tasks/`),
  > `~/Projects/Ideas.md`, `~/Projects/FOCUS.md`. The only macOS notarization text in the
  > workspace is `~/Projects/parztream`'s (a different product with its own `packaging/macos/`
  > and `build-macos-app.yml`). `PLAN_PACKAGING.md` scopes Windows and Linux only, never names
  > macOS, and the live shop page (`sower-industries/Docs/SophiAShop_Page.md` §"Platform
  > support") plus this repo's `docs/fulfillment-mails.md` both tell buyers "no macOS build
  > exists yet - don't buy yet." So this bullet asserts a platform commitment nothing else
  > records. Left in place as the author's stated direction, not deleted; whether macOS is
  > actually a precondition for marketing is Muad's call - see `DECISIONS.md`, 2026-09-09.
- sower-industries.de keeps developing as the website/showcase for the whole project portfolio.
- Sophi-A keeps developing, in its own session, as one of Sower Industries' core products - not
  a side experiment.
