# Project Status

> Living snapshot. Update this file whenever phase, health, or active work
> changes — do not let it go stale across a phase boundary.

**Last updated:** 2026-09-02

## Overall Status

**Phase:** 4 — Walking Skeleton
**Health:** 🟡 Active / Early

nh-deck is an independent, standalone GitHub repository — a local-first
CLI tool for writing, presenting, and exporting Markdown-based slide
decks, in the spirit of `arpitbbhayani/deckrun`. It is one of three
sibling projects (`daily-dose`, `nh-deck`, `nh-skills`) under the
"Not-Humans-Lab" umbrella; cross-cutting system-level docs for that
umbrella live in the separate, docs-only meta-repo at `../Not-Humans-Lab/`
(linked by relative path, not duplicated here). `nh-skills` has already
completed its own Phase 1+2 (pre-scaffold docs + walking skeleton) and is
usable as a completed precedent for house style/conventions — not as
content to copy, since nh-deck's product shape (a rendering CLI) is
completely different from a Markdown-skills collection. `daily-dose` does
not exist yet.

Tech stack: TypeScript on Node.js (target LTS 20/22+), Commander.js for
the CLI surface, `marked` for Markdown → HTML (KaTeX math and Mermaid
diagram rendering are **decided-but-not-yet-installed** — deferred past
this walking skeleton as an explicit fast-follow, not silently skipped),
a plain `node:http` local dev server (no framework), and
`puppeteer-core` + `chrome-launcher` for PDF export via a locally
detected Chrome/Chromium/Edge/Brave binary (no bundled Chromium, no
Playwright). Build via plain `tsc` (no bundler), producing `dist/index.js`
with a preserved shebang as the npm `bin` entry. Tests with Vitest. See
`docs/adr/0001-adopt-ts-node-cli-with-puppeteer-core-export.md` for the
full rationale.

**Local-first is a hard, non-negotiable constraint**, carried over from
the reference project: the CLI never phones home, and rendered HTML must
not depend on any CDN for correctness. See `SECURITY.md` for how this
shapes the Known Security Considerations.

## Active Specs & Plans

| Spec / Plan                                                        | Phase | Status      |
| -------------------------------------------------------------------- | ----- | ----------- |
| Pre-scaffold docs (`SECURITY.md`, `SUPPORT.md`, `status.md`, `decisions.md`) | 4     | Complete    |
| Core loop: render Markdown → HTML, `serve` (local preview), `export --pdf` | 4     | In progress |
| Single-OS CI (`ubuntu-latest`) for the walking skeleton              | 4     | In progress |
| 3-OS × multi-Node-version CI matrix expansion                        | 5     | Planned, not started |
| KaTeX (math) + Mermaid (diagrams) rendering support                  | 6     | Planned, not started |

## Recent Progress

- Decided and documented the full tech stack: TypeScript on Node.js,
  Commander.js, `marked`, plain `node:http` dev server, `puppeteer-core` +
  `chrome-launcher` for PDF export, `tsc`-only build (no bundler), Vitest
  for tests, Apache-2.0 license (applied identically across all three
  sibling projects).
- Corrected an earlier, now-outdated research assumption: nh-deck is
  confirmed local-first with no hosted multi-user surface — earlier
  speculative "auth for shareable decks" reasoning does not apply and has
  been superseded in `SECURITY.md`.
- Wrote the pre-scaffold governance docs: `SECURITY.md` (local-only server
  binding, raw-HTML/XSS trust boundary, PDF-export command-injection
  guardrail, supply-chain policy), `SUPPORT.md`, this file, `decisions.md`,
  and ADR 0001.

## Upcoming Milestones

1. **Walking-skeleton exit criterion**: `render` → `serve` → `export --pdf`
   core loop works end to end on a sample deck, with single-OS
   (`ubuntu-latest`) CI green.
2. Expand CI to the full 3-OS × multi-Node-version matrix once the
   walking skeleton is green — explicitly deferred, not part of this
   phase.
3. Fast-follow: add KaTeX (math) and Mermaid (diagrams) rendering,
   bundled locally per the no-CDN constraint in `SECURITY.md` — not
   before the matrix expansion above.
4. Add a top-level `README.md` once the skeleton is proven (not before —
   avoid documenting a shape that might still change).

## Risks & Blockers

- **No blockers currently identified.**
- **Risk:** PDF export quality/behavior can vary by whichever
  Chrome/Chromium/Edge/Brave binary `chrome-launcher` detects on a given
  machine, since nh-deck deliberately does not bundle its own Chromium
  (see `docs/adr/0001-adopt-ts-node-cli-with-puppeteer-core-export.md`).
  Acceptable for the walking skeleton; worth revisiting if cross-machine
  export consistency becomes a real complaint.
- **Risk:** raw HTML in rendered decks is not sanitized by design (see
  `SECURITY.md`) — opening a third-party deck file executes any embedded
  HTML/script it contains. No warning mechanism exists yet for this.
- **Risk:** because `daily-dose` doesn't exist yet, cross-project
  conventions (license, doc structure) are only validated against this
  repo and `nh-skills` so far — watch for drift once `daily-dose` is
  scaffolded.
