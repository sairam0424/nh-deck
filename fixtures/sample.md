# Getting Started with nh-deck

nh-deck turns a single Markdown file into a slide deck you can present or
export to PDF. Everything runs locally on your own machine.

Key features of the walking skeleton:

- Render Markdown to a self-contained HTML document
- Serve the deck locally with `nh-deck render`
- Export the rendered deck to PDF via a local Chrome binary

Here's a minimal example of starting the dev server from the CLI:

```bash
nh-deck render fixtures/sample.md --port 4000
```

No accounts, no hosting, no CDN dependencies — just your Markdown file.

---

# A Quick Formula

nh-deck can render inline math like $E = mc^2$, and block equations too:

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
