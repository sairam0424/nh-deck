# AGENTS.md — nh-deck

This file follows the vendor-neutral [AGENTS.md](https://agents.md) open specification. It is the operational instruction manual for this repository — what to run, where things live, and what not to do.

## Overview

nh-deck is a local-first CLI for writing, presenting, and exporting Markdown-based slide decks — the author's own version of [arpitbbhayani/deckrun](https://github.com/arpitbbhayani/deckrun). You write a deck as a single Markdown file, render it to HTML, present it via a local dev server with live reload, and export it to PDF. No accounts, no hosting, no multi-user sharing infrastructure: the tool runs entirely on the machine it's invoked from.

nh-deck is one of three independent sibling projects (daily-dose, nh-deck, nh-skills) under the **Not-Humans-Lab** umbrella. Not-Humans-Lab (`../Not-Humans-Lab/`) is a docs-only meta-repo holding cross-cutting system-level decisions (license, branch strategy, testing skeleton). This repo is its own standalone GitHub repository — not nested inside Not-Humans-Lab — and is the source of truth for everything specific to nh-deck. Cross-cutting conventions are linked by relative path, never duplicated:

- License rationale: `../Not-Humans-Lab/decisions.md`
- Branch/commit/PR template: `Branches.md` (copied verbatim from Not-Humans-Lab; canonical source is `../Not-Humans-Lab/Branches.md`)
- Testing skeleton: `../Not-Humans-Lab/TESTING.md`
- System architecture (C4 Level 1): `../Not-Humans-Lab/architecture.md`

## The Local-First Constraint (read this first)

nh-deck never phones home. The CLI makes no outbound network calls in its core render/serve/export path, and the HTML it renders must not depend on any CDN for correctness. This is inherited unmodified from the reference project and is treated as a hard constraint, not a preference — see `SOUL.md` for the full rationale and `CLAUDE.md` for the mechanism that protects it during agent-assisted changes.

## Setup

```bash
npm install
```

Requires Node.js LTS 20 or 22+. No other setup step exists at this project's current size — no database, no external service, no API key.

> On Node 20, `npm install` prints non-fatal `npm warn EBADENGINE` warnings for `puppeteer-core`/`@puppeteer/browsers` (they declare `>=22.12.0`) — this is expected and does not affect functionality; see the Known Gotchas below.

## Build / Test / Run Commands

- **Build**: `npm run build`
  Runs plain `tsc` (no bundler — transpile only, matching the reference project's "no bundler" philosophy). Emits `dist/index.js` (plus the rest of `dist/`) with a preserved shebang, wired as the npm `bin` entry.
- **Test**: `npm test`
  Runs the Vitest suite, including the CLI's own snapshot-test harness for rendered HTML output (see below).
- **Run locally without a global install**: `node dist/index.js <command>` after building, or `npm link` for a global `nh-deck` binary during development.
- **CI**: the full cross-platform matrix (`ubuntu-latest`/`macos-14`/`windows-latest` × Node 20/22/latest, 9 combinations, `fail-fast: false`) runs build + test on every PR, including a real, unmocked PDF-export test on every combination. Started as a single `ubuntu-latest` job for the walking skeleton, expanded once that skeleton went green — see `Context.md` for the history.

## Snapshot Testing (the render-output source of truth)

Rendering correctness is verified with Vitest snapshot tests, not manual inspection. A fixture Markdown deck is rendered to HTML and the output is compared against a committed snapshot; a diff fails the test.

- Fixtures live at repo-root `fixtures/` (not nested under `tests/`); test files live in `tests/` (`render.test.ts` for the pure `generateHtml` unit tests, `cli.test.ts` for the CLI-process integration test). This project does not use Vitest's `toMatchSnapshot()` file-based snapshot mechanism — "snapshot test" here means an assertion against the CLI's own stdout with non-deterministic fields (the OS-assigned port) normalized before comparison, not a committed `__snapshots__/` directory.
- If a rendering change is intentional, update the plain `expect(...).toContain(...)`/`toBe(...)` assertions in `tests/render.test.ts` and `tests/cli.test.ts` directly and review the diff like any other code change — there is no separate snapshot-update command.
- Prefer this harness over ad hoc manual verification (opening the HTML in a browser and eyeballing it) whenever checking rendering output — see `CLAUDE.md` for why this is a Claude-specific instruction, not just a suggestion.

## Code Style

- TypeScript on Node.js, compiled with plain `tsc` — no bundler, no build-time code generation.
- Follow the global coding-style rules already in force for this workspace (KISS, DRY, YAGNI, immutability, descriptive naming, 200-400 lines per file typical).
- CLI surface is built with Commander.js, wired directly in `src/index.ts` — at this project's current size (two subcommands: `render`, `pdf`) there is no `src/commands/` split; revisit only if the subcommand count grows enough to justify it.
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
                               "render" and "pdf" Commander.js subcommands directly
    render.ts                 — generateHtml(markdown, title?): markdown -> self-contained HTML
    htmlEscape.ts               — escapeHtml(value): shared HTML-escaping helper
    mermaidRenderer.ts           — renderMermaidDiagram(code): CDN-free Mermaid SVG, or an escaped error box
    server.ts                  — startServer(html, port?): plain node:http dev server, no framework
    pdfExport.ts                 — exportToPdf(html, outputPath): puppeteer-core + chrome-launcher
  dist/                           — tsc build output (gitignored, npm bin entry lives here)
  fixtures/
    sample.md                      — sample deck used by both render.test.ts and cli.test.ts
  tests/
    render.test.ts                  — Vitest unit tests for generateHtml (pure function)
    cli.test.ts                      — Vitest integration test: spawns the real CLI, asserts on
                                        stdout with the ephemeral port normalized before comparison
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
- Mermaid diagram rendering has **shipped, CDN-free** — see Known Gotchas and `docs/adr/0005-mermaid-local-cdn-import-stripped.md`. KaTeX is **decided but not yet installed** (see Known Gotchas). Do not add it as a dependency without also confirming its assets ship locally rather than via a CDN `<script>` tag — a CDN dependency in rendered output would violate the local-first constraint even for a supposedly "just for math rendering" fast-follow.

## Known Gotchas

- **Mermaid diagrams have shipped; KaTeX math remains deferred, not forgotten.** The reference project (deckrun) supports LaTeX math via KaTeX and diagrams via Mermaid. Mermaid rendering is done — ` ```mermaid ` fenced code blocks render as embedded SVG diagrams via a `marked` renderer override (`src/render.ts`/`src/mermaidRenderer.ts`), with a real Google Fonts CDN `@import` that the chosen library (`beautiful-mermaid`) bakes into its own output found and stripped rather than shipped (see `docs/adr/0005-mermaid-local-cdn-import-stripped.md`). KaTeX remains explicitly deferred on this branch — a documented fast-follow, not a silent gap. Do not quietly work around either's absence/edge cases with a CDN script tag in rendered HTML; that would violate the local-first constraint. See `Context.md` for the roadmap position.
- **No bundler means no code-splitting, no minification, no tree-shaking.** `tsc`-only output is larger and less optimized than a bundled equivalent. This is an intentional tradeoff (see `../Not-Humans-Lab/decisions.md` for the "no bundler" convention this repo follows), not an oversight — do not "fix" it by introducing esbuild/webpack/rollup without a real, demonstrated need.
- **The CI matrix now genuinely exercises cross-platform Chrome/Chromium detection** — `tests/pdfExport.test.ts` runs on all 9 OS/Node combinations, so PDF export's OS-specific binary-detection paths are verified, not just assumed. What's still unverified: visual *fidelity* differences between whichever browser (Chrome/Edge/Brave) `chrome-launcher` happens to detect on a given machine — the matrix proves export works everywhere, not that it looks identical everywhere.
- **`chrome-launcher`'s binary detection is host-dependent.** If no supported browser is installed, PDF export must fail with a clear, actionable error message — not a silent hang or a cryptic Puppeteer stack trace. Any change to the export path should be tested against "no browser found" as an explicit case.
- **`puppeteer-core`'s declared `engines.node` (`>=22.12.0` as of `^25.10.0`) is stricter than this project's own Node 20 support commitment.** `npm install` under Node 20 prints `npm warn EBADENGINE` for `puppeteer-core` and `@puppeteer/browsers` — this repo has no `.npmrc` and `engine-strict` defaults to `false`, so the warning is non-fatal and does not fail `npm install` or CI. Verified live on Node 20.20.2: the full test suite (including the unmocked `tests/pdfExport.test.ts` E2E test) passes unchanged. Tracked as a known, non-blocking drift in `Context.md`'s Open risks rather than silently ignored — do not "fix" it reflexively by bumping `engines.node` to `>=22.12.0` or dropping Node 20 from the CI matrix; both are real functional-support decisions, not warranted by a warning-only, empirically-non-breaking mismatch.
