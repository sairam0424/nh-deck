import { type FSWatcher, watch as watchPath } from "node:fs";
import type { Server } from "node:http";
import { basename, dirname, extname, resolve } from "node:path";
import { InvalidArgumentError } from "commander";

/**
 * Commander custom option-parser for --port. Validates before the action
 * handler runs at all, so an invalid port never reaches http.Server.listen().
 */
export function parsePort(value: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		throw new InvalidArgumentError(
			"port must be an integer between 0 and 65535.",
		);
	}
	return port;
}

/**
 * Derives the output path for an export command (`pdf`, `png`, ...). If no
 * explicit output is given, replaces a trailing .md with `.${extension}`, or
 * appends `.${extension}` if the input has no .md suffix (never silently
 * returns the unchanged input path). Always guards against the resolved
 * output equalling the resolved input.
 */
export function resolveOutputPath(
	file: string,
	output?: string,
	extension = "pdf",
): string {
	const outputPath =
		output ??
		(extname(file).toLowerCase() === ".md"
			? file.replace(/\.md$/i, `.${extension}`)
			: `${file}.${extension}`);

	if (resolve(outputPath) === resolve(file)) {
		throw new Error(
			`Refusing to overwrite the source file (${file}). Pass a different output path.`,
		);
	}

	return outputPath;
}

/**
 * Wraps fn so rapid-fire calls collapse into a single invocation, delayMs
 * after the last call. Used to smooth out fs.watch's tendency to fire
 * multiple change events for a single logical file save.
 */
export function debounce<Args extends unknown[]>(
	fn: (...args: Args) => void,
	delayMs: number,
): (...args: Args) => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return (...args: Args) => {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => fn(...args), delayMs);
	};
}

/**
 * Watches `file` for changes and invokes `onChange` on every change,
 * surviving "atomic save" editors (Vim/Neovim and other safe-write tools)
 * that save by writing a temp file and renaming it over the target.
 *
 * Watching the file directly (`fs.watch(file, ...)`) ties the watch to that
 * file's *current inode*. The first atomic-save rename swaps the inode at
 * that path out from under the watcher, which silently stops firing for
 * every subsequent save — confirmed live: the watched page freezes on the
 * first renamed content forever after. Watching the containing directory
 * instead and filtering events by basename survives renames, because the
 * directory itself is never replaced.
 */
export function watchFileForChanges(
	file: string,
	onChange: () => void,
): FSWatcher {
	const watchedBasename = basename(file);
	return watchPath(dirname(file), (_eventType, filename) => {
		// Per Node's fs.watch docs, `filename` is not guaranteed to be provided
		// on every platform/event. Treat a missing filename as a possible
		// match rather than silently dropping the event.
		if (filename === null || filename === watchedBasename) {
			onChange();
		}
	});
}

/**
 * Ties an fs watcher's lifetime to an HTTP server's close event, so the
 * watcher is torn down whenever the server closes — not just when the
 * whole process exits. Without this, a caller that calls `server.close()`
 * without exiting the process (a test harness, or a future programmatic
 * use of `startServer`) leaks an open fs.FSWatcher indefinitely.
 */
export function closeWatcherOnServerClose(
	watcher: FSWatcher,
	server: Server,
): void {
	server.on("close", () => {
		watcher.close();
	});
}
