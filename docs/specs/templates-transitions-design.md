# nh-deck — Templates (Layouts) + Presentation Mode + Transitions (Design Spec)

## 0. Purpose and scope

`Context.md`'s Roadmap item 11 has carried "templates and transitions" as deliberately deferred since the theme system shipped, explicitly flagged as needing "its own brainstorming pass when reached." This spec is that pass.

In scope for v1:

- **Layouts** ("templates"): 4 fixed, opt-in per-slide layouts — `title`, `section`, `two-column`, `quote`. A slide with no marker renders exactly as it does today.
- **Presentation mode** (new prerequisite, discovered during brainstorming, not originally scoped): opt-in one-slide-at-a-time navigation in the dev-server view. Required because transitions are meaningless without discrete slide changes to animate between, and nh-deck's dev-server view currently renders all slides as one continuously-scrollable page with no navigation mechanism at all.
- **Transitions**: deck-wide `fade`/`slide` effect between slides, only ever visually meaningful inside presentation mode.

Out of scope for v1 (see §7).

## 1. Constraints (unchanged, carried forward from SOUL.md)

- No forced visual theme, layout, or transition — every piece here is opt-in; a deck with no markers/flags/frontmatter keys renders identically to today.
- No CDN dependency — the presentation-mode script and all layout/transition CSS ship inline in the served HTML, same as every other rendering feature.
- Local-first: presentation mode's navigation state (current slide) lives in `location.hash`, not any server-side session or external state.
- Render faithfully, don't editorialize: layouts and transitions describe *how* an opted-in slide is structured/animated, never *what* content looks like by default.

## 2. Decisions (from the live brainstorming session)

- Templates mean **per-slide layout classes**, not whole-deck starter scaffolds or reusable content snippets.
- Layout opt-in is a **standalone HTML comment** (`<!-- layout: name -->`), mirroring the existing presenter-notes convention rather than inventing new Markdown syntax (Pandoc-style attribute lists, per-slide mini frontmatter) that marked's tokenizer doesn't natively support.
- v1 layout set: `title`, `section`, `two-column`, `quote`.
- Transitions require slide-by-slide navigation as a prerequisite — built together in this same spec, not deferred separately.
- Presentation mode is **additive via `?present`** in the URL (mirroring the existing `?notes` toggle), never a replacement of the default continuous-scroll view.
- Transitions are **deck-wide**, mirroring the theme system's exact mechanism (`--transition` flag + frontmatter `transition:` key, flag wins over frontmatter on conflict), not a per-slide property like layouts.
- v1 transition set: `fade`, `slide`. No explicit `none` — omitting the flag/key already means no transition.
- Transitions apply **only** to the `render` dev-server view, and only inside `?present`. `pdf`/`png` never read the flag or frontmatter key at all.
- Layouts apply everywhere (`render`, `pdf`, `png`) since they're a structural/visual choice, consistent with the "PDF that looks like what was on screen" mission.
- `--css` wins over both layout CSS and transition CSS, exactly as it already wins over theme CSS — one consistent "custom `--css` replaces everything nh-deck would otherwise inject" mental model.

## 3. Architecture

### 3.1 New file: `src/slideLayouts.ts`

Structured like `themes.ts`:

```ts
export const LAYOUTS = ["title", "section", "two-column", "quote"] as const;
export type LayoutName = (typeof LAYOUTS)[number];

export function resolveLayoutName(requested: string | undefined): {
  name?: LayoutName;
};
```

**Revised during implementation planning:** unlike theme names, an unrecognized layout name has no clean way to surface a warning — layout markers are discovered *inside* `generateHtml`'s own marked-lexing pipeline (per slide), not up front from simple frontmatter like a theme name. Surfacing a warning here would require either changing `generateHtml`'s return type from a plain string (a real breaking change touching every existing test that calls it) or a circular import between `render.ts` and `slideLayouts.ts`. Decision: **unrecognized layout names are a silent no-op** — no CSS class is applied at all, identical to no marker being present. `resolveLayoutName` therefore has no `warning` field; unknown input simply returns `{}`.

Also exports `extractSlideLayout(tokens: Token[]): { layout?: string; tokens: Token[] }`, which scans a slide's token array for a standalone `<!-- layout: name -->` comment (after the same `HTML_COMMENT_PATTERN` unwrap `presenterNotes.ts` already uses), returning the *raw* requested name (not yet validated — callers pass it through `resolveLayoutName`) and the token array with **every** matching layout-marker comment removed. If more than one layout comment appears on a slide, the first one found wins the `layout` field, but all of them are removed from the returned tokens — this is what keeps a layout marker from ever being rendered as a presenter note (see §3.4 below), without needing any change to `presenterNotes.ts` itself.

### 3.2 New file: `src/transitions.ts`

Structured identically to `themes.ts`:

```ts
export const TRANSITIONS = ["fade", "slide"] as const;
export type TransitionName = (typeof TRANSITIONS)[number];

export function resolveTransitionName(requested: string | undefined): {
  name?: TransitionName;
  warning?: string;
};
```

### 3.3 New file: `src/presentationScript.ts`

Exports a single string constant, `PRESENTATION_SCRIPT`, containing the client-side navigation JS (kept out of `render.ts` to avoid growing its inline-script list further):

- Reads `URLSearchParams(location.search).has("present")`; no-ops entirely if absent.
- On activation: reads `location.hash` (e.g. `#3`) for the starting slide index, defaulting to slide 1 if absent/invalid; marks the current `.slide` section with an `is-active` class (removed from every other slide); renders a small "N / total" counter. **Revised during implementation planning:** an `is-active` class, not the `hidden` attribute, is what's actually toggled — `hidden` maps to `display: none`, which can't be animated, and the fade/slide transitions (§3.5) need the outgoing/incoming slide to be simultaneously in the DOM with an animatable property (`opacity`/`transform`) changing between them. `render.ts`'s always-present base CSS still uses a plain `display: none`/`block` toggle keyed off `is-active` when no transition is active; only the transition-specific CSS override switches to the animatable version.
- Listens for `ArrowRight`/`Space` (advance) and `ArrowLeft` (back) `keydown` events, and `click` on the document body **except** when the click target is or is inside an `<a>` element (so links inside slide content keep working).
- On every navigation, updates `location.hash` to the new index (survives `--watch`'s `location.reload()`, since the hash is not part of what a reload discards) and re-applies the `is-active` toggling.

### 3.4 `presenterNotes.ts` — no changes needed

**Revised during implementation planning:** the collision between a layout marker and presenter-note extraction is resolved entirely by *ordering* in `render.ts`'s per-slide loop (§3.5) — `extractSlideLayout` runs first and removes every layout-marker comment from the token array, and only the *filtered* array is ever passed to `extractNotes`. Since `extractNotes` never sees a layout-marker token in the first place, it needs no modification at all; its own matching logic (and `isPresenterNoteComment`'s) stays exactly as-is.

### 3.5 `render.ts` changes

- New `LAYOUT_STYLE` constant (alongside the existing `NOTES_STYLE`/`PRINT_PAGINATION_STYLE`) defining the 4 layouts' CSS: `title` centers content vertically with a larger first heading; `section` is a minimal big-heading divider that de-emphasizes (not hides — hiding user-written content would be editorializing) body text below the heading; `quote` centers text with the last paragraph styled as a smaller attribution line; `two-column` uses `column-count: 2` to auto-flow the slide's existing content — no new Markdown split-syntax.
- New transition CSS block, generated from the resolved `transitionName`, overriding the base `is-active` toggle (above) with an animatable version: `fade` animates `opacity`; `slide` animates a `transform: translateX(...)`. This override is suppressible by `--css`; the base `is-active` toggle itself is not (see the Global Constraints in `docs/plans/templates-transitions-implementation-plan.md` for why the split is drawn there).
- Per-slide rendering loop calls `extractSlideLayout(slideTokens)` **before** `extractNotes`, passing the returned filtered token array to both `extractNotes` and `marked.parser` (not the original `slideTokens`), and applies the resolved layout name as an additional CSS class on that slide's `<section class="slide">` wrapper (`<section class="slide layout-title">`).
- `generateHtml` gains a 5th optional positional parameter, `transitionName?: TransitionName`, continuing the existing pattern (`themeColors` was added as the 4th). `PRESENTATION_SCRIPT` is always embedded (inert without `?present`, same as the existing `?notes` script).
- Both `LAYOUT_STYLE` and the transition CSS block are omitted when `customCss` is set, matching how `themeOverride` is already omitted — `--css` replaces everything.

### 3.6 `index.ts` changes

- `--transition <name>` option added only to the `render` subcommand.
- New `computeEffectiveTransition(frontmatterTransition, flagTransition, customCss): {name?, message?}`, mirroring `computeEffectiveTheme`'s exact shape and precedence rules (flag wins over frontmatter; `--css` wins over both).
- The `--watch` rerender closure recomputes the effective transition on every debounced save (re-parsing frontmatter, same as it already does for theme colors since the PR #18 fix), discarding the message so it stays silent on rerender.
- `pdf`/`png` subcommands are untouched — no `--transition` flag, no frontmatter `transition:` read at all.

## 4. Error handling summary

- Unknown `--transition`/frontmatter `transition:` name → falls back to no transition, one-time stderr warning (same shape as the theme system's unknown-name handling; resolved up front from frontmatter, same as themes, so the warning-printing mechanism poses no problem here).
- Unknown `layout:` marker name → silent no-op, no CSS class applied, no warning (see §3.1's revision — `generateHtml` has no clean way to surface a per-slide warning without a breaking API change).
- Two conflicting layout comments on one slide → first found wins the applied name, but every matching comment is removed from the token stream regardless (matches how a `--theme`-vs-frontmatter conflict already resolves: first-applicable-wins, not an error).
- A layout-marker comment is still a valid, "already reviewed" comment for `containsUnsafeHtml`'s purposes — it does not trip the raw-HTML warning, same as a presenter note.

## 5. Testing plan

- `tests/slideLayouts.test.ts` — `resolveLayoutName`'s known/unknown(silent)/case-insensitivity behavior; `extractSlideLayout`'s comment-matching, multi-comment-first-wins behavior, and that a plain presenter note is never mistaken for a layout marker.
- `tests/transitions.test.ts` — `resolveTransitionName`'s known/unknown/case-insensitivity behavior.
- `tests/render.test.ts` — extended: each layout applies its CSS class; a slide with no layout marker renders byte-identical to today (regression guard, mirroring the theme system's own precedent); a layout-marker comment is excluded from both the rendered notes and the raw HTML output; transition CSS block presence/absence matches the resolved transition name; `--css` suppresses both layout and transition CSS.
- `tests/cli.test.ts` — extended: `--transition` flag, frontmatter `transition:` key, flag-wins-over-frontmatter precedence, `--css`-wins-over-transition, unknown-transition-name warning; `pdf`/`png` reject or ignore `--transition` (no such flag exists on those subcommands).
- `tests/presentationMode.test.ts` (new) — real, unmocked browser test via the existing `detectBrowserExecutable()` helper (same philosophy as `pdfExport.test.ts`/`pngExport.test.ts`): launches a real browser against a served `?present` URL, dispatches real `ArrowRight`/`ArrowLeft`/click `keydown`/`click` events, and asserts on DOM state (which `.slide` is visible, `location.hash` value) and that a reload preserves the current slide via the hash.

## 6. Documentation updates required (as part of implementation, not this spec)

- `AGENTS.md`'s Directory Map: add `src/slideLayouts.ts`, `src/transitions.ts`, `src/presentationScript.ts`, and the 4 new test files (`tests/slideLayouts.test.ts`, `tests/transitions.test.ts`, `tests/presentationScript.test.ts`, `tests/presentationMode.test.ts`).
- `Context.md`'s Roadmap item 11: mark done once shipped, same pattern as the theme system's own roadmap entry update.
- A new ADR documenting the presentation-mode addition (it's a genuine new subsystem, not just a config toggle) — the theme system got `docs/adr/0008-named-theme-system.md`; this would be `docs/adr/0009-...`.

## 7. Explicitly out of scope (for this spec)

- Any transition effect beyond `fade`/`slide` (e.g. zoom, 3D flip).
- Any layout beyond the 4 shipped (e.g. a full-bleed image layout, a comparison-table layout) — extensibility for user-defined layouts is not addressed here, same posture as the theme system's fixed-4-themes decision.
- An in-UI "exit presentation mode" control — leaving `?present` is a manual URL edit for v1.
- Any attempt to simulate transitions in PDF/PNG export (e.g. inserting intermediate pages) — static export ignores transitions entirely, by design.
- Touch/swipe navigation for presentation mode — keyboard and click only.
- A per-slide transition override — transitions are deck-wide only, same posture as themes.
