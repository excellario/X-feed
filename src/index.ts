#!/usr/bin/env node
/**
 * x-feed-mcp — a least-privilege, read-only MCP server for a single X List.
 *
 * One tool: get_list_tweets. No writes, no posting, no DMs, no other reads.
 *
 * Transport is selected via MCP_TRANSPORT:
 *   - "stdio" (default): local use by an MCP client that launches this process.
 *   - "http": remote deployment (e.g. Render), guarded by a bearer token.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig, ConfigError } from "./config.js";
import { buildServer, SERVER_NAME } from "./server.js";
import { startHttpServer, startKeepalive } from "./http.js";

function fail(message: string): never {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) fail(err.message);
    throw err;
  }

  const transport = (process.env.MCP_TRANSPORT ?? "stdio").trim().toLowerCase();

  if (transport === "http") {
    const authToken = process.env.MCP_AUTH_TOKEN?.trim();
    if (!authToken) {
      fail(
        "MCP_TRANSPORT=http requires MCP_AUTH_TOKEN to be set. A public " +
          "endpoint must be authenticated. Set a long random secret and pass " +
          "it as `Authorization: Bearer <token>` (or /mcp/<token>) from the client.",
      );
    }
    if (authToken.length < 16) {
      fail("MCP_AUTH_TOKEN is too short; use at least 16 random characters.");
    }
    const port = Number(process.env.PORT ?? "3000");
    if (!Number.isInteger(port) || port <= 0) {
      fail(`Invalid PORT: ${process.env.PORT}`);
    }
    startHttpServer(config, { port, authToken });

    const selfUrl = (
      process.env.KEEPALIVE_URL ??
      process.env.RENDER_EXTERNAL_URL ??
      ""
    ).trim();
    if (selfUrl) {
      const minutes = Number(process.env.KEEPALIVE_MINUTES ?? "10");
      const intervalMs =
        Number.isFinite(minutes) && minutes > 0
          ? minutes * 60 * 1000
          : 10 * 60 * 1000;
      startKeepalive(selfUrl, intervalMs);
    }
    return;
  }

  if (transport !== "stdio") {
    fail(`Unknown MCP_TRANSPORT "${transport}". Use "stdio" or "http".`);
  }

  const server = buildServer(config);
  await server.connect(new StdioServerTransport());

  process.stderr.write(
    `[${SERVER_NAME}] read-only server ready (stdio). Exposes 1 tool: get_recent_tweets.\n`,
  );
}

main().catch((err) => {
  fail(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
});
