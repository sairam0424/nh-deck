import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PDFOptions } from "puppeteer-core";
import puppeteer from "puppeteer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportToPdf } from "../src/pdfExport.js";
import { generateHtml } from "../src/render.js";

// NOTE on the ".js" import extensions above: see tests/render.test.ts for why
// this project's TypeScript NodeNext convention imports "../src/foo.js" even
// though only foo.ts exists on disk.

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const fixturePath = path.join(repoRoot, "fixtures", "sample.md");
const fixtureMarkdown = readFileSync(fixturePath, "utf8");

// PDF generation launches a real local browser via chrome-launcher +
// puppeteer-core, so this is a real (not mocked) end-to-end test. Browser
// launch + page render + PDF generation is generously budgeted here since
// it involves real subprocess and I/O latency, especially on cold/CI runners.
const PDF_EXPORT_TIMEOUT_MS = 60_000;

let activeOutputPath: string | undefined;

afterEach(() => {
	if (activeOutputPath && existsSync(activeOutputPath)) {
		rmSync(activeOutputPath, { force: true });
	}
	activeOutputPath = undefined;
});

describe("exportToPdf", () => {
	it(
		"produces a real PDF file from rendered deck HTML",
		async () => {
			const html = generateHtml(fixtureMarkdown, "sample");

			// Unique filename per run so parallel test runs never collide on the
			// same path in the shared OS temp directory.
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-export-test-${randomUUID()}.pdf`,
			);
			activeOutputPath = outputPath;

			await exportToPdf(html, outputPath);

			expect(existsSync(outputPath)).toBe(true);

			const fileContents = readFileSync(outputPath);
			const magicNumber = fileContents.subarray(0, 4).toString("utf8");
			expect(magicNumber).toBe("%PDF");
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"produces one PDF page per slide when the deck has multiple slides",
		async () => {
			const html = generateHtml(
				"# Slide 1\n\nFirst.\n\n---\n\n# Slide 2\n\nSecond.\n\n---\n\n# Slide 3\n\nThird.",
			);
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-pagination-test-${randomUUID()}.pdf`,
			);
			activeOutputPath = outputPath;

			await exportToPdf(html, outputPath);

			const pdfBytes = readFileSync(outputPath);
			const pageCount = (
				pdfBytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []
			).length;
			expect(pageCount).toBe(3);
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"adds one extra PDF page per slide that has a note when the HTML was generated with withNotes: true",
		async () => {
			// Slide 1 has a note (expects an extra page immediately after its
			// own), slide 2 has none (expects no extra page), slide 3 has a
			// note again -- covers both "gets an extra page" and "does not"
			// within the same deck.
			const html = generateHtml(
				"# Slide 1\n\nFirst.\n\n<!-- note one -->\n\n---\n\n# Slide 2\n\nSecond, no note.\n\n---\n\n# Slide 3\n\nThird.\n\n<!-- note three -->",
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true,
			);
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-with-notes-test-${randomUUID()}.pdf`,
			);
			activeOutputPath = outputPath;

			await exportToPdf(html, outputPath);

			const pdfBytes = readFileSync(outputPath);
			const pageCount = (
				pdfBytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []
			).length;
			// 3 real slides + 2 notes pages (slides 1 and 3, not slide 2).
			expect(pageCount).toBe(5);
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"produces exactly one PDF page per slide (no extra pages) when the HTML was generated without withNotes, even though slides have notes",
		async () => {
			const html = generateHtml(
				"# Slide 1\n\nFirst.\n\n<!-- note one -->\n\n---\n\n# Slide 2\n\nSecond.\n\n<!-- note two -->",
			);
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-without-notes-test-${randomUUID()}.pdf`,
			);
			activeOutputPath = outputPath;

			await exportToPdf(html, outputPath);

			const pdfBytes = readFileSync(outputPath);
			const pageCount = (
				pdfBytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []
			).length;
			expect(pageCount).toBe(2);
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"produces landscape 16:9 pages matching the deck's own on-screen aspect ratio, not portrait A4",
		async () => {
			const html = generateHtml(fixtureMarkdown, "sample");
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-geometry-test-${randomUUID()}.pdf`,
			);
			activeOutputPath = outputPath;

			await exportToPdf(html, outputPath);

			// /MediaBox is a plain, always-present PDF page-geometry structure
			// (four numbers in PDF points, 72pt = 1in) -- parsing it directly
			// avoids pulling in a PDF-parsing dependency for a single
			// dimensions check.
			const pdfText = readFileSync(outputPath).toString("latin1");
			const mediaBoxMatch = pdfText.match(
				/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/,
			);
			expect(mediaBoxMatch).not.toBeNull();
			const [, x0, y0, x1, y1] = (mediaBoxMatch as RegExpMatchArray).map(
				Number,
			);
			const width = x1 - x0;
			const height = y1 - y0;

			// 13.333in x 7.5in at 72pt/in = 960pt x 540pt (16:9).
			expect(width).toBeCloseTo(960, 0);
			expect(height).toBeCloseTo(540, 0);
			// Guards against a regression back to portrait A4 (595.28pt x
			// 841.89pt) even if the exact width/height values above ever
			// legitimately change -- landscape (wider than tall) is the
			// non-negotiable property this test exists to protect.
			expect(width).toBeGreaterThan(height);
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"adds a small, centered page-number footer to every page via displayHeaderFooter",
		async () => {
			const html = generateHtml(
				"# Slide 1\n\nFirst.\n\n---\n\n# Slide 2\n\nSecond.\n\n---\n\n# Slide 3\n\nThird.",
			);
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-footer-test-${randomUUID()}.pdf`,
			);
			activeOutputPath = outputPath;

			// Spies through to the real puppeteer-core launch/newPage/pdf calls
			// (same live-spy-chain technique as the "export failure" describe
			// block below) so this both captures the exact options object
			// exportToPdf() passes to page.pdf() AND still produces a real PDF
			// to assert the rendered page count against -- a fuller check than
			// a spy-only assertion, per this stage's own "prefer a real
			// assertion if you can parse it" guidance.
			type LaunchFn = typeof puppeteer.launch;
			const originalLaunch: LaunchFn = puppeteer.launch.bind(puppeteer);
			let capturedPdfOptions: PDFOptions | undefined;
			vi.spyOn(puppeteer, "launch").mockImplementation(
				async (...args: Parameters<LaunchFn>) => {
					const browser = await originalLaunch(...args);
					const originalNewPage = browser.newPage.bind(browser);
					vi.spyOn(browser, "newPage").mockImplementation(async () => {
						const page = await originalNewPage();
						const originalPdf = page.pdf.bind(page);
						vi.spyOn(page, "pdf").mockImplementation(async (options) => {
							capturedPdfOptions = options;
							return originalPdf(options);
						});
						return page;
					});
					return browser;
				},
			);

			try {
				await exportToPdf(html, outputPath);

				expect(capturedPdfOptions?.displayHeaderFooter).toBe(true);
				expect(capturedPdfOptions?.footerTemplate).toContain("pageNumber");
				expect(capturedPdfOptions?.footerTemplate).toContain("totalPages");
				// A left-aligned footer would pass the two assertions above
				// despite the test name and release contract's "small, centered,
				// muted" page numbers -- assert the alignment rule itself, not
				// just the presence of the placeholders.
				expect(capturedPdfOptions?.footerTemplate).toContain(
					"text-align: center",
				);

				const pdfBytes = readFileSync(outputPath);
				const pageCount = (
					pdfBytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []
				).length;
				expect(pageCount).toBeGreaterThan(1);
			} finally {
				vi.restoreAllMocks();
			}
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"embeds the deck's title as the PDF's own document-level /Info Title metadata, not just the source HTML's <title> tag",
		async () => {
			// Verified empirically (manual probe against a real exported file,
			// not just Puppeteer/Chromium docs) that Page.pdf() already carries
			// document.title through to the output PDF's own /Info dictionary at
			// print time with no extra step -- this test locks that behavior in
			// so a future Puppeteer/Chromium upgrade that silently drops it gets
			// caught here rather than discovered by a user's PDF viewer or a
			// search-indexing tool showing a blank/generic title.
			const deckTitle = "Distinctive PDF Metadata Regression Title";
			const html = generateHtml(fixtureMarkdown, deckTitle);
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-metadata-title-test-${randomUUID()}.pdf`,
			);
			activeOutputPath = outputPath;

			await exportToPdf(html, outputPath);

			const pdfText = readFileSync(outputPath).toString("latin1");

			// Follow the trailer's /Info reference to the actual PDF Info
			// dictionary object, then assert /Title lives inside THAT object --
			// not just that the string "/Title (...)" appears somewhere in the
			// file, which could in principle pass even if some unrelated object
			// happened to carry a same-named key.
			const infoRefMatch = pdfText.match(/\/Info\s+(\d+)\s+\d+\s+R/);
			expect(infoRefMatch).not.toBeNull();
			const infoObjectNumber = (infoRefMatch as RegExpMatchArray)[1];

			const infoObjectMatch = pdfText.match(
				new RegExp(`\\n${infoObjectNumber} 0 obj\\s*<<([^]*?)>>\\s*endobj`),
			);
			expect(infoObjectMatch).not.toBeNull();
			const infoDictionaryBody = (infoObjectMatch as RegExpMatchArray)[1];

			expect(infoDictionaryBody).toContain(`/Title (${deckTitle})`);
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"adds a real PDF outline (bookmarks) derived from the deck's own headings, with each entry's destination pointing at the page its own slide actually landed on",
		async () => {
			// Three slides, each with one distinct top-level heading -- Chromium's
			// document-outline generation (CDP Page.printToPDF's
			// generateDocumentOutline, reached via Puppeteer's outline: true)
			// derives one outline entry per real <h1>-<h6> in the page's own
			// accessibility tree, so three distinct headings are expected to
			// produce three real outline entries, in the same order.
			const headings = [
				"Distinctive Outline Heading Alpha",
				"Distinctive Outline Heading Beta",
				"Distinctive Outline Heading Gamma",
			];
			const html = generateHtml(
				headings
					.map((heading) => `# ${heading}\n\nSlide body.`)
					.join("\n\n---\n\n"),
			);
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-outline-test-${randomUUID()}.pdf`,
			);
			activeOutputPath = outputPath;

			await exportToPdf(html, outputPath);

			const pdfText = readFileSync(outputPath).toString("latin1");

			// A bare "/Outlines" substring match alone would also pass for an
			// empty or degenerate outline dictionary, or a same-named key on
			// some unrelated object -- this test needs real entries with real
			// destinations, so it walks the actual outline/page structure
			// below rather than stopping at this presence check.
			expect(pdfText).toContain("/Outlines");

			// The /Pages tree's /Kids array is the authoritative, already-
			// in-page-order list of page object numbers -- same
			// follow-the-real-structure approach as the /Info Title test
			// above, which follows /Info's object reference rather than
			// trusting a bare substring match.
			const kidsMatch = pdfText.match(
				/\/Type\s*\/Pages[\s\S]*?\/Kids\s*\[([^\]]+)\]/,
			);
			expect(kidsMatch).not.toBeNull();
			const pageObjectNumbers = Array.from(
				(kidsMatch as RegExpMatchArray)[1].matchAll(/(\d+)\s+0\s+R/g),
			).map((match) => Number(match[1]));
			expect(pageObjectNumbers.length).toBe(3);

			headings.forEach((heading, slideIndex) => {
				// Each outline entry is its own PDF object, e.g.
				// "<</Title (Distinctive Outline Heading Alpha)\n/Dest [2 0 R ...".
				// Matching the /Title -> /Dest pair inside one object (not just
				// searching for the heading text anywhere in the file) is what
				// actually rules out the wrong-page regression this test exists
				// to catch: a title string with no real destination, or a
				// destination pointing at some unrelated object, would both
				// fail this specific match.
				// Splitting on "endobj" first (rather than a single regex
				// spanning /Title to /Dest with a non-greedy [^]*?) keeps the
				// match confined to one PDF object -- a spanning regex could
				// otherwise pair this heading's /Title with a /Dest that
				// actually belongs to a later, unrelated object and pass
				// incorrectly.
				const entryObject = pdfText
					.split("endobj")
					.find((object) => object.includes(`/Title (${heading})`));
				expect(
					entryObject,
					`expected an outline entry for "${heading}"`,
				).not.toBeUndefined();
				const entryMatch = (entryObject as string).match(
					/\/Dest\s*\[(\d+)\s+0\s+R/,
				);
				expect(
					entryMatch,
					`expected a /Dest reference in the outline entry for "${heading}"`,
				).not.toBeNull();
				const destPageObjectNumber = Number(
					(entryMatch as RegExpMatchArray)[1],
				);

				// The heading's own outline destination must resolve to the
				// same page its own slide actually landed on (slideIndex here,
				// 0-based, matching the deck's own slide order) -- this is the
				// exact destination-on-the-wrong-page failure mode a real
				// Chromium regression shortly after this feature's mid-2024
				// rollout produced, so this asserts real page correlation, not
				// just "some destination exists somewhere".
				expect(pageObjectNumbers[slideIndex]).toBe(destPageObjectNumber);
			});
		},
		PDF_EXPORT_TIMEOUT_MS,
	);
});

// Cross-platform check for whether an OS process is still alive. Signal 0
// sends no actual signal -- per Node's docs, it's the standard portable way
// to test for a process's existence, including on Windows (part of this
// project's own CI matrix).
function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// ESRCH ("no such process") is the only case that proves the process is
		// actually gone. Any other failure (e.g. EPERM) means the process still
		// exists but we can't signal it -- treat that as "still running" rather
		// than risk a false "closed cleanly".
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

describe("exportToPdf — export failure after a successful browser launch", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it(
		"wraps the error in a clear message and leaves no orphaned browser process behind",
		async () => {
			const html = generateHtml(fixtureMarkdown, "sample");

			// A path inside a directory that was never created. Unlike
			// pdfExport.launchFailure.test.ts (which mocks puppeteer.launch()
			// itself to reject, so `browser` stays undefined and the finally
			// block's `await browser?.close()` is a no-op), this lets
			// puppeteer.launch() succeed normally -- a real browser process
			// starts up -- and it's page.pdf() that fails afterward, because its
			// output directory doesn't exist. This is the realistic failure case
			// that actually exercises `browser.close()` against a live handle.
			const outputDir = path.join(
				tmpdir(),
				`nh-deck-pdf-export-missing-dir-${randomUUID()}`,
			);
			const outputPath = path.join(outputDir, "deck.pdf");

			// Spy (not mock) on the real puppeteer-core launch call, capturing
			// the real Browser instance it resolves to, so the test can inspect
			// the real OS process behind it without faking any part of the
			// export path itself. `.mockImplementation` still calls through to
			// the original launch -- it only adds the capture.
			type LaunchFn = typeof puppeteer.launch;
			const originalLaunch: LaunchFn = puppeteer.launch.bind(puppeteer);
			let launchedBrowser: Awaited<ReturnType<LaunchFn>> | undefined;
			const launchSpy = vi
				.spyOn(puppeteer, "launch")
				.mockImplementation(async (...args: Parameters<LaunchFn>) => {
					const browser = await originalLaunch(...args);
					launchedBrowser = browser;
					return browser;
				});

			try {
				// The thrown error must match exportToPdf's catch-block format
				// (`Failed to export PDF using ${executablePath}: ${message}`) --
				// a clear, actionable message, not a raw Puppeteer/Node stack trace
				// leaking out of the try block.
				await expect(exportToPdf(html, outputPath)).rejects.toThrow(
					/^Failed to export PDF using .+: /,
				);

				expect(launchSpy).toHaveBeenCalledTimes(1);

				const browserProcess = launchedBrowser?.process() ?? null;
				expect(browserProcess).not.toBeNull();

				const pid = browserProcess?.pid;
				if (typeof pid !== "number") {
					throw new Error(
						"Expected the real puppeteer.launch() call to return a browser with a live process pid",
					);
				}

				// exportToPdf() has already rejected by this point, so its finally
				// block's `await browser?.close()` has already run to completion --
				// @puppeteer/browsers' close() only resolves once the underlying
				// child process's real "exit" event has fired. Asserting the OS-level
				// pid is actually gone (not just that puppeteer's CDP session
				// disconnected) proves browser.close() ran against a real, live
				// browser and didn't leave an orphaned process behind.
				expect(isProcessRunning(pid)).toBe(false);

				expect(existsSync(outputPath)).toBe(false);
			} finally {
				rmSync(outputDir, { recursive: true, force: true });
			}
		},
		PDF_EXPORT_TIMEOUT_MS,
	);
});
