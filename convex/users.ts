import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth } from "./lib/auth";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getVerifiedAuthEmail } from "./lib/verifiedAuthEmail";

// Get current authenticated user with email from auth tables
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user) return null;

    // If user already has email, return it
    if (user.email) {
      return user;
    }

    // Otherwise, look up the email from authAccounts table
    // Note: providerAccountId contains the email for email-based auth providers
    const authAccounts = await ctx.db
      .query("authAccounts")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    // Get email from the first email-based provider account
    const emailAccount =
      authAccounts.find(
        (acc) => acc.providerAccountId && acc.providerAccountId.includes("@"),
      ) || authAccounts[0];

    const email = emailAccount?.providerAccountId || null;

    return {
      ...user,
      email,
    };
  },
});

// INTERNAL ONLY: Get user by email (for server-side use only)
export const getByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
  },
});

// Update user email and name
export const upsert = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) {
      throw new Error("Unauthorized: must be logged in to upsert user");
    }

    const verifiedEmail = await getVerifiedAuthEmail(ctx, authUserId);
    const normalizedEmail = args.email.toLowerCase().trim();
    if (!verifiedEmail || normalizedEmail !== verifiedEmail) {
      throw new Error("Email must match your verified sign-in address");
    }

    const updates: Record<string, string> = { email: normalizedEmail };
    if (args.name) updates.name = args.name;

    await ctx.db.patch(authUserId, updates);
    return authUserId;
  },
});

// Get Telegram link status for the current user
export const getTelegramStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const user = await ctx.db.get(userId);
    return {
      isLinked: !!user?.telegramChatId,
    };
  },
});

// Link Telegram account via code (web UI)
export const linkTelegramAccount = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);

    const linkCode = await ctx.db
      .query("telegramLinkCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .first();

    if (!linkCode) {
      throw new Error("Invalid code. Please check and try again.");
    }

    if (linkCode.expiresAt < Date.now()) {
      await ctx.db.delete(linkCode._id);
      throw new Error(
        "Code expired. Please generate a new one from the Telegram bot.",
      );
    }

    // Link the Telegram chatId to this user
    await ctx.db.patch(userId, {
      telegramChatId: linkCode.chatId,
    });

    // Clean up the code
    await ctx.db.delete(linkCode._id);

    return { success: true };
  },
});

// Unlink Telegram account (web UI)
export const unlinkTelegram = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    await ctx.db.patch(userId, { telegramChatId: undefined });
    return { success: true };
  },
});

// Dismiss Telegram onboarding prompt in Overview.
export const dismissTelegramOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    await ctx.db.patch(userId, {
      telegramOnboardingDismissedAt: Date.now(),
    });
    return { success: true };
  },
});

// Set active profile for user
export const setActiveProfile = mutation({
  args: {
    userId: v.id("users"),
    profileId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    const authUserId = await requireAuth(ctx);
    if (authUserId !== args.userId) {
      throw new Error("Access denied: Cannot modify other user's settings");
    }

    // Verify the profile is accessible to this user (own profile or family-owner access).
    const profile = await ctx.db.get(args.profileId);
    if (!profile) {
      throw new Error("Profile not found");
    }
    const own = profile.userId === args.userId;
    if (!own) {
      const myMemberships = await ctx.db
        .query("familyMembers")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect();
      const ownerFamilyIds = new Set(
        myMemberships.filter((m) => m.role === "owner").map((m) => m.familyId),
      );
      if (ownerFamilyIds.size === 0) {
        throw new Error("Access denied: Profile does not belong to this user");
      }
      const targetMemberships = await ctx.db
        .query("familyMembers")
        .withIndex("by_user", (q) => q.eq("userId", profile.userId))
        .collect();
      const canAccess = targetMemberships.some((m) =>
        ownerFamilyIds.has(m.familyId),
      );
      if (!canAccess) {
        throw new Error("Access denied: Profile does not belong to this user");
      }
    }

    await ctx.db.patch(args.userId, {
      activeProfileId: args.profileId,
    });
  },
});

export const acceptPendingFamilyInvites = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const email = await getVerifiedAuthEmail(ctx, userId);
    if (!email) return { accepted: 0 };

    const invites = await ctx.db
      .query("familyInvites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();

    let accepted = 0;
    for (const invite of invites) {
      if (invite.status !== "pending") continue;
      const existingMember = await ctx.db
        .query("familyMembers")
        .withIndex("by_family_user", (q) =>
          q.eq("familyId", invite.familyId).eq("userId", userId),
        )
        .first();
      if (!existingMember) {
        await ctx.db.insert("familyMembers", {
          familyId: invite.familyId,
          userId,
          role: invite.role,
          invitedByUserId: invite.invitedByUserId,
          joinedAt: Date.now(),
        });
      }
      await ctx.db.patch(invite._id, {
        status: "accepted",
        invitedUserId: userId,
        acceptedAt: Date.now(),
      });
      accepted += 1;
    }

    return { accepted };
  },
});

// Get user with active profile
export const getWithProfile = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const authUserId = await requireAuth(ctx);
    if (authUserId !== args.userId) {
      throw new Error("Access denied: Cannot view other user's data");
    }

    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    let activeProfile = null;
    if (user.activeProfileId) {
      activeProfile = await ctx.db.get(user.activeProfileId);
    }

    // If no active profile, get the default one
    if (!activeProfile) {
      const profiles = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect();

      activeProfile = profiles.find((p) => p.isDefault) || profiles[0] || null;
    }

    return {
      ...user,
      activeProfile,
    };
  },
});

// Ensure the authenticated user has a default profile. Creates one if missing.
export const ensureUserWithProfile = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthorized: must be logged in");
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User record not found for authenticated user");
    }

    // Check for existing profiles
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      if (!user.activeProfileId) {
        await ctx.db.patch(userId, { activeProfileId: existing._id });
      }
      return { userId, profileId: existing._id, created: false };
    }

    const profileName = args.name ?? "Me";

    const profileId = await ctx.db.insert("profiles", {
      userId,
      name: profileName,
      avatarColor: "#3B82F6",
      isDefault: true,
    });

    await ctx.db.patch(userId, { activeProfileId: profileId });

    return { userId, profileId, created: true };
  },
});
