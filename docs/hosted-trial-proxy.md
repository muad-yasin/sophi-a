# Hosted trial-key proxy — design doc (Phase 4, Step 1)

**Status: DRAFT — not implemented. See HUMAN STOP at the end.**

## What this fixes

Phase 1 Step 4's free-trial council run keeps the seller's API key as a plain constant in
`src-tauri/src/lib.rs`, protected only by a provider-side spend limit — honest, but the key is
extractable from the shipped binary with effort. This proxy is the actual fix: the key never
ships in any client at all.

## Design

- **Endpoint:** `POST /trial-run` on a Cloudflare Worker (or equivalent — any serverless HTTP
  endpoint with a KV-like store works; Worker chosen for zero-ops cost at this volume).
- **Request body:** `{ installId: string, sampleTask: string }`. `installId` is the same
  `~/.sophia/install-id` UUID Phase 1 already generates — no new client-side identity mechanism.
- **Per-install cap:** the Worker checks a KV store for `installId`; if a run already exists for
  it, respond `403 { error: 'trial_used' }`. Max 1 run per install, enforced server-side —
  unlike Phase 1's local flag file, this cannot be reset by deleting a local file.
- **Global cap:** a KV counter tracks total spend this calendar month; if it exceeds EUR 50,
  respond `503 { error: 'limit_reached' }` regardless of per-install state.
- **The call itself:** the Worker holds the seller key as an environment secret (Cloudflare's own
  secret store, never in source), spawns the `plan-cheap` relay chain against `sampleTask` (this
  requires the relay harness to be reachable from the Worker — see Open Question below), and
  returns the resulting `report.json` verbatim.
- **Client change:** `src/orchestrator/trial-run.js`'s `runTrial()` calls this endpoint instead of
  injecting a local env var; `src-tauri/src/lib.rs`'s key-holding code is deleted entirely once
  this ships — there is no longer a key on the client to protect.

## Open question (must be answered before implementation, not during)

The relay harness (`~/Projects/relay`) currently runs as a local CLI, spawned as a child process
by `relayChainSubprocess.js`. A Cloudflare Worker cannot spawn a local Node process. Either the
Worker calls the model APIs directly (reimplementing a slice of relay's `plan-cheap` chain logic
server-side — real duplication) or relay needs its own hosted HTTP entry point (relay's own
`src/mcp/server.js` comment already names this as a known future step: "relay-http-service is not
provisioned yet"). This design does not resolve that; it is the first thing the human stop below
must decide, since it changes the size estimate materially.

## Cost

**Days (2), once the open question above is resolved** — plus Cloudflare account setup and
ongoing operational ownership (nobody currently owns "the trial proxy is down" as an on-call
concern). Not free to run: Worker requests are cheap, but the EUR 50/month model spend is real
and separate from Cloudflare's own bill.

## HUMAN STOP — DO NOT PROCEED

No implementation starts until the owner (1) approves this design, specifically the open question
above, and (2) provisions the Cloudflare account (or chosen alternative) themselves — an account
creation and billing action, never done by a session.
