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
