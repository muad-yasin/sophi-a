# SHOP.md - retired paid-build offer (historical note)

**Status: retired 2026-09-16. There is no purchase flow.**

From 2026-09-09 to 2026-09-16 the project offered a packaged, ready-to-run Sophi-A build
(installer/binary) as a one-time paid convenience purchase. The source was, and still is, free
and open on GitHub under `LICENSE` (MIT); the offer only sold a pre-built binary for people who
did not want to run `npm install && npm run tauri dev` themselves.

The offer was retired on 2026-09-16 and its store products were archived. Sophi-A is source-only:
build it yourself (see `README.md`), or download a release asset from the GitHub Releases page
where one exists. Nothing is sold, and no licence key or account is needed.

What the offer's design settled, kept because the reasoning still applies to the product:

- **BYOK, no ongoing cost to recover.** Users authenticate their own Claude Code / API
  credentials and pay their own provider costs; Sophi-A resells nothing.
- **No licence-key enforcement.** The software is open source; there is nothing to enforce.
- **Trademark-safe naming.** "Sophi-A" contains no vendor name. Copy may say in plain text that
  the product runs Claude Code, but never uses "Claude"/"Claude Code"/"Anthropic" as part of the
  product's own name, or implies Anthropic built or endorses it.

The related documents (`docs/fulfillment-mails.md`, `docs/manual-fulfillment-runbook.md`,
`docs/stripe-product-copy.md`, `docs/hosted-trial-proxy.md`) are kept as the same kind of short
historical note.
