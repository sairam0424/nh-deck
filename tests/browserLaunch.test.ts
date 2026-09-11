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

	it("does not claim a download fallback is planned (ADR 0001/SOUL.md permanently reject bundling or downloading a browser)", async () => {
		const { detectBrowserExecutable } = await import("../src/browserLaunch.js");

		let thrown: unknown;
		try {
			detectBrowserExecutable();
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).not.toMatch(/download fallback/i);
	});
});

describe("detectAllBrowserExecutables — no browser installed", () => {
	it("returns an empty array rather than throwing", async () => {
		const { detectAllBrowserExecutables } = await import(
			"../src/browserLaunch.js"
		);

		expect(detectAllBrowserExecutables()).toEqual([]);
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

describe("detectAllBrowserExecutables — multiple installations", () => {
	it("returns every installation, in chrome-launcher's own priority order", async () => {
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

		const { detectAllBrowserExecutables } = await import(
			"../src/browserLaunch.js"
		);

		expect(detectAllBrowserExecutables()).toEqual([
			"/fake/path/to/chrome",
			"/fake/path/to/edge",
			"/fake/path/to/brave",
		]);
	});
});
