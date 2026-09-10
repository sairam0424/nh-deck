# nh-deck — End-to-End Codebase Index

## 1. Project Overview

**nh-deck** is a local-first, TypeScript/Node.js command-line tool that turns a single Markdown file into a self-contained slide-deck artifact. It has exactly two capabilities: (1) render Markdown to a self-contained HTML document and serve it locally for preview in a browser, and (2) export that same HTML to a PDF file using a locally-installed Chrome-family browser. There is no server backend, no hosting, no accounts, and — as a hard architectural constraint documented across SOUL.md/AGENTS.md/CLAUDE.md — no runtime network dependency anywhere in the render/serve/export path (no CDN scripts, no telemetry, no bundled/downloaded Chromium).

**Invocation** (via the `nh-deck` bin, wired through Commander.js in `src/index.ts`):
- `nh-deck render <file> [--port <n>] [--no-open]` — reads the Markdown file, renders it to HTML, starts a loopback-only (`127.0.0.1`) HTTP server on an OS-assigned or specified port, prints `nh-deck serving <file> at <url>` to stdout, and opens the URL in the OS default browser unless `--no-open` is passed.
- `nh-deck pdf <file> [output]` — reads the Markdown file, renders it to HTML, and exports it to a PDF via `puppeteer-core` driven against a locally detected Chrome/Chromium/Edge/Brave binary (via `chrome-launcher`); default output path is derived by replacing a trailing `.md` with `.pdf`.

**Current phase**: repo self-describes (Context.md, CLAUDE.md, status.md) as a completed "Phase 4 walking skeleton" — the core render/serve/export loop is fully implemented and tested; KaTeX (math), Mermaid (diagrams), themes/templates, and an automatic Chromium-download fallback are explicitly deferred, not built.

**Version**: `package.json` and `src/index.ts`'s `.version("0.1.0")` both say `0.1.0` (kept in sync manually — there is no single source of truth reading one from the other).

## 2. Architecture & Module Map

Four source files, no `src/commands/` split, no bundler — plain `tsc` compiles `src/*.ts` to `dist/*.js` with the shebang preserved for the npm `bin` entry.

### `src/index.ts` — CLI entry point (no exports; side-effect script)
Commander.js wiring only — zero business logic. Defines `program.name("nh-deck").version("0.1.0")` then two subcommands:
- **`render <file>`**: `fs.readFileSync(file, 'utf8')` → `generateHtml(markdown, file)` (the raw file *path* is passed as HTML `<title>`, not a cleaned deck title) → `Number(options.port)` (unvalidated — no NaN/range check) → `startServer(html, port)` → prints `nh-deck serving <file> at <url>` to stdout → `if (options.open) await open(url)` unless `--no-open`. **Has no try/catch** — unlike `pdf`, an ENOENT, a port-bind failure, or an `open()` failure produces a raw unhandled stack trace, not a friendly error.
- **`pdf <file> [output]`**: reads the file, derives `output` via `file.replace(/\.md$/, '.pdf')` (a file with no `.md` suffix silently keeps its original name, risking self-overwrite), calls `exportToPdf(html, output)` wrapped in try/catch → on failure prints `nh-deck: <message>` to stderr and sets `process.exitCode = 1`.

Imports: `node:fs`, `commander` (^12.1.0), `open` (^10.1.0), `./render.js`, `./server.js`, `./pdfExport.js`.

### `src/render.ts` — Markdown → HTML (pure function core)
- **`generateHtml(markdown: string, title?: string): string`** (exported) — `marked.parse(markdown, { async: false })` converts Markdown to an HTML fragment; `title` is escaped (via private `escapeHtml`) and defaulted to `"nh-deck"` if empty/whitespace; both are interpolated into a full `<!DOCTYPE html>` document with an **inlined** `<style>` block (typography, code/pre, blockquotes, tables, images, links, `prefers-color-scheme: dark` variant) — no external `<link>`/`<script>` tags anywhere, satisfying the local-first/no-CDN constraint.
- **`escapeHtml(value: string)`** (private) — escapes `& < > " '` for safe `<title>` interpolation. The `marked` fragment itself is interpolated into the body with **zero sanitization** beyond what `marked` does — an accepted trust boundary since the CLI's only input is the user's own deck.
- 100% synchronous, no I/O, no side effects. Consumed by both CLI subcommands.
- KaTeX/Mermaid support is explicitly documented (JSDoc) as deferred, not wired up.

### `src/server.ts` — local preview server
- **`interface StartedServer { server: http.Server; port: number; url: string; }`**
- **`startServer(html: string, port = 0): Promise<StartedServer>`** (exported) — creates a bare `node:http` server bound exclusively to `127.0.0.1` (never `0.0.0.0`); every request/method/path gets an unconditional `200 text/html` response of the same fixed `html` string (no routing, no 404s, no live-reload despite AGENTS.md's overview line claiming "live reload" — that claim is **false**, see §8). `server.once('error', reject)` converts bind failures (e.g. EADDRINUSE) into a promise rejection instead of a crash. By explicit design, **prints/logs nothing** — the caller owns all user-facing output. Zero dependencies beyond `node:http`.
- Sole consumer: `src/index.ts`'s `render` command.

### `src/pdfExport.ts` — HTML → PDF export
- **`exportToPdf(html: string, outputPath: string): Promise<void>`** (sole export) — `Launcher.getInstallations()` (chrome-launcher) enumerates local Chrome/Chromium/Edge/Brave binaries; if none found, throws a clear, actionable Error (no bundled-Chromium fallback — explicitly documented as planned-but-unimplemented in both a doc comment and the error text). Picks `installations[0]` with **no selection logic** if multiple browsers exist. Launches `puppeteer-core` headless against that executable (this `puppeteer.launch()` call sits **outside** the try/finally, so a launch-time failure propagates as a raw unwrapped error, unlike the carefully-worded "no browser found" case), opens a page, `page.setContent(html, {waitUntil: 'networkidle0'})`, `page.pdf({path: outputPath, format: 'A4', printBackground: true})`. Page close is in `try`; `browser.close()` is in `finally` to guarantee subprocess cleanup even on error. No timeout guard beyond Puppeteer defaults; no validation of `outputPath`/`html` before the (expensive) browser launch.

### Call/data flow through the CLI
```
index.ts (render) → fs.readFileSync → render.ts:generateHtml → server.ts:startServer → stdout print → open.js (optional)
index.ts (pdf)    → fs.readFileSync → render.ts:generateHtml → pdfExport.ts:exportToPdf → try/catch → stderr+exitCode on failure
```
`render.ts` is the only module shared by both commands; `server.ts` and `pdfExport.ts` never call each other or `render.ts` directly — `index.ts` is the sole orchestrator.

## 3. Test Coverage Map

Three test files under `tests/` (Vitest), all passing as of last run.

### `tests/render.test.ts` — unit tests for `generateHtml`
**Covers**: 4 tests against `fixtures/sample.md` — (1) full document structure (DOCTYPE/html tags), (2) heading + fenced-code-block conversion, (3) bullet-list conversion, (4) a 4-item CDN-hostname blacklist check (no `cdn.`, `unpkg.com`, `jsdelivr.net`, `cdnjs.cloudflare.com`).
**Gaps**: title parameter's default-fallback (`"nh-deck"`) and whitespace-trim branch never exercised; `escapeHtml` never exercised (no `& < > "` in any tested title); fixture only contains H1/paragraph/list/code — blockquotes, tables, images, links, ordered/nested lists (all styled by render.ts's CSS) are never rendered by any test; CDN check is a narrow blacklist, not a general external-reference check; no error-path test for malformed/empty Markdown; no KaTeX/Mermaid pass-through regression test.

### `tests/cli.test.ts` — black-box process-level integration test for `render`
**Covers**: single test spawning `node --import tsx src/index.ts render fixtures/sample.md --no-open --port 0` as a real child process; asserts stdout matches the exact `nh-deck serving fixtures/sample.md at http://127.0.0.1:<PORT>` format (port normalized out via regex), then `child.kill()` (SIGTERM) and confirms clean process exit within a timeout. Uses `node --import tsx` deliberately (not `npx tsx`) to avoid a wrapper-process orphan. An `afterEach` SIGKILLs any surviving child as a safety net.
**Gaps**: the `pdf` subcommand has **zero CLI-process-level coverage** (no test spawns `nh-deck pdf`); no CLI-level error-path test for `render` (missing/unreadable file would crash uncaught, since `index.ts`'s render command has no try/catch — unverified); no test ever issues a real HTTP request to the served URL (server.ts's request handler is unit-untested); `--no-open` is hardcoded in the only spawn, so the default open-browser branch is completely untested in either direction; no coverage of invalid `--port` values (NaN/negative/>65535); no coverage of missing required `<file>` arg, `--version`/`--help`; only SIGTERM is exercised, not SIGINT; no back-to-back invocation test.

### `tests/pdfExport.test.ts` — real, unmocked end-to-end PDF export test
**Covers**: single test — renders `fixtures/sample.md` via `generateHtml`, calls the real `exportToPdf()` (genuine chrome-launcher detection + puppeteer-core launch, no mocks) against a `randomUUID`-suffixed tmpdir path, asserts the output file exists and its first 4 bytes equal `%PDF`. 60s custom timeout (`PDF_EXPORT_TIMEOUT_MS`) for cold-start latency. `afterEach` removes the tracked output file.
**Gaps**: the "no browser found" error branch (explicitly flagged as required in AGENTS.md's own Known Gotchas) has **zero test coverage** — architecturally in tension with the file's real-E2E-only philosophy; no test of `browser.close()` running on a mid-export failure; no test of an invalid/unwritable `outputPath`; verification is only a 4-byte magic-number sniff (no page-count/format/printBackground assertion); no test of `installations[0]` selection when multiple browsers exist; single mutable module-level cleanup variable (not a Set) would race if more tests were added.
**Fixture/output tracking, per `.gitignore`**: the test's generated PDF lives outside the repo entirely (a `randomUUID`-suffixed path under the OS tmpdir, deleted by the `afterEach`), so it never touches version control regardless of `.gitignore`. Inside the repo, `.gitignore`'s blanket `*.pdf` rule is paired with a `!fixtures/**/*.pdf` negation specifically to keep any future PDF *fixtures* (inputs, not test-run outputs) tracked under `fixtures/` — but `fixtures/` currently contains only `sample.md`, so that negation is presently inert/future-proofing rather than protecting a real tracked file today. Net effect: no PDF artifact from this test suite is either accidentally committed or accidentally deleted by git tooling; there is simply nothing under `fixtures/` yet for the negation rule to apply to.

### Overall coverage gap
`src/server.ts` and `src/index.ts` have **no dedicated unit test file** — only indirect coverage via `cli.test.ts`'s subprocess integration test.

## 4. Build, Tooling & CI

**npm scripts** (`package.json`): `build` = `tsc` (plain transpile, no bundler, per explicit repo policy), `start` = `node dist/index.js`, `test` = `vitest run` (single-shot, used in CI), `test:watch` = `vitest`. No lint or typecheck script exists as an npm script.

**tsconfig.json**: `target: ES2022`, `module`/`moduleResolution: NodeNext` (required given `package.json`'s `"type": "module"`), `outDir: dist` / `rootDir: src`, `strict: true`, `declaration: false` (deliberate — ships as a CLI binary, not a consumed library), `esModuleInterop: true`. `include: ["src/**/*"]`, `exclude: ["node_modules","dist","tests","fixtures"]`.

**`.gitignore`** (36 lines, standard Node/TypeScript shape): excludes dependency and build artifacts (`node_modules/`, `dist/` — the latter aligning with `package.json`'s `"files": ["dist"]`, which is published to npm on `npm publish` but deliberately never git-tracked as source), log files (`npm-debug.log*`, `yarn-debug.log*`, `yarn-error.log*`, `lerna-debug.log*`, `.pnpm-debug.log*`), test-coverage output (`coverage/`, `.nyc_output/`), secrets (`.env`, `.env.local`, `.env.*.local` — consistent with AGENTS.md/SECURITY.md's no-secrets stance), OS/editor cruft (`.DS_Store`, `Thumbs.db`, `.vscode/`, `.idea/`, `*.swp`, `*.swo`), and generated PDFs via a blanket `*.pdf` rule paired with a `!fixtures/**/*.pdf` negation that re-includes any PDF fixtures placed under `fixtures/` (see §3's `pdfExport.test.ts` discussion for why that negation is currently inert — no PDF fixtures exist yet). Live-verified with `git status`/`git ls-files`/`git check-ignore -v`: every rule resolves and is individually exercised as intended, and the working tree stays clean despite `node_modules/`, `dist/`, and other artifacts existing on disk. The file correctly does **not** ignore the project's many root-level `*.md` docs (`Context.md`, `SOUL.md`, `decisions.md`, etc.), which are intentionally tracked, and has no KaTeX/Mermaid-related ignore rules, consistent with those features being deferred per AGENTS.md's Known Gotchas.

**`engines.node`**: `>=20`.

**CI** (`.github/workflows/ci.yml`): single job `build-and-test`, triggered on push-to-main and PRs, running a **9-combination matrix** (`ubuntu-latest`/`macos-14`/`windows-latest` × Node `20`/`22`/`latest`), `fail-fast: false`. Each combination: checkout → setup-node → `npm install` → `npm run build` → `npx vitest run` (including the real, unmocked PDF export test on every OS) → `npm pack` → a bash "packaging smoke test" that globally installs the packed tarball into a fresh temp dir and asserts `nh-deck --help` prints recognizable usage output. No separate lint/typecheck CI step.

**Lockfile** (`package-lock.json`, lockfileVersion 3): all resolved versions sit inside their declared caret ranges; no `overrides`/`resolutions`. Two benign dependency-tree anomalies: duplicate `esbuild` (0.21.5 via vitest's vite vs 0.28.2 via tsx) and duplicate `is-docker`/`is-wsl` majors (chrome-launcher's chain vs open's chain) — both ordinary npm dedupe artifacts, not defects. Confirmed **absent**: no full `puppeteer` package and no `playwright` package anywhere in the tree — positively verifying the no-bundled-Chromium security constraint.

## 5. Documentation Inventory

This repo has an **unusually large doc-to-code ratio** — roughly 20 root-level/near-root Markdown docs plus one ADR versus 4 source files, 3 test files, and 1 dotfile config (≈250 lines of production code). Each doc's role:

| File | Role |
|---|---|
| `AGENTS.md` | Vendor-neutral operational manual — setup/build/test/run commands, directory map, code style, commit/PR conventions, security notes, known gotchas; top of the doc hierarchy. |
| `CLAUDE.md` | Thin (41-line) Claude-Code-specific behavioral addendum on top of AGENTS.md — verification method, local-first stop-and-ask gate, scope discipline, SOUL.md pointer. |
| `SOUL.md` | Behavioral/identity charter — mission, values, four Non-Negotiables (local-first, no forced theme, no bundled Chromium, no silent scope expansion), decision heuristics, anti-examples, change log. |
| `Context.md` | Living state-of-the-world doc — phase status, tech-stack decisions, architecture summary, roadmap, open risks; meant to be continuously updated. |
| `architecture.md` | arc42/C4-style mid-level architecture doc — system context/scope, 4-module building-block view, 2 runtime flows. |
| `codebase_map.md` | File/directory tour — tree, per-file purpose table, "where do I make change X" index, entry points. |
| `tech.md` | Per-repo technology inventory — Stack summary, Adopt/Assess/Hold status, rationale, constraints, deprecated/hold list. |
| `TESTING.md` | Test-strategy policy doc — pyramid shape, required scripts, coverage policy, non-determinism handling, CI scope. |
| `decisions.md` | Decision-history index — ADR Index table + a 7-entry Lightweight Decisions Log. |
| `docs/adr/0001-adopt-ts-node-cli-with-puppeteer-core-export.md` | The one full ADR: locks in TS/Node CLI, Commander, marked, node:http, puppeteer-core+chrome-launcher, tsc, Vitest. |
| `status.md` | "Living snapshot" — phase/health, Active Specs & Plans, Recent Progress, Upcoming Milestones, Risks & Blockers. |
| `Branches.md` | Git branching/commit/PR/release policy — copied verbatim from the sibling Not-Humans-Lab meta-repo per AGENTS.md's mandate. |
| `agent_learning.md` | Append-only, dated register of AI-agent-behavior corrections (distinct from anti-patterns.md's code-pattern focus). |
| `anti-patterns.md` | Register of recurring **bad code patterns** actually observed in this repo (currently empty template). |
| `memory.md` | Scaffold/index for an agent-writable lessons ledger, modeled on Claude Code's MEMORY.md convention (currently empty — "(none yet)"). |
| `README.md` | User-facing quick-start — what nh-deck is, install/usage, honest limitations list. |
| `SECURITY.md` | Vulnerability-disclosure policy — scope and documented accepted risk trade-offs (unsanitized HTML, localhost-only server, no bundled Chromium). |
| `SUPPORT.md` | General-help triage funnel, defers security concerns to SECURITY.md. |
| `LICENSE` | Unmodified Apache-2.0 text, applied at the Not-Humans-Lab umbrella level. |
| `.gitignore` | Standard Node/TS ignore rules for dependencies, build output, logs, coverage, env files, OS/editor cruft, and generated PDFs (with a fixtures-PDF re-inclusion carve-out); undocumented by name in any of the doc files above despite being load-bearing for the repo's clean-tree discipline (see §4, §8). |
| `Context.md`, `tech.md`, `status.md`, `decisions.md` | (see above — these four plus AGENTS/CLAUDE/SOUL form the doc's own claimed "fixed doc set," though ~13 more files actually exist beyond that claim.) |

## 6. Git & Branch History

Small, linear history on `main`; all commits authored by sairamugge/Sairam Ugge, all dated **2026-09-02**, within a single ~2.5-hour scaffold-then-ship session:

1. **`7f33e0c`** (19:16) — `chore: initial nh-deck scaffold` — 28 files, +5626 lines: full governance-doc set, ADR, `src/index.ts`/`pdfExport.ts`/`render.ts`/`server.ts`, `tests/cli.test.ts`/`render.test.ts`, `.github/workflows/ci.yml`, package files, tsconfig, `.gitignore`, one fixture.
2. **`252515c`** (20:18) — `docs: Phase 7 cross-project reconciliation` — adds `Branches.md`, `agent_learning.md`, `anti-patterns.md`, tweaks `AGENTS.md`.
3. **`1a4fc9e`** (20:26) — `docs: refresh status.md to reflect shipped state` — rewrites `status.md`. `feat/ci-matrix-pdf-test` branched off here.
4. **`f2fded4`** (21:24) — `ci(deck): expand to full 3-OS x Node matrix, add real PDF export test (#1)` — squash-merge of PR #1 (GitHub noreply-email author signature); expands CI to the 9-combination matrix and adds `tests/pdfExport.test.ts`.
5. **`f311dcc`** (21:54, HEAD, tip of both `main` and `origin/main`) — `docs: reconcile status/context after fast-follow shipments` — docs-only follow-up touching `AGENTS.md`, `Context.md`, `README.md`, `SOUL.md`, `TESTING.md`, `decisions.md`, `tech.md`. **Notably does not touch `status.md`**, which is the direct root cause of that file's staleness (see §8).

**Branch state**: local `main` = `f311dcc`, fully in sync with `origin/main` (0 ahead/0 behind), clean working tree. `origin/feat/ci-matrix-pdf-test` (commit `f9abea8`) is a **stale remote branch** — the original (non-squashed) commit on the now-merged feature branch; it is graph-theoretically not an ancestor of `main`, but a byte-for-byte diff against `f2fded4` is empty, confirming this is a normal squash-merge artifact, not lost/diverged work. GitHub did not auto-delete it; safe to delete as housekeeping.

## 7. Dependency List

### Runtime dependencies
| Package | Version (declared/resolved) | Purpose |
|---|---|---|
| `commander` | ^12.1.0 / 12.1.0 | CLI framework — wires the `render` and `pdf` subcommands directly in `src/index.ts`. |
| `marked` | ^13.0.3 / 13.0.3 | Markdown → HTML conversion engine (project rule: never hand-roll Markdown parsing). |
| `open` | ^10.1.0 / 10.2.0 | Opens the rendered deck's URL in the OS default browser after `render` (unless `--no-open`); consistently **under-documented** across tech.md/ADR/decisions.md/codebase_map.md (see §8). |
| `puppeteer-core` | ^23.6.0 / 23.11.1 | Headless-browser automation for PDF export, driven against a host-detected browser — deliberately **not** full `puppeteer` (no bundled Chromium download). |
| `chrome-launcher` | ^1.1.2 / 1.2.1 | Detects installed Chrome/Chromium/Edge/Brave binaries for `puppeteer-core` to drive. |

### Dev dependencies
| Package | Version (declared/resolved) | Purpose |
|---|---|---|
| `typescript` | ^5.6.3 / 5.9.3 | Compiler powering `npm run build` (plain `tsc`, no bundler). |
| `vitest` | ^2.1.3 / 2.1.9 | Test runner for all three `tests/*.test.ts` files. |
| `tsx` | ^4.19.1 / 4.23.13 | esbuild-backed TS execution; used via `node --import tsx` in `tests/cli.test.ts` to run the CLI directly from source without a build step. |
| `@types/node` | ^20.14.0 / 20.19.43 | Node ambient types, deliberately pinned to the 20.x line to match `engines.node`. |

Confirmed **absent** anywhere in the lockfile: full `puppeteer`, `playwright`, and any KaTeX/Mermaid packages — all consistent with documented constraints.

## 8. Known Risks, Gaps, TODOs, and Inconsistencies

### Code-level robustness gaps
- **Asymmetric error handling in `src/index.ts`**: `pdf` has try/catch → stderr + `exitCode=1`; `render` has **none** — a missing file, port-bind failure, or `open()` failure crashes with a raw stack trace.
- **Unvalidated `--port`**: `Number(options.port)` has no NaN/range check before being passed to `http.Server.listen`.
- **`pdf`'s default-output derivation** (`file.replace(/\.md$/, '.pdf')`) silently reuses the input filename when the input has no `.md` suffix (e.g. `deck` → `deck`), risking an attempted overwrite of the source file.
- **`pdfExport.ts`**: `puppeteer.launch()` sits outside the try/finally, so launch-time failures (corrupt binary, permissions, arch mismatch) propagate as raw unwrapped errors, unlike the carefully-worded "no browser found" error. `installations[0]` is chosen with no selection logic across multiple detected browsers. No timeout guard on `setContent`/`pdf` beyond Puppeteer defaults; no validation of `outputPath`/`html` before the (expensive) browser launch.
- **`render.ts`**: `marked`'s HTML fragment output is interpolated into the document with zero sanitization beyond `marked` itself — an accepted trust boundary for a single-user local tool, but a real risk if this function were ever reused for untrusted input. SOUL.md's "no forced visual theme/font" Non-Negotiable is in literal tension with `render.ts` unconditionally injecting a hardcoded `<style>` block (fixed fonts, colors, max-width, auto dark-mode) with **no opt-out mechanism** — SOUL.md never reconciles this baseline-CSS case.

### Test coverage gaps (aggregated from §3)
- `pdf` subcommand has zero CLI-process integration coverage.
- "No browser found" error path in `pdfExport.ts` is completely untested, despite AGENTS.md's own Known Gotchas explicitly requiring it.
- `render`'s error path (missing file) and the default-open-browser branch are both unverified.
- `src/server.ts` and `src/index.ts` have no dedicated unit test files.

### Confirmed documentation-vs-code contradictions
- **`status.md` is stale and directly contradicted** by the live `.github/workflows/ci.yml`: it still describes CI as single-OS/ubuntu-latest with the matrix expansion "Planned, not started," and claims no PDF-export CI smoke test exists — both are false; the 9-combination matrix and `tests/pdfExport.test.ts` are already live. Root cause: commit `f311dcc` reconciled seven other docs but never touched `status.md`.
- **`codebase_map.md` is severely stale**: marks `package.json`, `tsconfig.json`, all four `src/*.ts` files, and two test files as "(planned)/not on disk" when all are fully implemented; invents a nonexistent `tests/pack.test.ts` while omitting the real `tests/pdfExport.test.ts`; documents the wrong `generateHtml` signature (missing `title?`); mis-attributes `--no-open`/stdout-message ownership to `server.ts` when both live in `index.ts`; omits the `open` dependency and `--port` flag; suggests a `ts-node` dev command that doesn't match the installed `tsx` toolchain; and, like every other doc in the repo, never mentions `.gitignore` at all.
- **`AGENTS.md`'s own Directory Map and "Snapshot Testing" section omit `tests/pdfExport.test.ts`**, even though AGENTS.md's own "Known Gotchas" section elsewhere discusses that exact file by name — a partial-edit miss traceable to commit `f311dcc`.
- **`architecture.md`** mis-attributes stdout-printing and `--no-open` handling to `src/server.ts` (contradicting server.ts's own doc comment that it prints nothing); calls sibling project `daily-dose` "planned, not yet built" when it has already shipped a v1.0.0 tag; the printed stdout line is paraphrased inaccurately (missing the `nh-deck ` prefix); `generateHtml`'s documented signature omits the `title?` param (inconsistent with this same repo's own AGENTS.md).
- **`tech.md` self-contradicts internally**: its Stack summary table says CI is single-OS with the matrix "deferred," while its own Adoption status table (18 lines later) correctly says the 9-combination matrix is already "Live."
- **`ADR-0001` and `SECURITY.md`/`SUPPORT.md` reference phantom CLI commands** `nh-deck serve` and `nh-deck export --pdf` that never shipped — the real commands are `render` and `pdf`. The ADR's `--browser <path>` override, called a "confirmed requirement," was also never implemented.
- **`Branches.md`'s "Release Automation" section** claims a merge to main triggers `npm publish` with full semver/changelog automation — none of this is wired up (no publish step in CI, no semantic-release tooling, no CHANGELOG.md, version still pinned at 0.1.0). Its "Protected Main" claim is also currently unenforceable since the repo is private on a free GitHub plan (branch protection returns HTTP 403).
- **`README.md` and `SECURITY.md`** both describe sibling project `daily-dose` as not-yet-existing — it is actually an actively-shipping, v1.0.0-tagged repo.
- **`TESTING.md`'s "exactly one test per layer" framing is stale**: `render.test.ts` has four tests, not one; no Vitest e2e test packs/installs the binary (that only exists as a bash step in CI); `tests/pdfExport.test.ts` doesn't fit any of the three documented pyramid layers.
- **`memory.md` is an empty scaffold** whose own worked example (a "hosted multi-user product" assumption correction) is already a real, dated fact recorded elsewhere (`decisions.md`, `Context.md`) but never promoted into `memory.md` itself — and `codebase_map.md` routes "record a lesson" to `memory.md` when actual practice uses `agent_learning.md` instead, creating ambiguity between three overlapping lesson-ledger files (`memory.md`, `agent_learning.md`, `anti-patterns.md`).
- **AGENTS.md's overview line claims the local dev server supports "live reload"** — `src/server.ts` has no file-watching, websocket, or SSE mechanism; this is false.
- Minor/consistent-but-worth-noting: the `open` npm dependency is real and load-bearing (`--no-open`/`--port` CLI surface) but is **omitted or undercounted** across `tech.md`, `SECURITY.md`, `ADR-0001`, `decisions.md`, and `codebase_map.md`'s dependency lists. Similarly, `.gitignore`'s `*.pdf` blanket-ignore + `!fixtures/**/*.pdf` negation is not mentioned in any doc (not even `TESTING.md` or `codebase_map.md`, both of which discuss `fixtures/` and PDF test output directly) — a small but real documentation gap given it governs exactly the artifacts those two docs care about.

### Non-doc housekeeping
- Stale remote branch `origin/feat/ci-matrix-pdf-test` should be deleted (content is fully captured in `main`, empty diff confirmed).
- No lint or typecheck script/CI step exists despite the repo's general quality-conscious posture.

## 9. Suggested Next Steps

1. **Fix `render`'s missing error handling in `src/index.ts`** to match `pdf`'s try/catch pattern, and add validation for `--port` (reject NaN/out-of-range values with a clear message).
2. **Add the two explicitly-flagged missing test cases**: a `pdfExport.ts` "no browser found" test (likely via a thin mock seam, even if it requires relaxing the file's real-E2E-only philosophy) and a `pdf`-subcommand CLI integration test analogous to `cli.test.ts`'s `render` coverage.
3. **Reconcile `status.md`** against the live CI matrix and shipped `pdfExport.test.ts` — it's the one doc commit `f311dcc` missed.
4. **Rewrite or prune `codebase_map.md`** — it is the most severely stale doc in the repo (marks shipped files as "planned," invents a nonexistent test file, omits a real one).
5. **Fix the phantom `nh-deck serve`/`nh-deck export --pdf` references** in `ADR-0001`, `SECURITY.md`, and `SUPPORT.md` to say `render`/`pdf`.
6. **Either implement or explicitly re-scope `Branches.md`'s Release Automation section** — it currently describes automation that doesn't exist as if it were live policy.
7. **Consolidate the three overlapping lesson-ledger docs** (`memory.md`, `agent_learning.md`, `anti-patterns.md`) into one clear routing rule, or explicitly document why three exist.
8. **Decide on the `render.ts` baseline-CSS tension** with SOUL.md's "no forced theme" Non-Negotiable — either add a documented carve-out or a `--css`/`--theme` opt-out flag.
9. **Delete the stale `origin/feat/ci-matrix-pdf-test` remote branch** as routine housekeeping.
10. **Add a lint/typecheck script and CI step** — currently absent despite the project's otherwise strong tooling discipline.
11. **Document `.gitignore`'s PDF-fixture carve-out** (the `*.pdf` / `!fixtures/**/*.pdf` rule pair) in `TESTING.md` or `codebase_map.md` the first time a real PDF fixture is added under `fixtures/`, so the negation's purpose isn't left to be reverse-engineered later.