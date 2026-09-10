# CLI Robustness & Testing — Primary-Source Research

Research backing for the 5 gaps documented in `CODEBASE_INDEX.md` §8 ("Code-level robustness gaps" / "Test coverage gaps"). Every recommendation below is grounded in either (a) this repo's own source at the paths/line numbers cited, or (b) the exact installed dependency version's shipped source/README under `node_modules/`, or (c) the live official docs page fetched during this research. No secondary blog sources were used.

Save location note: this repo has no `docs/research/` convention prior to this file. It does have `docs/adr/` for architecture decisions. This file follows that same `docs/<topic>/` nesting pattern, per the task's fallback instruction — no different existing convention was found.

---

## Gap 1 (highest severity): `render` has no try/catch, unlike `pdf`

**Current code** — `src/index.ts:18-34`:
```ts
program
  .command("render <file>")
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
Compare to `pdf`'s existing pattern at `src/index.ts:39-52`, which wraps its whole body and does `catch (error) { ...; process.stderr.write(...); process.exitCode = 1; }`.

**Why the crash happens (primary source: commander's own dispatch code).** `node_modules/commander/lib/command.js:1495-1502` chains the action handler's return value into a `promiseChain` that only becomes an unhandled rejection if the async function itself throws/rejects and nothing attaches a `.catch()`. Commander's own README (`node_modules/commander/Readme.md:668`) says explicitly:

> "You may supply an `async` action handler, in which case you call `.parseAsync` rather than `.parse`."

`src/index.ts:54` calls `program.parse()` (not `parseAsync`) for *both* subcommands, even though both actions are `async`. Because `pdf`'s handler fully swallows its own rejections in an internal try/catch, this mismatch is invisible for `pdf` — but for `render`, a rejected `readFileSync` throw, a rejected `startServer` promise, or a rejected `open()` call becomes an unhandled promise rejection, which Node prints as a raw, unhandled-rejection stack trace instead of a controlled CLI error. This is exactly the symptom in `CODEBASE_INDEX.md`.

**Fix — mirror `pdf`'s existing, already-correct pattern exactly:**
```ts
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
This requires no change to `program.parse()` at the bottom — wrapping the entire async body in try/catch means the action's returned promise always resolves (never rejects), so it is safe under plain `.parse()`, exactly as `pdf`'s handler already demonstrates in production. (Switching to `parseAsync()` per the Commander README quote above would be a reasonable *complementary* hardening — it makes `program.parse()` await the action chain and guarantees `process.exitCode` is set before Node exits — but it is not required to fix this specific gap and is out of scope for a minimal fix.)

**Citations:**
- `node_modules/commander/lib/command.js:1495-1502` (action handler → `promiseChain`)
- `node_modules/commander/Readme.md:668` ("You may supply an `async` action handler, in which case you call `.parseAsync` rather than `.parse`.")
- `src/index.ts:39-52` (this repo's own working precedent — `pdf`'s try/catch)

---

## Gap 2: `--port` passed through `Number(options.port)` with no validation

**Current code** — `src/index.ts:26`: `const port = options.port !== undefined ? Number(options.port) : undefined;` — `Number("abc")` is `NaN`, `Number("-1")` is `-1`, `Number("99999")` is `99999`; none are rejected before reaching `server.listen()` in `src/server.ts:27`.

**Best fix — validate at parse time via Commander's own "custom option processing," not inside the action.** `node_modules/commander/Readme.md:447-471` documents exactly this pattern:
```js
function myParseInt(value, dummyPrevious) {
  const parsedValue = parseInt(value, 10);
  if (isNaN(parsedValue)) {
    throw new commander.InvalidArgumentError('Not a number.');
  }
  return parsedValue;
}
program.option('-i, --integer <number>', 'integer argument', myParseInt);
```
Commander's dispatcher (`node_modules/commander/lib/command.js:572-582`, `_callParseArg`) specifically catches an error whose `.code === 'commander.invalidArgument'` (i.e. a thrown `InvalidArgumentError`, defined in `node_modules/commander/lib/error.js`) and converts it into `this.error(...)` — Commander's own controlled stderr-message-plus-`process.exit` path (`node_modules/commander/lib/command.js:1814-1831`). This means a validated `--port` option gets a friendly, Commander-formatted error message and a clean exit **before the action handler ever runs** — no manual validation code needed in `src/index.ts`'s action body at all.

**Fix — `src/index.ts`:**
```ts
import { Command, InvalidArgumentError } from "commander";

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new InvalidArgumentError("port must be an integer between 0 and 65535.");
  }
  return port;
}

program
  .command("render <file>")
  .option("--no-open", "do not open the deck in the default browser")
  .option("--port <n>", "port to listen on (default: OS-assigned)", parsePort)
  .action(async (file: string, options: { open: boolean; port?: number }) => {
    // options.port is now already a validated number | undefined — no Number(...) needed
    const { url } = await startServer(html, options.port);
    ...
  });
```
`Number.isInteger` is the right guard here because it returns `false` (never throws) for `NaN`, `Infinity`, and non-numeric strings coerced to `NaN` — confirmed by MDN: "If the value is `NaN` or `Infinity`, return `false`... It will always return `false` if the value is not a number." (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isInteger). The `0`–`65535` bound matches the range Node's own port validation enforces (`ERR_SOCKET_BAD_PORT`, https://nodejs.org/api/errors.html#err_socket_bad_port) and is consistent with `src/server.ts`'s own default of `port = 0` meaning "OS-assigned," which Node's docs confirm: "If `port` is omitted or is `0`, the operating system will assign an arbitrary unused port" (https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback).

**Runtime port conflicts (a valid port that's already bound) are a separate, already-correctly-handled case.** Node's own `net.html` docs (`#serverlisten`) document the pattern:
```js
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { /* ... */ }
});
```
`src/server.ts:23-25` already does the equivalent — `server.once("error", (err) => { reject(err); })` — converting an `EADDRINUSE` (or any other bind error) into a promise rejection instead of letting it crash. That rejection is exactly what Gap 1's `try/catch` fix will catch and print as a friendly `nh-deck: <message>` line. Gaps 1 and 2 compose: Gap 2 stops malformed input before it reaches `listen()`; Gap 1 catches legitimate runtime failures (including `EADDRINUSE`) that `server.ts` already correctly surfaces as a rejection.

**Citations:**
- `node_modules/commander/Readme.md:447-497` ("Custom option processing", `InvalidArgumentError` example)
- `node_modules/commander/lib/command.js:572-582` (`_callParseArg` catching `commander.invalidArgument`)
- `node_modules/commander/lib/error.js` (defines `InvalidArgumentError`)
- MDN `Number.isInteger`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isInteger
- Node `ERR_SOCKET_BAD_PORT`: https://nodejs.org/api/errors.html#err_socket_bad_port
- Node `server.listen()` / port 0 semantics: https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback
- Node `server` `'error'` event / `EADDRINUSE` pattern: https://nodejs.org/api/net.html#serverlisten (section "`server.listen()`")
- `src/server.ts:23-25, 27` (this repo's own existing, already-correct error-to-rejection conversion)

---

## Gap 3: `pdf`'s default output path can silently reuse the input filename

**Current code** — `src/index.ts:42`: `const outputPath = output ?? file.replace(/\.md$/, ".pdf");` — if `file` doesn't end in `.md` (e.g. `deck`, `deck.markdown`, `deck.txt`), the regex doesn't match, `.replace()` returns the string unchanged, and `outputPath === file`: the PDF export will attempt to overwrite the user's source file.

This gap has no third-party library API to validate against (it's pure application path logic), so the fix leans on Node's own `node:path` primitives rather than a hand-rolled regex, per this repo's own coding-style rule against hand-rolled parsing where a standard-library primitive exists:

> "`path.extname()` ... returns the extension of the path... If there is no `.` in the last portion of the path... an empty string is returned." — https://nodejs.org/api/path.html#pathextnamepath

**Fix:**
```ts
import { extname } from "node:path";

const outputPath =
  output ?? (extname(file) === ".md" ? file.replace(/\.md$/, ".pdf") : `${file}.pdf`);

if (resolve(outputPath) === resolve(file)) {
  throw new Error(
    `Refusing to overwrite the source file (${file}). Pass an explicit output path.`,
  );
}
```
The `extname()` check makes the "no `.md` suffix" branch produce `deck.pdf` instead of `deck` (append, don't silently no-op the replace). The `resolve(...) === resolve(...)` guard is a defense-in-depth backstop for any remaining edge case (e.g. an explicit `output` argument equal to the input file) and should raise the same friendly error class the Gap-1 try/catch already prints.

**Citation:**
- Node `path.extname()`: https://nodejs.org/api/path.html#pathextnamepath
- `src/index.ts:36-52` (this repo's own `pdf` command, where the change applies)

---

## Gap 4 (highest severity): `puppeteer.launch()` outside try/finally; `installations[0]` selection

**Current code** — `src/pdfExport.ts:17-37`:
```ts
const installations = Launcher.getInstallations();
if (!installations || installations.length === 0) {
  throw new Error("No local Chrome, Chromium, Edge, or Brave installation was found. ...");
}
const executablePath = installations[0];
const browser = await puppeteer.launch({ executablePath, headless: true }); // <-- outside try
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({ path: outputPath, format: "A4", printBackground: true });
  await page.close();
} finally {
  await browser.close();
}
```

### 4a. `installations[0]` is *not* a missing-selection-logic bug — it's chrome-launcher's own documented default

This is the one place primary-source research overturned the framing in `CODEBASE_INDEX.md`. chrome-launcher's own shipped source and README both document `installations[0]` as the *intended* selection when no explicit `chromePath` is given:

- README (`node_modules/chrome-launcher/README.md:132-136`):
  > "`ChromeLauncher.Launcher.getInstallations()` — Returns an `Array<string>` of paths to available Chrome installations. **When `chromePath` is not provided to `.launch()`, the first installation returned from this method is used instead.**"
- Source doc comment (`node_modules/chrome-launcher/dist/chrome-launcher.js:137`):
  > `/** Returns all available chrome installations in decreasing priority order. */`
  > `static getInstallations() { return chromeFinder[getPlatform()](); }`
- chrome-launcher's *own* internal default-selection helper does exactly what nh-deck does (`node_modules/chrome-launcher/dist/chrome-launcher.js:132-136`):
  ```js
  static getFirstInstallation() {
    if (getPlatform() === 'darwin') return chromeFinder.darwinFast();
    return chromeFinder[getPlatform()]()[0];
  }
  ```
  and `Launch.prototype.launch()` calls `Launcher.getFirstInstallation()` when no `chromePath` option is passed (`node_modules/chrome-launcher/dist/chrome-launcher.js:201-207`).
- The array ordering itself is not arbitrary — each platform finder (`darwin()`, `linux()` in `node_modules/chrome-launcher/dist/chrome-finder.js:52-72, 91-139`) assigns a numeric `weight` per browser/channel via a `priorities` table and sorts descending (`function sort(...)`, `chrome-finder.js:170-184`) — e.g. on Linux, `google-chrome-stable` (weight 50) ranks above `chromium-browser` (weight 48).

**Recommendation:** do not add custom selection logic — that would *diverge* from chrome-launcher's own contract, not fix a bug. The only worthwhile change is a one-line comment documenting *why* `installations[0]` is correct (citing the README line above), so a future reader doesn't "fix" it into a regression. Optionally, for user transparency, log which path was picked (not required for correctness).

### 4b. `puppeteer.launch()` outside try/finally — this is a real gap

Puppeteer-core's own `BrowserLauncher.launch()` (`node_modules/puppeteer-core/src/node/BrowserLauncher.ts:74-219`) can throw for reasons distinct from "no browser found" — e.g. a corrupt/incompatible binary, a permissions error, or a connection timeout (`timeout` option, default `30_000`ms per `LaunchOptions.ts:60-65`: *"Maximum time in milliseconds to wait for the browser to start... @defaultValue `30_000`"*). In nh-deck's current code, none of these get the same friendly-error treatment as "no browser found" — they propagate as raw, unwrapped errors.

**Important secondary finding:** you do *not* need to add manual child-process cleanup for a `launch()` failure. Puppeteer's own `launch()` already guarantees this internally — its `catch` block calls `browserCloseCallback()` (which kills the spawned browser process) before rethrowing (`node_modules/puppeteer-core/src/node/BrowserLauncher.ts:210-216`):
```ts
} catch (error) {
  void browserCloseCallback();
  if (error instanceof BrowsersTimeoutError) { throw new TimeoutError(error.message); }
  throw error;
}
```
So the only work nh-deck needs to do is (1) get the launch call inside the friendly-error path, and (2) not call `browser.close()` on a `browser` that was never assigned because `launch()` itself threw.

**Fix:**
```ts
export async function exportToPdf(html: string, outputPath: string): Promise<void> {
  const installations = Launcher.getInstallations(); // installations[0] below is correct per
                                                       // chrome-launcher's own documented default
                                                       // selection (README: "the first installation
                                                       // returned from this method is used instead").
  if (!installations || installations.length === 0) {
    throw new Error(
      "No local Chrome, Chromium, Edge, or Brave installation was found. " +
        "nh-deck requires one of these browsers to be installed on this machine to export PDFs. " +
        "An automatic download fallback is a planned but not-yet-implemented feature.",
    );
  }
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
`browser?.close()` in `finally` is the key correctness fix: it guards against the case where `launch()` itself threw and `browser` was never assigned (previously `browser.close()` in `finally` was unreachable in that case only because `launch()` wasn't inside the `try` at all — moving it in without the `?.` guard would instead throw `Cannot read properties of undefined` inside `finally`, masking the real error).

**Citations:**
- `node_modules/chrome-launcher/README.md:132-136`
- `node_modules/chrome-launcher/dist/chrome-launcher.js:132-140, 201-207`
- `node_modules/chrome-launcher/dist/chrome-finder.js:52-72, 91-139, 170-184`
- `node_modules/puppeteer-core/src/node/BrowserLauncher.ts:74-219` (full `launch()` method, incl. internal cleanup-on-failure at 210-216)
- `node_modules/puppeteer-core/src/node/LaunchOptions.ts:60-65` (`timeout` option, default `30_000`)
- Puppeteer-core README usage snippet (`node_modules/puppeteer-core/README.md:28-53`) — for context: even Puppeteer's own minimal example does *not* model try/finally around `launch()`/`close()`, so this pattern is a nh-deck-side hardening decision, not something contradicted by upstream docs.

---

## Gap 5: test coverage gaps

### 5a. Zero CLI-process integration test for `pdf`

No external primary source is needed here — the correct pattern already exists in this repo. `tests/cli.test.ts` (all of it) is the primary source: it spawns `node --import tsx src/index.ts render fixtures/sample.md --no-open --port 0` as a real child process (deliberately avoiding `npx tsx`/the `tsx` CLI binary to prevent an orphaned wrapper-process, per the comment at `tests/cli.test.ts:29-38`), waits for a stdout pattern match, then kills and waits for clean exit.

**Fix — add an analogous `describe("CLI: nh-deck pdf", ...)` block** in the same file (or a sibling file), spawning:
```ts
spawn(process.execPath, ["--import", "tsx", "src/index.ts", "pdf", "fixtures/sample.md", outputPath], { cwd: repoRoot })
```
asserting on the `Wrote PDF to ${outputPath}\n` stdout line (`src/index.ts:46`) and on `existsSync(outputPath)` afterward (reusing the `randomUUID()` tmpdir pattern already established in `tests/pdfExport.test.ts:41-45` to avoid collisions), with cleanup in `afterEach` mirroring `tests/pdfExport.test.ts:26-31`. Since this spawns the real CLI end-to-end (real chrome-launcher + real puppeteer-core, no mocks), it should use a timeout budget similar to `tests/pdfExport.test.ts`'s `PDF_EXPORT_TIMEOUT_MS = 60_000`, not `cli.test.ts`'s much shorter `STARTUP_TIMEOUT_MS`.

### 5b. "No browser found" branch in `pdfExport.ts` is completely untested

This is the one gap that specifically needs a DI/mocking-seam decision, because `tests/pdfExport.test.ts` is deliberately real-E2E (no mocks) end-to-end, per its own file comment (`tests/pdfExport.test.ts:18-21`) and per `AGENTS.md`'s Known Gotchas, which explicitly calls out this exact branch as required-but-untested.

**Vitest's own documented pattern for mocking one named export while leaving the rest of a module (and, critically, a *different* module like `puppeteer-core`) untouched** is `vi.mock` + `vi.importActual` (https://vitest.dev/api/vi.html#vi-mock):
```js
vi.mock('./example.js', async () => {
  const originalModule = await vi.importActual('./example.js')
  return { ...originalModule, get: vi.fn() }
})
```
Applied to `chrome-launcher` only — `puppeteer-core` is never imported by this test file, so it is never touched, keeping `tests/pdfExport.test.ts`'s real-E2E test in a separate file fully unaffected:

**New file — e.g. `tests/pdfExport.noBrowser.test.ts`:**
```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("chrome-launcher", async () => {
  const actual = await vi.importActual<typeof import("chrome-launcher")>("chrome-launcher");
  return {
    ...actual,
    Launcher: { ...actual.Launcher, getInstallations: () => [] },
  };
});

describe("exportToPdf — no browser installed", () => {
  it("throws a clear, actionable error instead of hanging or crashing", async () => {
    const { exportToPdf } = await import("../src/pdfExport.js");
    await expect(exportToPdf("<html></html>", "/tmp/should-not-be-created.pdf")).rejects.toThrow(
      /No local Chrome, Chromium, Edge, or Brave installation was found/,
    );
  });
});
```
This is a genuine unit test of the guard clause at `src/pdfExport.ts:19-25` — it never reaches `puppeteer.launch()` at all (the function returns before that line), so there is no real browser process involved and no conflict with the "real E2E" philosophy of the *other* test file. Because `vi.mock` is module-scoped per test file, this can live alongside — but should NOT live inside — `tests/pdfExport.test.ts`, to keep that file's "no mocks anywhere" invariant literally true.

### 5c. No unit test file for `src/server.ts` or `src/index.ts`

`src/server.ts` exports a pure, dependency-light `startServer(html, port?)` (`src/server.ts:16-38`) that is fully testable without spawning a CLI process at all — a real gap, since it's currently only exercised indirectly through `tests/cli.test.ts`'s subprocess test. A `tests/server.test.ts` can call `startServer()` directly, issue a real `fetch()`/`http.get()` against the returned `url`, assert the response body equals the input `html` and the `Content-Type` header, then call `server.close()` — no mocking needed since `startServer` has no external dependencies beyond `node:http` itself.

**Citations:**
- Vitest `vi.mock` / `vi.importActual`: https://vitest.dev/api/vi.html#vi-mock
- `tests/cli.test.ts` (this repo, full file — the pattern to replicate for `pdf`)
- `tests/pdfExport.test.ts:18-21, 26-31, 41-45` (real-E2E philosophy + cleanup/uniqueness pattern to preserve)
- `AGENTS.md` "Known Gotchas" (this repo — explicitly requires the "no browser found" case to be tested)
- `src/server.ts:16-38` (dependency-light `startServer`, directly unit-testable)

---

## Summary table

| Gap | Fix | Primary source |
|---|---|---|
| 1. `render` no try/catch | Wrap full action body in try/catch, matching `pdf`'s existing pattern | `node_modules/commander/lib/command.js:1495-1502`; `Readme.md:668` |
| 2. Unvalidated `--port` | Commander custom `parseArg` (`InvalidArgumentError` + `Number.isInteger` + 0–65535 range) | `node_modules/commander/Readme.md:447-497`; `lib/command.js:572-582`; MDN `Number.isInteger`; Node `ERR_SOCKET_BAD_PORT`/`net.html` |
| 3. `pdf` default output self-overwrite | `path.extname()` check + append-not-replace + resolved-path equality guard | Node `path.extname()` docs |
| 4. `puppeteer.launch()` outside try/finally; `installations[0]` | Move `launch()` into try, guard `finally { await browser?.close(); }`; keep `installations[0]` (it's correct) | `node_modules/chrome-launcher/README.md:132-136`, `dist/chrome-launcher.js:132-140,201-207`; `node_modules/puppeteer-core/src/node/BrowserLauncher.ts:74-219` |
| 5. Test gaps | `pdf` CLI integration test (mirror `cli.test.ts`); `vi.mock`+`vi.importActual` on `chrome-launcher` only for the "no browser" branch in a new file; direct unit test for `server.ts` | Vitest `vi.mock` docs; `tests/cli.test.ts`, `tests/pdfExport.test.ts` (this repo) |
