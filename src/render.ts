import type { Token, Tokens } from "marked";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import { escapeHtml } from "./htmlEscape.js";
import { getEmbeddedKatexCss } from "./katexAssets.js";
import { renderMermaidDiagram } from "./mermaidRenderer.js";

marked.use(markedKatex({ throwOnError: false }));

marked.use({
	useNewRenderer: true,
	renderer: {
		code({ text, lang, escaped }: Tokens.Code): string {
			const langString = (lang ?? "").match(/^\S*/)?.[0];

			if (langString === "mermaid") {
				return renderMermaidDiagram(text);
			}

			// Everything below exactly replicates marked@13.0.3's own default
			// code() renderer (verified directly against its source) for every
			// language other than "mermaid" -- this override must not change how
			// any other fenced code block renders.
			const code = `${text.replace(/\n$/, "")}\n`;
			if (!langString) {
				return `<pre><code>${escaped ? code : escapeHtml(code)}</code></pre>\n`;
			}
			return `<pre><code class="language-${escapeHtml(langString)}">${escaped ? code : escapeHtml(code)}</code></pre>\n`;
		},
	},
});

/**
 * Converts Markdown source into a complete, self-contained HTML document,
 * split into `<section class="slide">` blocks on each top-level `---`
 * thematic break.
 *
 * Slide-boundary detection is delegated entirely to marked's own tokenizer
 * (see splitIntoSlides below) rather than a hand-rolled regex over the raw
 * Markdown string, because CommonMark's own grammar is ambiguous here: a
 * `---` immediately after a paragraph line (no blank line) is a setext H2
 * heading underline, not a thematic break, and a `---` inside a fenced code
 * block is never a break at all. marked's tokenizer already resolves both
 * cases correctly (verified directly against its lexer output) — see
 * docs/adr/0002-per-slide-segmentation.md for the full comparison against
 * a regex-based alternative.
 *
 * Local-first constraint: the returned document must never reference any
 * external CDN (no <script src="https://...">, no <link href="https://...">).
 * Everything needed to render correctly is inlined.
 *
 * KaTeX math (inline `$...$` and block `$$...$$`) renders via
 * `marked-katex-extension`, which hooks into `marked`'s own tokenizer
 * extension API -- so `$` inside inline code or a fenced code block is
 * never mistaken for math (marked's own code tokenization runs first).
 * Invalid LaTeX degrades to a visible `class="katex-error"` span instead of
 * throwing (`throwOnError: false`).
 *
 * Mermaid (diagrams) rendering is wired up via a marked renderer override on
 * the `code` token (see the `marked.use({ renderer: { code ... } })` call
 * above) -- `mermaid` fenced code blocks render as CDN-free SVG diagrams via
 * `renderMermaidDiagram`, while every other language renders exactly as
 * marked's own default code renderer would.
 */
export function generateHtml(markdown: string, title?: string): string {
	const tokens = marked.lexer(markdown);
	const slidesHtml = splitIntoSlides(tokens)
		.map(
			(slideTokens) =>
				`<section class="slide">\n${marked.parser(slideTokens)}</section>`,
		)
		.join("\n");
	const pageTitle = escapeHtml(
		title && title.trim().length > 0 ? title : "nh-deck",
	);
	// Only pay the ~360KB embedded-font cost when the deck actually uses
	// math -- checked against the rendered output itself (KaTeX always
	// wraps its markup in class="katex"), not against the raw source, so a
	// deck with zero math incurs zero size cost.
	const katexStyle = slidesHtml.includes('class="katex"')
		? getEmbeddedKatexCss()
		: "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle}</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      max-width: 860px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
      color: #1a1a1a;
      background: #ffffff;
    }
    h1, h2, h3, h4, h5, h6 {
      line-height: 1.25;
      margin-top: 2rem;
      margin-bottom: 0.75rem;
    }
    h1 { font-size: 2rem; border-bottom: 1px solid #e0e0e0; padding-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; }
    p { margin: 0.75rem 0; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: #f2f2f2;
      padding: 0.15em 0.35em;
      border-radius: 4px;
      font-size: 0.9em;
    }
    pre {
      background: #f2f2f2;
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
    }
    blockquote {
      border-left: 4px solid #d0d0d0;
      margin: 1rem 0;
      padding: 0.25rem 1rem;
      color: #555555;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
    }
    th, td {
      border: 1px solid #d0d0d0;
      padding: 0.5rem 0.75rem;
      text-align: left;
    }
    img {
      max-width: 100%;
    }
    a {
      color: #0b5fff;
    }
    .slide {
      margin-bottom: 3rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid #e0e0e0;
    }
    .slide:last-of-type {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #e6e6e6; background: #121212; }
      h1 { border-bottom-color: #333333; }
      code, pre { background: #1e1e1e; }
      blockquote { border-left-color: #444444; color: #b0b0b0; }
      th, td { border-color: #333333; }
      a { color: #6ea8ff; }
      .slide { border-bottom-color: #333333; }
    }
    ${katexStyle}
  </style>
</head>
<body>
${slidesHtml}
</body>
</html>
`;
}

/**
 * Groups a top-level token stream into one array per slide, dividing at
 * each "hr" token (marked's tokenizer output for a `---` thematic break).
 * Two consecutive "hr" tokens — or a leading/trailing one — produce an
 * empty group; those are filtered out rather than rendered as a blank
 * slide. A stream with no "hr" tokens at all produces exactly one group
 * (the required backward-compatibility case for a deck with no delimiter).
 *
 * If every group turns out empty (or whitespace-only), the general filter
 * below would discard all of them and return zero slides — a silent blank
 * page with no error. This happens not only for an empty/whitespace-only
 * deck with no "hr" token (`marked.lexer("")` -> `[]`,
 * `marked.lexer("   \n\n   ")` -> a single "space" token, so `groups` has
 * exactly one, already-empty entry), but also for a deck consisting solely
 * of one or more `---` delimiters plus whitespace (e.g. "---", or
 * "---\n\n---"): every "hr" token pushes an additional empty group, so
 * `groups` ends up with two or more empty entries instead of one. Rescuing
 * only when `groups.length === 1` catches the former case but misses the
 * latter, so the rescue fires whenever *every* group is empty, regardless
 * of how many "hr"-caused splits produced them — and collapses back down to
 * exactly one (empty) group, preserving the "never render zero sections"
 * invariant without rendering a pile of redundant blank slides for a
 * document that has no visible content anywhere.
 */
function splitIntoSlides(tokens: Token[]): Token[][] {
	const groups: Token[][] = [];
	let current: Token[] = [];
	for (const token of tokens) {
		if (token.type === "hr") {
			groups.push(current);
			current = [];
		} else {
			current.push(token);
		}
	}
	groups.push(current);

	const nonEmptyGroups = groups.filter((group) =>
		group.some((token) => token.type !== "space"),
	);
	if (nonEmptyGroups.length === 0) {
		return [groups[0]];
	}
	return nonEmptyGroups;
}
