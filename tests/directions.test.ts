import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTION_NAME,
	DIRECTIONS,
	resolveDirectionName,
} from "../src/directions.js";

describe("DIRECTIONS", () => {
	it("has exactly the 2 fixed direction names", () => {
		expect([...DIRECTIONS].sort()).toEqual(["ltr", "rtl"]);
	});
});

describe("resolveDirectionName", () => {
	it("resolves a valid direction name with no warning", () => {
		const result = resolveDirectionName("rtl");
		expect(result).toEqual({ name: "rtl" });
	});

	it("is case-insensitive", () => {
		const result = resolveDirectionName("RTL");
		expect(result.name).toBe("rtl");
		expect(result.warning).toBeUndefined();
	});

	it("falls back to the default direction with a warning for an unknown name", () => {
		const result = resolveDirectionName("nonexistent-direction");
		expect(result.name).toBe(DEFAULT_DIRECTION_NAME);
		expect(result.warning).toMatch(/unknown direction/i);
		expect(result.warning).toContain("nonexistent-direction");
	});

	it("returns the default with no warning when nothing was requested", () => {
		const result = resolveDirectionName(undefined);
		expect(result).toEqual({ name: DEFAULT_DIRECTION_NAME });
	});
});
