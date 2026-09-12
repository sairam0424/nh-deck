#!/usr/bin/env node
// Type-checks tests/**/*.ts alongside src/**/*.ts.
//
// Why this isn't just `tsc -p tsconfig.json`: tsconfig.json's `rootDir` is
// "src" (required so `npm run build` only ever emits src's compiled output),
// and its `exclude` has always listed "tests" as a result — a file explicitly
// under `include` bypasses `exclude` for glob-matching purposes, but `tests/`
// living outside `rootDir` would fail the build with a rootDir violation if
// it were added to `include`. That combination means `npm run typecheck`
// (plain `tsc --noEmit`, reading the same tsconfig.json) has never actually
// type-checked anything under tests/ — vitest's esbuild-based transform
// doesn't type-check either, so a type error in a test file was previously
// invisible to both `npm test` and `npm run typecheck`.
//
// Passing files explicitly on the tsc command line (rather than via a
// tsconfig `include`) sidesteps the rootDir restriction entirely — tsc only
// enforces rootDir when it discovers files via config-driven globbing — so
// this can safely check src/ and tests/ together without touching the build
// tsconfig or its `rootDir`/`exclude`. File discovery is done by hand (no
// shell globbing) so this also runs identically on Windows, where the
// default `npm run` shell does not expand `*.ts` for external commands.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const require = createRequire(import.meta.url);

function collectTsFiles(dir) {
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectTsFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			files.push(entryPath);
		}
	}
	return files;
}

const files = [
	...collectTsFiles(path.join(repoRoot, "src")),
	...collectTsFiles(path.join(repoRoot, "tests")),
];

// typescript's package.json "exports" map does not list "./bin/tsc" as a
// subpath (only "bin.tsc" -- the npm CLI-binary field, resolved via PATH,
// not Node's module resolution), so require.resolve("typescript/bin/tsc")
// throws ERR_PACKAGE_PATH_NOT_EXPORTED. Resolving "typescript/package.json"
// (which the exports map does list) and reading its own "bin.tsc" field
// gets to the same file without relying on an unexported subpath.
const typescriptPackageJsonPath = require.resolve("typescript/package.json");
const typescriptPackageJson = JSON.parse(
	readFileSync(typescriptPackageJsonPath, "utf8"),
);
const tscBin = path.join(
	path.dirname(typescriptPackageJsonPath),
	typescriptPackageJson.bin.tsc,
);

// Kept in sync by hand with tsconfig.json's compilerOptions (minus
// rootDir/outDir/declaration, which are meaningless for a file-list,
// noEmit invocation like this one).
const args = [
	tscBin,
	// Newer tsc versions error (TS5112) rather than silently ignore
	// tsconfig.json when files are also passed on the command line, which
	// is exactly this script's own file-list-bypasses-rootDir design (see
	// the file header comment) -- --ignoreConfig is tsc's own documented
	// way to confirm that's intentional.
	"--ignoreConfig",
	"--noEmit",
	"--strict",
	"--target",
	"ES2022",
	"--module",
	"NodeNext",
	"--moduleResolution",
	"NodeNext",
	"--esModuleInterop",
	...files,
];

const result = spawnSync(process.execPath, args, {
	cwd: repoRoot,
	stdio: "inherit",
	shell: false,
});

if (result.error) {
	console.error(result.error);
	process.exit(1);
}

process.exit(result.status ?? 1);
