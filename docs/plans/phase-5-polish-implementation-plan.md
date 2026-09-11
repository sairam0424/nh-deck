# Phase 5 — Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four independently-shippable Phase 5 items from the roadmap on a single branch/PR: a `--css <path>` opt-out flag, presenter notes (HTML-comment convention), per-slide PDF pagination, and PNG export. Unlike Phase 4 (KaTeX/Mermaid), none of these introduce a new CDN risk or a heavy new dependency, so this phase does not need the same stop-and-ask scrutiny — but it does touch `generateHtml`'s public signature and `pdfExport.ts`'s structure, so still needs the same TDD/review rigor.

**Explicit scope authorization:** the user chose "one branch, one PR, all 4 items" over four parallel PRs (explicitly, via a direct choice) specifically to avoid repeating the cross-branch doc-reconciliation cost paid across Phases 2/3/4a/4b. All four items are sequential tasks on this one branch.

**Architecture:**
- `--css`: `generateHtml(markdown, title?, customCss?)` gains a third optional parameter. When provided, it fully replaces the baseline theme `<style>` block's content (opt-out, not merge — matches SOUL.md's "no forced theme" value literally). KaTeX's embedded font CSS and the new presenter-notes/print-pagination CSS are structural, not thematic, and stay unconditionally appended regardless of `--css`.
- Presenter notes: any standalone HTML comment (`<!-- ... -->` on its own line) inside a slide's Markdown is extracted via a new `src/presenterNotes.ts` module and rendered as a `<aside class="notes" hidden>` sibling inside that slide's `<section>`. Comments already pass through marked's `html`-type token unmodified (verified directly: they render as literal, browser-invisible HTML comments in the output today), so no change to slide *rendering* is needed — only comment *extraction* into a separate notes array. A `?notes` URL query param, checked by a small inline `<script>` (matching the precedent of Phase 3's inline SSE-reload script), removes the `hidden` attribute to reveal them. PDFs are for the audience, not the presenter, and get an explicit `@media print { .notes { display: none !important; } }` rule to guarantee they never appear in exported output regardless of the toggle state at render time.
- PDF pagination: a single `@media print { .slide { break-after: page; } }` CSS rule. Verified directly against the actual `pdfExport.ts` `page.pdf()` call (no code change needed there) — a 3-section test HTML with this exact rule produced a real 3-page PDF with zero other changes.
- PNG export: a new `src/pngExport.ts` module, `exportToPng(html, outputPath): Promise<void>`, screenshotting each `<section class="slide">` element individually via Puppeteer's `elementHandle.screenshot()` (verified directly: `page.$$('section.slide')` + per-element `.screenshot({path})` produces one correctly-sized PNG per section) and naming files by inserting `-N` before the output path's extension (`deck.png` → `deck-1.png`, `deck-2.png`, ...). A new `png <file> [output]` CLI subcommand mirrors the existing `pdf` subcommand's structure exactly. The browser-detection logic (currently duplicated verbatim if written twice) is extracted from `pdfExport.ts` into a new shared `src/browserLaunch.ts` module first, so `pngExport.ts` doesn't duplicate it.

**Tech Stack:** No new dependencies. Reuses `marked`, `puppeteer-core`, `chrome-launcher`, `commander` — all already installed.

**Spec:** `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/docs/specs/feature-implementation-roadmap-design.md` (§7, "Phase 5 — Polish")

**Everything below was verified empirically before writing this plan, not assumed:**
- Puppeteer's `page.pdf()` (the existing, unmodified call in `pdfExport.ts`) respects a plain `break-after: page` CSS rule with zero code changes: a real 3-section HTML with `.slide { break-after: page; height: 90vh; }` produced a real 3-page PDF (`/Type /Page` counted directly in the raw PDF bytes).
- `page.$$('section.slide')` returns one element handle per slide section, and `elementHandle.screenshot({ path })` produces a correctly-sized, valid PNG file per element — verified directly against a real 2-section HTML, producing two distinct, correctly-sized PNG files.
- `marked.lexer()` tokenizes a standalone HTML comment (surrounded by blank lines) as its own `html`-type token, with `.text` containing the literal comment text including its delimiters — verified directly (`<!-- speaker note: remember to breathe -->` became a token with `type: "html"`).
- That same `html`-type token already passes through `generateHtml`'s existing `marked.parser()` call unmodified into the final output today, and since it is a literal HTML comment, it is already invisible in any browser — verified directly against the current `generateHtml` output (`html.includes(rawComment)` is `true`, and HTML comments are never rendered by any browser). This means presenter-notes extraction is purely additive: existing slide rendering does not need to change to "hide" the source comment — it already is hidden, structurally.
- `resolveOutputPath`'s existing signature and guard-against-overwriting-the-source logic generalizes cleanly to a `.png` extension with a one-parameter addition (`extension = "pdf"` default), preserving the existing `pdf`-command call site's behavior unchanged.

## Global Constraints

- `generateHtml`'s existing two-parameter callers (`src/index.ts`'s `render` and `pdf` actions) must continue to work unchanged — the new `customCss` parameter is optional and defaults to preserving current behavior exactly.
- The `--css` flag is opt-in by construction — it never changes default (no-flag) behavior for any existing test or deck.
- Presenter notes must never appear in PDF/PNG export output, regardless of a `?notes` query param (which only exists in a live-served, interactive browser context) — enforced via an unconditional `@media print` rule, not by relying on the query param being absent server-side.
- The browser-detection refactor (Task 4) must not change either of `tests/pdfExport.noBrowser.test.ts`'s or `tests/pdfExport.launchFailure.test.ts`'s existing assertions — both tests' regexes must still match after the refactor, proving the extraction preserved exact existing behavior.
- No hand-rolled Markdown parsing (`AGENTS.md` Code Style) — presenter-notes detection goes through marked's own tokenizer output (`Token.type === "html"`), never a regex over raw Markdown source.
- TypeScript strict mode; ESM/NodeNext import style (`.js` extensions on relative imports); tab indentation (this project's `biome.json` mandate — verify with `npm run lint` before every commit, not just `npm test`).
- Every commit follows Conventional Commits; every change goes through a PR, even solo; CI must pass before merge; squash-merge only; branch naming `type/scope-slug`.
- A decision that changes how a deck is rendered, previewed, or exported meets this repo's own bar for a full ADR (`decisions.md`) — this phase's four shipped items qualify (one ADR covering all four, since they're one cohesive phase on one branch, not four separate ADRs).

## Setup (before Task 1)

- [ ] **Create and check out the feature branch, off current `main`**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/polish-phase5
```

---

### Task 1: `--css <path>` opt-out flag

**Files:**
- Modify: `src/render.ts`
- Modify: `src/index.ts`
- Modify: `tests/render.test.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Produces: `generateHtml(markdown: string, title?: string, customCss?: string): string` — new optional third parameter. `undefined` (the default) preserves current behavior exactly.

- [ ] **Step 1: Write the failing tests**

Add to `tests/render.test.ts`, as a new `describe` block after `describe("generateHtml — Mermaid diagrams", ...)`:

```ts
describe("generateHtml — custom CSS opt-out", () => {
	it("uses the default baseline stylesheet when no custom CSS is given", () => {
		const html = generateHtml("# Slide");

		expect(html).toContain("font-family: -apple-system");
	});

	it("fully replaces the baseline stylesheet when custom CSS is given", () => {
		const html = generateHtml("# Slide", undefined, ".slide { color: hotpink; }");

		expect(html).toContain(".slide { color: hotpink; }");
		expect(html).not.toContain("font-family: -apple-system");
	});

	it("still embeds KaTeX CSS/fonts alongside custom CSS when math is present", () => {
		const html = generateHtml("Math: $x^2$.", undefined, ".slide { color: hotpink; }");

		expect(html).toContain(".slide { color: hotpink; }");
		expect(html).toContain("KaTeX_Main");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/render.test.ts -t "custom CSS opt-out"`
Expected: FAIL — `generateHtml` doesn't accept a third parameter yet.

- [ ] **Step 3: Write the implementation**

In `src/render.ts`, change the `generateHtml` function signature and body. Change:

```ts
export function generateHtml(markdown: string, title?: string): string {
```

to:

```ts
export function generateHtml(
	markdown: string,
	title?: string,
	customCss?: string,
): string {
```

Then find the baseline `<style>` block's content — the large block of CSS starting at `:root { color-scheme: light dark; }` and ending at the closing `.slide { border-bottom-color: #333333; }\n    }` (just before `${katexStyle}`). Wrap that entire baseline block in a conditional: when `customCss` is provided, emit `customCss` verbatim instead of the baseline block. The `${katexStyle}` (and, once Task 3 lands, the print-pagination rule) must remain unconditionally appended after either branch — do not make those conditional on `customCss`.

Concretely, change the template literal's `<style>` section from:

```ts
  <style>
    :root {
      color-scheme: light dark;
    }
    body {
      ...
    }
    ...
    @media (prefers-color-scheme: dark) {
      ...
      .slide { border-bottom-color: #333333; }
    }
    ${katexStyle}
  </style>
```

to:

```ts
  <style>
${
	customCss ??
	`    :root {
      color-scheme: light dark;
    }
    body {
      ...
    }
    ...
    @media (prefers-color-scheme: dark) {
      ...
      .slide { border-bottom-color: #333333; }
    }`
}
    ${katexStyle}
  </style>
```

(Preserve every line of the existing baseline CSS block exactly as it is today inside that template-literal string — this step is purely "wrap the existing block in a `customCss ?? \`...\`` conditional," not a rewrite of its content. Read the current file before editing so you copy the exact existing CSS verbatim.)

- [ ] **Step 4: Add the CLI wiring**

In `src/index.ts`, add a `--css <path>` option to both the `render` and `pdf` commands, and read the file before calling `generateHtml`. Change the `render` command's option chain — after `.option("--watch", ...)`, add:

```ts
	.option("--css <path>", "path to a custom CSS file that fully replaces the default stylesheet")
```

Change the `render` action's signature and body — change:

```ts
		async (
			file: string,
			options: { open: boolean; port?: number; watch?: boolean },
		) => {
			try {
				const markdown = readFileSync(file, "utf8");
				const html = generateHtml(markdown, file);
```

to:

```ts
		async (
			file: string,
			options: { open: boolean; port?: number; watch?: boolean; css?: string },
		) => {
			try {
				const customCss = options.css
					? readFileSync(options.css, "utf8")
					: undefined;
				const markdown = readFileSync(file, "utf8");
				const html = generateHtml(markdown, file, customCss);
```

And inside the `--watch` re-render closure, change:

```ts
						updateHtml(generateHtml(updatedMarkdown, file));
```

to:

```ts
						updateHtml(generateHtml(updatedMarkdown, file, customCss));
```

For the `pdf` command, add the same `.option("--css <path>", ...)` to its chain, and change its action's signature from `async (file: string, output?: string) => {` to `async (file: string, output?: string, options?: { css?: string }) => {` — verified directly against a real Commander invocation: for a `command("pdf <file> [output]")` with an added `--css` option, the action callback receives `(file, output, options)` in that exact order, with `output` correctly `undefined` when the caller omits it (`options` is always the final argument, after every declared positional parameter). Thread `customCss` through to `generateHtml` the same way as the `render` command.

- [ ] **Step 5: Add a CLI-level test**

Add to `tests/cli.test.ts`, inside the existing `describe("CLI: nh-deck render", ...)` block, alongside its one existing test. This follows that file's established idiom exactly: spawn the real CLI via `node --import tsx`, wait for the serving-URL line via the file's existing `waitForServingLine` helper, then fetch the served page over real HTTP to assert on its actual body (the file's live-reload test already does an HTTP GET against the running server the same way, via `node:http`, which is already imported at the top of this file):

```ts
	it(
		"renders with a custom --css file, fully replacing the default stylesheet",
		async () => {
			const cssPath = path.join(
				tmpdir(),
				`nh-deck-custom-css-test-${randomUUID()}.css`,
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
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const body = await new Promise<string>((resolve, reject) => {
				http
					.get(url, (res) => {
						let data = "";
						res.on("data", (chunk: Buffer) => {
							data += chunk.toString();
						});
						res.on("end", () => resolve(data));
						res.on("error", reject);
					})
					.on("error", reject);
			});

			expect(body).toContain(".slide { color: hotpink; }");
			expect(body).not.toContain("font-family: -apple-system");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(cssPath, { force: true });
		},
		TEST_TIMEOUT_MS,
	);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/render.test.ts tests/cli.test.ts`
Expected: PASS — new tests pass, all pre-existing tests in both files unaffected.

- [ ] **Step 7: Run the full test suite, lint, and typecheck**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS, zero lint/typecheck errors.

- [ ] **Step 8: Commit**

```bash
git add src/render.ts src/index.ts tests/render.test.ts tests/cli.test.ts
git commit -m "feat(render): add --css opt-out flag for the baseline stylesheet"
```

---

### Task 2: Presenter notes

**Files:**
- Create: `src/presenterNotes.ts`
- Create: `tests/presenterNotes.test.ts`
- Modify: `src/render.ts`
- Modify: `tests/render.test.ts`

**Interfaces:**
- Produces: `extractNotes(tokens: Token[]): string[]` — given one slide's token group (the same `Token[]` shape `splitIntoSlides` already produces), returns the trimmed text of every standalone HTML-comment token in that group, in order. Used by Task 2's `render.ts` change.

- [ ] **Step 1: Write the failing tests**

Create `tests/presenterNotes.test.ts`:

```ts
import { marked } from "marked";
import { describe, expect, it } from "vitest";
import { extractNotes } from "../src/presenterNotes.js";

describe("extractNotes", () => {
	it("extracts a single standalone HTML comment's trimmed text", () => {
		const tokens = marked.lexer(
			"# Slide\n\nText.\n\n<!-- remember to breathe -->\n\nMore text.",
		);

		expect(extractNotes(tokens)).toEqual(["remember to breathe"]);
	});

	it("extracts multiple standalone comments in document order", () => {
		const tokens = marked.lexer(
			"# Slide\n\n<!-- first note -->\n\nText.\n\n<!-- second note -->\n",
		);

		expect(extractNotes(tokens)).toEqual(["first note", "second note"]);
	});

	it("returns an empty array when there are no comments", () => {
		const tokens = marked.lexer("# Slide\n\nJust text, no notes.");

		expect(extractNotes(tokens)).toEqual([]);
	});

	it("ignores non-comment HTML tokens", () => {
		const tokens = marked.lexer("# Slide\n\n<div>not a comment</div>\n");

		expect(extractNotes(tokens)).toEqual([]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/presenterNotes.test.ts`
Expected: FAIL — `src/presenterNotes.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/presenterNotes.ts`:

```ts
import type { Token } from "marked";

const HTML_COMMENT_PATTERN = /^<!--([\s\S]*?)-->/;

/**
 * Extracts presenter notes from one slide's token group: the trimmed text
 * of every standalone HTML comment (marked's own tokenizer already emits
 * a comment on its own line as a distinct "html"-type token, verified
 * directly against marked's lexer output -- this never needs a regex over
 * raw Markdown source). Comments already pass through unmodified into
 * generateHtml's rendered output today and are already invisible in any
 * browser (a real HTML comment is never rendered) -- this function only
 * extracts their text for separate display, it does not need to hide
 * anything that isn't already hidden.
 */
export function extractNotes(tokens: Token[]): string[] {
	const notes: string[] = [];
	for (const token of tokens) {
		if (token.type === "html") {
			const match = token.text.match(HTML_COMMENT_PATTERN);
			if (match) {
				notes.push(match[1].trim());
			}
		}
	}
	return notes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/presenterNotes.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Wire notes rendering into `render.ts`**

Add the failing tests first, to `tests/render.test.ts`, as a new `describe` block:

```ts
describe("generateHtml — presenter notes", () => {
	it("renders a slide's HTML comment as a hidden aside with class notes", () => {
		const html = generateHtml("# Slide\n\n<!-- speaker note here -->\n");

		expect(html).toContain('<aside class="notes" hidden>speaker note here</aside>');
	});

	it("renders no aside when a slide has no comments", () => {
		const html = generateHtml("# Slide\n\nNo notes here.");

		expect(html).not.toContain('class="notes"');
	});

	it("includes an inline script that reveals notes when ?notes is present", () => {
		const html = generateHtml("# Slide\n\n<!-- a note -->\n");

		expect(html).toContain("URLSearchParams");
		expect(html).toContain(".notes");
	});

	it("always hides notes in print media, regardless of the ?notes toggle", () => {
		const html = generateHtml("# Slide\n\n<!-- a note -->\n");

		expect(html).toMatch(/@media print[^}]*\.notes[^}]*display:\s*none/);
	});
});
```

Run: `npx vitest run tests/render.test.ts -t "presenter notes"` — expect FAIL (nothing wired up yet).

Then modify `src/render.ts`: add `import { extractNotes } from "./presenterNotes.js";` near the top (alongside the other local imports). In the `splitIntoSlides(tokens).map(...)` call inside `generateHtml`, change:

```ts
	const slidesHtml = splitIntoSlides(tokens)
		.map(
			(slideTokens) =>
				`<section class="slide">\n${marked.parser(slideTokens)}</section>`,
		)
		.join("\n");
```

to:

```ts
	const slidesHtml = splitIntoSlides(tokens)
		.map((slideTokens) => {
			const notesHtml = extractNotes(slideTokens)
				.map((note) => `<aside class="notes" hidden>${escapeHtml(note)}</aside>`)
				.join("\n");
			return `<section class="slide">\n${marked.parser(slideTokens)}${notesHtml}</section>`;
		})
		.join("\n");
```

Then add the notes CSS and toggle script. This CSS must be present regardless of `customCss` (it is structural, like `${katexStyle}`, not thematic), so it does NOT go inside the `customCss ?? \`...\`` conditional block from Task 1 — it is its own separate, always-appended block, sitting alongside `${katexStyle}` and (once Task 3 lands) the print-pagination rule, all after the closing `</style>`-block conditional's tag. Concretely, define a new constant near the top of the file (alongside where `getEmbeddedKatexCss` is imported) and reference it unconditionally in the template, the same way `${katexStyle}` already is:

```ts
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
```

Then, inside `generateHtml`'s returned template literal, change:

```ts
    ${katexStyle}
  </style>
```

to:

```ts
    ${katexStyle}
    ${NOTES_STYLE}
  </style>
```

Then, right before the closing `</body>` tag, add an inline script (unconditional, always present):

```html
  <script>
    if (new URLSearchParams(location.search).has("notes")) {
      document.querySelectorAll(".notes").forEach((el) => {
        el.hidden = false;
      });
    }
  </script>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/render.test.ts tests/presenterNotes.test.ts`
Expected: PASS — all new tests, and every pre-existing test in `render.test.ts` unaffected.

- [ ] **Step 7: Run the full test suite, lint, and typecheck**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/presenterNotes.ts src/render.ts tests/presenterNotes.test.ts tests/render.test.ts
git commit -m "feat(render): add presenter notes via HTML-comment convention"
```

---

### Task 3: Per-slide PDF pagination

**Files:**
- Modify: `src/render.ts`
- Modify: `tests/render.test.ts`
- Modify: `tests/pdfExport.test.ts`

**Interfaces:** N/A (CSS-only change; no function signature changes).

- [ ] **Step 1: Write the failing tests**

Add to `tests/render.test.ts`, as a new `describe` block:

```ts
describe("generateHtml — PDF pagination", () => {
	it("includes a print-media rule that breaks after each slide", () => {
		const html = generateHtml("# Slide 1\n\n---\n\n# Slide 2");

		expect(html).toMatch(/@media print[^}]*\.slide[^}]*break-after:\s*page/);
	});
});
```

Run: `npx vitest run tests/render.test.ts -t "PDF pagination"` — expect FAIL.

- [ ] **Step 2: Write the implementation**

In `src/render.ts`, add a new constant near `NOTES_STYLE` (from Task 2):

```ts
const PRINT_PAGINATION_STYLE = `
    @media print {
      .slide {
        break-after: page;
      }
    }`;
```

Then, inside `generateHtml`'s returned template literal, change:

```ts
    ${katexStyle}
    ${NOTES_STYLE}
  </style>
```

to:

```ts
    ${katexStyle}
    ${NOTES_STYLE}
    ${PRINT_PAGINATION_STYLE}
  </style>
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run tests/render.test.ts`
Expected: PASS.

- [ ] **Step 4: Add a real end-to-end PDF page-count test**

`tests/pdfExport.test.ts` already imports `generateHtml` and already declares a shared `activeOutputPath` variable with an `afterEach` that cleans it up — this new test reuses both exactly as the file's one existing test does. Add this second test case inside the same `describe("exportToPdf", ...)` block, right after the existing one:

```ts
	it(
		"produces one PDF page per slide when the deck has multiple slides",
		async () => {
			const html = generateHtml(
				"# Slide 1\n\nFirst.\n\n---\n\n# Slide 2\n\nSecond.\n\n---\n\n# Slide 3\n\nThird.",
			);
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-pagination-test-${randomUUID()}.pdf`,
			);
			activeOutputPath = outputPath;

			await exportToPdf(html, outputPath);

			const pdfBytes = readFileSync(outputPath);
			const pageCount = (
				pdfBytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []
			).length;
			expect(pageCount).toBe(3);
		},
		PDF_EXPORT_TIMEOUT_MS,
	);
```

- [ ] **Step 5: Run the full test suite, lint, and typecheck**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS. The new PDF test is real and unmocked (matches this repo's existing convention for `pdfExport.test.ts`) — it will take real wall-clock time; that is expected, not a bug.

- [ ] **Step 6: Commit**

```bash
git add src/render.ts tests/render.test.ts tests/pdfExport.test.ts
git commit -m "feat(render): add per-slide PDF pagination via print-media CSS"
```

---

### Task 4: Extract shared browser-detection helper

**Files:**
- Create: `src/browserLaunch.ts`
- Create: `tests/browserLaunch.test.ts`
- Modify: `src/pdfExport.ts`
- Modify: `tests/pdfExport.noBrowser.test.ts` (verify only — see Step 4)

**Interfaces:**
- Produces: `detectBrowserExecutable(): string` — throws the existing "No local Chrome, Chromium, Edge, or Brave installation was found..." error (verbatim on its distinctive first sentence) if `chrome-launcher`'s `Launcher.getInstallations()` returns nothing; otherwise returns the first installation path. Used by Task 5's `pngExport.ts`.

This task is a pure refactor: it must not change either `tests/pdfExport.noBrowser.test.ts`'s or `tests/pdfExport.launchFailure.test.ts`'s existing behavior or assertions.

- [ ] **Step 1: Write the failing tests for the new module**

Create `tests/browserLaunch.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("chrome-launcher", async () => {
	const actual =
		await vi.importActual<typeof import("chrome-launcher")>("chrome-launcher");
	return {
		...actual,
		Launcher: { ...actual.Launcher, getInstallations: () => [] },
	};
});

describe("detectBrowserExecutable — no browser installed", () => {
	it("throws a clear, actionable error", async () => {
		const { detectBrowserExecutable } = await import("../src/browserLaunch.js");

		expect(() => detectBrowserExecutable()).toThrow(
			/No local Chrome, Chromium, Edge, or Brave installation was found/,
		);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/browserLaunch.test.ts`
Expected: FAIL — `src/browserLaunch.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Read the current `src/pdfExport.ts` first (its exact current content, since you are about to extract from it verbatim). Create `src/browserLaunch.ts`:

```ts
import { Launcher } from "chrome-launcher";

/**
 * Detects a locally-installed Chrome/Chromium/Edge/Brave browser via
 * chrome-launcher and returns its executable path. No Chromium is bundled
 * or downloaded -- throws a clear, descriptive Error if none is found,
 * shared by every export path (PDF, PNG) that needs a local browser.
 */
export function detectBrowserExecutable(): string {
	const installations = Launcher.getInstallations();

	if (!installations || installations.length === 0) {
		throw new Error(
			"No local Chrome, Chromium, Edge, or Brave installation was found. " +
				"nh-deck requires one of these browsers to be installed on this machine to export decks. " +
				"An automatic download fallback is a planned but not-yet-implemented feature.",
		);
	}

	// installations[0] is intentional, not a missing-selection-logic bug:
	// chrome-launcher's own README documents that "the first installation
	// returned from this method is used instead" when no explicit chromePath
	// is given, and getInstallations() returns paths in decreasing priority
	// order per platform. Do not add custom selection logic here.
	return installations[0];
}
```

Then modify `src/pdfExport.ts`: remove the duplicated detection block and import the shared helper instead. Change:

```ts
import { Launcher } from "chrome-launcher";
import puppeteer from "puppeteer-core";
```

to:

```ts
import { detectBrowserExecutable } from "./browserLaunch.js";
import puppeteer from "puppeteer-core";
```

and change:

```ts
	const installations = Launcher.getInstallations();

	if (!installations || installations.length === 0) {
		throw new Error(
			"No local Chrome, Chromium, Edge, or Brave installation was found. " +
				"nh-deck requires one of these browsers to be installed on this machine to export PDFs. " +
				"An automatic download fallback is a planned but not-yet-implemented feature.",
		);
	}

	// installations[0] is intentional, not a missing-selection-logic bug:
	// chrome-launcher's own README documents that "the first installation
	// returned from this method is used instead" when no explicit chromePath
	// is given, and getInstallations() returns paths in decreasing priority
	// order per platform. Do not add custom selection logic here.
	const executablePath = installations[0];
```

to:

```ts
	const executablePath = detectBrowserExecutable();
```

Everything else in `pdfExport.ts` (the `puppeteer.launch()` call, its own try/catch/finally, the `page.pdf()` call, the "Failed to export PDF using..." error wrapping) stays exactly as it is today — only the detection block itself moves.

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `npx vitest run tests/browserLaunch.test.ts tests/pdfExport.noBrowser.test.ts tests/pdfExport.launchFailure.test.ts`
Expected: PASS, all three files, with zero changes needed to the two pre-existing `pdfExport.*.test.ts` files' own content — their existing regex assertions must still match verbatim. If either pre-existing test needs an edit to pass, stop and reconsider: that would mean the refactor changed real behavior, not just moved code, which this task does not authorize.

- [ ] **Step 5: Run the full test suite, lint, and typecheck**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/browserLaunch.ts src/pdfExport.ts tests/browserLaunch.test.ts
git commit -m "refactor(pdfExport): extract shared browser-detection helper"
```

---

### Task 5: PNG export

**Files:**
- Create: `src/pngExport.ts`
- Create: `tests/pngExport.test.ts`
- Modify: `src/cliHelpers.ts`
- Modify: `tests/cliHelpers.test.ts`
- Modify: `src/index.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `detectBrowserExecutable(): string` (Task 4).
- Produces: `exportToPng(html: string, outputPath: string): Promise<string[]>` — screenshots each `<section class="slide">` to its own PNG file, named by inserting `-N` (1-indexed) before `outputPath`'s extension, and returns the list of file paths actually written, in slide order.
- Produces: `resolveOutputPath(file: string, output: string | undefined, extension: string): string` — Task 5 generalizes the existing two-parameter `resolveOutputPath` (from Task/Phase 1) with a third, required-with-default `extension` parameter (`"pdf"` default), so the existing `pdf` command's call site (`resolveOutputPath(file, output)`) continues to work unchanged.

- [ ] **Step 1: Write the failing tests for `resolveOutputPath`'s extension parameter**

Add to `tests/cliHelpers.test.ts`, inside the existing `describe("resolveOutputPath", ...)` block:

```ts
	it("derives a .png path when an extension is explicitly given", () => {
		expect(resolveOutputPath("deck.md", undefined, "png")).toBe("deck.png");
	});

	it("still defaults to .pdf when no extension is given (backward compatibility)", () => {
		expect(resolveOutputPath("deck.md")).toBe("deck.pdf");
	});
```

Run: `npx vitest run tests/cliHelpers.test.ts -t "resolveOutputPath"` — expect the new `.png` case to FAIL (the backward-compatibility case should already pass).

- [ ] **Step 2: Update `resolveOutputPath`**

In `src/cliHelpers.ts`, change:

```ts
export function resolveOutputPath(file: string, output?: string): string {
	const outputPath =
		output ??
		(extname(file) === ".md" ? file.replace(/\.md$/, ".pdf") : `${file}.pdf`);
```

to:

```ts
export function resolveOutputPath(
	file: string,
	output?: string,
	extension = "pdf",
): string {
	const outputPath =
		output ??
		(extname(file) === ".md"
			? file.replace(/\.md$/, `.${extension}`)
			: `${file}.${extension}`);
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run tests/cliHelpers.test.ts`
Expected: PASS, all cases including every pre-existing one.

- [ ] **Step 4: Write the failing tests for `exportToPng`**

Create `tests/pngExport.test.ts`, matching `tests/pdfExport.test.ts`'s existing style (real, unmocked export against a real detected browser; read that file first to copy its temp-directory/cleanup conventions exactly):

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateHtml } from "../src/render.js";
import { exportToPng } from "../src/pngExport.js";

describe("exportToPng", () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("produces one real PNG file per slide, correctly named and non-empty", async () => {
		dir = mkdtempSync(join(tmpdir(), "nh-deck-png-test-"));
		const outputPath = join(dir, "deck.png");
		const html = generateHtml(
			"# Slide 1\n\nFirst.\n\n---\n\n# Slide 2\n\nSecond.",
		);

		const written = await exportToPng(html, outputPath);

		expect(written).toEqual([
			join(dir, "deck-1.png"),
			join(dir, "deck-2.png"),
		]);
		for (const path of written) {
			const bytes = readFileSync(path);
			// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
			expect(bytes.subarray(0, 8)).toEqual(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			);
		}
	}, 30_000);
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run tests/pngExport.test.ts`
Expected: FAIL — `src/pngExport.ts` doesn't exist yet.

- [ ] **Step 6: Write the implementation**

Create `src/pngExport.ts`:

```ts
import { detectBrowserExecutable } from "./browserLaunch.js";
import puppeteer from "puppeteer-core";

/**
 * Renders the given HTML and screenshots each `<section class="slide">`
 * to its own PNG file, using a locally-installed Chrome/Chromium/Edge/Brave
 * browser detected via chrome-launcher (see browserLaunch.ts). File names
 * are derived by inserting "-N" (1-indexed) before outputPath's extension,
 * e.g. "deck.png" -> "deck-1.png", "deck-2.png", ... Returns the list of
 * file paths actually written, in slide order.
 */
export async function exportToPng(
	html: string,
	outputPath: string,
): Promise<string[]> {
	const executablePath = detectBrowserExecutable();

	let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
	try {
		browser = await puppeteer.launch({ executablePath, headless: true });
		const page = await browser.newPage();
		await page.setContent(html, { waitUntil: "load" });
		const sections = await page.$$("section.slide");

		const written: string[] = [];
		for (let i = 0; i < sections.length; i++) {
			const path = insertSlideNumber(outputPath, i + 1);
			await sections[i].screenshot({ path });
			written.push(path);
		}
		await page.close();
		return written;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to export PNG using ${executablePath}: ${message}`);
	} finally {
		await browser?.close();
	}
}

function insertSlideNumber(outputPath: string, slideNumber: number): string {
	const lastDot = outputPath.lastIndexOf(".");
	if (lastDot === -1) {
		return `${outputPath}-${slideNumber}`;
	}
	return `${outputPath.slice(0, lastDot)}-${slideNumber}${outputPath.slice(lastDot)}`;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/pngExport.test.ts`
Expected: PASS.

- [ ] **Step 8: Add the `png` CLI subcommand**

In `src/index.ts`, add `import { exportToPng } from "./pngExport.js";` alongside the other local imports, and add a new command after the existing `pdf` command:

```ts
program
	.command("png <file> [output]")
	.description("Export a Markdown deck to one PNG per slide.")
	.action(async (file: string, output?: string) => {
		try {
			const markdown = readFileSync(file, "utf8");
			const html = generateHtml(markdown, file);
			const outputPath = resolveOutputPath(file, output, "png");

			const written = await exportToPng(html, outputPath);
			process.stdout.write(
				`Wrote ${written.length} PNG file(s), starting at ${written[0]}\n`,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`nh-deck: ${message}\n`);
			process.exitCode = 1;
		}
	});
```

- [ ] **Step 9: Add a CLI-level test**

Add a new `describe("CLI: nh-deck png", ...)` block to `tests/cli.test.ts`, right after the existing `describe("CLI: nh-deck pdf", ...)` block, following that block's exact idiom (spawn the real binary, `waitForExit`, check stdout + file existence + magic bytes):

```ts
describe("CLI: nh-deck png", () => {
	it(
		"exports one PNG per slide and reports the first output path on stdout",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-cli-png-test-${randomUUID()}.png`,
			);
			const firstSlidePath = outputPath.replace(/\.png$/, "-1.png");
			const secondSlidePath = outputPath.replace(/\.png$/, "-2.png");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"png",
					"fixtures/sample.md",
					outputPath,
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

			expect(stdout).toContain(`Wrote ${5} PNG file(s), starting at ${firstSlidePath}`);
			expect(existsSync(firstSlidePath)).toBe(true);
			expect(existsSync(secondSlidePath)).toBe(true);

			const fileContents = readFileSync(firstSlidePath);
			expect(fileContents.subarray(0, 8)).toEqual(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			);

			rmSync(firstSlidePath, { force: true });
			rmSync(secondSlidePath, { force: true });
			// fixtures/sample.md has 5 slides as of Phase 4b -- clean up the rest too.
			for (let n = 3; n <= 5; n++) {
				rmSync(outputPath.replace(/\.png$/, `-${n}.png`), { force: true });
			}
		},
		PDF_EXPORT_TIMEOUT_MS,
	);
});
```

(`fixtures/sample.md` has 5 slides as of the Mermaid phase (Phase 4b) — verify the exact current slide count by reading the fixture directly before writing this test's `Wrote ${N} PNG file(s)` assertion and cleanup loop bound, rather than trusting this plan's "5"; the fixture may have changed since this plan was written.)

- [ ] **Step 10: Run the full test suite, lint, and typecheck**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/pngExport.ts src/cliHelpers.ts src/index.ts tests/pngExport.test.ts tests/cliHelpers.test.ts tests/cli.test.ts
git commit -m "feat(png): add PNG export via a new png subcommand"
```

---

### Task 6: Record the decision (ADR) and reconcile the roadmap

**Files:**
- Create: `docs/adr/0006-phase-5-polish.md`
- Modify: `decisions.md` (ADR Index)
- Modify: `Context.md` (Roadmap items 6, 10, 12 → done)
- Modify: `fixtures/sample.md` (optional: add a presenter-note example)
- Modify: `tests/render.test.ts` (if the fixture changes)

**Interfaces:** N/A (docs only, plus an optional fixture extension).

- [ ] **Step 1: Write the ADR**

Create `docs/adr/0006-phase-5-polish.md`, following the same Michael Nygard-style structure as `docs/adr/0001` through `0005` (Status/Context and Problem Statement/Decision Drivers/Considered Options/Decision Outcome/Consequences/Confirmation/More Information). Cover all four shipped items in one ADR (they landed as one cohesive phase, on one branch, by explicit user choice to avoid the cross-branch reconciliation cost paid across Phases 2–4b):

- The `--css` opt-in-replacement design (chosen over a merge/append design, for predictability and directness with SOUL.md's "no forced theme" value).
- Presenter notes' extraction-via-marked-tokenizer + `?notes`-toggle design (chosen over Marpit's directive-comment convention, which this project has no directive system to support, and over reveal.js's postMessage companion-window design, which is meaningfully more complex to implement and verify for a first pass).
- The verified, zero-code-change PDF-pagination mechanism.
- The PNG-export design and the `detectBrowserExecutable` extraction it motivated.

- [ ] **Step 2: Add the ADR Index row**

Read `decisions.md`'s current ADR Index table first (its exact last row depends on the actual current state of `main` when this task runs), then append:

```markdown
| 0006 | [Phase 5 polish: --css opt-out, presenter notes, PDF pagination, PNG export](docs/adr/0006-phase-5-polish.md) | Accepted | <today's date> | —          |
```

- [ ] **Step 3: Mark Roadmap items done in `Context.md`**

Read the current Roadmap section first (its exact numbering depends on the actual current state of `main`). Mark the `--css` item, the presenter-notes/PDF-pagination item, and the PNG-export item all as done, in the same struck-through style as every other completed item, each referencing `docs/adr/0006-phase-5-polish.md`. Update the "Last updated" footer to today's date.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0006-phase-5-polish.md decisions.md Context.md
git commit -m "docs: record ADR-0006 (Phase 5 polish) and mark Roadmap items done"
```

---

## After all tasks: open the PR

```bash
git push -u origin feat/polish-phase5
```

Then open a PR against `main` per `Branches.md`'s PR-required policy (squash-merge only; the squash commit message must itself be a valid Conventional Commit — e.g. `feat: Phase 5 polish (--css opt-out, presenter notes, PDF pagination, PNG export)`). Wait for CI to go green across all 9 matrix combinations before merging.

**No cross-branch doc-reconciliation friction expected this time** — since this is the only open feature branch at the time it's cut (Phases 2–4b all merged before this plan was written), `Context.md`/`decisions.md` should be in their final, settled state throughout this phase's execution, unlike every prior phase.
