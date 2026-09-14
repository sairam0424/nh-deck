# Accessibility

This document states, as plainly and honestly as possible, what nh-deck
actually does and does not do for accessibility today. It is a factual
snapshot of shipped behavior — cross-referenced against the source in
`src/render.ts` and `src/presentationScript.ts`, the regression tests in
`tests/`, and the history in `CHANGELOG.md` — not a marketing claim and not
a roadmap. **nh-deck does not claim conformance with any WCAG level.** Some
real accessibility work has shipped; real gaps remain. Both are listed
below without rounding up.

If you are evaluating nh-deck for an accessibility-conscious context, read
the "Not Yet Verified or Supported" section before the "What's Supported"
one — it is the section that actually determines whether this tool is
ready for your use case.

## What's Supported Today

### Keyboard-only navigation in presentation mode

Presentation mode (`?present` in the served URL) is fully operable from the
keyboard — every action it exposes also has a key, not just a click or
touch target:

| Key | Action |
| --- | --- |
| `→` / `Space` | Advance: reveals the current slide's next fragment if one remains, otherwise moves to the next slide |
| `←` | Retreat: conceals the current slide's last-revealed fragment if one is revealed, otherwise moves to the previous slide |
| `Home` | Jump to the first slide (with all its fragments already revealed) |
| `End` | Jump to the last slide (with its fragments reset to concealed) |
| `Escape` | Context-sensitive: cancels an in-progress slide jump, else closes the help overlay, else closes the grid overview, else exits presentation mode back to the continuous-scroll view (only one of these happens per press) |
| `?` | Opens/closes the keyboard-shortcuts help overlay |
| `o` / `O` | Opens/closes a grid overview of every slide as clickable thumbnails |
| `g` / `G`, then digits, then `Enter` | Starts a slide-jump: type a slide number and confirm it |
| `p` / `P` | Opens a second, read-only presenter-view window (current + next slide, presenter notes, elapsed timer) |

Click and touch-swipe (a horizontal swipe left/right, gated so it never
hijacks ordinary vertical scrolling) are available as alternatives to the
keyboard, not replacements for it — every one of the actions above is
reachable with a keyboard alone. The default continuous-scroll view (no
`?present`) has no custom keyboard handling at all — it is a plain
scrollable HTML document, so ordinary browser/OS scrolling and navigation
behavior applies unmodified.

Source: `src/presentationScript.ts`'s module docstring and its `keydown`
listener; the on-screen help overlay itself lists a shorter summary of this
same list (it does not currently mention `p`/`P`).

### Keyboard-shortcuts help overlay

Pressing `?` (or clicking the always-visible "? controls" hint button)
opens a full-screen overlay listing the shortcuts above, so the keybinding
scheme is discoverable in-UI rather than only in this document or the
README. Shipped in v1.2.0. It composes with the grid overview (help can be
opened on top of an already-open overview without disturbing it) and closes
on a second `?` or `Escape`.

**Caveat**: the overlay itself has no `role="dialog"`/`aria-modal`
attribute and no focus-trap or focus-move behavior — see "Not Yet Verified
or Supported" below.

### `prefers-reduced-motion` support

A user with the OS-level "reduce motion" preference enabled gets a fast,
linear opacity-only crossfade in place of the full animation, for both:

- the configured slide transition (`fade`/`slide`, via `--transition`),
  shipped in v1.1.0; and
- fragment (incremental bullet/element) reveal and conceal, shipped in
  v1.2.0.

The accommodation deliberately substitutes a fast crossfade rather than
disabling animation outright (`transition: none`) — an instant, jarring cut
is its own kind of jolt. See `src/render.ts`'s `REDUCED_MOTION_STYLE`.

**Caveat**: this CSS is only injected when nh-deck is using its own default
stylesheet. It is skipped whenever a deck supplies `--css` (a full
stylesheet replacement) — consistent with this project's "render
faithfully, don't editorialize" principle (see `SOUL.md`), since `--css`
means the user has taken over rendering entirely, but it also means a
`--css` deck gets no automatic reduced-motion accommodation from nh-deck
itself and would need to add its own.

### `aria-hidden` kept in sync with fragment visibility

Fragments (bullets/elements marked with a trailing `<!-- fragment -->`
comment, revealed one at a time in presentation mode) keep their
`aria-hidden` attribute in lockstep with their actual visual visibility
across all three views that show fragment visibility differently:

- **Presentation mode, mid-navigation**: `aria-hidden="true"` until a
  fragment is revealed, then `"false"` — updated on every
  reveal/conceal/reset step.
- **Grid overview mode**: every fragment on every slide is shown at once
  regardless of reveal state, and `aria-hidden` is set to `"false"` for all
  of them to match.
- **Outside presentation mode** (continuous-scroll view, and PDF/PNG
  export, which never sets `?present` at all): fragments are visible by
  default with no hiding, and `aria-hidden` is removed entirely rather than
  left at a stale `"false"`.

This means a screen reader is never told a fragment is hidden in a view
where it is visually shown, and vice versa — the specific gap the
`syncFragmentAriaForCurrentMode()` docstring in
`src/presentationScript.ts` calls out as unresolved in comparable tools.
Shipped alongside fragment reveal itself in v1.2.0.

### WCAG AA color-contrast verification (theme system)

v1.1.0 fixed a real contrast bug: `--nh-code-bg` and `--nh-border` had been
derived from a theme's `muted`/`line` colors (tuned by the theme system for
Mermaid diagram roles, not UI backgrounds/borders), which collapsed
`--nh-code-bg` to the same hex as `--nh-muted` under the Nord theme —
making the presentation-mode slide counter render invisible against its
own background — and left inline-code foreground/background and border/
page-background contrast below the WCAG 2.x minimums in all 4 shipped
themes. The fix re-derives both variables independently by blending
`--nh-fg` into `--nh-bg` at fixed percentages, verified against the real
WCAG 2.x relative-luminance/contrast-ratio formula.

That verification is not just a one-time claim: `tests/render.test.ts` has
a live-browser regression test (`generateHtml — theme code-bg/border WCAG
contrast`) that renders each of the 4 shipped themes (`light`, `dark`,
`dracula`, `nord`), reads back the actually-resolved colors via a real
browser's `getComputedStyle()`, computes the real WCAG contrast ratio, and
asserts `--nh-code-bg`/`--nh-fg` meets `>= 4.5:1` (WCAG AA for normal text)
and `--nh-border`/`--nh-bg` meets `>= 3:1` (the UI-boundary minimum) for
every theme.

**Scope of this guarantee**: it covers nh-deck's own default-theme UI
tokens (inline-code text/background, borders, the presentation counter) —
not arbitrary colors a deck author writes into their own Markdown content
(inline HTML, a `--css`/`--css-vars` override, or unusual Markdown
formatting). Per this project's "render faithfully, don't editorialize"
principle, nh-deck does not — and will not — inspect or override a deck
author's own content colors; contrast of the *content itself* remains the
deck author's responsibility.

## Not Yet Verified or Supported

Said plainly, without hedging:

- **No screen-reader testing has been performed or documented anywhere in
  this project's history.** Nothing in `CHANGELOG.md`, the ADRs under
  `docs/adr/`, or the test suite reflects a VoiceOver/NVDA/JAWS pass over
  any view. The `aria-hidden` sync work above is real and verified against
  the DOM, but it has not been confirmed against an actual screen reader.
- **No formal WCAG conformance level (A/AA/AAA) is claimed for this
  project as a whole.** The contrast work above is real, tested, and
  specific — it is not the same thing as a conformance audit, and none has
  been run.
- **No dedicated accessibility test tooling (axe-core or equivalent) is
  wired into this project's test suite or CI.** The contrast regression
  test in `tests/render.test.ts` is hand-written WCAG math against specific
  color pairs, not a general-purpose automated a11y scan of rendered
  output.
- **The help overlay and grid overview have no dialog/modal ARIA semantics
  or focus management.** Neither `.presentation-help` nor `.overview` sets
  `role="dialog"`/`aria-modal="true"`, and opening either one does not move
  keyboard focus into it or trap focus inside it while it's open (verified
  by reading `src/presentationScript.ts`: no `tabindex` or `.focus()` call
  exists anywhere in that file). Keyboard operation still works (`Escape`
  closes either one), but the modal-like visual presentation is not backed
  by the matching ARIA/focus contract.
- **Slide changes in presentation mode are not announced to assistive
  technology.** There is no `aria-live` region (or any live-region
  mechanism) announcing the new slide's content when `goTo()` fires, and
  focus is never programmatically moved to the newly active slide.
- **The continuous-scroll default view has not been audited for landmark
  structure or heading hierarchy beyond what Markdown produces naturally.**
  `generateHtml()` sets `<html lang="en">` but does not add a `<main>`
  landmark or any other structural aid — a deck's heading hierarchy is
  exactly whatever the author's own Markdown produces (`#`, `##`, etc.),
  unmodified, consistent with "render faithfully, don't editorialize," but
  also not independently checked for accessibility best practice.

## What This Means in Practice

- A keyboard-only user can operate every presentation-mode feature this
  project ships, and can rely on `prefers-reduced-motion` being respected
  for both transitions and fragment reveal — as long as the deck uses
  nh-deck's own default stylesheet (not `--css`).
- A screen-reader user gets accurate `aria-hidden` state for fragments in
  every view, but should not assume slide changes are announced, that
  focus moves anywhere on navigation, or that the help/overview overlays
  behave like a conventional accessible dialog.
- A low-vision user gets a verified-AA-or-better contrast baseline for
  nh-deck's own UI chrome across all 4 shipped themes, but content-level
  contrast (whatever the deck author actually writes) is not checked by
  the tool.

This document will be updated as accessibility work ships or gaps are
closed — treat any claim here that doesn't match a specific source file,
test, or `CHANGELOG.md` entry as a bug in this document, not in the code.
