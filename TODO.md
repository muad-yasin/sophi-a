<!-- TODO.md holds only what is not yet done; anything finished moves to PROGRESS.md/BUILT.md in the same session it finishes. -->

- [ ] Wire `securityGate.js` (F6, now built and tested) into `familyManager.js`'s dispatch path, and add a real `family_apply`/`family_forward` WS command - F7 was built before F6 landed and was never revisited, so nothing produced by a family can be made "actionable" yet even though the gate itself exists. `familyManager.js`'s own header comment is stale (still says F6 "wasn't built tonight") - fix it as part of this work.
- [ ] Wire `familyManagerRestartRecovery()` into `index.js`'s actual startup path - it's built and tested but not called anywhere real yet.
- [ ] A live Chrome dev-build check of F8's Family panel (all five states) - not verified this overnight pass, the plan's own accepted offline gap.
- [ ] Source the real `families.config.json` per-seat `enabled`/`runtimes` rows into the frontend, so a flag-off seat's panel can show "off for this seat, here's why" proactively instead of only after a refused create/dispatch attempt.
- [ ] Resolve the `src/orchestrator/family/` (Session C's subdirectory) vs. flat `src/orchestrator/` (Session D's `securityGate.js`) directory-convention split - Muad's call, see `relay/Docs/SophiA-Seat-Families-OVERNIGHT.md` item 7.
