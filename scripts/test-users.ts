/**
 * Live validation: fetch recent tweets from specific @handles via search.
 * Proves the cookie (X_API_KEY) works against live X. This is a probe, not the
 * production path (the server tool reads a List). X search caps how many
 * from-user operators fit in one query, so this batches in groups.
 *
 * Usage:
 *   npm run test:users -- @sama @OpenAI @AnthropicAI
 */

import { Rettiwt } from "rettiwt-api";

try {
  // @ts-expect-error loadEnvFile exists on Node 20.6+ but may be missing in types.
  process.loadEnvFile?.(".env");
} catch {
  /* ambient env */
}

const BATCH = 8; // keep the OR query within X's search limits

async function run(): Promise<void> {
  const apiKey = process.env.X_API_KEY?.trim();
  if (!apiKey) {
    console.error("Missing X_API_KEY in .env");
    process.exit(1);
  }

  const handles = process.argv
    .slice(2)
    .flatMap((a) => a.split(","))
    .map((h) => h.trim().replace(/^@/, ""))
    .filter(Boolean);

  if (handles.length === 0) {
    console.error("Pass at least one @handle.");
    process.exit(1);
  }

  const rettiwt = new Rettiwt({ apiKey });
  console.log(`Probing ${handles.length} handle(s) in batches of ${BATCH} ...\n`);

  let total = 0;
  for (let i = 0; i < handles.length; i += BATCH) {
    const group = handles.slice(i, i + BATCH);
    try {
      const data = await rettiwt.tweet.search({ fromUsers: group }, 10);
      const tweets = data.list ?? [];
      total += tweets.length;
      console.log(`[${group.join(", ")}] -> ${tweets.length} tweet(s)`);
      for (const t of tweets.slice(0, 3)) {
        console.log(`   @${t.tweetBy?.userName}: ${(t.fullText ?? "").slice(0, 90).replace(/\n/g, " ")}`);
      }
    } catch (err) {
      console.error(
        `[${group.join(", ")}] -> ERROR: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`\nDone. Total tweets fetched: ${total}.`);
  process.exit(total > 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
