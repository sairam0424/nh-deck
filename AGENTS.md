# AGENTS.md — nh-deck

This file follows the vendor-neutral [AGENTS.md](https://agents.md) open specification. It is the operational instruction manual for this repository — what to run, where things live, and what not to do.

## Overview

nh-deck is a local-first CLI for writing, presenting, and exporting Markdown-based slide decks. You write a deck as a single Markdown file, render it to HTML, present it via a local dev server with live reload, and export it to PDF. No accounts, no hosting, no multi-user sharing infrastructure: the tool runs entirely on the machine it's invoked from.

nh-deck is one of three independent sibling projects (daily-dose, nh-deck, nh-skills) under the **Not-Humans-Lab** umbrella. Not-Humans-Lab (`../Not-Humans-Lab/`) is a docs-only meta-repo holding cross-cutting system-level decisions (license, branch strategy, testing skeleton). This repo is its own standalone GitHub repository — not nested inside Not-Humans-Lab — and is the source of truth for everything specific to nh-deck. Cross-cutting conventions are linked by relative path, never duplicated:

- License rationale: `../Not-Humans-Lab/decisions.md`
- Branch/commit/PR template: `Branches.md` (copied verbatim from Not-Humans-Lab; canonical source is `../Not-Humans-Lab/Branches.md`)
- Testing skeleton: `../Not-Humans-Lab/TESTING.md`
- System architecture (C4 Level 1): `../Not-Humans-Lab/architecture.md`

## The Local-First Constraint (read this first)

nh-deck never phones home. The CLI makes no outbound network calls in its core render/serve/export path, and the HTML it renders must not depend on any CDN for correctness. This is treated as a hard constraint, not a preference — see `SOUL.md` for the full rationale and `CLAUDE.md` for the mechanism that protects it during agent-assisted changes.

## Setup

```bash
npm install
```

Requires Node.js 22+. No other setup step exists at this project's current size — no database, no external service, no API key.

> Node 20 support was dropped because Node 20 itself reached its upstream end-of-life on 2026-04-30 — not because of a functional break in this project. Before that date, this repo deliberately kept supporting Node 20 despite `puppeteer-core`/`@puppeteer/browsers` declaring a stricter `engines.node` (`>=22.12.0`) than this project's own `>=20`, which only produced a non-fatal `npm warn EBADENGINE` on Node 20 with no observed effect on functionality; see the Known Gotchas below for the full history of that investigation and why Node 20's EOL, not the engine mismatch, is what finally triggered dropping it.

## Build / Test / Run Commands

- **Build**: `npm run build`
  Runs plain `tsc` (no bundler — transpile only). Emits `dist/index.js` (plus the rest of `dist/`) with a preserved shebang, wired as the npm `bin` entry.
- **Test**: `npm test`
  Runs the Vitest suite, including the CLI's own snapshot-test harness for rendered HTML output (see below).
- **Run locally without a global install**: `node dist/index.js <command>` after building, or `npm link` for a global `nh-deck` binary during development.
- **CI**: the full cross-platform matrix (`ubuntu-latest`/`macos-14`/`windows-latest` × Node 22/latest, 6 combinations, `fail-fast: false`) runs build + test on every PR, including a real, unmocked PDF-export test on every combination. Started as a single `ubuntu-latest` job for the walking skeleton, expanded to 9 combinations (Node 20/22/latest) once that skeleton went green, then dropped back to 6 when Node 20 support ended — see `Context.md` for the history.

## Snapshot Testing (the render-output source of truth)

Rendering correctness is verified with Vitest snapshot tests, not manual inspection. A fixture Markdown deck is rendered to HTML and the output is compared against a committed snapshot; a diff fails the test.

- Fixtures live at repo-root `fixtures/` (not nested under `tests/`); test files live in `tests/` (`render.test.ts` for the pure `generateHtml` unit tests, `cli.test.ts` for the CLI-process integration test). This project does not use Vitest's `toMatchSnapshot()` file-based snapshot mechanism — "snapshot test" here means an assertion against the CLI's own stdout with non-deterministic fields (the OS-assigned port) normalized before comparison, not a committed `__snapshots__/` directory.
- If a rendering change is intentional, update the plain `expect(...).toContain(...)`/`toBe(...)` assertions in `tests/render.test.ts` and `tests/cli.test.ts` directly and review the diff like any other code change — there is no separate snapshot-update command.
- Prefer this harness over ad hoc manual verification (opening the HTML in a browser and eyeballing it) whenever checking rendering output — see `CLAUDE.md` for why this is a Claude-specific instruction, not just a suggestion.

## Code Style

- TypeScript on Node.js, compiled with plain `tsc` — no bundler, no build-time code generation.
- Follow the global coding-style rules already in force for this workspace (KISS, DRY, YAGNI, immutability, descriptive naming, 200-400 lines per file typical).
- CLI surface is built with Commander.js, wired directly in `src/index.ts` — at this project's current size (three subcommands: `render`, `pdf`, `png`) there is no `src/commands/` split; revisit only if the subcommand count grows enough to justify it.
- Markdown-to-HTML conversion goes through the `marked` library. Do not hand-roll Markdown parsing.
- PDF export goes through `puppeteer-core` + `chrome-launcher` against a locally-detected Chrome/Chromium/Edge/Brave binary. Never bundle a Chromium binary and never add the full `puppeteer` package (which bundles one) — see Security Notes.

## Directory Map

```
nh-deck/
  AGENTS.md              — this file
  CLAUDE.md                — Claude Code addendum (imports this file)
  SOUL.md                   — behavioral/identity charter (unopinionated rendering, local-first)
  Context.md                 — living state-of-the-world doc
  package.json                 — build/test scripts + dependencies
  tsconfig.json                  — tsc transpile-only config
  src/
    index.ts                — CLI entry point (shebang preserved through build), wires the
                               "render", "pdf", and "png" Commander.js subcommands directly
    cliHelpers.ts              — parsePort/resolveOutputPath/debounce/watchFileForChanges/
                                  closeWatcherOnServerClose: shared --port/--watch/output-path
                                  helpers used by index.ts
    frontmatter.ts               — parseFrontmatter(markdown): splits a deck's optional
                                    "---\nkey: value\n---" frontmatter block from its body,
                                    used for the "theme:" key (falls through untouched on
                                    anything that doesn't parse as flat key:value lines, so a
                                    deck opening with a stylistic "---" horizontal rule is
                                    never misread as frontmatter)
    themes.ts                     — THEMES/DEFAULT_THEME_NAME/resolveThemeName(name): the
                                      fixed 4-theme registry (light/dark/dracula/nord),
                                      re-exporting beautiful-mermaid's own named color palettes
    render.ts                    — generateHtml(markdown, title?, customCss?, themeColors?): markdown -> self-contained HTML
    htmlEscape.ts                  — escapeHtml(value): shared HTML-escaping helper
    katexAssets.ts                   — getEmbeddedKatexCss(): KaTeX's own stylesheet with its
                                        @font-face fonts inlined as base64, so math rendering
                                        stays CDN-free
    mermaidRenderer.ts                 — renderMermaidDiagram(code): CDN-free Mermaid SVG, or an escaped error box
    presenterNotes.ts                    — extractNotes(tokens): pulls presenter-note text out of a
                                            slide's standalone HTML comments
    server.ts                              — startServer(html, port?): plain node:http dev server, no framework
    browserLaunch.ts                         — detectBrowserExecutable(): shared chrome-launcher lookup for a
                                                local Chrome/Chromium/Edge/Brave binary, used by pdfExport.ts
                                                and pngExport.ts
    pdfExport.ts                               — exportToPdf(html, outputPath): puppeteer-core + chrome-launcher
    pngExport.ts                                 — exportToPng(html, outputPath): puppeteer-core + chrome-launcher,
                                                    screenshots each slide to its own PNG
    slideLayouts.ts             — LAYOUTS/resolveLayoutName/extractSlideLayout: the fixed
                                  4-layout registry (title/section/two-column/quote) and
                                  per-slide <!-- layout: name --> marker extraction
    transitions.ts                — TRANSITIONS/resolveTransitionName: the fixed
                                     2-transition registry (fade/slide)
    presentationScript.ts           — PRESENTATION_SCRIPT: client-side one-slide-at-a-time
                                       navigation for the opt-in ?present presentation mode
  dist/                           — tsc build output (gitignored, npm bin entry lives here)
  fixtures/
    sample.md                      — sample deck used by both render.test.ts and cli.test.ts
  tests/
    render.test.ts                  — Vitest unit tests for generateHtml (pure function)
    cli.test.ts                      — Vitest integration test: spawns the real CLI, asserts on
                                        stdout with the ephemeral port normalized before comparison
    cliHelpers.test.ts                — unit tests for parsePort/resolveOutputPath/debounce/
                                         watchFileForChanges, including atomic-save rename survival
    frontmatter.test.ts                 — unit tests for parseFrontmatter, including the
                                           slide-separator-collision fall-through cases
    themes.test.ts                       — unit tests for THEMES/resolveThemeName, including
                                            case-insensitivity and the unknown-name warning/fallback
    htmlEscape.test.ts                  — unit tests for escapeHtml
    katexAssets.test.ts                   — asserts getEmbeddedKatexCss() embeds fonts as base64
                                             data URIs with no CDN or relative fonts/ path left behind
    mermaidRenderer.test.ts                 — asserts renderMermaidDiagram() output is CDN-free
                                               (no @import, no fonts.googleapis.com)
    presenterNotes.test.ts                    — unit tests for extractNotes() against real
                                                 marked() token output
    server.test.ts                              — unit tests for startServer(), including the
                                                   --watch SSE reload path
    browserLaunch.test.ts                         — mocks chrome-launcher to report no
                                                     installation; asserts detectBrowserExecutable()
                                                     throws a clear error
    pdfExport.test.ts                               — real, unmocked end-to-end PDF export test
                                                       (launches an actual local browser)
    pdfExport.noBrowser.test.ts                       — mocks chrome-launcher to report no
                                                         installation; asserts exportToPdf() throws
                                                         a clear error
    pdfExport.launchFailure.test.ts                     — mocks puppeteer-core's launch() to reject;
                                                           asserts exportToPdf() surfaces a clear
                                                           error, not a raw stack trace
    pngExport.test.ts                                     — end-to-end test asserting exportToPng()
                                                             writes one real, non-empty PNG per slide
    pngExport.noBrowser.test.ts                             — mocks chrome-launcher to report no
                                                               installation; asserts exportToPng() throws
                                                               a clear error
    pngExport.launchFailure.test.ts                           — mocks puppeteer-core's launch() to reject;
                                                                 asserts exportToPng() surfaces a clear
                                                                 error, not a raw stack trace
    slideLayouts.test.ts                                         — unit tests for resolveLayoutName/
                                                                    extractSlideLayout, including the
                                                                    presenter-note-collision guard
    transitions.test.ts                                           — unit tests for resolveTransitionName,
                                                                     including the case-insensitive and
                                                                     unknown-name-warning cases
    presentationScript.test.ts                                     — string-assertion tests for
                                                                      PRESENTATION_SCRIPT's contents
                                                                      (present-param gating, keys, hash
                                                                      persistence, link-click exclusion)
    presentationMode.test.ts                                        — real, unmocked browser test for
                                                                       ?present navigation (keyboard/click
                                                                       advance, link-click exclusion, hash
                                                                       persistence across reload)
  .github/workflows/
    ci.yml                             — 9-combination matrix (3 OS x 3 Node versions) build+test+pack-smoke-test job
```

## Commit & PR Conventions

Same template as every sibling project in this suite — see this repo's own `Branches.md` (Conventional Commits, trunk-based/GitHub Flow, squash-merge only, PR required even for solo work), copied verbatim from `../Not-Humans-Lab/Branches.md` since each repo is independent and cannot rely on a cross-repo relative path surviving a standalone clone. Summary:

- Branch naming: `type/scope-slug` (e.g. `feat/deck-pdf-export`, `fix/render-frontmatter-parsing`).
- Commits: [Conventional Commits](https://www.conventionalcommits.org) — required, drives changelog/versioning.
- Every change goes through a PR, even solo. CI (`npm run build && npm test`) must pass before merge.
- Squash-merge only; the squash commit message must itself be a valid Conventional Commit.

## Security Notes

- License: Apache-2.0 (decided once at the Not-Humans-Lab system level, applied identically across daily-dose/nh-deck/nh-skills — see `../Not-Humans-Lab/decisions.md`).
- Never commit secrets, API keys, or credentials. This tool has no accounts and no hosted backend, so this mostly applies to CI tokens and any local `.env` used for development tooling — not to end-user data, since nh-deck never collects any.
- **No runtime network dependency in the core render/serve/export path.** This is the single most important security property this repo has, because it is also the core product promise (local-first, never phones home). See `SOUL.md` for the full non-negotiable and `CLAUDE.md` for the required stop-and-ask gate before any diff that would introduce one.
- **No bundled Chromium.** PDF export uses `puppeteer-core` (no bundled browser binary) plus `chrome-launcher` to detect an already-installed Chrome/Chromium/Edge/Brave on the user's machine. Do not swap in the full `puppeteer` package or add Playwright — both bundle their own browser download step, which is both a larger attack surface and a silent network dependency at `npm install` time.
- KaTeX math and Mermaid diagram rendering have both **shipped, CDN-free** — see Known Gotchas, `docs/adr/0004-katex-local-embedded-math.md`, and `docs/adr/0005-mermaid-local-cdn-import-stripped.md`. Do not add any future rendering dependency without also confirming its assets ship locally rather than via a CDN `<script>` tag — a CDN dependency in rendered output would violate the local-first constraint even for a supposedly "just for X rendering" fast-follow.

## Known Gotchas

- **KaTeX and Mermaid have both shipped, CDN-free.** KaTeX math renders with fonts embedded locally as base64 (see `docs/adr/0004-katex-local-embedded-math.md`); Mermaid rendering is done too — ` ```mermaid ` fenced code blocks render as embedded SVG diagrams via a `marked` renderer override (`src/render.ts`/`src/mermaidRenderer.ts`), with a real Google Fonts CDN `@import` that the chosen library (`beautiful-mermaid`) bakes into its own output found and stripped rather than shipped (see `docs/adr/0005-mermaid-local-cdn-import-stripped.md`). Do not quietly work around any future rendering feature's edge cases with a CDN script tag in rendered HTML; that would violate the local-first constraint. See `Context.md` for the roadmap position.
- **No bundler means no code-splitting, no minification, no tree-shaking.** `tsc`-only output is larger and less optimized than a bundled equivalent. This is an intentional tradeoff (see `../Not-Humans-Lab/decisions.md` for the "no bundler" convention this repo follows), not an oversight — do not "fix" it by introducing esbuild/webpack/rollup without a real, demonstrated need.
- **The CI matrix now genuinely exercises cross-platform Chrome/Chromium detection** — `tests/pdfExport.test.ts` runs on all 9 OS/Node combinations, so PDF export's OS-specific binary-detection paths are verified, not just assumed. What's still unverified: visual *fidelity* differences between whichever browser (Chrome/Edge/Brave) `chrome-launcher` happens to detect on a given machine — the matrix proves export works everywhere, not that it looks identical everywhere.
- **`chrome-launcher`'s binary detection is host-dependent.** If no supported browser is installed, PDF export must fail with a clear, actionable error message — not a silent hang or a cryptic Puppeteer stack trace. Any change to the export path should be tested against "no browser found" as an explicit case.
- **Node 20 support has been dropped (`engines.node` is now `>=22`; the CI matrix runs `[22, latest]`) — because Node 20 itself reached upstream end-of-life on 2026-04-30, not because of the `puppeteer-core` engine mismatch this bullet used to track.** For the record, since this is a real decision with a history, not just a version bump: `puppeteer-core`'s declared `engines.node` (`>=22.12.0` as of `^25.10.0`) was stricter than this project's own prior Node 20 support commitment, and `npm install` under Node 20 printed a non-fatal `npm warn EBADENGINE` for `puppeteer-core`/`@puppeteer/browsers` — this repo has no `.npmrc` and `engine-strict` defaults to `false`, so the warning never failed `npm install` or CI, and the full test suite (including the unmocked `tests/pdfExport.test.ts` E2E test) was verified passing unchanged on Node 20.20.2. At the time, that investigation's ruling was explicitly to keep Node 20 rather than "fix" a warning-only, empirically-non-breaking mismatch — see `Context.md`'s Open risks for that original entry. Node 20's own EOL date is an independent, later trigger that supersedes that ruling: it is a real functional-support decision (the vendor stopped supporting the runtime), not a reflexive response to the engine-mismatch warning.
