# 0003. SSE-based live-reload for `render --watch`

## Status

Accepted — 2026-09-11

## Context and Problem Statement

`AGENTS.md`'s Overview line already claims the local dev server supports
"live reload" — `CODEBASE_INDEX.md` confirmed this was false: `server.ts`
had no file-watch or push mechanism at all. We need a way to detect
changes to the source Markdown file and get the open browser tab to
refresh automatically, without violating the local-first constraint (no
CDN-hosted client script, no outbound network call) and without changing
`render`'s existing default (non-watch) behavior.

## Decision Drivers

- No new runtime dependency, and no new protocol library — whatever
  push mechanism is chosen must be implementable on top of the existing
  `node:http` server.
- The client-side reload script must be inline and same-origin — never a
  CDN reference (`CLAUDE.md`'s stop-and-ask gate exists specifically for
  this class of change).
- Must not change `render`'s existing tested default behavior — ships
  behind an explicit `--watch` flag, not always-on.
- Must be genuinely testable, including the reload push itself, not just
  the file-watch trigger in isolation.

## Considered Options

1. **Server-Sent Events (SSE)** — a one-directional, server-to-client
   push mechanism natively supported by `node:http` over a normal
   HTTP/1.1 connection (`Content-Type: text/event-stream`).
2. **WebSocket** — a full bidirectional protocol, would require either a
   new dependency (`ws`) or hand-rolling the WebSocket handshake/framing
   on top of `node:http`.
3. **Client-side polling** — the browser periodically re-fetches the
   document (or a small "version" endpoint) and reloads if it changed.

## Decision Outcome

Chosen option: **Option 1 — Server-Sent Events.**

- **Option 2 (WebSocket)** was rejected: nh-deck's reload need is
  strictly one-directional (server tells the client to reload; the
  client never needs to send anything back), so a bidirectional protocol
  is more machinery than the problem calls for. Hand-rolling the
  WebSocket upgrade handshake by hand would also be exactly the kind of
  protocol-level code this project's "no bundler, minimal dependency
  surface" philosophy argues against reaching for without a real need.
- **Option 3 (polling)** was rejected: it either wastes requests (poll
  too often) or feels sluggish (poll too rarely), and still needs a
  change-detection mechanism (an ETag or content hash) that SSE's
  push-on-actual-change model makes unnecessary.
- **Option 1 (SSE)** fits `node:http` directly — it's just a long-lived
  HTTP response with a specific content type and a simple text framing
  (`data: ...\n\n`), no handshake, no extra dependency, and the browser's
  built-in `EventSource` API (used in the injected client script) handles
  reconnection automatically if the connection drops.

## Consequences

**Good:**

- Zero new dependency; SSE is native to both `node:http` and every
  browser's `EventSource` API.
- The reload script is ~2 lines of inline JavaScript, trivially
  auditable for the local-first constraint (no CDN reference, verified
  directly in tests).
- `render`'s existing non-watch behavior is provably unchanged (verified
  directly: the SSE branch and script injection are both gated behind
  `options.watch`).

**Bad:**

- SSE connections are one-directional — if nh-deck ever needs
  client-to-server signaling (e.g., a future "jump to slide N" remote
  control), a different mechanism would be needed then; not a concern
  for this phase's scope.
- An open SSE connection keeps `http.Server.close()` pending until the
  connection ends — verified directly and handled via
  `server.closeAllConnections()` in tests and would need the same
  handling in any future caller that needs a clean, immediate shutdown
  with a watch-mode server still holding an open tab.

## Confirmation

This decision is confirmed as implemented when:

1. `render --watch` re-renders and pushes a reload event when the
   source file changes.
2. `render` without `--watch` behaves identically to before this phase
   (verified: all pre-existing tests pass unmodified).
3. The reload script and endpoint are same-origin and inline — no
   `http://`/`https://` reference appears anywhere in watch-mode output.

## More Information

- See `docs/specs/feature-implementation-roadmap-design.md` §5 for how
  this fits into the broader Phase 3 roadmap item.
- See `Context.md`'s Roadmap, item 5.
