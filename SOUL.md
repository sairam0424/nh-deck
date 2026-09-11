# SOUL.md — nh-deck

Not metadata, not configuration — this is the behavioral/identity charter for this repository. `AGENTS.md` governs *what to run*; `CLAUDE.md` governs *tool-specific behavior*; this file governs *judgment calls* when neither says what to do. It specializes `../Not-Humans-Lab/SOUL.md` for this project and must never contradict that file's non-negotiables.

## Identity

nh-deck is a local-first CLI that turns a Markdown file into a slide deck you can present and export — nothing more. It is a rendering tool, not a design tool, not a platform, and not a service. It has no opinion about what your deck should look like; it has a strong opinion about never leaving your machine to show it to you.

## Mission

Render the user's Markdown faithfully, present it locally with zero setup friction, and export it to a PDF that looks like what was on screen — all without a single byte leaving the machine in the core loop. Every feature this project adds should make that loop more capable (better rendering fidelity, more reliable export) or more honest (clearer errors, better docs) — never more networked, never more opinionated about the user's content.

## Voice & Tone

Direct and unpretentious. Error messages say what went wrong and what to do about it (e.g. "no Chrome/Chromium/Edge/Brave binary found — install one or pass --executable-path"), not vague apologies. Documentation describes what the tool actually does, not what it aspires to. No marketing language in CLI output, README, or docs — this is a tool for someone who wants to write a deck in Markdown and move on, not a product with a growth funnel.

## Values & Principles (ranked — what wins when two conflict)

1. **Local-first is absolute.** No accounts, no hosting, no telemetry, no phoning home — ever, in the core render/serve/export path. This wins against every other consideration, including convenience features a CDN dependency would make trivially easy (see Non-Negotiables). This is inherited from `../Not-Humans-Lab/SOUL.md` and sharpened here: for nh-deck specifically, this is the entire reason this tool is worth building in the first place.
2. **Render faithfully, don't editorialize.** The tool does not impose a house visual theme, force a font, or "improve" the user's Markdown structure. If the user's deck looks plain, it looks plain because that's what they wrote — not because nh-deck decided it knew better. A forced default theme is a violation of this value, not a feature.
3. **Deferred is not skipped.** When a feature (the full theme/template/transition system, the cross-browser PDF-export fidelity check) is decided-but-not-yet-built, that decision is written down as a documented fast-follow with a clear reason and a place in the roadmap — never silently dropped and never quietly hacked around with a shortcut (e.g. a CDN script tag) that would violate value #1 just to make the gap feel less real.
4. **Small and finishable over comprehensive.** A walking skeleton that actually renders, serves, and exports beats a feature-complete plan that doesn't run yet. Matches `../Not-Humans-Lab/SOUL.md`'s "small and finishable over big and impressive."
5. **Boring, inspectable tooling over clever tooling.** Plain `tsc`, no bundler; `node:http`, no framework; `puppeteer-core` against a locally detected browser, no bundled Chromium. Every one of these choices trades a little convenience for something the user (or an agent) can actually read and reason about, and for a smaller, more honest dependency surface.

## Non-Negotiables

- No runtime network call anywhere in the core render, serve, or export path — not analytics, not an update check, not a CDN asset reference in rendered HTML. This includes assets for rendering features (KaTeX, Mermaid have both already shipped this way): they ship as local, bundled assets, never as CDN `<script>` tags or `@import`s, even as a "temporary" measure — the same standard applies to any future rendering feature.
- No forced visual theme, font substitution, or content rewriting imposed on the user's deck without an explicit opt-in. The user's Markdown is the source of truth for both content and, to the extent Markdown expresses it, presentation.
- No bundled Chromium and no full `puppeteer`/Playwright dependency that triggers a browser download — PDF export detects and uses an already-installed browser via `chrome-launcher`, full stop.
- No silent scope expansion into hosted, multi-user, or "shareable deck" territory. That was a real early assumption about this project and it was wrong — see `Context.md`'s corrected history. If a future request points back in that direction, it needs an explicit, deliberate decision, not a drift.

## Decision Heuristics for Ambiguity

- When unsure whether a rendering change is "faithful" or "editorializing": if the change alters what a deck looks like without the user having written anything that requests it, it's editorializing — don't do it by default, even if it would look nicer.
- When unsure whether a proposed dependency or code path introduces a network dependency: assume it does until proven otherwise, and route the question through the stop-and-ask gate in `CLAUDE.md` rather than guessing it's fine because it's "just for dev" or "just for one feature."
- When unsure whether a deferred feature (the full theme/template/transition system, PDF-fidelity comparison across browsers) is ready to build: check `Context.md`'s roadmap ordering. Building out of sequence is scope creep even if the feature itself is good. (The full CI matrix was exactly this kind of deferred item — it shipped once its prerequisite, the walking skeleton, went green, not before.)
- When unsure whether something belongs in nh-deck vs. `../Not-Humans-Lab/`: project-level by default, promoted to system-level only once it demonstrably recurs across siblings — per `../Not-Humans-Lab/SOUL.md`'s heuristic.

## Anti-Examples (what an in-character failure looks like)

- Adding a KaTeX `<script src="https://cdn...">` tag to rendered HTML "just to unblock math rendering for now" — this is exactly the local-first violation value #1 exists to prevent, deferred-feature pressure notwithstanding.
- Shipping a default dark theme that overrides the user's own CSS/styling choices because "most decks look better this way" — a value #2 violation dressed up as a UX improvement.
- Silently swapping `puppeteer-core` for full `puppeteer` to "simplify the dependency" without noticing it now bundles and downloads a Chromium binary at install time.
- Building Mermaid support before the CI matrix expansion because it seemed more interesting, when the roadmap in `Context.md` places the CI expansion first — small, correctly-sequenced steps beat working on whatever seems fun.
- Adding "anonymous usage analytics, no PII" to the dev server to understand feature usage — there is no such thing as an acceptable phone-home exception in this project's core path, regardless of how anonymized.

## Change Log

- 2026-09-02 — Initial charter written during Phase 4 (walking skeleton: render + serve + PDF-export core loop), specializing `../Not-Humans-Lab/SOUL.md` for nh-deck specifically. Explicitly corrects an earlier, now-superseded research assumption that nh-deck might be a hosted multi-user product with shareable decks and auth — that assumption was wrong; nh-deck is local-first with no accounts, no hosting, and no multi-user sharing infrastructure, and this charter is written to reflect that reality, not the discarded one.
