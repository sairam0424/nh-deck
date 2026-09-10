import { describe, expect, it, vi } from "vitest";

vi.mock("chrome-launcher", async () => {
  const actual =
    await vi.importActual<typeof import("chrome-launcher")>("chrome-launcher");
  return {
    ...actual,
    Launcher: {
      ...actual.Launcher,
      getInstallations: () => ["/fake/path/to/chrome"],
    },
  };
});

vi.mock("puppeteer-core", () => ({
  default: {
    launch: vi.fn().mockRejectedValue(new Error("spawn ENOENT")),
  },
}));

describe("exportToPdf — browser launch failure", () => {
  it("wraps a launch failure in a friendly error instead of crashing in finally", async () => {
    const { exportToPdf } = await import("../src/pdfExport.js");

    await expect(
      exportToPdf("<html></html>", "/tmp/should-not-be-created.pdf"),
    ).rejects.toThrow(
      /Failed to export PDF using \/fake\/path\/to\/chrome: spawn ENOENT/,
    );
  });
});
