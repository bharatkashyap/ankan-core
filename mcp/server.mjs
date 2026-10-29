import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { handleMcpProxy } from "./proxy.js";

const env = {
  MCP_PUBLIC_ORIGIN: process.env.MCP_PUBLIC_ORIGIN,
  ANKAN_APP_ORIGIN: process.env.ANKAN_APP_ORIGIN,
  CONVEX_MCP_ORIGIN: process.env.CONVEX_MCP_ORIGIN,
  MCP_PROXY_SECRET: readFileSync("/convex/data/mcp-secret", "utf8").trim(),
};

createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url || "/", env.MCP_PUBLIC_ORIGIN);
    const method = incoming.method || "GET";
    const request = new Request(url, {
      method,
      headers: incoming.headers,
      body: method === "GET" || method === "HEAD" ? undefined : incoming,
      duplex: "half",
    });
    const response = await handleMcpProxy(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
    else outgoing.end();
  } catch {
    outgoing.writeHead(502, { "content-type": "text/plain", "cache-control": "no-store" });
    outgoing.end("MCP proxy unavailable");
  }
}).listen(3002, "0.0.0.0");
