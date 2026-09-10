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

	it("never references an external CDN (local-first constraint)", () => {
		const html = generateHtml(fixtureMarkdown, "sample");

		expect(html).not.toMatch(/https?:\/\/cdn\./i);
		expect(html).not.toContain("unpkg.com");
		expect(html).not.toContain("jsdelivr.net");
		expect(html).not.toContain("cdnjs.cloudflare.com");
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
