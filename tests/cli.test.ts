import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

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
});

describe("CLI: nh-deck render — error handling", () => {
	it(
		"prints a friendly error and exits non-zero when the file does not exist, instead of an unhandled-rejection stack trace",
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

			expect(stderr).toMatch(/^nh-deck: /);
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
});

describe("CLI: nh-deck pdf", () => {
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
});
