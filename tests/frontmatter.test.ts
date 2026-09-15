import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/frontmatter.js";

describe("parseFrontmatter", () => {
	it("extracts a single key: value frontmatter block", () => {
		const markdown = "---\ntheme: dark\n---\n# Slide one\n";
		const result = parseFrontmatter(markdown);

		expect(result.frontmatter).toEqual({ theme: "dark" });
		expect(result.body).toBe("# Slide one\n");
	});

	it("extracts frontmatter with multiple keys, ignoring unrecognized ones", () => {
		const markdown = "---\ntheme: nord\nauthor: someone\n---\n# Slide one\n";
		const result = parseFrontmatter(markdown);

		expect(result.frontmatter).toEqual({
			theme: "nord",
			author: "someone",
		});
		expect(result.body).toBe("# Slide one\n");
	});

	it("returns the whole markdown untouched when there is no leading ---", () => {
		const markdown = "# Slide one\n\n---\n\n# Slide two\n";
		const result = parseFrontmatter(markdown);

		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe(markdown);
	});

	it("returns the whole markdown untouched when the leading --- has no closing ---", () => {
		const markdown = "---\ntheme: dark\n# Slide one (no closing delimiter)\n";
		const result = parseFrontmatter(markdown);

		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe(markdown);
	});

	it("returns the whole markdown untouched when the block doesn't parse as flat key: value lines", () => {
		// A deck that intentionally opens with a horizontal rule, followed by
		// a slide whose content happens to also contain a bare "---" line --
		// must not be misread as frontmatter just because it starts with ---.
		const markdown =
			"---\nThis is just slide content, not frontmatter.\n---\n# Slide two\n";
		const result = parseFrontmatter(markdown);

		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe(markdown);
	});

	it("returns the whole markdown untouched for an empty file", () => {
		const result = parseFrontmatter("");

		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe("");
	});

	it("trims whitespace around keys and values", () => {
		const markdown = "---\n  theme :  dark  \n---\nbody\n";
		const result = parseFrontmatter(markdown);

		expect(result.frontmatter).toEqual({ theme: "dark" });
		expect(result.body).toBe("body\n");
	});

	it("extracts a dir: key alongside theme/transition, needing zero new parsing logic", () => {
		const markdown =
			"---\ndir: rtl\ntheme: dark\ntransition: fade\n---\n# Slide one\n";
		const result = parseFrontmatter(markdown);

		expect(result.frontmatter).toEqual({
			dir: "rtl",
			theme: "dark",
			transition: "fade",
		});
		expect(result.body).toBe("# Slide one\n");
	});
});
