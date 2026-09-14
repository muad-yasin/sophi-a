# GUI restructure, 2026-09-14 - C&C centre stage, seven background seats

Muad's design direction, verbatim, as given in the C&C chat and relayed with this task:

> "Only the C&C seat should have a text window - a large one, centered, seamless into the screen.
> The other seats (Advisor, planning, building) get a placeholder image and sit in the background;
> they can display messages to C&C. The user can select one to send messages directly to that
> session, and pull its chat log into the foreground too."

and, earlier:

> "We need a visual identity, something similar to Claude Code. Something like 'Sophi-A, which can
> run Claude Code, or any other Harness seat, and use cheaper models for different planning and
> building agents'. And in the middle of the screen is the C&C seat where you chat with Claude
> Code / Sophi-A."

## What this replaces, and the PLAN.md conflict, stated plainly

`PLAN.md` -> "Desktop shell and UI" specifies:

> "CSS grid, 3 rows x 3 columns: the advisor pane spans top-center (collapsible, ...), the C&C
> chat pane sits center (largest), three planning-module tiles sit left, three building-module
> tiles sit right. Each tile shows the seat name, a glow ring ... and the last `seat.output` line."

This restructure **keeps** the spatial arrangement (advisor top, planners left, C&C centre,
builders right), the glow-ring status model, the five-event vocabulary, and "last `seat.output`
line on the tile" - the summary line on a collapsed chip is exactly that. What it **changes** is
that six of the eight tiles no longer show their full task form at once, and C&C is no longer one
bordered tile among eight but the stage the others sit around.

That is a divergence from a document a six-lab panel signed off, so it is recorded here rather
than made quietly: the author himself gave this direction after using the built product, which
outranks a plan written before it existed. Nothing in `PLAN.md`'s architecture sections
(orchestrator, seat registry, invocation mechanisms, event model, bridge) is touched. If this
layout is rejected, `PLAN.md` stands as-is and step 1 below survives on its own merits.

## Built in three steps, deliberately separable

1. **Collapse.** `src/seatLayout.ts` moves each non-cnc tile's existing body - task form, cost
   panel, debate panel, inspect panel, forward controls, smoke-run button, seat config - into a
   collapsible `.tile-body`, and builds a chip in its place: placeholder mark, seat name, role
   word, the seat's own (moved, not copied) status badge and cost ticker, and a one-line summary
   of its last output. Nodes are **moved**, never rebuilt, so every `[data-role=...]` the rest of
   `main.ts` queries is the same element and no seat feature changes behavior. The advisor's
   hand-written `advisor-toggle`/`advisor-body` pair is adopted by the same code rather than left
   as a second implementation of the same idea.
2. **Focus.** Clicking a chip - or a message that seat surfaced into C&C - pulls that one seat
   into a foreground panel on its own side of the stage; clicking again, or Escape, puts it back.
   One seat at a time. A seat that starts working opens itself and closes again when the turn
   ends; a seat the operator opened by hand stays open.
3. **Identity.** C&C loses its border and background (seamless), gets a large scrolling output
   area and a large input, and carries status on a hairline under its header plus the same text
   badge as before. A persistent status legend sits in the app header. Planners and Builders are
   told apart by a role word in the family's colour and a family placeholder mark - Planners' mark
   is a miniature of the real Council seal, and every Planner chip carries "5 rival labs grade the
   plan blind" at rest, so the differentiator no longer lives only in a one-shot dismissible modal.

## Verified how

- `node scripts/verify-gui-restructure.mjs` - 99 checks, offline, no window needed: the real
  frontend bundle against the real `index.html` in a DOM. It asserts every listed seat control
  still exists inside its own tile after the move, that chips collapse/expand/focus as described,
  that only one seat is ever in the foreground, that Escape clears it, that working auto-expands,
  and that a surfaced message focuses its seat when clicked.
- `npx tsc --noEmit` and `npm run build` clean.

**Not verified:** appearance. Nobody has looked at the window for this change - no screenshot was
possible in this environment (Wayland, no X11 surface, no grim/slurp, and installing system
packages was declined). Whether the stage reads as centred and seamless at 1400x900, whether the
chips are the right height, and whether the focused panel's 430px overlay covers something it
shouldn't are Muad's own look, in `npm run tauri dev`.

## Window size

`src-tauri/tauri.conf.json`'s fixed 1400x900 is unchanged. The stage columns are
`minmax(240px, 1fr) minmax(520px, 2.2fr) minmax(240px, 1fr)`, which needs ~1040px of content
width plus gaps - comfortable at 1400. Below roughly 1100px wide the centre column would start
squeezing; no minimum was changed to accommodate that, and if a smaller window is ever wanted,
that is a separate decision.
