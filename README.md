# Ankan Core

Self-host Ankan with a Vue web app, a Convex backend, and an MCP proxy. Docker Compose builds the images, starts Convex, deploys the functions, and serves the app.

## Quick start

1. Install and start Docker Engine or Docker Desktop with Docker Compose v2.
2. In [ZeptoMail](https://www.zoho.com/zeptomail/), verify a sender address and create a Send Mail API key. Email codes are required for account creation and sign-in.
3. Clone this repository, then copy `.env.example` to `.env`.
4. Set `ZEPTOMAIL_SEND_API_KEY` and `ZEPTOMAIL_FROM_ADDRESS` in `.env`. Set `ZEPTOMAIL_API_URL` if your ZeptoMail region uses a different Send Mail endpoint.
5. Run `docker compose up` in the repository directory. Wait for the deploy service to finish, then open <http://localhost:3000> and sign in with your email code.

Ports 3000 (web), 3002 (MCP), 3210 (Convex API), and 3211 (Convex HTTP actions) bind to `127.0.0.1` by default. The `convex-data` volume stores the database and generated keys across restarts. Run `docker compose up --build` after changing the source or public URLs.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `ZEPTOMAIL_SEND_API_KEY` | **Required.** ZeptoMail Send Mail API key. |
| `ZEPTOMAIL_FROM_ADDRESS` | **Required.** Verified sender address. |
| `ZEPTOMAIL_API_URL` | ZeptoMail Send Mail endpoint for your region; defaults to `https://api.zeptomail.com/v1.1/email`. |
| `ANKAN_WEB_ORIGIN` | Public web app URL; defaults to `http://localhost:3000`. |
| `ANKAN_CONVEX_ORIGIN` | Public Convex API URL; defaults to `http://localhost:3210`. |
| `ANKAN_CONVEX_SITE_ORIGIN` | Public Convex HTTP actions URL; defaults to `http://localhost:3211`. |
| `ANKAN_MCP_ORIGIN` | Public MCP URL; defaults to `http://localhost:3002`. |
| `ANKAN_BIND_ADDRESS` | Host interface for all four ports; defaults to `127.0.0.1`. |
| `VITE_TURNSTILE_SITE_KEY`, `CLOUDFLARE_TURNSTILE_SECRET_KEY` | Optional Cloudflare Turnstile keys; set both together. |
| `GOOGLE_AI_API_KEY` | Optional server-managed Google AI key. Users can also supply their own key in the app. |
| `TELEGRAM_BOT_TOKEN`, `VITE_TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | Optional Telegram bot settings; see below. |

## Access from other devices

Set up DNS and HTTPS reverse proxies for the web app, Convex API, Convex HTTP actions, and MCP endpoint. Route those origins to host ports 3000, 3210, 3211, and 3002 respectively. Preserve headers and WebSocket upgrades for the Convex API. Set all four `ANKAN_*_ORIGIN` values in `.env` to the matching external `https://` URLs, then run `docker compose up --build`.

A reverse proxy on the host can use the default loopback bindings. If it needs to reach the host ports from another network namespace, set `ANKAN_BIND_ADDRESS` to a reachable interface and restrict direct access with your firewall. The browser needs the web and Convex API origins; Telegram needs the Convex HTTP actions origin; external MCP clients need the MCP origin.

## Optional integrations

- **Turnstile:** Create a widget for your web hostname, set both Turnstile keys in `.env`, and rebuild.
- **Google AI:** Set `GOOGLE_AI_API_KEY` in `.env`, or add a personal key in Ankan after signing in.
- **Telegram:** Create a bot with BotFather. Set its token, username, and a long random webhook secret in `.env`; configure public HTTPS for `ANKAN_CONVEX_SITE_ORIGIN`; start Compose; then register `https://<actions-host>/telegram/webhook` with Telegram using the same secret as `secret_token`. Message the bot and connect it from Ankan's Telegram page.
- **MCP:** Open **Connected apps** after signing in and use the personal MCP URL shown there. External clients need an HTTPS `ANKAN_MCP_ORIGIN` and OAuth approval. See [MCP setup](docs/mcp.md).

Register a Telegram webhook with:

```sh
curl --request POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  --data-urlencode "url=https://<actions-host>/telegram/webhook" \
  --data-urlencode "secret_token=<WEBHOOK_SECRET>"
```

The source is MIT licensed. Ankan Core stores records without application-level field encryption; protect the Docker host and `convex-data` volume accordingly.
