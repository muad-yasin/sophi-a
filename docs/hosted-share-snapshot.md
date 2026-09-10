# Shareable Council-run snapshot — design doc (Phase 4, Step 2)

**Status: DRAFT — not implemented. See HUMAN STOP at the end.**

## What this is

A "Share this run" button that exports a finished Council debate (the same data Phase 3's replay
already renders — seals, per-lab verdicts, verbatim objections) as a standalone, static HTML
page, uploaded to a public bucket, with a link the user can post anywhere. Social proof for a
real unanimous sign-off — the honest kind, since every value on the page is a real
`report.json`, not a mockup.

## Design

- **Generation:** reuses Phase 3 Step 2's replay renderer in "static export" mode — the same
  `renderDebatePanel`-derived markup, minified to a single self-contained HTML file (inline CSS,
  no external JS dependency, so the shared page works even if the hosting bucket has no build
  pipeline behind it).
- **Storage:** a public object bucket (Cloudflare R2, chosen for the same zero-ops reasoning as
  the trial proxy, and to share one hosting vendor rather than two) — one file per shared run,
  keyed by a random slug, e.g. `share.sophi-a.example/run/<slug>.html`.
- **Metadata:** OpenGraph tags (`og:title`, `og:description` naming the sign-off result,
  `og:image` — a static generated card, not a live screenshot, to avoid a runtime rendering
  dependency) so the link previews well when pasted into Discord/X/etc.
- **Honesty requirement carried over from Phase 3:** the exported page is explicitly labelled
  "recorded run, not live" — the same rule that governs the in-app replay banner applies here,
  since a shared static page is even further from "live" than an in-app replay.
- **Client change:** a "Share" button next to Phase 3's existing "Export"/"Copy as Markdown"
  buttons on the Debate panel; on click, uploads via a small authenticated endpoint (not a
  direct-to-bucket client upload, to avoid embedding bucket write credentials in the shipped app —
  same key-exposure discipline as the trial proxy).

## What this does NOT need

No database, no user accounts, no moderation queue for this pass — a shared run is immutable once
posted (matches "the receipt stays in the run folder" framing already used in the product's own
copy) and abuse surface is limited to "someone shares an embarrassing refusal," which is the
product's own transparency working as designed, not a bug to guard against.

## Cost

**Week+** — template generator, R2 bucket setup, the small upload-auth endpoint, and rate
limiting on uploads (a runaway client bug spamming uploads is the realistic failure mode here,
not malicious abuse).

## HUMAN STOP — DO NOT PROCEED

No implementation starts until the owner approves this design and provisions the R2 bucket (or
chosen alternative) themselves.
