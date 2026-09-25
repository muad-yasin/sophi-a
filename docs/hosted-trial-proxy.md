# Hosted trial-key proxy (historical note)

**Status: design draft only, never implemented. Retired with the paid-build offer on 2026-09-16.
There is no purchase flow and no free-trial mechanism.**

This file once held a design for a hosted free-trial council run tied to the packaged-build offer
(see `SHOP.md`). That offer was retired on 2026-09-16, and the trial was never built: there is no
trial endpoint, no seller key and no `trial-run.js` in this repo.

The one design principle worth keeping, should a hosted trial ever be reconsidered: a
project-owned API key must never ship inside any client binary. It would live only as a secret
on a server-side endpoint, with per-install and global spend caps enforced server-side, and the
open question of how a serverless endpoint reaches the council engine (which runs as a local CLI
subprocess today) would have to be answered before any implementation. Any such work needs the
owner's explicit approval and account/billing setup first; a session never does that.
