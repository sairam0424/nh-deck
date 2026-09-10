import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const FONT_FACE_SRC_PATTERN =
	/url\(fonts\/([^)]+\.woff2)\)\s*format\("woff2"\)(?:,url\([^)]+\)\s*format\("(?:woff|truetype)"\))*/g;

let cachedCss: string | undefined;

/**
 * Returns KaTeX's own stylesheet with every @font-face rule's src rewritten
 * to an embedded base64 data URI (woff2 only -- universally supported by
 * modern browsers, and roughly a quarter the size of also including woff
 * and ttf fallbacks). This is what makes math rendering local-first: the
 * fonts KaTeX needs ship inside the rendered HTML document itself, never
 * fetched from a CDN.
 *
 * Memoized: this depends only on the installed `katex` package's own
 * shipped assets, never on user content, so it is computed once per
 * process rather than once per render.
 *
 * Resolution note: this uses `createRequire(import.meta.url).resolve()`
 * rather than `import.meta.resolve()` because Vitest's SSR module runner
 * (v2.1.9, the version this project's test suite runs on) does not
 * implement `import.meta.resolve` and throws
 * `__vite_ssr_import_meta__.resolve is not a function` when it is called
 * from a test-loaded module. `createRequire(...).resolve()` is Node's
 * standard ESM-safe package-path resolution primitive, behaves
 * identically under plain `node` execution and under Vitest, and -- like
 * `import.meta.resolve` -- walks real node_modules resolution rather than
 * assuming a hardcoded relative layout.
 */
export function getEmbeddedKatexCss(): string {
	if (cachedCss !== undefined) {
		return cachedCss;
	}

	const require = createRequire(import.meta.url);
	const cssPath = require.resolve("katex/dist/katex.min.css");
	const css = readFileSync(cssPath, "utf8");
	const fontsDir = path.join(path.dirname(cssPath), "fonts");

	cachedCss = css.replace(FONT_FACE_SRC_PATTERN, (_match, filename: string) => {
		const fontPath = path.join(fontsDir, filename);
		const base64 = readFileSync(fontPath).toString("base64");
		return `url(data:font/woff2;base64,${base64}) format("woff2")`;
	});

	return cachedCss;
}
