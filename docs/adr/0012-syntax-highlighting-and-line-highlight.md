# 0012. Syntax highlighting integration path, line-highlight tokenization, and background suppressibility

## Status

Accepted — 2026-09-16

## Context and Problem Statement

Three independent authoring/rendering features shipped in the same release
batch: real syntax highlighting for fenced code blocks via highlight.js,
Slidev-style `{1|3-4}` line highlighting layered on top of it, and an
opt-in per-slide background color/image marker. Each involved a real
integration decision this repo's own existing constraints ruled one way
on, not just a preference. This ADR records all three together, batched
the same way `0009` and `0011` batched their own release's features, since
none is big enough on its own to justify a standalone ADR and all three
land in the same release.

## Decision Drivers

- **The mermaid diagram code path must never be put at risk.** `code()`'s
  renderer override in `src/render.ts` is the one place a `mermaid`-tagged
  fenced block is recognized and dispatched to `renderMermaidDiagram`
  instead of ordinary code rendering (see `docs/adr/0005`). Any new
  integration point for syntax highlighting has to keep that guarantee
  absolute, not "true in the common case."
- **No unbounded dependency weight for a curated feature.** This project
  already keeps `puppeteer-core` instead of `puppeteer` and avoids a
  bundler specifically to keep its own footprint proportional to what it
  needs (see `AGENTS.md`'s Known Gotchas) — a new rendering dependency
  should follow the same discipline rather than pulling in an entire
  library's default bundle when a fixed, deliberately narrow subset is all
  a slide deck realistically needs (mirroring `themes.ts`'s/
  `slideLayouts.ts`'s own fixed-registry precedent).
- **Highlighted output must survive line-splitting without corruption.** A
  multi-line highlight.js `<span>` (a block comment, a triple-quoted
  string) cannot be naively cut at every `\n` — doing so would leave
  dangling unclosed tags on some lines and orphaned closing tags on
  others, breaking the DOM the moment a browser tries to parse it.
- **A decorative, per-element visual choice is a different kind of thing
  than a shared stylesheet rule.** This project already has a working
  precedent for a per-slide marker whose effect is a *shared CSS class*
  (`<!-- layout: name -->`, styled by `LAYOUT_STYLE`, suppressed under a
  custom `--css`). A background marker needed a decision about whether it
  should follow that same shape or a genuinely different one.

## Considered Options

### (a) Syntax highlighting: bridge mechanism and language registry

1. **Call `highlightCode()` (a thin highlight.js wrapper) directly from
   inside the existing `code()` renderer override**, the one place already
   guaranteed to be the sole handler for the `code` token type in this
   file, using `highlight.js/lib/core` plus 12 individually
   `registerLanguage()` calls (JavaScript, TypeScript, Python, Bash, JSON,
   YAML, CSS, XML, Markdown, SQL, Rust, Go), with an explicit `plaintext`
   fallback for anything unregistered.
2. **Register `marked-highlight`'s own `marked.use()` extension**, the
   package that exists specifically to bridge `marked` and highlight.js,
   using the top-level `highlight.js` package, which auto-registers all
   ~190 of its bundled languages.

### (b) Line-highlight splitting technique

1. **Tokenize the highlighted HTML into span-opens/span-closes/text runs,
   track an open-span stack, and close-then-reopen that exact stack at
   every literal `\n`** (`splitHighlightedHtml` in `codeHighlight.ts`).
2. **Split the highlighted HTML on `\n` directly with a plain
   `String.split("\n")`.**

### (c) Background marker mechanism

1. **A plain inline `style` attribute written directly onto that slide's
   own `<section>` element**, computed once per slide in `generateHtml`
   and never gated behind `!customCss`.
2. **A new shared CSS rule** (e.g. `.slide[data-bg="1"] { background: ...
   }`), added to the same `customCss ??`-gated default stylesheet block
   `LAYOUT_STYLE`/`HLJS_STYLE`/`CODE_LINE_HIGHLIGHT_STYLE` already live in.

## Decision Outcome

Chosen: **Option 1 in (a), (b), and (c).**

**(a) Direct `highlightCode()` call over a curated 12-language registry,
not `marked-highlight` over the full bundle.** Two separate decisions,
both resolved the same direction for related reasons.

On the bridge mechanism: `marked-highlight@2.2.4`'s own source was read
directly (not just its README) before this decision: it registers its own
`renderer.code` override in addition to its `walkTokens` hook, and
`marked@18.0.13`'s own `use()` implementation makes the LAST-registered
`renderer.code` in a chain of `marked.use()` calls win outright — neither
implementation ever returns `false` to fall through to the other. That
means which `renderer.code` "wins" would depend entirely on
`marked.use()` call order between this file and wherever
`marked-highlight` got registered — a fragile, easy-to-silently-break
collision risk for exactly the code path (`mermaid`) that must never
receive highlighted markup instead of raw source. Calling
`highlightCode()` directly from inside the one `code()` implementation
this file already registers sidesteps that risk entirely: there is only
ever one `renderer.code`, so there is no call-order dependency to get
wrong, today or after some future `marked.use()` is added elsewhere in
this codebase. `marked-highlight` was installed, evaluated against its
real source, and then uninstalled; only `highlight.js` itself remains a
dependency.

On the language registry: `highlight.js/lib/core` ships with zero
languages pre-registered, unlike the top-level `highlight.js` package
(~190 languages, the overwhelming majority of which this project's own
decks will never use). Registering exactly the 12 languages a slide-deck
author is actually likely to write keeps the dependency's footprint
proportional to real usage, the same "no bundler, no unnecessary
dependency weight" philosophy `AGENTS.md` already documents for
`tsc`/`puppeteer-core`. This is a fixed, deliberately narrow registry,
mirroring `themes.ts`'s/`slideLayouts.ts`'s own fixed-registry precedent —
extending it later is a real decision, not a drive-by addition. Verified
directly against the installed package (not assumed): `highlight.js/lib/core`
throws "Unknown language" for anything not explicitly registered, even
its own built-in `plaintext` grammar, so `plaintext` is registered the
same way any other language is, purely as the degrade-to-plain-text target
for an unregistered language tag — it has no grammar rules of its own, so
`hljs.highlight()` against it just HTML-escapes the code with zero added
`<span>` wrapping, the same visible result as before this feature existed.

**(b) Tokenize-and-rebalance splitting, not a naive `\n` split.** A naive
`html.split("\n")` would cut straight through any highlight.js `<span>`
that opens on one line and only closes several lines later — exactly what
a multi-line comment or triple-quoted string highlights as. The result
would leave an unclosed `<span>` dangling at the end of one line's string
and a stray, unmatched `</span>` at the start of the next — both of which
a browser's own HTML parser would "fix" by implicitly closing/ignoring
tags in ways that do not match what highlight.js actually intended,
silently corrupting the highlighted markup for any code sample containing
a multi-line token. `splitHighlightedHtml` avoids this by tokenizing the
whole highlighted string into a flat stream of span-opens, span-closes,
and plain-text runs first (safe because highlight.js always HTML-escapes
source text before wrapping it, so a plain-text token can never itself
contain a stray `<` or `>`), tracking a stack of the exact currently-open
opening-tag strings, and — whenever a literal `\n` is hit inside a
text token — closing every open span in reverse order to end that line,
then reopening the identical stack of spans in original order to begin
the next line's own string. This is more code than a one-line `split`,
but it is the only version of this feature that is correct against real
multi-line highlight.js output, not just against single-line samples —
verified directly with a real `hljs.highlight()` call over multi-line
input in `tests/codeHighlight.test.ts`, not assumed from reading
highlight.js's own docs.

**(c) A plain inline `style` attribute, not a new shared CSS rule.** A
background choice is fundamentally a per-slide, per-element value (a
specific color or image path an author typed for exactly this one slide),
not a reusable visual treatment shared across every slide the way
`LAYOUT_STYLE`'s flex/grid rules are — there is no sensible shared CSS
selector to write for "this slide's background," only "whatever this
slide's own author put in the comment." Writing it through as a `style`
attribute directly on that slide's own `<section>` needed zero new CSS
constant at all — the value is escaped once (`escapeHtml`, the same
treatment every other author-controlled value this function interpolates
already gets) and placed inline, which is also why it is not suppressed
under `!customCss` the way `LAYOUT_STYLE`/`HLJS_STYLE`/
`CODE_LINE_HIGHLIGHT_STYLE` are: those three are shared rules living
inside the swappable default `<style>` block, so a `--css` replacement
correctly drops them along with the rest of that block, but a `style`
attribute is not part of that block at all — a `--css` replacement only
ever replaces the document's `<style>` element, never a per-element
attribute already baked into the markup. This is the reasoning behind
this release's own categorization of the background marker as
decorative-but-not-stylesheet-suppressible: it is decorative in the same
"opt-in, author-controlled, no interactive mechanic attached" sense
`LAYOUT_STYLE` is, but implemented through a different mechanism (markup
attribute, not stylesheet rule) that happens to not be suppressible the
same way — a real, verified difference from the layout marker's own
behavior, not an oversight to be "fixed" into matching it. A deck author
who supplies a full custom stylesheet can still override an individual
slide's background with a `!important` rule or a higher-specificity
selector of their own if they want to, exactly as they could for any other
inline style in HTML — this project does not need to build that override
mechanism itself.

## Consequences

**Good:**

- The mermaid diagram code path stays provably unaffected by syntax
  highlighting regardless of `marked.use()` call order anywhere else in
  this codebase, now or in the future — verified by a real regression test
  in `tests/render.test.ts`.
- Highlighted code with multi-line tokens (block comments, triple-quoted
  strings) splits into per-line highlight spans without ever producing
  broken/dangling HTML, verified against real `hljs.highlight()` output in
  `tests/codeHighlight.test.ts`, not just single-line samples.
- A per-slide background survives even a full `--css` stylesheet
  replacement, matching what most authors intuitively expect from typing a
  value directly into their own deck's Markdown source.

**Bad / open risks:**

- **Line highlighting is a single static range for this release.** A
  deck author cannot yet advance a highlighted range fragment-by-fragment
  alongside presentation-mode navigation the way Slidev's own version of
  this feature supports — see the CHANGELOG's own "deliberately deferred
  fast-follow" note. Building that correctly would need a fragment-aware
  per-step highlight state, not just a parsed line-number `Set`.
- **The curated 12-language registry is a real limit, not just a
  placeholder.** A deck author writing, say, Kotlin or PHP code gets the
  harmless `plaintext` fallback, not an error, but also not real
  highlighting — extending the registry is a deliberate follow-up
  decision, not something this release attempted to anticipate.
- **A background marker's escaped value is still author-supplied,
  unvalidated CSS content.** `bg:`/`bg-image:` pass whatever the author
  typed straight into a `style` attribute (after HTML-escaping, never CSS-
  escaping) — a malformed value degrades to no visible background rather
  than throwing, but this project does not attempt to validate that a
  given color/path value is well-formed CSS before writing it through.

## Confirmation

This decision is confirmed as implemented by:

1. `src/codeHighlight.ts` — `highlightCode()` (the direct integration
   point, with its own docstring explaining the `marked-highlight`
   rejection), the 12-language `registerLanguage()` calls plus the
   `plaintext` fallback, and `parseHighlightSpec()`/
   `splitHighlightedHtml()`/`applyLineHighlights()` for line highlighting.
2. `src/render.ts` — the `code()` renderer override's mermaid-first-branch
   ordering (the guarantee (a) depends on), `HLJS_STYLE` (the color rules
   this same release's own final-integration pass found missing — see the
   CHANGELOG's Fixed entry), and `CODE_LINE_HIGHLIGHT_STYLE`.
3. `src/slideBackgrounds.ts` — `extractSlideBackground()`/
   `isBackgroundMarkerComment()`, and `generateHtml`'s own
   `backgroundStyle` computation (the inline `style` attribute, never
   gated behind `!customCss`).
4. `tests/codeHighlight.test.ts` — unit coverage for
   `parseHighlightSpec`/`splitHighlightedHtml`/`applyLineHighlights`
   against real `hljs.highlight()` output, including multi-line-token
   cases.
5. `tests/render.test.ts` — the mermaid-unaffected regression test, the
   real-browser `getComputedStyle()` proof that `hljs-*` tokens and
   line-highlighted lines both render with actually distinct colors (not
   just the right class names), and the `!customCss` suppression tests for
   `HLJS_STYLE`/`CODE_LINE_HIGHLIGHT_STYLE` versus the background marker's
   own deliberately-not-suppressed behavior.
6. `tests/slideBackgrounds.test.ts` — unit coverage for the marker-parsing
   module itself.
7. The full existing test suite, `npm run build`, `npm run lint`, and
   `npm run typecheck` all passing.

## More Information

- `docs/adr/0005-mermaid-local-cdn-import-stripped.md` — the ADR
  establishing the mermaid rendering path this batch's syntax highlighting
  had to layer on top of without ever being able to reach it.
- `docs/adr/0009-templates-transitions-presentation-mode.md` — the layout
  marker precedent (`<!-- layout: name -->`, `LAYOUT_STYLE`,
  `!customCss`-gated) this batch's background marker deliberately departs
  from for a specific, reasoned difference rather than copying it
  wholesale.
- `docs/adr/0011-presentation-interactivity-batch.md` — the most recent
  prior ADR, and the template this one follows for structure and tone.
