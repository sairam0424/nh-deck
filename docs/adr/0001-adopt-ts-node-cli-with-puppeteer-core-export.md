# 0001. Adopt TypeScript/Node CLI with puppeteer-core export

## Status

Accepted — 2026-09-02

## Context and Problem Statement

nh-deck is a local-first CLI tool for writing, presenting, and exporting
Markdown-based slide decks, built as our own version of
`arpitbbhayani/deckrun`, inside the three-project "Not-Humans-Lab" suite
(`daily-dose`, `nh-deck`, `nh-skills`). Before writing the first real
command, we need to decide the CLI's runtime/language, its command-line
framework, its Markdown → HTML rendering approach, its local preview
mechanism, its PDF export mechanism, and its build strategy.

The reference project's core value proposition, which we are explicitly
preserving, is **local-first**: the CLI never phones home, and rendered
HTML must not depend on any CDN for correctness. This constrains several
of the choices below — most visibly, it rules out reaching for a CDN
`<script>` tag as a shortcut for math (KaTeX) or diagram (Mermaid)
rendering, and it means any PDF export mechanism must run entirely on the
user's own machine against a browser they already have installed (or one
we bundle), not a remote rendering service.

We also want a walking skeleton fast: a minimal, correct render → serve →
export loop, gated by CI, before investing in anything more elaborate
(the full 3-OS CI matrix, KaTeX/Mermaid support). Every choice below is
evaluated against that near-term goal as well as long-term maintainability.

## Decision Drivers

- **Preserve the local-first / no-CDN constraint.** Any option that
  requires a network call for correctness (a hosted rendering API, a CDN
  script for math/diagrams) is disqualified. Deferring KaTeX/Mermaid
  entirely is preferred over reaching for a CDN workaround to get them in
  early.
- **Minimize dependency and install weight**, especially around PDF
  export. Full `puppeteer` bundles its own Chromium download (~300MB+),
  which is heavy for a CLI tool a user installs globally and conflicts
  with "small, fast, local" expectations for a slide-deck tool.
- **Match the reference project's build philosophy.** `deckrun` uses no
  bundler — plain transpilation. We want to carry that forward rather
  than introduce bundler configuration (esbuild/webpack/rollup) that the
  reference project's philosophy doesn't call for.
- **Fast walking skeleton over broad compatibility up front.** CI should
  start as single-OS (`ubuntu-latest`) and expand to the full 3-OS ×
  multi-Node-version matrix only after the core loop is proven — paying
  multi-OS CI cost before there's a working `render`/`serve`/`export` loop
  to protect is premature.
- **Ecosystem fit for a Node CLI.** Commander.js is the de facto standard
  for Node CLI argument parsing, with a stable API and no runtime
  surprises; introducing a less standard CLI framework for a small tool
  adds risk for no clear benefit.
- **Cross-suite consistency.** License (Apache-2.0) and the general
  polyrepo/testing conventions in `../Not-Humans-Lab/` are fixed
  constraints this ADR does not revisit, only respects.

## Considered Options

1. **TypeScript on Node.js (LTS 20/22+), Commander.js for the CLI
   surface, `marked` for Markdown → HTML, a plain `node:http` local dev
   server (no framework), `puppeteer-core` + `chrome-launcher` for PDF
   export via a locally detected browser binary, built with plain `tsc`
   (no bundler), tested with Vitest.**
2. **Rust or Go, shipped as a static binary.** Rewrite the CLI in a
   compiled systems language for a single-binary distribution with no
   Node.js runtime dependency for end users.
3. **Bun as the shipped runtime**, instead of Node.js, for the CLI
   itself (either as the dev/test runtime or as the thing end users
   invoke).
4. **Playwright instead of `puppeteer-core`** for the PDF export /
   headless-browser automation path.
5. **Bundle full `puppeteer`** (which ships its own Chromium) instead of
   `puppeteer-core` + `chrome-launcher`'s detect-first approach.

## Decision Outcome

Chosen option: **Option 1 — TypeScript/Node.js CLI on Commander.js +
`marked`, plain `node:http` dev server, `puppeteer-core` +
`chrome-launcher` for PDF export via a locally detected browser, `tsc`-only
build, Vitest for tests.**

Rationale, directly from the decision drivers above:

- **Rust/Go static-binary rewrite (Option 2)** would give a
  no-runtime-dependency single binary, which is attractive for
  distribution, but it throws away the reference project's Node/TS
  ecosystem fit and would require rewriting the Markdown-rendering and
  browser-automation integration from scratch in a language with a much
  thinner headless-Chrome-automation ecosystem than Node's. For a walking
  skeleton whose goal is proving the render/serve/export loop quickly,
  this is solving a distribution problem (no Node required) before
  solving the actual product problem. Rejected for this phase — worth
  revisiting only if binary distribution becomes a real, demonstrated
  need, not preemptively.
- **Bun as the shipped runtime (Option 3)** would give faster
  cold-start and a built-in bundler/test runner, but the target platform
  stated up front is Node.js LTS 20/22+, and `puppeteer-core` /
  `chrome-launcher`'s compatibility guarantees are written and tested
  against Node, not Bun. Adopting Bun now would trade a proven
  compatibility surface for a performance win we don't yet need at this
  project's size, and would put us ahead of the ecosystem's own stated
  target runtime. Rejected — Node LTS stays the baseline.
- **Playwright instead of `puppeteer-core` (Option 4)** is a strong,
  actively maintained alternative with its own browser-management story,
  but it defaults to *installing and managing its own browser binaries*
  per project — which reintroduces the install-weight problem we're
  trying to avoid by choosing `puppeteer-core` over full `puppeteer` in
  the first place. `puppeteer-core` paired with `chrome-launcher`'s
  detect-first approach (find an already-installed
  Chrome/Chromium/Edge/Brave binary) keeps nh-deck's own install small and
  keeps the CLI honestly local-first: it drives a browser the user
  already has, rather than downloading and managing one itself. Rejected
  for this project's install-weight goals — not a quality judgment against
  Playwright in general.
- **Bundling full `puppeteer` instead of detect-first `chrome-launcher`
  (Option 5)** would guarantee a consistent, version-pinned Chromium for
  every user, at the cost of a large bundled download and an extra
  Chromium binary the user almost certainly already has a browser that
  can substitute for. Given nh-deck is a CLI a user installs (often
  globally) purely to render their own decks, the weight cost outweighs
  the consistency benefit at this stage. Rejected — detect-first is
  accepted as a deliberate trade-off (see Consequences below), not an
  oversight.
- **`marked` over other Markdown parsers** was accepted as effectively
  uncontested for this phase: it's a stable, dependency-light, widely
  used Markdown → HTML library with no bundled math/diagram extensions
  that would tempt a CDN shortcut — consistent with deferring
  KaTeX/Mermaid explicitly rather than reaching for whatever a heavier
  Markdown library bundles by default.
- **Plain `node:http` over a framework (e.g., Express) for the dev
  server** was accepted as uncontested: the preview server's job is
  serving one rendered deck's HTML/assets locally, which does not need
  routing middleware, templating, or any of what a web framework provides.
  Adding Express would be dependency weight with no corresponding need
  (YAGNI).
- **`tsc`-only build (no bundler)** matches the reference project's
  stated "no bundler" philosophy directly and keeps the build step
  trivial to reason about: `tsc` transpiles, the shebang on the entry
  file is preserved, and `dist/index.js` becomes the npm `bin` entry with
  no bundler configuration to maintain.
- **Single-OS (`ubuntu-latest`) CI for the walking skeleton** is a
  deliberate, temporary scoping choice, not a decision to skip
  cross-platform support. The 3-OS × multi-Node-version matrix is a
  tracked upcoming milestone (see `status.md`), sequenced after the core
  loop is green so that matrix failures are debugged against a codebase
  that already works somewhere, not against zero working baseline.

## Consequences

**Good:**

- The CLI stays in one ecosystem end to end (Node/TypeScript), matching
  both the reference project and the rest of this workspace's tooling
  conventions, with no cross-language build step.
- Install weight stays small: no bundled Chromium, no bundler, no web
  framework — the CLI's own dependency footprint is `commander`,
  `marked`, `puppeteer-core`, and `chrome-launcher`, all named explicitly
  in `SECURITY.md`'s supply-chain section.
- The local-first / no-CDN constraint is structurally respected: nothing
  in this stack requires a network call to render, preview, or export a
  deck.
- `tsc`-only build keeps the build step simple to debug and matches the
  reference project's "no bundler" philosophy exactly.
- Deferring KaTeX/Mermaid is now an explicit, documented decision (here
  and in `status.md`/`decisions.md`) rather than a silent gap a future
  contributor might not notice.

**Bad:**

- **PDF export quality/behavior depends on whatever browser
  `chrome-launcher` finds** on a given machine — a user with only an
  unusual or very old browser installed may get inconsistent export
  results compared to a user with current Chrome. This is an accepted
  trade-off for install-weight reasons (see Option 5 rejection above),
  but it is a real support cost: bug reports about PDF export must ask
  which browser was detected (see `SUPPORT.md`).
  - **Case Chrome/Chromium/Edge/Brave are all absent**: `nh-deck export
    --pdf` must fail with a clear, actionable error (e.g., "no supported
    browser found — install Chrome, Chromium, Edge, or Brave, or set
    `--browser <path>`"), not a cryptic `chrome-launcher` stack trace. This
    is a confirmed requirement of the walking skeleton, not a
    nice-to-have.
- **No math/diagram rendering until the deferred fast-follow ships** —
  users who need KaTeX or Mermaid today have no workaround within
  nh-deck itself (and must not be pointed at a CDN-based workaround, per
  the local-first constraint).
- **Single-OS CI means Windows/macOS-specific bugs (e.g., in
  `chrome-launcher`'s browser-detection paths, which differ meaningfully
  by OS) will not be caught until the matrix expansion lands.** This is a
  known, time-boxed gap tracked in `status.md`, not an indefinite one.
- Choosing `puppeteer-core` over full `puppeteer` means the project must
  document (in `SUPPORT.md`/error messages) that a supported browser is a
  precondition for PDF export — full `puppeteer` would not have this
  precondition, at the cost of the install weight we rejected.

## Confirmation

This decision is confirmed as implemented when:

1. `nh-deck render <deck.md>` produces HTML via `marked` with no CDN
   references in the output, on Node.js LTS 20/22+.
2. `nh-deck serve` starts a `node:http` server bound to `127.0.0.1` only
   (never `0.0.0.0`) and serves the rendered deck for local preview.
3. `nh-deck export --pdf` successfully produces a PDF via
   `puppeteer-core` + `chrome-launcher` against at least one locally
   installed browser (Chrome, Chromium, Edge, or Brave), and fails with a
   clear, actionable error message when none is found.
4. The build produces `dist/index.js` via `tsc` alone (no bundler
   config), with the source file's shebang preserved and wired as the npm
   `bin` entry in `package.json`.
5. A single-OS (`ubuntu-latest`) GitHub Actions CI job runs the Vitest
   suite and the build on every PR, and is observed to fail a
   deliberately broken PR and pass a correct one.
6. No `katex` or `mermaid` dependency exists in `package.json` yet — their
   absence is itself part of confirming this ADR, since adding them
   early would contradict the deferral decision recorded here.

## More Information

- Source reasoning for this ADR is the TECH_DECISION context captured
  during Phase 4 planning for nh-deck; this document formalizes that
  reasoning in Michael Nygard's ADR format and does not introduce new
  rationale beyond it.
- Reference project this repo models itself on:
  `arpitbbhayani/deckrun`.
- Cross-cutting, system-level conventions shared with the sibling
  projects (`daily-dose`, `nh-skills`) — including the Apache-2.0 license
  decision — live in the separate docs-only meta-repo at
  `../Not-Humans-Lab/`; this ADR does not duplicate that content.
- See `decisions.md` (this repo, root) for the ADR index and the
  lightweight decisions log this ADR is tracked in.
- See `SECURITY.md` for how this decision interacts with the local-only
  server binding, the raw-HTML/XSS trust boundary, and the PDF-export
  command-injection guardrail — this ADR establishes the mechanism those
  security considerations constrain, not a substitute for that review.
- `nh-skills`' own `docs/adr/0001-adopt-markdown-only-skill-format-with-lint-gate.md`
  is a useful precedent for this ADR's format and level of detail (house
  style), though its subject matter — a zero-runtime skill format — is
  unrelated to nh-deck's rendering-CLI concerns.
