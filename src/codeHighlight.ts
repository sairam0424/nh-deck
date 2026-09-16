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
