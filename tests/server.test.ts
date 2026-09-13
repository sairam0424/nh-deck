import * as http from "node:http";
import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { startServer } from "../src/server.js";

function getWithHeaders(
	url: string,
	headers: http.OutgoingHttpHeaders,
): Promise<{ res: http.IncomingMessage; body: Buffer }> {
	return new Promise((resolve, reject) => {
		const req = http.get(url, { headers }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => resolve({ res, body: Buffer.concat(chunks) }));
			res.on("error", reject);
		});
		req.on("error", reject);
	});
}

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

describe("startServer — gzip compression", () => {
	it("gzip-compresses the response when the client sends Accept-Encoding: gzip", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, url } = await startServer(html, 0);

		const { res, body } = await getWithHeaders(url, {
			"Accept-Encoding": "gzip",
		});

		expect(res.headers["content-encoding"]).toBe("gzip");
		const decompressed = await new Promise<string>((resolve, reject) => {
			zlib.gunzip(body, (err, result) => {
				if (err) reject(err);
				else resolve(result.toString("utf8"));
			});
		});
		expect(decompressed).toBe(html);

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("serves an uncompressed response with no Content-Encoding when the client sends no Accept-Encoding header", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, url } = await startServer(html, 0);

		const { res, body } = await getWithHeaders(url, {});

		expect(res.headers["content-encoding"]).toBeUndefined();
		expect(body.toString("utf8")).toBe(html);

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("does NOT gzip-compress when the client explicitly disallows it with gzip;q=0", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, url } = await startServer(html, 0);

		const { res, body } = await getWithHeaders(url, {
			"Accept-Encoding": "gzip;q=0",
		});

		expect(res.headers["content-encoding"]).toBeUndefined();
		expect(body.toString("utf8")).toBe(html);

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("matches the gzip coding case-insensitively (GZip)", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, url } = await startServer(html, 0);

		const { res } = await getWithHeaders(url, { "Accept-Encoding": "GZip" });

		expect(res.headers["content-encoding"]).toBe("gzip");

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("does not treat an unrelated coding token like gzip-extra as gzip support", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, url } = await startServer(html, 0);

		const { res, body } = await getWithHeaders(url, {
			"Accept-Encoding": "gzip-extra",
		});

		expect(res.headers["content-encoding"]).toBeUndefined();
		expect(body.toString("utf8")).toBe(html);

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("permits gzip via a bare wildcard (*;q=1) when no explicit gzip entry exists", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, url } = await startServer(html, 0);

		const { res } = await getWithHeaders(url, {
			"Accept-Encoding": "*;q=1",
		});

		expect(res.headers["content-encoding"]).toBe("gzip");

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("lets an explicit gzip;q=0 override a permissive wildcard (*;q=1)", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, url } = await startServer(html, 0);

		const { res, body } = await getWithHeaders(url, {
			"Accept-Encoding": "gzip;q=0,*;q=1",
		});

		expect(res.headers["content-encoding"]).toBeUndefined();
		expect(body.toString("utf8")).toBe(html);

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("serves an uncompressed response for an explicit empty Accept-Encoding header", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, url } = await startServer(html, 0);

		const { res, body } = await getWithHeaders(url, { "Accept-Encoding": "" });

		expect(res.headers["content-encoding"]).toBeUndefined();
		expect(body.toString("utf8")).toBe(html);

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("clamps an out-of-range q-value (gzip;q=2) rather than treating it as a valid positive preference", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, url } = await startServer(html, 0);

		const { res } = await getWithHeaders(url, {
			"Accept-Encoding": "gzip;q=2",
		});

		// q=2 is malformed per RFC 7231's 0-1 range, but it is still a positive
		// number, not NaN -- gzip is clamped to fully acceptable (q=1), not
		// rejected outright, since the client did express *some* preference
		// for it. The regression this guards is treating clamping as
		// optional and passing the literal out-of-range value through.
		expect(res.headers["content-encoding"]).toBe("gzip");

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("does not treat a non-finite q-value (gzip;q=Infinity) as a valid positive preference", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, url } = await startServer(html, 0);

		const { res } = await getWithHeaders(url, {
			"Accept-Encoding": "gzip;q=Infinity",
		});

		expect(res.headers["content-encoding"]).toBe("gzip");

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("clamps a negative q-value (gzip;q=-1) down to 0, disallowing gzip", async () => {
		const html = "<!DOCTYPE html><html><body><p>hello</p></body></html>";
		const { server, url } = await startServer(html, 0);

		const { res, body } = await getWithHeaders(url, {
			"Accept-Encoding": "gzip;q=-1",
		});

		expect(res.headers["content-encoding"]).toBeUndefined();
		expect(body.toString("utf8")).toBe(html);

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("still gzip-compresses the reload-injected HTML in watch mode", async () => {
		const html = "<!DOCTYPE html><html><body><p>v1</p></body></html>";
		const { server, url } = await startServer(html, 0, { watch: true });

		const { res, body } = await getWithHeaders(url, {
			"Accept-Encoding": "gzip",
		});

		expect(res.headers["content-encoding"]).toBe("gzip");
		const decompressed = await new Promise<string>((resolve, reject) => {
			zlib.gunzip(body, (err, result) => {
				if (err) reject(err);
				else resolve(result.toString("utf8"));
			});
		});
		expect(decompressed).toContain("<script>");
		expect(decompressed).toContain("/__nh-deck-reload");

		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("never gzip-compresses the SSE reload endpoint itself", async () => {
		const { server, url } = await startServer("<p>x</p>", 0, { watch: true });

		// The SSE endpoint's connection never ends on its own, so this checks
		// headers as soon as they arrive rather than waiting for the response
		// body to finish (getWithHeaders's "end" event would never fire here).
		const req = http.get(
			`${url}/__nh-deck-reload`,
			{ headers: { "Accept-Encoding": "gzip" } },
			(res) => {
				expect(res.headers["content-encoding"]).toBeUndefined();
				req.destroy();
			},
		);
		await new Promise<void>((resolve) => req.once("close", resolve));

		server.closeAllConnections();
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

	it("does not crash or block delivery to other SSE clients when one client's connection is destroyed", async () => {
		// NOTE ON SCOPE: this test proves the broadcast loop is resilient to a
		// dead socket -- it does NOT prove the server.ts `req.on("close", ...)`
		// splice-cleanup logic actually ran. `sseClients` is a private closure
		// variable with no accessor on `StartedServer`, so this suite has no
		// way to observe its length from outside and cannot assert that a
		// destroyed client was removed from it. Node's `res.write()` on an
		// already-destroyed `http.ServerResponse` returns `false` silently
		// rather than throwing or emitting an `error` event, so this
		// broadcast would still reach clientB and still not crash even if the
		// splice never ran. Treat dead-socket *cleanup* (the leak-prevention
		// concern -- an unbounded `sseClients` array from tabs that were
		// closed without a graceful disconnect) as behaviorally unverified by
		// this suite until `StartedServer` exposes something to inspect it.
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
		// destroying the socket directly rather than a graceful req.end(). A
		// promise on the destroyed request's own "close" event (rather than a
		// fixed sleep) waits for the client side to observe the disconnect
		// before the next broadcast, with no arbitrary delay needed.
		const clientAClosed = new Promise<void>((resolve) =>
			clientA.req.once("close", resolve),
		);
		clientA.req.destroy();
		await clientAClosed;

		updateHtml("<p>v2</p>");

		// The remaining client must still receive the reload event, and the
		// broadcast loop must not throw partway through iterating a client
		// list that still contains (or has already dropped) clientA's dead
		// response object.
		const message = await clientB.messagePromise;
		expect(message).toContain("data: reload");

		clientB.req.destroy();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
});
