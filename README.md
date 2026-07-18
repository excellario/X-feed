# x-feed-mcp

A least-privilege, **read-only** [Model Context Protocol](https://modelcontextprotocol.io) server that returns recent tweets from a set of tracked X (Twitter) accounts.

It exposes **one tool**, `get_recent_tweets`, and nothing else:

- It **can** read the most recent tweets from a set of handles, using a logged-in session.
- It **cannot** post, reply, like, follow, DM, read your home timeline, or write anything. Only reading tracked handles is implemented.

The tracked handles are **passed dynamically by the caller** on each call, so the set can grow over time without redeploying. It authenticates with a **cookie-derived API key** (via [rettiwt-api](https://github.com/Rishikant181/Rettiwt-API)), no paid X API tier, and, importantly, **no automated password login**: you log in by hand once and encode the resulting cookies.

## Honest limitations (read before relying on it)

- **Against X's Terms of Service.** Programmatic access via session cookies breaks X's ToS. Use a **dedicated throwaway account**, never your personal one; expect it to be flagged/banned eventually.
- **Cookies expire.** The session dies periodically (days to weeks, sooner if flagged). When it does, the tool returns a clear "session expired" error and you must **log in again, regenerate `X_API_KEY`, and update it**. Low-maintenance, not zero-maintenance.
- **Brittle upstream.** It depends on X's internal endpoints via `rettiwt-api`; X changes break it until the library updates.

If you need durability, prefer official RSS/news feeds. This server is the pragmatic option when you specifically want to read a curated set of X accounts and accept the upkeep.

## Requirements

- Node.js 20+.
- A **dedicated** X account, logged in.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `X_API_KEY` | Yes | base64 of your account cookies (`auth_token`, `ct0`, `twid`). See below. |
| `X_HANDLES` | No | Optional static fallback set of handles (comma/space separated, `@` optional) used only when a call omits `handles`. Usually left unset so handles are passed dynamically. |

For remote (HTTP) deployment, also: `MCP_TRANSPORT=http`, `MCP_AUTH_TOKEN` (bearer secret), optional `PORT`, and optional keepalive (`KEEPALIVE_URL` / `RENDER_EXTERNAL_URL`, `KEEPALIVE_MINUTES`).

### Generating `X_API_KEY`

Log into your **dedicated** account, open the browser console, and run:

```js
btoa("auth_token=YOUR_AUTH_TOKEN;ct0=YOUR_CT0;twid=YOUR_TWID;")
```

Get each value from DevTools → Application → Cookies → `https://x.com` (`auth_token` ~40 chars, `ct0` long, `twid` looks like `u%3D<userid>`). The console prints a long base64 string, that is your `X_API_KEY` (a few hundred characters). It grants full access to that account, so keep it to the throwaway and never commit it.

## The tool: `get_recent_tweets`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `handles` | string[] | Optional if `X_HANDLES` is set | Handles to fetch (with or without `@`). Pass the current set here to keep it dynamic. |
| `count` | number | No | How many merged tweets to return, newest first (1-100). Default 30. |
| `includeReplies` | boolean | No | Include `@`-replies. Default false (replies are usually noise for a digest). |

Handles are fetched in small batches (X caps `from:` operators per search query), merged, de-duplicated, and sorted newest-first. Output is a compact text list of author, timestamp, text, and URL.

## Remote deployment (HTTP transport)

Run as an always-on service and add it to Claude as a custom connector. The `/mcp` endpoint requires a bearer token (`MCP_AUTH_TOKEN`), reachable as an `Authorization: Bearer` header **or** as `/mcp/<token>` in the path for connector UIs that only take a URL. `GET /health` is unauthenticated (health check + keepalive). A [`render.yaml`](render.yaml) blueprint is included; set secrets in the host dashboard, never in the file.

## Local development

```bash
npm install
npm run build
npm test                                   # unit + HTTP tests (no network)
npm run test:feed                          # live: default handles
npm run test:feed -- 20 @sama @OpenAI      # live: count + explicit handles
npm run test:users -- @sama @AnthropicAI   # live: probe specific handles
```

The live scripts hit real X endpoints and need a valid `X_API_KEY`.

## Security

See [SECURITY.md](SECURITY.md). The cookie key is read only from the environment, never logged, and grants full access to the connected account, keep it on a dedicated throwaway. Revoking it (log the account out of all sessions) immediately disables this integration.

## License

[MIT](LICENSE)
