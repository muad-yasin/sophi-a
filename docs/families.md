# Seat families (draft - being built overnight 2026-09-15/16, incomplete)

**Status: WORK IN PROGRESS.** This file is being assembled as Session E (F7/F8/F10) integrates
Sessions A-D's work. Do not treat anything below as shipped until `SophiA-Seat-Families-OVERNIGHT.md`
in `relay/Docs/` says so - that is the authoritative morning status, this is the user-facing doc it
feeds into.

## What a family is

A family is a seat-owned population of worker sessions, behind the `families.enabled` flag
(default off - flipping it on for real is a human gate, see G1 below). Only a human can create a
family (`family_create` requires `humanClick:true`); the owning seat's own model may dispatch into
an existing family and append/check items on that family's `plan.md`, but never create one itself.

Unlike `cnc`'s existing peer-pool fan-out (still the only always-on mechanism), a family belongs to
whichever seat created it - `plan-1`, `build-2`, or any seat with a families.config.json row - not
only `cnc`. The old `fanOut()` guard (`'Fan-out only allowed from cnc seat'`) is preserved
byte-for-byte when the flag is off.

## Lifecycle

States: `created, running, idle, stopped, failed-owned, stuck, holdout, needs-human, unreadable,
interrupted, closed`. See the plan's §2.4 (corrected diagram) for the full transition table.

## Compassion policy

One `restart-with-context` per failure; the second `failed-owned` on the same `planItem` allows
only `escalate-to-human` - `close` is a human-only UI action, never something the automated policy
offers. See `compassionPolicy.js`.

## Caps

Three nested levels - family ≤ seat ≤ global - `min` semantics. Once any turn in a family's
history is unpriced, `$`-headroom is permanently unavailable for that family (a later priced turn
never restores it); admission falls back to the concurrency minimum only.

## Security gate

Every family artifact that becomes actionable (Apply/Forward) requires both `humanClick:true` and
a server-side `NNNN.gate.json` with `result:"pass"` - never a client-side disabled button alone.

## Human-stop gates (binding, not defaults)

- **G1** - flipping `families.enabled` on in any non-test config, and setting real cap values.
- **G2** - the first paid family turn of any kind.
- **G3** - merging any of F0-F10 into `master`.
- **G4** - dispatching into a `needs-human` session.
- **G5** - making any family artifact actionable (Apply/Forward).
- **G6** - any change to `RESTRICTED_ARGS`/`SAFE_ENV_KEYS`/`safeEnv()`/the `runtimes` allowlist.
- **G7** - the `DECISIONS.md` reversal entry - Muad's own words or a verbatim chat quote, never
  written by a session on his behalf.
- **G8** - enabling a local Ollama reviewer as the real security-gate seat.

Full source: `relay/Docs/SophiA-Seat-Families-Plan.md`, revised by council at
`relay/runs/2026-09-15T19-57-10-287Z/deliverable.md`.
