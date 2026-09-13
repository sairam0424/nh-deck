#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as nodeUtil from "node:util";
import { Command } from "commander";
import open from "open";
import {
	closeWatcherOnServerClose,
	debounce,
	parsePort,
	resolveOutputPath,
	watchFileForChanges,
} from "./cliHelpers.js";
import { parseFrontmatter } from "./frontmatter.js";
import { exportToPdf } from "./pdfExport.js";
import { exportToPng } from "./pngExport.js";
import { containsUnsafeHtml, generateHtml } from "./render.js";
import { startServer } from "./server.js";
import type { ThemeColors } from "./themes.js";
import { resolveThemeName, THEMES } from "./themes.js";
import type { TransitionName } from "./transitions.js";
import { resolveTransitionName, TRANSITIONS } from "./transitions.js";

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
 * `node:util.styleText` was added in Node 20.12.0 -- this repo's declared
 * `engines.node` floor is `>=20`, which includes earlier 20.x patches where
 * the named export doesn't exist. Accessing it through the namespace import
 * (rather than a static named import) and feature-detecting at call time
 * avoids a load-time crash on those older patches; text is returned
 * unstyled there instead of colorized, which is a fully acceptable
 * degradation for a cosmetic feature.
 */
function style(
	format: Parameters<typeof nodeUtil.styleText>[0],
	text: string,
): string {
	return typeof nodeUtil.styleText === "function"
		? nodeUtil.styleText(format, text)
		: text;
}

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

/**
 * Computes the effective theme colors for a render/pdf/png invocation,
 * handling frontmatter/--theme precedence and --css mutual exclusivity.
 * Pure -- no side effects -- so callers can print any resulting
 * warning/note explicitly (and skip printing it on a silent
 * recomputation, e.g. a --watch debounced re-render, matching this
 * file's existing "warn once, not on every re-render" precedent for
 * UNSAFE_HTML_WARNING). See docs/specs/theme-system-design.md §3.5/§4
 * for the exact precedence rules this implements.
 *
 * Returns colors: undefined when no theme should be applied (customCss
 * given, or nothing was requested).
 */
function computeEffectiveTheme(
	frontmatterTheme: string | undefined,
	flagTheme: string | undefined,
	customCss: string | undefined,
): { colors: ThemeColors | undefined; message?: string } {
	const requested = flagTheme ?? frontmatterTheme;

	if (customCss) {
		if (requested) {
			return {
				colors: undefined,
				message: `nh-deck: note: --css overrides the requested theme '${requested}'; it was not applied.\n`,
			};
		}
		return { colors: undefined };
	}

	if (!requested) {
		return { colors: undefined };
	}

	const { name, warning } = resolveThemeName(requested);
	return {
		colors: THEMES[name].colors,
		message: warning ? `${warning}\n` : undefined,
	};
}

/**
 * Computes the effective transition name for a render invocation,
 * handling frontmatter/--transition precedence and --css mutual
 * exclusivity -- mirrors computeEffectiveTheme's exact shape and
 * precedence rules. Pure -- no side effects -- so callers can print any
 * resulting warning/note explicitly and skip printing it on a silent
 * recomputation (a --watch debounced re-render), matching this file's
 * "warn once, not on every re-render" precedent.
 */
function computeEffectiveTransition(
	frontmatterTransition: string | undefined,
	flagTransition: string | undefined,
	customCss: string | undefined,
): { name: TransitionName | undefined; message?: string } {
	const requested = flagTransition ?? frontmatterTransition;

	if (customCss) {
		if (requested) {
			return {
				name: undefined,
				message: `nh-deck: note: --css overrides the requested transition '${requested}'; it was not applied.\n`,
			};
		}
		return { name: undefined };
	}

	if (!requested) {
		return { name: undefined };
	}

	const { name, warning } = resolveTransitionName(requested);
	return {
		name,
		message: warning ? `${warning}\n` : undefined,
	};
}

// Read directly from package.json rather than a hardcoded string literal --
// this exact CLI shipped `--version` reporting "0.1.0" through the entire
// 1.0.0 release, since a literal is never touched by a version bump unless
// someone remembers to update it separately. dist/index.js's own directory
// is one level below the package root in both the source-build layout
// (dist/../package.json) and the published npm package layout
// (node_modules/nh-deck/dist/../package.json), so this resolves correctly
// in either case.
const packageJson = JSON.parse(
	readFileSync(
		resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
		"utf8",
	),
) as { version: string };

const program = new Command();

program
	.name("nh-deck")
	.description(
		"A local-first CLI for writing, presenting, and exporting Markdown-based slide decks.",
	)
	.version(packageJson.version)
	.showHelpAfterError()
	.showSuggestionAfterError();

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
	.option(
		"--theme <name>",
		`named color theme to apply (${Object.keys(THEMES).join(", ")}); overrides a deck's own frontmatter "theme:" value`,
	)
	.option(
		"--transition <name>",
		`transition effect between slides in presentation mode (${TRANSITIONS.join(", ")}); overrides a deck's own frontmatter "transition:" value`,
	)
	.action(
		async (
			file: string,
			options: {
				open: boolean;
				port?: number;
				watch?: boolean;
				css?: string;
				theme?: string;
				transition?: string;
			},
		) => {
			try {
				const customCss = options.css
					? readFileSync(options.css, "utf8")
					: undefined;
				const rawMarkdown = readFileSync(file, "utf8");
				if (containsUnsafeHtml(rawMarkdown)) {
					process.stderr.write(UNSAFE_HTML_WARNING);
				}
				const { frontmatter, body: markdown } = parseFrontmatter(rawMarkdown);
				const { colors: themeColors, message: themeMessage } =
					computeEffectiveTheme(frontmatter.theme, options.theme, customCss);
				if (themeMessage) {
					process.stderr.write(themeMessage);
				}
				const { name: transitionName, message: transitionMessage } =
					computeEffectiveTransition(
						frontmatter.transition,
						options.transition,
						customCss,
					);
				if (transitionMessage) {
					process.stderr.write(transitionMessage);
				}
				const html = generateHtml(
					markdown,
					file,
					customCss,
					themeColors,
					transitionName,
				);
				const { url, updateHtml, server } = await startServer(
					html,
					options.port,
					{
						watch: options.watch,
					},
				);

				process.stdout.write(
					`${style("green", `nh-deck serving ${file} at ${url}`)}\n`,
				);

				if (options.watch) {
					const rerender = debounce(() => {
						try {
							const updatedRawMarkdown = readFileSync(file, "utf8");
							const { frontmatter: updatedFrontmatter, body: updatedMarkdown } =
								parseFrontmatter(updatedRawMarkdown);
							const { colors: updatedThemeColors } = computeEffectiveTheme(
								updatedFrontmatter.theme,
								options.theme,
								customCss,
							);
							const { name: updatedTransitionName } =
								computeEffectiveTransition(
									updatedFrontmatter.transition,
									options.transition,
									customCss,
								);
							updateHtml(
								generateHtml(
									updatedMarkdown,
									file,
									customCss,
									updatedThemeColors,
									updatedTransitionName,
								),
							);
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
				process.stderr.write(
					`${style("red", formatActionError(error, file))}\n`,
				);
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
	.option(
		"--theme <name>",
		`named color theme to apply (${Object.keys(THEMES).join(", ")}); overrides a deck's own frontmatter "theme:" value`,
	)
	.action(
		async (
			file: string,
			output?: string,
			options?: { css?: string; theme?: string },
		) => {
			try {
				const customCss = options?.css
					? readFileSync(options.css, "utf8")
					: undefined;
				const rawMarkdown = readFileSync(file, "utf8");
				if (containsUnsafeHtml(rawMarkdown)) {
					process.stderr.write(UNSAFE_HTML_WARNING);
				}
				const { frontmatter, body: markdown } = parseFrontmatter(rawMarkdown);
				const { colors: themeColors, message: themeMessage } =
					computeEffectiveTheme(frontmatter.theme, options?.theme, customCss);
				if (themeMessage) {
					process.stderr.write(themeMessage);
				}
				const html = generateHtml(markdown, file, customCss, themeColors);
				const outputPath = resolveOutputPath(file, output);

				await exportToPdf(html, outputPath);
				process.stdout.write(
					`${style("green", `Wrote PDF to ${outputPath}`)}\n`,
				);
			} catch (error) {
				process.stderr.write(
					`${style("red", formatActionError(error, file))}\n`,
				);
				process.exitCode = 1;
			}
		},
	);

program
	.command("png <file> [output]")
	.description("Export a Markdown deck to one PNG per slide.")
	.option(
		"--css <path>",
		"path to a custom CSS file that fully replaces the default stylesheet",
	)
	.option(
		"--theme <name>",
		`named color theme to apply (${Object.keys(THEMES).join(", ")}); overrides a deck's own frontmatter "theme:" value`,
	)
	.action(
		async (
			file: string,
			output?: string,
			options?: { css?: string; theme?: string },
		) => {
			try {
				const customCss = options?.css
					? readFileSync(options.css, "utf8")
					: undefined;
				const rawMarkdown = readFileSync(file, "utf8");
				if (containsUnsafeHtml(rawMarkdown)) {
					process.stderr.write(UNSAFE_HTML_WARNING);
				}
				const { frontmatter, body: markdown } = parseFrontmatter(rawMarkdown);
				const { colors: themeColors, message: themeMessage } =
					computeEffectiveTheme(frontmatter.theme, options?.theme, customCss);
				if (themeMessage) {
					process.stderr.write(themeMessage);
				}
				const html = generateHtml(markdown, file, customCss, themeColors);
				const outputPath = resolveOutputPath(file, output, "png");

				const written = await exportToPng(html, outputPath);
				process.stdout.write(
					`${style(
						"green",
						`Wrote ${written.length} PNG file(s), starting at ${written[0]}`,
					)}\n`,
				);
			} catch (error) {
				process.stderr.write(
					`${style("red", formatActionError(error, file))}\n`,
				);
				process.exitCode = 1;
			}
		},
	);

program.parse();
