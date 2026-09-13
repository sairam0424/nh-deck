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

  const counter = document.createElement("div");
  counter.className = "presentation-counter";
  document.body.appendChild(counter);

  const progress = document.createElement("div");
  progress.className = "presentation-progress";
  document.body.appendChild(progress);

  const parseHashIndex = () => {
    const n = parseInt(location.hash.slice(1), 10);
    return Number.isInteger(n) && n >= 1 && n <= slides.length ? n - 1 : 0;
  };

  let current = parseHashIndex();
  let overviewOpen = false;
  let indexBeforeOverview = current;

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
    current = index;
    render();
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
    // Escape and "o" both need the "is overview open" precedence check
    // BEFORE anything else runs: Escape must close an open overview instead
    // of also exiting presentation mode in the same keypress (see
    // exitPresentationMode's docstring), and "o" toggles the overview open
    // or closed depending on that same state.
    if (event.key === "Escape") {
      if (overviewOpen) {
        closeOverviewToPreviousSlide();
      } else {
        exitPresentationMode();
      }
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
      goTo(current + 1, false);
    } else if (event.key === "ArrowLeft") {
      goTo(current - 1, true);
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
    // call goTo(current + 1, false), advancing a "current slide" concept
    // that page no longer has.
    if (!document.body.classList.contains("presenting")) {
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
    goTo(current + 1, false);
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
    // overview is open (same "no single active slide to move between"
    // rationale as arrow/Home/End above), and inert once
    // exitPresentationMode() has removed body.presenting -- this listener,
    // like every listener in this script, is attached once and never
    // detached, so without this check a swipe on the normal
    // continuous-scroll view (reached via Escape, without a page reload)
    // would still hijack vertical scrolling.
    if (overviewOpen || !document.body.classList.contains("presenting")) {
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
      goTo(current + 1, false);
    } else {
      // Finger moved left-to-right: go back, same direction as ArrowLeft.
      goTo(current - 1, true);
    }
  });

  render();
})();
</script>`;
