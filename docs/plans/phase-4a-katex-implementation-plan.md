# Phase 4a — KaTeX Math Rendering (Local-Only) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LaTeX math rendering via KaTeX, with zero CDN dependency anywhere — fonts inlined as base64 `data:` URIs directly in the existing `<style>` block, no fallback path to a remote source at all. This is explicitly the highest-risk item in the roadmap (`docs/specs/feature-implementation-roadmap-design.md` §6): two of the five tools researched for the feature-roadmap phase (reveal.js's official plugins, Marp Core) default to exactly the CDN pattern this must avoid.

**Explicit scope authorization:** nh-deck's `CLAUDE.md` requires stopping and asking before any diff that could introduce a runtime network dependency, specifically naming KaTeX as the example. The user explicitly confirmed proceeding with this exact local-only design (fonts inlined, no CDN fallback) in the live session this plan is written from — see the spec's own §0 for the standing authorization this extends.

**Architecture:** `marked-katex-extension` registers proper marked tokenizer/renderer extensions (not hand-rolled regex — verified directly against its source) for inline (`$...$`) and block (`$$...$$`) math, calling KaTeX's Node-side `katex.renderToString()` (synchronous, browser-free). A new `src/katexAssets.ts` module reads KaTeX's own shipped CSS and font files at runtime (via `import.meta.resolve`, since `katex` is a real npm dependency), rewrites every `@font-face` rule's `src` to a base64 `data:` URI (woff2 only — universally supported, ~4x smaller than including woff+ttf too), and memoizes the result (it depends only on the installed package, never on user content). `render.ts` includes this embedded CSS in its `<style>` block **only when the rendered output actually contains KaTeX markup** — a deck with no math incurs zero size cost.

**Tech Stack:** `katex` (0.18.x), `marked-katex-extension` (5.x) — both new runtime `dependencies`, not devDependencies (used by the shipped CLI at runtime, not just tooling).

**Spec:** `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/docs/specs/feature-implementation-roadmap-design.md` (§6, "Phase 4 — Math & Diagrams", KaTeX sub-phase)

**Everything below was verified empirically before writing this plan, not assumed:**
- `katex@0.18.7`'s own dependency tree is clean (`commander` only, for its own unrelated CLI — no DOM library, no network library).
- `marked-katex-extension@5.1.12` has zero regular dependencies, only peer deps on `katex`/`marked`, and its source (read directly) registers real `marked.use({extensions: [...]})` tokenizers — not string-replace regex — so it correctly composes with Phase 2's `marked.lexer()`/`marked.parser()` split and correctly leaves `$` inside inline code and fenced code blocks untouched (verified directly: `` `$5` `` and a fenced block containing `$HOME`/`$5` both render as literal text, never as math).
- `katex.renderToString(text, { throwOnError: false })` gracefully degrades invalid LaTeX to a visible, styled `<span class="katex-error" title="...">` instead of throwing — one malformed formula does not crash the whole render.
- KaTeX ships 20 font families; woff2-only totals ~296KB raw / ~360KB after base64 encoding + the ~24KB CSS. A full round-trip (render math → embed CSS → load in a real browser via `browse`) showed **zero network requests beyond the local file itself, zero console errors**, and visually correct rendering (checked directly with a screenshot).
- `katex`'s `package.json` `exports` field includes a `"./*": "./*"` wildcard, so `import.meta.resolve("katex/dist/katex.min.css")` and `import.meta.resolve("katex/dist/fonts/<name>.woff2")` both resolve correctly at runtime — verified directly.
- The MathML markup KaTeX emits includes `xmlns="http://www.w3.org/1998/Math/MathML"` — an XML namespace *identifier*, never fetched by a browser (exactly like SVG's `xmlns`), **not** a CDN reference. A blanket `not.toMatch(/https?:\/\//)` test would false-positive on this. Tests here use the same hostname-based check already established in `tests/render.test.ts` (`cdn.`, `unpkg.com`, `jsdelivr.net`, `cdnjs.cloudflare.com`), not a blanket protocol regex.

## Global Constraints

- **No CDN fallback path, anywhere, under any option** — this is the one constraint every task must be checked against explicitly, not just the phase as a whole.
- `katex` and `marked-katex-extension` go in `package.json`'s `"dependencies"`, not `"devDependencies"` — they're used by the shipped CLI at render time.
- `generateHtml` must stay a pure, synchronous function — no I/O inside the function body itself on every call; the one-time asset read is memoized (computed once per process, not per render).
- Do not hand-roll Markdown parsing (`AGENTS.md` Code Style) — math-delimiter detection must go through `marked`'s own extension API, never a bespoke regex over the rendered or raw string.
- A deck with no math must incur zero size/behavior cost — no KaTeX CSS or fonts embedded unless the output actually contains `class="katex"`.
- TypeScript strict mode; ESM/NodeNext import style (`.js` extensions on relative imports).
- File naming: camelCase, matching `render.ts`/`server.ts`/`pdfExport.ts`/`cliHelpers.ts` (e.g. `katexAssets.ts`).
- Every commit follows Conventional Commits; every change goes through a PR, even solo; CI must pass before merge; squash-merge only; branch naming `type/scope-slug`.
- A decision that changes how a deck is rendered, previewed, or exported meets this repo's own bar for a full ADR (`decisions.md`) — this phase's font-embedding mechanism qualifies.

## Setup (before Task 1)

- [ ] **Create and check out the feature branch, off current `main`**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/katex-math
```

---

### Task 1: `src/katexAssets.ts` — locally-embedded KaTeX CSS/fonts

**Files:**
- Create: `src/katexAssets.ts`
- Create: `tests/katexAssets.test.ts`

**Interfaces:**
- Produces: `getEmbeddedKatexCss(): string` — returns KaTeX's stylesheet with every `@font-face` `src` rewritten to a base64 `data:font/woff2` URI. Memoized (same string instance returned on repeated calls within one process). Used by Task 2's `render.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/katexAssets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getEmbeddedKatexCss } from "../src/katexAssets.js";

describe("getEmbeddedKatexCss", () => {
  it("returns CSS with every @font-face src rewritten to a base64 data URI", () => {
    const css = getEmbeddedKatexCss();

    expect(css).toContain("@font-face");
    expect(css).toContain("url(data:font/woff2;base64,");
  });

  it("leaves no relative fonts/ path references behind", () => {
    const css = getEmbeddedKatexCss();

    expect(css).not.toMatch(/url\(fonts\//);
  });

  it("never references an external CDN (local-first constraint)", () => {
    const css = getEmbeddedKatexCss();

    expect(css).not.toMatch(/https?:\/\/cdn\./i);
    expect(css).not.toContain("unpkg.com");
    expect(css).not.toContain("jsdelivr.net");
    expect(css).not.toContain("cdnjs.cloudflare.com");
  });

  it("memoizes the result across repeated calls", () => {
    const first = getEmbeddedKatexCss();
    const second = getEmbeddedKatexCss();

    expect(first).toBe(second);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/katexAssets.test.ts`
Expected: FAIL — `src/katexAssets.ts` doesn't exist yet.

- [ ] **Step 3: Add the runtime dependencies**

Run: `npm install katex@^0.18.7 marked-katex-extension@^5.1.12`

Confirm both landed under `"dependencies"` in `package.json` (not `"devDependencies"`) — if `npm install` placed them correctly, no manual edit is needed; verify by reading the file.

- [ ] **Step 4: Write the implementation**

Create `src/katexAssets.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FONT_FACE_SRC_PATTERN =
  /url\(fonts\/([^)]+\.woff2)\)\s*format\("woff2"\)(?:,url\([^)]+\)\s*format\("(?:woff|truetype)"\))*/g;

let cachedCss: string | undefined;

/**
 * Returns KaTeX's own stylesheet with every @font-face rule's src rewritten
 * to an embedded base64 data URI (woff2 only -- universally supported by
 * modern browsers, and roughly a quarter the size of also including woff
 * and ttf fallbacks). This is what makes math rendering local-first: the
 * fonts KaTeX needs ship inside the rendered HTML document itself, never
 * fetched from a CDN.
 *
 * Memoized: this depends only on the installed `katex` package's own
 * shipped assets, never on user content, so it is computed once per
 * process rather than once per render.
 */
export function getEmbeddedKatexCss(): string {
  if (cachedCss !== undefined) {
    return cachedCss;
  }

  const cssPath = fileURLToPath(
    import.meta.resolve("katex/dist/katex.min.css"),
  );
  const css = readFileSync(cssPath, "utf8");
  const fontsDir = path.join(path.dirname(cssPath), "fonts");

  cachedCss = css.replace(FONT_FACE_SRC_PATTERN, (_match, filename: string) => {
    const fontPath = path.join(fontsDir, filename);
    const base64 = readFileSync(fontPath).toString("base64");
    return `url(data:font/woff2;base64,${base64}) format("woff2")`;
  });

  return cachedCss;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/katexAssets.test.ts`
Expected: PASS (all 4 cases)

- [ ] **Step 6: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/katexAssets.ts tests/katexAssets.test.ts
git commit -m "feat(render): add locally-embedded KaTeX CSS/fonts (no CDN fallback)"
```

---

### Task 2: Wire KaTeX into `render.ts`

**Files:**
- Modify: `src/render.ts`
- Modify: `tests/render.test.ts`

**Interfaces:**
- Consumes: `getEmbeddedKatexCss(): string` (Task 1).
- Produces: no change to `generateHtml`'s public signature.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `tests/render.test.ts`, after the existing `describe("generateHtml — slide segmentation", ...)` block:

```ts
describe("generateHtml — KaTeX math", () => {
  it("renders inline math via KaTeX", () => {
    const html = generateHtml("Einstein: $E = mc^2$.");

    expect(html).toContain('class="katex"');
  });

  it("renders block/display math via KaTeX", () => {
    const html = generateHtml("$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$");

    expect(html).toContain('class="katex-display"');
  });

  it("does not treat $ inside inline code as math", () => {
    const html = generateHtml("Price: `$5` today.");

    expect(html).toContain("<code>$5</code>");
    expect(html).not.toContain('class="katex"');
  });

  it("does not treat $ inside a fenced code block as math", () => {
    const html = generateHtml("```\necho $HOME costs $5\n```");

    expect(html).toContain("echo $HOME costs $5");
    expect(html).not.toContain('class="katex"');
  });

  it("gracefully degrades invalid LaTeX instead of throwing", () => {
    expect(() => generateHtml("Broken: $\\frac{1$.")).not.toThrow();
    const html = generateHtml("Broken: $\\frac{1$.");

    expect(html).toContain('class="katex-error"');
  });

  it("does not embed KaTeX CSS/fonts when no math is present", () => {
    const html = generateHtml("# Just a heading\n\nNo math here.");

    expect(html).not.toContain("KaTeX_Main");
  });

  it("embeds KaTeX fonts locally with no CDN reference when math is present", () => {
    const html = generateHtml("Math: $x^2$.");

    expect(html).toContain("KaTeX_Main");
    expect(html).not.toMatch(/https?:\/\/cdn\./i);
    expect(html).not.toContain("unpkg.com");
    expect(html).not.toContain("jsdelivr.net");
    expect(html).not.toContain("cdnjs.cloudflare.com");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/render.test.ts -t "KaTeX math"`
Expected: FAIL — `generateHtml` doesn't render math yet.

- [ ] **Step 3: Write the implementation**

Modify the top of `src/render.ts` — change:

```ts
import { marked } from "marked";
import type { Token } from "marked";
```

to:

```ts
import { marked } from "marked";
import type { Token } from "marked";
import markedKatex from "marked-katex-extension";
import { getEmbeddedKatexCss } from "./katexAssets.js";

marked.use(markedKatex({ throwOnError: false }));
```

Modify `generateHtml`'s body — change:

```ts
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
```

to:

```ts
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
  // Only pay the ~360KB embedded-font cost when the deck actually uses
  // math -- checked against the rendered output itself (KaTeX always
  // wraps its markup in class="katex"), not against the raw source, so a
  // deck with zero math incurs zero size cost.
  const katexStyle = slidesHtml.includes('class="katex"')
    ? getEmbeddedKatexCss()
    : "";

  return `<!DOCTYPE html>
```

Modify the `<style>` block's closing tag — change:

```ts
      .slide { border-bottom-color: #333333; }
    }
  </style>
</head>
```

to:

```ts
      .slide { border-bottom-color: #333333; }
    }
    ${katexStyle}
  </style>
</head>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/render.test.ts`
Expected: PASS — the new "KaTeX math" tests, and every pre-existing test in this file (slide segmentation, fixture-based checks) unaffected.

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/render.ts tests/render.test.ts
git commit -m "feat(render): render LaTeX math via KaTeX, embedded fonts only when used"
```

---

### Task 3: Extend the real fixture with a math example

**Files:**
- Modify: `fixtures/sample.md`
- Modify: `tests/render.test.ts`

**Interfaces:** N/A (fixture content + test assertions only; no code change).

- [ ] **Step 1: Extend the fixture**

Add a fourth slide to `fixtures/sample.md` (append after the existing third slide, "Exporting to PDF"):

```markdown

---

# A Quick Formula

nh-deck can render inline math like $E = mc^2$, and block equations too:

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
```

- [ ] **Step 2: Add assertions for the fixture's math slide**

Add this case to the existing `describe("generateHtml", ...)` block in `tests/render.test.ts` (alongside the other fixture-based assertions):

```ts
  it("renders the fixture's fourth slide with KaTeX math", () => {
    const html = generateHtml(fixtureMarkdown, "sample");

    expect(html).toContain("<h1>A Quick Formula</h1>");
    expect(html).toContain('class="katex"');
  });
```

Also update the existing slide-count assertion(s) that check the fixture renders exactly 3 sections — search `tests/render.test.ts` for the test asserting `sectionCount).toBe(3)` against `fixtureMarkdown` and change the expected count to `4`.

- [ ] **Step 3: Run the render test file to verify everything passes**

Run: `npx vitest run tests/render.test.ts`
Expected: PASS — all pre-existing fixture-based tests still pass (they only assert on slides 1-3's content, untouched), the updated section-count assertion passes at 4, and the new math-slide test passes.

- [ ] **Step 4: Run the full test suite to confirm no regression in files that also use this fixture**

Run: `npm test`
Expected: PASS — `tests/cli.test.ts` and `tests/pdfExport.test.ts` both use `fixtures/sample.md` but only assert on the stdout serving-URL pattern and the exported PDF's existence/magic-number, never on rendered HTML content.

- [ ] **Step 5: Commit**

```bash
git add fixtures/sample.md tests/render.test.ts
git commit -m "test(render): extend the sample fixture with a KaTeX math slide"
```

---

### Task 4: Record the decision (ADR) and reconcile the roadmap

**Files:**
- Create: `docs/adr/0004-katex-local-embedded-math.md`
- Modify: `decisions.md` (ADR Index)
- Modify: `Context.md` (Roadmap item 8 → done)

**Interfaces:** N/A (docs only).

- [ ] **Step 1: Write the ADR**

Create `docs/adr/0004-katex-local-embedded-math.md`:

```markdown
# 0004. KaTeX math rendering with locally-embedded fonts

## Status

Accepted — 2026-09-11

## Context and Problem Statement

`Context.md`'s Roadmap has carried "KaTeX (math rendering)" as a deferred
fast-follow since the walking skeleton shipped, explicitly gated on
shipping it with local, bundled assets only -- no CDN fallback path, even
as an "advanced" opt-in. Primary-source research (`docs/research/feature-roadmap-research.md`)
found this gate is not hypothetical: two of the five comparable tools
surveyed (reveal.js's official KaTeX/MathJax plugins, Marp Core in both
its stable and RC lines) default to fetching KaTeX's fonts from
`cdn.jsdelivr.net` unless the embedding application explicitly overrides
that default. We need a design that renders LaTeX math correctly without
inheriting that default.

## Decision Drivers

- No CDN fallback path, under any option -- the exact failure mode two of
  the five surveyed tools ship as their *default*.
- Do not hand-roll Markdown parsing (`AGENTS.md` Code Style) -- math-
  delimiter detection must go through `marked`'s own extension API.
- `generateHtml` must stay a pure, synchronous function.
- A deck with no math must incur zero size/behavior cost.
- One malformed formula must not crash the whole render.

## Considered Options

1. **KaTeX's Node-side `renderToString` API via a proper `marked`
   tokenizer extension, with fonts inlined as base64 `data:` URIs.**
2. **KaTeX with its default CDN font path** (the shape both Marp Core
   and reveal.js's plugins default to).
3. **MathJax** instead of KaTeX.
4. **Hand-rolled `$...$`/`$$...$$` regex detection**, calling
   `katex.renderToString` directly without going through `marked`'s
   extension system.

## Decision Outcome

Chosen option: **Option 1 -- KaTeX + `marked-katex-extension`, fonts
inlined as base64.**

- **Option 2 (default CDN font path)** was rejected outright: this is
  precisely the anti-pattern the research identified in two of the five
  surveyed tools, and precisely what `CLAUDE.md`'s stop-and-ask gate
  exists to prevent.
- **Option 3 (MathJax)** was not pursued: KaTeX is already the tool this
  project's own docs (`AGENTS.md` Known Gotchas, `Context.md` Roadmap)
  have named as the intended choice since before this phase began: no
  new comparison was needed to justify revisiting an already-settled
  choice.
- **Option 4 (hand-rolled regex)** was rejected: `marked-katex-extension`
  (verified directly against its source) already registers proper
  `marked` tokenizer/renderer extensions -- the same category of solution
  ADR-0002 chose for slide segmentation over a regex-based alternative,
  and for the same reason: marked's own tokenizer already correctly
  leaves `$` inside inline code and fenced code blocks untouched, which a
  bespoke regex would need to reimplement and could get wrong.
- **Option 1** was verified empirically end-to-end: KaTeX's own font
  files (woff2-only, ~296KB raw / ~360KB after base64 encoding) were
  embedded via a rewritten `@font-face` block, loaded in a real browser,
  and confirmed to produce zero network requests beyond the local file
  itself, zero console errors, and visually correct math rendering.

## Consequences

**Good:**

- Zero CDN dependency, verified empirically rather than assumed.
- A deck with no math pays no size cost -- the ~360KB embedded font
  block is included only when the rendered output actually contains
  KaTeX markup.
- Invalid LaTeX degrades gracefully (`throwOnError: false`) to a visible,
  styled error span instead of crashing the whole render.
- `marked-katex-extension`'s use of `marked`'s own extension API means
  `$` inside inline code or fenced code blocks is never mistaken for
  math -- verified directly, not assumed.

**Bad:**

- A deck that uses even one small formula pays the full ~360KB embedded
  font cost for all 20 KaTeX font families, not just the ones that
  formula actually needs -- accepted as a reasonable simplicity trade-off
  rather than attempting to determine the minimal font subset per deck,
  which would require deep inspection of KaTeX's internal font-selection
  logic for comparatively little payoff at this project's scale.
- `katex` and `marked-katex-extension` are two new runtime dependencies
  -- both were checked directly (via `npm view`) to confirm no DOM
  library, browser-automation library, or other heavy/network-reaching
  transitive dependency exists in either package's own dependency tree.

## Confirmation

This decision is confirmed as implemented when:

1. Inline (`$...$`) and block (`$$...$$`) LaTeX math renders via KaTeX.
2. `$` inside inline code or a fenced code block is never rendered as
   math.
3. Invalid LaTeX renders a visible error span rather than throwing.
4. A deck with no math contains no KaTeX CSS/font references at all.
5. A deck with math contains zero CDN hostname references (`cdn.`,
   `unpkg.com`, `jsdelivr.net`, `cdnjs.cloudflare.com`) and zero
   `<script src="http`/`<link href="http` external resource references.

## More Information

- See `docs/research/feature-roadmap-research.md` §3a for the primary-
  source comparison against reveal.js's and Marp Core's default CDN
  behavior.
- See `docs/specs/feature-implementation-roadmap-design.md` §6 for how
  this fits into the broader Phase 4 roadmap item.
- See `Context.md`'s Roadmap, item 8.
- See `docs/adr/0002-per-slide-segmentation.md` for the precedent this
  ADR follows regarding marked's own extension API over hand-rolled
  regex.
```

- [ ] **Step 2: Add the ADR to `decisions.md`'s ADR Index**

Read the current ADR Index table in `decisions.md` first to get its exact current last row (this branch was cut after Phase 1 merged but the exact state of ADR-0002/0003 rows depends on merge order among the still-open PRs), then append a new row:

```markdown
| 0004 | [KaTeX math rendering with locally-embedded fonts](docs/adr/0004-katex-local-embedded-math.md) | Accepted | 2026-09-11 | —          |
```

- [ ] **Step 3: Mark Roadmap item 8 done in `Context.md`**

Read the current Roadmap section in `Context.md` first (its exact numbering depends on which of Phases 1-3's PRs have merged by the time this task runs), find the KaTeX item, and change it from its current unstruck form to a struck-through, "Done" form matching the style of the other completed items, e.g.:

```markdown
8. ~~KaTeX (math rendering).~~ Done — inline and block LaTeX math now renders via KaTeX with fonts embedded locally as base64 (no CDN fallback path); see `docs/adr/0004-katex-local-embedded-math.md`.
```

Also update the file's "Last updated" footer line to `2026-09-11` if it does not already say so.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0004-katex-local-embedded-math.md decisions.md Context.md
git commit -m "docs: record ADR-0004 (KaTeX local-embedded math) and mark Roadmap item 8 done"
```

---

## After all tasks: open the PR

```bash
git push -u origin feat/katex-math
```

Then open a PR against `main` per `Branches.md`'s PR-required policy (squash-merge only; the squash commit message must itself be a valid Conventional Commit — e.g. `feat(render): KaTeX math rendering with locally-embedded fonts (Phase 4a)`). Wait for CI to go green across all 9 matrix combinations before merging.

**Known merge friction:** this branch's Task 4 reads and edits `Context.md`'s Roadmap and `decisions.md`'s ADR Index at whatever state they're in when Task 4 actually runs — if Phase 2 and/or Phase 3's PRs haven't merged by then, this branch's docs edits may need manual reconciliation against theirs, same as the friction already flagged between Phase 2 and Phase 3. Resolve at merge time by taking the already-merged structure and re-applying this phase's "mark item 8 done" line and ADR row to the correct position.
