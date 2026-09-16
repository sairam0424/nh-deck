# 0013. Static site export as a new subcommand, not a render mode

## Status

Accepted — 2026-09-16

## Context and Problem Statement

This release adds a way to export a deck as a plain, hostable static
site — a self-contained `index.html` a user can drop on any static host
with no server-side code at all. The rendered HTML itself already has
everything a static export needs: `generateHtml()` already produces a
fully self-contained, CDN-free document (embedded KaTeX fonts, embedded
Mermaid SVGs, no CDN `<script>`/`<link>`), and `presentationScript.ts`'s
own presentation-mode navigation is already driven entirely client-side
through `location.hash`/`location.search`, with no server-side
assumption baked in anywhere. The only genuinely new piece of work is
*where that HTML ends up*: written to a durable file on disk at a
resolved output path, instead of held in memory and served by
`server.ts`'s `startServer()`. The decision this ADR records is not about
the HTML itself — that part was already solved — but about which
existing command this new file-writing behavior should live under.

## Decision Drivers

- **`render`'s entire identity is serve+watch+open-browser.** Every
  option `render` has that `pdf`/`png` do not — `--no-open`, `--port`,
  `--watch` — exists because `render` starts a local HTTP server, opens
  a browser tab against it, and (optionally) re-renders and pushes a
  live-reload event over SSE when the source file changes (see
  `AGENTS.md`'s directory map and `docs/adr/0003-sse-based-live-reload.md`).
  None of that translates to writing a static file once and exiting —
  there is no server to watch a port for, no browser tab to (not) open,
  and no long-running process for `--watch` to keep alive.
- **This project already has a working precedent for "export to a
  durable artifact is its own verb-subcommand," not a mode flag on an
  existing command.** `pdf` and `png` both already exist as separate
  subcommands from `render`, specifically because exporting to a durable
  file is a different shape of operation from serving — see
  `docs/adr/0001-adopt-ts-node-cli-with-puppeteer-core-export.md` for the
  original CLI shape this established. A third export target (a static
  site directory) extending that same precedent is the smaller, more
  consistent decision than introducing a first-ever "mode flag on
  `render`" pattern this project has deliberately avoided for `pdf`/`png`
  already.
- **A mode flag would still need almost all of `render`'s options to stay
  meaningless once the flag were set.** `--no-open`, `--port`, and
  `--watch` would all have to be silently ignored (or explicitly
  rejected) under a hypothetical `render --static` mode, producing a
  command whose valid-option set changes shape depending on another
  flag's value — exactly the kind of implicit, mode-dependent option
  interaction a separate subcommand avoids by construction, since an
  option that does not apply to `build` simply is never defined on it in
  the first place.

## Considered Options

1. **A new `build <file> [output]` subcommand**, structured as a sibling
   of `pdf`/`png`: same `<file> [output]` positional shape, same
   frontmatter/theme/direction/notes resolution through the existing
   `computeEffectiveTheme`/`computeEffectiveTransition`/
   `computeEffectiveDirection` helpers, and the same `generateHtml()`
   call every other command already makes.
2. **A new `--static [dir]` (or `--output-dir`) flag on the existing
   `render` command**, which would skip starting the HTTP server and
   opening a browser, and instead write the rendered HTML straight to
   disk.

## Decision Outcome

Chosen: **Option 1 — a new `build` subcommand.**

`render`'s own name and its entire existing option set commit it to
being the serve-and-watch command; retrofitting a "do not actually serve
anything" flag onto it would work mechanically (skip `startServer()`,
skip `open()`, write the file instead) but would leave `render --static`
as a command whose own most distinctive options (`--watch`, `--port`,
`--no-open`) become dead weight the moment that flag is passed — a
worse, more surprising interface than a subcommand that simply never
defines those options because they do not apply to it. `pdf` and `png`
already settled this exact question for their own export targets in
`docs/adr/0001`: exporting to a durable artifact earns its own verb,
`render` stays the one command whose job is serving. `build` follows
that same precedent rather than introducing a second, inconsistent
pattern (a mode flag) alongside it for no reason specific to a static
site export that would not have applied equally to `pdf`/`png` when
those were first added.

Once framed as a sibling of `pdf`/`png` rather than a mode of `render`,
the rest of `build`'s shape follows directly: the same `<file> [output]`
positional arguments, the same `--css`/`--css-vars`/`--theme`/`--dir`/
`--with-notes` options `pdf`/`png` already have, and a default output
path derived the same way `resolveOutputPath` already derives one for
`pdf`/`png` (`resolveBuildOutputDir`, mirroring its shape for a directory
instead of a single file). The one deliberate exception is
`--transition`: `build`'s output stays the same interactive, presentable
document `render` serves — including `presentationScript.ts`'s
navigation — unlike a flattened PDF page or a per-slide PNG screenshot,
so a deck-wide slide transition is still visually meaningful for `build`
in a way it is not for `pdf`/`png`, which is why neither of those two has
the flag and `build` does.

No second/parallel HTML-generation path was introduced: `build` calls
the exact same `generateHtml()` every other command already calls, with
the same resolved options, so every existing guarantee about that
output — no CDN reference, no bundled/downloaded browser, correct theme/
notes/direction handling — is inherited automatically rather than
needing to be re-proven for a new code path.

## Consequences

**Good:**

- A deck can now be deployed as a plain static site with zero
  server-side code — the written `index.html` needs nothing beyond a
  static file host (or no host at all; it opens correctly straight off
  local disk via a `file://` URL, verified directly in this release's
  own final-integration pass).
- Presentation mode's `?present` query flag and `#N` hash-based slide
  addressing already work against this static output with zero
  additional code, because `presentationScript.ts` was already written
  to drive all of its navigation client-side through `location.hash`/
  `location.search` rather than anything server-dependent — verified
  directly against a real `file://` static build, not assumed from
  reading the script.
- `render`'s own option set stays exactly what it was — no new mode
  flag whose validity depends on another flag's value, and no need to
  silently ignore `--watch`/`--port`/`--no-open` under some other mode.
- Extends this project's own established "export target earns its own
  subcommand" precedent (`pdf`, `png`) rather than introducing a second,
  inconsistent pattern next to it.

**Bad / open risks:**

- **True per-slide multi-page output (one URL per slide, e.g.
  `slide-2.html`, rather than one `index.html` containing every slide)
  is an intentional, deliberately deferred fast-follow, not part of this
  release.** Splitting a single generated document into multiple linked
  files would need real, separate design work — path rewriting for
  internal navigation, a shared-asset strategy across files — that this
  release did not attempt even a partial version of.
- **`build` adds a fourth subcommand alongside `render`/`pdf`/`png`,
  continuing to grow `src/index.ts` as a single file with no
  `src/commands/` split.** `AGENTS.md` already flags this as a decision
  to revisit only once the subcommand count justifies it, not something
  this release changes.

## Confirmation

This decision is confirmed as implemented by:

1. `src/index.ts` — the `build <file> [output]` command definition,
   structured as a direct sibling of the `pdf`/`png` command definitions
   immediately above it, sharing their option set except for the
   `--transition` addition.
2. `src/cliHelpers.ts` — `resolveBuildOutputDir()`, mirroring
   `resolveOutputPath`'s own default-derivation shape and
   case-insensitive `.md` handling, but for a directory name rather than
   a file with a swapped extension.
3. `tests/cli.test.ts` — the `build` integration tests, including the
   assertion that a written `index.html` is byte-identical to a direct
   `generateHtml()` call on the same fixture with the same resolved
   options (proving `build` is not a divergent rendering path), plus the
   default-output-directory, `--theme`, and file-not-found tests.
4. `tests/cliHelpers.test.ts` — unit coverage for
   `resolveBuildOutputDir()`, including its case-insensitive `.md`
   handling and its no-op-avoiding append behavior for a non-`.md` input.
5. This release's own final-integration pass, verifying a real,
   unmocked `file://` static build against a real browser: no CDN
   reference or external `src`/`href` anywhere in the written HTML, and
   `?present`/`#N` navigation (including plain arrow-key advance)
   working correctly with no server running at all.
6. The full existing test suite, `npm run build`, `npm run lint`, and
   `npm run typecheck` all passing.

## More Information

- `docs/adr/0001-adopt-ts-node-cli-with-puppeteer-core-export.md` — the
  ADR establishing `pdf` as its own subcommand rather than a `render`
  mode, the precedent this decision extends to a second export target.
- `docs/adr/0003-sse-based-live-reload.md` — the live-reload mechanism
  that is part of what makes `render` genuinely a different kind of
  command from `build`, not just a naming choice.
- `docs/adr/0012-syntax-highlighting-and-line-highlight.md` — the most
  recent prior ADR, and the template this one follows for structure and
  tone.
