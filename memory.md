# Memory Index

This file is the agent-writable, accumulated-lessons index for **nh-deck**. It
mirrors Claude Code's own `MEMORY.md` convention: a flat list of one-line
entries, each linking to a dedicated topic file that holds the full detail.
Keep this index short — it is a table of contents, not the content.

## Convention

- **One line per entry.** Format: `- [Short title](topic-file.md) — one-sentence summary. (type, YYYY-MM-DD)`
- **Topic files** live alongside this index (flat, no subfolder) unless the
  project later grows enough entries to warrant grouping — do not create that
  structure preemptively (YAGNI).
- **Entry types** (pick exactly one per entry):
  - `user` — a standing preference or instruction the user gave that should
    persist across sessions.
  - `feedback` — a correction after something went wrong; captures what was
    wrong and what to do instead (e.g. the now-superseded "hosted multi-user
    product" assumption this project once carried and had to be corrected
    away from).
  - `project` — a decision or milestone specific to nh-deck (a shipped
    phase, a rendering-pipeline change, a CI-matrix expansion).
  - `reference` — a pointer to durable external or cross-project context
    (e.g. something in `../Not-Humans-Lab/`) that's relevant here but owned
    elsewhere.
- **Dated.** Every entry carries the date it was written, so stale entries are
  identifiable at a glance.
- **Pruned.** When a topic file's guidance is superseded or no longer
  applies, delete its line from this index (and the topic file itself if
  nothing else references it). Do not let this index grow unbounded with
  dead entries — prune during phase reviews, not just when convenient.

## Entries

_(none yet — this project has no session history to record. The first entry
should be added the first time a real lesson, correction, or decision worth
persisting across sessions occurs, not invented ahead of time.)_

## Cross-references

- System-level (cross-project) memory conventions, if any are established for
  the whole Not-Humans-Lab suite, live in `../Not-Humans-Lab/memory.md` —
  link to the relevant file there by relative path rather than duplicating
  its content.
- The completed sibling project `nh-skills` has its own `memory.md` at
  `../nh-skills/memory.md`, usable as a house-style precedent for entry
  format — do not copy its (nh-skills-specific) entries into this file.
