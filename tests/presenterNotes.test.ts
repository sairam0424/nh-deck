import { marked } from "marked";
import { describe, expect, it } from "vitest";
import { extractNotes, hasPresenterNotes } from "../src/presenterNotes.js";

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

describe("hasPresenterNotes", () => {
	it("returns true for a deck with a single presenter note", () => {
		expect(
			hasPresenterNotes("# Slide\n\nText.\n\n<!-- remember to breathe -->\n"),
		).toBe(true);
	});

	it("returns true for a multi-slide deck whose note is on a later slide", () => {
		expect(
			hasPresenterNotes(
				"# Slide One\n\nFirst.\n\n---\n\n# Slide Two\n\n<!-- pause here -->\n",
			),
		).toBe(true);
	});

	it("returns false for a deck with zero presenter notes", () => {
		expect(hasPresenterNotes("# Slide\n\nJust text, no notes.")).toBe(false);
	});

	it("returns false for a deck containing only non-comment raw HTML", () => {
		expect(hasPresenterNotes("# Slide\n\n<div>not a comment</div>\n")).toBe(
			false,
		);
	});
});
