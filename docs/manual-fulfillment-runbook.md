# Sophi-A manual fulfillment runbook - what to do when a real order arrives

*Follows `sower-industries/Docs/ManualFulfillmentRunbook.md`'s shape exactly - the
copy-pasteable, run-order version of `SHOP.md`'s delivery step and `docs/fulfillment-mails.md`'s
text, so a real order doesn't require re-deriving anything under time pressure. Author-run only;
nothing here is automated.*

## 1. Notice the sale

Stripe emails a payment notification, or check the Payments dashboard
(`dashboard.stripe.com` -> the Sophi-A Payment Link -> Payments and Analytics). Note the buyer's
email and country (Germany-only launch - `SHOP.md` - refund and explain if Stripe let a
cross-border sale through before the checkout restriction is confirmed live).

## 2. Get the buyer a working download link

**Corrected (security/doc-drift review, 2026-09-16): the repo has been public since 2026-09-09**
(`DECISIONS.md`'s 2026-09-09 entry; reconfirmed by a later entry noting the footer's GitHub link
"points at the real public GitHub blob URL - real because the repo itself is already public"). A
buyer can reach a public repo's release assets directly - the private-repo gap this section used
to describe as unresolved doesn't exist anymore. Do this by hand per sale:

```
gh release download v0.1.0 -R muad-yasin/sophi-a -D /tmp/sophia-delivery
```

Then upload `Sophi-A_0.1.0_x64-setup.exe` and `Sophi-A_0.1.0_amd64.AppImage` from
`/tmp/sophia-delivery` to wherever the buyer can actually reach them, and use that URL as
`{{download link}}` in mail 1.

## 3. Send mail 1 (delivery)

`docs/fulfillment-mails.md` §1, sent by hand. No intake/questions step - unlike the plan
product, there's a fixed build to hand over, not a bespoke document to produce first.

## 4. If the buyer needs macOS, or anything else doesn't fit

`docs/fulfillment-mails.md` §2 - decline and refund, no reason owed beyond the one sentence in
the mail itself.

## What this runbook does not cover

Any automated delivery (a download-page-per-purchase flow instead of by-hand email) - named as a
plausible next step in `SHOP.md`, not designed or built. Until it exists, this file is the actual
production path.
