import puppeteer from "puppeteer-core";
import { detectBrowserExecutable } from "./browserLaunch.js";

/**
 * Renders the given HTML to a PDF at outputPath using a locally-installed
 * Chrome/Chromium/Edge/Brave browser, detected via chrome-launcher.
 *
 * No Chromium is bundled or downloaded — if no local installation is found,
 * this throws a clear, descriptive Error rather than crashing with a raw
 * Puppeteer stack trace. An automatic download fallback is a planned but
 * not-yet-implemented feature.
 */
export async function exportToPdf(
	html: string,
	outputPath: string,
): Promise<void> {
	const executablePath = detectBrowserExecutable();

	let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
	try {
		browser = await puppeteer.launch({ executablePath, headless: true });
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
