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
});
