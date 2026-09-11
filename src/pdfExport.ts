import puppeteer from "puppeteer-core";
import { detectBrowserExecutable } from "./browserLaunch.js";

/**
 * Renders the given HTML to a PDF at outputPath using a locally-installed
 * Chrome/Chromium/Edge/Brave browser, detected via chrome-launcher.
 *
 * No Chromium is bundled or downloaded — if no local installation is found,
 * this throws a clear, descriptive Error rather than crashing with a raw
 * Puppeteer stack trace.
 *
 * `executablePathOverride`, when provided, is used instead of calling
 * `detectBrowserExecutable()` -- existing 2-argument callers are unaffected.
 * This exists so `scripts/check-pdf-fidelity.mjs` can drive the same export
 * path against two different detected browsers for a visual-fidelity
 * comparison, rather than always exporting against whichever browser
 * chrome-launcher would pick first.
 *
 * `extraLaunchArgs`, when provided, is appended to Puppeteer's launch args.
 * Existing callers passing 0-3 arguments are unaffected (defaults to none).
 * This exists so `scripts/check-pdf-fidelity.mjs` can pass `--no-sandbox`
 * for a freshly-downloaded CI-only Chromium build whose sandbox helper
 * lacks the setuid permissions GitHub Actions containers need -- the real
 * CLI export path (used on a real end user's own machine, with a
 * normally-installed browser) never needs this and never passes it.
 */
export async function exportToPdf(
	html: string,
	outputPath: string,
	executablePathOverride?: string,
	extraLaunchArgs: string[] = [],
): Promise<void> {
	const executablePath = executablePathOverride ?? detectBrowserExecutable();

	let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
	try {
		browser = await puppeteer.launch({
			executablePath,
			headless: true,
			args: extraLaunchArgs,
		});
		const page = await browser.newPage();
		// "networkidle0"/"networkidle2" are not valid waitUntil values for
		// setContent() (only for real navigation via goto()) as of
		// puppeteer-core 25.x's types — setContent() injects HTML directly
		// rather than navigating, so "load" (fired once that injected content
		// has finished loading) is the correct and sufficient wait condition
		// here, especially given nh-deck's local-first constraint: rendered
		// decks never depend on a network fetch to finish loading.
		await page.setContent(html, { waitUntil: "load" });
		await page.pdf({ path: outputPath, format: "A4", printBackground: true });
		await page.close();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to export PDF using ${executablePath}: ${message}`);
	} finally {
		await browser?.close();
	}
}
