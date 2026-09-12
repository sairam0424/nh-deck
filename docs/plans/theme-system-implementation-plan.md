# Named Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give nh-deck 4 fixed, named color themes (`light`, `dark`, `dracula`, `nord`), selectable via Markdown frontmatter (`theme: dark`) or a `--theme <name>` CLI flag, applied consistently across the base deck, KaTeX math, and Mermaid diagrams.

**Architecture:** Two new small, dependency-free modules (`src/frontmatter.ts`, `src/themes.ts`) feed a refactor of `render.ts`'s baseline stylesheet from hardcoded colors to CSS custom properties, plus an optional colors parameter threaded through `mermaidRenderer.ts` to `beautiful-mermaid`'s existing theming support. `index.ts` wires flag/frontmatter precedence and `--css` mutual exclusivity.

**Tech Stack:** No new runtime dependencies. Reuses `beautiful-mermaid` (already a dependency) for its built-in named color palettes.

**Spec:** `docs/specs/theme-system-design.md` — every decision below traces to that spec, which was proposed and explicitly approved section-by-section in a live brainstorming session per `CLAUDE.md`'s stop-and-ask gate for theme work.

## Global Constraints

- **Local-first, no exceptions** — no theme may introduce a CDN reference; all 4 themes' colors are plain hex strings compiled into the JS bundle, never fetched.
- **No forced visual theme with no opt-out** — a deck with no theme requested (no `--theme`, no frontmatter `theme:`) must render **byte-identical** output to today's pre-feature `generateHtml`. This is verified by a dedicated regression test in Task 3, written and passing *before* any refactor, and re-verified passing *after*.
- **`--css` always wins over any theme** — mutually exclusive, no CSS-cascade layering.
- **No silent scope expansion** — templates and transitions (the other two pieces of `Context.md` Roadmap item 11) are explicitly out of scope; do not add them opportunistically.
- **Fixed theme set only** — exactly `light`, `dark`, `dracula`, `nord`. Do not add a 5th theme or a custom-theme-registration mechanism as part of this plan.
- **Tab indentation** (biome.json's mandate) — a PostToolUse hook in some environments reformats edited files to 2-space; if you hit this, run `npx biome format --write <file>` via Bash afterward (does not retrigger the hook) before committing.

## Pre-flight conflict scan

| Pair / Task | Shared file / interface | Finding |
|---|---|---|
| Task 2 ↔ Task 3 ↔ Task 4 | `Theme`/`ThemeColors` types (defined in Task 2) | Tasks 3 and 4 both import these types from `src/themes.ts` but never edit that file themselves. Task 2 must complete first. |
| Task 1 ↔ Task 5 | `src/index.ts` | Task 5 is the only task that edits `index.ts`; Task 1 only creates `src/frontmatter.ts`. No overlap, but Task 5 consumes Task 1's `parseFrontmatter`. |
| Task 3 ↔ Task 5 | `src/render.ts`'s `generateHtml` signature | Task 3 changes the signature (adds a theme colors parameter); Task 5 is the only caller (in `src/index.ts`) that needs updating to pass it. Task 3 must complete first. |
| Task 3 ↔ Task 6 | `tests/render.test.ts` | Task 3 adds the byte-identical regression test and per-theme CSS var tests directly as part of its own step 1/4 (TDD cycle). Task 6 only touches `tests/cli.test.ts`, `tests/mermaidRenderer.test.ts`. No file overlap. |
| Task 4 ↔ Task 5 | `src/mermaidRenderer.ts`'s `renderMermaidDiagram` signature | Task 4 adds an optional colors parameter; Task 5's `index.ts` doesn't call `renderMermaidDiagram` directly (it's called from within `render.ts`'s `generateHtml`), so Task 3 is the actual caller that needs updating, not Task 5. Task 4 must complete before Task 3's final integration step. |
| Task 7 | `README.md`, `AGENTS.md`, `Context.md`, new ADR | Docs-only, no code overlap with any other task. Must run last since it documents the actually-shipped behavior, not aspirational behavior. |

**Ordering implication:** Task 4 (Mermaid colors) must complete before Task 3's last step (integration), even though Task 3 is numbered before Task 4 in most of this plan's prose — **execute Task 4 before Task 3's final step**, or reorder to do Task 4 immediately after Task 2. To avoid confusion, the numbered order below is: **1, 2, 4, 3, 5, 6, 7** (Task numbers stay as labeled for cross-referencing; execute in that sequence).

No other conflicts found.

---

### Task 1: Frontmatter parser

**Files:**
- Create: `src/frontmatter.ts`
- Test: `tests/frontmatter.test.ts`

**Interfaces:**
- Produces: `ParsedFrontmatter` interface and `parseFrontmatter(markdown: string): ParsedFrontmatter` — used by Task 5's `index.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/frontmatter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/frontmatter.js";

describe("parseFrontmatter", () => {
	it("extracts a single key: value frontmatter block", () => {
		const markdown = "---\ntheme: dark\n---\n# Slide one\n";
		const result = parseFrontmatter(markdown);

		expect(result.frontmatter).toEqual({ theme: "dark" });
		expect(result.body).toBe("# Slide one\n");
	});

	it("extracts frontmatter with multiple keys, ignoring unrecognized ones", () => {
		const markdown =
			"---\ntheme: nord\nauthor: someone\n---\n# Slide one\n";
		const result = parseFrontmatter(markdown);

		expect(result.frontmatter).toEqual({
			theme: "nord",
			author: "someone",
		});
		expect(result.body).toBe("# Slide one\n");
	});

	it("returns the whole markdown untouched when there is no leading ---", () => {
		const markdown = "# Slide one\n\n---\n\n# Slide two\n";
		const result = parseFrontmatter(markdown);

		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe(markdown);
	});

	it("returns the whole markdown untouched when the leading --- has no closing ---", () => {
		const markdown = "---\ntheme: dark\n# Slide one (no closing delimiter)\n";
		const result = parseFrontmatter(markdown);

		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe(markdown);
	});

	it("returns the whole markdown untouched when the block doesn't parse as flat key: value lines", () => {
		// A deck that intentionally opens with a horizontal rule, followed by
		// a slide whose content happens to also contain a bare "---" line --
		// must not be misread as frontmatter just because it starts with ---.
		const markdown = "---\nThis is just slide content, not frontmatter.\n---\n# Slide two\n";
		const result = parseFrontmatter(markdown);

		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe(markdown);
	});

	it("returns the whole markdown untouched for an empty file", () => {
		const result = parseFrontmatter("");

		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe("");
	});

	it("trims whitespace around keys and values", () => {
		const markdown = "---\n  theme :  dark  \n---\nbody\n";
		const result = parseFrontmatter(markdown);

		expect(result.frontmatter).toEqual({ theme: "dark" });
		expect(result.body).toBe("body\n");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/frontmatter.test.ts`
Expected: FAIL — `Cannot find module '../src/frontmatter.js'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/frontmatter.ts`:

```ts
const KEY_VALUE_LINE_PATTERN = /^([^:\n]+):(.*)$/;

/**
 * Splits `markdown` into a frontmatter object and the remaining body, using
 * a deliberately narrow rule: only recognized as frontmatter if the file
 * starts with a line that is exactly "---", a closing line that is exactly
 * "---" exists somewhere after it, AND every non-blank line between them
 * parses as a flat "key: value" pair (no nesting, no lists -- this project
 * has no YAML dependency and doesn't need one for a single "theme" key).
 *
 * If any of those conditions fail, the ENTIRE original markdown is returned
 * untouched as `body`, with an empty `frontmatter` object. This is
 * deliberate: nh-deck's slide-separator convention also uses a bare "---"
 * line, so a deck that opens with a stylistic horizontal rule (with no
 * real frontmatter intent) must render exactly as it would without this
 * feature -- never partially consumed as if it were a failed frontmatter
 * block.
 */
export interface ParsedFrontmatter {
	frontmatter: Record<string, string>;
	body: string;
}

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
	const lines = markdown.split("\n");
	if (lines[0] !== "---") {
		return { frontmatter: {}, body: markdown };
	}

	const closingIndex = lines.indexOf("---", 1);
	if (closingIndex === -1) {
		return { frontmatter: {}, body: markdown };
	}

	const frontmatter: Record<string, string> = {};
	for (const line of lines.slice(1, closingIndex)) {
		if (line.trim().length === 0) {
			continue;
		}
		const match = line.match(KEY_VALUE_LINE_PATTERN);
		if (!match) {
			// A non-key:value, non-blank line inside the block means this isn't
			// really frontmatter -- bail out and treat the whole file as-is.
			return { frontmatter: {}, body: markdown };
		}
		frontmatter[match[1].trim()] = match[2].trim();
	}

	const body = lines.slice(closingIndex + 1).join("\n");
	return { frontmatter, body };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/frontmatter.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Format, lint, typecheck**

Run: `npx biome format --write src/frontmatter.ts tests/frontmatter.test.ts && npm run lint && npm run typecheck`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/frontmatter.ts tests/frontmatter.test.ts
git commit -m "feat(frontmatter): add minimal theme: key frontmatter parser"
```

---

### Task 2: Theme registry

**Files:**
- Create: `src/themes.ts`
- Test: `tests/themes.test.ts`

**Interfaces:**
- Produces: `ThemeColors` type, `Theme` type, `THEMES: Record<string, Theme>`, `DEFAULT_THEME_NAME`, `resolveThemeName(requested: string | undefined): { name: string; warning?: string }` — used by Task 3, Task 4, and Task 5.
- Consumes: `beautiful-mermaid`'s exported `THEMES` object (already a dependency, no `package.json` change needed).

- [ ] **Step 1: Confirm the exact upstream color values (do not guess)**

Run: `node -e "console.log(JSON.stringify(require('beautiful-mermaid').THEMES['github-light'], null, 2))"` (and repeat for `github-dark`, `dracula`, `nord`) to confirm the exact hex values before hardcoding them in Step 3 below. As of `beautiful-mermaid@1.1.3` these are:

```json
"github-light": { "bg": "#ffffff", "fg": "#1f2328", "line": "#d1d9e0", "accent": "#0969da", "muted": "#59636e" }
"github-dark":  { "bg": "#0d1117", "fg": "#e6edf3", "line": "#3d444d", "accent": "#4493f8", "muted": "#9198a1" }
"dracula":      { "bg": "#282a36", "fg": "#f8f8f2", "line": "#6272a4", "accent": "#bd93f9", "muted": "#6272a4" }
"nord":         { "bg": "#2e3440", "fg": "#d8dee9", "line": "#4c566a", "accent": "#88c0d0", "muted": "#616e88" }
```

If the installed version's values differ from the above (check `npm ls beautiful-mermaid`), use the actually-installed values, not this plan's copy -- and note the discrepancy in your task report.

- [ ] **Step 2: Write the failing tests**

Create `tests/themes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_NAME, resolveThemeName, THEMES } from "../src/themes.js";

describe("THEMES", () => {
	it("has exactly the 4 fixed theme names", () => {
		expect(Object.keys(THEMES).sort()).toEqual([
			"dark",
			"dracula",
			"light",
			"nord",
		]);
	});

	it("gives every theme a bg and fg color", () => {
		for (const theme of Object.values(THEMES)) {
			expect(theme.colors.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
			expect(theme.colors.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
		}
	});
});

describe("resolveThemeName", () => {
	it("resolves a valid theme name with no warning", () => {
		const result = resolveThemeName("dark");
		expect(result).toEqual({ name: "dark" });
	});

	it("is case-insensitive", () => {
		const result = resolveThemeName("Dark");
		expect(result.name).toBe("dark");
		expect(result.warning).toBeUndefined();
	});

	it("falls back to the default theme with a warning for an unknown name", () => {
		const result = resolveThemeName("nonexistent-theme");
		expect(result.name).toBe(DEFAULT_THEME_NAME);
		expect(result.warning).toMatch(/unknown theme/i);
		expect(result.warning).toContain("nonexistent-theme");
	});

	it("returns the default with no warning when nothing was requested", () => {
		const result = resolveThemeName(undefined);
		expect(result).toEqual({ name: DEFAULT_THEME_NAME });
	});
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/themes.test.ts`
Expected: FAIL — `Cannot find module '../src/themes.js'`.

- [ ] **Step 4: Write the implementation**

Create `src/themes.ts` (using the values confirmed in Step 1):

```ts
import { THEMES as MERMAID_THEMES } from "beautiful-mermaid";

export interface ThemeColors {
	bg: string;
	fg: string;
	line?: string;
	accent?: string;
	muted?: string;
}

export interface Theme {
	name: string;
	colors: ThemeColors;
}

export const DEFAULT_THEME_NAME = "light";

/**
 * nh-deck's 4 fixed named themes, each a thin re-export of one of
 * beautiful-mermaid's own built-in color palettes (already a dependency,
 * used for Mermaid diagram rendering) rather than a bespoke palette --
 * see docs/specs/theme-system-design.md §2 for why. Do not add a 5th theme
 * or a custom-theme-registration mechanism without a new design pass;
 * see that same spec's §7 (out of scope).
 */
export const THEMES: Record<string, Theme> = {
	light: { name: "light", colors: MERMAID_THEMES["github-light"] },
	dark: { name: "dark", colors: MERMAID_THEMES["github-dark"] },
	dracula: { name: "dracula", colors: MERMAID_THEMES.dracula },
	nord: { name: "nord", colors: MERMAID_THEMES.nord },
};

/**
 * Validates a requested theme name (case-insensitive) against the fixed
 * set above. An unrecognized non-empty name falls back to
 * DEFAULT_THEME_NAME with a warning message for the caller to print
 * (non-fatal -- never throws). `undefined`/empty input silently resolves
 * to the default with no warning, since "nothing was requested" is not
 * an error.
 */
export function resolveThemeName(requested: string | undefined): {
	name: string;
	warning?: string;
} {
	if (!requested || requested.trim().length === 0) {
		return { name: DEFAULT_THEME_NAME };
	}
	const normalized = requested.trim().toLowerCase();
	if (normalized in THEMES) {
		return { name: normalized };
	}
	return {
		name: DEFAULT_THEME_NAME,
		warning: `nh-deck: warning: unknown theme '${requested}', using default theme '${DEFAULT_THEME_NAME}'. Valid themes: ${Object.keys(THEMES).join(", ")}.`,
	};
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/themes.test.ts`
Expected: PASS (6/6).

- [ ] **Step 6: Format, lint, typecheck**

Run: `npx biome format --write src/themes.ts tests/themes.test.ts && npm run lint && npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add src/themes.ts tests/themes.test.ts
git commit -m "feat(themes): add fixed 4-theme registry reusing beautiful-mermaid palettes"
```

---

### Task 4: Mermaid color threading

*(Numbered 4 to match the spec's component numbering; execute after Task 2, before Task 3's final step -- see Pre-flight conflict scan.)*

**Files:**
- Modify: `src/mermaidRenderer.ts`
- Test: `tests/mermaidRenderer.test.ts`

**Interfaces:**
- Consumes: `ThemeColors` from `src/themes.ts` (Task 2).
- Produces: `renderMermaidDiagram(code: string, colors?: ThemeColors): string` (3rd argument added, backward-compatible).

- [ ] **Step 1: Read the current file and current test file in full**

Read `src/mermaidRenderer.ts` and `tests/mermaidRenderer.test.ts` before editing -- confirm the exact current signature and existing test style so this change is additive, not a rewrite.

- [ ] **Step 2: Write the failing test**

Add to `tests/mermaidRenderer.test.ts` (append a new `it` inside the existing `describe("renderMermaidDiagram", ...)` block, or add a new describe block if the file doesn't already have one wrapping the same subject -- match whatever the existing file's structure is):

```ts
it("threads custom colors through to beautiful-mermaid's rendering", () => {
	const withoutColors = renderMermaidDiagram("flowchart TD\n  A --> B");
	const withColors = renderMermaidDiagram("flowchart TD\n  A --> B", {
		bg: "#2e3440",
		fg: "#d8dee9",
		line: "#4c566a",
		accent: "#88c0d0",
		muted: "#616e88",
	});

	expect(withColors).not.toBe(withoutColors);
	expect(withColors).toContain("#2e3440");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/mermaidRenderer.test.ts`
Expected: FAIL — TypeScript error (3rd argument not accepted) or the two outputs being identical.

- [ ] **Step 4: Write the implementation**

Modify `src/mermaidRenderer.ts`'s function signature and call:

```ts
import { renderMermaidSVG } from "beautiful-mermaid";
import { escapeHtml } from "./htmlEscape.js";
import type { ThemeColors } from "./themes.js";

const CSS_IMPORT_PATTERN = /@import url\([^)]*\);?\s*/g;

/**
 * Renders Mermaid diagram source to an embeddable SVG string, or a visible
 * escaped error box if the source is invalid.
 *
 * `colors`, when provided, is passed straight through to beautiful-mermaid's
 * own renderMermaidSVG -- it already supports custom {bg, fg, line, accent,
 * muted} colors natively (see docs/specs/theme-system-design.md §2), so no
 * new Mermaid-specific theming logic is needed here beyond forwarding the
 * parameter.
 *
 * beautiful-mermaid's own generated CSS contains an unconditional Google
 * Fonts @import -- a real external CDN fetch, verified directly against its
 * own source, not a namespace-identifier false positive like an SVG's
 * xmlns. Stripped here; the library's own font-family rule already falls
 * back to 'system-ui, sans-serif', so this degrades gracefully with no
 * other change needed.
 *
 * beautiful-mermaid has no throwOnError-style option (unlike KaTeX) -- it
 * throws a plain Error for invalid syntax. This is nh-deck's own
 * equivalent: one malformed diagram must not crash the whole render.
 */
export function renderMermaidDiagram(code: string, colors?: ThemeColors): string {
	try {
		const svg = renderMermaidSVG(code, colors);
		return svg.replace(CSS_IMPORT_PATTERN, "");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `<pre class="mermaid-error">Mermaid diagram error: ${escapeHtml(message)}</pre>`;
	}
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/mermaidRenderer.test.ts`
Expected: PASS (all tests, including the new one).

- [ ] **Step 6: Format, lint, typecheck**

Run: `npx biome format --write src/mermaidRenderer.ts tests/mermaidRenderer.test.ts && npm run lint && npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add src/mermaidRenderer.ts tests/mermaidRenderer.test.ts
git commit -m "feat(mermaid): accept optional theme colors, forwarded to beautiful-mermaid"
```

---

### Task 3: CSS custom-properties refactor + theme application in `render.ts`

*(The highest-risk task in this plan -- it touches previously-stable, well-tested rendering code. Do not skip Step 1.)*

**Files:**
- Modify: `src/render.ts`
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: `Theme`/`ThemeColors`/`THEMES` from `src/themes.ts` (Task 2); the updated `renderMermaidDiagram(code, colors?)` from Task 4.
- Produces: `generateHtml(markdown: string, title?: string, customCss?: string, themeColors?: ThemeColors): string` (4th parameter added, backward-compatible).

- [ ] **Step 1: Write the byte-identical regression test FIRST, against the CURRENT (pre-refactor) code**

Read the current `src/render.ts` and `tests/render.test.ts` in full before touching anything. Add this test to `tests/render.test.ts` (inside the existing `describe("generateHtml", ...)` block) and run it against the **unmodified** current code to confirm it passes as a baseline -- this is a characterization test, not a red/green TDD test; it must be green both before and after the refactor:

```ts
it("produces byte-identical output with no theme argument (regression guard for the CSS custom-properties refactor)", () => {
	const withoutTheme = generateHtml(fixtureMarkdown, "sample");
	const withUndefinedTheme = generateHtml(fixtureMarkdown, "sample", undefined, undefined);

	expect(withUndefinedTheme).toBe(withoutTheme);
	// Baseline hardcoded colors from the pre-refactor stylesheet must still
	// appear literally in the default (no-theme) output.
	expect(withoutTheme).toContain("#1a1a1a");
	expect(withoutTheme).toContain("#ffffff");
	expect(withoutTheme).toContain("@media (prefers-color-scheme: dark)");
	expect(withoutTheme).toContain("#e6e6e6");
	expect(withoutTheme).toContain("#121212");
});
```

Run: `npx vitest run tests/render.test.ts -t "byte-identical"`
Expected: PASS immediately (this asserts today's existing behavior, before any change) -- if this fails before you've changed anything, stop and re-read the current file; something about the assumed baseline is wrong.

- [ ] **Step 2: Write the additional failing tests for the new theme behavior**

Add to `tests/render.test.ts`:

```ts
it("applies a theme's colors as CSS custom properties when one is given", () => {
	const html = generateHtml(fixtureMarkdown, "sample", undefined, {
		bg: "#2e3440",
		fg: "#d8dee9",
		line: "#4c566a",
		accent: "#88c0d0",
		muted: "#616e88",
	});

	expect(html).toContain("--nh-bg: #2e3440");
	expect(html).toContain("--nh-fg: #d8dee9");
});

it("gives .katex text a color tied to the active theme's foreground variable", () => {
	const html = generateHtml(fixtureMarkdown, "sample");
	expect(html).toMatch(/\.katex\s*\{[^}]*color:\s*var\(--nh-fg\)/);
});

it("ignores a theme when customCss is also given", () => {
	const html = generateHtml(fixtureMarkdown, "sample", "body { color: purple; }", {
		bg: "#2e3440",
		fg: "#d8dee9",
	});

	expect(html).toContain("body { color: purple; }");
	expect(html).not.toContain("--nh-bg: #2e3440");
});
```

Run: `npx vitest run tests/render.test.ts`
Expected: the 2 new theme tests FAIL (feature doesn't exist yet); the byte-identical test from Step 1 still PASSES.

- [ ] **Step 3: Refactor the baseline stylesheet to CSS custom properties, then apply an optional theme override**

Modify `src/render.ts`. The baseline `<style>` block's default-branch content (currently: hardcoded `body { color: #1a1a1a; background: #ffffff; }` plus a separate `@media (prefers-color-scheme: dark) { body { color: #e6e6e6; ... } }` block that sets properties directly) is restructured so that:

1. Every color the existing baseline stylesheet uses becomes a `:root`-level CSS custom property (`--nh-bg`, `--nh-fg`, `--nh-border`, `--nh-muted`, `--nh-code-bg`, `--nh-accent`), with the SAME literal hex values as today.
2. The existing `@media (prefers-color-scheme: dark)` block is rewritten to override those SAME variables at `:root` (not set `body`'s properties directly) -- computed styles stay byte-identical for the no-theme case, since a variable override cascades exactly the same as the current direct-property override did.
3. When a theme is active, an *additional*, unconditional `:root { --nh-bg: ...; }` block (no media query) is emitted **after** the auto/dark-mode block above -- CSS's "later rule at equal specificity wins" means the theme's fixed values win over the OS-preference-conditional default regardless of the user's OS setting, with no `!important` needed.
4. `.katex { color: var(--nh-fg); }` is added as a new rule (KaTeX's own embedded stylesheet, per ADR 0004, never hardcodes text color -- only glyph shapes are embedded as base64 -- so this is a plain, safe CSS addition).

```ts
import type { Token, Tokens } from "marked";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import { escapeHtml } from "./htmlEscape.js";
import { getEmbeddedKatexCss } from "./katexAssets.js";
import { renderMermaidDiagram } from "./mermaidRenderer.js";
import { extractNotes, isPresenterNoteComment } from "./presenterNotes.js";
import type { ThemeColors } from "./themes.js";

const NOTES_STYLE = `
    .notes {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #fffbe6;
      border-top: 2px solid #e0c46c;
      padding: 1rem 1.5rem;
      max-height: 30vh;
      overflow-y: auto;
    }
    .notes:not([hidden]) {
      display: block;
    }
    @media print {
      .notes {
        display: none !important;
      }
    }`;

const PRINT_PAGINATION_STYLE = `
    @media print {
      .slide {
        break-after: page;
      }
    }`;

/**
 * Maps a theme's {bg, fg, line, accent, muted} onto nh-deck's own CSS
 * custom-property names, with fallback chains for themes that omit some
 * fields (all 4 shipped themes define every field today, but the registry
 * in themes.ts is designed to allow a future theme with fewer fields --
 * see docs/specs/theme-system-design.md §7).
 */
function themeToCssVarBlock(colors: ThemeColors): string {
	const border = colors.line ?? colors.muted ?? colors.fg;
	const muted = colors.muted ?? colors.line ?? colors.fg;
	const codeBg = colors.muted ?? colors.line ?? colors.bg;
	const accent = colors.accent ?? colors.fg;
	return `
    :root {
      --nh-bg: ${colors.bg};
      --nh-fg: ${colors.fg};
      --nh-border: ${border};
      --nh-muted: ${muted};
      --nh-code-bg: ${codeBg};
      --nh-accent: ${accent};
    }`;
}

marked.use(markedKatex({ throwOnError: false }));

marked.use({
	useNewRenderer: true,
	renderer: {
		code({ text, lang, escaped }: Tokens.Code): string {
			const langString = (lang ?? "").match(/^\S*/)?.[0];

			if (langString === "mermaid") {
				return renderMermaidDiagram(text);
			}

			const code = `${text.replace(/\n$/, "")}\n`;
			if (!langString) {
				return `<pre><code>${escaped ? code : escapeHtml(code)}</code></pre>\n`;
			}
			return `<pre><code class="language-${escapeHtml(langString)}">${escaped ? code : escapeHtml(code)}</code></pre>\n`;
		},
	},
});

export function generateHtml(
	markdown: string,
	title?: string,
	customCss?: string,
	themeColors?: ThemeColors,
): string {
	const tokens = marked.lexer(markdown);
	const slidesHtml = splitIntoSlides(tokens)
		.map((slideTokens) => {
			const notesHtml = extractNotes(slideTokens)
				.map(
					(note) => `<aside class="notes" hidden>${escapeHtml(note)}</aside>`,
				)
				.join("\n");
			return `<section class="slide">\n${marked.parser(slideTokens)}${notesHtml}</section>`;
		})
		.join("\n");
	const pageTitle = escapeHtml(
		title && title.trim().length > 0 ? title : "nh-deck",
	);
	const katexStyle = slidesHtml.includes('class="katex"')
		? getEmbeddedKatexCss()
		: "";
	const themeOverride =
		!customCss && themeColors ? themeToCssVarBlock(themeColors) : "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle}</title>
  <style>
${
	customCss ??
	`    :root {
      color-scheme: light dark;
      --nh-bg: #ffffff;
      --nh-fg: #1a1a1a;
      --nh-border: #e0e0e0;
      --nh-muted: #555555;
      --nh-code-bg: #f2f2f2;
      --nh-accent: #0b5fff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --nh-bg: #121212;
        --nh-fg: #e6e6e6;
        --nh-border: #333333;
        --nh-muted: #b0b0b0;
        --nh-code-bg: #1e1e1e;
        --nh-accent: #6ea8ff;
      }
    }
    ${themeOverride}
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      max-width: 860px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
      color: var(--nh-fg);
      background: var(--nh-bg);
    }
    h1, h2, h3, h4, h5, h6 {
      line-height: 1.25;
      margin-top: 2rem;
      margin-bottom: 0.75rem;
    }
    h1 { font-size: 2rem; border-bottom: 1px solid var(--nh-border); padding-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; }
    p { margin: 0.75rem 0; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: var(--nh-code-bg);
      padding: 0.15em 0.35em;
      border-radius: 4px;
      font-size: 0.9em;
    }
    pre {
      background: var(--nh-code-bg);
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
    }
    blockquote {
      border-left: 4px solid var(--nh-border);
      margin: 1rem 0;
      padding: 0.25rem 1rem;
      color: var(--nh-muted);
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
    }
    th, td {
      border: 1px solid var(--nh-border);
      padding: 0.5rem 0.75rem;
      text-align: left;
    }
    img {
      max-width: 100%;
    }
    a {
      color: var(--nh-accent);
    }
    .katex {
      color: var(--nh-fg);
    }
    .slide {
      margin-bottom: 3rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid var(--nh-border);
    }
    .slide:last-of-type {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
    }`
}
    ${katexStyle}
    ${NOTES_STYLE}
    ${PRINT_PAGINATION_STYLE}
  </style>
</head>
<body>
${slidesHtml}
  <script>
    if (new URLSearchParams(location.search).has("notes")) {
      document.querySelectorAll(".notes").forEach((el) => {
        el.hidden = false;
      });
    }
  </script>
</body>
</html>
`;
}

export function containsUnsafeHtml(markdown: string): boolean {
	return tokenTreeContainsUnsafeHtml(marked.lexer(markdown));
}

function tokenTreeContainsUnsafeHtml(node: unknown): boolean {
	if (Array.isArray(node)) {
		return node.some(tokenTreeContainsUnsafeHtml);
	}
	if (node === null || typeof node !== "object") {
		return false;
	}
	const token = node as Record<string, unknown>;
	if (
		token.type === "html" &&
		typeof token.text === "string" &&
		!isPresenterNoteComment(token.text)
	) {
		return true;
	}
	return Object.values(token).some(tokenTreeContainsUnsafeHtml);
}

function splitIntoSlides(tokens: Token[]): Token[][] {
	const groups: Token[][] = [];
	let current: Token[] = [];
	for (const token of tokens) {
		if (token.type === "hr") {
			groups.push(current);
			current = [];
		} else {
			current.push(token);
		}
	}
	groups.push(current);

	const nonEmptyGroups = groups.filter((group) =>
		group.some((token) => token.type !== "space"),
	);
	if (nonEmptyGroups.length === 0) {
		return [groups[0]];
	}
	return nonEmptyGroups;
}
```

**Note on the `code({ text, lang, escaped })` renderer override and `splitIntoSlides`/`containsUnsafeHtml`/`tokenTreeContainsUnsafeHtml`:** these are unchanged from the current file -- shown above only for completeness of the full-file replacement. Do not alter their logic.

- [ ] **Step 4: Run all render tests to verify they pass**

Run: `npx vitest run tests/render.test.ts`
Expected: PASS, including both the Step-1 byte-identical regression test (still green) and the Step-2 new theme tests (now green).

- [ ] **Step 5: Format, lint, typecheck, and run the FULL suite**

Run: `npx biome format --write src/render.ts tests/render.test.ts && npm run build && npm run lint && npm run typecheck && npm test`
Expected: everything green. Pay special attention to `tests/cli.test.ts` and any other test that snapshots/asserts on rendered HTML content -- if anything else broke, it's a real signal the refactor changed default output; do not proceed until the full suite is green.

- [ ] **Step 6: Commit**

```bash
git add src/render.ts tests/render.test.ts
git commit -m "feat(render): refactor baseline stylesheet to CSS custom properties, apply theme colors"
```

---

### Task 5: CLI integration

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` (Task 1), `THEMES`/`resolveThemeName` (Task 2), the updated `generateHtml` (Task 3).

- [ ] **Step 1: Read the current file in full**

Read `src/index.ts` before editing -- confirm the exact current three action handlers (`render`, `pdf`, `png`) and the existing `UNSAFE_HTML_WARNING`/`formatActionError` pattern, so the new logic matches house style exactly.

- [ ] **Step 2: Add the `--theme` option and resolution logic to all three subcommands**

Modify `src/index.ts`. Add a new helper function near the top (alongside `formatActionError`), and a `--theme <name>` option plus its resolution logic to each of `render`, `pdf`, `png`'s action handlers:

```ts
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import open from "open";
import {
	closeWatcherOnServerClose,
	debounce,
	parsePort,
	resolveOutputPath,
	watchFileForChanges,
} from "./cliHelpers.js";
import { parseFrontmatter } from "./frontmatter.js";
import { exportToPdf } from "./pdfExport.js";
import { exportToPng } from "./pngExport.js";
import { containsUnsafeHtml, generateHtml } from "./render.js";
import { startServer } from "./server.js";
import { resolveThemeName, THEMES } from "./themes.js";
import type { ThemeColors } from "./themes.js";

const UNSAFE_HTML_WARNING =
	"nh-deck: warning: this deck contains raw HTML, which is rendered as-is (including any <script> tags). Only open decks from sources you trust.\n";

function formatActionError(error: unknown, file: string): string {
	const errnoPath = (error as NodeJS.ErrnoException)?.path;
	if (
		error instanceof Error &&
		(error as NodeJS.ErrnoException).code === "ENOENT" &&
		typeof errnoPath === "string" &&
		resolve(errnoPath) === resolve(file)
	) {
		return `nh-deck: could not find file '${file}'`;
	}
	const message = error instanceof Error ? error.message : String(error);
	return `nh-deck: ${message}`;
}

/**
 * Resolves the effective theme colors for a render/pdf/png invocation,
 * handling frontmatter/--theme precedence and --css mutual exclusivity.
 * Prints any resulting stderr note/warning as a side effect (matching
 * this file's existing UNSAFE_HTML_WARNING pattern: non-fatal, stderr,
 * never touches process.exitCode). See
 * docs/specs/theme-system-design.md §3.5/§4 for the exact precedence
 * rules this implements.
 *
 * Returns undefined when no theme should be applied (customCss given,
 * or nothing was requested).
 */
function resolveEffectiveTheme(
	frontmatterTheme: string | undefined,
	flagTheme: string | undefined,
	customCss: string | undefined,
): ThemeColors | undefined {
	const requested = flagTheme ?? frontmatterTheme;

	if (customCss) {
		if (requested) {
			process.stderr.write(
				`nh-deck: note: --css overrides the requested theme '${requested}'; it was not applied.\n`,
			);
		}
		return undefined;
	}

	if (!requested) {
		return undefined;
	}

	const { name, warning } = resolveThemeName(requested);
	if (warning) {
		process.stderr.write(`${warning}\n`);
	}
	return THEMES[name].colors;
}

const program = new Command();

program
	.name("nh-deck")
	.description(
		"A local-first CLI for writing, presenting, and exporting Markdown-based slide decks.",
	)
	.version("0.1.0");

program
	.command("render <file>")
	.description("Render a Markdown deck and serve it locally.")
	.option("--no-open", "do not open the deck in the default browser")
	.option("--port <n>", "port to listen on (default: OS-assigned)", parsePort)
	.option(
		"--watch",
		"re-render and auto-refresh the browser when the file changes",
	)
	.option(
		"--css <path>",
		"path to a custom CSS file that fully replaces the default stylesheet",
	)
	.option(
		"--theme <name>",
		`named color theme to apply (${Object.keys(THEMES).join(", ")}); overrides a deck's own frontmatter "theme:" value`,
	)
	.action(
		async (
			file: string,
			options: {
				open: boolean;
				port?: number;
				watch?: boolean;
				css?: string;
				theme?: string;
			},
		) => {
			try {
				const customCss = options.css
					? readFileSync(options.css, "utf8")
					: undefined;
				const rawMarkdown = readFileSync(file, "utf8");
				if (containsUnsafeHtml(rawMarkdown)) {
					process.stderr.write(UNSAFE_HTML_WARNING);
				}
				const { frontmatter, body: markdown } = parseFrontmatter(rawMarkdown);
				const themeColors = resolveEffectiveTheme(
					frontmatter.theme,
					options.theme,
					customCss,
				);
				const html = generateHtml(markdown, file, customCss, themeColors);
				const { url, updateHtml, server } = await startServer(
					html,
					options.port,
					{
						watch: options.watch,
					},
				);

				process.stdout.write(`nh-deck serving ${file} at ${url}\n`);

				if (options.watch) {
					const rerender = debounce(() => {
						try {
							const updatedRawMarkdown = readFileSync(file, "utf8");
							const { body: updatedMarkdown } =
								parseFrontmatter(updatedRawMarkdown);
							updateHtml(
								generateHtml(updatedMarkdown, file, customCss, themeColors),
							);
						} catch {
							// A transient read failure (e.g. mid-save) is not fatal — the
							// next file-change event retries.
						}
					}, 100);
					const watcher = watchFileForChanges(file, rerender);
					closeWatcherOnServerClose(watcher, server);
				}

				if (options.open) {
					await open(url);
				}
			} catch (error) {
				process.stderr.write(`${formatActionError(error, file)}\n`);
				process.exitCode = 1;
			}
		},
	);

program
	.command("pdf <file> [output]")
	.description("Export a Markdown deck to PDF.")
	.option(
		"--css <path>",
		"path to a custom CSS file that fully replaces the default stylesheet",
	)
	.option(
		"--theme <name>",
		`named color theme to apply (${Object.keys(THEMES).join(", ")}); overrides a deck's own frontmatter "theme:" value`,
	)
	.action(
		async (
			file: string,
			output?: string,
			options?: { css?: string; theme?: string },
		) => {
			try {
				const customCss = options?.css
					? readFileSync(options.css, "utf8")
					: undefined;
				const rawMarkdown = readFileSync(file, "utf8");
				if (containsUnsafeHtml(rawMarkdown)) {
					process.stderr.write(UNSAFE_HTML_WARNING);
				}
				const { frontmatter, body: markdown } = parseFrontmatter(rawMarkdown);
				const themeColors = resolveEffectiveTheme(
					frontmatter.theme,
					options?.theme,
					customCss,
				);
				const html = generateHtml(markdown, file, customCss, themeColors);
				const outputPath = resolveOutputPath(file, output);

				await exportToPdf(html, outputPath);
				process.stdout.write(`Wrote PDF to ${outputPath}\n`);
			} catch (error) {
				process.stderr.write(`${formatActionError(error, file)}\n`);
				process.exitCode = 1;
			}
		},
	);

program
	.command("png <file> [output]")
	.description("Export a Markdown deck to one PNG per slide.")
	.option(
		"--css <path>",
		"path to a custom CSS file that fully replaces the default stylesheet",
	)
	.option(
		"--theme <name>",
		`named color theme to apply (${Object.keys(THEMES).join(", ")}); overrides a deck's own frontmatter "theme:" value`,
	)
	.action(
		async (
			file: string,
			output?: string,
			options?: { css?: string; theme?: string },
		) => {
			try {
				const customCss = options?.css
					? readFileSync(options.css, "utf8")
					: undefined;
				const rawMarkdown = readFileSync(file, "utf8");
				if (containsUnsafeHtml(rawMarkdown)) {
					process.stderr.write(UNSAFE_HTML_WARNING);
				}
				const { frontmatter, body: markdown } = parseFrontmatter(rawMarkdown);
				const themeColors = resolveEffectiveTheme(
					frontmatter.theme,
					options?.theme,
					customCss,
				);
				const html = generateHtml(markdown, file, customCss, themeColors);
				const outputPath = resolveOutputPath(file, output, "png");

				const written = await exportToPng(html, outputPath);
				process.stdout.write(
					`Wrote ${written.length} PNG file(s), starting at ${written[0]}\n`,
				);
			} catch (error) {
				process.stderr.write(`${formatActionError(error, file)}\n`);
				process.exitCode = 1;
			}
		},
	);

program.parse();
```

**Note on `containsUnsafeHtml(rawMarkdown)`:** deliberately checked against the *raw* markdown (including any frontmatter block), not the frontmatter-stripped body -- a frontmatter block is just `key: value` lines by construction (Task 1's parser rejects anything else), so it can never itself contain raw HTML, and checking the raw string is simpler than re-threading two separate strings through this check.

- [ ] **Step 3: Run the full test suite**

Run: `npm run build && npm run lint && npm run typecheck && npm test`
Expected: all existing tests still pass (Task 6 hasn't added the new CLI-level theme tests yet, but nothing existing should break).

- [ ] **Step 4: Format**

Run: `npx biome format --write src/index.ts`

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(cli): wire --theme flag and frontmatter theme: precedence into render/pdf/png"
```

---

### Task 6: CLI-level integration tests

**Files:**
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Consumes: the fully-integrated CLI from Task 5. This task only adds tests; no source changes.

- [ ] **Step 1: Read the current file in full**

Read `tests/cli.test.ts` before editing -- match its existing spawn/timeout/fixture conventions exactly (see the file's own `waitForServingLine`, `STARTUP_TIMEOUT_MS`, etc.).

- [ ] **Step 2: Write the new tests**

Add a new `describe("CLI: theme selection", ...)` block (or extend the existing `render`/`pdf`/`png` describe blocks, whichever this file's own convention favors -- read it first) covering:

1. `--theme dark` on `render` produces served HTML containing `--nh-bg: #0d1117` (github-dark's bg).
2. A deck with frontmatter `---\ntheme: dracula\n---\n` (no `--theme` flag) produces output containing dracula's bg (`#282a36`).
3. `--theme nord` overrides a conflicting frontmatter `theme: light` -- output contains nord's bg, not github-light's.
4. `--css <path>` together with `--theme dark` produces the custom CSS content and a stderr line matching `/--css overrides the requested theme/`, and does NOT contain `--nh-bg: #0d1117`.
5. `--theme totally-not-a-theme` produces a stderr line matching `/unknown theme/i` and still renders successfully (exit code reflects success, not failure -- this is a warning, not an error) with the default `light` theme's bg (`#ffffff`) present in the output.

Follow this file's existing pattern for spawning the CLI and reading stdout/stderr (see `waitForServingLine` for the `render` command's pattern; the `pdf`/`png` tests use a simpler spawn-and-wait-for-exit pattern -- use whichever pattern the specific subcommand you're testing already uses elsewhere in this file). Write real temp `.md` fixture files with `mkdtempSync`/`writeFileSync` (matching this file's existing temp-file handling), not string literals passed some other way.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS, including all 5 new cases plus every pre-existing test in this file unchanged.

- [ ] **Step 4: Format, lint, typecheck, full suite**

Run: `npx biome format --write tests/cli.test.ts && npm run build && npm run lint && npm run typecheck && npm test`

- [ ] **Step 5: Commit**

```bash
git add tests/cli.test.ts
git commit -m "test(cli): cover --theme flag, frontmatter theme:, precedence, and --css interaction"
```

---

### Task 7: Documentation + ADR

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `Context.md`
- Create: `docs/adr/0008-named-theme-system.md`

**Model note:** this task *describes already-shipped code* (an ADR, README usage docs, a directory-map update) -- per this project's own established lesson (a haiku-tier agent previously fabricated plausible-sounding-but-false technical details for exactly this kind of task in an earlier phase), dispatch this to a judgment-tier model, not the cheapest available, and have the reviewer independently verify a meaningful sample of claims against the live source rather than just reading the prose.

- [ ] **Step 1: Read every file to be modified/referenced, and the final shipped source, in full**

Read the current `README.md`, `AGENTS.md`, `Context.md`, and the final state of `src/themes.ts`, `src/frontmatter.ts`, `src/render.ts`, `src/index.ts` (as landed by Tasks 1-6) directly -- do not draft any claim from this plan's own prose; verify every specific detail (flag names, precedence order, theme names, file names) against the real, final code.

- [ ] **Step 2: Update `README.md`**

Add a new "Themes" section under Usage, documenting: the 4 theme names, the `--theme <name>` flag, the frontmatter `theme:` key with a short example, and the `--css`-wins interaction. Remove the theme/template/transition system's "themes" portion from the "Current limitations" section (leave templates/transitions listed, since those remain deferred).

- [ ] **Step 3: Update `AGENTS.md`**

Add `src/frontmatter.ts` and `src/themes.ts` to the Directory Map, matching the existing entries' style (one-line description each). Add `tests/frontmatter.test.ts` and `tests/themes.test.ts` to the Directory Map's test listing.

- [ ] **Step 4: Update `Context.md`**

Update Roadmap item 11: split into two lines if the existing numbered format supports it cleanly, or strike the theme portion and note templates/transitions remain open -- match how other partially-done roadmap items have been formatted elsewhere in this same file (read the file first for precedent).

- [ ] **Step 5: Write the ADR**

Create `docs/adr/0008-named-theme-system.md`, following the exact Nygard structure of ADR 0007 (`Status` → `Context and Problem Statement` → `Decision Drivers` → `Considered Options` → `Decision Outcome` → `Consequences` → `Confirmation` → `More Information`) -- read ADR 0007 in full first to match heading style exactly. Cover: the gap (no theming existed), the decision (4 fixed themes reusing beautiful-mermaid's palettes, frontmatter+flag selection, CSS-custom-properties mechanism, `--css` mutual exclusivity), consequences (fixed set is not user-extensible; the frontmatter/slide-separator collision resolution and why it's safe; the byte-identical-default-output guarantee).

- [ ] **Step 6: Final independent verification**

Run `npm run build && npm run lint && npm run typecheck && npm test` one more time. Spot-check at least 5 specific claims in the new docs (flag names, theme names, file paths) against the real source directly, not against this plan's prose.

- [ ] **Step 7: Commit**

```bash
git add README.md AGENTS.md Context.md docs/adr/0008-named-theme-system.md
git commit -m "docs: document the named theme system (README, AGENTS.md, Context.md, ADR 0008)"
```

---

## After all 7 tasks: final whole-branch review

Per `superpowers:subagent-driven-development`'s process: dispatch a final whole-branch reviewer (most capable available model) scoped to the full diff from this branch's base commit to `HEAD`, independently re-verifying the byte-identical-default-output guarantee, the frontmatter/slide-separator collision handling, and the `--css`-wins precedence -- not just reading the diff. Then use `superpowers:finishing-a-development-branch` to push and open the PR.
