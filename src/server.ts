import * as http from "node:http";

export interface StartedServer {
  server: http.Server;
  port: number;
  url: string;
}

/**
 * Starts a minimal local HTTP server that serves the given HTML to any GET
 * request. No framework, no external dependency — just node:http.
 *
 * This function does not print or log anything; the caller (the CLI
 * entrypoint) owns all user-facing output.
 */
export function startServer(html: string, port = 0): Promise<StartedServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
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
      });
    });
  });
}
