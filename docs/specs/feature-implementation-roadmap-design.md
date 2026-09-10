# nh-deck — Feature & Robustness Implementation Roadmap (Design Spec)

**Status:** Draft, pending user review
**Date:** 2026-09-10
**Author:** Claude (brainstorming session), decisions attributable to @sairamugge per this session's explicit direction
**Save-location note:** this repo's existing `docs/` convention is flat, topic-suffixed files nested by kind (`docs/adr/000N-*.md`, `docs/research/*-research.md`). This doc follows that pattern as `docs/specs/*-design.md` rather than the brainstorming skill's generic `docs/superpowers/specs/YYYY-MM-DD-*.md` default, per "follow existing patterns when working in an existing codebase."

## 0. Purpose

This spec turns three inputs into one sequenced implementation plan:

1. `CODEBASE_INDEX.md` (root) — a full end-to-end index of nh-deck as it exists today, including 5 concrete code-robustness gaps and a set of documentation-drift findings.
2. Three primary-source research docs under `docs/research/`: `feature-roadmap-research.md`, `cli-robustness-testing-research.md`, `security-performance-tooling-research.md`.
3. This repo's own existing planning artifacts — `Context.md`'s Roadmap (items 1–6), `decisions.md`, `SOUL.md`'s four Non-Negotiables, and `CLAUDE.md`'s stop-and-ask gate.

**Explicit scope authorization (per `CLAUDE.md`'s own requirement to note approvals traceably):** `CLAUDE.md` requires stopping and asking before any diff that touches KaTeX/Mermaid/theme work or anything network-adjacent, and `AGENTS.md`'s scope-discipline section forbids building these "ahead of schedule." This spec is not ahead of schedule — `Context.md`'s existing Roadmap items 4–6 already are KaTeX → Mermaid → Themes, in that order. The user (@sairamugge) explicitly directed this planning session, covering all three research docs' recommendations, in the live conversation this spec is written from. That is the explicit approval `CLAUDE.md` asks for; it is recorded here, and should be re-referenced in the commit/PR description for each phase that touches KaTeX, Mermaid, or theming, per `CLAUDE.md`'s own instruction.

## 1. Constraints (unchanged, carried forward from SOUL.md)

Every phase below is checked against nh-deck's four Non-Negotiables:

1. **Local-first** — no CDN scripts, no telemetry, no runtime network dependency in the render/serve/export path.
2. **No bundled/auto-downloaded Chromium** — PDF/image export only ever drives a browser already installed on the user's machine.
3. **No forced visual theme with no opt-out.**
4. **No silent scope expansion.**

## 2. Reconciling this plan with `Context.md`'s existing Roadmap

`Context.md`'s Roadmap (as of 2026-09-02) is:

```
1. ~~Finish the Phase 4 walking skeleton.~~ Done.
2. ~~Expand CI to the full 3-OS × multi-Node-version matrix.~~ Done.
3. Automated PDF-export smoke test inside CI (partially done; remaining fast-follow: cross-browser visual fidelity check).
4. KaTeX (math rendering). Local, bundled assets only.
5. Mermaid (diagram rendering). Same local-asset constraint.
6. Themes, templates, transitions.
```

This plan's research (`CODEBASE_INDEX.md`, all three `docs/research/*.md` files) surfaced items **not yet on that list**: 5 code-robustness gaps, a CI/tooling gap, and 4 net-new roadmap features (slide segmentation, live-reload, speaker notes, PDF pagination, a lighter `--css` opt-out ahead of the full theme system, and PNG export). This spec **proposes an updated Roadmap** that inserts those items around the existing ones, preserving items 4–6's relative order and content:

```
1. ~~Finish the Phase 4 walking skeleton.~~ Done.
2. ~~Expand CI to the full 3-OS × multi-Node-version matrix.~~ Done.
3. Quick wins: 5 code-robustness fixes + CI/tooling hardening.        [NEW — this spec's Phase 1]
4. Real per-slide segmentation (`---` → `<section>`).                 [NEW — this spec's Phase 2]
5. Genuine live-reload for `render`.                                  [NEW — this spec's Phase 3]
6. Presenter notes + per-slide PDF pagination.                        [NEW — folded into this spec's Phase 5]
7. Automated cross-browser PDF-export visual-fidelity check.          [EXISTING item 3 — independent, unblocked, not detailed further by this spec]
8. KaTeX (math rendering), local-bundled only.                        [EXISTING item 4 — this spec's Phase 4a]
9. Mermaid (diagram rendering), local-only.                           [EXISTING item 5 — this spec's Phase 4b]
10. `--css`/`--theme` opt-out flag.                                   [NEW, lighter slice of EXISTING item 6 — this spec's Phase 5]
11. Full theme/template/transition system.                            [EXISTING item 6, remainder — explicitly out of detailed scope, see §7]
12. PNG (and future PPTX) export.                                     [NEW — this spec's Phase 5]
```

Item 7 (existing item 3's remaining fast-follow) is orthogonal to everything else here — it's a testing/QA task on already-shipped PDF export, not a new code path — and is left independent; nothing in Phases 1–5 blocks or is blocked by it. This spec's own implementation should update `Context.md`'s Roadmap section to this numbering once approved (tracked as a Phase 1 task, §3 below).

## 3. Phase 1 — Quick Wins: Robustness Fixes + CI/Tooling Hardening

**Goal:** close all 5 currently-known code gaps and the CI/tooling gap, with zero new runtime dependencies and zero feature-surface change. Fully specified already by `docs/research/cli-robustness-testing-research.md` and `docs/research/security-performance-tooling-research.md` — this phase is implementation-ready, not design-open.

**Components touched:** `src/index.ts`, `src/pdfExport.ts`, `.github/workflows/ci.yml`, `package.json`, `Branches.md`, `Context.md` (roadmap update), `decisions.md` (log this planning session).

**Design decisions (each cited in the research doc, not re-derived here):**

- `render`'s action body gets wrapped in try/catch, byte-for-byte matching `pdf`'s existing pattern (`src/index.ts:39-52`) — no change to `program.parse()`/`parseAsync()` needed.
- `--port` gets a Commander custom `parseArg` (`InvalidArgumentError` + `Number.isInteger` + 0–65535 range check), validated before the action handler runs at all, not inside it.
- `pdf`'s output-path derivation switches from a bare regex replace to `path.extname()`-based logic, appending `.pdf` instead of silently no-op'ing when the input lacks a `.md` suffix, plus a `resolve()`-equality guard against self-overwrite.
- `pdfExport.ts`: `puppeteer.launch()` moves inside `try`; `browser` is declared as possibly-`undefined`; `finally` becomes `await browser?.close()`. A citing comment is added documenting that `installations[0]` is chrome-launcher's own intended default-selection contract (confirmed in its README/source) — explicitly **not** changed, so a future contributor doesn't "fix" it into a regression.
- CI: add `cache: 'npm'` to the existing `actions/setup-node@v4` step (highest-leverage single-line change given the 9-combination matrix); add `npm audit --audit-level=high` as a new step; add Biome (`biome ci`) plus a standalone `"typecheck": "tsc --noEmit"` script, both wired into `ci.yml` ahead of the existing `npm run build` step.
- `Branches.md`: add a PR-checklist line addressing doc-drift ("if this PR changes CI, `src/`, or shipped-feature status, did you check `status.md`, `codebase_map.md`, and `AGENTS.md`'s Directory Map?") — the research found no tool solves nh-deck's actual doc-drift problem, so this is a process fix, not a new dependency.
- `Context.md`: update the Roadmap section to the reconciled numbering in §2 above.
- `decisions.md`: add a Lightweight Decisions Log entry recording this planning session and its scope-authorization for Phases 4a/4b (KaTeX/Mermaid) and 5 (theming).

**Testing:** one regression test per fix — `render`'s new error path (missing file → stderr + exit 1), `--port` validation (invalid input → clear Commander-formatted error, valid edge values 0/65535 accepted), `pdf`'s output-path edge case (input with no `.md` suffix → appends, doesn't overwrite), and a new `tests/pdfExport.noBrowser.test.ts` using `vi.mock`+`vi.importActual` scoped **only** to `chrome-launcher` (never touching `puppeteer-core`) for the "no browser found" path — kept in a separate file from the existing real-E2E `tests/pdfExport.test.ts` to preserve its "no mocks anywhere" invariant. Also add the missing CLI-process integration test for the `pdf` subcommand (mirroring `tests/cli.test.ts`'s existing `render` test) and a new `tests/server.test.ts` unit-testing `startServer` directly (real `fetch()`/`http.get()` against the returned URL, no mocking needed).

**Non-Negotiable impact:** none — no new runtime deps, no network surface, no theme change.

## 4. Phase 2 — Foundational: Real Slide Segmentation

**Goal:** `render.ts` currently calls `marked.parse()` on the entire file as one continuous document; a Markdown `---` becomes a plain `<hr>`, not a slide boundary (confirmed by reading `render.ts` directly). Every comparable tool (Marpit/Marp CLI, Slidev, reveal.js, mdx-deck) treats `---`-delimited segmentation as foundational, and it is the prerequisite for Phase 5's speaker notes and PDF pagination.

**Components touched:** `src/render.ts` (core change), `tests/render.test.ts`, `fixtures/sample.md` (extended to include multiple `---`-delimited slides).

**Design decisions:**

- Delimiter: `---` on its own line, matching Marpit/Slidev's convention and nh-deck's own docs' existing (previously unenforced) assumption.
- Pre-split the raw Markdown string on the delimiter **before** calling `marked.parse()`, parsing each slide's Markdown independently and wrapping each result in its own `<section class="slide">` — this is simpler and lower-risk than post-processing marked's HTML AST, and is effectively what Marpit/Slidev do.
- Backward compatibility: a file with no `---` must still render as exactly one `<section>`, not zero — this is a required regression test, not an edge case to skip.
- Add baseline CSS for slide boundaries (block-level `<section>` styling, no page-break rule yet — that's Phase 5).

**Testing:** extend `tests/render.test.ts` to assert section count matches slide count on an extended multi-slide fixture, verify the no-`---` single-section backward-compat case, and verify a `---` used mid-prose (e.g. inside a blockquote or list, if marked's block parser would ever treat it as non-top-level) doesn't spuriously create a slide boundary — confirm this against marked's actual block-parsing behavior during implementation, not assumed here.

**Non-Negotiable impact:** none — pure string-processing and CSS.

## 5. Phase 3 — Genuine Live-Reload

**Goal:** `AGENTS.md`'s Overview line already claims the dev server supports "live reload" — `CODEBASE_INDEX.md` §8 confirmed this is currently false (`src/server.ts` has no watch/push mechanism). This phase makes the existing doc claim true.

**Components touched:** `src/server.ts` (SSE endpoint + watcher wiring), `src/index.ts` (new `--watch` flag), new `tests/server.test.ts` additions, `tests/cli.test.ts` (new `--watch` case).

**Design decisions:**

- `fs.watch()` on the source Markdown file triggers `generateHtml()` again and notifies connected clients.
- A same-origin SSE endpoint (e.g. `GET /__nh-deck-reload`) is added to the existing `127.0.0.1`-only `http.Server`; the served HTML gets a small **inline** `<script>` (not a CDN reference) that opens an `EventSource` to that endpoint and calls `location.reload()` on message. This traffic never leaves loopback, so per the research's own framing it is not a "runtime network dependency" in `SOUL.md`'s sense — but per `CLAUDE.md`'s stop-and-ask gate, this exact judgment call is flagged explicitly in this spec for the user's visibility (§0's authorization covers it, but implementation should still double-check no CDN reference sneaks in via a copy-pasted reload-script snippet from a tutorial, which is exactly the failure mode `CLAUDE.md` warns about).
- Ships as an explicit `--watch` flag on `render`, not always-on — this avoids silently changing `render`'s existing tested default behavior (in particular `tests/cli.test.ts`'s existing subprocess test, which asserts specific stdout/exit behavior for the non-watch case).
- The watcher must be torn down when the server closes, tying into the existing `StartedServer` interface's lifecycle.

**Testing:** new `tests/server.test.ts` cases for the SSE endpoint and watcher-triggered rebuild; an extended `tests/cli.test.ts` case that spawns with `--watch`, touches the fixture file, and asserts a reload event fires — flagged as the trickiest test in this phase to make non-flaky (fs.watch timing/debounce); implementation should budget explicit time for this rather than treating it as a quick add.

**Non-Negotiable impact:** compliant if and only if the reload script stays inline and same-origin — verify explicitly during implementation review, don't just assume it from this design.

## 6. Phase 4 — Math (KaTeX) & Diagrams (Mermaid), Local-Only

**This is the highest-risk phase.** Two confirmed anti-patterns must NOT be copied, per direct source verification in `docs/research/feature-roadmap-research.md`:

- reveal.js's own official KaTeX/MathJax plugins default to loading from `cdn.jsdelivr.net` at runtime unless a `local` option is explicitly set (verified in their actual source, `plugin/math/katex.js` and `plugin/math/mathjax3.js`).
- Marp Core's `katexFontPath`/`fontPath` option defaults to jsDelivr CDN in **both** its stable v4 and RC v5 lines (verified in both branches' own docs).
- `@mermaid-js/mermaid-cli` — the most commonly reached-for Mermaid CLI tool — declares `puppeteer` as a **required** (non-optional) peer dependency (verified against live npm registry metadata), which would silently reintroduce a bundled-Chromium download, exactly the trap `SOUL.md`'s Anti-Example #3 names.

### 4a. KaTeX

**Design decisions:**

- Use KaTeX's Node-side `renderToString` API — synchronous, browser-free, fits `generateHtml`'s existing pure-function shape.
- Font files ship locally, embedded as base64 `data:` URIs directly in the existing `<style>` block (consistent with `render.ts`'s self-contained-single-HTML-file philosophy) — **no CDN fallback path at all**, not even as an opt-in "advanced" mode.
- New devDependency: `katex` only (no plugin/wrapper package needed for the Node-side API).

**Testing:** a fixture `.md` with inline and block math; assert the rendered HTML contains expected KaTeX markup; extend the existing CDN-hostname-blacklist test pattern already in `tests/render.test.ts` to explicitly assert **zero** `cdn.jsdelivr.net` (or any external host) references anywhere in KaTeX-containing output.

### 4b. Mermaid

**Design decisions:**

- Explicitly avoid `@mermaid-js/mermaid-cli`. Use a DOM-free, Puppeteer-free renderer for build-time SVG generation — the research identified `beautiful-mermaid` (verified via npm metadata: only `elkjs` + `entities` as runtime deps, no browser, no DOM) as the Marp-Core-v5-validated pattern. **Implementation must re-verify this package's current dependency tree at build time before adding it** — the research flagged this as needing "one more concrete look" and this spec does not treat that verification as already done.
- If `beautiful-mermaid` (or an equivalent) turns out to be unsuitable at implementation time, this sub-phase should re-open as its own brainstorming spike before proceeding — do not fall back to `mermaid-cli`/`puppeteer` as a shortcut.

**Testing:** golden-file test for Mermaid SVG output from a fixture `.md` with a `mermaid` code fence; same zero-CDN/zero-Puppeteer-in-process assertion pattern as 4a.

**Non-Negotiable impact:** the entire point of this phase's design is to be compliant — but it is the one phase where "looks fine" is not enough; every test must include an explicit network/Chromium-absence assertion, not just a rendering-correctness assertion.

## 7. Phase 5 — Polish

Four independently shippable items, each low-effort once Phase 2 (segmentation) exists:

- **`--css <path>` opt-out flag** — lets a user pass a custom CSS file that fully or partially overrides `render.ts`'s currently-unconditional baseline `<style>` block. This directly resolves the tension `CODEBASE_INDEX.md` §8 already flagged (SOUL.md's "no forced theme" Non-Negotiable vs. the hardcoded, no-opt-out CSS). This is a deliberately smaller slice of `Context.md`'s existing Roadmap item 6 ("Themes, templates, transitions") — the fuller theme *system* (named/registered themes, per-slide theme directives, transitions) is explicitly **out of scope** for this spec (see §8) and should get its own brainstorming pass when reached.
- **Presenter notes** — extend `generateHtml` to also return a parallel per-slide notes array, collected from HTML comments in each slide's Markdown (Marpit's convention: any comment not later consumed as a directive). Depends on Phase 2's slide boundaries. Display mechanism (a `?notes` view vs. a `window.open()`+`postMessage` companion window à la reveal.js) is the least-specified part of this whole plan — decide at implementation time, not here.
- **Per-slide PDF pagination** — once Phase 2's `<section>` boundaries exist, add `@media print { section { break-after: page; } }` (or the vendor-appropriate equivalent) so `pdfExport.ts`'s existing `page.pdf()` call produces one PDF page per slide. No new dependency.
- **PNG export** — reuse `pdfExport.ts`'s existing chrome-launcher-detected browser session; add a `page.screenshot()` call per `<section>`. Needs Phase 2's real slide boundaries to know what "one PNG per slide" means. Treat PPTX as an explicit future decision requiring a real library — out of scope here.

**Non-Negotiable impact:** the `--css` flag is opt-in by construction (compliant); the other three are pure local rendering/export additions (compliant).

## 8. Explicitly out of scope for this spec

- **The full theme/template/transition system** (`Context.md` Roadmap item 6's remainder, beyond the `--css` opt-out in Phase 5). This needs its own brainstorming pass once reached — it's a genuinely open design question (named/registered themes? a theme marketplace? per-slide theme directives?) that this spec's research did not fully resolve, and `SOUL.md`'s "render faithfully, don't editorialize" value needs to be actively re-checked against whatever shape it takes.
- **The cross-browser PDF-export visual-fidelity check** (`Context.md` Roadmap item 3's remaining fast-follow). Independent QA/testing work on already-shipped functionality, not a new feature or fix — unblocked by and non-blocking to everything in this spec.
- **PPTX export.** Named in research as a plausible further-out extension; needs a real library decision this spec does not make.

## 9. Risks

- **Phase 4 (KaTeX/Mermaid) is the one phase where a "looks fine" implementation could quietly violate Non-Negotiable #1 or #2** — both anti-patterns in §6 are the *default* behavior of the most obvious library/tool choice in their respective ecosystems. Every Phase 4 PR needs an explicit self-check (and ideally a reviewer check) for CDN references and Puppeteer-in-the-dependency-tree before merge, not just passing tests.
- **Phase 3's live-reload test (fs.watch timing) is flagged as the plan's most likely source of test flakiness.** Budget real implementation time for this, not a quick add.
- **Phase 2 (segmentation) changes `render.ts`'s core output shape**, which every later phase depends on. Get this one genuinely right (including the backward-compat case) before starting Phase 3 or later.

## 10. Sequencing dependency graph

```
Phase 1 (Quick Wins) ── independent, can run in parallel with everything below
Phase 2 (Segmentation) ── blocks: Phase 5's notes & pagination items
Phase 3 (Live-reload) ── depends on: nothing new (independent of Phase 2)
Phase 4a (KaTeX) ── depends on: nothing new (independent of Phase 2/3)
Phase 4b (Mermaid) ── depends on: nothing new (independent of Phase 2/3/4a)
Phase 5 (Polish) ── the --css flag & PNG-export items depend only on Phase 1/2;
                     notes & pagination depend specifically on Phase 2
```

Only Phase 5's notes/pagination items strictly require Phase 2 first. Everything else can be sequenced by priority/preference, not hard dependency — the ordering in §2/§3–7 reflects the research's priority ranking (foundational-ness × impact ÷ effort), not a strict blocking chain.

## 11. References

- `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/CODEBASE_INDEX.md`
- `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/docs/research/feature-roadmap-research.md`
- `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/docs/research/cli-robustness-testing-research.md`
- `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/docs/research/security-performance-tooling-research.md`
- `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/Context.md`, `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/decisions.md`, `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/SOUL.md`, `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/CLAUDE.md`, `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/AGENTS.md`
