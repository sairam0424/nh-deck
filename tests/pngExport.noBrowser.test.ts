import { describe, expect, it, vi } from "vitest";

vi.mock("chrome-launcher", async () => {
	const actual =
		await vi.importActual<typeof import("chrome-launcher")>("chrome-launcher");
	return {
		...actual,
		Launcher: { ...actual.Launcher, getInstallations: () => [] },
	};
});

describe("exportToPng — no browser installed", () => {
	it("throws a clear, actionable error instead of hanging or crashing", async () => {
		const { exportToPng } = await import("../src/pngExport.js");

		await expect(
			exportToPng("<html></html>", "/tmp/should-not-be-created.png"),
		).rejects.toThrow(
			/No local Chrome, Chromium, Edge, or Brave installation was found/,
		);
	});

	it("bypasses browser detection entirely when executablePathOverride is given", async () => {
		vi.resetModules();
		vi.doMock("chrome-launcher", async () => {
			const actual =
				await vi.importActual<typeof import("chrome-launcher")>(
					"chrome-launcher",
				);
			return {
				...actual,
				Launcher: { ...actual.Launcher, getInstallations: () => [] },
			};
		});

		const launch = vi.fn().mockResolvedValue({
			newPage: vi.fn().mockResolvedValue({
				setContent: vi.fn().mockResolvedValue(undefined),
				$$: vi.fn().mockResolvedValue([]),
				close: vi.fn().mockResolvedValue(undefined),
			}),
			close: vi.fn().mockResolvedValue(undefined),
		});
		vi.doMock("puppeteer-core", () => ({ default: { launch } }));

		const { exportToPng } = await import("../src/pngExport.js");

		await exportToPng(
			"<html></html>",
			"/tmp/should-not-be-created.png",
			"/fake/override/chrome",
		);

		expect(launch).toHaveBeenCalledWith({
			executablePath: "/fake/override/chrome",
			headless: true,
		});
	});
});
