# MCP in Ankan Core

The Compose stack includes a small MCP and OAuth proxy on `http://localhost:3002`. The app's **Connected apps** page provides a personal URL after sign-in. The proxy sends requests to the local Convex actions service using a secret generated in the persistent `convex-data` volume. The frontend never receives this secret.

Local loopback HTTP works for development. When deploying for other devices or users, expose the app, Convex, actions, and MCP services behind HTTPS and set `ANKAN_WEB_ORIGIN`, `ANKAN_CONVEX_ORIGIN`, `ANKAN_CONVEX_SITE_ORIGIN`, and `ANKAN_MCP_ORIGIN` in `.env`. Rebuild the images with `docker compose up --build` after changing public origins.

MCP endpoints are account-bound and require an OAuth bearer token. A personal URL alone does not grant access. The user approves a client in the app and can revoke its grant later.
