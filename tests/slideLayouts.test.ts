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
