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
