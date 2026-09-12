# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- `resolveOutputPath`'s `.md` extension check is now case-insensitive (a
  source file named with a capital `.MD` extension no longer gets a doubled
  output extension).

### Security

- No runtime network dependency anywhere in the render, serve, or export
  path — verified end-to-end, including after every rendering feature above
  was added. No CDN reference in rendered HTML, no bundled/downloaded
  browser, no telemetry, no accounts.

[1.0.0]: https://github.com/sairam0424/nh-deck/releases/tag/v1.0.0
