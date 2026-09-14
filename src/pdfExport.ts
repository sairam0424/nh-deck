import puppeteer from "puppeteer-core";
import { detectBrowserExecutable } from "./browserLaunch.js";

/**
 * Small, unobtrusive centered page-number footer injected into every
 * exported PDF page via Puppeteer's displayHeaderFooter/footerTemplate.
 * Header/footer templates render in their own isolated document context
 * (Chromium's print pipeline) with no access to the deck's own <style>
 * block, so this cannot reference the deck's `var(--nh-muted)` custom
 * property and instead hardcodes a neutral muted gray matching this
 * codebase's existing muted-text-color convention (see render.ts's
 * `.presentation-counter`/`.slide.layout-section p`, which both use
 * `color: var(--nh-muted)` at a small font-size for the same
 * unobtrusive-secondary-text role).
 *
 * `headerTemplate` is deliberately left unset: verified empirically that
 * Puppeteer's default (an empty string) renders no header content at all
 * -- it does not fall back to Chromium's own built-in header (which would
 * otherwise print the document title/URL/date), so there is nothing to
 * suppress here.
 */
const PDF_FOOTER_TEMPLATE = `
  <div style="width: 100%; font-size: 8px; text-align: center; color: #888888; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <span class="pageNumber"></span> / <span class="totalPages"></span>
  </div>`;

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
 *
 * If `html` was generated with `generateHtml(..., withNotes: true)`, it may
 * additionally contain one `<div class="notes-page">` per slide that has a
 * presenter note (see render.ts's NOTES_PAGE_STYLE docstring). This
 * function needs no code of its own to handle that -- `.notes-page`'s own
 * `@media print { break-after: page }` rule (part of the `html` passed in)
 * already turns each one into its own additional PDF page immediately
 * following its slide's page, through the exact same print pipeline that
 * already paginates every `.slide` below.
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
		await page.pdf({
			path: outputPath,
			// 13.333in x 7.5in is the standard 16:9 widescreen slide size
			// (the PowerPoint/Google Slides default), matching this deck's own
			// on-screen aspect ratio -- deliberately NOT `format: "A4"`
			// (portrait), which produced narrow, vertically-stacked pages for
			// 100% of export users.
			//
			// Deliberately no `landscape: true` alongside these explicit
			// width/height values: verified empirically against this installed
			// puppeteer-core version (probe script, both outputs' /MediaBox
			// inspected directly) that combining `landscape: true` with an
			// already-landscape-shaped explicit width/height SWAPS them straight
			// back to portrait -- Chromium's Page.printToPDF treats `landscape`
			// as "rotate the given paperWidth/paperHeight", not "this pair is
			// already rotated". So `landscape` is intentionally omitted here,
			// not merely forgotten.
			width: "13.333in",
			height: "7.5in",
			printBackground: true,
			displayHeaderFooter: true,
			footerTemplate: PDF_FOOTER_TEMPLATE,
			margin: { top: "0in", bottom: "0.3in", left: "0in", right: "0in" },
			// Generates a real PDF outline (the bookmarks/table-of-contents
			// sidebar every major PDF viewer -- Preview, Acrobat, Chrome's own
			// viewer -- already has UI for). This `outline` field maps directly
			// to Chromium's own CDP `Page.printToPDF` `generateDocumentOutline`
			// parameter: Chromium builds the outline straight from the
			// already-rendered page's own accessibility tree -- its real
			// <h1>-<h6> heading structure, the same tree screen readers use --
			// not from any separate authored table of contents this codebase
			// would have to build and keep in sync itself.
			//
			// This needs no launch-arg change alongside it: puppeteer-core's
			// ChromeLauncher already passes the `--export-tagged-pdf` and
			// `--generate-pdf-document-outline` flags this depends on as part
			// of its own DEFAULT launch args (verified directly in its
			// source), and the `puppeteer.launch()` call above never sets
			// `ignoreDefaultArgs`, so those flags are already active today,
			// simply unused until this option asks for them.
			//
			// There is deliberately no authoring control here over outline
			// granularity -- every <h1>-<h6> the deck's own Markdown produces
			// becomes its own outline entry, however many that is. That is the
			// correct, faithful-to-the-user's-own-content default for this
			// project's render-faithfully-don't-editorialize identity (see
			// SOUL.md's Non-Negotiables), not a bug to "fix" with heading-level
			// filtering nh-deck would have to invent an opinion about.
			//
			// Depends on the locally-detected browser being Chrome/Chromium/
			// Edge/Brave M126+ (stable since mid-2024) -- true for virtually
			// every real install as of 2026. On an unusually old detected
			// browser this is silently ignored by Chromium: the exported PDF
			// just keeps today's empty-outline status quo, never a crash or a
			// thrown error.
			outline: true,
		});
		await page.close();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to export PDF using ${executablePath}: ${message}`);
	} finally {
		await browser?.close();
	}
}
