import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { resolveOwnedProfile } from "./mcpExpenses";
import {
  decryptNumberWithFallback, decryptSalaryDetailsWithFallback,
  decryptSecretString, decryptStringWithFallback,
} from "./lib/fieldEncryption";

const profilePageArgs = {
  userId: v.id("users"), profileId: v.optional(v.id("profiles")),
  limit: v.number(), cursor: v.optional(v.string()),
};
const datedPageArgs = {
  ...profilePageArgs, startDate: v.optional(v.string()), endDate: v.optional(v.string()),
};
const pageSize = (limit: number) => Math.max(1, Math.min(Math.floor(limit), 100));
const pageResult = (page: { continueCursor: string; isDone: boolean }) => ({
  nextCursor: page.isDone ? null : page.continueCursor, hasMore: !page.isDone,
});

export const searchIncome = internalQuery({
  args: datedPageArgs,
  handler: async (ctx, args) => {
    const profile = await resolveOwnedProfile(ctx, args.userId, args.profileId);
    if (!profile) return { records: [], nextCursor: null, hasMore: false };
    const page = await ctx.db.query("incomeEntries").withIndex("by_profile_date", (q) => {
      const range = q.eq("profileId", profile._id);
      if (args.startDate && args.endDate) return range.gte("date", args.startDate).lte("date", args.endDate);
      if (args.startDate) return range.gte("date", args.startDate);
      if (args.endDate) return range.lte("date", args.endDate);
      return range;
    }).order("desc").paginate({ cursor: args.cursor || null, numItems: pageSize(args.limit) });
    const records = await Promise.all(page.page.map(async (row) => ({
      id: row._id, profileId: profile._id, date: row.date, currency: row.currency || "INR",
      category: (await ctx.db.get(row.categoryId))?.name || "Unknown",
      amount: await decryptNumberWithFallback(row.amountEnc, row.amount, "incomeEntries.amount"),
      netReceivedAmount: row.netReceivedAmountEnc || row.netReceivedAmount !== undefined
        ? await decryptNumberWithFallback(row.netReceivedAmountEnc, row.netReceivedAmount, "incomeEntries.netReceivedAmount") : null,
      salaryDetails: await decryptSalaryDetailsWithFallback(row.salaryDetailsEnc, row.salaryDetails),
      note: await decryptStringWithFallback(row.noteEnc, row.note),
      jurisdiction: row.jurisdiction, incomeType: row.incomeType, source: row.source,
    })));
    return { records, ...pageResult(page) };
  },
});

export const searchHealth = internalQuery({
  args: datedPageArgs,
  handler: async (ctx, args) => {
    const profile = await resolveOwnedProfile(ctx, args.userId, args.profileId);
    if (!profile) return { records: [], nextCursor: null, hasMore: false };
    const page = await ctx.db.query("healthEntries").withIndex("by_profile_date", (q) => {
      const range = q.eq("profileId", profile._id);
      if (args.startDate && args.endDate) return range.gte("date", args.startDate).lte("date", args.endDate);
      if (args.startDate) return range.gte("date", args.startDate);
      if (args.endDate) return range.lte("date", args.endDate);
      return range;
    }).order("desc").paginate({ cursor: args.cursor || null, numItems: pageSize(args.limit) });
    const records = await Promise.all(page.page.map(async ({ noteEnc, ...row }) => ({
      ...row, note: await decryptStringWithFallback(noteEnc, undefined),
    })));
    return { records, ...pageResult(page) };
  },
});

export const listAccounts = internalQuery({
  args: profilePageArgs,
  handler: async (ctx, args) => {
    const profile = await resolveOwnedProfile(ctx, args.userId, args.profileId);
    if (!profile) return { records: [], nextCursor: null, hasMore: false };
    const page = await ctx.db.query("accounts").withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .paginate({ cursor: args.cursor || null, numItems: pageSize(args.limit) });
    const records = await Promise.all(page.page.map(async (account) => {
      const latest = await ctx.db.query("balanceHistory")
        .withIndex("by_account_date", (q) => q.eq("accountId", account._id)).order("desc").first();
      return { id: account._id, profileId: account.profileId, name: account.name,
        category: account.category, type: account.type, currency: account.currency,
        isActive: account.isActive, balance: latest ? {
          date: latest.date,
          amount: await decryptNumberWithFallback(latest.amountEnc, latest.amount, "balanceHistory.amount"),
        } : null };
    }));
    return { records, ...pageResult(page) };
  },
});

export const searchBalances = internalQuery({
  args: { userId: v.id("users"), accountId: v.id("accounts"), limit: v.number(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new Error("Account not found");
    if (!(await resolveOwnedProfile(ctx, args.userId, account.profileId))) throw new Error("Account profile not found");
    const page = await ctx.db.query("balanceHistory")
      .withIndex("by_account_date", (q) => q.eq("accountId", args.accountId))
      .order("desc").paginate({ cursor: args.cursor || null, numItems: pageSize(args.limit) });
    const records = await Promise.all(page.page.map(async (row) => ({
      id: row._id, accountId: row.accountId, date: row.date,
      amount: await decryptNumberWithFallback(row.amountEnc, row.amount, "balanceHistory.amount"),
      note: await decryptStringWithFallback(row.noteEnc, row.note),
    })));
    return { records, ...pageResult(page) };
  },
});

export const searchTaxPayments = internalQuery({
  args: datedPageArgs,
  handler: async (ctx, args) => {
    const profile = await resolveOwnedProfile(ctx, args.userId, args.profileId);
    if (!profile) return { records: [], nextCursor: null, hasMore: false };
    const page = await ctx.db.query("taxPayments")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .paginate({ cursor: args.cursor || null, numItems: pageSize(args.limit) });
    const records = await Promise.all(page.page.filter((row) =>
      (!args.startDate || row.date >= args.startDate) && (!args.endDate || row.date <= args.endDate))
      .map(async (row) => ({
        id: row._id, profileId: row.profileId, date: row.date, fiscalYear: row.fiscalYear,
        jurisdiction: row.jurisdiction, paymentType: row.paymentType, currency: row.currency,
        amount: await decryptNumberWithFallback(row.amountEnc, row.amount, "taxPayments.amount"),
        note: await decryptStringWithFallback(row.noteEnc, row.note), source: row.source,
      })));
    return { records, ...pageResult(page) };
  },
});

export const listTaxResidency = internalQuery({
  args: profilePageArgs,
  handler: async (ctx, args) => {
    const profile = await resolveOwnedProfile(ctx, args.userId, args.profileId);
    if (!profile) return { records: [], nextCursor: null, hasMore: false };
    const page = await ctx.db.query("taxResidency")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .paginate({ cursor: args.cursor || null, numItems: pageSize(args.limit) });
    const records = await Promise.all(page.page.map(async ({ noteEnc, note, ...row }) => ({
      ...row, note: await decryptStringWithFallback(noteEnc, note),
    })));
    return { records, ...pageResult(page) };
  },
});

export const listMealReferences = internalQuery({
  args: profilePageArgs,
  handler: async (ctx, args) => {
    const profile = await resolveOwnedProfile(ctx, args.userId, args.profileId);
    if (!profile) return { records: [], nextCursor: null, hasMore: false };
    const page = await ctx.db.query("mealReferences")
      .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
      .paginate({ cursor: args.cursor || null, numItems: pageSize(args.limit) });
    const records = await Promise.all(page.page.map(async ({ nameEnc, ...row }) => ({
      ...row, name: await decryptSecretString(nameEnc),
    })));
    return { records, ...pageResult(page) };
  },
});

export const listTripReports = internalQuery({
  args: { userId: v.id("users"), limit: v.number(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("tripReports")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.userId))
      .paginate({ cursor: args.cursor || null, numItems: pageSize(args.limit) });
    const owned = await Promise.all(page.page.map(async (row) => {
      const profile = await ctx.db.get(row.profileId);
      return profile?.userId === args.userId ? { id: row._id, profileId: row.profileId,
        title: row.title, place: row.place, participants: row.participants, expiresAt: row.expiresAt } : null;
    }));
    return { records: owned.filter((row) => row !== null),
      ...pageResult(page) };
  },
});

export const listTripReportEntries = internalQuery({
  args: { userId: v.id("users"), reportId: v.id("tripReports"), limit: v.number(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report || report.ownerUserId !== args.userId) throw new Error("Report not found");
    if (!(await resolveOwnedProfile(ctx, args.userId, report.profileId))) throw new Error("Report profile not found");
    const page = await ctx.db.query("tripReportEntries")
      .withIndex("by_report", (q) => q.eq("reportId", report._id))
      .paginate({ cursor: args.cursor || null, numItems: pageSize(args.limit) });
    const records = await Promise.all(page.page.map(async ({ noteEnc, amountEnc, ...row }) => ({
      ...row, note: await decryptStringWithFallback(noteEnc, undefined),
      amount: await decryptNumberWithFallback(amountEnc, undefined, "tripReportEntries.amount"),
    })));
    return { records, ...pageResult(page) };
  },
});

export const listTripSettlements = internalQuery({
  args: { userId: v.id("users"), reportId: v.id("tripReports"), limit: v.number(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report || report.ownerUserId !== args.userId) throw new Error("Report not found");
    if (!(await resolveOwnedProfile(ctx, args.userId, report.profileId))) throw new Error("Report profile not found");
    const page = await ctx.db.query("tripReportSettlements")
      .withIndex("by_report", (q) => q.eq("reportId", report._id))
      .paginate({ cursor: args.cursor || null, numItems: pageSize(args.limit) });
    const records = await Promise.all(page.page.map(async ({ amountEnc, ...row }) => ({
      ...row, amount: await decryptNumberWithFallback(amountEnc, undefined, "tripReportSettlements.amount"),
    })));
    return { records, ...pageResult(page) };
  },
});

export const listFamilyMemberships = internalQuery({
  args: { userId: v.id("users"), limit: v.number(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("familyMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .paginate({ cursor: args.cursor || null, numItems: pageSize(args.limit) });
    const records = await Promise.all(page.page.map(async (row) => ({
      familyId: row.familyId, name: (await ctx.db.get(row.familyId))?.name || "Unknown",
      role: row.role, joinedAt: row.joinedAt,
    })));
    return { records, ...pageResult(page) };
  },
});
