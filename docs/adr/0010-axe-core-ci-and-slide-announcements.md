# 0010. axe-core CI scanning and presentation-mode screen-reader announcements

## Status

Accepted — 2026-09-15

## Context and Problem Statement

`ACCESSIBILITY.md` (added in v1.4.0) honestly disclosed two real gaps as
"Not Yet Verified or Supported": nothing in this project ran a real
accessibility-rule engine against actual rendered HTML (the existing test
suite only asserts specific, hand-picked properties, like a theme's own
code-background/border contrast ratio), and presentation mode's `?present`
navigation gave a screen-reader user no signal whatsoever that a slide
change had happened — no announcement, no focus movement, nothing. This
phase closed both gaps for real rather than continuing to carry them forward
as disclosed-but-open.

Two separate decisions from that work are worth recording here, since both
had genuine alternatives this repo's own existing constraints ruled out:

1. How axe-core got wired into CI — plain `axe-core`, manually injected via
   `page.addScriptTag()`, not the official `@axe-core/puppeteer` wrapper
   package.
2. How slide navigation gets announced and focused — a single, always-present
   live region, deliberately gated to skip the script's own first paint and
   to the main presenting window only, announcing heading text with a
   `"Slide N of M"` fallback rather than full slide content.

## Decision Drivers

- **Local-first, no exceptions, even for tooling that never ships.** axe-core
  itself must never be fetched from a CDN, matching the same "no runtime
  network dependency" discipline this repo already applies to rendered
  output (see `AGENTS.md`'s Local-First Constraint) — even though
  `scripts/check-a11y.mjs` is dev/CI-only and never reaches an end user.
- **Never install the full `puppeteer` package.** This repo has an explicit,
  standing rule (`AGENTS.md` Security Notes) against swapping
  `puppeteer-core` for full `puppeteer` or adding it alongside, because it
  bundles its own browser-download step — a real, silent network dependency
  at install time. Anything added for accessibility tooling has to respect
  that constraint too, not just the rendering/export code it was originally
  written for.
- **A screen-reader user needs a real, useful signal on every navigation —
  without being buried in noise, and without a redundant second
  announcement.** Presenter-view windows (shipped earlier) already mirror
  the main window's slide index; two windows independently announcing the
  identical text a moment apart would be confusing duplication, not help.
- **The live region and focus-management code must never fire before a
  viewer has actually navigated.** The presentation script's own automatic
  `render()` call on page load is not a user-initiated navigation, and
  treating it as one would tell a screen reader "you moved to slide 1" the
  instant the page finished loading — a false signal, since nothing moved.

## Considered Options

### axe-core wiring

1. **Plain `axe-core`, manually injected**: read axe-core's own built
   `node_modules/axe-core/axe.min.js` via `readFileSync`, inject it with
   `page.addScriptTag({ content: ... })`, then call
   `page.evaluate(() => axe.run())` directly.
2. **`@axe-core/puppeteer`**, the official wrapper package providing an
   `AxeBuilder` convenience API around that same injection mechanism.
3. **A third-party wrapper** built for a different browser-automation
   library (e.g. `axe-playwright`), adapted to this repo's `puppeteer-core`
   usage.

### Slide-navigation announcement and focus design

1. **A single, always-emitted `#nh-deck-live-region`** (`aria-live="polite"`,
   `aria-atomic="true"`), updated by `presentationScript.ts`'s `render()`,
   gated to the main presenting window only (`!isPresenterView`) and to real
   navigations only (`hasNavigated`, set the moment real navigation starts
   in `goTo()` — never inside `render()` itself, so `render()`'s own very
   first, load-time call can tell it apart from every real one that
   follows). Announces the newly active slide's first `h1`/`h2`/`h3` heading
   text, or a `"Slide N of M"` fallback when it has none. Also moves real
   keyboard focus (`tabindex="-1"` + `.focus({ preventScroll: true })`) onto
   the newly active slide, removing `tabindex` from whichever slide
   previously carried it.
2. **Announce from both the main window and any open presenter-view
   window.**
3. **Announce the slide's full text content**, not just its heading.
4. **Skip the `hasNavigated` gate** and announce/focus on the very first
   paint too.
5. **Move focus without any announcement, or announce without moving
   focus** — pick one signal, not both.

## Decision Outcome

Chosen: **Option 1 in both categories.**

**axe-core wiring** — rejected `@axe-core/puppeteer`: verified via
`npm view @axe-core/puppeteer peerDependencies` that it declares
`puppeteer: >=1.10.0` as a peer dependency — the exact full package this
repo has a standing rule against installing (see Decision Drivers above).
Since this repo uses `puppeteer-core` exclusively, adding
`@axe-core/puppeteer` would either produce an unmet-peer-dependency warning
or force installing the one package this project explicitly forbids, in
exchange for a convenience wrapper (`AxeBuilder`) around a mechanism this
project's own ~15-line `runCase()` helper in `scripts/check-a11y.mjs`
already implements directly: read axe-core's own built file, inject it, run
it, read back `results.violations`. A third-party wrapper built for a
different automation library was rejected for the same category of reason
— an extra dependency, and one built against an API this repo does not use,
for functionality already this cheap to write directly against the
`puppeteer-core` this repo already has.

**Slide-navigation announcement and focus** — rejected announcing from both
windows: a screen reader is realistically only ever attached to one of the
two windows a presenter is actually using at a given moment, and having both
independently announce the identical text a moment apart is redundant noise,
not help — this is why the gate is `!isPresenterView`, not "announce from
whichever window has focus" (a harder thing to detect reliably from either
window in isolation). Rejected announcing full slide content: dumping an
entire slide's text into a `polite` live region on every arrow-key press
would bury a screen-reader user rather than orient them; a heading (or
slide-count fallback) is enough to know where they landed without repeating
content already reachable through the DOM. Rejected skipping the
`hasNavigated` gate: the script's own initial `render()` call when the page
first loads under `?present` is not a navigation a viewer initiated, so
treating it as one would announce a false "you moved to slide 1" signal
before anything actually moved. Rejected picking only one of
announcement-or-focus: a live region alone tells a screen reader something
changed but does not move a subsequent `Tab` press's starting point onto the
new slide's own content; focus alone, with no accompanying text change, is
not reliably spoken by every screen-reader/browser combination when the
focus target is a plain, non-interactive element carrying only
`tabindex="-1"`. Doing both together is what actually closes the gap
end-to-end — the same "verify the actual browser behavior, do not assume it"
discipline that also drove `restoreFocus()`'s blur-before-focus fix for the
help overlay/grid overview (a real headless Chromium check found that
calling `.focus()` directly on `document.body` when nothing else had focus
is a silent no-op).

## Consequences

**Good:**

- axe-core CI (`npm run check:a11y`, the `a11y-check` job in
  `.github/workflows/ci.yml`) catches structural/contrast regressions the
  existing string-assertion suite cannot, using only a devDependency this
  phase already needed to add — no wrapper package, no peer-dependency
  conflict with this repo's `puppeteer-core`-only rule.
- A screen-reader user navigating `?present` now gets both an audible cue
  and a real DOM focus target on every navigation, closing a gap
  `ACCESSIBILITY.md` had disclosed as open since v1.4.0 — see its own
  "Screen-reader announcements and focus management on slide navigation"
  section for the shipped, source-cited behavior.
- Both mechanisms respect this repo's existing constraints without needing
  any new exception carved out: no CDN fetch for axe-core, no full
  `puppeteer` install, no announcement/focus firing before a viewer has
  actually done anything.
- Reusing the presenter-view system's existing `isPresenterView` flag to gate
  the announcement meant no new window-identification mechanism needed
  inventing — the same flag that already drives presenter-console-only
  rendering elsewhere in `presentationScript.ts`.

**Bad / open risks:**

- **The axe-core scan is a regression gate over a fixed, small fixture
  matrix, not a WCAG conformance audit.** It covers presentation mode's
  first paint at `/?present`, not the live-region announcement after a real
  keypress, nor the help overlay or grid overview while open — see
  `scripts/check-a11y.mjs`'s own header comment and `ACCESSIBILITY.md`'s
  caveat for the exact scope. Only `serious`/`critical` impact violations
  gate the build; `moderate`/`minor` findings are never surfaced, since
  axe-core's own docs note those lower tiers carry a meaningful
  false-positive rate.
- **The announcement is a best-effort label, not a content readout** — a
  slide's first heading, or a slide-count fallback, never its full body.
  A slide with a misleading or generic heading (e.g. multiple slides titled
  "Details") gives a screen-reader user a less specific orientation signal
  than a sighted viewer gets from glancing at the whole slide.
- **Dialog semantics on the help overlay/grid overview move and restore
  focus but do not trap it** — nothing intercepts `Tab` while either is
  open, so keyboard focus can still be tabbed out past the overlay's own
  visual boundary while it remains open. A full focus trap was not built in
  this phase.

## Confirmation

This decision is confirmed as implemented by:

1. `scripts/check-a11y.mjs` — the fixed-case matrix built from `THEMES`
   (`src/themes.ts`) and `LAYOUTS` (`src/slideLayouts.ts`) directly (not a
   hardcoded name list), the RTL and `?present` cases, `FAILING_IMPACTS`
   restricted to `serious`/`critical`, and the no-local-browser skip path
   mirroring `scripts/check-pdf-fidelity.mjs`'s own precedent.
2. The `a11y-check` job in `.github/workflows/ci.yml`, running
   `npm run check:a11y` on every PR.
3. `tests/render.test.ts` — the unconditional-emission assertion for
   `#nh-deck-live-region`.
4. `tests/presentationScript.test.ts` — string-assertion coverage for the
   `hasNavigated` gate, the `!isPresenterView` gate, the heading-or-fallback
   announcement text, and the help overlay/grid overview's `role="dialog"`/
   `aria-modal="true"` attributes and `focusIntoPanel()`/`restoreFocus()`
   behavior.
5. `tests/presentationMode.test.ts`'s "accessibility: live region + focus
   management" describe block — a real, unmocked browser test asserting the
   announcement text actually changes between two different slides, that
   focus lands on the newly active slide, and that the very first paint
   leaves focus on `document.body` untouched, plus the matching real-browser
   assertions for the help overlay's dialog/focus-restore behavior.
6. `ACCESSIBILITY.md`'s "Screen-reader announcements and focus management on
   slide navigation", "Dialog ARIA semantics and focus management for the
   help overlay and grid overview", and "Automated accessibility scanning
   (axe-core in CI)" sections — the honest, source-cited write-up of what
   shipped and its own caveats, replacing what those same sections
   previously listed as open gaps.
7. The full existing test suite, `npm run build`, `npm run lint`, and
   `npm run typecheck` all passing unchanged.

## More Information

- `AGENTS.md`'s Security Notes — the standing "never install full
  `puppeteer`" rule this ADR's axe-core wiring decision follows.
- `CLAUDE.md`'s local-first stop-and-ask gate — the same discipline this
  ADR's "axe-core injected locally, never from a CDN" decision follows, even
  though `scripts/check-a11y.mjs` is dev/CI-only tooling.
- `ACCESSIBILITY.md` — the living, honest accessibility status doc this
  phase moved three items out of "Not Yet Verified or Supported" and into
  "What's Supported Today," each with its own caveat.
- `src/presentationScript.ts` and `src/render.ts` — the implementation
  referenced throughout this ADR (`SR_ONLY_STYLE`, `#nh-deck-live-region`,
  `hasNavigated`, `focusIntoPanel()`, `restoreFocus()`).
- `scripts/check-a11y.mjs` — the axe-core scan implementation.
