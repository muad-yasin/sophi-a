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
