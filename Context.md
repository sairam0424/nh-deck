# Context.md — nh-deck

Living state-of-the-world doc. Agents should update this as work progresses — this is not a duplicate of `AGENTS.md`'s static command list.

## What this is

nh-deck is a local-first CLI for writing, presenting, and exporting Markdown-based slide decks — the author's own version of [arpitbbhayani/deckrun](https://github.com/arpitbbhayani/deckrun). It is one of three independent sibling projects — daily-dose, nh-deck, nh-skills — under the **Not-Humans-Lab** umbrella (`../Not-Humans-Lab/`, a separate docs-only meta-repo). nh-deck is itself a standalone GitHub repository, matching this workspace's polyrepo convention — it is not nested inside Not-Humans-Lab.

**Corrected assumption, for the record:** earlier speculative research about nh-deck guessed it might be a hosted multi-user product with "shareable decks" requiring auth. That assumption was wrong and is now superseded. nh-deck is confirmed local-first, exactly like the reference project: no user accounts, no hosting, no multi-user sharing infrastructure. All docs in this repo, especially `SOUL.md` and the eventual `SECURITY.md`, are written to reflect this reality — not the discarded speculative one. If you find older reasoning anywhere that assumes hosted/multi-user, it is stale and should be corrected on sight.

nh-skills (`../nh-skills/`) is a sibling that already completed its own Phase 1+2 (pre-scaffold docs + walking skeleton, one real skill shipped through a full author→validate→PR→CI→merge loop) — useful as a precedent for house style/conventions, but its product shape (a curated Markdown-skills collection) is unrelated to nh-deck's (a rendering CLI), so its content is referenced for convention, never copied verbatim. daily-dose does not exist yet.

## Current state (as of 2026-09-02)

- **Phase 4: walking skeleton in progress** — the render → serve → PDF-export core loop is the current scope. Nothing beyond that loop (themes, templates, transitions, math/diagram rendering) is in scope yet.
- **Tech stack: decided.** TypeScript on Node.js (LTS 20/22+), Commander.js for the CLI surface, `marked` for Markdown-to-HTML, a plain `node:http` dev server (no framework, no Express), and `puppeteer-core` + `chrome-launcher` for PDF export against a locally-detected Chrome/Chromium/Edge/Brave binary (no bundled Chromium, no Playwright). Build via plain `tsc` (no bundler), producing `dist/index.js` with a preserved shebang as the npm `bin` entry. Tests via Vitest, including a snapshot-test harness for rendered HTML.
- **KaTeX and Mermaid: explicitly deferred, not silently skipped.** Both are decided-but-not-yet-installed. This is a documented fast-follow — see Roadmap below — not a gap anyone should quietly work around (e.g. via a CDN script tag, which would violate the local-first constraint on its own).
- **CI: single-OS for now.** One GitHub Actions job on `ubuntu-latest` runs build + test on every PR. The full 3-OS (ubuntu/macos/windows) × multi-Node-version matrix is explicitly deferred until this walking skeleton is green — not part of this phase.
- **License: Apache-2.0**, decided once at the Not-Humans-Lab system level and applied identically across all three sibling projects (see `../Not-Humans-Lab/decisions.md`).

## Architecture at a glance

Three layers, all local, none of them a service:

1. **Render** — `marked`-based Markdown-to-HTML conversion (`src/render.ts`, exporting `generateHtml`). Deck source is a single Markdown file; output is static HTML. No CDN dependency for correctness — anything the rendered HTML needs must ship locally.
2. **Serve** — a plain `node:http` dev server (`src/server.ts`, exporting `startServer`) that serves the rendered deck locally, for presenting and for live iteration while writing. No framework (no Express), matching the "no bundler, no unnecessary dependency" philosophy running through this project's tooling choices.
3. **Export** — PDF export (`src/pdfExport.ts`, exporting `exportToPdf`) via `puppeteer-core` driving a locally-detected Chrome/Chromium/Edge/Brave binary through `chrome-launcher`. No bundled browser binary ships with nh-deck or gets downloaded at install time.

The CLI surface (`src/index.ts`, via Commander.js) wires the `render` and `pdf` subcommands to these three modules directly — one flat file per concern, no subdirectory nesting at this project's current size. See `AGENTS.md`'s Directory Map for the concrete file layout, and `../Not-Humans-Lab/architecture.md` for how nh-deck fits into the three-project system (C4 Level 1 only — this repo owns its own internals).

## Key decisions & why

- **Local-first, no exceptions, in the core path** — the entire reason to build a personal version of deckrun instead of using a hosted deck tool is to never depend on a network connection or a third party's server for something as basic as showing your own slides. See `SOUL.md` for the full non-negotiable and `CLAUDE.md` for the stop-and-ask gate that protects it during agent-assisted changes.
- **KaTeX/Mermaid deferred rather than stubbed or CDN-shimmed** — both are real, wanted features, but adding them properly (as local, bundled assets) is more work than this walking skeleton's scope allows, and a CDN shortcut would violate the local-first constraint just to save time now. Documented here explicitly so the gap reads as a decision, not an oversight.
- **No bundler (`tsc` only)** — matches the reference project's own philosophy and keeps the build step legible; revisit only if a real, demonstrated need (not a hypothetical optimization) shows up.
- **`puppeteer-core` + `chrome-launcher` over full `puppeteer` or Playwright** — avoids bundling or downloading a Chromium binary, which would be both a larger install footprint and a silent network dependency at `npm install` time — a direct conflict with the local-first constraint.
- **Single-OS CI for this phase** — the full 3-OS matrix is real work (especially for `chrome-launcher`'s OS-specific binary detection paths) and is deliberately sequenced after this skeleton is green, not skipped.
- **License = Apache-2.0** — decided once at the umbrella level, not re-decided per project; see `../Not-Humans-Lab/decisions.md` for the patent-grant rationale.

## Roadmap

In order — do not build out of sequence:

1. **Finish the Phase 4 walking skeleton.** Render → serve → PDF-export core loop, working end-to-end, with the snapshot-test harness covering rendering output, single-OS CI green.
2. **Expand CI to the full 3-OS × multi-Node-version matrix.** Only once step 1 is genuinely green — this is explicitly the next step after the skeleton, not a "someday."
3. **KaTeX (math rendering).** Local, bundled assets only — no CDN. Add as its own dependency decision, not folded silently into an unrelated change.
4. **Mermaid (diagram rendering).** Same local-asset constraint as KaTeX.
5. **Themes, templates, transitions** — the rest of the reference project's (deckrun's) feature set, brought in deliberately and evaluated each time against `SOUL.md`'s "render faithfully, don't editorialize" value — a theme system must stay opt-in, never a forced default.

## Open risks

- **The walking skeleton is not yet complete** — until render → serve → export actually runs end-to-end with passing snapshot tests, the core loop is a plan, not a proven artifact.
- **`chrome-launcher`'s cross-platform binary detection is unverified** — single-OS CI means the Windows/macOS detection paths have not yet been exercised in CI, only (at most) locally. This is a known gap the CI-matrix-expansion roadmap step exists to close.
- **The local-first constraint has not yet been tested against a real "convenience" pressure** (e.g. an actual KaTeX/Mermaid implementation attempt) — the stop-and-ask gate in `CLAUDE.md` is specified but not yet exercised against a real proposed CDN shortcut.
- **No cross-platform PDF export fidelity check exists yet** — different locally-detected browsers (Chrome vs. Edge vs. Brave) could in principle render/export slightly differently; this has not yet been characterized.

---
*Last updated: 2026-09-02. Agents: keep this current as work progresses — do not let it go stale while `AGENTS.md`/`SOUL.md`/`CLAUDE.md` stay static.*
