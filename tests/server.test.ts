import { describe, expect, it } from "vitest";
import { startServer } from "../src/server.js";

describe("startServer", () => {
	it("serves the given HTML on the resolved loopback URL", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, port, url } = await startServer(html, 0);

		expect(url).toBe(`http://127.0.0.1:${port}`);

		const response = await fetch(url);
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/html");
		expect(body).toBe(html);

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("assigns a real ephemeral port when none is specified", async () => {
		const { server, port } = await startServer("<p>x</p>");

		expect(port).toBeGreaterThan(0);

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
});
