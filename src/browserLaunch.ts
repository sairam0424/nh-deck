import { Launcher } from "chrome-launcher";

/**
 * Detects a locally-installed Chrome/Chromium/Edge/Brave browser via
 * chrome-launcher and returns its executable path. No Chromium is bundled
 * or downloaded -- throws a clear, descriptive Error if none is found,
 * shared by every export path (PDF, PNG) that needs a local browser.
 */
export function detectBrowserExecutable(): string {
	const installations = Launcher.getInstallations();

	if (!installations || installations.length === 0) {
		throw new Error(
			"No local Chrome, Chromium, Edge, or Brave installation was found. " +
				"nh-deck requires one of these browsers to be installed on this machine to export decks. " +
				"An automatic download fallback is a planned but not-yet-implemented feature.",
		);
	}

	// installations[0] is intentional, not a missing-selection-logic bug:
	// chrome-launcher's own README documents that "the first installation
	// returned from this method is used instead" when no explicit chromePath
	// is given, and getInstallations() returns paths in decreasing priority
	// order per platform. Do not add custom selection logic here.
	return installations[0];
}
