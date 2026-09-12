/**
 * nh-deck's 2 fixed, deck-wide transition effects, only ever visually
 * meaningful inside presentation mode (?present) -- see
 * docs/specs/templates-transitions-design.md §2. Do not add a 3rd
 * transition or a custom-registration mechanism without a new design
 * pass; see that same spec's §7 (out of scope).
 */
export const TRANSITIONS = ["fade", "slide"] as const;
export type TransitionName = (typeof TRANSITIONS)[number];

/**
 * Validates a requested transition name (case-insensitive) against the
 * fixed set above. An unrecognized non-empty name falls back to no
 * transition with a warning message for the caller to print (non-fatal
 * -- never throws) -- unlike layout names, a transition name is resolved
 * once, up front, from frontmatter/a flag (mirroring resolveThemeName),
 * so surfacing a warning here poses none of the problems layout-name
 * warnings do. `undefined`/empty input silently resolves to no
 * transition with no warning, since "nothing was requested" is not an
 * error.
 */
export function resolveTransitionName(requested: string | undefined): {
	name?: TransitionName;
	warning?: string;
} {
	if (!requested || requested.trim().length === 0) {
		return {};
	}
	const normalized = requested.trim().toLowerCase();
	if ((TRANSITIONS as readonly string[]).includes(normalized)) {
		return { name: normalized as TransitionName };
	}
	return {
		warning: `nh-deck: warning: unknown transition '${requested}', no transition will be applied. Valid transitions: ${TRANSITIONS.join(", ")}.`,
	};
}
