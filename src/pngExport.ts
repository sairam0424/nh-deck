import { basename, dirname, join } from "node:path";
import puppeteer from "puppeteer-core";
import { detectBrowserExecutable } from "./browserLaunch.js";

/**
 * Renders the given HTML and screenshots each `<section class="slide">`
 * to its own PNG file, using a locally-installed Chrome/Chromium/Edge/Brave
 * browser detected via chrome-launcher (see browserLaunch.ts). File names
 * are derived by inserting "-N" (1-indexed, zero-padded to the width of the
 * deck's own total slide count) before outputPath's extension, e.g.
 * "deck.png" -> "deck-1.png", "deck-2.png" for a 2-slide deck, but
 * "deck-01.png" ... "deck-12.png" for a 12-slide deck -- unpadded numbers
 * would otherwise sort lexicographically wrong ("deck-10.png" before
 * "deck-2.png" in a plain filesystem listing). Returns the list of file
 * paths actually written, in slide order.
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
export async function exportToPng(
	html: string,
	outputPath: string,
	executablePathOverride?: string,
	extraLaunchArgs: string[] = [],
): Promise<string[]> {
	const executablePath = executablePathOverride ?? detectBrowserExecutable();

	let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
	try {
		browser = await puppeteer.launch({
			executablePath,
			headless: true,
			args: extraLaunchArgs,
		});
		const page = await browser.newPage();
		// Explicitly locked to a deliberate 16:9 size (matching the deck's
		// own on-screen/PDF-export aspect ratio) rather than leaving
		// puppeteer-core's implicit default viewport (800x600) in play.
		// Without this, every screenshot in this export call still shares
		// *a* viewport (it's the same `page` for the whole loop below), but
		// it's an undocumented library default rather than a size this
		// project actually intends -- and any `vh`/`vw`-relative CSS in a
		// slide's layout (e.g. LAYOUT_STYLE's `min-height: 60vh` for the
		// title/section/quote layouts in render.ts) would resolve against
		// that arbitrary default instead of a size matching the rest of the
		// export pipeline.
		await page.setViewport({ width: 1280, height: 720 });
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
			const path = insertSlideNumber(outputPath, i + 1, sections.length);
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

function insertSlideNumber(
	outputPath: string,
	slideNumber: number,
	totalSlides: number,
): string {
	const dir = dirname(outputPath);
	const base = basename(outputPath);
	const lastDot = base.lastIndexOf(".");
	const paddedNumber = String(slideNumber).padStart(
		String(totalSlides).length,
		"0",
	);
	const newBase =
		lastDot === -1
			? `${base}-${paddedNumber}`
			: `${base.slice(0, lastDot)}-${paddedNumber}${base.slice(lastDot)}`;
	return join(dir, newBase);
}
