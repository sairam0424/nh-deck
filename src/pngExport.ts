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
 *
 * If `html` was generated with `generateHtml(..., withNotes: true)`, it may
 * additionally contain one `<div class="notes-page" data-notes-for="N">`
 * per slide that has at least one presenter note (see render.ts's
 * NOTES_PAGE_STYLE docstring) -- this function has no separate `withNotes`
 * parameter of its own because the presence of that markup in `html` is
 * already the single source of truth for whether "also export a notes
 * file" was requested; there is nothing else this function would need a
 * flag to decide. Each such div is screenshotted to its own
 * `<base>-<N>-notes.<ext>` file (e.g. "deck-1-notes.png" next to
 * "deck-1.png"), appended to the end of the returned `written` array,
 * after every real slide's own file. `data-notes-for`'s value is exactly
 * the 1-indexed slide number generateHtml assigned that slide, so the file
 * name always lines up with its own slide's file regardless of how many
 * earlier slides had no note (and therefore no notes-page div) at all. A
 * deck with no notes-page divs (either because `withNotes` was false, or
 * every slide happened to have zero notes) produces this function's exact
 * pre-existing output -- `section.slide` never matches a `<div>`, so this
 * addition changes nothing when there is nothing to add.
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

		// `section.slide` above never matches a `<div>`, so this query only
		// ever finds anything when `html` came from
		// `generateHtml(..., withNotes: true)` -- see this function's own
		// docstring for why that (rather than a separate parameter here) is
		// this function's single source of truth for "also export notes
		// files". Queried and processed after every real slide's own file
		// above, so `written`'s slide files keep their exact pre-existing
		// order and values regardless of whether any notes files are appended.
		const notesPages = await page.$$("div.notes-page");
		for (const notesPage of notesPages) {
			const slideNumberAttr = await notesPage.evaluate((el) =>
				el.getAttribute("data-notes-for"),
			);
			const slideNumber = Number(slideNumberAttr);
			if (!Number.isInteger(slideNumber) || slideNumber < 1) {
				throw new Error(
					`Encountered a notes-page element with an invalid data-notes-for attribute: ${String(slideNumberAttr)}`,
				);
			}
			const path = insertSlideNumber(
				outputPath,
				slideNumber,
				sections.length,
				"-notes",
			);
			await notesPage.screenshot({ path });
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

/**
 * `suffix`, when given (e.g. "-notes"), is inserted immediately after the
 * zero-padded number and before the extension -- e.g. "deck-1-notes.png"
 * for slideNumber=1, suffix="-notes" -- so a notes file sorts immediately
 * after its own slide's file for the exact same zero-padded number, using
 * the identical padding width every other file for this export already
 * uses (`totalSlides`, the REAL slide count, not counting any notes-page
 * elements). Defaults to "" for every existing call site, leaving their
 * output completely unchanged.
 */
function insertSlideNumber(
	outputPath: string,
	slideNumber: number,
	totalSlides: number,
	suffix = "",
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
			? `${base}-${paddedNumber}${suffix}`
			: `${base.slice(0, lastDot)}-${paddedNumber}${suffix}${base.slice(lastDot)}`;
	return join(dir, newBase);
}
