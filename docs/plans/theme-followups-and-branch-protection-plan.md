# Theme-System Follow-Up Fixes + Branch Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two real correctness gaps a post-ship backlog survey found in the just-shipped theme system (Mermaid diagrams not recolored; `--watch` not re-resolving frontmatter `theme:`), and add branch protection to `main` so a failing CI run can never silently merge again (as one already did on 2026-09-11, leaving `main` red for ~11.5 hours unnoticed).

**Architecture:** Tasks 1-2 are surgical fixes to already-shipped code (`src/render.ts`, `src/mermaidRenderer.ts` is untouched — only its existing `colors` parameter finally gets used; `src/index.ts`). Task 3 is a GitHub repository setting, not code — no branch/PR for it, applied directly via `gh api` with explicit confirmation before the actual write, per this plan's own note in that task.

**Tech Stack:** No new dependencies for Tasks 1-2. Task 3 uses `gh api` (already the tool used throughout this project's history for repo administration).

**Spec:** No separate spec doc — both code fixes complete behavior that was already decided and approved (docs/specs/theme-system-design.md §2's "theme scope: everything, including Mermaid diagrams" decision; the CLI-integration task's own intent that frontmatter travels with the file). These are bug fixes against an existing, approved design, not new design decisions requiring a fresh brainstorming pass. Branch protection settings are described in Task 3 itself.

## Global Constraints

- **No behavior change for the no-theme case.** Task 1's fix must not alter Mermaid rendering when no theme is active (`themeColors` is `undefined`) — `renderMermaidDiagram(text, undefined)` must produce byte-identical output to today's `renderMermaidDiagram(text)`.
- **No new warning spam.** Task 2's fix must NOT reprint the `--css`-override note or the unknown-theme warning on every debounced re-render — only on the initial render, matching the existing (tested) precedent for the unsafe-HTML warning in the same file.
- **`generateHtml` remains synchronous** — Task 1's fix relies on this. Do not introduce `async`/`await` anywhere in `generateHtml`'s call chain as part of this fix; if that ever becomes necessary for an unrelated reason, Task 1's approach (a module-level "current call" variable) would need re-examination.
- **Tab indentation** (biome.json's mandate) — a PostToolUse hook in some environments reformats edited files to 2-space; if hit, run `npx biome format --write <file>` via Bash afterward (does not retrigger the hook) before committing.

## Pre-flight conflict scan

| Pair / Task | Shared file / interface | Finding |
|---|---|---|
| Task 1 ↔ Task 2 | none | Task 1 touches only `src/render.ts` + `tests/render.test.ts`. Task 2 touches only `src/index.ts` + `tests/cli.test.ts`. No shared files, no ordering dependency — safe to do in either order or in parallel. |
| Task 1 ↔ Task 3 | none | Task 3 is a GitHub setting, no file overlap. |
| Task 2 ↔ Task 3 | none | Same. |

No conflicts found. Tasks 1 and 2 may be done in parallel by two different implementers if desired; Task 3 is independent of both and can happen at any point (it's not code).

---

### Task 1: Thread the active theme's colors into Mermaid diagram rendering

**Files:**
- Modify: `src/render.ts`
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: `renderMermaidDiagram(code: string, colors?: ThemeColors)` from `src/mermaidRenderer.ts` — already implemented and unit-tested in isolation; this task is the missing wiring, not a change to that function.

- [ ] **Step 1: Read the current file in full**

Read `src/render.ts` end to end. Confirm the exact current structure: `marked.use({ renderer: { code(...) {...} } })` is registered once at module load (outside `generateHtml`'s body), and its mermaid branch currently calls `renderMermaidDiagram(text)` with no second argument.

- [ ] **Step 2: Write the failing tests**

Add to `tests/render.test.ts` (inside or near the existing `describe("generateHtml", ...)` block):

```ts
it("recolors Mermaid diagrams to match the active theme", () => {
	const deckWithDiagram =
		"```mermaid\nflowchart TD\n  A --> B\n```\n";

	const lightHtml = generateHtml(deckWithDiagram, "sample", undefined, {
		bg: "#ffffff",
		fg: "#1f2328",
	});
	const darkHtml = generateHtml(deckWithDiagram, "sample", undefined, {
		bg: "#0d1117",
		fg: "#e6edf3",
	});

	expect(lightHtml).not.toBe(darkHtml);
	// The dark theme's bg should actually appear somewhere in the rendered
	// Mermaid SVG (fill/background attribute), not just in the CSS
	// custom-property block generated for the base deck.
	const svgOnly = darkHtml.slice(
		darkHtml.indexOf("<svg"),
		darkHtml.indexOf("</svg>") + "</svg>".length,
	);
	expect(svgOnly).toContain("#0d1117");
});

it("renders Mermaid diagrams identically to today when no theme is active", () => {
	const deckWithDiagram =
		"```mermaid\nflowchart TD\n  A --> B\n```\n";

	const withoutTheme = generateHtml(deckWithDiagram, "sample");
	const withUndefinedTheme = generateHtml(
		deckWithDiagram,
		"sample",
		undefined,
		undefined,
	);

	expect(withUndefinedTheme).toBe(withoutTheme);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/render.test.ts -t "recolors Mermaid"`
Expected: FAIL — the two theme calls currently produce identical Mermaid SVG output (the bug).

- [ ] **Step 4: Write the implementation**

The fix: introduce a module-level "current call" variable, set it at the top of `generateHtml`, and read it inside the `code()` renderer's mermaid branch. This is safe because `generateHtml` is fully synchronous end to end (`marked.lexer`, `splitIntoSlides`, `.map`, `marked.parser` — no `await` anywhere in the chain), so Node's single-threaded execution guarantees no other `generateHtml` call can interleave and see a stale value.

In `src/render.ts`, near the top (after the existing imports and style constants, before the `marked.use(...)` calls):

```ts
// Set at the top of generateHtml (below) and read inside the code()
// renderer override's mermaid branch. Safe despite being module-level
// mutable state: generateHtml is fully synchronous end to end (no
// `await` anywhere in its call chain), and marked.use() registers this
// renderer once at module load -- it has no other way to receive
// per-call data, since it isn't invoked as part of a per-call closure.
// Node's single-threaded execution model guarantees no other
// generateHtml() call can interleave and observe a stale value here.
let currentMermaidColors: ThemeColors | undefined;
```

Then change the `code()` renderer's mermaid branch:

```ts
			if (langString === "mermaid") {
				return renderMermaidDiagram(text, currentMermaidColors);
			}
```

Then, at the top of `generateHtml`'s body (before `const tokens = marked.lexer(markdown);`):

```ts
export function generateHtml(
	markdown: string,
	title?: string,
	customCss?: string,
	themeColors?: ThemeColors,
): string {
	currentMermaidColors = themeColors;
	const tokens = marked.lexer(markdown);
	// ... rest of the function body is unchanged ...
```

No other lines in `render.ts` change. `themeToCssVarBlock` and the rest of the theme-application logic for the base deck's CSS custom properties are untouched.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/render.test.ts`
Expected: PASS, including both new tests and every pre-existing test in the file (especially the byte-identical-default-output regression test from the theme-system plan — this fix must not break it).

- [ ] **Step 6: Format, lint, typecheck, full suite**

Run: `npx biome format --write src/render.ts tests/render.test.ts && npm run build && npm run lint && npm run typecheck && npm test`
Expected: all clean. Pay attention to `tests/mermaidRenderer.test.ts` too — it should be entirely unaffected (this task changes no line in `mermaidRenderer.ts`).

- [ ] **Step 7: Commit**

```bash
git add src/render.ts tests/render.test.ts
git commit -m "fix(render): thread active theme colors into Mermaid diagram rendering

generateHtml received a themeColors parameter and used it for the base
deck's CSS custom properties, but the marked code() renderer override
(registered once at module load, outside generateHtml's closure) never
passed it to renderMermaidDiagram -- so a themed deck's Mermaid diagrams
silently kept beautiful-mermaid's default colors. Fixed via a
module-level 'current call' variable, safe because generateHtml is
fully synchronous end to end."
```

---

### Task 2: Re-resolve frontmatter `theme:` on every `--watch` re-render

**Files:**
- Modify: `src/index.ts`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Produces: a refactored `resolveEffectiveTheme` split into a pure computation (no side effects) plus explicit warning-printing at call sites — needed so the watch-mode rerender path can recompute silently without spamming stderr on every save.

- [ ] **Step 1: Read the current file in full**

Read `src/index.ts` end to end. Confirm the exact current `resolveEffectiveTheme` function (which both computes theme colors AND writes warnings/notes to `process.stderr` as a side effect) and the three call sites (`render`, `pdf`, `png`), plus the `--watch` rerender closure that currently discards the freshly-parsed `frontmatter` and reuses the outer `themeColors`.

- [ ] **Step 2: Write the failing test**

Add to `tests/cli.test.ts`, inside (or near) the existing `describe("CLI: theme selection", ...)` and `describe("CLI: nh-deck render --watch", ...)` blocks. This file already imports `* as http from "node:http"` and uses `http.get` (not `fetch`) elsewhere (see the existing SSE-reload tests) -- match that exact pattern rather than introducing `fetch`:

```ts
function fetchPage(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const req = http.get(url, (res) => {
			let body = "";
			res.on("data", (chunk: Buffer) => {
				body += chunk.toString();
			});
			res.on("end", () => resolve(body));
			res.on("error", reject);
		});
		req.on("error", reject);
	});
}

it(
	"re-applies a deck's own updated frontmatter theme: value on a debounced re-render",
	async () => {
		const dir = mkdtempSync(join(tmpdir(), "nh-deck-watch-theme-"));
		const deckPath = join(dir, "deck.md");
		writeFileSync(
			deckPath,
			"---\ntheme: light\n---\n# Slide one\n",
		);

		const child = spawn(
			process.execPath,
			["--import", "tsx", "src/index.ts", "render", deckPath, "--watch", "--no-open", "--port", "0"],
			{ cwd: repoRoot },
		);
		activeChild = child;
		const servingLine = await waitForServingLine(child, STARTUP_TIMEOUT_MS);
		const url = servingLine.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
		if (!url) {
			throw new Error(`Could not extract URL from: ${servingLine}`);
		}

		const initialHtml = await fetchPage(url);
		expect(initialHtml).toContain("--nh-bg: #ffffff"); // light theme

		// Edit the deck's frontmatter to a different theme, then wait for
		// the debounced re-render to pick it up.
		writeFileSync(deckPath, "---\ntheme: dark\n---\n# Slide one\n");
		await new Promise((resolve) => setTimeout(resolve, 500));

		const updatedHtml = await fetchPage(url);
		expect(updatedHtml).toContain("--nh-bg: #0d1117"); // dark theme (github-dark)

		child.kill();
		await waitForExit(child, EXIT_TIMEOUT_MS);
		rmSync(dir, { recursive: true, force: true });
	},
	WATCH_TEST_TIMEOUT_MS,
);
```

If a `fetchPage`-shaped helper already exists elsewhere in this file by the time this task is implemented (check first), reuse it instead of adding a duplicate.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/cli.test.ts -t "re-applies a deck's own updated frontmatter theme"`
Expected: FAIL — the served page still shows the light theme's colors after the frontmatter edit (the bug).

- [ ] **Step 4: Write the implementation**

Refactor `resolveEffectiveTheme` to separate computation from the side effect, then update all three call sites and the watch rerender closure.

In `src/index.ts`, replace the current `resolveEffectiveTheme` function:

```ts
/**
 * Computes the effective theme colors for a render/pdf/png invocation,
 * handling frontmatter/--theme precedence and --css mutual exclusivity.
 * Pure -- no side effects -- so callers can print any resulting
 * warning/note explicitly (and skip printing it on a silent
 * recomputation, e.g. a --watch debounced re-render, matching this
 * file's existing "warn once, not on every re-render" precedent for
 * UNSAFE_HTML_WARNING). See docs/specs/theme-system-design.md §3.5/§4
 * for the exact precedence rules this implements.
 *
 * Returns colors: undefined when no theme should be applied (customCss
 * given, or nothing was requested).
 */
function computeEffectiveTheme(
	frontmatterTheme: string | undefined,
	flagTheme: string | undefined,
	customCss: string | undefined,
): { colors: ThemeColors | undefined; message?: string } {
	const requested = flagTheme ?? frontmatterTheme;

	if (customCss) {
		if (requested) {
			return {
				colors: undefined,
				message: `nh-deck: note: --css overrides the requested theme '${requested}'; it was not applied.\n`,
			};
		}
		return { colors: undefined };
	}

	if (!requested) {
		return { colors: undefined };
	}

	const { name, warning } = resolveThemeName(requested);
	return {
		colors: THEMES[name].colors,
		message: warning ? `${warning}\n` : undefined,
	};
}
```

Update all three initial call sites (`render`, `pdf`, `png` action handlers) from:

```ts
				const themeColors = resolveEffectiveTheme(
					frontmatter.theme,
					options.theme,
					customCss,
				);
```

to:

```ts
				const { colors: themeColors, message: themeMessage } =
					computeEffectiveTheme(frontmatter.theme, options.theme, customCss);
				if (themeMessage) {
					process.stderr.write(themeMessage);
				}
```

(Match the exact `options.theme` vs `options?.theme` optionality already present at each of the three call sites — `render`'s options are non-optional, `pdf`/`png`'s are `options?: {...}`.)

Then fix the `--watch` rerender closure:

```ts
				if (options.watch) {
					const rerender = debounce(() => {
						try {
							const updatedRawMarkdown = readFileSync(file, "utf8");
							const { frontmatter: updatedFrontmatter, body: updatedMarkdown } =
								parseFrontmatter(updatedRawMarkdown);
							const { colors: updatedThemeColors } = computeEffectiveTheme(
								updatedFrontmatter.theme,
								options.theme,
								customCss,
							);
							updateHtml(
								generateHtml(
									updatedMarkdown,
									file,
									customCss,
									updatedThemeColors,
								),
							);
						} catch {
							// A transient read failure (e.g. mid-save) is not fatal — the
							// next file-change event retries.
						}
					}, 100);
					const watcher = watchFileForChanges(file, rerender);
					closeWatcherOnServerClose(watcher, server);
				}
```

Note the rerender closure deliberately discards `computeEffectiveTheme`'s `message` field — this is the "silent recomputation" behavior Global Constraints requires (no warning/note spam on every save).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS, including the new test and every pre-existing test in the file (especially the existing `--css`-override-note and unknown-theme-warning tests, which must still pass unchanged since `computeEffectiveTheme` + explicit-print-at-call-site produces the same visible behavior as before for the non-watch paths — only the internal structure changed).

- [ ] **Step 6: Format, lint, typecheck, full suite**

Run: `npx biome format --write src/index.ts tests/cli.test.ts && npm run build && npm run lint && npm run typecheck && npm test`

- [ ] **Step 7: Commit**

```bash
git add src/index.ts tests/cli.test.ts
git commit -m "fix(cli): re-resolve frontmatter theme: on every --watch re-render

The rerender closure re-parsed frontmatter on each file change but
discarded the result and reused the themeColors captured once before
the watcher started -- so editing a deck's own theme: key while
--watch was running had no visible effect until restart. Split
resolveEffectiveTheme into a pure computation plus explicit
warning-printing at call sites, so the rerender path can recompute
silently (matching the existing 'warn once' precedent for the
unsafe-HTML warning) instead of either staying stale or re-spamming
stderr on every save."
```

---

### Task 3: Add branch protection to `main`

**Not code — a GitHub repository setting, applied directly via `gh api`. No branch, no PR, no worktree for this task.**

**Why:** on 2026-09-11, a push-to-main CI run failed (Windows puppeteer-launch flakiness) and `main` stayed red for ~11.5 hours until an unrelated PR happened to go green the next morning — no fix, revert, rerun, or tracking issue addressed it, because nothing currently prevents a failing check from landing on `main` (confirmed via `gh api repos/sairam0424/nh-deck/branches/main/protection` → `404 Branch not protected`).

**Decision (already made, stated here for the record):** require all 11 existing status checks to pass before merging into `main`, and enforce this for administrators too — matching this project's own already-documented convention (`AGENTS.md`'s "Every change goes through a PR, even solo") by making it a technical requirement rather than only a stated norm. Do **not** require a minimum number of PR approvals (this is a single-maintainer project; requiring the sole maintainer's own approval of their own PR is not meaningful).

- [ ] **Step 1: Confirm current state (already done once above, re-confirm before applying)**

Run: `gh api repos/sairam0424/nh-deck/branches/main/protection` — expect `404 Branch not protected`. If this now returns a real protection object instead, STOP and investigate before proceeding (something changed since this plan was written).

- [ ] **Step 2: Confirm the exact current set of required check names**

Run: `gh pr checks 17 --repo sairam0424/nh-deck` (or any other recent PR) and list every distinct check name. As of this plan's writing, the 11 are:

```
GitGuardian Security Checks
PDF/PNG cross-browser fidelity check
build-and-test (macos-14, 20)
build-and-test (macos-14, 22)
build-and-test (macos-14, latest)
build-and-test (ubuntu-latest, 20)
build-and-test (ubuntu-latest, 22)
build-and-test (ubuntu-latest, latest)
build-and-test (windows-latest, 20)
build-and-test (windows-latest, 22)
build-and-test (windows-latest, latest)
```

If this list has changed (a job renamed, added, or removed since this plan was written), use the actual current list, not this plan's copy.

- [ ] **Step 3: STOP -- confirm with the user before applying**

This changes a shared repository setting (not reversible by a simple `git revert`, and affects every future PR/push to `main`, including the user's own). Per this plan's own instruction: present the exact API call below to the user and get explicit confirmation before running it, even though it was discussed and approved at planning time -- applying a shared-infrastructure change is a separate action from planning it.

- [ ] **Step 4: Apply branch protection**

```bash
gh api --method PUT repos/sairam0424/nh-deck/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "GitGuardian Security Checks",
      "PDF/PNG cross-browser fidelity check",
      "build-and-test (macos-14, 20)",
      "build-and-test (macos-14, 22)",
      "build-and-test (macos-14, latest)",
      "build-and-test (ubuntu-latest, 20)",
      "build-and-test (ubuntu-latest, 22)",
      "build-and-test (ubuntu-latest, latest)",
      "build-and-test (windows-latest, 20)",
      "build-and-test (windows-latest, 22)",
      "build-and-test (windows-latest, latest)"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null
}
EOF
```

Note: GitHub's branch-protection API expects `contexts` (legacy, still supported and simplest for a single-repo setup) rather than the newer `checks` array with explicit app IDs -- `contexts` matching by name is sufficient here and avoids needing to look up each check's app ID.

- [ ] **Step 5: Verify**

Run: `gh api repos/sairam0424/nh-deck/branches/main/protection` — expect a real protection object now (not 404), with `required_status_checks.contexts` containing all 11 names and `enforce_admins.enabled: true`.

- [ ] **Step 6: Confirm it actually blocks a red PR (optional but recommended)**

If practical, open a throwaway branch with a deliberately failing test, push it, open a PR, and confirm the merge button is disabled / a merge attempt via `gh pr merge` is rejected while a required check is red. Close/delete the throwaway PR and branch afterward without merging.

No commit for this task -- it is a repository setting, not a file change.

---

## After Tasks 1-2: final review, then PR

Tasks 1 and 2 land on the same branch (`fix/theme-mermaid-watch-followups`). After both are committed:

1. Run `npm run build && npm run lint && npm run typecheck && npm test` one final time on the combined branch state.
2. Do a genuine end-to-end smoke test against the built CLI: render a deck containing both a `theme:` frontmatter key and a Mermaid diagram, confirm the diagram's SVG contains the theme's color; start `--watch`, edit the frontmatter's `theme:` value, confirm the served page updates without restarting the process.
3. Push and open a PR (squash-merge, matching this project's established convention) referencing this plan and noting both fixes were found by a post-ship backlog survey of the theme system (PR #17).
4. Task 3 (branch protection) is independent and can be applied before, during, or after this PR merges -- there is no ordering dependency, but doing it BEFORE this PR merges means this very PR would need to pass all 11 checks to land, which is a reasonable first real test of the new protection.
