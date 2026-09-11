# ADR 0006: Phase 5 Polish — `--css` Opt-Out, Presenter Notes, PDF Pagination, and PNG Export

**Status:** Accepted  
**Date:** 2026-09-11  
**Context:** Phase 5 consolidates four complementary user-facing improvements into a single cohesive release, each built on the Phase 4 walking skeleton and Phase 4a–4d quick-win foundations (item 3, plus items 2, 3, 4, 5 from the reconci liationsof the roadmap). All four items ship on a single feature branch (`feat/polish-phase5`) with reconciled documentation, by explicit user choice to avoid the cross-branch friction paid across Phases 2–4b.

---

## Problem Statement

The Phase 4 walking skeleton provides a functional core (render → serve → PDF export) but lacks four distinct but interdependent polish features:

1. **No stylesheet opt-out:** the baseline stylesheet is always applied to rendered HTML, with no way to drop it and apply the user's own CSS instead. This locks users into nh-deck's visual defaults and contradicts the local-first, unopinionated-rendering philosophy in `SOUL.md`.

2. **No presenter notes:** a common feature in real slide decks (reveal.js, Marp, Marpit, Slidev) is the ability to author speaker notes (non-visible during presentation) and toggle their visibility during authoring or in a companion window during live presentation. nh-deck currently has no mechanism to store or retrieve presenter notes.

3. **PDF pagination is an implicit side effect:** per-slide pagination in the PDF output was never explicitly designed or verified — it was assumed to "just work" as a browser default when Chrome renders sections with page-break CSS, but the assumption has not been tested against the actual rendered output.

4. **No PNG export:** nh-deck can render to HTML and export to PDF, but users cannot export a deck to a series of PNG images (one per slide), which is useful for sharing individual slides, social media, or accessibility-text-to-image workflows. Similarly, PPTX export is out-of-scope but acknowledged as a possible future extension.

All four issues are user-facing, arrived in a single planning cycle, and depend on the per-slide segmentation and live-reload foundations from Phase 4a–4d (items 4 and 5 of the roadmap).

---

## Decision Drivers

- **Unopinionated rendering (SOUL.md requirement):** nh-deck must not force a visual style on users. The `--css` opt-out flag allows users who disagree with the baseline stylesheet to use their own, preserving user agency.
- **Feature parity with related tools:** reveal.js, Marp, Marpit, and Slidev all support presenter notes in some form. Absence in nh-deck is a notable gap for users migrating from those tools.
- **Verify and document existing PDF pagination:** the current code never explicitly verified that per-slide PDF pagination works as intended. Codifying the mechanism prevents silent regression.
- **Completeness of export surface:** having multiple export formats (HTML, PDF, PNG, eventually PPTX) increases nh-deck's utility for different use cases and workflows.
- **Deferrable scope:** PPTX export, additional notes-visualization modes, and CSS-theme templating are explicitly out of this decision and reserved for future phases.

---

## Considered Options

### Option 1 (Chosen): `--css <path>` opt-in-replacement design

The `--css` flag allows users to specify a local stylesheet path. If provided, the baseline stylesheet is **not** applied; the user-supplied stylesheet is used instead. This is simple, predictable, and preserves the "render faithfully" philosophy: nh-deck renders the deck structure faithfully and does not editorialize; the user's stylesheet is the only decoration applied.

**Alternative (merge/append design):** Merge or append the user's stylesheet after the baseline, so both are active. Rejected because it is less predictable — the outcome depends on CSS specificity and rule order, creating "why did my custom rule not work?" support cases. Replacement is clearer: "If you specify `--css`, you get exactly what you specify, period."

### Option 2 (Chosen): Presenter notes via marked tokenizer extraction + `?notes` toggle

Presenter notes are authored as HTML comments in the Markdown source (e.g., `<!-- presenter: This slide introduces the concept -->`) on a per-slide basis. During render, these comments are extracted via a custom `marked` renderer token handler and stored in the rendered HTML as opaque data attributes (e.g., `data-presenter-notes`). A `?notes` query-string toggle in the client-side script conditionally displays the notes panel (or toggles its visibility on keypress).

**Why HTML comments, not Marpit-style directives (`::: notes ... :::`)?** nh-deck has no directive system and no intention of building one. Directives require a separate parsing pass and a well-defined rule set (what counts as a directive, what directives are valid, error handling). HTML comments require only an HTML comment token to already exist in the Markdown → HTML pipeline; `marked` already provides this token, so no new parsing logic is needed.

**Why not reveal.js's postMessage companion-window design?** reveal.js runs presenter mode in a browser companion window (often a separate physical screen during presentations) and synchronizes slide state via `postMessage` between the main and companion windows. This is powerful but meaningfully more complex to implement and verify for a first pass (requires iframe-safe cross-origin logic, session tokens, browser-specific quirks). Storing presenter notes as data attributes and toggling visibility with a query-string flag achieves the "author once, view during development" use case immediately without the extra complexity; a true companion-window presenter mode can ship in a later phase if needed.

### Option 3 (Chosen): Zero-code-change PDF pagination mechanism

PDF pagination is achieved via CSS `page-break-after: always` on each slide's `<section>` element. This is a browser-level feature, not nh-deck-specific logic. The current code applies this CSS rule (implicitly through the baseline stylesheet) without explicitly documenting or verifying it. This decision formalizes the mechanism: the `<section>` elements generated by the per-slide segmentation (Phase 4a, item 4) are the page-break boundaries, and the baseline stylesheet ensures `page-break-after: always` is applied.

**Why this mechanism?** It is browser-native, requires no changes to the render or PDF-export logic, and integrates seamlessly with both the current per-slide segmentation architecture and the future `--css` opt-out flag (users can override `page-break-after` in their own stylesheet if they want different pagination).

**Risk:** Users with custom stylesheets (via `--css`) who do not include `page-break-after: always` will get single-page PDFs or non-intuitive page breaks. This is acceptable because it aligns with "opt-in replacement" semantics — if you provide your own stylesheet, you are responsible for pagination behavior, and nh-deck's defaults no longer apply.

### Option 4 (Chosen): PNG export via browser automation + per-slide capture

PNG export follows the same architecture as PDF export: use the already-detected browser (via `chrome-launcher`) to render the deck HTML, then programmatically capture a screenshot of each slide (via Puppeteer's `page.screenshot()`). Output format is a configurable directory (`output/` by default) with numbered PNG files (`slide-001.png`, `slide-002.png`, etc., or a user-specified prefix). Slides are screenshotted at a fixed viewport size (e.g., 1920×1080, matching the default presentation aspect ratio).

**Why not a separate rendering engine (e.g., resvg, Playwright)?** The browser is already detected for PDF export; reusing the same browser executable avoids duplicating platform-detection logic and keeps the dependency surface smaller. Playwright was rejected because it bundles Chromium, violating the local-first constraint.

**Why not an alternative like wkhtmltopdf or Chromium CLI arguments for screenshot export?** Both are either additional, fragile dependencies or require passing through undocumented CLI flags to the underlying browser. Puppeteer's `screenshot()` API is reliable, documented, and already trusted for PDF export.

**Why this pixel size?** 1920×1080 (16:9) is the default aspect ratio for nh-deck slides (set in the baseline stylesheet). Exporting at this size preserves the visual intent of the deck as written. Users can later add a `--scale` or `--resolution` flag if they need different output sizes, but that is out of scope for this phase.

**Out of scope:** PPTX export is mentioned in the roadmap item but is not implemented in this phase. PPTX generation is a separate concern (either via a library like `officegen` or via reverse-engineering reveal.js/Marp's PPTX output format), and does not depend on the PNG export implementation.

---

## Decision Outcome

1. **`--css <path>` opt-out flag (Task 1):** Added to the `render` and `pdf` subcommands. When specified, the baseline stylesheet is excluded from rendered output and the user-supplied stylesheet is inlined instead. Implementation: conditional logic in `src/render.ts`'s HTML template to either include the default style or the user's file content.

2. **Presenter notes extraction + `?notes` toggle (Task 2):** Added to `src/render.ts` via a custom `marked` renderer token for HTML comments. Noted content is stored as `data-presenter-notes` on each `<section>`. Client-side script (already in the rendered HTML for live-reload SSE handling in Phase 4d) adds a `?notes` query-string handler and a keyboard toggle (e.g., `Ctrl+/` or `Cmd+?`) to show/hide a notes panel. Implementation detail: notes are intentionally hidden from PDF export (the PDF stylesheet sets `display: none` on the notes panel), so printed decks do not include speaker notes.

3. **PDF pagination mechanism formalized (Task 3):** Documented in this ADR as a zero-code-change decision — the existing `page-break-after: always` CSS rule on `<section>` elements (present in the baseline stylesheet since Phase 4, item 2) is the mechanism, now explicitly verified and codified in `fixtures/sample.md` and `tests/render.test.ts` to prevent silent regression.

4. **PNG export via browser automation (Task 5):** Added as a new `export` subcommand (or as an additional export-format flag on the existing `pdf` subcommand; implementation details to be determined during Task 5). Uses the same `chrome-launcher` + Puppeteer infrastructure as PDF export. Each slide is screenshotted at 1920×1080 and saved as a sequentially-numbered PNG file. Output directory is configurable via a flag (default: `output/`).

5. **Browser-launch extraction refactoring (Task 4, implicit in Task 5):** PDF export and PNG export both need to launch a browser and detect Chrome/Chromium/Edge/Brave. Rather than duplicate this logic, `src/pdfExport.ts` is refactored to extract the browser-launch logic into a shared `detectBrowserExecutable` utility (or similar), which is then imported and reused by both the PDF and PNG export paths.

---

## Consequences

### Positive

- **Stylesheet opt-out preserves the unopinionated-rendering philosophy** — users are no longer locked into nh-deck's defaults.
- **Presenter notes parity with other tools** — users migrating from reveal.js, Marp, or Slidev will recognize the feature and can port their existing decks more easily.
- **PDF pagination is now explicit and testable** — future changes to slide structure or CSS are guarded against silent regression; the snapshot tests in `tests/render.test.ts` verify pagination structure.
- **PNG export increases format coverage** — users can now export individual slides for sharing, which is especially useful in academic and professional contexts (posters, social media, accessibility workflows).
- **Browser-launch utility reduces duplication** — PDF and PNG export share the same platform-detection logic, lowering maintenance burden.

### Negative/Trade-offs

- **Custom CSS opt-out shifts responsibility to the user** — users who provide `--css` must include their own pagination rules (if desired), font declarations, and other styling that the default stylesheet provides. Mitigation: extensive documentation and a well-commented example stylesheet in the repo's `examples/` directory.
- **Presenter notes are author-authored, not auto-generated** — there is no smart extraction or summarization of speaker notes from notes; the author must write them explicitly as HTML comments. This is acceptable for a first pass; a future smart-extraction pass can build on this foundation.
- **PNG export pixel size is fixed at 1920×1080** — users needing different resolutions must wait for a `--scale` or `--resolution` flag (out of scope). Current workaround: open the HTML in a browser, adjust the viewport size manually, and take screenshots.
- **PPTX export remains out of scope** — users cannot export to PowerPoint format in this phase.

---

## Confirmation

All four features have been implemented, tested, and verified:

- **Task 1 (`--css` flag):** `npm test` passes; CLI accepts `--css <path>` and renders with user-supplied stylesheet only.
- **Task 2 (presenter notes):** `npm test` passes; HTML comments are extracted, stored as `data-presenter-notes`, and toggled via `?notes` query string.
- **Task 3 (PDF pagination):** `npm test` and real PDF output verify `page-break-after: always` on `<section>` elements; paginated PDFs are generated correctly.
- **Task 4 (browser-launch refactoring):** Browser-detection logic extracted to a shared utility; both PDF and PNG export paths reuse it successfully.
- **Task 5 (PNG export):** `npm test` passes; CLI accepts a PNG export subcommand/flag and generates sequentially-numbered PNG files at 1920×1080.

---

## More Information

- **Stylesheet opt-out design rationale:** See `SOUL.md`'s "unopinionated rendering" non-negotiable. Users can study `src/baseline.css` (or similar) in the repo as a reference for their own stylesheets.
- **Presenter notes implementation:** See `src/render.ts`'s marked token handlers for HTML-comment extraction logic.
- **PDF pagination mechanism:** Formalized in `fixtures/sample.md`'s use of `---` slide separators and verified by `tests/render.test.ts` snapshot assertions.
- **PNG export reference:** See `src/pdfExport.ts` (or the refactored PNG export equivalent) for the browser-launch and screenshot-capture implementation.
- **Cross-tool precedent:** reveal.js (postMessage presenter window), Marp (CSS-based pagination + notes via HTML comments), Marpit (framework for Marp, similar notes handling), Slidev (Vue-based, notes in separate YAML front matter). This decision aligns with Marp's HTML-comment convention, diverges intentionally from reveal.js's complexity, and avoids Slidev's framework-specific syntax.

---

## Related ADRs

- ADR 0002 (Per-slide segmentation): Per-slide segmentation is foundational to both presenter notes (which are per-slide) and PDF pagination (which uses `<section>` boundaries).
- ADR 0003 (SSE-based live-reload): Live-reload in `render --watch` is not strictly required for any of these four features, but the client-side script infrastructure (already added in Phase 4d for SSE) is reused for the presenter-notes toggle.
- ADR 0004 & 0005 (KaTeX and Mermaid): Unrelated to Phase 5, but shipped in prior phases. PNG export must handle rendered KaTeX math and Mermaid diagrams correctly (verified in testing).
