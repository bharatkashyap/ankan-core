# Ankan Core

Self-hosted household finance tracking, with a Vue web app, Convex backend, and MCP proxy. Docker Compose starts all three services and deploys the application code into the local Convex instance.

## Run locally

1. Install Docker with the Compose plugin.
2. Copy `.env.example` to `.env`. Set `ZEPTOMAIL_SEND_API_KEY` and `ZEPTOMAIL_FROM_ADDRESS` to a working ZeptoMail sender. These are required for email sign-in codes.
3. Run `docker compose up` from this directory.
4. Open <http://localhost:3000> and create an account.

The first run builds the images, starts Convex with a persistent SQLite volume, generates local admin and auth keys, deploys the functions, and serves the web app. After editing source code, run `docker compose up --build` to rebuild. The `convex-data` volume persists across runs.

The web app listens on `127.0.0.1:3000`; Convex uses `127.0.0.1:3210` and `127.0.0.1:3211`; MCP uses `127.0.0.1:3002`. Those loopback bindings make the default configuration suitable for one computer. To expose it on a server, set the four `ANKAN_*_ORIGIN` values in `.env`, put HTTPS reverse proxies in front of the services, and change the port bindings to match your network plan.

## Configuration

Email sending is the only required external service. Turnstile, Telegram, and Google AI are optional; set the matching variables in `.env` before starting the stack. Telegram webhooks need a publicly reachable HTTPS Convex actions origin. AI features need a configured Google AI key, either at deployment level or through the app's own-key setting. Without these optional services, manual finance and health entry still works.

MCP is included at <http://localhost:3002>. Local HTTP is accepted only for loopback origins; public deployment needs HTTPS. See [MCP setup](docs/mcp.md).

Ankan Core intentionally omits application-level field encryption. Records and user-supplied AI keys are stored plainly in the local Convex database volume. Back up and protect the volume as you would any other personal database. This is a new installation; encrypted records from a hosted Ankan deployment are not imported automatically.

## Development

The app is Vue 3, TypeScript, Vite, and Convex. `pnpm install`, `pnpm build`, and `pnpm backend:test` work outside Docker. The `deploy` service runs `convex deploy` against the self-hosted backend on startup. The standalone MCP proxy uses only Node.js and has tests in `mcp/proxy.test.mjs`.

The source is MIT licensed. The Ankan name and logos identify the project; the license does not grant trademark rights. Third-party logos in `public/brands/` belong to their respective owners.
