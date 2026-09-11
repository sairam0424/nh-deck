import { THEMES as MERMAID_THEMES } from "beautiful-mermaid";

export interface ThemeColors {
	bg: string;
	fg: string;
	line?: string;
	accent?: string;
	muted?: string;
}

export interface Theme {
	name: string;
	colors: ThemeColors;
}

export const DEFAULT_THEME_NAME = "light";

/**
 * nh-deck's 4 fixed named themes, each a thin re-export of one of
 * beautiful-mermaid's own built-in color palettes (already a dependency,
 * used for Mermaid diagram rendering) rather than a bespoke palette --
 * see docs/specs/theme-system-design.md §2 for why. Do not add a 5th theme
 * or a custom-theme-registration mechanism without a new design pass;
 * see that same spec's §7 (out of scope).
 */
export const THEMES: Record<string, Theme> = {
	light: { name: "light", colors: MERMAID_THEMES["github-light"] },
	dark: { name: "dark", colors: MERMAID_THEMES["github-dark"] },
	dracula: { name: "dracula", colors: MERMAID_THEMES.dracula },
	nord: { name: "nord", colors: MERMAID_THEMES.nord },
};

/**
 * Validates a requested theme name (case-insensitive) against the fixed
 * set above. An unrecognized non-empty name falls back to
 * DEFAULT_THEME_NAME with a warning message for the caller to print
 * (non-fatal -- never throws). `undefined`/empty input silently resolves
 * to the default with no warning, since "nothing was requested" is not
 * an error.
 */
export function resolveThemeName(requested: string | undefined): {
	name: string;
	warning?: string;
} {
	if (!requested || requested.trim().length === 0) {
		return { name: DEFAULT_THEME_NAME };
	}
	const normalized = requested.trim().toLowerCase();
	if (normalized in THEMES) {
		return { name: normalized };
	}
	return {
		name: DEFAULT_THEME_NAME,
		warning: `nh-deck: warning: unknown theme '${requested}', using default theme '${DEFAULT_THEME_NAME}'. Valid themes: ${Object.keys(THEMES).join(", ")}.`,
	};
}
