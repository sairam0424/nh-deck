#!/usr/bin/env node
// Dev-only screenshot generator for README.md's "Themes" section (see the
// CLI's own `list-themes` subcommand in src/index.ts for the text-only
// discovery half of the same feature). Never shipped in the npm package
// (package.json's "files" allowlist is just "dist") and never run by an
// end user -- it exists purely to (re)produce the 4 committed
// docs/assets/theme-<name>.png screenshots whenever a theme's colors
// change, following scripts/check-pdf-fidelity.mjs's own precedent for a
// dev-only script that drives a real local browser via
// detectBrowserExecutable() (src/browserLaunch.ts) rather than a bundled
// or downloaded one -- this repo's local-first constraint (AGENTS.md, "The
// Local-First Constraint") applies to dev tooling too, not just the
// shipped CLI path.
//
// Renders fixtures/sample.md once per fixed named theme (light, dark,
// dracula, nord -- src/themes.ts's THEMES registry) via the exact same
// generateHtml/exportToPng functions the real `png` subcommand uses, then
// keeps only each render's first slide (the rest are discarded) --
// screenshotting all 5 of fixtures/sample.md's slides per theme would be
// wasteful when the README gallery only ever shows one representative
// slide per theme.
//
// Run directly against source via `npm run generate:theme-gallery`
// (`node --import tsx scripts/generate-theme-gallery.mjs`), matching how
// check-pdf-fidelity.mjs and tests/cli.test.ts both exercise this repo's
// own source via tsx without a build step.
import {
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectBrowserExecutable } from "../src/browserLaunch.js";
import { exportToPng } from "../src/pngExport.js";
import { generateHtml } from "../src/render.js";
import { THEMES } from "../src/themes.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const fixturePath = path.join(repoRoot, "fixtures", "sample.md");
const assetsDir = path.join(repoRoot, "docs", "assets");

async function main() {
	const executablePath = detectBrowserExecutable();
	const markdown = readFileSync(fixturePath, "utf8");
	const tmpDir = mkdtempSync(path.join(tmpdir(), "nh-deck-theme-gallery-"));

	try {
		for (const theme of Object.values(THEMES)) {
			const html = generateHtml(
				markdown,
				"fixtures/sample.md",
				undefined,
				theme.colors,
			);
			// exportToPng always inserts "-<N>" before the extension (one file
			// per slide) regardless of how many slides the deck actually has --
			// written into a throwaway temp dir since only the first slide's
			// file is kept.
			const tempOutputPath = path.join(tmpDir, `${theme.name}.png`);
			const written = await exportToPng(html, tempOutputPath, executablePath);
			const destPath = path.join(assetsDir, `theme-${theme.name}.png`);
			renameSync(written[0], destPath);
			const { size } = statSync(destPath);
			if (size === 0) {
				throw new Error(
					`Wrote an empty PNG for theme '${theme.name}' at ${destPath}`,
				);
			}
			console.log(`Wrote ${destPath} (${size} bytes)`);
		}
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error("generate-theme-gallery failed with an unexpected error:");
	console.error(error);
	process.exit(1);
});
