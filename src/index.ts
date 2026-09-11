#!/usr/bin/env node
import { readFileSync } from "node:fs";
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
import { generateHtml } from "./render.js";
import { startServer } from "./server.js";

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
				const message = error instanceof Error ? error.message : String(error);
				process.stderr.write(`nh-deck: ${message}\n`);
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
			const html = generateHtml(markdown, file, customCss);
			const outputPath = resolveOutputPath(file, output);

			await exportToPdf(html, outputPath);
			process.stdout.write(`Wrote PDF to ${outputPath}\n`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`nh-deck: ${message}\n`);
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
			const html = generateHtml(markdown, file, customCss);
			const outputPath = resolveOutputPath(file, output, "png");

			const written = await exportToPng(html, outputPath);
			process.stdout.write(
				`Wrote ${written.length} PNG file(s), starting at ${written[0]}\n`,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`nh-deck: ${message}\n`);
			process.exitCode = 1;
		}
	});

program.parse();
