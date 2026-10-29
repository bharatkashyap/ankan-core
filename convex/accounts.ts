import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireProfileAccess, requireAccountAccess } from "./lib/auth";
import {
  decryptNumberWithFallback,
  decryptStringWithFallback,
  encryptNumber,
  encryptOptionalString,
} from "./lib/fieldEncryption";

async function hydrateBalanceRecord<
  T extends {
    amount?: number;
    amountEnc?: string;
    note?: string;
    noteEnc?: string;
  },
>(row: T) {
  return {
    ...row,
    amount: await decryptNumberWithFallback(
      row.amountEnc,
      row.amount,
      "balanceHistory.amount",
    ),
    note: await decryptStringWithFallback(row.noteEnc, row.note),
  };
}

// Get all accounts for a profile
export const listByProfile = query({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    return await ctx.db
      .query("accounts")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

// Get accounts by category
export const listByCategory = query({
  args: {
    profileId: v.id("profiles"),
    category: v.union(
      v.literal("asset"),
      v.literal("liability"),
    ),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    return await ctx.db
      .query("accounts")
      .withIndex("by_profile_category", (q) =>
        q.eq("profileId", args.profileId).eq("category", args.category),
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

// Get a single account
export const get = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    await requireAccountAccess(ctx, args.accountId);
    return await ctx.db.get(args.accountId);
  },
});

// Create a new account
export const create = mutation({
  args: {
    profileId: v.id("profiles"),
    name: v.string(),
    category: v.union(
      v.literal("asset"),
      v.literal("liability"),
    ),
    type: v.optional(v.string()),
    currency: v.string(),
    displayOrder: v.number(),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    return await ctx.db.insert("accounts", {
      ...args,
      isActive: true,
    });
  },
});

// Update an account
export const update = mutation({
  args: {
    accountId: v.id("accounts"),
    name: v.optional(v.string()),
    category: v.optional(
      v.union(v.literal("asset"), v.literal("liability")),
    ),
    type: v.optional(v.string()),
    currency: v.optional(v.string()),
    displayOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAccountAccess(ctx, args.accountId);
    const { accountId, ...updates } = args;
    await ctx.db.patch(accountId, updates);
  },
});

// Deactivate (soft delete) an account
export const deactivate = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    await requireAccountAccess(ctx, args.accountId);
    await ctx.db.patch(args.accountId, { isActive: false });
  },
});

// Get all latest balances for a profile (single query for all accounts)
export const getAllLatestBalances = query({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const balances: Record<string, { amount: number; date: string }> = {};

    for (const account of accounts) {
      const latest = await ctx.db
        .query("balanceHistory")
        .withIndex("by_account_date", (q) => q.eq("accountId", account._id))
        .order("desc")
        .first();

      if (latest) {
        const hydrated = await hydrateBalanceRecord(latest);
        balances[account._id] = { amount: hydrated.amount, date: latest.date };
      }
    }

    return balances;
  },
});

// Get latest balance for an account
export const getLatestBalance = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    await requireAccountAccess(ctx, args.accountId);
    const records = await ctx.db
      .query("balanceHistory")
      .withIndex("by_account_date", (q) => q.eq("accountId", args.accountId))
      .order("desc")
      .take(1);
    const first = records[0];
    if (!first) return null;
    return await hydrateBalanceRecord(first);
  },
});

// Get balance history for an account
export const getBalanceHistory = query({
  args: {
    accountId: v.id("accounts"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAccountAccess(ctx, args.accountId);
    const rows = await ctx.db
      .query("balanceHistory")
      .withIndex("by_account_date", (q) => q.eq("accountId", args.accountId))
      .order("desc")
      .take(args.limit || 10);
    return await Promise.all(rows.map(hydrateBalanceRecord));
  },
});

// Add a balance record
export const addBalance = mutation({
  args: {
    accountId: v.id("accounts"),
    amount: v.number(),
    date: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAccountAccess(ctx, args.accountId);
    return await ctx.db.insert("balanceHistory", {
      accountId: args.accountId,
      date: args.date,
      noteEnc: await encryptOptionalString(args.note),
      amountEnc: await encryptNumber(args.amount),
    });
  },
});

// Update a balance record
export const updateBalance = mutation({
  args: {
    recordId: v.id("balanceHistory"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    // Get the balance record to find the account
    const record = await ctx.db.get(args.recordId);
    if (!record) {
      throw new Error("Balance record not found");
    }
    await requireAccountAccess(ctx, record.accountId);
    await ctx.db.patch(args.recordId, {
      amountEnc: await encryptNumber(args.amount),
    });
  },
});

// Delete a balance record
export const deleteBalance = mutation({
  args: { recordId: v.id("balanceHistory") },
  handler: async (ctx, args) => {
    // Get the balance record to find the account
    const record = await ctx.db.get(args.recordId);
    if (!record) {
      throw new Error("Balance record not found");
    }
    await requireAccountAccess(ctx, record.accountId);
    await ctx.db.delete(args.recordId);
  },
});

// Get net worth summary for a profile (with multi-currency breakdown)
export const getNetWorth = query({
  args: { profileId: v.id("profiles") },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    // Multi-currency totals
    const assetsByCurrency = { INR: 0, USD: 0, THB: 0 };
    const liabilitiesByCurrency = { INR: 0, USD: 0, THB: 0 };

    for (const account of accounts) {
      const latestBalance = await ctx.db
        .query("balanceHistory")
        .withIndex("by_account_date", (q) => q.eq("accountId", account._id))
        .order("desc")
        .first();

      if (latestBalance) {
        const hydrated = await hydrateBalanceRecord(latestBalance);
        const currency = (account.currency || "INR") as "INR" | "USD" | "THB";

        switch (account.category) {
          case "asset":
            if (currency in assetsByCurrency) {
              assetsByCurrency[currency] += hydrated.amount;
            }
            break;
          case "liability":
            if (currency in liabilitiesByCurrency) {
              liabilitiesByCurrency[currency] += hydrated.amount;
            }
            break;
        }
      }
    }

    // Calculate single-currency totals for backwards compatibility
    const assets =
      assetsByCurrency.INR + assetsByCurrency.USD + assetsByCurrency.THB;
    const liabilities =
      liabilitiesByCurrency.INR +
      liabilitiesByCurrency.USD +
      liabilitiesByCurrency.THB;

    // Calculate net worth per currency.
    const netWorthByCurrency = {
      INR: assetsByCurrency.INR - liabilitiesByCurrency.INR,
      USD: assetsByCurrency.USD - liabilitiesByCurrency.USD,
      THB: assetsByCurrency.THB - liabilitiesByCurrency.THB,
    };

    return {
      assets,
      liabilities,
      netWorth: assets - liabilities,
      // Multi-currency breakdown
      assetsByCurrency,
      liabilitiesByCurrency,
      netWorthByCurrency,
    };
  },
});

// Net worth history by month for a profile (assets - liabilities per currency)
export const getNetWorthHistoryByMonth = query({
  args: {
    profileId: v.id("profiles"),
    months: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId);

    const monthsCount = Math.max(1, Math.min(24, args.months ?? 12));
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (monthsCount - 1), 1);
    const months: string[] = [];
    const monthEnds: string[] = [];
    const cursor = new Date(start);
    for (let i = 0; i < monthsCount; i += 1) {
      const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      months.push(month);
      monthEnds.push(`${month}-31`);
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_profile", (q) => q.eq("profileId", args.profileId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const totalsByMonth = months.map((month) => ({
      month,
      totals: { INR: 0, USD: 0, THB: 0 },
    }));

    for (const account of accounts) {
      const history = await ctx.db
        .query("balanceHistory")
        .withIndex("by_account_date", (q) => q.eq("accountId", account._id))
        .order("asc")
        .collect();
      if (history.length === 0) continue;
      const hydratedHistory = await Promise.all(history.map(hydrateBalanceRecord));

      let pointer = 0;
      let lastAmount: number | null = null;
      for (let idx = 0; idx < months.length; idx += 1) {
        const endDate = monthEnds[idx]!;
        while (pointer < hydratedHistory.length && hydratedHistory[pointer]!.date <= endDate) {
          lastAmount = hydratedHistory[pointer]!.amount;
          pointer += 1;
        }
        if (lastAmount === null) continue;
        const currency = (account.currency || "INR") as "INR" | "USD" | "THB";
        const bucket = totalsByMonth[idx]!.totals;
        if (account.category === "asset") {
          bucket[currency] += lastAmount;
        } else {
          bucket[currency] -= lastAmount;
        }
      }
    }

    return totalsByMonth;
  },
});
