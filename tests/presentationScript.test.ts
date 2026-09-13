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
});
