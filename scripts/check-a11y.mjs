#!/usr/bin/env node
// Automated accessibility scanning across the fixed set of rendering
// permutations this project actually ships: every theme (themes.ts), every
// layout (slideLayouts.ts), the opt-in RTL text direction, and the opt-in
// ?present presentation mode. This closes a real gap the existing Vitest
// snapshot suite does not cover -- those tests assert on HTML/CSS strings
// and on specific, hand-picked style properties (see tests/render.test.ts's
// "theme code-bg/border WCAG contrast" describe block), but nothing runs a
// real accessibility-rule engine against the actual rendered DOM the way a
// screen reader or automated auditor would encounter it.
//
// Scope: this is a regression gate, not a full manual accessibility audit
// (see ACCESSIBILITY.md for the honest, human-reviewed picture of what
// nh-deck does and does not support). Only axe-core's "serious" and
// "critical" impact violations fail this check -- "moderate"/"minor"
// findings are printed nowhere and never gate CI, since axe-core's own
// docs note those lower tiers include a meaningful false-positive rate that
// would make this check flaky rather than trustworthy. A real regression in
// contrast, landmark structure, or interactive-element semantics on any of
// these fixed cases is expected to surface as "serious" or "critical".
//
// Deliberately reuses the real THEMES/LAYOUTS registries (imported, not
// hardcoded name lists) so this check can never silently drift out of sync
// with themes.ts/slideLayouts.ts -- a themes.ts registry addition or rename
// is picked up here automatically, with zero edits to this file required.
//
// axe-core itself is injected by reading its own built,
// node_modules/axe-core/axe.min.js file directly (readFileSync) and adding
// it to the page via page.addScriptTag({ content: ... }) -- never fetched
// from a CDN. This matches every other local-first constraint this repo
// already enforces for rendered-deck output itself (see AGENTS.md's Local-
// First Constraint); this script is dev/CI-only tooling, never shipped, but
// the same "no runtime network dependency" discipline applies to how it
// exercises a real browser.
//
// Run directly against source via `npm run check:a11y`
// (`node --import tsx scripts/check-a11y.mjs`), matching how
// scripts/check-pdf-fidelity.mjs and tests/cli.test.ts already exercise
// source via tsx without a build step -- see that script's own comment for
// why `--import tsx` (not `npx tsx` or the tsx CLI binary) is used.
//
// Like scripts/check-pdf-fidelity.mjs, this never hard-fails a machine with
// no local browser installed -- it prints a clear skip message and exits 0
// instead when detectBrowserExecutable() throws (see main() below).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { detectBrowserExecutable } from "../src/browserLaunch.js";
import { generateHtml } from "../src/render.js";
import { startServer } from "../src/server.js";
import { LAYOUTS } from "../src/slideLayouts.js";
import { THEMES } from "../src/themes.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const AXE_SCRIPT_PATH = path.join(
	repoRoot,
	"node_modules",
	"axe-core",
	"axe.min.js",
);

// Only these two axe-core impact levels gate this check -- see this file's
// own header comment for why "moderate"/"minor" are deliberately excluded.
const FAILING_IMPACTS = new Set(["serious", "critical"]);

// Deliberately plain, representative slide content (a heading, a paragraph
// with a real link, a list, a fenced code block) -- enough surface area for
// axe-core's contrast/structure/interactive-element rules to have something
// real to check, without hand-authoring a deliberately broken fixture. Used
// for every case below except the per-layout ones, which need their own
// <!-- layout: name --> marker instead.
const FIXTURE_MARKDOWN = `# Accessibility fixture deck

A short paragraph with a [real link](https://example.com/) for axe-core to
inspect, plus some \`inline code\`.

- First item
- Second item
- Third item

---

# Second slide

\`\`\`js
console.log("hello from the fixture deck");
\`\`\`
`;

/**
 * Builds a one-slide deck carrying the given layout's own
 * <!-- layout: name --> marker (see slideLayouts.ts), with enough content
 * (a heading, a paragraph, a list) for that layout's own styling to have
 * something real to lay out.
 */
function buildLayoutMarkdown(layoutName) {
	return `<!-- layout: ${layoutName} -->

# ${layoutName} layout fixture

Representative content for the "${layoutName}" layout.

- One
- Two`;
}

/**
 * Builds the fixed set of rendered cases to scan: one per theme (THEMES),
 * one per layout (LAYOUTS), one RTL-direction deck, and one presentation-
 * mode case (same default-rendered deck, navigated with ?present appended
 * -- see runCase below). Iterating THEMES/LAYOUTS' own keys, rather than a
 * hardcoded name list, is what keeps this check from silently drifting out
 * of sync with either registry -- see this file's own header comment.
 */
function buildCases() {
	const cases = [];

	for (const themeName of Object.keys(THEMES)) {
		cases.push({
			name: `theme: ${themeName}`,
			html: generateHtml(
				FIXTURE_MARKDOWN,
				"a11y fixture",
				undefined,
				THEMES[themeName].colors,
			),
			path: "/",
		});
	}

	for (const layoutName of LAYOUTS) {
		cases.push({
			name: `layout: ${layoutName}`,
			html: generateHtml(buildLayoutMarkdown(layoutName), "a11y fixture"),
			path: "/",
		});
	}

	cases.push({
		name: "direction: rtl",
		html: generateHtml(
			FIXTURE_MARKDOWN,
			"a11y fixture",
			undefined,
			undefined,
			undefined,
			undefined,
			false,
			"rtl",
		),
		path: "/",
	});

	cases.push({
		name: "presentation mode (?present)",
		html: generateHtml(FIXTURE_MARKDOWN, "a11y fixture"),
		path: "/?present",
	});

	return cases;
}

/**
 * Serves one case's HTML, navigates a fresh page to it (appending the
 * case's own path, e.g. "/?present"), injects axe-core straight from its
 * own built file on disk, runs it, and returns only the "serious"/
 * "critical" violations. Each case gets its own server and page rather than
 * reusing one across cases, so one case's served HTML can never bleed into
 * another's.
 */
async function runCase(browser, axeSource, testCase) {
	const server = await startServer(testCase.html, 0);
	try {
		const page = await browser.newPage();
		try {
			await page.goto(`${server.url}${testCase.path}`, { waitUntil: "load" });
			await page.addScriptTag({ content: axeSource });
			const results = await page.evaluate(() => axe.run());
			return results.violations.filter((violation) =>
				FAILING_IMPACTS.has(violation.impact),
			);
		} finally {
			await page.close();
		}
	} finally {
		server.server.close();
	}
}

/**
 * Prints one case's failing violations in a clear, actionable shape: each
 * violation's own id/description, plus every affected node's own target
 * selector array (axe-core's `node.target`) -- exactly what a human needs
 * to find and fix the flagged element, without needing to re-run this
 * script locally first just to see what it found.
 */
function printViolations(caseName, violations) {
	console.error(
		`${caseName}: ${violations.length} serious/critical violation(s) -- FAIL`,
	);
	for (const violation of violations) {
		console.error(
			`  [${violation.impact}] ${violation.id}: ${violation.description}`,
		);
		for (const node of violation.nodes) {
			console.error(`    target: ${node.target.join(", ")}`);
		}
	}
}

async function main() {
	let executablePath;
	try {
		executablePath = detectBrowserExecutable();
	} catch (error) {
		console.log(
			"Skipping accessibility scan -- no local Chrome/Chromium/Edge/Brave " +
				`installation was detected on this machine: ${error.message}`,
		);
		process.exit(0);
	}

	const axeSource = readFileSync(AXE_SCRIPT_PATH, "utf8");
	const browser = await puppeteer.launch({ executablePath, headless: true });

	try {
		const cases = buildCases();
		let hasFailure = false;

		for (const testCase of cases) {
			const violations = await runCase(browser, axeSource, testCase);
			if (violations.length === 0) {
				console.log(`${testCase.name}: no serious/critical violations -- PASS`);
				continue;
			}
			hasFailure = true;
			printViolations(testCase.name, violations);
		}

		process.exitCode = hasFailure ? 1 : 0;
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error("check-a11y failed with an unexpected error:");
	console.error(error);
	process.exit(1);
});
