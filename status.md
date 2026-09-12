# Project Status

> Living snapshot. Update this file whenever phase, health, or active work
> changes — do not let it go stale across a phase boundary.

**Last updated:** 2026-09-11

## Overall Status

**Phase:** 4 — Walking Skeleton complete (Phase 7 cross-project reconciliation also done)
**Health:** 🟢 Stable

nh-deck is an independent, standalone GitHub repository (github.com/sairam0424/nh-deck) — a local-first
CLI tool for writing, presenting, and exporting Markdown-based slide
decks. It is one of three
sibling projects (`daily-dose`, `nh-deck`, `nh-skills`) under the
"Not-Humans-Lab" umbrella; cross-cutting system-level docs for that
umbrella live in the separate, docs-only meta-repo at `../Not-Humans-Lab/`
(linked by relative path for rationale/context; `Branches.md` is copied
verbatim into this repo since a relative path alone would break for a
standalone clone). `nh-skills` and `daily-dose` have also shipped their
own phases — see their own repos for their state.

Tech stack: TypeScript on Node.js (target LTS 20/22+), Commander.js for
the CLI surface, `marked` for Markdown → HTML (KaTeX math and Mermaid
diagram rendering have both shipped, CDN-free — see
`docs/adr/0004-katex-local-embedded-math.md` and
`docs/adr/0005-mermaid-local-cdn-import-stripped.md`),
a plain `node:http` local dev server (no framework), and
`puppeteer-core` + `chrome-launcher` for PDF export via a locally
detected Chrome/Chromium/Edge/Brave binary (no bundled Chromium, no
Playwright). Build via plain `tsc` (no bundler), producing `dist/index.js`
with a preserved shebang as the npm `bin` entry. Tests with Vitest. See
`docs/adr/0001-adopt-ts-node-cli-with-puppeteer-core-export.md` for the
full rationale.

**Local-first is a hard, non-negotiable constraint**: the CLI never
phones home, and rendered HTML must not depend on any CDN for
correctness. See `SECURITY.md` for how this
shapes the Known Security Considerations.

## Active Specs & Plans

| Spec / Plan                                                        | Phase | Status      |
| -------------------------------------------------------------------- | ----- | ----------- |
| Pre-scaffold docs (`SECURITY.md`, `SUPPORT.md`, `status.md`, `decisions.md`) | 4     | Complete    |
| Core loop: render Markdown → HTML, `serve` (local preview), `export --pdf` | 4     | **Complete — verified with a real server response and a real 57KB PDF** |
| Single-OS CI (`ubuntu-latest`) for the walking skeleton              | 4     | Complete, green |
| 3-OS × multi-Node-version CI matrix expansion                        | 5     | **Complete — see `.github/workflows/ci.yml`'s 9-combination matrix and `Context.md`'s Current state section** |
| KaTeX (math) rendering support                                       | 6     | **Done — shipped CDN-free** |
| Mermaid (diagrams) rendering support                                 | 6     | **Done — shipped CDN-free** |

## Recent Progress

- Shipped Phase 4's exit criterion for real: `render` genuinely serves
  HTML over a real local HTTP server (curl-verified), and `pdf` genuinely
  produced a real, valid 57KB single-page PDF via a locally-detected
  Chrome install — neither is stubbed.
- Phase 7 cross-project reconciliation: added `Branches.md` (copied
  verbatim from Not-Humans-Lab), `agent_learning.md`, and
  `anti-patterns.md` (all three were missing from the original scaffold).
  Separately fixed a real build bug (`tsc` picking up `tests/*.ts` under
  its default include, conflicting with `rootDir: "src"`) and a doc/code
  drift issue (docs described `src/commands/`, `src/render/`, `src/server/`,
  `src/export/` subdirectories that never existed — the real code is flat).
- Earlier: decided and documented the full tech stack; corrected the
  outdated "auth for shareable decks" research assumption in `SECURITY.md`.

## Upcoming Milestones

1. ~~Expand CI to the full 3-OS × multi-Node-version matrix.~~ Done — see
   `.github/workflows/ci.yml`'s 9-combination matrix and Adoption status above.
2. ~~Fast-follow: add KaTeX (math) rendering, bundled locally per the
   no-CDN constraint in `SECURITY.md`.~~ Done — see Adoption status above.
3. ~~Add a real automated PDF-export CI smoke test (currently only manually
   verified locally, not yet in the CI pipeline).~~ Done — `tests/pdfExport.test.ts`
   is a real, unmocked PDF-export test that runs via `npx vitest run` in
   `ci.yml` across all 9 OS/Node combinations.
4. ~~Add a top-level `README.md` refresh now that both KaTeX and Mermaid
   have landed.~~ Done — README's Usage and Current limitations sections
   were refreshed in PR #8 to cover KaTeX/Mermaid/png/`--watch`/`--css`.
5. Automated cross-browser PDF-export visual-fidelity check (Context.md
   Roadmap item 7) — not yet started.
6. ~~Full theme, template, and transition system (Context.md Roadmap item 11).~~
   Done — theme portion shipped earlier (`docs/adr/0008-named-theme-system.md`);
   templates (4 fixed per-slide layouts) and transitions (deck-wide fade/slide,
   scoped to a new opt-in presentation mode) shipped in this PR — see
   `docs/adr/0009-templates-transitions-presentation-mode.md`.

## Risks & Blockers

- **No blockers currently identified.**
- **Risk:** PDF export quality/behavior can vary by whichever
  Chrome/Chromium/Edge/Brave binary `chrome-launcher` detects on a given
  machine, since nh-deck deliberately does not bundle its own Chromium
  (see `docs/adr/0001-adopt-ts-node-cli-with-puppeteer-core-export.md`).
  Acceptable today; worth revisiting if cross-machine export consistency
  becomes a real complaint.
- **Risk:** raw HTML in rendered decks is not sanitized by design (see
  `SECURITY.md`) — opening a third-party deck file executes any embedded
  HTML/script it contains. A warning mechanism now exists for this:
  `render`/`pdf`/`png` print a non-fatal stderr warning when a deck
  contains raw HTML other than a presenter-note comment.
