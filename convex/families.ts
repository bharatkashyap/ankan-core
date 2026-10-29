import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth } from "./lib/auth";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export const listForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const memberships = await ctx.db
      .query("familyMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const families = await Promise.all(
      memberships.map(async (m) => {
        const family = await ctx.db.get(m.familyId);
        if (!family) return null;

        const members = await ctx.db
          .query("familyMembers")
          .withIndex("by_family", (q) => q.eq("familyId", m.familyId))
          .collect();
        const users = await Promise.all(members.map((row) => ctx.db.get(row.userId)));

        const pendingInvites = await ctx.db
          .query("familyInvites")
          .withIndex("by_family", (q) => q.eq("familyId", m.familyId))
          .collect();

        return {
          familyId: family._id,
          name: family.name,
          yourRole: m.role,
          members: members.map((row, idx) => ({
            userId: row.userId,
            role: row.role,
            joinedAt: row.joinedAt,
            name: users[idx]?.name || "Member",
            email: users[idx]?.email || null,
            emailVerified: !!users[idx]?.emailVerificationTime,
          })),
          invites: pendingInvites
            .filter((i) => i.status === "pending")
            .map((i) => ({
              inviteId: i._id,
              email: i.email,
              role: i.role,
              createdAt: i.createdAt,
              status: i.status,
            })),
        };
      }),
    );

    return families.filter((f): f is NonNullable<typeof f> => !!f);
  },
});

export const createFamily = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const familyId = await ctx.db.insert("families", {
      name: args.name.trim() || "Family",
      createdByUserId: userId,
    });
    await ctx.db.insert("familyMembers", {
      familyId,
      userId,
      role: "owner",
      joinedAt: Date.now(),
    });
    return { familyId };
  },
});

export const inviteMember = mutation({
  args: {
    familyId: v.id("families"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const myMembership = await ctx.db
      .query("familyMembers")
      .withIndex("by_family_user", (q) =>
        q.eq("familyId", args.familyId).eq("userId", userId),
      )
      .first();
    if (!myMembership) {
      throw new Error("Access denied: Not a member of this family");
    }

    // Members can invite, but only as member (never owner).
    const role = "member" as const;
    const email = normalizeEmail(args.email);

    const existingInvite = await ctx.db
      .query("familyInvites")
      .withIndex("by_family_email", (q) =>
        q.eq("familyId", args.familyId).eq("email", email),
      )
      .first();
    if (existingInvite && existingInvite.status === "pending") {
      return { inviteId: existingInvite._id, reused: true };
    }

    const inviteId = await ctx.db.insert("familyInvites", {
      familyId: args.familyId,
      email,
      role,
      invitedByUserId: userId,
      status: "pending",
      createdAt: Date.now(),
    });

    return { inviteId, reused: false };
  },
});
