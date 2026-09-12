const KEY_VALUE_LINE_PATTERN = /^([^:\n]+):(.*)$/;

/**
 * Splits `markdown` into a frontmatter object and the remaining body, using
 * a deliberately narrow rule: only recognized as frontmatter if the file
 * starts with a line that is exactly "---", a closing line that is exactly
 * "---" exists somewhere after it, AND every non-blank line between them
 * parses as a flat "key: value" pair (no nesting, no lists -- this project
 * has no YAML dependency and doesn't need one for a single "theme" key).
 *
 * If any of those conditions fail, the ENTIRE original markdown is returned
 * untouched as `body`, with an empty `frontmatter` object. This is
 * deliberate: nh-deck's slide-separator convention also uses a bare "---"
 * line, so a deck that opens with a stylistic horizontal rule (with no
 * real frontmatter intent) must render exactly as it would without this
 * feature -- never partially consumed as if it were a failed frontmatter
 * block.
 */
export interface ParsedFrontmatter {
	frontmatter: Record<string, string>;
	body: string;
}

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
	const lines = markdown.split("\n");
	if (lines[0] !== "---") {
		return { frontmatter: {}, body: markdown };
	}

	const closingIndex = lines.indexOf("---", 1);
	if (closingIndex === -1) {
		return { frontmatter: {}, body: markdown };
	}

	const frontmatter: Record<string, string> = {};
	for (const line of lines.slice(1, closingIndex)) {
		if (line.trim().length === 0) {
			continue;
		}
		const match = line.match(KEY_VALUE_LINE_PATTERN);
		if (!match) {
			// A non-key:value, non-blank line inside the block means this isn't
			// really frontmatter -- bail out and treat the whole file as-is.
			return { frontmatter: {}, body: markdown };
		}
		frontmatter[match[1].trim()] = match[2].trim();
	}

	const body = lines.slice(closingIndex + 1).join("\n");
	return { frontmatter, body };
}
