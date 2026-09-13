# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-09-13

A second research-informed pass, picking up where 1.1.0 left off: a ground-truth
snapshot of the shipped codebase plus 10 parallel research passes surfaced a
currently-broken export path and nh-deck's biggest capability gap versus peer
tools, both fixed here.

### Fixed

- **PDF and PNG export now produce landscape 16:9 pages instead of portrait
  A4.** Every export was previously broken this way -- slide content came out
  vertically stacked in a narrow portrait column, not a slide-shaped page.
  PNG exports also now share identical dimensions across every slide in one
  export (previously varied with content height, since no viewport was
  locked).
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

[1.2.0]: https://github.com/sairam0424/nh-deck/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/sairam0424/nh-deck/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/sairam0424/nh-deck/releases/tag/v1.0.0
