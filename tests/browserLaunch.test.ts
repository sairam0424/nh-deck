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

describe("detectBrowserExecutable — multiple installations", () => {
	it("returns the first installation, matching chrome-launcher's own priority order", async () => {
		vi.resetModules();
		vi.doMock("chrome-launcher", async () => {
			const actual =
				await vi.importActual<typeof import("chrome-launcher")>(
					"chrome-launcher",
				);
			return {
				...actual,
				Launcher: {
					...actual.Launcher,
					getInstallations: () => [
						"/fake/path/to/chrome",
						"/fake/path/to/edge",
						"/fake/path/to/brave",
					],
				},
			};
		});

		const { detectBrowserExecutable } = await import("../src/browserLaunch.js");

		expect(detectBrowserExecutable()).toBe("/fake/path/to/chrome");
	});
});
