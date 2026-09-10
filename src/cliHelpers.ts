import { extname, resolve } from "node:path";
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
 * Derives the PDF output path for the `pdf` command. If no explicit output
 * is given, replaces a trailing .md with .pdf, or appends .pdf if the input
 * has no .md suffix (never silently returns the unchanged input path).
 * Always guards against the resolved output equalling the resolved input.
 */
export function resolveOutputPath(file: string, output?: string): string {
	const outputPath =
		output ??
		(extname(file) === ".md" ? file.replace(/\.md$/, ".pdf") : `${file}.pdf`);

	if (resolve(outputPath) === resolve(file)) {
		throw new Error(
			`Refusing to overwrite the source file (${file}). Pass a different output path.`,
		);
	}

	return outputPath;
}
