# 0004. KaTeX math rendering with locally-embedded fonts

## Status

Accepted — 2026-09-11

## Context and Problem Statement

`Context.md`'s Roadmap has carried "KaTeX (math rendering)" as a deferred
fast-follow since the walking skeleton shipped, explicitly gated on
shipping it with local, bundled assets only -- no CDN fallback path, even
as an "advanced" opt-in. Primary-source research (`docs/research/feature-roadmap-research.md`)
found this gate is not hypothetical: two of the five comparable tools
surveyed (reveal.js's official KaTeX/MathJax plugins, Marp Core in both
its stable and RC lines) default to fetching KaTeX's fonts from
`cdn.jsdelivr.net` unless the embedding application explicitly overrides
that default. We need a design that renders LaTeX math correctly without
inheriting that default.

## Decision Drivers

- No CDN fallback path, under any option -- the exact failure mode two of
  the five surveyed tools ship as their *default*.
- Do not hand-roll Markdown parsing (`AGENTS.md` Code Style) -- math-
  delimiter detection must go through `marked`'s own extension API.
- `generateHtml` must stay a pure, synchronous function.
- A deck with no math must incur zero size/behavior cost.
- One malformed formula must not crash the whole render.

## Considered Options

1. **KaTeX's Node-side `renderToString` API via a proper `marked`
   tokenizer extension, with fonts inlined as base64 `data:` URIs.**
2. **KaTeX with its default CDN font path** (the shape both Marp Core
   and reveal.js's plugins default to).
3. **MathJax** instead of KaTeX.
4. **Hand-rolled `$...$`/`$$...$$` regex detection**, calling
   `katex.renderToString` directly without going through `marked`'s
   extension system.

## Decision Outcome

Chosen option: **Option 1 -- KaTeX + `marked-katex-extension`, fonts
inlined as base64.**

- **Option 2 (default CDN font path)** was rejected outright: this is
  precisely the anti-pattern the research identified in two of the five
  surveyed tools, and precisely what `CLAUDE.md`'s stop-and-ask gate
  exists to prevent.
- **Option 3 (MathJax)** was not pursued: KaTeX is already the tool this
  project's own docs (`AGENTS.md` Known Gotchas, `Context.md` Roadmap)
  have named as the intended choice since before this phase began: no
  new comparison was needed to justify revisiting an already-settled
  choice.
- **Option 4 (hand-rolled regex)** was rejected: `marked-katex-extension`
  (verified directly against its source) already registers proper
  `marked` tokenizer/renderer extensions -- the same category of solution
  ADR-0002 chose for slide segmentation over a regex-based alternative,
  and for the same reason: marked's own tokenizer already correctly
  leaves `$` inside inline code and fenced code blocks untouched, which a
  bespoke regex would need to reimplement and could get wrong.
- **Option 1** was verified empirically end-to-end: KaTeX's own font
  files (woff2-only, ~296KB raw / ~360KB after base64 encoding) were
  embedded via a rewritten `@font-face` block, loaded in a real browser,
  and confirmed to produce zero network requests beyond the local file
  itself, zero console errors, and visually correct math rendering.

## Consequences

**Good:**

- Zero CDN dependency, verified empirically rather than assumed.
- A deck with no math pays no size cost -- the ~360KB embedded font
  block is included only when the rendered output actually contains
  KaTeX markup.
- Invalid LaTeX degrades gracefully (`throwOnError: false`) to a visible,
  styled error span instead of crashing the whole render.
- `marked-katex-extension`'s use of `marked`'s own extension API means
  `$` inside inline code or fenced code blocks is never mistaken for
  math -- verified directly, not assumed.

**Bad:**

- A deck that uses even one small formula pays the full ~360KB embedded
  font cost for all 20 KaTeX font families, not just the ones that
  formula actually needs -- accepted as a reasonable simplicity trade-off
  rather than attempting to determine the minimal font subset per deck,
  which would require deep inspection of KaTeX's internal font-selection
  logic for comparatively little payoff at this project's scale.
- `katex` and `marked-katex-extension` are two new runtime dependencies
  -- both were checked directly (via `npm view`) to confirm no DOM
  library, browser-automation library, or other heavy/network-reaching
  transitive dependency exists in either package's own dependency tree.

## Confirmation

This decision is confirmed as implemented when:

1. Inline (`$...$`) and block (`$$...$$`) LaTeX math renders via KaTeX.
2. `$` inside inline code or a fenced code block is never rendered as
   math.
3. Invalid LaTeX renders a visible error span rather than throwing.
4. A deck with no math contains no KaTeX CSS/font references at all.
5. A deck with math contains zero CDN hostname references (`cdn.`,
   `unpkg.com`, `jsdelivr.net`, `cdnjs.cloudflare.com`) and zero
   `<script src="http`/`<link href="http` external resource references.

## More Information

- See `docs/research/feature-roadmap-research.md` §3a for the primary-
  source comparison against reveal.js's and Marp Core's default CDN
  behavior.
- See `docs/specs/feature-implementation-roadmap-design.md` §6 for how
  this fits into the broader Phase 4 roadmap item.
- See `Context.md`'s Roadmap, item 8.
- See `docs/adr/0002-per-slide-segmentation.md` for the precedent this
  ADR follows regarding marked's own extension API over hand-rolled
  regex.
