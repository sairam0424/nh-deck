# Phase 1 — Quick Wins: Robustness Fixes + CI/Tooling Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 5 code-robustness gaps and the CI/tooling gap documented in `CODEBASE_INDEX.md`, with zero new runtime dependencies and zero feature-surface change.

**Architecture:** Two small pure helper functions (`parsePort`, `resolveOutputPath`) get extracted into a new `src/cliHelpers.ts` module so they're unit-testable without triggering `src/index.ts`'s top-level `program.parse()` side effect. `src/pdfExport.ts`'s launch/cleanup lifecycle gets hardened in place. Three new test files close the test-coverage gaps. CI gets three new steps (cache, audit, typecheck+lint) ahead of the existing build/test/pack pipeline. Two doc updates close the process gap.

**Tech Stack:** TypeScript (strict, ESM/NodeNext), Commander.js 12, Vitest 2, Biome (new), GitHub Actions.

**Spec:** `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/docs/specs/feature-implementation-roadmap-design.md` (§3, "Phase 1 — Quick Wins")

## Global Constraints

- No new runtime dependency (`SOUL.md` Non-Negotiable #1/#2 — not touched by this phase, but the constraint stands project-wide).
- No bundler — plain `tsc` only (`AGENTS.md` Code Style).
- Markdown-to-HTML stays through `marked`; do not hand-roll parsing anywhere (`AGENTS.md` Code Style) — this phase uses `node:path`'s `extname`/`resolve` instead of hand-rolled path logic, consistent with this rule.
- TypeScript strict mode; ESM/NodeNext import style (`.js` extensions on relative imports even though only `.ts` exists on disk — matches every existing file in `src/`/`tests/`).
- File naming: camelCase, no hyphens, matching `render.ts`/`server.ts`/`pdfExport.ts` (not `cli-helpers.ts`).
- Every commit follows [Conventional Commits](https://www.conventionalcommits.org) (`Branches.md`).
- Every change goes through a PR, even solo; CI (`npm run build && npm test`, now also typecheck+lint+audit) must pass before merge; squash-merge only (`Branches.md`).
- Branch naming: `type/scope-slug` (`Branches.md`).

## Setup (before Task 1)

- [ ] **Create and check out the feature branch**

```bash
git checkout -b fix/cli-robustness-and-ci-hardening
```

---

### Task 1: `render` command — wrap action body in try/catch

**Files:**
- Modify: `src/index.ts:18-34`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new (behavioral fix only — `render`'s action promise now always resolves instead of sometimes rejecting).

- [ ] **Step 1: Write the failing test**

Add to `tests/cli.test.ts`, inside a new `describe` block placed after the existing `describe("CLI: nh-deck render", ...)` block:

```ts
describe("CLI: nh-deck render — error handling", () => {
  it(
    "prints a friendly error and exits non-zero when the file does not exist, instead of an unhandled-rejection stack trace",
    async () => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/index.ts",
          "render",
          "does-not-exist.md",
          "--no-open",
          "--port",
          "0",
        ],
        { cwd: repoRoot },
      );
      activeChild = child;

      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const exitCode = await new Promise<number | null>((resolve) => {
        child.once("exit", (code) => resolve(code));
      });

      expect(stderr).toMatch(/^nh-deck: /);
      expect(stderr).not.toMatch(/UnhandledPromiseRejection|at Object\.<anonymous>/);
      expect(exitCode).toBe(1);
    },
    STARTUP_TIMEOUT_MS,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.test.ts -t "error handling"`
Expected: FAIL — pre-fix, `stderr` contains a raw unhandled-rejection stack trace (matches the excluded pattern) instead of a `nh-deck: `-prefixed line, so the first `expect` fails.

- [ ] **Step 3: Write minimal implementation**

Modify `src/index.ts:18-34` from:

```ts
program
  .command("render <file>")
  .description("Render a Markdown deck and serve it locally.")
  .option("--no-open", "do not open the deck in the default browser")
  .option("--port <n>", "port to listen on (default: OS-assigned)")
  .action(async (file: string, options: { open: boolean; port?: string }) => {
    const markdown = readFileSync(file, "utf8");
    const html = generateHtml(markdown, file);
    const port = options.port !== undefined ? Number(options.port) : undefined;
    const { url } = await startServer(html, port);

    process.stdout.write(`nh-deck serving ${file} at ${url}\n`);

    if (options.open) {
      await open(url);
    }
  });
```

to:

```ts
program
  .command("render <file>")
  .description("Render a Markdown deck and serve it locally.")
  .option("--no-open", "do not open the deck in the default browser")
  .option("--port <n>", "port to listen on (default: OS-assigned)")
  .action(async (file: string, options: { open: boolean; port?: string }) => {
    try {
      const markdown = readFileSync(file, "utf8");
      const html = generateHtml(markdown, file);
      const port = options.port !== undefined ? Number(options.port) : undefined;
      const { url } = await startServer(html, port);

      process.stdout.write(`nh-deck serving ${file} at ${url}\n`);

      if (options.open) {
        await open(url);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`nh-deck: ${message}\n`);
      process.exitCode = 1;
    }
  });
```

(This is a temporary intermediate state — Task 2 will replace the `Number(options.port)` line and the `port?: string` type when it wires in `parsePort`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.test.ts -t "error handling"`
Expected: PASS

- [ ] **Step 5: Run the full existing test suite to confirm no regression**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS (both the pre-existing "prints the serving URL..." test and the new error-handling test)

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/cli.test.ts
git commit -m "fix(cli): wrap render action in try/catch to prevent unhandled-rejection crashes"
```

---

### Task 2: Extract and wire in `parsePort` — validate `--port` before the action runs

**Files:**
- Create: `src/cliHelpers.ts`
- Create: `tests/cliHelpers.test.ts`
- Modify: `src/index.ts:1-34` (imports, render command's `--port` option, action signature)

**Interfaces:**
- Produces: `parsePort(value: string): number` — throws `commander.InvalidArgumentError` for non-integer or out-of-range input; used by Task 3's file and by `src/index.ts`'s render command.

- [ ] **Step 1: Write the failing test**

Create `tests/cliHelpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InvalidArgumentError } from "commander";
import { parsePort } from "../src/cliHelpers.js";

describe("parsePort", () => {
  it("accepts valid integer ports, including the boundaries", () => {
    expect(parsePort("0")).toBe(0);
    expect(parsePort("65535")).toBe(65535);
    expect(parsePort("3000")).toBe(3000);
  });

  it("rejects non-numeric input", () => {
    expect(() => parsePort("abc")).toThrow(InvalidArgumentError);
  });

  it("rejects negative numbers", () => {
    expect(() => parsePort("-1")).toThrow(InvalidArgumentError);
  });

  it("rejects numbers above the valid port range", () => {
    expect(() => parsePort("65536")).toThrow(InvalidArgumentError);
  });

  it("rejects non-integer numbers", () => {
    expect(() => parsePort("3000.5")).toThrow(InvalidArgumentError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cliHelpers.test.ts`
Expected: FAIL with "Cannot find module '../src/cliHelpers.js'" (the file doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

Create `src/cliHelpers.ts`:

```ts
import { InvalidArgumentError } from "commander";

/**
 * Commander custom option-parser for --port. Validates before the action
 * handler runs at all, so an invalid port never reaches http.Server.listen().
 */
export function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new InvalidArgumentError(
      "port must be an integer between 0 and 65535.",
    );
  }
  return port;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cliHelpers.test.ts`
Expected: PASS (all 5 cases)

- [ ] **Step 5: Wire `parsePort` into `src/index.ts`**

Modify the top of `src/index.ts` — add the import (after the existing `Command` import):

```ts
import { Command } from "commander";
import { parsePort } from "./cliHelpers.js";
```

Modify the render command (building on Task 1's try/catch) from:

```ts
program
  .command("render <file>")
  .description("Render a Markdown deck and serve it locally.")
  .option("--no-open", "do not open the deck in the default browser")
  .option("--port <n>", "port to listen on (default: OS-assigned)")
  .action(async (file: string, options: { open: boolean; port?: string }) => {
    try {
      const markdown = readFileSync(file, "utf8");
      const html = generateHtml(markdown, file);
      const port = options.port !== undefined ? Number(options.port) : undefined;
      const { url } = await startServer(html, port);
      ...
```

to:

```ts
program
  .command("render <file>")
  .description("Render a Markdown deck and serve it locally.")
  .option("--no-open", "do not open the deck in the default browser")
  .option("--port <n>", "port to listen on (default: OS-assigned)", parsePort)
  .action(async (file: string, options: { open: boolean; port?: number }) => {
    try {
      const markdown = readFileSync(file, "utf8");
      const html = generateHtml(markdown, file);
      const { url } = await startServer(html, options.port);
      ...
```

(`options.port` is now already a validated `number | undefined` — the `Number(options.port)` conversion line is deleted entirely.)

- [ ] **Step 6: Add a CLI-level regression test for the invalid-port case**

Add to `tests/cli.test.ts`'s `describe("CLI: nh-deck render — error handling", ...)` block (from Task 1):

```ts
it(
  "rejects a non-numeric --port with a clear error before starting the server",
  async () => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/index.ts",
        "render",
        "fixtures/sample.md",
        "--no-open",
        "--port",
        "abc",
      ],
      { cwd: repoRoot },
    );
    activeChild = child;

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
    });

    expect(stderr).toMatch(/port must be an integer between 0 and 65535/);
    expect(exitCode).not.toBe(0);
  },
  STARTUP_TIMEOUT_MS,
);
```

- [ ] **Step 7: Run the full test suite to verify everything passes**

Run: `npx vitest run tests/cliHelpers.test.ts tests/cli.test.ts`
Expected: PASS (all cases, including the pre-existing `render` test using `--port 0`, which is still valid input)

- [ ] **Step 8: Commit**

```bash
git add src/cliHelpers.ts tests/cliHelpers.test.ts src/index.ts tests/cli.test.ts
git commit -m "fix(cli): validate --port via Commander custom parseArg before startServer runs"
```

---

### Task 3: Extract and wire in `resolveOutputPath` — fix `pdf`'s self-overwrite risk

**Files:**
- Modify: `src/cliHelpers.ts` (add a second export)
- Modify: `tests/cliHelpers.test.ts` (add test cases)
- Modify: `src/index.ts:36-52` (`pdf` command)

**Interfaces:**
- Consumes: nothing new.
- Produces: `resolveOutputPath(file: string, output?: string): string` — throws a plain `Error` if the resolved output path equals the resolved input path; used by `src/index.ts`'s `pdf` command.

- [ ] **Step 1: Write the failing test**

Add to `tests/cliHelpers.test.ts`:

```ts
import { resolveOutputPath } from "../src/cliHelpers.js";

describe("resolveOutputPath", () => {
  it("replaces a .md extension with .pdf when no output is given", () => {
    expect(resolveOutputPath("deck.md")).toBe("deck.pdf");
  });

  it("appends .pdf instead of no-op'ing when the input has no .md suffix", () => {
    expect(resolveOutputPath("deck")).toBe("deck.pdf");
    expect(resolveOutputPath("deck.markdown")).toBe("deck.markdown.pdf");
  });

  it("uses the explicit output path when one is given", () => {
    expect(resolveOutputPath("deck.md", "custom-name.pdf")).toBe(
      "custom-name.pdf",
    );
  });

  it("refuses to resolve to the same path as the input file", () => {
    expect(() => resolveOutputPath("deck.md", "deck.md")).toThrow(
      /Refusing to overwrite the source file/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cliHelpers.test.ts -t "resolveOutputPath"`
Expected: FAIL — `resolveOutputPath` is not exported from `../src/cliHelpers.js` yet.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/cliHelpers.ts` with:

```ts
import { InvalidArgumentError } from "commander";
import { extname, resolve } from "node:path";

/**
 * Commander custom option-parser for --port. Validates before the action
 * handler runs at all, so an invalid port never reaches http.Server.listen().
 */
export function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new InvalidArgumentError(
      "port must be an integer between 0 and 65535.",
    );
  }
  return port;
}

/**
 * Derives the PDF output path for the `pdf` command. If no explicit output
 * is given, replaces a trailing .md with .pdf, or appends .pdf if the input
 * has no .md suffix (never silently returns the unchanged input path).
 * Always guards against the resolved output equalling the resolved input.
 */
export function resolveOutputPath(file: string, output?: string): string {
  const outputPath =
    output ??
    (extname(file) === ".md" ? file.replace(/\.md$/, ".pdf") : `${file}.pdf`);

  if (resolve(outputPath) === resolve(file)) {
    throw new Error(
      `Refusing to overwrite the source file (${file}). Pass a different output path.`,
    );
  }

  return outputPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cliHelpers.test.ts`
Expected: PASS (all `parsePort` and `resolveOutputPath` cases)

- [ ] **Step 5: Wire `resolveOutputPath` into `src/index.ts`**

Modify the import line added in Task 2:

```ts
import { parsePort, resolveOutputPath } from "./cliHelpers.js";
```

Modify the `pdf` command from:

```ts
program
  .command("pdf <file> [output]")
  .description("Export a Markdown deck to PDF.")
  .action(async (file: string, output?: string) => {
    const markdown = readFileSync(file, "utf8");
    const html = generateHtml(markdown, file);
    const outputPath = output ?? file.replace(/\.md$/, ".pdf");

    try {
      await exportToPdf(html, outputPath);
      process.stdout.write(`Wrote PDF to ${outputPath}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`nh-deck: ${message}\n`);
      process.exitCode = 1;
    }
  });
```

to:

```ts
program
  .command("pdf <file> [output]")
  .description("Export a Markdown deck to PDF.")
  .action(async (file: string, output?: string) => {
    try {
      const markdown = readFileSync(file, "utf8");
      const html = generateHtml(markdown, file);
      const outputPath = resolveOutputPath(file, output);

      await exportToPdf(html, outputPath);
      process.stdout.write(`Wrote PDF to ${outputPath}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`nh-deck: ${message}\n`);
      process.exitCode = 1;
    }
  });
```

(Note: `readFileSync`/`generateHtml` moved inside the `try` too — this is a correctness improvement consistent with Task 1's pattern, since a missing-file error on the `pdf` path was previously also unguarded.)

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run tests/cliHelpers.test.ts tests/cli.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cliHelpers.ts tests/cliHelpers.test.ts src/index.ts
git commit -m "fix(cli): derive pdf output path via path.extname, guard against self-overwrite"
```

---

### Task 4: `pdfExport.ts` — move `puppeteer.launch()` inside try/finally

**Files:**
- Create: `tests/pdfExport.launchFailure.test.ts`
- Modify: `src/pdfExport.ts:13-38`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change — `exportToPdf(html: string, outputPath: string): Promise<void>` stays the same; only its internal error-safety changes.

- [ ] **Step 1: Write the failing test**

Create `tests/pdfExport.launchFailure.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("chrome-launcher", async () => {
  const actual =
    await vi.importActual<typeof import("chrome-launcher")>("chrome-launcher");
  return {
    ...actual,
    Launcher: { ...actual.Launcher, getInstallations: () => ["/fake/path/to/chrome"] },
  };
});

vi.mock("puppeteer-core", () => ({
  default: {
    launch: vi.fn().mockRejectedValue(new Error("spawn ENOENT")),
  },
}));

describe("exportToPdf — browser launch failure", () => {
  it("wraps a launch failure in a friendly error instead of crashing in finally", async () => {
    const { exportToPdf } = await import("../src/pdfExport.js");

    await expect(
      exportToPdf("<html></html>", "/tmp/should-not-be-created.pdf"),
    ).rejects.toThrow(
      /Failed to export PDF using \/fake\/path\/to\/chrome: spawn ENOENT/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pdfExport.launchFailure.test.ts`
Expected: FAIL — pre-fix, the rejection message is the raw `"spawn ENOENT"`, not wrapped as `"Failed to export PDF using ..."`, so the regex in `.rejects.toThrow(...)` does not match.

- [ ] **Step 3: Write minimal implementation**

Modify `src/pdfExport.ts:13-38` from:

```ts
export async function exportToPdf(
  html: string,
  outputPath: string,
): Promise<void> {
  const installations = Launcher.getInstallations();

  if (!installations || installations.length === 0) {
    throw new Error(
      "No local Chrome, Chromium, Edge, or Brave installation was found. " +
        "nh-deck requires one of these browsers to be installed on this machine to export PDFs. " +
        "An automatic download fallback is a planned but not-yet-implemented feature.",
    );
  }

  const executablePath = installations[0];
  const browser = await puppeteer.launch({ executablePath, headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({ path: outputPath, format: "A4", printBackground: true });
    await page.close();
  } finally {
    await browser.close();
  }
}
```

to:

```ts
export async function exportToPdf(
  html: string,
  outputPath: string,
): Promise<void> {
  const installations = Launcher.getInstallations();

  if (!installations || installations.length === 0) {
    throw new Error(
      "No local Chrome, Chromium, Edge, or Brave installation was found. " +
        "nh-deck requires one of these browsers to be installed on this machine to export PDFs. " +
        "An automatic download fallback is a planned but not-yet-implemented feature.",
    );
  }

  // installations[0] is intentional, not a missing-selection-logic bug:
  // chrome-launcher's own README documents that "the first installation
  // returned from this method is used instead" when no explicit chromePath
  // is given, and getInstallations() returns paths in decreasing priority
  // order per platform. Do not add custom selection logic here.
  const executablePath = installations[0];

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({ path: outputPath, format: "A4", printBackground: true });
    await page.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to export PDF using ${executablePath}: ${message}`);
  } finally {
    await browser?.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pdfExport.launchFailure.test.ts`
Expected: PASS

- [ ] **Step 5: Run the existing real-E2E PDF export test to confirm no regression**

Run: `npx vitest run tests/pdfExport.test.ts`
Expected: PASS (this test is untouched and still exercises the real, successful-launch path)

- [ ] **Step 6: Commit**

```bash
git add src/pdfExport.ts tests/pdfExport.launchFailure.test.ts
git commit -m "fix(pdf): move puppeteer.launch() inside try/finally, guard browser?.close()"
```

---

### Task 5: Add the missing "no browser found" regression test

**Files:**
- Create: `tests/pdfExport.noBrowser.test.ts`

**Interfaces:**
- Consumes: `exportToPdf(html: string, outputPath: string): Promise<void>` (from `src/pdfExport.ts`, unchanged since Task 4).
- Produces: nothing new — this task only adds test coverage for an existing, already-correct guard clause.

- [ ] **Step 1: Write the test**

This guard clause already behaves correctly (per `docs/research/cli-robustness-testing-research.md` §Gap 5b) — this task adds the missing regression test, so there's no "fix" step, only test-then-verify. Create `tests/pdfExport.noBrowser.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("chrome-launcher", async () => {
  const actual =
    await vi.importActual<typeof import("chrome-launcher")>("chrome-launcher");
  return {
    ...actual,
    Launcher: { ...actual.Launcher, getInstallations: () => [] },
  };
});

describe("exportToPdf — no browser installed", () => {
  it("throws a clear, actionable error instead of hanging or crashing", async () => {
    const { exportToPdf } = await import("../src/pdfExport.js");

    await expect(
      exportToPdf("<html></html>", "/tmp/should-not-be-created.pdf"),
    ).rejects.toThrow(
      /No local Chrome, Chromium, Edge, or Brave installation was found/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `npx vitest run tests/pdfExport.noBrowser.test.ts`
Expected: PASS (this exercises pre-existing, correct behavior — no code change accompanies this task)

- [ ] **Step 3: Commit**

```bash
git add tests/pdfExport.noBrowser.test.ts
git commit -m "test(pdf): add regression coverage for the no-browser-found error path"
```

---

### Task 6: Add a CLI-process integration test for `pdf`

**Files:**
- Modify: `tests/cli.test.ts` (new imports, new `describe` block)

**Interfaces:**
- Consumes: nothing new — spawns the real CLI process end-to-end.

- [ ] **Step 1: Write the test**

Add these imports to the top of `tests/cli.test.ts` (alongside the existing ones):

```ts
import { existsSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
```

Add this constant near the top, alongside the existing timeout constants:

```ts
const PDF_EXPORT_TIMEOUT_MS = 60_000;
```

Add a new `describe` block at the end of the file:

```ts
describe("CLI: nh-deck pdf", () => {
  it(
    "exports a real PDF file and reports the output path on stdout",
    async () => {
      const outputPath = path.join(
        tmpdir(),
        `nh-deck-cli-pdf-test-${randomUUID()}.pdf`,
      );

      const child = spawn(
        process.execPath,
        ["--import", "tsx", "src/index.ts", "pdf", "fixtures/sample.md", outputPath],
        { cwd: repoRoot },
      );
      activeChild = child;

      let stdout = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      await waitForExit(child, PDF_EXPORT_TIMEOUT_MS);

      expect(stdout).toContain(`Wrote PDF to ${outputPath}`);
      expect(existsSync(outputPath)).toBe(true);

      const fileContents = readFileSync(outputPath);
      expect(fileContents.subarray(0, 4).toString("utf8")).toBe("%PDF");

      rmSync(outputPath, { force: true });
    },
    PDF_EXPORT_TIMEOUT_MS,
  );
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/cli.test.ts -t "nh-deck pdf"`
Expected: PASS (real browser launch + real PDF write — budget for real latency, same as `tests/pdfExport.test.ts`)

- [ ] **Step 3: Run the full `cli.test.ts` file to confirm no regression**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS (all `render` and `pdf` cases)

- [ ] **Step 4: Commit**

```bash
git add tests/cli.test.ts
git commit -m "test(cli): add process-level integration test for the pdf subcommand"
```

---

### Task 7: Add a direct unit test for `src/server.ts`

**Files:**
- Create: `tests/server.test.ts`

**Interfaces:**
- Consumes: `startServer(html: string, port?: number): Promise<StartedServer>` where `StartedServer = { server: http.Server; port: number; url: string }` (from `src/server.ts`, unchanged).

- [ ] **Step 1: Write the test**

Create `tests/server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { startServer } from "../src/server.js";

describe("startServer", () => {
  it("serves the given HTML on the resolved loopback URL", async () => {
    const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
    const { server, port, url } = await startServer(html, 0);

    expect(url).toBe(`http://127.0.0.1:${port}`);

    const response = await fetch(url);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(body).toBe(html);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("assigns a real ephemeral port when none is specified", async () => {
    const { server, port } = await startServer("<p>x</p>");

    expect(port).toBeGreaterThan(0);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
```

(Node 20+'s global `fetch` is used directly — no new dependency, matches `engines.node: ">=20"` in `package.json`.)

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/server.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/server.test.ts
git commit -m "test(server): add direct unit tests for startServer"
```

---

### Task 8: CI — add npm dependency caching and an audit step

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:** N/A (CI configuration only)

- [ ] **Step 1: Modify the "Set up Node.js" step**

In `.github/workflows/ci.yml`, change:

```yaml
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
```

to:

```yaml
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
```

- [ ] **Step 2: Add an audit step after "Install dependencies"**

Insert immediately after the existing `- name: Install dependencies` step and before `- name: Build`:

```yaml
      - name: Audit dependencies
        run: npm audit --audit-level=high
```

- [ ] **Step 3: Verify the workflow file is valid YAML**

Run: `node -e "require('node:fs').readFileSync('.github/workflows/ci.yml', 'utf8')" && npx -y yaml-lint .github/workflows/ci.yml 2>/dev/null || python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/ci.yml'))" 2>/dev/null || echo "no local YAML linter available — will be validated by GitHub Actions on push"`
Expected: no parse error (if no local YAML linter is available, this is validated by the actual CI run after push, per Step 4 below)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: cache npm dependencies and add npm audit --audit-level=high"
```

---

### Task 9: CI — add Biome (lint) and a standalone typecheck script

**Files:**
- Create: `biome.json` (via `biome init`)
- Modify: `package.json` (new devDependency, new `typecheck`/`lint` scripts)
- Modify: `.github/workflows/ci.yml` (two new steps)

**Interfaces:** N/A (tooling/config only)

- [ ] **Step 1: Install Biome as an exact-pinned devDependency**

Run: `npm install --save-dev --save-exact @biomejs/biome`

- [ ] **Step 2: Generate the Biome config**

Run: `npx biome init`

This creates `biome.json` with Biome's recommended rule set enabled by default. Open the generated file and confirm it does not exclude `src/` or `tests/` (Biome's default `files` scope covers the whole project except common ignored directories like `node_modules`/`dist` — verify `dist` and `node_modules` are excluded, since they're `tsc` output and third-party code respectively).

- [ ] **Step 3: Add `typecheck` and `lint` scripts to `package.json`**

Modify the `"scripts"` block from:

```json
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

to:

```json
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "biome ci ."
  },
```

- [ ] **Step 4: Run both new scripts locally to confirm they pass on the current codebase**

Run: `npm run typecheck && npm run lint`
Expected: both PASS. If `lint` reports findings on existing code, fix them now (they're pre-existing issues Biome's recommended ruleset catches, not issues introduced by this plan) — do not merge this task with lint findings unresolved.

- [ ] **Step 5: Add CI steps for both, ahead of the existing Build step**

In `.github/workflows/ci.yml`, insert after the "Audit dependencies" step added in Task 8 and before "Build":

```yaml
      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json biome.json .github/workflows/ci.yml
git commit -m "ci(tooling): add Biome lint and a standalone tsc --noEmit typecheck gate"
```

---

### Task 10: Add a PR template with a doc-drift checklist item

**Files:**
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Modify: `Branches.md` (append a per-project deviation note)

**Interfaces:** N/A (process/docs only)

- [ ] **Step 1: Create the PR template**

Create `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## Summary

<!-- What does this PR change and why? -->

## Checklist

- [ ] `npm run build && npm test` passes locally
- [ ] If this PR changes CI, `src/`, or shipped-feature status: checked `status.md`, `codebase_map.md`, and `AGENTS.md`'s Directory Map for now-stale claims
- [ ] Commit messages follow Conventional Commits
```

- [ ] **Step 2: Append a per-project deviation note to `Branches.md`**

Add this new section at the end of `Branches.md`:

```markdown

## nh-deck-Specific Deviation

- **PR checklist for doc-drift**: this repo's `.github/PULL_REQUEST_TEMPLATE.md` adds a checklist item to re-check `status.md`/`codebase_map.md`/`AGENTS.md` on any PR touching CI, `src/`, or shipped-feature status. Added 2026-09-10 after `CODEBASE_INDEX.md` found `status.md` and `codebase_map.md` describing already-shipped features as "planned." No first-party tool solves doc/code consistency-checking (verified via primary-source research — see `docs/research/security-performance-tooling-research.md`), so this is a process fix, not a canonical-template change — not upstreamed to `../Not-Humans-Lab/Branches.md`.
```

- [ ] **Step 3: Commit**

```bash
git add .github/PULL_REQUEST_TEMPLATE.md Branches.md
git commit -m "docs: add PR template with a doc-drift recheck checklist item"
```

---

### Task 11: Reconcile `Context.md`'s Roadmap and log this planning session in `decisions.md`

**Files:**
- Modify: `Context.md` (Roadmap section, "Last updated" footer)
- Modify: `decisions.md` (Lightweight Decisions Log)

**Interfaces:** N/A (docs only)

- [ ] **Step 1: Replace `Context.md`'s Roadmap section**

Replace the existing "## Roadmap" section:

```markdown
## Roadmap

In order — do not build out of sequence:

1. ~~Finish the Phase 4 walking skeleton.~~ Done — render → serve → PDF-export core loop verified end-to-end.
2. ~~Expand CI to the full 3-OS × multi-Node-version matrix.~~ Done — 9/9 combinations green, including the real PDF-export test on every OS.
3. Add an automated PDF-export smoke test that runs *inside* every CI job rather than relying on manual local verification alone (partially done: `tests/pdfExport.test.ts` now runs in CI as part of the standard matrix — remaining fast-follow is a dedicated visual/fidelity check across the three detected browser families).
4. **KaTeX (math rendering).** Local, bundled assets only — no CDN. Add as its own dependency decision, not folded silently into an unrelated change.
5. **Mermaid (diagram rendering).** Same local-asset constraint as KaTeX.
6. **Themes, templates, transitions** — the rest of the reference project's (deckrun's) feature set, brought in deliberately and evaluated each time against `SOUL.md`'s "render faithfully, don't editorialize" value — a theme system must stay opt-in, never a forced default.
```

with:

```markdown
## Roadmap

In order — do not build out of sequence. Reconciled 2026-09-10 against a full codebase index (`CODEBASE_INDEX.md`) and three primary-source research docs (`docs/research/*.md`); full rationale in `docs/specs/feature-implementation-roadmap-design.md`.

1. ~~Finish the Phase 4 walking skeleton.~~ Done — render → serve → PDF-export core loop verified end-to-end.
2. ~~Expand CI to the full 3-OS × multi-Node-version matrix.~~ Done — 9/9 combinations green, including the real PDF-export test on every OS.
3. Quick wins: 5 code-robustness fixes (render try/catch, --port validation, pdf output-path derivation, puppeteer launch/finally) + CI/tooling hardening (npm cache, npm audit, Biome + typecheck gate, PR-checklist doc-drift item).
4. Real per-slide segmentation (`---` → `<section>` boundaries) — foundational; item 6 below depends on this.
5. Genuine live-reload for `render` (fixes this doc's own previously-false "live reload" claim in `AGENTS.md`'s Overview).
6. Presenter notes (HTML-comment convention) + per-slide PDF pagination — both depend on item 4.
7. Automated cross-browser PDF-export visual-fidelity check (unchanged from the prior roadmap's item 3 fast-follow — independent of items 3–6 and 8–11 below).
8. **KaTeX (math rendering).** Local, bundled assets only (fonts inlined as base64, no CDN fallback path at all) — add as its own dependency decision, not folded silently into an unrelated change.
9. **Mermaid (diagram rendering).** DOM-free, Puppeteer-free renderer only — explicitly not `@mermaid-js/mermaid-cli`, which requires full `puppeteer` as a peer dependency.
10. `--css <path>` opt-out flag for the baseline stylesheet — a smaller, immediately-actionable slice of item 11.
11. **Full theme, template, and transition system** — the rest of the reference project's (deckrun's) feature set, brought in deliberately and evaluated each time against `SOUL.md`'s "render faithfully, don't editorialize" value — must stay opt-in, never a forced default. Needs its own brainstorming pass when reached.
12. PNG (and, further out, PPTX) export via the already-detected browser — depends on item 4.
```

- [ ] **Step 2: Update the "Last updated" footer**

Change:

```markdown
*Last updated: 2026-09-02. Agents: keep this current as work progresses — do not let it go stale while `AGENTS.md`/`SOUL.md`/`CLAUDE.md` stay static.*
```

to:

```markdown
*Last updated: 2026-09-10. Agents: keep this current as work progresses — do not let it go stale while `AGENTS.md`/`SOUL.md`/`CLAUDE.md` stay static.*
```

- [ ] **Step 3: Add a `decisions.md` Lightweight Decisions Log entry**

Add a new row to the table in `decisions.md`:

```markdown
| 2026-09-10 | Reconciled `Context.md`'s Roadmap to insert 5 code-robustness fixes, CI/tooling hardening, and 4 net-new feature items (segmentation, live-reload, notes+pagination, `--css` opt-out, PNG export) around the existing KaTeX/Mermaid/Themes items (3–6), per a full codebase index plus 3 primary-source research docs. | Closes gaps `CODEBASE_INDEX.md` documented and grounds the already-planned KaTeX/Mermaid/theme work in verified anti-patterns from Marp/Slidev/reveal.js before implementation starts. Full spec: `docs/specs/feature-implementation-roadmap-design.md`. | @sairamugge |
```

- [ ] **Step 4: Commit**

```bash
git add Context.md decisions.md
git commit -m "docs: reconcile Context.md roadmap and log the planning session in decisions.md"
```

---

## After all tasks: open the PR

```bash
git push -u origin fix/cli-robustness-and-ci-hardening
```

Then open a PR against `main` per `Branches.md`'s PR-required policy (squash-merge only; the squash commit message must itself be a valid Conventional Commit — e.g. `fix(cli): harden robustness and CI tooling (Phase 1 quick wins)`). Wait for CI to go green across all 9 matrix combinations, including the new audit/typecheck/lint steps, before merging.
