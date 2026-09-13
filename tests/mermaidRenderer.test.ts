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

		// svgo's minifyStyles (part of the preset-default optimization pass)
		// HTML-entity-encodes quotes inside the SVG's inline <style> text
		// node, so "Inter" can come back as &quot;Inter&quot; rather than a
		// literal quote character -- functionally identical CSS, so the
		// assertion accepts either serialization.
		expect(svg).toMatch(
			/font-family:\s*(?:&quot;|['"])?Inter(?:&quot;|['"])?,\s*system-ui,\s*sans-serif/,
		);
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

	it("prefixes every id/class with the given diagramIndex so multiple diagrams in one document never collide", () => {
		const first = renderMermaidDiagram("flowchart TD\n  A --> B", undefined, 0);
		const second = renderMermaidDiagram(
			"flowchart TD\n  C --> D",
			undefined,
			1,
		);

		expect(first).toContain('id="nh-mermaid-0__arrowhead"');
		expect(second).toContain('id="nh-mermaid-1__arrowhead"');

		const idPattern = /\bid="([^"]+)"/g;
		const firstIds = [...first.matchAll(idPattern)].map((m) => m[1]);
		const secondIds = [...second.matchAll(idPattern)].map((m) => m[1]);
		expect(firstIds.some((id) => secondIds.includes(id))).toBe(false);
	});

	it("defaults diagramIndex to 0 when not provided, preserving the existing call signature", () => {
		const withDefault = renderMermaidDiagram("flowchart TD\n  A --> B");
		const withExplicitZero = renderMermaidDiagram(
			"flowchart TD\n  A --> B",
			undefined,
			0,
		);

		expect(withDefault).toBe(withExplicitZero);
	});
});
