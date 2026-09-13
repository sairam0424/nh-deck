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
