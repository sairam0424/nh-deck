@AGENTS.md

## Claude Code

This addendum is Claude-specific behavior only, on top of the shared instructions in `AGENTS.md`. Keep this file under 200 lines — push anything that grows beyond a short addendum into `AGENTS.md` or a referenced doc instead.

### Verifying rendering output: use the snapshot harness, not manual inspection

**Prefer the CLI's own Vitest snapshot-test harness over ad hoc manual verification when checking rendering output.** Do not "verify" a rendering change by running `nh-deck render` on a sample deck, opening the resulting HTML in a browser (or in a screenshot tool), and eyeballing whether it looks right. That is not a repeatable check and leaves no artifact for the next person or the next PR to lean on.

Instead:

- Run `npm test` (or `npx vitest run` targeting the relevant file) and confirm the snapshot tests pass.
- If a rendering change is intentional and snapshots need updating, run `npx vitest run -u`, then **read the resulting diff** before committing it — treat an accepted snapshot update as a claim that the new output is correct, not just a mechanical unblock step.
- Only fall back to manual browser inspection (e.g. via a screenshot/browse tool) for genuinely exploratory checks — for example, confirming a new feature's visual intent before a snapshot even exists yet. Once a snapshot exists for a code path, the snapshot test is the source of truth for that path, not a human glance.

### The local-first constraint is a stop-and-ask gate, not a lint rule

nh-deck's core promise is that it never phones home: no accounts, no hosting, no telemetry, and rendered HTML that does not depend on any CDN for correctness. This is documented as non-negotiable in `SOUL.md`, and it is easy to violate by accident — a "just add this one CDN script tag for KaTeX" edit, an analytics snippet copy-pasted from a tutorial, a `fetch()` added to the dev server for a "quick" feature.

**Before proposing any diff that would introduce a runtime network dependency into the core render, serve, or export path — stop and ask the user for explicit permission first.** This includes, non-exhaustively:

- Adding a CDN-hosted script or stylesheet reference (KaTeX, Mermaid, fonts, or otherwise) into rendered HTML output.
- Adding any outbound HTTP call (telemetry, update checks, license pings, analytics) anywhere in `src/render.ts`, `src/server.ts`, or `src/pdfExport.ts`.
- Swapping `puppeteer-core` for full `puppeteer` or Playwright in a way that triggers a browser download at install or run time.
- Any dependency whose install script or runtime behavior reaches the network for something other than the package manager's own install step.

Do not silently work around this constraint (e.g. by making the network call "opt-in" via a flag) without the same explicit check-in — an opt-in network call is still a network call this project's identity says it doesn't have. If the user explicitly approves an exception, note the approval and the reasoning in the relevant commit/PR description so the decision is traceable later.

KaTeX and Mermaid have already shipped, CDN-free — see `AGENTS.md`'s Known Gotchas — and they are the precedent for how this gate is supposed to work: KaTeX's fonts are embedded locally as base64, and Mermaid's own CDN Google Fonts `@import` was found and stripped rather than shipped. This gate exists to keep any *future* rendering feature honoring that same precedent instead of quietly reintroducing a network dependency: local-asset installation is fine, a CDN `<script>` tag or `@import` is not, and the user gets to make that call explicitly, not have it made for them by convenience.

### Scope discipline

- This is a walking skeleton (Phase 4 — render + serve + PDF-export core loop). Do not scaffold KaTeX, Mermaid, themes, templates, or transitions ahead of schedule — see `Context.md`'s roadmap for sequencing. Building these early is scope creep against an explicitly staged plan, not helpfulness.
- Do not add a bundler (esbuild/webpack/rollup) or swap Vitest for another test runner without being asked — both are settled decisions, not open questions.
- Do not create new top-level docs (README variants, extra planning files) unless explicitly asked — this repo's doc set is `AGENTS.md`, `CLAUDE.md`, `SOUL.md`, and `Context.md`, plus whatever `../Not-Humans-Lab/` covers by reference.
- When a request is ambiguous between "add this to nh-deck" and "this belongs in Not-Humans-Lab" (cross-project), default to nh-deck unless it demonstrably constrains or cuts across another sibling project — see `../Not-Humans-Lab/SOUL.md`'s decision heuristic.

### Read SOUL.md before touching rendering behavior

nh-deck deliberately does not impose a house visual style on the user's own deck content — it renders faithfully and does not editorialize the user's aesthetic choices. Before changing anything in `src/render.ts`, read `SOUL.md`'s Non-Negotiables so a "helpful" default (a forced theme, an opinionated font substitution, auto-injected styling) doesn't quietly contradict that identity.
