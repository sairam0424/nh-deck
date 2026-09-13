import { renderMermaidSVG } from "beautiful-mermaid";
import { optimize } from "svgo";
import { escapeHtml } from "./htmlEscape.js";
import type { ThemeColors } from "./themes.js";

const CSS_IMPORT_PATTERN = /@import url\([^)]*\);?\s*/g;

/**
 * Renders Mermaid diagram source to an embeddable SVG string, or a visible
 * escaped error box if the source is invalid.
 *
 * `colors`, when provided, is passed straight through to beautiful-mermaid's
 * own renderMermaidSVG -- it already supports custom {bg, fg, line, accent,
 * muted} colors natively (see docs/specs/theme-system-design.md §2), so no
 * new Mermaid-specific theming logic is needed here beyond forwarding the
 * parameter.
 *
 * beautiful-mermaid's own generated CSS contains an unconditional Google
 * Fonts @import -- a real external CDN fetch, verified directly against its
 * own source, not a namespace-identifier false positive like an SVG's
 * xmlns. Stripped here; the library's own font-family rule already falls
 * back to 'system-ui, sans-serif', so this degrades gracefully with no
 * other change needed.
 *
 * beautiful-mermaid has no throwOnError-style option (unlike KaTeX) -- it
 * throws a plain Error for invalid syntax. This is nh-deck's own
 * equivalent: one malformed diagram must not crash the whole render.
 *
 * `diagramIndex` (supplied by render.ts, incrementing once per mermaid
 * block in a document) becomes svgo's `prefixIds` prefix. Without it, every
 * diagram's marker defs share the same ids (e.g. id="arrowhead"), which is
 * invalid once 2+ diagrams land in one HTML document and lets one
 * diagram's markers leak into another's. svgo's `preset-default` also
 * shaves real size off beautiful-mermaid's unminified SVG output.
 */
export function renderMermaidDiagram(
	code: string,
	colors?: ThemeColors,
	diagramIndex = 0,
): string {
	try {
		const svg = renderMermaidSVG(code, colors);
		const stripped = svg.replace(CSS_IMPORT_PATTERN, "");
		const optimized = optimize(stripped, {
			plugins: [
				"preset-default",
				{
					name: "prefixIds",
					params: { prefix: `nh-mermaid-${diagramIndex}` },
				},
			],
		});
		return optimized.data;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return `<pre class="mermaid-error">Mermaid diagram error: ${escapeHtml(message)}</pre>`;
	}
}
