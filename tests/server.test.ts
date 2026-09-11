import * as http from "node:http";
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

describe("startServer — watch mode", () => {
	it("does not inject a reload script or expose the SSE endpoint when watch is off", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, url } = await startServer(html, 0);

		const response = await fetch(url);
		const body = await response.text();
		expect(body).toBe(html);

		const sseResponse = await fetch(`${url}/__nh-deck-reload`);
		expect(sseResponse.status).toBe(200);
		expect(sseResponse.headers.get("content-type")).toBe("text/html");

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("injects an inline reload script (never a CDN reference) when watch is on", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, url } = await startServer(html, 0, { watch: true });

		const response = await fetch(url);
		const body = await response.text();

		expect(body).toContain("<script>");
		expect(body).toContain("/__nh-deck-reload");
		expect(body).not.toMatch(/https?:\/\//);

		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("pushes a reload event to a connected SSE client when updateHtml is called", async () => {
		const { server, url, updateHtml } = await startServer("<p>v1</p>", 0, {
			watch: true,
		});

		const messagePromise = new Promise<string>((resolve, reject) => {
			const req = http.get(`${url}/__nh-deck-reload`, (res) => {
				// The response headers only arrive once the server has already
				// registered this client in its SSE client list (registration
				// happens synchronously, before the headers are flushed), so
				// triggering the update here — instead of after a fixed sleep —
				// removes the race with no arbitrary delay needed.
				res.on("data", (chunk: Buffer) => resolve(chunk.toString()));
				res.on("error", reject);
				updateHtml("<p>v2</p>");
			});
			req.on("error", reject);
		});

		const message = await messagePromise;
		expect(message).toContain("data: reload");

		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("serves the updated HTML after updateHtml, even without watch mode", async () => {
		const { server, url, updateHtml } = await startServer("<p>v1</p>", 0);

		updateHtml("<p>v2</p>");
		const response = await fetch(url);
		const body = await response.text();

		expect(body).toBe("<p>v2</p>");

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
});
