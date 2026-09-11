import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateHtml } from "../src/render.js";

// NOTE on the ".js" import extension above: this project uses TypeScript's
// NodeNext module resolution (see src/index.ts, which imports "./render.js"
// even though only render.ts exists on disk). Vitest's own module loader
// resolves that specifier straight to src/render.ts, so tests follow the same
// convention as the rest of the source tree rather than importing "../src/render.ts".

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const fixturePath = path.join(repoRoot, "fixtures", "sample.md");
const fixtureMarkdown = readFileSync(fixturePath, "utf8");

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
