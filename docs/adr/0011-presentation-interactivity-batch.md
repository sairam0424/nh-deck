# 0011. Presentation interactivity batch: zoom trigger, pacing formula, and auto-advance scope

## Status

Accepted — 2026-09-16

## Context and Problem Statement

Three independent presentation-mode features shipped in the same release
batch: Alt+click-to-zoom on dense content, a per-slide pacing indicator in
presenter view, and an auto-advance/kiosk mode. Each one had a real
alternative design this repo's own existing constraints (or a genuine
interaction-model bug, not just a preference) ruled out. This ADR records
all three together, batched the same way `0009` batched templates,
transitions, and presentation mode itself, since none of the three is big
enough on its own to justify a standalone ADR and all three land in the
same release.

## Decision Drivers

- **A trigger gesture must not fight the gesture it is layered on top of.**
  Presentation mode already treats a plain click as "advance to the next
  slide/fragment" (see `presentationScript.ts`'s existing click listener).
  Any new click-based interaction has to coexist with that, not silently
  break it.
- **No new authoring burden for a feature that is opt-in by nature.** Both
  the pacing indicator and auto-advance are opt-in (a typed target duration;
  a flag or frontmatter key), matching this project's existing precedent
  (theme/transition/direction) of "absent means byte-identical to before the
  feature existed." Any design that requires a deck author to maintain
  *more* structured input than the single value already asked for works
  against that precedent.
- **Fragment-aware navigation must stay consistent.** This repo already
  looks fragments up fresh from the live DOM on every navigation (see
  `presentationScript.ts`'s own module docstring) rather than tracking a
  parallel JS counter. Any new navigation driver (a timer, here) has to go
  through the same `advance()` path real arrow-key/click navigation already
  uses, not a separate raw slide-index jump that would skip fragments
  entirely.
- **Scope discipline**: ship the correct, well-scoped version of each
  feature now, and defer a genuinely harder extension (unbounded looping)
  as a documented, honest gap rather than rushing a half-correct version of
  it into this same pass.

## Considered Options

### (a) Zoom trigger gesture

1. **Alt+click (Option+click on macOS)**: a held-modifier check
   (`event.altKey`) evaluated inside the existing click listener, checked
   as the last guard before the plain fallthrough `advance()` call.
2. **Double-click**: bind zoom to the browser's native `dblclick` event.
3. **A dedicated on-slide "zoom" button/icon** rendered next to each
   zoomable element.

### (b) Pacing formula

1. **Simple ratio-based formula**: `expectedIndex = (elapsedMs /
   (targetMinutes * 60_000)) * totalSlides`, compared against the actual
   current slide index, rendered as ahead/on-pace/behind.
2. **Heavier per-slide-target-duration authoring scheme**: let an author
   assign an explicit time budget to each slide (via frontmatter or a
   per-slide comment marker, mirroring `<!-- layout: name -->`'s existing
   per-slide marker convention), and derive pacing from cumulative
   slide-specific budgets instead of a flat even split.

### (c) Auto-advance scope

1. **Fragment-aware `advance()` calls, reset on any real navigation, no
   looping**: the timer calls the exact same `advance()` function
   arrow-key/click navigation already uses (so fragments still reveal one
   at a time), `goTo()` resets the countdown on every real navigation from
   any input source, and the timer simply stops once the last slide has
   nothing left to reveal.
2. **Loop back to slide 1 after the last slide.**
3. **A raw slide-index timer, independent of `advance()`/fragment state.**

## Decision Outcome

Chosen: **Option 1 in all three categories.**

**(a) Alt+click, not double-click.** This was not a taste call between two
equally-working options — double-click is actually broken for this
interaction model. A real double-click fires two ordinary `click` events
*before* the browser synthesizes its own `dblclick` event. Because this
repo's existing click listener already treats a plain click as "advance,"
each of those two `click` events would independently call `advance()` before
`dblclick` ever had a chance to fire and intervene — a double-click would
reliably skip two slides/fragments forward and *then* try to open zoom on
whatever slide it landed on, not the one that was showing when the user
started clicking. A held-modifier check evaluated on the click event itself
has no such ordering problem, since it runs synchronously inside the same
event the existing advance-on-click logic already inspects, and can return
early before `advance()` runs at all. A dedicated on-slide zoom button was
rejected as unnecessary UI surface area and extra per-element DOM: it would
need positioning logic for every one of five different element types
(image/svg/pre/table/`.katex-display`), each with different natural
dimensions, for a discoverability problem Alt+click's own help-overlay entry
already solves more cheaply.

**(b) Simple ratio, not per-slide target durations.** The heavier scheme was
rejected primarily on the "no new authoring burden" decision driver: it
would require a presenter to assign and *maintain* an explicit time budget
per slide — reflowing every budget by hand whenever a slide is added,
removed, or reordered, the exact kind of upkeep cost a single flat target
duration (already typed in for the existing timer feature) does not have.
It would also need new frontmatter/marker parsing, new validation (do
per-slide budgets need to sum to the target duration? what happens if they
do not?), and a second UI surface to author and review those budgets — real
implementation cost for a presenter benefit (evenly-paced slides are already
a reasonable default assumption for most decks) that a flat ratio already
delivers for zero additional authoring. The simple formula reuses a value
that already exists for the timer feature and needed no new state, no new
parsing, and no new failure mode beyond the ones `updateTimerDisplay()`
already handles for that same target-duration input.

**(c) Fragment-aware advance, reset-on-navigation, no looping.** Chosen for
correctness: routing the timer through `advance()` rather than a raw
`goTo()` jump means a fragment-bearing slide under auto-advance still
reveals one fragment at a time, matching what a viewer would see under
manual navigation — a raw index timer (option 3) would either skip fragments
entirely or require duplicating fragment-reveal logic in a second code path,
worse on both correctness and duplication grounds. Resetting on any real
navigation (not just a timer tick) was chosen because a presenter who steps
in manually mid-countdown should get a full fresh interval, not have the
timer fire again almost immediately on whatever was left of the old one.
Looping (option 2) was explicitly deferred rather than shipped
half-correct, and the reason is concrete, not just "less code": looping back
to slide 1 with every fragment on every slide still marked
`is-revealed` (this repo's fragment state is looked up fresh from the live
DOM, never reset automatically) would show a "second lap" with nothing left
to reveal at all — every fragment already visible — which is not actually a
second presentation of the deck, it just repeats the final static state.
Doing looping correctly would require a new bulk fragment-reset function
(there is currently only `revealNextFragment`/`concealLastFragment`, which
step one fragment at a time), a decision about whether the presenter-view
elapsed timer and the new pacing indicator should reset per lap or keep
counting up indefinitely across laps, and e2e test coverage that can
actually observe a full loop boundary without making the real-browser test
suite (`tests/presentationMode.test.ts`) run for a full auto-advance cycle
plus wraparound. None of that is unsolvable, but none of it was solved in
this pass — the timer stopping cleanly at the end of a fixed-length,
non-looping deck is the honestly-scoped version of this feature, not the
final one.

## Consequences

**Good:**

- Alt+click-to-zoom coexists with plain-click-to-advance with no ordering
  bugs, verified by a real, unmocked browser test
  (`tests/presentationMode.test.ts`), not just a string assertion against
  the script's source.
- The pacing indicator needed zero new frontmatter, zero new CLI flags, and
  zero new parsing/validation — it is pure derived state from a value
  (target duration) this project already collects for a different feature.
- Auto-advance's fragment-awareness means a kiosk-mode deck with
  incrementally-revealed bullets still presents them incrementally, exactly
  as a human presenter clicking through would see them, rather than dumping
  a slide's full content the instant the timer reaches it.

**Bad / open risks:**

- **Auto-advance does not loop.** A kiosk-style deck meant to run
  unattended for hours will reach the last slide and simply stop advancing,
  requiring a human (or an external process restarting `nh-deck render`) to
  restart the presentation. This is disclosed here as a real, known scope
  limit, not an oversight — see the Decision Outcome above for exactly what
  correct looping would need.
- **The pacing formula assumes uniform per-slide pacing.** A deck with one
  deliberately long, dense slide and nine short ones will show that long
  slide's presenter as "behind" even if they are pacing that specific slide
  exactly as intended — the formula has no way to know a slide is supposed
  to take longer than average, since it does not carry any per-slide weight.
- **Alt+click has a discoverability cost.** A viewer with no reason to try
  holding Alt while clicking has no on-slide visual affordance telling them
  a zoomable element is zoomable at all, beyond the existing `?`
  keyboard-shortcuts help overlay listing it as a shortcut.

## Confirmation

This decision is confirmed as implemented by:

1. `src/presentationScript.ts` — `openZoom()`/`closeZoom()`/
   `ZOOM_TARGET_SELECTOR` (zoom), `updatePacingDisplay()` (pacing), and
   `startAutoAdvanceTimer()`/the `autoAdvanceMs` guard (auto-advance), each
   with its own module-docstring section explaining the exact design this
   ADR records decisions for.
2. `src/render.ts` — `ZOOM_STYLE` (the full-screen overlay, capped at
   90vw/90vh), the `.presenter-pacing` CSS block, and the
   `data-auto-advance-ms` `<body>` attribute emitted by `generateHtml()`.
3. `src/cliHelpers.ts`/`src/index.ts` — `parseAutoAdvanceSeconds()` and
   `computeEffectiveAutoAdvance()`, the `--auto-advance <seconds>` flag and
   `auto-advance:` frontmatter key with flag-wins precedence.
4. `tests/presentationScript.test.ts` and `tests/presentationMode.test.ts`
   — string-assertion and real-browser coverage for all three features,
   including the ahead/behind/on-pace pacing outcomes, the Alt+click zoom
   open/close/restore-position behavior, and the fragment-aware,
   reset-on-navigation, no-loop auto-advance behavior.
5. `tests/cliHelpers.test.ts` and `tests/render.test.ts` — coverage for
   `parseAutoAdvanceSeconds()`'s validation and `generateHtml()`'s
   `data-auto-advance-ms` attribute emission.
6. The full existing test suite, `npm run build`, `npm run lint`, and
   `npm run typecheck` all passing unchanged.

## More Information

- `docs/adr/0009-templates-transitions-presentation-mode.md` — the ADR that
  introduced presentation mode itself and its existing precedence rules
  (Escape/click/keydown ordering) this batch's zoom and auto-advance
  features had to layer on top of without breaking.
- `docs/adr/0010-axe-core-ci-and-slide-announcements.md` — the most recent
  prior ADR, and the template this one follows for structure and tone.
- `src/presentationScript.ts`'s own module docstring — the implementation
  detail referenced throughout this ADR (`ZOOM_TARGET_SELECTOR`,
  `updatePacingDisplay()`, `startAutoAdvanceTimer()`).
