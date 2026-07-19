import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.js";
import { XClient } from "../src/xclient.js";
import { parseNitterRss } from "../src/nitter.js";

// --- config -----------------------------------------------------------------

test("loadConfig: succeeds with no credentials (Nitter needs none)", () => {
  const c = loadConfig({} as NodeJS.ProcessEnv);
  assert.equal(c.apiKey, undefined);
  assert.deepEqual(c.defaultHandles, []);
});

test("loadConfig: keeps optional X_API_KEY when present", () => {
  const c = loadConfig({ X_API_KEY: "abc" } as NodeJS.ProcessEnv);
  assert.equal(c.apiKey, "abc");
});

test("loadConfig: parses X_HANDLES (comma/space, strips @)", () => {
  const c = loadConfig({
    X_HANDLES: "@sama, OpenAI  @karpathy",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(c.defaultHandles, ["sama", "OpenAI", "karpathy"]);
});

test("loadConfig: parses NITTER_INSTANCES", () => {
  const c = loadConfig({
    NITTER_INSTANCES: "nitter.net, xcancel.com",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(c.nitterInstances, ["nitter.net", "xcancel.com"]);
});

// --- Nitter RSS parsing (no network) -----------------------------------------

const SAMPLE_RSS = `<rss><channel>
<item>
  <title>Pinned: an old announcement</title>
  <dc:creator>@OpenAI</dc:creator>
  <pubDate>Mon, 01 Jan 2026 10:00:00 GMT</pubDate>
  <link>https://nitter.net/OpenAI/status/111#m</link>
</item>
<item>
  <title>R to @someone: a reply body</title>
  <dc:creator>@OpenAI</dc:creator>
  <pubDate>Tue, 02 Jan 2026 10:00:00 GMT</pubDate>
  <link>https://nitter.net/OpenAI/status/222#m</link>
</item>
<item>
  <title>We shipped GPT-5.6 today &amp; it&apos;s great</title>
  <dc:creator>@OpenAI</dc:creator>
  <pubDate>Wed, 03 Jan 2026 10:00:00 GMT</pubDate>
  <link>https://nitter.net/OpenAI/status/333#m</link>
</item>
</channel></rss>`;

test("parseNitterRss: extracts id, url, text, flags", () => {
  const tweets = parseNitterRss(SAMPLE_RSS, "OpenAI");
  assert.equal(tweets.length, 3);

  const pinned = tweets.find((t) => t.id === "111");
  assert.equal(pinned?.isPinned, true);

  const reply = tweets.find((t) => t.id === "222");
  assert.equal(reply?.isReply, true);
  assert.equal(reply?.text, "a reply body");

  const original = tweets.find((t) => t.id === "333");
  assert.equal(original?.isReply, false);
  assert.equal(original?.text, "We shipped GPT-5.6 today & it's great");
  assert.equal(original?.url, "https://x.com/OpenAI/status/333");
});

// --- client input validation (no network) -----------------------------------

test("getTweets: no handles and no default is invalid_input", async () => {
  const client = new XClient(undefined);
  const r = await client.getTweets(undefined, 20);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.category, "invalid_input");
});

test("getTweets: empty handle array with empty default -> invalid_input", async () => {
  const client = new XClient(undefined, []);
  const r = await client.getTweets([], 20);
  assert.equal(r.ok === false && r.category, "invalid_input");
});
