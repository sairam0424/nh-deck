# Phase 2 — Real Per-Slide Segmentation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `generateHtml()`'s single undivided HTML document into `<section class="slide">` blocks on each top-level `---` thematic break, delegating all of CommonMark's own disambiguation (setext-heading-vs-thematic-break, `---` inside fenced code) to `marked`'s own tokenizer rather than hand-rolled regex.

**Architecture:** Tokenize the whole document once via `marked.lexer()`, group the resulting top-level tokens into per-slide arrays at each `hr` token, render each group independently via `marked.parser()`, and wrap each in its own `<section>`. Verified empirically against the actual installed `marked` version (see ADR-0002, Task 3) — this is not a design assumption.

**Tech Stack:** TypeScript, `marked`'s `lexer`/`parser` public API (already a dependency, no new package).

**Spec:** `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/docs/specs/feature-implementation-roadmap-design.md` (§4, "Phase 2 — Foundational: Real Slide Segmentation")

## Global Constraints

- No new runtime dependency — use `marked`'s existing `lexer`/`parser` API, not a new package.
- Do not hand-roll Markdown parsing (AGENTS.md Code Style) — slide-boundary detection must come from `marked`'s own tokenizer output (`hr` token type), never a regex over the raw Markdown string.
- `generateHtml` must stay a pure, synchronous function — no I/O, no async.
- Backward compatibility is mandatory: a deck with zero `---` delimiters must render as exactly one `<section class="slide">`, not zero and not a crash.
- TypeScript strict mode; ESM/NodeNext import style (`.js` extensions on relative imports).
- Every commit follows Conventional Commits; every change goes through a PR, even solo; CI must pass before merge; squash-merge only; branch naming `type/scope-slug`.
- A decision that "changes how a deck is rendered, previewed, or exported" meets this repo's own bar for a full ADR (`decisions.md`) — this phase's core mechanism qualifies (see Task 3).

## Setup (before Task 1)

- [ ] **Create and check out the feature branch, off current `main` (not the unmerged Phase 1 branch — this phase doesn't touch any file Phase 1 changed)**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/slide-segmentation
```

---

### Task 1: Core segmentation algorithm + baseline CSS in `render.ts`

**Files:**
- Modify: `src/render.ts`
- Modify: `tests/render.test.ts` (new `describe` block, synthetic/inline Markdown only — no fixture dependency)

**Interfaces:**
- Consumes: nothing new.
- Produces: `generateHtml(markdown: string, title?: string): string` — signature unchanged; internal behavior now wraps output in per-slide `<section>` elements. A new non-exported helper `splitIntoSlides(tokens: Token[]): Token[][]` is internal to `render.ts`, not part of the public interface.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `tests/render.test.ts`, after the existing `describe("generateHtml", ...)` block:

```ts
describe("generateHtml — slide segmentation", () => {
  it("wraps single-slide content in exactly one <section> when there is no delimiter", () => {
    const html = generateHtml("# Only slide\n\nSome text.");
    const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
    expect(sectionCount).toBe(1);
  });

  it("splits into multiple sections on a --- preceded by a blank line", () => {
    const html = generateHtml(
      "# Slide 1\n\nFirst.\n\n---\n\n# Slide 2\n\nSecond.",
    );
    const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
    expect(sectionCount).toBe(2);
    expect(html).toContain("<h1>Slide 1</h1>");
    expect(html).toContain("<h1>Slide 2</h1>");
  });

  it("does not split on a --- immediately after a paragraph (setext H2 heading)", () => {
    const html = generateHtml("Some Text\n---\nMore text.");
    const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
    expect(sectionCount).toBe(1);
    expect(html).toContain("<h2>Some Text</h2>");
  });

  it("does not split on a --- inside a fenced code block", () => {
    const html = generateHtml(
      "Before.\n\n```\ncode\n---\nmore code\n```\n\nAfter.",
    );
    const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
    expect(sectionCount).toBe(1);
    expect(html).toContain("---\nmore code");
  });

  it("filters out an empty slide produced by two consecutive delimiters", () => {
    const html = generateHtml(
      "# Slide 1\n\nFirst.\n\n---\n\n---\n\n# Slide 2\n\nSecond.",
    );
    const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
    expect(sectionCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/render.test.ts -t "slide segmentation"`
Expected: FAIL — `generateHtml` doesn't yet produce any `<section class="slide">` elements at all (0 matches against every expected count).

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/render.ts` with:

```ts
import { marked } from "marked";
import type { Token } from "marked";

/**
 * Converts Markdown source into a complete, self-contained HTML document,
 * split into `<section class="slide">` blocks on each top-level `---`
 * thematic break.
 *
 * Slide-boundary detection is delegated entirely to marked's own tokenizer
 * (see splitIntoSlides below) rather than a hand-rolled regex over the raw
 * Markdown string, because CommonMark's own grammar is ambiguous here: a
 * `---` immediately after a paragraph line (no blank line) is a setext H2
 * heading underline, not a thematic break, and a `---` inside a fenced code
 * block is never a break at all. marked's tokenizer already resolves both
 * cases correctly (verified directly against its lexer output) — see
 * docs/adr/0002-per-slide-segmentation.md for the full comparison against
 * a regex-based alternative.
 *
 * Local-first constraint: the returned document must never reference any
 * external CDN (no <script src="https://...">, no <link href="https://...">).
 * Everything needed to render correctly is inlined.
 *
 * KaTeX (math) and Mermaid (diagrams) rendering are explicitly deferred as a
 * fast-follow feature and are NOT wired up here yet.
 */
export function generateHtml(markdown: string, title?: string): string {
  const tokens = marked.lexer(markdown);
  const slidesHtml = splitIntoSlides(tokens)
    .map(
      (slideTokens) =>
        `<section class="slide">\n${marked.parser(slideTokens)}</section>`,
    )
    .join("\n");
  const pageTitle = escapeHtml(
    title && title.trim().length > 0 ? title : "nh-deck",
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle}</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      max-width: 860px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
      color: #1a1a1a;
      background: #ffffff;
    }
    h1, h2, h3, h4, h5, h6 {
      line-height: 1.25;
      margin-top: 2rem;
      margin-bottom: 0.75rem;
    }
    h1 { font-size: 2rem; border-bottom: 1px solid #e0e0e0; padding-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; }
    p { margin: 0.75rem 0; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: #f2f2f2;
      padding: 0.15em 0.35em;
      border-radius: 4px;
      font-size: 0.9em;
    }
    pre {
      background: #f2f2f2;
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
    }
    blockquote {
      border-left: 4px solid #d0d0d0;
      margin: 1rem 0;
      padding: 0.25rem 1rem;
      color: #555555;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
    }
    th, td {
      border: 1px solid #d0d0d0;
      padding: 0.5rem 0.75rem;
      text-align: left;
    }
    img {
      max-width: 100%;
    }
    a {
      color: #0b5fff;
    }
    .slide {
      margin-bottom: 3rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid #e0e0e0;
    }
    .slide:last-of-type {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #e6e6e6; background: #121212; }
      h1 { border-bottom-color: #333333; }
      code, pre { background: #1e1e1e; }
      blockquote { border-left-color: #444444; color: #b0b0b0; }
      th, td { border-color: #333333; }
      a { color: #6ea8ff; }
      .slide { border-bottom-color: #333333; }
    }
  </style>
</head>
<body>
${slidesHtml}
</body>
</html>
`;
}

/**
 * Groups a top-level token stream into one array per slide, dividing at
 * each "hr" token (marked's tokenizer output for a `---` thematic break).
 * Two consecutive "hr" tokens — or a leading/trailing one — produce an
 * empty group; those are filtered out rather than rendered as a blank
 * slide. A stream with no "hr" tokens at all produces exactly one group
 * (the required backward-compatibility case for a deck with no delimiter).
 */
function splitIntoSlides(tokens: Token[]): Token[][] {
  const groups: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.type === "hr") {
      groups.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  groups.push(current);
  return groups.filter((group) =>
    group.some((token) => token.type !== "space"),
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/render.test.ts`
Expected: PASS — both the 4 pre-existing tests (unaffected: they use `.toContain(...)`, which still matches inside the new `<section>` wrapper) and the 5 new segmentation tests.

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: PASS (all files — `render.test.ts`'s changes don't affect `cli.test.ts`, `pdfExport.test.ts`, `server.test.ts`, or `cliHelpers.test.ts`, since none of them inspect rendered HTML content beyond what `render.test.ts` already covers)

- [ ] **Step 6: Commit**

```bash
git add src/render.ts tests/render.test.ts
git commit -m "feat(render): split decks into <section class=\"slide\"> blocks on --- boundaries"
```

---

### Task 2: Extend the real fixture to a multi-slide deck

**Files:**
- Modify: `fixtures/sample.md`
- Modify: `tests/render.test.ts` (add assertions against the real fixture's new slide count/content)

**Interfaces:** N/A (fixture content + test assertions only; no code change).

- [ ] **Step 1: Extend the fixture**

Replace the full contents of `fixtures/sample.md` with:

```markdown
# Getting Started with nh-deck

nh-deck turns a single Markdown file into a slide deck you can present or
export to PDF. Everything runs locally on your own machine.

Key features of the walking skeleton:

- Render Markdown to a self-contained HTML document
- Serve the deck locally with `nh-deck render`
- Export the rendered deck to PDF via a local Chrome binary

Here's a minimal example of starting the dev server from the CLI:

```bash
nh-deck render fixtures/sample.md --port 4000
```

No accounts, no hosting, no CDN dependencies — just your Markdown file.

---

# Presenting Your Deck

Once a deck is rendered, `nh-deck render` serves it locally so you can
present straight from the browser — no build step, no upload.

---

# Exporting to PDF

When you're ready to share a static copy, `nh-deck pdf` exports the same
rendered deck to a PDF file using a browser already installed on your
machine.
```

- [ ] **Step 2: Add assertions for the fixture's new slide structure**

Add these two `it(...)` cases to the existing `describe("generateHtml", ...)` block in `tests/render.test.ts` (alongside the 4 pre-existing cases, before the closing `});` of that block — not inside the "slide segmentation" `describe` block added in Task 1, since these test the real fixture, matching that block's existing style):

```ts
  it('splits the fixture into three <section class="slide"> blocks on its --- delimiters', () => {
    const html = generateHtml(fixtureMarkdown, "sample");
    const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
    expect(sectionCount).toBe(3);
  });

  it("renders each of the fixture's three slide headings inside its own section", () => {
    const html = generateHtml(fixtureMarkdown, "sample");

    expect(html).toContain("<h1>Getting Started with nh-deck</h1>");
    expect(html).toContain("<h1>Presenting Your Deck</h1>");
    expect(html).toContain("<h1>Exporting to PDF</h1>");
  });
```

- [ ] **Step 3: Run the render test file to verify everything passes**

Run: `npx vitest run tests/render.test.ts`
Expected: PASS — all 4 pre-existing fixture-based tests still pass unchanged (they only assert on slide 1's content, which is untouched), the 2 new fixture-based tests pass, and Task 1's 5 synthetic tests still pass.

- [ ] **Step 4: Run the full test suite to confirm no regression in files that also use this fixture**

Run: `npm test`
Expected: PASS — `tests/cli.test.ts` and `tests/pdfExport.test.ts` both use `fixtures/sample.md` but only assert on the stdout serving-URL pattern and the exported PDF's existence/magic-number, never on rendered HTML content, so the fixture's new slides don't affect them.

- [ ] **Step 5: Commit**

```bash
git add fixtures/sample.md tests/render.test.ts
git commit -m "test(render): extend the sample fixture to a 3-slide deck"
```

---

### Task 3: Record the decision (ADR) and reconcile the roadmap

**Files:**
- Create: `docs/adr/0002-per-slide-segmentation.md`
- Modify: `decisions.md` (ADR Index)
- Modify: `Context.md` (Roadmap item 4 → done)

**Interfaces:** N/A (docs only).

**Rationale for a full ADR, not just a Lightweight Decisions Log row:** `decisions.md`'s own bar says a decision qualifies for a full ADR when it "changes how a deck is rendered, previewed, or exported — the Markdown → HTML pipeline." This phase does exactly that.

- [ ] **Step 1: Write the ADR**

Create `docs/adr/0002-per-slide-segmentation.md`:

```markdown
# 0002. Adopt per-slide segmentation via marked's lexer/parser split

## Status

Accepted — 2026-09-10

## Context and Problem Statement

`generateHtml()` renders the entire input Markdown file as a single,
undivided HTML document — there is no `---`-based (or other) mechanism for
splitting a deck into presentable slides, even though nh-deck's own docs
and example fixture already write decks as if `---` marks a slide
boundary. This blocks every deferred feature that assumes real slide
boundaries exist (presenter notes, per-slide PDF pagination, live-reload
navigation). We need to decide how a deck gets split into slides, and how
to avoid CommonMark's own ambiguity around `---`: a `---` immediately
after a paragraph is a setext H2 heading underline, not a thematic break.

## Decision Drivers

- Must not hand-roll Markdown parsing (`AGENTS.md` Code Style) — whatever
  disambiguates a slide-boundary `---` from a setext-heading `---`, or
  from a `---` inside a fenced code block, must come from `marked`'s own
  tokenizer, not a bespoke regex.
- Must keep `generateHtml`'s existing pure, synchronous shape — both the
  `render` and `pdf` commands depend on it staying that way.
- Must preserve backward compatibility: an existing deck with no `---` at
  all must still render correctly, as a single slide, not break or
  produce zero output.
- No new runtime dependency — `marked` is already a dependency; the
  mechanism should use its existing public API.

## Considered Options

1. **Split the raw Markdown string on a `---`-matching regex, before
   calling `marked.parse()`.**
2. **Tokenize the whole document once via `marked.lexer()`, group the
   resulting top-level tokens into slides at each `hr` token, then render
   each group independently via `marked.parser()`.**
3. **Post-process the rendered HTML string, splitting on `<hr>` tags.**

## Decision Outcome

Chosen option: **Option 2 — lexer/parser token-group split.**

- **Option 1 (regex on raw string)** was rejected: verified directly
  against `marked.lexer()`'s output that a `---` immediately after a
  paragraph line (no blank line) produces a `heading` token (setext H2),
  not an `hr` token — a naive regex split would incorrectly treat that as
  a slide boundary and mangle the heading. A regex would also need to
  separately special-case fenced code blocks (where a literal `---` inside
  \`\`\`...\`\`\` must not split) — exactly the kind of Markdown-parsing-in-
  userland this project's coding style rule forbids.
- **Option 3 (post-process rendered HTML)** was rejected: by the time
  HTML is rendered, there is no reliable, unambiguous marker distinguishing
  a slide-boundary `<hr>` from any `<hr>` a user's Markdown might
  legitimately contain for a different reason — that distinction is only
  recoverable at the token level, before rendering.
- **Option 2** was verified empirically, directly against the installed
  `marked` version, using its stable public `lexer`/`parser` API: a `---`
  after a blank line produces a distinct `hr` token; the same `---`
  immediately after a paragraph produces a `heading` token instead; a
  `---` inside a fenced code block never leaves the enclosing `code`
  token's raw content. Grouping the top-level token array at `hr`
  boundaries and rendering each group independently via `marked.parser()`
  therefore delegates all of CommonMark's own disambiguation to `marked`'s
  tokenizer. Two consecutive `hr` tokens produce an empty group, filtered
  out rather than rendered as a blank slide. A document with zero `hr`
  tokens produces exactly one group — the required backward-compatibility
  case.

## Consequences

**Good:**

- Zero new dependency; `marked.lexer`/`marked.parser` are the same
  library already in use, just its two-phase public API instead of the
  combined `marked.parse()`.
- Slide-boundary disambiguation is exactly as correct as CommonMark
  itself, with no bespoke edge-case handling to maintain.
- `generateHtml` stays a pure, synchronous function.

**Bad:**

- Slightly more code than a one-line regex split, for a reader
  unfamiliar with `marked`'s lexer/parser split — mitigated with an
  explanatory comment at the call site in `render.ts`.
- Reference-style link definitions (`[text][ref]` / `[ref]: url`) are
  resolved during the single whole-document `marked.lexer()` call, before
  any slide-group splitting happens — verified this still resolves
  correctly even when the definition and its use land in different token
  groups, since `marked` bakes the resolved `href` into the link's inline
  token at lex time rather than deferring to a shared lookup at render
  time.

## Confirmation

This decision is confirmed as implemented when:

1. `generateHtml()` wraps each `---`-delimited slide in its own
   `<section class="slide">` element.
2. A deck with no `---` still renders as exactly one
   `<section class="slide">`.
3. A `---` immediately following a paragraph (setext H2 heading) does
   not create a new section.
4. A `---` inside a fenced code block does not create a new section.
5. `fixtures/sample.md` renders as three sections, and
   `tests/render.test.ts` asserts this.

## More Information

- See `docs/specs/feature-implementation-roadmap-design.md` §4 for how
  this fits into the broader Phase 2 roadmap item.
- See `Context.md`'s Roadmap, item 4.
```

- [ ] **Step 2: Add the ADR to `decisions.md`'s ADR Index**

Modify the ADR Index table in `decisions.md` from:

```markdown
| ID   | Title                                                                      | Status   | Date       | Supersedes |
| ---- | ----------------------------------------------------------------------------- | -------- | ---------- | ---------- |
| 0001 | [Adopt TS/Node CLI with puppeteer-core export](docs/adr/0001-adopt-ts-node-cli-with-puppeteer-core-export.md) | Accepted | 2026-09-02 | —          |
```

to:

```markdown
| ID   | Title                                                                      | Status   | Date       | Supersedes |
| ---- | ----------------------------------------------------------------------------- | -------- | ---------- | ---------- |
| 0001 | [Adopt TS/Node CLI with puppeteer-core export](docs/adr/0001-adopt-ts-node-cli-with-puppeteer-core-export.md) | Accepted | 2026-09-02 | —          |
| 0002 | [Adopt per-slide segmentation via marked's lexer/parser split](docs/adr/0002-per-slide-segmentation.md) | Accepted | 2026-09-10 | —          |
```

- [ ] **Step 3: Mark Roadmap item 4 done in `Context.md`**

Modify the Roadmap section in `Context.md`, changing item 4 from:

```markdown
4. Real per-slide segmentation (`---` → `<section>` boundaries) — foundational; item 6 below depends on this.
```

to:

```markdown
4. ~~Real per-slide segmentation (`---` → `<section>` boundaries).~~ Done — `generateHtml()` now splits on `---` via `marked`'s lexer/parser token-group split (see `docs/adr/0002-per-slide-segmentation.md`); item 6 below (presenter notes + PDF pagination) can now build on this.
```

Also update the file's "Last updated" footer line to `2026-09-10` if it does not already say so.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0002-per-slide-segmentation.md decisions.md Context.md
git commit -m "docs: record ADR-0002 (per-slide segmentation) and mark Roadmap item 4 done"
```

---

## After all tasks: open the PR

```bash
git push -u origin feat/slide-segmentation
```

Then open a PR against `main` per `Branches.md`'s PR-required policy (squash-merge only; the squash commit message must itself be a valid Conventional Commit — e.g. `feat(render): split decks into per-slide sections (Phase 2)`). Wait for CI to go green before merging. Note this branch was cut from `main`, independent of the still-open Phase 1 PR (#2) — neither depends on the other; they can merge in either order.
