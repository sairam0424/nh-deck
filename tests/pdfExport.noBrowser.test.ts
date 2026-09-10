import { describe, expect, it, vi } from "vitest";

vi.mock("chrome-launcher", async () => {
  const actual =
    await vi.importActual<typeof import("chrome-launcher")>("chrome-launcher");
  return {
    ...actual,
    Launcher: { ...actual.Launcher, getInstallations: () => [] },
  };
});

describe("exportToPdf — no browser installed", () => {
  it("throws a clear, actionable error instead of hanging or crashing", async () => {
    const { exportToPdf } = await import("../src/pdfExport.js");

    await expect(
      exportToPdf("<html></html>", "/tmp/should-not-be-created.pdf"),
    ).rejects.toThrow(
      /No local Chrome, Chromium, Edge, or Brave installation was found/,
    );
  });
});
