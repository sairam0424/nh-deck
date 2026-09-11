import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_NAME, resolveThemeName, THEMES } from "../src/themes.js";

describe("THEMES", () => {
	it("has exactly the 4 fixed theme names", () => {
		expect(Object.keys(THEMES).sort()).toEqual([
			"dark",
			"dracula",
			"light",
			"nord",
		]);
	});

	it("gives every theme a bg and fg color", () => {
		for (const theme of Object.values(THEMES)) {
			expect(theme.colors.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
			expect(theme.colors.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
		}
	});
});

describe("resolveThemeName", () => {
	it("resolves a valid theme name with no warning", () => {
		const result = resolveThemeName("dark");
		expect(result).toEqual({ name: "dark" });
	});

	it("is case-insensitive", () => {
		const result = resolveThemeName("Dark");
		expect(result.name).toBe("dark");
		expect(result.warning).toBeUndefined();
	});

	it("falls back to the default theme with a warning for an unknown name", () => {
		const result = resolveThemeName("nonexistent-theme");
		expect(result.name).toBe(DEFAULT_THEME_NAME);
		expect(result.warning).toMatch(/unknown theme/i);
		expect(result.warning).toContain("nonexistent-theme");
	});

	it("returns the default with no warning when nothing was requested", () => {
		const result = resolveThemeName(undefined);
		expect(result).toEqual({ name: DEFAULT_THEME_NAME });
	});
});
