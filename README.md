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

Render a Markdown deck and serve it locally, then open it in your browser (add `--no-open` to skip auto-opening, or `--port <n>` to pin a specific port):

```bash
nh-deck render deck.md
```

Export a deck to PDF:

```bash
nh-deck pdf deck.md
```

(from a local clone, substitute `node dist/index.js` for `nh-deck` in either example)

PDF export works by launching a Chrome/Chromium/Edge/Brave binary that's already installed on your machine (via `puppeteer-core` + `chrome-launcher`) — nh-deck never downloads or bundles a browser itself.

## Current limitations

This is an early walking skeleton, not a feature-complete tool. The following are deliberate, tracked fast-follows rather than oversights:

- **Math and diagrams** — KaTeX (math rendering) and Mermaid (diagrams) support is decided but not yet installed. They are deferred, not silently dropped.
- **Themes, templates, and transitions** — no visual customization yet; every deck renders with a single default look.
- **Multi-OS CI** — CI currently runs a single job on `ubuntu-latest` only. The full 3-OS × multi-Node-version matrix is deferred until after this walking skeleton is green.
- **PDF export fallback** — if no local Chrome/Chromium/Edge/Brave install is found, `nh-deck pdf` fails rather than automatically downloading a browser for you.

nh-deck never phones home and the rendered HTML never depends on a CDN for correctness — that local-first constraint carries over unchanged from the original `deckrun` concept, even while the features above are still catching up.
