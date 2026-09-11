import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { exportToPdf } from "../src/pdfExport.js";
import { generateHtml } from "../src/render.js";

// NOTE on the ".js" import extensions above: see tests/render.test.ts for why
// this project's TypeScript NodeNext convention imports "../src/foo.js" even
// though only foo.ts exists on disk.

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const fixturePath = path.join(repoRoot, "fixtures", "sample.md");
const fixtureMarkdown = readFileSync(fixturePath, "utf8");

// PDF generation launches a real local browser via chrome-launcher +
// puppeteer-core, so this is a real (not mocked) end-to-end test. Browser
// launch + page render + PDF generation is generously budgeted here since
// it involves real subprocess and I/O latency, especially on cold/CI runners.
const PDF_EXPORT_TIMEOUT_MS = 60_000;

let activeOutputPath: string | undefined;

afterEach(() => {
	if (activeOutputPath && existsSync(activeOutputPath)) {
		rmSync(activeOutputPath, { force: true });
	}
	activeOutputPath = undefined;
});

describe("exportToPdf", () => {
	it(
		"produces a real PDF file from rendered deck HTML",
		async () => {
			const html = generateHtml(fixtureMarkdown, "sample");

			// Unique filename per run so parallel test runs never collide on the
			// same path in the shared OS temp directory.
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-export-test-${randomUUID()}.pdf`,
			);
			activeOutputPath = outputPath;

			await exportToPdf(html, outputPath);

			expect(existsSync(outputPath)).toBe(true);

			const fileContents = readFileSync(outputPath);
			const magicNumber = fileContents.subarray(0, 4).toString("utf8");
			expect(magicNumber).toBe("%PDF");
		},
		PDF_EXPORT_TIMEOUT_MS,
	);
});
