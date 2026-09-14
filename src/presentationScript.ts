/**
 * Client-side navigation for nh-deck's opt-in presentation mode. Kept in
 * its own module (rather than inline in render.ts, like the smaller
 * ?notes toggle script) because this script is real, multi-part logic
 * (hash parsing, keyboard/click handling, a slide counter) that deserves
 * its own review surface -- see docs/specs/templates-transitions-design.md
 * §3.3.
 *
 * Entirely inert unless `?present` is in the URL -- the continuous-scroll
 * default view is completely unaffected, matching the existing `?notes`
 * toggle's own opt-in-via-URL precedent.
 *
 * goTo() also toggles a `direction-backward` class on <body> to record
 * which way navigation just moved (ArrowLeft, and the Home jump, count as
 * backward; ArrowRight, Space, the End jump, and click all move forward) --
 * render.ts's "slide" transition CSS reads that class to flip translateX's
 * sign, so backward navigation visually reverses instead of replaying
 * forward's exact same motion.
 *
 * Escape exits presentation mode entirely (see exitPresentationMode()
 * below), back to the normal continuous-scroll document view, without a
 * full page reload.
 *
 * "o" also toggles a slide-overview ("grid view") mode -- the convention
 * shared by reveal.js, Slidev, Marp, and deckrun -- which adds an
 * `.overview` class to <body> (render.ts's CSS shows every `.slide` at once,
 * scaled down into a grid, under that class) and closes again on a second
 * "o", Escape, or a thumbnail click.
 *
 * Escape's role is deliberately NOT a symmetric toggle with "o": Escape only
 * ever CLOSES the overview when it's open (returning to the slide active
 * before it opened, via closeOverviewToPreviousSlide() below) -- it never
 * OPENS the overview. This preserves exitPresentationMode()'s pre-existing,
 * already-shipped behavior unmodified: a bare Escape press from normal
 * presentation mode (overview not open) still exits presentation mode
 * directly, in one keypress, exactly as before this feature existed. A
 * single Escape keypress therefore only ever does ONE of "close overview" or
 * "exit presentation mode", never both.
 *
 * Touch swipes (touchstart/touchend, plain DOM Touch events -- no gesture
 * library) also navigate: a swipe left (finger moves right-to-left) advances
 * like ArrowRight, a swipe right goes back like ArrowLeft. A horizontal
 * delta must clear both a minimum-distance threshold and a "more horizontal
 * than vertical" check before it counts as a swipe, so ordinary vertical
 * scrolling is never hijacked -- see the touchend listener below.
 *
 * "?" opens a full-screen keyboard-shortcuts help overlay (`.presentation-help`,
 * shown/hidden via a `.help-open` class on <body> -- the same class-toggle
 * pattern "o"'s `.overview` class above already uses), and closes it again on
 * a second "?" or Escape. A hidden keybinding by itself only relocates the
 * discoverability problem rather than solving it, so an always-visible
 * "? controls" hint button (created alongside the slide counter, wrapped
 * together in the `.presentation-chrome` row render.ts's HELP_STYLE
 * positions) opens the exact same overlay on click -- see
 * openHelp()/closeHelp() below. Help composes with the grid overview the
 * same "check the innermost open thing first" way overview composes with
 * exitPresentationMode: help can be opened ON TOP of an already-open
 * overview (openHelp()/closeHelp() never touch overviewOpen), so the
 * keydown listener's Escape/"?" branches both check helpOpen BEFORE
 * overviewOpen -- see that listener's own precedence comment for the full
 * reasoning.
 *
 * Fragment (incremental bullet/element reveal, render.ts's `.fragment`
 * class -- see fragments.ts for the authoring-side marker extraction)
 * reveal/conceal is a state machine layered directly on top of forward/
 * backward navigation, not a separate keybinding: advance()/retreat()
 * (used by ArrowRight/Space/click/swipe-left and ArrowLeft/swipe-right
 * respectively, in place of calling goTo() directly) each check the
 * CURRENT slide's own fragments FIRST -- advance() reveals the next
 * not-yet-revealed fragment (if any remain) and stops there; retreat()
 * conceals the last-revealed one (if any) and stops there. Only once a
 * slide has no more fragments left to reveal (advance) or conceal
 * (retreat) does either function fall through to goTo(), exactly as
 * before this feature existed -- a deck with zero fragments on a slide
 * therefore behaves completely unchanged (revealNextFragment/
 * concealLastFragment immediately return false, every time).
 *
 * goTo() itself resets the LANDING slide's fragments whenever the slide
 * index actually changes (never when index === current, e.g.
 * closeOverviewToPreviousSlide() returning to the same slide overview
 * opened on): entering forward (isBackward false -- ArrowRight/Space/
 * click/swipe-left's fall-through, and End's direct jump) resets that
 * slide's fragments to all-concealed (reveal-count 0); entering backward
 * (isBackward true -- ArrowLeft/swipe-right's fall-through, and Home's
 * direct jump) sets every one of that slide's fragments to already-
 * revealed. This is what makes "leave a slide as you found it" hold: a
 * slide re-entered via ArrowLeft from the slide after it shows its full
 * content immediately, matching what a viewer would have already seen
 * revealed while moving forward through it the first time. Home/End are
 * deliberately NOT intercepted by advance()/retreat() -- they are direct
 * jumps (bypassing per-fragment step-by-step navigation entirely, per
 * their own pre-existing docs above), but the slide they land ON still
 * gets its fragment state set via this same goTo()-level rule.
 *
 * Each fragment's `aria-hidden` attribute is kept in lockstep with its
 * `.is-revealed` class ("false" once revealed, "true" otherwise) as part
 * of every reveal/conceal/reset step -- a real accessibility gap neither
 * reveal.js nor Slidev closes for their own equivalent feature, done here
 * as a genuine differentiator rather than left as a nice-to-have. That
 * same lockstep also has to survive the two OTHER views where render.ts's
 * own CSS overrides fragment visibility independently of .is-revealed:
 * grid-overview mode shows every fragment on every slide at once
 * (aria-hidden="false" for all, regardless of reveal state), and exiting
 * presentation mode entirely returns to the continuous-scroll view where
 * fragments are visible by default with no hiding at all (aria-hidden
 * removed, not just set to "false"). See syncFragmentAriaForCurrentMode
 * below, called from openOverview()/closeOverviewUi()/
 * exitPresentationMode() -- without it, a screen reader would report
 * fragments as hidden in exactly the two views where they are visually
 * all shown.
 *
 * A genuinely separate presenter view -- a second browser window/tab
 * showing a presenter-console layout (the current slide, a preview of the
 * next slide, that slide's own presenter notes always visible, and a
 * count-up elapsed timer) instead of the normal one-slide-fullscreen view
 * -- is opened via "p"/"P" (see openPresenterView() below). It is
 * deliberately the SAME served document at the SAME URL, with one added
 * query flag: an "&presenter" alongside the "present" flag this whole
 * script already requires. There is no second HTML generation path
 * anywhere in this project for presenter view -- a presenter-view window
 * is detected purely by that one extra flag (isPresenterView below) and
 * renders a DIFFERENT layout (a body.presenter-view class -- see
 * render.ts's PRESENTER_VIEW_STYLE) on top of the exact same
 * slides/current/goTo() machinery every other view in this file already
 * shares. See updatePresenterConsole() below for the one small, additive
 * piece specific to that layout (moving the current/next slide's own real
 * elements into two preview boxes, never cloning them, plus refreshing a
 * dedicated notes panel) -- this is NOT a fork of slide-index tracking
 * itself.
 *
 * A presenter-view window is read-only: it never drives navigation itself
 * (its own keydown/click/touchend listeners all bail out immediately once
 * document.body.classList.contains("presenter-view") -- see each
 * listener's own early guard below), and it never calls goTo() (reserved
 * for the window a presenter is actually clicking/pressing keys in --
 * ordinarily the main, non-presenter-view one). Instead it mirrors that
 * OTHER window's state via two channels: a BroadcastChannel (deliberately
 * not postMessage -- both windows are same-origin tabs of the identical
 * served document, exactly what BroadcastChannel is for, and it needs no
 * opener/window reference the way postMessage would) that goTo() posts
 * {type: "slide", index: current} to on every call, live, for whichever
 * presenter-view window(s) are ALREADY open and listening; and
 * localStorage (a "nh-deck-current-slide" key goTo() also writes on every
 * call), which a presenter-view window opened or reloaded AFTER some
 * navigation already happened reads exactly ONCE, at startup, to recover
 * that last-known index before it has ever received a single broadcast --
 * see the `current` initialization right after parseHashIndex() below.
 * Receiving a broadcast updates `current` and calls render() directly
 * (never goTo()) -- goTo()'s own bounds-check, fragment-reset, and
 * direction-backward bookkeeping are for the window actually navigating,
 * and repeating them here would be redundant at best and (for the
 * direction flag specifically) wrong: a presenter-view window has no
 * navigation direction of its own.
 *
 * "p"/"P" (openPresenterView() below) opens that window via a plain
 * window.open() call against a NAMED target ("nh-deck-presenter"), so
 * repeated presses reuse/focus the same window rather than spawning a new
 * tab every time. It is checked in the keydown listener right after "?"
 * and before the `if (helpOpen) { return; }` guard that suppresses every
 * OTHER key while help is open -- opening presenter view is a side-channel
 * action on an entirely separate window/document; it neither reads nor
 * mutates this window's own helpOpen/overviewOpen state, so (like "?" and
 * Escape immediately above it) it must not be swallowed by either
 * suppression rule. The presenter URL is built as
 * `location.pathname + location.search + "&presenter" + location.hash`,
 * deliberately NOT `location.href + "&presenter"` -- the latter breaks the
 * moment location.hash is non-empty (true almost immediately, since
 * render() unconditionally sets it below): appending after an existing
 * "#fragment" makes the appended text part of the hash, not an actual
 * query parameter. `location.search` is guaranteed non-empty here (it must
 * already contain "?present", or this whole script would have returned at
 * the top-level gate above), so "&presenter" is always syntactically safe
 * to append to it as one more bare flag, matching the bare (no "=value")
 * style "present"/"notes" already use elsewhere in this project.
 *
 * A "g" keypress starts a short-lived slide-jump: subsequent digit
 * keypresses (0-9) accumulate into jumpDigits (a plain string, not yet a
 * number -- see that variable's own comment below) shown live via a small
 * on-screen indicator (render.ts's JUMP_INDICATOR_STYLE) -- the same
 * "a hidden keybinding alone just relocates the discoverability problem"
 * reasoning that already motivated the "? controls" hint button above,
 * applied here to a keybinding that, unlike "?"/"o"/"p", has no natural
 * always-visible button of its own to click (there is nothing to click to
 * "start typing a slide number"). Enter confirms the jump via confirmJump()
 * below, which parses the typed digits as a 1-indexed slide number --
 * matching the visible counter's own 1-indexed "N / M" display, the exact
 * convention a viewer is already looking at -- converts that to goTo()'s
 * 0-indexed convention, and clamps it into the valid slide range with
 * Math.min/Math.max rather than doing nothing or throwing on a too-large or
 * too-small number. This is the same clamping spirit Home/End already get
 * for free (they always compute an in-range index directly, so goTo()'s own
 * `index < 0 || index >= slides.length` guard never actually has to reject
 * either of them) applied explicitly, since an arbitrary typed number has
 * no such built-in guarantee. Escape cancels a pending jump without
 * navigating anywhere (cancelJump() below) -- folded into the keydown
 * listener's pre-existing Escape branch as its FIRST, highest-precedence
 * case, ahead of that branch's existing helpOpen/overviewOpen checks, since
 * starting a jump is itself only ever possible once both of those are
 * already confirmed closed (see startJump()'s own check site, gated behind
 * the same helpOpen/overviewOpen early-returns that already suppress "o"
 * and ordinary slide navigation) -- the two states can therefore never
 * actually overlap in practice, but the ordering is still written this way
 * on purpose, matching how carefully this file already orders every other
 * modal-ish precedence decision. While a jump is pending, every key this
 * listener understands other than a digit or Enter -- "?", "p", "o", the
 * arrows, Home, End, Space -- is swallowed outright, and a plain click or
 * touch swipe do nothing either (see the jumpDigits early-returns in the
 * keydown/click/touchend listeners below): a pending jump behaves like its
 * own small, most tightly-scoped modal state, layered on top of (never a
 * replacement for) the plain-presenting/overview/help precedence this file
 * already establishes above.
 */
export const PRESENTATION_SCRIPT = `<script>
(() => {
  if (!new URLSearchParams(location.search).has("present")) {
    return;
  }
  document.body.classList.add("presenting");

  // See this file's own module docstring above for the full presenter-view
  // design. This is the ONLY thing that distinguishes a presenter-view
  // window from an ordinary presenting one -- everything else in this
  // script (slides/current/goTo(), even the chrome elements created below)
  // is shared, unforked code; render.ts's PRESENTER_VIEW_STYLE is what
  // actually swaps the visible layout, scoped entirely under this class.
  const isPresenterView = new URLSearchParams(location.search).has(
    "presenter",
  );
  if (isPresenterView) {
    document.body.classList.add("presenter-view");
  }

  const slides = Array.from(document.querySelectorAll(".slide"));
  if (slides.length === 0) {
    return;
  }

  // Presenter-view sync constants -- see this file's own module docstring
  // for the full BroadcastChannel/localStorage design. Shared verbatim by
  // every window (main or presenter-view): both need the exact same
  // channel name to talk to each other, and the exact same localStorage
  // key so a presenter-view window reads what the main window itself last
  // wrote there.
  const PRESENTER_CHANNEL_NAME = "nh-deck-presenter-sync";
  const CURRENT_SLIDE_STORAGE_KEY = "nh-deck-current-slide";
  const PRESENTER_WINDOW_NAME = "nh-deck-presenter";
  const presenterChannel = new BroadcastChannel(PRESENTER_CHANNEL_NAME);

  // Wraps the slide counter together with the "? controls" hint button
  // (below) in a single flex row, positioned via render.ts's
  // .presentation-chrome rule -- rather than making the counter and the
  // hint button two independently "position: fixed" siblings and
  // hand-tuning a "right" offset wide enough to clear the counter's own
  // variable-width "N / M" text, the wrapper makes this layout self-sizing
  // regardless of how wide that text ends up being.
  const chromeRow = document.createElement("div");
  chromeRow.className = "presentation-chrome";
  document.body.appendChild(chromeRow);

  const counter = document.createElement("div");
  counter.className = "presentation-counter";
  chromeRow.appendChild(counter);

  // The actual discoverability fix -- see this file's own module docstring
  // above and render.ts's HELP_STYLE docstring: a hidden "?" keybinding
  // alone just relocates the secret, so this button is always visible
  // (whenever presenting) and opens the exact same overlay openHelp() does.
  const helpHint = document.createElement("button");
  helpHint.type = "button";
  helpHint.className = "presentation-help-hint";
  helpHint.textContent = "? controls";
  helpHint.setAttribute("aria-label", "Show keyboard shortcuts");
  chromeRow.appendChild(helpHint);

  const progress = document.createElement("div");
  progress.className = "presentation-progress";
  document.body.appendChild(progress);

  // Visible feedback for an in-progress "g"-then-digits-then-Enter slide
  // jump -- see this file's own module docstring and startJump()/
  // appendJumpDigit()/confirmJump()/cancelJump() below for the full design.
  // Styled like the pre-existing .presentation-counter/.presenter-timer
  // chrome (render.ts's JUMP_INDICATOR_STYLE) but kept OUT of chromeRow
  // above: unlike the counter/hint, which are always visible while
  // presenting, this only appears for the brief window an actual jump is
  // being typed, via the "is-active" class renderJumpIndicator() below
  // toggles.
  const jumpIndicator = document.createElement("div");
  jumpIndicator.className = "presentation-jump-indicator";
  document.body.appendChild(jumpIndicator);

  // Full-screen keyboard-shortcuts overlay, opened by "?" (see the keydown
  // listener below) or a helpHint click, and closed the same two ways.
  // Grouped into "Navigate" (the keys/gestures that move between slides)
  // and "View" (the keys that change which mode is showing) -- matching how
  // this file's own module docstring already separates those two concerns.
  const help = document.createElement("div");
  help.className = "presentation-help";
  help.innerHTML =
    '<div class="presentation-help-panel">' +
    "<h2>Keyboard shortcuts</h2>" +
    "<dl>" +
    "<dt>Navigate</dt>" +
    "<dd>→ / Space / ← / Home / End / click / swipe</dd>" +
    "<dd>G, digits, Enter — jump to slide</dd>" +
    "<dt>View</dt>" +
    "<dd>O — overview</dd>" +
    "<dd>P — presenter view</dd>" +
    "<dd>? — this help</dd>" +
    "<dd>Esc — exit or close</dd>" +
    "</dl>" +
    "</div>";
  document.body.appendChild(help);

  // Presenter-console DOM refs -- only ever assigned (and only ever read by
  // updatePresenterConsole() below) when isPresenterView is true; see the
  // isPresenterView block immediately below, which is the only place that
  // assigns them. Declared here, at the outer scope, purely so
  // updatePresenterConsole() (a plain function value, not yet invoked at
  // this point in the script) can close over them regardless of where in
  // this file it happens to be defined relative to this block.
  let currentPreview;
  let nextPreview;
  let notesPanel;

  // Presenter-console UI: the current slide (scaled down), a preview
  // of the next slide (scaled down further), the current slide's own
  // presenter notes (always visible here, unlike the main view's
  // ?notes-gated overlay), and a plain count-up elapsed timer. Entirely
  // absent from the DOM in an ordinary presenting window -- see this
  // file's own module docstring for why isPresenterView is the only fork
  // in this whole script, and why it is confined to layout/UI construction
  // like this rather than slide-index tracking itself.
  if (isPresenterView) {
    const presenterConsole = document.createElement("div");
    presenterConsole.className = "presenter-console";
    document.body.appendChild(presenterConsole);

    currentPreview = document.createElement("div");
    currentPreview.className = "presenter-preview presenter-preview-current";
    presenterConsole.appendChild(currentPreview);

    nextPreview = document.createElement("div");
    nextPreview.className = "presenter-preview presenter-preview-next";
    presenterConsole.appendChild(nextPreview);

    notesPanel = document.createElement("div");
    notesPanel.className = "presenter-notes-panel";
    presenterConsole.appendChild(notesPanel);

    const timerEl = document.createElement("div");
    timerEl.className = "presenter-timer";
    presenterConsole.appendChild(timerEl);

    // A plain count-up timer -- starts counting from when THIS window
    // opens, via setInterval computing Date.now() minus a stored start
    // time. Deliberately no pause/resume and no duration-based color
    // coding for this v1 -- both are explicit fast-follows, not built here.
    const timerStartMs = Date.now();
    const updateTimerDisplay = () => {
      const elapsedSeconds = Math.floor((Date.now() - timerStartMs) / 1000);
      const minutes = Math.floor(elapsedSeconds / 60);
      const seconds = elapsedSeconds % 60;
      timerEl.textContent =
        String(minutes).padStart(2, "0") +
        ":" +
        String(seconds).padStart(2, "0");
    };
    updateTimerDisplay();
    setInterval(updateTimerDisplay, 1000);

    // The read-only half of the sync mechanism (see this file's own module
    // docstring): a "slide" message means the MAIN window just navigated,
    // so mirror its new index directly and re-render -- deliberately
    // calling render() here, never goTo(), since goTo()'s bounds-check,
    // fragment-reset, and direction-backward bookkeeping are for the
    // window actually doing the navigating, not this passive display of
    // it.
    presenterChannel.addEventListener("message", (event) => {
      if (event.data && event.data.type === "slide") {
        current = event.data.index;
        render();
      }
    });
  }

  const parseHashIndex = () => {
    const n = parseInt(location.hash.slice(1), 10);
    return Number.isInteger(n) && n >= 1 && n <= slides.length ? n - 1 : 0;
  };

  let current = parseHashIndex();

  // A presenter-view window opened or reloaded AFTER navigation has already
  // happened in the main window has no hash of its own to resume from --
  // it is a genuinely separate tab/window with its own navigation history,
  // so parseHashIndex() above only ever reflects THIS window's own,
  // possibly-stale hash. localStorage is shared across same-origin tabs, so
  // this reads the main window's last-known slide index once, here, at
  // startup, before subscribing to presenterChannel above for every live
  // update from that point on -- see this file's own module docstring.
  if (isPresenterView) {
    const storedIndex = Number.parseInt(
      localStorage.getItem(CURRENT_SLIDE_STORAGE_KEY) ?? "",
      10,
    );
    if (
      Number.isInteger(storedIndex) &&
      storedIndex >= 0 &&
      storedIndex < slides.length
    ) {
      current = storedIndex;
    }
  } else {
    // The MAIN window's own initial index (parsed from ITS hash above, or
    // 0 with no hash) is written here immediately, rather than left for
    // goTo() to write on the FIRST actual navigation -- otherwise a
    // presenter-view window opened before any navigation happens would
    // read whatever stale index a PREVIOUS session left in localStorage
    // (shared across same-origin tabs indefinitely, not cleared between
    // runs) instead of the main window's real current slide.
    localStorage.setItem(CURRENT_SLIDE_STORAGE_KEY, String(current));
  }

  let overviewOpen = false;
  let indexBeforeOverview = current;
  let helpOpen = false;

  // Jump-to-slide state ("g" then digits then Enter/Escape -- see this
  // file's own module docstring for the full design). "null" means no jump
  // is in progress; once "g" starts one (startJump() below), this holds the
  // digits typed so far as a plain STRING, never a number -- so a leading
  // zero, or the brief moment right after "g" itself (no digit typed yet,
  // jumpDigits === ""), both round-trip through the on-screen indicator
  // exactly as typed rather than being silently coerced by a numeric type
  // before Enter is even pressed.
  let jumpDigits = null;

  // Fragment (incremental reveal) helpers -- see this file's own module
  // docstring above for the full state-machine explanation. Fragments are
  // looked up fresh from the live DOM every time (via .fragment/
  // .is-revealed class state) rather than tracked in a parallel JS
  // counter, so there is exactly one source of truth for "how many of
  // this slide's fragments are revealed right now".
  const fragmentsInSlide = (slide) =>
    Array.from(slide.querySelectorAll(".fragment"));

  // One-time initialization: every fragment everywhere starts concealed
  // (aria-hidden="true", no .is-revealed class). render.ts's FRAGMENT_STYLE
  // already renders them invisible by default under body.presenting with
  // no JS needed -- this just keeps the accessibility tree in sync with
  // that same starting state from first paint, matching goTo()'s own
  // "entering a slide forward resets to 0 revealed" rule below for
  // whichever slide ends up active first.
  document.querySelectorAll(".fragment").forEach((el) => {
    el.setAttribute("aria-hidden", "true");
  });

  // Reveals the next not-yet-revealed fragment on slide, in document
  // order, toggling both .is-revealed (render.ts's CSS reads this) and
  // aria-hidden (kept in lockstep, "false" once revealed). Returns
  // whether there was one to reveal -- advance() uses this to decide
  // whether to stay on this slide or fall through to goTo().
  const revealNextFragment = (slide) => {
    const next = fragmentsInSlide(slide).find(
      (el) => !el.classList.contains("is-revealed"),
    );
    if (!next) {
      return false;
    }
    next.classList.add("is-revealed");
    next.setAttribute("aria-hidden", "false");
    return true;
  };

  // Conceals the LAST-revealed fragment on slide (the mirror image of
  // revealNextFragment) -- searches from the end so retreat() undoes
  // reveals in the exact reverse order advance() applied them.
  const concealLastFragment = (slide) => {
    const fragments = fragmentsInSlide(slide);
    for (let i = fragments.length - 1; i >= 0; i--) {
      if (fragments[i].classList.contains("is-revealed")) {
        fragments[i].classList.remove("is-revealed");
        fragments[i].setAttribute("aria-hidden", "true");
        return true;
      }
    }
    return false;
  };

  // Sets EVERY fragment on slide to the same revealed/concealed state at
  // once -- used by goTo() when a slide is entered wholesale (forward:
  // reveal-count resets to 0 / all concealed; backward: all revealed),
  // rather than one-at-a-time like revealNextFragment/concealLastFragment.
  const setFragmentsRevealed = (slide, revealed) => {
    fragmentsInSlide(slide).forEach((el) => {
      el.classList.toggle("is-revealed", revealed);
      el.setAttribute("aria-hidden", revealed ? "false" : "true");
    });
  };

  // The three functions above keep aria-hidden in lockstep with .is-revealed
  // for ONE slide's fragments during ordinary presentation-mode navigation --
  // but render.ts's own CSS also makes every fragment visible regardless of
  // .is-revealed under two OTHER conditions this file controls: grid-overview
  // mode (body.overview .fragment forces full opacity for every slide at
  // once) and exiting presentation mode entirely (fragments have no
  // aria-hidden-worthy hiding at all in the normal continuous-scroll view --
  // FRAGMENT_STYLE's base rule already shows them by default there). Without
  // this, a screen reader would still report fragments as hidden in exactly
  // the two views where they are visually all shown at once. Called from
  // openOverview()/closeOverviewUi()/exitPresentationMode() below rather than
  // threaded through every caller of those three functions individually.
  const syncFragmentAriaForCurrentMode = () => {
    document.querySelectorAll(".fragment").forEach((el) => {
      if (overviewOpen) {
        el.setAttribute("aria-hidden", "false");
      } else if (document.body.classList.contains("presenting")) {
        el.setAttribute(
          "aria-hidden",
          el.classList.contains("is-revealed") ? "false" : "true",
        );
      } else {
        el.removeAttribute("aria-hidden");
      }
    });
  };

  // Presenter-console update: moves the CURRENT and NEXT slide's own real
  // .slide elements into their dedicated preview boxes -- never clones
  // them. Cloning would duplicate any id a slide's content carries (e.g.
  // Mermaid's own SVG marker/arrowhead ids, or KaTeX's internal ids),
  // which is invalid HTML and can break rendering the moment two copies of
  // the same id exist in one document; moving the real node sidesteps that
  // entirely, since only one copy of it ever exists. Also refreshes the
  // dedicated notes panel from the CURRENT slide's own .notes content, via
  // a plain textContent copy (never innerHTML) so nothing here can ever
  // inject markup. Only ever called when isPresenterView is true (see
  // render()'s own call site immediately below) -- currentPreview/
  // nextPreview/notesPanel are only ever assigned in that case, so this
  // function is never invoked with them undefined.
  const updatePresenterConsole = () => {
    // A preview box can only ever hold the ONE slide currently designated
    // current/next -- park whatever it held before (if anything) back onto
    // <body> first, so the appendChild calls below never leave a stale
    // previous occupant sitting alongside the new one. body.presenter-view's
    // own CSS hides every .slide NOT inside a .presenter-preview box, so a
    // parked-back slide simply disappears again, exactly like every other
    // slide currently not designated current/next.
    while (currentPreview.firstChild) {
      document.body.appendChild(currentPreview.firstChild);
    }
    while (nextPreview.firstChild) {
      document.body.appendChild(nextPreview.firstChild);
    }
    if (slides[current]) {
      currentPreview.appendChild(slides[current]);
    }
    if (slides[current + 1]) {
      nextPreview.appendChild(slides[current + 1]);
    }

    notesPanel.innerHTML = "";
    const currentNotes = slides[current]
      ? Array.from(slides[current].querySelectorAll(".notes"))
      : [];
    if (currentNotes.length === 0) {
      notesPanel.textContent = "(no notes for this slide)";
    } else {
      currentNotes.forEach((note) => {
        const noteEl = document.createElement("div");
        noteEl.className = "presenter-note";
        noteEl.textContent = note.textContent ?? "";
        notesPanel.appendChild(noteEl);
      });
    }
  };

  const render = () => {
    slides.forEach((slide, i) => {
      slide.classList.toggle("is-active", i === current);
    });
    counter.textContent = (current + 1) + " / " + slides.length;
    const lastIndex = slides.length - 1;
    const progressPercent = lastIndex === 0 ? 100 : (current / lastIndex) * 100;
    progress.style.width = progressPercent + "%";
    location.hash = String(current + 1);
    if (isPresenterView) {
      updatePresenterConsole();
    }
  };

  const goTo = (index, isBackward) => {
    if (index < 0 || index >= slides.length) {
      return;
    }
    document.body.classList.toggle("direction-backward", Boolean(isBackward));
    // Only reset the LANDING slide's fragments when the slide index is
    // actually changing -- e.g. closeOverviewToPreviousSlide() calls
    // goTo(indexBeforeOverview, false) to return to the exact slide the
    // grid overview was opened on, which is always still "current" at that
    // point (nothing else mutates current while overview is open); that is
    // not an "entering" event and must not disturb whatever reveal state
    // the viewer had already reached there.
    if (index !== current) {
      setFragmentsRevealed(slides[index], Boolean(isBackward));
    }
    current = index;
    render();
    // Presenter-view sync (see this file's own module docstring): persists
    // the new index to localStorage (read once, at startup, by a
    // presenter-view window opened or reloaded after this point) and
    // broadcasts it live to any ALREADY-OPEN presenter-view window via
    // BroadcastChannel. goTo() is only ever reachable from a presenter-view
    // window's own user input in the first place (its keydown/click/
    // touchend listeners all bail out before calling goTo() -- see their
    // own isPresenterView guards below), so in practice this only ever
    // actually fires from the MAIN presenting window -- but writing it
    // here, unconditionally, inside goTo() itself, keeps this one shared
    // function the single place that both windows' tracking flows through,
    // rather than forking a separate "broadcasting goTo" for the main
    // window alone.
    localStorage.setItem(CURRENT_SLIDE_STORAGE_KEY, String(current));
    presenterChannel.postMessage({ type: "slide", index: current });
  };

  // Forward navigation: reveal the current slide's next fragment (if any
  // remain) and stop there; only once none remain does this fall through
  // to advancing the slide itself. Used in place of a direct
  // goTo(current + 1, false) call by every forward-navigation trigger
  // (ArrowRight/Space, a plain click, and a left swipe) -- see this file's
  // own module docstring for the full state machine. Deliberately NOT used
  // by End, which is a direct jump past any in-between fragments, per its
  // own pre-existing docs above.
  const advance = () => {
    if (revealNextFragment(slides[current])) {
      return;
    }
    goTo(current + 1, false);
  };

  // Backward navigation: the mirror image of advance() -- conceals the
  // current slide's last-revealed fragment (if any) and stops there;
  // only once none remain revealed does this fall through to retreating a
  // slide. Used by ArrowLeft and a right swipe; NOT used by Home, which
  // (like End above) is a direct jump.
  const retreat = () => {
    if (concealLastFragment(slides[current])) {
      return;
    }
    goTo(current - 1, true);
  };

  // Opens grid-overview mode: records which slide was active BEFORE opening
  // (indexBeforeOverview) separately from current, so closing it again via
  // Escape/"o" (closeOverviewToPreviousSlide, below) always returns to that
  // slide -- not necessarily whatever slide was most recently clicked/hovered
  // while the grid was open. Nothing else mutates current while overview is
  // open (arrow/Home/End navigation is suppressed below via the early
  // overviewOpen return), so in practice indexBeforeOverview and current
  // stay equal until a thumbnail click intentionally changes current -- see
  // the click listener's own separate, non-restoring close path.
  const openOverview = () => {
    if (overviewOpen) {
      return;
    }
    indexBeforeOverview = current;
    overviewOpen = true;
    document.body.classList.add("overview");
    syncFragmentAriaForCurrentMode();
  };

  // Removes the overview class/flag without touching current -- shared by
  // both close paths (Escape/"o", and a thumbnail click) since only the
  // Escape/"o" path also needs to navigate back to indexBeforeOverview.
  const closeOverviewUi = () => {
    overviewOpen = false;
    document.body.classList.remove("overview");
    syncFragmentAriaForCurrentMode();
  };

  // The Escape/"o"-while-open close path: closes the grid and returns to the
  // slide that was active when it opened.
  const closeOverviewToPreviousSlide = () => {
    closeOverviewUi();
    goTo(indexBeforeOverview, false);
  };

  // Opens the keyboard-shortcuts help overlay. Deliberately never touches
  // overviewOpen (unlike openOverview, which records indexBeforeOverview) --
  // help has no "current slide" concept of its own to preserve, and, more
  // importantly, this is what lets help be opened ON TOP of an already-open
  // grid overview (via "?" or a helpHint click) without disturbing it. See
  // the keydown listener's own precedence comment below for how this
  // composes with overviewOpen.
  const openHelp = () => {
    if (helpOpen) {
      return;
    }
    helpOpen = true;
    document.body.classList.add("help-open");
  };

  // Closes JUST the help overlay -- like openHelp() above, this never
  // touches overviewOpen, so closing help while the grid overview happens to
  // also be open leaves that overview exactly as it was.
  const closeHelp = () => {
    helpOpen = false;
    document.body.classList.remove("help-open");
  };

  // Exits presentation mode entirely, back to the normal continuous-scroll
  // document view -- WITHOUT a full page reload. Kept as its own
  // clearly-named function (rather than inlined into the Escape branch
  // below) so the overview/grid-mode addition above can compose in front of
  // it: the keydown listener checks "is overview open" first and closes that
  // instead (closeOverviewToPreviousSlide), falling back to this
  // exit-presentation behavior only when overview isn't open -- a single
  // Escape keypress therefore never does both in the same event.
  const exitPresentationMode = () => {
    const params = new URLSearchParams(location.search);
    params.delete("present");
    const query = params.toString();
    history.replaceState(
      null,
      "",
      location.pathname + (query ? "?" + query : "") + location.hash,
    );
    // Removing this class alone is enough to hide all presentation-only
    // chrome (counter, progress bar, nav arrows) -- render.ts scopes every
    // bit of that chrome's styling under body.presenting.
    document.body.classList.remove("presenting");
    syncFragmentAriaForCurrentMode();
  };

  // Opens the presenter-view window/tab -- see this file's own module
  // docstring for the full URL-construction and precedence reasoning.
  // Targets a NAMED window ("nh-deck-presenter") so repeated "p" presses
  // reuse/focus the same window instead of spawning a new tab every time.
  const openPresenterView = () => {
    const presenterUrl =
      location.pathname + location.search + "&presenter" + location.hash;
    window.open(presenterUrl, PRESENTER_WINDOW_NAME);
  };

  // True while a slide-jump's digits are being typed -- one named check
  // shared by the keydown, click, and touchend listeners below (each needs
  // to suppress its own normal behavior while a jump is pending, the same
  // "one modal-ish state governs every input channel" treatment
  // helpOpen/overviewOpen already get in each of those three listeners),
  // rather than re-writing the same "jumpDigits !== null" condition three
  // separate times.
  const isJumpPending = () => jumpDigits !== null;

  // Refreshes the on-screen digit indicator from jumpDigits -- called by
  // every function below that changes it, rather than folded into render()
  // (which every goTo() call already runs for the slide/counter/progress
  // bar/presenter-console): jumpDigits changes independently of the
  // current slide index, and piggybacking on render()'s much larger body
  // for every single digit keypress would be wasted work with no upside.
  const renderJumpIndicator = () => {
    jumpIndicator.classList.toggle("is-active", isJumpPending());
    jumpIndicator.textContent = isJumpPending() ? "Go to: " + jumpDigits : "";
  };

  // Starts capturing a jump target. See the keydown listener's own
  // precedence comment below for why "g" is only ever reachable once
  // help/overview are both confirmed closed.
  const startJump = () => {
    jumpDigits = "";
    renderJumpIndicator();
  };

  // Appends one more typed digit (already validated as "0"-"9" by the
  // keydown listener's own jumpDigits block below) to the number being
  // built.
  const appendJumpDigit = (digit) => {
    jumpDigits += digit;
    renderJumpIndicator();
  };

  // Cancels a pending jump WITHOUT navigating anywhere -- used by Escape
  // (folded into the keydown listener's existing Escape branch below, as
  // its first, highest-precedence case) and by confirmJump() itself when
  // Enter is pressed with no digits typed yet: nothing to jump to, so it
  // cancels exactly like Escape rather than jumping to some arbitrary
  // default slide.
  const cancelJump = () => {
    jumpDigits = null;
    renderJumpIndicator();
  };

  // Confirms a pending jump: parses the accumulated digits as a 1-indexed
  // slide number (matching the visible counter's own 1-indexed "N / M"
  // display), converts that to goTo()'s 0-indexed convention, and clamps
  // it into the valid slide range with Math.min/Math.max -- an
  // out-of-range number (e.g. past the last slide) lands on the nearest
  // valid slide instead of doing nothing or throwing, the same clamping
  // spirit Home/End already get for free (see this file's own module
  // docstring) applied explicitly here, since an arbitrary typed number has
  // no such built-in guarantee.
  const confirmJump = () => {
    const digits = jumpDigits;
    cancelJump();
    if (!digits) {
      return;
    }
    const requestedSlideNumber = Number.parseInt(digits, 10);
    const targetIndex = Math.min(
      Math.max(requestedSlideNumber - 1, 0),
      slides.length - 1,
    );
    // A jump lands "backward" (in goTo()'s own fragment-reset sense -- see
    // this file's own module docstring) only when it moves to an EARLIER
    // slide than the one currently showing. This differs from Home (always
    // backward) and End (always forward): an arbitrary typed jump can move
    // either direction depending on where the viewer currently is, so the
    // direction has to be computed from the actual indices instead of
    // hardcoded like those two.
    goTo(targetIndex, targetIndex < current);
  };

  document.addEventListener("keydown", (event) => {
    // Inert once exitPresentationMode() has removed body.presenting -- this
    // listener, like every listener in this script, is attached once and
    // never detached (see the touchend listener's identical guard/comment
    // below), so without this check, pressing "o" on the normal
    // continuous-scroll view (reached via Escape, without a page reload)
    // would still call openOverview(), turning the ordinary document into a
    // grid of clipped thumbnails outside presentation mode entirely.
    if (!document.body.classList.contains("presenting")) {
      return;
    }
    // A presenter-view window is a read-only mirror of the MAIN window's
    // state (see this file's own module docstring's presenter-view
    // section) -- every key this listener handles below (Escape/"?"/"p"/
    // "o"/"g"/digits/Enter/arrows/Home/End/Space) exists to drive or view
    // THIS window's own slide state, which a presenter-view window must
    // never do. Checked here, once, before any of those branches, rather
    // than duplicated inside each one individually.
    if (document.body.classList.contains("presenter-view")) {
      return;
    }
    // Precedence across this script's three modal-ish states -- help open,
    // overview open, and plain presenting -- is checked in a fixed order so
    // a single keypress never does two things at once:
    //
    // 1. Escape and "?" BOTH check "is help open" first, ahead of "is
    //    overview open". Help can be opened via "?" (or a helpHint click)
    //    WHILE the grid overview is already open -- openHelp()/closeHelp()
    //    never touch overviewOpen (see their own docstrings above), so the
    //    two states can be stacked with help on top of overview. Escape
    //    must therefore close only the topmost layer: if help is open,
    //    close JUST help, leaving overviewOpen -- and
    //    closeOverviewToPreviousSlide's own indexBeforeOverview bookkeeping
    //    -- completely untouched. A SECOND Escape, pressed once help is
    //    confirmed closed, is what falls through to the pre-existing
    //    overview-vs-exit precedence below.
    // 2. Once help is confirmed not open, "o" and Escape's fallback are
    //    completely unchanged from before this feature existed: they
    //    resolve purely between overviewOpen and exitPresentationMode, per
    //    exitPresentationMode's own docstring.
    // 3. "o", "g", and all slide-to-slide navigation (arrows/Home/End/
    //    Space) are ALL suppressed while help is open, not just
    //    navigation -- letting "o" open the grid overview, or "g" start a
    //    new slide jump, underneath a still-open help modal would silently
    //    do a second thing on top of whatever "?" or the helpHint click
    //    already did, which is exactly the one-keypress-one-effect rule
    //    this whole ordering exists to preserve.
    //
    // A pending slide jump (jumpDigits !== null, started by "g" -- see this
    // file's own module docstring, and the jumpDigits block right below,
    // which is checked BEFORE the "?" branch so a pending jump swallows
    // "?" too) is a FOURTH modal-ish state, layered on top of the three
    // above: cancelJump() is folded into this very Escape branch as
    // its first, highest-precedence case, ahead of helpOpen/overviewOpen,
    // since Escape while a jump is pending means "cancel this jump", never
    // "close help"/"close overview"/"exit presentation mode". In practice
    // helpOpen/overviewOpen are always false whenever jumpDigits isn't
    // null -- starting a jump via "g" is itself gated behind both of those
    // being closed already (see that check's own comment, near the bottom
    // of this listener) -- but the ordering is written defensively anyway,
    // matching how carefully this file already orders every other
    // precedence decision here.
    if (event.key === "Escape") {
      if (isJumpPending()) {
        cancelJump();
      } else if (helpOpen) {
        closeHelp();
      } else if (overviewOpen) {
        closeOverviewToPreviousSlide();
      } else {
        exitPresentationMode();
      }
      return;
    }
    // Digits and Enter for an in-progress slide jump are resolved here,
    // immediately after Escape's own cancelJump() branch above and before
    // every other key this listener understands ("?"/"p"/"o"/arrows/Home/
    // End/Space): while a jump is pending, a digit accumulates into the
    // number being typed (appendJumpDigit()) and Enter confirms it
    // (confirmJump()) -- but EVERY other key, including ones that would
    // normally open help/overview or navigate, is swallowed outright via
    // the bare "return" at the end of this block, rather than also doing
    // whatever it would normally do underneath an in-progress digit entry.
    // This mirrors the helpOpen/overviewOpen early-returns further down
    // (which suppress "o"/"g" and slide navigation the same blanket way
    // while THEIR modal is open). This block MUST come before the "?"
    // branch below -- checking "?" first would let it open/close help
    // while a jump is still pending, breaking the "every other key is
    // swallowed" guarantee for exactly one key.
    if (isJumpPending()) {
      if (event.key === "Enter") {
        confirmJump();
      } else if (event.key >= "0" && event.key <= "9") {
        appendJumpDigit(event.key);
      }
      return;
    }
    if (event.key === "?") {
      if (helpOpen) {
        closeHelp();
      } else {
        openHelp();
      }
      return;
    }
    // "p"/"P" opens a NEW presenter-view window/tab (see openPresenterView()
    // above) -- checked here, right after "?" and BEFORE the
    // "if (helpOpen) { return; }" guard just below (which suppresses every
    // OTHER key, including "o" and slide navigation, while the help overlay
    // is open), because opening presenter view is a side-channel action on
    // an entirely separate window/document: it neither reads nor mutates
    // THIS window's own helpOpen/overviewOpen/current state at all, so
    // there is nothing here for either of those modal-ish states to
    // conflict with. A single "p" keypress therefore always opens
    // presenter view, regardless of whatever else is currently open in
    // this window, exactly like "?" and Escape immediately above it.
    if (event.key === "p" || event.key === "P") {
      openPresenterView();
      return;
    }
    if (helpOpen) {
      return;
    }
    if (event.key === "o" || event.key === "O") {
      if (overviewOpen) {
        closeOverviewToPreviousSlide();
      } else {
        openOverview();
      }
      return;
    }
    // Slide-to-slide navigation, and starting a NEW slide jump via "g", are
    // both suppressed while the grid overview is open -- it has no "one
    // active slide" to move between or jump from, and silently changing
    // current underneath the grid would make closeOverviewToPreviousSlide's
    // "return to the slide from before opening" guarantee ambiguous.
    if (overviewOpen) {
      return;
    }
    // Starts a new slide jump -- see startJump() above and the jumpDigits
    // block near the top of this listener for how the digits/Enter/Escape
    // that follow are handled. Checked only here, after BOTH the helpOpen
    // and overviewOpen early-returns above, so "g" can never start a jump
    // while either of those already fully occupies keyboard input -- the
    // exact same reasoning that already gates "o" and ordinary slide
    // navigation behind those same two guards.
    if (event.key === "g" || event.key === "G") {
      startJump();
      return;
    }
    if (event.key === "ArrowRight" || event.key === " ") {
      advance();
    } else if (event.key === "ArrowLeft") {
      retreat();
    } else if (event.key === "Home") {
      goTo(0, true);
    } else if (event.key === "End") {
      goTo(slides.length - 1, false);
    }
  });

  document.addEventListener("click", (event) => {
    // Same "inert once exitPresentationMode() has removed body.presenting"
    // guard as the keydown listener above -- without it, clicking anywhere
    // on the normal continuous-scroll view (reached via Escape) would still
    // call advance(), advancing a "current slide" concept that page no
    // longer has.
    if (!document.body.classList.contains("presenting")) {
      return;
    }
    // Same "read-only mirror" guard as the keydown listener above -- a
    // presenter-view window must never advance/retreat a slide, open the
    // grid overview, or open help from a click either.
    if (document.body.classList.contains("presenter-view")) {
      return;
    }
    // Mirrors the keydown listener's own jump-pending precedence (see this
    // file's own module docstring): while a slide jump's digits are being
    // typed, a click anywhere on the page -- including on the helpHint
    // button checked immediately below -- must not also open help or
    // advance the slide underneath the in-progress digit entry.
    if (isJumpPending()) {
      return;
    }
    // Mirrors the keydown listener's own "help open" precedence: a helpHint
    // click must be handled before anything else below, including the
    // overview-click branch, since (per openHelp()'s own docstring) it's
    // meant to work even while the grid overview is already open.
    if (event.target.closest(".presentation-help-hint")) {
      openHelp();
      return;
    }
    // Suppressed while the help overlay is open, for the same reason the
    // keydown listener's own helpOpen early-return suppresses
    // arrow/Home/End/Space and "o": clicking anywhere on the page --
    // including on the dimmed slide underneath the modal-ish help overlay --
    // must not silently advance to the next slide behind it.
    if (helpOpen) {
      return;
    }
    if (overviewOpen) {
      const clickedSlide = event.target.closest(".slide");
      if (!clickedSlide) {
        return;
      }
      const index = slides.indexOf(clickedSlide);
      if (index === -1) {
        return;
      }
      // Jumps straight to the clicked thumbnail's slide and closes the
      // overview WITHOUT restoring indexBeforeOverview -- this is the one
      // path that intentionally changes current to something other than
      // the pre-overview slide. preventDefault() stops a link inside the
      // thumbnail's content from actually navigating the page away; a
      // thumbnail click always means "select this slide", not "follow this
      // link".
      event.preventDefault();
      closeOverviewUi();
      goTo(index, false);
      return;
    }
    if (event.target.closest("a")) {
      return;
    }
    advance();
  });

  // Touch swipe navigation, for presenting from a phone/tablet with no
  // keyboard. Plain DOM Touch events -- no gesture-library dependency, which
  // would pull in a runtime dependency this project's local-first constraint
  // (see CLAUDE.md) doesn't need for something this small. Only touchstart
  // (record the start point) and touchend (compute the delta and decide) are
  // needed; touchmove is deliberately NOT listened for, since nothing here
  // needs a live drag preview -- matching goTo()'s existing all-or-nothing
  // "jump to the target slide" behavior rather than a partial-drag animation.
  let touchStartX = 0;
  let touchStartY = 0;

  // Below this many px of horizontal movement, a touch is a tap or a
  // deliberately tiny nudge, not a swipe -- ignore it rather than risk
  // firing navigation on an incidental finger tremor.
  const SWIPE_THRESHOLD_PX = 50;

  document.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    if (!touch) {
      return;
    }
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  });

  document.addEventListener("touchend", (event) => {
    // Guards mirror the keydown listener's own: suppressed while a slide
    // jump is pending, the grid overview is open, OR the help overlay is
    // open (same "no single active slide to move between"/modal-overlay
    // rationale as arrow/Home/End and the click listener's own guards
    // above), and inert once exitPresentationMode() has removed
    // body.presenting -- this listener, like every listener in this
    // script, is attached once and never detached, so without this check a
    // swipe on the normal continuous-scroll view (reached via Escape,
    // without a page reload) would still hijack vertical scrolling.
    if (
      isJumpPending() ||
      helpOpen ||
      overviewOpen ||
      !document.body.classList.contains("presenting") ||
      document.body.classList.contains("presenter-view")
    ) {
      return;
    }
    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }
    const deltaX = touch.clientX - touchStartX;
    const deltaY = touch.clientY - touchStartY;
    // A swipe must move further horizontally than the threshold AND further
    // horizontally than vertically -- the second half of this guard is what
    // keeps an ordinary vertical scroll gesture (in a browser embedding this
    // page without ?present, or a diagonal-ish swipe) from being
    // misinterpreted as slide navigation.
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }
    if (deltaX < 0) {
      // Finger moved right-to-left: advance, same direction as ArrowRight.
      advance();
    } else {
      // Finger moved left-to-right: go back, same direction as ArrowLeft.
      retreat();
    }
  });

  render();
})();
</script>`;
