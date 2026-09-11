# 0002. Adopt per-slide segmentation via marked's lexer/parser split

## Status

Accepted — 2026-09-10

## Context and Problem Statement

`generateHtml()` renders the entire input Markdown file as a single,
undivided HTML document — there is no `---`-based (or other) mechanism for
splitting a deck into presentable slides, even though nh-deck's own docs
and example fixture already write decks as if `---` marks a slide
boundary. This blocks every deferred feature that assumes real slide
boundaries exist (presenter notes, per-slide PDF pagination, live-reload
navigation). We need to decide how a deck gets split into slides, and how
to avoid CommonMark's own ambiguity around `---`: a `---` immediately
after a paragraph is a setext H2 heading underline, not a thematic break.

## Decision Drivers

- Must not hand-roll Markdown parsing (`AGENTS.md` Code Style) — whatever
  disambiguates a slide-boundary `---` from a setext-heading `---`, or
  from a `---` inside a fenced code block, must come from `marked`'s own
  tokenizer, not a bespoke regex.
- Must keep `generateHtml`'s existing pure, synchronous shape — both the
  `render` and `pdf` commands depend on it staying that way.
- Must preserve backward compatibility: an existing deck with no `---` at
  all must still render correctly, as a single slide, not break or
  produce zero output.
- No new runtime dependency — `marked` is already a dependency; the
  mechanism should use its existing public API.

## Considered Options

1. **Split the raw Markdown string on a `---`-matching regex, before
   calling `marked.parse()`.**
2. **Tokenize the whole document once via `marked.lexer()`, group the
   resulting top-level tokens into slides at each `hr` token, then render
   each group independently via `marked.parser()`.**
3. **Post-process the rendered HTML string, splitting on `<hr>` tags.**

## Decision Outcome

Chosen option: **Option 2 — lexer/parser token-group split.**

- **Option 1 (regex on raw string)** was rejected: verified directly
  against `marked.lexer()`'s output that a `---` immediately after a
  paragraph line (no blank line) produces a `heading` token (setext H2),
  not an `hr` token — a naive regex split would incorrectly treat that as
  a slide boundary and mangle the heading. A regex would also need to
  separately special-case fenced code blocks (where a literal `---` inside
  \`\`\`...\`\`\` must not split) — exactly the kind of Markdown-parsing-in-
  userland this project's coding style rule forbids.
- **Option 3 (post-process rendered HTML)** was rejected: by the time
  HTML is rendered, there is no reliable, unambiguous marker distinguishing
  a slide-boundary `<hr>` from any `<hr>` a user's Markdown might
  legitimately contain for a different reason — that distinction is only
  recoverable at the token level, before rendering.
- **Option 2** was verified empirically, directly against the installed
  `marked` version, using its stable public `lexer`/`parser` API: a `---`
  after a blank line produces a distinct `hr` token; the same `---`
  immediately after a paragraph produces a `heading` token instead; a
  `---` inside a fenced code block never leaves the enclosing `code`
  token's raw content. Grouping the top-level token array at `hr`
  boundaries and rendering each group independently via `marked.parser()`
  therefore delegates all of CommonMark's own disambiguation to `marked`'s
  tokenizer. Two consecutive `hr` tokens produce an empty group, filtered
  out rather than rendered as a blank slide. A document with zero `hr`
  tokens produces exactly one group — the required backward-compatibility
  case.

## Consequences

**Good:**

- Zero new dependency; `marked.lexer`/`marked.parser` are the same
  library already in use, just its two-phase public API instead of the
  combined `marked.parse()`.
- Slide-boundary disambiguation is exactly as correct as CommonMark
  itself, with no bespoke edge-case handling to maintain.
- `generateHtml` stays a pure, synchronous function.

**Bad:**

- Slightly more code than a one-line regex split, for a reader
  unfamiliar with `marked`'s lexer/parser split — mitigated with an
  explanatory comment at the call site in `render.ts`.
- Reference-style link definitions (`[text][ref]` / `[ref]: url`) are
  resolved during the single whole-document `marked.lexer()` call, before
  any slide-group splitting happens — verified this still resolves
  correctly even when the definition and its use land in different token
  groups, since `marked` bakes the resolved `href` into the link's inline
  token at lex time rather than deferring to a shared lookup at render
  time.

## Confirmation

This decision is confirmed as implemented when:

1. `generateHtml()` wraps each `---`-delimited slide in its own
   `<section class="slide">` element.
2. A deck with no `---` still renders as exactly one
   `<section class="slide">`.
3. A `---` immediately following a paragraph (setext H2 heading) does
   not create a new section.
4. A `---` inside a fenced code block does not create a new section.
5. `fixtures/sample.md` renders as three sections, and
   `tests/render.test.ts` asserts this.

## More Information

- See `docs/specs/feature-implementation-roadmap-design.md` §4 for how
  this fits into the broader Phase 2 roadmap item.
- See `Context.md`'s Roadmap, item 4.
