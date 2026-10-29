# Ankan Core

Self-hosted Ankan: Vue frontend, Convex backend, and MCP proxy. MIT licensed.

## Requirements

- Docker Engine or Docker Desktop with Docker Compose v2.
- ZeptoMail Send Mail API key and a verified sender address. Email OTP is the authentication method.
- Available host ports: `3000`, `3002`, `3210`, `3211`.

## Start

```sh
git clone https://github.com/bharatkashyap/ankan-core.git
cd ankan-core
cp .env.example .env
```

Set `ZEPTOMAIL_SEND_API_KEY` and `ZEPTOMAIL_FROM_ADDRESS` in `.env`, then run:

```sh
docker compose up
```

Open <http://localhost:3000>. The first start builds the images, starts the local Convex backend, generates credentials in the `convex-data` volume, and deploys the Convex functions. No Convex Cloud setup is required. Subsequent starts reuse the volume. Rebuild after source or public URL changes with `docker compose up --build`.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ZEPTOMAIL_SEND_API_KEY` | Yes | — | ZeptoMail Send Mail API key. |
| `ZEPTOMAIL_FROM_ADDRESS` | Yes | — | Verified sender address. |
| `ZEPTOMAIL_API_URL` | No | `https://api.zeptomail.com/v1.1/email` | Send Mail endpoint for the account's region. |
| `ANKAN_WEB_ORIGIN` | No | `http://localhost:3000` | Browser-facing frontend origin. |
| `ANKAN_CONVEX_ORIGIN` | No | `http://localhost:3210` | Browser-facing Convex API origin. |
| `ANKAN_CONVEX_SITE_ORIGIN` | No | `http://localhost:3211` | Convex HTTP actions origin. |
| `ANKAN_MCP_ORIGIN` | No | `http://localhost:3002` | MCP and OAuth origin. |
| `ANKAN_BIND_ADDRESS` | No | `127.0.0.1` | Host address for published ports; use `0.0.0.0` to accept connections from other devices. |
| `VITE_TURNSTILE_SITE_KEY` | No | empty | Turnstile site key; set with the secret key. |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` | No | empty | Turnstile secret key; set with the site key. |
| `GOOGLE_AI_API_KEY` | No | empty | Server-managed Google AI API key. |
| `TELEGRAM_BOT_TOKEN` | No | empty | Telegram bot token. |
| `VITE_TELEGRAM_BOT_USERNAME` | No | empty | Telegram bot username, without `@`. |
| `TELEGRAM_WEBHOOK_SECRET` | No | empty | Telegram webhook secret token. |

For access from another device, set `ANKAN_BIND_ADDRESS` and the `ANKAN_*_ORIGIN` values to addresses that device can reach. Rebuild after changing origins.

## Optional services

- **Turnstile:** Create a widget for the web origin's hostname; set both Turnstile variables and rebuild.
- **Google AI:** Set `GOOGLE_AI_API_KEY`, or configure a user key in the app.
- **Telegram:** Create a bot with BotFather. Set `TELEGRAM_BOT_TOKEN`, `VITE_TELEGRAM_BOT_USERNAME`, and `TELEGRAM_WEBHOOK_SECRET`; configure `ANKAN_CONVEX_SITE_ORIGIN` over public HTTPS; start Compose; register the webhook:

  ```sh
  curl --request POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
    --data-urlencode "url=https://<actions-host>/telegram/webhook" \
    --data-urlencode "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
  ```

- **MCP:** Set an HTTPS `ANKAN_MCP_ORIGIN` for remote clients. The account-specific URL and OAuth authorization are available on the app's **Connected apps** page. See [MCP configuration](docs/mcp.md).

## Data

`convex-data` contains SQLite data, Convex credentials, auth signing keys, and the MCP proxy secret. Back up the entire volume with the stack stopped. `docker compose down` retains the volume; `docker compose down -v` deletes it. Application-level field encryption is disabled in Ankan Core.
