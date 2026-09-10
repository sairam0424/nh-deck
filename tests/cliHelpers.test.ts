import { InvalidArgumentError } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce, parsePort, resolveOutputPath } from "../src/cliHelpers.js";

describe("parsePort", () => {
	it("accepts valid integer ports, including the boundaries", () => {
		expect(parsePort("0")).toBe(0);
		expect(parsePort("65535")).toBe(65535);
		expect(parsePort("3000")).toBe(3000);
	});

	it("rejects non-numeric input", () => {
		expect(() => parsePort("abc")).toThrow(InvalidArgumentError);
	});

	it("rejects negative numbers", () => {
		expect(() => parsePort("-1")).toThrow(InvalidArgumentError);
	});

	it("rejects numbers above the valid port range", () => {
		expect(() => parsePort("65536")).toThrow(InvalidArgumentError);
	});

	it("rejects non-integer numbers", () => {
		expect(() => parsePort("3000.5")).toThrow(InvalidArgumentError);
	});
});

describe("resolveOutputPath", () => {
	it("replaces a .md extension with .pdf when no output is given", () => {
		expect(resolveOutputPath("deck.md")).toBe("deck.pdf");
	});

	it("appends .pdf instead of no-op'ing when the input has no .md suffix", () => {
		expect(resolveOutputPath("deck")).toBe("deck.pdf");
		expect(resolveOutputPath("deck.markdown")).toBe("deck.markdown.pdf");
	});

	it("uses the explicit output path when one is given", () => {
		expect(resolveOutputPath("deck.md", "custom-name.pdf")).toBe(
			"custom-name.pdf",
		);
	});

	it("refuses to resolve to the same path as the input file", () => {
		expect(() => resolveOutputPath("deck.md", "deck.md")).toThrow(
			/Refusing to overwrite the source file/,
		);
	});
});

describe("debounce", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("collapses rapid-fire calls into a single invocation after the delay", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced();
		debounced();
		debounced();

		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("passes through only the latest call's arguments", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 50);

		debounced("first");
		debounced("second");
		vi.advanceTimersByTime(50);

		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith("second");
	});

	it("does not fire before the delay has elapsed", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced();
		vi.advanceTimersByTime(99);

		expect(fn).not.toHaveBeenCalled();
	});

	it("fires again for a call made after a previous debounced call already resolved", () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced();
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);

		debounced();
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
