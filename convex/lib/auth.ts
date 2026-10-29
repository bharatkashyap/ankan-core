import { getAuthUserId, getAuthSessionId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Get the authenticated user ID or throw an error
 * Use this at the start of any query/mutation that needs auth
 *
 * SECURITY: This validates the JWT token via Convex's auth system.
 * The token is cryptographically verified - cannot be spoofed.
 */
export async function requireAuth(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError("Unauthorized: Please log in");
  }

  // Verify the user actually exists in our database
  const user = await ctx.db.get(userId);
  if (!user) {
    throw new ConvexError("Unauthorized: User not found");
  }

  return userId;
}

/**
 * Get the authenticated user ID or return null (for optional auth)
 */
export async function optionalAuth(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;

  // Verify user exists
  const user = await ctx.db.get(userId);
  if (!user) return null;

  return userId;
}

/**
 * Verify the authenticated user owns the given profile
 * Returns the userId if valid, throws otherwise
 *
 * SECURITY: Prevents users from accessing other users' profiles
 */
export async function requireProfileAccess(
  ctx: QueryCtx | MutationCtx,
  profileId: Id<"profiles">,
): Promise<Id<"users">> {
  const userId = await requireAuth(ctx);

  const profile = await ctx.db.get(profileId);
  if (!profile) {
    throw new ConvexError("Profile not found");
  }

  if (profile.userId === userId) {
    return userId;
  }

  const myMemberships = await ctx.db
    .query("familyMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  if (myMemberships.length === 0) {
    throw new ConvexError("Access denied: You don't own this profile");
  }

  const targetMemberships = await ctx.db
    .query("familyMembers")
    .withIndex("by_user", (q) => q.eq("userId", profile.userId))
    .collect();

  const targetFamilyIds = new Set(targetMemberships.map((m) => m.familyId));
  const hasOwnerAccess = myMemberships.some(
    (m) => m.role === "owner" && targetFamilyIds.has(m.familyId),
  );
  if (!hasOwnerAccess) {
    throw new ConvexError("Access denied: You don't own this profile");
  }

  return userId;
}

/**
 * Verify the authenticated user owns the account (via profile ownership)
 *
 * SECURITY: Prevents users from accessing other users' accounts
 */
export async function requireAccountAccess(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"accounts">,
): Promise<{ userId: Id<"users">; profileId: Id<"profiles"> }> {
  const account = await ctx.db.get(accountId);
  if (!account) {
    throw new ConvexError("Account not found");
  }
  const userId = await requireProfileAccess(ctx, account.profileId);

  return { userId, profileId: account.profileId };
}

/**
 * Get the current session ID for audit logging
 */
export async function getSessionId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"authSessions"> | null> {
  return await getAuthSessionId(ctx);
}

/**
 * Verify the authenticated user owns an expense entry (via profile ownership)
 */
export async function requireExpenseEntryAccess(
  ctx: QueryCtx | MutationCtx,
  entryId: Id<"expenseEntries">,
): Promise<{ userId: Id<"users">; profileId: Id<"profiles"> }> {
  const entry = await ctx.db.get(entryId);
  if (!entry) {
    throw new ConvexError("Expense entry not found");
  }
  const userId = await requireProfileAccess(ctx, entry.profileId);

  return { userId, profileId: entry.profileId };
}

/**
 * Verify the authenticated user owns an income entry (via profile ownership)
 */
export async function requireIncomeEntryAccess(
  ctx: QueryCtx | MutationCtx,
  entryId: Id<"incomeEntries">,
): Promise<{ userId: Id<"users">; profileId: Id<"profiles"> }> {
  const entry = await ctx.db.get(entryId);
  if (!entry) {
    throw new ConvexError("Income entry not found");
  }
  const userId = await requireProfileAccess(ctx, entry.profileId);

  return { userId, profileId: entry.profileId };
}
