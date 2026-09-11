# Codebase Map — nh-deck

A literal, navigable tour of this repo only. This does not cover nh-skills,
daily-dose, or Not-Humans-Lab — each is its own repo/doc set. Reflects the
current on-disk layout — every file listed below already exists in this
repo (verified against `src/`, `tests/`, and `fixtures/` directly).

## Bird's-eye view

```
nh-deck/
├── memory.md                     agent-writable lessons index
├── tech.md                        tech stack inventory
├── architecture.md                this project's own architecture doc
├── codebase_map.md                this file
├── TESTING.md                     this project's test-approach lock-in
├── package.json                   declares dependencies + npm scripts
├── tsconfig.json                  tsc-only build config (no bundler)
├── src/
│   ├── index.ts                   CLI entry — Commander setup, subcommand dispatch (render/pdf/png)
│   ├── render.ts                  generateHtml(markdown, title?, customCss?) -> HTML string, via `marked`
│   ├── htmlEscape.ts              escapeHtml(value) -> string, shared HTML-escaping helper
│   ├── katexAssets.ts             getEmbeddedKatexCss() — KaTeX stylesheet with fonts embedded as base64
│   ├── mermaidRenderer.ts         renderMermaidDiagram(code) — CDN-free Mermaid SVG via `beautiful-mermaid`
│   ├── presenterNotes.ts          extractNotes(tokens) — pulls speaker notes out of HTML-comment tokens
│   ├── server.ts                  local node:http dev server (ephemeral port, --no-open, --watch live reload)
│   ├── cliHelpers.ts              parsePort/resolveOutputPath/debounce/file-watch helpers used by index.ts
│   ├── browserLaunch.ts           detectBrowserExecutable() — shared local Chrome/Chromium/Edge/Brave detection
│   ├── pdfExport.ts               PDF export via puppeteer-core + chrome-launcher
│   └── pngExport.ts               one-PNG-per-slide export via puppeteer-core + chrome-launcher
├── tests/
│   ├── render.test.ts              unit tests for generateHtml
│   ├── cli.test.ts                 integration test: spawns the CLI, asserts stdout
│   ├── cliHelpers.test.ts          unit tests for cliHelpers.ts
│   ├── htmlEscape.test.ts          unit tests for htmlEscape.ts
│   ├── katexAssets.test.ts         unit tests for katexAssets.ts
│   ├── mermaidRenderer.test.ts     unit tests for mermaidRenderer.ts
│   ├── presenterNotes.test.ts      unit tests for presenterNotes.ts
│   ├── server.test.ts              unit tests for server.ts
│   ├── browserLaunch.test.ts       unit tests for browserLaunch.ts
│   ├── pdfExport.test.ts           real, unmocked PDF-export test (runs on all 9 CI OS/Node combinations)
│   ├── pdfExport.noBrowser.test.ts pdfExport's "no local browser found" error path
│   ├── pdfExport.launchFailure.test.ts pdfExport's browser-launch-failure error path
│   ├── pngExport.test.ts           unit tests for exportToPng
│   ├── pngExport.noBrowser.test.ts pngExport's "no local browser found" error path
│   └── pngExport.launchFailure.test.ts pngExport's browser-launch-failure error path
├── fixtures/
│   └── sample.md                   sample deck Markdown used by tests
└── dist/                           GENERATED — build output of `tsc`, do not hand-edit
    └── index.js                     the npm `bin` entry, shebang preserved
```

Note: the packaging/e2e smoke test (`npm pack` + install into a temp dir +
run the binary) is **not** a Vitest spec under `tests/` — it is implemented
directly as a shell step ("Packaging smoke test") inside
`.github/workflows/ci.yml`. There is no `tests/pack.test.ts`.

## Directory-by-directory

| Path | What it is | Notes |
|---|---|---|
| `src/index.ts` | CLI entrypoint. Sets up Commander, defines the `render`, `pdf`, and `png` subcommands and their flags (e.g. `--no-open`, `--watch`, `--css`), and dispatches to `render.ts`, `server.ts`, `pdfExport.ts`, `pngExport.ts`, and `cliHelpers.ts`. | The only file that touches `process.argv` or owns top-level error handling/exit codes. |
| `src/render.ts` | The render module. Exports `generateHtml(markdown, title?): string`, converting a deck's Markdown source into a self-contained HTML string via `marked`. | Pure function, no filesystem or network I/O — this is what makes it the wide base of the test pyramid (see `TESTING.md`). Both KaTeX math (via `marked-katex-extension`) and Mermaid diagram rendering (via a `marked` renderer override) have landed here. |
| `src/htmlEscape.ts` | Shared `escapeHtml(value: string): string` HTML-escaping helper. | Extracted out of `render.ts` so `mermaidRenderer.ts` can reuse it without a circular import. |
| `src/katexAssets.ts` | Exports `getEmbeddedKatexCss(): string` — KaTeX's stylesheet with every `@font-face` rewritten to a base64 `data:` URI, memoized. | No CDN fallback path at all; see `docs/adr/0004-katex-local-embedded-math.md`. |
| `src/mermaidRenderer.ts` | Exports `renderMermaidDiagram(code: string): string` — renders Mermaid source to a CDN-free SVG string via `beautiful-mermaid`, or an escaped error box on invalid syntax. | Strips a real Google Fonts CDN `@import` that `beautiful-mermaid` bakes into its own default output; see `docs/adr/0005-mermaid-local-cdn-import-stripped.md`. |
| `src/server.ts` | The local dev server. A plain `node:http` server (no framework) that serves the rendered HTML on an ephemeral port, prints the serving URL to stdout, and honors `--no-open`. | No routing, no middleware — it serves exactly one already-rendered HTML string per invocation. |
| `src/pdfExport.ts` | The PDF export module. Uses `chrome-launcher` to detect a local Chrome-family browser, then drives it via `puppeteer-core` to print the rendered HTML to a PDF file. | Must fail with a clear, non-crashing error (not a stack-trace crash) if no local browser is found — no auto-download fallback in this skeleton. |
| `src/cliHelpers.ts` | Shared CLI-support helpers: `parsePort` (Commander custom option-parser for `--port`), `resolveOutputPath` (derives a PDF/PNG output path from the input file, guarding against overwriting the source), `debounce`, `watchFileForChanges`, and `closeWatcherOnServerClose`. | `watchFileForChanges` watches the containing directory rather than the file itself, so it survives atomic-save renames (Vim/Neovim and similar editors). |
| `src/browserLaunch.ts` | Exports `detectBrowserExecutable(): string` — detects a local Chrome/Chromium/Edge/Brave install via `chrome-launcher` and returns its path, shared by every export path that needs a local browser. | Throws a clear, descriptive `Error` (not a crash) when no local browser is found; used by both `pdfExport.ts` and `pngExport.ts`. |
| `src/pngExport.ts` | Exports `exportToPng(html, outputPath): Promise<string[]>` — renders the given HTML in a locally-detected browser and screenshots each `<section class="slide">` to its own PNG file. | Depends on `src/browserLaunch.ts` for browser detection; file names are derived by inserting `-N` (1-indexed) before `outputPath`'s extension. |
| `src/presenterNotes.ts` | Exports `extractNotes(tokens: Token[]): string[]` — extracts the trimmed text of every standalone HTML-comment token in a slide's token group, for separate presenter-notes display. | Comments already pass through unmodified into `generateHtml`'s rendered output; this only extracts their text, it doesn't need to hide anything that isn't already hidden. |
| `tests/` | Vitest specs: unit tests for every `src/` module plus an integration test (`cli.test.ts`) that spawns the actual CLI process and asserts on normalized stdout. | Name pattern: `*.test.ts`. Mirrors `src/` structure per the global coding-style convention. See `TESTING.md` for the pyramid ratio. The packaging/e2e smoke test (pack + install + run the binary) is **not** here — it's a shell step in `.github/workflows/ci.yml`. |
| `fixtures/` | Sample Markdown files used as test input (e.g. a minimal deck for `render.test.ts` and `cli.test.ts` to point at). | Not shipped as part of the npm package — dev/test-only. |
| `dist/` | **Generated.** Build output of `tsc` (transpile-only, no bundler). Contains `index.js` with the shebang preserved, which is the npm `bin` entry. | Do not hand-edit anything under `dist/` — it is regenerated by `npm run build` and should be gitignored. |
| `package.json` | Declares dependencies (Commander.js, `marked`, `puppeteer-core`, `chrome-launcher`, `beautiful-mermaid`, `katex`, `marked-katex-extension`) and npm scripts (`build`, `test`, `test:watch`). | Both KaTeX and Mermaid's runtime dependencies are listed here now — see `tech.md`. |
| `tsconfig.json` | `tsc` transpile-only config targeting current Node LTS. | No bundler config exists anywhere in this repo — see `tech.md` Rationale. |
| `memory.md` | Agent-writable accumulated-lessons index. | See its own convention note; near-empty until real history accrues. |
| `tech.md` | Fast-lookup stack inventory for this repo. | — |
| `architecture.md` | This project's own arc42/C4-style architecture doc. | — |
| `TESTING.md` | This project's test-approach lock-in (pyramid shape, required scripts, coverage thresholds). | — |

## "Where do I make change X" index

| I want to... | Go to |
|---|---|
| Add or change a CLI subcommand or flag | `src/index.ts` |
| Change how Markdown becomes HTML (KaTeX math and Mermaid diagrams both already added) | `src/render.ts` |
| Change how the local dev server behaves (port selection, `--no-open`, stdout message) | `src/server.ts` |
| Change how PDF export works (print options, page-count/pagination) | `src/pdfExport.ts` |
| Change how PNG export works (per-slide screenshot, output filename derivation) | `src/pngExport.ts` |
| Change local browser detection (shared by PDF and PNG export) | `src/browserLaunch.ts` |
| Add or adjust a unit test for the render function | `tests/render.test.ts` |
| Add or adjust an integration test against the real CLI process | `tests/cli.test.ts` |
| Add or adjust the packaging/e2e smoke test | `.github/workflows/ci.yml` ("Packaging smoke test" step — not a Vitest spec) |
| Add a new sample deck for tests to use | `fixtures/` |
| Add or bump a dependency | `package.json` (see `tech.md` for what's Adopt vs. Hold before adding anything) |
| Change the build step | `tsconfig.json` (`tsc` only — do not introduce a bundler) |
| Record a lesson learned or decision | `memory.md` (add one index line + a new topic file) |
| Update the stack rationale or adoption status | `tech.md` |
| Update the architecture description | `architecture.md` |
| Update the test-approach lock-in | `TESTING.md` |

## Entry points

- **CLI, from source (dev)**: `node --loader ts-node/esm src/index.ts` or
  equivalent — actual dev-run command is finalized alongside `package.json`
  scripts.
- **CLI, built**: `dist/index.js` (shebang preserved) — the npm `bin` entry,
  produced by `npm run build`.
- **Local render flow**: `nh-deck render <file>` → `src/index.ts` →
  `src/render.ts` → `src/server.ts`. See `architecture.md` Runtime View,
  Flow 1.
- **PDF export flow**: `nh-deck pdf <file>` → `src/index.ts` →
  `src/render.ts` → `src/pdfExport.ts`. See `architecture.md` Runtime View,
  Flow 2.
- **Tests**: `npm test` → `vitest run` against everything under `tests/`.
- **CI**: `.github/workflows/ci.yml` runs a 9-combination matrix (`ubuntu-latest`/`macos-14`/`windows-latest` × Node 20/22/latest, `fail-fast: false`) doing
  typecheck + lint + build + test + a packaging smoke test on every PR — not a single deferred job.

## Cross-module dependency notes

- `src/index.ts` imports `src/render.ts`, `src/server.ts`, `src/pdfExport.ts`,
  `src/pngExport.ts`, and `src/cliHelpers.ts` — it is the only module that
  imports all five.
- `src/render.ts` imports `src/htmlEscape.ts`, `src/katexAssets.ts`,
  `src/mermaidRenderer.ts`, and `src/presenterNotes.ts`. `generateHtml` is
  still independently unit-testable without spinning up a server or a
  browser — none of those four are I/O-bound at call time (the fonts
  `katexAssets.ts` embeds are read once and memoized).
- `src/mermaidRenderer.ts` imports `src/htmlEscape.ts` (to build its escaped
  error-box fallback on invalid Mermaid syntax) — this is why `htmlEscape.ts`
  was extracted out of `render.ts` in the first place, so both modules could
  reuse it without a circular import.
- `src/pdfExport.ts` and `src/pngExport.ts` both import `src/browserLaunch.ts`
  for local Chrome/Chromium/Edge/Brave detection, and neither depends on the
  other; both depend only on the HTML string produced by `src/render.ts`,
  passed in by `src/index.ts`.
- `src/browserLaunch.ts` depends on an external, runtime-detected local
  Chrome-family browser binary (via `chrome-launcher`) — this dependency is
  environmental, not an npm package, and its absence must be handled as a
  clear error, not a crash.
- `src/server.ts`, `src/cliHelpers.ts`, `src/katexAssets.ts`, and
  `src/presenterNotes.ts` have no dependency on any other `src/` module.
- `tests/render.test.ts` depends only on `src/render.ts` and `fixtures/`.
  `tests/cli.test.ts` depends on the built or source CLI entrypoint and
  spawns it as a real process. The packaging/e2e smoke test is not a Vitest
  spec (there is no `tests/pack.test.ts`) — it runs as a shell step in
  `.github/workflows/ci.yml` that packs a real tarball via `npm pack` and
  installs it into a temp dir.
- Nothing in this repo depends on nh-skills, daily-dose, or Not-Humans-Lab —
  those relationships are thematic/lineage only, documented in
  `architecture.md`'s Context & Scope, not wired as code or build
  dependencies.
