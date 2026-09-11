# Decisions

This file is the index over this project's Architecture Decision Records
(ADRs, in `docs/adr/`) plus a lightweight running log for decisions that
don't rise to ADR weight. Together they are the decision history for
nh-deck; do not duplicate cross-cutting decisions that belong in the
docs-only meta-repo at `../Not-Humans-Lab/` (link there by relative path
instead).

## What Counts as "Architecturally Significant" Here

A decision gets a full ADR (in `docs/adr/`) when it meets at least one of
these bars for nh-deck specifically:

- It fixes the **runtime/toolchain shape of the CLI itself** (e.g., the
  language/runtime it ships on, the CLI framework, the build strategy —
  bundler vs. transpile-only, how the npm `bin` entry is produced).
- It changes **how a deck is rendered, previewed, or exported** — the
  Markdown → HTML pipeline, the local dev-server approach, or the PDF
  export mechanism (which browser-automation library, bundled vs.
  detect-first browser strategy).
- It is **expensive or awkward to reverse** once decks, scripts, or CI
  depend on it (e.g., switching CLI frameworks after commands ship, or
  changing the PDF export library after users depend on its exact
  output).
- It trades off between two or more of the decision drivers this project
  cares about (local-first / no-CDN constraint, zero bundled-browser
  weight, minimal dependency surface, CI cost, cross-suite consistency
  with `daily-dose` / `nh-skills`) rather than being an obvious,
  uncontested choice.

Everything else — a specific flag name, a soft warning threshold, a test
fixture's exact content — goes in the Lightweight Decisions Log below
instead of getting its own ADR file.

## ADR Index

| ID   | Title                                                                      | Status   | Date       | Supersedes |
| ---- | ----------------------------------------------------------------------------- | -------- | ---------- | ---------- |
| 0001 | [Adopt TS/Node CLI with puppeteer-core export](docs/adr/0001-adopt-ts-node-cli-with-puppeteer-core-export.md) | Accepted | 2026-09-02 | —          |
| 0002 | [Adopt per-slide segmentation via marked's lexer/parser split](docs/adr/0002-per-slide-segmentation.md) | Accepted | 2026-09-10 | —          |
| 0003 | [SSE-based live-reload for render --watch](docs/adr/0003-sse-based-live-reload.md) | Accepted | 2026-09-11 | —          |
| 0004 | [KaTeX math rendering with locally-embedded fonts](docs/adr/0004-katex-local-embedded-math.md) | Accepted | 2026-09-11 | —          |
| 0005 | [Mermaid diagram rendering with a stripped CDN font import](docs/adr/0005-mermaid-local-cdn-import-stripped.md) | Accepted | 2026-09-11 | —          |
| 0006 | [Phase 5 polish: --css opt-out, presenter notes, PDF pagination, PNG export](docs/adr/0006-phase-5-polish.md) | Accepted | 2026-09-11 | —          |

## Lightweight Decisions Log

| Date       | Decision                                                                                                    | Rationale                                                                                                                 | Owner |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----- |
| 2026-09-02 | Ship nh-deck as an independent, standalone GitHub repo, not nested inside `Not-Humans-Lab`.                    | Matches this workspace's polyrepo convention; `Not-Humans-Lab` is docs-only and cross-cutting, not a code host for its siblings. | @sairamugge |
| 2026-09-02 | License: Apache-2.0.                                                                                            | Decided once at the system level, applied identically across `daily-dose`, `nh-deck`, and `nh-skills` for enterprise-clearable, patent-safe consistency. | @sairamugge |
| 2026-09-02 | Corrected an earlier speculative assumption that nh-deck needed auth for "shareable decks."                    | nh-deck is confirmed local-first with no hosting or multi-user surface; the earlier assumption was wrong and is superseded in `SECURITY.md`. | @sairamugge |
| 2026-09-02 | KaTeX (math) and Mermaid (diagrams) rendering are decided-but-not-yet-installed — explicit fast-follow, not silently skipped. | Keeps the walking skeleton's dependency surface minimal (YAGNI) while making the deferral visible instead of an implicit gap; must ship bundled, never via CDN, per the local-first constraint. | @sairamugge |
| 2026-09-02 | Build with plain `tsc` (transpile-only), no bundler.                                                            | A small CLI does not need bundling to ship `dist/index.js`; tsc alone is sufficient. | @sairamugge |
| 2026-09-02 | CI starts as a single-OS (`ubuntu-latest`) job for the walking skeleton; the full 3-OS × multi-Node-version matrix is deferred until after the skeleton is green. | Avoids paying multi-OS CI cost before the core render/serve/export loop is proven; matrix expansion is a tracked upcoming milestone, not abandoned scope. | @sairamugge |
| 2026-09-02 | Test with Vitest.                                                                                                | Consistent, fast TS-native test runner for a TypeScript-on-Node CLI; no need for Jest's extra config surface for this project's size. | @sairamugge |
| 2026-09-02 | Expanded CI to the full 3-OS x 3-Node-version matrix and added a real, unmocked `tests/pdfExport.test.ts`.       | Fulfilled the milestone tracked in the row above — the walking skeleton went green, so the deferred matrix expansion was no longer speculative. PDF export now genuinely verified on Windows/macOS, not just assumed to work there. | @sairamugge |
| 2026-09-10 | Reconciled `Context.md`'s Roadmap to insert 5 code-robustness fixes, CI/tooling hardening, and 4 net-new feature items (segmentation, live-reload, notes+pagination, `--css` opt-out, PNG export) around the existing KaTeX/Mermaid/Themes items (3–6), per a full codebase index plus 3 primary-source research docs. | Closes gaps `CODEBASE_INDEX.md` documented and grounds the already-planned KaTeX/Mermaid/theme work in verified anti-patterns from Marp/Slidev/reveal.js before implementation starts. Full spec: `docs/specs/feature-implementation-roadmap-design.md`. | @sairamugge |
