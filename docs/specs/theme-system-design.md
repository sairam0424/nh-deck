# nh-deck — Named Theme System (Design Spec)

**Status:** Draft, pending user review
**Date:** 2026-09-12
**Author:** Claude (brainstorming session), decisions attributable to @sairamugge per this session's explicit direction
**Save-location note:** follows this repo's existing `docs/specs/*-design.md` flat, topic-suffixed convention (see `docs/specs/feature-implementation-roadmap-design.md`).

## 0. Purpose and scope

`Context.md`'s Roadmap item 11 ("Full theme, template, and transition system") is explicitly deferred pending its own design pass, per `SOUL.md`'s "render faithfully, don't editorialize" value. This spec covers **only the theme piece** of that item — named color/font presets a user can opt into. Templates (per-slide layouts) and transitions (live-presenting animation) are deliberately **out of scope** for this spec; they remain deferred, to be brainstormed separately if/when prioritized.

**Explicit scope authorization:** `CLAUDE.md` requires stopping and asking before any diff touching theme work. This spec is the result of exactly that stop-and-ask conversation — every architectural decision below was proposed, discussed, and explicitly approved by the user (@sairamugge) turn-by-turn in the live brainstorming session this spec is written from. That approval should be re-referenced in the PR description for the implementation that follows this spec, per `CLAUDE.md`'s decision-traceability instruction.

## 1. Constraints (unchanged, carried forward from SOUL.md)

1. **Local-first** — no CDN scripts, no telemetry, no runtime network dependency. Every theme's assets (colors, fonts) ship locally; no theme may introduce a CDN font/script reference.
2. **No forced visual theme with no opt-out** — theming is additive and opt-in (a deck with no theme specified renders exactly as it does today). This spec does not change nh-deck's default, unthemed rendering output.
3. **No silent scope expansion** — this spec covers themes only, not templates/transitions.

## 2. Decisions (from the live brainstorming session)

| Decision | Choice | Why |
|---|---|---|
| Selection mechanism | **Both**: Markdown frontmatter (`theme: dark`) as the default, `--theme <name>` CLI flag as an override | Frontmatter makes theme choice travel with the deck file (portable); the flag lets a user override without editing the file. |
| Precedence | `--theme` flag > frontmatter `theme:` > default (`light`) | Standard CLI-flag-overrides-file-setting precedence, unsurprising to any CLI user. |
| Interaction with `--css` | **Mutually exclusive — `--css` wins.** If both a theme (via flag or frontmatter) and `--css` are given, `--css` is used and the theme is not applied. | Simple mental model: `--css` means "I'm handling styling myself." No CSS-cascade-layering complexity to design, test, or explain. |
| Theme set | **Fixed, ship 4**: `light`, `dark`, `dracula`, `nord` | Matches KISS/YAGNI; no user-extensibility mechanism to design/maintain/version. |
| Theme scope | **Everything** — base deck (background/text/fonts/code blocks) + KaTeX math color + Mermaid diagram colors | Full visual consistency; a dark theme with light-colored diagrams would look broken, not polished. |
| Theme source | **Reuse `beautiful-mermaid`'s existing named palettes**, not bespoke color design | `beautiful-mermaid` (already a dependency) ships 15 proven `{bg, fg, line, accent, muted}` color palettes and its own SVG-rendering functions already accept custom colors in exactly this shape. Reusing them gives native Mermaid theming "for free" with zero new color-design work and zero fragile SVG-output post-processing. |

## 3. Architecture

### 3.1 New file: `src/frontmatter.ts`

```ts
export interface ParsedFrontmatter {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseFrontmatter(markdown: string): ParsedFrontmatter;
```

Deliberately narrow, matching the single `theme:` key this spec needs:

- Only attempts frontmatter parsing if the file's **first three characters are exactly `---`** followed by a newline.
- Scans forward for the next line that is **exactly** `---` (nothing else on the line) to find the closing delimiter.
- The content between the two delimiters must parse as flat `key: value` lines (one key-value pair per line, no nesting, no lists) for the block to be treated as frontmatter at all.
- **If either condition fails** (file doesn't start with `---`, no closing `---` found, or the content between them doesn't parse as flat `key: value`), `parseFrontmatter` returns `{ frontmatter: {}, body: markdown }` — the **entire original markdown untouched**, including any leading `---`. This guarantees a deck that happens to open with a stylistic horizontal rule (nh-deck's existing slide-separator syntax) is never misinterpreted as frontmatter, and behaves byte-identically to today.
- Unrecognized keys (anything other than `theme`) are parsed but ignored by callers — forward-compatible with future frontmatter keys, not an error.
- No YAML library dependency — flat `key: value` parsing is a few lines of string splitting, and this repo's philosophy is to avoid a new dependency without a demonstrated need beyond what hand-written code covers.

### 3.2 New file: `src/themes.ts`

```ts
export interface ThemeColors {
  bg: string;
  fg: string;
  line?: string;
  accent?: string;
  muted?: string;
}

export interface Theme {
  name: string;
  colors: ThemeColors; // passed directly to beautiful-mermaid's renderMermaidDiagram
}

export const THEMES: Record<string, Theme>; // keys: "light", "dark", "dracula", "nord"
export const DEFAULT_THEME_NAME = "light";

export function resolveThemeName(requested: string | undefined): {
  name: string;
  warning?: string; // set when `requested` was non-empty but unknown
};
```

- `THEMES`'s four entries are built from `beautiful-mermaid`'s own exported `THEMES` object (`github-light`, `github-dark`, `dracula`, `nord` keys respectively) — re-exported under nh-deck's own simpler names, not redefined.
- `resolveThemeName` lowercase-normalizes the input for case-insensitive matching (`--theme Dark` matches `dark`), and falls back to `DEFAULT_THEME_NAME` with a warning message (not a thrown error) when given an unrecognized non-empty name.

### 3.3 `render.ts` changes

The existing baseline `<style>` block (hardcoded colors) is refactored to use CSS custom properties:

```css
:root {
  --nh-bg: #FFFFFF;
  --nh-fg: #27272A;
  --nh-accent: ...;
  --nh-muted: ...;
}
body { background: var(--nh-bg); color: var(--nh-fg); }
/* ...existing rules updated to reference the same variables... */
.katex { color: var(--nh-fg); }
```

When a theme is resolved, `generateHtml` prepends a `:root { --nh-bg: <theme color>; ... }` override block **before** the baseline stylesheet, so the theme's values win via normal CSS cascade — no duplication of the full stylesheet per theme, just a small variable-override block. When `--css` is given, this entire mechanism is skipped and the custom stylesheet is used exactly as it works today.

**Critical regression-safety requirement:** the default (no theme specified) rendering output must remain **byte-identical** to today's output. The CSS-custom-properties refactor is a pure refactor of the baseline stylesheet's mechanism, not a visual change — see Testing (§5) for how this is verified.

### 3.4 `mermaidRenderer.ts` changes

```ts
export function renderMermaidDiagram(code: string, colors?: ThemeColors): string;
```

`colors`, when provided, is passed straight through to `beautiful-mermaid`'s `renderMermaidSVG(code, colors)` — no new Mermaid-specific theming logic; `beautiful-mermaid` already handles applying the given colors to its SVG output.

### 3.5 `index.ts` changes

- New `--theme <name>` option added to `render`, `pdf`, and `png` subcommands (mirroring the existing `--css <path>` option pattern).
- Before calling `generateHtml`, the CLI:
  1. Parses frontmatter from the raw markdown via `parseFrontmatter`.
  2. Determines the *requested* theme name (a raw string, not yet validated): `--theme` flag value, else frontmatter's `theme` value, else `undefined` (nothing requested).
  3. **If `--css` was also given and a theme was requested:** print a one-line stderr note — `nh-deck: note: --css overrides the requested theme '<name>'; it was not applied.` — and stop here. Theme-name validation (step 4) is skipped entirely in this case, since the name's validity is moot when it's never going to be applied. If `--css` was given and no theme was requested, nothing is printed (today's exact behavior).
  4. **Otherwise** (no `--css`, or `--css` not given at all): call `resolveThemeName` on the requested name. If it was non-empty but unknown, print the returned warning to stderr (non-fatal, falls back to `light`).
  5. Passes the resolved theme's `colors` into both `generateHtml` (for the CSS variable block) and every `renderMermaidDiagram` call reached during rendering — unless `--css` was given, in which case this step is skipped and the custom stylesheet is used exactly as it works today.
- The frontmatter-stripped `body` (not the original raw markdown) is what gets passed to `generateHtml` — the frontmatter block itself never reaches `marked`'s lexer.

## 4. Error handling summary

| Situation | Behavior |
|---|---|
| No theme requested (flag or frontmatter) | Default, unthemed rendering — byte-identical to pre-feature output. |
| Valid theme requested | Applied; base CSS vars + KaTeX color + Mermaid colors all reflect it. |
| Unknown theme name requested | Non-fatal stderr warning, falls back to `light`. Does not block rendering/export. |
| Frontmatter present but malformed | Silently falls through — file (including its leading `---`) renders exactly as if the frontmatter feature didn't exist. No warning (indistinguishable from "deck intentionally starts with a horizontal rule"). |
| Theme requested (flag or frontmatter) **and** `--css` given | `--css` wins; theme not applied; one-line stderr note explaining why. |
| `--theme` flag **and** frontmatter `theme:` both present, no `--css` | `--theme` flag wins silently (standard flag-overrides-file precedence — no note needed, this is expected/unsurprising). |

## 5. Testing plan

- **`tests/frontmatter.test.ts` (new):** valid extraction (`theme: dark` alone, and alongside unrelated keys which are ignored); malformed frontmatter (unclosed `---`, non-key-value content) falls through with body unchanged; a file with no leading `---` is untouched; a file whose first line is `---` but is actually an intentional horizontal rule (no valid key:value block follows) falls through correctly.
- **`tests/themes.test.ts` (new):** `resolveThemeName` for all 4 valid names, case-insensitivity (`Dark` → `dark`), unknown name returns the warning + falls back to `light`, `undefined` input returns default with no warning.
- **`tests/render.test.ts` (extended):** a **regression test asserting `generateHtml`'s output with no theme argument is byte-identical to the pre-refactor baseline** (the single most important test in this spec, given it's the only guard against the CSS-custom-properties refactor silently changing default rendering). Additional cases: each theme's CSS var block appears in output when requested; `.katex` color rule references the CSS variable.
- **`tests/mermaidRenderer.test.ts` (extended):** a rendered diagram's SVG output actually contains a theme's specific color value when colors are passed — proving the threading reaches `beautiful-mermaid`'s render call, not just that the code compiles.
- **`tests/cli.test.ts` (extended):** `--theme dark` end-to-end produces dark-theme output; frontmatter-only `theme: dracula` (no flag) produces dracula output; `--theme` flag overrides a conflicting frontmatter value; `--css` + a requested theme produces the note on stderr and `--css`'s content, not the theme's; unknown `--theme <bogus>` warns and falls back.

## 6. Documentation updates required (as part of implementation, not this spec)

- `README.md` — new "Themes" section under Usage; remove the theme/template/transition system line from "Current limitations" (partially — templates/transitions remain listed, themes no longer does).
- `AGENTS.md` — Directory Map entries for the 2 new files; Known Gotchas note if anything theme-specific proves gotcha-worthy during implementation.
- `Context.md` — strike through Roadmap item 11's theme portion (or split item 11 into "themes: done" + "templates/transitions: still deferred" if the roadmap format wants that granularity — implementer's call, consistent with how other split items have been handled).
- A new ADR (`docs/adr/0008-*.md`, following the existing Nygard-format precedent) documenting the "reuse beautiful-mermaid's palettes" decision and the frontmatter/slide-separator collision resolution — both are exactly the kind of non-obvious architectural choice this repo's ADR convention exists to capture.

## 7. Explicitly out of scope (for this spec)

- Templates (per-slide layout selection) and transitions (live-presenting animation) — Roadmap item 11's other two components, deferred separately.
- User-extensible/custom-registered themes beyond the fixed 4 — `--css` already covers "I want full custom control."
- Any additional `beautiful-mermaid` palette beyond the 4 chosen (`light`/`dark`/`dracula`/`nord`) — can be added later as a small, low-risk follow-up if requested, since the registry pattern in §3.2 supports it trivially.
