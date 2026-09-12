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

  // Exits presentation mode entirely, back to the normal continuous-scroll
  // document view -- WITHOUT a full page reload. Kept as its own
  // clearly-named function (rather than inlined into the Escape branch
  // below) so a later overview/grid-mode addition can compose in front of
  // it: check "is overview open" first and close that instead, falling
  // back to this exit-presentation behavior only when overview isn't open.
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
    if (event.key === "ArrowRight" || event.key === " ") {
      goTo(current + 1, false);
    } else if (event.key === "ArrowLeft") {
      goTo(current - 1, true);
    } else if (event.key === "Home") {
      goTo(0, true);
    } else if (event.key === "End") {
      goTo(slides.length - 1, false);
    } else if (event.key === "Escape") {
      exitPresentationMode();
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      return;
    }
    goTo(current + 1, false);
  });

  render();
})();
</script>`;
