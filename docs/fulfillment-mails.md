# Sophi-A - the fulfillment mails

*Written 2026-09-09, following `sower-industries/Docs/PlanShop_Mails.md`'s shape and voice
exactly (plain, no hype, no "AI magic", no outcome promises) - not its content, that product is
unrelated except as a reusable pattern. The first buyers are fulfilled by hand
(`SHOP.md`); this is the actual text to send. Send as plain text, from the address on
sower-industries' Impressum (Sophi-A doesn't have its own yet).*

Placeholders: `{{name}}` (or nothing, if Stripe didn't collect one), `{{order}}`, `{{download
link}}`.

---

## 1. Delivery - sent by hand after Stripe reports the payment

No intake/questions step here, unlike the plan product - Sophi-A is a fixed build, not a
bespoke document, so there's nothing to ask the buyer first. One mail does it.

**Subject:** Your Sophi-A build

Hello,

thanks for buying Sophi-A. Order `{{order}}`.

Download: {{download link}} - pick the installer for your system:

- **Windows** - `Sophi-A_0.1.0_x64-setup.exe`. Run it; no admin permission needed. Windows will
  show a "Windows protected your PC" warning on first run - click "More info", then "Run
  anyway". This build isn't code-signed yet (a real cost named honestly: signing certificates
  run $100-400/year, not worth it before there's revenue to justify it), so this warning is
  expected, not a sign anything's wrong.
- **Linux** - `Sophi-A_0.1.0_amd64.AppImage`. Make it executable (`chmod +x`, or right-click →
  Properties → Permissions in most file managers) and run it directly - no install step, no
  root needed.

**No macOS build exists yet.** If that's what you needed, say so and I'll refund order
`{{order}}` in full - see the note at the end of this mail.

The source is open (Apache-2.0) at {{repo URL, once public}} if you'd rather build it yourself
or just read how it works.

**Getting started:** open the app, click "Setup" (top right) to check your Claude Code CLI is
found and, if you want `cnc`/`advisor` on something other than Anthropic, enter that provider's
API key there. You need your own Claude Code subscription and/or provider API keys - Sophi-A
doesn't include or resell access to any of them.

One honest note: this is a young build (v0.1.0) - if something breaks, reply here and tell me
what happened. There's no support contract behind this purchase, but I'd genuinely like to
know what's broken.

- Muad

---

## 2. Decline and refund - unsupported platform or anything else that doesn't fit

**Subject:** Refunding your order

Hello,

I'm refunding order `{{order}}` in full; it should appear in a few days.

The reason: {{one specific sentence - e.g. "no macOS build exists yet" or whatever the real
reason is}}.

No hard feelings and no conditions. If a macOS build ships later, or the issue gets fixed, buy
again and I'll make sure it works this time.

- Muad

---

## Notes for whoever automates this later

- Both mails above are ones the buyer would be happy to receive. Automation is allowed to make
  them faster; it is not allowed to make them worse, longer, or more enthusiastic - same rule
  `PlanShop_Mails.md` states for its own mails.
- Mail 2 exists on purpose, same reasoning as the plan product's mail 4: a refund path the
  seller uses voluntarily is what makes "no support contract, but I care" credible.
- Do not add an upsell, a newsletter, a discount for a second purchase, or a request for a
  review.
- No pledge-link line in mail 1 - unlike the plan product, whether Sophi-A carries a 0.7 percent
  pledge mechanism is explicitly undecided (`SHOP.md`'s "Build definitely, but later"). Don't add
  one here until that's actually decided.
