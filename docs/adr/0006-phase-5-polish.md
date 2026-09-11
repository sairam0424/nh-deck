# 0006. Phase 5 polish: `--css` opt-out, presenter notes, PDF pagination, and PNG export

## Status

Accepted — 2026-09-11

## Context and Problem Statement

The Phase 4 walking skeleton provides a functional core (render → serve →
PDF export) but lacked four distinct, user-facing capabilities: a way to
opt out of the baseline stylesheet, a way to author presenter notes, an
explicit and tested mechanism for per-slide PDF pagination, and a way to
export individual slide images. Phase 5 closes all four gaps in a single
release on one feature branch (`feat/polish-phase5`), building directly on
the Phase 4 render/serve/export core and the per-slide segmentation from
ADR 0002:

1. **No stylesheet opt-out.** The baseline stylesheet was always applied to
   rendered HTML, with no way to drop it and use a fully custom one. This
   locks users into nh-deck's visual defaults, in tension with the
   unopinionated-rendering non-negotiable in `SOUL.md`.
2. **No presenter notes.** Common slide tools (reveal.js, Marp, Marpit,
   Slidev) let authors write speaker notes that stay hidden during normal
   viewing. nh-deck had no mechanism to author or surface these.
3. **PDF pagination had no explicit, dedicated CSS rule or test coverage.**
   Nothing in `render.ts` forced one slide per printed page; pagination
   behavior was unverified.
4. **No PNG export.** nh-deck could render to HTML and export to PDF, but
   not export individual slide images, which is useful for sharing single
   slides, social posts, or accessibility workflows.

## Decision Drivers

- **Unopinionated rendering (`SOUL.md`).** nh-deck must not force a visual
  style on users; a `--css` opt-out preserves user agency over the whole
  deck's appearance.
- **Feature parity with related tools.** reveal.js, Marp, Marpit, and
  Slidev all support some form of presenter notes; the absence was a
  notable gap for users coming from those tools.
- **Testable pagination.** Per-slide pagination in PDF output should be
  driven by an explicit, named CSS rule with test coverage, not left as an
  unverified assumption about browser or stylesheet defaults.
- **Completeness of the export surface.** Supporting PNG alongside HTML and
  PDF increases nh-deck's utility for sharing and accessibility use cases.
- **Avoid duplicating browser-detection logic.** PDF and PNG export both
  need a locally installed Chrome/Chromium/Edge/Brave binary; that
  detection logic should exist once, not twice.

## Considered Options

### `--css <path>`: full-replacement vs. merge/append

The chosen design: `--css <path>` (on both `render` and `pdf`) reads the
given file's contents and substitutes them for nh-deck's default
typography/layout stylesheet block in `generateHtml`'s `<style>` template
(`src/render.ts:129-209` — `customCss ?? <default block>`). The KaTeX
stylesheet (when math is present), the presenter-notes visibility CSS
(`NOTES_STYLE`), and the print-pagination rule (`PRINT_PAGINATION_STYLE`)
are appended unconditionally after that block regardless of `--css`
(`src/render.ts:210-212`) — so a custom-CSS deck still gets notes-hiding
and per-slide print pagination by default; only the visual/typography
defaults are replaced.

**Alternative (merge/append):** layer the user's stylesheet on top of the
baseline instead of replacing it. Rejected because the outcome would depend
on CSS specificity and cascade order, producing "why didn't my rule take
effect?" confusion. Full replacement is simpler to reason about: "if you
pass `--css`, you get exactly what you specify for layout and typography."

### Presenter notes: HTML comments + `?notes` query toggle, vs. directives or a companion window

Presenter notes are authored as standalone HTML comments inside a slide's
Markdown (e.g. `<!-- remember to breathe -->` on its own line). `marked`'s
own tokenizer already emits a distinct `"html"`-type token for a
comment on its own line; `extractNotes` (`src/presenterNotes.ts`) scans a
slide's token group for such tokens and, for each one matching
`/^<!--([\s\S]*?)-->/`, extracts and trims the interior text. `generateHtml`
renders each extracted note as `<aside class="notes" hidden>` (escaped)
appended inside that slide's `<section class="slide">` (`src/render.ts:103-108`).

Visibility is controlled by the `hidden` attribute together with
`NOTES_STYLE` (`src/render.ts:9-29`): `.notes` is `display: none` by
default and becomes visible via the `:not([hidden])` selector as a
fixed-position panel pinned to the bottom of the viewport; a
`@media print` rule forces `display: none !important` so notes never
appear in PDF or PNG output. The toggle itself is a one-time check in an
inline `<script>` at the end of the document body (`src/render.ts:217-223`):
on page load, if `new URLSearchParams(location.search).has("notes")` is
true, every `.notes` element's `hidden` attribute is removed. There is no
keyboard shortcut — showing notes requires loading the page with a `?notes`
query parameter present in the URL.

**Why HTML comments, not a directive syntax (e.g. Marpit-style
`::: notes ... :::`)?** nh-deck has no directive system and no plan to
build one; HTML comments are already tokenized by `marked` with no new
parsing logic required.

**Why not reveal.js's `postMessage` companion-window design?** That design
synchronizes a separate presenter-view window with the main view via
cross-window messaging — meaningfully more complex to implement and verify
than a query-string toggle, for a first pass at this feature.

### PDF pagination: a new, explicit `@media print` rule vs. relying on unverified defaults

Task 3 added a genuinely new constant to `src/render.ts`, `PRINT_PAGINATION_STYLE`
(`src/render.ts:31-36`):

```css
@media print {
  .slide {
    break-after: page;
  }
}
```

This is referenced unconditionally in `generateHtml`'s `<style>` template
(`src/render.ts:212`), so every `<section class="slide">` gets a forced
page break after it when printed, regardless of whether `--css` is used.
This is new render-time code, not a "zero-code-change" formalization of
pre-existing behavior — before this task, no such rule existed anywhere in
`render.ts`.

The phrase "zero-code-change" applies only to the PDF *export* mechanism
in `src/pdfExport.ts`: Puppeteer's existing `page.pdf({ path, format: "A4",
printBackground: true })` call (`src/pdfExport.ts:31`) already respects
`@media print` / `break-after` CSS with no change needed to the export code
itself — that was verified before Task 3 was even planned. Task 3's actual
work was adding the CSS rule that gives the export mechanism something
correct to respect.

**Alternative:** rely on default browser print behavior without an
explicit rule. Rejected as untestable and unverified — there was no
guarantee any `<section>` boundary would force a page break without an
explicit rule, and no test would catch a regression.

### PNG export: reuse the PDF export browser, screenshot each slide element individually, no fixed viewport

PNG export (`src/pngExport.ts`) follows the same browser-automation
approach as PDF export: it calls the shared `detectBrowserExecutable()`
(see below), launches that browser headlessly, and loads the rendered HTML
via `page.setContent(html, { waitUntil: "load" })` — no navigation, and no
`page.setViewport()` call anywhere in the file, so no fixed resolution is
set. It then queries every `section.slide` element via `page.$$()` and
calls `.screenshot({ path })` on each element handle in a loop
(`src/pngExport.ts:31-38`); each output PNG is therefore sized to that
slide's own rendered bounding box, not to a fixed pixel resolution such as
1920×1080.

Output filenames are derived by `insertSlideNumber` (`src/pngExport.ts:49-58`):
it inserts `-N` (1-indexed) immediately before the output path's extension
— `deck.png` → `deck-1.png`, `deck-2.png`, ... (or `deck` → `deck-1`,
`deck-2`, ... when the output path has no extension). This is not a
zero-padded `slide-NNN.png` scheme.

The `png` subcommand (`src/index.ts:110-128`) is `nh-deck png <file>
[output]`: `output` is an optional second **positional** argument, not a
flag, reusing the same `resolveOutputPath(file, output, "png")` helper the
`pdf` command uses — if omitted, a trailing `.md` on the input is replaced
with `.png` (or `.png` is appended). There is no directory flag and no
`output/` default directory.

**Why not a separate rendering engine (e.g. Playwright)?** The browser is
already detected for PDF export via `chrome-launcher`; reusing the same
executable avoids duplicating platform-detection logic and keeps the
dependency surface smaller. Playwright was rejected as it defaults to
managing its own downloaded browser binaries, which would reintroduce the
install-weight/local-first tension ADR 0001 already rejected for the PDF
path.

### Browser-launch extraction (Task 4)

PDF and PNG export both need to detect a local Chrome/Chromium/Edge/Brave
installation. That logic now lives once, in `src/browserLaunch.ts`'s
`detectBrowserExecutable()`, which uses `chrome-launcher`'s
`Launcher.getInstallations()` and throws a clear, descriptive error if
none is found. Both `src/pdfExport.ts` and `src/pngExport.ts` import and
call this shared function rather than each detecting a browser
independently.

## Decision Outcome

1. **`--css <path>` (Task 1):** added to the `render` and `pdf`
   subcommands. When given, its file contents fully replace the default
   visual/typography stylesheet block in `generateHtml`'s template; the
   presenter-notes CSS and print-pagination CSS still apply unconditionally.
2. **Presenter notes (Task 2):** authored as standalone HTML comments per
   slide, extracted by `extractNotes` (`src/presenterNotes.ts`) and
   rendered as `<aside class="notes" hidden>` elements. Visibility is
   toggled once, at page load, by the presence of a `?notes` query
   parameter — there is no keyboard shortcut. Notes are always hidden
   under `@media print`, so PDF and PNG exports never include them.
3. **PDF pagination (Task 3):** a new `PRINT_PAGINATION_STYLE` constant
   (`@media print { .slide { break-after: page; } }`) was added to
   `src/render.ts` and is applied unconditionally. `src/pdfExport.ts`
   itself required no changes, since Puppeteer's existing `page.pdf()`
   call already honors this kind of print CSS.
4. **PNG export (Task 5):** a new `png <file> [output]` CLI subcommand
   (`src/index.ts`) backed by `exportToPng` (`src/pngExport.ts`), which
   screenshots each `<section class="slide">` element individually (no
   fixed viewport or resolution) and writes one PNG per slide, named by
   inserting `-N` before the output path's extension.
5. **Browser-launch extraction (Task 4):** `detectBrowserExecutable()` was
   extracted into `src/browserLaunch.ts` and is now shared by
   `src/pdfExport.ts` and `src/pngExport.ts`.

## Consequences

### Positive

- Stylesheet opt-out preserves the unopinionated-rendering philosophy from
  `SOUL.md` without giving up notes-hiding or print pagination by default.
- Presenter notes give feature parity with reveal.js/Marp/Slidev's
  speaker-notes concept using only existing `marked` tokenization — no new
  parsing logic.
- PDF pagination is now an explicit, named, tested CSS rule
  (`PRINT_PAGINATION_STYLE`) instead of an unverified assumption.
- PNG export adds a third export format with no new browser-automation
  dependency, and each slide is captured at its own natural rendered size
  rather than requiring a hardcoded resolution decision up front.
- The shared `detectBrowserExecutable()` means PDF and PNG export cannot
  drift from each other in how they find or fail to find a browser.

### Negative / Trade-offs

- **`--css` users cannot opt out of the notes or print-pagination CSS** —
  those two rules are unconditional, so a highly customized deck cannot
  currently suppress or restyle them except by overriding the same
  selectors with higher specificity in their own file.
- **Presenter notes have no keyboard toggle and no companion-window mode**
  — visibility is controlled only by a `?notes` URL query parameter,
  checked once at load. Toggling live during a running presentation
  requires reloading the page with that parameter present.
- **PNG filenames are not zero-padded or user-configurable** — `deck-1.png`
  through `deck-10.png` will not sort correctly against `deck-11.png` in a
  naive lexicographic file listing, and there is no flag to choose a
  different naming scheme or output directory.
- **PNG export has no fixed resolution** — output image dimensions follow
  whatever size each slide's `<section>` element happens to render at,
  which means visual consistency across slides (or across machines) is not
  guaranteed the way a fixed viewport would guarantee it.

## Confirmation

This decision is confirmed as implemented by the existing test suite:

- **Task 1 (`--css`):** `tests/cli.test.ts` ("renders with a custom --css
  file, fully replacing the default stylesheet") exercises `--css` end to
  end through the real CLI process.
- **Task 2 (presenter notes):** `tests/presenterNotes.test.ts` verifies
  `extractNotes` against standalone and multiple HTML comments; the
  `generateHtml — presenter notes` suite in `tests/render.test.ts` verifies
  the rendered `<aside class="notes" hidden>` markup, the inline
  `?notes`-reveal script, and that notes are hidden under `@media print`
  regardless of the toggle.
- **Task 3 (PDF pagination):** `tests/render.test.ts` asserts the rendered
  output matches `/@media print[^}]*\.slide[^}]*break-after:\s*page/`.
- **Task 4 (browser-launch extraction):** `tests/browserLaunch.test.ts`
  covers `detectBrowserExecutable()` directly; `tests/pdfExport.test.ts`
  and `tests/pngExport.test.ts` both exercise it indirectly through their
  respective export paths.
- **Task 5 (PNG export):** `tests/pngExport.test.ts` produces real,
  non-empty PNG files (verified via PNG magic bytes) with the `deck-1.png`
  / `deck-2.png` naming scheme, including a case where the output path has
  no extension; `tests/cli.test.ts`'s `CLI: nh-deck png` suite exercises
  the subcommand end to end through the real CLI process.

## More Information

- Per-slide segmentation (ADR 0002) is foundational to both presenter
  notes (extracted per slide) and PDF pagination (page breaks at
  `<section class="slide">` boundaries).
- KaTeX (ADR 0004) and Mermaid (ADR 0005) rendering both predate this
  phase; PNG export screenshots whatever a slide contains, including
  embedded KaTeX and Mermaid SVG output, with no special-casing required.
- See `src/render.ts`, `src/presenterNotes.ts`, `src/pngExport.ts`,
  `src/browserLaunch.ts`, `src/pdfExport.ts`, `src/cliHelpers.ts`, and
  `src/index.ts` for the implementations referenced throughout this ADR.
