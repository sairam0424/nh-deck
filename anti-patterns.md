# anti-patterns.md — nh-deck

Catalog of recurring BAD practices actually observed in THIS repo's own code/domain — not generic industry ones. A pattern that recurs in two or more sibling projects gets promoted to `../Not-Humans-Lab/anti-patterns.md`, with a one-line pointer left here.

## Entries

*(none yet — no bad pattern has actually recurred in this repo's own code; the cross-cutting issues found during Phase 7 reconciliation (aspirational docs drift, ConfigProtection on tsconfig.json) were logged as `agent_learning.md` corrections, not code anti-patterns — see this file's own `agent_learning.md` and `../Not-Humans-Lab/agent_learning.md`)*

## Entry format (for when entries land)

- **Name** — short, memorable; reuse an existing industry name if one exists
- **Where observed** — file/module, or this repo as a whole
- **Symptoms** — how to recognize it during review/diff
- **Root cause** — why it keeps happening
- **Consequences** — the concrete cost
- **Recommended alternative** — the sanctioned pattern instead, linking an ADR if one governs the choice
- **Example** — a real (anonymized if needed) before/after
- **Known exceptions** — when this anti-pattern is actually the right call
