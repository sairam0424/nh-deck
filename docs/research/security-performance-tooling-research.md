# nh-deck — Security, CI Tooling, and Doc-Drift Research

**Purpose**: primary-source research to ground prioritized, concrete recommendations for nh-deck's exact stack (TypeScript/Node ESM CLI, `marked`, `puppeteer-core`+`chrome-launcher`, GitHub Actions 9-way matrix, no lint/typecheck CI gate, 20-doc-vs-4-file doc-to-code ratio per `CODEBASE_INDEX.md`).

**Save location note**: this repo has no existing `docs/research/` convention — `docs/` contains only `docs/adr/`. This file establishes the `docs/research/` path per the task's fallback instruction, matching the existing `docs/` nesting pattern (`docs/adr/` → `docs/research/`).

---

## (a) Security

### marked — confirmed: no built-in sanitization, DOMPurify is marked's own recommendation

Source: `marked.js.org` (marked's own docs site — first-party).

> "Marked does not sanitize the output HTML." ... "If you are processing potentially unsafe strings, it's important to filter for possible XSS attacks." ... "Some filtering options include DOMPurify (recommended), js-xss, sanitize-html and insane."

Separately, `SECURITY.md` in the `markedjs/marked` repo is a vulnerability-*disclosure* policy (response-time SLAs: 48h initial assessment, patches within 2 weeks), not a sanitization guarantee — it says nothing about XSS. The sanitization guidance lives in the docs site, not `SECURITY.md`.

**How this maps to nh-deck**: `src/render.ts:14` calls `marked.parse(markdown, { async: false })` and interpolates the fragment with zero sanitization — `CODEBASE_INDEX.md` §2 and §8 already flag this as an "accepted trust boundary" because the only input today is the user's own file. marked's own docs confirm this is the *expected* division of responsibility (marked does conversion, not sanitization) — nh-deck is not doing anything wrong today, but the moment `generateHtml` is reused for any input the CLI's own user didn't author (a shared-deck feature, a "render someone else's .md" mode, a future web-facing preview), marked's own docs make DOMPurify-or-equivalent the documented, not optional, next step.

**Recommendation (highest priority in this section)**: Add a one-line comment at `src/render.ts:14` (next to the existing JSDoc) citing marked's own no-sanitization stance, so a future contributor doesn't need to rediscover this from marked's docs — and treat "add DOMPurify" as a hard blocker (not a nice-to-have) the day any untrusted-input code path is proposed, consistent with `SOUL.md`'s local-first non-negotiables already gating similar changes.

### puppeteer-core — confirmed: no bundled/verified browser, security is the developer's responsibility

Source: `github.com/puppeteer/puppeteer` `docs/guides/installation.md` (Puppeteer's own repo docs — first-party; pptr.dev has no dedicated "security" guide — checked the full `docs/guides/` directory listing, no `security.md` exists).

> "puppeteer-core is fully driven through its programmatic interface implying no defaults are assumed and puppeteer-core will not download Chrome when installed." ... "You should use puppeteer-core if you are connecting to a remote browser or managing browsers yourself." ... "you will need to call puppeteer.launch with an explicit executablePath (or channel if it's installed in a standard location)."

Critically, Puppeteer's own docs make **no** claim of vetting or verifying a self-managed/host-installed browser — that verification is implicitly the caller's job. `chrome-launcher`'s `Launcher.getInstallations()[0]` selection (`src/pdfExport.ts`, per `CODEBASE_INDEX.md` §2) picks the first detected binary with no path/version validation, which is consistent with — not a deviation from — how Puppeteer's own docs describe `puppeteer-core`'s trust model.

Puppeteer's Docker guide (`docs/guides/docker.md`) is the closest the official docs get to a security-relevant CI note: the official Docker image runs Chrome **with the sandbox enabled** and explicitly requires the `SYS_ADMIN` Linux capability to do so — it does not document `--no-sandbox` at all. This is irrelevant to nh-deck's CI today (the matrix runs real installed browsers on GitHub-hosted runners' host OS, not this Docker image) but is worth flagging if nh-deck's CI is ever containerized: dropping to `--no-sandbox` for container convenience is a documented-by-omission risk (Puppeteer's own image avoids it), not something their docs endorse.

**Recommendation**: No code change is required today given nh-deck's threat model (local CLI, user's own machine, user's own already-installed browser). Document in `SECURITY.md` — which `CODEBASE_INDEX.md` §8 already flags as referencing phantom `nh-deck serve`/`export --pdf` commands and needing a fix pass anyway — that `chrome-launcher`'s first-match selection is an intentional, Puppeteer-docs-consistent trust delegation to "whatever browser the user already has," not an oversight, so the next contributor doesn't file it as a bug.

### `npm audit` and third-party scanners — first-party npm docs are authoritative for this repo's size; Socket/Snyk are optional, not load-bearing

Source: `docs.npmjs.com/cli/v10/commands/npm-audit` (npm's own CLI docs — first-party).

Key facts, quoted:
> "The audit command submits a description of the dependencies configured in your project to your default registry and asks for a report of known vulnerabilities." ... `--audit-level`: "This option does not filter the report output, it simply changes the command's failure threshold." ... `--omit`: "Dependency types to omit from the installation tree on disk... these dependencies are still resolved and added to the package-lock.json... They are just not physically installed on disk."

This last point matters for nh-deck specifically: `npm audit`'s Quick Audit endpoint submits **all** packages in the tree regardless of `--omit`, so a CI `npm audit --omit=dev` still gets a full report; `--omit` only trims what's *displayed*, not what's checked. There is no dedicated "dev-dependency noise" flag in npm's own docs — the closest lever is `--omit=dev` on `npm audit fix`, not `npm audit` itself.

I checked Socket.dev's own docs (`docs.socket.dev/docs/socket-for-github` — first-party, not a blog) to verify it's a real product and not marketing copy: it is a genuine GitHub App that comments on PRs when `package.json`/`package-lock.json`/`yarn.lock` changes introduce install scripts, typosquats, telemetry, native code, or known malware. It is PR-comment-based, not a GitHub Actions CI step, and the doc makes no pricing claim either way.

**Recommendation (highest priority in this section)**: For nh-deck's actual dependency tree — 5 runtime deps (`commander`, `marked`, `open`, `puppeteer-core`, `chrome-launcher`), confirmed via `CODEBASE_INDEX.md` §7 to exclude full `puppeteer`/`playwright` — `npm audit --audit-level=high` as a CI step is sufficient and is the correct first-party tool; it costs one line in `ci.yml` and has zero setup. Socket.dev/Snyk are legitimate but are marginal value-add at this dependency-tree size (5 direct deps) and add either a GitHub App install (Socket) or an account+token (Snyk) — treat both as optional future additions if the dependency tree grows, not as part of the immediate lint/typecheck/CI gap already flagged in `CODEBASE_INDEX.md` §9 item 10.

---

## (b) CI tooling — ESLint flat config vs Biome vs `tsc --noEmit`

### ESLint flat config (current, non-deprecated setup)

Source: `eslint.org/docs/latest/use/configure/configuration-files` (ESLint's own docs — first-party).

Confirmed current requirements for nh-deck's exact stack (Node ESM, TypeScript, `strict: true`):
> Config file must "export an array of configuration objects" from `eslint.config.js`/`.mjs`/`.cjs`/`.ts` (TS variants "require additional setup"). For a `.ts` config on plain Node (not Deno/Bun): "you must install the optional dev dependency jiti in version 2.2.0 or later in your project." And explicitly: "ESLint does not perform type checking on your configuration file and does not apply any settings from tsconfig.json."

Given nh-deck's `package.json` already has `"type": "module"` and `tsconfig.json` targets `NodeNext`, a plain `eslint.config.js` (not `.ts`) avoids the `jiti` dependency entirely — one fewer new dev dependency than a TS-flavored config. Type-aware linting (the kind that would actually catch `src/index.ts`'s missing try/catch or `pdfExport.ts`'s launch-outside-try-finally issues, both flagged in `CODEBASE_INDEX.md` §8) requires `@typescript-eslint`'s type-checked config presets, which ESLint's own core docs don't cover (that's `typescript-eslint`'s docs, not ESLint's) — but the setup mechanics above (flat config array, `languageOptions.parserOptions` pointing at `tsconfig.json`, `plugins`/`extends`) are what `@typescript-eslint` layers onto.

### Biome (current setup, first-party docs)

Source: `biomejs.dev/guides/getting-started/` (Biome's own docs — first-party).

> Install: `npm i -D -E @biomejs/biome` ("`-E` ensures that the package manager pins the version of Biome.") Init: `npx @biomejs/biome init` generates `biome.json`. CI-specific command: "Run `biome ci` as part of your CI pipeline... It works just like the `biome check` command, but is optimized for CI."

Biome unifies lint + format + import-organization behind one binary, one config file, one CI command (`biome ci`) — versus ESLint's need for a separate formatter (Prettier) and separate config files for each. Biome does **not** currently do type-aware linting the way `@typescript-eslint`'s type-checked presets do (it lints syntax/patterns, not cross-file type information) — its own docs don't claim otherwise, so it would not, by itself, catch the type-level issues in `pdfExport.ts`/`index.ts` that a type-aware ESLint config could.

### `tsc --noEmit` as a standalone CI gate

Source: `typescriptlang.org/tsconfig/#noEmit` (TypeScript's own TSConfig reference — first-party).

> "Do not emit compiler output files like JavaScript source code, source-maps or declarations. This makes room for another tool like Babel, or swc to handle converting the TypeScript file... You can then use TypeScript as a tool for providing editor integration, and as a source code type-checker."

This is exactly the documented use case for a CI typecheck gate. For nh-deck specifically, `npm run build` (`tsc`, no `--noEmit`) already fails on type errors — but only as a side effect of also writing `dist/`. `CODEBASE_INDEX.md` §4/§9 already flags "no lint or typecheck script exists" as a script-level gap even though `tsc` runs inside `build`; the concrete fix is a dedicated `"typecheck": "tsc --noEmit"` script so CI (and contributors) can run type-checking without touching `dist/`, and so a future bundler/build-step change (explicitly disallowed today per `CLAUDE.md`'s scope-discipline section, but worth future-proofing for) doesn't silently drop type-checking along with it.

**Recommendation (highest priority in this section)**: Given nh-deck is a 4-source-file, ~250-line CLI (per `CODEBASE_INDEX.md` §5) with a hard "no bundler, no scope creep" policy (`AGENTS.md`, `CLAUDE.md`), Biome is the better fit over ESLint+Prettier: one dependency, one config file, one `biome ci` command, versus ESLint's multi-package setup (`eslint` + `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` + `jiti` for a `.ts` config + a separate formatter) for a codebase this small. Pair it with a standalone `"typecheck": "tsc --noEmit"` script and both as new CI steps in `ci.yml` before the existing `npm run build` step — closing the exact gap `CODEBASE_INDEX.md` §9 item 10 already identified. If type-aware lint rules become a priority later (e.g. to systematically catch the try/catch asymmetry and launch-outside-try-finally patterns already documented), that's the point to reconsider ESLint+`@typescript-eslint`'s type-checked presets instead — not before.

---

## (c) Documentation drift tooling

### markdown-link-check — real, citable, CI-ready

Source: `github.com/tcort/markdown-link-check` (tool's own README — first-party).

> "Extracts links from markdown texts and checks whether each link is alive (200 OK) or dead." CLI: `markdown-link-check ./docs` (recursively checks a directory). CI: a companion GitHub Action (`github-action-markdown-link-check`) is referenced by name; a concrete GitLab CI snippet is also given directly in the README.

This tool checks **link liveness**, not doc/code consistency — it would catch a dead link in nh-deck's 20-doc set but not `codebase_map.md` claiming `pdfExport.test.ts` doesn't exist (`CODEBASE_INDEX.md` §8's most severe finding). It's a real, low-effort win for a different, narrower problem than doc-drift.

### Vale — real, citable, prose/style linting (not fact-checking)

Source: `docs.vale.sh` (Vale's own docs — first-party; note the `vale.sh/docs/` URL 301-redirects to `docs.vale.sh`).

> Vale is "a command-line tool that brings code-like linting to prose"; "Vale is not a general-purpose writing aid" — it targets style consistency, not grammar or factual correctness. CI: setting a rule's `level: error` "will cause CI builds to fail," and there is an official `vale-action` GitHub Action.

Vale is a style/terminology linter (e.g., "Nodebalancer" vs "NodeBalancer" consistency) — it has no mechanism to detect that `status.md` claims CI is single-OS when `ci.yml` already runs a 9-combination matrix. **Neither markdown-link-check nor Vale solves nh-deck's actual, already-diagnosed documentation-drift problem** (stale claims about shipped features) — I looked for a first-party tool that does this specific job and did not find one; doc/code-consistency-checking is not a solved-and-tool-supported problem the way link-checking and prose-style-linting are. I am not going to invent a "best practice" here without a citable source, per the task's own instruction.

**Recommendation (highest priority in this section)**: Given no tool solves the actual drift problem nh-deck has, the actionable fix is process, not tooling: `CODEBASE_INDEX.md` §8 already identified the root cause precisely — commit `f311dcc` updated seven docs but missed `status.md` in the same "reconciliation" pass. The concrete, low-cost mitigation is a PR template checklist line ("if this PR changes CI, `src/`, or shipped-feature status, did you check `status.md`, `codebase_map.md`, and `AGENTS.md`'s Directory Map?") rather than adding a new tool — consistent with `Branches.md`'s existing PR-required policy, which already has a natural checkpoint to add this to. `markdown-link-check` (via `github-action-markdown-link-check`) is still worth adding as a separate, narrow CI step given how many cross-repo relative links this doc set carries (`../Not-Humans-Lab/...` references throughout `AGENTS.md`) — but treat it as link-rot prevention, not doc-drift prevention; don't conflate the two.

---

## (d) GitHub Actions — matrix cost, `fail-fast`, dependency caching

### Matrix strategy cost/time and `fail-fast`/`max-parallel` semantics

Source: `docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs` (GitHub's own Actions docs — first-party).

Confirmed: the docs describe matrix mechanics (a 2×3 matrix "will run six jobs, one for each combination") and `max-parallel` ("the maximum number of jobs that can run simultaneously" — example: capping 6 possible jobs to 2 concurrent) but do **not** state a `fail-fast` default value or connect matrix size to billed-minutes cost anywhere in this page. This is a real gap in GitHub's own docs relative to what the task asked me to verify — I'm reporting the gap rather than filling it with an unsourced claim. (GitHub's separate billing docs cover per-minute cost by OS multiplier — macOS and Windows runners bill at a higher per-minute multiplier than Linux — but that's a different doc page than the matrix-strategy one, and wasn't part of this fetch; flagging as a citation gap rather than asserting the multiplier numbers from memory.)

**What this means for nh-deck's actual 9-combination matrix** (`ubuntu-latest`/`macos-14`/`windows-latest` × Node `20`/`22`/`latest`, `fail-fast: false`): `fail-fast: false` is a deliberate, already-documented-in-code choice (every combination runs to completion even if one fails) — appropriate for a matrix whose entire purpose (per `CODEBASE_INDEX.md` §4) is verifying `chrome-launcher`'s OS-specific browser-detection paths independently; a `fail-fast: true` default would cancel in-progress OS-specific verification the moment any single combination failed, defeating the matrix's stated purpose. No change recommended here — this is already the correct choice per the matrix's own goal, just worth documenting the *why* in `ci.yml` itself as a comment, since `TESTING.md`/`tech.md` currently only describe *what* the matrix does (per `CODEBASE_INDEX.md` §5), not why `fail-fast: false` specifically.

### Dependency caching: `actions/setup-node`'s built-in cache vs `actions/cache`

Source: `docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows` (GitHub's own Actions docs — first-party).

> "npm, Yarn, pnpm | setup-node ... Caching global packages data" — "using their respective setup-* actions requires minimal configuration and will create and restore dependency caches for you." Manual `actions/cache` equivalent: `path: ~/.npm`, `key: ${{ runner.os }}-build-${{ env.cache-name }}-${{ hashFiles('**/package-lock.json') }}`. Eviction: "GitHub will remove any cache entries that have not been accessed in over 7 days," and "the total size of all caches in a repository is limited. By default, the limit is 10 GB," beyond which oldest-first eviction can cause "cache thrashing."

**Recommendation (highest priority in this section)**: nh-deck's `ci.yml` currently runs `actions/setup-node@v4` with no `cache` input at all (confirmed by reading the file directly), then `npm install` from scratch on every one of 9 combinations. The fix is a one-line addition — `cache: 'npm'` on the existing `actions/setup-node@v4` step — which is GitHub's own documented "minimal configuration" path; there is no reason for nh-deck to hand-roll an `actions/cache` step with manual key/restore-keys logic when `setup-node`'s built-in option does the same thing in one line. Given the 9-combination matrix multiplies this install cost by 9 on every push/PR, this is the single highest-leverage CI change in this document for actual PR turnaround time, independent of the security/lint findings above.

---

## Summary — highest-priority recommendation per area

- **(a) Security**: No urgent fix needed today (marked/puppeteer-core's own docs confirm nh-deck's current trust-boundary decisions are correct, not oversights) — but add `npm audit --audit-level=high` as a new CI step; it's the one first-party, zero-setup gap versus the repo's otherwise strong security posture.
- **(b) CI tooling**: Adopt Biome (`biome ci`) over ESLint+Prettier for this codebase's size, plus a standalone `"typecheck": "tsc --noEmit"` script — both wired into `ci.yml` as new steps, directly closing the gap `CODEBASE_INDEX.md` §9 item 10 already flagged.
- **(c) Documentation drift**: No tool solves nh-deck's actual drift problem (stale shipped-feature claims) — fix the process via a `Branches.md`/PR-template checklist item, not a new tool; add `markdown-link-check` separately, but only as link-rot prevention.
- **(d) GitHub Actions**: Add `cache: 'npm'` to the existing `actions/setup-node@v4` step in `ci.yml` — one line, GitHub's own documented "minimal configuration" path, and the highest-leverage speed win given the 9x multiplier from the matrix.
