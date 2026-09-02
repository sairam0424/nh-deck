# TESTING.md — nh-deck

This is nh-deck's own filled-in copy of the canonical template at
`../Not-Humans-Lab/TESTING.md`. It locks in this project's test approach
from day one rather than deferring it — do not invent new section names
here; fill in the same headings the template defines.

## Test Philosophy

nh-deck follows a classic **Fowler-style test pyramid**, not a trophy shape.
The reasoning: the core logic here (`generateHtml`, a pure Markdown-to-HTML
function) is deterministic and cheap to isolate in a unit test — there is no
dynamic type system gap or schema-validation surface that would make a
trophy shape (mostly integration, thin unit layer) the better fit, the way
it might be for a project whose correctness lives mostly in runtime-checked
shapes. A wide base of fast unit tests carries most of the weight; a thinner
integration layer verifies the CLI process's actual observable behavior
(stdout); a thin top layer proves the packaged artifact actually installs
and runs.

## Test Pyramid by Layer

| Layer | Target ratio (mature) | What it's allowed to touch |
|---|---|---|
| Unit | ~70% | Pure functions only — primarily `generateHtml` in `src/render.ts`. No filesystem, no network, no child process, no real browser. |
| Integration | ~20% | Spawns the actual CLI as a real child process (`node dist/index.js render <fixture>` or equivalent) and asserts on its stdout/stderr/exit code. Non-deterministic fields (the ephemeral port number) are normalized before comparison/snapshotting. Real filesystem (fixtures) is allowed; no real network beyond the loopback interface the dev server itself binds to. |
| E2E / packaging | ~10% | `npm pack` → install the resulting tarball into a temp directory → run the packed binary. Verifies the shipped artifact (not just source) actually works: shebang intact, `bin` entry resolves, dependencies are correctly declared (not accidentally devDependencies). |

**This walking skeleton phase implements exactly one test per layer** —
one unit test for `generateHtml`, one integration test that spawns the CLI
and checks normalized stdout, one e2e test that packs/installs/runs the
binary — not the full ~70/20/10 ratio yet. The ratio above is the target
for the *mature* version of this project, to be grown into as real feature
surface accrues, not retrofitted all at once.

## Required npm Scripts

For this walking-skeleton phase, exactly three scripts exist:

- `build` — wraps `tsc` (transpile-only, no bundler). Produces `dist/index.js`.
- `test` — wraps `vitest run`. Runs the full suite (unit + integration + e2e
  test files together) as the single blocking gate.
- `test:watch` — wraps `vitest` in watch mode, for local dev.

As the project grows past this skeleton, expect this to expand toward the
same name-identical script set the sibling projects converge on per
`../Not-Humans-Lab/TESTING.md` (`test:unit`, `test:integration`, `test:e2e`,
`test:coverage`, plus a project-specific `test:snapshot` for the normalized
CLI-stdout snapshots) — but do not add those scripts ahead of having
distinct enough test files to justify separating them; three scripts is
correct for the current file count.

## Coverage Thresholds

The workspace-wide floor is 80% (unit + integration + e2e combined), per
`../Not-Humans-Lab/TESTING.md` and the global testing rules. This walking
skeleton phase does not yet enforce this numerically via a `test:coverage`
script — that lands once there's a stable, non-trivial `src/` surface across
all four modules (`index.ts`, `render.ts`, `server.ts`, `pdfExport.ts`) to
measure meaningfully. `dist/` (generated build output) is excluded from
coverage once measurement is added.

## Non-Determinism Policy

The one genuinely non-deterministic field this project produces is the
**ephemeral port number** the local dev server binds to for `nh-deck
render`. Integration tests that assert on CLI stdout must normalize this
field (e.g. replace `http://127.0.0.1:\d+` with a fixed placeholder like
`http://127.0.0.1:<PORT>`) before comparing or snapshotting — never assert
on a literal port number, and never pin the server to a fixed port just to
make a test simpler, since that would break local multi-instance usage.
There is no LLM-output or timing-dependent surface in this project to
quarantine separately.

## File Naming & Location

Tests live under `tests/`, mirroring `src/`'s structure per the global
coding-style convention (`tests/render.test.ts` corresponds to
`src/render.ts`, etc.), rather than being colocated next to source files.
File naming: `*.test.ts`.

## CI Scope (deferred matrix)

CI for this walking skeleton runs as a **single job on `ubuntu-latest`**,
running `npm run build && npm test`. The full 3-OS (Linux/macOS/Windows) ×
multi-Node-version (20/22+) matrix is an explicit, deliberate deferral — not
an oversight — and is only added once this single-OS skeleton is proven
green. Do not add the matrix preemptively.

## Cross-references

- Canonical template this file fills in: `../Not-Humans-Lab/TESTING.md`.
- What gets tested (the render module, the dev server flow, the PDF export
  flow) is documented in `architecture.md`'s Building Block View and
  Runtime View.
- The repo layout of `tests/` and `fixtures/` is documented in
  `codebase_map.md`.
