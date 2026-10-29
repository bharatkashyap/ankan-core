# Ankan Core

Self-hosted household finance tracking with a Vue app, a self-hosted Convex backend, and an MCP proxy. Once email delivery is configured, `docker compose up` builds, deploys, and starts the stack. No Convex Cloud account or manual Convex deployment is needed.

## What you need before starting

- Docker Engine or Docker Desktop with Docker Compose v2, running on your computer or server.
- A ZeptoMail account with a verified sender address and a Send Mail API key. Ankan uses email one-time codes for account creation and sign-in. Configure the sender in ZeptoMail first; an arbitrary address or dummy key will let the containers start but will not deliver sign-in codes.
- Free host ports 3000 (web), 3002 (MCP), 3210 (Convex API), and 3211 (Convex HTTP actions). The default bindings are local only.

## Start on one computer

1. Clone this repository and enter its directory.
2. Copy `.env.example` to `.env`.
3. In `.env`, set `ZEPTOMAIL_SEND_API_KEY` to the Send Mail API key and `ZEPTOMAIL_FROM_ADDRESS` to your verified sender. If your ZeptoMail account uses another region, also set `ZEPTOMAIL_API_URL` to that region's Send Mail endpoint.
4. Run `docker compose up` from the repository directory. The first run downloads base images and builds the app; wait for the deploy service to finish successfully and the web and MCP services to start.
5. Open <http://localhost:3000>, enter your email address, retrieve the code delivered by ZeptoMail, and complete sign-in. Create your first profile in the app.

The first run creates a `convex-data` Docker volume, generates local Convex admin and auth keys there, deploys the functions, and starts the app. Later runs reuse that volume and its keys. `docker compose up --build` rebuilds after source or public URL changes. `docker compose ps -a` should show `deploy` as `Exited (0)` and the other three services as running. Use `docker compose logs deploy backend web mcp` to diagnose startup failures.

## Make it reachable from other devices

The four ports bind to `127.0.0.1` by default. For a public or LAN deployment, perform these manual steps **before** running Compose:

1. Arrange DNS names and HTTPS certificates for the web app, Convex API, Convex HTTP actions, and MCP endpoint. They can be four subdomains of one domain. The browser must be able to reach the web and Convex API origins; external webhooks must be able to reach the actions origin.
2. Put a reverse proxy in front of each local service, routing the public HTTPS origins to host ports 3000, 3210, 3211, and 3002 respectively. Preserve request paths, methods, headers, and WebSocket upgrades for the Convex API. Keep the Convex admin key and data volume private.
3. Set `ANKAN_WEB_ORIGIN`, `ANKAN_CONVEX_ORIGIN`, `ANKAN_CONVEX_SITE_ORIGIN`, and `ANKAN_MCP_ORIGIN` in `.env` to the four external `https://` origins, without trailing slashes. These values are baked into the frontend and also configure the backend and MCP OAuth URLs.
4. If your reverse proxy runs on the host, it can connect to the default loopback ports. If it needs host ports reachable from another network namespace, set `ANKAN_BIND_ADDRESS` to an address it can reach. `0.0.0.0` exposes all four ports on every host interface, so restrict access with your firewall or proxy configuration.
5. Run `docker compose up --build`, then open the public web URL and sign in from another device to verify HTTPS, Convex connectivity, and email delivery.

Changing an origin after users have signed in requires rebuilding the web image. Use stable public URLs for production.

## Optional integrations and their manual setup

| Feature | Manual steps | `.env` settings |
| --- | --- | --- |
| Cloudflare Turnstile on sign-in | Create a Turnstile widget for your web hostname and copy its site and secret keys. Set both keys before rebuilding. | `VITE_TURNSTILE_SITE_KEY`, `CLOUDFLARE_TURNSTILE_SECRET_KEY` |
| Google AI | Create an API key for the Google AI models used by the app, or enter a personal key in the app's own-key setting after sign-in. AI actions require a usable key; manual finance and health entry does not. | `GOOGLE_AI_API_KEY` for a server-managed key |
| Telegram bot | Create a bot with BotFather and note its token and username. Set a long random webhook secret, configure public HTTPS for the actions origin, start Compose, then register `https://<actions-host>/telegram/webhook` with Telegram's `setWebhook` API using the **same secret** as `secret_token`. Message the bot and connect it from Ankan's Telegram page. | `TELEGRAM_BOT_TOKEN`, `VITE_TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `ANKAN_CONVEX_SITE_ORIGIN` |
| MCP clients | Open **Connected apps** after sign-in and use the personal MCP URL shown there. The client must complete the OAuth approval flow. Public MCP use requires HTTPS. | `ANKAN_MCP_ORIGIN` for a public endpoint |

For Telegram, this command registers the webhook after replacing all placeholders; keep the bot token and secret out of shell history on shared systems:

```sh
curl --request POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  --data-urlencode "url=https://<actions-host>/telegram/webhook" \
  --data-urlencode "secret_token=<WEBHOOK_SECRET>"
```

See [MCP setup](docs/mcp.md) for the OAuth endpoint details. Optional services can be added later by editing `.env` and running `docker compose up --build`. If a previously configured optional secret must be removed, delete its Convex environment variable as well; leaving its Compose variable blank does not remove an existing Convex value.

## Data, backups, and updates

Ankan Core stores database files, generated keys, and MCP proxy secret in the `convex-data` Docker volume. Back up the **whole volume**, including keys, while the stack is stopped so the SQLite files are consistent. Restore it as a whole before starting a replacement stack. `docker compose down` keeps the volume; `docker compose down -v` deletes it and all Ankan data. Protect backups and the Docker host because Ankan Core intentionally stores records and user-supplied AI keys without application-level field encryption.

To update, back up the volume, pull the new source, and run `docker compose up --build`. Check the deploy service exit code and sign in again. This is a new installation: encrypted records from hosted Ankan are not imported automatically.

## Development and verification

The app uses Vue 3, TypeScript, Vite, and Convex. Outside Docker, `pnpm install`, `pnpm build`, and `pnpm backend:test` work. The deploy service runs `convex deploy` against the local backend on each Compose startup.

The Compose stack has been exercised locally through image build, backend deployment, email OTP delivery to a local test capture endpoint, sign-in through the API and browser UI, an authenticated profile write/read, Convex restart with data and session persistence, and MCP OAuth discovery. This verifies Ankan's email request and OTP flow, but not delivery through a real ZeptoMail account. Telegram sending and webhook delivery were not exercised; they require a real bot, chat, and public HTTPS actions URL. Public HTTPS routing also requires your own domains and certificates.

The source is MIT licensed. The Ankan name and logos identify the project; the license does not grant trademark rights. Third-party logos in `public/brands/` belong to their respective owners.
