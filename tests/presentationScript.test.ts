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

	it("persists the current slide via location.hash", () => {
		expect(PRESENTATION_SCRIPT).toContain("location.hash");
	});

	it("does not advance on a click inside a link", () => {
		expect(PRESENTATION_SCRIPT).toContain('closest("a")');
	});

	it("never references an external CDN (local-first constraint)", () => {
		expect(PRESENTATION_SCRIPT).not.toMatch(/https?:\/\/cdn\./i);
	});
});
