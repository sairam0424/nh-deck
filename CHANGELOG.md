# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-09-14

A small fast-follow, closing out the last item deliberately deferred from
the presenter-view window shipped in v1.3.0.

### Added

- The presenter-view timer can now be paused: click the elapsed-time
  display to freeze it, click again to resume from where it left off.
- An optional target duration (in minutes), typed into a small field next
  to the timer, recolors the display amber past 80% of that duration and
  red once over it. Entirely opt-in and local to the browser (persisted
  to localStorage, no CLI flag or frontmatter key) -- with no duration
  set, the timer looks exactly as it always has.

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

[1.5.0]: https://github.com/sairam0424/nh-deck/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/sairam0424/nh-deck/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/sairam0424/nh-deck/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/sairam0424/nh-deck/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/sairam0424/nh-deck/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/sairam0424/nh-deck/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/sairam0424/nh-deck/releases/tag/v1.0.0
