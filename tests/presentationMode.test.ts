import puppeteer from "puppeteer-core";
import { afterEach, describe, expect, it } from "vitest";
import { detectBrowserExecutable } from "../src/browserLaunch.js";
import { generateHtml } from "../src/render.js";
import type { StartedServer } from "../src/server.js";
import { startServer } from "../src/server.js";

// Presentation mode's actual navigation behavior (keyboard/click events,
// hash persistence across reload) is real DOM interaction that no
// string-assertion test can verify. This launches a real, unmocked
// browser via the same detectBrowserExecutable() helper
// pdfExport.test.ts/pngExport.test.ts already use, rather than adding a
// different browser-automation tool for just this one feature. Budgeted
// generously (matching the PDF/PNG export tests' own timeout) since real
// browser launches are the known source of CI timing flakiness tracked
// in issue #19 -- not a reason to mock this out, just a reason not to
// under-budget it.
const PRESENTATION_TEST_TIMEOUT_MS = 60_000;

const THREE_SLIDE_DECK =
	"# Slide 1\n\nFirst.\n\n---\n\n# Slide 2\n\nSecond.\n\n---\n\n# Slide 3\n\nThird.";

let activeServer: StartedServer | undefined;
let activeBrowser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;

afterEach(async () => {
	await activeBrowser?.close();
	activeBrowser = undefined;
	activeServer?.server.close();
	activeServer = undefined;
});

async function openPresentationPage(html: string, path = "/?present") {
	activeServer = await startServer(html, 0);
	const executablePath = detectBrowserExecutable();
	activeBrowser = await puppeteer.launch({ executablePath, headless: true });
	const page = await activeBrowser.newPage();
	await page.goto(`${activeServer.url}${path}`, { waitUntil: "load" });
	return page;
}

function activeSlideHeading(
	page: Awaited<ReturnType<typeof openPresentationPage>>,
) {
	return page.evaluate(
		() => document.querySelector(".slide.is-active h1")?.textContent,
	);
}

describe("presentation mode", () => {
	it(
		"shows only the first slide when ?present is in the URL",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			const activeCount = await page.evaluate(
				() => document.querySelectorAll(".slide.is-active").length,
			);
			expect(activeCount).toBe(1);
			expect(await activeSlideHeading(page)).toBe("Slide 1");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"advances to the next slide on ArrowRight and back on ArrowLeft",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 2");

			await page.keyboard.press("ArrowLeft");
			expect(await activeSlideHeading(page)).toBe("Slide 1");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"advances on a click that is not on a link",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.click("body");

			expect(await activeSlideHeading(page)).toBe("Slide 2");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"does not advance when clicking a link inside slide content",
		async () => {
			// A same-page anchor href, not a real external URL: the click
			// handler deliberately never calls preventDefault() for a link
			// click (links inside slide content are meant to keep working
			// normally, per the design), so an external URL here would
			// genuinely navigate the page away -- this only needs to prove
			// that clicking a link never ALSO calls goTo(), which a same-page
			// hash change proves without leaving the page.
			const deckWithLink =
				"# Slide 1\n\n[a link](#somewhere)\n\n---\n\n# Slide 2\n\nSecond.";
			const page = await openPresentationPage(generateHtml(deckWithLink));

			await page.click(".slide.is-active a");

			expect(await activeSlideHeading(page)).toBe("Slide 1");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"persists the current slide across a reload via location.hash",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("ArrowRight");
			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 3");

			await page.reload({ waitUntil: "load" });

			expect(await activeSlideHeading(page)).toBe("Slide 3");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"leaves the continuous-scroll view completely unaffected without ?present",
		async () => {
			const page = await openPresentationPage(
				generateHtml(THREE_SLIDE_DECK),
				"/",
			);

			const activeCount = await page.evaluate(
				() => document.querySelectorAll(".slide.is-active").length,
			);
			expect(activeCount).toBe(0);

			const visibleSlideCount = await page.evaluate(
				() =>
					Array.from(document.querySelectorAll(".slide")).filter(
						(el) => (el as HTMLElement).offsetParent !== null,
					).length,
			);
			expect(visibleSlideCount).toBe(3);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);
});
