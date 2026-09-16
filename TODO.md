<!-- TODO.md holds only what is not yet done; anything finished moves to PROGRESS.md/BUILT.md in the same session it finishes. -->

- [ ] F3 (receipts v2 + `familyLedger.js` rewrite) and F5 (chat/council runtimes as family members) - Session C, not built overnight (real tooling/permission block, being re-dispatched - see `relay/Docs/SophiA-Seat-Families-OVERNIGHT.md`).
- [ ] F6 (`securityGate.js`) + F9 (THCMCP `chains/security-review-only.json`) - Session D, not built overnight (held for Muad's direct go-ahead, being re-dispatched - see the same handoff doc).
- [ ] Wire `familyManagerRestartRecovery()` into `index.js`'s actual startup path - it's built and tested but not called anywhere real yet.
- [ ] A live Chrome dev-build check of F8's Family panel (all five states) - not verified this overnight pass, the plan's own accepted offline gap.
- [ ] Source the real `families.config.json` per-seat `enabled`/`runtimes` rows into the frontend, so a flag-off seat's panel can show "off for this seat, here's why" proactively instead of only after a refused create/dispatch attempt.
