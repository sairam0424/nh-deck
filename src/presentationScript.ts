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
 * as a genuine differentiator rather than left as a nice-to-have.
 */
export const PRESENTATION_SCRIPT = `<script>
(() => {
  if (!new URLSearchParams(location.search).has("present")) {
    return;
  }
  document.body.classList.add("presenting");

  const slides = Array.from(document.querySelectorAll(".slide"));
  if (slides.length === 0) {
    return;
  }

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
    "<dt>View</dt>" +
    "<dd>O — overview</dd>" +
    "<dd>? — this help</dd>" +
    "<dd>Esc — exit or close</dd>" +
    "</dl>" +
    "</div>";
  document.body.appendChild(help);

  const parseHashIndex = () => {
    const n = parseInt(location.hash.slice(1), 10);
    return Number.isInteger(n) && n >= 1 && n <= slides.length ? n - 1 : 0;
  };

  let current = parseHashIndex();
  let overviewOpen = false;
  let indexBeforeOverview = current;
  let helpOpen = false;

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

  const render = () => {
    slides.forEach((slide, i) => {
      slide.classList.toggle("is-active", i === current);
    });
    counter.textContent = (current + 1) + " / " + slides.length;
    const lastIndex = slides.length - 1;
    const progressPercent = lastIndex === 0 ? 100 : (current / lastIndex) * 100;
    progress.style.width = progressPercent + "%";
    location.hash = String(current + 1);
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
  };

  // Removes the overview class/flag without touching current -- shared by
  // both close paths (Escape/"o", and a thumbnail click) since only the
  // Escape/"o" path also needs to navigate back to indexBeforeOverview.
  const closeOverviewUi = () => {
    overviewOpen = false;
    document.body.classList.remove("overview");
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
    // 3. "o" and all slide-to-slide navigation (arrows/Home/End/Space) are
    //    BOTH suppressed while help is open, not just navigation -- letting
    //    "o" open the grid overview underneath a still-open help modal
    //    would silently do a second thing on top of whatever "?" or the
    //    helpHint click already did, which is exactly the
    //    one-keypress-one-effect rule this whole ordering exists to
    //    preserve.
    if (event.key === "Escape") {
      if (helpOpen) {
        closeHelp();
      } else if (overviewOpen) {
        closeOverviewToPreviousSlide();
      } else {
        exitPresentationMode();
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
    // Slide-to-slide navigation is suppressed while the grid overview is
    // open -- it has no "one active slide" to move between, and silently
    // changing current underneath the grid would make
    // closeOverviewToPreviousSlide's "return to the slide from before
    // opening" guarantee ambiguous.
    if (overviewOpen) {
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
    // Guards mirror the keydown listener's own: suppressed while the grid
    // overview OR the help overlay is open (same "no single active slide to
    // move between"/modal-overlay rationale as arrow/Home/End and the click
    // listener's own helpOpen guard above), and inert once
    // exitPresentationMode() has removed body.presenting -- this listener,
    // like every listener in this script, is attached once and never
    // detached, so without this check a swipe on the normal
    // continuous-scroll view (reached via Escape, without a page reload)
    // would still hijack vertical scrolling.
    if (
      helpOpen ||
      overviewOpen ||
      !document.body.classList.contains("presenting")
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
