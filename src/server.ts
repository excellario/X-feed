/**
 * Builds the read-only X MCP server: one tool, get_recent_tweets.
 *
 * Transport-agnostic (index.ts wires stdio or HTTP). The capability surface is
 * exactly one read: recent tweets from a set of tracked handles. No posting, no
 * writes, no DMs, no other reads.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { Config } from "./config.js";
import { XClient, FeedTweet } from "./xclient.js";

export const SERVER_NAME = "x-feed-mcp";
export const SERVER_VERSION = "0.1.0";

/** Render tweets as a compact, model-friendly text block. */
function formatTweets(tweets: FeedTweet[]): string {
  if (tweets.length === 0) return "No recent tweets found for the tracked handles.";
  return tweets
    .map((t, i) => {
      const rt = t.isRetweet ? " [RT]" : "";
      return (
        `${i + 1}. @${t.handle} (${t.author})${rt} — ${t.createdAt}\n` +
        `${t.text}\n${t.url}`
      );
    })
    .join("\n\n");
}

/**
 * Construct a configured McpServer with the single read tool registered.
 * @param config validated configuration
 */
export function buildServer(config: Config): McpServer {
  const client = new XClient(config.apiKey, config.defaultHandles);

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "get_recent_tweets",
    {
      title: "Get recent tweets from tracked X accounts",
      description:
        "Return the most recent tweets from a set of X (Twitter) handles, " +
        "newest first, using a logged-in session. Read-only: this server can " +
        "only read, it cannot post, reply, like, follow, DM, or write anything. " +
        "Defaults to the server's configured handle set; useful for summarising " +
        "what a curated group of accounts has posted.",
      inputSchema: {
        handles: z
          .array(z.string())
          .optional()
          .describe(
            "X handles to fetch (with or without @). Optional if the server " +
              "has a default set (X_HANDLES) configured.",
          ),
        count: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("How many recent tweets to return after merging (1-100). Default 30."),
        includeReplies: z
          .boolean()
          .optional()
          .describe(
            "Include @-replies. Default false, replies are usually noise for a digest.",
          ),
      },
    },
    async ({ handles, count, includeReplies }) => {
      const result = await client.getTweets(
        handles,
        count ?? 30,
        includeReplies ?? false,
      );

      if (result.ok) {
        return {
          content: [
            {
              type: "text",
              text:
                `Fetched ${result.tweets.length} recent tweet(s) from ` +
                `${result.handles.length} tracked handle(s):\n\n` +
                formatTweets(result.tweets),
            },
          ],
        };
      }

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to read tweets [${result.category}]: ${result.message}`,
          },
        ],
      };
    },
  );

  return server;
}
