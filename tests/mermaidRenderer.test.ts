import { describe, expect, it } from "vitest";
import { renderMermaidDiagram } from "../src/mermaidRenderer.js";

describe("renderMermaidDiagram", () => {
	it("renders valid Mermaid source to an SVG string", () => {
		const svg = renderMermaidDiagram("flowchart TD\n  A --> B");

		expect(svg).toContain("<svg");
		expect(svg).toContain("</svg>");
	});

	it("never leaves a Google Fonts (or any external) CSS @import in the output", () => {
		const svg = renderMermaidDiagram("flowchart TD\n  A --> B");

		expect(svg).not.toMatch(/@import/i);
		expect(svg).not.toContain("fonts.googleapis.com");
	});

	it("never references an external CDN (local-first constraint)", () => {
		const svg = renderMermaidDiagram("flowchart TD\n  A --> B");

		expect(svg).not.toMatch(/https?:\/\/cdn\./i);
		expect(svg).not.toContain("unpkg.com");
		expect(svg).not.toContain("jsdelivr.net");
		expect(svg).not.toContain("cdnjs.cloudflare.com");
		expect(svg).not.toContain("fonts.googleapis.com");
	});

	it("still keeps the font-family fallback chain so text is not unstyled", () => {
		const svg = renderMermaidDiagram("flowchart TD\n  A --> B");

		expect(svg).toMatch(/font-family:\s*'?Inter'?,\s*system-ui,\s*sans-serif/);
	});

	it("gracefully degrades invalid Mermaid syntax instead of throwing", () => {
		expect(() => renderMermaidDiagram("not a real diagram")).not.toThrow();

		const result = renderMermaidDiagram("not a real diagram");
		expect(result).toContain("mermaid-error");
	});

	it("escapes the error message so invalid diagram source cannot inject markup", () => {
		const result = renderMermaidDiagram("<script>alert(1)</script>");

		expect(result).not.toContain("<script>alert(1)</script>");
		expect(result).toContain("&lt;script&gt;");
		expect(result).toContain("&lt;/script&gt;");
	});
});
