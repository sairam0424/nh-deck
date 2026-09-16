import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// `highlight.js/lib/core` ships with zero languages pre-registered -- unlike
// the top-level `highlight.js` package (which bundles all ~190 of its
// supported languages, most of which this project's decks will never use).
// Importing core + registering exactly the languages below keeps the
// dependency's footprint proportional to what nh-deck actually needs, the
// same "no bundler, no unnecessary dependency weight" philosophy already
// documented in Context.md's Key decisions for tsc/puppeteer-core. This is a
// fixed, deliberately narrow registry (mirroring themes.ts's/slideLayouts.ts's
// own fixed-registry precedent) -- extending it is a real decision, not a
// drive-by addition.
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("xml", xml); // covers HTML too -- highlight.js has no separate "html" grammar.
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("go", go);

// Not one of the 12 languages this project actually syntax-highlights --
// this is the degrade-to-plain-text target for a fenced code block whose
// language tag isn't in the registry above. Registered the same way any
// other language is (highlight.js/lib/core throws "Unknown language" for
// anything not explicitly registered, even its own built-in "plaintext" --
// verified directly against the installed package, not assumed), so an
// unsupported language degrades harmlessly instead of throwing: "plaintext"
// has no grammar rules of its own, so hljs.highlight() against it just
// HTML-escapes the code with zero added <span> wrapping, the same visible
// result as before this file existed.
const FALLBACK_LANGUAGE = "plaintext";
hljs.registerLanguage(FALLBACK_LANGUAGE, plaintext);

/**
 * Syntax-highlights a fenced code block's raw source via highlight.js,
 * returning HTML-safe markup ready to drop straight into a `<code>` element
 * (already HTML-escaped by highlight.js itself -- callers must not run the
 * result through `escapeHtml` again).
 *
 * `info` is the FULL fence info string exactly as it appeared after the
 * opening ` ``` ` marker (e.g. "ts twoslash" for ` ```ts twoslash `), and
 * `lang` is the already-extracted bare language word a caller may have
 * derived from it (render.ts's own `code()` renderer does this for its
 * mermaid special-case, using the identical regex reused below). Deriving
 * the word from `info` here too -- rather than trusting a caller-supplied
 * `lang` at face value -- keeps this function correct and independently
 * testable on its own terms, regardless of what any particular caller
 * already computed.
 *
 * Special-cases the word being exactly "mermaid" by returning `code`
 * completely untouched, byte-for-byte -- render.ts's own `code()` renderer
 * override already never reaches this function for a mermaid block (its
 * mermaid branch returns early, before any call here), but this function
 * must stay correct in isolation regardless of which caller invokes it or
 * in what order, so that a mermaid fenced block's raw source is never at
 * risk of being run through highlight.js and corrupted before
 * `renderMermaidDiagram` (see mermaidRenderer.ts) ever sees it.
 *
 * An unregistered/unknown language word falls back to `FALLBACK_LANGUAGE`
 * ("plaintext") rather than throwing -- see that constant's own comment
 * above for why this degrades harmlessly instead of erroring.
 */
export function highlightCode(
	code: string,
	lang: string,
	info: string,
): string {
	const word = (info || lang || "").match(/^\S*/)?.[0] ?? "";
	if (word === "mermaid") {
		return code;
	}
	const language = hljs.getLanguage(word) ? word : FALLBACK_LANGUAGE;
	return hljs.highlight(code, { language }).value;
}

/**
 * Parses a Slidev-style line-highlight annotation -- the part of a fenced
 * code block's info string that comes after the bare language word, e.g.
 * "{1|3-4}" in a fence opened as " ```js {1|3-4} " -- into the Set of
 * 1-based line numbers it marks for highlighting.
 *
 * `annotation` is expected verbatim, braces included (applyLineHighlights
 * below passes it through untouched): if it doesn't look like a "{...}"
 * block at all -- absent, empty, or just plain text with no braces -- this
 * returns `undefined`, meaning "no highlighting requested", so a caller can
 * tell "annotation given but empty/malformed" apart from "no annotation at
 * all" only by this single undefined-vs-Set check, never by inspecting the
 * Set's own size.
 *
 * Once the "{...}" wrapper is confirmed, the inner text is split on "|" and
 * each piece is matched against either a plain integer ("3") or an
 * inclusive "A-B" range ("3-4"); anything else (a typo, stray whitespace
 * that isn't part of a valid piece, an out-of-order range) is silently
 * ignored rather than thrown -- a malformed annotation degrades harmlessly
 * to "highlight whatever pieces WERE parseable" instead of blowing up
 * rendering over a typo in a slide deck's own fence line.
 */
export function parseHighlightSpec(
	annotation: string,
): Set<number> | undefined {
	const wrapped = annotation.match(/^\{(.*)\}$/);
	if (!wrapped) {
		return undefined;
	}
	const lines = new Set<number>();
	for (const rawPiece of wrapped[1].split("|")) {
		const piece = rawPiece.trim();
		const singleMatch = piece.match(/^(\d+)$/);
		if (singleMatch) {
			lines.add(Number(singleMatch[1]));
			continue;
		}
		const rangeMatch = piece.match(/^(\d+)-(\d+)$/);
		if (rangeMatch) {
			const start = Number(rangeMatch[1]);
			const end = Number(rangeMatch[2]);
			for (let line = start; line <= end; line++) {
				lines.add(line);
			}
		}
		// Anything else (empty piece, non-numeric text, ...) is silently
		// ignored -- see this function's own docstring above.
	}
	return lines;
}

/**
 * Splits an already-highlight.js-rendered HTML string into one string per
 * source line, without ever breaking an hljs-* `<span>` that opens on one
 * line and only closes several lines later -- exactly what a multi-line
 * comment or string highlights as (verified directly against a real
 * `hljs.highlight()` call in tests/codeHighlight.test.ts, not assumed).
 *
 * Technique: tokenize the whole string into a flat stream of span-opens,
 * span-closes, and plain-text runs (`/<span class="[^"]*">|<\/span>|[^<]+/g`
 * is exhaustive here because highlight.js always HTML-escapes source text
 * before wrapping it -- a plain-text token can never itself contain a
 * stray "<" or ">"). Track a stack of the exact currently-open opening-tag
 * strings; whenever a literal "\n" is hit inside a text token, close every
 * open span in reverse order to end that line, push the finished line, then
 * reopen the identical stack of spans (in original order) to begin the
 * next line's own string.
 *
 * highlightCode's own callers always hand this a string whose source ends
 * with exactly one trailing "\n" (see render.ts's `code()` renderer
 * override, which normalizes with `text.replace(/\n$/, "") + "\n"` before
 * ever calling highlightCode) -- so the final newline is a line
 * TERMINATOR, not the start of an extra trailing blank line. Concretely:
 * the running `current` buffer is only pushed as a final line if it is
 * non-empty once every token has been consumed; a well-formed trailing
 * "\n" always leaves `current` empty at that point (nothing left to flush),
 * while a genuine blank final source line (two consecutive newlines) still
 * gets its own empty-string entry via the loop's own per-newline push.
 */
export function splitHighlightedHtml(html: string): string[] {
	const tokens = html.match(/<span class="[^"]*">|<\/span>|[^<]+/g) ?? [];
	const openSpanStack: string[] = [];
	const lines: string[] = [];
	let current = "";

	for (const token of tokens) {
		if (token === "</span>") {
			current += token;
			openSpanStack.pop();
			continue;
		}
		if (token.startsWith('<span class="')) {
			current += token;
			openSpanStack.push(token);
			continue;
		}
		const parts = token.split("\n");
		for (let i = 0; i < parts.length; i++) {
			current += parts[i];
			const isLastPart = i === parts.length - 1;
			if (isLastPart) {
				continue;
			}
			for (let j = openSpanStack.length - 1; j >= 0; j--) {
				current += "</span>";
			}
			lines.push(current);
			current = openSpanStack.join("");
		}
	}
	if (current !== "") {
		lines.push(current);
	}
	return lines;
}

/**
 * Applies Slidev-style `{1|3-4}` line highlighting on top of an
 * already-highlight.js-rendered `highlightedHtml` string, using the fenced
 * code block's own full `info` string (the same value already passed to
 * `highlightCode` as its own `info` parameter -- see that function's
 * docstring) to recover the annotation.
 *
 * `info`'s bare language word is stripped the exact same way `highlightCode`
 * itself already strips it -- a leading run of non-whitespace characters --
 * and everything after it, trimmed, is treated as the potential annotation
 * for `parseHighlightSpec`. When that
 * returns `undefined` (no annotation given, or a string that doesn't look
 * like a "{...}" block at all), `highlightedHtml` is returned completely
 * untouched -- byte-identical to how this code block would have rendered
 * before this feature existed, verified directly in
 * tests/codeHighlight.test.ts and tests/render.test.ts. Otherwise, every
 * line (via splitHighlightedHtml) is wrapped in its own
 * `<span class="nh-code-line">` (plus `nh-code-line-highlighted` for a
 * 1-based line number in the parsed Set), rejoined with real "\n"
 * characters between the wrapping spans -- never inside them -- so a
 * reader who copy-pastes highlighted code back out of the rendered page
 * still gets real newlines in the copied text, not one that only look like
 * line breaks via CSS.
 */
export function applyLineHighlights(
	highlightedHtml: string,
	info: string,
): string {
	const word = (info || "").match(/^\S*/)?.[0] ?? "";
	const annotation = info.slice(word.length).trim();
	const highlightedLines = parseHighlightSpec(annotation);
	if (!highlightedLines) {
		return highlightedHtml;
	}
	return splitHighlightedHtml(highlightedHtml)
		.map((line, index) => {
			const lineNumber = index + 1;
			const className = highlightedLines.has(lineNumber)
				? "nh-code-line nh-code-line-highlighted"
				: "nh-code-line";
			return `<span class="${className}">${line}</span>`;
		})
		.join("\n");
}
