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

/**
 * Deliberately NOT `position: fixed` at the base -- the default
 * continuous-scroll view has no single "current slide" concept, so a
 * fixed bottom overlay would unhide and stack EVERY slide's note at the
 * identical screen position the moment `?notes` reveals them all at once
 * (a real shipped bug, verified via getComputedStyle() in
 * tests/render.test.ts's "presenter notes reveal" describe block, not a
 * hypothetical). A revealed note here stays in normal document flow
 * (`position: static`, the CSS default) as a bordered inline box
 * immediately after its own slide's content, since
 * `<aside class="notes">` is emitted inside that same slide's `<section>`
 * (see generateHtml below).
 *
 * `body.presenting .notes` below re-applies the fixed bottom-overlay
 * behavior, but scoped to real presentation mode, where
 * `body.presenting .slide.is-active` (PRESENTATION_STYLE) guarantees
 * exactly one slide -- and therefore at most one revealed note -- is ever
 * visible at a time.
 */
const NOTES_STYLE = `
    .notes {
      display: none;
      background: var(--nh-code-bg);
      border: 1px solid var(--nh-border);
      border-radius: 6px;
      color: var(--nh-fg);
      padding: 1rem 1.5rem;
      margin-top: 1.5rem;
    }
    .notes:not([hidden]) {
      display: block;
    }
    body.presenting .notes {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      margin-top: 0;
      border: none;
      border-top: 2px solid var(--nh-border);
      border-radius: 0;
      max-height: 30vh;
      overflow-y: auto;
    }
    @media print {
      .notes {
        display: none !important;
      }
    }`;

/**
 * `print-color-adjust: exact` (plus the `-webkit-` prefix Chromium/Safari
 * still need) stops a browser's print pipeline from silently substituting
 * background colors for something print-friendlier -- without it, a dark
 * theme's `--nh-bg` background is dropped entirely when a user prints this
 * raw `generateHtml()` output directly via the browser's own Ctrl+P dialog.
 * Scoped to the universal selector (not just `.slide`/`body`) since the
 * property does not inherit to descendants in every browser implementation,
 * and any element could carry a theme-derived background (code blocks,
 * blockquotes, mermaid diagram fills, ...). This is a separate code path
 * from pdfExport.ts's own `printBackground: true` Puppeteer option, which
 * only covers the CLI's own `pdf`/`png` export commands, not a raw
 * browser print of the rendered HTML.
 */
const PRINT_PAGINATION_STYLE = `
    @media print {
      .slide {
        break-after: page;
      }
      * {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
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
      font-size: clamp(2.25rem, 5vw, 3.5rem);
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
    @media (max-width: 640px) {
      .slide.layout-two-column { column-count: 1; }
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
    .presentation-counter {
      display: none;
    }
    body.presenting .presentation-counter {
      display: block;
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
 * Grid "slide overview" mode -- the convention shared by reveal.js, Slidev,
 * Marp, and deckrun -- toggled by PRESENTATION_SCRIPT's Escape/"o" handling
 * via a `.overview` class added onto the same `<body>` element
 * `body.presenting` is scoped under. Every `.slide` becomes visible at once
 * (not just the `.is-active` one), laid out in a CSS grid of thumbnails, and
 * clickable to jump straight to that slide.
 *
 * Deliberately NOT gated behind `!customCss` the way LAYOUT_STYLE/
 * transitionStyle/progressStyle are -- like PRESENTATION_STYLE itself, this
 * defines a core interactive mechanic of presentation mode (an alternate way
 * to see and navigate slides), not a suppressible decorative flourish, so a
 * custom --css should not be able to silently break it.
 *
 * Every `.slide` override below uses `!important` rather than leaning on
 * selector specificity to beat PRESENTATION_STYLE's `body.presenting .slide`
 * toggle, transitionToCssBlock's per-transition `position: absolute`/
 * `transform`/`opacity` rules, and LAYOUT_STYLE's `min-height: 60vh` title/
 * section/quote centering -- all of which must be overridden regardless of
 * which transition (if any) is active or where in the stylesheet this block
 * ends up relative to them. This mirrors REDUCED_MOTION_STYLE's own
 * established use of `!important` above for the identical kind of problem
 * (overriding contextual presentation-mode state without a specificity
 * fight).
 */
const OVERVIEW_STYLE = `
    body.overview {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 1rem;
      max-width: none;
      padding: 2rem;
      align-content: start;
    }
    body.overview .presentation-counter,
    body.overview .presentation-progress {
      display: none !important;
    }
    body.overview .slide {
      display: block !important;
      position: static !important;
      inset: auto !important;
      transform: none !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      transition: none !important;
      min-height: 0 !important;
      max-height: 220px;
      overflow: hidden;
      margin: 0 !important;
      padding: 0.75rem;
      border: 1px solid var(--nh-border);
      border-radius: 6px;
      font-size: 0.55rem;
      cursor: pointer;
    }
    body.overview .slide.is-active {
      border-color: var(--nh-accent);
    }
    body.overview .notes {
      display: none !important;
    }`;

/**
 * Scoped under body.presenting the same way .presentation-counter is,
 * above -- but kept in its own constant rather than folded into
 * PRESENTATION_STYLE so it can be suppressed by a custom --css the same
 * way LAYOUT_STYLE/transitionToCssBlock's output already is (see
 * layoutOverride/transitionStyle in generateHtml below). PRESENTATION_STYLE
 * itself is deliberately NOT suppressible -- the slide show/hide toggle it
 * defines is load-bearing for presentation mode's entire visual mechanic --
 * but a decorative progress bar has no such requirement.
 */
const PRESENTATION_PROGRESS_STYLE = `
    .presentation-progress {
      display: none;
    }
    body.presenting .presentation-progress {
      display: block;
      position: fixed;
      bottom: 0;
      left: 0;
      height: 2px;
      background: var(--nh-accent);
      width: 0%;
      transition: width 0.2s ease;
    }`;

/**
 * Appended, unconditionally, to every transitionToCssBlock() return value
 * regardless of which transition (fade/slide) is active -- a user who has
 * prefers-reduced-motion enabled gets a fast opacity-only crossfade instead
 * of either the full slide/fade animation or motion being silently left
 * untouched. Deliberately substitutes a fast crossfade rather than
 * disabling the transition entirely (transition: none): an instant, jarring
 * slide swap with zero visual continuity is its own kind of jolt, and a
 * fast linear opacity fade is the pattern verified against a real
 * competitor's implementation of this same accessibility affordance.
 */
const REDUCED_MOTION_STYLE = `
    @media (prefers-reduced-motion: reduce) {
      .slide { transition: opacity 0.2s linear !important; transform: none !important; }
    }`;

/**
 * Overrides PRESENTATION_STYLE's plain display:none/block toggle with an
 * animatable version for the given transition: both the active and
 * inactive slide stay display:block (position:absolute, stacked), so
 * opacity/transform can transition smoothly between them. Suppressible
 * by --css, unlike PRESENTATION_STYLE itself -- see the plan's Global
 * Constraints for why the split is drawn there.
 *
 * The "slide" transition also carries a `body.presenting.direction-backward`
 * override: PRESENTATION_SCRIPT toggles that class onto <body> at the moment
 * of navigation (ArrowLeft, or ArrowRight's/click's absence of it), so a
 * backward navigation flips the translateX sign instead of replaying the
 * exact same left-to-right motion forward navigation uses.
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
    }${REDUCED_MOTION_STYLE}`;
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
    }
    body.presenting.direction-backward .slide {
      transform: translateX(-100%);
    }
    body.presenting.direction-backward .slide.is-active {
      transform: translateX(0);
    }${REDUCED_MOTION_STYLE}`;
}

// Percentage of --nh-fg blended into --nh-bg to derive --nh-code-bg and
// --nh-border independently of a theme's `line`/`muted` colors below.
// `line`/`muted` are tuned for mermaid diagram roles (edge/connector color,
// secondary diagram-label text) -- not for a UI element's background or
// border -- and for all 4 shipped themes, `muted` happens to be the exact
// hex beautiful-mermaid also uses for `line` (dracula) or is otherwise
// untuned for contrast against `bg`/`fg` in a UI context. That mismatch is
// what let --nh-code-bg collapse to the exact same hex as --nh-muted (the
// Nord theme, notably), and let --nh-border fall under WCAG's 3:1 minimum
// against --nh-bg for every shipped theme except dracula.
//
// Verified with the real WCAG 2.x contrast-ratio formula against all 4
// shipped themes' actual resolved colors (see the
// "theme code-bg/border WCAG contrast" describe block in
// tests/render.test.ts, which checks this live via getComputedStyle rather
// than by inspecting these hex constants):
//   - CODE_BG_FG_BLEND_PERCENT (10%) keeps --nh-fg vs --nh-code-bg contrast
//     >= 7.1:1 for every shipped theme (WCAG AA for normal text requires
//     >= 4.5:1) -- comfortable margin because a small blend toward --nh-fg
//     barely moves --nh-code-bg away from --nh-bg, and --nh-fg already has
//     high contrast against --nh-bg in all 4 shipped themes.
//   - BORDER_FG_BLEND_PERCENT (55%) keeps --nh-border vs --nh-bg contrast
//     >= 3.6:1 for every shipped theme (WCAG's 3:1 non-text/UI-boundary
//     minimum). This needs to be a much larger blend than
//     CODE_BG_FG_BLEND_PERCENT because sRGB's gamma curve makes contrast
//     rise slowly near white: the light theme (white --nh-bg) needs >=
//     ~48% blended in before it clears 3:1 at all.
const CODE_BG_FG_BLEND_PERCENT = 10;
const BORDER_FG_BLEND_PERCENT = 55;

/**
 * Splits a "#rrggbb" string into its three 0-255 channel values.
 */
function hexToRgbChannels(hex: string): [number, number, number] {
	const normalized = hex.replace("#", "");
	return [
		Number.parseInt(normalized.slice(0, 2), 16),
		Number.parseInt(normalized.slice(2, 4), 16),
		Number.parseInt(normalized.slice(4, 6), 16),
	];
}

/**
 * Blends `toColor` into `fromColor` by `weightPercent` (0-100), interpolating
 * each RGB channel linearly in gamma-encoded sRGB space -- the same
 * approach CSS's `color-mix(in srgb, ...)` uses, and the one
 * beautiful-mermaid's own theme system already uses internally for its
 * derived diagram colors (see its `MIX`-weighted `color-mix()` rules in
 * node_modules/beautiful-mermaid/src/theme.ts). Implemented here as a
 * plain hex computation -- rather than emitting a `color-mix()` CSS
 * function -- so nh-deck's `--nh-*` variables keep resolving to concrete
 * hex values, as every other theme variable already does.
 *
 * Assumes both inputs are "#rrggbb" hex strings, which holds for every
 * ThemeColors value in practice (themes.ts re-exports beautiful-mermaid's
 * own hex palettes; see themes.ts's docstring).
 */
function blendHexColors(
	fromColor: string,
	toColor: string,
	weightPercent: number,
): string {
	const from = hexToRgbChannels(fromColor);
	const to = hexToRgbChannels(toColor);
	const weight = weightPercent / 100;
	const toHexByte = (channel: number) =>
		Math.round(channel).toString(16).padStart(2, "0");
	return `#${from.map((channel, i) => toHexByte(channel + (to[i] - channel) * weight)).join("")}`;
}

/**
 * Maps a theme's {bg, fg, line, accent, muted} onto nh-deck's own CSS
 * custom-property names, with fallback chains for themes that omit some
 * fields (all 4 shipped themes define every field today, but the registry
 * in themes.ts is designed to allow a future theme with fewer fields --
 * see docs/specs/theme-system-design.md §7).
 */
function themeToCssVarBlock(colors: ThemeColors): string {
	const muted = colors.muted ?? colors.line ?? colors.fg;
	// --nh-border and --nh-code-bg are UI-chrome roles (a UI-boundary line,
	// a code block's own background) -- deliberately derived straight from
	// bg/fg rather than from muted/line (diagram-label/edge-connector
	// colors), see CODE_BG_FG_BLEND_PERCENT/BORDER_FG_BLEND_PERCENT above.
	const codeBg = blendHexColors(colors.bg, colors.fg, CODE_BG_FG_BLEND_PERCENT);
	const border = blendHexColors(colors.bg, colors.fg, BORDER_FG_BLEND_PERCENT);
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

// Reset alongside currentMermaidColors at the top of each generateHtml()
// call (same module-level-state reasoning as the comment above) and
// incremented once per mermaid code block, so renderMermaidDiagram can give
// each diagram's SVG ids a unique prefix -- without this, two diagrams in
// the same document both emit id="arrowhead", which is invalid HTML/SVG and
// lets one diagram's marker definitions leak into another's.
let mermaidDiagramCounter = 0;

marked.use({
	renderer: {
		code({ text, lang, escaped }: Tokens.Code): string {
			const langString = (lang ?? "").match(/^\S*/)?.[0];

			if (langString === "mermaid") {
				return renderMermaidDiagram(
					text,
					currentMermaidColors,
					mermaidDiagramCounter++,
				);
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
	mermaidDiagramCounter = 0;
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
	const progressStyle = !customCss ? PRESENTATION_PROGRESS_STYLE : "";

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
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
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
    ${OVERVIEW_STYLE}
    ${progressStyle}
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
