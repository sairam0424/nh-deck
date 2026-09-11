import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidArgumentError } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	closeWatcherOnServerClose,
	debounce,
	parsePort,
	resolveOutputPath,
	watchFileForChanges,
} from "../src/cliHelpers.js";
import { startServer } from "../src/server.js";

/**
 * Calls `action(attempt)`, then polls `mock` until it has been called at
 * least once. If no call arrives within `windowMs`, retries with a fresh
 * `action(attempt + 1)` rather than just waiting longer.
 *
 * fs.watch is documented by Node as not 100% consistent across platforms
 * (https://nodejs.org/api/fs.html#caveats), and verified directly on this
 * machine: roughly 1-in-5 to 1-in-9 runs see the underlying OS-level event
 * genuinely dropped rather than merely delayed — reproducible even in
 * complete isolation with no other load. A longer single wait does not
 * help a dropped event; retrying the trigger does. `action` must be
 * idempotent-safe to call multiple times (e.g. write new content, or
 * rename a freshly-created temp file each attempt) since a prior attempt
 * may have already succeeded at the filesystem level even though its
 * watch event never fired.
 */
async function waitForCallWithRetry(
	mock: ReturnType<typeof vi.fn>,
	action: (attempt: number) => void,
	{ windowMs = 1_500, maxAttempts = 5 } = {},
): Promise<void> {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		action(attempt);
		const deadline = Date.now() + windowMs;
		while (mock.mock.calls.length === 0 && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 20));
		}
		if (mock.mock.calls.length > 0) {
			return;
		}
	}
	throw new Error(
		`Timed out waiting for the watcher callback to fire after ${maxAttempts} attempts.`,
	);
}

describe("parsePort", () => {
	it("accepts valid integer ports, including the boundaries", () => {
		expect(parsePort("0")).toBe(0);
		expect(parsePort("65535")).toBe(65535);
		expect(parsePort("3000")).toBe(3000);
	});

	it("rejects non-numeric input", () => {
		expect(() => parsePort("abc")).toThrow(InvalidArgumentError);
	});

	it("rejects negative numbers", () => {
		expect(() => parsePort("-1")).toThrow(InvalidArgumentError);
	});

	it("rejects numbers above the valid port range", () => {
		expect(() => parsePort("65536")).toThrow(InvalidArgumentError);
	});

	it("rejects non-integer numbers", () => {
		expect(() => parsePort("3000.5")).toThrow(InvalidArgumentError);
	});
});

describe("resolveOutputPath", () => {
	it("replaces a .md extension with .pdf when no output is given", () => {
		expect(resolveOutputPath("deck.md")).toBe("deck.pdf");
	});

	it("appends .pdf instead of no-op'ing when the input has no .md suffix", () => {
		expect(resolveOutputPath("deck")).toBe("deck.pdf");
		expect(resolveOutputPath("deck.markdown")).toBe("deck.markdown.pdf");
	});

	it("uses the explicit output path when one is given", () => {
		expect(resolveOutputPath("deck.md", "custom-name.pdf")).toBe(
			"custom-name.pdf",
		);
	});

	it("refuses to resolve to the same path as the input file", () => {
		expect(() => resolveOutputPath("deck.md", "deck.md")).toThrow(
			/Refusing to overwrite the source file/,
		);
	});

	it("derives a .png path when an extension is explicitly given", () => {
		expect(resolveOutputPath("deck.md", undefined, "png")).toBe("deck.png");
	});

	it("still defaults to .pdf when no extension is given (backward compatibility)", () => {
		expect(resolveOutputPath("deck.md")).toBe("deck.pdf");
	});
});

describe("debounce", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("collapses rapid-fire calls into a single invocation after the delay", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced();
		debounced();
		debounced();

		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("passes through only the latest call's arguments", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 50);

		debounced("first");
		debounced("second");
		vi.advanceTimersByTime(50);

		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith("second");
	});

	it("does not fire before the delay has elapsed", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced();
		vi.advanceTimersByTime(99);

		expect(fn).not.toHaveBeenCalled();
	});

	it("fires again for a call made after a previous debounced call already resolved", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced();
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);

		debounced();
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(2);
	});
});

describe("watchFileForChanges", () => {
	let dir: string;
	let filePath: string;
	let watcher: ReturnType<typeof watchFileForChanges> | undefined;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "nh-deck-watch-test-"));
		filePath = join(dir, "deck.md");
		writeFileSync(filePath, "# v1\n");
	});

	afterEach(() => {
		watcher?.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("fires onChange for a plain in-place (same-inode) write", async () => {
		const onChange = vi.fn();
		watcher = watchFileForChanges(filePath, onChange);

		await waitForCallWithRetry(onChange, (attempt) =>
			writeFileSync(filePath, `# v${attempt + 2}\n`),
		);

		expect(onChange).toHaveBeenCalled();
	}, 15_000);

	it("keeps firing onChange across multiple consecutive atomic-save renames", async () => {
		// Reproduces the "editor atomic save" pattern used by Vim/Neovim and
		// many "safe write" editors/IDEs: write to a temp file, then rename
		// it over the target. A file-path-based fs.watch(file, ...) only
		// survives the FIRST such rename; every subsequent one silently
		// stops firing, forever, for the rest of the process's life —
		// confirmed live against the real CLI. This test fails on that old
		// behavior after the second rename.
		const onChange = vi.fn();
		watcher = watchFileForChanges(filePath, onChange);

		for (let i = 0; i < 3; i++) {
			onChange.mockClear();

			await waitForCallWithRetry(onChange, (attempt) => {
				const tempPath = `${filePath}.tmp-${i}-${attempt}`;
				writeFileSync(tempPath, `# atomic save ${i} attempt ${attempt}\n`);
				renameSync(tempPath, filePath);
			});

			expect(onChange).toHaveBeenCalled();
		}
	}, 30_000);

	it("ignores changes to unrelated files in the same directory", async () => {
		const onChange = vi.fn();
		watcher = watchFileForChanges(filePath, onChange);

		// Establishing a directory watch on macOS can replay a one-time
		// "phantom" event for the target file that was created moments before
		// the watch existed (verified directly: fs.watch on a freshly
		// mkdtemp'd directory containing an already-written file reliably
		// reports one rename event for that file shortly after the watch
		// starts, even though nothing new happened to it). Drain that expected
		// initial event and reset the mock before asserting on a genuinely new,
		// unrelated change, so this test isn't measuring that platform quirk.
		await new Promise((r) => setTimeout(r, 150));
		onChange.mockClear();

		const unrelatedPath = join(dir, "other.md");
		writeFileSync(unrelatedPath, "# unrelated\n");
		// Give a real fs event a chance to arrive, then confirm none did for
		// this unrelated file.
		await new Promise((r) => setTimeout(r, 300));

		expect(onChange).not.toHaveBeenCalled();
	});
});

describe("closeWatcherOnServerClose", () => {
	it("closes the watcher once the server closes, without exiting the process", async () => {
		const dir = mkdtempSync(join(tmpdir(), "nh-deck-watch-close-test-"));
		const filePath = join(dir, "deck.md");
		writeFileSync(filePath, "# v1\n");

		const { server } = await startServer("<p>x</p>", 0);
		const watcher = watchFileForChanges(filePath, () => {});
		const closeSpy = vi.spyOn(watcher, "close");

		closeWatcherOnServerClose(watcher, server);

		expect(closeSpy).not.toHaveBeenCalled();

		await new Promise<void>((resolve) => server.close(() => resolve()));

		expect(closeSpy).toHaveBeenCalledTimes(1);

		rmSync(dir, { recursive: true, force: true });
	});
});
