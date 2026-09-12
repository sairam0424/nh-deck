import type { Token, Tokens } from "marked";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import { escapeHtml } from "./htmlEscape.js";
import { getEmbeddedKatexCss } from "./katexAssets.js";
import { renderMermaidDiagram } from "./mermaidRenderer.js";
import { PRESENTATION_SCRIPT } from "./presentationScript.js";
import { extractNotes, isPresenterNoteComment } from "./presenterNotes.js";
import { extractSlideLayout, resolveLayoutName } from "./slideLayouts.js";
import type { ThemeColors } from "./themes.js";
import type { TransitionName } from "./transitions.js";

const NOTES_STYLE = `
    .notes {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--nh-code-bg);
      border-top: 2px solid var(--nh-border);
      color: var(--nh-fg);
      padding: 1rem 1.5rem;
      max-height: 30vh;
      overflow-y: auto;
    }
    .notes:not([hidden]) {
      display: block;
    }
    @media print {
      .notes {
        display: none !important;
      }
    }`;

const PRINT_PAGINATION_STYLE = `
    @media print {
      .slide {
        break-after: page;
      }
    }`;

const LAYOUT_STYLE = `
    .slide.layout-title {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 60vh;
      text-align: center;
    }
    .slide.layout-title h1 {
      font-size: 3rem;
      border-bottom: none;
    }
    .slide.layout-title p:first-of-type {
      color: var(--nh-muted);
      font-size: 1.25rem;
    }
    .slide.layout-section {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 60vh;
      text-align: center;
    }
    .slide.layout-section h1,
    .slide.layout-section h2 {
      font-size: 2.5rem;
      border-bottom: none;
    }
    .slide.layout-section p,
    .slide.layout-section ul,
    .slide.layout-section ol {
      color: var(--nh-muted);
      font-size: 1rem;
    }
    .slide.layout-two-column {
      column-count: 2;
      column-gap: 2rem;
    }
    .slide.layout-two-column h1,
    .slide.layout-two-column h2,
    .slide.layout-two-column h3 {
      break-after: avoid;
    }
    .slide.layout-two-column pre,
    .slide.layout-two-column table,
    .slide.layout-two-column img,
    .slide.layout-two-column svg {
      break-inside: avoid;
    }
    .slide.layout-quote {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 60vh;
      text-align: center;
    }
    .slide.layout-quote p {
      font-size: 1.75rem;
      font-style: italic;
    }
    .slide.layout-quote p:not(:only-of-type):last-of-type {
      font-size: 1rem;
      font-style: normal;
      color: var(--nh-muted);
    }
    /* Without this, presentation mode's own display:block toggle
       (PRESENTATION_STYLE, and transitionToCssBlock when a transition is
       active) wins the specificity fight against .slide.layout-title's
       plain display:flex, silently breaking vertical centering only
       inside ?present. Re-asserting display:flex here at higher
       specificity (0,4,1) beats both (0,3,1) and (0,2,1) regardless of
       source order. layout-two-column needs no such rule -- column-count
       works on a block container, so presentation mode's forced
       display:block never breaks it. */
    body.presenting .slide.is-active.layout-title,
    body.presenting .slide.is-active.layout-section,
    body.presenting .slide.is-active.layout-quote {
      display: flex;
    }`;

const PRESENTATION_STYLE = `
    body.presenting .slide {
      display: none;
    }
    body.presenting .slide.is-active {
      display: block;
    }
    body.presenting .presentation-counter {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      background: var(--nh-code-bg);
      color: var(--nh-muted);
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      font-size: 0.85rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }`;

/**
 * Overrides PRESENTATION_STYLE's plain display:none/block toggle with an
 * animatable version for the given transition: both the active and
 * inactive slide stay display:block (position:absolute, stacked), so
 * opacity/transform can transition smoothly between them. Suppressible
 * by --css, unlike PRESENTATION_STYLE itself -- see the plan's Global
 * Constraints for why the split is drawn there.
 */
function transitionToCssBlock(name: TransitionName): string {
	if (name === "fade") {
		return `
    body.presenting .slide {
      display: block;
      position: absolute;
      inset: 0;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    body.presenting .slide.is-active {
      opacity: 1;
      pointer-events: auto;
    }`;
	}
	return `
    body.presenting .slide {
      display: block;
      position: absolute;
      inset: 0;
      transform: translateX(100%);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.3s ease, opacity 0.3s ease;
    }
    body.presenting .slide.is-active {
      transform: translateX(0);
      opacity: 1;
      pointer-events: auto;
    }`;
}

/**
 * Maps a theme's {bg, fg, line, accent, muted} onto nh-deck's own CSS
 * custom-property names, with fallback chains for themes that omit some
 * fields (all 4 shipped themes define every field today, but the registry
 * in themes.ts is designed to allow a future theme with fewer fields --
 * see docs/specs/theme-system-design.md §7).
 */
function themeToCssVarBlock(colors: ThemeColors): string {
	const border = colors.line ?? colors.muted ?? colors.fg;
	const muted = colors.muted ?? colors.line ?? colors.fg;
	const codeBg = colors.muted ?? colors.line ?? colors.bg;
	const accent = colors.accent ?? colors.fg;
	return `
    :root {
      --nh-bg: ${colors.bg};
      --nh-fg: ${colors.fg};
      --nh-border: ${border};
      --nh-muted: ${muted};
      --nh-code-bg: ${codeBg};
      --nh-accent: ${accent};
    }`;
}

marked.use(markedKatex({ throwOnError: false }));

// Set at the top of generateHtml (below) and read inside the code()
// renderer override's mermaid branch. Safe despite being module-level
// mutable state: generateHtml is fully synchronous end to end (no
// `await` anywhere in its call chain), and marked.use() registers this
// renderer once at module load -- it has no other way to receive
// per-call data, since it isn't invoked as part of a per-call closure.
// Node's single-threaded execution model guarantees no other
// generateHtml() call can interleave and observe a stale value here.
let currentMermaidColors: ThemeColors | undefined;

marked.use({
	renderer: {
		code({ text, lang, escaped }: Tokens.Code): string {
			const langString = (lang ?? "").match(/^\S*/)?.[0];

			if (langString === "mermaid") {
				return renderMermaidDiagram(text, currentMermaidColors);
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
export function generateHtml(
	markdown: string,
	title?: string,
	customCss?: string,
	themeColors?: ThemeColors,
	transitionName?: TransitionName,
): string {
	currentMermaidColors = themeColors;
	const tokens = marked.lexer(markdown);
	const slidesHtml = splitIntoSlides(tokens)
		.map((slideTokens) => {
			const { layout, tokens: filteredTokens } =
				extractSlideLayout(slideTokens);
			const { name: layoutName } = resolveLayoutName(layout);
			const layoutClass = layoutName ? ` layout-${layoutName}` : "";
			const notesHtml = extractNotes(filteredTokens)
				.map(
					(note) => `<aside class="notes" hidden>${escapeHtml(note)}</aside>`,
				)
				.join("\n");
			return `<section class="slide${layoutClass}">\n${marked.parser(filteredTokens)}${notesHtml}</section>`;
		})
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
	const themeOverride =
		!customCss && themeColors ? themeToCssVarBlock(themeColors) : "";
	const layoutOverride = !customCss ? LAYOUT_STYLE : "";
	const transitionStyle =
		!customCss && transitionName ? transitionToCssBlock(transitionName) : "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle}</title>
  <style>
${
	customCss ??
	`    :root {
      color-scheme: light dark;
      --nh-bg: #ffffff;
      --nh-fg: #1a1a1a;
      --nh-border: #e0e0e0;
      --nh-muted: #555555;
      --nh-code-bg: #f2f2f2;
      --nh-accent: #0b5fff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --nh-bg: #121212;
        --nh-fg: #e6e6e6;
        --nh-border: #333333;
        --nh-muted: #b0b0b0;
        --nh-code-bg: #1e1e1e;
        --nh-accent: #6ea8ff;
      }
    }
    ${themeOverride}
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      max-width: 860px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
      color: var(--nh-fg);
      background: var(--nh-bg);
    }
    h1, h2, h3, h4, h5, h6 {
      line-height: 1.25;
      margin-top: 2rem;
      margin-bottom: 0.75rem;
    }
    h1 { font-size: 2rem; border-bottom: 1px solid var(--nh-border); padding-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; }
    p { margin: 0.75rem 0; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: var(--nh-code-bg);
      color: var(--nh-fg);
      padding: 0.15em 0.35em;
      border-radius: 4px;
      font-size: 0.9em;
    }
    pre {
      background: var(--nh-code-bg);
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
    }
    blockquote {
      border-left: 4px solid var(--nh-border);
      margin: 1rem 0;
      padding: 0.25rem 1rem;
      color: var(--nh-muted);
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
    }
    th, td {
      border: 1px solid var(--nh-border);
      padding: 0.5rem 0.75rem;
      text-align: left;
    }
    img {
      max-width: 100%;
    }
    a {
      color: var(--nh-accent);
    }
    .katex {
      color: var(--nh-fg);
    }
    .slide {
      margin-bottom: 3rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid var(--nh-border);
    }
    .slide:last-of-type {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
    }`
}
    ${katexStyle}
    ${NOTES_STYLE}
    ${PRINT_PAGINATION_STYLE}
    ${PRESENTATION_STYLE}
    ${layoutOverride}
    ${transitionStyle}
  </style>
</head>
<body>
${slidesHtml}
  <script>
    if (new URLSearchParams(location.search).has("notes")) {
      document.querySelectorAll(".notes").forEach((el) => {
        el.hidden = false;
      });
    }
  </script>
  ${PRESENTATION_SCRIPT}
</body>
</html>
`;
}

/**
 * Returns true if `markdown` contains any raw-HTML content -- an "html"-type
 * token anywhere in marked's token tree, block-level or inline, nested
 * inside a paragraph/heading/list/table cell or not -- that is NOT a
 * presenter-note comment (see presenterNotes.ts's isPresenterNoteComment).
 *
 * A deck that only contains presenter-note comments is expected,
 * already-reviewed content (see presenterNotes.ts) and must never trip
 * this check; only genuine other raw HTML (a real tag like `<script>`,
 * `<iframe>`, `<img onerror=...>`, or any HTML comment that isn't a
 * standalone presenter note) should. See src/index.ts for where this feeds
 * a one-time, non-fatal stderr warning.
 */
export function containsUnsafeHtml(markdown: string): boolean {
	return tokenTreeContainsUnsafeHtml(marked.lexer(markdown));
}

/**
 * Walks the entire token tree generically (any array is walked
 * element-by-element, any object is walked property-by-property) rather
 * than hand-enumerating marked's per-token-type nested fields (Paragraph's
 * `.tokens`, List's `.items`, Table's `.header`/`.rows`, etc.) -- this stays
 * correct even if marked adds a new nested-token shape later, since it never
 * has to be told where nested tokens live.
 */
function tokenTreeContainsUnsafeHtml(node: unknown): boolean {
	if (Array.isArray(node)) {
		return node.some(tokenTreeContainsUnsafeHtml);
	}
	if (node === null || typeof node !== "object") {
		return false;
	}
	const token = node as Record<string, unknown>;
	if (
		token.type === "html" &&
		typeof token.text === "string" &&
		!isPresenterNoteComment(token.text)
	) {
		return true;
	}
	return Object.values(token).some(tokenTreeContainsUnsafeHtml);
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
