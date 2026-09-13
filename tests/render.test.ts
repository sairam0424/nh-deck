import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { afterEach, describe, expect, it } from "vitest";
import { detectBrowserExecutable } from "../src/browserLaunch.js";
import { containsUnsafeHtml, generateHtml } from "../src/render.js";
import type { StartedServer } from "../src/server.js";
import { startServer } from "../src/server.js";
import { THEMES } from "../src/themes.js";

// NOTE on the ".js" import extension above: this project uses TypeScript's
// NodeNext module resolution (see src/index.ts, which imports "./render.js"
// even though only render.ts exists on disk). Vitest's own module loader
// resolves that specifier straight to src/render.ts, so tests follow the same
// convention as the rest of the source tree rather than importing "../src/render.ts".

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const fixturePath = path.join(repoRoot, "fixtures", "sample.md");
const fixtureMarkdown = readFileSync(fixturePath, "utf8");

// The quote-layout CSS specificity bug (a lone paragraph is trivially also
// :last-of-type) can only be proven wrong -- or proven fixed -- by asking a
// real browser to resolve the cascade via getComputedStyle(); a string
// assertion on the CSS text can't tell you which rule actually won. This
// launches a real, unmocked browser via the same detectBrowserExecutable()
// helper presentationMode.test.ts/pdfExport.test.ts already use. Budgeted
// generously (matching those tests' own timeout) for the same reason.
const STYLE_TEST_TIMEOUT_MS = 60_000;

let activeServer: StartedServer | undefined;
let activeBrowser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;

afterEach(async () => {
	await activeBrowser?.close();
	activeBrowser = undefined;
	activeServer?.server.close();
	activeServer = undefined;
});

async function openHtmlPage(html: string) {
	activeServer = await startServer(html, 0);
	const executablePath = detectBrowserExecutable();
	activeBrowser = await puppeteer.launch({ executablePath, headless: true });
	const page = await activeBrowser.newPage();
	await page.goto(activeServer.url, { waitUntil: "load" });
	return page;
}

async function quoteParagraphStyles(
	page: Awaited<ReturnType<typeof openHtmlPage>>,
) {
	return page.evaluate(() =>
		Array.from(document.querySelectorAll(".slide.layout-quote p")).map((p) => {
			const computed = getComputedStyle(p);
			return { fontSize: computed.fontSize, fontStyle: computed.fontStyle };
		}),
	);
}

describe("generateHtml", () => {
	it("renders a complete, self-contained HTML document", () => {
		const html = generateHtml(fixtureMarkdown, "sample");

		expect(html).toContain("<!DOCTYPE");
		expect(html).toContain("<html");
		expect(html).toContain("</html>");
	});

	it("renders the fixture's heading and code block content", () => {
		const html = generateHtml(fixtureMarkdown, "sample");

		expect(html).toContain("<h1>Getting Started with nh-deck</h1>");
		expect(html).toContain("nh-deck render fixtures/sample.md --port 4000");
		expect(html).toContain("<pre><code");
	});

	it("renders the fixture's bullet list", () => {
		const html = generateHtml(fixtureMarkdown, "sample");

		expect(html).toContain("<ul>");
		expect(html).toContain(
			"<li>Render Markdown to a self-contained HTML document</li>",
		);
	});

	it("renders the fixture's fourth slide with KaTeX math", () => {
		const html = generateHtml(fixtureMarkdown, "sample");

		expect(html).toContain("<h1>A Quick Formula</h1>");
		expect(html).toContain('class="katex"');
	});

	it("renders the fixture's Mermaid diagram section", () => {
		const html = generateHtml(fixtureMarkdown, "sample");

		expect(html).toContain("<h2>A Quick Diagram</h2>");
		expect(html).toContain("<svg");
	});

	it("never references an external CDN (local-first constraint)", () => {
		const html = generateHtml(fixtureMarkdown, "sample");

		expect(html).not.toMatch(/https?:\/\/cdn\./i);
		expect(html).not.toContain("unpkg.com");
		expect(html).not.toContain("jsdelivr.net");
		expect(html).not.toContain("cdnjs.cloudflare.com");
	});

	it('splits the fixture into five <section class="slide"> blocks on its --- delimiters', () => {
		const html = generateHtml(fixtureMarkdown, "sample");
		const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
		expect(sectionCount).toBe(5);
	});

	it("renders each of the fixture's slide headings inside its own section", () => {
		const html = generateHtml(fixtureMarkdown, "sample");

		expect(html).toContain("<h1>Getting Started with nh-deck</h1>");
		expect(html).toContain("<h1>Presenting Your Deck</h1>");
		expect(html).toContain("<h1>Exporting to PDF</h1>");
		expect(html).toContain("<h1>A Quick Formula</h1>");
		expect(html).toContain("<h2>A Quick Diagram</h2>");
	});

	it("produces byte-identical output with no theme argument (regression guard for the CSS custom-properties refactor)", () => {
		const withoutTheme = generateHtml(fixtureMarkdown, "sample");
		const withUndefinedTheme = generateHtml(
			fixtureMarkdown,
			"sample",
			undefined,
			undefined,
		);

		expect(withUndefinedTheme).toBe(withoutTheme);
		// Baseline hardcoded colors from the pre-refactor stylesheet must still
		// appear literally in the default (no-theme) output.
		expect(withoutTheme).toContain("#1a1a1a");
		expect(withoutTheme).toContain("#ffffff");
		expect(withoutTheme).toContain("@media (prefers-color-scheme: dark)");
		expect(withoutTheme).toContain("#e6e6e6");
		expect(withoutTheme).toContain("#121212");
	});

	it("recolors Mermaid diagrams to match the active theme", () => {
		const deckWithDiagram = "```mermaid\nflowchart TD\n  A --> B\n```\n";

		const lightHtml = generateHtml(deckWithDiagram, "sample", undefined, {
			bg: "#ffffff",
			fg: "#1f2328",
		});
		const darkHtml = generateHtml(deckWithDiagram, "sample", undefined, {
			bg: "#0d1117",
			fg: "#e6edf3",
		});

		expect(lightHtml).not.toBe(darkHtml);
		// The dark theme's bg should actually appear somewhere in the rendered
		// Mermaid SVG (fill/background attribute), not just in the CSS
		// custom-property block generated for the base deck.
		const svgOnly = darkHtml.slice(
			darkHtml.indexOf("<svg"),
			darkHtml.indexOf("</svg>") + "</svg>".length,
		);
		expect(svgOnly).toContain("#0d1117");
	});

	it("renders Mermaid diagrams identically to today when no theme is active", () => {
		const deckWithDiagram = "```mermaid\nflowchart TD\n  A --> B\n```\n";

		const withoutTheme = generateHtml(deckWithDiagram, "sample");
		const withUndefinedTheme = generateHtml(
			deckWithDiagram,
			"sample",
			undefined,
			undefined,
		);

		expect(withUndefinedTheme).toBe(withoutTheme);
	});

	it("applies a layout CSS class from a slide's layout marker comment", () => {
		const html = generateHtml(
			"<!-- layout: title -->\n\n# Big Heading\n\nSubtitle text.",
		);

		expect(html).toContain('<section class="slide layout-title">');
	});

	it("renders a slide with no layout marker exactly as before -- no layout class", () => {
		const html = generateHtml("# Big Heading\n\nSubtitle text.");

		// LAYOUT_STYLE's CSS (like NOTES_STYLE/PRINT_PAGINATION_STYLE) is
		// injected unconditionally -- it's scoped entirely to
		// ".slide.layout-*" selectors, so it has zero effect on a <section>
		// that never gets a layout-* class. The precise check for "no
		// layout class applied" is this exact section-tag substring: a
		// section with a layout class would render
		// `class="slide layout-title"`, which would not match.
		expect(html).toContain('<section class="slide">');
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
		expect(containsUnsafeHtml("<!-- layout: title -->\n\n# Heading\n")).toBe(
			false,
		);
	});

	it("does not apply LAYOUT_STYLE's CSS when a custom --css is given", () => {
		const html = generateHtml("# Heading", "sample", ".slide { color: red; }");

		expect(html).not.toContain(".slide.layout-title");
	});

	it("embeds the presentation-mode script unconditionally, inert without ?present", () => {
		const html = generateHtml(fixtureMarkdown, "sample");

		expect(html).toContain('has("present")');
	});

	it("adds transition CSS when a transition name is given", () => {
		const html = generateHtml(
			"# Slide",
			"sample",
			undefined,
			undefined,
			"fade",
		);

		expect(html).toContain("transition: opacity");
	});

	it("adds a different transition's CSS for the slide transition", () => {
		const html = generateHtml(
			"# Slide",
			"sample",
			undefined,
			undefined,
			"slide",
		);

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
		// "pointer-events: none" (rather than the more generic
		// "transition: opacity") is the marker checked here: it appears ONLY
		// inside transitionToCssBlock's fade/slide output, unlike
		// "transition: opacity", which FRAGMENT_STYLE's own (unconditional)
		// body.presenting .fragment rule also legitimately uses for an
		// unrelated feature -- see FRAGMENT_STYLE's docstring in render.ts.
		expect(html).not.toContain("pointer-events: none");
	});

	it("does not apply transition CSS when a custom --css is given, even with a transition name", () => {
		const html = generateHtml(
			"# Slide",
			"sample",
			".slide { color: red; }",
			undefined,
			"fade",
		);

		expect(html).not.toContain("pointer-events: none");
	});

	it.each(["fade", "slide"] as const)(
		"includes a prefers-reduced-motion override regardless of --transition value (%s)",
		(transitionName) => {
			const html = generateHtml(
				"# Slide",
				"sample",
				undefined,
				undefined,
				transitionName,
			);

			expect(html).toContain("@media (prefers-reduced-motion: reduce)");
			expect(html).toContain(
				".slide { transition: opacity 0.2s linear !important; transform: none !important; }",
			);
		},
	);

	it("does not apply the reduced-motion override when a custom --css is given, even with a transition name", () => {
		const html = generateHtml(
			"# Slide",
			"sample",
			".slide { color: red; }",
			undefined,
			"fade",
		);

		expect(html).not.toContain("prefers-reduced-motion");
	});

	it("still applies presentation mode's base show/hide CSS even with a custom --css", () => {
		const html = generateHtml("# Slide", "sample", ".slide { color: red; }");

		expect(html).toContain("body.presenting .slide.is-active");
	});

	it("produces byte-identical output with no transition argument (regression guard)", () => {
		const withoutArg = generateHtml(
			fixtureMarkdown,
			"sample",
			undefined,
			undefined,
		);
		const withUndefinedTransition = generateHtml(
			fixtureMarkdown,
			"sample",
			undefined,
			undefined,
			undefined,
		);

		expect(withUndefinedTransition).toBe(withoutArg);
	});
});

describe("generateHtml — slide segmentation", () => {
	it("wraps single-slide content in exactly one <section> when there is no delimiter", () => {
		const html = generateHtml("# Only slide\n\nSome text.");
		const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
		expect(sectionCount).toBe(1);
	});

	it("splits into multiple sections on a --- preceded by a blank line", () => {
		const html = generateHtml(
			"# Slide 1\n\nFirst.\n\n---\n\n# Slide 2\n\nSecond.",
		);
		const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
		expect(sectionCount).toBe(2);
		expect(html).toContain("<h1>Slide 1</h1>");
		expect(html).toContain("<h1>Slide 2</h1>");
	});

	it("does not split on a --- immediately after a paragraph (setext H2 heading)", () => {
		const html = generateHtml("Some Text\n---\nMore text.");
		const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
		expect(sectionCount).toBe(1);
		expect(html).toContain("<h2>Some Text</h2>");
	});

	it("does not split on a --- inside a fenced code block", () => {
		const html = generateHtml(
			"Before.\n\n```\ncode\n---\nmore code\n```\n\nAfter.",
		);
		const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
		expect(sectionCount).toBe(1);
		expect(html).toContain("---\nmore code");
	});

	it("filters out an empty slide produced by two consecutive delimiters", () => {
		const html = generateHtml(
			"# Slide 1\n\nFirst.\n\n---\n\n---\n\n# Slide 2\n\nSecond.",
		);
		const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
		expect(sectionCount).toBe(2);
	});

	it("wraps an empty deck in exactly one <section> (zero-delimiter backward-compatibility invariant)", () => {
		const html = generateHtml("");
		const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
		expect(sectionCount).toBe(1);
	});

	it("wraps a whitespace-only deck in exactly one <section> (zero-delimiter backward-compatibility invariant)", () => {
		const html = generateHtml("   \n\n   ");
		const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
		expect(sectionCount).toBe(1);
	});

	it("wraps a deck consisting solely of a single --- delimiter in exactly one <section>", () => {
		const html = generateHtml("---");
		const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
		expect(sectionCount).toBe(1);
	});

	it("wraps a deck consisting solely of two --- delimiters in exactly one <section>", () => {
		const html = generateHtml("---\n\n---");
		const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
		expect(sectionCount).toBe(1);
	});

	it("wraps a leading --- typed before any slide content in exactly one <section>", () => {
		const html = generateHtml("---\n\n   ");
		const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
		expect(sectionCount).toBe(1);
	});
});

describe("generateHtml — KaTeX math", () => {
	it("renders inline math via KaTeX", () => {
		const html = generateHtml("Einstein: $E = mc^2$.");

		expect(html).toContain('class="katex"');
	});

	it("renders block/display math via KaTeX", () => {
		const html = generateHtml("$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$");

		expect(html).toContain('class="katex-display"');
	});

	it("does not treat $ inside inline code as math", () => {
		const html = generateHtml("Price: `$5` today.");

		expect(html).toContain("<code>$5</code>");
		expect(html).not.toContain('class="katex"');
	});

	it("does not treat $ inside a fenced code block as math", () => {
		const html = generateHtml("```\necho $HOME costs $5\n```");

		expect(html).toContain("echo $HOME costs $5");
		expect(html).not.toContain('class="katex"');
	});

	it("gracefully degrades invalid LaTeX instead of throwing", () => {
		expect(() => generateHtml("Broken: $\\frac{1$.")).not.toThrow();
		const html = generateHtml("Broken: $\\frac{1$.");

		expect(html).toContain('class="katex-error"');
	});

	it("does not embed KaTeX CSS/fonts when no math is present", () => {
		const html = generateHtml("# Just a heading\n\nNo math here.");

		expect(html).not.toContain("KaTeX_Main");
	});

	it("embeds KaTeX fonts locally with no CDN reference when math is present", () => {
		const html = generateHtml("Math: $x^2$.");

		expect(html).toContain("KaTeX_Main");
		expect(html).not.toMatch(/https?:\/\/cdn\./i);
		expect(html).not.toContain("unpkg.com");
		expect(html).not.toContain("jsdelivr.net");
		expect(html).not.toContain("cdnjs.cloudflare.com");
	});
});

describe("generateHtml — Mermaid diagrams", () => {
	it("renders a mermaid fenced code block as an SVG diagram", () => {
		const html = generateHtml("```mermaid\nflowchart TD\n  A --> B\n```");

		expect(html).toContain("<svg");
		expect(html).not.toContain("```mermaid");
	});

	it("renders a visible error box for invalid mermaid syntax instead of throwing", () => {
		expect(() =>
			generateHtml("```mermaid\nnot a real diagram\n```"),
		).not.toThrow();

		const html = generateHtml("```mermaid\nnot a real diagram\n```");
		expect(html).toContain("mermaid-error");
	});

	it("never references an external CDN when a diagram is present", () => {
		const html = generateHtml("```mermaid\nflowchart TD\n  A --> B\n```");

		expect(html).not.toMatch(/https?:\/\/cdn\./i);
		expect(html).not.toContain("unpkg.com");
		expect(html).not.toContain("jsdelivr.net");
		expect(html).not.toContain("cdnjs.cloudflare.com");
		expect(html).not.toContain("fonts.googleapis.com");
	});

	it("gives each mermaid diagram unique ids so a deck with 2+ diagrams has no duplicate id attributes", () => {
		const html = generateHtml(
			"```mermaid\nflowchart TD\n  A --> B\n```\n\n```mermaid\nflowchart TD\n  C --> D\n```",
		);

		const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
		const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

		expect(duplicates).toEqual([]);
	});

	it("renders a non-mermaid fenced code block exactly as before this phase", () => {
		const html = generateHtml("```bash\necho hi\n```");

		expect(html).toContain(
			'<pre><code class="language-bash">echo hi\n</code></pre>',
		);
	});

	it("renders a fenced code block with no language tag exactly as before this phase", () => {
		const html = generateHtml("```\nplain text\n```");

		expect(html).toContain("<pre><code>plain text\n</code></pre>");
	});
});

describe("generateHtml — custom CSS opt-out", () => {
	it("uses the default baseline stylesheet when no custom CSS is given", () => {
		const html = generateHtml("# Slide");

		expect(html).toContain("font-family: -apple-system");
	});

	it("fully replaces the baseline stylesheet when custom CSS is given", () => {
		const html = generateHtml(
			"# Slide",
			undefined,
			".slide { color: hotpink; }",
		);

		expect(html).toContain(".slide { color: hotpink; }");
		expect(html).not.toContain("font-family: -apple-system");
	});

	it("still embeds KaTeX CSS/fonts alongside custom CSS when math is present", () => {
		const html = generateHtml(
			"Math: $x^2$.",
			undefined,
			".slide { color: hotpink; }",
		);

		expect(html).toContain(".slide { color: hotpink; }");
		expect(html).toContain("KaTeX_Main");
	});
});

describe("generateHtml — named themes", () => {
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
		const html = generateHtml(
			fixtureMarkdown,
			"sample",
			"body { color: purple; }",
			{
				bg: "#2e3440",
				fg: "#d8dee9",
			},
		);

		expect(html).toContain("body { color: purple; }");
		expect(html).not.toContain("--nh-bg: #2e3440");
	});
});

describe("generateHtml — --css-vars overlay", () => {
	// Unlike --css (which replaces the entire <style> block wholesale, see
	// the "custom CSS opt-out" describe block above), --css-vars is designed
	// to be a small variable overlay that COMPOSES with the rest of
	// generateHtml's output -- the active theme's own :root block, the fixed
	// layout/transition/progress-bar CSS, everything --css's own
	// mutual-exclusivity with LAYOUT_STYLE/transitionStyle/progressStyle
	// silently drops. See docs/specs/css-vars-override-design.md.
	const ACCENT_OVERLAY = ":root { --nh-accent: #ff6600; }";

	it("produces byte-identical output with no --css-vars argument (regression guard)", () => {
		const withoutArg = generateHtml(
			fixtureMarkdown,
			"sample",
			undefined,
			undefined,
			undefined,
		);
		const withUndefinedCssVars = generateHtml(
			fixtureMarkdown,
			"sample",
			undefined,
			undefined,
			undefined,
			undefined,
		);

		expect(withUndefinedCssVars).toBe(withoutArg);
	});

	it("overlays a --css-vars custom property on top of the default (no-theme) stylesheet", () => {
		const html = generateHtml(
			"# Slide",
			"sample",
			undefined,
			undefined,
			undefined,
			ACCENT_OVERLAY,
		);

		expect(html).toContain(ACCENT_OVERLAY);
		// The overlay's own accent value must appear strictly after the
		// baseline stylesheet's default --nh-accent declaration -- "later in
		// source wins" is the entire mechanism this feature relies on.
		expect(html.indexOf(ACCENT_OVERLAY)).toBeGreaterThan(
			html.indexOf("--nh-accent: #0b5fff"),
		);
	});

	it("composes with an active theme, appearing after the theme's own :root override block", () => {
		const html = generateHtml(
			fixtureMarkdown,
			"sample",
			undefined,
			{ bg: "#2e3440", fg: "#d8dee9", accent: "#88c0d0" },
			undefined,
			ACCENT_OVERLAY,
		);

		expect(html).toContain("--nh-bg: #2e3440");
		expect(html).toContain(ACCENT_OVERLAY);
		expect(html.indexOf(ACCENT_OVERLAY)).toBeGreaterThan(
			html.indexOf("--nh-bg: #2e3440"),
		);
	});

	it("preserves layout and transition CSS alongside a --css-vars overlay (unlike a full --css replacement, which drops both)", () => {
		const html = generateHtml(
			"<!-- layout: title -->\n\n# Heading\n",
			"sample",
			undefined,
			undefined,
			"fade",
			ACCENT_OVERLAY,
		);

		expect(html).toContain(ACCENT_OVERLAY);
		expect(html).toContain(".slide.layout-title");
		expect(html).toContain("transition: opacity");
		expect(html).toContain("body.presenting .presentation-progress");
	});

	it("ignores --css-vars when customCss is also given (mutual exclusivity mirrors --theme's own precedent)", () => {
		const html = generateHtml(
			"# Slide",
			"sample",
			"body { color: purple; }",
			undefined,
			undefined,
			ACCENT_OVERLAY,
		);

		expect(html).toContain("body { color: purple; }");
		expect(html).not.toContain(ACCENT_OVERLAY);
	});

	it("throws a clear error if --css-vars content contains a closing </style> tag, rather than letting it terminate the document's own <style> element", () => {
		expect(() =>
			generateHtml(
				"# Slide",
				"sample",
				undefined,
				undefined,
				undefined,
				"</style><script>alert(1)</script>",
			),
		).toThrow(/<\/style>/);
	});

	it(
		"actually changes the computed color of an element styled via var(--nh-accent) in a real browser",
		async () => {
			const html = generateHtml(
				"[a link](https://example.com)",
				"sample",
				undefined,
				undefined,
				undefined,
				ACCENT_OVERLAY,
			);
			const page = await openHtmlPage(html);

			const color = await page.evaluate(() => {
				const link = document.querySelector("a");
				return link ? getComputedStyle(link).color : null;
			});

			// #ff6600 -> rgb(255, 102, 0)
			expect(color).toBe("rgb(255, 102, 0)");
		},
		STYLE_TEST_TIMEOUT_MS,
	);
});

describe("generateHtml — presenter notes", () => {
	it("renders a slide's HTML comment as a hidden aside with class notes", () => {
		const html = generateHtml("# Slide\n\n<!-- speaker note here -->\n");

		expect(html).toContain(
			'<aside class="notes" hidden>speaker note here</aside>',
		);
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

describe("generateHtml — presenter notes reveal (?notes) rendering scope", () => {
	// Regression coverage for a real bug: `.notes` was unconditionally
	// `position: fixed; bottom: 0; left: 0; right: 0`, so revealing notes via
	// `?notes` in the default continuous-scroll view (which has no single
	// "current slide" concept) unhid EVERY slide's <aside class="notes"> at
	// once, and all of them stacked at the exact same fixed screen position.
	// The fix scopes the fixed bottom-overlay behavior to `body.presenting
	// .notes` (real presentation mode, where there genuinely is one active
	// slide) and leaves the default view's revealed notes in normal document
	// flow, immediately after their own slide's content.
	const TWO_SLIDE_DECK_WITH_NOTES =
		"# Slide 1\n\nFirst slide body.\n\n<!-- note for slide one -->\n\n---\n\n# Slide 2\n\nSecond slide body.\n\n<!-- note for slide two -->\n";

	async function openNotesPage(html: string, path = "/?notes") {
		activeServer = await startServer(html, 0);
		const executablePath = detectBrowserExecutable();
		activeBrowser = await puppeteer.launch({ executablePath, headless: true });
		const page = await activeBrowser.newPage();
		await page.goto(`${activeServer.url}${path}`, { waitUntil: "load" });
		return page;
	}

	async function noteBoundingBoxes(
		page: Awaited<ReturnType<typeof openNotesPage>>,
	) {
		return page.evaluate(() =>
			Array.from(document.querySelectorAll(".notes")).map((el) => {
				const rect = el.getBoundingClientRect();
				return { top: rect.top, left: rect.left };
			}),
		);
	}

	it(
		"renders each slide's revealed note at its own bounding-box position in the default continuous-scroll view, not stacked on top of each other",
		async () => {
			const html = generateHtml(TWO_SLIDE_DECK_WITH_NOTES);
			const page = await openNotesPage(html);

			const boxes = await noteBoundingBoxes(page);

			expect(boxes).toHaveLength(2);
			// Two notes belonging to two different slides that stack vertically
			// in the default continuous-scroll view must land at different top
			// offsets if each renders in-flow next to its own slide. Under the
			// bug, both were `position: fixed; bottom: 0`, so both boxes
			// resolved to the identical {top, left} pair.
			expect(boxes[0].top).not.toBe(boxes[1].top);
		},
		STYLE_TEST_TIMEOUT_MS,
	);

	it(
		"keeps the revealed note in normal document flow (not fixed) outside presentation mode",
		async () => {
			const html = generateHtml("# Slide\n\n<!-- a note -->\n");
			const page = await openNotesPage(html);

			const position = await page.evaluate(() => {
				const notes = document.querySelector(".notes");
				return notes ? getComputedStyle(notes).position : null;
			});

			expect(position).not.toBe("fixed");
		},
		STYLE_TEST_TIMEOUT_MS,
	);

	it(
		"still overlays the revealed note fixed to the bottom of the screen inside presentation mode",
		async () => {
			const html = generateHtml("# Slide\n\n<!-- a note -->\n");
			const page = await openNotesPage(html, "/?present&notes");

			const position = await page.evaluate(() => {
				const notes = document.querySelector(".notes");
				return notes ? getComputedStyle(notes).position : null;
			});

			expect(position).toBe("fixed");
		},
		STYLE_TEST_TIMEOUT_MS,
	);
});

describe("generateHtml — PDF pagination", () => {
	it("includes a print-media rule that breaks after each slide", () => {
		const html = generateHtml("# Slide 1\n\n---\n\n# Slide 2");

		expect(html).toMatch(/@media print[^}]*\.slide[^}]*break-after:\s*page/);
	});

	it("forces exact background/color printing in print media, so themed backgrounds survive a raw browser Ctrl+P", () => {
		const html = generateHtml("# Slide 1\n\n---\n\n# Slide 2");

		// Without this, a browser's print pipeline can silently substitute a
		// dark theme's background for something print-friendlier when the
		// user prints this raw generateHtml() output directly (e.g. via
		// Ctrl+P) rather than going through pdfExport.ts's own
		// `printBackground: true` Puppeteer option, which only covers the
		// CLI's own `pdf`/`png` export commands.
		//
		// Uses indexOf rather than a single `toMatch` regex (unlike the sibling
		// test above) because PRINT_PAGINATION_STYLE's `@media print` block now
		// contains two separate rules -- a `[^}]*`-style regex spanning both
		// would incorrectly require no `}` between them, which no longer holds
		// now that the `.slide { break-after: page; }` rule's own closing brace
		// sits in between.
		const printMediaIndex = html.indexOf("@media print");
		expect(printMediaIndex).toBeGreaterThan(-1);
		expect(
			html.indexOf("print-color-adjust: exact;", printMediaIndex),
		).toBeGreaterThan(printMediaIndex);
		expect(
			html.indexOf("-webkit-print-color-adjust: exact;", printMediaIndex),
		).toBeGreaterThan(printMediaIndex);
	});
});

describe("containsUnsafeHtml", () => {
	it("returns true for a deck containing a genuine <script> tag", () => {
		expect(containsUnsafeHtml("# Slide\n\n<script>alert(1)</script>\n")).toBe(
			true,
		);
	});

	it("returns true for a deck containing a genuine <iframe> tag", () => {
		expect(
			containsUnsafeHtml(
				'# Slide\n\n<iframe src="https://example.com"></iframe>\n',
			),
		).toBe(true);
	});

	it("returns true for raw HTML embedded inline within a paragraph, not just standalone on its own line", () => {
		expect(
			containsUnsafeHtml(
				"# Slide\n\nSome text with an inline <img src=x onerror=alert(1)> tag mid-sentence.\n",
			),
		).toBe(true);
	});

	it("returns false for a plain markdown-only deck", () => {
		expect(
			containsUnsafeHtml(
				"# Slide\n\nJust plain text, a [link](https://example.com), and a\n\n- list\n- of items\n",
			),
		).toBe(false);
	});

	it("returns false for a deck using only presenter-note HTML comments", () => {
		expect(
			containsUnsafeHtml(
				"# Slide One\n\nFirst slide body.\n\n<!-- remember to smile -->\n\n---\n\n# Slide Two\n\nSecond slide body.\n\n<!-- pause for questions -->\n",
			),
		).toBe(false);
	});
});

describe("generateHtml — quote layout single-paragraph bug", () => {
	it(
		"renders a single-paragraph quote as large italic text, not small muted text",
		async () => {
			const html = generateHtml(
				"<!-- layout: quote -->\n\nJust one paragraph of quote text.",
			);
			const page = await openHtmlPage(html);

			const styles = await quoteParagraphStyles(page);

			expect(styles).toHaveLength(1);
			expect(styles[0].fontStyle).toBe("italic");
			expect(styles[0].fontSize).toBe("28px");
		},
		STYLE_TEST_TIMEOUT_MS,
	);

	it(
		"renders a two-paragraph quote's attribution line as small, muted, non-italic text, and the quote itself as large italic text",
		async () => {
			const html = generateHtml(
				"<!-- layout: quote -->\n\nThe quote itself.\n\n— Attribution",
			);
			const page = await openHtmlPage(html);

			const styles = await quoteParagraphStyles(page);

			expect(styles).toHaveLength(2);
			expect(styles[0].fontStyle).toBe("italic");
			expect(styles[0].fontSize).toBe("28px");
			expect(styles[1].fontStyle).toBe("normal");
			expect(styles[1].fontSize).toBe("16px");
		},
		STYLE_TEST_TIMEOUT_MS,
	);
});

describe("generateHtml — two-column layout break-inside protection", () => {
	it("includes svg alongside pre/table/img in the two-column break-inside:avoid selector list", () => {
		const html = generateHtml("<!-- layout: two-column -->\n\nSome text.");

		expect(html).toMatch(
			/\.slide\.layout-two-column pre,\s*\n?\s*\.slide\.layout-two-column table,\s*\n?\s*\.slide\.layout-two-column img,\s*\n?\s*\.slide\.layout-two-column svg\s*\{\s*\n?\s*break-inside:\s*avoid;/,
		);
	});

	it("protects a Mermaid diagram's raw <svg> output on a two-column slide from a mid-diagram page break", () => {
		const html = generateHtml(
			"<!-- layout: two-column -->\n\n```mermaid\nflowchart TD\n  A --> B\n```",
		);

		// renderMermaidDiagram() returns a bare <svg>, not wrapped in
		// pre/table/img -- without the fix, this diagram would have no
		// break-inside protection at all inside a two-column layout.
		expect(html).toContain("<svg");
		expect(html).toMatch(
			/\.slide\.layout-two-column svg\s*\{\s*\n?\s*break-inside:\s*avoid;/,
		);
	});
});

describe("generateHtml — two-column layout container-query breakpoint", () => {
	// Regression coverage for a real, currently-shipped bug: the two-column
	// layout's mobile breakpoint queried `@media (max-width: 640px)` -- the
	// real browser VIEWPORT -- instead of the slide's own box. Grid-overview
	// mode (OVERVIEW_STYLE, toggled by presentationScript.ts's "o" key) can
	// shrink a `.slide` down to a ~220-400px-wide thumbnail via a CSS grid +
	// `transform: none !important`, WITHOUT the viewport itself changing size
	// at all -- so the old viewport-scoped `@media` rule never fired there,
	// even though the two-column layout visually needs to collapse to one
	// column once it's squeezed that small. The fix gives `.slide` its own
	// CSS containment context (`container-type: inline-size` on the base
	// `.slide` rule) and swaps the breakpoint to `@container (max-width:
	// 640px)`, which queries the slide's own box, not the viewport -- so it
	// fires correctly inside a shrunk overview thumbnail regardless of how
	// wide the real viewport stays. The actual `column-count` toggle lives on
	// an inner `.two-column-flow` wrapper rather than on `.slide.layout-two-column`
	// itself, since a CSS size query container can never match a `@container`
	// rule against itself, only against a descendant -- see render.ts's own
	// comment on this for the real-Chromium verification.
	//
	// Opens presentation mode and presses "o" -- exactly how
	// presentationScript.ts's own openOverview() adds the `overview` class to
	// <body> (see that file's keydown listener) -- rather than adding the
	// class via page.evaluate, so this exercises the real toggle path a
	// viewer actually takes.
	async function openOverviewPage(html: string) {
		activeServer = await startServer(html, 0);
		const executablePath = detectBrowserExecutable();
		activeBrowser = await puppeteer.launch({ executablePath, headless: true });
		const page = await activeBrowser.newPage();
		// Pinned explicitly wider than the 640px breakpoint so a passing test
		// can only be explained by the slide's own shrunk box triggering the
		// container query -- if the real viewport were narrow too, a lingering
		// viewport-scoped @media rule could produce the same passing result
		// for the wrong reason.
		await page.setViewport({ width: 1024, height: 800 });
		await page.goto(`${activeServer.url}/?present`, { waitUntil: "load" });
		await page.keyboard.press("o");
		return page;
	}

	async function twoColumnColumnCount(
		page: Awaited<ReturnType<typeof openOverviewPage>>,
	) {
		return page.evaluate(() => {
			const flow = document.querySelector(
				".slide.layout-two-column .two-column-flow",
			);
			return flow ? getComputedStyle(flow).columnCount : null;
		});
	}

	const TWO_COLUMN_DECK =
		"<!-- layout: two-column -->\n\nColumn one text.\n\nColumn two text.";

	it(
		"collapses a two-column slide to a single column once grid-overview mode shrinks it to a thumbnail, even though the real browser viewport stays well above the 640px breakpoint",
		async () => {
			const html = generateHtml(TWO_COLUMN_DECK);
			const page = await openOverviewPage(html);

			const isOverviewOpen = await page.evaluate(() =>
				document.body.classList.contains("overview"),
			);
			expect(isOverviewOpen).toBe(true);

			expect(await twoColumnColumnCount(page)).toBe("1");
		},
		STYLE_TEST_TIMEOUT_MS,
	);

	it(
		"keeps the two-column layout at two columns in the normal (non-overview) continuous-scroll view at that same wide viewport (guards against overcorrecting to always-one-column)",
		async () => {
			const html = generateHtml(TWO_COLUMN_DECK);
			const page = await openHtmlPage(html);
			await page.setViewport({ width: 1024, height: 800 });

			expect(await twoColumnColumnCount(page)).toBe("2");
		},
		STYLE_TEST_TIMEOUT_MS,
	);
});

describe("generateHtml — themed notes panel", () => {
	const DRACULA_COLORS = {
		bg: "#282a36",
		fg: "#f8f8f2",
		line: "#6272a4",
		accent: "#bd93f9",
		muted: "#6272a4",
	};
	const NORD_COLORS = {
		bg: "#2e3440",
		fg: "#d8dee9",
		line: "#4c566a",
		accent: "#88c0d0",
		muted: "#616e88",
	};

	function notesRule(html: string): string {
		const match = html.match(/\.notes\s*\{[^}]*\}/);
		if (!match) {
			throw new Error("no .notes rule found in generated HTML");
		}
		return match[0];
	}

	it("no longer hardcodes the old cream/gold hex colors in the .notes rule", () => {
		const html = generateHtml("# Slide\n\n<!-- a note -->\n");
		const rule = notesRule(html);

		expect(rule).not.toContain("#fffbe6");
		expect(rule).not.toContain("#e0c46c");
	});

	it("styles the notes panel via the ambient theme's CSS custom properties, not fixed colors", () => {
		const html = generateHtml(
			"# Slide\n\n<!-- a note -->\n",
			"sample",
			undefined,
			DRACULA_COLORS,
		);
		const rule = notesRule(html);

		expect(rule).toContain("var(--nh-code-bg)");
		expect(rule).toContain("var(--nh-border)");
		expect(rule).toContain("var(--nh-fg)");
	});

	it("resolves to genuinely different colors for two different dark themes, proving the panel is theme-derived rather than a fixed color that happens to look neutral", () => {
		const draculaHtml = generateHtml(
			"# Slide\n\n<!-- a note -->\n",
			"sample",
			undefined,
			DRACULA_COLORS,
		);
		const nordHtml = generateHtml(
			"# Slide\n\n<!-- a note -->\n",
			"sample",
			undefined,
			NORD_COLORS,
		);

		// The .notes rule text itself is identical between themes (it always
		// references the same var() names) -- it's the surrounding :root
		// block's variable *values* that must differ per theme for the panel
		// to actually look different on screen. --nh-code-bg/--nh-border are
		// blended from each theme's own bg/fg (see CODE_BG_FG_BLEND_PERCENT/
		// BORDER_FG_BLEND_PERCENT in render.ts), not copied from `muted`/
		// `line`, so these two dark themes -- which share an identical
		// `muted` value with `line` (dracula) but differ in bg/fg -- still
		// resolve to genuinely different, theme-derived hex values here.
		expect(notesRule(draculaHtml)).toBe(notesRule(nordHtml));
		expect(draculaHtml).toContain("--nh-code-bg: #3d3f49");
		expect(nordHtml).toContain("--nh-code-bg: #3f4551");
		expect(draculaHtml).toContain("--nh-border: #9a9b9d");
		expect(nordHtml).toContain("--nh-border: #8c929d");
		expect(draculaHtml).not.toBe(nordHtml);
	});
});

describe("generateHtml — inline code contrast inside the section layout", () => {
	// --nh-muted and --nh-code-bg both fall back to a theme's own `muted`
	// color first (themeToCssVarBlock), which is true for every one of the
	// 4 shipped themes -- so the two variables always resolve to the exact
	// same value whenever a theme is active. The section layout separately
	// sets `color: var(--nh-muted)` on its paragraphs to de-emphasize body
	// text. Inline <code> has no color of its own, so it inherits that
	// de-emphasized color from its parent <p> -- and combined with code's
	// own `background: var(--nh-code-bg)`, text and background become
	// identical, making the code text invisible. Only a real browser's
	// resolved (not just cascaded-in-isolation) color can prove this --
	// found live via Playwright MCP against a running dev server, not by
	// this suite's own prior string-assertion tests.
	const DRACULA_COLORS = {
		bg: "#282a36",
		fg: "#f8f8f2",
		line: "#6272a4",
		accent: "#bd93f9",
		muted: "#6272a4",
	};

	async function inlineCodeColors(
		page: Awaited<ReturnType<typeof openHtmlPage>>,
	) {
		return page.evaluate(() => {
			const code = document.querySelector(".slide.layout-section code");
			if (!code) return null;
			const computed = getComputedStyle(code);
			return { color: computed.color, background: computed.backgroundColor };
		});
	}

	it(
		"keeps inline code legible (not the same color as its own background) inside a themed section-layout slide",
		async () => {
			const html = generateHtml(
				"<!-- layout: section -->\n\n# Heading\n\nSome text with `inline code` in it.",
				"sample",
				undefined,
				DRACULA_COLORS,
			);
			const page = await openHtmlPage(html);

			const colors = await inlineCodeColors(page);

			expect(colors).not.toBeNull();
			expect(colors?.color).not.toBe(colors?.background);
		},
		STYLE_TEST_TIMEOUT_MS,
	);
});

describe("generateHtml — theme code-bg/border WCAG contrast (regression: collapsed --nh-code-bg/--nh-muted made the presentation counter invisible)", () => {
	// Real WCAG 2.x relative-luminance / contrast-ratio math
	// (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance), run against
	// each shipped theme's actually-*resolved* colors via a real browser's
	// getComputedStyle() -- not eyeballed, and not asserted against
	// hand-copied hex literals that could silently drift from
	// beautiful-mermaid's own palette values (imported live from
	// ../src/themes.js below instead).
	function parseRgbChannels(value: string): [number, number, number] {
		const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
		if (!match) {
			throw new Error(
				`unparseable color value from getComputedStyle: ${value}`,
			);
		}
		return [Number(match[1]), Number(match[2]), Number(match[3])];
	}

	function relativeLuminance([r, g, b]: [number, number, number]): number {
		const channel = (c: number) => {
			const s = c / 255;
			return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
	}

	function contrastRatio(colorA: string, colorB: string): number {
		const l1 = relativeLuminance(parseRgbChannels(colorA));
		const l2 = relativeLuminance(parseRgbChannels(colorB));
		const lighter = Math.max(l1, l2);
		const darker = Math.min(l1, l2);
		return (lighter + 0.05) / (darker + 0.05);
	}

	const DECK = "# Heading\n\nSome text with `inline code` in it.";

	async function openPresentingPage(html: string) {
		activeServer = await startServer(html, 0);
		const executablePath = detectBrowserExecutable();
		activeBrowser = await puppeteer.launch({ executablePath, headless: true });
		const page = await activeBrowser.newPage();
		await page.goto(`${activeServer.url}/?present`, { waitUntil: "load" });
		return page;
	}

	async function themeContrastColors(
		page: Awaited<ReturnType<typeof openPresentingPage>>,
	) {
		return page.evaluate(() => {
			const code = document.querySelector("code");
			const heading = document.querySelector("h1");
			const counter = document.querySelector(".presentation-counter");
			if (!code || !heading || !counter) return null;
			const codeStyle = getComputedStyle(code);
			const headingStyle = getComputedStyle(heading);
			const bodyStyle = getComputedStyle(document.body);
			const counterStyle = getComputedStyle(counter);
			return {
				codeForeground: codeStyle.color,
				codeBackground: codeStyle.backgroundColor,
				headingBorder: headingStyle.borderBottomColor,
				bodyBackground: bodyStyle.backgroundColor,
				counterForeground: counterStyle.color,
				counterBackground: counterStyle.backgroundColor,
			};
		});
	}

	for (const [themeName, theme] of Object.entries(THEMES)) {
		it(
			`gives the "${themeName}" theme a --nh-code-bg/--nh-fg pair meeting WCAG AA (>=4.5:1), a --nh-border/--nh-bg pair meeting the 3:1 UI-boundary minimum, and a presentation counter that is no longer invisible against its own background`,
			async () => {
				const html = generateHtml(DECK, "sample", undefined, theme.colors);
				const page = await openPresentingPage(html);

				const colors = await themeContrastColors(page);
				expect(colors).not.toBeNull();
				if (!colors) return;

				// (a) inline <code>'s own foreground (--nh-fg) vs background
				// (--nh-code-bg) -- the most-visible real manifestation of this
				// pair -- must meet WCAG AA for normal text (>=4.5:1).
				expect(colors.codeForeground).not.toBe(colors.codeBackground);
				expect(
					contrastRatio(colors.codeForeground, colors.codeBackground),
				).toBeGreaterThanOrEqual(4.5);

				// (b) --nh-border (h1's border-bottom) against --nh-bg (the
				// page background) must meet the 3:1 non-text/UI-boundary
				// contrast minimum.
				expect(
					contrastRatio(colors.headingBorder, colors.bodyBackground),
				).toBeGreaterThanOrEqual(3);

				// (c) the presentation counter's own live-resolved background
				// (--nh-code-bg) and text color (--nh-muted) must never
				// collapse to the exact same value -- that collapse is what
				// made the counter render completely invisible against its
				// own background under every one of these 4 shipped themes.
				expect(colors.counterForeground).not.toBe(colors.counterBackground);
			},
			STYLE_TEST_TIMEOUT_MS,
		);
	}
});

describe("generateHtml — fragment (incremental reveal) markers", () => {
	it('applies class="fragment" to a paragraph immediately followed by a marker', () => {
		const html = generateHtml(
			"First paragraph.\n\n<!-- fragment -->\n\nSecond paragraph.",
		);

		expect(html).toContain('<p class="fragment">First paragraph.</p>');
		expect(html).not.toContain('<p class="fragment">Second paragraph.</p>');
		expect(html).not.toContain("<!-- fragment -->");
	});

	it("recognizes the marker case-insensitively and with no internal whitespace", () => {
		expect(generateHtml("First.\n\n<!-- FRAGMENT -->\n\nSecond.")).toContain(
			'<p class="fragment">First.</p>',
		);
		expect(generateHtml("First.\n\n<!--fragment-->\n\nSecond.")).toContain(
			'<p class="fragment">First.</p>',
		);
	});

	it("does not treat a near-miss comment as a fragment marker", () => {
		const html = generateHtml("First.\n\n<!-- fragments -->\n\nSecond.");

		expect(html).not.toContain('class="fragment"');
	});

	it('applies class="fragment" to a single bullet marked via a nested, indented marker (the per-item authoring convention)', () => {
		const html = generateHtml(
			"- Item 1\n  <!-- fragment -->\n- Item 2\n- Item 3\n",
		);

		expect(html).toContain('<li class="fragment">Item 1</li>');
		expect(html).toContain("<li>Item 2</li>");
		expect(html).toContain("<li>Item 3</li>");
		expect(html).not.toContain("<!-- fragment -->");
		// A single <ul> -- the nested marker convention must not split the
		// list into two separate lists.
		expect((html.match(/<ul>/g) ?? []).length).toBe(1);
	});

	it("marks each bullet independently when every item has its own trailing marker", () => {
		const html = generateHtml(
			"- Item 1\n  <!-- fragment -->\n- Item 2\n  <!-- fragment -->\n- Item 3\n",
		);

		expect(html).toContain('<li class="fragment">Item 1</li>');
		expect(html).toContain('<li class="fragment">Item 2</li>');
		expect(html).toContain("<li>Item 3</li>");
	});

	it("removes an earlier direct marker inside a multi-paragraph bullet, not just the trailing one that marks the whole item (regression: the earlier marker used to leak through as a literal HTML comment)", () => {
		const html = generateHtml(
			"- First paragraph.\n\n  <!-- fragment -->\n\n  Second paragraph.\n\n  <!-- fragment -->\n- Item 2\n",
		);

		expect(html).toContain('<p class="fragment">First paragraph.</p>');
		expect(html).toContain("<p>Second paragraph.</p>");
		expect(html).toMatch(/<li class="fragment">/);
		expect(html).not.toContain("<!-- fragment -->");
	});

	it("marks a loose list item (blank line before the nested marker) the same way as a tight one", () => {
		const html = generateHtml("- Item 1\n\n  <!-- fragment -->\n- Item 2\n");

		expect(html).toMatch(/<li class="fragment"><p>Item 1<\/p>\s*<\/li>/);
	});

	it('applies class="fragment" to a code fence immediately preceded by a marker', () => {
		const html = generateHtml("<!-- fragment -->\n\n```\nsome code\n```\n");

		expect(html).toContain('<pre class="fragment">');
		expect(html).not.toContain("<!-- fragment -->");
	});

	it('composes class="fragment" onto a code fence\'s existing language class rather than replacing it', () => {
		const html = generateHtml("<!-- fragment -->\n\n```bash\necho hi\n```\n");

		expect(html).toContain(
			'<pre class="fragment"><code class="language-bash">',
		);
	});

	it('applies class="fragment" to a blockquote immediately preceded by a marker', () => {
		const html = generateHtml("<!-- fragment -->\n\n> a quote\n");

		expect(html).toContain('<blockquote class="fragment">');
		expect(html).not.toContain("<!-- fragment -->");
	});

	it("marks a paragraph nested inside a blockquote when the marker sits between two of its own paragraphs", () => {
		const html = generateHtml(
			"> Quote line 1.\n> <!-- fragment -->\n> Quote line 2.\n",
		);

		expect(html).toContain('<p class="fragment">Quote line 1.</p>');
		expect(html).toContain("<p>Quote line 2.</p>");
	});

	it('applies class="fragment" to a Mermaid diagram (a code token with lang mermaid) preceded by a marker, composed onto its root <svg>', () => {
		const html = generateHtml(
			"<!-- fragment -->\n\n```mermaid\nflowchart TD\n  A --> B\n```\n",
		);

		expect(html).toMatch(/<svg[^>]*class="fragment"/);
		expect(html).not.toContain("<!-- fragment -->");
	});

	it('composes class="fragment" onto Mermaid\'s own mermaid-error class rather than replacing it, for an invalid diagram', () => {
		const html = generateHtml(
			"<!-- fragment -->\n\n```mermaid\nnot a real diagram\n```\n",
		);

		expect(html).toContain('class="mermaid-error fragment"');
	});

	it("drops a marker with no supported adjacent target instead of crashing or applying a class anywhere", () => {
		expect(() =>
			generateHtml("# Heading\n\n<!-- fragment -->\n\n# Another heading\n"),
		).not.toThrow();
		const html = generateHtml(
			"# Heading\n\n<!-- fragment -->\n\n# Another heading\n",
		);

		expect(html).not.toContain('class="fragment"');
		expect(html).not.toContain("<!-- fragment -->");
	});

	it("drops a marker between two list items with no blank line (which splits the list) with no visual effect, rather than mis-attaching to the whole preceding list", () => {
		const html = generateHtml(
			"- Item 1\n- Item 2\n<!-- fragment -->\n- Item 3\n",
		);

		expect(html).not.toContain('class="fragment"');
		expect(html).not.toContain("<!-- fragment -->");
	});

	it("never flags a fragment-marked deck as containing unsafe HTML (allowlist covers the fragment marker itself)", () => {
		expect(
			containsUnsafeHtml(
				"# Slide\n\nSome text.\n\n<!-- fragment -->\n\nMore text.\n",
			),
		).toBe(false);
		expect(
			containsUnsafeHtml("- Item 1\n  <!-- fragment -->\n- Item 2\n"),
		).toBe(false);
	});

	it("includes the reduced-motion override for .fragment when the deck has a fragment, even with no --transition configured", () => {
		const html = generateHtml(
			"First.\n\n<!-- fragment -->\n\nSecond.",
			"sample",
			undefined,
			undefined,
			undefined,
		);

		expect(html).toContain("@media (prefers-reduced-motion: reduce)");
		expect(html).toContain(
			".fragment { transition: opacity 0.2s linear !important; }",
		);
	});

	it("does not include any reduced-motion override when the deck has neither a fragment nor a --transition", () => {
		const html = generateHtml(
			"# Slide",
			"sample",
			undefined,
			undefined,
			undefined,
		);

		expect(html).not.toContain("prefers-reduced-motion");
	});

	it("includes the overview override that forces every fragment visible regardless of reveal state", () => {
		const html = generateHtml("First.\n\n<!-- fragment -->\n\nSecond.");

		expect(html).toContain("body.overview .fragment {");
		expect(html).toMatch(
			/body\.overview \.fragment \{\s*opacity: 1 !important;/,
		);
	});

	it("still applies FRAGMENT_STYLE's base rules even with a custom --css (core interactive mechanic, not suppressible)", () => {
		const html = generateHtml(
			"First.\n\n<!-- fragment -->\n\nSecond.",
			"sample",
			".slide { color: red; }",
		);

		expect(html).toContain("body.presenting .fragment");
		expect(html).toContain("body.overview .fragment");
	});
});

describe("generateHtml — fragments visible by default (continuous-scroll view and PDF/PNG export path)", () => {
	// pdfExport.ts/pngExport.ts both call generateHtml() and load the result
	// directly, never appending ?present to the URL they open -- so this
	// exercises the EXACT SAME code path those export commands rely on:
	// loading the raw generateHtml() output with no ?present, which is all
	// FRAGMENT_STYLE's base (non-body.presenting-scoped) opacity:1 rule
	// needs to keep every fragment visible with zero export-specific code.
	it(
		"renders a fragment-marked paragraph fully visible (opacity 1) when loaded without ?present",
		async () => {
			const html = generateHtml(
				"First paragraph.\n\n<!-- fragment -->\n\nSecond paragraph.",
			);
			const page = await openHtmlPage(html);

			const opacity = await page.evaluate(() => {
				const el = document.querySelector(".fragment");
				return el ? getComputedStyle(el).opacity : null;
			});

			expect(opacity).toBe("1");
		},
		STYLE_TEST_TIMEOUT_MS,
	);

	it(
		"renders a fragment-marked bullet fully visible (opacity 1) when loaded without ?present",
		async () => {
			const html = generateHtml("- Item 1\n  <!-- fragment -->\n- Item 2\n");
			const page = await openHtmlPage(html);

			const opacities = await page.evaluate(() =>
				Array.from(document.querySelectorAll(".fragment")).map(
					(el) => getComputedStyle(el).opacity,
				),
			);

			expect(opacities).toEqual(["1"]);
		},
		STYLE_TEST_TIMEOUT_MS,
	);

	it(
		"hides an unrevealed fragment (opacity 0) once ?present is active, proving the visible-by-default behavior above is genuinely scoped to non-presenting mode, not just always-visible",
		async () => {
			const html = generateHtml(
				"First paragraph.\n\n<!-- fragment -->\n\nSecond paragraph.",
			);
			activeServer = await startServer(html, 0);
			const executablePath = detectBrowserExecutable();
			activeBrowser = await puppeteer.launch({
				executablePath,
				headless: true,
			});
			const page = await activeBrowser.newPage();
			await page.goto(`${activeServer.url}/?present`, { waitUntil: "load" });

			const opacity = await page.evaluate(() => {
				const el = document.querySelector(".fragment");
				return el ? getComputedStyle(el).opacity : null;
			});

			expect(opacity).toBe("0");
		},
		STYLE_TEST_TIMEOUT_MS,
	);
});
