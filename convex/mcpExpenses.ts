import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { decryptNumberWithFallback, decryptStringWithFallback } from "./lib/fieldEncryption";
import { requireMcpProfileOwner } from "./lib/mcpOwnership";

export async function resolveOwnedProfile(ctx: QueryCtx, userId: Id<"users">, profileId?: Id<"profiles">) {
  if (!(await ctx.db.get(userId))) throw new Error("User not found");
  let profile = profileId ? await ctx.db.get(profileId) : null;
  if (!profileId) {
    const own = await ctx.db.query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    profile = own.find((row) => row.isDefault) || own[0] || null;
  }
  if (profile) requireMcpProfileOwner(userId, profile);
  return profile;
}

export const listOwnedProfiles = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    if (!(await ctx.db.get(userId))) return [];
    const profiles = await ctx.db.query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    return profiles.map((profile) => ({ id: profile._id, name: profile.name, isDefault: profile.isDefault }));
  },
});

export const searchOwnedExpenses = internalQuery({
  args: {
    userId: v.id("users"),
    profileId: v.optional(v.id("profiles")),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    query: v.optional(v.string()),
    category: v.optional(v.string()),
    currency: v.optional(v.union(v.literal("INR"), v.literal("USD"), v.literal("THB"))),
    limit: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await resolveOwnedProfile(ctx, args.userId, args.profileId);
    if (!profile) return { profile: null, records: [], nextCursor: null, hasMore: false, scanned: 0 };
    const limit = Math.max(1, Math.min(Math.floor(args.limit), 100));
    const page = await ctx.db.query("expenseEntries")
      .withIndex("by_profile_date", (q) => {
        const range = q.eq("profileId", profile._id);
        if (args.startDate && args.endDate) return range.gte("date", args.startDate).lte("date", args.endDate);
        if (args.startDate) return range.gte("date", args.startDate);
        if (args.endDate) return range.lte("date", args.endDate);
        return range;
      })
      .order("desc")
      .paginate({ cursor: args.cursor || null, numItems: limit });
    const text = args.query?.trim().toLowerCase() || "";
    const categoryFilter = args.category?.trim().toLowerCase() || "";
    const records = [];
    for (const entry of page.page) {
      if (args.currency && (entry.currency || "INR") !== args.currency) continue;
      const category = await ctx.db.get(entry.categoryId);
      const categoryName = category?.name || "Unknown";
      if (categoryFilter && categoryName.toLowerCase() !== categoryFilter) continue;
      const note = await decryptStringWithFallback(entry.noteEnc, entry.note);
      if (text && !`${categoryName} ${note}`.toLowerCase().includes(text)) continue;
      records.push({
        id: entry._id, profileId: profile._id, date: entry.date,
        amount: await decryptNumberWithFallback(entry.amountEnc, entry.amount, "expenseEntries.amount"),
        currency: entry.currency || "INR", category: categoryName, note,
      });
    }
    return { profile: { id: profile._id, name: profile.name }, records,
      nextCursor: page.isDone ? null : page.continueCursor, hasMore: !page.isDone, scanned: page.page.length };
  },
});
