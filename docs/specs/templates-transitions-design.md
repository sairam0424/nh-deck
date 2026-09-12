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
  warning?: string;
};
```

Unknown requested name → `{name: undefined, warning: "..."}`, same fallback+warning shape as `resolveThemeName`.

Also exports `isLayoutMarkerComment(text: string): boolean` and `extractSlideLayout(tokens: Token[]): { layout?: string; tokens: Token[] }` — the latter scans a slide's token array for the first `html`-type token matching `/^layout:\s*(\S+)/` (after the shared `HTML_COMMENT_PATTERN` unwrap already defined in `presenterNotes.ts`), returning the extracted name and the token array with that comment token removed. If more than one layout comment appears on a slide, the first one found wins; the rest are ignored silently.

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
- On activation: reads `location.hash` (e.g. `#3`) for the starting slide index, defaulting to slide 1 if absent/invalid; hides every `.slide` section except the current one via the `hidden` attribute; renders a small "N / total" counter.
- Listens for `ArrowRight`/`Space` (advance) and `ArrowLeft` (back) `keydown` events, and `click` on the document body **except** when the click target is or is inside an `<a>` element (so links inside slide content keep working).
- On every navigation, updates `location.hash` to the new index (survives `--watch`'s `location.reload()`, since the hash is not part of what a reload discards) and re-applies the `hidden` toggling.

### 3.4 `presenterNotes.ts` changes

`extractNotes` gains a one-line exclusion: any comment token recognized by the new `isLayoutMarkerComment` (from `slideLayouts.ts`) is skipped, so a `<!-- layout: title -->` marker is never also swept up and rendered as a presenter note. `isPresenterNoteComment`'s own matching is unchanged — it still recognizes the layout-marker comment as a comment (needed for the existing `containsUnsafeHtml` exemption), it just isn't also treated as note *content*.

### 3.5 `render.ts` changes

- New `LAYOUT_STYLE` constant (alongside the existing `NOTES_STYLE`/`PRINT_PAGINATION_STYLE`) defining the 4 layouts' CSS: `title` centers content vertically with a larger first heading; `section` is a minimal big-heading divider; `quote` centers text with the last paragraph styled as a smaller attribution line; `two-column` uses `column-count: 2` to auto-flow the slide's existing content — no new Markdown split-syntax.
- New transition CSS block, generated from the resolved `transitionName`: `fade` animates `opacity` on the `hidden`-attribute toggle presentation mode already does; `slide` animates a `transform: translateX(...)`.
- Per-slide rendering loop calls `extractSlideLayout` before `extractNotes`, applying the resolved layout name as an additional CSS class on that slide's `<section class="slide">` wrapper (`<section class="slide layout-title">`).
- `generateHtml` gains a 5th optional positional parameter, `transitionName?: TransitionName`, continuing the existing pattern (`themeColors` was added as the 4th). `PRESENTATION_SCRIPT` is always embedded (inert without `?present`, same as the existing `?notes` script).
- Both `LAYOUT_STYLE` and the transition CSS block are omitted when `customCss` is set, matching how `themeOverride` is already omitted — `--css` replaces everything.

### 3.6 `index.ts` changes

- `--transition <name>` option added only to the `render` subcommand.
- New `computeEffectiveTransition(frontmatterTransition, flagTransition, customCss): {name?, message?}`, mirroring `computeEffectiveTheme`'s exact shape and precedence rules (flag wins over frontmatter; `--css` wins over both).
- The `--watch` rerender closure recomputes the effective transition on every debounced save (re-parsing frontmatter, same as it already does for theme colors since the PR #18 fix), discarding the message so it stays silent on rerender.
- `pdf`/`png` subcommands are untouched — no `--transition` flag, no frontmatter `transition:` read at all.

## 4. Error handling summary

- Unknown `--transition`/frontmatter `transition:` name → falls back to no transition, one-time stderr warning (same shape as the theme system's unknown-name handling).
- Unknown `layout:` marker name → falls back to no layout, one-time stderr warning, same pattern.
- Two conflicting layout comments on one slide → first found wins, rest silently ignored (matches how a `--theme`-vs-frontmatter conflict already resolves: first-applicable-wins, not an error).
- A layout-marker comment is still a valid, "already reviewed" comment for `containsUnsafeHtml`'s purposes — it does not trip the raw-HTML warning, same as a presenter note.

## 5. Testing plan

- `tests/slideLayouts.test.ts` — `resolveLayoutName`'s known/unknown/case-insensitivity behavior; `extractSlideLayout`'s comment-matching and multi-comment-first-wins behavior.
- `tests/transitions.test.ts` — `resolveTransitionName`'s known/unknown/case-insensitivity behavior.
- `tests/presenterNotes.test.ts` — extended: a layout-marker comment is excluded from `extractNotes`'s output but still recognized by `isPresenterNoteComment`.
- `tests/render.test.ts` — extended: each layout applies its CSS class; a slide with no layout marker renders byte-identical to today (regression guard, mirroring the theme system's own precedent); transition CSS block presence/absence matches the resolved transition name; `--css` suppresses both layout and transition CSS.
- `tests/cli.test.ts` — extended: `--transition` flag, frontmatter `transition:` key, flag-wins-over-frontmatter precedence, `--css`-wins-over-transition, unknown-transition-name warning; `pdf`/`png` reject or ignore `--transition` (no such flag exists on those subcommands).
- `tests/presentationMode.test.ts` (new) — real, unmocked browser test via the existing `detectBrowserExecutable()` helper (same philosophy as `pdfExport.test.ts`/`pngExport.test.ts`): launches a real browser against a served `?present` URL, dispatches real `ArrowRight`/`ArrowLeft`/click `keydown`/`click` events, and asserts on DOM state (which `.slide` is visible, `location.hash` value) and that a reload preserves the current slide via the hash.

## 6. Documentation updates required (as part of implementation, not this spec)

- `AGENTS.md`'s Directory Map: add `src/slideLayouts.ts`, `src/transitions.ts`, `src/presentationScript.ts`, and the 3 new test files.
- `Context.md`'s Roadmap item 11: mark done once shipped, same pattern as the theme system's own roadmap entry update.
- A new ADR documenting the presentation-mode addition (it's a genuine new subsystem, not just a config toggle) — the theme system got `docs/adr/0008-named-theme-system.md`; this would be `docs/adr/0009-...`.

## 7. Explicitly out of scope (for this spec)

- Any transition effect beyond `fade`/`slide` (e.g. zoom, 3D flip).
- Any layout beyond the 4 shipped (e.g. a full-bleed image layout, a comparison-table layout) — extensibility for user-defined layouts is not addressed here, same posture as the theme system's fixed-4-themes decision.
- An in-UI "exit presentation mode" control — leaving `?present` is a manual URL edit for v1.
- Any attempt to simulate transitions in PDF/PNG export (e.g. inserting intermediate pages) — static export ignores transitions entirely, by design.
- Touch/swipe navigation for presentation mode — keyboard and click only.
- A per-slide transition override — transitions are deck-wide only, same posture as themes.
