import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
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
import { runWatchedRerender } from "../src/cliHelpers.js";
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

describe("CLI: nh-deck init", () => {
	it(
		"writes a starter deck covering themes, all 4 layouts, KaTeX, Mermaid, presenter notes, and presentation-mode shortcuts",
		async () => {
			const tempFile = path.join(
				tmpdir(),
				`nh-deck-init-test-${randomUUID()}.md`,
			);

			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "init", tempFile],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stdout).toContain(`Wrote starter deck to ${tempFile}`);
			expect(stdout).toContain(`nh-deck render ${tempFile}`);
			expect(existsSync(tempFile)).toBe(true);

			const written = readFileSync(tempFile, "utf8");
			// Frontmatter: real theme/transition values, not placeholders.
			expect(written).toContain("---\ntheme: dracula\ntransition: fade\n---");
			// One slide per fixed layout, via the existing marker convention.
			expect(written).toContain("<!-- layout: title -->");
			expect(written).toContain("<!-- layout: section -->");
			expect(written).toContain("<!-- layout: two-column -->");
			expect(written).toContain("<!-- layout: quote -->");
			// KaTeX: inline and block math.
			expect(written).toContain("$E = mc^2$");
			expect(written).toContain("$$");
			expect(written).toContain("\\frac{n(n+1)}{2}");
			// A Mermaid diagram.
			expect(written).toContain("```mermaid");
			expect(written).toContain("flowchart");
			// A presenter-note comment, distinct from a layout marker.
			expect(written).toContain(
				"<!-- Remember: presenter notes stay hidden until ?notes is added to the URL. -->",
			);
			// The closing slide documents presentation mode as real slide
			// content -- both query params and the actual keyboard shortcuts.
			expect(written).toContain("?present");
			expect(written).toContain("?notes");
			expect(written).toContain("→ / Space / ← / Home / End / click / swipe");
			expect(written).toContain("Esc");

			rmSync(tempFile, { force: true });
		},
		STARTUP_TIMEOUT_MS,
	);

	it(
		"refuses to overwrite an existing file without --force",
		async () => {
			const tempFile = path.join(
				tmpdir(),
				`nh-deck-init-exists-test-${randomUUID()}.md`,
			);
			const originalContent = "# My existing deck\n";
			writeFileSync(tempFile, originalContent);

			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "init", tempFile],
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

			expect(exitCode).toBe(1);
			expect(stderr).toMatch(/^nh-deck: /);
			expect(stderr).toMatch(/already exists/);
			expect(stderr).toMatch(/--force/);
			// The pre-existing file must be left completely untouched.
			expect(readFileSync(tempFile, "utf8")).toBe(originalContent);

			rmSync(tempFile, { force: true });
		},
		STARTUP_TIMEOUT_MS,
	);

	it(
		"overwrites an existing file when --force is passed",
		async () => {
			const tempFile = path.join(
				tmpdir(),
				`nh-deck-init-force-test-${randomUUID()}.md`,
			);
			writeFileSync(tempFile, "# My existing deck\n");

			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "init", tempFile, "--force"],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stdout).toContain(`Wrote starter deck to ${tempFile}`);

			const written = readFileSync(tempFile, "utf8");
			expect(written).not.toBe("# My existing deck\n");
			expect(written).toContain("<!-- layout: title -->");

			rmSync(tempFile, { force: true });
		},
		STARTUP_TIMEOUT_MS,
	);

	it(
		"respects a custom filename argument",
		async () => {
			const tempDir = mkdtempSync(
				path.join(tmpdir(), "nh-deck-init-custom-name-"),
			);
			const customFile = path.join(tempDir, "my-talk.md");

			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "init", customFile],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stdout).toContain(`Wrote starter deck to ${customFile}`);
			expect(existsSync(customFile)).toBe(true);

			rmSync(tempDir, { recursive: true, force: true });
		},
		STARTUP_TIMEOUT_MS,
	);

	it(
		"defaults to writing deck.md in the current directory when no file argument is given",
		async () => {
			// Nested under repoRoot's own (gitignored) .worktrees/, not the OS
			// tmpdir(): `--import tsx` resolves the "tsx" package by walking up
			// node_modules from the spawned process's cwd, exactly like plain
			// CommonJS require() resolution -- a cwd outside this repo entirely
			// (e.g. plain tmpdir()) has no ancestor node_modules containing
			// "tsx" and fails with ERR_MODULE_NOT_FOUND before init ever runs.
			// .worktrees/ is already gitignored for exactly this "real nested
			// directory under repoRoot, safe to leave stray" use case (see
			// .gitignore), so a crash before the rmSync cleanup below still
			// can't taint `git status`. A fresh CI checkout never has this
			// directory on disk (it is gitignored, so nothing creates it before
			// this test runs) -- mkdtempSync requires its parent to already
			// exist, so it must be created here rather than assumed present.
			const worktreesDir = path.join(repoRoot, ".worktrees");
			mkdirSync(worktreesDir, { recursive: true });
			const tempDir = mkdtempSync(
				path.join(worktreesDir, "nh-deck-init-default-"),
			);
			const defaultFile = path.join(tempDir, "deck.md");

			// Spawned with an absolute script path (rather than the usual
			// relative "src/index.ts") so `cwd` can point at tempDir instead of
			// repoRoot -- this test exercises init's no-argument default, which
			// resolves "deck.md" against process.cwd(), and must never write a
			// stray deck.md into this repo's own working directory.
			const child = spawn(
				process.execPath,
				["--import", "tsx", path.join(repoRoot, "src", "index.ts"), "init"],
				{ cwd: tempDir },
			);
			activeChild = child;

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stdout).toContain("Wrote starter deck to deck.md");
			expect(existsSync(defaultFile)).toBe(true);

			rmSync(tempDir, { recursive: true, force: true });
		},
		STARTUP_TIMEOUT_MS,
	);
});

describe("CLI: nh-deck list-themes", () => {
	it(
		"prints all 4 fixed theme names, one per line, noting the default, and exits 0",
		async () => {
			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "list-themes"],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			// Exactly the 4 fixed theme names from src/themes.ts's THEMES
			// registry, in that registry's own insertion order, each on its
			// own line -- "light" is annotated as the default (matching
			// src/themes.ts's DEFAULT_THEME_NAME) and no other line is.
			const lines = stdout.trim().split("\n");
			expect(lines).toEqual(["light (default)", "dark", "dracula", "nord"]);
		},
		STARTUP_TIMEOUT_MS,
	);

	it(
		"never launches a browser or touches the filesystem -- it only reads the fixed THEMES registry",
		async () => {
			// No fixture path, no --port, no temp file: list-themes takes no
			// arguments at all. This exercises that it still exits cleanly
			// and quickly (well under STARTUP_TIMEOUT_MS, which every other
			// test in this file needs specifically because it's waiting on a
			// browser launch or a dev-server startup -- list-themes needs
			// neither).
			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "list-themes"],
				{ cwd: repoRoot },
			);
			activeChild = child;

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
		},
		STARTUP_TIMEOUT_MS,
	);
});

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
		"omits both --open and --no-open and still fails via the same clean ENOENT error path, confirming --open's default never diverts Commander's parsing before the open() call it would otherwise gate",
		async () => {
			// Every other render test in this file passes --no-open explicitly,
			// so this is the only place Commander's negatable `--no-open` flag
			// is ever left completely unset on the command line -- exercising
			// its true default (`options.open === true`) for the first time.
			// A deliberately-missing input file makes the action throw (and
			// print the ENOENT-derived error) at the `readFileSync(file, ...)`
			// call, well before the `if (options.open) await open(url)` line
			// src/index.ts's render action reaches last -- so this can never
			// launch a real OS browser. What it does prove: with `--no-open`
			// completely absent from argv, Commander still parses the command
			// line cleanly and the action reaches the exact same "could not
			// find file" branch (same message, same exit code) as the
			// already-covered explicit-`--no-open` case above -- i.e. leaving
			// `--open` at its default has no different or broken parsing path.
			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "render", "does-not-exist.md"],
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

describe("CLI: nh-deck pdf/png — presenter notes dropped warning", () => {
	// Today, presenter notes are silently and completely dropped from every
	// pdf/png export unless --with-notes is passed -- this is the fix for
	// that silence: a non-fatal stderr note printed once, after a
	// successful export, whenever the deck actually has at least one note
	// that --with-notes would have included.
	const NOTES_DROPPED_TEXT =
		"note: presenter notes are not included in this export (pass --with-notes to include them)";

	it(
		"pdf: writes the notes-dropped note to stderr for a deck with a presenter note, exported without --with-notes",
		async () => {
			const tempFile = path.join(
				tmpdir(),
				`nh-deck-notes-dropped-pdf-test-${randomUUID()}.md`,
			);
			writeFileSync(
				tempFile,
				"# Slide\n\nBody text.\n\n<!-- remember to smile -->\n",
			);
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-notes-dropped-pdf-test-${randomUUID()}.pdf`,
			);

			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "pdf", tempFile, outputPath],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

			expect(stderr).toContain(NOTES_DROPPED_TEXT);

			rmSync(tempFile, { force: true });
			rmSync(outputPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"pdf: does not write the notes-dropped note for a deck with zero presenter notes",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-notes-dropped-none-pdf-test-${randomUUID()}.pdf`,
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

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

			expect(stderr).not.toContain(NOTES_DROPPED_TEXT);

			rmSync(outputPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"pdf: does not write the notes-dropped note for a deck with a presenter note when --with-notes is passed",
		async () => {
			const tempFile = path.join(
				tmpdir(),
				`nh-deck-notes-included-pdf-test-${randomUUID()}.md`,
			);
			writeFileSync(
				tempFile,
				"# Slide\n\nBody text.\n\n<!-- remember to smile -->\n",
			);
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-notes-included-pdf-test-${randomUUID()}.pdf`,
			);

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"pdf",
					tempFile,
					outputPath,
					"--with-notes",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

			expect(stderr).not.toContain(NOTES_DROPPED_TEXT);

			rmSync(tempFile, { force: true });
			rmSync(outputPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"png: writes the notes-dropped note to stderr for a deck with a presenter note, exported without --with-notes",
		async () => {
			const tempFile = path.join(
				tmpdir(),
				`nh-deck-notes-dropped-png-test-${randomUUID()}.md`,
			);
			writeFileSync(
				tempFile,
				"# Slide\n\nBody text.\n\n<!-- remember to smile -->\n",
			);
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-notes-dropped-png-test-${randomUUID()}.png`,
			);
			const firstSlidePath = outputPath.replace(/\.png$/, "-1.png");

			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "png", tempFile, outputPath],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

			expect(stderr).toContain(NOTES_DROPPED_TEXT);

			rmSync(tempFile, { force: true });
			rmSync(firstSlidePath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"png: does not write the notes-dropped note for a deck with zero presenter notes",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-notes-dropped-none-png-test-${randomUUID()}.png`,
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

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

			expect(stderr).not.toContain(NOTES_DROPPED_TEXT);

			for (let n = 1; n <= 6; n++) {
				rmSync(outputPath.replace(/\.png$/, `-${n}.png`), { force: true });
			}
			rmSync(firstSlidePath, { force: true });
			rmSync(secondSlidePath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);
});

describe("CLI: nh-deck pdf --with-notes", () => {
	it(
		"exports a PDF with an extra page for the slide that has a note, and no dropped-notes stderr note",
		async () => {
			const tempFile = path.join(
				tmpdir(),
				`nh-deck-cli-pdf-with-notes-test-${randomUUID()}.md`,
			);
			writeFileSync(
				tempFile,
				"# Slide 1\n\nFirst.\n\n<!-- a note -->\n\n---\n\n# Slide 2\n\nSecond, no note.",
			);
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-cli-pdf-with-notes-test-${randomUUID()}.pdf`,
			);

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"pdf",
					tempFile,
					outputPath,
					"--with-notes",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

			expect(stdout).toContain(`Wrote PDF to ${outputPath}`);
			expect(stderr).not.toContain("presenter notes are not included");

			// 2 real slide pages + 1 extra notes page for slide 1 only.
			const pdfBytes = readFileSync(outputPath);
			const pageCount = (
				pdfBytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []
			).length;
			expect(pageCount).toBe(3);

			rmSync(tempFile, { force: true });
			rmSync(outputPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);
});

describe("CLI: nh-deck png --with-notes", () => {
	it(
		"exports the usual per-slide PNGs plus an additional -notes.png file for the slide that has a note",
		async () => {
			const tempFile = path.join(
				tmpdir(),
				`nh-deck-cli-png-with-notes-test-${randomUUID()}.md`,
			);
			writeFileSync(
				tempFile,
				"# Slide 1\n\nFirst.\n\n<!-- a note -->\n\n---\n\n# Slide 2\n\nSecond, no note.",
			);
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-cli-png-with-notes-test-${randomUUID()}.png`,
			);
			const firstSlidePath = outputPath.replace(/\.png$/, "-1.png");
			const secondSlidePath = outputPath.replace(/\.png$/, "-2.png");
			const notesPath = outputPath.replace(/\.png$/, "-1-notes.png");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"png",
					tempFile,
					outputPath,
					"--with-notes",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

			expect(stdout).toContain("Wrote 3 PNG file(s)");
			expect(stderr).not.toContain("presenter notes are not included");
			expect(existsSync(firstSlidePath)).toBe(true);
			expect(existsSync(secondSlidePath)).toBe(true);
			expect(existsSync(notesPath)).toBe(true);

			rmSync(tempFile, { force: true });
			rmSync(firstSlidePath, { force: true });
			rmSync(secondSlidePath, { force: true });
			rmSync(notesPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
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

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
			if (!url) {
				throw new Error(`Could not extract URL from: ${matchedLine}`);
			}

			const initialBody = await fetchBody(url);
			expect(initialBody).toContain("Original");

			// Delete the watched file right as a change event fires, so the
			// debounced re-render's readFileSync hits ENOENT mid-"save" -- the
			// exact transient-failure shape runWatchedRerender's ENOENT check
			// (src/cliHelpers.ts), wired up from src/index.ts's --watch block,
			// exists to survive.
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

			// This transient, mid-rename ENOENT must stay exactly as silent as
			// it always has been -- no stderr output at all, unlike a genuine
			// render error (see the runWatchedRerender describe block below).
			expect(stderr).toBe("");

			// A subsequent valid save must still be picked up: this proves the
			// watcher/server genuinely survived (retried on the next change
			// event), not merely that it hadn't crashed yet.
			writeFileSync(deckPath, "# Recovered\n");
			await new Promise((resolve) => setTimeout(resolve, 500));

			const recoveredBody = await fetchBody(url);
			expect(recoveredBody).toContain("Recovered");

			// Still silent even after the recovery -- the earlier ENOENT never
			// produced a delayed/queued warning either.
			expect(stderr).toBe("");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(dir, { recursive: true, force: true });
		},
		WATCH_TEST_TIMEOUT_MS,
	);

	it(
		"prints a short stdout note on each successful debounced re-render, naming the changed file",
		async () => {
			const dir = mkdtempSync(
				path.join(tmpdir(), "nh-deck-watch-rebuilt-note-"),
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

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			await waitForServingLine(child, STARTUP_TIMEOUT_MS);
			const rebuiltCount = () =>
				(stdout.match(/nh-deck: rebuilt/g) ?? []).length;

			// Not printed on the initial render -- only on a debounced
			// re-render triggered by an actual file-change event.
			expect(rebuiltCount()).toBe(0);

			writeFileSync(deckPath, "# Changed\n");
			await new Promise((resolve) => setTimeout(resolve, 500));

			expect(rebuiltCount()).toBe(1);
			expect(stdout).toContain(`nh-deck: rebuilt ${deckPath}`);

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
			// The fade transition's own base rule (0.3s ease) must be gone, even
			// though the shared prefers-reduced-motion override (0.2s linear) is
			// present for every transition, "slide" included. Checked via this
			// exact multi-line combo (rather than the bare "transition: opacity
			// 0.3s ease" substring) because FRAGMENT_STYLE's own unconditional
			// body.presenting .fragment rule now legitimately contains that exact
			// same substring for an unrelated feature -- see render.ts's
			// FRAGMENT_STYLE docstring. This combo is unique to the fade
			// transition's own .slide rule.
			expect(updatedBody).not.toContain(
				"pointer-events: none;\n      transition: opacity 0.3s ease;",
			);

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(dir, { recursive: true, force: true });
		},
		WATCH_TEST_TIMEOUT_MS,
	);

	// The three cases below exercise runWatchedRerender (src/cliHelpers.ts)
	// directly rather than through a spawned CLI process. index.ts's --watch
	// block wires this same function up to real readFileSync/generateHtml
	// calls; there is currently no real Markdown/frontmatter input that makes
	// generateHtml (or the frontmatter/theme/transition computation around
	// it) throw for a genuine reason -- parseFrontmatter and
	// resolveThemeName/resolveTransitionName all degrade gracefully instead of
	// throwing, and the one spot generateHtml does throw (a --css-vars file
	// containing a literal "</style") is fixed content read once at startup,
	// not something a watched *deck* file save can trigger. A mocked `render`
	// callback is the reliable way to exercise the "a real render error
	// happened" branch, matching this file's own precedent of importing
	// generateHtml directly (see the top-of-file import) rather than only ever
	// driving behavior through a spawned subprocess.
	describe("runWatchedRerender", () => {
		it("reports success and applies the new HTML when the render step completes", () => {
			const applied: string[] = [];
			const result = runWatchedRerender(
				() => "# still valid markdown",
				(content) => {
					applied.push(content);
				},
			);

			expect(result.status).toBe("success");
			expect(applied).toEqual(["# still valid markdown"]);
		});

		it("classifies an ENOENT read failure as transient, matching today's silent retry", () => {
			const readFile = (): string => {
				const error = new Error(
					"ENOENT: no such file or directory, open 'deck.md'",
				) as NodeJS.ErrnoException;
				error.code = "ENOENT";
				throw error;
			};

			const result = runWatchedRerender(readFile, () => {
				throw new Error(
					"render must not be reached when the read itself failed",
				);
			});

			expect(result.status).toBe("transient");
		});

		it(
			"reports a genuine render-step failure (a mocked generateHtml rejection) as an error, " +
				"without ever applying it",
			() => {
				const applied: string[] = [];
				const renderError = new Error(
					"mocked: a construct generateHtml itself rejects",
				);

				const result = runWatchedRerender(
					() => "# content generateHtml will reject",
					() => {
						// Mirrors index.ts's own shape -- updateHtml(generateHtml(...))
						// -- where a throw from generateHtml means updateHtml's argument
						// never finishes evaluating, so updateHtml is never called at
						// all and the previously-served HTML is left untouched.
						throw renderError;
					},
				);

				expect(result.status).toBe("error");
				expect((result as { status: "error"; error: unknown }).error).toBe(
					renderError,
				);
				expect(applied).toEqual([]);
			},
		);
	});
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

describe("CLI: theme selection — pdf", () => {
	// pdf writes a binary PDF file rather than serving HTML, so unlike the
	// render-command tests above there is no response body to curl for a
	// "--nh-bg: #..." CSS variable. Chromium's print-to-PDF renders a
	// <style> tag's effect (glyph positions, fill colors), not its source
	// text -- see the "custom --css file" pdf test's own comment for the
	// same reasoning. Instead, each test here verifies the same
	// stderr warning/note computeEffectiveTheme() prints on pdf (identical
	// wiring to render, per src/index.ts) plus confirms the export itself
	// still succeeds (exit 0, a real PDF file with the correct magic bytes).

	it(
		"applies a named theme via the --theme flag on the pdf subcommand",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-theme-test-${randomUUID()}.pdf`,
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
					"--theme",
					"dark",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stderr).not.toMatch(/unknown theme/i);
			expect(stdout).toContain(`Wrote PDF to ${outputPath}`);
			expect(existsSync(outputPath)).toBe(true);

			const fileContents = readFileSync(outputPath);
			expect(fileContents.subarray(0, 4).toString("utf8")).toBe("%PDF");

			rmSync(outputPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"applies a deck's own frontmatter theme: value on the pdf subcommand when no --theme flag is given",
		async () => {
			const tempDir = mkdtempSync(
				path.join(tmpdir(), "nh-deck-pdf-theme-frontmatter-"),
			);
			const tempFile = path.join(tempDir, "deck.md");
			writeFileSync(tempFile, "---\ntheme: dracula\n---\n# Slide\n");
			const outputPath = path.join(tempDir, "deck.pdf");

			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "pdf", tempFile, outputPath],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stderr).not.toMatch(/unknown theme/i);
			expect(stdout).toContain(`Wrote PDF to ${outputPath}`);
			expect(existsSync(outputPath)).toBe(true);

			const fileContents = readFileSync(outputPath);
			expect(fileContents.subarray(0, 4).toString("utf8")).toBe("%PDF");

			rmSync(tempDir, { recursive: true, force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"lets --css win over a --theme flag on the pdf subcommand, with a stderr note and a successful export",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-theme-css-test-${randomUUID()}.pdf`,
			);
			const cssPath = path.join(
				tmpdir(),
				`nh-deck-pdf-theme-css-file-test-${randomUUID()}.css`,
			);
			writeFileSync(cssPath, ".slide { color: hotpink; }");

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

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stderr).toContain("nh-deck: note:");
			expect(stderr).toContain("--css overrides the requested theme");
			expect(existsSync(outputPath)).toBe(true);

			const fileContents = readFileSync(outputPath);
			expect(fileContents.subarray(0, 4).toString("utf8")).toBe("%PDF");

			rmSync(outputPath, { force: true });
			rmSync(cssPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"falls back to the default theme with a warning on the pdf subcommand for an unrecognized --theme name",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-theme-unknown-test-${randomUUID()}.pdf`,
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
					"--theme",
					"totally-not-a-theme",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stderr).toMatch(/unknown theme/i);
			expect(stdout).toContain(`Wrote PDF to ${outputPath}`);
			expect(existsSync(outputPath)).toBe(true);

			const fileContents = readFileSync(outputPath);
			expect(fileContents.subarray(0, 4).toString("utf8")).toBe("%PDF");

			rmSync(outputPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);
});

describe("CLI: theme selection — png", () => {
	// Same reasoning as "CLI: theme selection — pdf" above: png writes
	// binary PNG files rather than serving HTML, so each test here verifies
	// the same stderr warning/note plus a successful export (exit 0, a
	// real PNG file with the correct magic bytes) instead of curling a
	// response body.

	it(
		"applies a named theme via the --theme flag on the png subcommand",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-png-theme-test-${randomUUID()}.png`,
			);
			const firstSlidePath = outputPath.replace(/\.png$/, "-1.png");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"png",
					"fixtures/sample.md",
					outputPath,
					"--theme",
					"dark",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stderr).not.toMatch(/unknown theme/i);
			expect(stdout).toContain(
				`Wrote 5 PNG file(s), starting at ${firstSlidePath}`,
			);
			expect(existsSync(firstSlidePath)).toBe(true);

			const fileContents = readFileSync(firstSlidePath);
			expect(fileContents.subarray(0, 8)).toEqual(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			);

			for (let n = 1; n <= 5; n++) {
				rmSync(outputPath.replace(/\.png$/, `-${n}.png`), { force: true });
			}
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"applies a deck's own frontmatter theme: value on the png subcommand when no --theme flag is given",
		async () => {
			const tempDir = mkdtempSync(
				path.join(tmpdir(), "nh-deck-png-theme-frontmatter-"),
			);
			const tempFile = path.join(tempDir, "deck.md");
			writeFileSync(tempFile, "---\ntheme: dracula\n---\n# Slide\n");
			const outputPath = path.join(tempDir, "deck.png");
			const firstSlidePath = outputPath.replace(/\.png$/, "-1.png");

			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "png", tempFile, outputPath],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stderr).not.toMatch(/unknown theme/i);
			expect(stdout).toContain(
				`Wrote 1 PNG file(s), starting at ${firstSlidePath}`,
			);
			expect(existsSync(firstSlidePath)).toBe(true);

			const fileContents = readFileSync(firstSlidePath);
			expect(fileContents.subarray(0, 8)).toEqual(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			);

			rmSync(tempDir, { recursive: true, force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"lets --css win over a --theme flag on the png subcommand, with a stderr note and a successful export",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-png-theme-css-test-${randomUUID()}.png`,
			);
			const firstSlidePath = outputPath.replace(/\.png$/, "-1.png");
			const cssPath = path.join(
				tmpdir(),
				`nh-deck-png-theme-css-file-test-${randomUUID()}.css`,
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

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stderr).toContain("nh-deck: note:");
			expect(stderr).toContain("--css overrides the requested theme");
			expect(existsSync(firstSlidePath)).toBe(true);

			const fileContents = readFileSync(firstSlidePath);
			expect(fileContents.subarray(0, 8)).toEqual(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			);

			for (let n = 1; n <= 5; n++) {
				rmSync(outputPath.replace(/\.png$/, `-${n}.png`), { force: true });
			}
			rmSync(cssPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"falls back to the default theme with a warning on the png subcommand for an unrecognized --theme name",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-png-theme-unknown-test-${randomUUID()}.png`,
			);
			const firstSlidePath = outputPath.replace(/\.png$/, "-1.png");

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"png",
					"fixtures/sample.md",
					outputPath,
					"--theme",
					"totally-not-a-theme",
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stderr).toMatch(/unknown theme/i);
			expect(stdout).toContain(
				`Wrote 5 PNG file(s), starting at ${firstSlidePath}`,
			);
			expect(existsSync(firstSlidePath)).toBe(true);

			const fileContents = readFileSync(firstSlidePath);
			expect(fileContents.subarray(0, 8)).toEqual(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			);

			for (let n = 1; n <= 5; n++) {
				rmSync(outputPath.replace(/\.png$/, `-${n}.png`), { force: true });
			}
		},
		PDF_EXPORT_TIMEOUT_MS,
	);
});

describe("CLI: --css-vars", () => {
	const ACCENT_OVERLAY = ":root { --nh-accent: #ff6600; }";

	it(
		"overlays a --css-vars custom property via the render subcommand",
		async () => {
			const cssVarsPath = path.join(
				tmpdir(),
				`nh-deck-css-vars-test-${randomUUID()}.css`,
			);
			writeFileSync(cssVarsPath, ACCENT_OVERLAY);

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
					"--css-vars",
					cssVarsPath,
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
			expect(body).toContain(ACCENT_OVERLAY);
			// The rest of the baseline stylesheet -- unlike --css's full
			// replacement -- must still be present alongside the overlay.
			expect(body).toContain("font-family: -apple-system");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(cssVarsPath, { force: true });
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"composes --css-vars with a --theme flag: theme colors and the vars overlay both apply",
		async () => {
			const cssVarsPath = path.join(
				tmpdir(),
				`nh-deck-css-vars-theme-test-${randomUUID()}.css`,
			);
			writeFileSync(cssVarsPath, ACCENT_OVERLAY);

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
					"--css-vars",
					cssVarsPath,
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
			// github-dark's bg, per src/themes.ts's THEMES.dark -- proves the
			// theme itself is still fully applied.
			expect(body).toContain("--nh-bg: #0d1117");
			// The --css-vars overlay's own accent value, proving composition
			// rather than one silently overriding the other.
			expect(body).toContain(ACCENT_OVERLAY);
			expect(body.indexOf(ACCENT_OVERLAY)).toBeGreaterThan(
				body.indexOf("--nh-bg: #0d1117"),
			);

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(cssVarsPath, { force: true });
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"lets --css win over --css-vars, with a stderr note and no vars overlay applied",
		async () => {
			const cssPath = path.join(
				tmpdir(),
				`nh-deck-css-vars-conflict-css-test-${randomUUID()}.css`,
			);
			const cssVarsPath = path.join(
				tmpdir(),
				`nh-deck-css-vars-conflict-vars-test-${randomUUID()}.css`,
			);
			writeFileSync(cssPath, ".slide { color: hotpink; }");
			writeFileSync(cssVarsPath, ACCENT_OVERLAY);

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
					"--css-vars",
					cssVarsPath,
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
			expect(body).not.toContain(ACCENT_OVERLAY);
			expect(stderr).toContain("nh-deck: note:");
			expect(stderr).toContain("--css overrides --css-vars");

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
			rmSync(cssPath, { force: true });
			rmSync(cssVarsPath, { force: true });
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"surfaces the raw ENOENT error and exits non-zero when --css-vars points to a nonexistent file",
		async () => {
			// A generated, guaranteed-unique path (never created) rather than a
			// fixed literal like "/path/to/does-not-exist.css" -- an unlucky
			// host where that literal path happens to exist would make render
			// actually start and this test hang waiting for a process exit that
			// never comes, instead of the ENOENT failure it means to test.
			const nonexistentPath = path.join(
				tmpdir(),
				`nh-deck-css-vars-enoent-test-${randomUUID()}.css`,
			);
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
					"--css-vars",
					nonexistentPath,
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

			// Same reasoning/current behavior as the --css ENOENT test above:
			// the top-level try/catch surfaces readFileSync's own ENOENT
			// message verbatim, prefixed with "nh-deck: ".
			expect(stderr).toMatch(/^nh-deck: /);
			expect(stderr).toMatch(/ENOENT/);
			expect(exitCode).toBe(1);
		},
		STARTUP_TIMEOUT_MS,
	);

	it(
		"wires --css-vars onto the pdf subcommand, with a successful export",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-css-vars-test-${randomUUID()}.pdf`,
			);
			const cssVarsPath = path.join(
				tmpdir(),
				`nh-deck-pdf-css-vars-file-test-${randomUUID()}.css`,
			);
			writeFileSync(cssVarsPath, ACCENT_OVERLAY);

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"pdf",
					"fixtures/sample.md",
					outputPath,
					"--css-vars",
					cssVarsPath,
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			expect(stdout).toContain(`Wrote PDF to ${outputPath}`);
			expect(existsSync(outputPath)).toBe(true);

			const fileContents = readFileSync(outputPath);
			expect(fileContents.subarray(0, 4).toString("utf8")).toBe("%PDF");

			rmSync(outputPath, { force: true });
			rmSync(cssVarsPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"lets --css win over --css-vars on the pdf subcommand, with a stderr note and a successful export",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-pdf-css-vars-conflict-test-${randomUUID()}.pdf`,
			);
			const cssPath = path.join(
				tmpdir(),
				`nh-deck-pdf-css-vars-conflict-css-test-${randomUUID()}.css`,
			);
			const cssVarsPath = path.join(
				tmpdir(),
				`nh-deck-pdf-css-vars-conflict-vars-test-${randomUUID()}.css`,
			);
			writeFileSync(cssPath, ".slide { color: hotpink; }");
			writeFileSync(cssVarsPath, ACCENT_OVERLAY);

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
					"--css-vars",
					cssVarsPath,
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

			expect(exitCode).toBe(0);
			expect(stderr).toContain("nh-deck: note:");
			expect(stderr).toContain("--css overrides --css-vars");
			expect(existsSync(outputPath)).toBe(true);

			const fileContents = readFileSync(outputPath);
			expect(fileContents.subarray(0, 4).toString("utf8")).toBe("%PDF");

			rmSync(outputPath, { force: true });
			rmSync(cssPath, { force: true });
			rmSync(cssVarsPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);

	it(
		"wires --css-vars onto the png subcommand, with a successful export",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-png-css-vars-test-${randomUUID()}.png`,
			);
			const firstSlidePath = outputPath.replace(/\.png$/, "-1.png");
			const cssVarsPath = path.join(
				tmpdir(),
				`nh-deck-png-css-vars-file-test-${randomUUID()}.css`,
			);
			writeFileSync(cssVarsPath, ACCENT_OVERLAY);

			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"png",
					"fixtures/sample.md",
					outputPath,
					"--css-vars",
					cssVarsPath,
				],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.once("exit", (code) => resolve(code));
			});

			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			expect(stdout).toContain(
				`Wrote 5 PNG file(s), starting at ${firstSlidePath}`,
			);
			expect(existsSync(firstSlidePath)).toBe(true);

			const fileContents = readFileSync(firstSlidePath);
			expect(fileContents.subarray(0, 8)).toEqual(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			);

			for (let n = 1; n <= 5; n++) {
				rmSync(outputPath.replace(/\.png$/, `-${n}.png`), { force: true });
			}
			rmSync(cssVarsPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
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
			// The fade transition's own base rule (0.3s ease) must be gone, even
			// though the shared prefers-reduced-motion override (0.2s linear) is
			// present for every transition, "slide" included. See the identical
			// comment above (in the --watch describe block) for why this checks
			// the fade-specific multi-line combo rather than the bare substring.
			expect(body).not.toContain(
				"pointer-events: none;\n      transition: opacity 0.3s ease;",
			);

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
			// "pointer-events: none;" (semicolon immediately after "none", no
			// "!important") is the marker checked here: it appears ONLY inside
			// transitionToCssBlock's fade/slide output. render.ts's
			// PRESENTER_VIEW_STYLE also contains "pointer-events: none" but
			// always as "none !important;", so the exact "none;" substring
			// still uniquely identifies the transition feature.
			expect(body).not.toContain("pointer-events: none;");

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
			// See the identical comment on the --css test above for why this
			// checks the "pointer-events: none;" (no "!important") marker.
			expect(body).not.toContain("pointer-events: none;");

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

	it(
		"rejects --transition as an unknown option on the png subcommand",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-png-no-transition-test-${randomUUID()}.png`,
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

// The ANSI escape character, built from its code point rather than a literal
// control character embedded in source (avoids the "unexpected control
// character" lint rule that literal regex/string escapes trigger).
const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_SGR_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, "g");
const GREEN_SGR = `${ANSI_ESCAPE}[32m`;
const RED_SGR = `${ANSI_ESCAPE}[31m`;

/** Strips ANSI SGR escape sequences (the ones node:util's styleText emits). */
function stripAnsi(value: string): string {
	return value.replace(ANSI_SGR_PATTERN, "");
}

describe("CLI: colorized output stays informational-content-equivalent", () => {
	it(
		"prints the serving line with no ANSI codes by default (non-TTY pipe)",
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

			// Capture the full raw stdout (not just the regex-extracted line
			// below) so a leading/trailing ANSI escape wrapped around the
			// matched text would still be visible here.
			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);

			// A spawned child's stdout is a pipe, not a TTY, so styleText must
			// degrade to plain text without any explicit NO_COLOR handling --
			// this is what every other exact-match stdout/stderr assertion in
			// this file already relies on implicitly.
			expect(stdout.includes(ANSI_ESCAPE)).toBe(false);
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
		"colorizes the serving line green under FORCE_COLOR without changing its text",
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
				{ cwd: repoRoot, env: { ...process.env, FORCE_COLOR: "1" } },
			);
			activeChild = child;

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);

			expect(stdout.includes(GREEN_SGR)).toBe(true);
			// The regex-extracted line matches on plain-text boundaries only, so
			// it is already color-free -- this doubles as the "content unchanged
			// by coloring" check.
			const normalized = matchedLine.replace(/:\d+$/, ":<PORT>");
			expect(normalized).toBe(
				"nh-deck serving fixtures/sample.md at http://127.0.0.1:<PORT>",
			);
			// Stripping the raw, ANSI-wrapped stdout must round-trip back to the
			// same plain-text serving line.
			expect(stripAnsi(stdout)).toContain(
				"nh-deck serving fixtures/sample.md at http://127.0.0.1:",
			);

			child.kill();
			await waitForExit(child, EXIT_TIMEOUT_MS);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"colorizes an error message red under FORCE_COLOR without changing its text",
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
				{ cwd: repoRoot, env: { ...process.env, FORCE_COLOR: "1" } },
			);
			activeChild = child;

			let stderr = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.on("exit", resolve);
			});

			expect(exitCode).toBe(1);
			expect(stderr.includes(RED_SGR)).toBe(true);
			expect(stripAnsi(stderr)).toBe(
				"nh-deck: could not find file 'does-not-exist.md'\n",
			);
		},
		EXIT_TIMEOUT_MS + 5_000,
	);

	it(
		"writes the PDF export success line in green under FORCE_COLOR, same text underneath",
		async () => {
			const outputPath = path.join(
				tmpdir(),
				`nh-deck-color-pdf-test-${randomUUID()}.pdf`,
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
				{ cwd: repoRoot, env: { ...process.env, FORCE_COLOR: "1" } },
			);
			activeChild = child;

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.on("exit", resolve);
			});

			expect(exitCode).toBe(0);
			expect(stdout.includes(GREEN_SGR)).toBe(true);
			expect(stripAnsi(stdout)).toContain(`Wrote PDF to ${outputPath}`);

			rmSync(outputPath, { force: true });
		},
		PDF_EXPORT_TIMEOUT_MS,
	);
});

describe("CLI: showHelpAfterError / showSuggestionAfterError wiring", () => {
	it(
		"suggests the closest subcommand and prints help after an unknown command",
		async () => {
			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "rendr", "fixtures/sample.md"],
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

			expect(exitCode).toBe(1);
			expect(stderr).toMatch(/unknown command 'rendr'/);
			// showSuggestionAfterError()
			expect(stderr).toMatch(/Did you mean render\?/);
			// showHelpAfterError() -- off by default in commander, so this line
			// only appears because index.ts explicitly opts in.
			expect(stderr).toMatch(/Usage: nh-deck/);
		},
		EXIT_TIMEOUT_MS + 5_000,
	);

	it(
		"suggests the closest flag and prints subcommand help after an unknown option",
		async () => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"tsx",
					"src/index.ts",
					"render",
					"fixtures/sample.md",
					"--wach",
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

			expect(exitCode).toBe(1);
			expect(stderr).toMatch(/unknown option '--wach'/);
			expect(stderr).toMatch(/Did you mean --watch\?/);
			expect(stderr).toMatch(/Usage: nh-deck render/);
		},
		EXIT_TIMEOUT_MS + 5_000,
	);
});

describe("CLI: --version", () => {
	it(
		"reports package.json's own version, not a stale hardcoded string (regression: --version reported 0.1.0 through the entire 1.0.0 release)",
		async () => {
			const packageJson = JSON.parse(
				readFileSync(path.join(repoRoot, "package.json"), "utf8"),
			) as { version: string };

			const child = spawn(
				process.execPath,
				["--import", "tsx", "src/index.ts", "--version"],
				{ cwd: repoRoot },
			);
			activeChild = child;

			let stdout = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			const exitCode = await new Promise<number | null>((resolve) => {
				child.on("exit", resolve);
			});

			expect(exitCode).toBe(0);
			expect(stdout.trim()).toBe(packageJson.version);
		},
		EXIT_TIMEOUT_MS + 5_000,
	);
});
