# agent_learning.md — nh-deck

Append-only, dated register of corrections applied to AI agents working in this repo — companion to `AGENTS.md`/`CLAUDE.md` (which hold current-state static instructions), not a replacement. This file holds the *history of why* those instructions exist.

**Scope:** learnings specific to this project's own code/domain. A learning that recurs in two or more sibling projects' own `agent_learning.md` files gets copied up to `../Not-Humans-Lab/agent_learning.md`, with a one-line pointer left here.

## Entries

### 2026-09-02 — Promoted to system level (x2)

Two learnings first observed concretely in this repo recurred in one or more siblings and were promoted:

1. **Aspirational docs drift** — this repo's own docs described `src/commands/`, `src/render/`, `src/server/`, `src/export/` subdirectories and a `test/__snapshots__/` convention that never matched the real, flat `src/render.ts`/`src/server.ts`/`src/pdfExport.ts` implementation. Recurred in nh-skills and daily-dose too.
2. **ConfigProtection blocks `tsconfig.json` in any new project with its own `package.json`** — hit for real here first; the fix (a scoped `ALLOW_CONFIG_PATHS` exception) was then applied proactively for daily-dose before it hit the same wall.

Full entries, root causes, and the standing rules now in force for both: see `../Not-Humans-Lab/agent_learning.md`.

## Entry format

- **Date**
- **Trigger** — what prompted the entry
- **Observation** — what the agent did or assumed, verbatim where useful
- **Root cause** — why the agent got it wrong
- **Correction / Rule** — the concrete, checkable rule now in force
- **Scope** — this-project-only vs. system-wide (system-wide entries get promoted, see above)
- **Status** — active | superseded | promoted-to-AGENTS.md (with a link to where it landed)
