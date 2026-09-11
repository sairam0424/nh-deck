# Tech Stack — nh-deck

Fast-lookup inventory of every technology choice in this repo, why it was
made, and how to keep it current. This file describes **nh-deck only**; it
does not restate or duplicate the umbrella-level tech.md that lives at
`../Not-Humans-Lab/` — see "Inherited constraints" below for the one item
that flows down from there.

nh-deck is a local-first CLI for writing, presenting, and exporting
Markdown-based slide decks. Every choice below is made in service of one
non-negotiable constraint: **the CLI never phones home, and rendered
HTML must not depend on any CDN for correctness.**

## Stack summary

| Layer | Technology | Role |
|---|---|---|
| Language / runtime | TypeScript on Node.js (LTS 20/22+) | The entire CLI, render module, dev server, and PDF export module |
| CLI surface | Commander.js | Parses `nh-deck render <file>`, `nh-deck pdf <file>`, and future subcommands |
| Markdown → HTML | `marked` | Converts a deck's Markdown source into an HTML string |
| Math rendering | KaTeX | **Adopted** — inline/block LaTeX math renders with fonts embedded locally as base64, no CDN fallback (see Adoption status) |
| Diagram rendering | Mermaid (`beautiful-mermaid`) | **Adopted** — `mermaid` fenced code blocks render as embedded, CDN-free SVG diagrams (see Adoption status) |
| Local dev server | `node:http` (no framework) | Serves rendered HTML on an ephemeral local port for `nh-deck render` |
| PDF export | `puppeteer-core` + `chrome-launcher` | Detects a local Chrome-family browser and prints the rendered HTML to PDF |
| Build | `tsc` (transpile-only, no bundler) | Produces `dist/index.js` with a preserved shebang as the npm `bin` entry |
| Test runner | Vitest | Unit + integration tests (see `TESTING.md`) |
| CI | GitHub Actions, multi-OS/multi-Node matrix | Live: `ubuntu-latest`/`macos-14`/`windows-latest` × Node 20/22/latest (9 combinations, `fail-fast: false`). Started as a single `ubuntu-latest` job for the walking skeleton, expanded once that skeleton went green |
| License | Apache-2.0 | Decided at the Not-Humans-Lab umbrella level, applied identically across sibling projects |

## Adoption status

| Technology | Status | Notes |
|---|---|---|
| TypeScript + Node.js LTS 20/22+ | **Adopt** | The whole project's language/runtime. No transpile target below current LTS. |
| Commander.js | **Adopt** | Standard, battle-tested Node CLI framework — handles subcommands, flags (`--no-open`), and `--help` generation without hand-rolled arg parsing. |
| `marked` | **Adopt** | Markdown → HTML conversion. Chosen over `markdown-it`/`remark` for being small, dependency-light, and sufficient for slide-deck-shaped Markdown (headings, lists, code fences, slide separators). |
| `puppeteer-core` + `chrome-launcher` | **Adopt** | PDF export path. `puppeteer-core` (no bundled Chromium download) + `chrome-launcher` (locates an already-installed Chrome/Chromium/Edge/Brave binary) together avoid shipping or downloading a browser binary as part of this CLI. |
| `tsc`-only build | **Adopt** | Explicitly **not** tsup, webpack, or esbuild. See Rationale below. |
| Vitest | **Adopt** | Test runner for unit + integration layers. |
| KaTeX | **Adopt** | Math rendering, shipped. Fonts embedded locally as base64 `data:` URIs, no CDN fallback path at all — verified via a real end-to-end browser check (zero network requests); see `docs/adr/0004-katex-local-embedded-math.md`. |
| Mermaid (`beautiful-mermaid`) | **Adopt** | Diagram rendering, shipped. Chosen for its minimal, DOM-free/Puppeteer-free dependency tree (`elkjs` + `entities` only). Its own generated SVG output was found to contain a hardcoded Google Fonts CDN `@import` — a real anti-pattern, not hypothetical — which is stripped before embedding; see `docs/adr/0005-mermaid-local-cdn-import-stripped.md`. |
| Playwright | **Hold — rejected** | See Rationale below. |
| Express or any web framework | **Hold** | The local dev server is a plain `node:http` server on purpose — no framework is needed for "serve one rendered HTML string on an ephemeral port." |
| Bundler (esbuild/webpack/tsup/rollup) | **Hold** | No bundler at all — a CLI this small doesn't need one. `tsc` transpile-only is the entire build step. |
| Multi-OS / multi-Node CI matrix | **Adopt** | Live: `ubuntu-latest`/`macos-14`/`windows-latest` × Node 20/22/latest (9 combinations, `fail-fast: false`). Started as a single `ubuntu-latest` job for the walking skeleton, expanded once that skeleton went green. |
| `open` | **Adopt** | Production dependency. Used in `src/index.ts` to open the rendered deck in the user's default browser after `nh-deck render`, unless `--no-open` is passed. |
| `@biomejs/biome` | **Adopt** | Lint + format. Configured via `biome.json`; the CI `Lint` step runs `npm run lint` (`biome ci .`). |
| `tsx` | **Adopt** | Dev dependency. Runs the CLI directly from TypeScript source (`node --import tsx`) in `tests/cli.test.ts`'s integration tests, without requiring a build step first. |

## Rationale (non-obvious choices)

- **`puppeteer-core` + `chrome-launcher`, not full `puppeteer`.** Full
  `puppeteer` bundles its own Chromium download at install time, which is
  exactly the kind of "phones home for a large binary at unpredictable
  times" behavior a local-first CLI should avoid. `puppeteer-core` gives the
  same automation API without the bundled browser; `chrome-launcher`
  supplies the local-detection logic (Chrome, Chromium, Edge, or Brave)
  needed to drive it against a browser the user already has installed.
- **Playwright explicitly rejected, not merely unconsidered.** Playwright's
  own browser management (`playwright-chromium`, or `npx playwright
  install`) maintains a *separate* browser cache/download path from
  `chrome-launcher`'s local-detection approach. Running both strategies in
  one project means two independent "which Chromium am I actually driving"
  answers that can silently diverge (different versions, different install
  locations, double the disk footprint for browser binaries). Since
  `puppeteer-core` + `chrome-launcher` already satisfies the PDF-export
  requirement without any bundled/downloaded browser, adding Playwright
  alongside it would be redundant tooling with a real conflict risk, not a
  neutral second option.
- **`tsc`-only build, no bundler.** A CLI tool with a handful of
  source files doesn't need tree-shaking, code-splitting, or a bundler's
  build-time complexity. Plain `tsc` transpile emits `dist/index.js` with
  the shebang preserved, which is all an npm `bin` entry needs.
- **Plain `node:http`, no Express.** The local dev server's entire job is:
  serve one already-rendered HTML string on an ephemeral port, optionally
  open a browser. That does not need routing, middleware, or templating —
  pulling in a web framework for it would be scope creep against KISS/YAGNI.
- **KaTeX and Mermaid both shipped local-only, not silently dropped.**
  Both are real, intentional parts of the feature set, and both confirm
  the local-first constraint is actively enforced, not just aspirational.
  KaTeX ships its own fonts embedded as base64 `data:` URIs, no CDN
  fallback path at all. Mermaid's chosen library (`beautiful-mermaid`)
  had its own default output tried to fetch a Google Fonts CDN font, and
  that was found and stripped before shipping rather than accepted as a
  shortcut. Any future rendering feature must meet the same bar.

## Version & upgrade policy

- **Node.js**: track current LTS (20.x or 22.x at time of writing). Bump the
  CI workflow's `node-version`, the `engines` field in `package.json`, and
  the `tsc` target together.
- **TypeScript**: track latest stable minor via normal dependency update
  flow; avoid pinning an exact patch.
- **Commander.js, `marked`, `puppeteer-core`, `chrome-launcher`, Vitest**:
  track latest stable minor/patch via normal update flow (Dependabot or
  manual `npm update`); apply standard semver caution on majors, especially
  for `puppeteer-core` (API surface can shift between major versions).
- **Mermaid (`beautiful-mermaid`)**: pinned at `^1.1.3` as of this adoption.
- **KaTeX / `marked-katex-extension`**: pinned at `^0.18.7` / `^5.1.12` as of this adoption.

## Constraints

- The CLI must never make a network call for its own correctness — no
  telemetry, no update-checks, no remote config fetch.
- Rendered HTML output must be fully self-contained for correctness: no
  required CDN `<script>`/`<link>` tag. KaTeX ships fonts embedded as
  base64 `data:` URIs; Mermaid ships local/bundled SVG output, with a real
  CDN font reference found and stripped rather than shipped. Any future
  rendering feature must meet the same bar.
- PDF export must never bundle or auto-download a Chromium binary — it must
  detect and use a locally installed Chrome-family browser, and fail with a
  clear, non-crashing error message if none is found.
- No bundler may be introduced for the CLI build — `tsc` transpile-only is
  the ceiling, not a starting point to build up from.

## Deprecated / Hold list

- **Playwright** — Hold/rejected. See Rationale above (browser-cache
  conflict with `puppeteer-core` in the same project).
- **Any bundler** (esbuild/webpack/tsup/rollup) — Hold. No build step beyond
  `tsc` exists or is planned.
- **Express or any Node web framework** — Hold. The dev server is plain
  `node:http`.
- **Full `puppeteer` (with bundled Chromium)** — Hold. `puppeteer-core`
  (no bundled browser) is the adopted variant.
- Neither KaTeX nor Mermaid appear here — both shipped; see Adoption status.

## Local dev requirements

- Node.js LTS 20 or 22+ installed.
- A local Chrome, Chromium, Edge, or Brave binary installed, for exercising
  the `nh-deck pdf` path during development (not required for `nh-deck
  render`).
- `npm install` at the repo root.
- `npm run build` (wraps `tsc`) to produce `dist/index.js`.
- `npm test` (wraps `vitest run`) to run the test suite locally before
  opening a PR.
- No database, no external service, and no network access needed to
  develop, render, serve, or export decks — this is the local-first
  constraint applied to the dev loop itself, not just the shipped product.

## Inherited constraints (from the Not-Humans-Lab umbrella)

- **License: Apache-2.0.** Decided once at the system level and applied
  identically across all three sibling projects (`daily-dose`, `nh-deck`,
  `nh-skills`): "explicit patent grant matters more for enterprise adoption
  than MIT's silence on patents; consistency across all three signals a
  deliberate choice to reviewers." See `../Not-Humans-Lab/decisions.md` for
  the full system-wide rationale — not duplicated here.
