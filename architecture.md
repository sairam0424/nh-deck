# Architecture — nh-deck

This is nh-deck's **own** architecture document. Per arc42/C4 convention,
nh-deck is "the system" from its own point of view — everything outside this
repo's boundary (including the Not-Humans-Lab umbrella and its other sibling
projects) is an external actor, not an internal component. It describes the
walking-skeleton shape of the CLI: what exists (or is about to exist) at this
phase, not speculative future features.

## Context & Scope

nh-deck is a standalone, independent GitHub repository — a local-first CLI
tool for writing, presenting, and exporting Markdown-based slide decks,
matching this workspace's polyrepo convention (it is not nested inside
Not-Humans-Lab).

**nh-deck is not a hosted, multi-user product.** There are no user accounts,
no server-side persistence, no "shareable deck" hosting infrastructure. A
deck is a Markdown file on the user's own filesystem; the CLI reads it,
renders it, and either serves it locally or exports it to a local PDF file.
Everything runs on the user's own machine, for the user's own use.

```
                    ┌───────────────────────────────┐
                    │   Not-Humans-Lab (umbrella)    │
                    │  docs-only meta-repo, holds     │
                    │  cross-cutting system docs      │
                    │  (../Not-Humans-Lab/)           │
                    └───────────────┬─────────────────┘
                                    │ (thematic/lineage only —
                                    │  no build/runtime dependency)
                                    ▼
   ┌───────────────┐      ┌─────────────────────┐      ┌───────────────┐
   │  nh-skills     │◄────►│       nh-deck        │◄────►│  daily-dose    │
   │  (sibling,     │      │  THIS repo:          │      │  (planned      │
   │  Phase 1+2     │      │  local-first slide-   │      │  sibling,      │
   │  shipped)      │      │  deck CLI (render,    │      │  not yet built)│
   └───────────────┘      │  serve, export-to-PDF) │      └───────────────┘
                          └──────────┬────────────┘
                                     │
                          ┌──────────▼────────────┐
                          │  User's local machine   │
                          │  (filesystem, a locally │
                          │   installed Chrome-      │
                          │   family browser,        │
                          │   127.0.0.1 loopback)    │
                          └─────────────────────────┘
```

- **Not-Humans-Lab** (external actor): a docs-only meta-repo holding
  cross-cutting, system-level docs shared by the three sibling projects. It
  is read from (relative links), never duplicated into this repo.
- **nh-skills, daily-dose** (external actors): sibling projects under the
  same umbrella. nh-skills is a completed precedent for house style; neither
  it nor daily-dose is a runtime dependency of nh-deck.
- **The user's local machine** (external actor, and the *only* runtime
  environment this system ever touches): the filesystem holding the
  Markdown source and the exported PDF, a locally installed Chrome-family
  browser used for PDF export, and the loopback interface (`127.0.0.1`) the
  dev server binds to. No remote host, no cloud service, no CDN is ever in
  this picture.
- **In scope for nh-deck itself**: parsing CLI arguments; rendering
  Markdown to a self-contained HTML string; serving that HTML locally for
  live viewing/presenting; exporting it to a local PDF file via a detected
  local browser.
- **Out of scope for nh-deck itself**: user accounts, hosted "shareable
  deck" links, any server-side persistence, any CDN-dependent rendering path,
  and anything belonging to nh-skills or daily-dose.

## Building Block View

Four real building blocks make up the walking skeleton:

```
nh-deck/
├── src/index.ts        Building block 1: CLI entrypoint (Commander)
│                            — defines "render" and "pdf" subcommands,
│                              parses flags (e.g. --no-open), dispatches
│                              to the render/server/pdfExport modules.
│
├── src/render.ts        Building block 2: Render module
│                            — generateHtml(markdown): reads a deck's
│                              Markdown source and produces a self-contained
│                              HTML string via `marked`. Pure function, no
│                              I/O of its own — the CLI layer handles
│                              reading the source file and writing/serving
│                              the result.
│
├── src/server.ts        Building block 3: Local dev server
│                            — a plain node:http server that serves the
│                              rendered HTML on an ephemeral local port,
│                              honors --no-open, and prints the serving URL
│                              to stdout.
│
└── src/pdfExport.ts      Building block 4: PDF export module
                              — detects a local Chrome-family browser via
                                chrome-launcher, drives it via
                                puppeteer-core to print the rendered HTML
                                to a PDF file.
```

Relationships:

- Building block 1 (CLI) is the only consumer of Building blocks 2, 3, and
  4 — it reads the file from disk, calls Building block 2 to get HTML, then
  hands that HTML to either Building block 3 (`render` command) or Building
  block 4 (`pdf` command).
- Building block 2 (render) has no dependency on 3 or 4 — it is a pure
  `markdown -> HTML string` function, independently unit-testable.
- Building block 3 (server) and Building block 4 (PDF export) do not depend
  on each other — they are two independent consumers of Building block 2's
  output, selected by which CLI subcommand the user ran.
- Building block 4 depends on a local Chrome-family browser being
  discoverable on the host machine; if none is found, it must fail with a
  clear, non-crashing error rather than attempting to download one.

## Runtime View

### Flow 1 — `nh-deck render <file>`

```
 1. User runs: nh-deck render <file>
              │
              ▼
 2. CLI entrypoint (src/index.ts) reads <file> from disk
              │
              ▼
 3. render.ts: generateHtml(markdown) -> HTML string
              │
              ▼
 4. server.ts starts a node:http server on an ephemeral port,
    serving the HTML string
              │
              ▼
 5. Prints to stdout: "Serving <file> at http://127.0.0.1:<port>"
              │
              ▼
 6. Unless --no-open was passed, opens the user's default browser
    to that URL
```

### Flow 2 — `nh-deck pdf <file>`

```
 1. User runs: nh-deck pdf <file>
              │
              ▼
 2. CLI entrypoint (src/index.ts) reads <file> from disk
              │
              ▼
 3. render.ts: generateHtml(markdown) -> HTML string
              │
              ▼
 4. pdfExport.ts: chrome-launcher detects a local Chrome-family
    browser (Chrome, Chromium, Edge, or Brave)
              │
        found ─┼─ not found
        │             │
        ▼             ▼
 5. puppeteer-core   Fail with a clear, non-crashing error message
    drives the        (e.g. "No local Chrome-family browser found —
    detected browser   install one and retry.") and exit non-zero.
    to print the       An automatic browser-download fallback is a
    HTML to PDF        deferred fast-follow, not implemented here.
              │
              ▼
 6. Writes the PDF to the requested output path
```

## Cross-references

- Umbrella-level, cross-cutting architecture context (C4 Level 1, with
  nh-deck as one of three sibling boxes) is owned by
  `../Not-Humans-Lab/architecture.md` — link there rather than duplicating.
- This repo's literal file/directory tour lives in `codebase_map.md`
  alongside this file.
- The technology choices underlying these building blocks are documented in
  `tech.md`.
- Test strategy for the two runtime flows above (unit-testing
  `generateHtml`, integration-testing the CLI process's stdout, e2e-testing
  the packed binary) is documented in `TESTING.md`.
