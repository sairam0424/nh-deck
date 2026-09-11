# 0007. Cross-browser PDF/PNG export visual-fidelity check

## Status

Accepted — 2026-09-11

## Context and Problem Statement

`Context.md`'s Roadmap has carried "Automated cross-browser PDF-export
visual-fidelity check" (item 7) as an open item since the CI matrix
expansion, and `AGENTS.md`'s Known Gotchas and `Context.md`'s Open Risks
both name the same gap explicitly: the 9-combination CI matrix
(`ubuntu-latest`/`macos-14`/`windows-latest` × Node 20/22/latest) proves PDF
and PNG export *work* everywhere -- a real PDF/PNG gets produced on every
combination, via `tests/pdfExport.test.ts` and `tests/pngExport.test.ts` --
but it does not prove export *looks* the same everywhere. `chrome-launcher`
detects whichever Chrome-family browser (Chrome, Chromium, Edge, Brave)
happens to be installed on a given machine, and different browser builds
can in principle rasterize the same HTML/CSS slightly differently (font
hinting, anti-aliasing, sub-pixel layout). No check existed to characterize
or catch a real regression in that dimension.

## Decision Drivers

- **No CDN dependency, no bundled/downloaded browser.** Any comparison
  approach must work against whatever browser(s) `chrome-launcher` already
  detects locally -- it must not download or bundle a browser itself,
  consistent with `SOUL.md`'s local-first non-negotiable and ADR 0001's
  `puppeteer-core`-over-`puppeteer` decision.
- **Must not fail solo-browser machines.** Most developer machines and many
  CI runner images have exactly one detectable browser. A check that hard-
  fails in that case would be actively hostile to contributors and would
  need to be silenced rather than heeded.
- **Dev/CI tooling only, never shipped.** Whatever this pulls in as a
  dependency must stay out of the published package -- `package.json`'s
  `"files": ["dist"]` already excludes `devDependencies` from the npm
  tarball, so a decode-only, pure-JS dependency here carries no runtime or
  install-time cost for end users.
- **Distinguish "looks slightly different" from "is actually broken."** A
  pixel-level rendering difference between two browser builds is expected
  and should be tolerated; a different number of PDF pages for the same
  deck is not a rendering nuance, it is a real content-parity bug.
- **Don't pay this cost 9 times.** Installing a second real browser adds
  real CI minutes and a new external action dependency; the existing
  9-combination matrix already does real, valuable OS/Node-version
  coverage and shouldn't be slowed down further for a concern that is
  orthogonal to OS/Node version.

## Considered Options

### Pixel-comparison mechanism

1. **`pngjs` (pure-JS PNG decoder) + a hand-rolled per-channel threshold
   comparison**, run from a plain Node script.
2. **`pixelmatch`** (or a similar dedicated image-diff library) on top of a
   PNG decoder.
3. **A hosted visual-regression service** (Percy, Chromatic, Applitools) or
   a heavier local framework (BackstopJS).

### Second-browser acquisition in CI

1. **`browser-actions/setup-chrome`**, pinned by commit SHA, pulling a
   genuine upstream Chromium snapshot build (`chrome-version: latest`) and
   wiring its output path in via `chrome-launcher`'s own `CHROME_PATH`
   override.
2. **`apt-get install chromium`/`chromium-browser`** directly on the
   `ubuntu-latest` runner.
3. **A Docker container image with two browsers pre-installed.**

### Where to enforce this

1. **A new, separate CI job** (`pdf-fidelity-check`), `ubuntu-latest` only,
   not part of the existing OS/Node matrix.
2. **Fold it into the existing 9-combination matrix job.**
3. **Local-only** (a script contributors are expected to run by hand, never
   wired into CI at all).

## Decision Outcome

Chosen: **pngjs + hand-rolled threshold comparison (Option 1)**,
**`browser-actions/setup-chrome` (Option 1)**, and **a dedicated new CI job
(Option 1)**.

- **Pixel comparison, Option 2 (`pixelmatch`) was rejected**: it is a
  perfectly reasonable library, but it pulls in its own comparison
  algorithm and API surface for a need this project's own threshold logic
  (count pixels where any of R/G/B differs by more than a fixed amount)
  covers in well under 30 lines, with a dependency (`pngjs`) that does
  nothing but decode bytes -- keeping the dev-only dependency surface as
  small as the KaTeX/Mermaid precedent already established for runtime
  dependencies (verify what a library actually does, prefer the smallest
  thing that does it).
- **Pixel comparison, Option 3 (hosted/heavier frameworks) was rejected
  outright**: a hosted visual-regression service is a real, ongoing network
  dependency and a third-party account requirement for a local-first CLI
  project that doesn't even have a CI secret store set up for such a thing;
  BackstopJS bundles its own browser-automation stack, duplicating
  `puppeteer-core`/`chrome-launcher` for no added benefit here.
- **Second-browser acquisition, Option 2 (`apt-get install chromium`) was
  investigated and rejected**: verified directly against
  `actions/runner-images`' own `install-google-chrome.sh` build script that
  `ubuntu-latest` already ships Google Chrome *and* a manually-downloaded,
  non-apt, non-snap Chromium build (symlinked to `/usr/bin/chromium` and
  `/usr/bin/chromium-browser`) pre-installed -- so an `apt-get install
  chromium`/`chromium-browser` call would either be a no-op or, on Ubuntu
  releases where `chromium`/`chromium-browser` is a transitional package
  that pulls in `snapd`, a real source of CI flakiness (slow first-run snap
  initialization) for no benefit, since a real, working Chromium binary is
  already present.
- **Second-browser acquisition, Option 3 (a two-browser Docker image) was
  rejected**: `ubuntu-latest`'s own runner image already has Chrome
  pre-installed for free; building or sourcing a custom container image
  just to get a second browser is real infrastructure this project doesn't
  otherwise need.
- **Second-browser acquisition, Option 1 was chosen with one specific
  caveat, verified directly against `browser-actions/setup-chrome`'s own
  README**: "The installed binary name is not always `chrome` or
  `chromium`." `chrome-launcher`'s Linux detection (as pinned in this
  project, `chrome-launcher@1.1.2`) only recognizes four literal binary
  names (`google-chrome-stable`, `google-chrome`, `chromium-browser`,
  `chromium`) via `which`, so a setup-chrome-installed binary is not
  guaranteed to be found that way. The action's own `chrome-path` output is
  instead exported as the `CHROME_PATH` environment variable, which
  `chrome-launcher` explicitly checks first (verified directly against its
  `chrome-finder.js` source) -- this makes the newly-installed Chromium
  build detectable regardless of its literal file name, while the runner
  image's pre-existing Google Chrome remains separately detectable via the
  ordinary `which`-based path, giving two genuinely distinct entries.
- **Enforcement location, Option 2 (fold into the 9-combination matrix) was
  rejected**: installing a second browser on all 9 OS/Node combinations
  would be real, repeated CI cost for a check that is orthogonal to OS and
  Node version -- the comparison target is "do two browsers on the same
  machine agree," not "does this work on Windows vs. macOS vs. Linux."
- **Enforcement location, Option 3 (local-only, no CI wiring) was
  rejected**: a check nobody is required to run tends to silently stop
  being run at all; wiring it into CI (as its own job, so a genuine skip on
  a solo-browser environment is still a visible, auditable log line) keeps
  it live.

Concretely:

1. `src/browserLaunch.ts` gained `detectAllBrowserExecutables()`, returning
   every installation `chrome-launcher`'s `Launcher.getInstallations()`
   reports (empty array if none) in the same priority order.
   `detectBrowserExecutable()` now calls it internally; its own behavior
   and error message are unchanged except for removing a stale sentence
   about a "planned" automatic-download fallback that `SOUL.md` and ADR
   0001 already permanently rule out.
2. `exportToPng()` (`src/pngExport.ts`) and `exportToPdf()`
   (`src/pdfExport.ts`) both gained an optional third parameter,
   `executablePathOverride`, used instead of calling
   `detectBrowserExecutable()` when provided. Existing 2-argument callers
   (the `render`/`pdf`/`png` CLI subcommands) are unaffected.
3. `scripts/check-pdf-fidelity.mjs` (run via `npm run check:fidelity`,
   `node --import tsx scripts/check-pdf-fidelity.mjs`, matching how
   `tests/cli.test.ts` exercises the CLI via `tsx` without a build step):
   - Calls `detectAllBrowserExecutables()`. Fewer than 2 installations
     prints a clear skip message and exits `0` -- this must never fail a
     solo-browser machine.
   - Otherwise takes the first two installations (chrome-launcher's own
     priority order), renders `fixtures/sample.md` to PNG via
     `exportToPng()` once per browser, and compares every corresponding
     slide pair: dimensions must match exactly; the percentage of pixels
     where any of R/G/B differs by more than 30/255 is accumulated across
     every slide (total differing pixels ÷ total pixels across the whole
     deck, not an average of per-slide percentages) and compared against a
     **2% tolerance**.
   - Also renders to PDF via `exportToPdf()` once per browser and compares
     page counts using the same `/Type\s*\/Page[^s]/g` byte-regex technique
     `tests/pdfExport.test.ts` already uses -- page counts must match
     **exactly**; any mismatch is a content-parity failure, not a
     tolerance question.
   - Prints a pass/fail summary (per-slide and overall pixel-diff
     percentages, both PDF page counts) and exits `1` on any failure.
4. `pngjs` (pure-JS, no native bindings) was added as a **devDependency**
   only -- it decodes PNG bytes for the pixel comparison and is never
   imported from `src/`, so it never ships in `dist/` or the npm tarball.
5. A new, separate `pdf-fidelity-check` job in
   `.github/workflows/ci.yml`, `ubuntu-latest` only, installs a second
   Chromium build via `browser-actions/setup-chrome` (pinned by commit
   SHA) and runs `npm run check:fidelity` with `CHROME_PATH` set to that
   build's path. Its failure fails the PR; a genuine "only 1 browser
   detected, skipping" exit-`0` result is treated as a pass, not a
   workaround.

### Why 2%, specifically

Anti-aliasing and font-hinting differences between browser builds are
expected even when rendering byte-identical HTML/CSS -- an exact
pixel-for-pixel match was never a realistic bar, and this project has no
existing empirical baseline (no prior run of this check on two genuinely
different real browsers) to derive a precise number from. 2% is a
deliberately round, conservative starting tolerance chosen to be well above
plausible anti-aliasing noise on typical deck content (mostly typography,
not photographic detail) while still being tight enough to catch a real
rendering regression (a missing font, a broken KaTeX/Mermaid embed, a
layout collapse) that would move a much larger fraction of a slide's
pixels. It is explicitly a starting point, not a derived constant -- see
Consequences below.

## Consequences

**Good:**

- The gap named in `Context.md`'s Open Risks and `AGENTS.md`'s Known
  Gotchas now has an actual check, not just a documented absence of one.
- The check never blocks a solo-browser contributor's local workflow --
  `npm run check:fidelity` is dev-only, not wired into `npm test` or
  `npm run build`, and gracefully skips (exit `0`) below 2 detected
  browsers.
- `detectAllBrowserExecutables()` and the `executablePathOverride`
  parameters are small, additive, backward-compatible changes -- no
  existing caller of `detectBrowserExecutable()`, `exportToPng()`, or
  `exportToPdf()` changes behavior.
- The stale "automatic download fallback is a planned... feature" sentence
  in `detectBrowserExecutable()`'s error message is gone -- it
  contradicted `SOUL.md`'s and ADR 0001's permanent rejection of ever
  bundling or downloading a browser, and is not describing real planned
  work.
- `pngjs` is dev/CI-tooling only; `package.json`'s `"files": ["dist"]`
  already excludes it (and all `devDependencies`) from what end users
  install, so this does not touch the local-first/no-CDN runtime
  constraint.

**Bad / open risks:**

- **This does not cover Brave.** Brave is one of the four browsers
  `chrome-launcher` can detect and this project's own docs and error
  messages name, but it is not realistically installable via a standard
  GitHub-hosted `ubuntu-latest` runner step the way Chrome/Chromium are (no
  equivalent well-maintained setup action, no plain apt package) -- a
  Brave-vs-Chrome comparison is not exercised anywhere, including in CI.
- **A local machine with only one detected browser always skips.** This is
  the deliberately-chosen safe default (see Decision Drivers), but it means
  the *only* place this check is known to genuinely exercise the 2-browser
  comparison path is the dedicated CI job -- most contributors will only
  ever see the skip message locally.
- **The 2% tolerance is a starting point, not an empirically-derived
  number** (see "Why 2%, specifically" above) -- it may prove too strict
  (flagging real browsers' ordinary rendering differences as failures) or
  too loose (missing a real regression) once this job has actually run
  against two genuinely different real browser builds enough times to
  build a track record. Revisit the threshold, not the overall approach, if
  either failure mode shows up in practice.
- **The CI job's exact behavior has not yet been observed on a live GitHub
  Actions run.** This ADR's second-browser-detection reasoning was verified
  against primary sources (`actions/runner-images`' own
  `install-google-chrome.sh` build script, and `browser-actions/setup-chrome`'s
  own README and `action.yml`) and the pixel-diff/page-count comparison
  logic itself was verified empirically end-to-end on this development
  machine (comparing the same real local Chrome install against itself via
  `exportToPng()`/`exportToPdf()` with `executablePathOverride`, which
  produced the expected 0% pixel difference and matching PDF page counts)
  -- but this development environment has only one detectable browser, so
  the specific "does `CHROME_PATH` plus the runner's pre-installed Chrome
  actually yield 2 distinct `chrome-launcher` detections on a real
  `ubuntu-latest` runner" claim is verified by source inspection, not by an
  actual CI run, as of this ADR. Confirm on the first real PR that triggers
  the `pdf-fidelity-check` job, and correct this ADR if the runner behaves
  differently than reasoned here.

## Confirmation

This decision is confirmed as implemented by:

1. `tests/browserLaunch.test.ts` (extend, if not already covering
   `detectAllBrowserExecutables()`'s empty-array and multiple-installation
   cases) and the existing `detectBrowserExecutable()` coverage, which
   continues to pass with the byte-identical (minus the removed sentence)
   error message.
2. `tests/pngExport.test.ts` / `tests/pdfExport.test.ts` continuing to pass
   unmodified with `exportToPng()`/`exportToPdf()`'s new optional third
   parameter -- proving the 2-argument call sites are unaffected.
3. `npm run check:fidelity` printing a clear "skipping -- only 1 browser
   detected" message and exiting `0` on a machine with one detected
   browser (this development machine, at the time this ADR was written).
4. The full existing test suite, `npm run build`, `npm run lint`, and
   `npm run typecheck` all passing unchanged.
5. The new `pdf-fidelity-check` job in `.github/workflows/ci.yml` running
   on every PR going forward, and either genuinely exercising the
   2-browser comparison (pass or fail on its merits) or -- if this ADR's
   second-browser-detection reasoning turns out to be wrong on a real
   runner -- visibly skipping rather than silently doing nothing.

## More Information

- See `Context.md`'s Roadmap, item 7, and its Open Risks section (the
  "No cross-platform PDF export *fidelity* check exists yet" entry this
  ADR closes).
- See `AGENTS.md`'s Known Gotchas for the same gap, described from the CI
  matrix's perspective.
- See `docs/adr/0001-adopt-ts-node-cli-with-puppeteer-core-export.md` for
  the original `puppeteer-core`/`chrome-launcher`, no-bundled-browser
  decision this ADR's CI-job design stays consistent with.
- See `docs/adr/0005-mermaid-local-cdn-import-stripped.md` for the
  "verify a dependency's actual behavior, don't assume it from its
  reputation or dependency tree" precedent this ADR's second-browser
  research follows.
- See `src/browserLaunch.ts`, `src/pngExport.ts`, `src/pdfExport.ts`,
  `scripts/check-pdf-fidelity.mjs`, and `.github/workflows/ci.yml` for the
  implementation referenced throughout this ADR.
