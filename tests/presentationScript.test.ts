import { describe, expect, it } from "vitest";
import { PRESENTATION_SCRIPT } from "../src/presentationScript.js";

describe("PRESENTATION_SCRIPT", () => {
	it("is wrapped in a real <script> tag", () => {
		expect(PRESENTATION_SCRIPT).toMatch(/^<script>[\s\S]*<\/script>$/);
	});

	it("gates all its behavior behind the present query parameter", () => {
		expect(PRESENTATION_SCRIPT).toContain('has("present")');
	});

	it("listens for the expected navigation keys", () => {
		expect(PRESENTATION_SCRIPT).toContain("ArrowRight");
		expect(PRESENTATION_SCRIPT).toContain("ArrowLeft");
	});

	it("listens for Home, End, and Escape", () => {
		expect(PRESENTATION_SCRIPT).toContain('"Home"');
		expect(PRESENTATION_SCRIPT).toContain('"End"');
		expect(PRESENTATION_SCRIPT).toContain('"Escape"');
	});

	it("exits presentation mode via a clearly-named, composable function rather than inline Escape logic", () => {
		expect(PRESENTATION_SCRIPT).toContain("exitPresentationMode");
		expect(PRESENTATION_SCRIPT).toContain('params.delete("present")');
		expect(PRESENTATION_SCRIPT).toContain("history.replaceState");
	});

	it('toggles a grid-overview mode via the "o" key, applying an overview class', () => {
		expect(PRESENTATION_SCRIPT).toContain('event.key === "o"');
		expect(PRESENTATION_SCRIPT).toContain('event.key === "O"');
		expect(PRESENTATION_SCRIPT).toContain('classList.add("overview")');
		expect(PRESENTATION_SCRIPT).toContain('classList.remove("overview")');
	});

	it('gives Escape/"o" precedence over exitPresentationMode while overview is open, via a distinct close function', () => {
		expect(PRESENTATION_SCRIPT).toContain("closeOverviewToPreviousSlide");
		expect(PRESENTATION_SCRIPT).toContain("overviewOpen");
	});

	it("persists the current slide via location.hash", () => {
		expect(PRESENTATION_SCRIPT).toContain("location.hash");
	});

	it("does not advance on a click inside a link", () => {
		expect(PRESENTATION_SCRIPT).toContain('closest("a")');
	});

	it("never references an external CDN (local-first constraint)", () => {
		expect(PRESENTATION_SCRIPT).not.toMatch(/https?:\/\/cdn\./i);
	});

	it("listens for touchstart and touchend to support swipe navigation", () => {
		expect(PRESENTATION_SCRIPT).toContain('"touchstart"');
		expect(PRESENTATION_SCRIPT).toContain('"touchend"');
	});

	it("only treats a touch as a swipe once it clears both a distance threshold and a horizontal-dominance check", () => {
		expect(PRESENTATION_SCRIPT).toContain("SWIPE_THRESHOLD_PX");
		expect(PRESENTATION_SCRIPT).toContain("Math.abs(deltaX)");
		expect(PRESENTATION_SCRIPT).toContain("Math.abs(deltaY)");
	});

	it("guards swipe handling behind presentation mode and the overview state", () => {
		expect(PRESENTATION_SCRIPT).toContain('classList.contains("presenting")');
	});

	it('opens a keyboard-shortcuts help overlay via "?", toggling a help-open class', () => {
		expect(PRESENTATION_SCRIPT).toContain('event.key === "?"');
		expect(PRESENTATION_SCRIPT).toContain('classList.add("help-open")');
		expect(PRESENTATION_SCRIPT).toContain('classList.remove("help-open")');
		expect(PRESENTATION_SCRIPT).toContain("openHelp");
		expect(PRESENTATION_SCRIPT).toContain("closeHelp");
		expect(PRESENTATION_SCRIPT).toContain("helpOpen");
	});

	it("creates an always-visible hint button, separate from the hidden keybinding, that also opens the help overlay on click", () => {
		expect(PRESENTATION_SCRIPT).toContain("presentation-help-hint");
		expect(PRESENTATION_SCRIPT).toContain("? controls");
		expect(PRESENTATION_SCRIPT).toContain('closest(".presentation-help-hint")');
	});

	it("groups the help overlay's shortcut list under Navigate and View headings", () => {
		expect(PRESENTATION_SCRIPT).toContain("Navigate");
		expect(PRESENTATION_SCRIPT).toContain("View");
	});

	it('gives help precedence over overview for both Escape and "?": both branches check helpOpen before overviewOpen', () => {
		const escapeBranch = PRESENTATION_SCRIPT.slice(
			PRESENTATION_SCRIPT.indexOf('event.key === "Escape"'),
			PRESENTATION_SCRIPT.indexOf('event.key === "?"'),
		);
		expect(escapeBranch).toContain("helpOpen");
		expect(escapeBranch.indexOf("helpOpen")).toBeLessThan(
			escapeBranch.indexOf("overviewOpen"),
		);
	});

	it('suppresses "o" and slide-to-slide navigation while the help overlay is open, via an early return checked before both', () => {
		const keydownListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("keydown"',
		);
		const oKeyIndex = PRESENTATION_SCRIPT.indexOf(
			'event.key === "o"',
			keydownListenerStart,
		);
		const helpOpenGuardIndex = PRESENTATION_SCRIPT.indexOf(
			"if (helpOpen) {",
			keydownListenerStart,
		);
		expect(helpOpenGuardIndex).toBeGreaterThan(-1);
		expect(helpOpenGuardIndex).toBeLessThan(oKeyIndex);
	});

	it("suppresses the click listener's advance-to-next-slide behavior while the help overlay is open", () => {
		const clickListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("click"',
		);
		const advanceIndex = PRESENTATION_SCRIPT.indexOf(
			"advance();",
			clickListenerStart,
		);
		const helpOpenGuardIndex = PRESENTATION_SCRIPT.indexOf(
			"if (helpOpen) {",
			clickListenerStart,
		);
		expect(helpOpenGuardIndex).toBeGreaterThan(-1);
		expect(advanceIndex).toBeGreaterThan(-1);
		expect(helpOpenGuardIndex).toBeLessThan(advanceIndex);
	});

	it("suppresses touch-swipe navigation while the help overlay is open, same as the overview guard", () => {
		const touchendListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("touchend"',
		);
		const guard = PRESENTATION_SCRIPT.slice(
			touchendListenerStart,
			touchendListenerStart + 900,
		);
		expect(guard).toContain("helpOpen");
		expect(guard).toContain("overviewOpen");
	});
});
