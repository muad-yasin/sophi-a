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

## 2. Get the buyer a working download link - the one genuinely open step

The built installers exist as GitHub Release assets on `github.com/muad-yasin/sophi-a`, which is
currently a **private** repo - a buyer can't reach a private repo's release assets on their own.
**This is a real, unresolved gap, not assumed away**: before the first real sale, decide one of:

- Make the repo public (matches the Apache-2.0/open-source decision already made - probably the
  simplest fix, but a repo-visibility flip is the author's own call, not a session's).
- Keep it private and re-host the two files somewhere a buyer can reach without a GitHub login
  (a plain download link on sower-industries.de, a file-sharing link, etc.) - more steps per
  sale, but keeps the repo private if there's a reason to.

Until one of these is chosen, do this by hand per sale:

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
