<!-- TODO.md holds only what is not yet done; anything finished moves to PROGRESS.md/BUILT.md in the same session it finishes. -->

- [ ] Offline-first acceptance harness (foundation, build first - everything below depends on it): `test/fixtures/fake-claude.sh` + `test/fixtures/mock-relay-chain.mjs` (three canned scenarios: all-approve, one-holdout, malformed-JSON-critic), verified by `test/fixtures/fixture-selftest.test.mjs`.
- [ ] Family-model decision record: one dated `DECISIONS.md` entry stating the `fanOut()` guard stays unchanged, "family" = supervised worker agents under the existing cnc-only coordinator mechanism, and reopening hub-and-spoke is deferred to Muad.
