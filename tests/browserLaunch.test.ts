import { describe, expect, it, vi } from "vitest";

vi.mock("chrome-launcher", async () => {
	const actual =
		await vi.importActual<typeof import("chrome-launcher")>("chrome-launcher");
	return {
		...actual,
		Launcher: { ...actual.Launcher, getInstallations: () => [] },
	};
});

describe("detectBrowserExecutable — no browser installed", () => {
	it("throws a clear, actionable error", async () => {
		const { detectBrowserExecutable } = await import("../src/browserLaunch.js");

		expect(() => detectBrowserExecutable()).toThrow(
			/No local Chrome, Chromium, Edge, or Brave installation was found/,
		);
	});
});
