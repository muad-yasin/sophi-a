# SHOP.md - monetizing a packaged Sophi-A build

*Written 2026-09-09, following `sower-industries/plan-shop.md`'s shape (settled / open / non-goals
/ acceptance test) and honesty level, not its content - that product is unrelated except as a
reusable pattern. Source: `DECISIONS.md`'s 2026-09-09 monetization entries (Stripe-vs-Gumroad cost
call, BYOK legal-compliance check, VAT/OSS gap). Read those before changing anything here.*

## The product, in one sentence

A packaged, ready-to-run Sophi-A build (installer/binary) sold for convenience - the source
stays free and open on GitHub under `LICENSE` (Apache-2.0); paying buys a working build someone
doesn't have to `npm install && npm run tauri dev` themselves, not the code.

## What is settled

- **Channel:** Stripe, direct - a payment link, the same pattern `sower-industries.de/plan` already
  runs live (payment link -> success page -> by-hand fulfillment). Not Gumroad/LemonSqueezy; that
  call is made and recorded in `DECISIONS.md` (cost-driven: Stripe's ~1.5-2.9%+fixed fee vs.
  Gumroad's ~5-10%), not re-litigated here. **The link is live** (created by Muad's own dashboard
  click, 2026-09-09, per the standing rule that this is always the author's action, not a
  session's).
- **One-time purchase, not a subscription.** Matches the BYOK cost structure already established:
  the buyer authenticates their own Claude Code/API credentials and pays their own provider costs
  (PLAN.md's commercial-terms item 1/2, resolved in `DECISIONS.md`'s BYOK entry) - Sophi-A
  itself has no ongoing per-user cost to recover, so there's nothing a subscription would be paying
  for.
- **Settled price: €20 one-time** (Muad's own call, 2026-09-09 - lower than the $29 recommendation
  below; also matches `sower-industries.de/plan`'s own €20 anchor price). The pricing math below is
  kept as the reasoning that was actually weighed at the time, not edited to retroactively justify
  €20 - see the note at the end of that section.

## Pricing math (Stripe vs. the earlier Gumroad recommendation)

The author already rejected an earlier $29-49 recommendation when it was proposed for Gumroad/
LemonSqueezy, on the grounds that their ~5-10% cut eats too much of a small indie sale. That
rejection stands and isn't reversed here - but the channel underneath it has changed, and the math
changes with it:

| price | via Gumroad (~5-10% cut, `DECISIONS.md`'s own range) | via Stripe (~1.5-2.9% + a small fixed fee) |
|---|---|---|
| $29 | fee ~$1.45-$2.90, net **~$26.10-$27.55** | fee ~$0.70-$1.14, net **~$27.86-$28.30** |
| $35 | fee ~$1.75-$3.50, net **~$31.50-$33.25** | fee ~$0.80-$1.32, net **~$33.68-$34.21** |

Stripe's cut is roughly a third of Gumroad's worst case on a $29-35 sale. That buys room to do
either of two things - both stay inside the indie-BYOK-desktop-tool $10-100 one-time range the
earlier research found, so neither is a new number invented here:

- Keep a similar price point ($35) at meaningfully higher margin (~$33.68-$34.21 vs. ~$31.50-$33.25
  net via Gumroad), or
- Price lower ($29) and still net about as much per sale (~$27.86-$28.30 via Stripe) as $29 would
  have netted at Gumroad's *best* case (~$27.55), while beating Gumroad's worst case
  (~$26.10) outright - and reading cheaper next to free source.

**Recommendation: $29.** This is a convenience sale of a build whose source is free on GitHub under
an OSI license - the price has to read as "worth not compiling it yourself," not as buying the
software. $29 sits at the low end of the previously-considered range (a familiar number, not a
fresh guess), and Stripe's lower cut means it still nets a healthy ~96% of face value. Regional
pricing, like `plan-shop.md`'s own product, is a later step, not v1.

**Actually settled, 2026-09-09: €20**, not $29 - Muad's own call when creating the real Stripe
link. Lower than this section's recommendation, matching `sower-industries.de/plan`'s own €20
price instead (one round number across both Sower Industries products, easier to talk about, and
consistent with this author preferring a lower price point earlier in the same conversation - see
the Gumroad-vs-Stripe fee math above, which was itself a reaction to "we cannot afford" a higher
number). Net-of-fees at €20 via Stripe is still roughly 96-97% of face value, the same shape of
outcome this section argued for, just anchored to a different number.

## What's still genuinely open - the author's own decision or action, not guessed here

- **VAT/OSS registration.** Unresolved for `sower-industries.de/plan` today
  (`PlanShop_Legal.md` §4) and inherited unchanged by this product the moment it uses Stripe direct
  instead of a merchant-of-record platform (`DECISIONS.md`, 2026-09-09). **Recommendation: launch
  Germany-only**, matching `PlanShop_Legal.md`'s own stopgap ("either sell only to Germany or hold
  off"), until OSS registration is actually done. This is a real legal gate, not a formality - don't
  sell cross-border before it clears.
- **The Stripe payment link itself: done, 2026-09-09.** Created by Muad's own dashboard click
  ("Sophi-A", €20) - this workspace's established rule (`sower-industries/CLAUDE.md`: "Stripe
  payment links are created by the author in the dashboard, never by a session") held; nothing
  here created or simulated one.
- **Delivery mechanism: built, one real gap flagged.** Packaging now exists for real (`v0.1.0`,
  `PLAN_PACKAGING.md`) - real Windows/Linux installers exist as GitHub Release assets. Fulfillment
  mails and the copy-pasteable runbook are written: `docs/fulfillment-mails.md`,
  `docs/manual-fulfillment-runbook.md` (mirrors `ManualFulfillmentRunbook.md`'s pattern - notice
  the sale, do the work, send it). **Genuinely unresolved**: the GitHub repo is currently private,
  so a buyer can't reach the release assets directly - either make the repo public (matches the
  open-source decision already made) or re-host the two files somewhere reachable without a
  GitHub login. Author's call, named in the runbook, not assumed either way.
- **Stripe success page: built.** `sower-industries` now has `/en/sophi-a/next/`, mirroring
  `/plan/next.astro`'s pattern. Once deployed, point the Sophi-A payment link's success URL at
  `https://sower-industries.de/en/sophi-a/next/` - a dashboard action, not done here.
- **Product name: settled, 2026-09-09 - "Sophi-A"** (Muad's own call; the name and the "Visual
  Identity: SMO" direction both draw on an existing Sower Industries property - see DECISIONS.md).
  This name passes the trademark check on its face (no "Claude"/"Anthropic"/"Claude Code" in it),
  Trademark-safe copy for the actual Stripe product now drafted: `docs/stripe-product-copy.md`
  (checked against code.claude.com/docs/en/legal-and-compliance, 2026-09-09 - see DECISIONS.md).
  Pasting it into Stripe's dashboard is the author's own action, same rule as the payment link
  itself - not done here.

## Non-goals for v1

- No auto-update mechanism - manual re-download of a new build if one is ever made.
- No license-key enforcement - the software is open source; there is nothing to enforce, and
  pretending otherwise would be a lie the source code itself disproves.
- No cross-border sales until the OSS/VAT gate above actually clears.
- No packaging/installer automation - that's the parallel build effort's job, not this document's.
- No regional pricing, no DE-language page, no subscription tier.

## Acceptance test

~~The author creates the Stripe payment link by hand for €20 one-time~~ - **done, 2026-09-09**. A
test purchase completes and lands on a plain thank-you/next-steps page telling the buyer a build is
on its way by email; the author builds and sends one binary by hand per
`ManualFulfillmentRunbook.md`'s pattern; the sale is restricted to Germany at checkout (or the OSS
gate is confirmed cleared first); the marketing copy passes a trademark-safe read against
Anthropic's brand guidelines before publishing. The remaining three checks (test purchase, by-hand
delivery, Germany restriction/OSS gate, copy review) are still open - the link's existence isn't
the whole acceptance test.

## Build definitely, but later

Automated packaging and delivery (once `npm run tauri build` is wired and signed builds exist),
a download-page-per-purchase flow instead of by-hand email, regional pricing, and a public
"if it becomes a business" pledge mechanism if the author wants to mirror `plan-shop.md`'s 0.7
percent pattern here too - none of that is decided or designed, only named as plausible next steps.
