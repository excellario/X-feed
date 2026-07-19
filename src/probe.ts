/**
 * Diagnostic probe: tests which X data paths work from THIS host's IP.
 *
 * Datacenter IPs are treated differently by X than residential ones, so the
 * only way to know what works in production is to test from production. The
 * probe is mounted behind the same auth token as /mcp and reports status codes
 * and short body snippets only — no secrets.
 */

import { Rettiwt } from "rettiwt-api";

export interface ProbeCheck {
  name: string;
  ok: boolean;
  status?: number;
  detail: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function probeFetch(
  name: string,
  url: string,
  init?: RequestInit,
): Promise<ProbeCheck> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    return {
      name,
      ok: res.ok,
      status: res.status,
      detail: text.slice(0, 160).replace(/\s+/g, " "),
    };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: `threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Run all probes and return their results.
 * @param apiKey the rettiwt cookie key, to test the authenticated path too
 */
export async function runProbes(apiKey: string): Promise<ProbeCheck[]> {
  const checks: ProbeCheck[] = [];

  // 1. Egress IP identity, so we know what X sees.
  checks.push(await probeFetch("egress-ip", "https://api.ipify.org?format=json"));

  // 2. rettiwt cookie-auth search (the current production path).
  try {
    const rettiwt = new Rettiwt({ apiKey });
    const data = await rettiwt.tweet.search({ fromUsers: ["OpenAI"] }, 3);
    checks.push({
      name: "rettiwt-search",
      ok: true,
      detail: `fetched ${data.list?.length ?? 0} tweets`,
    });
  } catch (err) {
    checks.push({
      name: "rettiwt-search",
      ok: false,
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }

  // 3. Syndication timeline (no auth) — powers embedded profile timelines.
  checks.push(
    await probeFetch(
      "syndication-timeline",
      "https://syndication.twitter.com/srv/timeline-profile/screen-name/OpenAI",
    ),
  );

  // 4. Syndication CDN single-tweet (no auth) — powers embedded tweets.
  checks.push(
    await probeFetch(
      "syndication-tweet",
      "https://cdn.syndication.twimg.com/tweet-result?id=2078581967768166591&token=a",
    ),
  );

  // 5. FxTwitter public API (no auth) — used by Discord-style embeds.
  checks.push(
    await probeFetch("fxtwitter-user", "https://api.fxtwitter.com/OpenAI"),
  );

  return checks;
}
