const SLUG = /^[A-Za-z0-9_-]{43}$/;
const FORWARDED_HEADERS = [
  "accept", "authorization", "content-type", "mcp-protocol-version",
  "mcp-method", "mcp-name", "mcp-session-id", "origin", "user-agent",
];

export async function handleMcpProxy(request, env, fetchUpstream = fetch) {
  if (!env.MCP_PROXY_SECRET || env.MCP_PROXY_SECRET.length < 32 ||
      !env.CONVEX_MCP_ORIGIN || !env.MCP_PUBLIC_ORIGIN || !env.ANKAN_APP_ORIGIN) {
    return new Response("MCP proxy is unavailable", { status: 503 });
  }
  const url = new URL(request.url);
  if (url.origin !== env.MCP_PUBLIC_ORIGIN) return new Response("Not found", { status: 404 });
  let path;
  let slug = "";
  if (url.pathname === "/.well-known/oauth-authorization-server") path = url.pathname;
  else if (url.pathname === "/register") path = "/mcp/register";
  else if (url.pathname === "/authorize") path = "/mcp/authorize";
  else if (url.pathname === "/token") path = "/mcp/token";
  else {
    const resource = /^\/u\/([^/]+)$/.exec(url.pathname);
    const metadata = /^\/\.well-known\/oauth-protected-resource\/u\/([^/]+)$/.exec(url.pathname);
    slug = resource?.[1] || metadata?.[1] || "";
    if (!SLUG.test(slug)) return new Response("Not found", { status: 404 });
    path = resource ? "/mcp" : "/.well-known/oauth-protected-resource/mcp";
  }
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("x-ankan-mcp-proxy-secret", env.MCP_PROXY_SECRET);
  if (slug) headers.set("x-ankan-mcp-endpoint", slug);
  const target = new URL(path + url.search, env.CONVEX_MCP_ORIGIN);
  let response;
  try {
    response = await fetchUpstream(new Request(target, {
      method: request.method, headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual", duplex: "half",
    }));
  } catch {
    return new Response("MCP upstream unavailable", { status: 502 });
  }
  const location = response.headers.get("location");
  if (location) {
    try {
      const destination = new URL(location);
      if (destination.origin !== env.MCP_PUBLIC_ORIGIN && destination.origin !== env.ANKAN_APP_ORIGIN) {
        return new Response("Invalid upstream redirect", { status: 502 });
      }
    } catch { return new Response("Invalid upstream redirect", { status: 502 }); }
  }
  const outgoing = new Headers(response.headers);
  for (const name of [...outgoing.keys()]) {
    if (["server", "via", "set-cookie", "content-encoding", "content-length",
      "transfer-encoding", "connection"].includes(name) || name.includes("convex") ||
      name.startsWith("cf-")) outgoing.delete(name);
  }
  outgoing.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers: outgoing });
}

export default { fetch: (request, env) => handleMcpProxy(request, env) };
