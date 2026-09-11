import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src/htmlEscape.js";

describe("escapeHtml", () => {
	it("escapes all five HTML-significant characters", () => {
		expect(escapeHtml(`<script>alert("x & y's")</script>`)).toBe(
			"&lt;script&gt;alert(&quot;x &amp; y&#39;s&quot;)&lt;/script&gt;",
		);
	});

	it("leaves plain text untouched", () => {
		expect(escapeHtml("plain text, no special chars")).toBe(
			"plain text, no special chars",
		);
	});
});
