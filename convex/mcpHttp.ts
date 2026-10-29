import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const SCOPE = "records:read";
const LEGACY_VERSION = "2025-11-25";
const CLIENT_ID_LIMIT = 2048;
const BODY_LIMIT = 32_768;

async function proxyAuthorized(request: Request) {
  const expected = process.env.MCP_PROXY_SECRET;
  const supplied = request.headers.get("x-ankan-mcp-proxy-secret");
  if (!expected || expected.length < 32 || !supplied) return false;
  const [a, b] = await Promise.all([sha256(expected), sha256(supplied)]);
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function forbidden() { return json({ error: "forbidden" }, 403); }

function configuration() {
  const issuer = process.env.MCP_PUBLIC_ORIGIN?.replace(/\/$/, "");
  const app = process.env.ANKAN_APP_URL?.replace(/\/$/, "");
  const valid = (origin: string | undefined) => {
    if (!origin) return false;
    try {
      const url = new URL(origin);
      return url.origin === origin && (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
    } catch { return false; }
  };
  if (!valid(issuer) || !valid(app)) {
    throw new Error("MCP requires HTTPS origins or local loopback HTTP origins");
  }
  return { issuer, app };
}

function endpointSlug(request: Request) {
  const slug = request.headers.get("x-ankan-mcp-endpoint") || "";
  return /^[A-Za-z0-9_-]{43}$/.test(slug) ? slug : null;
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", ...headers,
  } });
}

function oauthError(error: string, status = 400) {
  return json({ error }, status);
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Base64url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function validRedirect(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" && !!url.hostname && !url.hostname.endsWith(".local");
  } catch { return false; }
}

function validCimdUrl(value: string) {
  if (value.length > CLIENT_ID_LIMIT) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname.includes(".") &&
      !/^\d+(?:\.\d+){3}$/.test(url.hostname) && !url.hostname.endsWith(".local") &&
      !url.username && !url.password && !url.hash && !url.search &&
      url.pathname !== "/" && (!url.port || url.port === "443");
  } catch { return false; }
}

async function clientMetadata(clientId: string) {
  if (!validCimdUrl(clientId)) return null;
  // Only fetch metadata from operators we explicitly trust. An arbitrary HTTPS
  // URL is otherwise an SSRF primitive, including through DNS rebinding.
  const allowedHosts = (process.env.MCP_CIMD_ALLOWED_HOSTS || "")
    .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!allowedHosts.includes(new URL(clientId).hostname.toLowerCase())) return null;
  try {
    const response = await fetch(clientId, { redirect: "error", signal: AbortSignal.timeout(4000),
      headers: { accept: "application/json" } });
    if (!response.ok || Number(response.headers.get("content-length") || 0) > 16_384) return null;
    const raw = await boundedBody(response, 16_384);
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.client_id !== clientId || typeof value.client_name !== "string" ||
      !value.client_name.trim() || value.client_name.length > 120 ||
      !Array.isArray(value.redirect_uris) || value.redirect_uris.length < 1 ||
      value.redirect_uris.length > 10 || !value.redirect_uris.every(validRedirect) ||
      (value.token_endpoint_auth_method && value.token_endpoint_auth_method !== "none")) return null;
    return { clientName: value.client_name, redirectUris: value.redirect_uris as string[] };
  } catch { return null; }
}

async function boundedBody(message: Request | Response, maxBytes: number) {
  if (Number(message.headers.get("content-length") || 0) > maxBytes) throw new Error("Request too large");
  if (!message.body) return "";
  const reader = message.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Request too large");
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function smallBody(request: Request) {
  return boundedBody(request, BODY_LIMIT);
}

export const protectedResourceMetadata = httpAction(async (ctx, request) => {
  if (!(await proxyAuthorized(request))) return forbidden();
  const { issuer } = configuration();
  const slug = endpointSlug(request);
  if (!slug || !(await ctx.runQuery(internal.mcpStore.findEndpoint, { slug }))) return oauthError("invalid_request");
  const resource = `${issuer}/u/${slug}`;
  return json({ resource, authorization_servers: [issuer], scopes_supported: [SCOPE] }, 200,
    { "access-control-allow-origin": "*" });
});

export const authorizationServerMetadata = httpAction(async (_ctx, request) => {
  if (!(await proxyAuthorized(request))) return forbidden();
  const { issuer } = configuration();
  return json({ issuer, authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE], client_id_metadata_document_supported:
      Boolean(process.env.MCP_CIMD_ALLOWED_HOSTS?.trim()),
    authorization_response_iss_parameter_supported: true }, 200,
    { "access-control-allow-origin": "*" });
});

export const register = httpAction(async (ctx, request) => {
  if (!(await proxyAuthorized(request))) return forbidden();
  try {
    const value = JSON.parse(await smallBody(request)) as Record<string, unknown>;
    if (!Array.isArray(value.redirect_uris) || value.redirect_uris.length < 1 ||
      value.redirect_uris.length > 10 || !value.redirect_uris.every(validRedirect) ||
      (value.token_endpoint_auth_method && value.token_endpoint_auth_method !== "none") ||
      (value.application_type && !["native", "web"].includes(String(value.application_type)))) {
      return oauthError("invalid_redirect_uri");
    }
    const clientName = typeof value.client_name === "string" ? value.client_name.trim().slice(0, 120) : "MCP client";
    if (!(await ctx.runMutation(internal.mcpStore.consumeRateLimit, { key: "registration", max: 100 }))) {
      return oauthError("temporarily_unavailable", 429);
    }
    const clientId = randomToken();
    await ctx.runMutation(internal.mcpStore.registerClient, {
      clientId, clientName, redirectUris: value.redirect_uris as string[],
    });
    return json({ client_id: clientId, client_name: clientName,
      redirect_uris: value.redirect_uris, token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, 201);
  } catch { return oauthError("invalid_client_metadata"); }
});

export const authorize = httpAction(async (ctx, request) => {
  if (!(await proxyAuthorized(request))) return forbidden();
  try {
    const { app, issuer } = configuration();
    const url = new URL(request.url);
    const clientId = url.searchParams.get("client_id") || "";
    const redirectUri = url.searchParams.get("redirect_uri") || "";
    const challenge = url.searchParams.get("code_challenge") || "";
    const state = url.searchParams.get("state") || "";
    const resource = url.searchParams.get("resource") || "";
    const slug = resource.startsWith(`${issuer}/u/`) ? resource.slice(`${issuer}/u/`.length) : "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(slug) ||
      !(await ctx.runQuery(internal.mcpStore.findEndpoint, { slug })) ||
      url.searchParams.get("response_type") !== "code" ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) ||
      url.searchParams.get("scope") !== SCOPE ||
      !validRedirect(redirectUri) || state.length > 512 || !clientId) return oauthError("invalid_request");
    const registered = await ctx.runQuery(internal.mcpStore.getClient, { clientId });
    const metadata = registered ? { clientName: registered.clientName, redirectUris: registered.redirectUris } :
      await clientMetadata(clientId);
    if (!metadata || !metadata.redirectUris.includes(redirectUri)) return oauthError("invalid_client");
    if (!(await ctx.runMutation(internal.mcpStore.consumeRateLimit, {
      key: "authorization:global", max: 300,
    }))) return oauthError("temporarily_unavailable", 429);
    if (!(await ctx.runMutation(internal.mcpStore.consumeRateLimit, {
      key: `authorization:${await sha256(clientId)}`, max: 100,
    }))) return oauthError("temporarily_unavailable", 429);
    const requestId = randomToken();
    await ctx.runMutation(internal.mcpStore.createAuthorizationRequest, {
      requestId, clientId, clientName: metadata.clientName, redirectUri,
      resource, codeChallenge: challenge, state,
    });
    return new Response(null, { status: 302, headers: {
      location: `${app}/mcp/authorize?request=${encodeURIComponent(requestId)}`,
      "cache-control": "no-store", "referrer-policy": "no-referrer",
    } });
  } catch { return oauthError("server_error", 500); }
});

export const token = httpAction(async (ctx, request) => {
  if (!(await proxyAuthorized(request))) return forbidden();
  try {
    if (!request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) return oauthError("invalid_request");
    const form = new URLSearchParams(await smallBody(request));
    const { issuer } = configuration();
    const resource = form.get("resource") || "";
    const slug = resource.startsWith(`${issuer}/u/`) ? resource.slice(`${issuer}/u/`.length) : "";
    const clientId = form.get("client_id") || "";
    const grantType = form.get("grant_type");
    if (!clientId || (resource && !/^[A-Za-z0-9_-]{43}$/.test(slug))) return oauthError("invalid_request");
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const accessHash = await sha256(accessToken);
    const refreshHash = await sha256(refreshToken);
    let success = false;
    if (grantType === "authorization_code") {
      const code = form.get("code") || "";
      const verifier = form.get("code_verifier") || "";
      const redirectUri = form.get("redirect_uri") || "";
      if (form.get("resource") !== resource || !code || !redirectUri ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oauthError("invalid_grant");
      success = await ctx.runMutation(internal.mcpStore.redeemAuthorizationCode, {
        codeHash: await sha256(code), clientId, redirectUri,
        codeChallenge: await sha256Base64url(verifier), accessHash, refreshHash, resource,
      });
    } else if (grantType === "refresh_token") {
      const oldToken = form.get("refresh_token") || "";
      if (!oldToken) return oauthError("invalid_grant");
      success = await ctx.runMutation(internal.mcpStore.rotateRefreshToken, {
        refreshHash: await sha256(oldToken), clientId, accessHash, nextRefreshHash: refreshHash,
      });
    } else return oauthError("unsupported_grant_type");
    if (!success) return oauthError("invalid_grant");
    return json({ access_token: accessToken, refresh_token: refreshToken,
      token_type: "Bearer", expires_in: 3600, scope: SCOPE });
  } catch { return oauthError("invalid_request"); }
});

const tools = [
  { name: "whoami", description: "Show the Ankan user ID bound to this connection.",
    inputSchema: { type: "object", additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "list_profiles", description: "List profiles owned by the connected Ankan account.",
    inputSchema: { type: "object", additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "search_expenses", description: "Search historical expenses in one owned profile. Omit profileId for the default profile. Continue with nextCursor until hasMore is false, even when a page has no matches.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      profileId: { type: "string" }, query: { type: "string" },
      startDate: { type: "string", description: "Inclusive YYYY-MM-DD" },
      endDate: { type: "string", description: "Inclusive YYYY-MM-DD" },
      category: { type: "string" }, currency: { type: "string", enum: ["INR", "USD", "THB"] },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }, cursor: { type: "string" },
    } }, annotations: { readOnlyHint: true } },
  ...[
    ["search_income", "Search income entries, including salary details, in an owned profile."],
    ["search_health", "Search meals and workouts in an owned profile."],
    ["search_tax_payments", "Search tax payment records in an owned profile."],
  ].map(([name, description]) => ({ name, description,
    inputSchema: { type: "object", additionalProperties: false, properties: {
      profileId: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }, cursor: { type: "string" },
    } }, annotations: { readOnlyHint: true } })),
  ...[
    ["list_accounts", "List owned asset and liability accounts with their latest balances."],
    ["list_tax_residency", "List saved tax residency records in an owned profile."],
    ["list_meal_references", "List saved meal references in an owned profile."],
  ].map(([name, description]) => ({ name, description,
    inputSchema: { type: "object", additionalProperties: false, properties: {
      profileId: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      cursor: { type: "string" },
    } }, annotations: { readOnlyHint: true } })),
  { name: "search_balance_history", description: "List historical balances for an owned asset or liability account.",
    inputSchema: { type: "object", additionalProperties: false, required: ["accountId"], properties: {
      accountId: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      cursor: { type: "string" },
    } }, annotations: { readOnlyHint: true } },
  { name: "list_trip_reports", description: "List trip reports created by this Ankan account.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }, cursor: { type: "string" },
    } }, annotations: { readOnlyHint: true } },
  ...[
    ["list_trip_report_entries", "List entries in an owned trip report."],
    ["list_trip_settlements", "List settlements in an owned trip report."],
  ].map(([name, description]) => ({ name, description,
    inputSchema: { type: "object", additionalProperties: false, required: ["reportId"], properties: {
      reportId: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      cursor: { type: "string" },
    } }, annotations: { readOnlyHint: true } })),
  { name: "list_family_memberships", description: "List family groups this Ankan account belongs to, without other members' private data.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      limit: { type: "integer", minimum: 1, maximum: 100, default: 50 }, cursor: { type: "string" },
    } }, annotations: { readOnlyHint: true } },
];

function toolError(id: unknown, code: number, message: string) {
  return json({ jsonrpc: "2.0", id, error: { code, message } });
}

export const mcpPost = httpAction(async (ctx, request) => {
  if (!(await proxyAuthorized(request))) return forbidden();
  const { issuer } = configuration();
  const slug = endpointSlug(request);
  if (!slug) return oauthError("invalid_request");
  const resource = `${issuer}/u/${slug}`;
  const origin = request.headers.get("origin");
  if (origin && origin !== issuer && origin !== process.env.ANKAN_APP_URL) return json({ error: "invalid_origin" }, 403);
  const bearer = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
  const auth = bearer ? await ctx.runQuery(internal.mcpStore.verifyAccessToken, { tokenHash: await sha256(bearer), resource, now: Date.now() }) : null;
  if (!auth) return json({ error: "unauthorized" }, 401, {
    "www-authenticate": `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/u/${slug}", scope="${SCOPE}"`,
  });
  let message: Record<string, unknown>;
  try { message = JSON.parse(await smallBody(request)) as Record<string, unknown>; }
  catch { return toolError(null, -32700, "Parse error"); }
  if (!message || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return toolError(message?.id ?? null, -32600, "Invalid Request");
  }
  // Modern MCP requires per-request metadata and a different discovery response.
  // Reject it with HTTP 400 so dual-era clients can retry the tested legacy flow.
  if (request.headers.get("mcp-protocol-version") === "2026-07-28" ||
    (message.params && typeof message.params === "object" && !Array.isArray(message.params) &&
      (message.params as Record<string, unknown>)._meta &&
      typeof (message.params as Record<string, unknown>)._meta === "object" &&
      ((message.params as Record<string, unknown>)._meta as Record<string, unknown>)["io.modelcontextprotocol/protocolVersion"] === "2026-07-28")) {
    return json({ jsonrpc: "2.0", id: message.id ?? null,
      error: { code: -32601, message: "Modern MCP protocol is not supported" } }, 400);
  }
  const params = (message.params && typeof message.params === "object" && !Array.isArray(message.params)) ?
    message.params as Record<string, unknown> : {};
  if (message.id === undefined) return new Response(null, { status: 202 });
  let result: Record<string, unknown>;
  if (message.method === "initialize") result = {
    protocolVersion: LEGACY_VERSION, capabilities: { tools: {} },
    serverInfo: { name: "ankan", version: "1.0.0" },
  };
  else if (message.method === "tools/list") result = { tools };
  else if (message.method === "tools/call") {
    const name = params.name;
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) return toolError(message.id, -32602, "Invalid arguments");
    const input = args as Record<string, unknown>;
    if (!tools.some((tool) => tool.name === name)) return toolError(message.id, -32602, "Unknown tool");
    const quota = await ctx.runMutation(internal.mcpStore.consumeToolQuota, { userId: auth.userId });
    if (!quota.allowed) {
      result = { isError: true, content: [{ type: "text",
        text: `${quota.plan} plan MCP limit reached (${quota.limit} tool calls per UTC day).` }] };
      return json({ jsonrpc: "2.0", id: message.id, result });
    }
    let data: unknown;
    if (name === "whoami" || name === "list_profiles") {
      if (Object.keys(input).length) return toolError(message.id, -32602, "Invalid arguments");
      data = name === "whoami" ? { userId: auth.userId, scope: SCOPE } :
        { profiles: await ctx.runQuery(internal.mcpExpenses.listOwnedProfiles, { userId: auth.userId }) };
    } else if (name === "search_expenses") {
      const allowed = new Set(["profileId", "query", "startDate", "endDate", "category", "currency", "limit", "cursor"]);
      if (Object.keys(input).some((key) => !allowed.has(key)) ||
        ["profileId", "query", "startDate", "endDate", "category", "currency", "cursor"]
          .some((key) => input[key] !== undefined && typeof input[key] !== "string") ||
        (input.limit !== undefined && (!Number.isInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 100)) ||
        (["startDate", "endDate"] as const).some((key) => input[key] && !/^\d{4}-\d{2}-\d{2}$/.test(String(input[key]))) ||
        (input.startDate && input.endDate && String(input.startDate) > String(input.endDate)) ||
        (input.currency && !["INR", "USD", "THB"].includes(String(input.currency)))) {
        return toolError(message.id, -32602, "Invalid arguments");
      }
      try {
        data = await ctx.runQuery(internal.mcpExpenses.searchOwnedExpenses, {
          userId: auth.userId, profileId: input.profileId as Id<"profiles"> | undefined,
          query: input.query as string | undefined, startDate: input.startDate as string | undefined,
          endDate: input.endDate as string | undefined, category: input.category as string | undefined,
          currency: input.currency as "INR" | "USD" | "THB" | undefined,
          limit: Number(input.limit || 50), cursor: input.cursor as string | undefined,
        });
      } catch { return toolError(message.id, -32602, "Invalid cursor or profile"); }
    } else {
      const dated = ["search_income", "search_health", "search_tax_payments"].includes(String(name));
      const withProfile = dated || ["list_accounts", "list_tax_residency", "list_meal_references"].includes(String(name));
      const withAccount = name === "search_balance_history";
      const withReport = name === "list_trip_report_entries" || name === "list_trip_settlements";
      const allowed = new Set(["limit", "cursor", ...(withProfile ? ["profileId"] : []),
        ...(dated ? ["startDate", "endDate"] : []), ...(withAccount ? ["accountId"] : []),
        ...(withReport ? ["reportId"] : [])]);
      if (Object.keys(input).some((key) => !allowed.has(key)) ||
        [...allowed].some((key) => key !== "limit" && input[key] !== undefined && typeof input[key] !== "string") ||
        (input.limit !== undefined && (!Number.isInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 100)) ||
        (withAccount && !input.accountId) || (withReport && !input.reportId) ||
        (["startDate", "endDate"] as const).some((key) => input[key] && !/^\d{4}-\d{2}-\d{2}$/.test(String(input[key]))) ||
        (input.startDate && input.endDate && String(input.startDate) > String(input.endDate))) {
        return toolError(message.id, -32602, "Invalid arguments");
      }
      const pageArgs = { userId: auth.userId, limit: Number(input.limit || 50),
        cursor: input.cursor as string | undefined };
      const profileArgs = { ...pageArgs, profileId: input.profileId as Id<"profiles"> | undefined };
      const datedArgs = { ...profileArgs, startDate: input.startDate as string | undefined,
        endDate: input.endDate as string | undefined };
      try {
        if (name === "search_income") data = await ctx.runQuery(internal.mcpData.searchIncome, datedArgs);
        else if (name === "search_health") data = await ctx.runQuery(internal.mcpData.searchHealth, datedArgs);
        else if (name === "search_tax_payments") data = await ctx.runQuery(internal.mcpData.searchTaxPayments, datedArgs);
        else if (name === "list_accounts") data = await ctx.runQuery(internal.mcpData.listAccounts, profileArgs);
        else if (name === "list_tax_residency") data = await ctx.runQuery(internal.mcpData.listTaxResidency, profileArgs);
        else if (name === "list_meal_references") data = await ctx.runQuery(internal.mcpData.listMealReferences, profileArgs);
        else if (name === "search_balance_history") data = await ctx.runQuery(internal.mcpData.searchBalances,
          { ...pageArgs, accountId: input.accountId as Id<"accounts"> });
        else if (name === "list_trip_report_entries") data = await ctx.runQuery(internal.mcpData.listTripReportEntries,
          { ...pageArgs, reportId: input.reportId as Id<"tripReports"> });
        else if (name === "list_trip_settlements") data = await ctx.runQuery(internal.mcpData.listTripSettlements,
          { ...pageArgs, reportId: input.reportId as Id<"tripReports"> });
        else if (name === "list_family_memberships") data = await ctx.runQuery(internal.mcpData.listFamilyMemberships, pageArgs);
        else data = await ctx.runQuery(internal.mcpData.listTripReports, pageArgs);
      } catch { return toolError(message.id, -32602, "Invalid cursor or record scope"); }
    }
    result = { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
  } else return toolError(message.id, -32601, "Method not found");
  return json({ jsonrpc: "2.0", id: message.id, result });
});

export const mcpGet = httpAction(async (_ctx, request) =>
  (await proxyAuthorized(request)) ? json({ error: "method_not_allowed" }, 405, { allow: "POST" }) : forbidden());
