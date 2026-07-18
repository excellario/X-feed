/**
 * Manual test: fetch and print recent tweets from the tracked handles.
 * Hits the real X endpoints using your X_API_KEY, so it needs valid cookies.
 *
 * Usage:
 *   npm run test:feed                         # X_HANDLES, 30 tweets
 *   npm run test:feed -- 30 @sama @OpenAI     # count then explicit handles
 */

import { loadConfig, ConfigError } from "../src/config.js";
import { XClient } from "../src/xclient.js";

try {
  // @ts-expect-error loadEnvFile exists on Node 20.6+ but may be missing in types.
  process.loadEnvFile?.(".env");
} catch {
  /* rely on ambient env */
}

async function run(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Config error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const args = process.argv.slice(2);
  const count = args.length && /^\d+$/.test(args[0]) ? Number(args.shift()) : 30;
  const handles = args.length ? args : undefined;

  const client = new XClient(config.apiKey, config.defaultHandles);
  console.log(
    `Fetching ${count} tweets from ${handles ? handles.length + " handle(s)" : "default handles"} ...`,
  );
  const result = await client.getTweets(handles, count);

  if (result.ok) {
    console.log(`Got ${result.tweets.length} tweet(s) from ${result.handles.length} handles:\n`);
    for (const t of result.tweets) {
      console.log(`@${t.handle}: ${t.text.slice(0, 110).replace(/\n/g, " ")}`);
      console.log(`  ${t.url}\n`);
    }
    process.exit(0);
  } else {
    console.error(`Failure [${result.category}]: ${result.message}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
