/**
 * Streamable HTTP transport for remote deployment (e.g. Render), guarded by a
 * bearer token.
 *
 * SECURITY: a publicly reachable send endpoint MUST be authenticated, or anyone
 * who finds the URL could send WhatsApp messages on the configured account.
 * Every request to /mcp must carry `Authorization: Bearer <MCP_AUTH_TOKEN>`.
 * The server refuses to start over HTTP without a token configured.
 *
 * Runs in stateless mode: a fresh MCP server + transport is created per request,
 * which is simple and safe behind a single-instance host.
 */

import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { Config } from "./config.js";
import { buildServer, SERVER_NAME } from "./server.js";

export interface HttpOptions {
  port: number;
  authToken: string;
  /** Path the MCP endpoint is served on. Defaults to "/mcp". */
  path?: string;
}

/** Constant-time comparison that never throws on length mismatch. */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract and validate the bearer token from a request. */
function isAuthorized(req: IncomingMessage, expected: string): boolean {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  return tokensMatch(match[1], expected);
}

/** Write a JSON-RPC-shaped error response. */
function sendJsonError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

/** Read and JSON-parse a request body (capped to avoid unbounded buffering). */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const MAX_BYTES = 1_000_000; // 1 MB is ample for tool calls.
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("Request body too large.");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length ? JSON.parse(raw) : undefined;
}

/**
 * Start the HTTP server and begin listening.
 * @param config validated WhatsApp configuration
 * @param opts port, auth token, and optional path
 * @returns the underlying http.Server (useful for graceful shutdown in tests)
 */
export function startHttpServer(config: Config, opts: HttpOptions): Server {
  const path = opts.path ?? "/mcp";

  const pathPrefix = `${path}/`;

  const httpServer = createServer(async (req, res) => {
    const url = (req.url ?? "").split("?")[0];

    // Unauthenticated health check for the host's uptime probe.
    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: SERVER_NAME }));
      return;
    }

    // Diagnostic probe (token-guarded): GET /probe/<token>. Tests which X data
    // paths work from this host's IP. See probe.ts.
    if (req.method === "GET" && url.startsWith("/probe/")) {
      const segment = url.slice("/probe/".length);
      let decoded: string | null;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        decoded = null;
      }
      if (decoded === null || !tokensMatch(decoded, opts.authToken)) {
        sendJsonError(res, 401, -32001, "Unauthorized.");
        return;
      }
      const { runProbes } = await import("./probe.js");
      const results = await runProbes(config.apiKey);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(results, null, 2));
      return;
    }

    // The MCP endpoint is reachable two ways:
    //   /mcp          -> authorize via `Authorization: Bearer <token>` header
    //   /mcp/<token>  -> authorize via a secret in the path, for connector UIs
    //                    that cannot attach a custom header. The URL is then a
    //                    secret; see SECURITY.md.
    const isBase = url === path;
    const isPathToken = url.startsWith(pathPrefix);
    if (!isBase && !isPathToken) {
      sendJsonError(res, 404, -32000, "Not found.");
      return;
    }

    // Only POST carries MCP requests in stateless mode.
    if (req.method !== "POST") {
      sendJsonError(res, 405, -32000, "Method not allowed.");
      return;
    }

    let authorized: boolean;
    if (isPathToken) {
      const segment = url.slice(pathPrefix.length);
      let decoded: string | null;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        decoded = null;
      }
      authorized = decoded !== null && tokensMatch(decoded, opts.authToken);
    } else {
      authorized = isAuthorized(req, opts.authToken);
    }

    if (!authorized) {
      sendJsonError(res, 401, -32001, "Unauthorized.");
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJsonError(res, 400, -32700, "Invalid or oversized JSON body.");
      return;
    }

    // Stateless: fresh server + transport per request, torn down on close.
    const server = buildServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        sendJsonError(res, 500, -32603, "Internal server error.");
      }
      process.stderr.write(
        `[${SERVER_NAME}] request error: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  });

  httpServer.listen(opts.port, () => {
    process.stderr.write(
      `[${SERVER_NAME}] send-only server ready (HTTP) on port ${opts.port}, ` +
        `MCP endpoint ${path}, bearer auth required.\n`,
    );
  });

  return httpServer;
}

/**
 * Keep a free-tier host (e.g. Render) awake by self-pinging its own /health on
 * an interval. This generates inbound traffic so the instance is not spun down
 * for inactivity. Hitting /health needs no auth and leaks nothing.
 *
 * @param baseUrl the app's own public base URL (e.g. RENDER_EXTERNAL_URL)
 * @param intervalMs ping interval; default 10 min (host sleeps after ~15 min idle)
 * @returns the interval timer (unref'd so it never blocks process exit)
 */
export function startKeepalive(
  baseUrl: string,
  intervalMs: number = 10 * 60 * 1000,
): NodeJS.Timeout {
  const url = `${baseUrl.replace(/\/+$/, "")}/health`;
  const timer = setInterval(() => {
    // Fire-and-forget; a failed ping is not fatal, the next one will retry.
    void fetch(url, { method: "GET" }).catch(() => {
      /* ignore transient errors */
    });
  }, intervalMs);
  timer.unref?.();
  process.stderr.write(
    `[${SERVER_NAME}] keepalive self-ping enabled: ${url} every ${Math.round(
      intervalMs / 60000,
    )} min.\n`,
  );
  return timer;
}
