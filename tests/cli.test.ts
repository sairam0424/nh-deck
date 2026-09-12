import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import * as http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { generateHtml } from "../src/render.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const fixturePath = path.join(repoRoot, "fixtures", "sample.md");

const SERVING_LINE_PATTERN = /nh-deck serving .* at http:\/\/127\.0\.0\.1:\d+/;
const STARTUP_TIMEOUT_MS = 8_000;
const EXIT_TIMEOUT_MS = 3_000;
const TEST_TIMEOUT_MS = STARTUP_TIMEOUT_MS + EXIT_TIMEOUT_MS + 5_000;
const PDF_EXPORT_TIMEOUT_MS = 60_000;
const WATCH_TEST_TIMEOUT_MS = 10_000;

let activeChild: ChildProcess | undefined;

// Safety net: if an assertion throws between spawning and the explicit
// kill()+wait below, this still guarantees no server process is left running
// after the test finishes (pass or fail).
afterEach(() => {
	if (
		activeChild &&
		activeChild.exitCode === null &&
		activeChild.signalCode === null
	) {
		activeChild.kill("SIGKILL");
	}
	activeChild = undefined;
});

/**
 * Spawns the CLI and resolves once its stdout contains a line matching
 * SERVING_LINE_PATTERN, or rejects on timeout / early exit / spawn error.
 *
 * Deliberately spawns `node --import tsx <file>` rather than `npx tsx <file>`
 * or the `tsx` CLI binary directly: both of those internally spawn a further
 * child process to run the actual instrumented Node process, so killing only
 * the immediate child would leave the real server process orphaned. `node
 * --import tsx` runs everything in the single process we spawn here, which we
 * can kill directly and deterministically.
 */
function waitForServingLine(
	child: ChildProcess,
	timeoutMs: number,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";

		const cleanup = () => {
			clearTimeout(timer);
			child.stdout?.off("data", onStdout);
			child.stderr?.off("data", onStderr);
			child.off("exit", onExit);
			child.off("error", onError);
		};

		const onStdout = (chunk: Buffer) => {
			stdout += chunk.toString();
			const match = stdout.match(SERVING_LINE_PATTERN);
			if (match) {
				cleanup();
				resolve(match[0]);
			}
		};

		const onStderr = (chunk: Buffer) => {
			stderr += chunk.toString();
		};

		const onExit = (code: number | null, signal: string | null) => {
			cleanup();
			reject(
				new Error(
					`nh-deck CLI exited early (code=${code}, signal=${signal}) before announcing its serving URL.\n` +
						`stdout: ${JSON.stringify(stdout)}\nstderr: ${JSON.stringify(stderr)}`,
				),
			);
		};

		const onError = (err: Error) => {
			cleanup();
			reject(err);
		};

		const timer = setTimeout(() => {
			cleanup();
			child.kill("SIGKILL");
			reject(
				new Error(
					`Timed out after ${timeoutMs}ms waiting for the nh-deck CLI to announce its serving URL.\n` +
						`stdout so far: ${JSON.stringify(stdout)}\nstderr so far: ${JSON.stringify(stderr)}`,
				),
			);
		}, timeoutMs);

		child.stdout?.on("data", onStdout);
		child.stderr?.on("data", onStderr);
		child.on("exit", onExit);
		child.on("error", onError);
	});
}

/** Resolves once the child has actually exited, force-killing on timeout. */
function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) {
		return Promise.resolve();
	}

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(
				new Error(
					`nh-deck CLI process did not exit within ${timeoutMs}ms after being killed.`,
				),
			);
		}, timeoutMs);

		child.once("exit", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

/** Fetches the response body from `url` as a UTF-8 string. */
function fetchBody(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		http
			.get(url, (res) => {
				let data = "";
				res.on("data", (chunk: Buffer) => {
					data += chunk.toString();
				});
				res.on("end", () => resolve(data));
				res.on("error", reject);
			})
			.on("error", reject);
	});
}

describe("CLI: nh-deck render", () => {
	it(
		"prints the serving URL to stdout and shuts down cleanly on kill",
		async () => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"0",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);

			expect(matchedLine).toMatch(SERVING_LINE_PATTERN);

			// Strip the OS-assigned port before comparing, since --port 0 means the
			// actual port differs on every run and a raw equality check would be flaky.
			const normalized = matchedLine.replace(/:\d+$/, ":<PORT>");
			expect(normalized).toBe(
				"nh-deck serving fixtures/sample.md at http://127.0.0.1:<PORT>",
			);

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"renders with a custom --css file, fully replacing the default stylesheet",
		async () => {
			const cssPath = path.join(
				tmpdir(),
				`nh-deck-custom-css-test-${randomUUID()}.css`,
			);
			writeFileSync(cssPath, ".slide { color: hotpink; }");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"0",
					"--css",
					cssPath,
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const body = await new Promise<string>((resolve, reject) => {
				http
					.get(url, (res) => {
						let data = "";
						res.on("data", (chunk: Buffer) => {
							data += chunk.toString();
						});
						res.on("end", () => resolve(data));
						res.on("error", reject);
					})
					.on("error", reject);
			});

			expect(body).toContain(".slide { color: hotpink; }");
			expect(body).not.toContain("font-family: -apple-system");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(cssPath, { force: true });
		},
		TEST_TIMEOUT_MS,
	);
});

describe("CLI: nh-deck render — unsafe HTML warning", () => {
	it(
		"writes the raw-HTML warning to stderr (not stdout) for a deck containing a genuine <script> tag",
		async () => {
			const tempFile = path.join(
				tmpdir(),
				`nh-deck-unsafe-html-test-${randomUUID()}.md`,
			);
			writeFileSync(tempFile, "# Slide\n\n<script>alert(1)</script>\n");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					tempFile,
					"--no-open",
					"--port",
					"0",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			expect(matchedLine).toMatch(SERVING_LINE_PATTERN);
			expect(stderr).toBe(
				"nh-deck: warning: this deck contains raw HTML, which is rendered as-is (including any <script> tags). Only open decks from sources you trust.\n",
			);

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(tempFile, { force: true });
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"does not write the warning for a plain markdown-only deck",
		async () => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"0",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			expect(stderr).not.toMatch(/nh-deck: warning:/);

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"does not write the warning for a deck using only presenter-note HTML comments",
		async () => {
			const tempFile = path.join(
				tmpdir(),
				`nh-deck-presenter-notes-only-test-${randomUUID()}.md`,
			);
			writeFileSync(
				tempFile,
				"# Slide\n\nBody text.\n\n<!-- remember to smile -->\n",
			);

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					tempFile,
					"--no-open",
					"--port",
					"0",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			expect(stderr).not.toMatch(/nh-deck: warning:/);

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(tempFile, { force: true });
		},
		TEST_TIMEOUT_MS,
	);
});

describe("CLI: nh-deck render — error handling", () => {
	it(
		"prints a clean 'could not find file' error and exits non-zero when the file does not exist, instead of a raw ENOENT/unhandled-rejection stack trace",
		async () => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"does-not-exist.md",
					"--no-open",
					"--port",
					"0",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(stderr).toBe("nh-deck: could not find file 'does-not-exist.md'\n");
			expect(stderr).not.toMatch(/ENOENT/);
			expect(stderr).not.toMatch(
				/UnhandledPromiseRejection|at Object\.<anonymous>/,
			);
			expect(exitCode).toBe(1);
		},
		STARTUP_TIMEOUT_MS,
	);

	it(
		"rejects a non-numeric --port with a clear error before starting the server",
		async () => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"abc",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(stderr).toMatch(/port must be an integer between 0 and 65535/);
			expect(exitCode).not.toBe(0);
		},
		STARTUP_TIMEOUT_MS,
	);

	it(
		"surfaces the raw ENOENT error and exits non-zero when --css points to a nonexistent file",
		async () => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"0",
					"--css",
					"/path/to/does-not-exist.css",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			// Current behavior: the top-level try/catch in src/index.ts surfaces
			// readFileSync's own ENOENT error message verbatim, prefixed with
			// "nh-deck: " -- there is no custom "--css file not found" message.
			expect(stderr).toMatch(/^nh-deck: /);
			expect(stderr).toMatch(/ENOENT/);
			expect(exitCode).toBe(1);
		},
		STARTUP_TIMEOUT_MS,
	);
});

describe("CLI: nh-deck pdf", () => {
	it(
		"prints a clean 'could not find file' error and exits non-zero when the file does not exist",
		async () => {
			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "pdf", "does-not-exist.md"],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(stderr).toBe("nh-deck: could not find file 'does-not-exist.md'\n");
			expect(stderr).not.toMatch(/ENOENT/);
			expect(exitCode).toBe(1);
		},
		STARTUP_TIMEOUT_MS,
	);

	it(
		"exports a real PDF file and reports the output path on stdout",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-cli-pdf-test-${randomUUID()}.pdf`,
			);

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"pdf",
					"fixtures/sample.md",
					outputPath,
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

			expect(stdout).toContain(`Wrote PDF to ${outputPath}`);
			expect(existsSync(outputPath)).toBe(true);

			const fileContents = readFileSync(outputPath);
			expect(fileContents.subarray(0, 4).toString("utf8")).toBe("%PDF");

			rmSync(outputPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"exports a real PDF file with a custom --css file",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-cli-pdf-css-test-${randomUUID()}.pdf`,
			);
			const cssPath = path.join(
				tmpdir(),
				`nh-deck-custom-css-pdf-test-${randomUUID()}.css`,
			);
			const customCss = ".slide { color: hotpink; }";
			writeFileSync(cssPath, customCss);

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"pdf",
					"fixtures/sample.md",
					outputPath,
					"--css",
					cssPath,
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

			expect(stdout).toContain(`Wrote PDF to ${outputPath}`);
			expect(existsSync(outputPath)).toBe(true);

			const fileContents = readFileSync(outputPath);
			expect(fileContents.subarray(0, 4).toString("utf8")).toBe("%PDF");

			// The PDF's own bytes are a poor place to look for verbatim CSS text:
			// Chromium's print-to-PDF renders the <style> tag's effect (glyph
			// positions, fill colors), not its source text, so ".slide { color:
			// hotpink; }" never appears as searchable ASCII in the output --
			// unlike a plain HTTP response body (see the "render --css" test
			// above), a PDF has no equivalent of "read back the served bytes".
			// As a reliable proxy for "pdf --css exercises the same customCss
			// wiring render --css already exercises", call generateHtml directly
			// with the same markdown+CSS and confirm it fully replaces the
			// default stylesheet -- this is the exact function pdf's action
			// calls with the same options.css-derived customCss argument.
			const fixtureMarkdown = readFileSync(fixturePath, "utf8");
			const html = generateHtml(
				fixtureMarkdown,
				"fixtures/sample.md",
				customCss,
			);
			expect(html).toContain(customCss);
			expect(html).not.toContain("font-family: -apple-system");

			rmSync(outputPath, { force: true });
			rmSync(cssPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"exports a paginated PDF with a custom --css file and presenter notes combined",
		async () => {
			// Inline fixture deliberately exercising all three features shipped in
			// the same PR together: three slides (multi-slide pagination), a
			// standalone HTML-comment presenter note on two of them, and a
			// --css file that fully replaces the default stylesheet.
			const combinedMarkdown = [
				"# Slide One",
				"",
				"First slide body.",
				"",
				"<!-- remember to smile -->",
				"",
				"---",
				"",
				"# Slide Two",
				"",
				"Second slide body.",
				"",
				"<!-- pause for questions -->",
				"",
				"---",
				"",
				"# Slide Three",
				"",
				"Third slide body.",
				"",
			].join("\n");

			const mdPath = path.join(
				tmpdir(),
				`nh-deck-combined-features-test-${randomUUID()}.md`,
			);
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-cli-pdf-combined-test-${randomUUID()}.pdf`,
			);
			const cssPath = path.join(
				tmpdir(),
				`nh-deck-custom-css-combined-test-${randomUUID()}.css`,
			);
			const customCss = ".slide { color: hotpink; }";
			writeFileSync(mdPath, combinedMarkdown);
			writeFileSync(cssPath, customCss);

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"pdf",
					mdPath,
					outputPath,
					"--css",
					cssPath,
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

			expect(stdout).toContain(`Wrote PDF to ${outputPath}`);
			expect(existsSync(outputPath)).toBe(true);

			const fileContents = readFileSync(outputPath);
			expect(fileContents.subarray(0, 4).toString("utf8")).toBe("%PDF");

			// Pagination: three "---"-delimited slides must still produce three
			// PDF pages even with a custom stylesheet in play -- the print
			// pagination rule is appended unconditionally after customCss in
			// src/render.ts, independent of which stylesheet block is used. Same
			// byte-level page-count technique as tests/pdfExport.test.ts's own
			// "one PDF page per slide" test.
			const pageCount = (
				fileContents.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []
			).length;
			expect(pageCount).toBe(3);

			// CSS + notes: as in the "custom --css file" pdf test above, a
			// rendered PDF's bytes are the wrong place to look for verbatim CSS
			// or note text (Chromium's print-to-PDF renders glyphs, not source
			// text). Call generateHtml directly with the same markdown+CSS --
			// the exact function pdf's action calls -- to confirm both the
			// custom stylesheet and both presenter notes are present in the HTML
			// that was actually fed to the PDF exporter.
			const html = generateHtml(combinedMarkdown, mdPath, customCss);
			expect(html).toContain(customCss);
			expect(html).not.toContain("font-family: -apple-system");
			expect(html).toContain(
				'<aside class="notes" hidden>remember to smile</aside>',
			);
			expect(html).toContain(
				'<aside class="notes" hidden>pause for questions</aside>',
			);

			rmSync(mdPath, { force: true });
			rmSync(outputPath, { force: true });
			rmSync(cssPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);
});

describe("CLI: nh-deck pdf — error handling", () => {
	// The "input file does not exist" case for pdf is covered by the "prints
	// a clean 'could not find file' error..." test above, in the main "CLI:
	// nh-deck pdf" describe block.

	it(
		"surfaces the raw ENOENT error and exits non-zero when --css points to a nonexistent file",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-cli-pdf-css-enoent-test-${randomUUID()}.pdf`,
			);

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"pdf",
					"fixtures/sample.md",
					outputPath,
					"--css",
					"/path/to/does-not-exist.css",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			// Current behavior: same as render's --css ENOENT test -- the
			// top-level try/catch surfaces readFileSync's own ENOENT message
			// verbatim, prefixed with "nh-deck: ".
			expect(stderr).toMatch(/^nh-deck: /);
			expect(stderr).toMatch(/ENOENT/);
			expect(exitCode).toBe(1);
			expect(existsSync(outputPath)).toBe(false);
		},
		STARTUP_TIMEOUT_MS,
	);
});

describe("CLI: nh-deck png", () => {
	it(
		"prints a clean 'could not find file' error and exits non-zero when the file does not exist",
		async () => {
			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "png", "does-not-exist.md"],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(stderr).toBe("nh-deck: could not find file 'does-not-exist.md'\n");
			expect(stderr).not.toMatch(/ENOENT/);
			expect(exitCode).toBe(1);
		},
		STARTUP_TIMEOUT_MS,
	);

	it(
		"exports one PNG per slide and reports the first output path on stdout",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-cli-png-test-${randomUUID()}.png`,
			);
			const firstSlidePath = outputPath.replace(/\.png$/, "-1.png");
			const secondSlidePath = outputPath.replace(/\.png$/, "-2.png");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"png",
					"fixtures/sample.md",
					outputPath,
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

			expect(stdout).toContain(
				`Wrote 5 PNG file(s), starting at ${firstSlidePath}`,
			);
			expect(existsSync(firstSlidePath)).toBe(true);
			expect(existsSync(secondSlidePath)).toBe(true);

			const fileContents = readFileSync(firstSlidePath);
			expect(fileContents.subarray(0, 8)).toEqual(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			);

			rmSync(firstSlidePath, { force: true });
			rmSync(secondSlidePath, { force: true });
			// fixtures/sample.md has 5 slides -- clean up the rest too.
			for (let n = 3; n <= 5; n++) {
				rmSync(outputPath.replace(/\.png$/, `-${n}.png`), { force: true });
			}
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"exports PNGs with a custom --css file",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-cli-png-css-test-${randomUUID()}.png`,
			);
			const firstSlidePath = outputPath.replace(/\.png$/, "-1.png");
			const secondSlidePath = outputPath.replace(/\.png$/, "-2.png");
			const cssPath = path.join(
				tmpdir(),
				`nh-deck-custom-css-png-test-${randomUUID()}.css`,
			);
			writeFileSync(cssPath, ".slide { color: hotpink; }");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"png",
					"fixtures/sample.md",
					outputPath,
					"--css",
					cssPath,
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

			expect(stdout).toContain(
				`Wrote 5 PNG file(s), starting at ${firstSlidePath}`,
			);
			expect(existsSync(firstSlidePath)).toBe(true);
			expect(existsSync(secondSlidePath)).toBe(true);

			const fileContents = readFileSync(firstSlidePath);
			expect(fileContents.subarray(0, 8)).toEqual(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			);

			rmSync(firstSlidePath, { force: true });
			rmSync(secondSlidePath, { force: true });
			// fixtures/sample.md has 5 slides -- clean up the rest too.
			for (let n = 3; n <= 5; n++) {
				rmSync(outputPath.replace(/\.png$/, `-${n}.png`), { force: true });
			}
			rmSync(cssPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);
});

describe("CLI: nh-deck png — error handling", () => {
	// The "input file does not exist" case for png is covered by the "prints
	// a clean 'could not find file' error..." test above, in the main "CLI:
	// nh-deck png" describe block.

	it(
		"surfaces the raw ENOENT error and exits non-zero when --css points to a nonexistent file",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-cli-png-css-enoent-test-${randomUUID()}.png`,
			);

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"png",
					"fixtures/sample.md",
					outputPath,
					"--css",
					"/path/to/does-not-exist.css",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			// Current behavior: same as render's --css ENOENT test -- the
			// top-level try/catch surfaces readFileSync's own ENOENT message
			// verbatim, prefixed with "nh-deck: ".
			expect(stderr).toMatch(/^nh-deck: /);
			expect(stderr).toMatch(/ENOENT/);
			expect(exitCode).toBe(1);
			expect(existsSync(outputPath.replace(/\.png$/, "-1.png"))).toBe(false);
		},
		STARTUP_TIMEOUT_MS,
	);
});

describe("CLI: nh-deck render --watch", () => {
	it(
		"pushes a reload event over SSE when the watched file changes",
		async () => {
			const tempFile = path.join(
				tmpdir(),
				`nh-deck-watch-test-${randomUUID()}.md`,
			);
			writeFileSync(tempFile, "# Original\n");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					tempFile,
					"--no-open",
					"--port",
					"0",
					"--watch",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const reloadPromise = new Promise<string>((resolve, reject) => {
				const req = http.get(`${url}/__nh-deck-reload`, (res) => {
					res.on("data", (chunk: Buffer) => {
						const text = chunk.toString();
						if (text.includes("data:")) {
							req.destroy();
							resolve(text);
						}
					});
					res.on("error", reject);
				});
				req.on("error", reject);
			});

			// Give the SSE connection a moment to establish before triggering a change.
			await new Promise((r) => setTimeout(r, 300));
			writeFileSync(tempFile, "# Changed\n");

			const message = await reloadPromise;
			expect(message).toContain("data: reload");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(tempFile, { force: true });
		},
		WATCH_TEST_TIMEOUT_MS,
	);

	it(
		"warns once on the initial render and not again on a debounced re-render triggered by a file save",
		async () => {
			const tempFile = path.join(
				tmpdir(),
				`nh-deck-watch-unsafe-html-test-${randomUUID()}.md`,
			);
			writeFileSync(tempFile, "# Slide\n\n<script>alert(1)</script>\n");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					tempFile,
					"--no-open",
					"--port",
					"0",
					"--watch",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const warningCount = () =>
				(stderr.match(/nh-deck: warning:/g) ?? []).length;

			expect(warningCount()).toBe(1);

			const reloadPromise = new Promise<string>((resolve, reject) => {
				const req = http.get(`${url}/__nh-deck-reload`, (res) => {
					res.on("data", (chunk: Buffer) => {
						const text = chunk.toString();
						if (text.includes("data:")) {
							req.destroy();
							resolve(text);
						}
					});
					res.on("error", reject);
				});
				req.on("error", reject);
			});

			// Give the SSE connection a moment to establish before triggering a
			// change -- the re-saved content still contains raw HTML, so if the
			// check ran again on every debounced re-render (rather than only on
			// the initial render), the warning count below would double.
			await new Promise((r) => setTimeout(r, 300));
			writeFileSync(tempFile, "# Slide changed\n\n<script>alert(2)</script>\n");

			await reloadPromise;
			// The debounce window is 100ms; wait comfortably past it before the
			// final assertion so a would-be second warning has time to appear.
			await new Promise((r) => setTimeout(r, 300));

			expect(warningCount()).toBe(1);

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(tempFile, { force: true });
		},
		WATCH_TEST_TIMEOUT_MS,
	);

	it(
		"re-applies a deck's own updated frontmatter theme: value on a debounced re-render",
		async () => {
			const dir = mkdtempSync(path.join(tmpdir(), "nh-deck-watch-theme-"));
			const deckPath = path.join(dir, "deck.md");
			writeFileSync(deckPath, "---\ntheme: light\n---\n# Slide one\n");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					deckPath,
					"--watch",
					"--no-open",
					"--port",
					"0",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;
			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const initialBody = await fetchBody(url);
			expect(initialBody).toContain("--nh-bg: #ffffff"); // light theme

			// Edit the deck's frontmatter to a different theme, then wait for
			// the debounced re-render to pick it up.
			writeFileSync(deckPath, "---\ntheme: dark\n---\n# Slide one\n");
			await new Promise((resolve) => setTimeout(resolve, 500));

			const updatedBody = await fetchBody(url);
			expect(updatedBody).toContain("--nh-bg: #0d1117"); // dark theme (github-dark)

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(dir, { recursive: true, force: true });
		},
		WATCH_TEST_TIMEOUT_MS,
	);

	it(
		"survives a transient read failure during a debounced re-render and keeps serving",
		async () => {
			const dir = mkdtempSync(
				path.join(tmpdir(), "nh-deck-watch-read-failure-"),
			);
			const deckPath = path.join(dir, "deck.md");
			writeFileSync(deckPath, "# Original\n");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					deckPath,
					"--watch",
					"--no-open",
					"--port",
					"0",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;
			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const initialBody = await fetchBody(url);
			expect(initialBody).toContain("Original");

			// Delete the watched file right as a change event fires, so the
			// debounced re-render's readFileSync hits ENOENT mid-"save" -- the
			// exact transient-failure shape the empty catch in the --watch
			// rerender closure (src/index.ts) exists to survive.
			rmSync(deckPath, { force: true });
			// Wait comfortably past the 100ms debounce window so the failed
			// re-render attempt actually runs before asserting survival.
			await new Promise((resolve) => setTimeout(resolve, 500));

			// The process must not have crashed from the uncaught read failure.
			expect(child.exitCode).toBeNull();
			expect(child.signalCode).toBeNull();

			// The server must still be serving the last successfully rendered
			// HTML -- the failed read must not have torn anything down.
			const bodyAfterFailure = await fetchBody(url);
			expect(bodyAfterFailure).toContain("Original");

			// A subsequent valid save must still be picked up: this proves the
			// watcher/server genuinely survived (retried on the next change
			// event), not merely that it hadn't crashed yet.
			writeFileSync(deckPath, "# Recovered\n");
			await new Promise((resolve) => setTimeout(resolve, 500));

			const recoveredBody = await fetchBody(url);
			expect(recoveredBody).toContain("Recovered");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(dir, { recursive: true, force: true });
		},
		WATCH_TEST_TIMEOUT_MS,
	);

	it(
		"re-applies a deck's own updated frontmatter transition: value on a debounced re-render",
		async () => {
			const dir = mkdtempSync(path.join(tmpdir(), "nh-deck-watch-transition-"));
			const deckPath = path.join(dir, "deck.md");
			writeFileSync(deckPath, "---\ntransition: fade\n---\n# Slide one\n");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					deckPath,
					"--watch",
					"--no-open",
					"--port",
					"0",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;
			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const initialBody = await fetchBody(url);
			expect(initialBody).toContain("transition: opacity"); // fade transition

			// Edit the deck's frontmatter to a different transition, then wait
			// for the debounced re-render to pick it up.
			writeFileSync(deckPath, "---\ntransition: slide\n---\n# Slide one\n");
			await new Promise((resolve) => setTimeout(resolve, 500));

			const updatedBody = await fetchBody(url);
			expect(updatedBody).toContain("transform: translateX"); // slide transition
			expect(updatedBody).not.toContain("transition: opacity");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(dir, { recursive: true, force: true });
		},
		WATCH_TEST_TIMEOUT_MS,
	);
});

describe("CLI: theme selection", () => {
	it(
		"applies a named theme's colors via the --theme flag on render",
		async () => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"0",
					"--theme",
					"dark",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const body = await fetchBody(url);
			// github-dark's bg, per src/themes.ts's THEMES.dark.
			expect(body).toContain("--nh-bg: #0d1117");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"applies a deck's own frontmatter theme: value when no --theme flag is given",
		async () => {
			const tempDir = mkdtempSync(
				path.join(tmpdir(), "nh-deck-theme-frontmatter-"),
			);
			const tempFile = path.join(tempDir, "deck.md");
			writeFileSync(tempFile, "---\ntheme: dracula\n---\n# Slide\n");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					tempFile,
					"--no-open",
					"--port",
					"0",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const body = await fetchBody(url);
			// dracula's bg, per src/themes.ts's THEMES.dracula.
			expect(body).toContain("--nh-bg: #282a36");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(tempDir, { recursive: true, force: true });
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"lets a --theme flag override a conflicting frontmatter theme: value",
		async () => {
			const tempDir = mkdtempSync(
				path.join(tmpdir(), "nh-deck-theme-precedence-"),
			);
			const tempFile = path.join(tempDir, "deck.md");
			writeFileSync(tempFile, "---\ntheme: light\n---\n# Slide\n");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					tempFile,
					"--no-open",
					"--port",
					"0",
					"--theme",
					"nord",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const body = await fetchBody(url);
			// nord's bg, per src/themes.ts's THEMES.nord -- confirms the --theme
			// flag won over the deck's conflicting frontmatter theme: light.
			expect(body).toContain("--nh-bg: #2e3440");
			// github-light's own fg (distinct from the baseline stylesheet's
			// hardcoded #1a1a1a default fg) would only appear here if the
			// frontmatter's "light" had incorrectly won instead -- a bare bg check
			// alone can't tell the two apart, since the baseline stylesheet's own
			// hardcoded default bg (#ffffff) happens to equal github-light's bg too.
			expect(body).not.toContain("--nh-fg: #1f2328");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(tempDir, { recursive: true, force: true });
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"lets --css win over a --theme flag, with a stderr note and no theme override applied",
		async () => {
			const cssPath = path.join(
				tmpdir(),
				`nh-deck-theme-css-conflict-test-${randomUUID()}.css`,
			);
			writeFileSync(cssPath, ".slide { color: hotpink; }");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"0",
					"--css",
					cssPath,
					"--theme",
					"dark",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const body = await fetchBody(url);
			expect(body).toContain(".slide { color: hotpink; }");
			expect(body).not.toContain("--nh-bg: #0d1117");
			expect(stderr).toMatch(/--css overrides the requested theme/);

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(cssPath, { force: true });
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"falls back to the default theme with a warning for an unrecognized --theme name",
		async () => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"0",
					"--theme",
					"totally-not-a-theme",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			expect(matchedLine).toMatch(SERVING_LINE_PATTERN);
			expect(stderr).toMatch(/unknown theme/i);

			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const body = await fetchBody(url);
			// The default "light" theme's own bg -- confirms the fallback still
			// rendered successfully rather than crashing or failing outright.
			expect(body).toContain("--nh-bg: #ffffff");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
		},
		TEST_TIMEOUT_MS,
	);
});

describe("CLI: transition selection", () => {
	it(
		"applies a transition's CSS via the --transition flag on render",
		async () => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"0",
					"--transition",
					"fade",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const body = await fetchBody(url);
			expect(body).toContain("transition: opacity");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"applies a deck's own frontmatter transition: value when no --transition flag is given",
		async () => {
			const tempDir = mkdtempSync(
				path.join(tmpdir(), "nh-deck-transition-frontmatter-"),
			);
			const tempFile = path.join(tempDir, "deck.md");
			writeFileSync(tempFile, "---\ntransition: slide\n---\n# Slide\n");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					tempFile,
					"--no-open",
					"--port",
					"0",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const body = await fetchBody(url);
			expect(body).toContain("transform: translateX");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"lets a --transition flag override a conflicting frontmatter transition: value",
		async () => {
			const tempDir = mkdtempSync(
				path.join(tmpdir(), "nh-deck-transition-override-"),
			);
			const tempFile = path.join(tempDir, "deck.md");
			writeFileSync(tempFile, "---\ntransition: fade\n---\n# Slide\n");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					tempFile,
					"--no-open",
					"--port",
					"0",
					"--transition",
					"slide",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const body = await fetchBody(url);
			expect(body).toContain("transform: translateX");
			expect(body).not.toContain("transition: opacity");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"lets --css win over a --transition flag, with a stderr note and no transition applied",
		async () => {
			const cssPath = path.join(
				tmpdir(),
				`nh-deck-transition-css-test-${randomUUID()}.css`,
			);
			writeFileSync(cssPath, ".slide { color: hotpink; }");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"0",
					"--css",
					cssPath,
					"--transition",
					"fade",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			expect(stderr).toContain("nh-deck: note:");
			expect(stderr).toContain("--css overrides the requested transition");

			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}
			const body = await fetchBody(url);
			expect(body).not.toContain("transition: opacity");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(cssPath, { force: true });
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"falls back to no transition with a warning for an unrecognized --transition name",
		async () => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--no-open",
					"--port",
					"0",
					"--transition",
					"nonexistent",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			expect(stderr).toContain("nh-deck: warning:");
			expect(stderr).toContain("unknown transition");

			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}
			const body = await fetchBody(url);
			expect(body).not.toContain("transform: translateX");
			expect(body).not.toContain("transition: opacity");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"rejects --transition as an unknown option on the pdf subcommand",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-no-transition-test-${randomUUID()}.pdf`,
			);
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"pdf",
					"fixtures/sample.md",
					outputPath,
					"--transition",
					"fade",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.on("exit", resolve);
			});

			expect(exitCode).not.toBe(0);
			expect(stderr).toContain("unknown option");
			expect(existsSync(outputPath)).toBe(false);
		},
		EXIT_TIMEOUT_MS + 5_000,
	);
});
