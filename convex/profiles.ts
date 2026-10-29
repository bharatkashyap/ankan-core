import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth, requireProfileAccess } from "./lib/auth";
import type { Id } from "./_generated/dataModel";

// Get all profiles for a user
export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const authUserId = await requireAuth(ctx);
    if (authUserId !== args.userId) {
      throw new Error("Access denied: Cannot view other user's profiles");
    }

    return await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const listAccessible = query({
  args: {},
  handler: async (ctx) => {
    const authUserId = await requireAuth(ctx);
    const ownProfiles = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", authUserId))
      .collect();

    const memberships = await ctx.db
      .query("familyMembers")
      .withIndex("by_user", (q) => q.eq("userId", authUserId))
      .collect();
    const ownerFamilyIds = new Set(
      memberships.filter((m) => m.role === "owner").map((m) => m.familyId),
    );

    if (ownerFamilyIds.size === 0) return ownProfiles;

    const familyMembers = await Promise.all(
      Array.from(ownerFamilyIds).map((familyId) =>
        ctx.db
          .query("familyMembers")
          .withIndex("by_family", (q) => q.eq("familyId", familyId))
          .collect(),
      ),
    );
    const visibleUserIds = new Set<Id<"users">>([authUserId]);
    for (const rows of familyMembers) {
      for (const row of rows) visibleUserIds.add(row.userId);
    }

    const allProfiles = await ctx.db.query("profiles").collect();
    return allProfiles.filter((p) => visibleUserIds.has(p.userId));
  },
});

// Get a single profile
export const get = query({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);
    return await ctx.db.get(args.profileId);
  },
});

// Create a new profile
export const create = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    avatarColor: v.string(),
    isDefault: v.boolean(),
  },
  handler: async (ctx, args) => {
    const authUserId = await requireAuth(ctx);
    if (authUserId !== args.userId) {
      throw new Error("Access denied: Cannot create profiles for other users");
    }

    // If this is set as default, unset other defaults
    if (args.isDefault) {
      const existingProfiles = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect();

      for (const profile of existingProfiles) {
        if (profile.isDefault) {
          await ctx.db.patch(profile._id, { isDefault: false });
        }
      }
    }

    const profileId = await ctx.db.insert("profiles", {
      userId: args.userId,
      name: args.name,
      avatarColor: args.avatarColor,
      isDefault: args.isDefault,
    });

    // Set as active profile for user if it's the default
    if (args.isDefault) {
      await ctx.db.patch(args.userId, { activeProfileId: profileId });
    }

    return profileId;
  },
});

// Update a profile
export const update = mutation({
  args: {
    profileId: v.id("profiles"),
    name: v.optional(v.string()),
    avatarColor: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const { profileId, ...updates } = args;
    const profile = await ctx.db.get(profileId);
    if (!profile) throw new Error("Profile not found");

    // If setting as default, unset others
    if (updates.isDefault) {
      const existingProfiles = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", profile.userId))
        .collect();

      for (const p of existingProfiles) {
        if (p._id !== profileId && p.isDefault) {
          await ctx.db.patch(p._id, { isDefault: false });
        }
      }
    }

    await ctx.db.patch(profileId, updates);
  },
});

// Delete a profile
export const remove = mutation({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);
    await ctx.db.delete(args.profileId);
  },
});
