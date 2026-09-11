#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import open from "open";
import {
	closeWatcherOnServerClose,
	debounce,
	parsePort,
	resolveOutputPath,
	watchFileForChanges,
} from "./cliHelpers.js";
import { exportToPdf } from "./pdfExport.js";
import { exportToPng } from "./pngExport.js";
import { containsUnsafeHtml, generateHtml } from "./render.js";
import { startServer } from "./server.js";

/**
 * Non-fatal stderr warning printed once, on the first read of a deck's
 * Markdown source, whenever it contains raw HTML that isn't a
 * presenter-note comment (see containsUnsafeHtml in render.ts). Written to
 * stderr rather than stdout so it never contaminates any script/pipeline
 * that consumes this CLI's stdout (e.g. the serving-URL line, the exported
 * file path). Never changes process.exitCode or blocks rendering/export --
 * nh-deck's raw-HTML-passes-through-untouched design (see SECURITY.md) is
 * unchanged; this is only a heads-up for whoever is about to open the
 * result.
 */
const UNSAFE_HTML_WARNING =
	"nh-deck: warning: this deck contains raw HTML, which is rendered as-is (including any <script> tags). Only open decks from sources you trust.\n";

/**
 * Formats a caught action-handler error for `nh-deck: <message>` stderr
 * output. An ENOENT failure reading the input `<file>` argument gets a
 * clean, human-authored message instead of the raw Node.js syscall wording
 * (e.g. "ENOENT: no such file or directory, open '...'"). Every other error
 * — including an ENOENT from a missing --css file — falls through to the
 * generic message unchanged.
 *
 * The path comparison resolves both sides to absolute paths: on Windows,
 * Node's fs errors report an absolute `.path` (e.g. `D:\...\file.md`) even
 * when a relative path was passed in, while POSIX keeps the relative string
 * as-passed -- a raw `===` comparison only matches on POSIX.
 */
function formatActionError(error: unknown, file: string): string {
	const errnoPath = (error as NodeJS.ErrnoException)?.path;
	if (
		error instanceof Error &&
		(error as NodeJS.ErrnoException).code === "ENOENT" &&
		typeof errnoPath === "string" &&
		resolve(errnoPath) === resolve(file)
	) {
		return `nh-deck: could not find file '${file}'`;
	}
	const message = error instanceof Error ? error.message : String(error);
	return `nh-deck: ${message}`;
}

const program = new Command();

program
	.name("nh-deck")
	.description(
		"A local-first CLI for writing, presenting, and exporting Markdown-based slide decks.",
	)
	.version("0.1.0");

program
	.command("render <file>")
	.description("Render a Markdown deck and serve it locally.")
	.option("--no-open", "do not open the deck in the default browser")
	.option("--port <n>", "port to listen on (default: OS-assigned)", parsePort)
	.option(
		"--watch",
		"re-render and auto-refresh the browser when the file changes",
	)
	.option(
		"--css <path>",
		"path to a custom CSS file that fully replaces the default stylesheet",
	)
	.action(
		async (
			file: string,
			options: { open: boolean; port?: number; watch?: boolean; css?: string },
		) => {
			try {
				const customCss = options.css
					? readFileSync(options.css, "utf8")
					: undefined;
				const markdown = readFileSync(file, "utf8");
				if (containsUnsafeHtml(markdown)) {
					process.stderr.write(UNSAFE_HTML_WARNING);
				}
				const html = generateHtml(markdown, file, customCss);
				const { url, updateHtml, server } = await startServer(
					html,
					options.port,
					{
						watch: options.watch,
					},
				);

				process.stdout.write(`nh-deck serving ${file} at ${url}\n`);

				if (options.watch) {
					const rerender = debounce(() => {
						try {
							const updatedMarkdown = readFileSync(file, "utf8");
							updateHtml(generateHtml(updatedMarkdown, file, customCss));
						} catch {
							// A transient read failure (e.g. mid-save) is not fatal — the
							// next file-change event retries.
						}
					}, 100);
					const watcher = watchFileForChanges(file, rerender);
					closeWatcherOnServerClose(watcher, server);
				}

				if (options.open) {
					await open(url);
				}
			} catch (error) {
				process.stderr.write(`${formatActionError(error, file)}\n`);
				process.exitCode = 1;
			}
		},
	);

program
	.command("pdf <file> [output]")
	.description("Export a Markdown deck to PDF.")
	.option(
		"--css <path>",
		"path to a custom CSS file that fully replaces the default stylesheet",
	)
	.action(async (file: string, output?: string, options?: { css?: string }) => {
		try {
			const customCss = options?.css
				? readFileSync(options.css, "utf8")
				: undefined;
			const markdown = readFileSync(file, "utf8");
			if (containsUnsafeHtml(markdown)) {
				process.stderr.write(UNSAFE_HTML_WARNING);
			}
			const html = generateHtml(markdown, file, customCss);
			const outputPath = resolveOutputPath(file, output);

			await exportToPdf(html, outputPath);
			process.stdout.write(`Wrote PDF to ${outputPath}\n`);
		} catch (error) {
			process.stderr.write(`${formatActionError(error, file)}\n`);
			process.exitCode = 1;
		}
	});

program
	.command("png <file> [output]")
	.description("Export a Markdown deck to one PNG per slide.")
	.option(
		"--css <path>",
		"path to a custom CSS file that fully replaces the default stylesheet",
	)
	.action(async (file: string, output?: string, options?: { css?: string }) => {
		try {
			const customCss = options?.css
				? readFileSync(options.css, "utf8")
				: undefined;
			const markdown = readFileSync(file, "utf8");
			if (containsUnsafeHtml(markdown)) {
				process.stderr.write(UNSAFE_HTML_WARNING);
			}
			const html = generateHtml(markdown, file, customCss);
			const outputPath = resolveOutputPath(file, output, "png");

			const written = await exportToPng(html, outputPath);
			process.stdout.write(
				`Wrote ${written.length} PNG file(s), starting at ${written[0]}\n`,
			);
		} catch (error) {
			process.stderr.write(`${formatActionError(error, file)}\n`);
			process.exitCode = 1;
		}
	});

program.parse();
