import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportToPng } from "../src/pngExport.js";
import { generateHtml } from "../src/render.js";

// pngjs is already a devDependency used the same way
// (`PNG.sync.read(buffer).width`/`.height`) in
// scripts/check-pdf-fidelity.mjs's cross-browser pixel comparison -- reused
// here rather than hand-parsing PNG's IHDR chunk.

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

	it("produces identical PNG dimensions for every slide in one export call", async () => {
		dir = mkdtempSync(join(tmpdir(), "nh-deck-png-test-"));
		const outputPath = join(dir, "deck.png");
		// A minimal custom stylesheet (generateHtml's customCss param "fully
		// replaces the default stylesheet" -- see the CLI's own --css help
		// text) ties each `.slide`'s box directly to the viewport via vw/vh,
		// deliberately isolating this assertion from the *default* stylesheet's
		// own unrelated `.slide:last-of-type` rule (drops padding-bottom/
		// border-bottom, so under the default stylesheet the last slide of any
		// deck is intentionally ~33px shorter than the others -- a real,
		// separate rendering decision about the continuous-scroll view, not a
		// viewport-locking bug). With the viewport genuinely locked to a fixed
		// 1280x720 size (this stage's fix), every slide's 50vw x 50vh box
		// resolves to the exact same 640x360 regardless of position or content.
		const customCss = `
      body { margin: 0; }
      .slide {
        display: block;
        width: 50vw;
        height: 50vh;
        margin: 0;
        padding: 0;
        border: none;
        box-sizing: border-box;
        overflow: hidden;
      }
    `;
		const html = generateHtml(
			"# Slide 1\n\n---\n\n# Slide 2\n\n---\n\n# Slide 3\n\n---\n\n# Slide 4",
			undefined,
			customCss,
		);

		const written = await exportToPng(html, outputPath);

		expect(written).toHaveLength(4);
		const dimensions = written.map((path) => {
			const png = PNG.sync.read(readFileSync(path));
			return { width: png.width, height: png.height };
		});
		for (const dimension of dimensions) {
			expect(dimension).toEqual(dimensions[0]);
		}
		// Pinned to the fixed 1280x720 viewport this fix sets (50vw x 50vh of
		// it), not just "coincidentally equal to each other".
		expect(dimensions[0]).toEqual({ width: 640, height: 360 });
	}, 30_000);

	it("zero-pads slide numbers in filenames so they sort lexicographically in slide order", async () => {
		dir = mkdtempSync(join(tmpdir(), "nh-deck-png-test-"));
		const outputPath = join(dir, "deck.png");
		const markdown = Array.from(
			{ length: 12 },
			(_, i) => `# Slide ${i + 1}`,
		).join("\n\n---\n\n");
		const html = generateHtml(markdown);

		const written = await exportToPng(html, outputPath);

		const names = written.map((path) => basename(path));
		expect(names).toEqual([
			"deck-01.png",
			"deck-02.png",
			"deck-03.png",
			"deck-04.png",
			"deck-05.png",
			"deck-06.png",
			"deck-07.png",
			"deck-08.png",
			"deck-09.png",
			"deck-10.png",
			"deck-11.png",
			"deck-12.png",
		]);
		// The actual regression this guards: an unpadded "deck-10.png" would
		// sort lexicographically before "deck-2.png" in a plain filesystem
		// listing. Padded names must sort identically to slide order.
		expect([...names].sort()).toEqual(names);
	}, 30_000);
});

describe("exportToPng — post-launch export failure", () => {
	afterEach(() => {
		vi.doUnmock("puppeteer-core");
		vi.resetModules();
	});

	it("wraps a screenshot failure after a successful launch in a friendly error and still closes the browser (no orphaned process)", async () => {
		// Built via node:path's own join/dirname (not a hardcoded POSIX
		// literal) so the expected mock-call path matches pngExport.ts's
		// real platform-specific separator on Windows too.
		const outputPath = join(tmpdir(), "nh-deck-does-not-exist", "deck.png");
		const firstSlidePath = join(
			tmpdir(),
			"nh-deck-does-not-exist",
			"deck-1.png",
		);

		const closeBrowser = vi.fn().mockResolvedValue(undefined);
		const screenshot = vi
			.fn()
			.mockRejectedValue(
				new Error(
					`ENOENT: no such file or directory, open '${firstSlidePath}'`,
				),
			);

		vi.resetModules();
		vi.doMock("puppeteer-core", () => ({
			default: {
				launch: vi.fn().mockResolvedValue({
					newPage: vi.fn().mockResolvedValue({
						setViewport: vi.fn().mockResolvedValue(undefined),
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
			exportToPng("<html></html>", outputPath, "/fake/override/chrome"),
		).rejects.toThrow(
			/Failed to export PNG using \/fake\/override\/chrome: ENOENT/,
		);

		expect(screenshot).toHaveBeenCalledWith({
			path: firstSlidePath,
		});
		// The browser must still be closed via the `finally` block even though
		// the failure happened after a successful launch -- this is what
		// guarantees no orphaned browser subprocess is left running.
		expect(closeBrowser).toHaveBeenCalledTimes(1);
	});
});
