# Support

nh-deck is a personal, local-first CLI tool for writing, presenting, and
exporting Markdown-based slide decks (the author's own version of
[arpitbbhayani/deckrun](https://github.com/arpitbbhayani/deckrun)). It is
maintained by one person in spare time. Support here is **best effort,
with no SLA** — please calibrate expectations accordingly. If you need
guaranteed response times, this project is not the right dependency for
that.

## How to Get Help (in order)

1. **Read the docs first** — see Links below. Most "how do I render/serve
   a deck," "why did PDF export fail to find a browser," or "why doesn't
   KaTeX/Mermaid work" questions are answered there (the last one:
   KaTeX/Mermaid are a deferred fast-follow, not yet installed — see
   `status.md`).
2. **Search existing issues** — someone may have already hit the same
   problem: use GitHub's issue search on this repo before opening a new
   one.
3. **Open a GitHub issue** — for bugs, rendering mismatches, PDF export
   failures, unclear docs, or feature requests. This is the primary
   channel. See "How to File a Good Bug Report" below.
4. **GitHub Discussions** (if enabled on this repo) — for open-ended
   questions, "is this the right way to structure a deck," or general
   feedback that isn't a concrete bug.
5. **Do not use security channels for support** — if your issue is a
   suspected vulnerability (e.g., a command-injection concern in the PDF
   export path, or an XSS concern with a third-party deck), stop and go
   to `SECURITY.md` instead (see Security section below).

## Links to Docs

- Project overview and current state: `status.md` (this repo, root)
- Architecture and process decisions: `decisions.md` and `docs/adr/`
  (this repo, root)
- Cross-cutting, system-level docs shared across the sibling projects
  (`daily-dose`, `nh-deck`, `nh-skills`): `../Not-Humans-Lab/` — link by
  relative path; content there is not duplicated here.
- Security posture, including the local-only server binding and the
  third-party-deck HTML/XSS trust boundary: `SECURITY.md`.

## Community Channels

This is a personal project, not a company product — there is no Slack,
Discord, or forum. The only community channel is this repository's GitHub
Issues (and Discussions, if enabled). If that changes, this section will
be updated.

## How to File a Good Bug Report

A good report lets the maintainer reproduce the problem without a
back-and-forth. Please include:

1. **Which command you ran** — e.g. `nh-deck render deck.md`,
   `nh-deck serve`, `nh-deck export --pdf`, including any flags.
2. **What you expected** vs. **what actually happened** — include the
   exact error output or terminal log, not a paraphrase.
3. **A minimal repro deck** if possible — the smallest Markdown file that
   still triggers the issue (strip out unrelated slides/content).
4. **Environment** — Node.js version (`node -v`), OS, and — for PDF
   export issues specifically — which browser(s)
   (Chrome/Chromium/Edge/Brave) are installed and detectable on your
   machine.
5. **How you installed nh-deck** (global npm install, `npx`, cloned repo
   + local build).

Bug reports that are just "it doesn't work" without the above will likely
get a follow-up question before any fix — including the details up front
saves a round trip.

## Response-Time Expectations

- **No guaranteed response time.** This project has no SLA.
- As a rough, non-binding guide: issues are typically triaged (labeled,
  acknowledged) within a couple of weeks, faster if the report is clear
  and actionable.
- Security reports follow the timeline in `SECURITY.md`, which is tighter
  than general support because of the private-disclosure process — use
  that channel, not a public issue, for anything security-related.
- Pull requests fixing an obvious bug with a clear description are
  generally reviewed faster than open-ended feature requests.

## Security Issues

If your question is actually a security concern — a command-injection
risk in the PDF export path, a way the local dev server could become
reachable beyond `127.0.0.1`, or a third-party deck file that behaved in
a way you didn't expect — **do not file a public issue**. Follow the
private reporting process in `SECURITY.md` instead.
