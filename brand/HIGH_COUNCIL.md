# The High Council - Sophi-A's visual/marketing identity

*Written 2026-09-10, at Muad's request, as the visual+marketing identity for `plan-1..3`'s real
mechanism - not a new feature, a name and a look for one that already ships. Source of truth for
who's actually at the table: `../relay/chains/plan-cheap.json` and
`docs/market-positioning.md`'s 2026-09-09 correction pass (six labs total, one proposer plus five
critics, not seven, not "multiple labs propose"). Do not invent a seventh seat or a
"labs-propose-blind" story here - that's `plan-debate`, a different chain, not what a `plan-N`
tile runs by default.*

## The one sentence this identity has to sell

**Your plan doesn't ship until five other labs' models have tried to kill it, on the record.**

That's `docs/market-positioning.md`'s "actual differentiator, and it's real" - Conductor and
Nimbalyst run N copies of the same agent and let a human pick after the fact. Sophi-A runs a real
adversarial council before a single line of code exists, and the run folder proves it
(`report.json`'s `signoff`/`scoreboard`/`failures` - already rendered today as the in-app Debate
panel). The High Council is that mechanism, named and given a face. It is not decoration over a
feature that doesn't exist; every claim below has to trace to a field in a real `report.json`.

## Who's actually at the table (real, from `plan-cheap.json`)

| seat | lab | role |
|---|---|---|
| the Advocate | Anthropic (`claude-sonnet-5`) | drafts and revises the plan - presents to the Council, does not sit on it |
| Council seat I | Alibaba, via Together (`Qwen3.5`) | critic |
| Council seat II | Z.ai (`glm-4.7-flash`) | critic |
| Council seat III | Cohere (`command-r7b`) | critic |
| Council seat IV | Google (`gemini-3.6-flash`) | critic |
| Council seat V | Meta, via OpenRouter (`llama-3.3-70b`) | critic |

Six seats, one proposer + five judges - matches `BOARD.md`'s own "six labs" count. `plan-debate`
(a different, real chain - see `PLAN_PACKAGING.md`/`PLAN_PARALLEL_BUILD.md`, both produced by it)
is a **second, distinct mechanism** ("the labs propose blind, then argue with each other") and
earns its own name later if it ever gets marketing treatment - don't collapse the two here.

A chain's actual seat list can change (Mistral is named in `plan-cheap.json`'s own description as
"parked, add back once it clears" - a 429 issue, not a design choice). This doc names *today's*
five; if the roster changes, update this table and the sigil legend below in the same commit as
the chain-config change, not separately.

## Why sigils, not logos

Per Muad's call: distinct seats per lab, not an abstracted single council. But "distinct" here
means **a sigil Sophi-A owns**, not another company's mark - no Anthropic wordmark, no Google "G",
no Meta infinity. Two reasons, both real: (1) trademark risk on a public marketing surface -
flagged for a later legal pass per the standing "move fast, flag later" call, not resolved by
avoiding it, just not blocking on it now; (2) five different corporate brand systems dropped onto
one page fight the mark instead of surrounding it - the whole identity is built around the
asymptote star being the calmest, warmest thing on the page (`BRAND.md`'s "never claims to be
finished" reasoning). A sigil says "a seat, occupied, judging" without borrowing anyone else's
visual equity.

Each sigil is a simple geometric mark (not a logo, not a face) in the seat's own accent hue,
arranged in a ring around the mark. The lab name is set in type next to it, plainly, in
`--text-secondary` - the sigil is atmosphere, the name is the actual credibility claim, and the
two must never be forced to do the same job.

## Seat accent hues

Built as five *distinct, name-stable* hues around the existing warm-gold palette (`BRAND.md`) -
not one per "how important," one per seat, so a hue reads the same way in every future render.
Kept cool/desaturated relative to the gold core on purpose: the star stays the only warm, bright
thing on the page; the Council surrounds it in restraint, not competition.

| seat | lab | hex | sigil |
|---|---|---|---|
| I | Qwen (Alibaba) | `#7a8fa6` (slate blue) | a single vertical bar through a ring - a measure, a gate |
| II | GLM (Z.ai) | `#8a9a7a` (sage) | a balance scale (beam + two pans) - weighing, mid-judgment |
| III | Command (Cohere) | `#a68a6b` (clay) | a hexagon - a cut gem, terse and load-bearing |
| IV | Gemini (Google) | `#7a90a6` (steel blue, distinct from Qwen's slate - see contrast note) | two opposed arcs - a set of twin lenses |
| V | Llama (Meta) | `#9a8a6b` (warm taupe) | a triangle inside a circle - a mountain seat |

Contrast note: Qwen (`#7a8fa6`) and Gemini (`#7a90a6`) are close by design (both read as "cool
seat") but differ by sigil shape first, hue second - verify at both 32px (favicon-scale, sigil
alone has to disambiguate) and 128px+ (hue starts doing real work) before shipping either into a
size-constrained context. If a future pass finds they don't disambiguate at small sizes, widen the
hue gap rather than redesigning the sigils - the shapes are the more legible axis and shouldn't
be the first thing traded away.

The Advocate (Anthropic) does not get a Council-ring sigil - it sits at the mark's own position
(the gold star *is* the Advocate's seat, visually), since it is presenting to the Council, not
seated on it. Do not add a sixth ring sigil for it; that would misstate the mechanism (one
proposer, five judges - not six judges).

## Composition: the Council Seal

`brand/council-seal.svg` (built this pass) - the master graphic. Five sigils in a ring at fixed
angles (72° apart, seat I at top, clockwise in table order above) around the existing
`sophi-a-mark`/`favicon.svg` star at center, each sigil sitting inside a thin arc segment in its
own hue at ~30% opacity (the ring reads as a table, not a badge strip). Radii and the star itself
are untouched from `public/favicon.svg` - the mark does not get redrawn for this, it gets
surrounded.

Two required render states, same file, toggled by an SVG class (no separate source of truth):

- **Idle/full council** - all five arcs at full opacity, evenly lit. This is the identity mark:
  landing-page hero, README, social card.
- **Live verdict** - per-seat arc opacity driven by that seat's real `signoff` boolean from a
  `report.json` (lit = signed off, dimmed = objected, per the same data the in-app Debate panel
  already renders). This state is for the product itself, not static marketing - it's the thing a
  screenshot of Conductor structurally cannot produce, so it belongs in a live demo GIF or the
  actual Debate panel, not baked as a fake "everyone agreed" state into brand assets. **Do not
  ship a static image claiming a specific verdict unless it is a real screenshot of a real run.**

## Copy voice for this identity specifically

Builds on `BRAND.md`'s existing voice (asymptote, "never claims to be finished," dry honesty
about gaps) with one addition: the Council's voice is **procedural, not theatrical**. "Five labs
reviewed this plan" is the identity; "the Council has spoken" is not - it oversells a chat
completion as a tribunal. Prefer verbs a real review actually does: *reviewed, objected, signed
off, overruled, flagged*. Avoid: *judged, decreed, ruled, blessed*. The mechanism is genuinely
novel and doesn't need myth-language to sell; myth-language on top of a real thing reads as
hiding that it's real.

Working taglines (pick one per surface, don't run all three on the same page):

- "Five labs review your plan before a line of code exists."
- "Nothing builds until the Council signs off - or tells you exactly why it won't."
- "Your plan, cross-examined by five labs that don't work for the one that wrote it."

## What this pass did NOT do (real gaps, not oversights)

- **Checked and fixed, 2026-09-10, third pass.** Ran a real protanopia/deuteranopia/tritanopia
  simulation (Viénot-style linear-RGB matrices) over the five seat hues, pairwise Euclidean
  distance in sRGB as the closeness proxy. Two real findings, one already known and one not:
  - Qwen (`#7a8fa6`) vs. Gemini (`#7a90a6`) - already flagged above as deliberately close - measure
    at 0.004 (normal vision, near-identical) and stay near-identical under all three simulated
    conditions. Confirms the existing "shape disambiguates, hue doesn't" call was correct, not
    just cautious.
  - **Not previously flagged:** Cohere (`#a68a6b`) vs. Llama (`#9a8a6b`) measure 0.047 normal,
    0.040-0.047 simulated - just as close as the Qwen/Gemini pair the doc already called out, and
    this one wasn't named anywhere. Every seat pair loses 25-45% of its already-small hue distance
    under protanopia/deuteranopia specifically (GLM vs. Cohere: 0.139 normal down to 0.079
    protan). **Conclusion: hue is not a reliable disambiguator for any pair in this palette,
    colorblind or not** - every seat sigil has to carry the actual distinction. That made the
    second finding below load-bearing, not decorative.
  - **Also found while checking this, and the more serious issue:** the sigils were never actually
    checked at the size they render in the shipped product. `index.html`'s in-app `.council-seal`
    renders at 80x80 against a 512 viewBox (a 0.156 scale factor) - the original sigil
    stroke-width of ~2.5-3 units rendered at **under half a pixel**, i.e. not merely "hard to
    read," genuinely not visibly present. Confirmed by rendering the real seal at 80px and
    upscaling with nearest-neighbor (no smoothing to hide the problem) - the sigils were
    invisible; only the wedge color patches were doing any work, and per the finding above, color
    alone can't disambiguate several of these pairs. **Fixed**: sigil stroke-width raised to
    10-12 units and shape radii roughly 1.5x larger in both `brand/council-seal.svg` and the
    three in-app copies in `index.html` (kept in sync by hand, same discipline as the
    `favicon.svg`/`sophi-a-mark.svg` pair) - renders at ~1.9px at 80px, confirmed legible by the
    same render-and-upscale check, and still reads cleanly at the landing page's full 512px size.
    In-app screenshot-verified in a running dev build, not just re-rendered offline.
- `plan-debate`'s "labs propose blind, then argue" mechanism has no identity here on purpose - see
  the roster note above. A second seal for that chain is a real follow-up, not scoped into this
  pass.
- The landing page (`marketing/index.html`) still ships the idle/full-council state only - it's a
  static asset, not wired to a real run.
- **Built 2026-09-10, second pass:** the in-app Debate panel now carries the live-verdict state.
  A trimmed inline `.council-seal` (index.html, one per `plan-N` tile - full ring geometry, no
  flare rays, `<circle>` orb reusing a single shared `<defs>` block instead of tripling the
  gradient markup) sits above the existing signoff list. `renderDebatePanel` (src/main.ts) drives
  each wedge's `debate-signed-off`/`debate-objected`/`debate-abstained` class straight from that
  run's real `report.json` signoff array - matched by `data-provider` against relay's own
  `signoff[].provider` string verbatim (`labOf()` in `relay/src/chain.js` falls back to
  `seat.provider`, so the real values are `together`/`zai`/`cohere`/`google`/`openrouter`, not
  friendly lab names - a direct selector match, no lookup table to drift out of sync with a
  chain-config change). Verified by injecting real signoff states into a running dev build in
  Chrome and confirming each wedge's opacity actually changes - not just that the CSS classes
  exist.
