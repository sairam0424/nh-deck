/**
 * nh-deck's 2 fixed text-direction values for a deck's own authored
 * content -- opt-in only, via a deck's own frontmatter "dir:" key or a
 * --dir flag (see frontmatter.ts and index.ts), the same way --theme and
 * --transition are already opt-in. A deck that specifies neither renders
 * exactly as it did before this feature existed: generateHtml (render.ts)
 * only emits a `dir="rtl"` attribute when this resolves to "rtl", never for
 * "ltr" (the default), since left-to-right is already the browser's own
 * unmarked default and adding the attribute for it would change nothing but
 * the markup's byte count.
 *
 * Deliberately scoped to text direction only -- this does not touch
 * presentation-mode navigation-key semantics (ArrowLeft/ArrowRight keep
 * their current meaning regardless of a deck's direction) or reposition any
 * presentation-mode chrome (the help hint, presenter timer, jump
 * indicator); both were explicitly researched and deferred as separate,
 * not-yet-approved decisions.
 */
export const DIRECTIONS = ["ltr", "rtl"] as const;
export type DirectionName = (typeof DIRECTIONS)[number];

export const DEFAULT_DIRECTION_NAME: DirectionName = "ltr";

/**
 * Validates a requested direction name (case-insensitive) against the fixed
 * set above -- mirrors resolveThemeName's exact shape (themes.ts), not
 * resolveTransitionName's (transitions.ts): an unrecognized non-empty name
 * falls back to DEFAULT_DIRECTION_NAME with a warning message for the
 * caller to print (non-fatal -- never throws). `undefined`/empty input
 * silently resolves to the default with no warning, since "nothing was
 * requested" is not an error. Unlike layout names (slideLayouts.ts), which
 * silently no-op on an unrecognized value (see that file's own documented
 * exception), a direction name warns, matching theme/transition.
 */
export function resolveDirectionName(requested: string | undefined): {
	name: DirectionName;
	warning?: string;
} {
	if (!requested || requested.trim().length === 0) {
		return { name: DEFAULT_DIRECTION_NAME };
	}
	const normalized = requested.trim().toLowerCase();
	if ((DIRECTIONS as readonly string[]).includes(normalized)) {
		return { name: normalized as DirectionName };
	}
	return {
		name: DEFAULT_DIRECTION_NAME,
		warning: `nh-deck: warning: unknown direction '${requested}', using default direction '${DEFAULT_DIRECTION_NAME}'. Valid directions: ${DIRECTIONS.join(", ")}.`,
	};
}
