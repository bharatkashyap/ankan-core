import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { mcpDailyLimit } from "./lib/mcpPlan";
import { requireMcpEndpointOwner } from "./lib/mcpOwnership";

const HOUR = 60 * 60_000;
const MONTH = 30 * 24 * HOUR;

export const consumeToolQuota = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");
    const entitlement = await ctx.db.query("aiManagedEntitlements")
      .withIndex("by_user", (q) => q.eq("userId", userId)).first();
    const configuredTrialDays = Number(process.env.AI_TRIAL_DAYS || 15);
    const trialDays = Number.isFinite(configuredTrialDays) && configuredTrialDays > 0 ? configuredTrialDays : 15;
    const { plan, limit } = mcpDailyLimit(user._creationTime, process.env.SELF_HOSTED_MODE === "1" || entitlement?.status === "active", Date.now(), trialDays);
    const day = new Date().toISOString().slice(0, 10);
    const row = await ctx.db.query("mcpUsageDaily")
      .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day)).unique();
    if (row && row.count >= limit) return { allowed: false, limit, plan };
    if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
    else await ctx.db.insert("mcpUsageDaily", { userId, day, count: 1 });
    return { allowed: true, limit, plan };
  },
});

export const consumeRateLimit = internalMutation({
  args: { key: v.string(), max: v.number() },
  handler: async (ctx, { key, max }) => {
    const now = Date.now();
    const bucketKey = `${key}:${Math.floor(now / HOUR)}`;
    const bucket = await ctx.db.query("mcpRateBuckets")
      .withIndex("by_key", (q) => q.eq("key", bucketKey)).unique();
    if (bucket) {
      if (bucket.count >= max) return false;
      await ctx.db.patch(bucket._id, { count: bucket.count + 1 });
    } else {
      await ctx.db.insert("mcpRateBuckets", {
        key: bucketKey, count: 1, expiresAt: (Math.floor(now / HOUR) + 2) * HOUR,
      });
    }
    return true;
  },
});

export const getClient = internalQuery({
  args: { clientId: v.string() },
  handler: async (ctx, { clientId }) => ctx.db.query("mcpClients")
    .withIndex("by_client_id", (q) => q.eq("clientId", clientId)).unique(),
});

export const findEndpoint = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => ctx.db.query("mcpEndpoints")
    .withIndex("by_slug", (q) => q.eq("slug", slug)).unique(),
});

export const ensureEndpoint = internalMutation({
  args: { userId: v.id("users"), slug: v.string() },
  handler: async (ctx, { userId, slug }) => {
    if (!(await ctx.db.get(userId))) throw new Error("Unauthorized");
    const existing = await ctx.db.query("mcpEndpoints")
      .withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (existing) return existing.slug;
    await ctx.db.insert("mcpEndpoints", { userId, slug, createdAt: Date.now() });
    return slug;
  },
});

export const registerClient = internalMutation({
  args: { clientId: v.string(), clientName: v.string(), redirectUris: v.array(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("mcpClients")
      .withIndex("by_client_id", (q) => q.eq("clientId", args.clientId)).unique();
    if (existing) throw new Error("Client ID already exists");
    await ctx.db.insert("mcpClients", { ...args, createdAt: Date.now() });
  },
});

export const createAuthorizationRequest = internalMutation({
  args: {
    requestId: v.string(), clientId: v.string(), clientName: v.string(),
    redirectUri: v.string(), resource: v.string(), codeChallenge: v.string(), state: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("mcpAuthorizationRequests", { ...args, expiresAt: Date.now() + 10 * 60_000 });
  },
});

export const describeAuthorizationRequest = query({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await ctx.db.get(userId))) throw new Error("Unauthorized");
    const request = await ctx.db.query("mcpAuthorizationRequests")
      .withIndex("by_request_id", (q) => q.eq("requestId", requestId)).unique();
    if (!request || request.expiresAt <= Date.now()) return null;
    return { clientName: request.clientName, clientId: request.clientId,
      redirectUri: request.redirectUri, expiresAt: request.expiresAt };
  },
});

export const approveAuthorizationRequest = internalMutation({
  args: { requestId: v.string(), userId: v.id("users"), codeHash: v.string() },
  handler: async (ctx, { requestId, userId, codeHash }) => {
    const request = await ctx.db.query("mcpAuthorizationRequests")
      .withIndex("by_request_id", (q) => q.eq("requestId", requestId)).unique();
    if (!request || request.expiresAt <= Date.now() || !(await ctx.db.get(userId))) {
      throw new Error("Authorization request expired");
    }
    const slug = request.resource?.split("/u/")[1];
    const endpoint = slug ? await ctx.db.query("mcpEndpoints")
      .withIndex("by_slug", (q) => q.eq("slug", slug)).unique() : null;
    requireMcpEndpointOwner(userId, endpoint, request.resource, process.env.MCP_PUBLIC_ORIGIN);
    await ctx.db.delete(request._id);
    await ctx.db.insert("mcpAuthorizationCodes", {
      codeHash, userId, clientId: request.clientId, clientName: request.clientName,
      redirectUri: request.redirectUri, resource: request.resource,
      codeChallenge: request.codeChallenge,
      expiresAt: Date.now() + 60_000,
    });
    return { redirectUri: request.redirectUri, state: request.state };
  },
});

export const redeemAuthorizationCode = internalMutation({
  args: {
    codeHash: v.string(), clientId: v.string(), redirectUri: v.string(),
    codeChallenge: v.string(), accessHash: v.string(), refreshHash: v.string(), resource: v.string(),
  },
  handler: async (ctx, args) => {
    const code = await ctx.db.query("mcpAuthorizationCodes")
      .withIndex("by_code_hash", (q) => q.eq("codeHash", args.codeHash)).unique();
    if (!code) return false;
    await ctx.db.delete(code._id);
    if (code.expiresAt <= Date.now() || code.clientId !== args.clientId ||
      code.redirectUri !== args.redirectUri || code.codeChallenge !== args.codeChallenge ||
      code.resource !== args.resource ||
      !(await ctx.db.get(code.userId))) return false;
    const now = Date.now();
    const grantId = await ctx.db.insert("mcpGrants", {
      userId: code.userId, clientId: code.clientId, clientName: code.clientName,
      resource: args.resource, scope: "records:read",
      createdAt: now, lastUsedAt: now,
    });
    await ctx.db.insert("mcpAccessTokens", { tokenHash: args.accessHash, grantId, expiresAt: now + HOUR });
    await ctx.db.insert("mcpRefreshTokens", { tokenHash: args.refreshHash, grantId, expiresAt: now + MONTH });
    return true;
  },
});

export const rotateRefreshToken = internalMutation({
  args: { refreshHash: v.string(), clientId: v.string(), accessHash: v.string(), nextRefreshHash: v.string() },
  handler: async (ctx, args) => {
    const refresh = await ctx.db.query("mcpRefreshTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", args.refreshHash)).unique();
    if (!refresh) return false;
    const grant = await ctx.db.get(refresh.grantId);
    if (!grant || grant.revokedAt || grant.clientId !== args.clientId ||
      grant.createdAt + MONTH <= Date.now() || refresh.expiresAt <= Date.now()) return false;
    if (refresh.usedAt) {
      await ctx.db.patch(grant._id, { revokedAt: Date.now() });
      return false;
    }
    const now = Date.now();
    await ctx.db.patch(refresh._id, { usedAt: now });
    await ctx.db.insert("mcpAccessTokens", { tokenHash: args.accessHash, grantId: grant._id, expiresAt: now + HOUR });
    await ctx.db.insert("mcpRefreshTokens", { tokenHash: args.nextRefreshHash, grantId: grant._id, expiresAt: grant.createdAt + MONTH });
    await ctx.db.patch(grant._id, { lastUsedAt: now });
    return true;
  },
});

export const verifyAccessToken = internalQuery({
  args: { tokenHash: v.string(), resource: v.string(), now: v.number() },
  handler: async (ctx, { tokenHash, resource, now }) => {
    const token = await ctx.db.query("mcpAccessTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    if (!token || token.expiresAt <= now) return null;
    const grant = await ctx.db.get(token.grantId);
    if (!grant || grant.revokedAt || grant.createdAt + MONTH <= now ||
      grant.resource !== resource || grant.scope !== "records:read" || !(await ctx.db.get(grant.userId))) return null;
    return { userId: grant.userId, clientId: grant.clientId, grantId: grant._id };
  },
});

export const pruneExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const oldDay = new Date(now - 60 * 24 * HOUR).toISOString().slice(0, 10);
    const oldUsage = await ctx.db.query("mcpUsageDaily")
      .withIndex("by_day", (q) => q.lt("day", oldDay)).take(400);
    const requests = await ctx.db.query("mcpAuthorizationRequests")
      .withIndex("by_expires", (q) => q.lte("expiresAt", now)).take(400);
    const buckets = await ctx.db.query("mcpRateBuckets")
      .withIndex("by_expires", (q) => q.lte("expiresAt", now)).take(400);
    const codes = await ctx.db.query("mcpAuthorizationCodes")
      .withIndex("by_expires", (q) => q.lte("expiresAt", now)).take(400);
    const accesses = await ctx.db.query("mcpAccessTokens")
      .withIndex("by_expires", (q) => q.lte("expiresAt", now)).take(400);
    const refreshes = await ctx.db.query("mcpRefreshTokens")
      .withIndex("by_expires", (q) => q.lte("expiresAt", now)).take(400);
    const grants = await ctx.db.query("mcpGrants")
      .withIndex("by_created_at", (q) => q.lte("createdAt", now - MONTH)).take(400);
    for (const row of [...oldUsage, ...buckets, ...requests, ...codes, ...accesses, ...refreshes, ...grants]) await ctx.db.delete(row._id);
  },
});

export const listGrants = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await ctx.db.get(userId))) throw new Error("Unauthorized");
    const rows = await ctx.db.query("mcpGrants").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    return rows.filter((row) => !row.revokedAt && row.createdAt + MONTH > Date.now()).map((row) => ({
      id: row._id, clientName: row.clientName, clientId: row.clientId,
      createdAt: row.createdAt, lastUsedAt: row.lastUsedAt,
    }));
  },
});

export const revokeGrant = mutation({
  args: { grantId: v.id("mcpGrants") },
  handler: async (ctx, { grantId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    const grant = await ctx.db.get(grantId);
    if (!grant || grant.userId !== userId) throw new Error("Grant not found");
    if (!grant.revokedAt) await ctx.db.patch(grantId, { revokedAt: Date.now() });
  },
});
