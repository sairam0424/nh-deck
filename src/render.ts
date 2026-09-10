import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import { getEmbeddedKatexCss } from "./katexAssets.js";

marked.use(markedKatex({ throwOnError: false }));

/**
 * Converts Markdown source into a complete, self-contained HTML document.
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
 * Mermaid (diagrams) rendering is explicitly deferred as a fast-follow
 * feature and is NOT wired up here yet.
 */
export function generateHtml(markdown: string, title?: string): string {
	const fragment = marked.parse(markdown, { async: false }) as string;
	const pageTitle = escapeHtml(
		title && title.trim().length > 0 ? title : "nh-deck",
	);
	// Only pay the ~360KB embedded-font cost when the deck actually uses
	// math -- checked against the rendered output itself (KaTeX always
	// wraps its markup in class="katex"), not against the raw source, so a
	// deck with zero math incurs zero size cost.
	const katexStyle = fragment.includes('class="katex"')
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
    @media (prefers-color-scheme: dark) {
      body { color: #e6e6e6; background: #121212; }
      h1 { border-bottom-color: #333333; }
      code, pre { background: #1e1e1e; }
      blockquote { border-left-color: #444444; color: #b0b0b0; }
      th, td { border-color: #333333; }
      a { color: #6ea8ff; }
    }
    ${katexStyle}
  </style>
</head>
<body>
${fragment}
</body>
</html>
`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
