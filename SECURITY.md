# Security Policy

nh-deck is a **local-first CLI tool** for writing, presenting, and
exporting Markdown-based slide decks — the author's own version of
[arpitbbhayani/deckrun](https://github.com/arpitbbhayani/deckrun). It is
one of three independent sibling projects (`daily-dose`, `nh-deck`,
`nh-skills`) under the "Not-Humans-Lab" umbrella; cross-cutting
system-level docs for that umbrella live in the separate, docs-only
meta-repo at `../Not-Humans-Lab/` (linked by relative path, not
duplicated here).

**This is not a hosted, multi-user product.** There are no user accounts,
no hosting, no server-side database, and no "shareable deck" feature that
requires authentication or authorization. nh-deck runs entirely on the
user's own machine, on decks the user supplies as local Markdown files.
Any earlier assumption that nh-deck needed auth for shared/hosted decks is
superseded by this reality — the sections below are written against the
actual local-first CLI shape of the product, not a speculative hosted one.

## Supported Versions

nh-deck does not yet follow semver release branches. There is one living
line of development: the `main` branch. The latest commit on `main` is the
only supported version.

| Version                 | Supported               |
| ------------------------ | ------------------------ |
| `main` (latest commit)   | Yes                      |
| Anything older / forked  | No — pull latest `main`  |

## Reporting a Vulnerability

Please report suspected vulnerabilities **privately**, not as a public
GitHub issue.

- **Preferred channel**: GitHub's private vulnerability reporting, via the
  "Report a vulnerability" button under this repo's **Security** tab
  (Security → Advisories → "Report a vulnerability"). This opens a private
  advisory visible only to the maintainer and you.
- **Fallback channel**: open a GitHub issue titled only `Security contact
  needed` with no technical details, and the maintainer will follow up to
  establish a private channel.

Do not include exploit details or a working proof-of-concept (e.g., a
deck file that demonstrates command injection or arbitrary code
execution) in a public issue, PR, or discussion.

### What to include in a report

- Which command or code path is affected (e.g., `nh-deck serve`,
  `nh-deck export --pdf`, the Markdown renderer).
- What the concern is: command injection via a flag, an escape from the
  local-only server binding, an XSS/trust-boundary issue, a dependency
  vulnerability, or something else.
- Steps to reproduce, ideally with a minimal deck file and the exact CLI
  invocation used.
- Your OS, Node.js version (`node -v`), and which local browser binary (if
  relevant to PDF export) you had installed.

## Disclosure Policy & Timeline

This is a personal, best-effort project — the timeline below is a target,
not a contractual SLA (see `SUPPORT.md` for the general support posture).

| Stage                          | Target timing                |
| ------------------------------- | ------------------------------ |
| Acknowledge report              | Within 5 business days        |
| Initial triage / severity call  | Within 10 business days       |
| Fix or mitigation merged        | Best effort, no fixed SLA — prioritized over other work |
| Public disclosure               | After a fix is merged, or 90 days from report, whichever is sooner, unless the reporter agrees to a longer embargo |

Credit is given to reporters in the fix commit/PR description unless the
reporter asks to remain anonymous.

## Scope

**In scope:**

- The nh-deck CLI itself: the Commander.js command surface, the Markdown
  → HTML rendering pipeline (`marked`), the local `node:http` dev server,
  and the PDF export path (`puppeteer-core` + `chrome-launcher`).
- Build and packaging: `tsc` output (`dist/index.js`), the npm `bin`
  entry and its shebang.
- CI configuration (`.github/workflows/`) for this repository.
- Repository metadata that affects trust (`LICENSE`, this file,
  `SUPPORT.md`, `decisions.md`).

**Out of scope:**

- Any hosted or multi-user deployment of nh-deck — none exists. If someone
  builds a hosted wrapper around this CLI, its security posture is that
  wrapper's responsibility, not this repository's.
- Third-party browser binaries (Chrome/Chromium/Edge/Brave) that
  `chrome-launcher` detects on the user's machine — report browser
  vulnerabilities to the browser vendor, not here.
- The `marked` library's own parsing correctness/security — report
  upstream; this repo only tracks and pins the dependency (see Supply
  Chain policy below).
- The sibling projects `daily-dose` (does not exist yet) and `nh-skills` —
  each is an independent repository with its own `SECURITY.md`.
- `../Not-Humans-Lab/` — a separate, docs-only meta-repo; report issues
  with its content there, not here.

## Known Security Considerations

These are real, documented properties of the current design — not
hypothetical hardening ideas — because nh-deck is local-first by hard
constraint (see `../Not-Humans-Lab/` and this project's own decision docs
for that constraint's origin).

- **The local dev server binds only to `127.0.0.1`.** `nh-deck serve`
  starts a plain `node:http` server for previewing a deck while writing
  it. It must never bind to `0.0.0.0` or any public/LAN-reachable
  interface — there is no authentication layer, and none is planned,
  because the server is designed to be reachable only from the same
  machine. If this ever needs to be exposed beyond localhost (e.g., for a
  remote-preview feature), that is a breaking change to the threat model
  and must get its own security review and its own ADR before shipping —
  it does not get silently added as a `--host` flag.
- **Rendered Markdown/HTML is not sanitized against XSS, by design.**
  nh-deck passes Markdown through `marked` and renders the resulting HTML
  as-is, inheriting deckrun's "raw HTML passes through untouched" design
  choice. This is an accepted trade-off, not an oversight: a user writing
  and presenting their **own** deck is inside their own trust boundary —
  sanitizing their own embedded HTML/JS would break legitimate use of raw
  HTML in slides (custom styling, embeds, small scripts).
  - **Real risk to flag**: if a user opens or presents a **third-party**
    deck file (downloaded, received from someone else, cloned from a
    repo they don't control), any HTML or `<script>` embedded in that
    deck's Markdown executes in their browser exactly as if they'd
    written it themselves. nh-deck does not warn on this today. Treat any
    third-party `.md` deck with the same caution as running an unknown
    script — do not open decks from sources you don't trust.
  - Sanitizing by default is deliberately not in scope for the walking
    skeleton — it would need to be an explicit, documented opt-in/opt-out
    (or a "you are opening a deck you didn't author" prompt) rather than
    silently breaking the raw-HTML feature. Track this as a fast-follow
    consideration, not a fixed gap.
- **PDF export shells out to a locally detected browser binary.**
  `nh-deck export --pdf` uses `chrome-launcher` to detect an installed
  Chrome/Chromium/Edge/Brave binary and drives it headlessly via
  `puppeteer-core`. Two related risks:
  - If a `--browser <path>` (or equivalent) flag is ever added to let a
    user point at a specific binary, that path **must** be validated
    (exists, is a regular executable file, is not passed through a shell)
    before being handed to the child-process launcher — never
    string-concatenate it into a shell command. This is a command
    injection vector if done carelessly, since the value comes directly
    from user/CLI input.
  - `puppeteer-core` (unlike full `puppeteer`) does not bundle its own
    Chromium — nh-deck intentionally relies on detect-first via
    `chrome-launcher` instead of downloading/bundling a browser, which
    also means export quality/behavior can vary slightly by whichever
    browser is actually installed on a given machine. This is a
    deliberate trade-off (see `docs/adr/0001-adopt-ts-node-cli-with-puppeteer-core-export.md`),
    not a bug.
- **No CDN dependency in rendered output, by hard constraint.** The
  rendered HTML must work fully offline — this is why KaTeX (math) and
  Mermaid (diagrams) are deferred rather than wired in via a CDN
  `<script>` tag as a shortcut. A CDN reference in rendered slide output
  would itself be a security/privacy leak (third-party script executing
  in the context of the user's deck, plus a phone-home on every render)
  and would violate the local-first constraint even for a walking
  skeleton. When KaTeX/Mermaid are added, they must ship as installed
  dependencies bundled into the output, not a CDN `<script src>`.

## Secrets Handling

- nh-deck has no secrets today: no API keys, no tokens, no credentials of
  any kind are required to run the CLI, render a deck, serve a preview,
  or export a PDF. If that ever changes (e.g., a future integration needs
  a credential), it must be sourced from the *user's own* environment at
  run time — never committed, never hardcoded, and documented here before
  it ships.
- If a secret is ever accidentally committed to this repository, treat it
  as compromised immediately: rotate it at the source, then scrub it from
  git history (not just delete it in a new commit).
- CI for this repo does not require any secrets to build or test the
  walking skeleton; if a future workflow needs one (e.g., a publish step
  to npm), it will be scoped to the minimum permission needed and
  documented here before it is added.

## Supply Chain & Dependency Policy

- **Runtime dependencies are intentionally small and named up front**:
  `commander` (CLI surface), `marked` (Markdown → HTML), `puppeteer-core`
  and `chrome-launcher` (PDF export via a locally detected browser). No
  bundled Chromium (unlike full `puppeteer`), no Playwright, no Express,
  no bundler — see
  `docs/adr/0001-adopt-ts-node-cli-with-puppeteer-core-export.md` for the
  full rationale and rejected alternatives.
- **`puppeteer-core` / `chrome-launcher` are the highest-scrutiny
  dependencies** in this repo, because they are the only ones that spawn
  a child process and drive it over a debugging protocol. Version bumps
  to either are reviewed for changes to process-spawning or
  argument-handling behavior, not just changelogs skimmed for breaking
  API changes.
- **KaTeX and Mermaid are decided-but-not-yet-installed.** They are a
  documented fast-follow, not silently skipped — do not add them as
  dependencies until their own security review (in particular: Mermaid's
  diagram source can itself carry embedded content, and KaTeX must be
  bundled locally, never CDN-loaded, per the Known Security
  Considerations above).
- **Any future dependency addition** must be justified against KISS/YAGNI
  (per this workspace's global coding-style rules) before being added —
  "might need it later" is not sufficient justification. New runtime
  dependencies should be called out explicitly in `decisions.md` (the
  Lightweight Decisions Log, or a full ADR if the addition is
  architecturally significant per that file's definition).
- Dependabot (or equivalent) alerts are triaged like any other repo, with
  priority given to `puppeteer-core`/`chrome-launcher` (process-spawning
  surface) over lower-risk devDependencies (Vitest, TypeScript, `tsc`
  itself).
- License: Apache-2.0, decided once at the Not-Humans-Lab system level and
  applied identically across `daily-dose`, `nh-deck`, and `nh-skills` (see
  `../Not-Humans-Lab/decisions.md`). New dependencies should be
  license-compatible with Apache-2.0.

## Contact

Use GitHub private vulnerability reporting (see above) as the primary
channel. For anything that is not a vulnerability report, see
`SUPPORT.md`.
