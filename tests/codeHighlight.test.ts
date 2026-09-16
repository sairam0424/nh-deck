import { describe, expect, it } from "vitest";
import {
	applyLineHighlights,
	highlightCode,
	parseHighlightSpec,
	splitHighlightedHtml,
} from "../src/codeHighlight.js";

describe("parseHighlightSpec", () => {
	it("parses a single line number", () => {
		expect(parseHighlightSpec("{1}")).toEqual(new Set([1]));
	});

	it("parses a range", () => {
		expect(parseHighlightSpec("{3-4}")).toEqual(new Set([3, 4]));
	});

	it("parses a pipe-combined mix of a single line and a range", () => {
		expect(parseHighlightSpec("{1|3-4}")).toEqual(new Set([1, 3, 4]));
	});

	it("returns undefined for a malformed annotation (no braces at all)", () => {
		expect(parseHighlightSpec("1|3-4")).toBeUndefined();
	});

	it("returns undefined for an absent annotation (empty string)", () => {
		expect(parseHighlightSpec("")).toBeUndefined();
	});

	it("silently ignores a malformed piece inside an otherwise-valid annotation", () => {
		expect(parseHighlightSpec("{abc|2}")).toEqual(new Set([2]));
	});
});

describe("splitHighlightedHtml", () => {
	it("splits a span that deliberately spans 3 lines without breaking any tag", () => {
		// Mirrors real highlight.js output for an unterminated-looking
		// multi-line comment (see codeHighlight.test's "real hljs" describe
		// block below for the actual hljs.highlight() shape this is modeled
		// on) -- one <span> opens on line 1 and only closes on line 3, plus
		// the single trailing "\n" every highlightCode() caller's `code`
		// text is normalized to end with (see render.ts's `code()` renderer
		// override), which must NOT produce a spurious 4th empty line.
		const html = '<span class="hljs-comment">/* a\nb\nc */</span>\n';

		const lines = splitHighlightedHtml(html);

		expect(lines).toHaveLength(3);
		for (const line of lines) {
			expect(line).toContain('class="hljs-comment"');
			const opens = line.match(/<span class="[^"]*">/g)?.length ?? 0;
			const closes = line.match(/<\/span>/g)?.length ?? 0;
			expect(opens).toBe(closes);
		}
		expect(lines[0]).toBe('<span class="hljs-comment">/* a</span>');
		expect(lines[1]).toBe('<span class="hljs-comment">b</span>');
		expect(lines[2]).toBe('<span class="hljs-comment">c */</span>');
	});

	it("splits plain (non-span) highlighted lines with no trailing empty line artifact", () => {
		const html =
			'<span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span>;\n<span class="hljs-keyword">const</span> y = <span class="hljs-number">2</span>;\n';

		const lines = splitHighlightedHtml(html);

		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe(
			'<span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span>;',
		);
		expect(lines[1]).toBe(
			'<span class="hljs-keyword">const</span> y = <span class="hljs-number">2</span>;',
		);
	});
});

describe("applyLineHighlights", () => {
	it("wraps each line and marks the highlighted set, using a real hljs.highlight() call", () => {
		const code = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n";
		const info = "javascript {1|3-4}";
		const highlighted = highlightCode(code, "javascript", info);

		const result = applyLineHighlights(highlighted, info);
		const lines = result.split("\n");

		expect(lines).toHaveLength(4);
		expect(lines[0]).toContain("nh-code-line-highlighted");
		expect(lines[1]).not.toContain("nh-code-line-highlighted");
		expect(lines[2]).toContain("nh-code-line-highlighted");
		expect(lines[3]).toContain("nh-code-line-highlighted");
		expect(lines[1]).toContain('class="nh-code-line"');
	});

	it("returns the highlighted HTML completely unchanged (byte-identical) when no annotation is given", () => {
		const code = "const a = 1;\n";
		const info = "javascript";
		const highlighted = highlightCode(code, "javascript", info);

		expect(applyLineHighlights(highlighted, info)).toBe(highlighted);
	});

	it("returns the highlighted HTML completely unchanged when the info string is empty", () => {
		const code = "const a = 1;\n";
		const highlighted = highlightCode(code, "javascript", "javascript");

		expect(applyLineHighlights(highlighted, "")).toBe(highlighted);
	});
});
