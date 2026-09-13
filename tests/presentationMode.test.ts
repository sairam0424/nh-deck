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
