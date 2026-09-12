# Templates (Layouts) + Presentation Mode + Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give nh-deck 4 fixed, opt-in per-slide layouts (`title`, `section`, `two-column`, `quote`), a new opt-in one-slide-at-a-time presentation mode (`?present`), and deck-wide `fade`/`slide` transitions between slides that only apply inside presentation mode.

**Architecture:** Two new dependency-free registry modules (`src/slideLayouts.ts`, `src/transitions.ts`) plus a new client-script module (`src/presentationScript.ts`) feed two sequential rounds of wiring into `render.ts` (layouts first, then transitions + the presentation script + a `generateHtml` signature change) and one round of CLI wiring into `index.ts` (`--transition` on `render` only). A dedicated real-browser test proves presentation mode's actual interactive behavior, since it's the first feature in this codebase that isn't verifiable via string assertions alone.

**Tech Stack:** No new runtime dependencies. Reuses `puppeteer-core` (already a dependency, used for PDF/PNG export) for the presentation-mode browser test.

**Spec:** `docs/specs/templates-transitions-design.md` — every decision below traces to that spec, proposed and approved section-by-section in a live brainstorming session, including a mid-brainstorm scope discovery (presentation mode had to be added as a real prerequisite for transitions) and two mid-planning simplifications (layout-name warnings are a silent no-op; the layout/presenter-note collision is resolved by filter ordering in `render.ts`, not a change to `presenterNotes.ts`) — both confirmed with the user and folded back into the spec before this plan was written.

## Global Constraints

- **No forced default, ever** — a slide with no `<!-- layout: name -->` marker, a deck with no `--transition`/frontmatter `transition:`, and a URL with no `?present` must all render/behave exactly as they do today. This is verified by dedicated regression tests in Task 2 and Task 5, written and passing *before* any change, re-verified passing *after*.
- **`--css` wins over layout CSS and transition CSS** — mutually exclusive, no CSS-cascade layering. Presentation mode's own base show/hide mechanism (`PRESENTATION_STYLE`) is **not** suppressed by `--css` — it's a functional necessity for presentation mode to work at all, exactly like the existing `NOTES_STYLE`/`PRINT_PAGINATION_STYLE` are never suppressed either. Only the fade/slide *animation* on top of that base mechanism is suppressible.
- **Layouts apply everywhere** (`render`, `pdf`, `png`); **transitions apply only to `render`**, and only ever visually manifest inside `?present`. `pdf`/`png` never gain a `--transition` flag at all.
- **Unrecognized layout name → silent no-op** (no CSS class applied, no warning — see spec §3.1's revision). **Unrecognized `--transition`/frontmatter name → falls back to no transition with a one-time stderr warning**, mirroring the theme system's exact unknown-name handling, since transition names *are* resolvable up front from frontmatter, unlike per-slide layout markers.
- **Fixed sets only** — exactly 4 layouts, exactly 2 transitions. Do not add a 5th of either, or a custom-registration mechanism, as part of this plan.
- **No CDN dependency** — the presentation-mode script and all new CSS ship inline in the served HTML, same as every other rendering feature.
- **Tab indentation** (biome.json's mandate) — a PostToolUse hook in some environments reformats edited files to 2-space; if you hit this, run `npx biome format --write <file>` via Bash afterward (does not retrigger the hook) before committing.

## Pre-flight conflict scan

| Pair / Task | Shared file / interface | Finding |
|---|---|---|
| Task 1 ↔ Task 2 | `src/slideLayouts.ts`'s `extractSlideLayout`/`resolveLayoutName` | Task 2 is the only consumer; Task 1 must complete first. |
| Task 3 ↔ Task 5, Task 6 | `src/transitions.ts`'s `TRANSITIONS`/`resolveTransitionName` | Tasks 5 and 6 both consume these; Task 3 must complete first. Task 3 has no dependency on Tasks 1/2/4 and could run in parallel with them. |
| Task 4 ↔ Task 5 | `src/presentationScript.ts`'s `PRESENTATION_SCRIPT` | Task 5 embeds it; Task 4 must complete first. Task 4 has no dependency on Tasks 1/2/3 and could run in parallel with them. |
| Task 2 ↔ Task 5 | `src/render.ts` | Both edit `render.ts`'s per-slide loop and style-assembly area. Task 5 must start from Task 2's already-committed state — sequential, not parallel, despite touching logically separate concerns (layouts vs. transitions). |
| Task 5 ↔ Task 6 | `src/render.ts`'s `generateHtml` signature (gains a 5th param, `transitionName`) | Task 6 is the only caller (in `src/index.ts`) that needs updating to pass it. Task 5 must complete first. |
| Task 5 ↔ Task 7 | `PRESENTATION_SCRIPT`'s embedding + `PRESENTATION_STYLE` | Task 7's real-browser test exercises behavior Task 5 wires in. Task 5 must complete first. |
| Task 8 | `AGENTS.md`, `Context.md`, new ADR | Docs-only, no code overlap with any other task. Must run last since it documents the actually-shipped behavior. |

**Ordering implication:** Tasks 1, 3, and 4 are mutually independent and could run in parallel; Task 2 depends only on Task 1; Task 5 depends on Tasks 2, 3, and 4 all being done; Task 6 and Task 7 both depend on Task 5. Numbered execution order: **1, 2, 3, 4, 5, 6, 7, 8**.

No other conflicts found.

---

### Task 1: Layout registry & marker extraction

**Files:**
- Create: `src/slideLayouts.ts`
- Test: `tests/slideLayouts.test.ts`

**Interfaces:**
- Produces: `LAYOUTS: readonly string[]`, `LayoutName` type, `resolveLayoutName(requested: string | undefined): { name?: LayoutName }`, `extractSlideLayout(tokens: Token[]): { layout?: string; tokens: Token[] }` — all used by Task 2.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

Create `tests/slideLayouts.test.ts`:

```ts
import { marked } from "marked";
import { describe, expect, it } from "vitest";
import {
	extractSlideLayout,
	LAYOUTS,
	resolveLayoutName,
} from "../src/slideLayouts.js";

describe("LAYOUTS", () => {
	it("has exactly the 4 fixed layout names", () => {
		expect([...LAYOUTS].sort()).toEqual([
			"quote",
			"section",
			"title",
			"two-column",
		]);
	});
});

describe("resolveLayoutName", () => {
	it("resolves a valid layout name", () => {
		expect(resolveLayoutName("title")).toEqual({ name: "title" });
	});

	it("is case-insensitive", () => {
		expect(resolveLayoutName("Title")).toEqual({ name: "title" });
	});

	it("silently returns no name for an unrecognized layout", () => {
		expect(resolveLayoutName("nonexistent-layout")).toEqual({});
	});

	it("returns no name when nothing was requested", () => {
		expect(resolveLayoutName(undefined)).toEqual({});
	});
});

describe("extractSlideLayout", () => {
	it("extracts a layout name from a standalone HTML comment and removes it from the token stream", () => {
		const tokens = marked.lexer("<!-- layout: title -->\n\n# Hi\n");

		const result = extractSlideLayout(tokens);

		expect(result.layout).toBe("title");
		expect(result.tokens.some((t) => t.type === "html")).toBe(false);
		expect(result.tokens.some((t) => t.type === "heading")).toBe(true);
	});

	it("leaves tokens unchanged when no layout marker is present", () => {
		const tokens = marked.lexer("# Hi\n");

		const result = extractSlideLayout(tokens);

		expect(result.layout).toBeUndefined();
		expect(result.tokens).toEqual(tokens);
	});

	it("does not mistake a presenter note for a layout marker", () => {
		const tokens = marked.lexer(
			"<!-- remember to slow down here -->\n\n# Hi\n",
		);

		const result = extractSlideLayout(tokens);

		expect(result.layout).toBeUndefined();
		expect(result.tokens).toEqual(tokens);
	});

	it("uses the first layout marker when multiple appear, dropping both from the token stream", () => {
		const tokens = marked.lexer(
			"<!-- layout: title -->\n\n<!-- layout: quote -->\n\n# Hi\n",
		);

		const result = extractSlideLayout(tokens);

		expect(result.layout).toBe("title");
		expect(result.tokens.some((t) => t.type === "html")).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/slideLayouts.test.ts`
Expected: FAIL — `Cannot find module '../src/slideLayouts.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/slideLayouts.ts`:

```ts
import type { Token } from "marked";

const HTML_COMMENT_PATTERN = /^<!--([\s\S]*?)-->/;
const LAYOUT_MARKER_PATTERN = /^layout:\s*(\S+)/i;

/**
 * nh-deck's 4 fixed, opt-in per-slide layouts. A slide with no
 * <!-- layout: name --> marker renders with no layout at all (today's
 * exact behavior) -- see docs/specs/templates-transitions-design.md §2.
 * Do not add a 5th layout or a custom-layout-registration mechanism
 * without a new design pass; see that same spec's §7 (out of scope).
 */
export const LAYOUTS = ["title", "section", "two-column", "quote"] as const;
export type LayoutName = (typeof LAYOUTS)[number];

/**
 * Validates a requested layout name (case-insensitive) against the fixed
 * set above. Unlike resolveThemeName, an unrecognized name has no clean
 * way to surface a warning here -- layout markers are discovered inside
 * generateHtml's own lexing pipeline, not up front from simple frontmatter
 * -- so this silently returns no name for anything unrecognized (see
 * docs/specs/templates-transitions-design.md §3.1's revision).
 */
export function resolveLayoutName(requested: string | undefined): {
	name?: LayoutName;
} {
	if (!requested || requested.trim().length === 0) {
		return {};
	}
	const normalized = requested.trim().toLowerCase();
	return (LAYOUTS as readonly string[]).includes(normalized)
		? { name: normalized as LayoutName }
		: {};
}

function matchLayoutMarker(text: string): string | undefined {
	const commentMatch = text.match(HTML_COMMENT_PATTERN);
	if (!commentMatch) {
		return undefined;
	}
	const markerMatch = commentMatch[1].trim().match(LAYOUT_MARKER_PATTERN);
	return markerMatch ? markerMatch[1] : undefined;
}

/**
 * Scans one slide's token array for a standalone <!-- layout: name -->
 * comment (the same standalone-HTML-comment shape presenterNotes.ts
 * recognizes for presenter notes, disambiguated by content) and returns
 * the raw requested name (not yet validated -- callers pass it through
 * resolveLayoutName) plus the token array with every matching comment
 * removed. Removing every match here, not just the winning one, is what
 * keeps a layout marker from ever being rendered as a presenter note --
 * render.ts passes the returned `tokens` (not the original array) to
 * extractNotes, so extractNotes never sees a layout-marker token at all
 * and needs no change of its own. If more than one layout comment
 * appears, the first one found wins the `layout` field.
 */
export function extractSlideLayout(tokens: Token[]): {
	layout?: string;
	tokens: Token[];
} {
	let layout: string | undefined;
	const filtered: Token[] = [];
	for (const token of tokens) {
		const markerName =
			token.type === "html" ? matchLayoutMarker(token.text) : undefined;
		if (markerName !== undefined) {
			if (layout === undefined) {
				layout = markerName;
			}
			continue;
		}
		filtered.push(token);
	}
	return { layout, tokens: filtered };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/slideLayouts.test.ts`
Expected: PASS (8/8).

- [ ] **Step 5: Format, lint, typecheck**

Run: `npx biome format --write src/slideLayouts.ts tests/slideLayouts.test.ts && npm run lint && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/slideLayouts.ts tests/slideLayouts.test.ts
git commit -m "feat(layouts): add fixed 4-layout registry and per-slide marker extraction"
```

---

### Task 2: Wire layouts into `render.ts`

**Files:**
- Modify: `src/render.ts`
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: Task 1's `extractSlideLayout`, `resolveLayoutName`.
- Produces: no signature change to `generateHtml` in this task — the per-slide loop applies a layout CSS class internally.

- [ ] **Step 1: Write the failing tests**

Add to `tests/render.test.ts` (inside the existing `describe("generateHtml", ...)` block, after the Mermaid-theming tests):

```ts
it("applies a layout CSS class from a slide's layout marker comment", () => {
	const html = generateHtml(
		"<!-- layout: title -->\n\n# Big Heading\n\nSubtitle text.",
	);

	expect(html).toContain('<section class="slide layout-title">');
});

it("renders a slide with no layout marker exactly as before -- no layout class", () => {
	const html = generateHtml("# Big Heading\n\nSubtitle text.");

	expect(html).toContain('<section class="slide">');
	expect(html).not.toContain("layout-");
});

it("excludes a layout marker comment from both the rendered notes and the raw output", () => {
	const html = generateHtml("<!-- layout: title -->\n\n# Heading\n");

	expect(html).not.toContain("layout:");
	expect(html).not.toContain('class="notes"');
});

it("silently ignores an unrecognized layout name -- no class applied, no crash", () => {
	const html = generateHtml("<!-- layout: nonexistent -->\n\n# Heading\n");

	expect(html).toContain('<section class="slide">');
	expect(html).not.toContain("layout-nonexistent");
});

it("still treats a layout marker comment as an already-reviewed comment, not raw HTML", () => {
	expect(
		containsUnsafeHtml("<!-- layout: title -->\n\n# Heading\n"),
	).toBe(false);
});

it("does not apply LAYOUT_STYLE's CSS when a custom --css is given", () => {
	const html = generateHtml(
		"# Heading",
		"sample",
		".slide { color: red; }",
	);

	expect(html).not.toContain(".slide.layout-title");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/render.test.ts -t "layout"`
Expected: FAIL — no slide ever gets a `layout-*` class yet (`extractSlideLayout` isn't wired in).

- [ ] **Step 3: Write the implementation**

In `src/render.ts`, add the import:

```ts
import { extractSlideLayout, resolveLayoutName } from "./slideLayouts.js";
```

Add a new constant, placed directly after `PRINT_PAGINATION_STYLE`'s declaration:

```ts
const LAYOUT_STYLE = `
    .slide.layout-title {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 60vh;
      text-align: center;
    }
    .slide.layout-title h1 {
      font-size: 3rem;
      border-bottom: none;
    }
    .slide.layout-title p:first-of-type {
      color: var(--nh-muted);
      font-size: 1.25rem;
    }
    .slide.layout-section {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 60vh;
      text-align: center;
    }
    .slide.layout-section h1,
    .slide.layout-section h2 {
      font-size: 2.5rem;
      border-bottom: none;
    }
    .slide.layout-section p,
    .slide.layout-section ul,
    .slide.layout-section ol {
      color: var(--nh-muted);
      font-size: 1rem;
    }
    .slide.layout-two-column {
      column-count: 2;
      column-gap: 2rem;
    }
    .slide.layout-two-column h1,
    .slide.layout-two-column h2,
    .slide.layout-two-column h3 {
      break-after: avoid;
    }
    .slide.layout-two-column pre,
    .slide.layout-two-column table,
    .slide.layout-two-column img {
      break-inside: avoid;
    }
    .slide.layout-quote {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 60vh;
      text-align: center;
    }
    .slide.layout-quote p {
      font-size: 1.75rem;
      font-style: italic;
    }
    .slide.layout-quote p:last-of-type {
      font-size: 1rem;
      font-style: normal;
      color: var(--nh-muted);
    }`;
```

Change the per-slide rendering loop inside `generateHtml` from:

```ts
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
```

to:

```ts
	const slidesHtml = splitIntoSlides(tokens)
		.map((slideTokens) => {
			const { layout, tokens: filteredTokens } =
				extractSlideLayout(slideTokens);
			const { name: layoutName } = resolveLayoutName(layout);
			const layoutClass = layoutName ? ` layout-${layoutName}` : "";
			const notesHtml = extractNotes(filteredTokens)
				.map(
					(note) => `<aside class="notes" hidden>${escapeHtml(note)}</aside>`,
				)
				.join("\n");
			return `<section class="slide${layoutClass}">\n${marked.parser(filteredTokens)}${notesHtml}</section>`;
		})
		.join("\n");
```

Add a new local variable right after `themeOverride`'s declaration:

```ts
	const layoutOverride = !customCss ? LAYOUT_STYLE : "";
```

Finally, add `${layoutOverride}` to the unconditionally-appended style list, changing:

```ts
    ${katexStyle}
    ${NOTES_STYLE}
    ${PRINT_PAGINATION_STYLE}
  </style>
```

to:

```ts
    ${katexStyle}
    ${NOTES_STYLE}
    ${PRINT_PAGINATION_STYLE}
    ${layoutOverride}
  </style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/render.test.ts`
Expected: PASS (all tests, including the pre-existing byte-identical-no-theme regression test — this task never touches anything theme-related).

- [ ] **Step 5: Format, lint, typecheck**

Run: `npx biome format --write src/render.ts tests/render.test.ts && npm run lint && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/render.ts tests/render.test.ts
git commit -m "feat(render): apply per-slide layout classes from layout marker comments"
```

---

### Task 3: Transition registry

**Files:**
- Create: `src/transitions.ts`
- Test: `tests/transitions.test.ts`

**Interfaces:**
- Produces: `TRANSITIONS: readonly string[]`, `TransitionName` type, `resolveTransitionName(requested: string | undefined): { name?: TransitionName; warning?: string }` — used by Task 5 and Task 6.
- Consumes: nothing new. No dependency on Tasks 1/2/4 — can run in parallel with them.

- [ ] **Step 1: Write the failing tests**

Create `tests/transitions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveTransitionName, TRANSITIONS } from "../src/transitions.js";

describe("TRANSITIONS", () => {
	it("has exactly the 2 fixed transition names", () => {
		expect([...TRANSITIONS].sort()).toEqual(["fade", "slide"]);
	});
});

describe("resolveTransitionName", () => {
	it("resolves a valid transition name with no warning", () => {
		expect(resolveTransitionName("fade")).toEqual({ name: "fade" });
	});

	it("is case-insensitive", () => {
		const result = resolveTransitionName("Fade");
		expect(result.name).toBe("fade");
		expect(result.warning).toBeUndefined();
	});

	it("falls back to no transition with a warning for an unknown name", () => {
		const result = resolveTransitionName("nonexistent-transition");
		expect(result.name).toBeUndefined();
		expect(result.warning).toMatch(/unknown transition/i);
		expect(result.warning).toContain("nonexistent-transition");
	});

	it("returns no transition and no warning when nothing was requested", () => {
		expect(resolveTransitionName(undefined)).toEqual({});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/transitions.test.ts`
Expected: FAIL — `Cannot find module '../src/transitions.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/transitions.ts`:

```ts
/**
 * nh-deck's 2 fixed, deck-wide transition effects, only ever visually
 * meaningful inside presentation mode (?present) -- see
 * docs/specs/templates-transitions-design.md §2. Do not add a 3rd
 * transition or a custom-registration mechanism without a new design
 * pass; see that same spec's §7 (out of scope).
 */
export const TRANSITIONS = ["fade", "slide"] as const;
export type TransitionName = (typeof TRANSITIONS)[number];

/**
 * Validates a requested transition name (case-insensitive) against the
 * fixed set above. An unrecognized non-empty name falls back to no
 * transition with a warning message for the caller to print (non-fatal
 * -- never throws) -- unlike layout names, a transition name is resolved
 * once, up front, from frontmatter/a flag (mirroring resolveThemeName),
 * so surfacing a warning here poses none of the problems layout-name
 * warnings do. `undefined`/empty input silently resolves to no
 * transition with no warning, since "nothing was requested" is not an
 * error.
 */
export function resolveTransitionName(requested: string | undefined): {
	name?: TransitionName;
	warning?: string;
} {
	if (!requested || requested.trim().length === 0) {
		return {};
	}
	const normalized = requested.trim().toLowerCase();
	if ((TRANSITIONS as readonly string[]).includes(normalized)) {
		return { name: normalized as TransitionName };
	}
	return {
		warning: `nh-deck: warning: unknown transition '${requested}', no transition will be applied. Valid transitions: ${TRANSITIONS.join(", ")}.`,
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/transitions.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Format, lint, typecheck**

Run: `npx biome format --write src/transitions.ts tests/transitions.test.ts && npm run lint && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/transitions.ts tests/transitions.test.ts
git commit -m "feat(transitions): add fixed 2-transition registry"
```

---

### Task 4: Presentation-mode client script

**Files:**
- Create: `src/presentationScript.ts`
- Test: `tests/presentationScript.test.ts`

**Interfaces:**
- Produces: `PRESENTATION_SCRIPT: string` — a complete `<script>...</script>` block — used by Task 5.
- Consumes: nothing. No dependency on Tasks 1/2/3 — can run in parallel with them.

- [ ] **Step 1: Write the failing tests**

Create `tests/presentationScript.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PRESENTATION_SCRIPT } from "../src/presentationScript.js";

describe("PRESENTATION_SCRIPT", () => {
	it("is wrapped in a real <script> tag", () => {
		expect(PRESENTATION_SCRIPT).toMatch(/^<script>[\s\S]*<\/script>$/);
	});

	it("gates all its behavior behind the present query parameter", () => {
		expect(PRESENTATION_SCRIPT).toContain('has("present")');
	});

	it("listens for the expected navigation keys", () => {
		expect(PRESENTATION_SCRIPT).toContain("ArrowRight");
		expect(PRESENTATION_SCRIPT).toContain("ArrowLeft");
	});

	it("persists the current slide via location.hash", () => {
		expect(PRESENTATION_SCRIPT).toContain("location.hash");
	});

	it("does not advance on a click inside a link", () => {
		expect(PRESENTATION_SCRIPT).toContain('closest("a")');
	});

	it("never references an external CDN (local-first constraint)", () => {
		expect(PRESENTATION_SCRIPT).not.toMatch(/https?:\/\/cdn\./i);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/presentationScript.test.ts`
Expected: FAIL — `Cannot find module '../src/presentationScript.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/presentationScript.ts`:

```ts
/**
 * Client-side navigation for nh-deck's opt-in presentation mode. Kept in
 * its own module (rather than inline in render.ts, like the smaller
 * ?notes toggle script) because this script is real, multi-part logic
 * (hash parsing, keyboard/click handling, a slide counter) that deserves
 * its own review surface -- see docs/specs/templates-transitions-design.md
 * §3.3.
 *
 * Entirely inert unless `?present` is in the URL -- the continuous-scroll
 * default view is completely unaffected, matching the existing `?notes`
 * toggle's own opt-in-via-URL precedent.
 */
export const PRESENTATION_SCRIPT = `<script>
(() => {
  if (!new URLSearchParams(location.search).has("present")) {
    return;
  }
  document.body.classList.add("presenting");

  const slides = Array.from(document.querySelectorAll(".slide"));
  if (slides.length === 0) {
    return;
  }

  const counter = document.createElement("div");
  counter.className = "presentation-counter";
  document.body.appendChild(counter);

  const parseHashIndex = () => {
    const n = parseInt(location.hash.slice(1), 10);
    return Number.isInteger(n) && n >= 1 && n <= slides.length ? n - 1 : 0;
  };

  let current = parseHashIndex();

  const render = () => {
    slides.forEach((slide, i) => {
      slide.classList.toggle("is-active", i === current);
    });
    counter.textContent = (current + 1) + " / " + slides.length;
    location.hash = String(current + 1);
  };

  const goTo = (index) => {
    if (index < 0 || index >= slides.length) {
      return;
    }
    current = index;
    render();
  };

  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === " ") {
      goTo(current + 1);
    } else if (event.key === "ArrowLeft") {
      goTo(current - 1);
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      return;
    }
    goTo(current + 1);
  });

  render();
})();
</script>`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/presentationScript.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Format, lint, typecheck**

Run: `npx biome format --write src/presentationScript.ts tests/presentationScript.test.ts && npm run lint && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/presentationScript.ts tests/presentationScript.test.ts
git commit -m "feat(presentation): add client-side one-slide-at-a-time navigation script"
```

---

### Task 5: Wire transitions + presentation mode into `render.ts`

**Files:**
- Modify: `src/render.ts`
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: Task 2's already-wired layout code (builds on top of it in the same file); Task 3's `TransitionName` type; Task 4's `PRESENTATION_SCRIPT`.
- Produces: `generateHtml(markdown, title?, customCss?, themeColors?, transitionName?)` — the new 5-arg signature Task 6 calls.

- [ ] **Step 1: Write the failing tests**

Add to `tests/render.test.ts` (after Task 2's layout tests):

```ts
it("embeds the presentation-mode script unconditionally, inert without ?present", () => {
	const html = generateHtml(fixtureMarkdown, "sample");

	expect(html).toContain('has("present")');
});

it("adds transition CSS when a transition name is given", () => {
	const html = generateHtml("# Slide", "sample", undefined, undefined, "fade");

	expect(html).toContain("transition: opacity");
});

it("adds a different transition's CSS for the slide transition", () => {
	const html = generateHtml("# Slide", "sample", undefined, undefined, "slide");

	expect(html).toContain("transform: translateX");
});

it("adds no transition animation CSS when no transition name is given", () => {
	const html = generateHtml(
		"# Slide",
		"sample",
		undefined,
		undefined,
		undefined,
	);

	expect(html).not.toContain("transform: translateX");
	expect(html).not.toContain("transition: opacity");
});

it("does not apply transition CSS when a custom --css is given, even with a transition name", () => {
	const html = generateHtml(
		"# Slide",
		"sample",
		".slide { color: red; }",
		undefined,
		"fade",
	);

	expect(html).not.toContain("transition: opacity");
});

it("still applies presentation mode's base show/hide CSS even with a custom --css", () => {
	const html = generateHtml("# Slide", "sample", ".slide { color: red; }");

	expect(html).toContain("body.presenting .slide.is-active");
});

it("produces byte-identical output with no transition argument (regression guard)", () => {
	const withoutArg = generateHtml(fixtureMarkdown, "sample", undefined, undefined);
	const withUndefinedTransition = generateHtml(
		fixtureMarkdown,
		"sample",
		undefined,
		undefined,
		undefined,
	);

	expect(withUndefinedTransition).toBe(withoutArg);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/render.test.ts -t "transition"`
Expected: FAIL — `generateHtml` doesn't accept a 5th argument yet, and no transition/presentation CSS or script exists in the output.

- [ ] **Step 3: Write the implementation**

In `src/render.ts`, add the import and type import:

```ts
import { PRESENTATION_SCRIPT } from "./presentationScript.js";
import type { TransitionName } from "./transitions.js";
```

Add two new constants, placed directly after `LAYOUT_STYLE`'s declaration:

```ts
const PRESENTATION_STYLE = `
    body.presenting .slide {
      display: none;
    }
    body.presenting .slide.is-active {
      display: block;
    }
    body.presenting .presentation-counter {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      background: var(--nh-code-bg);
      color: var(--nh-muted);
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      font-size: 0.85rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }`;

/**
 * Overrides PRESENTATION_STYLE's plain display:none/block toggle with an
 * animatable version for the given transition: both the active and
 * inactive slide stay display:block (position:absolute, stacked), so
 * opacity/transform can transition smoothly between them. Suppressible
 * by --css, unlike PRESENTATION_STYLE itself -- see the plan's Global
 * Constraints for why the split is drawn there.
 */
function transitionToCssBlock(name: TransitionName): string {
	if (name === "fade") {
		return `
    body.presenting .slide {
      display: block;
      position: absolute;
      inset: 0;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    body.presenting .slide.is-active {
      opacity: 1;
      pointer-events: auto;
    }`;
	}
	return `
    body.presenting .slide {
      display: block;
      position: absolute;
      inset: 0;
      transform: translateX(100%);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.3s ease, opacity 0.3s ease;
    }
    body.presenting .slide.is-active {
      transform: translateX(0);
      opacity: 1;
      pointer-events: auto;
    }`;
}
```

Change `generateHtml`'s signature and add the two new local variables, from:

```ts
export function generateHtml(
	markdown: string,
	title?: string,
	customCss?: string,
	themeColors?: ThemeColors,
): string {
```

to:

```ts
export function generateHtml(
	markdown: string,
	title?: string,
	customCss?: string,
	themeColors?: ThemeColors,
	transitionName?: TransitionName,
): string {
```

Add these two lines right after `layoutOverride`'s declaration (from Task 2):

```ts
	const transitionStyle =
		!customCss && transitionName ? transitionToCssBlock(transitionName) : "";
```

Change the unconditionally-appended style list from:

```ts
    ${katexStyle}
    ${NOTES_STYLE}
    ${PRINT_PAGINATION_STYLE}
    ${layoutOverride}
  </style>
```

to:

```ts
    ${katexStyle}
    ${NOTES_STYLE}
    ${PRINT_PAGINATION_STYLE}
    ${PRESENTATION_STYLE}
    ${layoutOverride}
    ${transitionStyle}
  </style>
```

Finally, embed the script by changing:

```ts
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
```

to:

```ts
<body>
${slidesHtml}
  <script>
    if (new URLSearchParams(location.search).has("notes")) {
      document.querySelectorAll(".notes").forEach((el) => {
        el.hidden = false;
      });
    }
  </script>
  ${PRESENTATION_SCRIPT}
</body>
</html>
`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/render.test.ts`
Expected: PASS (all tests, including every Task 2 layout test and the pre-existing theme regression tests).

- [ ] **Step 5: Format, lint, typecheck**

Run: `npx biome format --write src/render.ts tests/render.test.ts && npm run lint && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/render.ts tests/render.test.ts
git commit -m "feat(render): wire presentation mode and deck-wide transitions into generateHtml"
```

---

### Task 6: CLI integration for `--transition`

**Files:**
- Modify: `src/index.ts`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Consumes: Task 3's `TRANSITIONS`/`resolveTransitionName`; Task 5's 5-arg `generateHtml`.
- Produces: nothing further consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Add to `tests/cli.test.ts` (after the existing `describe("CLI: theme selection", ...)` block):

```ts
describe("CLI: transition selection", () => {
	it(
		"applies a transition's CSS via the --transition flag on render",
		async () => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"0",
					"--transition",
					"fade",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const body = await fetchBody(url);
			expect(body).toContain("transition: opacity");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"applies a deck's own frontmatter transition: value when no --transition flag is given",
		async () => {
			const tempDir = mkdtempSync(
				path.join(tmpdir(), "nh-deck-transition-frontmatter-"),
			);
			const tempFile = path.join(tempDir, "deck.md");
			writeFileSync(tempFile, "---\ntransition: slide\n---\n# Slide\n");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					tempFile,
					"--no-open",
					"--port",
					"0",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const body = await fetchBody(url);
			expect(body).toContain("transform: translateX");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"lets a --transition flag override a conflicting frontmatter transition: value",
		async () => {
			const tempDir = mkdtempSync(
				path.join(tmpdir(), "nh-deck-transition-override-"),
			);
			const tempFile = path.join(tempDir, "deck.md");
			writeFileSync(tempFile, "---\ntransition: fade\n---\n# Slide\n");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					tempFile,
					"--no-open",
					"--port",
					"0",
					"--transition",
					"slide",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const body = await fetchBody(url);
			expect(body).toContain("transform: translateX");
			expect(body).not.toContain("transition: opacity");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"lets --css win over a --transition flag, with a stderr note and no transition applied",
		async () => {
			const cssPath = path.join(
				tmpdir(),
				`nh-deck-transition-css-test-${randomUUID()}.css`,
			);
			writeFileSync(cssPath, ".slide { color: hotpink; }");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"0",
					"--css",
					cssPath,
					"--transition",
					"fade",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			expect(stderr).toContain("nh-deck: note:");
			expect(stderr).toContain("--css overrides the requested transition");

			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}
			const body = await fetchBody(url);
			expect(body).not.toContain("transition: opacity");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(cssPath, { force: true });
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"falls back to no transition with a warning for an unrecognized --transition name",
		async () => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"0",
					"--transition",
					"nonexistent",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			expect(stderr).toContain("nh-deck: warning:");
			expect(stderr).toContain("unknown transition");

			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}
			const body = await fetchBody(url);
			expect(body).not.toContain("transform: translateX");
			expect(body).not.toContain("transition: opacity");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"rejects --transition as an unknown option on the pdf subcommand",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-no-transition-test-${randomUUID()}.pdf`,
			);
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"pdf",
					"fixtures/sample.md",
					outputPath,
					"--transition",
					"fade",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.on("exit", resolve);
			});

			expect(exitCode).not.toBe(0);
			expect(stderr).toContain("unknown option");
			expect(existsSync(outputPath)).toBe(false);
		},
		EXIT_TIMEOUT_MS + 5_000,
	);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli.test.ts -t "transition"`
Expected: FAIL — `render` has no `--transition` option yet; the pdf-rejection test's exact stderr wording should be double-checked against Commander's real output for an unrecognized option on this repo's installed Commander version (bumped to 15.0.0 as of PR #12) before trusting the `"unknown option"` substring literally — adjust the assertion to match if Commander's actual wording differs.

- [ ] **Step 3: Write the implementation**

In `src/index.ts`, add the import:

```ts
import { resolveTransitionName, TRANSITIONS } from "./transitions.js";
```

Add a new function, placed directly after `computeEffectiveTheme`:

```ts
/**
 * Computes the effective transition name for a render invocation,
 * handling frontmatter/--transition precedence and --css mutual
 * exclusivity -- mirrors computeEffectiveTheme's exact shape and
 * precedence rules. Pure -- no side effects -- so callers can print any
 * resulting warning/note explicitly and skip printing it on a silent
 * recomputation (a --watch debounced re-render), matching this file's
 * "warn once, not on every re-render" precedent.
 */
function computeEffectiveTransition(
	frontmatterTransition: string | undefined,
	flagTransition: string | undefined,
	customCss: string | undefined,
): { name: TransitionName | undefined; message?: string } {
	const requested = flagTransition ?? frontmatterTransition;

	if (customCss) {
		if (requested) {
			return {
				name: undefined,
				message: `nh-deck: note: --css overrides the requested transition '${requested}'; it was not applied.\n`,
			};
		}
		return { name: undefined };
	}

	if (!requested) {
		return { name: undefined };
	}

	const { name, warning } = resolveTransitionName(requested);
	return {
		name,
		message: warning ? `${warning}\n` : undefined,
	};
}
```

In the `render` command's option list, add (directly after the existing `--theme` option):

```ts
	.option(
		"--transition <name>",
		`transition effect between slides in presentation mode (${TRANSITIONS.join(", ")}); overrides a deck's own frontmatter "transition:" value`,
	)
```

Update the `render` action handler's options type, from:

```ts
			options: {
				open: boolean;
				port?: number;
				watch?: boolean;
				css?: string;
				theme?: string;
			},
```

to:

```ts
			options: {
				open: boolean;
				port?: number;
				watch?: boolean;
				css?: string;
				theme?: string;
				transition?: string;
			},
```

Inside the `render` action handler, after the theme resolution block, add:

```ts
				const { name: transitionName, message: transitionMessage } =
					computeEffectiveTransition(
						frontmatter.transition,
						options.transition,
						customCss,
					);
				if (transitionMessage) {
					process.stderr.write(transitionMessage);
				}
```

Change the `generateHtml` call inside the `render` action handler from:

```ts
				const html = generateHtml(markdown, file, customCss, themeColors);
```

to:

```ts
				const html = generateHtml(
					markdown,
					file,
					customCss,
					themeColors,
					transitionName,
				);
```

Inside the `--watch` debounced `rerender` closure, after the `updatedThemeColors` recomputation, add:

```ts
							const { name: updatedTransitionName } = computeEffectiveTransition(
								updatedFrontmatter.transition,
								options.transition,
								customCss,
							);
```

Change the closure's `updateHtml`/`generateHtml` call from:

```ts
							updateHtml(
								generateHtml(
									updatedMarkdown,
									file,
									customCss,
									updatedThemeColors,
								),
							);
```

to:

```ts
							updateHtml(
								generateHtml(
									updatedMarkdown,
									file,
									customCss,
									updatedThemeColors,
									updatedTransitionName,
								),
							);
```

Do not touch the `pdf` or `png` commands at all — no `--transition` option, no `computeEffectiveTransition` call, no `transitionName` argument passed to their `generateHtml` calls.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS (all tests, including every pre-existing theme/watch test).

- [ ] **Step 5: Format, lint, typecheck**

Run: `npx biome format --write src/index.ts tests/cli.test.ts && npm run lint && npm run typecheck`

- [ ] **Step 6: Run the full suite**

Run: `pkill -f "puppeteer_dev_chrome_profile"` (clear any orphaned browser processes from a prior interrupted run before trusting timing — see the known flakiness pattern tracked in issue #19), then `npm test`.
Expected: PASS (all files).

- [ ] **Step 7: Commit**

```bash
git add src/index.ts tests/cli.test.ts
git commit -m "feat(cli): add --transition flag and frontmatter transition: support to render"
```

---

### Task 7: Real-browser presentation-mode test

**Files:**
- Create: `tests/presentationMode.test.ts`

**Interfaces:**
- Consumes: Task 5's `generateHtml` (embeds `PRESENTATION_SCRIPT`/`PRESENTATION_STYLE`), `startServer` (existing), `detectBrowserExecutable` (existing).
- Produces: nothing consumed by later tasks — this is the end-to-end proof that presentation mode's actual interactive behavior works, since string assertions alone can't verify it (see `docs/specs/templates-transitions-design.md` §5).

- [ ] **Step 1: Write the test**

There's no "failing then passing" TDD cycle for this task in the usual sense — presentation mode's behavior was already implemented and unit/string-tested in Tasks 2–6. This task adds the one kind of test this codebase doesn't have yet: real DOM interaction. Write it once, run it, and fix any real bug it finds (don't fix the test to match a wrong implementation).

Create `tests/presentationMode.test.ts`:

```ts
import puppeteer from "puppeteer-core";
import { afterEach, describe, expect, it } from "vitest";
import { detectBrowserExecutable } from "../src/browserLaunch.js";
import { generateHtml } from "../src/render.js";
import { startServer } from "../src/server.js";
import type { StartedServer } from "../src/server.js";

// Presentation mode's actual navigation behavior (keyboard/click events,
// hash persistence across reload) is real DOM interaction that no
// string-assertion test can verify. This launches a real, unmocked
// browser via the same detectBrowserExecutable() helper
// pdfExport.test.ts/pngExport.test.ts already use, rather than adding a
// different browser-automation tool for just this one feature. Budgeted
// generously (matching the PDF/PNG export tests' own timeout) since real
// browser launches are the known source of CI timing flakiness tracked
// in issue #19 -- not a reason to mock this out, just a reason not to
// under-budget it.
const PRESENTATION_TEST_TIMEOUT_MS = 60_000;

const THREE_SLIDE_DECK =
	"# Slide 1\n\nFirst.\n\n---\n\n# Slide 2\n\nSecond.\n\n---\n\n# Slide 3\n\nThird.";

let activeServer: StartedServer | undefined;
let activeBrowser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;

afterEach(async () => {
	await activeBrowser?.close();
	activeBrowser = undefined;
	activeServer?.server.close();
	activeServer = undefined;
});

async function openPresentationPage(html: string, path = "/?present") {
	activeServer = await startServer(html, 0);
	const executablePath = detectBrowserExecutable();
	activeBrowser = await puppeteer.launch({ executablePath, headless: true });
	const page = await activeBrowser.newPage();
	await page.goto(`${activeServer.url}${path}`, { waitUntil: "load" });
	return page;
}

function activeSlideHeading(page: Awaited<ReturnType<typeof openPresentationPage>>) {
	return page.evaluate(
		() => document.querySelector(".slide.is-active h1")?.textContent,
	);
}

describe("presentation mode", () => {
	it(
		"shows only the first slide when ?present is in the URL",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			const activeCount = await page.evaluate(
				() => document.querySelectorAll(".slide.is-active").length,
			);
			expect(activeCount).toBe(1);
			expect(await activeSlideHeading(page)).toBe("Slide 1");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"advances to the next slide on ArrowRight and back on ArrowLeft",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 2");

			await page.keyboard.press("ArrowLeft");
			expect(await activeSlideHeading(page)).toBe("Slide 1");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"advances on a click that is not on a link",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.click("body");

			expect(await activeSlideHeading(page)).toBe("Slide 2");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"does not advance when clicking a link inside slide content",
		async () => {
			// A same-page anchor href, not a real external URL: the click
			// handler deliberately never calls preventDefault() for a link
			// click (links inside slide content are meant to keep working
			// normally, per the design), so an external URL here would
			// genuinely navigate the page away -- this only needs to prove
			// that clicking a link never ALSO calls goTo(), which a same-page
			// hash change proves without leaving the page.
			const deckWithLink =
				"# Slide 1\n\n[a link](#somewhere)\n\n---\n\n# Slide 2\n\nSecond.";
			const page = await openPresentationPage(generateHtml(deckWithLink));

			await page.click(".slide.is-active a");

			expect(await activeSlideHeading(page)).toBe("Slide 1");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"persists the current slide across a reload via location.hash",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("ArrowRight");
			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 3");

			await page.reload({ waitUntil: "load" });

			expect(await activeSlideHeading(page)).toBe("Slide 3");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"leaves the continuous-scroll view completely unaffected without ?present",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK), "/");

			const activeCount = await page.evaluate(
				() => document.querySelectorAll(".slide.is-active").length,
			);
			expect(activeCount).toBe(0);

			const visibleSlideCount = await page.evaluate(
				() =>
					Array.from(document.querySelectorAll(".slide")).filter(
						(el) => (el as HTMLElement).offsetParent !== null,
					).length,
			);
			expect(visibleSlideCount).toBe(3);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/presentationMode.test.ts`
Expected: PASS (6/6). If any test fails, read the actual DOM/behavior it surfaces before changing the test — this is the first real end-to-end proof of presentation mode, and a failure here is more likely to be a genuine bug in Tasks 2–6's implementation than a wrong test.

- [ ] **Step 3: Format, lint, typecheck**

Run: `npx biome format --write tests/presentationMode.test.ts && npm run lint && npm run typecheck`

- [ ] **Step 4: Run the full suite one more time**

Run: `pkill -f "puppeteer_dev_chrome_profile"` (clear orphans from this task's own browser launches before the timing-sensitive full run), then `npm test`.
Expected: PASS (all files, all tests).

- [ ] **Step 5: Commit**

```bash
git add tests/presentationMode.test.ts
git commit -m "test(presentation): add real-browser end-to-end test for presentation mode navigation"
```

---

### Task 8: Documentation + ADR

**Files:**
- Modify: `AGENTS.md`
- Modify: `Context.md`
- Create: `docs/adr/0009-templates-transitions-presentation-mode.md`

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: nothing (last task).

- [ ] **Step 1: Update `AGENTS.md`'s Directory Map**

In the `src/` section of the Directory Map, add entries (alphabetically near their siblings) for:

```
    slideLayouts.ts             — LAYOUTS/resolveLayoutName/extractSlideLayout: the fixed
                                  4-layout registry (title/section/two-column/quote) and
                                  per-slide <!-- layout: name --> marker extraction
    transitions.ts                — TRANSITIONS/resolveTransitionName: the fixed
                                     2-transition registry (fade/slide)
    presentationScript.ts           — PRESENTATION_SCRIPT: client-side one-slide-at-a-time
                                       navigation for the opt-in ?present presentation mode
```

In the `tests/` section, add entries for `tests/slideLayouts.test.ts`, `tests/transitions.test.ts`, `tests/presentationScript.test.ts`, and `tests/presentationMode.test.ts`, each with a one-line description mirroring the style of the surrounding entries.

- [ ] **Step 2: Update `Context.md`'s Roadmap item 11**

Find the line:

```
**Templates and transitions remain deferred** — additional visual customization beyond `--css`/themes, evaluated each time against `SOUL.md`'s "render faithfully, don't editorialize" value, must stay opt-in, never a forced default. Needs its own brainstorming pass when reached.
```

Replace it with a "done" note in the same style as the theme system's own roadmap update (check the surrounding text for the exact phrasing precedent used when theming shipped), stating: layouts (4 fixed, per-slide, opt-in via `<!-- layout: name -->`) and transitions (2 fixed, deck-wide, opt-in via `--transition`/frontmatter `transition:`, applying only inside the new opt-in presentation mode) are both done, with a pointer to `docs/adr/0009-templates-transitions-presentation-mode.md` for the full record — including the mid-brainstorm discovery that presentation mode itself had to be built as a genuine prerequisite, not originally scoped.

- [ ] **Step 3: Write the ADR**

Create `docs/adr/0009-templates-transitions-presentation-mode.md`, following the exact section structure of `docs/adr/0008-named-theme-system.md` (Status, Context and Problem Statement, Decision Drivers, Considered Options, Decision Outcome, Consequences, Confirmation, More Information). Content to cover, drawn directly from `docs/specs/templates-transitions-design.md`:

- Context: Roadmap item 11's deferred templates/transitions, and the mid-brainstorm discovery that presentation mode (previously nonexistent) was a real prerequisite, not an original scope item.
- Decision Outcome: the 3 pieces as shipped (layouts, presentation mode, transitions) and their exact mechanisms (HTML-comment marker, `?present` URL opt-in, `--transition`/frontmatter).
- Consequences (Good): opt-in-everywhere, no CDN dependency, `--css` composability rules.
- Consequences (Bad/open risks): no in-UI exit from presentation mode; unrecognized layout names are silently ignored rather than warned (the one behavior asymmetry with themes, and why); the fixed 4-layout/2-transition sets are not user-extensible.
- Confirmation: point to the specific tests in Tasks 1–7 that verify each claim, same pattern as ADR 0008's Confirmation section.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md Context.md docs/adr/0009-templates-transitions-presentation-mode.md
git commit -m "docs: document templates/transitions/presentation-mode as shipped (Roadmap item 11)"
```

## After all 8 tasks: final whole-branch review

Dispatch a final code reviewer against the entire branch diff (`main...feat/templates-transitions`), on the most capable available model — this spans 3 new subsystems (layouts, presentation mode, transitions) touching `render.ts`'s core rendering path, not a single self-contained change. Specifically re-verify, by live testing against the built CLI (not just reading the diff):

1. A deck with no layout marker, no `--transition`/frontmatter `transition:`, and no `?present` renders and behaves identically to `main` before this branch — spot-check with `node dist/index.js render`, `pdf`, and `png` against a plain deck.
2. Each of the 4 layouts and both transitions actually looks right in a real browser (this plan's automated tests prove *mechanism*, not visual quality) — use `/browse` or equivalent to eyeball at least one deck using each layout and each transition.
3. `--watch` correctly recomputes both the layout classes (automatic, since `generateHtml` re-runs its whole pipeline on every re-render) and the transition (explicitly wired in Task 6) on a debounced save, without reprinting a transition warning on every keystroke-triggered save.
4. The full test suite passes cleanly with zero orphaned Chrome processes left over afterward (`ps aux | grep -i puppeteer_dev_chrome_profile` should be empty).

Once clean, follow `superpowers:finishing-a-development-branch` to merge/PR this branch.
