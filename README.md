# x-feed-mcp

A least-privilege, **read-only** [Model Context Protocol](https://modelcontextprotocol.io) server that returns recent tweets from a **single X (Twitter) List**.

It exposes **one tool**, `get_list_tweets`, and nothing else:

- It **can** read the most recent tweets from a List you control, using a logged-in session.
- It **cannot** post, reply, like, follow, DM, read your home timeline, or write anything. Only List reading is implemented.

It authenticates with a **cookie-derived API key** (via [rettiwt-api](https://github.com/Rishikant181/Rettiwt-API)), no paid X API tier, and, importantly, **no automated password login**: you log in by hand once and encode the resulting cookies.

## Honest limitations (read before relying on it)

- **Against X's Terms of Service.** Programmatic access via session cookies breaks X's ToS. Use a **dedicated throwaway account**, never your personal one; expect it to be flagged/banned eventually.
- **Cookies expire.** The session dies periodically (days to weeks, sooner if flagged). When it does, the tool returns a clear "session expired" error and you must **log in again, regenerate `X_API_KEY`, and update it**. So this is low-maintenance, not zero-maintenance.
- **Brittle upstream.** It depends on X's internal endpoints via `rettiwt-api`; X changes break it until the library updates.

If you need durability, prefer official RSS/news feeds. This server is the pragmatic option when you specifically want a curated X List and accept the upkeep.

## Requirements

- Node.js 20+.
- A **dedicated** X account, logged in, with a List of the accounts to track.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `X_API_KEY` | Yes | base64 of your account cookies (`auth_token`, `ct0`, `twid`). See below. |
| `X_LIST_ID` | No | Default numeric List ID (from `x.com/i/lists/<ID>`). |
| `MCP_TRANSPORT` | For remote | `stdio` (default) or `http`. |
| `MCP_AUTH_TOKEN` | For `http` | Bearer secret guarding the HTTP endpoint. |
| `PORT` | No | HTTP port (Render sets it automatically). |
| `KEEPALIVE_URL` / `KEEPALIVE_MINUTES` | No | Self-ping to keep a free host awake (auto on Render). |

### Generating `X_API_KEY` (no password)

1. Log into your **dedicated** X account in a browser.
2. DevTools → Application → Cookies → copy `auth_token`, `ct0`, `twid`.
3. In the browser console, run:
   ```js
   btoa("auth_token=<AUTH_TOKEN>;ct0=<CT0>;twid=<TWID>;")
   ```
4. The output is your `X_API_KEY`. It grants full access to that account, treat it as a secret.

## The tool: `get_list_tweets`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `listId` | string | Optional if `X_LIST_ID` is set | Numeric List ID. |
| `count` | number | No | How many recent tweets (1-100). Default 20. |

Returns a compact text list of recent tweets (author, handle, text, timestamp, URL) for a model to summarise. On an expired session it returns a distinguishable `auth` error telling you to refresh the key.

## Remote deployment (HTTP transport)

Same shape as any MCP HTTP server. Set `MCP_TRANSPORT=http` and `MCP_AUTH_TOKEN`; the endpoint is `POST /mcp` (bearer auth) or `POST /mcp/<token>` (token in path, for connector UIs that cannot send a header). `GET /health` is open for keepalive/health checks. A `render.yaml` blueprint is included; set all secrets in the host dashboard, never in the repo.

## Local development

```bash
npm install
npm run build
npm test                 # unit + HTTP auth tests (no live X calls)
npm run test:feed        # live: fetch your List (needs a valid X_API_KEY)
npm run test:feed -- 1234567890 10
```

## Security

See [SECURITY.md](SECURITY.md): read-only surface, cookie-key handling, HTTP auth, and revocation (logging the dedicated account out invalidates the key).

## License

[MIT](LICENSE)
