/**
 * Thin, READ-ONLY client that fetches recent tweets from a set of tracked
 * handles and nothing else.
 *
 * Source order:
 *   1. Nitter RSS (no login, no cookies, no account at risk) — primary.
 *   2. rettiwt cookie session (X_API_KEY) — optional fallback, only works from
 *      residential IPs since X blocks datacenter IPs for the cookie path.
 *
 * Deliberately exposes only reading. There is no code path to post, reply,
 * like, follow, or DM.
 */

import { Rettiwt } from "rettiwt-api";

import { fetchNitterTweets } from "./nitter.js";
import { FeedFailure, FeedResult, FeedTweet } from "./types.js";

/** rettiwt caps `from:` operators per search query. */
const RETTIWT_BATCH = 5;
/** Tweets requested per rettiwt batch. */
const RETTIWT_PER_BATCH = 20;
/** Concurrent Nitter fetches — polite to the public instance. */
const NITTER_CONCURRENCY = 4;

export class XClient {
  private rettiwt?: Rettiwt;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly defaultHandles: string[] = [],
    private readonly nitterInstances?: string[],
  ) {}

  /** Lazily construct rettiwt; its constructor throws on a bad key. */
  private rettiwtClient(): Rettiwt {
    if (!this.apiKey) throw new Error("no rettiwt api key configured");
    if (!this.rettiwt) this.rettiwt = new Rettiwt({ apiKey: this.apiKey });
    return this.rettiwt;
  }

  /**
   * Fetch recent tweets across a set of handles, newest first.
   * @param handles handles (with or without @); falls back to the configured default set
   * @param count how many merged tweets to return (1..100)
   * @param includeReplies keep @-replies (default false: replies are noise for a digest)
   */
  async getTweets(
    handles?: string[],
    count = 30,
    includeReplies = false,
  ): Promise<FeedResult> {
    const list = (handles && handles.length ? handles : this.defaultHandles)
      .map((h) => h.trim().replace(/^@/, ""))
      .filter(Boolean);

    if (list.length === 0) {
      return {
        ok: false,
        category: "invalid_input",
        message:
          "No handles provided and X_HANDLES is not set. Pass a list of X " +
          "handles (with or without @).",
      };
    }

    const limit = Math.min(Math.max(1, Math.floor(count)), 100);
    const byId = new Map<string, FeedTweet>();
    const missed: string[] = [];
    const sources = new Set<string>();

    // --- Source 1: Nitter RSS, a few handles at a time -----------------------
    for (let i = 0; i < list.length; i += NITTER_CONCURRENCY) {
      const group = list.slice(i, i + NITTER_CONCURRENCY);
      const results = await Promise.all(
        group.map(async (h) => ({
          handle: h,
          tweets: await fetchNitterTweets(h, this.nitterInstances),
        })),
      );
      for (const r of results) {
        if (r.tweets === null) {
          missed.push(r.handle);
          continue;
        }
        sources.add("nitter");
        for (const t of r.tweets) {
          if (t.isPinned) continue; // pinned posts are usually old
          if (t.isReply && !includeReplies) continue;
          byId.set(t.id, t);
        }
      }
    }

    // --- Source 2: rettiwt fallback for handles Nitter missed ----------------
    if (missed.length > 0 && this.apiKey) {
      const stillMissed = await this.rettiwtFill(
        missed,
        byId,
        includeReplies,
      );
      if (stillMissed.length < missed.length) sources.add("rettiwt");
      missed.length = 0;
      missed.push(...stillMissed);
    }

    if (byId.size === 0) {
      return {
        ok: false,
        category: "upstream",
        message:
          `No tweets could be fetched for any of the ${list.length} handle(s). ` +
          (this.apiKey
            ? "Both Nitter and the cookie session failed."
            : "Nitter failed and no X_API_KEY fallback is configured."),
      };
    }

    const tweets = [...byId.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);

    return {
      ok: true,
      handles: list,
      tweets,
      source: [...sources].join("+") || "none",
      missed,
    };
  }

  /**
   * Try to fill missed handles via the rettiwt cookie session.
   * Mutates byId; returns the handles that still produced nothing.
   */
  private async rettiwtFill(
    handles: string[],
    byId: Map<string, FeedTweet>,
    includeReplies: boolean,
  ): Promise<string[]> {
    const covered = new Set<string>();
    for (let i = 0; i < handles.length; i += RETTIWT_BATCH) {
      const batch = handles.slice(i, i + RETTIWT_BATCH);
      try {
        const data = await this.rettiwtClient().tweet.search(
          { fromUsers: batch },
          RETTIWT_PER_BATCH,
        );
        for (const t of data.list ?? []) {
          const isReply =
            Boolean(t.replyTo) || /^@\w/.test((t.fullText ?? "").trim());
          if (isReply && !includeReplies) continue;
          const handle = t.tweetBy?.userName ?? "unknown";
          covered.add(handle.toLowerCase());
          byId.set(t.id, {
            id: t.id,
            author: t.tweetBy?.fullName ?? handle,
            handle,
            text: t.fullText ?? "",
            createdAt: t.createdAt,
            url: t.url ?? `https://x.com/i/status/${t.id}`,
            isRetweet: Boolean(t.retweetedTweet),
            isReply,
            likeCount: t.likeCount,
            retweetCount: t.retweetCount,
          });
        }
      } catch {
        // fallback failure is non-fatal; these handles stay missed
      }
    }
    return handles.filter((h) => !covered.has(h.toLowerCase()));
  }

  /** Kept for callers that need a categorised failure from a raw error. */
  static mapError(err: unknown): FeedFailure {
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();
    if (
      lower.includes("unauthor") ||
      lower.includes("authenticat") ||
      lower.includes("forbidden") ||
      lower.includes("session")
    ) {
      return { ok: false, category: "auth", message };
    }
    if (lower.includes("rate") || lower.includes("429")) {
      return { ok: false, category: "rate_limit", message };
    }
    if (lower.includes("network") || lower.includes("timeout")) {
      return { ok: false, category: "network", message };
    }
    return { ok: false, category: "upstream", message };
  }
}
