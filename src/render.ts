import { marked } from "marked";
import type { Token } from "marked";

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
 * KaTeX (math) and Mermaid (diagrams) rendering are explicitly deferred as a
 * fast-follow feature and are NOT wired up here yet.
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
  return groups.filter((group) =>
    group.some((token) => token.type !== "space"),
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
