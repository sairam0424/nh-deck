import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportToPng } from "../src/pngExport.js";
import { generateHtml } from "../src/render.js";

describe("exportToPng", () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("produces one real PNG file per slide, correctly named and non-empty", async () => {
		dir = mkdtempSync(join(tmpdir(), "nh-deck-png-test-"));
		const outputPath = join(dir, "deck.png");
		const html = generateHtml(
			"# Slide 1\n\nFirst.\n\n---\n\n# Slide 2\n\nSecond.",
		);

		const written = await exportToPng(html, outputPath);

		expect(written).toEqual([join(dir, "deck-1.png"), join(dir, "deck-2.png")]);
		for (const path of written) {
			const bytes = readFileSync(path);
			// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
			expect(bytes.subarray(0, 8)).toEqual(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			);
		}
	}, 30_000);

	it("does not mangle a dotted directory name when the output filename has no extension", async () => {
		dir = mkdtempSync(join(tmpdir(), "nh-deck-png-test-"));
		const dottedDir = join(dir, "dir.with.dots");
		mkdirSync(dottedDir);
		const outputPath = join(dottedDir, "deck");
		const html = generateHtml(
			"# Slide 1\n\nFirst.\n\n---\n\n# Slide 2\n\nSecond.",
		);

		const written = await exportToPng(html, outputPath);

		expect(written).toEqual([
			join(dottedDir, "deck-1"),
			join(dottedDir, "deck-2"),
		]);
	}, 30_000);
});

describe("exportToPng — post-launch export failure", () => {
	afterEach(() => {
		vi.doUnmock("puppeteer-core");
		vi.resetModules();
	});

	it("wraps a screenshot failure after a successful launch in a friendly error and still closes the browser (no orphaned process)", async () => {
		const closeBrowser = vi.fn().mockResolvedValue(undefined);
		const screenshot = vi
			.fn()
			.mockRejectedValue(
				new Error(
					"ENOENT: no such file or directory, open '/tmp/nh-deck-does-not-exist/deck-1.png'",
				),
			);

		vi.resetModules();
		vi.doMock("puppeteer-core", () => ({
			default: {
				launch: vi.fn().mockResolvedValue({
					newPage: vi.fn().mockResolvedValue({
						setContent: vi.fn().mockResolvedValue(undefined),
						$$: vi.fn().mockResolvedValue([{ screenshot }]),
						close: vi.fn().mockResolvedValue(undefined),
					}),
					close: closeBrowser,
				}),
			},
		}));

		const { exportToPng } = await import("../src/pngExport.js");

		await expect(
			exportToPng(
				"<html></html>",
				"/tmp/nh-deck-does-not-exist/deck.png",
				"/fake/override/chrome",
			),
		).rejects.toThrow(
			/Failed to export PNG using \/fake\/override\/chrome: ENOENT/,
		);

		expect(screenshot).toHaveBeenCalledWith({
			path: "/tmp/nh-deck-does-not-exist/deck-1.png",
		});
		// The browser must still be closed via the `finally` block even though
		// the failure happened after a successful launch -- this is what
		// guarantees no orphaned browser subprocess is left running.
		expect(closeBrowser).toHaveBeenCalledTimes(1);
	});
});
