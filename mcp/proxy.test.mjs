import test from "node:test";
import assert from "node:assert/strict";
import { handleMcpProxy } from "./proxy.js";

const slug = "a".repeat(43);
const env = {
  MCP_PUBLIC_ORIGIN: "https://mcp.ankan.app",
  ANKAN_APP_ORIGIN: "https://ankan.app",
  CONVEX_MCP_ORIGIN: "https://private-convex.example",
  MCP_PROXY_SECRET: "s".repeat(40),
};

test("account MCP URL proxies with a server secret and never forwards client spoofing", async () => {
  let upstream;
  const response = await handleMcpProxy(new Request(`https://mcp.ankan.app/u/${slug}`, {
    method: "POST", headers: { authorization: "Bearer user-token", "x-ankan-mcp-proxy-secret": "attacker" },
    body: '{"jsonrpc":"2.0"}',
  }), env, async (request) => {
    upstream = request;
    return new Response('{"ok":true}', { headers: { "x-convex-debug": "hidden", server: "Convex",
      "content-encoding": "gzip", "content-length": "2", "cf-ray": "upstream" } });
  });
  assert.equal(upstream.url, "https://private-convex.example/mcp");
  assert.equal(upstream.headers.get("x-ankan-mcp-proxy-secret"), env.MCP_PROXY_SECRET);
  assert.equal(upstream.headers.get("x-ankan-mcp-endpoint"), slug);
  assert.equal(upstream.headers.get("authorization"), "Bearer user-token");
  assert.equal(response.headers.get("x-convex-debug"), null);
  assert.equal(response.headers.get("server"), null);
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.get("cf-ray"), null);
  assert.equal(await response.text(), '{"ok":true}');
});

test("missing secret and unknown URLs fail closed", async () => {
  const request = new Request(`https://mcp.ankan.app/u/${slug}`);
  assert.equal((await handleMcpProxy(request, { ...env, MCP_PROXY_SECRET: "" })).status, 503);
  assert.equal((await handleMcpProxy(new Request("https://mcp.ankan.app/u/bad"), env)).status, 404);
});

test("OAuth discovery stays on Ankan and upstream redirects cannot reveal Convex", async () => {
  const metadata = await handleMcpProxy(
    new Request("https://mcp.ankan.app/.well-known/oauth-authorization-server"), env,
    async (request) => {
      assert.equal(request.url, "https://private-convex.example/.well-known/oauth-authorization-server");
      return Response.json({ issuer: "https://mcp.ankan.app", token_endpoint: "https://mcp.ankan.app/token" });
    },
  );
  assert.equal((await metadata.json()).issuer, "https://mcp.ankan.app");
  const badRedirect = await handleMcpProxy(new Request("https://mcp.ankan.app/authorize"), env,
    async () => Response.redirect("https://private-convex.example/secret", 302));
  assert.equal(badRedirect.status, 502);
  assert.equal(badRedirect.headers.get("location"), null);
});
