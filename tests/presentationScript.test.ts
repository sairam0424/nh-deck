import { describe, expect, it } from "vitest";
import { PRESENTATION_SCRIPT } from "../src/presentationScript.js";

describe("PRESENTATION_SCRIPT", () => {
	it("is wrapped in a real <script> tag", () => {
		expect(PRESENTATION_SCRIPT).toMatch(/^<script>[\s\S]*<\/script>$/);
	});

	it("gates all its behavior behind the present query parameter", () => {
		expect(PRESENTATION_SCRIPT).toContain('has("present")');
	});

	it("listens for the expected navigation keys", () => {
		expect(PRESENTATION_SCRIPT).toContain("ArrowRight");
		expect(PRESENTATION_SCRIPT).toContain("ArrowLeft");
	});

	it("listens for Home, End, and Escape", () => {
		expect(PRESENTATION_SCRIPT).toContain('"Home"');
		expect(PRESENTATION_SCRIPT).toContain('"End"');
		expect(PRESENTATION_SCRIPT).toContain('"Escape"');
	});

	it("exits presentation mode via a clearly-named, composable function rather than inline Escape logic", () => {
		expect(PRESENTATION_SCRIPT).toContain("exitPresentationMode");
		expect(PRESENTATION_SCRIPT).toContain('params.delete("present")');
		expect(PRESENTATION_SCRIPT).toContain("history.replaceState");
	});

	it('toggles a grid-overview mode via the "o" key, applying an overview class', () => {
		expect(PRESENTATION_SCRIPT).toContain('event.key === "o"');
		expect(PRESENTATION_SCRIPT).toContain('event.key === "O"');
		expect(PRESENTATION_SCRIPT).toContain('classList.add("overview")');
		expect(PRESENTATION_SCRIPT).toContain('classList.remove("overview")');
	});

	it('gives Escape/"o" precedence over exitPresentationMode while overview is open, via a distinct close function', () => {
		expect(PRESENTATION_SCRIPT).toContain("closeOverviewToPreviousSlide");
		expect(PRESENTATION_SCRIPT).toContain("overviewOpen");
	});

	it("persists the current slide via location.hash", () => {
		expect(PRESENTATION_SCRIPT).toContain("location.hash");
	});

	it("does not advance on a click inside a link", () => {
		expect(PRESENTATION_SCRIPT).toContain('closest("a")');
	});

	it("never references an external CDN (local-first constraint)", () => {
		expect(PRESENTATION_SCRIPT).not.toMatch(/https?:\/\/cdn\./i);
	});

	it("listens for touchstart and touchend to support swipe navigation", () => {
		expect(PRESENTATION_SCRIPT).toContain('"touchstart"');
		expect(PRESENTATION_SCRIPT).toContain('"touchend"');
	});

	it("only treats a touch as a swipe once it clears both a distance threshold and a horizontal-dominance check", () => {
		expect(PRESENTATION_SCRIPT).toContain("SWIPE_THRESHOLD_PX");
		expect(PRESENTATION_SCRIPT).toContain("Math.abs(deltaX)");
		expect(PRESENTATION_SCRIPT).toContain("Math.abs(deltaY)");
	});

	it("guards swipe handling behind presentation mode and the overview state", () => {
		expect(PRESENTATION_SCRIPT).toContain('classList.contains("presenting")');
	});

	it('opens a keyboard-shortcuts help overlay via "?", toggling a help-open class', () => {
		expect(PRESENTATION_SCRIPT).toContain('event.key === "?"');
		expect(PRESENTATION_SCRIPT).toContain('classList.add("help-open")');
		expect(PRESENTATION_SCRIPT).toContain('classList.remove("help-open")');
		expect(PRESENTATION_SCRIPT).toContain("openHelp");
		expect(PRESENTATION_SCRIPT).toContain("closeHelp");
		expect(PRESENTATION_SCRIPT).toContain("helpOpen");
	});

	it("creates an always-visible hint button, separate from the hidden keybinding, that also opens the help overlay on click", () => {
		expect(PRESENTATION_SCRIPT).toContain("presentation-help-hint");
		expect(PRESENTATION_SCRIPT).toContain("? controls");
		expect(PRESENTATION_SCRIPT).toContain('closest(".presentation-help-hint")');
	});

	it("groups the help overlay's shortcut list under Navigate and View headings", () => {
		expect(PRESENTATION_SCRIPT).toContain("Navigate");
		expect(PRESENTATION_SCRIPT).toContain("View");
	});

	it('gives help precedence over overview for both Escape and "?": both branches check helpOpen before overviewOpen', () => {
		const escapeBranch = PRESENTATION_SCRIPT.slice(
			PRESENTATION_SCRIPT.indexOf('event.key === "Escape"'),
			PRESENTATION_SCRIPT.indexOf('event.key === "?"'),
		);
		expect(escapeBranch).toContain("helpOpen");
		expect(escapeBranch.indexOf("helpOpen")).toBeLessThan(
			escapeBranch.indexOf("overviewOpen"),
		);
	});

	it('suppresses "o" and slide-to-slide navigation while the help overlay is open, via an early return checked before both', () => {
		const keydownListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("keydown"',
		);
		const oKeyIndex = PRESENTATION_SCRIPT.indexOf(
			'event.key === "o"',
			keydownListenerStart,
		);
		const helpOpenGuardIndex = PRESENTATION_SCRIPT.indexOf(
			"if (helpOpen) {",
			keydownListenerStart,
		);
		expect(helpOpenGuardIndex).toBeGreaterThan(-1);
		expect(helpOpenGuardIndex).toBeLessThan(oKeyIndex);
	});

	it("suppresses the click listener's advance-to-next-slide behavior while the help overlay is open", () => {
		const clickListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("click"',
		);
		const advanceIndex = PRESENTATION_SCRIPT.indexOf(
			"advance();",
			clickListenerStart,
		);
		const helpOpenGuardIndex = PRESENTATION_SCRIPT.indexOf(
			"if (helpOpen) {",
			clickListenerStart,
		);
		expect(helpOpenGuardIndex).toBeGreaterThan(-1);
		expect(advanceIndex).toBeGreaterThan(-1);
		expect(helpOpenGuardIndex).toBeLessThan(advanceIndex);
	});

	it("suppresses touch-swipe navigation while the help overlay is open, same as the overview guard", () => {
		const touchendListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("touchend"',
		);
		const guard = PRESENTATION_SCRIPT.slice(
			touchendListenerStart,
			touchendListenerStart + 900,
		);
		expect(guard).toContain("helpOpen");
		expect(guard).toContain("overviewOpen");
	});
});

describe("PRESENTATION_SCRIPT — presenter view", () => {
	it('detects the "presenter" query flag and applies a presenter-view class on body', () => {
		expect(PRESENTATION_SCRIPT).toContain('has(\n    "presenter",\n  )');
		expect(PRESENTATION_SCRIPT).toContain('classList.add("presenter-view")');
	});

	it("opens presenter view via a plain, named window.open() call", () => {
		expect(PRESENTATION_SCRIPT).toContain("openPresenterView");
		expect(PRESENTATION_SCRIPT).toContain(
			"window.open(presenterUrl, PRESENTER_WINDOW_NAME)",
		);
	});

	it("never uses window.postMessage for the sync mechanism -- only BroadcastChannel's own postMessage method", () => {
		expect(PRESENTATION_SCRIPT).not.toContain("window.postMessage");
		expect(PRESENTATION_SCRIPT).toContain("presenterChannel.postMessage");
	});

	it('builds the presenter URL from pathname + search + "&presenter" + hash, never location.href directly (a bare href-append would corrupt a non-empty hash)', () => {
		expect(PRESENTATION_SCRIPT).toContain(
			'location.pathname + location.search + "&presenter" + location.hash',
		);
		expect(PRESENTATION_SCRIPT).not.toContain('location.href + "&presenter"');
	});

	it('gives "p"/"P" precedence over the help-open suppression guard, checked right after "?" and before `if (helpOpen) { return; }`', () => {
		const keydownListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("keydown"',
		);
		const pKeyIndex = PRESENTATION_SCRIPT.indexOf(
			'event.key === "p"',
			keydownListenerStart,
		);
		const questionMarkIndex = PRESENTATION_SCRIPT.indexOf(
			'event.key === "?"',
			keydownListenerStart,
		);
		// The FIRST "if (helpOpen) {" after keydownListenerStart is actually
		// inside the Escape branch above (`if (helpOpen) { closeHelp(); }`) --
		// the standalone suppression guard this test cares about only comes
		// after the "p" branch, so search from pKeyIndex, not
		// keydownListenerStart, to find that one specifically.
		const helpOpenGuardIndex = PRESENTATION_SCRIPT.indexOf(
			"if (helpOpen) {",
			pKeyIndex,
		);
		expect(pKeyIndex).toBeGreaterThan(-1);
		expect(pKeyIndex).toBeGreaterThan(questionMarkIndex);
		expect(pKeyIndex).toBeLessThan(helpOpenGuardIndex);
	});

	it("guards the keydown listener against a presenter-view window ever driving its own navigation, checked before any Escape/?/p/o/arrow branch", () => {
		const keydownListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("keydown"',
		);
		const presenterViewGuardIndex = PRESENTATION_SCRIPT.indexOf(
			'classList.contains("presenter-view")',
			keydownListenerStart,
		);
		const escapeIndex = PRESENTATION_SCRIPT.indexOf(
			'event.key === "Escape"',
			keydownListenerStart,
		);
		expect(presenterViewGuardIndex).toBeGreaterThan(-1);
		expect(presenterViewGuardIndex).toBeLessThan(escapeIndex);
	});

	it("guards the click listener against a presenter-view window ever driving its own navigation", () => {
		const clickListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("click"',
		);
		const presenterViewGuardIndex = PRESENTATION_SCRIPT.indexOf(
			'classList.contains("presenter-view")',
			clickListenerStart,
		);
		const helpHintIndex = PRESENTATION_SCRIPT.indexOf(
			'closest(".presentation-help-hint")',
			clickListenerStart,
		);
		expect(presenterViewGuardIndex).toBeGreaterThan(-1);
		expect(presenterViewGuardIndex).toBeLessThan(helpHintIndex);
	});

	it("guards touch-swipe navigation against a presenter-view window ever driving its own navigation", () => {
		const touchendListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("touchend"',
		);
		const guard = PRESENTATION_SCRIPT.slice(
			touchendListenerStart,
			touchendListenerStart + 900,
		);
		expect(guard).toContain('classList.contains("presenter-view")');
	});

	it("syncs slide navigation via a BroadcastChannel, not postMessage, and persists the current index to localStorage on every goTo() call", () => {
		expect(PRESENTATION_SCRIPT).toContain("new BroadcastChannel(");
		expect(PRESENTATION_SCRIPT).toContain(
			'presenterChannel.postMessage({ type: "slide", index: current })',
		);
		expect(PRESENTATION_SCRIPT).toContain(
			"localStorage.setItem(CURRENT_SLIDE_STORAGE_KEY, String(current))",
		);
		expect(PRESENTATION_SCRIPT).toContain(
			"localStorage.getItem(CURRENT_SLIDE_STORAGE_KEY)",
		);
	});

	it("updates a presenter-view window's own current index straight from a received broadcast, via render() -- never goTo(), which is reserved for the window actually navigating", () => {
		const messageHandlerIndex = PRESENTATION_SCRIPT.indexOf(
			'presenterChannel.addEventListener("message"',
		);
		expect(messageHandlerIndex).toBeGreaterThan(-1);
		const handlerBody = PRESENTATION_SCRIPT.slice(
			messageHandlerIndex,
			messageHandlerIndex + 300,
		);
		expect(handlerBody).toContain("current = event.data.index");
		expect(handlerBody).toContain("render();");
		expect(handlerBody).not.toContain("goTo(");
	});

	it("moves the real current/next .slide elements into dedicated preview boxes rather than cloning them (cloning would duplicate ids like Mermaid's own SVG marker ids)", () => {
		expect(PRESENTATION_SCRIPT).toContain("updatePresenterConsole");
		expect(PRESENTATION_SCRIPT).toContain(
			"currentPreview.appendChild(slides[current])",
		);
		expect(PRESENTATION_SCRIPT).toContain(
			"nextPreview.appendChild(slides[current + 1])",
		);
		expect(PRESENTATION_SCRIPT).not.toContain("cloneNode");
	});

	it("populates the always-visible presenter notes panel via textContent only, never innerHTML with untrusted content", () => {
		expect(PRESENTATION_SCRIPT).toContain('notesPanel.innerHTML = "";');
		expect(PRESENTATION_SCRIPT).toContain(
			"noteEl.textContent = note.textContent",
		);
	});

	it("runs a plain count-up timer via setInterval and Date.now(), with no pause/resume/color-coding logic (an explicit v1 scope cut)", () => {
		expect(PRESENTATION_SCRIPT).toContain("presenter-timer");
		expect(PRESENTATION_SCRIPT).toContain(
			"setInterval(updateTimerDisplay, 1000)",
		);
		expect(PRESENTATION_SCRIPT).toContain("Date.now() - timerStartMs");
	});

	it("never references an external CDN from the presenter-view feature either (local-first constraint)", () => {
		expect(PRESENTATION_SCRIPT).not.toMatch(/https?:\/\/cdn\./i);
	});
});

describe('PRESENTATION_SCRIPT — jump to slide ("g" + digits + Enter)', () => {
	it('starts a jump on "g"/"G" and creates an on-screen digit indicator', () => {
		expect(PRESENTATION_SCRIPT).toContain('event.key === "g"');
		expect(PRESENTATION_SCRIPT).toContain('event.key === "G"');
		expect(PRESENTATION_SCRIPT).toContain("startJump");
		expect(PRESENTATION_SCRIPT).toContain("presentation-jump-indicator");
	});

	it("accumulates digit keypresses into jumpDigits via appendJumpDigit, and shows them in the indicator's text", () => {
		expect(PRESENTATION_SCRIPT).toContain("appendJumpDigit");
		expect(PRESENTATION_SCRIPT).toContain("jumpDigits += digit");
		expect(PRESENTATION_SCRIPT).toContain('"Go to: " + jumpDigits');
	});

	it("confirms a pending jump on Enter via confirmJump, converting the 1-indexed typed number to goTo()'s 0-indexed convention", () => {
		expect(PRESENTATION_SCRIPT).toContain('event.key === "Enter"');
		expect(PRESENTATION_SCRIPT).toContain("confirmJump");
		expect(PRESENTATION_SCRIPT).toContain("requestedSlideNumber - 1");
	});

	it("clamps an out-of-range typed slide number into the valid slide range instead of doing nothing or throwing", () => {
		expect(PRESENTATION_SCRIPT).toContain("Math.min(");
		expect(PRESENTATION_SCRIPT).toContain(
			"Math.max(requestedSlideNumber - 1, 0)",
		);
		expect(PRESENTATION_SCRIPT).toContain("slides.length - 1,\n    );");
	});

	it("cancels a pending jump without navigating when Enter is pressed with no digits typed", () => {
		const confirmJumpBody = PRESENTATION_SCRIPT.slice(
			PRESENTATION_SCRIPT.indexOf("const confirmJump = () =>"),
			PRESENTATION_SCRIPT.indexOf("const confirmJump = () =>") + 400,
		);
		expect(confirmJumpBody).toContain("cancelJump();");
		expect(confirmJumpBody).toContain("if (!digits) {");
	});

	it('folds jump-cancellation into the keydown listener\'s existing Escape branch as its FIRST, highest-precedence case, ahead of helpOpen/overviewOpen (no second "event.key === \\"Escape\\"" check is introduced)', () => {
		const escapeOccurrences =
			PRESENTATION_SCRIPT.split('event.key === "Escape"').length - 1;
		expect(escapeOccurrences).toBe(1);

		const escapeIndex = PRESENTATION_SCRIPT.indexOf('event.key === "Escape"');
		const escapeBranch = PRESENTATION_SCRIPT.slice(
			escapeIndex,
			PRESENTATION_SCRIPT.indexOf('event.key === "?"'),
		);
		expect(escapeBranch).toContain("isJumpPending()");
		expect(escapeBranch).toContain("cancelJump();");
		expect(escapeBranch.indexOf("isJumpPending()")).toBeLessThan(
			escapeBranch.indexOf("helpOpen"),
		);
	});

	it('suppresses every other key (arrows/Home/End/Space/"?"/"p"/"o") while a jump is pending, via a bare return at the end of the jumpDigits block', () => {
		const keydownListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("keydown"',
		);
		const questionMarkIndex = PRESENTATION_SCRIPT.indexOf(
			'event.key === "?"',
			keydownListenerStart,
		);
		// The FIRST "if (isJumpPending())" after keydownListenerStart is
		// actually inside the Escape branch above (`if (isJumpPending()) {
		// cancelJump(); }`) -- the standalone swallow-everything-else block this
		// test cares about only comes after the "?" branch, so search from
		// questionMarkIndex, not keydownListenerStart, to find that one
		// specifically (mirrors the "p"-precedence test's own identical
		// disambiguation below).
		const jumpBlockIndex = PRESENTATION_SCRIPT.indexOf(
			"if (isJumpPending()) {",
			questionMarkIndex,
		);
		const pKeyIndex = PRESENTATION_SCRIPT.indexOf(
			'event.key === "p"',
			keydownListenerStart,
		);
		expect(jumpBlockIndex).toBeGreaterThan(-1);
		// The jumpDigits block is checked right after "?" and before "p" --
		// see this file's own module docstring for the full precedence
		// reasoning.
		expect(jumpBlockIndex).toBeGreaterThan(questionMarkIndex);
		expect(jumpBlockIndex).toBeLessThan(pKeyIndex);
	});

	it('starts a new jump via "g" only after BOTH the helpOpen and overviewOpen early-returns, so "g" can never start a jump while either is open', () => {
		const keydownListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("keydown"',
		);
		const gKeyIndex = PRESENTATION_SCRIPT.indexOf(
			'event.key === "g"',
			keydownListenerStart,
		);
		// Specifically the standalone suppression guard (`if (helpOpen) {
		// return; }`), not the Escape/"?" branches' own "helpOpen" checks
		// (which read as "else if (helpOpen)"/"if (helpOpen)" followed by
		// closeHelp(), not a bare return) -- see the "p"-precedence test above
		// for the identical disambiguation concern.
		const helpOpenGuardIndex = PRESENTATION_SCRIPT.indexOf(
			"if (helpOpen) {\n      return;",
			keydownListenerStart,
		);
		const overviewOpenGuardIndex = PRESENTATION_SCRIPT.indexOf(
			"if (overviewOpen) {\n      return;",
			keydownListenerStart,
		);
		expect(helpOpenGuardIndex).toBeGreaterThan(-1);
		expect(overviewOpenGuardIndex).toBeGreaterThan(-1);
		expect(gKeyIndex).toBeGreaterThan(helpOpenGuardIndex);
		expect(gKeyIndex).toBeGreaterThan(overviewOpenGuardIndex);
	});

	it("suppresses the click listener's advance-to-next-slide and helpHint-open behavior while a jump is pending", () => {
		const clickListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("click"',
		);
		const jumpGuardIndex = PRESENTATION_SCRIPT.indexOf(
			"if (isJumpPending()) {",
			clickListenerStart,
		);
		const helpHintIndex = PRESENTATION_SCRIPT.indexOf(
			'closest(".presentation-help-hint")',
			clickListenerStart,
		);
		const advanceIndex = PRESENTATION_SCRIPT.indexOf(
			"advance();",
			clickListenerStart,
		);
		expect(jumpGuardIndex).toBeGreaterThan(-1);
		expect(jumpGuardIndex).toBeLessThan(helpHintIndex);
		expect(jumpGuardIndex).toBeLessThan(advanceIndex);
	});

	it("suppresses touch-swipe navigation while a jump is pending, same as the overview/help guards", () => {
		const touchendListenerStart = PRESENTATION_SCRIPT.indexOf(
			'addEventListener("touchend"',
		);
		const guard = PRESENTATION_SCRIPT.slice(
			touchendListenerStart,
			touchendListenerStart + 900,
		);
		expect(guard).toContain("isJumpPending()");
	});

	it("adds the jump-to-slide binding to the help overlay's own shortcut list, under Navigate", () => {
		const navigateIndex = PRESENTATION_SCRIPT.indexOf("<dt>Navigate</dt>");
		const viewIndex = PRESENTATION_SCRIPT.indexOf("<dt>View</dt>");
		const navigateSection = PRESENTATION_SCRIPT.slice(navigateIndex, viewIndex);
		expect(navigateSection).toContain("jump to slide");
		expect(navigateSection).toContain("G");
	});

	it("never uses a backtick inside the client-side script text (a stray backtick would prematurely terminate the outer template literal)", () => {
		expect(PRESENTATION_SCRIPT).not.toContain("`");
	});
});
