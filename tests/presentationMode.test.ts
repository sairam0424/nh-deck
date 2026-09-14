import type { Page } from "puppeteer-core";
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

// Builds a deck with exactly slideCount slides ("Slide 1" .. "Slide N"),
// each with trivial body text -- used by the jump-to-slide ("g" + digits +
// Enter) tests below, which need a deck with more than 9 slides (to
// exercise a real multi-digit jump) rather than THREE_SLIDE_DECK's fixed
// three.
function buildDeck(slideCount: number): string {
	return Array.from(
		{ length: slideCount },
		(_, i) => `# Slide ${i + 1}\n\nContent for slide ${i + 1}.`,
	).join("\n\n---\n\n");
}

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
	// Some CI runner images (observed on macOS-14 and windows-latest GitHub
	// Actions hosts, but not ubuntu-latest) default to an OS-level "reduce
	// motion" accessibility setting, which headless Chromium surfaces as
	// prefers-reduced-motion: reduce. render.ts's REDUCED_MOTION_STYLE then
	// forces `transform: none !important` on every .slide, which silently
	// zeroes out any test that asserts a specific transform/translateX value
	// during a transition -- this file's tests are about the normal
	// (non-reduced-motion) transition path, so every page here explicitly
	// pins the opposite of that ambient host state rather than inheriting it.
	await page.emulateMediaFeatures([
		{ name: "prefers-reduced-motion", value: "no-preference" },
	]);
	await page.goto(`${activeServer.url}${path}`, { waitUntil: "load" });
	return page;
}

// Opens a SECOND page against the SAME already-running browser/server as an
// existing openPresentationPage() call -- required for the presenter-view
// tests below, which need two real tabs of the identical served document
// open at once (a main presenting page and a presenter-view page) sharing
// the SAME origin, since that same-origin requirement is exactly what lets
// BroadcastChannel and localStorage bridge them at all. Puppeteer's default
// (non-incognito) browser context shares storage/broadcast scope across
// every page opened via browser.newPage() on that one browser instance --
// verified directly below, rather than assumed, since the task explicitly
// calls out that this needs checking in practice.
async function openSecondPresentationPage(path: string) {
	if (!activeBrowser || !activeServer) {
		throw new Error(
			"openSecondPresentationPage requires an existing browser/server -- call openPresentationPage first",
		);
	}
	const page = await activeBrowser.newPage();
	await page.emulateMediaFeatures([
		{ name: "prefers-reduced-motion", value: "no-preference" },
	]);
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

// Dispatches real, synthetic touchstart/touchend DOM events (via the
// standard Touch/TouchEvent constructors) rather than relying on
// Puppeteer's own CDP-backed touchscreen API, which requires the page's
// viewport to opt into touch emulation (hasTouch) before the browser will
// translate input into touch events at all. Constructing and dispatching the
// events directly exercises presentationScript.ts's own listeners exactly as
// a real mobile browser would invoke them, without that extra emulation
// setup -- touchmove is deliberately omitted since presentationScript.ts
// itself never listens for it (see its own comment).
async function simulateSwipe(
	page: Awaited<ReturnType<typeof openPresentationPage>>,
	startX: number,
	startY: number,
	endX: number,
	endY: number,
) {
	await page.evaluate(
		(sx: number, sy: number, ex: number, ey: number) => {
			const dispatch = (
				type: string,
				x: number,
				y: number,
				active: boolean,
			) => {
				const touch = new Touch({
					identifier: 1,
					target: document.body,
					clientX: x,
					clientY: y,
				});
				document.body.dispatchEvent(
					new TouchEvent(type, {
						bubbles: true,
						cancelable: true,
						touches: active ? [touch] : [],
						targetTouches: active ? [touch] : [],
						changedTouches: [touch],
					}),
				);
			};
			dispatch("touchstart", sx, sy, true);
			dispatch("touchend", ex, ey, false);
		},
		startX,
		startY,
		endX,
		endY,
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
		"reverses the slide transition's translateX direction when navigating backward vs forward (regression: backward previously replayed forward's exact same left-to-right motion)",
		async () => {
			const page = await openPresentationPage(
				generateHtml(
					THREE_SLIDE_DECK,
					undefined,
					undefined,
					undefined,
					"slide",
				),
			);

			// Reads the translateX component (matrix's tx) of a specific slide
			// by index -- deliberately NOT ".slide:not(.is-active)", which is
			// ambiguous with 3 slides (2 are inactive at once): after
			// ArrowLeft navigates back to slide 0, slide 2 is ALSO still
			// inactive (resting at its untouched forward +100% from the very
			// first ArrowRight), and querySelector would happily return
			// whichever of the two comes first in DOM order regardless of
			// which one the test actually means to observe.
			const slideTranslateX = (index: number) =>
				page.evaluate((i) => {
					const el = document.querySelectorAll(".slide")[i];
					const transform = el ? getComputedStyle(el).transform : "none";
					const match = transform.match(/matrix\(([^)]+)\)/);
					if (!match) {
						return 0;
					}
					const parts = match[1].split(",").map((n) => Number.parseFloat(n));
					return parts[4] ?? 0;
				}, index);

			// Polls for a value that is both nonzero AND unchanged across two
			// consecutive 100ms-apart reads, rather than a single fixed sleep:
			// on slower/busier CI runners (observed intermittently on
			// windows-latest, never on ubuntu-latest/macos-14), a single fixed
			// wait sometimes read a still-animating (mid-transition) value.
			// Requiring stability, not just non-zero, is what actually proves
			// the 0.3s CSS transition has settled rather than merely started.
			const pollForSettledTranslateX = async (index: number) => {
				const deadline = Date.now() + 3000;
				let previous = await slideTranslateX(index);
				do {
					await new Promise((resolve) => setTimeout(resolve, 100));
					const current = await slideTranslateX(index);
					if (current === previous && current !== 0) {
						return current;
					}
					previous = current;
				} while (Date.now() < deadline);
				return previous;
			};

			await page.keyboard.press("ArrowRight");
			// Slide 0 was active, is now inactive -- resting at the forward
			// direction's +100%-equivalent.
			const forwardTx = await pollForSettledTranslateX(0);

			await page.keyboard.press("ArrowLeft");
			// Slide 1 was active, is now inactive -- resting at the backward
			// direction's -100%-equivalent. Slide 0 (now active again) and
			// slide 2 (still untouched since the first navigation) are
			// deliberately not read here.
			const backwardTx = await pollForSettledTranslateX(1);

			expect(forwardTx).toBeGreaterThan(0);
			expect(backwardTx).toBeLessThan(0);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"stays on the last slide when ArrowRight is pressed past the end, and on the first slide when ArrowLeft is pressed before the start",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			// Advance past the last slide (2 presses reaches slide 3, a 3rd
			// exercises goTo()'s `index >= slides.length` guard) -- no test
			// previously pressed ArrowRight enough times to reach the end and
			// go one step further.
			await page.keyboard.press("ArrowRight");
			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 3");
			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 3");

			const activeCountAtEnd = await page.evaluate(
				() => document.querySelectorAll(".slide.is-active").length,
			);
			expect(activeCountAtEnd).toBe(1);

			// Now walk back to the first slide and go one step further, to
			// exercise the `index < 0` half of the same guard.
			await page.keyboard.press("ArrowLeft");
			await page.keyboard.press("ArrowLeft");
			expect(await activeSlideHeading(page)).toBe("Slide 1");
			await page.keyboard.press("ArrowLeft");
			expect(await activeSlideHeading(page)).toBe("Slide 1");

			const activeCountAtStart = await page.evaluate(
				() => document.querySelectorAll(".slide.is-active").length,
			);
			expect(activeCountAtStart).toBe(1);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"jumps directly to the first slide on Home and the last slide on End",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 2");

			await page.keyboard.press("End");
			expect(await activeSlideHeading(page)).toBe("Slide 3");

			await page.keyboard.press("Home");
			expect(await activeSlideHeading(page)).toBe("Slide 1");

			// Home/End land on a valid slide even when already there --
			// re-pressing must not throw goTo()'s bounds guard off or drop
			// the active slide entirely.
			await page.keyboard.press("Home");
			expect(await activeSlideHeading(page)).toBe("Slide 1");

			const activeCount = await page.evaluate(
				() => document.querySelectorAll(".slide.is-active").length,
			);
			expect(activeCount).toBe(1);
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

	it(
		"keeps a layout's flex centering active even inside presentation mode",
		async () => {
			const deckWithLayout =
				"<!-- layout: title -->\n\n# Slide 1\n\nSubtitle.\n\n---\n\n# Slide 2\n\nSecond.";
			const page = await openPresentationPage(generateHtml(deckWithLayout));

			const display = await page.evaluate(() => {
				const el = document.querySelector(".slide.is-active");
				return el ? getComputedStyle(el).display : null;
			});

			expect(display).toBe("flex");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"keeps a layout's flex centering active in presentation mode even with a transition set",
		async () => {
			const deckWithLayout =
				"<!-- layout: section -->\n\n# Slide 1\n\nSubtitle.\n\n---\n\n# Slide 2\n\nSecond.";
			const page = await openPresentationPage(
				generateHtml(deckWithLayout, undefined, undefined, undefined, "fade"),
			);

			const display = await page.evaluate(() => {
				const el = document.querySelector(".slide.is-active");
				return el ? getComputedStyle(el).display : null;
			});

			expect(display).toBe("flex");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"shows a presentation-progress element whose width tracks slide position from first to last slide",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			const progressElementCount = await page.evaluate(
				() => document.querySelectorAll(".presentation-progress").length,
			);
			expect(progressElementCount).toBe(1);

			const progressWidth = () =>
				page.evaluate(
					() =>
						(
							document.querySelector(
								".presentation-progress",
							) as HTMLElement | null
						)?.style.width,
				);

			// Slide 1 of 3 (index 0): 0 / (3 - 1) * 100 = 0%.
			expect(await progressWidth()).toBe("0%");

			// Slide 2 of 3 (index 1, the middle slide): 1 / (3 - 1) * 100 = 50%.
			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
			expect(await progressWidth()).toBe("50%");

			// Slide 3 of 3 (index 2, the last slide): 2 / (3 - 1) * 100 = 100%.
			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 3");
			expect(await progressWidth()).toBe("100%");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"exits presentation mode on Escape: clears the presenting class and removes ?present from the URL (preserving other params) without a full page reload",
		async () => {
			const page = await openPresentationPage(
				generateHtml(THREE_SLIDE_DECK),
				"/?present&notes",
			);

			const isPresentingBefore = await page.evaluate(() =>
				document.body.classList.contains("presenting"),
			);
			expect(isPresentingBefore).toBe(true);

			// A marker that only survives if the page never actually
			// reloads/navigates -- history.replaceState must not trigger one.
			await page.evaluate(() => {
				(window as unknown as Record<string, unknown>).__nhDeckNoReloadMarker =
					true;
			});

			await page.keyboard.press("Escape");

			const isPresentingAfter = await page.evaluate(() =>
				document.body.classList.contains("presenting"),
			);
			expect(isPresentingAfter).toBe(false);

			const searchParamsAfter = await page.evaluate(() => {
				const params = new URLSearchParams(location.search);
				return {
					hasPresent: params.has("present"),
					hasNotes: params.has("notes"),
				};
			});
			expect(searchParamsAfter.hasPresent).toBe(false);
			expect(searchParamsAfter.hasNotes).toBe(true);

			const survivedReload = await page.evaluate(
				() =>
					(window as unknown as Record<string, unknown>)
						.__nhDeckNoReloadMarker === true,
			);
			expect(survivedReload).toBe(true);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"hides the presentation counter and progress bar once Escape exits presentation mode",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("Escape");

			const chromeDisplay = await page.evaluate(() => {
				const counter = document.querySelector(".presentation-counter");
				const progress = document.querySelector(".presentation-progress");
				return {
					counterDisplay: counter
						? getComputedStyle(counter).display
						: "missing",
					progressDisplay: progress
						? getComputedStyle(progress).display
						: "missing",
				};
			});

			expect(chromeDisplay.counterDisplay).toBe("none");
			expect(chromeDisplay.progressDisplay).toBe("none");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"ignores 'o' and clicks on the normal continuous-scroll view after Escape has exited presentation mode (regression: the keydown/click listeners are attached once at load and never detached, so without a presenting guard they kept firing after exit)",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("Escape");
			await page.keyboard.press("o");

			const stateAfterO = await page.evaluate(() => ({
				hasOverviewClass: document.body.classList.contains("overview"),
				hasPresentingClass: document.body.classList.contains("presenting"),
			}));
			expect(stateAfterO.hasOverviewClass).toBe(false);
			expect(stateAfterO.hasPresentingClass).toBe(false);

			// A click on the normal document must not behave like a
			// presentation-mode "advance to next slide" click either.
			// exitPresentationMode() only removes body.presenting -- it doesn't
			// clear whichever slide's leftover .is-active from before the exit,
			// so the correct regression signal is that .is-active does NOT move
			// to a different slide as a result of this click (which is exactly
			// what the buggy unguarded click listener's goTo(current + 1, false)
			// would have done).
			const headingBeforeClick = await activeSlideHeading(page);
			await page.click("body");
			const headingAfterClick = await activeSlideHeading(page);
			expect(headingAfterClick).toBe(headingBeforeClick);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);
});

describe("presentation mode — touch swipe navigation", () => {
	it(
		"advances to the next slide on a left swipe past the threshold, and back to the previous slide on a right swipe",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			// Finger moves right-to-left (deltaX negative, well past the 50px
			// threshold): same direction as ArrowRight.
			await simulateSwipe(page, 300, 300, 80, 300);
			expect(await activeSlideHeading(page)).toBe("Slide 2");

			// Finger moves left-to-right (deltaX positive): same direction as
			// ArrowLeft.
			await simulateSwipe(page, 80, 300, 300, 300);
			expect(await activeSlideHeading(page)).toBe("Slide 1");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"does not navigate on a small horizontal touch movement below the threshold, or on a vertical-dominant movement (a scroll gesture, not a swipe)",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			// Only 20px of horizontal movement -- below SWIPE_THRESHOLD_PX (50).
			await simulateSwipe(page, 200, 300, 220, 300);
			expect(await activeSlideHeading(page)).toBe("Slide 1");

			// 60px horizontal (past the threshold on its own) but 120px vertical
			// -- vertical movement dominates, so this must read as a scroll
			// attempt, not a swipe.
			await simulateSwipe(page, 200, 200, 260, 320);
			expect(await activeSlideHeading(page)).toBe("Slide 1");

			const activeCount = await page.evaluate(
				() => document.querySelectorAll(".slide.is-active").length,
			);
			expect(activeCount).toBe(1);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"does not navigate on a touch swipe once presentation mode has been exited via Escape",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("Escape");
			const isPresenting = await page.evaluate(() =>
				document.body.classList.contains("presenting"),
			);
			expect(isPresenting).toBe(false);

			// exitPresentationMode() only removes the "presenting" class -- it
			// deliberately never clears .is-active from whichever slide was
			// current (see render.ts's own comment on that class), so the real
			// signal that this swipe was ignored is the active heading staying
			// put, not the count of .is-active elements (which stays 1 either
			// way).
			await simulateSwipe(page, 300, 300, 80, 300);

			expect(await activeSlideHeading(page)).toBe("Slide 1");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);
});

describe("presentation mode — slide overview (grid view)", () => {
	async function visibleSlideCount(
		page: Awaited<ReturnType<typeof openPresentationPage>>,
	) {
		return page.evaluate(
			() =>
				Array.from(document.querySelectorAll(".slide")).filter(
					(el) => (el as HTMLElement).offsetParent !== null,
				).length,
		);
	}

	async function isOverviewOpen(
		page: Awaited<ReturnType<typeof openPresentationPage>>,
	) {
		return page.evaluate(() => document.body.classList.contains("overview"));
	}

	it(
		'opening the overview via the "o" key shows every slide at once, laid out in a grid, without exiting presentation mode',
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			// Before opening the overview, presentation mode's normal
			// one-slide-at-a-time behavior holds.
			expect(await visibleSlideCount(page)).toBe(1);

			await page.keyboard.press("o");

			expect(await isOverviewOpen(page)).toBe(true);
			expect(await visibleSlideCount(page)).toBe(3);

			const bodyDisplay = await page.evaluate(
				() => getComputedStyle(document.body).display,
			);
			expect(bodyDisplay).toBe("grid");

			// Overview is a mode WITHIN presentation mode, not a replacement for
			// it -- it must not also exit presentation mode.
			const isPresenting = await page.evaluate(() =>
				document.body.classList.contains("presenting"),
			);
			expect(isPresenting).toBe(true);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"clicking a slide's thumbnail in the overview jumps presentation mode to that slide and closes the overview",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("o");
			expect(await isOverviewOpen(page)).toBe(true);

			await page.click(".slide:nth-of-type(3)");

			expect(await isOverviewOpen(page)).toBe(false);
			expect(await activeSlideHeading(page)).toBe("Slide 3");
			// Closing back into normal presentation mode restores the
			// one-slide-at-a-time view.
			expect(await visibleSlideCount(page)).toBe(1);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"pressing Escape while the overview is open closes ONLY the overview -- it does not also exit presentation mode in the same keypress (regression: precedence with the pre-existing Escape-exits-presentation-mode handler)",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			// Land on slide 2 before opening the overview, so closing it can
			// prove it returns to THIS slide -- not slide 1, and not whatever
			// slide might otherwise be assumed "last active".
			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 2");

			await page.keyboard.press("o");
			expect(await isOverviewOpen(page)).toBe(true);

			// The critical precedence assertion: Escape while overview is open
			// must close the overview only -- it must NOT also run
			// exitPresentationMode in the same keypress.
			await page.keyboard.press("Escape");

			expect(await isOverviewOpen(page)).toBe(false);

			const isPresenting = await page.evaluate(() =>
				document.body.classList.contains("presenting"),
			);
			expect(isPresenting).toBe(true);

			const hasPresentParam = await page.evaluate(() =>
				new URLSearchParams(location.search).has("present"),
			);
			expect(hasPresentParam).toBe(true);

			// Returns to the slide that was active before the overview opened.
			expect(await activeSlideHeading(page)).toBe("Slide 2");

			// A SECOND Escape (overview now closed) exits presentation mode --
			// proving the pre-existing exit behavior still works, unmodified, once
			// overview is out of the way.
			await page.keyboard.press("Escape");
			const isPresentingAfterSecondEscape = await page.evaluate(() =>
				document.body.classList.contains("presenting"),
			);
			expect(isPresentingAfterSecondEscape).toBe(false);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);
});

describe("presentation mode — keyboard-shortcuts help overlay", () => {
	async function isHelpOpen(
		page: Awaited<ReturnType<typeof openPresentationPage>>,
	) {
		return page.evaluate(() => document.body.classList.contains("help-open"));
	}

	async function isOverviewOpen(
		page: Awaited<ReturnType<typeof openPresentationPage>>,
	) {
		return page.evaluate(() => document.body.classList.contains("overview"));
	}

	async function isPresenting(
		page: Awaited<ReturnType<typeof openPresentationPage>>,
	) {
		return page.evaluate(() => document.body.classList.contains("presenting"));
	}

	it(
		'opening the help overlay via "?" shows the grouped shortcut list without exiting presentation mode',
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("?");

			expect(await isHelpOpen(page)).toBe(true);

			const helpDisplay = await page.evaluate(() => {
				const el = document.querySelector(".presentation-help");
				return el ? getComputedStyle(el).display : "missing";
			});
			expect(helpDisplay).not.toBe("none");

			const helpText = await page.evaluate(
				() => document.querySelector(".presentation-help")?.textContent ?? "",
			);
			expect(helpText).toContain("Navigate");
			expect(helpText).toContain("View");
			expect(helpText).toContain("swipe");
			expect(helpText).toContain("overview");
			// Regression: presenter view ("p"/"P") is a real, fully wired
			// feature in this same file, but the help panel never listed it --
			// a presenter relying on in-app help would never learn it exists.
			expect(helpText).toContain("presenter view");

			expect(await isPresenting(page)).toBe(true);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"closes the help overlay on Escape without exiting presentation mode",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("?");
			expect(await isHelpOpen(page)).toBe(true);

			await page.keyboard.press("Escape");

			expect(await isHelpOpen(page)).toBe(false);
			expect(await isPresenting(page)).toBe(true);
			const hasPresentParam = await page.evaluate(() =>
				new URLSearchParams(location.search).has("present"),
			);
			expect(hasPresentParam).toBe(true);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		'closes the help overlay on a second "?" press, without exiting presentation mode',
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("?");
			expect(await isHelpOpen(page)).toBe(true);

			await page.keyboard.press("?");

			expect(await isHelpOpen(page)).toBe(false);
			expect(await isPresenting(page)).toBe(true);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"suppresses slide navigation (arrows, Space, End) while the help overlay is open, and does not close it either",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("?");
			expect(await isHelpOpen(page)).toBe(true);

			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 1");

			await page.keyboard.press("End");
			expect(await activeSlideHeading(page)).toBe("Slide 1");

			await page.keyboard.press(" ");
			expect(await activeSlideHeading(page)).toBe("Slide 1");

			expect(await isHelpOpen(page)).toBe(true);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"shows an always-visible hint button next to the counter that also opens the help overlay on click",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			const hintDisplay = await page.evaluate(() => {
				const el = document.querySelector(".presentation-help-hint");
				return el ? getComputedStyle(el).display : "missing";
			});
			expect(hintDisplay).not.toBe("none");

			const hintIsVisible = await page.evaluate(() => {
				const el = document.querySelector(
					".presentation-help-hint",
				) as HTMLElement | null;
				return el !== null && el.offsetParent !== null;
			});
			expect(hintIsVisible).toBe(true);

			await page.click(".presentation-help-hint");

			expect(await isHelpOpen(page)).toBe(true);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"closing the help overlay while the grid overview is also open leaves the overview untouched (regression: a single Escape must never close two things at once)",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 2");

			await page.keyboard.press("o");
			expect(await isOverviewOpen(page)).toBe(true);

			// Opens help ON TOP of the already-open overview.
			await page.keyboard.press("?");
			expect(await isHelpOpen(page)).toBe(true);

			await page.keyboard.press("Escape");

			// Help closed; overview and presentation mode both untouched.
			expect(await isHelpOpen(page)).toBe(false);
			expect(await isOverviewOpen(page)).toBe(true);
			expect(await isPresenting(page)).toBe(true);

			// A second Escape (help now closed) falls through to the
			// pre-existing overview-close behavior, returning to slide 2.
			await page.keyboard.press("Escape");
			expect(await isOverviewOpen(page)).toBe(false);
			expect(await activeSlideHeading(page)).toBe("Slide 2");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		'toggling "?" a second time while the grid overview is also open closes only help, leaving the overview open (same precedence as the Escape case above, exercised via "?" itself)',
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("o");
			expect(await isOverviewOpen(page)).toBe(true);

			await page.keyboard.press("?");
			expect(await isHelpOpen(page)).toBe(true);

			await page.keyboard.press("?");
			expect(await isHelpOpen(page)).toBe(false);
			expect(await isOverviewOpen(page)).toBe(true);
			expect(await isPresenting(page)).toBe(true);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"hides the help overlay and hint button once Escape exits presentation mode entirely",
		async () => {
			const page = await openPresentationPage(generateHtml(THREE_SLIDE_DECK));

			await page.keyboard.press("Escape");

			const chromeDisplay = await page.evaluate(() => {
				const help = document.querySelector(".presentation-help");
				const hint = document.querySelector(".presentation-help-hint");
				return {
					helpDisplay: help ? getComputedStyle(help).display : "missing",
					hintDisplay: hint ? getComputedStyle(hint).display : "missing",
				};
			});
			expect(chromeDisplay.helpDisplay).toBe("none");
			expect(chromeDisplay.hintDisplay).toBe("none");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);
});

describe("presentation mode — fragment (incremental reveal) state machine", () => {
	// Slide 1 (index 0) has no fragments; slide 2 (index 1) has three,
	// each marked via its own nested/trailing marker (one per bullet);
	// slide 3 (index 2) has none. This shape lets forward/backward
	// navigation into and out of the fragment-bearing slide be exercised
	// from both directions.
	const FRAGMENT_DECK =
		"# Slide 1\n\nIntro, no fragments here.\n\n---\n\n" +
		"# Slide 2\n\n" +
		"- Point A\n  <!-- fragment -->\n" +
		"- Point B\n  <!-- fragment -->\n" +
		"- Point C\n  <!-- fragment -->\n\n---\n\n" +
		"# Slide 3\n\nNo fragments here either.";

	async function fragmentStates(
		page: Awaited<ReturnType<typeof openPresentationPage>>,
	) {
		return page.evaluate(() =>
			Array.from(document.querySelectorAll(".slide.is-active .fragment")).map(
				(el) => ({
					isRevealed: el.classList.contains("is-revealed"),
					ariaHidden: el.getAttribute("aria-hidden"),
				}),
			),
		);
	}

	it(
		"advancing forward reveals one fragment at a time before moving to the next slide",
		async () => {
			const page = await openPresentationPage(generateHtml(FRAGMENT_DECK));

			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: false, ariaHidden: "true" },
				{ isRevealed: false, ariaHidden: "true" },
				{ isRevealed: false, ariaHidden: "true" },
			]);

			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: false, ariaHidden: "true" },
				{ isRevealed: false, ariaHidden: "true" },
			]);

			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: false, ariaHidden: "true" },
			]);

			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: true, ariaHidden: "false" },
			]);

			// All three now revealed -- the NEXT ArrowRight finally advances
			// the slide itself, rather than doing nothing or revealing a
			// fourth (nonexistent) fragment.
			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 3");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"entering a fragment-bearing slide backward (ArrowLeft from the next slide) shows every fragment already revealed",
		async () => {
			const page = await openPresentationPage(generateHtml(FRAGMENT_DECK));

			// Reach slide 3 without ever revealing slide 2's own fragments.
			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
			await page.keyboard.press("End");
			expect(await activeSlideHeading(page)).toBe("Slide 3");

			// Slide 3 has no fragments, so this single ArrowLeft falls through
			// to goTo(1, true) -- entering slide 2 BACKWARD.
			await page.keyboard.press("ArrowLeft");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: true, ariaHidden: "false" },
			]);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"backward navigation conceals fragments in reverse order, one at a time, before moving to the previous slide",
		async () => {
			const page = await openPresentationPage(generateHtml(FRAGMENT_DECK));

			// Land on slide 2 with all three fragments already revealed (via
			// the backward-entry path exercised in the test above).
			await page.keyboard.press("ArrowRight");
			await page.keyboard.press("End");
			await page.keyboard.press("ArrowLeft");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: true, ariaHidden: "false" },
			]);

			// Conceals Point C first (the last one revealed).
			await page.keyboard.press("ArrowLeft");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: false, ariaHidden: "true" },
			]);

			// Then Point B.
			await page.keyboard.press("ArrowLeft");
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: false, ariaHidden: "true" },
				{ isRevealed: false, ariaHidden: "true" },
			]);

			// Then Point A -- now none remain revealed, but ArrowLeft still
			// has not moved off slide 2.
			await page.keyboard.press("ArrowLeft");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: false, ariaHidden: "true" },
				{ isRevealed: false, ariaHidden: "true" },
				{ isRevealed: false, ariaHidden: "true" },
			]);

			// Only NOW, with nothing left to conceal, does ArrowLeft finally
			// retreat to the previous slide.
			await page.keyboard.press("ArrowLeft");
			expect(await activeSlideHeading(page)).toBe("Slide 1");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"resets a fragment-bearing slide's reveal state to fully concealed when re-entered forward, even if it was left partially revealed (a direct jump via the overview, not a step-by-step retreat)",
		async () => {
			const page = await openPresentationPage(generateHtml(FRAGMENT_DECK));

			await page.keyboard.press("ArrowRight");
			// Reveal 2 of slide 2's 3 fragments, then jump away (End) while
			// still partially revealed -- a direct jump never resets the
			// slide being LEFT, only the slide being ENTERED.
			await page.keyboard.press("ArrowRight");
			await page.keyboard.press("ArrowRight");
			await page.keyboard.press("End");
			expect(await activeSlideHeading(page)).toBe("Slide 3");

			// Jump back to slide 2 via the grid overview -- a thumbnail click
			// always calls goTo(index, false), i.e. a FORWARD entry,
			// regardless of the click's spatial direction.
			await page.keyboard.press("o");
			await page.click(".slide:nth-of-type(2)");
			expect(await activeSlideHeading(page)).toBe("Slide 2");

			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: false, ariaHidden: "true" },
				{ isRevealed: false, ariaHidden: "true" },
				{ isRevealed: false, ariaHidden: "true" },
			]);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"a click advances fragments one at a time before advancing the slide, same as ArrowRight",
		async () => {
			const page = await openPresentationPage(generateHtml(FRAGMENT_DECK));

			await page.click("body");
			expect(await activeSlideHeading(page)).toBe("Slide 2");

			await page.click("body");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: false, ariaHidden: "true" },
				{ isRevealed: false, ariaHidden: "true" },
			]);

			// Click through the remaining two fragments, then confirm one more
			// click advances the slide itself (the click path exhausts and
			// falls through to goTo() exactly like the keyboard path already
			// verified above).
			await page.click("body");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: false, ariaHidden: "true" },
			]);

			await page.click("body");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: true, ariaHidden: "false" },
			]);

			await page.click("body");
			expect(await activeSlideHeading(page)).toBe("Slide 3");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"a deck with no fragments on the current slide navigates exactly as before (no behavior change for fragment-free decks)",
		async () => {
			const page = await openPresentationPage(generateHtml(FRAGMENT_DECK));

			// Slide 1 has zero fragments -- ArrowRight must advance the slide
			// immediately, on the very first press.
			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 2");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"the grid overview shows every fragment fully visible regardless of its reveal state, and reports aria-hidden=false for all of them (regression: aria-hidden previously still reflected pre-overview reveal state, contradicting what a screen reader would infer from the visible-to-everyone-at-once grid)",
		async () => {
			const page = await openPresentationPage(generateHtml(FRAGMENT_DECK));

			await page.keyboard.press("ArrowRight");
			await page.keyboard.press("ArrowRight");
			// Exactly one of slide 2's three fragments is now revealed; the
			// other two are still concealed.
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: false, ariaHidden: "true" },
				{ isRevealed: false, ariaHidden: "true" },
			]);

			await page.keyboard.press("o");

			const overviewState = await page.evaluate(() =>
				Array.from(
					document.querySelectorAll(".slide:nth-of-type(2) .fragment"),
				).map((el) => ({
					opacity: getComputedStyle(el).opacity,
					ariaHidden: el.getAttribute("aria-hidden"),
				})),
			);
			expect(overviewState).toEqual([
				{ opacity: "1", ariaHidden: "false" },
				{ opacity: "1", ariaHidden: "false" },
				{ opacity: "1", ariaHidden: "false" },
			]);

			// Closing the overview (back to the same slide) must restore
			// aria-hidden from each fragment's own .is-revealed state, not
			// leave every fragment stuck at aria-hidden="false".
			await page.keyboard.press("o");
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: true, ariaHidden: "false" },
				{ isRevealed: false, ariaHidden: "true" },
				{ isRevealed: false, ariaHidden: "true" },
			]);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"removes aria-hidden from fragments entirely on exiting presentation mode (visible-by-default continuous-scroll view has no hiding to describe)",
		async () => {
			const page = await openPresentationPage(generateHtml(FRAGMENT_DECK));

			await page.keyboard.press("ArrowRight");
			// Slide 2's fragments are concealed (aria-hidden="true") -- confirm
			// that starting state before exiting.
			expect(await fragmentStates(page)).toEqual([
				{ isRevealed: false, ariaHidden: "true" },
				{ isRevealed: false, ariaHidden: "true" },
				{ isRevealed: false, ariaHidden: "true" },
			]);

			await page.keyboard.press("Escape");

			const ariaHiddenValues = await page.evaluate(() =>
				Array.from(document.querySelectorAll(".fragment")).map((el) =>
					el.getAttribute("aria-hidden"),
				),
			);
			expect(ariaHiddenValues).toEqual([null, null, null]);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"applies a fast linear opacity transition to a fragment's reveal when prefers-reduced-motion is enabled",
		async () => {
			activeServer = await startServer(generateHtml(FRAGMENT_DECK), 0);
			const executablePath = detectBrowserExecutable();
			activeBrowser = await puppeteer.launch({
				executablePath,
				headless: true,
			});
			const page = await activeBrowser.newPage();
			await page.emulateMediaFeatures([
				{ name: "prefers-reduced-motion", value: "reduce" },
			]);
			await page.goto(`${activeServer.url}/?present`, { waitUntil: "load" });

			await page.keyboard.press("ArrowRight");

			const transition = await page.evaluate(() => {
				const el = document.querySelector(".fragment");
				return el ? getComputedStyle(el).transitionDuration : null;
			});

			expect(transition).toBe("0.2s");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);
});

describe("presentation mode — presenter view (separate window)", () => {
	const NOTES_DECK =
		"# Slide 1\n\nFirst.\n\n<!-- remember to breathe -->\n\n---\n\n# Slide 2\n\nSecond.\n\n---\n\n# Slide 3\n\nThird.";

	function presenterCurrentHeading(presenterPage: Page) {
		return presenterPage.evaluate(
			() =>
				document.querySelector(".presenter-preview-current h1")?.textContent,
		);
	}

	function presenterNextHeading(presenterPage: Page) {
		return presenterPage.evaluate(
			() => document.querySelector(".presenter-preview-next h1")?.textContent,
		);
	}

	it(
		"opening a second page at the same URL plus &presenter shows the presenter-console layout with current+next slide previews and notes visible without needing ?notes",
		async () => {
			const mainPage = await openPresentationPage(generateHtml(NOTES_DECK));
			const presenterPage = await openSecondPresentationPage(
				"/?present&presenter",
			);

			const isPresenterView = await presenterPage.evaluate(() =>
				document.body.classList.contains("presenter-view"),
			);
			expect(isPresenterView).toBe(true);

			expect(await presenterCurrentHeading(presenterPage)).toBe("Slide 1");
			expect(await presenterNextHeading(presenterPage)).toBe("Slide 2");

			const notesText = await presenterPage.evaluate(
				() => document.querySelector(".presenter-notes-panel")?.textContent,
			);
			expect(notesText).toContain("remember to breathe");

			// The main window's own URL never carries ?notes -- the presenter
			// console's notes panel is visible regardless, unlike the main
			// view's own ?notes-gated overlay.
			const mainUrlHasNotes = await mainPage.evaluate(() =>
				new URLSearchParams(location.search).has("notes"),
			);
			expect(mainUrlHasNotes).toBe(false);

			// The ordinary presenting (non-presenter) window must never show
			// this chrome at all.
			const mainHasPresenterConsole = await mainPage.evaluate(
				() => document.querySelector(".presenter-console") !== null,
			);
			expect(mainHasPresenterConsole).toBe(false);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"navigating in the main window's simulated presenting context broadcasts the update to an already-open presenter-view page via BroadcastChannel (verified live across two real Puppeteer pages, not assumed)",
		async () => {
			const mainPage = await openPresentationPage(
				generateHtml(THREE_SLIDE_DECK),
			);
			const presenterPage = await openSecondPresentationPage(
				"/?present&presenter",
			);
			expect(await presenterCurrentHeading(presenterPage)).toBe("Slide 1");

			await mainPage.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(mainPage)).toBe("Slide 2");

			// The BroadcastChannel message is delivered asynchronously -- poll
			// briefly for the OTHER page's own DOM to reflect it rather than
			// asserting immediately after the keypress, which could race.
			await presenterPage.waitForFunction(
				() =>
					document.querySelector(".presenter-preview-current h1")
						?.textContent === "Slide 2",
			);

			expect(await presenterNextHeading(presenterPage)).toBe("Slide 3");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"a presenter-view page opened AFTER navigation already happened reads the last-known slide index from localStorage on load",
		async () => {
			const mainPage = await openPresentationPage(
				generateHtml(THREE_SLIDE_DECK),
			);

			await mainPage.keyboard.press("ArrowRight");
			await mainPage.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(mainPage)).toBe("Slide 3");

			const presenterPage = await openSecondPresentationPage(
				"/?present&presenter",
			);

			expect(await presenterCurrentHeading(presenterPage)).toBe("Slide 3");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"a presenter-view page opened BEFORE any navigation happens in a fresh main window shows that window's real current slide, not a stale index left over by an earlier session at the same origin",
		async () => {
			const staleSessionPage = await openPresentationPage(
				generateHtml(THREE_SLIDE_DECK),
			);
			await staleSessionPage.keyboard.press("ArrowRight");
			await staleSessionPage.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(staleSessionPage)).toBe("Slide 3");

			// A genuinely fresh main-window session at the SAME origin/server,
			// with no hash of its own -- localStorage still holds "2" from the
			// session above at this point, until this window's own startup
			// code runs.
			const freshMainPage = await openSecondPresentationPage("/?present");
			expect(await activeSlideHeading(freshMainPage)).toBe("Slide 1");

			const presenterPage = await openSecondPresentationPage(
				"/?present&presenter",
			);

			expect(await presenterCurrentHeading(presenterPage)).toBe("Slide 1");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"the presenter-view page never drives its own navigation -- keyboard and click input inside it have no effect on either window",
		async () => {
			const mainPage = await openPresentationPage(
				generateHtml(THREE_SLIDE_DECK),
			);
			const presenterPage = await openSecondPresentationPage(
				"/?present&presenter",
			);

			await presenterPage.keyboard.press("ArrowRight");
			await presenterPage.click("body");
			await presenterPage.keyboard.press("o");

			expect(await activeSlideHeading(mainPage)).toBe("Slide 1");
			expect(await presenterCurrentHeading(presenterPage)).toBe("Slide 1");
			const presenterHasOverviewClass = await presenterPage.evaluate(() =>
				document.body.classList.contains("overview"),
			);
			expect(presenterHasOverviewClass).toBe(false);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"pressing p in the main presenting window opens a real, separate presenter-view window carrying both the present and presenter flags",
		async () => {
			const mainPage = await openPresentationPage(
				generateHtml(THREE_SLIDE_DECK),
			);
			if (!activeBrowser) {
				throw new Error("activeBrowser was not set by openPresentationPage");
			}

			const [target] = await Promise.all([
				activeBrowser.waitForTarget((candidate) =>
					candidate.url().includes("presenter"),
				),
				mainPage.keyboard.press("p"),
			]);
			const presenterPage = await target.page();
			if (!presenterPage) {
				throw new Error("window.open()'s target produced no Page");
			}
			await presenterPage.waitForFunction(() =>
				document.body.classList.contains("presenter-view"),
			);

			const presenterUrl = new URL(presenterPage.url());
			const presenterParams = new URLSearchParams(presenterUrl.search);
			expect(presenterParams.has("present")).toBe(true);
			expect(presenterParams.has("presenter")).toBe(true);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"shows a count-up timer that visibly increases over a short real wait",
		async () => {
			await openPresentationPage(generateHtml(THREE_SLIDE_DECK));
			const presenterPage = await openSecondPresentationPage(
				"/?present&presenter",
			);

			const readTimerSeconds = async () => {
				const text = await presenterPage.evaluate(
					() =>
						document.querySelector(".presenter-timer-display")?.textContent ??
						"",
				);
				const [minutes, seconds] = text.split(":").map(Number);
				return minutes * 60 + seconds;
			};

			const initialSeconds = await readTimerSeconds();
			await new Promise((resolve) => setTimeout(resolve, 2200));
			const laterSeconds = await readTimerSeconds();

			expect(laterSeconds).toBeGreaterThan(initialSeconds);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"still initializes the presenter timer and lets a target duration recolor it in-memory when localStorage throws on every call",
		async () => {
			await openPresentationPage(generateHtml(THREE_SLIDE_DECK));
			if (!activeBrowser || !activeServer) {
				throw new Error(
					"openPresentationPage did not set up activeBrowser/activeServer",
				);
			}

			// evaluateOnNewDocument runs before the page's own scripts (including
			// presentationScript.ts's inline <script> tag) start executing, so
			// this override is already in place when the presenter-view setup
			// code first calls localStorage.getItem/setItem/removeItem -- the
			// exact private-browsing/storage-disabled failure mode this stage's
			// try/catch blocks exist to survive.
			const throwingPage = await activeBrowser.newPage();
			await throwingPage.evaluateOnNewDocument(() => {
				const throwStorageDisabled = () => {
					throw new DOMException("storage disabled", "SecurityError");
				};
				Object.defineProperty(window, "localStorage", {
					value: {
						getItem: throwStorageDisabled,
						setItem: throwStorageDisabled,
						removeItem: throwStorageDisabled,
					},
				});
			});
			await throwingPage.goto(`${activeServer.url}/?present&presenter`, {
				waitUntil: "load",
			});

			// Presenter-view setup itself must not have thrown/aborted -- the
			// console/notes/timer chrome all still exist.
			const timerText = await throwingPage.evaluate(
				() =>
					document.querySelector(".presenter-timer-display")?.textContent ?? "",
			);
			expect(timerText).toMatch(/^\d{2}:\d{2}$/);

			// Typing a target duration still recolors the timer using the
			// in-memory input value, even though persisting it to localStorage
			// fails on every call.
			await throwingPage.click(".presenter-timer-duration");
			await throwingPage.type(".presenter-timer-duration", "0.1");
			await throwingPage.keyboard.press("Tab");
			await throwingPage.waitForFunction(() =>
				document
					.querySelector(".presenter-timer")
					?.classList.contains("is-near-target"),
			);

			await throwingPage.close();
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"pauses and resumes the presenter timer on click, freezing and then resuming the display",
		async () => {
			await openPresentationPage(generateHtml(THREE_SLIDE_DECK));
			const presenterPage = await openSecondPresentationPage(
				"/?present&presenter",
			);

			const readTimerSeconds = async () => {
				const text = await presenterPage.evaluate(
					() =>
						document.querySelector(".presenter-timer-display")?.textContent ??
						"",
				);
				const [minutes, seconds] = text.split(":").map(Number);
				return minutes * 60 + seconds;
			};
			const isPaused = () =>
				presenterPage.evaluate(() =>
					document
						.querySelector(".presenter-timer")
						?.classList.contains("is-paused"),
				);

			await presenterPage.click(".presenter-timer-display");
			expect(await isPaused()).toBe(true);

			const secondsWhilePaused = await readTimerSeconds();
			// 2200ms, matching the established safe margin from "shows a
			// count-up timer that visibly increases over a short real wait"
			// above -- comfortably past setInterval's own 1000ms tick even
			// under background-tab timer throttling or a slow/contended CI
			// runner, so this always observes at least one real update
			// rather than racing the interval's own schedule.
			await new Promise((resolve) => setTimeout(resolve, 2200));
			expect(await readTimerSeconds()).toBe(secondsWhilePaused);

			await presenterPage.click(".presenter-timer-display");
			expect(await isPaused()).toBe(false);

			await new Promise((resolve) => setTimeout(resolve, 2200));
			expect(await readTimerSeconds()).toBeGreaterThan(secondsWhilePaused);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"recolors the presenter timer amber near a typed target duration and red once over it, but not before either threshold",
		async () => {
			await openPresentationPage(generateHtml(THREE_SLIDE_DECK));
			const presenterPage = await openSecondPresentationPage(
				"/?present&presenter",
			);

			const timerClasses = () =>
				presenterPage.evaluate(() =>
					Array.from(
						document.querySelector(".presenter-timer")?.classList ?? [],
					),
				);

			// No target typed yet -- neither color class should ever apply,
			// regardless of elapsed time. This is the default, opt-in-only
			// behavior every deck gets with zero duration configured.
			expect(await timerClasses()).not.toContain("is-near-target");
			expect(await timerClasses()).not.toContain("is-over-target");

			// A tiny target (0.1 minutes = 6s) so both thresholds are crossed
			// within this test's own real-time budget rather than waiting
			// minutes for a realistic value -- large enough (near-target at
			// 4.8s, over-target at 6s) to leave real margin against the
			// click/type/Tab setup above counting against the budget on a
			// slow or contended runner, unlike a sub-2s target would.
			await presenterPage.click(".presenter-timer-duration");
			await presenterPage.type(".presenter-timer-duration", "0.1");
			await presenterPage.keyboard.press("Tab");

			await presenterPage.waitForFunction(() =>
				document
					.querySelector(".presenter-timer")
					?.classList.contains("is-near-target"),
			);
			expect(await timerClasses()).not.toContain("is-over-target");

			await presenterPage.waitForFunction(
				() =>
					document
						.querySelector(".presenter-timer")
						?.classList.contains("is-over-target"),
				{ timeout: 5000 },
			);
			expect(await timerClasses()).not.toContain("is-near-target");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"persists a typed target duration to localStorage, scoped to this browser rather than any CLI flag or frontmatter",
		async () => {
			await openPresentationPage(generateHtml(THREE_SLIDE_DECK));
			const presenterPage = await openSecondPresentationPage(
				"/?present&presenter",
			);

			await presenterPage.click(".presenter-timer-duration");
			await presenterPage.type(".presenter-timer-duration", "15");
			await presenterPage.keyboard.press("Tab");

			const stored = await presenterPage.evaluate(() =>
				localStorage.getItem("nh-deck-presenter-timer-duration-minutes"),
			);
			expect(stored).toBe("15");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"removes the stored target duration and clears both target color classes when the duration is cleared",
		async () => {
			await openPresentationPage(generateHtml(THREE_SLIDE_DECK));
			const presenterPage = await openSecondPresentationPage(
				"/?present&presenter",
			);

			await presenterPage.click(".presenter-timer-duration");
			await presenterPage.type(".presenter-timer-duration", "0.1");
			await presenterPage.keyboard.press("Tab");
			await presenterPage.waitForFunction(() =>
				document
					.querySelector(".presenter-timer")
					?.classList.contains("is-near-target"),
			);

			await presenterPage.click(".presenter-timer-duration");
			await presenterPage.evaluate(() => {
				const input = document.querySelector(
					".presenter-timer-duration",
				) as HTMLInputElement;
				input.value = "";
				input.dispatchEvent(new Event("change", { bubbles: true }));
			});

			const stored = await presenterPage.evaluate(() =>
				localStorage.getItem("nh-deck-presenter-timer-duration-minutes"),
			);
			expect(stored).toBeNull();

			const classes = await presenterPage.evaluate(() =>
				Array.from(document.querySelector(".presenter-timer")?.classList ?? []),
			);
			expect(classes).not.toContain("is-near-target");
			expect(classes).not.toContain("is-over-target");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"toggles pause via a real keyboard activation (Enter) on the timer button, not just a mouse click",
		async () => {
			await openPresentationPage(generateHtml(THREE_SLIDE_DECK));
			const presenterPage = await openSecondPresentationPage(
				"/?present&presenter",
			);

			const isPaused = () =>
				presenterPage.evaluate(() =>
					document
						.querySelector(".presenter-timer")
						?.classList.contains("is-paused"),
				);
			const ariaPressed = () =>
				presenterPage.evaluate(() =>
					document
						.querySelector(".presenter-timer-display")
						?.getAttribute("aria-pressed"),
				);

			await presenterPage.focus(".presenter-timer-display");
			await presenterPage.keyboard.press("Enter");
			expect(await isPaused()).toBe(true);
			expect(await ariaPressed()).toBe("true");

			await presenterPage.keyboard.press("Enter");
			expect(await isPaused()).toBe(false);
			expect(await ariaPressed()).toBe("false");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);
});

describe('presentation mode — jump to slide ("g" + digits + Enter)', () => {
	const FIFTEEN_SLIDE_DECK = buildDeck(15);

	async function isJumpIndicatorActive(
		page: Awaited<ReturnType<typeof openPresentationPage>>,
	) {
		return page.evaluate(() => {
			const el = document.querySelector(".presentation-jump-indicator");
			return el?.classList.contains("is-active") ?? false;
		});
	}

	async function jumpIndicatorText(
		page: Awaited<ReturnType<typeof openPresentationPage>>,
	) {
		return page.evaluate(
			() =>
				document.querySelector(".presentation-jump-indicator")?.textContent ??
				"",
		);
	}

	it(
		'typing "g" "1" "2" then Enter navigates directly to slide 12 on a 15-slide deck',
		async () => {
			const page = await openPresentationPage(generateHtml(FIFTEEN_SLIDE_DECK));

			await page.keyboard.press("g");
			await page.keyboard.press("1");
			await page.keyboard.press("2");
			await page.keyboard.press("Enter");

			expect(await activeSlideHeading(page)).toBe("Slide 12");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"shows the on-screen digit indicator while typing, updating its text with each digit, and hides it again once Enter confirms the jump",
		async () => {
			const page = await openPresentationPage(generateHtml(FIFTEEN_SLIDE_DECK));

			expect(await isJumpIndicatorActive(page)).toBe(false);

			await page.keyboard.press("g");
			expect(await isJumpIndicatorActive(page)).toBe(true);
			expect(await jumpIndicatorText(page)).toContain("Go to");

			await page.keyboard.press("1");
			await page.keyboard.press("2");
			expect(await jumpIndicatorText(page)).toContain("12");

			await page.keyboard.press("Enter");
			expect(await isJumpIndicatorActive(page)).toBe(false);
			expect(await activeSlideHeading(page)).toBe("Slide 12");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"Escape cancels a pending jump, leaving the current slide unchanged and hiding the indicator (and does not also exit presentation mode in the same keypress)",
		async () => {
			const page = await openPresentationPage(generateHtml(FIFTEEN_SLIDE_DECK));

			await page.keyboard.press("ArrowRight");
			await page.keyboard.press("ArrowRight");
			expect(await activeSlideHeading(page)).toBe("Slide 3");

			await page.keyboard.press("g");
			await page.keyboard.press("9");
			expect(await isJumpIndicatorActive(page)).toBe(true);

			await page.keyboard.press("Escape");

			expect(await isJumpIndicatorActive(page)).toBe(false);
			expect(await activeSlideHeading(page)).toBe("Slide 3");

			const isPresenting = await page.evaluate(() =>
				document.body.classList.contains("presenting"),
			);
			expect(isPresenting).toBe(true);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"clamps an out-of-range typed slide number to the last slide instead of doing nothing or throwing",
		async () => {
			const page = await openPresentationPage(generateHtml(FIFTEEN_SLIDE_DECK));

			await page.keyboard.press("g");
			await page.keyboard.press("9");
			await page.keyboard.press("9");
			await page.keyboard.press("Enter");

			expect(await activeSlideHeading(page)).toBe("Slide 15");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"suppresses ordinary arrow-key navigation while a jump is pending, still confirming the jump once Enter is pressed",
		async () => {
			const page = await openPresentationPage(generateHtml(FIFTEEN_SLIDE_DECK));

			await page.keyboard.press("g");
			await page.keyboard.press("1");
			await page.keyboard.press("ArrowRight");

			expect(await activeSlideHeading(page)).toBe("Slide 1");
			expect(await isJumpIndicatorActive(page)).toBe(true);

			await page.keyboard.press("Enter");
			expect(await activeSlideHeading(page)).toBe("Slide 1");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		'swallows "?" while a jump is pending instead of opening the help overlay -- a pending jump must suppress every other key, "?" included',
		async () => {
			const page = await openPresentationPage(generateHtml(FIFTEEN_SLIDE_DECK));

			await page.keyboard.press("g");
			await page.keyboard.press("1");
			await page.keyboard.press("?");

			const helpOpen = await page.evaluate(() =>
				document.body.classList.contains("help-open"),
			);
			expect(helpOpen).toBe(false);
			expect(await isJumpIndicatorActive(page)).toBe(true);
			expect(await jumpIndicatorText(page)).toContain("1");

			await page.keyboard.press("Enter");
			expect(await activeSlideHeading(page)).toBe("Slide 1");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		"cancels silently, without navigating, when Enter is pressed with no digits typed yet",
		async () => {
			const page = await openPresentationPage(generateHtml(FIFTEEN_SLIDE_DECK));

			await page.keyboard.press("g");
			expect(await isJumpIndicatorActive(page)).toBe(true);

			await page.keyboard.press("Enter");

			expect(await isJumpIndicatorActive(page)).toBe(false);
			expect(await activeSlideHeading(page)).toBe("Slide 1");
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);

	it(
		'"g" does not start a jump while the grid overview is open, or while the help overlay is open',
		async () => {
			const page = await openPresentationPage(generateHtml(FIFTEEN_SLIDE_DECK));

			await page.keyboard.press("o");
			const overviewOpen = await page.evaluate(() =>
				document.body.classList.contains("overview"),
			);
			expect(overviewOpen).toBe(true);

			await page.keyboard.press("g");
			expect(await isJumpIndicatorActive(page)).toBe(false);

			// Close overview, open help instead, and confirm "g" is blocked there
			// too.
			await page.keyboard.press("o");
			await page.keyboard.press("?");
			const helpOpen = await page.evaluate(() =>
				document.body.classList.contains("help-open"),
			);
			expect(helpOpen).toBe(true);

			await page.keyboard.press("g");
			expect(await isJumpIndicatorActive(page)).toBe(false);
		},
		PRESENTATION_TEST_TIMEOUT_MS,
	);
});
