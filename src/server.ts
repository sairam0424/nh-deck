import * as http from "node:http";
import * as zlib from "node:zlib";

export interface StartedServer {
	server: http.Server;
	port: number;
	url: string;
	/**
	 * Updates the HTML this server serves on subsequent requests. In watch
	 * mode, also pushes a reload event to every currently-connected SSE
	 * client, so an open browser tab refreshes automatically.
	 */
	updateHtml: (html: string) => void;
}

export interface StartServerOptions {
	/**
	 * When true, serves a same-origin Server-Sent-Events endpoint
	 * (RELOAD_PATH) and injects a small inline reload script into every
	 * served document. The script is never CDN-hosted — it's embedded
	 * directly in the response, so it never leaves loopback.
	 */
	watch?: boolean;
}

const RELOAD_PATH = "/__nh-deck-reload";

const RELOAD_SCRIPT = `<script>
new EventSource(${JSON.stringify(RELOAD_PATH)}).onmessage = () => location.reload();
</script>`;

function withReloadScript(html: string): string {
	return html.includes("</body>")
		? html.replace("</body>", `${RELOAD_SCRIPT}\n</body>`)
		: `${html}${RELOAD_SCRIPT}`;
}

interface EncodingPreference {
	coding: string;
	q: number;
}

function parseAcceptEncoding(header: string): EncodingPreference[] {
	return header
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => {
			const [coding, ...params] = entry.split(";").map((part) => part.trim());
			const qParam = params.find((param) =>
				param.toLowerCase().startsWith("q="),
			);
			// Number(), not Number.parseFloat() -- parseFloat parses only a
			// leading numeric prefix and silently ignores trailing garbage, so
			// "0junk" would parse as the literal, valid-looking value 0
			// instead of being recognized as malformed. Number() requires the
			// entire string to be numeric, correctly returning NaN for it.
			const parsed = qParam ? Number(qParam.slice(2)) : 1;
			// A q-value is only ever meaningful in [0, 1] per RFC 7231 -- a
			// malformed (NaN, e.g. "q=abc" or "q=0junk") or non-finite (e.g.
			// "q=Infinity") value defaults to fully acceptable (the client
			// expressed *some* preference for this coding, just not a
			// parseable strength), and an out-of-range value (negative, or
			// >1) is clamped rather than stored as-is, so nothing downstream
			// can be misled by a q of -1 or 2 into a wrong preference
			// ordering.
			const q = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1;
			return { coding: coding.toLowerCase(), q };
		});
}

/**
 * RFC 7231 §5.3.4 Accept-Encoding negotiation for gzip specifically: an
 * explicit "gzip" entry's q-value (including q=0, which explicitly forbids
 * it) always takes precedence over a "*" wildcard entry, and coding names
 * are matched case-insensitively and exactly -- a naive prefix match would
 * wrongly accept "gzip;q=0" (explicitly disallowed) or an unrelated coding
 * like "gzip-extra".
 */
function acceptsGzip(req: http.IncomingMessage): boolean {
	const header = req.headers["accept-encoding"];
	if (typeof header !== "string") {
		return false;
	}
	const preferences = parseAcceptEncoding(header);
	const explicitGzip = preferences.find((pref) => pref.coding === "gzip");
	if (explicitGzip) {
		return explicitGzip.q > 0;
	}
	const wildcard = preferences.find((pref) => pref.coding === "*");
	return wildcard ? wildcard.q > 0 : false;
}

function sendHtml(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	html: string,
): void {
	if (!acceptsGzip(req)) {
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(html);
		return;
	}
	zlib.gzip(html, (err, compressed) => {
		if (err) {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(html);
			return;
		}
		res.writeHead(200, {
			"Content-Type": "text/html",
			"Content-Encoding": "gzip",
		});
		res.end(compressed);
	});
}

/**
 * Starts a minimal local HTTP server that serves the given HTML to any GET
 * request. No framework, no external dependency — just node:http.
 *
 * This function does not print or log anything; the caller (the CLI
 * entrypoint) owns all user-facing output.
 */
export function startServer(
	html: string,
	port = 0,
	options: StartServerOptions = {},
): Promise<StartedServer> {
	let currentHtml = html;
	const sseClients: http.ServerResponse[] = [];

	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			if (options.watch && req.url === RELOAD_PATH) {
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				});
				sseClients.push(res);
				// Flush headers immediately rather than waiting for the first
				// SSE message. Without this, Node buffers the header block
				// until the first res.write(), so a connected browser's
				// EventSource would not report the connection as open until
				// the first reload event — long after it actually connected.
				res.flushHeaders();
				req.on("close", () => {
					const index = sseClients.indexOf(res);
					if (index !== -1) sseClients.splice(index, 1);
				});
				return;
			}

			sendHtml(
				req,
				res,
				options.watch ? withReloadScript(currentHtml) : currentHtml,
			);
		});

		server.once("error", (err) => {
			reject(err);
		});

		server.listen(port, "127.0.0.1", () => {
			const address = server.address();
			const boundPort =
				typeof address === "object" && address !== null ? address.port : port;
			resolve({
				server,
				port: boundPort,
				url: `http://127.0.0.1:${boundPort}`,
				updateHtml: (newHtml: string) => {
					currentHtml = newHtml;
					if (options.watch) {
						for (const client of sseClients) {
							client.write("data: reload\n\n");
						}
					}
				},
			});
		});
	});
}
