import { Launcher } from "chrome-launcher";

/**
 * Returns every local Chrome/Chromium/Edge/Brave installation chrome-launcher
 * can find, via `Launcher.getInstallations()`, in the same decreasing
 * priority order chrome-launcher itself returns them in (empty array if none
 * are found). No Chromium is bundled or downloaded -- this only reports what
 * chrome-launcher can already see on this machine. Used by
 * `detectBrowserExecutable()` below, and directly by
 * `scripts/check-pdf-fidelity.mjs` when more than one installation is needed
 * (a cross-browser visual-fidelity comparison).
 */
export function detectAllBrowserExecutables(): string[] {
	return Launcher.getInstallations() ?? [];
}

/**
 * Detects a locally-installed Chrome/Chromium/Edge/Brave browser via
 * chrome-launcher and returns its executable path. No Chromium is bundled
 * or downloaded -- throws a clear, descriptive Error if none is found,
 * shared by every export path (PDF, PNG) that needs a local browser.
 */
export function detectBrowserExecutable(): string {
	const installations = detectAllBrowserExecutables();

	if (installations.length === 0) {
		throw new Error(
			"No local Chrome, Chromium, Edge, or Brave installation was found. " +
				"nh-deck requires one of these browsers to be installed on this machine to export decks.",
		);
	}

	// installations[0] is intentional, not a missing-selection-logic bug:
	// chrome-launcher's own README documents that "the first installation
	// returned from this method is used instead" when no explicit chromePath
	// is given, and getInstallations() returns paths in decreasing priority
	// order per platform. Do not add custom selection logic here.
	return installations[0];
}
