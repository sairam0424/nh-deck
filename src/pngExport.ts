import { basename, dirname, join } from "node:path";
import puppeteer from "puppeteer-core";
import { detectBrowserExecutable } from "./browserLaunch.js";

/**
 * Renders the given HTML and screenshots each `<section class="slide">`
 * to its own PNG file, using a locally-installed Chrome/Chromium/Edge/Brave
 * browser detected via chrome-launcher (see browserLaunch.ts). File names
 * are derived by inserting "-N" (1-indexed) before outputPath's extension,
 * e.g. "deck.png" -> "deck-1.png", "deck-2.png", ... Returns the list of
 * file paths actually written, in slide order.
 */
export async function exportToPng(
	html: string,
	outputPath: string,
): Promise<string[]> {
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
		const sections = await page.$$("section.slide");

		const written: string[] = [];
		for (let i = 0; i < sections.length; i++) {
			const path = insertSlideNumber(outputPath, i + 1);
			await sections[i].screenshot({ path });
			written.push(path);
		}
		await page.close();
		return written;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to export PNG using ${executablePath}: ${message}`);
	} finally {
		await browser?.close();
	}
}

function insertSlideNumber(outputPath: string, slideNumber: number): string {
	const dir = dirname(outputPath);
	const base = basename(outputPath);
	const lastDot = base.lastIndexOf(".");
	const newBase =
		lastDot === -1
			? `${base}-${slideNumber}`
			: `${base.slice(0, lastDot)}-${slideNumber}${base.slice(lastDot)}`;
	return join(dir, newBase);
}
