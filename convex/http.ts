import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { webhook as telegramWebhook } from "./telegram";
import { webhook as lemonSqueezyWebhook } from "./lemonsqueezyWebhook";
import * as mcp from "./mcpHttp";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({ path: "/.well-known/oauth-protected-resource", method: "GET", handler: mcp.protectedResourceMetadata });
http.route({ path: "/.well-known/oauth-protected-resource/mcp", method: "GET", handler: mcp.protectedResourceMetadata });
http.route({ path: "/.well-known/oauth-authorization-server", method: "GET", handler: mcp.authorizationServerMetadata });
http.route({ path: "/mcp/register", method: "POST", handler: mcp.register });
http.route({ path: "/mcp/authorize", method: "GET", handler: mcp.authorize });
http.route({ path: "/mcp/token", method: "POST", handler: mcp.token });
http.route({ path: "/mcp", method: "POST", handler: mcp.mcpPost });
http.route({ path: "/mcp", method: "GET", handler: mcp.mcpGet });

// Telegram bot webhook
http.route({
  path: "/telegram/webhook",
  method: "POST",
  handler: telegramWebhook,
});

// LemonSqueezy billing webhook
http.route({
  path: "/billing/lemonsqueezy/webhook",
  method: "POST",
  handler: lemonSqueezyWebhook,
});

export default http;
