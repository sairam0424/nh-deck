# Context.md — nh-deck

Living state-of-the-world doc. Agents should update this as work progresses — this is not a duplicate of `AGENTS.md`'s static command list.

## What this is

nh-deck is a local-first CLI for writing, presenting, and exporting Markdown-based slide decks — the author's own version of [arpitbbhayani/deckrun](https://github.com/arpitbbhayani/deckrun). It is one of three independent sibling projects — daily-dose, nh-deck, nh-skills — under the **Not-Humans-Lab** umbrella (`../Not-Humans-Lab/`, a separate docs-only meta-repo). nh-deck is itself a standalone GitHub repository, matching this workspace's polyrepo convention — it is not nested inside Not-Humans-Lab.

**Corrected assumption, for the record:** earlier speculative research about nh-deck guessed it might be a hosted multi-user product with "shareable decks" requiring auth. That assumption was wrong and is now superseded. nh-deck is confirmed local-first, exactly like the reference project: no user accounts, no hosting, no multi-user sharing infrastructure. All docs in this repo, especially `SOUL.md` and the eventual `SECURITY.md`, are written to reflect this reality — not the discarded speculative one. If you find older reasoning anywhere that assumes hosted/multi-user, it is stale and should be corrected on sight.

nh-skills (`../nh-skills/`) and daily-dose (`../daily-dose/`) have both also shipped their own phases — nh-skills now has two skills through the loop, daily-dose ships both HN and arXiv sourcing — see their own repos/Context.md files for their state; their content is useful as house-style precedent but never copied verbatim, since each project's product shape is unrelated to nh-deck's (a rendering CLI).

## Current state (as of 2026-09-02)

- **Phase 4 walking skeleton: complete.** The render → serve → PDF-export core loop works end-to-end, genuinely verified (a real local HTTP server response, a real 57KB PDF via a detected Chrome install). Themes, templates, transitions, and math/diagram rendering remain out of scope, deliberately.
- **Tech stack: decided and shipped.** TypeScript on Node.js (LTS 20/22+), Commander.js for the CLI surface, `marked` for Markdown-to-HTML, a plain `node:http` dev server (no framework, no Express), and `puppeteer-core` + `chrome-launcher` for PDF export against a locally-detected Chrome/Chromium/Edge/Brave binary (no bundled Chromium, no Playwright). Build via plain `tsc` (no bundler), producing `dist/index.js` with a preserved shebang as the npm `bin` entry. Tests via Vitest, including a real (unmocked) end-to-end PDF-export test.
- **KaTeX: shipped, CDN-free.** Inline and block LaTeX math render via KaTeX with fonts embedded locally as base64 (no CDN fallback path); see `docs/adr/0004-katex-local-embedded-math.md`. **Mermaid: explicitly deferred, not silently skipped.** Decided-but-not-yet-installed on this branch — a documented fast-follow tracked separately (see Roadmap below), not a gap anyone should quietly work around (e.g. via a CDN script tag, which would violate the local-first constraint on its own).
- **CI: full cross-platform matrix, live.** `ubuntu-latest` / `macos-14` / `windows-latest` × Node 20/22/latest (9 combinations, `fail-fast: false`) all genuinely pass, including the real PDF-export test on every OS — Chrome/Chromium detection is now verified cross-platform, not just on Linux.
- **License: Apache-2.0**, decided once at the Not-Humans-Lab system level and applied identically across all three sibling projects (see `../Not-Humans-Lab/decisions.md`).

## Architecture at a glance

Three layers, all local, none of them a service:

1. **Render** — `marked`-based Markdown-to-HTML conversion (`src/render.ts`, exporting `generateHtml`). Deck source is a single Markdown file; output is static HTML. No CDN dependency for correctness — anything the rendered HTML needs must ship locally.
2. **Serve** — a plain `node:http` dev server (`src/server.ts`, exporting `startServer`) that serves the rendered deck locally, for presenting and for live iteration while writing. No framework (no Express), matching the "no bundler, no unnecessary dependency" philosophy running through this project's tooling choices.
3. **Export** — PDF export (`src/pdfExport.ts`, exporting `exportToPdf`) via `puppeteer-core` driving a locally-detected Chrome/Chromium/Edge/Brave binary through `chrome-launcher`. No bundled browser binary ships with nh-deck or gets downloaded at install time.

The CLI surface (`src/index.ts`, via Commander.js) wires the `render` and `pdf` subcommands to these three modules directly — one flat file per concern, no subdirectory nesting at this project's current size. See `AGENTS.md`'s Directory Map for the concrete file layout, and `../Not-Humans-Lab/architecture.md` for how nh-deck fits into the three-project system (C4 Level 1 only — this repo owns its own internals).

## Key decisions & why

- **Local-first, no exceptions, in the core path** — the entire reason to build a personal version of deckrun instead of using a hosted deck tool is to never depend on a network connection or a third party's server for something as basic as showing your own slides. See `SOUL.md` for the full non-negotiable and `CLAUDE.md` for the stop-and-ask gate that protects it during agent-assisted changes.
- **KaTeX shipped CDN-free; Mermaid deferred rather than stubbed or CDN-shimmed** — KaTeX math rendering is done (see Current state above); Mermaid remains a real, wanted feature not yet installed on this branch, since adding it properly (as local, bundled assets) is more work than a given walking-skeleton phase allows, and a CDN shortcut would violate the local-first constraint just to save time now. Documented here explicitly so the gap reads as a decision, not an oversight.
- **No bundler (`tsc` only)** — matches the reference project's own philosophy and keeps the build step legible; revisit only if a real, demonstrated need (not a hypothetical optimization) shows up.
- **`puppeteer-core` + `chrome-launcher` over full `puppeteer` or Playwright** — avoids bundling or downloading a Chromium binary, which would be both a larger install footprint and a silent network dependency at `npm install` time — a direct conflict with the local-first constraint.
- **Single-OS CI first, then the full matrix once green** — the full 3-OS matrix was real work (especially for `chrome-launcher`'s OS-specific binary detection paths), sequenced after the skeleton went green rather than paying that cost upfront. It has since shipped (see Current state above).
- **License = Apache-2.0** — decided once at the umbrella level, not re-decided per project; see `../Not-Humans-Lab/decisions.md` for the patent-grant rationale.

## Roadmap

In order — do not build out of sequence. Reconciled 2026-09-10 against a full codebase index (`CODEBASE_INDEX.md`) and three primary-source research docs (`docs/research/*.md`); full rationale in `docs/specs/feature-implementation-roadmap-design.md`.

1. ~~Finish the Phase 4 walking skeleton.~~ Done — render → serve → PDF-export core loop verified end-to-end.
2. ~~Expand CI to the full 3-OS × multi-Node-version matrix.~~ Done — 9/9 combinations green, including the real PDF-export test on every OS.
3. ~~Quick wins: 5 code-robustness fixes (render try/catch, --port validation, pdf output-path derivation, puppeteer launch/finally) + CI/tooling hardening (npm cache, npm audit, Biome + typecheck gate, PR-checklist doc-drift item).~~ Done — merged to main.
4. ~~Real per-slide segmentation (`---` → `<section>` boundaries).~~ Done — `generateHtml()` now splits on `---` via `marked`'s lexer/parser token-group split (see `docs/adr/0002-per-slide-segmentation.md`). Foundational for live-reload (item 5) and presenter notes/PDF pagination (item 6).
5. ~~Genuine live-reload for `render`.~~ Done — `render --watch` now re-renders and pushes a same-origin SSE reload event on file change (see `docs/adr/0003-sse-based-live-reload.md`); the previously-false "live reload" claim in `AGENTS.md`'s Overview is now accurate.
6. Presenter notes (HTML-comment convention) + per-slide PDF pagination — both depend on item 4.
7. Automated cross-browser PDF-export visual-fidelity check (unchanged from the prior roadmap's item 3 fast-follow — independent of items 3–6 and 8–11 below).
8. ~~KaTeX (math rendering).~~ Done — inline and block LaTeX math now renders via KaTeX with fonts embedded locally as base64 (no CDN fallback path); see `docs/adr/0004-katex-local-embedded-math.md`.
9. **Mermaid (diagram rendering).** DOM-free, Puppeteer-free renderer only — explicitly not `@mermaid-js/mermaid-cli`, which requires full `puppeteer` as a peer dependency.
10. `--css <path>` opt-out flag for the baseline stylesheet — a smaller, immediately-actionable slice of item 11.
11. **Full theme, template, and transition system** — the rest of the reference project's (deckrun's) feature set, brought in deliberately and evaluated each time against `SOUL.md`'s "render faithfully, don't editorialize" value — must stay opt-in, never a forced default. Needs its own brainstorming pass when reached.
12. PNG (and, further out, PPTX) export via the already-detected browser — depends on item 4.

## Open risks

- **The local-first constraint has now been tested against a real "convenience" pressure, and held.** KaTeX's own upstream convention (and two of the five tools surveyed during roadmap research, reveal.js's and Marp Core's official plugins) defaults to a CDN font path — this project instead ships KaTeX's fonts embedded as base64 `data:` URIs directly in rendered output, with no CDN fallback path at all, verified via a real end-to-end browser check (zero network requests beyond the local file). See `docs/adr/0004-katex-local-embedded-math.md`.
- **No cross-platform PDF export *fidelity* check exists yet** — the 9-combination CI matrix proves the export path *works* on all three OSes (a real PDF gets produced everywhere), but different locally-detected browsers (Chrome vs. Edge vs. Brave) could in principle render/export slightly differently in appearance; that visual-fidelity comparison has not yet been characterized.
- **The PDF-export test is genuinely slow under machine contention** — locally observed 5-55s depending on concurrent load; CI runners are dedicated so this shouldn't recur there, but the test's 60s timeout is worth revisiting if it ever proves too tight or too loose in practice.
- **`vitest`/`vite`/`esbuild` dev-only dependency chain has known moderate/critical advisories** (as of 2026-09-10) that would require a `vitest` 2→5 major-version bump to resolve — deferred, not silently ignored. Zero production exposure (dev/test-tooling only, never shipped in `dist/`). CI's `npm audit` gate is deliberately scoped to `--omit=dev` to reflect this; re-evaluate when a `vitest` major-version upgrade is otherwise on the roadmap.
- **`puppeteer-core@25.10.0` and its transitive `@puppeteer/browsers@3.2.2` declare `"engines": {"node": ">=22.12.0"}`**, stricter than this project's own `package.json` (`"node": ">=20"`), `AGENTS.md` ("Requires Node.js LTS 20 or 22+"), and the CI matrix (`node-version: [20, 22, latest]`) — a drift introduced by the `puppeteer-core` bump in the "fix(deps)" commit on this branch. Investigated and verified live on real Node 20.20.2 (`brew install node@20`, isolated from this worktree's own `node_modules`): `npm install` prints non-fatal `npm warn EBADENGINE` for both packages (this repo has no `.npmrc`, and `npm config get engine-strict` is `false` by default, so the warning never fails the install or the CI job); `npm audit --omit=dev --audit-level=high` still exits 0; and the **full real test suite (22/22, including the unmocked `tests/pdfExport.test.ts` E2E and the CLI `pdf` subcommand test in `tests/cli.test.ts`) passes unchanged** — the actual `puppeteer.launch()`/`newPage()`/`setContent()`/`pdf()`/`close()` call chain works correctly on Node 20.20.2 despite the stricter declared engine. Ruling: keep Node 20 in `package.json`'s `engines`, `AGENTS.md`, and the CI matrix as-is rather than drop platform support over an advisory-only mismatch with no observed functional impact; revisit if a future `puppeteer-core` upgrade actually breaks on Node 20 (not just warns), or if this project ever adopts `engine-strict=true`.

---
*Last updated: 2026-09-11. Agents: keep this current as work progresses — do not let it go stale while `AGENTS.md`/`SOUL.md`/`CLAUDE.md` stay static.*
