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

**Caveat**: the overlay's own container now carries `role="dialog"` and
`aria-modal="true"`, and opening it moves focus into its panel while
closing it restores focus to wherever it was beforehand — see "Dialog ARIA
semantics and focus management for the help overlay and grid overview"
below for the source. That is still not a focus trap: nothing intercepts
`Tab`, so keyboard focus can be tabbed out past the overlay's own boundary
while it remains open.

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

### Screen-reader announcements and focus management on slide navigation

Presentation mode now tells a screen reader that a slide change happened,
and moves keyboard focus to reflect it. `generateHtml()` in `src/render.ts`
unconditionally emits a visually-hidden `#nh-deck-live-region` div
(`aria-live="polite"`, `aria-atomic="true"`) in `<body>` via the new
`SR_ONLY_STYLE` clip-based CSS pattern — deliberately not `display: none`
or `visibility: hidden`, either of which would remove the element from the
accessibility tree too. `src/presentationScript.ts`'s `render()` function
grabs that region once at setup, and — gated on `!isPresenterView &&
hasNavigated`, i.e. the main presenting window only, and never on the very
first paint before any real navigation — sets its text to the newly active
slide's first `h1`/`h2`/`h3` heading text, or a `"Slide N of M"` fallback
when the slide has no heading. The same block also gives the newly active
slide `tabindex="-1"` and calls `.focus({ preventScroll: true })` on it,
first removing `tabindex` from whichever slide previously carried it.

Covered by `tests/presentationMode.test.ts`'s "accessibility: live region +
focus management" describe block (a real-browser regression suite
asserting the announcement text actually changes between two different
slides, that focus lands on the newly active slide, and that the very first
paint leaves focus on `document.body`), `tests/presentationScript.test.ts`'s
matching string-assertion coverage, and one unconditional-emission
assertion in `tests/render.test.ts`.

**Caveat**: the announcement is a best-effort label, not a content readout
— it is the slide's own first heading, or a slide-count fallback, never the
slide's full body content. This is a deliberate design choice, not a
shortcut: dumping an entire slide's content into a live region on every
navigation would bury a screen-reader user in noise rather than help them,
so this only ever announces enough to orient, not the whole slide.

### Dialog ARIA semantics and focus management for the help overlay and grid overview

The keyboard-shortcuts help overlay and the grid overview now behave like a
real modal dialog to assistive technology, not just visually. In
`src/presentationScript.ts`, `openHelp()`/`closeHelp()` set and remove
`role="dialog"`/`aria-modal="true"` on the help overlay's own container,
and `openOverview()`/`closeOverviewUi()` do the same on `document.body`
(the grid overview has no dedicated wrapper of its own — its CSS applies
directly to `<body>`). A shared `focusIntoPanel()` helper moves focus onto
a real focusable child of the just-opened panel if one exists, or gives the
panel itself `tabindex="-1"` and focuses that. A shared `restoreFocus()`
helper blurs the current active element before focusing the
`focusBeforeHelp`/`focusBeforeOverview` target captured right before the
overlay opened, once it closes — blurring first is required because calling
`.focus()` directly on `document.body` (the common case when nothing else
had focus beforehand) is a silent no-op otherwise, which a real headless
Chromium check confirmed would leave focus stuck on the just-hidden panel.

Covered by `tests/presentationMode.test.ts`'s real-browser test asserting
the help overlay's `role`/`aria-modal` attributes, that focus lands inside
its panel on open, and that focus returns to `document.body` after
`Escape` closes it, plus `tests/presentationScript.test.ts`'s matching
string-assertion coverage for both overlays.

**Caveat**: this is dialog semantics plus a one-time focus move on open and
a focus restore on close — it is not a focus trap. Nothing intercepts
`Tab` while either overlay is open, so keyboard focus can still be tabbed
out past the overlay's own boundary while it remains visually open.

### Automated accessibility scanning (axe-core in CI)

`scripts/check-a11y.mjs` runs axe-core against real rendered HTML for a
fixed set of cases, built from this project's own registries so the check
can never silently drift out of sync with them: every theme in `THEMES`
(`src/themes.ts`), every layout in `LAYOUTS` (`src/slideLayouts.ts`), one
RTL-direction case, and one presentation-mode (`?present`) case — all
served locally and driven through a real local browser via
`puppeteer-core`, with axe-core itself injected from its own built
`node_modules/axe-core/axe.min.js` file via `page.addScriptTag()`, never
fetched from a CDN. Only axe-core's `serious` and `critical` impact
violations (`FAILING_IMPACTS`) fail the check; `moderate`/`minor` findings
are not surfaced or gated, since axe-core's own docs note those lower tiers
carry a meaningful false-positive rate. Wired up as `npm run check:a11y`
and a dedicated `a11y-check` job in `.github/workflows/ci.yml` that runs on
every PR.

**Caveat**: this is a regression gate over a fixed, small fixture matrix —
4 themes, 4 layouts, one RTL case, one presentation-mode case, each against
one representative fixture deck — not exhaustive coverage of every
interaction state. It scans presentation mode's first paint at `/?present`,
not the live-region announcement after a real keypress, the help overlay
or grid overview while open, or any other mid-interaction state. A clean
run means these specific fixed renders have no automated-detectable
serious/critical issue; it is not a WCAG conformance audit and it is not a
substitute for an actual screen-reader pass.

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
  every view, a live-region announcement plus a focus move onto the newly
  active slide after every real navigation, and `role="dialog"`/
  `aria-modal` semantics with focus moved in on open and restored on close
  for the help overlay and grid overview. None of this is trapped focus,
  and none of it has been confirmed against an actual screen reader — the
  automated axe-core scan in CI checks a fixed set of rendered fixtures for
  detectable rule violations, which is a real but narrower guarantee than a
  VoiceOver/NVDA/JAWS pass, and that pass still has not been performed (see
  "Not Yet Verified or Supported" above).
- A low-vision user gets a verified-AA-or-better contrast baseline for
  nh-deck's own UI chrome across all 4 shipped themes, but content-level
  contrast (whatever the deck author actually writes) is not checked by
  the tool.

This document will be updated as accessibility work ships or gaps are
closed — treat any claim here that doesn't match a specific source file,
test, or `CHANGELOG.md` entry as a bug in this document, not in the code.
