# 0008. Named theme system

## Status

Accepted — 2026-09-12

## Context and Problem Statement

`Context.md`'s Roadmap item 11 ("Full theme, template, and transition
system") named a real, deliberately-deferred gap: beyond the `--css <path>`
opt-out flag (`docs/adr/0006-phase-5-polish.md`), every deck rendered with
exactly one, hardcoded, unthemed look. There was no way to say "render this
deck dark" without hand-writing a whole replacement stylesheet via `--css`.
`SOUL.md`'s "render faithfully, don't editorialize" value meant this could
not be solved by simply picking one new default look; it required an
opt-in mechanism a user (or the deck file itself) could choose explicitly.
`docs/specs/theme-system-design.md` records the live, section-by-section
brainstorming session (per `CLAUDE.md`'s stop-and-ask gate for theme work)
that produced the decisions below; this ADR captures the resulting
architecture and its consequences, per this repo's own ADR convention.

## Decision Drivers

- **Local-first, no exceptions.** Any theme's colors must be plain values
  compiled into the JS bundle — never fetched from a CDN, never requiring a
  network call, consistent with `SOUL.md`'s non-negotiable and the
  precedent `docs/adr/0004-katex-local-embedded-math.md` and
  `docs/adr/0005-mermaid-local-cdn-import-stripped.md` already set.
- **No forced visual theme with no opt-out.** A deck with no theme
  requested (no `--theme`, no frontmatter `theme:`) must keep rendering
  exactly as it always has — this is the single biggest regression risk of
  refactoring the baseline stylesheet's mechanism, not just adding a new
  feature on top of it.
- **`--css` already means "I'm handling styling myself."** Whatever theme
  mechanism is added must not create a CSS-cascade-layering puzzle when a
  user also supplies `--css`.
- **KISS/YAGNI over a custom-theme-registration mechanism.** A small,
  fixed, well-known set of themes is easier to build, test, and document
  than an extensible registry nobody asked for yet.
- **Don't design new colors if a dependency already ships good ones.**
  `beautiful-mermaid` (already a runtime dependency, used for Mermaid
  diagram rendering since `docs/adr/0005-mermaid-local-cdn-import-stripped.md`)
  ships 15 named `{bg, fg, line, accent, muted}` palettes and its own
  SVG-rendering function already accepts custom colors in exactly that
  shape.
- **A deck's slide-separator convention (`---`) and a plausible YAML-style
  frontmatter delimiter (also `---`) collide syntactically.** Any
  frontmatter-parsing mechanism must not misinterpret a deck that simply
  opens with a stylistic horizontal rule as a (malformed) frontmatter
  block.

## Considered Options

### Theme color source

1. **Re-export `beautiful-mermaid`'s own named palettes** (`github-light`,
   `github-dark`, `dracula`, `nord`) under nh-deck's own simpler names.
2. **Design a bespoke color palette per theme**, independent of
   `beautiful-mermaid`'s.

### Theme selection mechanism

1. **Both** a `--theme <name>` CLI flag and a Markdown frontmatter
   `theme:` key, flag overriding frontmatter.
2. **Frontmatter only.**
3. **CLI flag only.**

### Frontmatter parsing approach

1. **A deliberately narrow, hand-written parser**: recognized only when
   the file opens with a literal `---` line, a literal closing `---` line
   exists after it, and every non-blank line between them parses as a flat
   `key: value` pair — falling through to "no frontmatter, whole file is
   body" on any violation.
2. **A real YAML parser dependency** (e.g. `js-yaml`), parsing the block
   between `---` delimiters as arbitrary YAML.

### Interaction with `--css`

1. **Mutually exclusive, `--css` wins**, with a one-line stderr note when
   both a theme and `--css` are given.
2. **CSS-cascade layering** — emit the theme's variables, then layer the
   user's custom CSS on top so it can override individual properties.

### Baseline stylesheet refactor mechanism

1. **CSS custom properties (`:root { --nh-bg: ...; }`)**, with the
   existing `@media (prefers-color-scheme: dark)` block rewritten to
   override the same variables, and an active theme's variables emitted in
   an additional unconditional `:root` block placed after it (later rule,
   equal specificity, wins — no `!important` needed).
2. **Generate an entirely separate `<style>` block per theme name**,
   selected by an `if`/`switch` in `generateHtml`.

## Decision Outcome

Chosen: **Option 1 in every category above** — reuse
`beautiful-mermaid`'s palettes; support both `--theme` and frontmatter
`theme:` (flag wins); a narrow hand-written frontmatter parser with no new
dependency; `--css` wins outright over any theme with a stderr note; and a
CSS-custom-properties refactor of the baseline stylesheet.

- **Theme color source, Option 2 (bespoke palette) was rejected**: it
  would mean designing, testing, and maintaining 4 new color palettes for
  no benefit over the 4 already-vetted palettes `beautiful-mermaid` ships
  and this project already depends on — and it would forfeit "reuse the
  same colors for Mermaid diagrams for free," forcing a second,
  independent color-matching exercise per theme.
- **Selection mechanism, Option 2 (frontmatter only) was rejected**: a
  user presenting the same deck twice with two different looks (e.g. a
  light-room demo vs. a dark-room talk) would have to edit the file each
  time. **Option 3 (flag only) was rejected**: a theme choice would not
  travel with the deck file, so sharing the `.md` file would lose the
  author's intended look.
- **Frontmatter parsing, Option 2 (a real YAML parser) was rejected**:
  this project's own philosophy (see `AGENTS.md`'s Code Style: "avoid a
  new dependency without a demonstrated need") only needs a single flat
  `theme: <name>` key — a full YAML grammar (nesting, lists, multi-line
  scalars) is unneeded complexity and unneeded dependency-surface for
  that. A hand-written parser narrow enough to require every non-blank
  line between the delimiters to parse as `key: value` also makes the
  slide-separator collision easy to resolve correctly: any deviation
  (a bare content line, no closing `---`, no opening `---`) falls all the
  way back to "treat the whole file as one opaque body," which is exactly
  how a deck that opens with a stylistic horizontal rule already rendered
  before this feature existed.
- **`--css` interaction, Option 2 (cascade layering) was rejected**: it
  would require deciding, testing, and documenting a precise override
  order per CSS property — real design and maintenance cost for a need
  `--css` already fully satisfies today ("I want total control, don't
  touch my styling"). A flat mutual-exclusion rule has no such surface.
- **Baseline refactor mechanism, Option 2 (a separate `<style>` block per
  theme) was rejected**: it means duplicating the entire stylesheet 4
  times (5 counting the default), a real DRY violation and a much larger
  diff for reviewers to verify doesn't silently change unthemed behavior.
  CSS custom properties keep exactly one copy of every non-color rule, and
  the "later `:root` block at equal specificity wins" cascade behavior
  means overriding a theme's colors needs no `!important` anywhere.

Concretely, as landed:

1. `src/frontmatter.ts` — `parseFrontmatter(markdown)` returns
   `{ frontmatter: Record<string, string>, body: string }`. Falls through
   to `{ frontmatter: {}, body: markdown }` (the entire original file,
   untouched) unless the file opens with a literal `---` line, a literal
   closing `---` line exists after it, and every non-blank line between
   them matches `key: value`.
2. `src/themes.ts` — `THEMES: Record<string, Theme>` with exactly 4 keys
   (`light`, `dark`, `dracula`, `nord`), each `colors` field a direct
   re-export of `beautiful-mermaid`'s own `THEMES["github-light"]`,
   `THEMES["github-dark"]`, `THEMES.dracula`, and `THEMES.nord` objects
   respectively (verified live against the installed
   `beautiful-mermaid` version — the hex values matched the plan's
   assumed values exactly, no discrepancy found).
   `resolveThemeName(requested)` case-insensitively validates a requested
   name, returning `{ name: DEFAULT_THEME_NAME ("light") }` for
   `undefined`/empty input with no warning, or
   `{ name: DEFAULT_THEME_NAME, warning: "..." }` for a non-empty,
   unrecognized name — never throws.
3. `src/mermaidRenderer.ts` — `renderMermaidDiagram(code, colors?)` gained
   an optional third-argument-equivalent `colors` parameter, forwarded
   directly to `beautiful-mermaid`'s own `renderMermaidSVG(code, colors)`.
4. `src/render.ts` — `generateHtml(markdown, title?, customCss?,
   themeColors?)` gained a 4th parameter. The baseline `<style>` block's
   colors are now `:root`-level CSS custom properties (`--nh-bg`,
   `--nh-fg`, `--nh-border`, `--nh-muted`, `--nh-code-bg`, `--nh-accent`)
   with the same literal hex values as before this change; the existing
   `@media (prefers-color-scheme: dark)` block now overrides those same
   variables at `:root` instead of setting `body`'s properties directly.
   When `themeColors` is given (and `customCss` is not), an additional
   unconditional `:root { ... }` override block is emitted after the
   auto/dark-mode block, so the theme's fixed colors win regardless of the
   visitor's OS color-scheme preference. `.katex { color: var(--nh-fg); }`
   ties KaTeX's rendered math color to the same variable.
5. `src/index.ts` — a `--theme <name>` option was added to all three
   subcommands (`render`, `pdf`, `png`). A new `resolveEffectiveTheme`
   helper implements the precedence: `--theme` flag, else the deck's own
   frontmatter `theme:` value, else nothing requested. If `--css` was also
   given and a theme was requested, a one-line stderr note is printed
   (`nh-deck: note: --css overrides the requested theme '<name>'; it was
   not applied.`) and the theme is not resolved or applied at all. If no
   `--css`, the requested name (if any) is validated via
   `resolveThemeName`; an unknown name prints its warning to stderr and
   falls back to `light`. The frontmatter-stripped `body` (not the raw
   file) is what's passed to `generateHtml`; `containsUnsafeHtml` is still
   checked against the *raw* markdown (a frontmatter block can never
   itself contain raw HTML by construction, so this is simpler than
   re-threading two separate strings).

### A verified gap: Mermaid diagrams are not yet actually recolored by a theme

The design intent (`docs/specs/theme-system-design.md` §2, "Theme scope:
**Everything**") and this ADR's own Decision Drivers both name Mermaid
diagram colors as in-scope alongside the base deck and KaTeX. Item 3 above
(`renderMermaidDiagram`'s optional `colors` parameter) is real, unit-tested
(`tests/mermaidRenderer.test.ts`), and correctly forwards colors to
`beautiful-mermaid` when called with them directly.

However, verified directly against the shipped `src/render.ts`: the
`marked.use({ renderer: { code(...) { ... renderMermaidDiagram(text) ... } } })`
registration that wires `renderMermaidDiagram` into Markdown rendering is
executed once at module load, outside of `generateHtml`'s function body —
its `code()` callback has no access to `generateHtml`'s per-call
`themeColors` argument, and the call site itself
(`return renderMermaidDiagram(text);`) passes no `colors` argument at all.
A live check (rendering the same `` ```mermaid `` fenced block through
`generateHtml` once with the `light` theme and once with `dark`) confirms
the two calls produce byte-identical SVG output — neither theme's `bg`/`fg`
values appear anywhere in the rendered diagram. **Mermaid diagrams
currently render with their own untouched default colors regardless of
which named theme (if any) is active.** This is recorded here rather than
silently glossed over — see Consequences below and `Context.md`'s Open
risks for the tracked follow-up.

> **Update (2026-09-12):** Fixed. `generateHtml` now sets a module-level
> "current call" variable (`currentMermaidColors`) at the top of its body,
> and the `code()` renderer's Mermaid branch reads it — safe despite being
> module-level mutable state because `generateHtml` is fully synchronous
> end to end, so no other call can interleave and observe a stale value.
> See `tests/render.test.ts`'s `recolors Mermaid diagrams to match the
> active theme` regression test. This ADR's own historical analysis above
> is left unchanged as the record of what was true at the time it was
> written; only this note and the corresponding Consequences bullet below
> reflect the fix.

## Consequences

**Good:**

- A deck author can now opt into `light`, `dark`, `dracula`, or `nord`
  without hand-writing a full replacement stylesheet, while a deck with no
  theme requested keeps rendering byte-identical output to before this
  feature existed — verified by a dedicated regression test
  (`tests/render.test.ts`'s "produces byte-identical output with no theme
  argument" case) written and passing against the pre-refactor code
  *before* the refactor, and re-verified passing after.
- Reusing `beautiful-mermaid`'s own palettes means zero new color-design
  work and, now that Mermaid theming (below) is wired in, zero fragile
  SVG-output post-processing.
- The frontmatter/slide-separator collision is resolved safely: any deck
  that opens with a bare `---` horizontal rule but has no valid trailing
  `key: value` block (or no closing `---` at all) falls all the way back
  to "treat the whole file as one opaque body" — indistinguishable from
  how that same deck rendered before this feature existed. No new failure
  mode was introduced for existing decks.
- `--css`'s mental model stays simple: it either fully replaces the
  stylesheet (today's behavior, unchanged) or it doesn't run at all; there
  is no cascade-order question to reason about or explain.
- All four new/changed function signatures
  (`generateHtml`, `renderMermaidDiagram`, and the three CLI subcommands'
  options) are additive and backward-compatible — no existing 1-, 2-, or
  3-argument caller needed to change.

**Bad / open risks:**

- **The fixed 4-theme set is not user-extensible.** A user who wants a 5th
  named theme, or to tweak one of the 4 shipped ones, has only `--css` as
  an escape hatch (full replacement, not a per-color override) — this was
  a deliberate KISS/YAGNI tradeoff, not an oversight, but it is a real
  limitation until/unless a future design pass revisits it.
- ~~**Mermaid diagrams do not yet actually change color with the active
  theme, despite the original design intent and this ADR's own Decision
  Drivers naming them in scope.** The plumbing (`renderMermaidDiagram`'s
  `colors` parameter) exists and is tested in isolation, but
  `generateHtml` never calls it with the active theme's colors. A
  dark-themed deck with a Mermaid diagram will show that diagram in its
  default (light, `beautiful-mermaid`-chosen) colors, which will look
  visually inconsistent against the rest of the themed slide.~~
  **Fixed (2026-09-12)** — see the Update note in the verified-gap
  subsection above.
- **Themes only affect color, not font choice or spacing.** This matches
  the explicit design scope (`docs/specs/theme-system-design.md` §2's
  "base deck (background/text/fonts/code blocks)" line is, on inspection
  of the shipped `themeToCssVarBlock`, actually color-only — no
  font-family variable exists in the theme mapping) — a future design
  pass would need to decide whether font theming is wanted before adding
  it.
- **Unknown theme names are silently non-fatal.** A typo in `--theme` or a
  deck's frontmatter (e.g. `--theme drakula`) never blocks rendering or
  export — it prints a warning and falls back to `light`. This is the
  deliberately-chosen safe default (matching this project's existing
  non-fatal-warning conventions, e.g. `UNSAFE_HTML_WARNING`), but it means
  a genuine typo could go unnoticed if stderr isn't being watched.

## Confirmation

This decision is confirmed as implemented by:

1. `tests/frontmatter.test.ts` — extraction, multi-key frontmatter,
   unclosed/malformed/no-leading-`---` fall-through cases, and the
   dedicated slide-separator-collision case (a deck whose first slide's
   content itself contains a bare `---` line).
2. `tests/themes.test.ts` — exactly the 4 fixed theme names, every theme
   having a valid `bg`/`fg` hex color, `resolveThemeName`'s validation,
   case-insensitivity, unknown-name warning/fallback, and
   `undefined`-input default-with-no-warning cases.
3. `tests/render.test.ts` — the byte-identical-default-output regression
   test (passing both before and after the refactor), plus theme-CSS-var,
   `.katex`-color-variable, and `--css`-wins-over-theme cases.
4. `tests/mermaidRenderer.test.ts` — `renderMermaidDiagram`'s `colors`
   parameter, called directly, produces different SVG output containing
   the given colors (proving the parameter itself works in isolation —
   see the verified-gap subsection above for what this does *not* prove).
5. `tests/cli.test.ts`'s `"CLI: theme selection"` describe block —
   end-to-end `--theme` flag usage, frontmatter-only `theme:` usage,
   flag-over-frontmatter precedence, `--css`-wins-with-stderr-note, and
   unknown-theme-name-warns-and-falls-back cases, each spawning the real
   CLI against a real temp `.md` fixture.
6. The full existing test suite, `npm run build`, `npm run lint`, and
   `npm run typecheck` all passing unchanged.

## More Information

- `docs/specs/theme-system-design.md` — the full design spec this ADR's
  Decision Drivers and Considered Options are drawn from, including the
  live brainstorming session's turn-by-turn decisions.
- `Context.md`'s Roadmap, item 11, for the now-resolved Mermaid-theming
  gap named above.
- `docs/adr/0004-katex-local-embedded-math.md` and
  `docs/adr/0005-mermaid-local-cdn-import-stripped.md` — the local-first
  precedent this ADR's "no CDN, no bundled fonts per theme" constraint
  follows.
- `docs/adr/0006-phase-5-polish.md` — the `--css` opt-out flag this ADR's
  mutual-exclusivity decision builds on.
- `src/frontmatter.ts`, `src/themes.ts`, `src/mermaidRenderer.ts`,
  `src/render.ts`, and `src/index.ts` for the implementation referenced
  throughout this ADR.
