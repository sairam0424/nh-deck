# nh-deck — `--css-vars` Overlay Flag (Design Addendum)

**Status:** Implemented
**Date:** 2026-09-13
**Author:** Claude (implementation session), decisions attributable to @sairamugge per this session's explicit direction
**Save-location note:** follows this repo's existing `docs/specs/*-design.md` flat, topic-suffixed convention (see `docs/specs/theme-system-design.md`).

## 0. Purpose and scope

`docs/specs/theme-system-design.md` §2 recorded a deliberate decision for
`--css` itself: *"No CSS-cascade-layering complexity to design, test, or
explain"* — `--css` and a named theme are mutually exclusive, full stop, and
option 2 (cascade layering) in that spec's `--css` interaction table was
considered and rejected.

**This addendum does not reopen that decision.** `--css-vars <path>` is a
separate, narrower mechanism solving a different, previously-documented pain
point: reaching for `--css` to tweak just one color (say, the accent color)
silently drops every other piece of `!customCss`-gated CSS `generateHtml()`
emits — all 4 named layouts (`LAYOUT_STYLE`), both slide transitions
(`transitionToCssBlock`), and the presentation progress bar
(`PRESENTATION_PROGRESS_STYLE`) — because `--css` is, by design, a *full
stylesheet replacement*, not an overlay. A user who only wants a different
accent color has no way to get that without either hand-authoring an entire
replacement stylesheet (reproducing layout/transition/progress-bar CSS
themselves) or doing without those features entirely.

`--css-vars` closes that gap with the smallest possible mechanism: a raw CSS
snippet — conventionally just a `:root { --nh-accent: #...; }`-shaped
block — concatenated into the *existing* cascade, not layered as a new
concept on top of it.

## 1. Why this is not the same as "CSS-cascade layering for `--css`"

The rejected option in `theme-system-design.md` §2 was specifically about
layering a **user's arbitrary custom stylesheet** on top of a **theme**, so
individual properties from the theme could survive next to arbitrary custom
rules from `--css`. That requires deciding, testing, and documenting a
precise override order for every property the two might both touch — real
design and maintenance surface for a need `--css` already fully satisfies
("I want total control, don't touch my styling").

`--css-vars` is a different shape of feature entirely:

| | `--css` | `--css-vars` |
|---|---|---|
| Input | An arbitrary, unconstrained stylesheet | A small file limited by convention to `--nh-*` variable declarations |
| Effect | Replaces the entire `<style>` block's content | Adds one more `:root` block after the ones already there |
| Interacts with `--theme`/frontmatter `theme:` | No — mutually exclusive (existing decision, unchanged) | Yes — composes with it (that is the entire point) |
| Interacts with `LAYOUT_STYLE`/`transitionStyle`/`PRESENTATION_PROGRESS_STYLE` | No — all gated behind `!customCss`, dropped | Yes — untouched, still emitted |
| New cascade mechanism? | N/A | **No** — reuses the exact "later `:root` block, equal specificity, wins" mechanism `themeOverride` already uses to sit on top of the baseline/dark-mode `:root` blocks |

The last row is the key point: `generateHtml()` was already emitting a chain
of `:root { ... }` blocks in source order (baseline defaults, then the
`prefers-color-scheme: dark` override, then an active theme's override) and
relying on plain CSS cascade order — no `!important`, no CSS Cascade Layers
(`@layer`), no specificity trick — to let a later block win. `--css-vars`
adds exactly one more block to that same chain, immediately after
`themeOverride`. Nothing new was invented; an existing, already-shipped
pattern was extended by one more link.

## 2. Decision

| Decision | Choice | Why |
|---|---|---|
| Relationship to `--css` | **Mutually exclusive**, `--css` wins, with a one-line stderr note — mirrors `--theme`'s and `--transition`'s existing `--css` precedent exactly | A small vars overlay is meaningless layered on top of a stylesheet that has already fully replaced the block it would be layered into; `--css` already means "I'm handling styling myself," and that meaning does not change here. |
| Relationship to `--theme`/frontmatter `theme:` | **Composes** — both apply, `--css-vars` wins on the specific properties it sets (later in source) | This is the actual feature request: override one or two variables without losing the rest of a chosen theme. |
| Input shape | Raw CSS file content, concatenated verbatim (no parsing, no validation of which properties it sets) | Matches this project's existing "raw CSS passthrough" precedent for `--css` itself — nh-deck does not parse or validate a user's own CSS in either flag. A user can technically put more than `--nh-*` declarations in the file; nothing prevents it, exactly as nothing prevents a `--css` file from doing anything at all. |
| Placement in the cascade | Immediately after `themeOverride`, before the baseline `body { ... }` rule | The exact insertion point needed for "later wins over the theme, but the file's own rule order inside `--css-vars` is still respected for anything beyond `:root` too." |
| CLI surface | `--css-vars <path>` on all three subcommands (`render`, `pdf`, `png`) | Matches `--css`'s and `--theme`'s existing availability on all three — no reason for `--css-vars` to be render-only. |
| Frontmatter counterpart | **None** | Unlike `--theme`/`--transition`, there is no `theme:`-style deck-file field for this — `--css-vars` is a CLI-only, local-file-path flag, same category as `--css` itself (also CLI-only, no frontmatter equivalent). |

## 3. Architecture

### 3.1 `src/render.ts`

`generateHtml()` gains a 6th, optional parameter:

```ts
export function generateHtml(
  markdown: string,
  title?: string,
  customCss?: string,
  themeColors?: ThemeColors,
  transitionName?: TransitionName,
  cssVars?: string,
): string
```

Appended as the last parameter (rather than inserted earlier) so every
existing call site — 1 through 5 positional arguments — keeps compiling
unchanged; this mirrors how `transitionName` itself was added as the 5th
parameter in `docs/adr/0009` without disturbing the first four.

Inside the function:

```ts
const cssVarsOverride = !customCss && cssVars ? cssVars : "";
```

— gated behind `!customCss` the same way `themeOverride`/`layoutOverride`/
`transitionStyle`/`progressStyle` already are, so a direct caller that
passes both `customCss` and `cssVars` together (as a unit test can) still
gets the correct "customCss wins outright" behavior even without going
through the CLI's own mutual-exclusivity check. `cssVarsOverride` is spliced
into the default-stylesheet template immediately after `${themeOverride}`
and before the `body { ... }` rule:

```css
${themeOverride}
${cssVarsOverride}
body {
  ...
}
```

### 3.2 `src/index.ts`

A new `computeEffectiveCssVars(cssVars, customCss)` pure helper, shaped
identically to `computeEffectiveTheme`/`computeEffectiveTransition`:

```ts
function computeEffectiveCssVars(
  cssVars: string | undefined,
  customCss: string | undefined,
): { cssVars: string | undefined; message?: string }
```

Unlike those two, there is no frontmatter value to fold in and no name
registry to validate against — `--css-vars` either wasn't given (nothing to
do), or was given and there's no `--css` conflict (use it as-is), or was
given alongside `--css` (drop it, emit `nh-deck: note: --css overrides
--css-vars; it was not applied.\n`). No "unknown value, warn and fall back"
branch exists, because there is no fixed set of valid values to validate
against — the input is raw file content, not a name.

A new `--css-vars <path>` option is added to all three subcommands
(`render`, `pdf`, `png`), read via `readFileSync(options.cssVars, "utf8")` —
the exact same synchronous local-file read, with the exact same top-level
try/catch ENOENT handling, that `--css` already uses. No new trust boundary,
no new error-handling path.

For `render`'s `--watch` debounced re-render: `effectiveCssVars` is computed
once (outside the debounce, exactly like `customCss` itself) and closed over
by the rerender closure, rather than recomputed per file-change event —
because `--css-vars`, like `--css`, has no frontmatter counterpart that
could change between saves, only the fixed CLI flag value, which cannot
change without restarting the process.

## 4. Error handling summary

| Situation | Behavior |
|---|---|
| No `--css-vars` given | No effect — output identical to before this feature existed. |
| `--css-vars <path>` given, no `--css` | Content of `<path>` concatenated into the cascade after the theme override (see §3.1); composes with `--theme`/frontmatter `theme:`. |
| `--css-vars <path>` given, no `--css`, `--theme`/frontmatter `theme:` also given | Both apply; `--css-vars`'s own declarations win over the theme's on any variable both set, by cascade order. |
| `--css-vars <path>` **and** `--css <path>` both given | `--css` wins outright; `--css-vars` is not applied at all; one-line stderr note explaining why (mirrors the existing `--theme`/`--transition` vs. `--css` note format). |
| `--css-vars` points to a nonexistent file | Raw `ENOENT` surfaces via the same top-level `nh-deck: <message>` error path `--css` already uses; exits non-zero. |

## 5. Testing plan (as implemented)

- **`tests/render.test.ts`** (`generateHtml — --css-vars overlay`): a
  byte-identical-with-no-argument regression guard (mirrors the equivalent
  guard for `themeColors`/`transitionName`); the overlay's content appears,
  and appears *after* the baseline's own default `--nh-accent` declaration;
  composition with an active theme (the overlay lands after the theme's own
  `:root` block); `LAYOUT_STYLE`/`transitionStyle`/`PRESENTATION_PROGRESS_STYLE`
  all still present alongside the overlay (the exact case a full `--css`
  replacement would have dropped); mutual exclusion with `customCss`; and one
  real-browser `getComputedStyle()` assertion proving the overlay's variable
  genuinely resolves to a different computed color on a themed element, not
  just that the substring appears somewhere in the stylesheet text.
- **`tests/cli.test.ts`** (`CLI: --css-vars`): flag wiring on `render`
  (response body contains the overlay content, and the rest of the baseline
  stylesheet is still present); composition with `--theme` end-to-end
  (`render`'s served body contains both the theme's own background color and
  the overlay's accent, in the correct order); `--css`-wins mutual
  exclusivity with the stderr note (`render` and `pdf`); the `ENOENT` error
  path for a missing `--css-vars` file; and flag-wiring-plus-successful-export
  checks on both `pdf` and `png` (mirroring the existing `--theme`
  pdf/png-wiring test shape, since neither export command has an HTTP
  response body to inspect).

## 6. Explicitly out of scope

- Parsing or validating `--css-vars`' file content (which variables it sets,
  whether it sets anything beyond `--nh-*`) — same "raw passthrough, no
  validation" precedent `--css` itself already establishes.
- A frontmatter counterpart (e.g. a deck-file `css-vars:` key pointing at a
  relative path) — not requested, and would raise its own relative-path/
  trust-boundary questions `--css`'s own CLI-only precedent does not need to
  answer.
- Reopening `--css`'s own mutual exclusivity with `--theme`/frontmatter
  `theme:` — unchanged, see `docs/specs/theme-system-design.md` §2/§3.5 and
  `docs/adr/0008-named-theme-system.md`.
