import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const approve = action({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in before connecting");
    const issuer = process.env.MCP_PUBLIC_ORIGIN;
    if (!issuer || !(issuer.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(issuer))) {
      throw new Error("MCP issuer is not configured");
    }
    const code = randomToken();
    const result = await ctx.runMutation(internal.mcpStore.approveAuthorizationRequest, {
      requestId, userId, codeHash: await sha256(code),
    });
    const redirect = new URL(result.redirectUri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", result.state);
    redirect.searchParams.set("iss", issuer);
    return redirect.toString();
  },
});

export const getOrCreateEndpoint = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    return ctx.runMutation(internal.mcpStore.ensureEndpoint, { userId, slug: randomToken() });
  },
});
