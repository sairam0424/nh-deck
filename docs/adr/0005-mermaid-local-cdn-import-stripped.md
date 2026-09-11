# 0005. Mermaid diagram rendering with a stripped CDN font import

## Status

Accepted — 2026-09-11

## Context and Problem Statement

`Context.md`'s Roadmap has carried "Mermaid (diagram rendering)" as a
deferred fast-follow, gated on the same local-only constraint as
Phase 4a's KaTeX work. The research phase identified `beautiful-mermaid`
as a DOM-free, Puppeteer-free renderer with a clean npm dependency tree
(`elkjs` + `entities` only), but flagged that this needed "one more
concrete look" before committing, since dependency-tree cleanliness
alone doesn't guarantee CDN-free *output*. That re-verification (done
immediately before this plan was written) found a real problem: the
library's own generated SVG output contains a hardcoded, unconditional
Google Fonts `@import` -- a genuine external CDN reference the original
research, which checked only the npm dependency graph, did not catch.

## Decision Drivers

- No CDN fallback path, under any option -- including one baked into a
  chosen library's own default output rather than into nh-deck's code.
- Do not hand-roll Markdown parsing (`AGENTS.md` Code Style) -- Mermaid
  block detection must go through `marked`'s own extension/renderer API.
- `generateHtml` must stay a pure, synchronous function.
- One malformed diagram must not crash the whole render.
- The fix must not change how any other kind of fenced code block renders.

## Considered Options

1. **`beautiful-mermaid`, with its own `@import` stripped from the
   returned SVG before embedding**, relying on its existing
   `system-ui, sans-serif` font fallback.
2. **`beautiful-mermaid`, left as-is** (accepting the CDN font fetch).
3. **`@mermaid-js/mermaid-cli`**, the most commonly reached-for Mermaid
   CLI tool.
4. **Core `mermaid` package**, run in a way that avoids its DOM
   dependency.

## Decision Outcome

Chosen option: **Option 1 -- strip the `@import`, keep the fallback
font chain.**

- **Option 2 (leave as-is)** was rejected outright: it is precisely the
  anti-pattern `CLAUDE.md`'s stop-and-ask gate exists to prevent, just
  arriving via a dependency's own default output instead of via
  nh-deck's own code.
- **Option 3 (`mermaid-cli`)** was rejected, consistent with the
  original research and this spec's §6 opening paragraph: it declares
  `puppeteer` as a required peer dependency, which would silently
  reintroduce a bundled-Chromium download.
- **Option 4 (core `mermaid`)** was rejected: verified directly via
  `npm view` that its dependency tree includes D3, DOMPurify, cytoscape,
  and roughjs -- a genuinely browser-oriented library, not a fit for a
  synchronous, DOM-free CLI render path.
- **Option 1** was verified empirically end-to-end: after stripping the
  `@import`, a real headless-browser load of the resulting SVG showed
  zero network requests beyond the local file itself and zero console
  errors, and a screenshot confirmed the diagram still renders correctly
  with the system-font fallback in place of the CDN-hosted Inter font.

## Consequences

**Good:**

- Zero CDN dependency, verified empirically rather than assumed --
  including a dependency the original research did not catch.
- Diagrams render with a system font instead of Inter -- a minor visual
  difference from the library's own out-of-the-box behavior, accepted as
  the cost of the local-first constraint.
- Invalid Mermaid syntax degrades gracefully to a visible, escaped error
  box instead of crashing the whole render (nh-deck's own equivalent of
  KaTeX's `throwOnError: false`, since the library provides no such
  option itself).
- The `marked` renderer override that wires this in exactly replicates
  marked's own default fenced-code-block output for every other
  language, verified directly against the installed `marked@13.0.3`
  source -- no other fenced code block's rendering changes.

**Bad:**

- This fix depends on `beautiful-mermaid`'s current internal CSS
  structure (a `font-family` rule with an existing fallback chain,
  immediately preceded by a stripped `@import`). A future version of the
  library could restructure this in a way that reintroduces the CDN
  reference without an equivalent fallback -- mitigated by this ADR's own
  Confirmation section's explicit CDN-hostname test, which would fail
  loudly on any regression, but this is a real, accepted ongoing risk of
  depending on an external library's unstated output contract.
- `beautiful-mermaid` supports 6 diagram types (Flowchart, State,
  Sequence, Class, ER, XY Charts) -- notably not Gantt, pie, or git-graph
  charts. A user writing one of those unsupported types gets the
  library's own parse error, surfaced via this phase's error-box path,
  not a diagram. Not addressed by this phase; tracked as a known gap.

## Confirmation

This decision is confirmed as implemented when:

1. A ` ```mermaid ` fenced code block renders as an embedded SVG diagram.
2. Invalid Mermaid syntax renders a visible, escaped error box rather
   than throwing.
3. A deck with a diagram contains zero CDN hostname references (`cdn.`,
   `unpkg.com`, `jsdelivr.net`, `cdnjs.cloudflare.com`,
   `fonts.googleapis.com`) anywhere in its rendered output.
4. A non-`mermaid` fenced code block (with or without a language tag)
   renders byte-for-byte identically to before this phase.

## More Information

- See `docs/research/feature-roadmap-research.md` for the original
  Mermaid-renderer comparison.
- See `docs/specs/feature-implementation-roadmap-design.md` §6 for how
  this fits into the broader Phase 4 roadmap item, including this plan's
  own re-verification findings recorded there on 2026-09-11.
- See `Context.md`'s Roadmap, item 9.
- See `docs/adr/0004-katex-local-embedded-math.md` for the sibling
  decision (KaTeX, Phase 4a) this ADR's numbering follows.
