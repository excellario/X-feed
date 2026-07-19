/**
 * Nitter RSS source: fetches a handle's recent tweets as RSS from Nitter
 * instances (no login, no cookies, no account at risk).
 *
 * Instances are tried in order until one yields items. The RSS is simple and
 * predictable, so it is parsed with small string operations instead of an XML
 * dependency.
 */

import { FeedTweet } from "./types.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Default instance list; overridable via NITTER_INSTANCES (comma-separated). */
export const DEFAULT_INSTANCES = ["nitter.net"];

/** Decode the handful of entities Nitter emits in titles. */
function decodeEntities(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** Extract the first occurrence of <tag>...</tag> from a block. */
function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : "";
}

/**
 * Parse a Nitter RSS document into tweets.
 * @param xml raw RSS
 * @param handle the handle this feed belongs to
 */
export function parseNitterRss(xml: string, handle: string): FeedTweet[] {
  const items = xml.split("<item>").slice(1);
  const tweets: FeedTweet[] = [];

  for (const raw of items) {
    const block = raw.split("</item>")[0];
    let title = decodeEntities(tag(block, "title"));
    const link = tag(block, "link");
    const pubDate = tag(block, "pubDate");
    const creator = decodeEntities(
      (block.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/) ?? [])[1] ?? handle,
    ).replace(/^@/, "");

    const idMatch = link.match(/\/status\/(\d+)/);
    if (!idMatch) continue; // profile/self links, not tweets

    // Nitter prefixes: "R to @x:" reply, "RT by @x:" retweet, "Pinned:" pinned.
    const isReply = /^R to @/i.test(title);
    const isRetweet = /^RT by @/i.test(title);
    const isPinned = /^Pinned:/i.test(title);
    title = title
      .replace(/^R to @\w+:\s*/i, "")
      .replace(/^RT by @\w+:\s*/i, "")
      .replace(/^Pinned:\s*/i, "");

    tweets.push({
      id: idMatch[1],
      author: creator,
      handle: creator,
      text: title,
      createdAt: pubDate,
      url: `https://x.com/${creator}/status/${idMatch[1]}`,
      isRetweet,
      isReply,
      isPinned,
    });
  }

  return tweets;
}

/**
 * Fetch one handle's recent tweets via the first working Nitter instance.
 * Returns null when every instance fails (caller decides on fallback).
 * @param handle X handle without @
 * @param instances Nitter hostnames to try in order
 */
export async function fetchNitterTweets(
  handle: string,
  instances: string[] = DEFAULT_INSTANCES,
): Promise<FeedTweet[] | null> {
  for (const inst of instances) {
    try {
      const res = await fetch(`https://${inst}/${encodeURIComponent(handle)}/rss`, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml, text/xml" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const tweets = parseNitterRss(xml, handle);
      if (tweets.length > 0) return tweets;
    } catch {
      // try the next instance
    }
  }
  return null;
}
