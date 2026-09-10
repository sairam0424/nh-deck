import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateHtml } from "../src/render.js";

// NOTE on the ".js" import extension above: this project uses TypeScript's
// NodeNext module resolution (see src/index.ts, which imports "./render.js"
// even though only render.ts exists on disk). Vitest's own module loader
// resolves that specifier straight to src/render.ts, so tests follow the same
// convention as the rest of the source tree rather than importing "../src/render.ts".

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const fixturePath = path.join(repoRoot, "fixtures", "sample.md");
const fixtureMarkdown = readFileSync(fixturePath, "utf8");

describe("generateHtml", () => {
  it("renders a complete, self-contained HTML document", () => {
    const html = generateHtml(fixtureMarkdown, "sample");

    expect(html).toContain("<!DOCTYPE");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("renders the fixture's heading and code block content", () => {
    const html = generateHtml(fixtureMarkdown, "sample");

    expect(html).toContain("<h1>Getting Started with nh-deck</h1>");
    expect(html).toContain("nh-deck render fixtures/sample.md --port 4000");
    expect(html).toContain("<pre><code");
  });

  it("renders the fixture's bullet list", () => {
    const html = generateHtml(fixtureMarkdown, "sample");

    expect(html).toContain("<ul>");
    expect(html).toContain(
      "<li>Render Markdown to a self-contained HTML document</li>",
    );
  });

  it("never references an external CDN (local-first constraint)", () => {
    const html = generateHtml(fixtureMarkdown, "sample");

    expect(html).not.toMatch(/https?:\/\/cdn\./i);
    expect(html).not.toContain("unpkg.com");
    expect(html).not.toContain("jsdelivr.net");
    expect(html).not.toContain("cdnjs.cloudflare.com");
  });

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
});

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

  it("wraps an empty deck in exactly one <section> (zero-delimiter backward-compatibility invariant)", () => {
    const html = generateHtml("");
    const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
    expect(sectionCount).toBe(1);
  });

  it("wraps a whitespace-only deck in exactly one <section> (zero-delimiter backward-compatibility invariant)", () => {
    const html = generateHtml("   \n\n   ");
    const sectionCount = (html.match(/<section class="slide">/g) ?? []).length;
    expect(sectionCount).toBe(1);
  });
});
