#!/usr/bin/env node
// Cross-browser PDF/PNG export visual-fidelity check (Context.md Roadmap
// item 7; see docs/adr/0007-pdf-cross-browser-fidelity-check.md).
//
// The 9-combination CI matrix (.github/workflows/ci.yml) proves export
// *works* on every OS/Node combination it runs against -- a real PDF/PNG
// gets produced everywhere. It does not prove the export *looks* the same
// across whichever Chrome-family browser chrome-launcher happens to detect
// on a given machine (Chrome vs. Edge vs. Brave vs. Chromium). This script
// closes that gap: when at least two distinct browser installations are
// detected, it renders the same fixture deck through both and compares the
// resulting PNG pixels (tolerance-based, since anti-aliasing/font-hinting
// differences between browser builds are expected even on identical
// content) and PDF page counts (exact match required -- a page-count
// mismatch is a real content-parity bug, not a rendering-tolerance
// question).
//
// This intentionally never fails a machine that only has one browser
// installed (solo-browser dev machines, and most default CI runner images)
// -- it prints a clear skip message and exits 0 instead. Wiring a second
// browser into CI so this genuinely runs there is the job of a dedicated
// "pdf-fidelity-check" job in .github/workflows/ci.yml, not this script's
// concern.
//
// Run directly against source via `npm run check:fidelity`
// (`node --import tsx scripts/check-pdf-fidelity.mjs`), matching how
// tests/cli.test.ts exercises the CLI via tsx without a build step -- see
// that file's own comment for why `--import tsx` (not `npx tsx` or the tsx
// CLI binary) is used.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { detectAllBrowserExecutables } from "../src/browserLaunch.js";
import { exportToPdf } from "../src/pdfExport.js";
import { exportToPng } from "../src/pngExport.js";
import { generateHtml } from "../src/render.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

// Anti-aliasing and font-hinting differ between browser builds even when
// rendering byte-identical HTML/CSS, so an exact pixel match is never a
// realistic bar. 2% is a starting tolerance, not a derived constant --
// revisit (see docs/adr/0007) if it proves too strict (false failures on a
// genuinely-matching deck) or too loose (real regressions slip through) in
// practice.
const PIXEL_DIFF_TOLERANCE_PERCENT = 2;

// A per-channel (R, G, B) difference below this is treated as
// indistinguishable anti-aliasing/hinting noise rather than a real visual
// difference. Alpha is deliberately not compared.
const CHANNEL_DIFF_THRESHOLD = 30;

/**
 * Decodes two same-slide PNG buffers and counts pixels that differ by more
 * than CHANNEL_DIFF_THRESHOLD on any of R, G, or B.
 */
function comparePngBuffers(bufferA, bufferB) {
	const pngA = PNG.sync.read(bufferA);
	const pngB = PNG.sync.read(bufferB);

	if (pngA.width !== pngB.width || pngA.height !== pngB.height) {
		return { dimensionsMatch: false, diffPixels: 0, totalPixels: 0 };
	}

	const totalPixels = pngA.width * pngA.height;
	let diffPixels = 0;
	for (let i = 0; i < totalPixels; i++) {
		const offset = i * 4;
		const rDiff = Math.abs(pngA.data[offset] - pngB.data[offset]);
		const gDiff = Math.abs(pngA.data[offset + 1] - pngB.data[offset + 1]);
		const bDiff = Math.abs(pngA.data[offset + 2] - pngB.data[offset + 2]);
		if (
			rDiff > CHANNEL_DIFF_THRESHOLD ||
			gDiff > CHANNEL_DIFF_THRESHOLD ||
			bDiff > CHANNEL_DIFF_THRESHOLD
		) {
			diffPixels++;
		}
	}

	return { dimensionsMatch: true, diffPixels, totalPixels };
}

/**
 * Exports the deck to PNG via both browsers, then compares every
 * corresponding slide pair. The overall percentage is the total differing
 * pixels across every slide divided by the total pixels across every slide
 * (not an average of per-slide percentages), so a single bad slide in an
 * otherwise-large deck cannot get diluted away.
 */
async function comparePngExports(html, tmpDir, browserA, browserB) {
	const dirA = path.join(tmpDir, "png-a");
	const dirB = path.join(tmpDir, "png-b");
	mkdirSync(dirA);
	mkdirSync(dirB);

	const pathsA = await exportToPng(html, path.join(dirA, "deck.png"), browserA);
	const pathsB = await exportToPng(html, path.join(dirB, "deck.png"), browserB);

	if (pathsA.length !== pathsB.length) {
		return {
			ok: false,
			perSlide: [],
			summary:
				`PNG slide count differs between browsers: ${pathsA.length} vs ` +
				`${pathsB.length} (same deck, so this is a real bug, not a ` +
				"rendering difference) -- FAIL",
		};
	}

	let totalDiffPixels = 0;
	let totalPixels = 0;
	const perSlide = [];

	for (let i = 0; i < pathsA.length; i++) {
		const result = comparePngBuffers(
			readFileSync(pathsA[i]),
			readFileSync(pathsB[i]),
		);

		if (!result.dimensionsMatch) {
			return {
				ok: false,
				perSlide,
				summary: `PNG dimensions differ on slide ${i + 1} between browsers -- FAIL`,
			};
		}

		totalDiffPixels += result.diffPixels;
		totalPixels += result.totalPixels;
		const slidePercent = (result.diffPixels / result.totalPixels) * 100;
		perSlide.push(
			`slide ${i + 1}: ${slidePercent.toFixed(3)}% differing pixels`,
		);
	}

	const overallPercent = (totalDiffPixels / totalPixels) * 100;
	const ok = overallPercent <= PIXEL_DIFF_TOLERANCE_PERCENT;

	return {
		ok,
		perSlide,
		summary: ok
			? `PNG pixel-diff: ${overallPercent.toFixed(3)}% (tolerance ${PIXEL_DIFF_TOLERANCE_PERCENT}%) -- PASS`
			: `PNG pixel-diff: ${overallPercent.toFixed(3)}% exceeds tolerance ${PIXEL_DIFF_TOLERANCE_PERCENT}% -- FAIL`,
	};
}

/**
 * Counts `/Type /Page` object occurrences in a PDF's raw bytes -- the same
 * byte-regex technique tests/pdfExport.test.ts already uses to verify PDF
 * pagination, reused here for a cross-browser comparison instead of a
 * fixed expected count.
 */
function countPdfPages(pdfPath) {
	const bytes = readFileSync(pdfPath);
	const matches = bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
	return matches.length;
}

/**
 * Exports the deck to PDF via both browsers and compares page counts.
 * Unlike the PNG pixel-diff, this is an exact-match requirement: a
 * page-count mismatch means the two browsers disagree on how many printed
 * pages the same HTML/CSS produces, which is a content-parity bug, not a
 * rendering-tolerance question.
 */
async function comparePdfExports(html, tmpDir, browserA, browserB) {
	const pathA = path.join(tmpDir, "a.pdf");
	const pathB = path.join(tmpDir, "b.pdf");

	await exportToPdf(html, pathA, browserA);
	await exportToPdf(html, pathB, browserB);

	const pagesA = countPdfPages(pathA);
	const pagesB = countPdfPages(pathB);
	const ok = pagesA === pagesB;

	return {
		ok,
		summary: ok
			? `PDF page count: ${pagesA} (matches) -- PASS`
			: `PDF page count differs: browser A produced ${pagesA}, browser B ` +
				`produced ${pagesB} -- FAIL (a real content-parity bug, not a ` +
				"rendering-tolerance question)",
	};
}

async function main() {
	const browsers = detectAllBrowserExecutables();

	if (browsers.length < 2) {
		console.log(
			"Skipping cross-browser PDF/PNG fidelity check -- only " +
				`${browsers.length} browser installation(s) detected on this ` +
				"machine. This check needs at least 2 distinct Chrome-family " +
				"browsers to compare against each other.",
		);
		process.exit(0);
	}

	// Cap at the first 2 -- chrome-launcher's own priority order (see
	// browserLaunch.ts) means these are its two most-preferred detections,
	// and comparing more than a pair adds combinatorial complexity this
	// check doesn't need.
	const [browserA, browserB] = browsers.slice(0, 2);
	console.log(`Browser A: ${browserA}`);
	console.log(`Browser B: ${browserB}`);

	const fixturePath = path.join(repoRoot, "fixtures", "sample.md");
	const markdown = readFileSync(fixturePath, "utf8");
	const html = generateHtml(markdown, "sample");

	const tmpDir = mkdtempSync(path.join(tmpdir(), "nh-deck-fidelity-"));

	try {
		const pngResult = await comparePngExports(html, tmpDir, browserA, browserB);
		const pdfResult = await comparePdfExports(html, tmpDir, browserA, browserB);

		console.log("");
		console.log("=== Cross-browser PDF/PNG fidelity summary ===");
		console.log(pngResult.summary);
		for (const line of pngResult.perSlide) {
			console.log(`  ${line}`);
		}
		console.log(pdfResult.summary);

		process.exit(pngResult.ok && pdfResult.ok ? 0 : 1);
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error("check-pdf-fidelity failed with an unexpected error:");
	console.error(error);
	process.exit(1);
});
