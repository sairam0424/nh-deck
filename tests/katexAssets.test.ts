import { describe, expect, it } from "vitest";
import { getEmbeddedKatexCss } from "../src/katexAssets.js";

describe("getEmbeddedKatexCss", () => {
	it("returns CSS with every @font-face src rewritten to a base64 data URI", () => {
		const css = getEmbeddedKatexCss();

		expect(css).toContain("@font-face");
		expect(css).toContain("url(data:font/woff2;base64,");
	});

	it("leaves no relative fonts/ path references behind", () => {
		const css = getEmbeddedKatexCss();

		expect(css).not.toMatch(/url\(fonts\//);
	});

	it("never references an external CDN (local-first constraint)", () => {
		const css = getEmbeddedKatexCss();

		expect(css).not.toMatch(/https?:\/\/cdn\./i);
		expect(css).not.toContain("unpkg.com");
		expect(css).not.toContain("jsdelivr.net");
		expect(css).not.toContain("cdnjs.cloudflare.com");
	});

	it("memoizes the result across repeated calls", () => {
		const first = getEmbeddedKatexCss();
		const second = getEmbeddedKatexCss();

		expect(first).toBe(second);
	});
});
