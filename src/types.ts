/** Shared shapes for the read-only feed. */

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
  isPinned?: boolean;
  likeCount?: number;
  retweetCount?: number;
}

export interface FeedSuccess {
  ok: true;
  handles: string[];
  tweets: FeedTweet[];
  /** Which source produced the result: "nitter" or "rettiwt". */
  source: string;
  /** Handles that produced no tweets from any source this run. */
  missed: string[];
}

export interface FeedFailure {
  ok: false;
  category: "invalid_input" | "auth" | "rate_limit" | "upstream" | "network";
  message: string;
}

export type FeedResult = FeedSuccess | FeedFailure;
