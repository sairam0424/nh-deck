import type { Token, Tokens } from "marked";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import type { DirectionName } from "./directions.js";
import { extractFragments, isFragmentMarkerComment } from "./fragments.js";
import { escapeHtml } from "./htmlEscape.js";
import { getEmbeddedKatexCss } from "./katexAssets.js";
import { renderMermaidDiagram } from "./mermaidRenderer.js";
import { PRESENTATION_SCRIPT } from "./presentationScript.js";
import { extractNotes, isPresenterNoteComment } from "./presenterNotes.js";
import { extractSlideLayout, resolveLayoutName } from "./slideLayouts.js";
import type { ThemeColors } from "./themes.js";
import type { TransitionName } from "./transitions.js";

/**
 * Deliberately NOT `position: fixed` at the base -- the default
 * continuous-scroll view has no single "current slide" concept, so a
 * fixed bottom overlay would unhide and stack EVERY slide's note at the
 * identical screen position the moment `?notes` reveals them all at once
 * (a real shipped bug, verified via getComputedStyle() in
 * tests/render.test.ts's "presenter notes reveal" describe block, not a
 * hypothetical). A revealed note here stays in normal document flow
 * (`position: static`, the CSS default) as a bordered inline box
 * immediately after its own slide's content, since
 * `<aside class="notes">` is emitted inside that same slide's `<section>`
 * (see generateHtml below).
 *
 * `body.presenting .notes` below re-applies the fixed bottom-overlay
 * behavior, but scoped to real presentation mode, where
 * `body.presenting .slide.is-active` (PRESENTATION_STYLE) guarantees
 * exactly one slide -- and therefore at most one revealed note -- is ever
 * visible at a time.
 */
const NOTES_STYLE = `
    .notes {
      display: none;
      background: var(--nh-code-bg);
      border: 1px solid var(--nh-border);
      border-radius: 6px;
      color: var(--nh-fg);
      padding: 1rem 1.5rem;
      margin-top: 1.5rem;
    }
    .notes:not([hidden]) {
      display: block;
    }
    body.presenting .notes {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      margin-top: 0;
      border: none;
      border-top: 2px solid var(--nh-border);
      border-radius: 0;
      max-height: 30vh;
      overflow-y: auto;
    }
    @media print {
      .notes {
        display: none !important;
      }
    }`;

/**
 * Styling for the additional "notes page" `<div>` generateHtml emits once
 * per slide that has at least one presenter note, but only when called with
 * `withNotes: true` (see pdfExport.ts/pngExport.ts's `--with-notes` wiring
 * in index.ts). This is a source-adjacent SIBLING of that slide's own
 * `<section class="slide">` -- appended immediately after its closing tag,
 * never inside it and never an overlay on top of it -- so it can never
 * change how the slide itself renders.
 *
 * `.note`'s typography is lifted directly from NOTES_STYLE's own base
 * `.notes` rule above (background/border/border-radius/color/padding/
 * margin-top), MINUS that rule's `position: fixed` override (which only
 * ever applies under `body.presenting` -- irrelevant here, since export
 * never adds that class to `<body>`) and MINUS its
 * `@media print { .notes { display: none !important } }` rule -- the whole
 * point of this page is to appear in the exported PDF, so it must stay
 * visible under print, unlike the overlay note it borrows typography from.
 *
 * `break-after: page` on `.notes-page` under `@media print` is what turns
 * this div into its own additional PDF page, immediately following the
 * slide's own page -- entirely independent of PRINT_PAGINATION_STYLE's
 * `.slide { break-after: page }` rule below, since this div deliberately
 * never carries class="slide" itself. Reusing "slide" here would make this
 * div compete with the real slide `<section>` for CSS's `:last-of-type`
 * pseudo-class, which counts siblings by TAG NAME, not by class: a trailing
 * `<section class="slide notes-page">` would silently strip the REAL last
 * slide's own `.slide:last-of-type` margin/padding/border trim the moment
 * that slide had a note, changing that slide's own exported PNG's pixel
 * dimensions -- exactly the "existing slide output must stay byte-identical"
 * regression this design avoids by using a plain `<div>` instead (a `<div>`
 * is never counted alongside `<section>` siblings for `:last-of-type`
 * purposes, so the real slide's own last-of-type styling is untouched).
 */
const NOTES_PAGE_STYLE = `
    .notes-page {
      padding: 1rem 1.5rem;
    }
    .notes-page .note {
      background: var(--nh-code-bg);
      border: 1px solid var(--nh-border);
      border-radius: 6px;
      color: var(--nh-fg);
      padding: 1rem 1.5rem;
      margin-top: 1.5rem;
    }
    .notes-page .note:first-child {
      margin-top: 0;
    }
    @media print {
      .notes-page {
        break-after: page;
      }
    }`;

/**
 * `print-color-adjust: exact` (plus the `-webkit-` prefix Chromium/Safari
 * still need) stops a browser's print pipeline from silently substituting
 * background colors for something print-friendlier -- without it, a dark
 * theme's `--nh-bg` background is dropped entirely when a user prints this
 * raw `generateHtml()` output directly via the browser's own Ctrl+P dialog.
 * Scoped to the universal selector (not just `.slide`/`body`) since the
 * property does not inherit to descendants in every browser implementation,
 * and any element could carry a theme-derived background (code blocks,
 * blockquotes, mermaid diagram fills, ...). This is a separate code path
 * from pdfExport.ts's own `printBackground: true` Puppeteer option, which
 * only covers the CLI's own `pdf`/`png` export commands, not a raw
 * browser print of the rendered HTML.
 */
const PRINT_PAGINATION_STYLE = `
    @media print {
      .slide {
        break-after: page;
      }
      * {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
    }`;

const LAYOUT_STYLE = `
    .slide.layout-title {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 60vh;
      text-align: center;
    }
    /* Deliberately still "5vw", not "5cqw", despite .slide now being a size
       query container (see the base .slide rule below) -- swapping to the
       container-query-width unit was measured directly in a real browser
       (getComputedStyle) against the normal (non-overview) continuous-scroll
       view and it changes the rendered title font-size there too, e.g.
       40px -> 37.6px at an 800px viewport, 56px -> 43px at 1280px+ -- because
       .slide's own inline-size (the cqw basis) is capped by body's
       max-width: 860px well before the viewport is, so cqw and vw diverge
       even in the ordinary, non-shrunk case. That is a real regression to
       already-shipped normal-view sizing, not just an overview-mode fix, so
       it is out of scope here: this rule only needs to shrink correctly
       INSIDE a grid-overview thumbnail, and clamp()'s own 2.25rem/3.5rem
       floor/ceiling already keeps the title from overflowing there (the
       thumbnail simply clips/scrolls under OVERVIEW_STYLE's own
       max-height/overflow:hidden, same as any other slide content that
       doesn't fit). */
    .slide.layout-title h1 {
      font-size: clamp(2.25rem, 5vw, 3.5rem);
      border-bottom: none;
    }
    .slide.layout-title p:first-of-type {
      color: var(--nh-muted);
      font-size: 1.25rem;
    }
    .slide.layout-section {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 60vh;
      text-align: center;
    }
    .slide.layout-section h1,
    .slide.layout-section h2 {
      font-size: 2.5rem;
      border-bottom: none;
    }
    .slide.layout-section p,
    .slide.layout-section ul,
    .slide.layout-section ol {
      color: var(--nh-muted);
      font-size: 1rem;
    }
    /* column-count/column-gap live on the inner .two-column-flow wrapper
       (see generateHtml's wrappedContentHtml), not on .slide.layout-two-column
       itself -- a CSS size query container can never match a @container rule
       against ITSELF, only against a descendant (verified directly against
       real Chromium: an identical @container rule matches a child of the
       container but never the container element, even for a property with
       no possible effect on that element's own size). The base .slide rule
       below makes .slide the query container so grid-overview mode's shrunk
       thumbnail box can be queried at all; .two-column-flow is what the
       @container breakpoint actually restyles. */
    .two-column-flow {
      column-count: 2;
      column-gap: 2rem;
    }
    /* @container, not @media -- this must query the slide's OWN box, not the
       real browser viewport. Grid-overview mode (OVERVIEW_STYLE) shrinks a
       .slide down to a ~220-400px-wide thumbnail via CSS grid + transform:
       none !important, with no actual viewport resize at all -- a
       viewport-scoped @media rule here never fires in that case, even though
       the two-column layout visually needs to collapse to one column once
       squeezed that small. See tests/render.test.ts's "two-column layout
       container-query breakpoint" describe block for the real-browser
       regression coverage. */
    @container (max-width: 640px) {
      .two-column-flow { column-count: 1; }
    }
    .slide.layout-two-column h1,
    .slide.layout-two-column h2,
    .slide.layout-two-column h3 {
      break-after: avoid;
    }
    .slide.layout-two-column pre,
    .slide.layout-two-column table,
    .slide.layout-two-column img,
    .slide.layout-two-column svg {
      break-inside: avoid;
    }
    .slide.layout-quote {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 60vh;
      text-align: center;
    }
    .slide.layout-quote p {
      font-size: 1.75rem;
      font-style: italic;
    }
    .slide.layout-quote p:not(:only-of-type):last-of-type {
      font-size: 1rem;
      font-style: normal;
      color: var(--nh-muted);
    }
    /* Without this, presentation mode's own display:block toggle
       (PRESENTATION_STYLE, and transitionToCssBlock when a transition is
       active) wins the specificity fight against .slide.layout-title's
       plain display:flex, silently breaking vertical centering only
       inside ?present. Re-asserting display:flex here at higher
       specificity (0,4,1) beats both (0,3,1) and (0,2,1) regardless of
       source order. layout-two-column needs no such rule -- column-count
       works on a block container, so presentation mode's forced
       display:block never breaks it. */
    body.presenting .slide.is-active.layout-title,
    body.presenting .slide.is-active.layout-section,
    body.presenting .slide.is-active.layout-quote {
      display: flex;
    }`;

/**
 * The standard visually-hidden-but-still-announced-by-a-screen-reader
 * pattern, applied to `#nh-deck-live-region` (see generateHtml's `<body>`
 * below) and reusable for any future element that needs the same
 * treatment. Deliberately NOT `display: none` or `visibility: hidden` --
 * both of those remove an element from the accessibility tree entirely,
 * which would defeat the one purpose this element exists for (a screen
 * reader announcing text a sighted viewer never needs to see). Clipping the
 * element to a 1x1 box with `overflow: hidden` instead keeps it fully
 * present in the accessibility tree while occupying no visible space.
 *
 * Always included, unconditionally -- unlike LAYOUT_STYLE/transitionStyle/
 * progressStyle, this is not suppressible by a custom --css: the live
 * region itself is always emitted in `<body>` regardless of presentation
 * mode (see generateHtml below), so its own styling must never depend on
 * whether a custom --css replaced the rest of this `<style>` block.
 */
const SR_ONLY_STYLE = `
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
    }
    @media print {
      .sr-only {
        display: none;
      }
    }`;

const PRESENTATION_STYLE = `
    body.presenting .slide {
      display: none;
    }
    body.presenting .slide.is-active {
      display: block;
    }
    .presentation-counter {
      display: none;
    }
    body.presenting .presentation-counter {
      display: block;
      background: var(--nh-code-bg);
      color: var(--nh-muted);
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      font-size: 0.85rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }`;

/**
 * Grid "slide overview" mode -- the convention shared by reveal.js, Slidev,
 * Marp, and deckrun -- toggled by PRESENTATION_SCRIPT's Escape/"o" handling
 * via a `.overview` class added onto the same `<body>` element
 * `body.presenting` is scoped under. Every `.slide` becomes visible at once
 * (not just the `.is-active` one), laid out in a CSS grid of thumbnails, and
 * clickable to jump straight to that slide.
 *
 * Deliberately NOT gated behind `!customCss` the way LAYOUT_STYLE/
 * transitionStyle/progressStyle are -- like PRESENTATION_STYLE itself, this
 * defines a core interactive mechanic of presentation mode (an alternate way
 * to see and navigate slides), not a suppressible decorative flourish, so a
 * custom --css should not be able to silently break it.
 *
 * Every `.slide` override below uses `!important` rather than leaning on
 * selector specificity to beat PRESENTATION_STYLE's `body.presenting .slide`
 * toggle, transitionToCssBlock's per-transition `position: absolute`/
 * `transform`/`opacity` rules, and LAYOUT_STYLE's `min-height: 60vh` title/
 * section/quote centering -- all of which must be overridden regardless of
 * which transition (if any) is active or where in the stylesheet this block
 * ends up relative to them. This mirrors REDUCED_MOTION_STYLE's own
 * established use of `!important` above for the identical kind of problem
 * (overriding contextual presentation-mode state without a specificity
 * fight).
 */
const OVERVIEW_STYLE = `
    body.overview {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 1rem;
      max-width: none;
      padding: 2rem;
      align-content: start;
    }
    body.overview .presentation-counter,
    body.overview .presentation-progress {
      display: none !important;
    }
    body.overview .slide {
      display: block !important;
      position: static !important;
      inset: auto !important;
      transform: none !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      transition: none !important;
      min-height: 0 !important;
      max-height: 220px;
      overflow: hidden;
      margin: 0 !important;
      padding: 0.75rem;
      border: 1px solid var(--nh-border);
      border-radius: 6px;
      font-size: 0.55rem;
      cursor: pointer;
    }
    body.overview .slide.is-active {
      border-color: var(--nh-accent);
    }
    body.overview .notes {
      display: none !important;
    }`;

/**
 * Discoverability chrome for presentation mode's keyboard shortcuts: a
 * small, always-visible "? controls" hint button (`.presentation-help-hint`,
 * wrapped together with the pre-existing `.presentation-counter` in a new
 * `.presentation-chrome` flex row -- PRESENTATION_SCRIPT creates both inside
 * that shared wrapper -- so the two sit visibly next to each other instead of
 * the counter alone occupying that bottom-right corner) plus the full-screen
 * shortcut-list overlay (`.presentation-help`) that both the hint button and
 * PRESENTATION_SCRIPT's own "?" keydown handling open. This is the piece
 * that actually solves discoverability: a "?" keybinding alone (like "o" for
 * overview before it) is still a secret unless something on screen tells a
 * first-time viewer it exists.
 *
 * Deliberately NOT gated behind `!customCss`, for the same reason
 * OVERVIEW_STYLE above is not: this is core interactive presentation-mode
 * chrome (the discoverability mechanism itself), not a suppressible
 * decorative flourish, so a custom --css should not be able to silently
 * hide the one thing that tells a viewer these shortcuts even exist.
 *
 * `.presentation-help`'s `z-index: 1000` is what lets it always render above
 * every other piece of presentation-mode chrome -- the slide grid under
 * `body.overview`, the counter/hint row, the progress bar -- without an
 * `!important` fight: PRESENTATION_SCRIPT's own keydown-listener precedence
 * comment explains why `body.overview` and `body.help-open` can both be on
 * `<body>` at once (help can be opened via "?" or the hint button while the
 * grid overview is already open, stacking help on top of it) -- this
 * z-index is what makes that stacking actually render help on top, rather
 * than underneath the grid's own thumbnails.
 */
const HELP_STYLE = `
    .presentation-chrome {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      display: none;
    }
    body.presenting .presentation-chrome {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .presentation-help-hint {
      display: none;
    }
    body.presenting .presentation-help-hint {
      display: inline-flex;
      align-items: center;
      background: var(--nh-code-bg);
      color: var(--nh-muted);
      border: 1px solid var(--nh-border);
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      font-size: 0.85rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      cursor: pointer;
    }
    .presentation-help {
      display: none;
    }
    body.help-open .presentation-help {
      display: flex;
      position: fixed;
      inset: 0;
      z-index: 1000;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.6);
    }
    .presentation-help-panel {
      background: var(--nh-bg);
      color: var(--nh-fg);
      border: 1px solid var(--nh-border);
      border-radius: 8px;
      padding: 1.5rem 2rem;
      max-width: 28rem;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
    }
    .presentation-help-panel h2 {
      margin-top: 0;
      font-size: 1.1rem;
    }
    .presentation-help-panel dt {
      font-weight: 600;
      margin-top: 0.75rem;
    }
    .presentation-help-panel dt:first-child {
      margin-top: 0;
    }
    .presentation-help-panel dd {
      margin: 0.25rem 0 0;
      color: var(--nh-muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.9rem;
    }`;

/**
 * On-screen feedback for an in-progress "g"-then-digits-then-Enter slide
 * jump (see presentationScript.ts's own module docstring and its
 * startJump()/appendJumpDigit()/confirmJump()/cancelJump() functions) --
 * without this, "g" would silently swallow every digit keystroke with zero
 * on-screen trace, exactly the discoverability gap HELP_STYLE above already
 * exists to close for "?" itself: a hidden keybinding by itself only
 * relocates that problem rather than solving it.
 *
 * Styled like the pre-existing `.presentation-counter`/`.presenter-timer`
 * chrome (same code-bg background, monospace font, small padding/
 * border-radius) but positioned at the OPPOSITE corner (top-right, not
 * bottom-right): `.presentation-chrome`'s counter+hint row above already
 * occupies the bottom-right corner, and stacking a third, only-sometimes-
 * visible element into that same corner would either overlap it or force
 * yet another self-sizing layout wrapper for what is, in practice, a
 * briefly-shown transient state. The top-right corner is otherwise unused
 * in this (non-presenter-view) layout -- PRESENTER_VIEW_STYLE's own
 * `.presenter-timer` occupies the equivalent corner, but only ever under
 * `body.presenter-view`, a class this element is never shown under anyway
 * (see the hide-list at the top of PRESENTER_VIEW_STYLE below).
 *
 * Hidden by two independent conditions, exactly like `.presentation-counter`
 * above: the bare `.presentation-jump-indicator` rule hides it
 * unconditionally (so it vanishes the instant exitPresentationMode()
 * removes body.presenting, with no JS needed to hide it explicitly), and
 * even under body.presenting it additionally requires
 * presentationScript.ts's own `.is-active` class (toggled by
 * renderJumpIndicator() there) before it actually renders -- an ordinary
 * presenting session with no jump in progress must never show an empty box
 * in the corner.
 *
 * Deliberately NOT gated behind `!customCss`, for the same reason
 * HELP_STYLE/OVERVIEW_STYLE above are not: this is the discoverability
 * mechanism for a core interactive presentation-mode keybinding, not a
 * suppressible decorative flourish.
 */
const JUMP_INDICATOR_STYLE = `
    .presentation-jump-indicator {
      display: none;
    }
    body.presenting .presentation-jump-indicator.is-active {
      display: block;
      position: fixed;
      top: 1rem;
      right: 1rem;
      background: var(--nh-code-bg);
      color: var(--nh-fg);
      border: 1px solid var(--nh-border);
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      font-size: 0.85rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }`;

/**
 * The presenter-console layout for a genuinely separate presenter-view
 * window -- the SAME served document, opened at the SAME URL with one
 * added query flag (`&presenter`), rendering this layout instead of the
 * normal one-slide-fullscreen view. See presentationScript.ts's own module
 * docstring for the full URL/sync design; this constant is only the
 * layout's CSS half. Everything here is scoped under `body.presenter-view`
 * (added by presentationScript.ts only when the `presenter` flag is
 * present), so an ordinary presenting window is completely unaffected --
 * `.presenter-console`'s own base rule below is `display: none` unless
 * that class is present, same as `.presentation-progress`'s own
 * `display: none` base rule above.
 *
 * Deliberately NOT gated behind `!customCss`, for the same reason
 * PRESENTATION_STYLE/OVERVIEW_STYLE/HELP_STYLE above are not: this is core
 * interactive presentation-mode chrome (an entire alternate view, not a
 * suppressible decorative flourish), so a custom --css should not be able
 * to silently break it.
 *
 * `.presenter-preview .slide` reuses OVERVIEW_STYLE's own established
 * thumbnail-scaling technique above (neutralize position/transform/
 * opacity/transition via `!important` so no other presentation-mode rule
 * -- PRESENTATION_STYLE's plain display toggle, transitionToCssBlock's
 * per-transition absolute positioning, LAYOUT_STYLE's title/section/quote
 * flex centering -- can win the specificity fight, then shrink via a
 * smaller font-size) rather than a fresh `transform: scale(...)` -- same
 * proven mechanism, applied to exactly the ONE or TWO `.slide` elements
 * presentationScript.ts's updatePresenterConsole() moves into these boxes
 * (never all of them at once, unlike the grid overview). The wrapping
 * `.presenter-preview-current`/`-next` boxes -- not `.slide` itself, since
 * a `.slide` moved in here already has its own margin/padding/border
 * neutralized above -- carry the actual `max-height`/`overflow: hidden`
 * clipping, the same pairing OVERVIEW_STYLE's own `.slide` rule uses for
 * an identical purpose.
 *
 * `.presenter-preview .fragment` forces every fragment inside a preview
 * box fully visible, `!important`, mirroring FRAGMENT_STYLE's own
 * `body.overview .fragment` rule below for the exact same reason: a
 * presenter-view window is a genuinely SEPARATE document instance (its own
 * parse of the same served HTML, opened via window.open() -- not a live
 * reference to the main window's DOM), so its own copy of a fragment-
 * bearing slide never receives the main window's `.is-revealed` reveal
 * progress at all (only the CURRENT SLIDE INDEX is synced, over
 * BroadcastChannel -- see presentationScript.ts). Without this override, a
 * fragment-bearing slide's content would sit permanently at
 * FRAGMENT_STYLE's `body.presenting .fragment { opacity: 0; }` default
 * inside the preview boxes -- invisible forever, since nothing in a
 * presenter-view window ever reveals a fragment locally.
 *
 * `.presenter-preview .notes` is hidden, `!important` -- a `.notes`
 * element nested inside a slide moved into a preview box would otherwise
 * inherit NOTES_STYLE's own `body.presenting .notes` fixed bottom-overlay
 * positioning, which makes no sense pinned inside a small thumbnail box.
 * The dedicated `.presenter-notes-panel` below (populated by
 * updatePresenterConsole() from that same `.notes` content, via a plain
 * text copy) is what actually shows the current slide's notes here,
 * always visible, unlike the main view's own `?notes`-gated overlay.
 */
const PRESENTER_VIEW_STYLE = `
    body.presenter-view .presentation-chrome,
    body.presenter-view .presentation-progress,
    body.presenter-view .presentation-help,
    body.presenter-view .presentation-help-hint,
    body.presenter-view .presentation-jump-indicator {
      display: none !important;
    }
    body.presenter-view .slide {
      display: none !important;
    }
    .presenter-console {
      display: none;
    }
    body.presenter-view .presenter-console {
      display: grid;
      grid-template-columns: 2fr 1fr;
      grid-template-areas:
        "current next"
        "notes   next";
      gap: 1rem;
      box-sizing: border-box;
      min-height: 100vh;
      padding: 1.5rem;
      background: var(--nh-bg);
      color: var(--nh-fg);
    }
    .presenter-preview {
      border: 1px solid var(--nh-border);
      border-radius: 6px;
      background: var(--nh-bg);
      overflow: hidden;
    }
    .presenter-preview-current {
      grid-area: current;
      max-height: 60vh;
    }
    .presenter-preview-next {
      grid-area: next;
      max-height: 30vh;
    }
    .presenter-notes-panel {
      grid-area: notes;
      background: var(--nh-code-bg);
      color: var(--nh-fg);
      border: 1px solid var(--nh-border);
      border-radius: 6px;
      padding: 1rem;
      overflow-y: auto;
    }
    .presenter-note + .presenter-note {
      margin-top: 0.75rem;
    }
    .presenter-timer {
      position: fixed;
      top: 1rem;
      right: 1rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      background: var(--nh-code-bg);
      color: var(--nh-fg);
      border: 1px solid var(--nh-border);
      border-radius: 4px;
      padding: 0.25rem 0.6rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.9rem;
    }
    /* A <button>, not a <span> (see presentationScript.ts), for real
       keyboard operability -- these resets strip the browser's own default
       button chrome (background/border/padding/font) back to plain
       styled text so it reads identically to before this was a button. */
    .presenter-timer-display {
      background: none;
      border: none;
      padding: 0;
      margin: 0;
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    .presenter-timer.is-paused .presenter-timer-display {
      opacity: 0.55;
    }
    /* Fixed amber/red, not theme-derived: this project's theme palette
       (themes.ts) has no warning/danger semantic to reference, and a
       presenter needs "running late" to look the same regardless of which
       of the 4 themes is active -- matching pdfExport.ts's own hardcoded
       page-number-footer gray for the same "no theme-appropriate variable
       exists for this" reason. */
    .presenter-timer.is-near-target .presenter-timer-display {
      color: #d97706;
    }
    .presenter-timer.is-over-target .presenter-timer-display {
      color: #dc2626;
    }
    .presenter-timer-duration {
      width: 3.4rem;
      background: transparent;
      color: var(--nh-muted);
      border: 1px solid var(--nh-border);
      border-radius: 3px;
      font: inherit;
      font-size: 0.75rem;
      padding: 0.1rem 0.3rem;
      cursor: text;
    }
    body.presenter-view .presenter-preview .slide {
      display: block !important;
      position: static !important;
      inset: auto !important;
      transform: none !important;
      opacity: 1 !important;
      pointer-events: none !important;
      transition: none !important;
      min-height: 0 !important;
      margin: 0 !important;
      border: none !important;
      width: 100%;
      box-sizing: border-box;
    }
    body.presenter-view .presenter-preview-current .slide {
      padding: 1.5rem;
      font-size: 0.9rem;
    }
    body.presenter-view .presenter-preview-next .slide {
      padding: 1rem;
      font-size: 0.65rem;
    }
    body.presenter-view .presenter-preview .fragment {
      opacity: 1 !important;
      transition: none !important;
    }
    body.presenter-view .presenter-preview .notes {
      display: none !important;
    }`;

/**
 * Scoped under body.presenting the same way .presentation-counter is,
 * above -- but kept in its own constant rather than folded into
 * PRESENTATION_STYLE so it can be suppressed by a custom --css the same
 * way LAYOUT_STYLE/transitionToCssBlock's output already is (see
 * layoutOverride/transitionStyle in generateHtml below). PRESENTATION_STYLE
 * itself is deliberately NOT suppressible -- the slide show/hide toggle it
 * defines is load-bearing for presentation mode's entire visual mechanic --
 * but a decorative progress bar has no such requirement.
 */
const PRESENTATION_PROGRESS_STYLE = `
    .presentation-progress {
      display: none;
    }
    body.presenting .presentation-progress {
      display: block;
      position: fixed;
      bottom: 0;
      left: 0;
      height: 2px;
      background: var(--nh-accent);
      width: 0%;
      transition: width 0.2s ease;
    }`;

/**
 * Fragment (incremental bullet/element reveal) visibility rules --
 * unconditional and not suppressible by a custom --css, the same "core
 * interactive presentation-mode mechanic, not a decorative flourish"
 * treatment PRESENTATION_STYLE/OVERVIEW_STYLE already document for
 * themselves.
 *
 * `.fragment` is visible everywhere by default: the continuous-scroll
 * view, and both PDF/PNG export -- pdfExport.ts/pngExport.ts both load
 * generateHtml()'s own output directly and never append `?present`, so
 * this single rule is what keeps every fragment printed/screenshotted,
 * with zero export-specific code needed anywhere else. Only
 * `body.presenting` hides an unrevealed fragment; PRESENTATION_SCRIPT's
 * goTo()/advance()/retreat() toggle `.is-revealed` (and the matching
 * aria-hidden attribute) on each fragment in turn as navigation moves
 * through the active slide -- see that file's own fragment-state-machine
 * docstring.
 *
 * `body.overview` forces every fragment back to fully visible regardless
 * of reveal state (`!important`, matching OVERVIEW_STYLE's own
 * established use of it against exactly this "beat a contextual
 * presentation-mode rule with no specificity fight" problem) -- the grid
 * overview shows each slide's full content at a glance, not whatever
 * partial reveal state a viewer happened to leave it in. `transition:
 * none !important` alongside it is what makes that "at a glance" genuinely
 * instant rather than a 0.3s fade-in: `!important` on `opacity` alone only
 * wins WHICH value the property animates TOWARD, not whether it animates
 * at all -- `body.presenting .fragment`'s own `transition: opacity 0.3s
 * ease` still applies otherwise, exactly the same class of problem
 * OVERVIEW_STYLE's own `.slide` override already neutralizes the same way
 * (see that constant's own docstring).
 */
const FRAGMENT_STYLE = `
    .fragment {
      opacity: 1;
    }
    body.presenting .fragment {
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    body.presenting .fragment.is-revealed {
      opacity: 1;
    }
    body.overview .fragment {
      opacity: 1 !important;
      transition: none !important;
    }`;

/**
 * Included whenever motion could actually occur: a slide transition is
 * configured, and/or the deck has at least one fragment-marked element
 * (see hasFragments/reducedMotionStyle in generateHtml below) -- a user
 * with prefers-reduced-motion enabled gets a fast opacity-only crossfade
 * for BOTH the slide-transition swap and a fragment's reveal/conceal,
 * instead of either the full (slower) animation or motion being silently
 * left untouched. Deliberately substitutes a fast crossfade rather than
 * disabling the transition entirely (transition: none) for either case:
 * an instant, jarring slide swap or fragment pop-in is its own kind of
 * jolt, and a fast linear opacity fade is the pattern verified against a
 * real competitor's implementation of this same accessibility affordance.
 */
const REDUCED_MOTION_STYLE = `
    @media (prefers-reduced-motion: reduce) {
      .slide { transition: opacity 0.2s linear !important; transform: none !important; }
      .fragment { transition: opacity 0.2s linear !important; }
    }`;

/**
 * Overrides PRESENTATION_STYLE's plain display:none/block toggle with an
 * animatable version for the given transition: both the active and
 * inactive slide stay display:block (position:absolute, stacked), so
 * opacity/transform can transition smoothly between them. Suppressible
 * by --css, unlike PRESENTATION_STYLE itself -- see the plan's Global
 * Constraints for why the split is drawn there.
 *
 * The "slide" transition also carries a `body.presenting.direction-backward`
 * override: PRESENTATION_SCRIPT toggles that class onto <body> at the moment
 * of navigation (ArrowLeft, or ArrowRight's/click's absence of it), so a
 * backward navigation flips the translateX sign instead of replaying the
 * exact same left-to-right motion forward navigation uses.
 *
 * Does NOT append REDUCED_MOTION_STYLE itself (unlike before fragments
 * existed) -- generateHtml now computes that inclusion centrally
 * (reducedMotionStyle below), since a deck can need the reduced-motion
 * accommodation for `.fragment` even with no --transition configured at
 * all.
 */
function transitionToCssBlock(name: TransitionName): string {
	if (name === "fade") {
		return `
    body.presenting .slide {
      display: block;
      position: absolute;
      inset: 0;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    body.presenting .slide.is-active {
      opacity: 1;
      pointer-events: auto;
    }`;
	}
	return `
    body.presenting .slide {
      display: block;
      position: absolute;
      inset: 0;
      transform: translateX(100%);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.3s ease, opacity 0.3s ease;
    }
    body.presenting .slide.is-active {
      transform: translateX(0);
      opacity: 1;
      pointer-events: auto;
    }
    body.presenting.direction-backward .slide {
      transform: translateX(-100%);
    }
    body.presenting.direction-backward .slide.is-active {
      transform: translateX(0);
    }`;
}

// Percentage of --nh-fg blended into --nh-bg to derive --nh-code-bg and
// --nh-border independently of a theme's `line`/`muted` colors below.
// `line`/`muted` are tuned for mermaid diagram roles (edge/connector color,
// secondary diagram-label text) -- not for a UI element's background or
// border -- and for all 4 shipped themes, `muted` happens to be the exact
// hex beautiful-mermaid also uses for `line` (dracula) or is otherwise
// untuned for contrast against `bg`/`fg` in a UI context. That mismatch is
// what let --nh-code-bg collapse to the exact same hex as --nh-muted (the
// Nord theme, notably), and let --nh-border fall under WCAG's 3:1 minimum
// against --nh-bg for every shipped theme except dracula.
//
// Verified with the real WCAG 2.x contrast-ratio formula against all 4
// shipped themes' actual resolved colors (see the
// "theme code-bg/border WCAG contrast" describe block in
// tests/render.test.ts, which checks this live via getComputedStyle rather
// than by inspecting these hex constants):
//   - CODE_BG_FG_BLEND_PERCENT (10%) keeps --nh-fg vs --nh-code-bg contrast
//     >= 7.1:1 for every shipped theme (WCAG AA for normal text requires
//     >= 4.5:1) -- comfortable margin because a small blend toward --nh-fg
//     barely moves --nh-code-bg away from --nh-bg, and --nh-fg already has
//     high contrast against --nh-bg in all 4 shipped themes.
//   - BORDER_FG_BLEND_PERCENT (55%) keeps --nh-border vs --nh-bg contrast
//     >= 3.6:1 for every shipped theme (WCAG's 3:1 non-text/UI-boundary
//     minimum). This needs to be a much larger blend than
//     CODE_BG_FG_BLEND_PERCENT because sRGB's gamma curve makes contrast
//     rise slowly near white: the light theme (white --nh-bg) needs >=
//     ~48% blended in before it clears 3:1 at all.
const CODE_BG_FG_BLEND_PERCENT = 10;
const BORDER_FG_BLEND_PERCENT = 55;

/**
 * Splits a "#rrggbb" string into its three 0-255 channel values.
 */
function hexToRgbChannels(hex: string): [number, number, number] {
	const normalized = hex.replace("#", "");
	return [
		Number.parseInt(normalized.slice(0, 2), 16),
		Number.parseInt(normalized.slice(2, 4), 16),
		Number.parseInt(normalized.slice(4, 6), 16),
	];
}

/**
 * Blends `toColor` into `fromColor` by `weightPercent` (0-100), interpolating
 * each RGB channel linearly in gamma-encoded sRGB space -- the same
 * approach CSS's `color-mix(in srgb, ...)` uses, and the one
 * beautiful-mermaid's own theme system already uses internally for its
 * derived diagram colors (see its `MIX`-weighted `color-mix()` rules in
 * node_modules/beautiful-mermaid/src/theme.ts). Implemented here as a
 * plain hex computation -- rather than emitting a `color-mix()` CSS
 * function -- so nh-deck's `--nh-*` variables keep resolving to concrete
 * hex values, as every other theme variable already does.
 *
 * Assumes both inputs are "#rrggbb" hex strings, which holds for every
 * ThemeColors value in practice (themes.ts re-exports beautiful-mermaid's
 * own hex palettes; see themes.ts's docstring).
 */
function blendHexColors(
	fromColor: string,
	toColor: string,
	weightPercent: number,
): string {
	const from = hexToRgbChannels(fromColor);
	const to = hexToRgbChannels(toColor);
	const weight = weightPercent / 100;
	const toHexByte = (channel: number) =>
		Math.round(channel).toString(16).padStart(2, "0");
	return `#${from.map((channel, i) => toHexByte(channel + (to[i] - channel) * weight)).join("")}`;
}

/**
 * Maps a theme's {bg, fg, line, accent, muted} onto nh-deck's own CSS
 * custom-property names, with fallback chains for themes that omit some
 * fields (all 4 shipped themes define every field today, but the registry
 * in themes.ts is designed to allow a future theme with fewer fields --
 * see docs/specs/theme-system-design.md §7).
 */
function themeToCssVarBlock(colors: ThemeColors): string {
	const muted = colors.muted ?? colors.line ?? colors.fg;
	// --nh-border and --nh-code-bg are UI-chrome roles (a UI-boundary line,
	// a code block's own background) -- deliberately derived straight from
	// bg/fg rather than from muted/line (diagram-label/edge-connector
	// colors), see CODE_BG_FG_BLEND_PERCENT/BORDER_FG_BLEND_PERCENT above.
	const codeBg = blendHexColors(colors.bg, colors.fg, CODE_BG_FG_BLEND_PERCENT);
	const border = blendHexColors(colors.bg, colors.fg, BORDER_FG_BLEND_PERCENT);
	const accent = colors.accent ?? colors.fg;
	return `
    :root {
      --nh-bg: ${colors.bg};
      --nh-fg: ${colors.fg};
      --nh-border: ${border};
      --nh-muted: ${muted};
      --nh-code-bg: ${codeBg};
      --nh-accent: ${accent};
    }`;
}

marked.use(markedKatex({ throwOnError: false }));

// Set at the top of generateHtml (below) and read inside the code()
// renderer override's mermaid branch. Safe despite being module-level
// mutable state: generateHtml is fully synchronous end to end (no
// `await` anywhere in its call chain), and marked.use() registers this
// renderer once at module load -- it has no other way to receive
// per-call data, since it isn't invoked as part of a per-call closure.
// Node's single-threaded execution model guarantees no other
// generateHtml() call can interleave and observe a stale value here.
let currentMermaidColors: ThemeColors | undefined;

// Reset alongside currentMermaidColors at the top of each generateHtml()
// call (same module-level-state reasoning as the comment above) and
// incremented once per mermaid code block, so renderMermaidDiagram can give
// each diagram's SVG ids a unique prefix -- without this, two diagrams in
// the same document both emit id="arrowhead", which is invalid HTML/SVG and
// lets one diagram's marker definitions leak into another's.
let mermaidDiagramCounter = 0;

/**
 * Composes `class="fragment"` into `html`'s outermost opening tag,
 * appending it to (never replacing) any class attribute that tag already
 * carries -- Mermaid's own error path emits `<pre class="mermaid-error">`,
 * so a fragment-marked failed diagram must keep BOTH classes, not lose
 * "mermaid-error" -- rather than special-casing that one shape, this
 * inspects the actual rendered tag generically (verified empirically
 * against renderMermaidDiagram's real output: neither its `<svg ...>`
 * success path nor its `<pre class="mermaid-error">` error path ever puts
 * a bare `>` character inside an attribute value before the tag's own
 * closing `>`, so a simple "first tag" match is safe here). Used by every
 * fragment-aware renderer override below (code/paragraph/listitem/
 * blockquote) so the class-composition logic lives in exactly one place.
 */
function withFragmentClass(html: string): string {
	const tagMatch = html.match(/^<([a-zA-Z][\w-]*)((?:\s+[^<>]*)?)>/);
	if (!tagMatch) {
		return html;
	}
	const [fullMatch, tagName, attrs] = tagMatch;
	const classMatch = attrs.match(/\sclass="([^"]*)"/);
	const newAttrs = classMatch
		? attrs.replace(classMatch[0], ` class="${classMatch[1]} fragment"`)
		: `${attrs} class="fragment"`;
	return `<${tagName}${newAttrs}>${html.slice(fullMatch.length)}`;
}

marked.use({
	renderer: {
		code({
			text,
			lang,
			escaped,
			fragment,
		}: Tokens.Code & { fragment?: boolean }): string {
			const langString = (lang ?? "").match(/^\S*/)?.[0];

			if (langString === "mermaid") {
				const svg = renderMermaidDiagram(
					text,
					currentMermaidColors,
					mermaidDiagramCounter++,
				);
				return fragment ? withFragmentClass(svg) : svg;
			}

			// Everything below exactly replicates marked@13.0.3's own default
			// code() renderer (verified directly against its source) for every
			// language other than "mermaid" -- this override must not change how
			// any other fenced code block renders, aside from composing in
			// class="fragment" on <pre> when this block is fragment-marked.
			const code = `${text.replace(/\n$/, "")}\n`;
			const html = !langString
				? `<pre><code>${escaped ? code : escapeHtml(code)}</code></pre>\n`
				: `<pre><code class="language-${escapeHtml(langString)}">${escaped ? code : escapeHtml(code)}</code></pre>\n`;
			return fragment ? withFragmentClass(html) : html;
		},
		paragraph({
			tokens,
			fragment,
		}: Tokens.Paragraph & { fragment?: boolean }): string {
			// Exactly replicates marked@13.0.3's own default paragraph()
			// renderer, aside from composing in class="fragment" when this
			// paragraph is fragment-marked (see fragments.ts's extractFragments).
			const html = `<p>${this.parser.parseInline(tokens)}</p>\n`;
			return fragment ? withFragmentClass(html) : html;
		},
		listitem(item: Tokens.ListItem & { fragment?: boolean }): string {
			// Exactly replicates marked@13.0.3's own default listitem()
			// renderer -- task-list checkboxes render via item.tokens containing
			// a "checkbox"-type token that this.parser.parse dispatches to the
			// (untouched) default checkbox() renderer, so nothing extra is
			// needed here for that case.
			const html = `<li>${this.parser.parse(item.tokens)}</li>\n`;
			return item.fragment ? withFragmentClass(html) : html;
		},
		blockquote({
			tokens,
			fragment,
		}: Tokens.Blockquote & { fragment?: boolean }): string {
			// Exactly replicates marked@13.0.3's own default blockquote()
			// renderer, aside from composing in class="fragment" when this
			// blockquote is fragment-marked.
			const html = `<blockquote>\n${this.parser.parse(tokens)}</blockquote>\n`;
			return fragment ? withFragmentClass(html) : html;
		},
	},
});

/**
 * Converts Markdown source into a complete, self-contained HTML document,
 * split into `<section class="slide">` blocks on each top-level `---`
 * thematic break.
 *
 * Slide-boundary detection is delegated entirely to marked's own tokenizer
 * (see splitIntoSlides below) rather than a hand-rolled regex over the raw
 * Markdown string, because CommonMark's own grammar is ambiguous here: a
 * `---` immediately after a paragraph line (no blank line) is a setext H2
 * heading underline, not a thematic break, and a `---` inside a fenced code
 * block is never a break at all. marked's tokenizer already resolves both
 * cases correctly (verified directly against its lexer output) — see
 * docs/adr/0002-per-slide-segmentation.md for the full comparison against
 * a regex-based alternative.
 *
 * Local-first constraint: the returned document must never reference any
 * external CDN (no <script src="https://...">, no <link href="https://...">).
 * Everything needed to render correctly is inlined.
 *
 * KaTeX math (inline `$...$` and block `$$...$$`) renders via
 * `marked-katex-extension`, which hooks into `marked`'s own tokenizer
 * extension API -- so `$` inside inline code or a fenced code block is
 * never mistaken for math (marked's own code tokenization runs first).
 * Invalid LaTeX degrades to a visible `class="katex-error"` span instead of
 * throwing (`throwOnError: false`).
 *
 * Mermaid (diagrams) rendering is wired up via a marked renderer override on
 * the `code` token (see the `marked.use({ renderer: { code ... } })` call
 * above) -- `mermaid` fenced code blocks render as CDN-free SVG diagrams via
 * `renderMermaidDiagram`, while every other language renders exactly as
 * marked's own default code renderer would.
 *
 * `cssVars`, when given (and `customCss` is not), is a small raw CSS
 * snippet -- typically a single `:root { --nh-accent: #...; }`-shaped block
 * overriding a subset of the 6 `--nh-*` custom properties -- concatenated
 * verbatim immediately after `themeOverride` and before the baseline `body
 * { ... }` rule. This is the exact same "later `:root` block at equal
 * specificity wins" mechanism `themeOverride` itself already uses to sit on
 * top of the baseline/dark-mode `:root` blocks (see docs/adr/0008's
 * "Baseline stylesheet refactor mechanism" decision) -- `cssVars` is not a
 * new cascade concept, just one more block placed later in the same
 * `:root`-block chain, so it composes with an active theme rather than
 * replacing it. See docs/specs/css-vars-override-design.md for why this is
 * a distinct, narrower mechanism than `customCss` (which replaces this
 * entire `<style>` block wholesale) rather than a reopening of
 * docs/specs/theme-system-design.md §2's "no CSS-cascade-layering
 * complexity" decision for `--css` itself.
 *
 * `withNotes`, when true, additionally emits a `<div class="notes-page">`
 * sibling immediately after any slide's own `<section>` that has at least
 * one presenter note (see NOTES_PAGE_STYLE's own docstring for the full
 * mechanism and why it is a `<div>`, never a `<section class="slide">`).
 * A slide with no note gets no such sibling. Defaults to false, matching
 * this project's own explicit-opt-in precedent for anything notes-related
 * (`?notes` is opt-in on `render` too) -- pdfExport.ts/pngExport.ts's
 * `--with-notes` CLI flag is the only caller that ever passes true.
 *
 * `direction`, when it resolves to "rtl", adds a `dir="rtl"` attribute to
 * `<html>` (alongside `lang`, the only other document-level attribute this
 * function already emits) for a deck's own authored content -- opt-in via a
 * deck's "dir:" frontmatter key or a --dir flag, mirroring --theme/
 * --transition's own opt-in precedent (see directions.ts and index.ts's
 * computeEffectiveDirection). Omitted entirely for "ltr" (the default) or
 * `undefined`, so a deck with neither key nor flag renders byte-identical
 * to before this parameter existed -- unlike themeColors/transitionName,
 * this is never suppressed by a custom --css: it is HTML structure, not a
 * `<style>` block --css replaces, so there is nothing for --css to conflict
 * with. Deliberately scoped to text direction only: this does not change
 * ArrowLeft/ArrowRight's navigation semantics or reposition any
 * presentation-mode chrome, and Mermaid diagrams stay LTR-oriented
 * regardless (see directions.ts's own docstring).
 */
export function generateHtml(
	markdown: string,
	title?: string,
	customCss?: string,
	themeColors?: ThemeColors,
	transitionName?: TransitionName,
	cssVars?: string,
	withNotes = false,
	direction?: DirectionName,
): string {
	currentMermaidColors = themeColors;
	mermaidDiagramCounter = 0;
	const tokens = marked.lexer(markdown);
	let hasFragments = false;
	const slidesHtml = splitIntoSlides(tokens)
		.map((slideTokens, slideIndex) => {
			const { layout, tokens: afterLayout } = extractSlideLayout(slideTokens);
			const { name: layoutName } = resolveLayoutName(layout);
			const layoutClass = layoutName ? ` layout-${layoutName}` : "";
			const { tokens: filteredTokens, hasFragment } =
				extractFragments(afterLayout);
			if (hasFragment) {
				hasFragments = true;
			}
			const notes = extractNotes(filteredTokens);
			const notesHtml = notes
				.map(
					(note) => `<aside class="notes" hidden>${escapeHtml(note)}</aside>`,
				)
				.join("\n");
			// See NOTES_PAGE_STYLE's own docstring for why this is a plain
			// `<div>` (never `<section class="slide">`) -- appended as a SIBLING
			// after the slide's own closing `</section>` below, never inside it,
			// so the slide's own markup byte-for-byte is completely unaffected
			// by whether `withNotes` is true or a slide has notes at all.
			const notesPageHtml =
				withNotes && notes.length > 0
					? `\n<div class="notes-page" data-notes-for="${slideIndex + 1}">\n${notes
							.map((note) => `<div class="note">${escapeHtml(note)}</div>`)
							.join("\n")}\n</div>`
					: "";
			const contentHtml = marked.parser(filteredTokens);
			// Two-column layout wraps its content in its own inner element rather
			// than putting `column-count` directly on `<section class="slide
			// layout-two-column">` -- CSS container queries cannot query a size
			// container against itself (verified directly against real Chromium:
			// an identical @container rule matches a DESCENDANT of the container
			// but never the container element itself, even for a property with no
			// possible effect on that element's own size). LAYOUT_STYLE's base
			// `.slide` rule makes `.slide` the query container so grid-overview
			// mode's shrunk thumbnail box can be queried at all; `column-count`
			// therefore has to live one level down, on `.two-column-flow`, so the
			// `@container (max-width: 640px)` breakpoint that collapses it has a
			// container ancestor (`.slide`) that is a different element than the
			// one it restyles.
			const wrappedContentHtml =
				layoutName === "two-column"
					? `<div class="two-column-flow">\n${contentHtml}</div>\n`
					: contentHtml;
			return `<section class="slide${layoutClass}">\n${wrappedContentHtml}${notesHtml}</section>${notesPageHtml}`;
		})
		.join("\n");
	const pageTitle = escapeHtml(
		title && title.trim().length > 0 ? title : "nh-deck",
	);
	// Only pay the ~360KB embedded-font cost when the deck actually uses
	// math -- checked against the rendered output itself (KaTeX always
	// wraps its markup in class="katex"), not against the raw source, so a
	// deck with zero math incurs zero size cost.
	const katexStyle = slidesHtml.includes('class="katex"')
		? getEmbeddedKatexCss()
		: "";
	const themeOverride =
		!customCss && themeColors ? themeToCssVarBlock(themeColors) : "";
	// Gated the same way themeOverride/layoutOverride/transitionStyle/
	// progressStyle already are: a full --css replacement (customCss) makes a
	// small vars overlay meaningless on top of it, since customCss becomes the
	// entire <style> block's content below, not a layer within it. index.ts's
	// own computeEffectiveCssVars already enforces this same mutual exclusion
	// one level up (with a stderr note) before ever calling generateHtml, but
	// this repeats the check here too -- the same defense-in-depth every other
	// customCss-gated override in this function already has, and what lets a
	// caller (e.g. a direct unit test) pass both arguments together safely.
	// cssVars is interpolated verbatim into the document's <style> element
	// below -- a value containing a closing </style> delimiter would
	// terminate that element early and let the remainder parse as document
	// markup instead of CSS. Unlike KaTeX/Mermaid's per-formula/per-diagram
	// graceful degradation (a single slide's content, isolated from the
	// rest of the render), this affects the whole document's structure, so
	// there is no small, isolated place to degrade into -- throwing here
	// and letting the CLI's existing top-level error handling surface a
	// clean message is the right failure mode, the same way a file-read
	// error already propagates as a thrown Error rather than being
	// silently swallowed.
	if (cssVars?.match(/<\/style/i)) {
		throw new Error(
			"--css-vars file must not contain a closing </style> tag (it is inserted directly into the document's own <style> element).",
		);
	}
	const cssVarsOverride = !customCss && cssVars ? cssVars : "";
	const layoutOverride = !customCss ? LAYOUT_STYLE : "";
	const transitionStyle =
		!customCss && transitionName ? transitionToCssBlock(transitionName) : "";
	const progressStyle = !customCss ? PRESENTATION_PROGRESS_STYLE : "";
	// See REDUCED_MOTION_STYLE's own docstring: included whenever a slide
	// transition is configured (covering .slide's own reduced-motion rule,
	// exactly as before fragments existed) OR this deck has at least one
	// fragment (covering .fragment's rule even with no --transition set at
	// all) -- but never both at once double-included, since transitionStyle
	// and reducedMotionStyle are two separate template slots below.
	const reducedMotionStyle =
		!customCss && (Boolean(transitionName) || hasFragments)
			? REDUCED_MOTION_STYLE
			: "";
	// Omitted entirely for "ltr"/undefined -- see generateHtml's own docstring
	// for why this (unlike themeOverride/layoutOverride/transitionStyle) is
	// never gated by customCss.
	const dirAttribute = direction === "rtl" ? ' dir="rtl"' : "";

	return `<!DOCTYPE html>
<html lang="en"${dirAttribute}>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle}</title>
  <style>
${
	customCss ??
	`    :root {
      color-scheme: light dark;
      --nh-bg: #ffffff;
      --nh-fg: #1a1a1a;
      --nh-border: #e0e0e0;
      --nh-muted: #555555;
      --nh-code-bg: #f2f2f2;
      --nh-accent: #0b5fff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --nh-bg: #121212;
        --nh-fg: #e6e6e6;
        --nh-border: #333333;
        --nh-muted: #b0b0b0;
        --nh-code-bg: #1e1e1e;
        --nh-accent: #6ea8ff;
      }
    }
    ${themeOverride}
    ${cssVarsOverride}
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
      line-height: 1.6;
      max-width: 860px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
      color: var(--nh-fg);
      background: var(--nh-bg);
    }
    h1, h2, h3, h4, h5, h6 {
      line-height: 1.25;
      margin-top: 2rem;
      margin-bottom: 0.75rem;
    }
    h1 { font-size: 2rem; border-bottom: 1px solid var(--nh-border); padding-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; }
    p { margin: 0.75rem 0; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: var(--nh-code-bg);
      color: var(--nh-fg);
      padding: 0.15em 0.35em;
      border-radius: 4px;
      font-size: 0.9em;
    }
    pre {
      background: var(--nh-code-bg);
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
    }
    blockquote {
      /* Logical property, not border-left -- resolves to the correct
         physical side (right, under a right-to-left ancestor) automatically,
         with no direction-conditional selector needed at all. See
         tests/render.test.ts's "text direction (opt-in RTL)" describe block
         for the real-browser proof this actually flips sides, not just the
         property name. */
      border-inline-start: 4px solid var(--nh-border);
      margin: 1rem 0;
      padding: 0.25rem 1rem;
      color: var(--nh-muted);
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
    }
    th, td {
      border: 1px solid var(--nh-border);
      padding: 0.5rem 0.75rem;
      /* Logical value, not a hardcoded physical side -- see blockquote's
         own comment above for why this needs no direction-conditional
         selector either. */
      text-align: start;
    }
    img {
      max-width: 100%;
    }
    a {
      color: var(--nh-accent);
    }
    .katex {
      color: var(--nh-fg);
      /* Best-effort math isolation, not a full fix: KaTeX's own output is
         built assuming LTR layout, and mirroring it under a right-to-left
         document is a real, ~10-year-old unresolved upstream limitation
         (KaTeX/MathJax both still have open issues on RTL math layout at
         time of writing). Forcing the formula's own internal layout to
         stay LTR regardless of the surrounding document's direction avoids
         the worse outcome (a mirrored, visually-broken formula) but does
         not make KaTeX itself RTL-aware -- this is a documented,
         known-imperfect workaround. */
      direction: ltr;
    }
    .slide {
      /* Makes .slide a CSS size query container along its inline axis, so
         LAYOUT_STYLE's .two-column-flow breakpoint can use
         @container (max-width: ...) to query the SLIDE'S OWN box instead
         of the real browser viewport -- see that rule's own comment in
         LAYOUT_STYLE for why this matters for grid-overview mode. */
      container-type: inline-size;
      margin-bottom: 3rem;
      padding-bottom: 2rem;
      border-bottom: 1px solid var(--nh-border);
    }
    .slide:last-of-type {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: none;
    }`
}
    ${katexStyle}
    ${NOTES_STYLE}
    ${NOTES_PAGE_STYLE}
    ${PRINT_PAGINATION_STYLE}
    ${SR_ONLY_STYLE}
    ${PRESENTATION_STYLE}
    ${OVERVIEW_STYLE}
    ${HELP_STYLE}
    ${JUMP_INDICATOR_STYLE}
    ${PRESENTER_VIEW_STYLE}
    ${progressStyle}
    ${FRAGMENT_STYLE}
    ${reducedMotionStyle}
    ${layoutOverride}
    ${transitionStyle}
  </style>
</head>
<body>
${slidesHtml}
  <div id="nh-deck-live-region" class="sr-only" aria-live="polite" aria-atomic="true"></div>
  <script>
    if (new URLSearchParams(location.search).has("notes")) {
      document.querySelectorAll(".notes").forEach((el) => {
        el.hidden = false;
      });
    }
  </script>
  ${PRESENTATION_SCRIPT}
</body>
</html>
`;
}

/**
 * Returns true if `markdown` contains any raw-HTML content -- an "html"-type
 * token anywhere in marked's token tree, block-level or inline, nested
 * inside a paragraph/heading/list/table cell or not -- that is NOT a
 * presenter-note comment (see presenterNotes.ts's isPresenterNoteComment).
 *
 * A deck that only contains presenter-note comments is expected,
 * already-reviewed content (see presenterNotes.ts) and must never trip
 * this check; only genuine other raw HTML (a real tag like `<script>`,
 * `<iframe>`, `<img onerror=...>`, or any HTML comment that isn't a
 * standalone presenter note) should. See src/index.ts for where this feeds
 * a one-time, non-fatal stderr warning.
 */
export function containsUnsafeHtml(markdown: string): boolean {
	return tokenTreeContainsUnsafeHtml(marked.lexer(markdown));
}

/**
 * Walks the entire token tree generically (any array is walked
 * element-by-element, any object is walked property-by-property) rather
 * than hand-enumerating marked's per-token-type nested fields (Paragraph's
 * `.tokens`, List's `.items`, Table's `.header`/`.rows`, etc.) -- this stays
 * correct even if marked adds a new nested-token shape later, since it never
 * has to be told where nested tokens live.
 *
 * A `<!-- fragment -->` marker already matches isPresenterNoteComment's own
 * generic "shaped like `<!-- ... -->`" pattern (so it was never actually
 * flagged here even before extractFragments existed) -- isFragmentMarkerComment
 * is checked explicitly anyway, so this allowlist stays correct on its own
 * terms even if isPresenterNoteComment's pattern is ever tightened to be
 * note-specific rather than comment-shaped-in-general.
 */
function tokenTreeContainsUnsafeHtml(node: unknown): boolean {
	if (Array.isArray(node)) {
		return node.some(tokenTreeContainsUnsafeHtml);
	}
	if (node === null || typeof node !== "object") {
		return false;
	}
	const token = node as Record<string, unknown>;
	if (
		token.type === "html" &&
		typeof token.text === "string" &&
		!isPresenterNoteComment(token.text) &&
		!isFragmentMarkerComment(token.text)
	) {
		return true;
	}
	return Object.values(token).some(tokenTreeContainsUnsafeHtml);
}

/**
 * Groups a top-level token stream into one array per slide, dividing at
 * each "hr" token (marked's tokenizer output for a `---` thematic break).
 * Two consecutive "hr" tokens — or a leading/trailing one — produce an
 * empty group; those are filtered out rather than rendered as a blank
 * slide. A stream with no "hr" tokens at all produces exactly one group
 * (the required backward-compatibility case for a deck with no delimiter).
 *
 * If every group turns out empty (or whitespace-only), the general filter
 * below would discard all of them and return zero slides — a silent blank
 * page with no error. This happens not only for an empty/whitespace-only
 * deck with no "hr" token (`marked.lexer("")` -> `[]`,
 * `marked.lexer("   \n\n   ")` -> a single "space" token, so `groups` has
 * exactly one, already-empty entry), but also for a deck consisting solely
 * of one or more `---` delimiters plus whitespace (e.g. "---", or
 * "---\n\n---"): every "hr" token pushes an additional empty group, so
 * `groups` ends up with two or more empty entries instead of one. Rescuing
 * only when `groups.length === 1` catches the former case but misses the
 * latter, so the rescue fires whenever *every* group is empty, regardless
 * of how many "hr"-caused splits produced them — and collapses back down to
 * exactly one (empty) group, preserving the "never render zero sections"
 * invariant without rendering a pile of redundant blank slides for a
 * document that has no visible content anywhere.
 */
function splitIntoSlides(tokens: Token[]): Token[][] {
	const groups: Token[][] = [];
	let current: Token[] = [];
	for (const token of tokens) {
		if (token.type === "hr") {
			groups.push(current);
			current = [];
		} else {
			current.push(token);
		}
	}
	groups.push(current);

	const nonEmptyGroups = groups.filter((group) =>
		group.some((token) => token.type !== "space"),
	);
	if (nonEmptyGroups.length === 0) {
		return [groups[0]];
	}
	return nonEmptyGroups;
}
