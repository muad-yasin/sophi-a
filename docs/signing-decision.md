# Windows code-signing decision

*Per PLAN_PACKAGING.md §2.2/§6. Read that first - this file states the consequence plainly, it
doesn't re-argue the decision.*

**v1 ships unsigned.** No Authenticode certificate is configured (`tauri.conf.json`'s
`bundle.windows` has no `certificateThumbprint`, no `signCommand`).

**What this actually costs the user:** on first run, Windows SmartScreen shows "Windows protected
your PC" with the app's publisher listed as "Unknown publisher." The user must click "More info",
then "Run anyway." Some fraction of first-time downloaders will not get past this dialog - that is
a real, accepted cost of shipping unsigned, not a hidden one.

**Why accepted for v1:** an OV code-signing certificate costs roughly $200-$400/year; EV costs
roughly $100-$300/year plus a mandatory hardware token. Sophi-A is a solo-operator, ~€20-one-time
product with no revenue yet - that annual cost doesn't clear the bar before there's a single sale
to justify it against.

**Revisit when:** there's enough real revenue that the SmartScreen drop-off is costing more in
lost sales than a certificate would cost to remove it. Buying an EV certificate also gets
SmartScreen reputation faster than OV (EV certs get an initial reputation boost); worth comparing
both again at that point rather than defaulting to OV.

**Not done, and explicitly not a self-signed certificate either** - a self-signed cert was
considered and rejected during the packaging plan's review (`BOARD_PACKAGING.md`, MISTRAL-2): it
does not reduce or remove the SmartScreen warning at all (SmartScreen reputation is per-certificate
and a self-signed cert has none), so it would add build complexity for zero user-facing benefit.
