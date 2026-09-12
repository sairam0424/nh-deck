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

	it("rejects with the bind error when the port is already in use", async () => {
		const first = await startServer("<p>first</p>", 0);

		await expect(
			startServer("<p>second</p>", first.port),
		).rejects.toMatchObject({
			code: "EADDRINUSE",
		});

		await new Promise<void>((resolve) => first.server.close(() => resolve()));
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

	it("appends the reload script via string concatenation when the HTML has no </body> tag", async () => {
		const html = "<p>no closing body tag here</p>";
		const { server, url } = await startServer(html, 0, { watch: true });

		const response = await fetch(url);
		const body = await response.text();

		// No </body> for withReloadScript to splice into, so it must fall back
		// to plain concatenation (`${html}${RELOAD_SCRIPT}`) rather than
		// silently dropping the reload script.
		expect(body.startsWith(html)).toBe(true);
		expect(body.slice(html.length)).toContain("<script>");
		expect(body).toContain("/__nh-deck-reload");
		expect(body).not.toMatch(/https?:\/\//);

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

	/**
	 * Connects a raw http.get() SSE client to the reload endpoint and
	 * resolves once headers arrive (registration on the server's
	 * sseClients array happens synchronously before headers are flushed,
	 * matching the reasoning in the single-client reload test above).
	 * Returns both the request (so a test can later req.destroy() it to
	 * simulate a dropped connection) and a promise for the first message
	 * chunk it receives.
	 */
	function connectSseClient(
		url: string,
	): Promise<{ req: http.ClientRequest; messagePromise: Promise<string> }> {
		return new Promise((resolveConnect, rejectConnect) => {
			const req = http.get(`${url}/__nh-deck-reload`, (res) => {
				const messagePromise = new Promise<string>(
					(resolveMessage, rejectMessage) => {
						res.on("data", (chunk: Buffer) => resolveMessage(chunk.toString()));
						res.on("error", rejectMessage);
					},
				);
				resolveConnect({ req, messagePromise });
			});
			req.on("error", rejectConnect);
		});
	}

	it("pushes a reload event to every connected SSE client, not just one", async () => {
		const { server, url, updateHtml } = await startServer("<p>v1</p>", 0, {
			watch: true,
		});

		const clientA = await connectSseClient(url);
		const clientB = await connectSseClient(url);

		updateHtml("<p>v2</p>");

		const [messageA, messageB] = await Promise.all([
			clientA.messagePromise,
			clientB.messagePromise,
		]);
		expect(messageA).toContain("data: reload");
		expect(messageB).toContain("data: reload");

		clientA.req.destroy();
		clientB.req.destroy();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("keeps broadcasting to remaining SSE clients after one client's connection is destroyed", async () => {
		const { server, url, updateHtml } = await startServer("<p>v1</p>", 0, {
			watch: true,
		});

		const clientA = await connectSseClient(url);
		const clientB = await connectSseClient(url);

		// clientA's own message promise never resolves once its connection is
		// destroyed below -- mark it handled so the abort surfaces as neither
		// an unhandled rejection nor a false test failure.
		clientA.messagePromise.catch(() => {});

		// Simulate a dropped connection (closed tab, lost network) by
		// destroying the socket directly rather than a graceful req.end() --
		// this is what actually fires the server's req.on("close", ...)
		// handler that splices the client out of sseClients. A promise on
		// the destroyed request's own "close" event (rather than a fixed
		// sleep) waits for exactly that cleanup to run before the next
		// broadcast, with no arbitrary delay needed.
		const clientAClosed = new Promise<void>((resolve) =>
			clientA.req.once("close", resolve),
		);
		clientA.req.destroy();
		await clientAClosed;

		updateHtml("<p>v2</p>");

		// The remaining client must still receive the reload event. If the
		// disconnected client had NOT been spliced out of sseClients, this
		// broadcast would attempt to write to its dead socket -- proving
		// that didn't crash the server or block delivery to clientB.
		const message = await clientB.messagePromise;
		expect(message).toContain("data: reload");

		clientB.req.destroy();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
});
