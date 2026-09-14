# 0009. Templates (layouts), presentation mode, and transitions

## Status

Accepted — 2026-09-12

## Context and Problem Statement

`Context.md`'s Roadmap item 11 named "Full theme, template, and transition
system" as the deferred gap; the theme portion of it, the theme system
(`docs/adr/0008-named-theme-system.md`), already shipped. Once the theme
system landed, that same roadmap line explicitly carried the remainder
forward: "**Templates and transitions remain deferred** — ... Needs its
own brainstorming pass when reached." This ADR is that pass, landed.

A live, section-by-section brainstorming session produced
`docs/specs/templates-transitions-design.md`, which this ADR's Decision
Drivers and Considered Options are drawn from. That session surfaced a
real, mid-brainstorm scope discovery, not an original planning item:
**transitions are meaningless without discrete slide changes to animate
between**, and nh-deck's dev-server (`render`) view at the time rendered
every slide as one continuously-scrollable page with no navigation
mechanism at all — there was no "next slide" for a transition to animate
into. A genuine, one-slide-at-a-time **presentation mode** therefore had
to be designed and built as a real prerequisite for transitions, not
folded in as an afterthought or skipped. `SOUL.md`'s "render faithfully,
don't editorialize" value meant this third subsystem, like the two it
depends on, had to stay strictly opt-in.

## Decision Drivers

- **No forced default, ever.** A slide with no `<!-- layout: name -->`
  marker, a deck with no `--transition`/frontmatter `transition:`, and a
  URL with no `?present` must all render/behave exactly as they did before
  this feature existed — the single biggest regression risk of touching
  `render.ts`'s core per-slide loop and style-assembly path, not just an
  aspiration.
- **`--css` already means "I'm handling styling myself," consistently
  with the theme system.** Whatever layout/transition mechanism is added
  must not create a new CSS-cascade-layering puzzle when a user also
  supplies `--css` — mutually exclusive, same posture theming already
  established.
- **Local-first, no exceptions.** Presentation mode's client-side script
  and all new layout/transition CSS must ship inline in the served HTML,
  with zero CDN dependency, consistent with the precedent
  `docs/adr/0004-katex-local-embedded-math.md` and
  `docs/adr/0005-mermaid-local-cdn-import-stripped.md` already set.
  Presentation-mode navigation state (the current slide) lives in
  `location.hash`, not any server-side session or external state.
- **Layouts apply everywhere `render`/`pdf`/`png` render a slide; transitions
  apply only to `render`, and only ever visually manifest inside
  `?present`.** A layout is a structural/visual choice consistent with the
  "PDF that looks like what was on screen" mission; a transition is
  meaningless on a static export.
- **KISS/YAGNI over an extensible, user-registrable layout/transition
  system.** A small, fixed, well-known set of each (4 layouts, 2
  transitions) is easier to build, test, and document than a
  custom-registration mechanism nobody asked for yet — the same tradeoff
  the theme system already made with its fixed 4 themes.

## Considered Options

### What "templates" means

1. **Per-slide layout CSS classes**, applied via a marker the author opts
   a specific slide into.
2. **Whole-deck starter scaffolds** (a pre-written `.md` file a user
   copies to start a new deck).
3. **Reusable content snippets** (a way to define and reuse a block of
   Markdown across slides).

### Layout opt-in mechanism

1. **A standalone HTML comment**, `<!-- layout: name -->`, mirroring the
   existing presenter-notes convention.
2. **New Markdown syntax** (a Pandoc-style attribute list, or a per-slide
   mini frontmatter block).

### Presentation mode's navigation-state mechanism

1. **`location.hash`**, read on load and updated on every navigation.
2. **In-memory JS state only**, lost on reload.
3. **A server-side session**, persisted by `server.ts`.

### Transition selection mechanism

1. **Both** a `--transition <name>` CLI flag and a Markdown frontmatter
   `transition:` key, flag overriding frontmatter — mirroring the theme
   system's exact `--theme`/frontmatter `theme:` precedent.
2. **Frontmatter only.**
3. **CLI flag only.**

### Unrecognized-name error handling (layouts vs. transitions)

1. **Diverge from the theme system**: transitions warn-and-fall-back on an
   unrecognized name (matching `resolveThemeName`'s shape exactly), but
   layouts silently no-op on an unrecognized name, with no warning at all.
2. **Match the theme system exactly** for both: warn-and-fall-back on any
   unrecognized name, layouts included.

## Decision Outcome

Chosen: **Option 1 in every category above.** Templates mean per-slide
layout classes (not scaffolds or snippets); layout opt-in is a standalone
HTML comment; presentation-mode state lives in `location.hash`; transition
selection mirrors the theme system's flag-plus-frontmatter precedent; and
unrecognized-name handling deliberately *diverges* between layouts
(silent no-op) and transitions (warn-and-fall-back) — not an
inconsistency, but a direct consequence of *where* each name is resolved
(see the rejected alternatives below).

- **"Templates" as whole-deck scaffolds or reusable snippets was
  rejected**: a scaffold is a starting-point file, not a rendering
  feature, and out of scope for a rendering CLI's own responsibility; a
  snippet-reuse mechanism is a real feature but an unrelated one to
  "give a slide a fixed visual structure," and neither was what Roadmap
  item 11 was actually gesturing at.
- **New Markdown syntax for the layout marker was rejected**: `marked`'s
  tokenizer has no native support for Pandoc-style attribute lists or a
  per-slide mini frontmatter block, so either would require a custom
  tokenizer extension for a purely cosmetic syntax preference, when a
  standalone HTML comment already has a working, precedented parser
  (`presenterNotes.ts`'s own comment-matching logic) to mirror.
- **In-memory-only or server-side session state was rejected**: in-memory
  state is lost on `--watch`'s `location.reload()`, defeating live
  presenting-while-editing; a server-side session would be nh-deck's
  first piece of server-side state ever, a real architectural weight
  increase for a local single-user CLI with no accounts, and would
  violate the "state travels with what the browser already has" simplicity
  a `location.hash` value gets for free.
- **Frontmatter-only or flag-only transition selection was rejected**, for
  the same reasons the theme system already rejected them: frontmatter-only
  means presenting the same deck twice with two different transition
  choices (e.g. a subtle fade for a formal talk vs. no transition at all
  for a quick review) requires editing the file each time; flag-only means
  a transition choice doesn't travel with the deck file, so sharing the
  `.md` loses the author's intended motion.
- **Matching the theme system's warn-and-fall-back for layouts too was
  rejected**: unlike a theme name (resolved once, up front, from
  frontmatter, exactly where `resolveThemeName` already runs) or a
  transition name (same shape), a layout marker is discovered *inside*
  `generateHtml`'s own per-slide `marked`-lexing pipeline. Surfacing a
  warning from there would require either changing `generateHtml`'s
  return type away from a plain string — a real breaking change touching
  every existing caller and test — or a circular import between
  `render.ts` and `slideLayouts.ts`. A silent no-op costs nothing extra
  and behaves identically to "no marker present at all," which is already
  the required no-op behavior for the *far* more common case of a slide
  with no layout marker.

Concretely, as landed:

1. `src/slideLayouts.ts` — `LAYOUTS: readonly string[]` (`title`,
   `section`, `two-column`, `quote`), `resolveLayoutName(requested)`
   (case-insensitive, silently returns `{}` for `undefined`/unrecognized
   input, never throws), and `extractSlideLayout(tokens)`, which scans one
   slide's token array for a standalone `<!-- layout: name -->` comment
   (the same standalone-HTML-comment shape `presenterNotes.ts` already
   recognizes, disambiguated by content) and returns the raw requested
   name plus the token array with **every** matching comment removed —
   not just the winning one, when more than one is present. Removing
   every match, and having `render.ts`'s per-slide loop pass the
   *filtered* tokens (not the original array) into `extractNotes`, is
   what keeps a layout marker from ever being rendered as a presenter
   note, with zero change needed to `presenterNotes.ts` itself.
2. `src/transitions.ts` — `TRANSITIONS: readonly string[]` (`fade`,
   `slide`) and `resolveTransitionName(requested)`, structured identically
   to `resolveThemeName`: `undefined`/empty input silently resolves to no
   transition with no warning; a non-empty, unrecognized name returns a
   `warning` string for the caller to print and falls back to no
   transition; never throws.
3. `src/presentationScript.ts` — `PRESENTATION_SCRIPT`, a complete
   `<script>...</script>` string, entirely inert unless
   `new URLSearchParams(location.search).has("present")`. When active: adds
   a `presenting` class to `document.body`; toggles an `is-active` class
   onto exactly one `.slide` section at a time (an animatable class
   toggle, not the `hidden` attribute, so the transition CSS below has a
   property to animate); renders a small "N / total" counter; listens for
   `ArrowRight`/`Space` (advance), `ArrowLeft` (back), and a document
   `click` that advances unless the click target is or is inside an `<a>`
   (so links inside slide content keep working); and persists the current
   slide index to `location.hash` on every navigation, read back on load
   so a `--watch`-triggered reload (or a manual browser refresh) restores
   the same slide.
4. `src/render.ts` — `generateHtml(markdown, title?, customCss?,
   themeColors?, transitionName?)` gained a 5th parameter. Per-slide
   rendering now calls `extractSlideLayout` before `extractNotes`, applies
   the resolved layout name as an additional `layout-<name>` class on that
   slide's `<section class="slide">` wrapper, and always embeds
   `PRESENTATION_SCRIPT` (inert without `?present`, matching the existing
   `?notes` toggle script's own always-embedded-but-inert precedent). Two
   new unconditional style blocks (`LAYOUT_STYLE`, `PRESENTATION_STYLE`)
   are never suppressed by `--css` for their *base* mechanism —
   `PRESENTATION_STYLE`'s plain `display: none`/`block` toggle is a
   functional necessity for presentation mode to work at all, exactly like
   `NOTES_STYLE`/`PRINT_PAGINATION_STYLE` are never suppressed either — but
   `LAYOUT_STYLE`'s cosmetic layout CSS and the transition-specific
   `transitionToCssBlock(name)` override (which switches `is-active`
   toggling from a plain `display` swap to a `position: absolute` +
   `opacity`/`transform` animatable version) are both omitted whenever
   `customCss` is set, matching how `themeOverride` was already omitted —
   `--css` replaces everything nh-deck would otherwise inject, layouts and
   transitions included.
5. `src/index.ts` — a `--transition <name>` option was added **only** to
   the `render` subcommand (never `pdf`/`png`). A new
   `computeEffectiveTransition(frontmatterTransition, flagTransition,
   customCss)` helper mirrors `computeEffectiveTheme`'s exact shape and
   precedence: flag wins over frontmatter; if `--css` was also given and a
   transition was requested, a one-line stderr note is printed
   (`nh-deck: note: --css overrides the requested transition '<name>'; it
   was not applied.`) and no transition is resolved; otherwise an unknown
   name's warning is printed and it falls back to no transition. The
   `--watch` debounced rerender closure recomputes the effective
   transition on every save (discarding any message, so it never
   reprints a warning/note on a keystroke-triggered re-render) — the same
   "warn once, not on every re-render" precedent the theme system's own
   `--watch` fix already established.

## Consequences

**Good:**

- All three pieces are opt-in and independently invisible when unused: a
  deck with no layout marker, no `--transition`/frontmatter `transition:`,
  and a URL with no `?present` renders and behaves exactly as before this
  branch — verified by dedicated regression tests (a byte-identical-output
  assertion in `tests/render.test.ts` for both the no-layout and
  no-transition-argument cases) written and passing before this
  feature's change to `render.ts`, and re-verified after.
- Zero new runtime dependencies and zero CDN references: the
  presentation-mode script and every new CSS block ship inline in the
  served HTML, consistent with every prior rendering feature's local-first
  precedent.
- The `--css` composability rule stays simple and uniform across all three
  now-shipped customization axes (themes, layouts, transitions):
  `--css` either fully replaces nh-deck's injected styling or it doesn't
  run at all, with no cascade-order question to reason about for any of
  them — while presentation mode's own base show/hide mechanism keeps
  working regardless, since it's a functional necessity rather than a
  cosmetic override.
- Reusing the theme system's exact `computeEffectiveTheme`/
  `resolveThemeName` shape for `computeEffectiveTransition`/
  `resolveTransitionName` meant no new precedence model needed
  inventing or explaining — a reviewer already familiar with `--theme`
  can read `--transition`'s behavior by analogy.
- The mid-brainstorm discovery that presentation mode was a genuine
  prerequisite, not a nice-to-have, was surfaced and resolved *before*
  implementation began (recorded in
  `docs/specs/templates-transitions-design.md`) rather than being found
  the hard way partway through building transitions.

**Bad / open risks:**

- ~~There is no in-UI way to exit presentation mode.~~ **Resolved in
  v1.1.0** — Escape now exits presentation mode directly, back to the
  continuous-scroll view, with no URL edit and no full page reload; see
  `CHANGELOG.md`'s v1.1.0 entry and `exitPresentationMode()` in
  `src/presentationScript.ts`.
- **Unrecognized layout names are silently ignored, with no warning at
  all — the one behavior asymmetry with the theme and transition
  systems, which both warn-and-fall-back on an unrecognized name.** This
  is a deliberate tradeoff, not an inconsistency introduced by oversight:
  see the Considered Options/Decision Outcome sections above for why a
  per-slide marker, discovered deep inside `generateHtml`'s per-slide
  lexing loop, has no clean way to surface a warning without either a
  breaking API change or a circular import. A genuine typo in a
  `<!-- layout: name -->` marker (e.g. `<!-- layout: titel -->`) will
  render that slide with no layout applied and no diagnostic printed
  anywhere.
- **The fixed 4-layout/2-transition sets are not user-extensible.** A user
  who wants a 5th layout, a 3rd transition, or to tweak one of the shipped
  ones has only `--css` as an escape hatch (a full stylesheet replacement,
  not a per-layout or per-transition override) — the same deliberate
  KISS/YAGNI tradeoff the theme system already made with its fixed 4
  themes, carried forward here rather than revisited.
- **Transitions never apply to `pdf`/`png` export, by design** — a static
  export has no "next slide" to animate into, so this is not a gap so much
  as an explicit non-goal (`docs/specs/templates-transitions-design.md`
  §7), but it means a deck author cannot preview a transition's visual
  effect anywhere except the real, unmocked browser presentation-mode
  view.

## Confirmation

This decision is confirmed as implemented by:

1. `tests/slideLayouts.test.ts` — the exact 4 fixed layout names,
   `resolveLayoutName`'s known/case-insensitive/silent-unrecognized/no-
   input behavior, and `extractSlideLayout`'s comment-matching,
   multi-marker-first-wins-but-all-removed behavior, and the dedicated
   case proving a plain presenter note is never mistaken for a layout
   marker.
2. `tests/transitions.test.ts` — the exact 2 fixed transition names, and
   `resolveTransitionName`'s known/case-insensitive/unknown-name-warning/
   no-input behavior.
3. `tests/presentationScript.test.ts` — `PRESENTATION_SCRIPT`'s real
   `<script>` wrapping, its `present`-query-parameter gate, its
   `ArrowRight`/`ArrowLeft` key handling, its `location.hash` persistence,
   its link-click exclusion, and that it references no external CDN.
4. `tests/render.test.ts` — each of the 4 layouts applying its CSS class;
   the byte-identical-with-no-layout-marker regression case; a layout
   marker excluded from both rendered notes and raw-HTML detection; the
   unrecognized-layout-name silent-no-op case; `--css` suppressing
   `LAYOUT_STYLE`; the presentation script's unconditional embedding;
   both transitions' CSS block presence/absence matching the resolved
   `transitionName`; the byte-identical-with-no-transition-argument
   regression case; and `--css` suppressing transition CSS while still
   leaving `PRESENTATION_STYLE`'s base show/hide mechanism intact.
5. `tests/cli.test.ts`'s `"CLI: transition selection"` describe block —
   end-to-end `--transition` flag usage, frontmatter-only `transition:`
   usage, flag-wins-over-frontmatter precedence, `--css`-wins-with-
   stderr-note, unknown-transition-name warning-and-fallback, and
   `pdf` rejecting `--transition` as an unrecognized option outright —
   each spawning the real CLI, verified live: 6/6 passing, zero orphaned
   `puppeteer_dev_chrome_profile` Chrome processes afterward.
6. `tests/presentationMode.test.ts` — a real, unmocked browser test (the
   first in this codebase to prove interactive DOM behavior rather than a
   string assertion): only the first slide visible under `?present`;
   `ArrowRight`/`ArrowLeft` advancing/retreating; a body click advancing;
   a click on a link inside slide content *not* advancing; the current
   slide surviving a real page reload via `location.hash`; and the
   default (no `?present`) continuous-scroll view left completely
   unaffected — verified live: 6/6 passing.
7. The full existing test suite, `npm run build`, `npm run lint`, and
   `npm run typecheck` all passing unchanged.

## More Information

- `docs/specs/templates-transitions-design.md` — the full design spec this
  ADR's Decision Drivers and Considered Options are drawn from, including
  the live brainstorming session's turn-by-turn decisions and the two
  mid-planning simplifications (layout-name warnings as a silent no-op;
  the layout/presenter-note collision resolved by filter ordering in
  `render.ts`, not a change to `presenterNotes.ts`).
- `docs/plans/templates-transitions-implementation-plan.md` — the
  task-by-task implementation plan, including the Global Constraints this
  ADR's `--css` composability rules and layout/transition asymmetry
  reasoning are drawn from.
- `docs/adr/0008-named-theme-system.md` — the theme system this ADR's
  `--theme`/frontmatter precedence model, `--css`-mutual-exclusivity
  posture, and fixed-registry-over-extensibility tradeoff all directly
  follow.
- `docs/adr/0004-katex-local-embedded-math.md` and
  `docs/adr/0005-mermaid-local-cdn-import-stripped.md` — the local-first
  precedent this ADR's "no CDN, everything inline" constraint follows.
- `Context.md`'s Roadmap, item 11, for the now-closed deferred item this
  ADR resolves.
- `src/slideLayouts.ts`, `src/transitions.ts`,
  `src/presentationScript.ts`, `src/render.ts`, and `src/index.ts` for the
  implementation referenced throughout this ADR.
