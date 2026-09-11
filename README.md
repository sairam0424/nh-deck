# nh-deck

nh-deck is a local-first CLI tool for writing, presenting, and exporting Markdown-based slide decks — this author's own take on the presentation-CLI concept popularized by [arpitbbhayani/deckrun](https://github.com/arpitbbhayani/deckrun). Write your deck as plain Markdown, render it and serve it from a local HTTP server on your own machine, present it straight from your browser, and export it to PDF — all without an internet connection or an account, and without any of it ever leaving your machine. It's one of three independent sibling projects under the [Not-Humans-Lab](../Not-Humans-Lab/) umbrella (alongside `nh-skills` and the planned `daily-dose`), each an independent repo with its own toolchain.

## Installation

Once published:

```bash
npx nh-deck <command>
# or
npm install -g nh-deck
```

nh-deck is currently a walking skeleton and has not been published yet. For now, run it from a local clone:

```bash
git clone <this-repo-url>
cd nh-deck
npm install
npm run build
node dist/index.js <command>
```

## Usage

Render a Markdown deck and serve it locally, then open it in your browser (add `--no-open` to skip auto-opening, `--port <n>` to pin a specific port, `--watch` to re-render and auto-refresh the browser whenever the file changes, or `--css <path>` to fully replace the default stylesheet with your own):

```bash
nh-deck render deck.md
```

Export a deck to PDF:

```bash
nh-deck pdf deck.md
```

Export a deck to one PNG per slide:

```bash
nh-deck png deck.md
```

`pdf` and `png` also accept `--css <path>` to replace the default stylesheet, same as `render`.

(from a local clone, substitute `node dist/index.js` for `nh-deck` in any of the examples above)

PDF export works by launching a Chrome/Chromium/Edge/Brave binary that's already installed on your machine (via `puppeteer-core` + `chrome-launcher`) — nh-deck never downloads or bundles a browser itself.

## Current limitations

This is an early walking skeleton, not a feature-complete tool. The following are deliberate, tracked fast-follows rather than oversights:

- **Themes, templates, and transitions** — no full visual customization system yet beyond the `--css` flag (which lets you replace the default stylesheet outright); every deck otherwise renders with the single default look.
- **PDF export fidelity across browsers** — the full 3-OS × multi-Node CI matrix confirms PDF export *works* on Chrome/Chromium across Linux, macOS, and Windows, but visual-fidelity differences between Chrome vs. Edge vs. Brave (whichever `chrome-launcher` detects on a given machine) haven't been characterized yet.

KaTeX (math rendering) and Mermaid (diagrams) are both supported today, CDN-free — see `AGENTS.md`'s Known Gotchas for how.

nh-deck never phones home and the rendered HTML never depends on a CDN for correctness — that local-first constraint carries over unchanged from the original `deckrun` concept, even while the features above are still catching up.
