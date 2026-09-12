import { describe, expect, it } from "vitest";
import { resolveTransitionName, TRANSITIONS } from "../src/transitions.js";

describe("TRANSITIONS", () => {
	it("has exactly the 2 fixed transition names", () => {
		expect([...TRANSITIONS].sort()).toEqual(["fade", "slide"]);
	});
});

describe("resolveTransitionName", () => {
	it("resolves a valid transition name with no warning", () => {
		expect(resolveTransitionName("fade")).toEqual({ name: "fade" });
	});

	it("is case-insensitive", () => {
		const result = resolveTransitionName("Fade");
		expect(result.name).toBe("fade");
		expect(result.warning).toBeUndefined();
	});

	it("falls back to no transition with a warning for an unknown name", () => {
		const result = resolveTransitionName("nonexistent-transition");
		expect(result.name).toBeUndefined();
		expect(result.warning).toMatch(/unknown transition/i);
		expect(result.warning).toContain("nonexistent-transition");
	});

	it("returns no transition and no warning when nothing was requested", () => {
		expect(resolveTransitionName(undefined)).toEqual({});
	});
});
