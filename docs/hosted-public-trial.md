# Public "try the council on your own idea" endpoint — design doc (Phase 4, Step 3)

**Status: DRAFT — not implemented. Explicitly not started before Step 1's proxy exists. See
HUMAN STOP at the end.**

## What this is

A box on the marketing page (`sower-industries.de/sophi-a/`, and potentially the Golden Path
leaderboard page, since this is also the only honest fix for GP's "loads as an interactive
thing" criterion — see `~/Projects/relay/runs/2026-09-10T19-39-50-690Z/deliverable.md`'s scope
additions) where any visitor types a real task and gets a real Council debate back, live, without
installing anything. This is the natural successor to Phase 4 Step 1's trial proxy — same
mechanism, opened to the public instead of gated to one run per install.

## Dependency

**Requires Step 1's proxy to exist first.** This is not a parallel track: the proxy's per-install
cap and key-holding design is the exact mechanism this endpoint needs, just with the cap changed
from "1 per install, ever" to something rate-limited and renewable (see below). Building this
before the proxy exists means building the proxy twice.

## Design

- **Endpoint:** the same Worker as Step 1, a new route `POST /public-trial` (or the same route,
  gated by a different caller — a design choice for whoever picks this up, not fixed here).
- **Abuse protection (required, not optional):**
  - Rate limit per IP/session: a small number of runs per hour (exact number is a placeholder —
    pricing math against the real per-run cost from `ranked-features.md`'s #2 entry, roughly
    $0.01-0.05/run on cheap-tier critics, sets the real ceiling).
  - A global daily spend cap, separate from Step 1's monthly trial-key cap — a public endpoint
    with no install-id friction is a materially different abuse surface than one download-gated
    trial per machine.
  - A CAPTCHA or equivalent bot-gate is worth considering here specifically (not needed for
    Step 1's install-gated version) since a public text box is a much easier target for scripted
    abuse.
- **Prompt-injection surface (required, not optional):** strangers now submit arbitrary text that
  the same critic models read. This is not a new class of risk — the product's own
  `docs/security-prompt-injection.md` already threat-models model-emitted text reaching the UI —
  but a public submission box is the first time *arbitrary public input* reaches that pipeline
  directly, rather than a paying buyer's own task. The design must state, before implementation:
  what the submitted text is allowed to contain (length caps at minimum), and that critic output
  rendered back to the public visitor goes through the same DOMPurify allowlist Phase 1's
  visualizer already established — no new rendering path that bypasses it.
- **Client:** a public web page (not the desktop app) — this is the one Phase 4 item that is a
  genuinely new surface, not an extension of an existing one, and should probably be scoped as
  its own small static page rather than bolted into the existing marketing site's build.

## Cost

**Days**, on top of Step 1's proxy already existing — the abuse-protection and prompt-injection
work above is the bulk of the estimate, not the endpoint itself, which is a thin wrapper around
Step 1's mechanism.

## HUMAN STOP — DO NOT PROCEED

No implementation starts until the owner approves this design — specifically the rate-limit
numbers, the daily spend cap, and the prompt-injection handling named above — and until Step 1's
proxy is built and running.
