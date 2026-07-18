import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig, ConfigError } from "../src/config.js";
import { XClient } from "../src/xclient.js";

// --- config -----------------------------------------------------------------

test("loadConfig: succeeds with X_API_KEY", () => {
  const c = loadConfig({ X_API_KEY: "abc" } as NodeJS.ProcessEnv);
  assert.equal(c.apiKey, "abc");
  assert.deepEqual(c.defaultHandles, []);
});

test("loadConfig: throws without X_API_KEY", () => {
  assert.throws(
    () => loadConfig({} as NodeJS.ProcessEnv),
    (e: unknown) => e instanceof ConfigError && e.message.includes("X_API_KEY"),
  );
});

test("loadConfig: parses X_HANDLES (comma/space, strips @)", () => {
  const c = loadConfig({
    X_API_KEY: "abc",
    X_HANDLES: "@sama, OpenAI  @karpathy",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(c.defaultHandles, ["sama", "OpenAI", "karpathy"]);
});

test("loadConfig error never contains the api key value", () => {
  try {
    loadConfig({ X_HANDLES: "x" } as NodeJS.ProcessEnv);
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    assert.equal(e instanceof ConfigError && e.message.includes("abc"), false);
  }
});

// --- client input validation (no network) -----------------------------------

test("getTweets: no handles and no default is invalid_input", async () => {
  const client = new XClient("dummy-key");
  const r = await client.getTweets(undefined, 20);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.category, "invalid_input");
});

test("getTweets: empty handle array falls back to default (still empty) -> invalid_input", async () => {
  const client = new XClient("dummy-key", []);
  const r = await client.getTweets([], 20);
  assert.equal(r.ok === false && r.category, "invalid_input");
});
