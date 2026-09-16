import { marked } from "marked";
import { describe, expect, it } from "vitest";
import {
	extractSlideBackground,
	isBackgroundMarkerComment,
} from "../src/slideBackgrounds.js";

describe("isBackgroundMarkerComment", () => {
	it("recognizes a bg: color marker", () => {
		expect(isBackgroundMarkerComment("<!-- bg: #222 -->")).toBe(true);
	});

	it("recognizes a bg-image: marker", () => {
		expect(
			isBackgroundMarkerComment("<!-- bg-image: path/to/image.jpg -->"),
		).toBe(true);
	});

	it("is case-insensitive on the bg/bg-image keyword", () => {
		expect(isBackgroundMarkerComment("<!-- BG: #222 -->")).toBe(true);
		expect(isBackgroundMarkerComment("<!-- Bg-Image: image.jpg -->")).toBe(
			true,
		);
	});

	it("does not mistake an ordinary presenter note for a background marker", () => {
		expect(
			isBackgroundMarkerComment("<!-- remember to slow down here -->"),
		).toBe(false);
	});

	it("does not mistake a layout marker for a background marker", () => {
		expect(isBackgroundMarkerComment("<!-- layout: title -->")).toBe(false);
	});
});

describe("extractSlideBackground", () => {
	it("extracts a color background from a standalone HTML comment and removes it from the token stream", () => {
		const tokens = marked.lexer("<!-- bg: #222 -->\n\n# Hi\n");

		const result = extractSlideBackground(tokens);

		expect(result.background).toEqual({ type: "color", value: "#222" });
		expect(result.tokens.some((t) => t.type === "html")).toBe(false);
		expect(result.tokens.some((t) => t.type === "heading")).toBe(true);
	});

	it("extracts an image background from a standalone HTML comment and removes it from the token stream", () => {
		const tokens = marked.lexer(
			"<!-- bg-image: path/to/image.jpg -->\n\n# Hi\n",
		);

		const result = extractSlideBackground(tokens);

		expect(result.background).toEqual({
			type: "image",
			value: "path/to/image.jpg",
		});
		expect(result.tokens.some((t) => t.type === "html")).toBe(false);
		expect(result.tokens.some((t) => t.type === "heading")).toBe(true);
	});

	it("leaves tokens unchanged when no background marker is present", () => {
		const tokens = marked.lexer("# Hi\n");

		const result = extractSlideBackground(tokens);

		expect(result.background).toBeUndefined();
		expect(result.tokens).toEqual(tokens);
	});

	it("does not mistake a presenter note for a background marker", () => {
		const tokens = marked.lexer(
			"<!-- remember to slow down here -->\n\n# Hi\n",
		);

		const result = extractSlideBackground(tokens);

		expect(result.background).toBeUndefined();
		expect(result.tokens).toEqual(tokens);
	});

	it("uses the first background marker when multiple appear, dropping both from the token stream", () => {
		const tokens = marked.lexer(
			"<!-- bg: #222 -->\n\n<!-- bg-image: image.jpg -->\n\n# Hi\n",
		);

		const result = extractSlideBackground(tokens);

		expect(result.background).toEqual({ type: "color", value: "#222" });
		expect(result.tokens.some((t) => t.type === "html")).toBe(false);
	});

	it("does not interfere with a presenter note sitting alongside a background marker on the same slide", () => {
		const tokens = marked.lexer(
			"<!-- bg: #222 -->\n\n<!-- remember to slow down here -->\n\n# Hi\n",
		);

		const result = extractSlideBackground(tokens);

		expect(result.background).toEqual({ type: "color", value: "#222" });
		// The presenter note is a distinct standalone HTML comment that does
		// not match the bg/bg-image pattern, so it must survive extraction
		// untouched -- presenterNotes.ts's own extractNotes still needs to
		// find it in the returned tokens.
		const remainingHtmlComments = result.tokens.filter(
			(t) => t.type === "html",
		);
		expect(remainingHtmlComments).toHaveLength(1);
		expect((remainingHtmlComments[0] as { text: string }).text).toContain(
			"remember to slow down here",
		);
	});
});
