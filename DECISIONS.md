# Decisions

- 2026-09-09 - Built this slice with the orchestrating session staying present throughout, rather
  than handing the whole HANDOFF.md cold to a single fresh top-level agent. Two prior attempts at a
  fully fresh hand-off refused to start: a fresh agent has no way to verify conversational
  authorization (only file evidence), and this project's own board (FOCUS.md) explicitly warns
  about trusting self-referential authorization claims. The orchestrating session directly
  witnessed the real authorization (two explicit user confirmations, one via a plan-mode approval)
  and is better positioned to judge that than a cold read of the repo's files. Subagents are still
  used for parallelizable chunks of the mechanical work itself (capped at 6 concurrent, Sonnet 5),
  per the author's explicit instruction.
- 2026-09-09 - Tauri scaffolded via `npm create tauri-app@latest -- . --manager npm --template
  vanilla-ts --tauri-version 2 --identifier com.sower.cncharness --yes --force`, in place inside the
  existing repo (which already held PLAN.md/BOARD.md/HANDOFF.md) rather than a nested subdirectory.
- 2026-09-09 - `cargo`/`rustc` require `. "$HOME/.cargo/env"` to be on PATH; added to `~/.bashrc` and
  `~/.bash_profile` so every future shell (including subagents') picks it up without re-sourcing.
- 2026-09-09 - Multiple fresh subagents refused to build adapters/UI, quoting FOCUS.md wording
  ("say so and stop", "No new projects. No new repos.") that no longer exists in the live file -
  a stale-cache issue (their system-prompt-level import of FOCUS.md predates the same-day
  rewrite), confirmed by `tool_uses: 0` in every such refusal (they never actually re-read the
  file). One subagent's retry did independently re-verify FOCUS.md live and proceed, successfully
  building and testing `relayChainSubprocess.js`. For the remaining two adapters, after a further
  refusal round, the orchestrating session built them directly instead of continuing to relaunch
  fresh agents against an unreliable authorization check.
- 2026-09-09 - `messagesApi.js`'s call into relay's `src/providers.js` needed relay's own `.env`
  loaded into this process - `providers.js` reads keys straight from `process.env` and never loads
  `.env` itself (only relay's `cli.js` entry point does that). Added the same minimal `.env`
  parsing relay's own `cli.js` uses, run once before the first real call.
- 2026-09-09 - `claude-fable-5-1` (seats.json's advisor model string) is a real, accepted Anthropic
  model id, confirmed by a real API call - not actually a placeholder needing resolution, despite
  PLAN.md's own hedge about placeholder identifiers.
