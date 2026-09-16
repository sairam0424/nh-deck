import type { Token } from "marked";

const HTML_COMMENT_PATTERN = /^<!--([\s\S]*?)-->/;
const BACKGROUND_COLOR_PATTERN = /^bg:\s*(\S.*)$/i;
const BACKGROUND_IMAGE_PATTERN = /^bg-image:\s*(\S.*)$/i;

/**
 * An opt-in per-slide background, authored as a standalone
 * <!-- bg: value --> or <!-- bg-image: value --> HTML comment -- see
 * extractSlideBackground below. `value` is passed through exactly as the
 * author typed it (a color, a relative/absolute path, or a data URI are
 * all equally just a string here); nothing in this module ever fetches or
 * inlines the bytes behind an image path.
 */
export type SlideBackground = {
	type: "color" | "image";
	value: string;
};

function matchBackgroundMarker(text: string): SlideBackground | undefined {
	const commentMatch = text.match(HTML_COMMENT_PATTERN);
	if (!commentMatch) {
		return undefined;
	}
	const inner = commentMatch[1].trim();
	const imageMatch = inner.match(BACKGROUND_IMAGE_PATTERN);
	if (imageMatch) {
		return { type: "image", value: imageMatch[1] };
	}
	const colorMatch = inner.match(BACKGROUND_COLOR_PATTERN);
	if (colorMatch) {
		return { type: "color", value: colorMatch[1] };
	}
	return undefined;
}

/**
 * Returns true if `text` is (the start of) a standalone HTML comment whose
 * inner text matches either the "bg: <value>" or "bg-image: <value>"
 * marker pattern -- case-insensitive on the "bg"/"bg-image" keyword itself,
 * mirroring LAYOUT_MARKER_PATTERN's own case-insensitivity in
 * slideLayouts.ts. Shared with render.ts's containsUnsafeHtml the same way
 * isPresenterNoteComment/isFragmentMarkerComment already are, so a
 * background-marked deck never trips that unsafe-HTML warning.
 */
export function isBackgroundMarkerComment(text: string): boolean {
	return matchBackgroundMarker(text) !== undefined;
}

/**
 * Scans one slide's token array for a standalone <!-- bg: value --> or
 * <!-- bg-image: value --> comment (the same standalone-HTML-comment shape
 * presenterNotes.ts recognizes for presenter notes and slideLayouts.ts
 * recognizes for a layout marker, disambiguated by content) and returns the
 * extracted background (if any) plus the token array with every matching
 * comment removed. Removing every match here, not just the winning one, is
 * what keeps a background marker from ever being rendered as a presenter
 * note -- render.ts passes the returned `tokens` (not the original array)
 * on to extractFragments/extractNotes, so neither ever sees a
 * background-marker token at all. If more than one background comment
 * appears, the first one found wins the `background` field.
 */
export function extractSlideBackground(tokens: Token[]): {
	background?: SlideBackground;
	tokens: Token[];
} {
	let background: SlideBackground | undefined;
	let filtered: Token[] | undefined;
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		const marker =
			token.type === "html" ? matchBackgroundMarker(token.text) : undefined;
		if (marker === undefined) {
			filtered?.push(token);
			continue;
		}
		if (background === undefined) {
			background = marker;
		}
		if (!filtered) {
			filtered = tokens.slice(0, i);
		}
	}
	return { background, tokens: filtered ?? tokens };
}
