# Security

`x-feed-mcp` is a least-privilege, read-only integration. This document summarizes its posture.

## Capability boundary

The server does exactly one thing: **read** the most recent tweets from a single X List. It has:

- **No** write capability at all: no posting, replying, liking, following, or DMing.
- **No** other reads: no home timeline, no arbitrary user lookups, no DMs, no search.

This is enforced by the code: `XClient` only calls the List-tweets endpoint, and the MCP server registers only `get_list_tweets`.

## Credential handling

- `X_API_KEY` (a base64 encoding of the account cookies) is read **only** from the environment, never hardcoded, never logged.
- It is derived by a **manual** browser login, the server never automates password entry and never solves CAPTCHAs.
- `.env` is git-ignored and excluded from the published package; only `.env.example` (placeholders) is committed.
- The key grants **full access** to the X account it came from. Use a **dedicated throwaway account**, never a personal one. If the server is ever compromised, only that throwaway is exposed.

## Remote (HTTP) deployment

When run over HTTP (`MCP_TRANSPORT=http`):

- The server refuses to start without `MCP_AUTH_TOKEN` (min 16 chars).
- Every request to `/mcp` (or `/mcp/<token>`) is authenticated; missing/wrong secret gets `401`, compared in constant time.
- Only `GET /health` is unauthenticated and returns no sensitive data.

## Revocation / kill switch

Logging the dedicated account out of all sessions in X's settings (or changing its password) **invalidates the cookies**, which immediately disables this integration. You would then generate a fresh `X_API_KEY` if you want to resume. There is no other cached credential.

## Terms of Service note

Cookie-based programmatic access breaks X's Terms of Service and can get the account banned. This is an accepted risk for a personal, single-user tool on a dedicated account; do not use a personal account.
