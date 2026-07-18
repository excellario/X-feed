import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { startHttpServer } from "../src/http.js";
import type { Config } from "../src/config.js";

const AUTH_TOKEN = "test-secret-token-1234567890";
const config: Config = { apiKey: "dummy-key", defaultListId: "1234567890" };

let server: Server;
let base: string;

const INIT_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
});

before(async () => {
  server = startHttpServer(config, { port: 0, authToken: AUTH_TOKEN });
  await new Promise<void>((resolve) => {
    if (server.listening) return resolve();
    server.once("listening", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

test("GET /health is open", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
});

test("POST /mcp without auth is 401", async () => {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: INIT_BODY,
  });
  assert.equal(res.status, 401);
});

test("POST /mcp with bearer initializes", async () => {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: INIT_BODY,
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /x-feed-mcp/);
});

test("POST /mcp/<token> initializes (path-token auth)", async () => {
  const res = await fetch(`${base}/mcp/${AUTH_TOKEN}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: INIT_BODY,
  });
  assert.equal(res.status, 200);
});

test("POST /mcp/<wrong> is 401", async () => {
  const res = await fetch(`${base}/mcp/nope`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: INIT_BODY,
  });
  assert.equal(res.status, 401);
});
