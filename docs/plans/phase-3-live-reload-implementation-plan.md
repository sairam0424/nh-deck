# Phase 3 — Genuine Live-Reload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `AGENTS.md`'s Overview line already claims the dev server supports "live reload" — `CODEBASE_INDEX.md` confirmed this was false (no watch/push mechanism existed). This phase makes it true: `fs.watch()` the rendered Markdown file, re-render on change, and push a same-origin SSE reload event to the connected browser tab, gated behind an explicit `--watch` flag so `render`'s existing default (non-watch) behavior never changes.

**Architecture:** `src/server.ts`'s `startServer` gains an optional third parameter (`{ watch?: boolean }`) and a new `updateHtml(html)` method on its returned object; when `watch` is true, it also serves a same-origin SSE endpoint (`/__nh-deck-reload`) and injects a small inline `<script>` (never CDN-hosted) into the served document. `src/cliHelpers.ts` gains a generic, unit-testable `debounce()` utility. `src/index.ts`'s `render` command wires `fs.watch()` through that debounce into `updateHtml()`, behind a new `--watch` flag.

**Tech Stack:** `node:http` (already in use, no new dependency), `node:fs`'s `watch`, Server-Sent Events (a native HTTP/1.1 mechanism, no new protocol or library).

**Spec:** `/Users/sairamugge/Desktop/Not-Humans-World/nh-deck/docs/specs/feature-implementation-roadmap-design.md` (§5, "Phase 3 — Genuine Live-Reload")

## Global Constraints

- No new runtime dependency — SSE is native to `node:http`; no WebSocket library, no polling library.
- The reload script must be **inline, same-origin, never CDN-hosted** — this is the exact local-first failure mode `CLAUDE.md`'s stop-and-ask gate exists to prevent. Verify directly in tests that no `http://`/`https://` reference appears anywhere in watch-mode output.
- `render`'s existing default (non-`--watch`) behavior must not change at all — every existing test in `tests/cli.test.ts` and `tests/server.test.ts` must keep passing unmodified.
- TypeScript strict mode; ESM/NodeNext import style (`.js` extensions on relative imports).
- File naming: camelCase, matching `render.ts`/`server.ts`/`pdfExport.ts`/`cliHelpers.ts`.
- Every commit follows Conventional Commits; every change goes through a PR, even solo; CI must pass before merge; squash-merge only; branch naming `type/scope-slug`.
- A decision that changes how a deck is rendered, previewed, or exported meets this repo's own bar for a full ADR (`decisions.md`) — this phase's SSE-vs-alternatives choice qualifies (see Task 4).

## Setup (before Task 1)

- [ ] **Create and check out the feature branch, off current `main`**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/live-reload
```

---

### Task 1: Watch-mode capability in `server.ts`

**Files:**
- Modify: `src/server.ts`
- Modify: `tests/server.test.ts`

**Interfaces:**
- Produces: `StartServerOptions = { watch?: boolean }`; `StartedServer` gains `updateHtml: (html: string) => void`. `startServer(html: string, port?: number, options?: StartServerOptions): Promise<StartedServer>` — the existing 1-arg and 2-arg call sites (`startServer(html)`, `startServer(html, port)`) keep working unchanged, since `options` is optional and defaults to `{}`.

- [ ] **Step 1: Write the failing tests**

Add this import to the top of `tests/server.test.ts` (alongside the existing ones):

```ts
import * as http from "node:http";
```

Add a new `describe` block at the end of `tests/server.test.ts`:

```ts
describe("startServer — watch mode", () => {
  it("does not inject a reload script or expose the SSE endpoint when watch is off", async () => {
    const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
    const { server, url } = await startServer(html, 0);

    const response = await fetch(url);
    const body = await response.text();
    expect(body).toBe(html);

    const sseResponse = await fetch(`${url}/__nh-deck-reload`);
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get("content-type")).toBe("text/html");

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("injects an inline reload script (never a CDN reference) when watch is on", async () => {
    const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
    const { server, url } = await startServer(html, 0, { watch: true });

    const response = await fetch(url);
    const body = await response.text();

    expect(body).toContain("<script>");
    expect(body).toContain("/__nh-deck-reload");
    expect(body).not.toMatch(/https?:\/\//);

    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("pushes a reload event to a connected SSE client when updateHtml is called", async () => {
    const { server, url, updateHtml } = await startServer("<p>v1</p>", 0, {
      watch: true,
    });

    const messagePromise = new Promise<string>((resolve, reject) => {
      const req = http.get(`${url}/__nh-deck-reload`, (res) => {
        res.on("data", (chunk: Buffer) => resolve(chunk.toString()));
        res.on("error", reject);
      });
      req.on("error", reject);
    });

    // Give the request a moment to actually connect before triggering the update.
    await new Promise((r) => setTimeout(r, 50));
    updateHtml("<p>v2</p>");

    const message = await messagePromise;
    expect(message).toContain("data: reload");

    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves the updated HTML after updateHtml, even without watch mode", async () => {
    const { server, url, updateHtml } = await startServer("<p>v1</p>", 0);

    updateHtml("<p>v2</p>");
    const response = await fetch(url);
    const body = await response.text();

    expect(body).toBe("<p>v2</p>");

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server.test.ts -t "watch mode"`
Expected: FAIL — `startServer` doesn't yet accept a third argument, doesn't return `updateHtml`, and doesn't serve `/__nh-deck-reload` distinctly.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/server.ts` with:

```ts
import * as http from "node:http";

export interface StartedServer {
  server: http.Server;
  port: number;
  url: string;
  /**
   * Updates the HTML this server serves on subsequent requests. In watch
   * mode, also pushes a reload event to every currently-connected SSE
   * client, so an open browser tab refreshes automatically.
   */
  updateHtml: (html: string) => void;
}

export interface StartServerOptions {
  /**
   * When true, serves a same-origin Server-Sent-Events endpoint
   * (RELOAD_PATH) and injects a small inline reload script into every
   * served document. The script is never CDN-hosted — it's embedded
   * directly in the response, so it never leaves loopback.
   */
  watch?: boolean;
}

const RELOAD_PATH = "/__nh-deck-reload";

const RELOAD_SCRIPT = `<script>
new EventSource(${JSON.stringify(RELOAD_PATH)}).onmessage = () => location.reload();
</script>`;

function withReloadScript(html: string): string {
  return html.includes("</body>")
    ? html.replace("</body>", `${RELOAD_SCRIPT}\n</body>`)
    : `${html}${RELOAD_SCRIPT}`;
}

/**
 * Starts a minimal local HTTP server that serves the given HTML to any GET
 * request. No framework, no external dependency — just node:http.
 *
 * This function does not print or log anything; the caller (the CLI
 * entrypoint) owns all user-facing output.
 */
export function startServer(
  html: string,
  port = 0,
  options: StartServerOptions = {},
): Promise<StartedServer> {
  let currentHtml = html;
  const sseClients: http.ServerResponse[] = [];

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (options.watch && req.url === RELOAD_PATH) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        sseClients.push(res);
        req.on("close", () => {
          const index = sseClients.indexOf(res);
          if (index !== -1) sseClients.splice(index, 1);
        });
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(options.watch ? withReloadScript(currentHtml) : currentHtml);
    });

    server.once("error", (err) => {
      reject(err);
    });

    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const boundPort =
        typeof address === "object" && address !== null ? address.port : port;
      resolve({
        server,
        port: boundPort,
        url: `http://127.0.0.1:${boundPort}`,
        updateHtml: (newHtml: string) => {
          currentHtml = newHtml;
          if (options.watch) {
            for (const client of sseClients) {
              client.write("data: reload\n\n");
            }
          }
        },
      });
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server.test.ts`
Expected: PASS — the 2 pre-existing tests (unaffected: they call `startServer(html, 0)`/`startServer(html)` with `options` defaulting to `{}`, so `options.watch` is falsy and behavior is byte-for-byte identical to before) and the 4 new watch-mode tests.

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: PASS (all files)

- [ ] **Step 6: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat(server): add watch-mode SSE reload endpoint and updateHtml"
```

---

### Task 2: `debounce` utility in `cliHelpers.ts`

**Files:**
- Modify: `src/cliHelpers.ts`
- Modify: `tests/cliHelpers.test.ts`

**Interfaces:**
- Produces: `debounce<Args extends unknown[]>(fn: (...args: Args) => void, delayMs: number): (...args: Args) => void` — used by Task 3's `fs.watch` wiring in `src/index.ts` to collapse rapid-fire file-change events (many editors fire multiple 'change'/'rename' events per logical save) into a single re-render.

- [ ] **Step 1: Write the failing tests**

Add these imports to the top of `tests/cliHelpers.test.ts` (alongside the existing ones):

```ts
import { afterEach, beforeEach, vi } from "vitest";
import { debounce } from "../src/cliHelpers.js";
```

Add a new `describe` block at the end of `tests/cliHelpers.test.ts`:

```ts
describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses rapid-fire calls into a single invocation after the delay", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced();
    debounced();

    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("passes through only the latest call's arguments", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced("first");
    debounced("second");
    vi.advanceTimersByTime(50);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("second");
  });

  it("does not fire before the delay has elapsed", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(99);

    expect(fn).not.toHaveBeenCalled();
  });

  it("fires again for a call made after a previous debounced call already resolved", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);

    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cliHelpers.test.ts -t "debounce"`
Expected: FAIL — `debounce` is not exported from `../src/cliHelpers.js` yet.

- [ ] **Step 3: Write the implementation**

Add this export to `src/cliHelpers.ts` (after `resolveOutputPath`):

```ts
/**
 * Wraps fn so rapid-fire calls collapse into a single invocation, delayMs
 * after the last call. Used to smooth out fs.watch's tendency to fire
 * multiple change events for a single logical file save.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), delayMs);
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cliHelpers.test.ts`
Expected: PASS (all `parsePort`, `resolveOutputPath`, and `debounce` cases)

- [ ] **Step 5: Commit**

```bash
git add src/cliHelpers.ts tests/cliHelpers.test.ts
git commit -m "feat(cli): add a generic debounce utility for fs.watch wiring"
```

---

### Task 3: Wire `--watch` into the `render` command

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `startServer(html, port?, { watch }?)` returning `{ url, updateHtml }` (Task 1); `debounce(fn, delayMs)` (Task 2).
- Produces: nothing new — `render`'s CLI surface gains a `--watch` boolean flag.

- [ ] **Step 1: Write the failing test**

Add these imports to the top of `tests/cli.test.ts` (alongside the existing ones from Phase 1):

```ts
import { writeFileSync } from "node:fs";
import * as http from "node:http";
```

Add this constant near the top, alongside the existing timeout constants:

```ts
const WATCH_TEST_TIMEOUT_MS = 10_000;
```

Add a new `describe` block at the end of `tests/cli.test.ts`:

```ts
describe("CLI: nh-deck render --watch", () => {
  it(
    "pushes a reload event over SSE when the watched file changes",
    async () => {
      const tempFile = path.join(
        tmpdir(),
        `nh-deck-watch-test-${randomUUID()}.md`,
      );
      writeFileSync(tempFile, "# Original\n");

      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/index.ts",
          "render",
          tempFile,
          "--no-open",
          "--port",
          "0",
          "--watch",
        ],
        { cwd: repoRoot },
      );
      activeChild = child;

      const matchedLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
      const url = matchedLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (!url) {
        throw new Error(`Could not extract URL from: ${matchedLine}`);
      }

      const reloadPromise = new Promise<string>((resolve, reject) => {
        const req = http.get(`${url}/__nh-deck-reload`, (res) => {
          res.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            if (text.includes("data:")) {
              req.destroy();
              resolve(text);
            }
          });
          res.on("error", reject);
        });
        req.on("error", reject);
      });

      // Give the SSE connection a moment to establish before triggering a change.
      await new Promise((r) => setTimeout(r, 300));
      writeFileSync(tempFile, "# Changed\n");

      const message = await reloadPromise;
      expect(message).toContain("data: reload");

      child.kill();
      await waitForExit(child, EXIT_TIMEOUT_MS);
      rmSync(tempFile, { force: true });
    },
    WATCH_TEST_TIMEOUT_MS,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cli.test.ts -t "watch"`
Expected: FAIL — `render` doesn't yet accept a `--watch` flag, and no `/__nh-deck-reload` endpoint is served.

- [ ] **Step 3: Write the implementation**

Modify `src/index.ts`'s imports from:

```ts
import { readFileSync } from "node:fs";
import { Command } from "commander";
import open from "open";
import { parsePort, resolveOutputPath } from "./cliHelpers.js";
import { exportToPdf } from "./pdfExport.js";
import { generateHtml } from "./render.js";
import { startServer } from "./server.js";
```

to:

```ts
import { readFileSync, watch as watchFile } from "node:fs";
import { Command } from "commander";
import open from "open";
import { debounce, parsePort, resolveOutputPath } from "./cliHelpers.js";
import { exportToPdf } from "./pdfExport.js";
import { generateHtml } from "./render.js";
import { startServer } from "./server.js";
```

Modify the `render` command from:

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

to:

```ts
program
  .command("render <file>")
  .description("Render a Markdown deck and serve it locally.")
  .option("--no-open", "do not open the deck in the default browser")
  .option("--port <n>", "port to listen on (default: OS-assigned)", parsePort)
  .option(
    "--watch",
    "re-render and auto-refresh the browser when the file changes",
  )
  .action(
    async (
      file: string,
      options: { open: boolean; port?: number; watch?: boolean },
    ) => {
      try {
        const markdown = readFileSync(file, "utf8");
        const html = generateHtml(markdown, file);
        const { url, updateHtml } = await startServer(html, options.port, {
          watch: options.watch,
        });

        process.stdout.write(`nh-deck serving ${file} at ${url}\n`);

        if (options.watch) {
          const rerender = debounce(() => {
            try {
              const updatedMarkdown = readFileSync(file, "utf8");
              updateHtml(generateHtml(updatedMarkdown, file));
            } catch {
              // A transient read failure (e.g. mid-save) is not fatal — the
              // next file-change event retries.
            }
          }, 100);
          watchFile(file, rerender);
        }

        if (options.open) {
          await open(url);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`nh-deck: ${message}\n`);
        process.exitCode = 1;
      }
    },
  );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/cli.test.ts -t "watch"`
Expected: PASS

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: PASS — all pre-existing `render`/`pdf` tests (which never pass `--watch`) are byte-for-byte unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/cli.test.ts
git commit -m "feat(cli): add --watch flag for live-reload on render"
```

---

### Task 4: Record the decision (ADR) and reconcile the roadmap

**Files:**
- Create: `docs/adr/0003-sse-based-live-reload.md`
- Modify: `decisions.md` (ADR Index)
- Modify: `Context.md` (Roadmap item 5 → done)

**Interfaces:** N/A (docs only).

- [ ] **Step 1: Write the ADR**

Create `docs/adr/0003-sse-based-live-reload.md`:

```markdown
# 0003. SSE-based live-reload for `render --watch`

## Status

Accepted — 2026-09-11

## Context and Problem Statement

`AGENTS.md`'s Overview line already claims the local dev server supports
"live reload" — `CODEBASE_INDEX.md` confirmed this was false: `server.ts`
had no file-watch or push mechanism at all. We need a way to detect
changes to the source Markdown file and get the open browser tab to
refresh automatically, without violating the local-first constraint (no
CDN-hosted client script, no outbound network call) and without changing
`render`'s existing default (non-watch) behavior.

## Decision Drivers

- No new runtime dependency, and no new protocol library — whatever
  push mechanism is chosen must be implementable on top of the existing
  `node:http` server.
- The client-side reload script must be inline and same-origin — never a
  CDN reference (`CLAUDE.md`'s stop-and-ask gate exists specifically for
  this class of change).
- Must not change `render`'s existing tested default behavior — ships
  behind an explicit `--watch` flag, not always-on.
- Must be genuinely testable, including the reload push itself, not just
  the file-watch trigger in isolation.

## Considered Options

1. **Server-Sent Events (SSE)** — a one-directional, server-to-client
   push mechanism natively supported by `node:http` over a normal
   HTTP/1.1 connection (`Content-Type: text/event-stream`).
2. **WebSocket** — a full bidirectional protocol, would require either a
   new dependency (`ws`) or hand-rolling the WebSocket handshake/framing
   on top of `node:http`.
3. **Client-side polling** — the browser periodically re-fetches the
   document (or a small "version" endpoint) and reloads if it changed.

## Decision Outcome

Chosen option: **Option 1 — Server-Sent Events.**

- **Option 2 (WebSocket)** was rejected: nh-deck's reload need is
  strictly one-directional (server tells the client to reload; the
  client never needs to send anything back), so a bidirectional protocol
  is more machinery than the problem calls for. Hand-rolling the
  WebSocket upgrade handshake by hand would also be exactly the kind of
  protocol-level code this project's "no bundler, minimal dependency
  surface" philosophy argues against reaching for without a real need.
- **Option 3 (polling)** was rejected: it either wastes requests (poll
  too often) or feels sluggish (poll too rarely), and still needs a
  change-detection mechanism (an ETag or content hash) that SSE's
  push-on-actual-change model makes unnecessary.
- **Option 1 (SSE)** fits `node:http` directly — it's just a long-lived
  HTTP response with a specific content type and a simple text framing
  (`data: ...\n\n`), no handshake, no extra dependency, and the browser's
  built-in `EventSource` API (used in the injected client script) handles
  reconnection automatically if the connection drops.

## Consequences

**Good:**

- Zero new dependency; SSE is native to both `node:http` and every
  browser's `EventSource` API.
- The reload script is ~2 lines of inline JavaScript, trivially
  auditable for the local-first constraint (no CDN reference, verified
  directly in tests).
- `render`'s existing non-watch behavior is provably unchanged (verified
  directly: the SSE branch and script injection are both gated behind
  `options.watch`).

**Bad:**

- SSE connections are one-directional — if nh-deck ever needs
  client-to-server signaling (e.g., a future "jump to slide N" remote
  control), a different mechanism would be needed then; not a concern
  for this phase's scope.
- An open SSE connection keeps `http.Server.close()` pending until the
  connection ends — verified directly and handled via
  `server.closeAllConnections()` in tests and would need the same
  handling in any future caller that needs a clean, immediate shutdown
  with a watch-mode server still holding an open tab.

## Confirmation

This decision is confirmed as implemented when:

1. `render --watch` re-renders and pushes a reload event when the
   source file changes.
2. `render` without `--watch` behaves identically to before this phase
   (verified: all pre-existing tests pass unmodified).
3. The reload script and endpoint are same-origin and inline — no
   `http://`/`https://` reference appears anywhere in watch-mode output.

## More Information

- See `docs/specs/feature-implementation-roadmap-design.md` §5 for how
  this fits into the broader Phase 3 roadmap item.
- See `Context.md`'s Roadmap, item 5.
```

- [ ] **Step 2: Add the ADR to `decisions.md`'s ADR Index**

Modify the ADR Index table in `decisions.md`, adding a new row after ADR-0002 (adjust if ADR-0002 has not yet landed on this branch's base — check the actual current table content first and append after whatever the last row is):

```markdown
| 0003 | [SSE-based live-reload for render --watch](docs/adr/0003-sse-based-live-reload.md) | Accepted | 2026-09-11 | —          |
```

- [ ] **Step 3: Mark Roadmap item 5 done in `Context.md`**

Modify the Roadmap section in `Context.md`, changing item 5 from:

```markdown
5. Genuine live-reload for `render` (fixes this doc's own previously-false "live reload" claim in `AGENTS.md`'s Overview).
```

to:

```markdown
5. ~~Genuine live-reload for `render`.~~ Done — `render --watch` now re-renders and pushes a same-origin SSE reload event on file change (see `docs/adr/0003-sse-based-live-reload.md`); the previously-false "live reload" claim in `AGENTS.md`'s Overview is now accurate.
```

Also update the file's "Last updated" footer line to `2026-09-11` if it does not already say so.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0003-sse-based-live-reload.md decisions.md Context.md
git commit -m "docs: record ADR-0003 (SSE-based live-reload) and mark Roadmap item 5 done"
```

---

## After all tasks: open the PR

```bash
git push -u origin feat/live-reload
```

Then open a PR against `main` per `Branches.md`'s PR-required policy (squash-merge only; the squash commit message must itself be a valid Conventional Commit — e.g. `feat(server): SSE-based live-reload for render --watch (Phase 3)`). Wait for CI to go green across all 9 matrix combinations before merging.

**Known merge friction:** this branch was cut from `main` after Phase 1 (PR #2) merged, but before Phase 2 (PR #3, slide segmentation) merged. Both Phase 2 and this phase edit `Context.md`'s Roadmap section from *different* base states (Phase 2 edited the pre-Phase-1-reconciliation 7-item list; this phase edits the post-Phase-1-reconciliation 12-item list) — whichever of Phase 2 / Phase 3 merges second will hit a real git merge conflict on that one section. Resolve by taking the already-merged side's structure and manually re-applying the other phase's "mark item N done" line to the correct item number — this is not data loss, just numbering reconciliation.
