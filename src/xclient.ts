/**
 * Thin, READ-ONLY client over rettiwt-api. It fetches recent tweets from a set
 * of tracked handles and nothing else.
 *
 * Deliberately exposes only reading. There is no method here to post, reply,
 * like, follow, DM, or otherwise write, keeping this a least-privilege consumer
 * of a logged-in session.
 */

import { Rettiwt } from "rettiwt-api";

/** A single tweet flattened to the fields worth digesting. */
export interface FeedTweet {
  id: string;
  author: string;
  handle: string;
  text: string;
  createdAt: string;
  url: string;
  isRetweet: boolean;
  isReply: boolean;
  likeCount?: number;
  retweetCount?: number;
}

export interface FeedSuccess {
  ok: true;
  handles: string[];
  tweets: FeedTweet[];
}

export interface FeedFailure {
  ok: false;
  category: "invalid_input" | "auth" | "rate_limit" | "upstream" | "network";
  message: string;
}

export type FeedResult = FeedSuccess | FeedFailure;

/**
 * X search caps how many `from:` operators fit in one query, so handles are
 * fetched in small batches and merged. 5 is comfortably within the limit.
 */
const BATCH_SIZE = 5;
/** Tweets to request per batch before merging and trimming. */
const PER_BATCH = 20;

export class XClient {
  private rettiwt?: Rettiwt;

  constructor(
    private readonly apiKey: string,
    private readonly defaultHandles: string[] = [],
  ) {}

  /**
   * Build the Rettiwt instance lazily. Its constructor validates the API key and
   * throws on an invalid/expired one, so this is only called inside the fetch
   * try/catch, where the error is mapped to a clean "auth" failure rather than
   * crashing the caller.
   */
  private client(): Rettiwt {
    if (!this.rettiwt) {
      this.rettiwt = new Rettiwt({ apiKey: this.apiKey });
    }
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
    const batches: string[][] = [];
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      batches.push(list.slice(i, i + BATCH_SIZE));
    }

    const byId = new Map<string, FeedTweet>();
    let firstError: FeedFailure | undefined;
    let succeeded = 0;

    for (const batch of batches) {
      try {
        const data = await this.client().tweet.search(
          { fromUsers: batch },
          PER_BATCH,
        );
        succeeded += 1;
        for (const t of data.list ?? []) {
          const isReply =
            Boolean(t.replyTo) || /^@\w/.test((t.fullText ?? "").trim());
          if (isReply && !includeReplies) continue;
          byId.set(t.id, {
            id: t.id,
            author: t.tweetBy?.fullName ?? t.tweetBy?.userName ?? "unknown",
            handle: t.tweetBy?.userName ?? "unknown",
            text: t.fullText ?? "",
            createdAt: t.createdAt,
            url: t.url ?? `https://x.com/i/status/${t.id}`,
            isRetweet: Boolean(t.retweetedTweet),
            isReply,
            likeCount: t.likeCount,
            retweetCount: t.retweetCount,
          });
        }
      } catch (err) {
        const mapped = this.mapError(err);
        // Auth failure is terminal (dead cookie): stop and report immediately.
        if (mapped.category === "auth") return mapped;
        if (!firstError) firstError = mapped;
      }
    }

    if (succeeded === 0) {
      return firstError ?? {
        ok: false,
        category: "upstream",
        message: "All handle batches failed to fetch.",
      };
    }

    const tweets = [...byId.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);

    return { ok: true, handles: list, tweets };
  }

  /** Map a rettiwt/network error to a categorised, secret-free failure. */
  private mapError(err: unknown): FeedFailure {
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();

    if (
      lower.includes("unauthor") ||
      lower.includes("authenticat") ||
      lower.includes("forbidden") ||
      lower.includes("login") ||
      lower.includes("session")
    ) {
      return {
        ok: false,
        category: "auth",
        message:
          "X session appears invalid or expired. Log into the dedicated " +
          "account again, re-generate X_API_KEY from fresh cookies, and update " +
          "it in the environment.",
      };
    }
    if (lower.includes("rate") || lower.includes("429") || lower.includes("too many")) {
      return {
        ok: false,
        category: "rate_limit",
        message: `Rate limited by X. Try again later. (${message})`,
      };
    }
    if (lower.includes("network") || lower.includes("fetch") || lower.includes("timeout")) {
      return {
        ok: false,
        category: "network",
        message: `Network error reaching X: ${message}`,
      };
    }
    return {
      ok: false,
      category: "upstream",
      message: `Failed to fetch tweets: ${message}`,
    };
  }
}
