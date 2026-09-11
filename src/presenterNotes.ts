import type { Token } from "marked";

const HTML_COMMENT_PATTERN = /^<!--([\s\S]*?)-->/;

/**
 * Extracts presenter notes from one slide's token group: the trimmed text
 * of every standalone HTML comment (marked's own tokenizer already emits
 * a comment on its own line as a distinct "html"-type token, verified
 * directly against marked's lexer output -- this never needs a regex over
 * raw Markdown source). Comments already pass through unmodified into
 * generateHtml's rendered output today and are already invisible in any
 * browser (a real HTML comment is never rendered) -- this function only
 * extracts their text for separate display, it does not need to hide
 * anything that isn't already hidden.
 */
export function extractNotes(tokens: Token[]): string[] {
	const notes: string[] = [];
	for (const token of tokens) {
		if (token.type === "html") {
			const match = token.text.match(HTML_COMMENT_PATTERN);
			if (match) {
				notes.push(match[1].trim());
			}
		}
	}
	return notes;
}

/**
 * Returns true if `text` is (the start of) a standalone HTML comment, using
 * the exact same pattern extractNotes uses to recognize a presenter note.
 * Shared with render.ts's containsUnsafeHtml so both places agree on what
 * counts as an already-reviewed, expected presenter-note comment versus
 * genuine other raw HTML.
 */
export function isPresenterNoteComment(text: string): boolean {
	return HTML_COMMENT_PATTERN.test(text);
}
