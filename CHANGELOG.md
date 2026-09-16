# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.10.0] - 2026-09-16

A single feature this release: a genuine static-site export path for a
deck, so it can be deployed as a plain, hostable set of files with no
server-side code at all. See
`docs/adr/0013-static-site-export.md` for why this shipped as its own
subcommand rather than a new mode bolted onto `render`.

### Added

- **`nh-deck build <file> [output]`**: a new subcommand that writes a
  deck to a static output directory (`<outputDir>/index.html`) instead of
  serving it through `render`'s local dev server. The HTML it writes is
  the exact same fully self-contained, CDN-free document `render`/`pdf`/
  `png` already produce -- `build` calls the identical `generateHtml()`
  every other command already calls, with no second/parallel rendering
  path -- so it inherits every existing guarantee that HTML already has:
  no CDN reference, no bundled/downloaded browser, embedded KaTeX/Mermaid
  assets, themes, custom CSS, and presenter notes all working exactly as
  they do today. Because the written file needs nothing beyond a static
  file server (or no server at all -- it opens correctly straight off
  disk via a `file://` URL) to be viewed, deploying a deck now needs zero
  server-side code: drop `index.html` on any static host and it works.
  Structured as a sibling of `pdf`/`png` -- same `<file> [output]`
  positional shape, same frontmatter/theme/direction/notes resolution --
  not as a new `render` mode; `--transition` is the one option `build`
  shares with `render` rather than `pdf`/`png`, since `build`'s output
  stays the same interactive, presentable document `render` serves,
  unlike a flattened PDF page or PNG screenshot. A default output
  directory (`<name>-site/`) is derived from the input filename when none
  is given, mirroring how `pdf`/`png` already derive their own default
  output paths.
- **Presentation mode and hash-based slide addressing already work
  against static `build` output, with zero additional code written for
  either.** Verified directly against a real `file://` static output, not
  assumed: `?present` on the built `index.html`'s URL, plus a `#N`
  hash to jump straight to slide N, both worked exactly as they do
  against `render`'s served HTML, because `presentationScript.ts` already
  drives all of its navigation client-side through `location.hash` and
  `location.search` -- properties any browser exposes identically whether
  the document arrived over HTTP or straight off local disk. Nothing
  about that script assumes a server exists, so it needed no changes at
  all to keep working here.
- **True per-slide multi-page static output (one URL per slide, e.g.
  `slide-2.html`) is an intentional, deliberately deferred fast-follow,
  not part of this release.** `build` writes exactly one `index.html`
  containing every slide, the same single-document shape `render`/`pdf`/
  `png` already produce -- splitting that into one file per slide with
  working cross-links would be a real, separate piece of work (path
  rewriting for internal navigation, a shared-asset strategy across
  files), not a small addition to this release's own scope.

## [1.9.0] - 2026-09-16

Three authoring/rendering features for decks with real code and visual
variety: real syntax highlighting for fenced code blocks, Slidev-style line
highlighting layered on top of it, and an opt-in per-slide background
marker. See `docs/adr/0012-syntax-highlighting-and-line-highlight.md` for
the integration-path and technique decisions behind the first two.

### Added

- **Syntax-highlighted code blocks**: fenced code blocks now render with
  real syntax highlighting via highlight.js, covering a curated
  12-language subset -- JavaScript, TypeScript, Python, Bash, JSON, YAML,
  CSS, XML (which also covers HTML, since highlight.js has no separate
  HTML grammar), Markdown, SQL, Rust, and Go -- registered individually
  through `highlight.js/lib/core` rather than pulling in the full
  ~190-language bundle, so the dependency's footprint stays proportional
  to what a slide deck actually needs rather than what highlight.js ships
  by default. A fence tagged with any other language (or a typo) degrades
  harmlessly to plain, unhighlighted text instead of throwing. The
  mermaid diagram code path is completely unaffected by this change and
  guaranteed to stay that way: a `mermaid`-tagged fenced block is still
  recognized and dispatched to the existing SVG diagram renderer before
  highlighting is ever attempted, so a deck mixing highlighted code and
  Mermaid diagrams renders both correctly with zero interaction between
  the two.
- **Code-block line highlighting**: a Slidev-style `{1|3-4}` annotation
  appended to a fenced code block's language tag (e.g. ` ```js {1|3-4} `)
  highlights the named line numbers with a themed background tint, reusing
  the same `--nh-accent` custom property every other themed element in
  this file already does. This release ships exactly one static
  highlighted range per code block, fixed at render time -- true
  incremental, multi-step reveal (the highlighted range advancing on its
  own alongside presentation-mode navigation, the way Slidev's own version
  of this feature works) is an explicit, deliberately deferred fast-follow
  for a later release, not something this pass attempted a partial version
  of.
- **Per-slide background color/image**: an opt-in `<!-- bg: value -->` or
  `<!-- bg-image: value -->` HTML comment, placed anywhere in a slide's
  own Markdown source, sets that slide's background -- a color for `bg:`,
  or an escaped `url(...)` background-image for `bg-image:`. Unlike the
  existing `<!-- layout: name -->` marker, whose CSS is dropped the moment
  a custom `--css` stylesheet replaces the baseline one, a background
  marker's value is written through as a plain inline `style` attribute
  directly on that slide's own `<section>` element, not a shared
  stylesheet rule -- so it is NOT suppressed by `--css`: a `--css`
  replacement only ever replaces the document's `<style>` block, never a
  per-element attribute, and a background choice an author actually typed
  in should not silently vanish just because they also supplied their own
  stylesheet. See the ADR's decision (c) for the full reasoning.

### Fixed

- **Syntax-highlighted code blocks had no visible color**: highlight.js's
  `hljs-*` token classes were being emitted correctly on every
  highlighted block, but this project's own stylesheet had zero CSS rules
  defining what color any of them should actually be -- every token
  silently inherited the same flat `code { color: var(--nh-fg); }` rule
  the rest of a code block already had, so a "highlighted" block rendered
  in one uniform color, visually indistinguishable from an unhighlighted
  one. The existing test suite never caught this because it only asserted
  the `hljs-*` class NAMES were present in the markup, never that they
  actually resolved to a different color -- found in this release's own
  final-integration pass via a real-browser `getComputedStyle()` check,
  the same technique the line-highlighting feature above already used to
  prove its own tint was real. Fixed with a small three-tier color rule
  set (muted/italic comments, accented keywords, an accent-and-foreground
  blend for literal values and names), built entirely from this project's
  existing `--nh-accent`/`--nh-fg`/`--nh-muted` custom properties rather
  than new hardcoded colors, so highlighting now shifts correctly across
  all 4 named themes instead of only ever looking like the light theme.
  Suppressed under a custom `--css` stylesheet the same way the code-block
  line-highlight tint already is.

## [1.8.0] - 2026-09-16

Three presentation-mode interactivity features batched into a single
release: a presenter-facing pacing signal, a viewer-facing zoom mechanic,
and a self-driving mode for kiosk/unattended presenting. See
`docs/adr/0011-presentation-interactivity-batch.md` for the design
decisions behind all three, including two rejected alternatives that were
not just a matter of taste.

### Added

- **Click-to-zoom on dense content**: Alt+click (Option+click on macOS)
  an image, a Mermaid diagram, a fenced code block, a table, or a block
  math expression in presentation mode to zoom it into a full-screen
  overlay, capped at 90% of the viewport so it never overflows regardless
  of its natural size. Closes via Escape or a click on the darkened
  backdrop, restoring the zoomed element to its exact original position in
  the slide -- including when it is nested several levels deep, e.g.
  inside a list item inside a two-column layout. Double-click was
  considered and rejected for this, not just stylistically passed over --
  see the ADR for why it is a genuinely broken interaction here, not a
  taste call.
- **Per-slide pacing indicator in presenter view**: next to the existing
  elapsed-time display, a presenter with a target duration typed in now
  sees a live "on pace", "N ahead", or "N behind" readout, derived by
  comparing the slide index they are actually on against the slide index
  a simple ratio of elapsed time to target duration says they should be
  on by now. Updates once a second from the same clock that already
  drives the timer, plus immediately on every navigation so it never lags
  a full second behind a real slide change. Entirely opt-in on the same
  typed target duration the timer already requires -- no duration means
  no pacing text at all.
- **Auto-advance / kiosk mode**: a new `--auto-advance <seconds>` flag and
  matching `auto-advance:` frontmatter key (the flag wins when both are
  given) make presentation mode advance itself on a timer instead of
  waiting for manual input, for a kiosk-style loop or a strictly timed
  self-paced run-through. It advances through a slide's own fragments one
  at a time first, exactly the way a real arrow-key press already does,
  only moving to the next slide once nothing is left to reveal on the
  current one. Any real manual navigation -- arrows, click, jump-to-slide,
  a grid-overview thumbnail -- resets the countdown back to full, so
  stepping in by hand mid-countdown does not get immediately overridden by
  the timer. Looping back to slide 1 after the last slide is deliberately
  not supported yet: the timer simply stops once the last slide has
  nothing left to reveal, rather than wrapping around -- see the ADR for
  what looping would have cost to do correctly in this same pass.

## [1.7.0] - 2026-09-15

Housekeeping plus real accessibility work: closing out Node 20 now that its
own upstream lifecycle has ended, and turning presentation mode's
screen-reader gaps -- honestly disclosed as open in `ACCESSIBILITY.md` since
v1.4.0 -- into shipped, tested behavior.

### Added

- **axe-core accessibility scanning in CI**: a new `a11y-check` job renders
  every theme, every layout, the opt-in RTL direction, and presentation mode
  through a real local browser and runs axe-core against each, failing the
  build on any "serious" or "critical" violation. This closes the gap
  between the existing snapshot/string-assertion test suite -- which only
  asserts specific, hand-picked properties like theme contrast ratios -- and
  what a real accessibility-rule engine flags against the actual rendered
  DOM. axe-core is injected from its own built `node_modules` file, never
  fetched from a CDN, so this stays consistent with the local-first
  constraint even though it is dev/CI-only tooling that never ships.
- **Slide-change announcements for screen readers**: presentation mode now
  speaks each navigation to assistive technology via a visually-hidden live
  region, announcing the newly active slide's own first heading (or a
  "Slide N of M" fallback when a slide has none). Previously, a
  screen-reader user navigating `?present` had no signal a slide change had
  happened at all -- the deck looked identical to them before and after
  every arrow-key press.
- **Focus management in presentation mode**: the newly active slide now
  receives real keyboard focus on every navigation, where previously focus
  never moved anywhere during a presentation. The help overlay and grid
  overview also gained proper dialog semantics -- `role="dialog"` and
  `aria-modal="true"` on their own container, focus moved into the panel the
  moment either opens, and focus restored to wherever it was right
  beforehand once either closes -- so a keyboard or screen-reader user is
  never left stranded inside, or locked out of, either overlay.

### Changed

- **Dropped Node 20 support** (`engines.node` is now `>=22`): Node 20
  reached its own upstream end-of-life on 2026-04-30, so this project no
  longer carries support for an unmaintained runtime. The CI matrix drops
  from 9 to 6 build-and-test combinations (`ubuntu-latest`/`macos-14`/
  `windows-latest` x Node 22/latest).
- **Five dependency patch bumps**: `marked` ^18.0.12 -> ^18.0.13,
  `puppeteer-core` ^25.10.0 -> ^25.11.0, `vitest` ^5.0.0 -> ^5.0.1, `open`
  ^11.0.2 -> ^11.0.4, and `@types/node` ^26.5.0 -> ^26.5.1 -- zero known
  CVEs, confirmed via `npm audit`.

## [1.6.0] - 2026-09-15

Three items from a deep-research pass on the deferred backlog, all confirmed
buildable with zero new dependencies.

### Added

- **PDF outline/bookmark navigation**: exported PDFs now populate the
  bookmarks sidebar every major PDF viewer already has (Preview, Acrobat,
  Chrome's own viewer), derived automatically from the deck's own
  `<h1>`-`<h6>` heading structure -- no authoring control needed or added,
  since every heading becoming its own entry is the correct, faithful
  default for this project.
- **Live theme preview during `render --watch`**: a small on-page control
  lets you click through all 4 named themes against your own deck content
  without hand-editing frontmatter, reusing the existing SSE live-reload
  channel end to end -- including correct Mermaid diagram recoloring,
  which a CSS-only approach could not have done. Absent entirely outside
  `--watch`, and a no-op until a preview click actually happens.
- **Opt-in RTL text direction**: a `dir: rtl` frontmatter key or `--dir`
  flag (mirroring `--theme`/`--transition`'s own precedence) renders a
  deck's own content right-to-left for Arabic/Hebrew/Farsi/Urdu decks and
  similar. A deck with neither renders byte-identical to before this
  release. Scoped to text direction only -- presentation-mode navigation
  keys and chrome positioning are unchanged.

## [1.5.0] - 2026-09-14

A small fast-follow, closing out the last item deliberately deferred from
the presenter-view window shipped in v1.3.0.

### Added

- The presenter-view timer can now be paused: click the elapsed-time
  display to freeze it, click again to resume from where it left off.
- An optional target duration (in minutes), typed into a small field next
  to the timer, recolors the display amber past 80% of that duration and
  red once it reaches or exceeds the full duration. Entirely opt-in and
  local to the browser (persisted to localStorage, no CLI flag or
  frontmatter key) -- with no duration set, the timer looks exactly as
  it always has.
- The pause control is a real, keyboard-operable button (not just a
  mouse-only click target), with `aria-pressed` kept in sync with the
  pause state. Reading or writing the target duration now degrades
  gracefully, rather than breaking presenter view, if `localStorage` is
  unavailable (private browsing, storage disabled).

## [1.4.1] - 2026-09-14

A production dry run against real decks (real CLI usage, real browser
interaction, real exported files) found one critical rendering bug before
this multi-phase effort closed out. Patch release, no new features.

### Fixed

- **Fragment (incremental reveal) markers did not work when written the
  way this project's own docs describe** -- a marker trailing on the SAME
  line as its bullet or paragraph text (`- Bullet text <!-- fragment -->`),
  exactly as shown in the v1.2.0 entry below. The marker was silently
  dropped with no `class="fragment"` applied anywhere, so an author
  following the documented syntax got their whole slide's content at once
  in presentation mode instead of an incremental reveal, with no error or
  warning. Only the marker-on-its-own-separate-line variant
  (`- Bullet text\n  <!-- fragment -->`) previously worked. Root cause:
  `marked`'s lexer wraps a single line of bullet/paragraph content in an
  extra block token, nesting a same-line marker one level deeper than the
  fragment-extraction logic checked. Both syntaxes are now equivalent and
  covered by regression tests, including a top-level paragraph case.
- The `?`-triggered keyboard-shortcuts help overlay never listed the
  `p`/`P` presenter-view shortcut, even though presenter view (shipped in
  v1.3.0) is a fully working, keyboard-wired feature -- a presenter
  relying on in-app help had no way to discover it exists.
- A same-line trailing marker on a blockquote's own single paragraph
  (e.g. `> A quote <!-- fragment -->`) was consumed by that nested
  paragraph before the blockquote itself got a chance, leaving the quote
  frame always visible while only its text faded in. Found by CodeRabbit
  during this release's own review.
- `nh-deck init`'s starter deck documents presentation-mode shortcuts as
  slide content, and that list had drifted out of sync with the real
  help overlay, missing both jump-to-slide and presenter-view entirely.

### Documentation

- Corrected two changelog entries below (v1.2.0, v1.4.0) that inaccurately
  claimed PNG export produces identical per-slide dimensions unconditionally.
  Per `docs/adr/0006-phase-5-polish.md`'s own documented trade-off, PNG
  dimensions follow each slide's own rendered content height under the
  default stylesheet, so plain and two-column slides can legitimately
  differ in height from slides using a layout with a fixed `min-height`
  (title/section/quote) -- this was never fully fixed, and the earlier
  wording overstated what the v1.2.0 change actually verified.

## [1.4.0] - 2026-09-14

Phase 2 of the backlog-prioritization pass: the remaining ranked quick wins.

### Added

- `nh-deck list-themes`: prints the fixed theme names from the command
  line, noting the default, without rendering anything. README now shows a
  screenshot gallery of all 4 themes.
- Jump-to-slide in presentation mode: press `g`, type a slide number, then
  Enter to jump directly to it (an out-of-range number clamps to the last
  slide; Escape cancels a pending jump). Documented in the `?` help
  overlay alongside the other shortcuts.
- `nh-deck render` now prints `?present`/`?notes` hints after it starts
  serving, so both opt-in URL features are discoverable without reading
  the README. The `?notes` hint only appears when the deck actually has
  presenter notes.
- `ACCESSIBILITY.md`: an honest, sourced snapshot of what's supported
  (keyboard-only navigation, the shortcuts overlay, `prefers-reduced-motion`,
  `aria-hidden` fragment sync, WCAG AA contrast verification) and what
  isn't yet (no screen-reader testing, no WCAG conformance claim, no
  axe-core in CI).

### Fixed

- `--watch` re-renders triggered by a file save were completely silent,
  and a genuine render error (as opposed to a transient mid-save read
  glitch) was swallowed with no trace. A successful rebuild now prints a
  short confirmation; a real render error prints a warning without
  tearing down the server.

### Verified

- PDF exports already carry the deck's title as real PDF document
  metadata (the file's own `/Info Title`, not just the source HTML's
  `<title>` tag) — confirmed against a real exported file and locked in
  with a regression test.
- ~~PNG dimension-uniformity coverage (the v1.2.0 landscape-geometry fix)
  already runs on every PR across the full CI matrix; no gap found.~~
  **Corrected in v1.4.1** — a production dry run against real, varied-content
  decks found this claim too narrow: the existing test only covers a
  controlled-CSS harness, not the real-world content-height variance
  `docs/adr/0006-phase-5-polish.md` already documents as an accepted
  trade-off. See v1.4.1's Documentation section.

## [1.3.0] - 2026-09-14

A backlog-prioritization pass: three ranked items from the outstanding
feature backlog, picked and shipped together as one round.

### Added

- `--with-notes` on `pdf`/`png` export: presenter notes are appended as an
  extra PDF page (or a sibling PNG) immediately after their slide, instead
  of being silently dropped from every export as before. When a deck has
  notes and `--with-notes` isn't passed, a one-line stderr note now says
  so.
- `nh-deck init [file]`: scaffolds a starter deck covering real theme/
  transition frontmatter, all 4 layouts, inline and block KaTeX, a Mermaid
  diagram, a presenter note, and a closing slide that documents
  presentation mode's keyboard shortcuts and query params as slide
  content. Refuses to overwrite an existing file unless `--force` is
  passed.
- A presenter-view window (press `p`/`P` in presentation mode): opens a
  second, read-only window showing the current and next slide, the
  current slide's presenter notes (always visible, no `?notes` needed),
  and a count-up timer, synced live to the main presenting window via
  `BroadcastChannel` and `localStorage`.

## [1.2.0] - 2026-09-13

A second research-informed pass, picking up where 1.1.0 left off: a ground-truth
snapshot of the shipped codebase plus 10 parallel research passes surfaced a
currently-broken export path and nh-deck's biggest capability gap versus peer
tools, both fixed here.

### Fixed

- **PDF and PNG export now produce landscape 16:9 pages instead of portrait
  A4.** Every export was previously broken this way -- slide content came out
  vertically stacked in a narrow portrait column, not a slide-shaped page.
  ~~PNG exports also now share identical dimensions across every slide in
  one export (previously varied with content height, since no viewport
  was locked).~~ **Corrected in v1.4.1** — a fixed viewport was added, but
  each PNG is still cropped to its own slide's rendered content height, so
  dimensions can still legitimately vary across slides of differing
  natural height under the default stylesheet; see
  `docs/adr/0006-phase-5-polish.md`.
- The two-column layout no longer stays stuck at 2 columns inside the grid
  overview mode's shrunk thumbnails -- its responsive breakpoint now queries
  the slide's own box (a CSS container query) instead of the browser
  viewport, which never actually shrinks in overview mode.
- `nh-deck --version` fix from the 1.1.0 development cycle is now correctly
  documented here (it was missed in the 1.1.0 changelog entry itself due to
  branch-protection timing).

### Added

- **Fragment (incremental) reveal**: mark a bullet, paragraph, blockquote,
  code block, or diagram with a trailing `<!-- fragment -->` comment to
  reveal it progressively during presentation mode, one step at a time,
  instead of showing the whole slide at once. Fragments are visible by
  default in the continuous-scroll view and in PDF/PNG export; only
  presentation mode reveals them incrementally. Respects
  `prefers-reduced-motion` and keeps `aria-hidden` in sync with reveal state.
- A "?"-triggered keyboard-shortcuts help overlay in presentation mode, plus
  an always-visible "? controls" hint button -- nh-deck's growing set of
  shortcuts (arrows, Space, Home, End, Escape, `o`, touch swipe) had no
  in-UI discovery path until now.
- `--css-vars <path>` on `render`/`pdf`/`png`: overlay just a few CSS custom
  properties (e.g. `--nh-accent`) without losing all 4 layouts, both
  transitions, and the progress bar the way the existing `--css` flag's full
  stylesheet replacement does. When both are provided, `--css` takes
  precedence and `--css-vars` is not applied (with a stderr note); `--css-vars`
  composes with `--theme`. See `docs/specs/css-vars-override-design.md`.
- PDF exports now include small, centered, muted page numbers by default.

## [1.1.0] - 2026-09-13

A prioritized pass over UI/UX/accessibility/performance gaps, informed by a
deckrun code-level deep-dive and 10 parallel best-practices research passes.

### Fixed

- `--nh-code-bg` and `--nh-border` no longer derive from `colors.muted`/
  `colors.line`, which failed WCAG AA contrast in every shipped theme and,
  under Nord specifically, made the presentation-mode slide counter render
  in a color identical to its own background.
- The `slide` transition's backward navigation (ArrowLeft) no longer plays
  the same left-to-right motion as forward navigation.
- Presenter notes (`?notes`) no longer unhide every slide's note
  simultaneously in the default continuous-scroll view, where they'd all
  stack at an identical fixed screen position; the fixed bottom-overlay
  behavior is now scoped to presentation mode, where exactly one slide is
  ever active.
- A deck with 2+ Mermaid diagrams no longer emits duplicate SVG marker ids
  (e.g. two `id="arrowhead"`s), which is invalid SVG/HTML and could let one
  diagram's markers leak into another's.
- `nh-deck --version` now reports the actual package version instead of a
  hardcoded `0.1.0`, which it reported unchanged through the entire 1.0.0
  release.

### Added

- A progress bar in presentation mode (`?present`), alongside the existing
  slide counter.
- `prefers-reduced-motion` support for slide transitions.
- `Home`/`End` to jump to the first/last slide, and `Escape` to exit
  presentation mode without hand-editing the URL.
- A slide-overview/grid-mode toggle (`Escape`/`o`) showing every slide at
  once as clickable thumbnails.
- Touch swipe navigation in presentation mode.
- Commander's built-in `showSuggestionAfterError()`/`showHelpAfterError()`,
  and colorized success/error CLI output (via `node:util.styleText`, which
  already no-ops on non-TTY output and degrades to plain text on Node
  20.0-20.11, before `styleText` existed).
- gzip compression for HTML served by the local dev server, negotiated via
  a proper RFC 7231 `Accept-Encoding` evaluator (q-values, wildcards, and
  case-insensitive coding names all handled correctly).
- A README demo screenshot and two new screenshots documenting
  presentation mode's progress bar and grid overview.

### Changed

- `.slide.layout-title`'s heading now scales responsively (`clamp()`)
  instead of a fixed `font-size`.
- `.slide.layout-two-column` collapses to a single column under 640px.
- The base font stack gained a fuller emoji/CJK-adjacent fallback chain.

## [1.0.0] - 2026-09-13

First published release. nh-deck has been developed in the open on `main` since
its initial walking-skeleton commit; this entry summarizes everything shipped
up to this release, not just changes since a prior tag (none existed before now).

### Added

- **Core loop**: `render` (write Markdown, serve it locally, present it in your
  browser), `pdf` (export to PDF), and `png` (export one PNG per slide) — all
  driven by a locally-detected Chrome/Chromium/Edge/Brave install via
  `puppeteer-core` + `chrome-launcher`. No Chromium is ever bundled or downloaded.
- **`--watch`**: re-renders and pushes a same-origin SSE reload event to the
  browser whenever the source file changes.
- **`--css <path>`**: fully replace the default stylesheet with your own.
- **Presenter notes**: a standalone HTML comment on any slide becomes a
  presenter note, hidden by default and shown by adding `?notes` to the URL.
- **KaTeX math rendering** (inline `$...$` and block `$$...$$`), with fonts
  embedded locally as base64 — no CDN fallback path.
- **Mermaid diagram rendering** (` ```mermaid ` fenced code blocks), rendered
  as embedded, CDN-free SVG.
- **Named theme system**: 4 fixed color themes (`light`, `dark`, `dracula`,
  `nord`), selectable via `--theme <name>` or a deck's own frontmatter
  `theme:` key, applied consistently to the base deck, KaTeX math, and
  Mermaid diagrams. A deck with no theme requested renders unchanged.
- **Per-slide layouts**: 4 fixed layouts (`title`, `section`, `two-column`,
  `quote`), opted into per slide via a `<!-- layout: name -->` comment.
  Apply everywhere (`render`, `pdf`, `png`).
- **Presentation mode**: an opt-in, one-slide-at-a-time view (`?present` in
  the URL) with keyboard/click navigation; slide position survives a
  `--watch` reload via the URL hash.
- **Transitions**: deck-wide `fade`/`slide` effects between slides, via
  `--transition <name>` or frontmatter `transition:`, active only inside
  presentation mode on `render`.
- **Cross-browser PDF/PNG visual-fidelity check**: a dedicated CI job compares
  pixel output and page counts between two distinct Chrome-family browsers on
  every PR.
- A hardened CI matrix (`ubuntu-latest`/`macos-14`/`windows-latest` × Node
  20/22/latest) with branch protection on `main` requiring all checks to pass.

### Fixed

- Mermaid diagrams now actually recolor to match the active theme (an
  initially-shipped gap in the theme system, closed shortly after).
- Presentation mode no longer silently breaks a layout's flexbox centering
  (a CSS-specificity conflict between the presentation and layout stylesheets).
- A single-paragraph `quote`-layout slide (no attribution line) no longer
  incorrectly renders in the smaller attribution style.
- The `two-column` layout's break-protection now covers Mermaid's raw `<svg>`
  output, not just `pre`/`table`/`img`.
- The presenter-notes panel now follows the active theme instead of a fixed
  cream/gold color scheme.
- Inline code is no longer invisible inside a themed `section`-layout slide
  (its text color collided exactly with its own background under every
  shipped theme, since both derived from the same fallback value) — found
  via a live end-to-end pass against a running dev server, not the
  pre-existing test suite.
- `resolveOutputPath`'s `.md` extension check is now case-insensitive (a
  source file named with a capital `.MD` extension no longer gets a doubled
  output extension).

### Security

- No runtime network dependency anywhere in the render, serve, or export
  path — verified end-to-end, including after every rendering feature above
  was added. No CDN reference in rendered HTML, no bundled/downloaded
  browser, no telemetry, no accounts.

[1.10.0]: https://github.com/sairam0424/nh-deck/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/sairam0424/nh-deck/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/sairam0424/nh-deck/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/sairam0424/nh-deck/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/sairam0424/nh-deck/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/sairam0424/nh-deck/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/sairam0424/nh-deck/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/sairam0424/nh-deck/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/sairam0424/nh-deck/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/sairam0424/nh-deck/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/sairam0424/nh-deck/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/sairam0424/nh-deck/releases/tag/v1.0.0
