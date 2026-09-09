# Sophi-A visual identity - the asymptote star

*Written 2026-09-09. Source material: `~/Projects/SMO/SMO/Docs/Sophi-A.md` (the lore/design doc
for SMO's own in-game "Project Sophi-A") and its real shader/material code
(`SophiACoronaGenerator.cs`, `SophiAVisualDriver.cs`, `SophiAFlareAnimator.cs`). This is a
deliberate cross-property callout, not a coincidence - see `CLAUDE.md`'s naming note.*

## The one-sentence pitch this identity has to carry

Sophi-A gets you closer to shipping with the models you already pay for - it never claims to
replace you, and it never claims to be finished doing it. One build, €20, forever.

## Where the mark comes from

In SMO, Project Sophi-A is the game's AGI-under-construction: a small glowing star/plasma orb
housed in a Data Center room, rendered with a corona shader, a volumetric noise shell, and 120
animated "flare" prominence segments. The name itself is the thesis - *Sophia, but Artificial* -
and the core game mechanic is an asymptotic completeness gauge that visibly decelerates and
mathematically never reaches 100%. It is *always still becoming*.

That is exactly the pitch of this harness: cheap, fast, never the finished, all-knowing
system - a tool that gets closer, session after session, never claims to have arrived. The mark
inherits the star, the asymptote, and the warm-gold palette on purpose.

## The mark

- Master file: `brand/sophi-a-mark.svg` (512x512, opaque dark background - used to regenerate
  every packaged app icon via `npx tauri icon brand/sophi-a-mark-1024.png`).
- Transparent sibling for in-app/web use: `public/favicon.svg`. Keep both in sync by hand - there's
  no build step linking them (same discipline `src/styles.css`'s own header note uses for the
  palette).
- Shape: a warm gold-white orb (radial gradient, off-center highlight for depth) with six uneven
  flare rays. The unevenness is deliberate, not sloppy - SMO's own `SophiAFlareAnimator.cs` header
  comment calls a static, symmetric sunburst "the oldest unfixed complaint" about the in-game
  object ("a star whose prominences are frozen does not read as alive"). A still marketing image
  can't animate that, but it can at least not be symmetric.
- Tested at 32px (taskbar/favicon size) and 128px - the orb alone carries the mark at small sizes;
  the flares only read at 128px+. Don't rely on the flares for anything that has to work small.

## Palette (already load-bearing - don't invent new hex values)

`src/styles.css` already carries SMO's own Gold as `--gold`/`--gold-bright` (`#c9a24d`/`#e9c97f`) -
that predates this session and the mark below was built to match it exactly, not the other way
around.

| role | hex | source |
|---|---|---|
| core hot spot | `#fffdf6` | new - near-white, above any existing token |
| upper bloom | `#fdeec0` | new - between white and gold-bright |
| gold-bright | `#e9c97f` / mark's `#f2d18e` step | `--gold-bright`, SMO `AiAccentDark`-adjacent |
| gold | `#c9a24d` | `--gold`, SMO Gold - reused verbatim |
| ember/rim | `#a8763a` → `#6b4420` | new - desaturated-to-sRGB read of SMO's HDR corona anchors (`SophiACoronaGenerator.cs`'s anchor list runs `(1.75,1.50,1.05)` bright bloom down to `(0.62,0.32,0.16)` deep ember; those are >1.0 bloom floats made for Unity's HDR pipeline, not paste-able hex - these are a by-eye sRGB match, not a literal conversion) |
| backdrop | `#0a0908` | `--bg` - already the app's own background |

## What's shipped with this pass

- `src-tauri/icons/*` regenerated from the mark (desktop-only - the iOS/Android sets `tauri icon`
  also generates were deleted, since mobile is explicitly deferred per `PLAN.md`/`CLAUDE.md`).
- `public/favicon.svg` + `index.html`'s `<link rel="icon">`.
- A small breathing brand mark on the connecting screen (`.brand-mark`, `src/styles.css`) - a slow
  3.2s pulse rather than a spinner, on purpose: the mark's whole point is "approaching, never
  arriving," so it shouldn't resolve to a stock loading animation.

## What this pass did NOT do (real gaps, not oversights)

- No marketing/landing hero image (wide banner, social-share card, Stripe product image) - the
  shop flow (`SHOP.md`) is a bare payment link today with no landing page to put one on yet.
- No wordmark/lockup (mark + "Sophi-A" type) - `--font-chrome` (Space Grotesk) is the obvious
  choice to pair it with, not built here.
- No light-mode variant - the whole app is `color-scheme: dark` only (`src/styles.css`), so this
  wasn't needed, but a white-background context (e.g. a GitHub README badge) will need the
  transparent favicon variant checked against a light backdrop before reuse - it was only tested
  against `--bg`.
- No animated corona/flare version (SMO's own real shader work) - this is a static SVG mark, not a
  ported shader. If Sophi-A ever gets a real animated hero (splash screen, landing page WebGL),
  that's a real follow-up project, not a small addition to this one.
