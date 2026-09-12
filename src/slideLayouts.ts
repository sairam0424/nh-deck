import type { Token } from "marked";

const HTML_COMMENT_PATTERN = /^<!--([\s\S]*?)-->/;
const LAYOUT_MARKER_PATTERN = /^layout:\s*(\S+)/i;

/**
 * nh-deck's 4 fixed, opt-in per-slide layouts. A slide with no
 * <!-- layout: name --> marker renders with no layout at all (today's
 * exact behavior) -- see docs/specs/templates-transitions-design.md §2.
 * Do not add a 5th layout or a custom-layout-registration mechanism
 * without a new design pass; see that same spec's §7 (out of scope).
 */
export const LAYOUTS = ["title", "section", "two-column", "quote"] as const;
export type LayoutName = (typeof LAYOUTS)[number];

/**
 * Validates a requested layout name (case-insensitive) against the fixed
 * set above. Unlike resolveThemeName, an unrecognized name has no clean
 * way to surface a warning here -- layout markers are discovered inside
 * generateHtml's own lexing pipeline, not up front from simple frontmatter
 * -- so this silently returns no name for anything unrecognized (see
 * docs/specs/templates-transitions-design.md §3.1's revision).
 */
export function resolveLayoutName(requested: string | undefined): {
	name?: LayoutName;
} {
	if (!requested || requested.trim().length === 0) {
		return {};
	}
	const normalized = requested.trim().toLowerCase();
	return (LAYOUTS as readonly string[]).includes(normalized)
		? { name: normalized as LayoutName }
		: {};
}

function matchLayoutMarker(text: string): string | undefined {
	const commentMatch = text.match(HTML_COMMENT_PATTERN);
	if (!commentMatch) {
		return undefined;
	}
	const markerMatch = commentMatch[1].trim().match(LAYOUT_MARKER_PATTERN);
	return markerMatch ? markerMatch[1] : undefined;
}

/**
 * Scans one slide's token array for a standalone <!-- layout: name -->
 * comment (the same standalone-HTML-comment shape presenterNotes.ts
 * recognizes for presenter notes, disambiguated by content) and returns
 * the raw requested name (not yet validated -- callers pass it through
 * resolveLayoutName) plus the token array with every matching comment
 * removed. Removing every match here, not just the winning one, is what
 * keeps a layout marker from ever being rendered as a presenter note --
 * render.ts passes the returned `tokens` (not the original array) to
 * extractNotes, so extractNotes never sees a layout-marker token at all
 * and needs no change of its own. If more than one layout comment
 * appears, the first one found wins the `layout` field.
 */
export function extractSlideLayout(tokens: Token[]): {
	layout?: string;
	tokens: Token[];
} {
	let layout: string | undefined;
	let filtered: Token[] | undefined;
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		const markerName =
			token.type === "html" ? matchLayoutMarker(token.text) : undefined;
		if (markerName === undefined) {
			filtered?.push(token);
			continue;
		}
		if (layout === undefined) {
			layout = markerName;
		}
		if (!filtered) {
			filtered = tokens.slice(0, i);
		}
	}
	return { layout, tokens: filtered ?? tokens };
}
